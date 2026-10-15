import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { db, hashPassword, verifyPassword, ensureBoardLabels } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

/* ---------- Xác thực ---------- */

function getSessionUser(token) {
  if (!token) return null;
  return db.prepare(`
    SELECT u.id, u.username, u.name, u.is_admin FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND u.disabled = 0
  `).get(token) || null;
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

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const row = db.prepare('SELECT * FROM users WHERE username = ? AND disabled = 0').get(String(username || '').trim());
  if (!row || !verifyPassword(String(password || ''), row.password_hash)) {
    return res.status(401).json({ error: 'Sai tên đăng nhập hoặc mật khẩu' });
  }
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
  const { title, background, closed } = req.body || {};
  if (title !== undefined) db.prepare('UPDATE boards SET title = ? WHERE id = ?').run(String(title).trim(), id);
  if (background !== undefined) db.prepare('UPDATE boards SET background = ? WHERE id = ?').run(String(background), id);
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
  res.json({ board, lists, cards, checklist, commentCounts, attachmentCounts, labels, cardLabels, cardMembers, rules });
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
  const { title, position, archived } = req.body || {};
  if (title !== undefined) db.prepare('UPDATE lists SET title = ? WHERE id = ?').run(String(title).trim(), req.params.id);
  if (position !== undefined) db.prepare('UPDATE lists SET position = ? WHERE id = ?').run(Number(position), req.params.id);
  if (archived !== undefined) {
    db.prepare('UPDATE lists SET archived = ? WHERE id = ?').run(archived ? 1 : 0, req.params.id);
    logActivity(boardId, null, req.user.id, archived ? 'list_archived' : 'list_restored',
      { title: db.prepare('SELECT title FROM lists WHERE id = ?').get(req.params.id)?.title });
  }
  notifyBoard(boardId);
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
    applyRules(id, Number(b.list_id), req.user.id);
    if (toList && toList.board_id !== boardId) notifyBoard(toList.board_id);
  }
  if (b.archived !== undefined) {
    logActivity(boardId, id, req.user.id, b.archived ? 'card_archived' : 'card_restored', { title: current.title });
  }
  if (b.due_complete !== undefined && !!b.due_complete !== !!current.due_complete) {
    logActivity(boardId, id, req.user.id, b.due_complete ? 'card_completed' : 'card_uncompleted', {});
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

/* ---------- WebSocket ---------- */

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (socket, req) => {
  const url = new URL(req.url, 'http://localhost');
  const user = getSessionUser(url.searchParams.get('token'));
  if (!user) { socket.close(4001, 'unauthorized'); return; }
  socket.boardId = null;
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

server.listen(PORT, () => console.log(`Kanban server chạy tại http://localhost:${PORT}`));
