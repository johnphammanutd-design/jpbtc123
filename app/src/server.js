import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import webpush from 'web-push';
import { db, hashPassword, verifyPassword, ensureBoardLabels } from './db.js';
import { canSeeBoard, canSeeCard, canManageBoard, invalidateReview, canReadUpload, boardRole, isLeader, userById, requireBoard, authorizeResource, validateActions, fail } from './access.js';
import { cloneCard, moveCard } from './card-data.js';
import { registerWorkRoutes } from './work-routes.js';
import { companyDate, validDate, validTime, addDays, nextOccurrence, dueInstant, REMIND_MS } from './dates.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.set('trust proxy', 1); // chạy sau reverse proxy (Caddy/Nginx) — lấy đúng IP người dùng
app.use(express.json({ limit: '1mb' }));

// Security headers cơ bản cho triển khai nội bộ
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'",
  });
  next();
});
app.use(express.static(path.join(__dirname, '..', 'public')));

/* ---------- Chặn dò mật khẩu: 5 lần sai → khóa IP+tài khoản 15 phút ---------- */
const loginFails = new Map(); // key "ip|username" -> { fails, until }
const FAIL_LIMIT = 5;
const LOCK_MS = 15 * 60 * 1000;

function loginThrottle(req, res, next) {
  const key = `${req.ip}|${String(req.body?.username || '').trim().toLowerCase()}`;
  const entry = loginFails.get(key);
  if (entry && entry.until > Date.now()) {
    const mins = Math.ceil((entry.until - Date.now()) / 60000);
    return res.status(429).json({ error: `Sai quá ${FAIL_LIMIT} lần. Thử lại sau ${mins} phút.` });
  }
  req.loginKey = key;
  next();
}

function recordLoginFail(key) {
  const entry = loginFails.get(key) || { fails: 0, until: 0 };
  entry.fails += 1;
  if (entry.fails >= FAIL_LIMIT) {
    entry.until = Date.now() + LOCK_MS;
    entry.fails = 0;
  }
  loginFails.set(key, entry);
  if (loginFails.size > 10000) loginFails.clear(); // chống phình bộ nhớ
}

/* ---------- Xác thực ---------- */

// Phiên đăng nhập tự hết hạn sau 30 ngày (đổi bằng SESSION_TTL_DAYS)
const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS || 30);

function getSessionUser(token) {
  if (!token) return null;
  return db.prepare(`
    SELECT u.id, u.username, u.name, u.is_admin, u.disabled FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND u.disabled = 0
      AND s.created_at > datetime('now', ?)
  `).get(token, `-${SESSION_TTL_DAYS} days`) || null;
}

// Dọn phiên hết hạn mỗi lần có đăng nhập mới
function pruneSessions() {
  db.prepare("DELETE FROM sessions WHERE created_at <= datetime('now', ?)").run(`-${SESSION_TTL_DAYS} days`);
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const cookieToken = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('kanban-session='))?.slice(15);
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.method==='GET' && req.originalUrl.startsWith('/u/') ? cookieToken : null);
  const user = getSessionUser(token);
  if (!user) return res.status(401).json({ error: 'Chưa đăng nhập hoặc phiên đã hết hạn' });
  req.user = user;
  req.token = token;
  if (!cookieToken && header.startsWith('Bearer ')) setSessionCookie(req, res, token);
  next();
}

function adminOnly(req, res, next) {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Chỉ quản trị viên được phép' });
  next();
}


function setSessionCookie(req, res, token) {
  res.cookie('kanban-session', token, { httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: SESSION_TTL_DAYS * 864e5, path: '/' });
}
app.use('/api', (req, res, next) => {
  res.set('Cache-Control','no-store');
  if (req.path === '/login') return next();
  auth(req, res, () => authorizeResource(req, res, next));
});

app.post('/api/login', loginThrottle, (req, res) => {
  const { username, password } = req.body || {};
  const row = db.prepare('SELECT * FROM users WHERE username = ? AND disabled = 0').get(String(username || '').trim());
  if (!row || !verifyPassword(String(password || ''), row.password_hash)) {
    recordLoginFail(req.loginKey);
    return res.status(401).json({ error: 'Sai tên đăng nhập hoặc mật khẩu' });
  }
  loginFails.delete(req.loginKey);
  pruneSessions();
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, row.id);
  setSessionCookie(req, res, token);
  res.json({ token, user: { id: row.id, username: row.username, name: row.name, is_admin: !!row.is_admin, is_leader:isLeader(row.id) } });
});

app.post('/api/logout', auth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
  res.clearCookie('kanban-session', { path: '/' });
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => res.json({ user: { ...req.user, is_leader: isLeader(req.user.id) } }));

app.post('/api/me/password', auth, (req, res) => {
  const { current, password } = req.body || {};
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(String(current || ''), row.password_hash)) {
    return res.status(400).json({ error: 'Mật khẩu hiện tại không đúng' });
  }
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: 'Mật khẩu mới cần ít nhất 6 ký tự' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(password)), req.user.id);
  res.json({ ok: true });
});

/* ---------- Người dùng (admin) ---------- */

app.get('/api/users', auth, (req, res) => {
  res.json({ users: db.prepare('SELECT id, username, name, is_admin, disabled FROM users ORDER BY name').all() });
});

app.post('/api/users', auth, adminOnly, (req, res) => {
  const { username, name, password, is_admin } = req.body || {};
  const u = String(username || '').trim().toLowerCase();
  if (!u || !name || !password || String(password).length < 6) {
    return res.status(400).json({ error: 'Cần tên đăng nhập, tên hiển thị và mật khẩu ≥ 6 ký tự' });
  }
  try {
    const info = db.prepare('INSERT INTO users (username, name, password_hash, is_admin) VALUES (?, ?, ?, ?)')
      .run(u, String(name).trim(), hashPassword(String(password)), is_admin ? 1 : 0);
    res.json({ id: info.lastInsertRowid });
  } catch {
    res.status(400).json({ error: 'Tên đăng nhập đã tồn tại' });
  }
});

app.patch('/api/users/:id', auth, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const { password, disabled, is_admin, name } = req.body || {};
  if (password !== undefined) {
    if (String(password).length < 6) return res.status(400).json({ error: 'Mật khẩu mới cần ít nhất 6 ký tự' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(password)), id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }
  if (name !== undefined) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(String(name).trim(), id);
  if (disabled !== undefined) {
    if (id === req.user.id) return res.status(400).json({ error: 'Không thể tự khóa tài khoản của mình' });
    db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, id);
    if (disabled) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }
  if (is_admin !== undefined && id !== req.user.id) {
    db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(is_admin ? 1 : 0, id);
  }
  res.json({ ok: true });
});

/* ---------- Trợ giúp chung ---------- */

function nextPosition(table, whereSql, params) {
  const row = db.prepare(`SELECT COALESCE(MAX(position), 0) AS p FROM ${table} ${whereSql}`).get(...params);
  return row.p + 1024;
}

const boardIdOfList = listId =>
  db.prepare('SELECT board_id FROM lists WHERE id = ?').get(listId)?.board_id;
const boardIdOfCard = cardId =>
  db.prepare('SELECT l.board_id FROM cards c JOIN lists l ON l.id = c.list_id WHERE c.id = ?').get(cardId)?.board_id;

function logActivity(boardId, cardId, userId, type, data = {}) {
  if (!boardId) return;
  db.prepare('INSERT INTO activity (board_id, card_id, user_id, type, data) VALUES (?, ?, ?, ?, ?)')
    .run(boardId, cardId, userId, type, JSON.stringify(data));
}

function notifyBoard(boardId) {
  if (boardId) broadcast(boardId, { type: 'board-changed', boardId });
}

/* ---------- Web Push (thông báo đẩy tới điện thoại) ---------- */

// VAPID key tự sinh lần đầu, lưu trong DATA_DIR để giữ qua các lần deploy
const VAPID_FILE = path.join(process.env.DATA_DIR || path.resolve('data'), 'vapid.json');
let vapid;
try { vapid = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8')); }
catch {
  vapid = webpush.generateVAPIDKeys();
  fs.mkdirSync(path.dirname(VAPID_FILE), { recursive: true });
  fs.writeFileSync(VAPID_FILE, JSON.stringify(vapid));
}
webpush.setVapidDetails('mailto:admin@task.kairetic.com', vapid.publicKey, vapid.privateKey);

function pushTypeText(type, data) {
  const t = data.title ? `"${String(data.title).slice(0, 60)}"` : 'thẻ';
  switch (type) {
    case 'assigned': return 'Bạn được gán vào ' + t;
    case 'mention': return `Bạn được nhắc trong ${t}: ${data.text || ''}`;
    case 'comment': return `Bình luận mới ở ${t}: ${data.text || ''}`;
    case 'moved': return `${t} chuyển từ "${data.from}" sang "${data.to}"`;
    case 'due_soon': return `⏰ ${t} sắp đến hạn (${data.due})`;
    case 'due_overdue': return `🔴 ${t} đã TRỄ HẠN (${data.due})`;
    case 'completed': return `✅ ${t} đã hoàn thành`;
    case 'created': return `🆕 Thẻ mới ${t} trên board bạn theo dõi`;
    case 'review_requested': return 'Công việc chờ bạn duyệt: '+t;
    case 'review_approved': return 'Đã duyệt hoàn thành: '+t;
    case 'review_changes': return 'Cần chỉnh sửa: '+t;
    default: return t;
  }
}

function sendWebPush(userId, type, cardId, data) {
  const subs = db.prepare('SELECT * FROM push_subs WHERE user_id = ?').all(userId);
  if (!subs.length) return;
  const payload = JSON.stringify({
    title: '📋 Bảng công việc',
    body: pushTypeText(type, data),
    url: cardId ? '/#c/' + cardId : '/',
    tag: cardId ? 'card-' + cardId : undefined,
  });
  for (const s of subs) {
    webpush.sendNotification(JSON.parse(s.sub_json), payload).catch(err => {
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        db.prepare('DELETE FROM push_subs WHERE id = ?').run(s.id); // thiết bị đã hủy đăng ký
      }
    });
  }
}

/* ---------- Thông báo cá nhân (chuông 🔔) ---------- */

