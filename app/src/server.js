import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { db, hashPassword, verifyPassword, ensureBoardLabels } from './db.js';

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
    SELECT u.id, u.username, u.name, u.is_admin FROM sessions s
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
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const user = getSessionUser(token);
  if (!user) return res.status(401).json({ error: 'Chưa đăng nhập hoặc phiên đã hết hạn' });
  req.user = user;
  req.token = token;
  next();
}

function adminOnly(req, res, next) {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Chỉ quản trị viên được phép' });
  next();
}

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
  res.json({ token, user: { id: row.id, username: row.username, name: row.name, is_admin: !!row.is_admin } });
});

app.post('/api/logout', auth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => res.json({ user: req.user }));

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

/* ---------- Thông báo cá nhân (chuông 🔔) ---------- */

// Tạo thông báo cho userId (bỏ qua khi tự mình gây ra) và đẩy realtime
function pushNotification(userId, actorId, type, boardId, cardId, data = {}) {
  if (!userId || userId === actorId) return;
  db.prepare(`INSERT INTO notifications (user_id, actor_id, type, board_id, card_id, data)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(userId, actorId, type, boardId, cardId, JSON.stringify(data));
  broadcastUser(userId, { type: 'notification' });
}

const cardMemberIds = cardId =>
  db.prepare('SELECT user_id FROM card_members WHERE card_id = ?').all(cardId).map(r => r.user_id);

// Người nhận thông báo của một thẻ: thành viên ∪ theo dõi thẻ ∪ theo dõi board
const cardRecipientIds = cardId => [...new Set([
  ...cardMemberIds(cardId),
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

// Nhắc hạn: mỗi giờ quét thẻ đến hạn hôm nay/mai hoặc vừa trễ — mỗi thẻ+ngày chỉ nhắc 1 lần
function scanDueNotifications() {
  const today = new Date().toISOString().slice(0, 10);
  const REMIND_DAYS = { '0d': 0, '1d': 1, '2d': 2, '7d': 7 };
  const horizon = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const cards = db.prepare(`
    SELECT c.id, c.title, c.due_date, c.remind, l.board_id FROM cards c JOIN lists l ON l.id = c.list_id
    WHERE c.archived = 0 AND c.due_complete = 0 AND c.due_date != '' AND c.due_date <= ?
  `).all(horizon);
  const seen = db.prepare(`SELECT 1 FROM notifications WHERE user_id = ? AND card_id = ? AND type = ? AND data LIKE ?`);
  for (const c of cards) {
    let type = null;
    if (c.due_date < today) {
      if (c.due_date < new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10)) continue; // trễ quá 3 ngày thì thôi
      type = 'due_overdue';
    } else {
      // Nhắc trước hạn theo mức từng thẻ (none = không nhắc trước)
      const days = REMIND_DAYS[c.remind];
      if (days === undefined) continue;
      const remindFrom = new Date(new Date(c.due_date) - days * 864e5).toISOString().slice(0, 10);
      if (today < remindFrom) continue;
      type = 'due_soon';
    }
    for (const uid of cardRecipientIds(c.id)) {
      if (seen.get(uid, c.id, type, `%"${c.due_date}"%`)) continue;
      pushNotification(uid, null, type, c.board_id, c.id, { title: c.title, due: c.due_date });
    }
  }
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
  const today = new Date().toISOString().slice(0, 10);
  const weekday = ((new Date().getDay() + 6) % 7) + 1; // 1=Thứ 2 … 7=CN
  const rows = db.prepare("SELECT * FROM auto_schedules WHERE enabled = 1 AND last_run != ?").all(today);
  for (const s of rows) {
    if (s.cadence === 'weekly' && s.weekday !== weekday) continue;
    let a = {};
    try { a = JSON.parse(s.actions); } catch { continue; }
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
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const rules = db.prepare('SELECT * FROM due_rules WHERE enabled = 1').all();
  for (const rule of rules) {
    let a = {};
    try { a = JSON.parse(rule.actions); } catch { continue; }
    const cond = rule.trigger === 'overdue' ? `c.due_date < '${today}'` : `c.due_date = '${tomorrow}'`;
    const cards = db.prepare(`
      SELECT c.id, c.title FROM cards c JOIN lists l ON l.id = c.list_id
      WHERE l.board_id = ? AND c.archived = 0 AND c.due_complete = 0 AND c.due_date != '' AND ${cond}
        AND NOT EXISTS (SELECT 1 FROM due_rule_applied da WHERE da.rule_id = ? AND da.card_id = c.id)
    `).all(rule.board_id, rule.id);
    for (const c of cards) {
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
setInterval(hourlyTick, 60 * 60 * 1000);
setTimeout(hourlyTick, 10 * 1000);

app.get('/api/notifications', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT n.*, u.name AS actor_name, c.title AS card_title, b.title AS board_title
    FROM notifications n
    LEFT JOIN users u ON u.id = n.actor_id
    LEFT JOIN cards c ON c.id = n.card_id
    LEFT JOIN boards b ON b.id = n.board_id
    WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 50
  `).all(req.user.id);
  const unread = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0').get(req.user.id).n;
  res.json({ notifications: rows, unread });
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

app.get('/api/boards', auth, (req, res) => {
  const boards = db.prepare(`
    SELECT b.*,
      (SELECT COUNT(*) FROM lists l JOIN cards c ON c.list_id = l.id
        WHERE l.board_id = b.id AND c.archived = 0 AND l.archived = 0) AS card_count,
      EXISTS(SELECT 1 FROM board_stars s WHERE s.board_id = b.id AND s.user_id = ?) AS starred
    FROM boards b ORDER BY b.position, b.id
  `).all(req.user.id);
  res.json({ boards });
});

app.post('/api/boards', auth, (req, res) => {
  const title = String(req.body?.title || '').trim();
  const background = String(req.body?.background || 'blue');
  if (!title) return res.status(400).json({ error: 'Thiếu tên board' });
  const info = db.prepare('INSERT INTO boards (title, position, background) VALUES (?, ?, ?)')
    .run(title, nextPosition('boards', '', []), background);
  const boardId = info.lastInsertRowid;
  for (const t of ['Cần làm', 'Đang làm', 'Chờ duyệt', 'Hoàn thành']) {
    db.prepare('INSERT INTO lists (board_id, title, position) VALUES (?, ?, ?)')
      .run(boardId, t, nextPosition('lists', 'WHERE board_id = ?', [boardId]));
  }
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

// Sao chép board: cột (màu/WIP), nhãn, thẻ (mô tả/hạn/nhãn/checklist chưa tick), rule vào cột
app.post('/api/boards/:id/copy', auth, (req, res) => {
  const src = db.prepare('SELECT * FROM boards WHERE id = ?').get(req.params.id);
  if (!src) return res.status(404).json({ error: 'Board không tồn tại' });
  const copy = db.transaction(() => {
    const newBoardId = db.prepare('INSERT INTO boards (title, position, background, powerups) VALUES (?, ?, ?, ?)')
      .run(src.title + ' (bản sao)', nextPosition('boards', '', []), src.background, src.powerups).lastInsertRowid;
    const labelMap = {};
    for (const l of db.prepare('SELECT * FROM labels WHERE board_id = ? ORDER BY position').all(src.id)) {
      labelMap[l.id] = db.prepare('INSERT INTO labels (board_id, name, color, position) VALUES (?, ?, ?, ?)')
        .run(newBoardId, l.name, l.color, l.position).lastInsertRowid;
    }
    const listMap = {};
    for (const l of db.prepare('SELECT * FROM lists WHERE board_id = ? AND archived = 0 ORDER BY position').all(src.id)) {
      listMap[l.id] = db.prepare('INSERT INTO lists (board_id, title, position, color, wip_limit) VALUES (?, ?, ?, ?, ?)')
        .run(newBoardId, l.title, l.position, l.color, l.wip_limit).lastInsertRowid;
      for (const c of db.prepare('SELECT * FROM cards WHERE list_id = ? AND archived = 0 ORDER BY position').all(l.id)) {
        const newCardId = db.prepare(`INSERT INTO cards (list_id, title, description, due_date, due_time, start_date, recur, remind, cover, position)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(listMap[l.id], c.title, c.description, c.due_date, c.due_time, c.start_date, c.recur, c.remind,
               c.cover.startsWith('url:') ? '' : c.cover, c.position).lastInsertRowid;
        for (const cl of db.prepare('SELECT label_id FROM card_labels WHERE card_id = ?').all(c.id)) {
          if (labelMap[cl.label_id]) db.prepare('INSERT INTO card_labels (card_id, label_id) VALUES (?, ?)').run(newCardId, labelMap[cl.label_id]);
        }
        for (const ci of db.prepare('SELECT * FROM checklist_items WHERE card_id = ? ORDER BY position').all(c.id)) {
          db.prepare('INSERT INTO checklist_items (card_id, text, checked, position) VALUES (?, ?, 0, ?)').run(newCardId, ci.text, ci.position);
        }
      }
    }
    for (const r of db.prepare('SELECT * FROM automation_rules WHERE board_id = ?').all(src.id)) {
      if (!listMap[r.trigger_list_id]) continue;
      let a = {};
      try { a = JSON.parse(r.actions); } catch { continue; }
      if (a.label_id) a.label_id = labelMap[a.label_id] || undefined;
      db.prepare('INSERT INTO automation_rules (board_id, trigger_list_id, actions) VALUES (?, ?, ?)')
        .run(newBoardId, listMap[r.trigger_list_id], JSON.stringify(a));
    }
    return newBoardId;
  });
  const newId = copy();
  logActivity(newId, null, req.user.id, 'board_created', { title: src.title + ' (bản sao)' });
  broadcast(null, { type: 'boards-changed' });
  res.json({ id: newId });
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
  ensureBoardLabels(board.id);
  const lists = db.prepare('SELECT * FROM lists WHERE board_id = ? AND archived = 0 ORDER BY position, id').all(board.id);
  const cards = db.prepare(`
    SELECT c.* FROM cards c JOIN lists l ON l.id = c.list_id
    WHERE l.board_id = ? AND c.archived = 0 AND l.archived = 0
    ORDER BY c.position, c.id
  `).all(board.id);
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
  res.json({ board, lists, cards, checklist, commentCounts, attachmentCounts, labels, cardLabels, cardMembers, rules, voteCounts, myVotes, myWatches, watchingBoard, schedules, dueRules, cardButtons });
});

app.get('/api/boards/:id/archived', auth, (req, res) => {
  const id = Number(req.params.id);
  const cards = db.prepare(`
    SELECT c.*, l.title AS list_title FROM cards c JOIN lists l ON l.id = c.list_id
    WHERE l.board_id = ? AND c.archived = 1 ORDER BY c.id DESC
  `).all(id);
  const lists = db.prepare('SELECT * FROM lists WHERE board_id = ? AND archived = 1 ORDER BY id DESC').all(id);
  res.json({ cards, lists });
});

app.get('/api/boards/:id/activity', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT a.*, u.name AS user_name, c.title AS card_title FROM activity a
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN cards c ON c.id = a.card_id
    WHERE a.board_id = ? ORDER BY a.id DESC LIMIT 80
  `).all(req.params.id);
  res.json({ activity: rows });
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
  const info = db.prepare('INSERT INTO cards (list_id, title, position) VALUES (?, ?, ?)')
    .run(list_id, String(title).trim(), nextPosition('cards', 'WHERE list_id = ?', [list_id]));
  const boardId = boardIdOfList(list_id);
  logActivity(boardId, info.lastInsertRowid, req.user.id, 'card_created', { title: String(title).trim() });
  for (const uid of boardWatcherIds(boardId)) {
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
    try { actions = JSON.parse(rule.actions); } catch { continue; }
    const applied = [];
    if (actions.due_complete) {
      db.prepare('UPDATE cards SET due_complete = 1 WHERE id = ?').run(cardId);
      applied.push('due_complete');
    }
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

app.patch('/api/cards/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare('SELECT c.*, l.board_id, l.title AS list_title FROM cards c JOIN lists l ON l.id = c.list_id WHERE c.id = ?').get(id);
  if (!current) return res.status(404).json({ error: 'Thẻ không tồn tại' });
  const b = req.body || {};
  const sets = [];
  const vals = [];
  if (b.title !== undefined) { sets.push('title = ?'); vals.push(String(b.title).trim()); }
  if (b.description !== undefined) { sets.push('description = ?'); vals.push(String(b.description)); }
  if (b.due_date !== undefined) { sets.push('due_date = ?'); vals.push(String(b.due_date)); }
  if (b.start_date !== undefined) { sets.push('start_date = ?'); vals.push(String(b.start_date)); }
  if (b.due_time !== undefined) { sets.push('due_time = ?'); vals.push(String(b.due_time)); }
  if (b.recur !== undefined) { sets.push('recur = ?'); vals.push(['daily', 'weekly', 'monthly'].includes(b.recur) ? b.recur : ''); }
  if (b.remind !== undefined) { sets.push('remind = ?'); vals.push(['none', '0d', '1d', '2d', '7d'].includes(b.remind) ? b.remind : '1d'); }
  if (b.due_complete !== undefined) { sets.push('due_complete = ?'); vals.push(b.due_complete ? 1 : 0); }
  if (b.cover !== undefined) { sets.push('cover = ?'); vals.push(String(b.cover)); }
  if (b.archived !== undefined) { sets.push('archived = ?'); vals.push(b.archived ? 1 : 0); }
  if (b.list_id !== undefined) { sets.push('list_id = ?'); vals.push(Number(b.list_id)); }
  if (b.position !== undefined) { sets.push('position = ?'); vals.push(Number(b.position)); }
  if (sets.length) {
    vals.push(id);
    db.prepare(`UPDATE cards SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }
  const boardId = current.board_id;
  if (b.list_id !== undefined && Number(b.list_id) !== current.list_id) {
    const toList = db.prepare('SELECT title, board_id FROM lists WHERE id = ?').get(Number(b.list_id));
    logActivity(toList?.board_id || boardId, id, req.user.id, 'card_moved',
      { from: current.list_title, to: toList?.title });
    for (const uid of cardRecipientIds(id)) {
      pushNotification(uid, req.user.id, 'moved', toList?.board_id || boardId, id,
        { title: current.title, from: current.list_title, to: toList?.title });
    }
    applyRules(id, Number(b.list_id), req.user.id);
    if (toList && toList.board_id !== boardId) notifyBoard(toList.board_id);
  }
  if (b.archived !== undefined) {
    logActivity(boardId, id, req.user.id, b.archived ? 'card_archived' : 'card_restored', { title: current.title });
  }
  if (b.due_complete !== undefined && !!b.due_complete !== !!current.due_complete) {
    logActivity(boardId, id, req.user.id, b.due_complete ? 'card_completed' : 'card_uncompleted', {});
    if (b.due_complete) {
      for (const uid of cardRecipientIds(id)) {
        pushNotification(uid, req.user.id, 'completed', boardId, id, { title: current.title });
      }
      // Hạn định kỳ: hoàn thành xong tự dời hạn sang chu kỳ kế và mở lại thẻ
      if (current.recur && current.due_date) {
        const d = new Date(current.due_date);
        if (current.recur === 'daily') d.setDate(d.getDate() + 1);
        else if (current.recur === 'weekly') d.setDate(d.getDate() + 7);
        else d.setMonth(d.getMonth() + 1);
        const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        db.prepare('UPDATE cards SET due_date = ?, due_complete = 0 WHERE id = ?').run(next, id);
        db.prepare('UPDATE checklist_items SET checked = 0 WHERE card_id = ?').run(id);
        logActivity(boardId, id, null, 'rule_applied', { applied: ['🔁 định kỳ: dời hạn sang ' + next] });
      }
    }
  }
  notifyBoard(boardId);
  res.json({ ok: true });
});

app.post('/api/cards/:id/copy', auth, (req, res) => {
  const id = Number(req.params.id);
  const src = db.prepare('SELECT * FROM cards WHERE id = ?').get(id);
  if (!src) return res.status(404).json({ error: 'Thẻ không tồn tại' });
  const listId = Number(req.body?.list_id || src.list_id);
  const info = db.prepare(`
    INSERT INTO cards (list_id, title, description, due_date, due_complete, cover, position)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(listId, src.title, src.description, src.due_date, src.due_complete, src.cover,
    nextPosition('cards', 'WHERE list_id = ?', [listId]));
  const newId = info.lastInsertRowid;
  db.prepare('INSERT INTO card_labels (card_id, label_id) SELECT ?, label_id FROM card_labels WHERE card_id = ?').run(newId, id);
  db.prepare('INSERT INTO card_members (card_id, user_id) SELECT ?, user_id FROM card_members WHERE card_id = ?').run(newId, id);
  db.prepare(`
    INSERT INTO checklist_items (card_id, text, checked, position)
    SELECT ?, text, 0, position FROM checklist_items WHERE card_id = ?
  `).run(newId, id);
  const boardId = boardIdOfList(listId);
  logActivity(boardId, newId, req.user.id, 'card_copied', { title: src.title });
  notifyBoard(boardId);
  res.json({ id: newId });
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
  const info = db.prepare('INSERT INTO attachments (card_id, url, name) VALUES (?, ?, ?)').run(cardId, url, name);
  const boardId = boardIdOfCard(cardId);
  logActivity(boardId, cardId, req.user.id, 'attachment_added', { name });
  notifyBoard(boardId);
  res.json({ id: info.lastInsertRowid });
});

app.delete('/api/attachments/:id', auth, (req, res) => {
  const row = db.prepare('SELECT card_id FROM attachments WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM attachments WHERE id = ?').run(req.params.id);
  if (row) notifyBoard(boardIdOfCard(row.card_id));
  res.json({ ok: true });
});

/* ---------- Checklist & bình luận ---------- */

app.post('/api/cards/:id/checklist', auth, (req, res) => {
  const cardId = Number(req.params.id);
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Thiếu nội dung' });
  const info = db.prepare('INSERT INTO checklist_items (card_id, text, position) VALUES (?, ?, ?)')
    .run(cardId, text, nextPosition('checklist_items', 'WHERE card_id = ?', [cardId]));
  notifyBoard(boardIdOfCard(cardId));
  res.json({ id: info.lastInsertRowid });
});

app.patch('/api/checklist/:id', auth, (req, res) => {
  const item = db.prepare('SELECT card_id FROM checklist_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Không tồn tại' });
  const { text, checked } = req.body || {};
  if (text !== undefined) db.prepare('UPDATE checklist_items SET text = ? WHERE id = ?').run(String(text).trim(), req.params.id);
  if (checked !== undefined) db.prepare('UPDATE checklist_items SET checked = ? WHERE id = ?').run(checked ? 1 : 0, req.params.id);
  notifyBoard(boardIdOfCard(item.card_id));
  res.json({ ok: true });
});

app.delete('/api/checklist/:id', auth, (req, res) => {
  const item = db.prepare('SELECT card_id FROM checklist_items WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM checklist_items WHERE id = ?').run(req.params.id);
  if (item) notifyBoard(boardIdOfCard(item.card_id));
  res.json({ ok: true });
});

app.get('/api/cards/:id/comments', auth, (req, res) => {
  const comments = db.prepare(`
    SELECT cm.id, cm.text, cm.created_at, u.name AS author FROM comments cm
    LEFT JOIN users u ON u.id = cm.user_id WHERE cm.card_id = ? ORDER BY cm.id
  `).all(req.params.id);
  res.json({ comments });
});

app.post('/api/cards/:id/comments', auth, (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Bình luận trống' });
  const cardId = Number(req.params.id);
  db.prepare('INSERT INTO comments (card_id, user_id, text) VALUES (?, ?, ?)').run(cardId, req.user.id, text);
  const boardId = boardIdOfCard(cardId);
  logActivity(boardId, cardId, req.user.id, 'comment_added', { text: text.slice(0, 80) });
  const cardTitle = db.prepare('SELECT title FROM cards WHERE id = ?').get(cardId)?.title;
  const mentioned = new Set(mentionedUserIds(text));
  for (const uid of mentioned) {
    pushNotification(uid, req.user.id, 'mention', boardId, cardId, { title: cardTitle, text: text.slice(0, 80) });
  }
  for (const uid of cardRecipientIds(cardId)) {
    if (!mentioned.has(uid)) pushNotification(uid, req.user.id, 'comment', boardId, cardId, { title: cardTitle, text: text.slice(0, 80) });
  }
  notifyBoard(boardId);
  broadcast(boardId, { type: 'comments-changed', cardId });
  res.json({ ok: true });
});

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
  const applied = [];
  if (a.label_id) { db.prepare('INSERT OR IGNORE INTO card_labels (card_id, label_id) VALUES (?, ?)').run(cardId, Number(a.label_id)); applied.push('label'); }
  if (a.complete) { db.prepare('UPDATE cards SET due_complete = 1 WHERE id = ?').run(cardId); applied.push('complete'); }
  if (a.due_shift_days !== undefined && a.due_shift_days !== null && a.due_shift_days !== '') {
    const base = card.due_date ? new Date(card.due_date) : new Date();
    base.setDate(base.getDate() + Number(a.due_shift_days));
    const d = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
    db.prepare('UPDATE cards SET due_date = ? WHERE id = ?').run(d, cardId);
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
  if (!src || !dst || srcId === dstId) return res.status(400).json({ error: 'Thẻ nguồn/đích không hợp lệ' });
  const merge = db.transaction(() => {
    if (src.description) {
      const d = dst.description ? dst.description + '\n\n— Hợp nhất từ "' + src.title + '":\n' + src.description
                                : src.description;
      db.prepare('UPDATE cards SET description = ? WHERE id = ?').run(d, dstId);
    }
    if (src.due_date && !dst.due_date) {
      db.prepare('UPDATE cards SET due_date = ? WHERE id = ?').run(src.due_date, dstId);
    }
    db.prepare('UPDATE checklist_items SET card_id = ? WHERE card_id = ?').run(dstId, srcId);
    db.prepare('UPDATE comments SET card_id = ? WHERE card_id = ?').run(dstId, srcId);
    db.prepare('UPDATE attachments SET card_id = ? WHERE card_id = ?').run(dstId, srcId);
    db.prepare('INSERT OR IGNORE INTO card_labels (card_id, label_id) SELECT ?, label_id FROM card_labels WHERE card_id = ?').run(dstId, srcId);
    db.prepare('INSERT OR IGNORE INTO card_members (card_id, user_id) SELECT ?, user_id FROM card_members WHERE card_id = ?').run(dstId, srcId);
    db.prepare('INSERT OR IGNORE INTO card_watchers (card_id, user_id) SELECT ?, user_id FROM card_watchers WHERE card_id = ?').run(dstId, srcId);
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
    WHERE c.archived = 0 AND (c.title LIKE ? OR c.description LIKE ?)
    ORDER BY c.id DESC LIMIT 30
  `).all(like, like);
  res.json({ cards });
});

/* ---------- Định vị thẻ (cho link chia sẻ #c/<id>) ---------- */

app.get('/api/cards/:id/locate', auth, (req, res) => {
  const row = db.prepare(`
    SELECT c.id, c.archived, l.board_id FROM cards c JOIN lists l ON l.id = c.list_id WHERE c.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Thẻ không tồn tại' });
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

app.get('/u/:file', (req, res) => {
  const file = String(req.params.file).replace(/[^a-z0-9.]/gi, '');
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
  res.set('Cache-Control', 'private, max-age=86400');
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
    WHERE ps.user_id = ? AND c.archived = 0
  `).all(req.user.id);
  const myCards = db.prepare(`
    SELECT c.id, c.title, c.due_date, c.due_complete, l.title AS list_title, l.board_id, b.title AS board_title
    FROM card_members cm
    JOIN cards c ON c.id = cm.card_id JOIN lists l ON l.id = c.list_id JOIN boards b ON b.id = l.board_id
    WHERE cm.user_id = ? AND c.archived = 0 AND l.archived = 0 AND b.closed = 0 AND c.due_complete = 0
    ORDER BY CASE WHEN c.due_date = '' THEN 1 ELSE 0 END, c.due_date, c.id DESC LIMIT 100
  `).all(req.user.id);
  const inbox = db.prepare("SELECT * FROM inbox_items WHERE user_id = ? AND date != '' ORDER BY date").all(req.user.id);
  res.json({ slots, myCards, inbox });
});

app.put('/api/planner', auth, (req, res) => {
  const cardId = Number(req.body?.card_id);
  const date = String(req.body?.date || '');
  if (!cardId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Cần thẻ và ngày hợp lệ' });
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
  socket.on('message', raw => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'watch') socket.boardId = msg.boardId ? Number(msg.boardId) : null;
    } catch {}
  });
});

function broadcast(boardId, payload) {
  const msg = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState !== 1) continue;
    if (boardId === null || client.boardId === boardId) client.send(msg);
  }
}

function broadcastUser(userId, payload) {
  const msg = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === 1 && client.userId === userId) client.send(msg);
  }
}

server.listen(PORT, () => console.log(`Kanban server chạy tại http://localhost:${PORT}`));