// Tạo thông báo cho userId (bỏ qua khi tự mình gây ra), đẩy realtime + Web Push
function pushNotification(userId, actorId, type, boardId, cardId, data = {}) {
  if (!userId || userId === actorId || (boardId && !canSeeBoard(userById(userId),boardId)) || (cardId && !canSeeCard(userById(userId),cardId))) return;
  db.prepare(`INSERT INTO notifications (user_id, actor_id, type, board_id, card_id, data)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(userId, actorId, type, boardId, cardId, JSON.stringify(data));
  broadcastUser(userId, { type: 'notification' });
  try { sendWebPush(userId, type, cardId, data); } catch {}
}

app.get('/api/push/key', auth, (req, res) => res.json({ key: vapid.publicKey }));

app.post('/api/push/subscribe', auth, (req, res) => {
  const sub = req.body?.subscription;
  if (!sub?.endpoint) return res.status(400).json({ error: 'Thiếu subscription' });
  db.prepare(`INSERT INTO push_subs (user_id, endpoint, sub_json) VALUES (?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, sub_json = excluded.sub_json`)
    .run(req.user.id, String(sub.endpoint), JSON.stringify(sub));
  res.json({ ok: true });
});

app.post('/api/push/unsubscribe', auth, (req, res) => {
  const endpoint = String(req.body?.endpoint || '');
  db.prepare('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?').run(endpoint, req.user.id);
  res.json({ ok: true });
});

const cardMemberIds = cardId =>
  db.prepare('SELECT user_id FROM card_members WHERE card_id = ?').all(cardId).map(r => r.user_id);

// Người nhận thông báo của một thẻ: thành viên ∪ theo dõi thẻ ∪ theo dõi board
const cardRecipientIds = cardId => [...new Set([
  ...cardMemberIds(cardId),
  ...db.prepare('SELECT lw.user_id FROM list_watchers lw JOIN cards c ON c.list_id=lw.list_id WHERE c.id=?').all(cardId).map(r=>r.user_id),
  ...db.prepare('SELECT user_id FROM card_watchers WHERE card_id = ?').all(cardId).map(r => r.user_id),
  ...db.prepare(`SELECT bw.user_id FROM board_watchers bw
    JOIN lists l ON l.board_id = bw.board_id JOIN cards c ON c.list_id = l.id
    WHERE c.id = ?`).all(cardId).map(r => r.user_id),
])];

const boardWatcherIds = boardId =>
  db.prepare('SELECT user_id FROM board_watchers WHERE board_id = ?').all(boardId).map(r => r.user_id);

// @mention trong bình luận: @username (không dấu cách)
function mentionedUserIds(text) {
  const names = [...String(text).matchAll(/@([a-z0-9._-]+)/gi)].map(m => m[1].toLowerCase());
  if (!names.length) return [];
  return db.prepare(`SELECT id FROM users WHERE disabled = 0 AND lower(username) IN (${names.map(() => '?').join(',')})`)
    .all(...names).map(r => r.id);
}

// Nhắc theo ngày/giờ của công ty, độc lập múi giờ máy chủ.
function scanDueNotifications(now = new Date()) {
  const cards = db.prepare(`SELECT c.*,l.board_id FROM cards c JOIN lists l ON l.id=c.list_id JOIN boards b ON b.id=l.board_id
    WHERE c.archived=0 AND l.archived=0 AND b.closed=0 AND c.is_template=0 AND c.mirror_of IS NULL AND c.due_complete=0 AND c.due_date!=''`).all();
  const seen = db.prepare("SELECT 1 FROM notifications WHERE user_id=? AND card_id=? AND type=? AND json_extract(data,'$.occurrence')=?");
  for (const c of cards) {
    if (c.remind==='none' || REMIND_MS[c.remind]===undefined) continue;
    const due = dueInstant(c.due_date,c.due_time), time = now.getTime();
    if (!Number.isFinite(due) || time < due - REMIND_MS[c.remind] || time > due+3*864e5) continue;
    const type = time > due ? 'due_overdue' : 'due_soon';
    const occurrence = c.due_date+'T'+(c.due_time || '23:59')+'|'+c.remind;
    for (const uid of cardRecipientIds(c.id)) {
      if (!seen.get(uid,c.id,type,occurrence)) pushNotification(uid,null,type,c.board_id,c.id,{title:c.title,due:c.due_date,due_time:c.due_time,occurrence});
    }
  }
}

function completeCard(cardId, approved = false) {
  const card = db.prepare('SELECT c.*,b.approval_required FROM cards c JOIN lists l ON l.id=c.list_id JOIN boards b ON b.id=l.board_id WHERE c.id=?').get(cardId);
  if (card.approval_required && !approved) return false;
  db.prepare('UPDATE cards SET due_complete=1 WHERE id=?').run(cardId);
  if (card.recur && card.due_date) {
    const anchor=card.recur==='monthly'?(card.recur_anchor_day || Number(card.due_date.slice(8))):0;
    const next=nextOccurrence(card.due_date,card.recur,anchor),delta=Math.round((Date.parse(next)-Date.parse(card.due_date))/864e5);
    const start=validDate(card.start_date)?addDays(card.start_date,delta):card.start_date;
    db.prepare("UPDATE cards SET due_date=?,start_date=?,recur_anchor_day=?,due_complete=0,approval_state='in_progress',submitted_by=NULL WHERE id=?").run(next,start,anchor,cardId);
    for(const item of db.prepare("SELECT id,due_date FROM checklist_items WHERE card_id=? AND due_date!=''").all(cardId))if(validDate(item.due_date))db.prepare('UPDATE checklist_items SET due_date=? WHERE id=?').run(addDays(item.due_date,delta),item.id);
    db.prepare('UPDATE checklist_items SET checked=0 WHERE card_id=?').run(cardId);
    db.prepare('DELETE FROM due_rule_applied WHERE card_id=?').run(cardId);
    logActivity(boardIdOfCard(cardId),cardId,null,'rule_applied',{applied:['🔁 định kỳ: dời hạn sang '+next]});
  }
  return true;
}
/* ---------- Automation theo lịch & theo ngày hạn (Butler mở rộng) ---------- */

function sortListNow(listId, by) {
  const orders = {
    title: 'ORDER BY title COLLATE NOCASE',
    due: "ORDER BY CASE WHEN due_date = '' THEN 1 ELSE 0 END, due_date",
    created: 'ORDER BY created_at DESC, id DESC',
  };
  if (!orders[by]) return;
  const cards = db.prepare(`SELECT id FROM cards WHERE list_id = ? AND archived = 0 ${orders[by]}`).all(listId);
  const upd = db.prepare('UPDATE cards SET position = ? WHERE id = ?');
  cards.forEach((c, i) => upd.run((i + 1) * 1024, c.id));
}

function runScheduledAutomations() {
  const today = companyDate();
  const weekday = ((new Date(today+'T12:00:00Z').getUTCDay() + 6) % 7) + 1; // 1=Thứ 2 … 7=CN
  const rows = db.prepare("SELECT * FROM auto_schedules WHERE enabled = 1 AND last_run != ?").all(today);
  for (const s of rows) {
    if (db.prepare('SELECT closed FROM boards WHERE id=?').get(s.board_id)?.closed) continue;
    if (s.cadence === 'weekly' && s.weekday !== weekday) continue;
    let a = {};
    try { a = JSON.parse(s.actions); validateActions(a,s.board_id); } catch { continue; }
    if ([a.sort?.list_id,a.archive_done_list_id].filter(Boolean).some(id=>db.prepare('SELECT archived FROM lists WHERE id=?').get(Number(id))?.archived)) continue;
    const applied = [];
    if (a.sort?.list_id) { sortListNow(Number(a.sort.list_id), String(a.sort.by || 'due')); applied.push('sort'); }
    if (a.archive_done_list_id) {
      db.prepare('UPDATE cards SET archived = 1 WHERE list_id = ? AND due_complete = 1 AND archived = 0')
        .run(Number(a.archive_done_list_id));
      applied.push('archive_done');
    }
    db.prepare('UPDATE auto_schedules SET last_run = ? WHERE id = ?').run(today, s.id);
    if (applied.length) {
      logActivity(s.board_id, null, null, 'rule_applied', { applied: ['⏰ lịch: ' + applied.join(', ')] });
      notifyBoard(s.board_id);
    }
  }
}

function runDueRules() {
  const today = companyDate();
  const tomorrow = addDays(today,1);
  const rules = db.prepare('SELECT * FROM due_rules WHERE enabled = 1').all();
  for (const rule of rules) {
    let a = {};
    try { a = JSON.parse(rule.actions); validateActions(a,rule.board_id); } catch { continue; }
    const cond = rule.trigger === 'overdue' ? `c.due_date <= '${today}'` : `c.due_date = '${tomorrow}'`;
    const cards = db.prepare(`
      SELECT c.id,c.title,c.due_date,c.due_time FROM cards c JOIN lists l ON l.id=c.list_id
      WHERE l.board_id = ? AND l.archived=0 AND (SELECT closed FROM boards WHERE id=l.board_id)=0 AND c.is_template=0 AND c.mirror_of IS NULL AND c.archived = 0 AND c.due_complete = 0 AND c.due_date != '' AND ${cond}
        AND NOT EXISTS (SELECT 1 FROM due_rule_applied da WHERE da.rule_id = ? AND da.card_id = c.id)
    `).all(rule.board_id, rule.id);
    for (const c of cards) {
      if(rule.trigger==='overdue' && dueInstant(c.due_date,c.due_time)>=Date.now()) continue;
      const applied = [];
      if (a.label_id) {
        db.prepare('INSERT OR IGNORE INTO card_labels (card_id, label_id) VALUES (?, ?)').run(c.id, Number(a.label_id));
        applied.push('label');
      }
      if (a.move_list_id) {
        db.prepare('UPDATE cards SET list_id = ?, position = ? WHERE id = ?')
          .run(Number(a.move_list_id), nextPosition('cards', 'WHERE list_id = ?', [Number(a.move_list_id)]), c.id);
        applied.push('move');
      }
      db.prepare('INSERT OR IGNORE INTO due_rule_applied (rule_id, card_id) VALUES (?, ?)').run(rule.id, c.id);
      if (applied.length) {
        logActivity(rule.board_id, c.id, null,
          'rule_applied', { applied: [(rule.trigger === 'overdue' ? '🔴 quá hạn: ' : '⏰ sắp hạn: ') + applied.join(', ')] });
      }
    }
    if (cards.length) notifyBoard(rule.board_id);
  }
}

function hourlyTick() {
  try { scanDueNotifications(); } catch (e) { console.error('scanDue:', e.message); }
  try { runScheduledAutomations(); } catch (e) { console.error('schedules:', e.message); }
  try { runDueRules(); } catch (e) { console.error('dueRules:', e.message); }
}
if (process.env.NODE_ENV !== 'test') {
  setInterval(hourlyTick, 60 * 1000);
  setTimeout(hourlyTick, 10 * 1000);
}

app.get('/api/notifications', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT n.*, u.name AS actor_name, c.title AS card_title, b.title AS board_title
    FROM notifications n
    LEFT JOIN users u ON u.id = n.actor_id
    LEFT JOIN cards c ON c.id = n.card_id
    LEFT JOIN boards b ON b.id = n.board_id
    WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 50
  `).all(req.user.id);
  const visible=rows.filter(n=>(!n.board_id || canSeeBoard(req.user,n.board_id)) && (!n.card_id || canSeeCard(req.user,n.card_id)));
  const unread=db.prepare('SELECT board_id,card_id FROM notifications WHERE user_id=? AND read=0').all(req.user.id).filter(n=>(!n.board_id || canSeeBoard(req.user,n.board_id)) && (!n.card_id || canSeeCard(req.user,n.card_id))).length;
  res.json({notifications:visible,unread});
});

app.post('/api/notifications/read', auth, (req, res) => {
  const ids = req.body?.ids;
  if (Array.isArray(ids) && ids.length) {
    db.prepare(`UPDATE notifications SET read = 1 WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`)
      .run(req.user.id, ...ids.map(Number));
  } else {
    db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user.id);
  }
  res.json({ ok: true });
});

/* ---------- Boards ---------- */

// Mọi bảng nội bộ đều cần cấp quyền; leader quản lý các bảng thuộc team được giao.
app.get('/api/boards', auth, (req, res) => {
  const boards = db.prepare(`SELECT b.*,
    (SELECT COUNT(*) FROM lists l JOIN cards c ON c.list_id=l.id WHERE l.board_id=b.id AND l.archived=0 AND c.archived=0) AS card_count,
    EXISTS(SELECT 1 FROM board_stars s WHERE s.board_id=b.id AND s.user_id=?) AS starred
    FROM boards b ORDER BY b.position,b.id`).all(req.user.id)
    .filter(b => canSeeBoard(req.user,b.id)).map(b => ({...b, role:boardRole(req.user,b.id)}));
  res.json({ boards });
});

app.post('/api/boards', auth, (req, res) => {
  const title = String(req.body?.title || '').trim();
  const background = String(req.body?.background || 'blue');
  if (!title) return res.status(400).json({ error: 'Thiếu tên board' });
  const info = db.prepare("INSERT INTO boards (title, position, background, visibility) VALUES (?, ?, ?, 'private')")
    .run(title, nextPosition('boards', '', []), background);
  const boardId = info.lastInsertRowid;
  db.prepare("INSERT INTO board_members(board_id,user_id,role) VALUES (?,?,'manager')").run(boardId,req.user.id);
  for (const t of ['Cần làm', 'Đang làm', 'Chờ duyệt', 'Hoàn thành']) {
    db.prepare('INSERT INTO lists (board_id, title, position) VALUES (?, ?, ?)')
      .run(boardId, t, nextPosition('lists', 'WHERE board_id = ?', [boardId]));
  }
  db.prepare("UPDATE boards SET review_list_id=(SELECT id FROM lists WHERE board_id=? AND title='Chờ duyệt'),done_list_id=(SELECT id FROM lists WHERE board_id=? AND title='Hoàn thành'),changes_list_id=(SELECT id FROM lists WHERE board_id=? AND title='Đang làm') WHERE id=?").run(boardId,boardId,boardId,boardId);
  ensureBoardLabels(boardId);
  logActivity(boardId, null, req.user.id, 'board_created', { title });
  broadcast(null, { type: 'boards-changed' });
  res.json({ id: boardId });
});

app.patch('/api/boards/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  const { title, background, closed, powerups } = req.body || {};
  if (title !== undefined) db.prepare('UPDATE boards SET title = ? WHERE id = ?').run(String(title).trim(), id);
  if (background !== undefined) db.prepare('UPDATE boards SET background = ? WHERE id = ?').run(String(background), id);
  if (powerups !== undefined && typeof powerups === 'object') {
    db.prepare('UPDATE boards SET powerups = ? WHERE id = ?').run(JSON.stringify(powerups), id);
  }
  if (req.body?.visibility !== undefined && ['workspace', 'private'].includes(req.body.visibility)) {
    db.prepare('UPDATE boards SET visibility = ? WHERE id = ?').run(req.body.visibility, id);
    // Người đặt riêng tư tự thành thành viên để không tự khóa mình
    if (req.body.visibility === 'private') {
      db.prepare('INSERT OR IGNORE INTO board_members (board_id, user_id) VALUES (?, ?)').run(id, req.user.id);
    }
  }
  if (closed !== undefined) {
    db.prepare('UPDATE boards SET closed = ? WHERE id = ?').run(closed ? 1 : 0, id);
    logActivity(id, null, req.user.id, closed ? 'board_closed' : 'board_reopened', {});
  }
  notifyBoard(id);
  broadcast(null, { type: 'boards-changed' });
  res.json({ ok: true });
});

app.post('/api/boards/:id/star', auth, (req, res) => {
  const id = Number(req.params.id);
  const has = db.prepare('SELECT 1 FROM board_stars WHERE user_id = ? AND board_id = ?').get(req.user.id, id);
  if (has) db.prepare('DELETE FROM board_stars WHERE user_id = ? AND board_id = ?').run(req.user.id, id);
  else db.prepare('INSERT INTO board_stars (user_id, board_id) VALUES (?, ?)').run(req.user.id, id);
  res.json({ starred: !has });
});

// Thành viên board (cho board riêng tư)
app.put('/api/boards/:id/members', auth, (req, res) => {
  const boardId = Number(req.params.id);
  const members = Array.isArray(req.body?.members) ? req.body.members : (req.body?.user_ids || []).map(id => ({user_id:Number(id),role:db.prepare('SELECT role FROM board_members WHERE board_id=? AND user_id=?').get(boardId,id)?.role || 'member'}));
  if (!members.every(m => userById(Number(m.user_id)) && ['manager','member'].includes(m.role))) return res.status(400).json({error:'Thành viên hoặc vai trò không hợp lệ'});
  // A board manager may delegate, but may not accidentally remove their own management access.
  if (!req.user.is_admin && !members.some(m => Number(m.user_id)===req.user.id && m.role==='manager')) return res.status(400).json({error:'Giữ ít nhất quyền quản lý của bạn'});
  db.transaction(() => {
    db.prepare('DELETE FROM board_members WHERE board_id=?').run(boardId);
    for (const m of members) db.prepare('INSERT OR IGNORE INTO board_members(board_id,user_id,role) VALUES (?,?,?)').run(boardId,Number(m.user_id),m.role);
  })();
  notifyBoard(boardId);
  broadcast(null,{type:'boards-changed'});
  res.json({ok:true});
});

/* ---------- Trường tùy chỉnh (Custom Fields) ---------- */

app.post('/api/boards/:id/fields', auth, (req, res) => {
  const { name, type, options } = req.body || {};
  if (!String(name || '').trim()) return res.status(400).json({ error: 'Thiếu tên trường' });
  const t = ['text', 'number', 'date', 'select', 'checkbox'].includes(type) ? type : 'text';
  const info = db.prepare('INSERT INTO board_fields (board_id, name, type, options, position) VALUES (?, ?, ?, ?, ?)')
    .run(Number(req.params.id), String(name).trim().slice(0, 30), t,
      JSON.stringify(Array.isArray(options) ? options.slice(0, 20) : []),
      nextPosition('board_fields', 'WHERE board_id = ?', [Number(req.params.id)]));
  notifyBoard(Number(req.params.id));
  res.json({ id: info.lastInsertRowid });
});

app.delete('/api/fields/:id', auth, (req, res) => {
  const row = db.prepare('SELECT board_id FROM board_fields WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM board_fields WHERE id = ?').run(req.params.id);
  if (row) notifyBoard(row.board_id);
  res.json({ ok: true });
});

app.put('/api/cards/:id/field/:fieldId', auth, (req, res) => {
  const cardId = Number(req.params.id);
  const fieldId = Number(req.params.fieldId);
  const field=db.prepare('SELECT * FROM board_fields WHERE id=?').get(fieldId);
  const before=db.prepare('SELECT value FROM card_field_values WHERE card_id=? AND field_id=?').get(cardId,fieldId)?.value || '';
  const value = field.type==='checkbox' ? (['1',1,true].includes(req.body?.value)?'1':'0') : String(req.body?.value ?? '').slice(0,300);
  if(value!==before) invalidateReview(cardId);
  if (value === '') db.prepare('DELETE FROM card_field_values WHERE card_id = ? AND field_id = ?').run(cardId, fieldId);
  else db.prepare(`INSERT INTO card_field_values (card_id, field_id, value) VALUES (?, ?, ?)
    ON CONFLICT(card_id, field_id) DO UPDATE SET value = excluded.value`).run(cardId, fieldId, value);
  notifyBoard(boardIdOfCard(cardId));
  res.json({ ok: true });
});

/* ---------- Thẻ đối xứng (mirror) ---------- */

app.post('/api/cards/:id/mirror', auth, (req, res) => {
  const srcId = Number(req.params.id);
  const listId = Number(req.body?.list_id);
  const src = db.prepare('SELECT * FROM cards WHERE id = ?').get(srcId);
  if (!src || !boardIdOfList(listId)) return res.status(400).json({ error: 'Thẻ nguồn hoặc cột đích không hợp lệ' });
  if (src.mirror_of) return res.status(400).json({ error: 'Không đối xứng một thẻ đối xứng' });
  const info = db.prepare('INSERT INTO cards (list_id, title, position, mirror_of) VALUES (?, ?, ?, ?)')
    .run(listId, '🪞 ' + src.title, nextPosition('cards', 'WHERE list_id = ?', [listId]), srcId);
  const boardId = boardIdOfList(listId);
  logActivity(boardId, info.lastInsertRowid, req.user.id, 'card_created', { title: '🪞 ' + src.title });
  notifyBoard(boardId);
  res.json({ id: info.lastInsertRowid });
});

// Nền ảnh cho board: upload rồi đặt background = 'url:/u/…'
app.post('/api/boards/:id/background', auth,
  express.raw({ type: () => true, limit: '10mb' }),
  (req, res) => {
    const boardId = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM boards WHERE id = ?').get(boardId)) return res.status(404).json({ error: 'Board không tồn tại' });
    if (!req.body?.length) return res.status(400).json({ error: 'File trống' });
    const ext = (String(req.query.name || '').split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!IMAGE_EXTS.includes(ext)) return res.status(400).json({ error: 'Chỉ nhận ảnh png/jpg/gif/webp' });
    const fileName = crypto.randomBytes(12).toString('hex') + '.' + ext;
    fs.writeFileSync(path.join(UPLOAD_DIR, fileName), req.body);
    db.prepare('UPDATE boards SET background = ? WHERE id = ?').run('url:/u/' + fileName, boardId);
    notifyBoard(boardId);
    broadcast(null, { type: 'boards-changed' });
    res.json({ ok: true, url: '/u/' + fileName });
  });

// Copy giữ nguyên phạm vi truy cập và các dữ liệu/rule đã hỗ trợ.
app.post('/api/boards/:id/copy', auth, (req,res) => {
  const src=db.prepare('SELECT * FROM boards WHERE id=?').get(req.params.id);
  const newId=db.transaction(()=>{
    const id=db.prepare('INSERT INTO boards(title,position,background,powerups,visibility,team_id,approval_required) VALUES (?,?,?,?,?,?,?)')
      .run(String(req.body?.title || src.title+' (bản sao)'),nextPosition('boards','',[]),src.background,src.powerups,'private',src.team_id,src.approval_required).lastInsertRowid;
    db.prepare('INSERT INTO board_members(board_id,user_id,role) SELECT ?,user_id,role FROM board_members WHERE board_id=?').run(id,src.id);
    db.prepare("INSERT INTO board_members(board_id,user_id,role) VALUES (?,?,'manager') ON CONFLICT(board_id,user_id) DO UPDATE SET role='manager'").run(id,req.user.id);
    const labels={},lists={};
    for(const l of db.prepare('SELECT * FROM labels WHERE board_id=?').all(src.id)) labels[l.id]=db.prepare('INSERT INTO labels(board_id,name,color,position) VALUES (?,?,?,?)').run(id,l.name,l.color,l.position).lastInsertRowid;
    for(const f of db.prepare('SELECT * FROM board_fields WHERE board_id=?').all(src.id)) db.prepare('INSERT INTO board_fields(board_id,name,type,options,position) VALUES (?,?,?,?,?)').run(id,f.name,f.type,f.options,f.position);
    for(const l of db.prepare('SELECT * FROM lists WHERE board_id=? AND archived=0 ORDER BY position').all(src.id)) {
      lists[l.id]=db.prepare('INSERT INTO lists(board_id,title,position,color,wip_limit) VALUES (?,?,?,?,?)').run(id,l.title,l.position,l.color,l.wip_limit).lastInsertRowid;
      for(const c of db.prepare('SELECT * FROM cards WHERE list_id=? AND archived=0 ORDER BY position').all(l.id)) {
        if(c.mirror_of) {
          if(canSeeBoard(req.user,boardIdOfCard(c.mirror_of))) db.prepare('INSERT INTO cards(list_id,title,position,mirror_of) VALUES (?,?,?,?)').run(lists[l.id],c.title,c.position,c.mirror_of);
        } else cloneCard(c.id,lists[l.id],{keep_template:true,actor_id:req.user.id});
      }
    }
    db.prepare('UPDATE boards SET review_list_id=?,done_list_id=?,changes_list_id=? WHERE id=?').run(lists[src.review_list_id] || null,lists[src.done_list_id] || null,lists[src.changes_list_id] || null,id);
    const remap = raw => {
      const a=JSON.parse(raw);
      if(a.label_id) a.label_id=labels[a.label_id] || null;
      if(a.move_list_id) a.move_list_id=lists[a.move_list_id] || null;
      if(a.archive_done_list_id) a.archive_done_list_id=lists[a.archive_done_list_id] || null;
      if(a.sort?.list_id) a.sort.list_id=lists[a.sort.list_id] || null;
      return JSON.stringify(a);
    };
    for(const r of db.prepare('SELECT * FROM automation_rules WHERE board_id=?').all(src.id)) if(lists[r.trigger_list_id]) db.prepare('INSERT INTO automation_rules(board_id,trigger_list_id,actions,enabled) VALUES (?,?,?,?)').run(id,lists[r.trigger_list_id],remap(r.actions),r.enabled);
    for(const r of db.prepare('SELECT * FROM auto_schedules WHERE board_id=?').all(src.id)) db.prepare('INSERT INTO auto_schedules(board_id,cadence,weekday,actions,enabled) VALUES (?,?,?,?,?)').run(id,r.cadence,r.weekday,remap(r.actions),r.enabled);
    for(const r of db.prepare('SELECT * FROM due_rules WHERE board_id=?').all(src.id)) db.prepare('INSERT INTO due_rules(board_id,trigger,actions,enabled) VALUES (?,?,?,?)').run(id,r.trigger,remap(r.actions),r.enabled);
    for(const r of db.prepare('SELECT * FROM card_buttons WHERE board_id=?').all(src.id)) db.prepare('INSERT INTO card_buttons(board_id,name,actions,position) VALUES (?,?,?,?)').run(id,r.name,remap(r.actions),r.position);
    return id;
  })();
  logActivity(newId,null,req.user.id,'board_created',{title:src.title+' (bản sao)'});
  broadcast(null,{type:'boards-changed'});res.json({id:newId});
});

// Theo dõi cả board: nhận thông báo mọi hoạt động trên thẻ của board
app.post('/api/boards/:id/watch', auth, (req, res) => {
  const boardId = Number(req.params.id);
  const has = db.prepare('SELECT 1 FROM board_watchers WHERE board_id = ? AND user_id = ?').get(boardId, req.user.id);
  if (has) db.prepare('DELETE FROM board_watchers WHERE board_id = ? AND user_id = ?').run(boardId, req.user.id);
  else db.prepare('INSERT INTO board_watchers (board_id, user_id) VALUES (?, ?)').run(boardId, req.user.id);
  res.json({ watching: !has });
});

// Xuất CSV toàn bộ thẻ của board (UTF-8 BOM cho Excel)
app.get('/api/boards/:id/export.csv', auth, (req, res) => {
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(req.params.id);
  if (!board) return res.status(404).json({ error: 'Board không tồn tại' });
  const rows = db.prepare(`
    SELECT c.*, l.title AS list_title FROM cards c JOIN lists l ON l.id = c.list_id
    WHERE l.board_id = ? AND c.archived = 0 AND l.archived = 0 ORDER BY l.position, c.position
  `).all(board.id);
  const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const lines = [['Cột', 'Tiêu đề', 'Mô tả', 'Thành viên', 'Nhãn', 'Bắt đầu', 'Hạn', 'Giờ', 'Hoàn thành', 'Ngày tạo'].map(esc).join(',')];
  for (const c of rows) {
    const members = db.prepare('SELECT u.name FROM card_members cm JOIN users u ON u.id = cm.user_id WHERE cm.card_id = ?')
      .all(c.id).map(r => r.name).join('; ');
    const labels = db.prepare('SELECT l.name FROM card_labels cl JOIN labels l ON l.id = cl.label_id WHERE cl.card_id = ?')
      .all(c.id).map(r => r.name || '■').join('; ');
    lines.push([c.list_title, c.title, c.description, members, labels, c.start_date, c.due_date, c.due_time,
      c.due_complete ? 'x' : '', c.created_at].map(esc).join(','));
  }
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="board-${board.id}.csv"`);
  res.send('﻿' + lines.join('\r\n'));
});

app.delete('/api/boards/:id', auth, adminOnly, (req, res) => {
  db.prepare('DELETE FROM boards WHERE id = ?').run(req.params.id);
  broadcast(null, { type: 'boards-changed' });
  res.json({ ok: true });
});

app.get('/api/boards/:id', auth, (req, res) => {
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(req.params.id);
  if (!board) return res.status(404).json({ error: 'Board không tồn tại' });
  if (!canSeeBoard(req.user, board.id)) return res.status(403).json({ error: 'Board này riêng tư — bạn chưa được thêm vào' });
  ensureBoardLabels(board.id);
  const lists = db.prepare('SELECT * FROM lists WHERE board_id = ? AND archived = 0 ORDER BY position, id').all(board.id);
  const cards = db.prepare(`
    SELECT c.* FROM cards c JOIN lists l ON l.id = c.list_id
    WHERE l.board_id = ? AND c.archived = 0 AND l.archived = 0
    ORDER BY c.position, c.id
  `).all(board.id).filter(c=>!c.mirror_of || canSeeBoard(req.user,boardIdOfCard(c.mirror_of)));
  const checklist = db.prepare(`
    SELECT ci.* FROM checklist_items ci
    JOIN cards c ON c.id = ci.card_id JOIN lists l ON l.id = c.list_id
    WHERE l.board_id = ? ORDER BY ci.position, ci.id
  `).all(board.id);
  const commentCounts = db.prepare(`
    SELECT cm.card_id, COUNT(*) AS n FROM comments cm
    JOIN cards c ON c.id = cm.card_id JOIN lists l ON l.id = c.list_id
    WHERE l.board_id = ? GROUP BY cm.card_id
  `).all(board.id);
  const attachmentCounts = db.prepare(`
    SELECT a.card_id, COUNT(*) AS n FROM attachments a
    JOIN cards c ON c.id = a.card_id JOIN lists l ON l.id = c.list_id
    WHERE l.board_id = ? GROUP BY a.card_id
  `).all(board.id);
  const labels = db.prepare('SELECT * FROM labels WHERE board_id = ? ORDER BY position, id').all(board.id);
  const cardLabels = db.prepare(`
    SELECT cl.card_id, cl.label_id FROM card_labels cl
    JOIN cards c ON c.id = cl.card_id JOIN lists l ON l.id = c.list_id WHERE l.board_id = ?
  `).all(board.id);
  const cardMembers = db.prepare(`
    SELECT cm.card_id, cm.user_id, u.name FROM card_members cm
    JOIN users u ON u.id = cm.user_id
    JOIN cards c ON c.id = cm.card_id JOIN lists l ON l.id = c.list_id WHERE l.board_id = ?
  `).all(board.id);
  const rules = db.prepare('SELECT * FROM automation_rules WHERE board_id = ?').all(board.id);
  const voteCounts = db.prepare(`
    SELECT v.card_id, COUNT(*) AS n FROM card_votes v
    JOIN cards c ON c.id = v.card_id JOIN lists l ON l.id = c.list_id
    WHERE l.board_id = ? GROUP BY v.card_id
  `).all(board.id);
  const myVotes = db.prepare(`
    SELECT v.card_id FROM card_votes v
    JOIN cards c ON c.id = v.card_id JOIN lists l ON l.id = c.list_id
    WHERE l.board_id = ? AND v.user_id = ?
  `).all(board.id, req.user.id).map(r => r.card_id);
  const myWatches = db.prepare(`
    SELECT w.card_id FROM card_watchers w
    JOIN cards c ON c.id = w.card_id JOIN lists l ON l.id = c.list_id
    WHERE l.board_id = ? AND w.user_id = ?
  `).all(board.id, req.user.id).map(r => r.card_id);
  const watchingBoard = !!db.prepare('SELECT 1 FROM board_watchers WHERE board_id = ? AND user_id = ?').get(board.id, req.user.id);
  const schedules = db.prepare('SELECT * FROM auto_schedules WHERE board_id = ?').all(board.id);
  const dueRules = db.prepare('SELECT * FROM due_rules WHERE board_id = ?').all(board.id);
  const cardButtons = db.prepare('SELECT * FROM card_buttons WHERE board_id = ? ORDER BY position, id').all(board.id);
  const boardMembers = db.prepare('SELECT user_id FROM board_members WHERE board_id = ?').all(board.id).map(r => r.user_id);
  const fields = db.prepare('SELECT * FROM board_fields WHERE board_id = ? ORDER BY position, id').all(board.id);
  const fieldValues = db.prepare(`
    SELECT v.card_id, v.field_id, v.value FROM card_field_values v
    JOIN cards c ON c.id = v.card_id JOIN lists l ON l.id = c.list_id WHERE l.board_id = ?
  `).all(board.id);
  for(const c of cards)c.last_activity=db.prepare('SELECT MAX(created_at) AS latest FROM activity WHERE card_id=?').get(c.id).latest || c.created_at;
  const mirrorLabels=[];
  // Thẻ đối xứng chỉ trả dữ liệu khi người xem có quyền trên cả hai bảng.
  for (const c of cards) {
    if (!c.mirror_of) continue;
    const src = db.prepare(`
      SELECT c.*, l.board_id AS src_board FROM cards c JOIN lists l ON l.id = c.list_id WHERE c.id = ?
    `).get(c.mirror_of);
    if (src) {
      c.title = src.title;
      c.due_date = src.due_date; c.due_time = src.due_time; c.due_complete = src.due_complete;
      c.recur = src.recur; c.cover = src.cover; c.start_date=src.start_date; c.approval_state=src.approval_state;
      const sourceLabels=db.prepare('SELECT lb.* FROM labels lb JOIN card_labels cl ON cl.label_id=lb.id WHERE cl.card_id=?').all(src.id);
      mirrorLabels.push(...sourceLabels);c.source_label_ids=sourceLabels.map(l=>l.id);
      c.source_members=db.prepare('SELECT cm.user_id,u.name FROM card_members cm JOIN users u ON u.id=cm.user_id WHERE cm.card_id=?').all(src.id);
      c.source_checklist=db.prepare('SELECT * FROM checklist_items WHERE card_id=? ORDER BY position').all(src.id);
      c.source_fields=db.prepare('SELECT f.*,v.value FROM card_field_values v JOIN board_fields f ON f.id=v.field_id WHERE v.card_id=?').all(src.id);
      commentCounts.push({card_id:c.id,n:db.prepare('SELECT COUNT(*) AS n FROM comments WHERE card_id=?').get(src.id).n});
      attachmentCounts.push({card_id:c.id,n:db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE card_id=?').get(src.id).n});
      c.description = src.description;
      c.src_archived = src.archived;
    } else c.title = '(thẻ gốc đã bị xóa)';
  }
  res.json({ mirrorLabels, eligibleMembers:db.prepare('SELECT id,name,username,is_admin,disabled FROM users WHERE disabled=0').all().filter(u=>canSeeBoard(u,board.id)), board: {...board, role:boardRole(req.user,board.id)}, boardMemberRoles:db.prepare('SELECT user_id,role FROM board_members WHERE board_id=?').all(board.id), checklistGroups:db.prepare('SELECT g.* FROM checklist_groups g JOIN cards c ON c.id=g.card_id JOIN lists l ON l.id=c.list_id WHERE l.board_id=? ORDER BY g.position,g.id').all(board.id), myListWatches:db.prepare('SELECT lw.list_id FROM list_watchers lw JOIN lists l ON l.id=lw.list_id WHERE lw.user_id=? AND l.board_id=?').all(req.user.id,board.id).map(r=>r.list_id), lists, cards, checklist, commentCounts, attachmentCounts, labels, cardLabels, cardMembers, rules, voteCounts, myVotes, myWatches, watchingBoard, schedules, dueRules, cardButtons, boardMembers, fields, fieldValues });
});

app.get('/api/boards/:id/archived', auth, (req, res) => {
  const id = Number(req.params.id);
  const cards = db.prepare(`
    SELECT c.*, l.title AS list_title FROM cards c JOIN lists l ON l.id = c.list_id
    WHERE l.board_id = ? AND c.archived = 1 ORDER BY c.id DESC
  `).all(id);
  const lists = db.prepare('SELECT * FROM lists WHERE board_id = ? AND archived = 1 ORDER BY id DESC').all(id);
  res.json({ cards:cards.filter(c=>canSeeCard(req.user,c.id)), lists });
});

app.get('/api/boards/:id/activity', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT a.*, u.name AS user_name, c.title AS card_title FROM activity a
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN cards c ON c.id = a.card_id
    WHERE a.board_id = ? ORDER BY a.id DESC LIMIT 80
  `).all(req.params.id);
  res.json({ activity:rows.filter(a=>!a.card_id || canSeeCard(req.user,a.card_id)) });
});

/* ---------- Nhãn (theo board, có tên — như Trello) ---------- */

app.post('/api/boards/:id/labels', auth, (req, res) => {
  const boardId = Number(req.params.id);
  const { name, color } = req.body || {};
  if (!color) return res.status(400).json({ error: 'Thiếu màu nhãn' });
  const info = db.prepare('INSERT INTO labels (board_id, name, color, position) VALUES (?, ?, ?, ?)')
    .run(boardId, String(name || '').trim(), String(color), nextPosition('labels', 'WHERE board_id = ?', [boardId]));
  notifyBoard(boardId);
  res.json({ id: info.lastInsertRowid });
});

app.patch('/api/labels/:id', auth, (req, res) => {
  const label = db.prepare('SELECT * FROM labels WHERE id = ?').get(req.params.id);
  if (!label) return res.status(404).json({ error: 'Không tồn tại' });
  const { name, color } = req.body || {};
  if (name !== undefined) db.prepare('UPDATE labels SET name = ? WHERE id = ?').run(String(name).trim(), req.params.id);
  if (color !== undefined) db.prepare('UPDATE labels SET color = ? WHERE id = ?').run(String(color), req.params.id);
  notifyBoard(label.board_id);
  res.json({ ok: true });
});

app.delete('/api/labels/:id', auth, (req, res) => {
  const label = db.prepare('SELECT * FROM labels WHERE id = ?').get(req.params.id);
  if (label) {
    db.prepare('DELETE FROM labels WHERE id = ?').run(req.params.id);
    notifyBoard(label.board_id);
  }
  res.json({ ok: true });
});

app.put('/api/cards/:id/labels', auth, (req, res) => {
  const cardId = Number(req.params.id);
  const ids = (req.body?.label_ids || []).map(Number);
  const previous=db.prepare('SELECT label_id FROM card_labels WHERE card_id=?').all(cardId).map(r=>r.label_id).sort();
  if(JSON.stringify(previous)!==JSON.stringify([...new Set(ids)].sort())) invalidateReview(cardId);
  db.prepare('DELETE FROM card_labels WHERE card_id = ?').run(cardId);
  const ins = db.prepare('INSERT OR IGNORE INTO card_labels (card_id, label_id) VALUES (?, ?)');
  for (const id of ids) ins.run(cardId, id);
  notifyBoard(boardIdOfCard(cardId));
  res.json({ ok: true });
});

/* ---------- Thành viên thẻ (nhiều người — như Trello) ---------- */

app.put('/api/cards/:id/members', auth, (req, res) => {
  const cardId = Number(req.params.id);
  const ids = (req.body?.user_ids || []).map(Number);
  const beforeRows = db.prepare('SELECT user_id FROM card_members WHERE card_id = ?').all(cardId).map(r => r.user_id);
  db.prepare('DELETE FROM card_members WHERE card_id = ?').run(cardId);
  const ins = db.prepare('INSERT OR IGNORE INTO card_members (card_id, user_id) VALUES (?, ?)');
  for (const id of ids) ins.run(cardId, id);
  const boardId = boardIdOfCard(cardId);
  if (JSON.stringify([...beforeRows].sort()) !== JSON.stringify([...ids].sort())) {
    invalidateReview(cardId);
    logActivity(boardId, cardId, req.user.id, 'members_changed', { count: ids.length });
    const card = db.prepare('SELECT title FROM cards WHERE id = ?').get(cardId);
    for (const uid of ids.filter(x => !beforeRows.includes(x))) {
      pushNotification(uid, req.user.id, 'assigned', boardId, cardId, { title: card?.title });
    }
  }
  notifyBoard(boardId);
  res.json({ ok: true });
});

/* ---------- Lists ---------- */

app.post('/api/lists', auth, (req, res) => {
  const { board_id, title } = req.body || {};
  if (!board_id || !String(title || '').trim()) return res.status(400).json({ error: 'Thiếu board hoặc tên cột' });
  const info = db.prepare('INSERT INTO lists (board_id, title, position) VALUES (?, ?, ?)')
    .run(board_id, String(title).trim(), nextPosition('lists', 'WHERE board_id = ?', [board_id]));
  notifyBoard(Number(board_id));
  res.json({ id: info.lastInsertRowid });
});

app.patch('/api/lists/:id', auth, (req, res) => {
  const boardId = boardIdOfList(req.params.id);
  const { title, position, archived, wip_limit, color } = req.body || {};
  if (title !== undefined) db.prepare('UPDATE lists SET title = ? WHERE id = ?').run(String(title).trim(), req.params.id);
  if (position !== undefined) db.prepare('UPDATE lists SET position = ? WHERE id = ?').run(Number(position), req.params.id);
  if (wip_limit !== undefined) db.prepare('UPDATE lists SET wip_limit = ? WHERE id = ?').run(Math.max(0, Number(wip_limit) || 0), req.params.id);
  if (color !== undefined) db.prepare('UPDATE lists SET color = ? WHERE id = ?').run(String(color), req.params.id);
  if (archived !== undefined) {
    db.prepare('UPDATE lists SET archived = ? WHERE id = ?').run(archived ? 1 : 0, req.params.id);
    logActivity(boardId, null, req.user.id, archived ? 'list_archived' : 'list_restored',
      { title: db.prepare('SELECT title FROM lists WHERE id = ?').get(req.params.id)?.title });
  }
  notifyBoard(boardId);
  res.json({ ok: true });
});

// Sắp xếp một lần các thẻ trong cột (như menu cột của Trello)
app.post('/api/lists/:id/sort', auth, (req, res) => {
  const listId = Number(req.params.id);
  const by = String(req.body?.by || '');
  const orders = {
    title: "ORDER BY title COLLATE NOCASE",
    due: "ORDER BY CASE WHEN due_date = '' THEN 1 ELSE 0 END, due_date",
    created: 'ORDER BY created_at DESC, id DESC',
  };
  if (!orders[by]) return res.status(400).json({ error: 'Kiểu sắp xếp không hợp lệ' });
  const cards = db.prepare(`SELECT id FROM cards WHERE list_id = ? AND archived = 0 ${orders[by]}`).all(listId);
  const upd = db.prepare('UPDATE cards SET position = ? WHERE id = ?');
  cards.forEach((c, i) => upd.run((i + 1) * 1024, c.id));
  notifyBoard(boardIdOfList(listId));
  res.json({ ok: true });
});

app.delete('/api/lists/:id', auth, (req, res) => {
  const boardId = boardIdOfList(req.params.id);
  db.prepare('DELETE FROM lists WHERE id = ?').run(req.params.id);
  notifyBoard(boardId);
  res.json({ ok: true });
});

/* ---------- Cards ---------- */

app.post('/api/cards', auth, (req, res) => {
  const { list_id, title } = req.body || {};
  if (!list_id || !String(title || '').trim()) return res.status(400).json({ error: 'Thiếu cột hoặc tiêu đề thẻ' });
  const info = db.prepare('INSERT INTO cards (list_id, title, position, created_by) VALUES (?, ?, ?, ?)')
    .run(list_id, String(title).trim(), nextPosition('cards', 'WHERE list_id = ?', [list_id]),req.user.id);
  if (!canManageBoard(req.user,boardIdOfList(list_id))) db.prepare('INSERT INTO card_members(card_id,user_id) VALUES (?,?)').run(info.lastInsertRowid,req.user.id);
  const boardId = boardIdOfList(list_id);
  logActivity(boardId, info.lastInsertRowid, req.user.id, 'card_created', { title: String(title).trim() });
  for (const uid of new Set([...boardWatcherIds(boardId),...db.prepare('SELECT user_id FROM list_watchers WHERE list_id=?').all(list_id).map(r=>r.user_id)])) {
    pushNotification(uid, req.user.id, 'created', boardId, info.lastInsertRowid, { title: String(title).trim() });
  }
  notifyBoard(boardId);
  res.json({ id: info.lastInsertRowid });
});

// Automation kiểu Butler: khi thẻ vào cột có rule → áp hành động
function applyRules(cardId, listId, actorId) {
  const rules = db.prepare('SELECT * FROM automation_rules WHERE trigger_list_id = ? AND enabled = 1').all(listId);
  for (const rule of rules) {
    let actions;
    try { actions = JSON.parse(rule.actions); validateActions(actions,rule.board_id); } catch { continue; }
    const applied = [];
    if (actions.due_complete && completeCard(cardId)) applied.push('due_complete');
    if (actions.label_id) {
      db.prepare('INSERT OR IGNORE INTO card_labels (card_id, label_id) VALUES (?, ?)').run(cardId, actions.label_id);
      applied.push('label');
    }
    if (actions.member_id) {
      db.prepare('INSERT OR IGNORE INTO card_members (card_id, user_id) VALUES (?, ?)').run(cardId, actions.member_id);
      applied.push('member');
    }
    if (actions.cover) {
      db.prepare('UPDATE cards SET cover = ? WHERE id = ?').run(actions.cover, cardId);
      applied.push('cover');
    }
    if (actions.check_all) {
      db.prepare('UPDATE checklist_items SET checked = 1 WHERE card_id = ?').run(cardId);
      applied.push('check_all');
    }
    if (applied.length) {
      logActivity(rule.board_id, cardId, actorId, 'rule_applied', { applied });
    }
  }
}

app.patch('/api/cards/:id',auth,(req,res)=>{
  const id=Number(req.params.id), b=req.body || {};
  const current=db.prepare('SELECT c.*,l.board_id,l.title AS list_title FROM cards c JOIN lists l ON l.id=c.list_id WHERE c.id=?').get(id);
  for(const field of ['start_date','due_date']) if(b[field]!==undefined && b[field]!=='' && !validDate(b[field])) return res.status(400).json({error:'Ngày không hợp lệ'});
  if((b.start_date ?? current.start_date) && (b.due_date ?? current.due_date) && (b.start_date ?? current.start_date)>(b.due_date ?? current.due_date))return res.status(400).json({error:'Ngày bắt đầu phải trước hoặc bằng ngày hết hạn'});
  if(b.due_time!==undefined && b.due_time!=='' && !validTime(b.due_time)) return res.status(400).json({error:'Giờ không hợp lệ'});
  if(b.position!==undefined && !Number.isFinite(Number(b.position))) return res.status(400).json({error:'Vị trí không hợp lệ'});
  if(b.title!==undefined && !String(b.title).trim()) return res.status(400).json({error:'Tiêu đề không được trống'});
  const required=db.prepare('SELECT approval_required FROM boards WHERE id=?').get(current.board_id).approval_required;
  if(b.due_complete && !current.due_complete && required) return res.status(409).json({error:'Công việc cần gửi duyệt; chỉ người duyệt được xác nhận hoàn thành'});
  const target=b.list_id===undefined ? current.list_id : Number(b.list_id);
  const targetBoard=boardIdOfList(target);
  if(targetBoard!==current.board_id) {requireBoard(req.user,current.board_id,true);requireBoard(req.user,targetBoard,true);}
  const changed=['title','description','due_date','start_date','due_time','recur'].some(f=>b[f]!==undefined && String(b[f])!==String(current[f]));
  db.transaction(()=>{
    if(changed)invalidateReview(id);
    if(target!==current.list_id) moveCard(id,target,b.position===undefined?undefined:Number(b.position));
    const sets=[],values=[];
    for(const f of ['title','description','due_date','start_date','due_time','cover']) if(b[f]!==undefined) {sets.push(f+'=?');values.push(f==='title'?String(b[f]).trim():String(b[f]));}
    if(b.recur!==undefined) {sets.push('recur=?');values.push(['daily','weekly','monthly'].includes(b.recur)?b.recur:'');}
    if((b.due_date!==undefined && b.due_date!==current.due_date) || (b.recur!==undefined && b.recur!==current.recur)){sets.push('recur_anchor_day=?');values.push((b.recur ?? current.recur)==='monthly'?(Number((b.due_date ?? current.due_date).slice(8)) || 0):0);}
    if(b.remind!==undefined) {sets.push('remind=?');values.push(b.remind==='none'||REMIND_MS[b.remind]!==undefined?b.remind:'1d');}
    for(const f of ['archived','is_template']) if(b[f]!==undefined) {sets.push(f+'=?');values.push(b[f]?1:0);}
    if(b.position!==undefined) {sets.push('position=?');values.push(Number(b.position));}
    if(b.due_complete!==undefined && !b.due_complete) {sets.push('due_complete=0');if(current.due_complete) sets.push("approval_state='in_progress'","submitted_by=NULL");}
    if(sets.length) db.prepare('UPDATE cards SET '+sets.join(',')+' WHERE id=?').run(...values,id);
    if(['due_date','due_time','recur'].some(f=>b[f]!==undefined && b[f]!==current[f])) db.prepare('DELETE FROM due_rule_applied WHERE card_id=?').run(id);
    if(b.due_complete && !current.due_complete) completeCard(id);
    if(target!==current.list_id) applyRules(id,target,req.user.id);
  })();
  if(target!==current.list_id) {
    const title=db.prepare('SELECT title FROM lists WHERE id=?').get(target).title;
    logActivity(targetBoard,id,req.user.id,'card_moved',{from:current.list_title,to:title});
    for(const uid of cardRecipientIds(id)) pushNotification(uid,req.user.id,'moved',targetBoard,id,{title:current.title,from:current.list_title,to:title});
  }
  if(b.archived!==undefined) logActivity(current.board_id,id,req.user.id,b.archived?'card_archived':'card_restored',{title:current.title});
  if(b.due_complete!==undefined && !!b.due_complete!==!!current.due_complete) logActivity(targetBoard,id,req.user.id,b.due_complete?'card_completed':'card_uncompleted',{});
  notifyBoard(current.board_id);notifyBoard(targetBoard);
  for(const r of db.prepare('SELECT DISTINCT l.board_id FROM cards m JOIN lists l ON l.id=m.list_id WHERE m.mirror_of=?').all(id)) notifyBoard(r.board_id);
  res.json({ok:true,card:db.prepare('SELECT * FROM cards WHERE id=?').get(id)});
});

app.post('/api/cards/:id/copy',auth,(req,res)=>{
  const src=db.prepare('SELECT * FROM cards WHERE id=?').get(req.params.id);
  const listId=Number(req.body?.list_id || src.list_id);
  if(boardIdOfList(listId)!==boardIdOfCard(src.id)) {requireBoard(req.user,boardIdOfCard(src.id),true);requireBoard(req.user,boardIdOfList(listId),true);}
  const id=cloneCard(src.id,listId,{...(req.body || {}),actor_id:req.user.id});
  logActivity(boardIdOfList(listId),id,req.user.id,'card_copied',{title:src.title});notifyBoard(boardIdOfList(listId));res.json({id});
});

app.delete('/api/cards/:id', auth, (req, res) => {
  const boardId = boardIdOfCard(req.params.id);
  db.prepare('DELETE FROM cards WHERE id = ?').run(req.params.id);
  notifyBoard(boardId);
  res.json({ ok: true });
});

app.get('/api/cards/:id/activity', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT a.*, u.name AS user_name FROM activity a
    LEFT JOIN users u ON u.id = a.user_id
    WHERE a.card_id = ? ORDER BY a.id DESC LIMIT 40
  `).all(req.params.id);
  res.json({ activity: rows });
});

/* ---------- Đính kèm (link) ---------- */

app.get('/api/cards/:id/attachments', auth, (req, res) => {
  res.json({ attachments: db.prepare('SELECT * FROM attachments WHERE card_id = ? ORDER BY id').all(req.params.id) });
});

app.post('/api/cards/:id/attachments', auth, (req, res) => {
  const cardId = Number(req.params.id);
  const url = String(req.body?.url || '').trim();
  if (!/^https?:\/\//.test(url)) return res.status(400).json({ error: 'Cần đường dẫn http(s) hợp lệ' });
  const name = String(req.body?.name || '').trim() || url.replace(/^https?:\/\//, '').slice(0, 60);
  invalidateReview(cardId);
  const info = db.prepare('INSERT INTO attachments (card_id, url, name) VALUES (?, ?, ?)').run(cardId, url, name);
  const boardId = boardIdOfCard(cardId);
  logActivity(boardId, cardId, req.user.id, 'attachment_added', { name });
  notifyBoard(boardId);
  res.json({ id: info.lastInsertRowid });
});

app.delete('/api/attachments/:id', auth, (req, res) => {
  const row = db.prepare('SELECT card_id FROM attachments WHERE id = ?').get(req.params.id);
  if(row) invalidateReview(row.card_id);
  db.prepare('DELETE FROM attachments WHERE id = ?').run(req.params.id);
  if (row) notifyBoard(boardIdOfCard(row.card_id));
  res.json({ ok: true });
});

/* ---------- Checklist & bình luận ---------- */

registerWorkRoutes(app,{auth,adminOnly,notifyBoard,logActivity,pushNotification,broadcast,completeCard,cardRecipientIds});

/* ---------- Automation rules ---------- */

app.post('/api/boards/:id/rules', auth, (req, res) => {
  const boardId = Number(req.params.id);
  const { trigger_list_id, actions } = req.body || {};
  if (!trigger_list_id || !actions || typeof actions !== 'object') {
    return res.status(400).json({ error: 'Cần cột kích hoạt và ít nhất một hành động' });
  }
  const info = db.prepare('INSERT INTO automation_rules (board_id, trigger_list_id, actions) VALUES (?, ?, ?)')
    .run(boardId, Number(trigger_list_id), JSON.stringify(actions));
  notifyBoard(boardId);
  res.json({ id: info.lastInsertRowid });
});

app.delete('/api/rules/:id', auth, (req, res) => {
  const rule = db.prepare('SELECT board_id FROM automation_rules WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM automation_rules WHERE id = ?').run(req.params.id);
  if (rule) notifyBoard(rule.board_id);
  res.json({ ok: true });
});

/* ---------- Automation theo lịch / theo hạn / nút thẻ (CRUD) ---------- */

app.post('/api/boards/:id/schedules', auth, (req, res) => {
  const { cadence, weekday, actions } = req.body || {};
  if (!['daily', 'weekly'].includes(cadence) || !actions || typeof actions !== 'object') {
    return res.status(400).json({ error: 'Cần chu kỳ (daily/weekly) và hành động' });
  }
  const info = db.prepare('INSERT INTO auto_schedules (board_id, cadence, weekday, actions) VALUES (?, ?, ?, ?)')
    .run(Number(req.params.id), cadence, Math.min(7, Math.max(1, Number(weekday) || 1)), JSON.stringify(actions));
  notifyBoard(Number(req.params.id));
  res.json({ id: info.lastInsertRowid });
});

app.delete('/api/schedules/:id', auth, (req, res) => {
  const row = db.prepare('SELECT board_id FROM auto_schedules WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM auto_schedules WHERE id = ?').run(req.params.id);
  if (row) notifyBoard(row.board_id);
  res.json({ ok: true });
});

app.post('/api/boards/:id/due-rules', auth, (req, res) => {
  const { trigger, actions } = req.body || {};
  if (!['overdue', 'due_tomorrow'].includes(trigger) || !actions || typeof actions !== 'object') {
    return res.status(400).json({ error: 'Cần điều kiện hạn và hành động' });
  }
  const info = db.prepare('INSERT INTO due_rules (board_id, trigger, actions) VALUES (?, ?, ?)')
    .run(Number(req.params.id), trigger, JSON.stringify(actions));
  notifyBoard(Number(req.params.id));
  res.json({ id: info.lastInsertRowid });
});

app.delete('/api/due-rules/:id', auth, (req, res) => {
  const row = db.prepare('SELECT board_id FROM due_rules WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM due_rules WHERE id = ?').run(req.params.id);
  if (row) notifyBoard(row.board_id);
  res.json({ ok: true });
});

app.post('/api/boards/:id/buttons', auth, (req, res) => {
  const { name, actions } = req.body || {};
  if (!String(name || '').trim() || !actions || typeof actions !== 'object') {
    return res.status(400).json({ error: 'Cần tên nút và hành động' });
  }
  const info = db.prepare('INSERT INTO card_buttons (board_id, name, actions, position) VALUES (?, ?, ?, ?)')
    .run(Number(req.params.id), String(name).trim().slice(0, 30), JSON.stringify(actions),
      nextPosition('card_buttons', 'WHERE board_id = ?', [Number(req.params.id)]));
  notifyBoard(Number(req.params.id));
  res.json({ id: info.lastInsertRowid });
});

app.delete('/api/buttons/:id', auth, (req, res) => {
  const row = db.prepare('SELECT board_id FROM card_buttons WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM card_buttons WHERE id = ?').run(req.params.id);
  if (row) notifyBoard(row.board_id);
  res.json({ ok: true });
});

// Bấm nút thẻ tùy chỉnh: áp chuỗi hành động lên thẻ
app.post('/api/cards/:id/apply-button/:buttonId', auth, (req, res) => {
  const cardId = Number(req.params.id);
  const btn = db.prepare('SELECT * FROM card_buttons WHERE id = ?').get(req.params.buttonId);
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId);
  if (!btn || !card) return res.status(404).json({ error: 'Không tồn tại' });
  let a = {};
  try { a = JSON.parse(btn.actions); } catch {}
  if(a.complete && db.prepare('SELECT approval_required FROM boards WHERE id=?').get(boardIdOfCard(cardId)).approval_required) return res.status(409).json({error:'Cần gửi duyệt; nút tự động không được bỏ qua duyệt'});
  const applied = [];
  if (a.label_id) { db.prepare('INSERT OR IGNORE INTO card_labels (card_id, label_id) VALUES (?, ?)').run(cardId, Number(a.label_id)); applied.push('label'); }
  if (a.complete) { if(!completeCard(cardId)) return res.status(409).json({error:'Cần gửi duyệt; tự động hóa không được bỏ qua duyệt'}); applied.push('complete'); }
  if (a.due_shift_days !== undefined && a.due_shift_days !== null && a.due_shift_days !== '') {
    const base = card.due_date ? new Date(card.due_date) : new Date();
    base.setDate(base.getDate() + Number(a.due_shift_days));
    const d = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
    db.prepare('UPDATE cards SET due_date = ? WHERE id = ?').run(d, cardId);
    db.prepare('DELETE FROM due_rule_applied WHERE card_id=?').run(cardId);
    applied.push('due');
  }
  if (a.move_list_id) {
    db.prepare('UPDATE cards SET list_id = ?, position = ? WHERE id = ?')
      .run(Number(a.move_list_id), nextPosition('cards', 'WHERE list_id = ?', [Number(a.move_list_id)]), cardId);
    applyRules(cardId, Number(a.move_list_id), req.user.id);
    applied.push('move');
  }
  const boardId = boardIdOfCard(cardId);
  logActivity(boardId, cardId, req.user.id, 'rule_applied', { applied: [`🔘 ${btn.name}: ${applied.join(', ')}`] });
  notifyBoard(boardId);
  res.json({ ok: true, applied });
});

/* ---------- Hợp nhất thẻ (merge — như Trello bản mới) ---------- */

app.post('/api/cards/:id/merge', auth, (req, res) => {
  const srcId = Number(req.params.id);
  const dstId = Number(req.body?.target_id);
  const src = db.prepare('SELECT * FROM cards WHERE id = ?').get(srcId);
  const dst = db.prepare('SELECT * FROM cards WHERE id = ?').get(dstId);
  if (!src || !dst || srcId === dstId || src.mirror_of || dst.mirror_of) return res.status(400).json({ error: 'Thẻ nguồn/đích không hợp lệ' });
  const merge = db.transaction(() => {
    if (src.description) {
      const d = dst.description ? dst.description + '\n\n— Hợp nhất từ "' + src.title + '":\n' + src.description
                                : src.description;
      db.prepare('UPDATE cards SET description = ? WHERE id = ?').run(d, dstId);
    }
    if (src.due_date && !dst.due_date) {
      db.prepare('UPDATE cards SET due_date = ? WHERE id = ?').run(src.due_date, dstId);
    }
    for(const g of db.prepare('SELECT * FROM checklist_groups WHERE card_id=? ORDER BY position').all(srcId)) {
      const gid=db.prepare('INSERT INTO checklist_groups(card_id,title,position) VALUES (?,?,?)').run(dstId,g.title,nextPosition('checklist_groups','WHERE card_id=?',[dstId])).lastInsertRowid;
      db.prepare('INSERT INTO checklist_items(card_id,group_id,text,checked,position,user_id,due_date,due_time) SELECT ?,?,text,checked,position,user_id,due_date,due_time FROM checklist_items WHERE group_id=?').run(dstId,gid,g.id);
    }
    for(const cm of db.prepare('SELECT * FROM comments WHERE card_id=?').all(srcId)) {
      const cid=db.prepare('INSERT INTO comments(card_id,user_id,text,created_at,edited_at) VALUES (?,?,?,?,?)').run(dstId,cm.user_id,cm.text,cm.created_at,cm.edited_at).lastInsertRowid;
      db.prepare('INSERT INTO comment_reactions(comment_id,user_id,emoji) SELECT ?,user_id,emoji FROM comment_reactions WHERE comment_id=?').run(cid,cm.id);
    }
    db.prepare('INSERT INTO attachments(card_id,url,name,created_at) SELECT ?,url,name,created_at FROM attachments WHERE card_id=?').run(dstId,srcId);
    for(const table of ['card_labels','card_members','card_watchers','card_votes']) {
      const column=table==='card_labels'?'label_id':'user_id';
      db.prepare(`INSERT OR IGNORE INTO ${table}(card_id,${column}) SELECT ?,${column} FROM ${table} WHERE card_id=?`).run(dstId,srcId);
    }
    db.prepare('INSERT OR IGNORE INTO card_field_values(card_id,field_id,value) SELECT ?,field_id,value FROM card_field_values WHERE card_id=?').run(dstId,srcId);
    invalidateReview(dstId);
    db.prepare('UPDATE cards SET archived = 1 WHERE id = ?').run(srcId);
  });
  merge();
  const boardId = boardIdOfCard(dstId);
  logActivity(boardId, dstId, req.user.id, 'card_merged', { from: src.title, into: dst.title });
  for (const uid of cardRecipientIds(dstId)) {
    pushNotification(uid, req.user.id, 'moved', boardId, dstId, { title: dst.title, from: 'hợp nhất "' + src.title + '"', to: dst.title });
  }
  notifyBoard(boardId);
  notifyBoard(boardIdOfCard(srcId));
  res.json({ ok: true });
});

/* ---------- Tìm kiếm toàn cục ---------- */

app.get('/api/search', auth, (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ cards: [] });
  const like = `%${q}%`;
  const cards = db.prepare(`
    SELECT c.id, c.title, c.due_date, l.title AS list_title, b.title AS board_title, b.id AS board_id
    FROM cards c JOIN lists l ON l.id = c.list_id JOIN boards b ON b.id = l.board_id
    WHERE c.archived=0 AND l.archived=0 AND b.closed=0 AND (c.title LIKE ? OR c.description LIKE ?)
    ORDER BY c.id DESC
  `).all(like,like).filter(c=>canSeeCard(req.user,c.id)).slice(0,30);
  res.json({ cards });
});

/* ---------- Định vị thẻ (cho link chia sẻ #c/<id>) ---------- */

app.get('/api/cards/:id/locate', auth, (req, res) => {
  const row = db.prepare(`
    SELECT c.id, c.archived, l.board_id FROM cards c JOIN lists l ON l.id = c.list_id WHERE c.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Thẻ không tồn tại' });
  if (!canSeeBoard(req.user, row.board_id)) return res.status(403).json({ error: 'Board này riêng tư' });
  res.json({ board_id: row.board_id, archived: !!row.archived });
});

/* ---------- Upload file đính kèm ---------- */

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Loại hiển thị trực tiếp trong trình duyệt; còn lại ép tải về (chặn HTML/SVG thực thi script)
const INLINE_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', pdf: 'application/pdf',
};
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];

app.post('/api/cards/:id/upload', auth,
  express.raw({ type: () => true, limit: '25mb' }),
  (req, res) => {
    const cardId = Number(req.params.id);
    const boardId = boardIdOfCard(cardId);
    if (!boardId) return res.status(404).json({ error: 'Thẻ không tồn tại' });
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'File trống' });
    const original = String(req.query.name || 'file').slice(0, 120);
    const ext = (original.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
    const fileName = crypto.randomBytes(12).toString('hex') + '.' + ext;
    fs.writeFileSync(path.join(UPLOAD_DIR, fileName), req.body);
    const url = '/u/' + fileName;
    const info = db.prepare('INSERT INTO attachments (card_id, url, name) VALUES (?, ?, ?)').run(cardId, url, original);
    logActivity(boardId, cardId, req.user.id, 'attachment_added', { name: original });
    // Ảnh đầu tiên tự thành ảnh bìa nếu thẻ chưa có (giống Trello)
    const card = db.prepare('SELECT cover FROM cards WHERE id = ?').get(cardId);
    if (IMAGE_EXTS.includes(ext) && (req.query.cover === '1' || !card.cover)) {
      db.prepare('UPDATE cards SET cover = ? WHERE id = ?').run('url:' + url, cardId);
    }
    notifyBoard(boardId);
    res.json({ id: info.lastInsertRowid, url });
  });

app.get('/u/:file', auth, (req, res) => {
  const file = String(req.params.file).replace(/[^a-z0-9.]/gi, '');
  const url = '/u/' + file;
  const accessible=canReadUpload(req.user,url);
  if (!accessible) return res.status(403).end();
  const full = path.join(UPLOAD_DIR, file);
  if (!fs.existsSync(full)) return res.status(404).end();
  const ext = file.split('.').pop().toLowerCase();
  if (INLINE_TYPES[ext]) {
    res.set('Content-Type', INLINE_TYPES[ext]);
    res.set('Content-Disposition', 'inline');
  } else {
    res.set('Content-Type', 'application/octet-stream');
    res.set('Content-Disposition', 'attachment');
  }
  res.set('Cache-Control', 'private, no-store');
  res.sendFile(full);
});

/* ---------- Theo dõi thẻ (watch) ---------- */

// Tham gia / rời thẻ một chạm (như nút "Tham gia" của Trello)
app.post('/api/cards/:id/join', auth, (req, res) => {
  const cardId = Number(req.params.id);
  const boardId = boardIdOfCard(cardId);
  if (!boardId) return res.status(404).json({ error: 'Thẻ không tồn tại' });
  const has = db.prepare('SELECT 1 FROM card_members WHERE card_id = ? AND user_id = ?').get(cardId, req.user.id);
  if (has) db.prepare('DELETE FROM card_members WHERE card_id = ? AND user_id = ?').run(cardId, req.user.id);
  else db.prepare('INSERT INTO card_members (card_id, user_id) VALUES (?, ?)').run(cardId, req.user.id);
  logActivity(boardId, cardId, req.user.id, 'members_changed',
    { count: db.prepare('SELECT COUNT(*) n FROM card_members WHERE card_id = ?').get(cardId).n });
  notifyBoard(boardId);
  res.json({ joined: !has });
});

app.post('/api/cards/:id/watch', auth, (req, res) => {
  const cardId = Number(req.params.id);
  const has = db.prepare('SELECT 1 FROM card_watchers WHERE card_id = ? AND user_id = ?').get(cardId, req.user.id);
  if (has) db.prepare('DELETE FROM card_watchers WHERE card_id = ? AND user_id = ?').run(cardId, req.user.id);
  else db.prepare('INSERT INTO card_watchers (card_id, user_id) VALUES (?, ?)').run(cardId, req.user.id);
  res.json({ watching: !has });
});

/* ---------- Vote trên thẻ (Power-up) ---------- */

app.post('/api/cards/:id/vote', auth, (req, res) => {
  const cardId = Number(req.params.id);
  const has = db.prepare('SELECT 1 FROM card_votes WHERE card_id = ? AND user_id = ?').get(cardId, req.user.id);
  if (has) db.prepare('DELETE FROM card_votes WHERE card_id = ? AND user_id = ?').run(cardId, req.user.id);
  else db.prepare('INSERT INTO card_votes (card_id, user_id) VALUES (?, ?)').run(cardId, req.user.id);
  notifyBoard(boardIdOfCard(cardId));
  const count = db.prepare('SELECT COUNT(*) AS n FROM card_votes WHERE card_id = ?').get(cardId).n;
  res.json({ voted: !has, count });
});

/* ---------- Inbox cá nhân (thu việc nhanh, như Trello Inbox) ---------- */

app.get('/api/inbox', auth, (req, res) => {
  res.json({ items: db.prepare('SELECT * FROM inbox_items WHERE user_id = ? ORDER BY position, id').all(req.user.id) });
});

app.post('/api/inbox', auth, (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Nội dung trống' });
  const info = db.prepare('INSERT INTO inbox_items (user_id, text, position) VALUES (?, ?, ?)')
    .run(req.user.id, text, nextPosition('inbox_items', 'WHERE user_id = ?', [req.user.id]));
  res.json({ id: info.lastInsertRowid });
});

app.patch('/api/inbox/:id', auth, (req, res) => {
  const item = db.prepare('SELECT * FROM inbox_items WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return res.status(404).json({ error: 'Không tồn tại' });
  const { text, date, position } = req.body || {};
  if (text !== undefined) db.prepare('UPDATE inbox_items SET text = ? WHERE id = ?').run(String(text).trim(), item.id);
  if (date !== undefined) db.prepare('UPDATE inbox_items SET date = ? WHERE id = ?').run(String(date), item.id);
  if (position !== undefined) db.prepare('UPDATE inbox_items SET position = ? WHERE id = ?').run(Number(position), item.id);
  res.json({ ok: true });
});

app.delete('/api/inbox/:id', auth, (req, res) => {
  db.prepare('DELETE FROM inbox_items WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// Chuyển mục Inbox thành thẻ thật trên board
app.post('/api/inbox/:id/convert', auth, (req, res) => {
  const item = db.prepare('SELECT * FROM inbox_items WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return res.status(404).json({ error: 'Không tồn tại' });
  const listId = Number(req.body?.list_id);
  if (!listId || !boardIdOfList(listId)) return res.status(400).json({ error: 'Thiếu cột đích' });
  const info = db.prepare('INSERT INTO cards (list_id, title, due_date, position) VALUES (?, ?, ?, ?)')
    .run(listId, item.text, item.date || '', nextPosition('cards', 'WHERE list_id = ?', [listId]));
  db.prepare('INSERT INTO card_members (card_id, user_id) VALUES (?, ?)').run(info.lastInsertRowid, req.user.id);
  db.prepare('DELETE FROM inbox_items WHERE id = ?').run(item.id);
  const boardId = boardIdOfList(listId);
  logActivity(boardId, info.lastInsertRowid, req.user.id, 'card_created', { title: item.text });
  notifyBoard(boardId);
  res.json({ id: info.lastInsertRowid, board_id: boardId });
});

/* ---------- Planner tuần cá nhân ---------- */

app.get('/api/planner', auth, (req, res) => {
  const slots = db.prepare(`
    SELECT ps.card_id, ps.date, c.title, c.due_date, c.due_complete, l.title AS list_title, l.board_id, b.title AS board_title
    FROM planner_slots ps
    JOIN cards c ON c.id = ps.card_id JOIN lists l ON l.id = c.list_id JOIN boards b ON b.id = l.board_id
    WHERE ps.user_id = ? AND c.archived=0 AND l.archived=0 AND b.closed=0
  `).all(req.user.id).filter(c=>canSeeCard(req.user,c.card_id ?? c.id));
  const myCards = db.prepare(`
    SELECT c.id, c.title, c.due_date, c.due_complete, l.title AS list_title, l.board_id, b.title AS board_title
    FROM card_members cm
    JOIN cards c ON c.id = cm.card_id JOIN lists l ON l.id = c.list_id JOIN boards b ON b.id = l.board_id
    WHERE cm.user_id = ? AND c.archived = 0 AND l.archived = 0 AND b.closed = 0 AND c.due_complete = 0
    ORDER BY CASE WHEN c.due_date = '' THEN 1 ELSE 0 END, c.due_date, c.id DESC LIMIT 100
  `).all(req.user.id).filter(c=>canSeeCard(req.user,c.card_id ?? c.id));
  const inbox = db.prepare("SELECT * FROM inbox_items WHERE user_id = ? AND date != '' ORDER BY date").all(req.user.id);
  const planned=new Set(slots.map(s=>s.card_id));
  const dueCards=myCards.filter(c=>c.due_date && !planned.has(c.id)).map(c=>({...c,card_id:c.id,date:c.due_date,automatic:true}));
  res.json({ slots:[...slots,...dueCards], myCards, inbox });
});

app.put('/api/planner', auth, (req, res) => {
  const cardId = Number(req.body?.card_id);
  const date = String(req.body?.date || '');
  if (!cardId || !validDate(date)) return res.status(400).json({ error: 'Cần thẻ và ngày hợp lệ' });
  requireBoard(req.user,boardIdOfCard(cardId));
  if(!canSeeCard(req.user,cardId))return res.status(403).json({error:'Bạn chưa được cấp quyền vào thẻ gốc'});
  db.prepare('INSERT INTO planner_slots (user_id, card_id, date) VALUES (?, ?, ?) ON CONFLICT(user_id, card_id) DO UPDATE SET date = excluded.date')
    .run(req.user.id, cardId, date);
  res.json({ ok: true });
});

app.delete('/api/planner/:cardId', auth, (req, res) => {
  db.prepare('DELETE FROM planner_slots WHERE user_id = ? AND card_id = ?').run(req.user.id, req.params.cardId);
  res.json({ ok: true });
});

/* ---------- AI (Claude API — bật khi có ANTHROPIC_API_KEY) ---------- */

const AI_KEY = process.env.ANTHROPIC_API_KEY || '';
const AI_MODEL = process.env.AI_MODEL || 'claude-haiku-5-5';

app.get('/api/ai/status', auth, (req, res) => res.json({ enabled: !!AI_KEY }));

async function askClaude(system, userText) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'x-api-key': AI_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: AI_MODEL, max_tokens: 800, system, messages: [{ role: 'user', content: userText }] }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error?.message || 'AI lỗi ' + r.status);
    return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  } finally { clearTimeout(timer); }
}

app.post('/api/ai/card/:id', auth, async (req, res) => {
  if (!AI_KEY) return res.status(400).json({ error: 'Chưa cấu hình ANTHROPIC_API_KEY trên máy chủ' });
  const cardId = Number(req.params.id);
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId);
  if (!card) return res.status(404).json({ error: 'Thẻ không tồn tại' });
  const comments = db.prepare(`
    SELECT u.name AS author, cm.text FROM comments cm LEFT JOIN users u ON u.id = cm.user_id
    WHERE cm.card_id = ? ORDER BY cm.id DESC LIMIT 30
  `).all(cardId).reverse();
  const checklist = db.prepare('SELECT text, checked FROM checklist_items WHERE card_id = ? ORDER BY position').all(cardId);
  const action = String(req.body?.action || '');
  const ctx = `Thẻ công việc: "${card.title}"
Mô tả hiện tại: ${card.description || '(chưa có)'}
Checklist: ${checklist.map(i => `[${i.checked ? 'x' : ' '}] ${i.text}`).join('; ') || '(chưa có)'}
Bình luận (cũ → mới): ${comments.map(c => `${c.author || '?'}: ${c.text}`).join(' | ') || '(chưa có)'}`;
  const prompts = {
    summary: ['Bạn là trợ lý quản lý công việc của một đội sản xuất video YouTube người Việt. Trả lời ngắn gọn bằng tiếng Việt, không markdown.',
      `${ctx}\n\nTóm tắt tình trạng thẻ này trong tối đa 4 câu: việc gì, đang ở đâu, vướng gì, việc kế tiếp là gì.`],
    describe: ['Bạn là trợ lý viết mô tả công việc cho đội sản xuất video YouTube người Việt. Viết tiếng Việt, không markdown.',
      `${ctx}\n\nViết mô tả ngắn gọn (3-5 câu) cho thẻ này: mục tiêu, yêu cầu đầu ra, lưu ý. Chỉ trả về nội dung mô tả.`],
    checklist: ['Bạn là trợ lý chia nhỏ công việc cho đội sản xuất video YouTube người Việt. Trả về MỖI DÒNG MỘT VIỆC CON, tối đa 7 dòng, không đánh số, không gạch đầu dòng, không giải thích.',
      `${ctx}\n\nĐề xuất danh sách việc con để hoàn thành thẻ này.`],
  };
  if (!prompts[action]) return res.status(400).json({ error: 'Hành động không hợp lệ' });
  try {
    const text = await askClaude(prompts[action][0], prompts[action][1]);
    res.json({ text });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e).slice(0, 200) });
  }
});

/* ---------- WebSocket ---------- */

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (socket, req) => {
  const url = new URL(req.url, 'http://localhost');
  const user = getSessionUser(url.searchParams.get('token'));
  if (!user) { socket.close(4001, 'unauthorized'); return; }
  socket.boardId = null;
  socket.userId = user.id;
  socket.token = url.searchParams.get('token');
  socket.on('message', raw => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'watch') socket.boardId = msg.boardId && canSeeBoard(getSessionUser(socket.token),Number(msg.boardId)) ? Number(msg.boardId) : null;
    } catch {}
  });
});

function broadcast(boardId, payload) {
  const msg = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState !== 1) continue;
    const user = getSessionUser(client.token);
    if (!user) { client.close(4001,'unauthorized'); continue; }
    if (boardId === null || (client.boardId === boardId && canSeeBoard(user,boardId))) client.send(msg);
  }
}

function broadcastUser(userId, payload) {
  const msg = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === 1 && client.userId === userId) client.send(msg);
  }
}

app.use((error,req,res,next)=>{ console.error(error.message); res.status(error.status || 500).json({error:error.status?error.message:'Có lỗi xử lý dữ liệu'}); });
export { app, server, wss, scanDueNotifications, runDueRules, runScheduledAutomations };
if(process.env.NODE_ENV!=='test') server.listen(PORT, process.env.HOST || '0.0.0.0', () => console.log(`Kanban server chạy tại http://localhost:${PORT}`));
