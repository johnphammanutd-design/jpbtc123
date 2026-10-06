import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { db, hashPassword, verifyPassword } from './db.js';

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

/* ---------- Board / List / Card ---------- */

function nextPosition(table, whereSql, params) {
  const row = db.prepare(`SELECT COALESCE(MAX(position), 0) AS p FROM ${table} ${whereSql}`).get(...params);
  return row.p + 1024;
}

function boardIdOfList(listId) {
  return db.prepare('SELECT board_id FROM lists WHERE id = ?').get(listId)?.board_id;
}
function boardIdOfCard(cardId) {
  return db.prepare('SELECT l.board_id FROM cards c JOIN lists l ON l.id = c.list_id WHERE c.id = ?').get(cardId)?.board_id;
}

app.get('/api/boards', auth, (req, res) => {
  const boards = db.prepare(`
    SELECT b.*, (SELECT COUNT(*) FROM lists l JOIN cards c ON c.list_id = l.id WHERE l.board_id = b.id) AS card_count
    FROM boards b ORDER BY b.position, b.id
  `).all();
  res.json({ boards });
});

app.post('/api/boards', auth, (req, res) => {
  const title = String(req.body?.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Thiếu tên board' });
  const info = db.prepare('INSERT INTO boards (title, position) VALUES (?, ?)')
    .run(title, nextPosition('boards', '', []));
  const boardId = info.lastInsertRowid;
  // Cột mặc định để đội bắt đầu nhanh
  for (const t of ['Cần làm', 'Đang làm', 'Chờ duyệt', 'Hoàn thành']) {
    db.prepare('INSERT INTO lists (board_id, title, position) VALUES (?, ?, ?)')
      .run(boardId, t, nextPosition('lists', 'WHERE board_id = ?', [boardId]));
  }
  broadcast(null, { type: 'boards-changed' });
  res.json({ id: boardId });
});

app.patch('/api/boards/:id', auth, (req, res) => {
  const { title } = req.body || {};
  if (title !== undefined) db.prepare('UPDATE boards SET title = ? WHERE id = ?').run(String(title).trim(), req.params.id);
  broadcast(Number(req.params.id), { type: 'board-changed', boardId: Number(req.params.id) });
  broadcast(null, { type: 'boards-changed' });
  res.json({ ok: true });
});

app.delete('/api/boards/:id', auth, (req, res) => {
  db.prepare('DELETE FROM boards WHERE id = ?').run(req.params.id);
  broadcast(null, { type: 'boards-changed' });
  res.json({ ok: true });
});

app.get('/api/boards/:id', auth, (req, res) => {
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(req.params.id);
  if (!board) return res.status(404).json({ error: 'Board không tồn tại' });
  const lists = db.prepare('SELECT * FROM lists WHERE board_id = ? ORDER BY position, id').all(board.id);
  const cards = db.prepare(`
    SELECT c.*, u.name AS assignee_name FROM cards c
    LEFT JOIN users u ON u.id = c.assignee_id
    JOIN lists l ON l.id = c.list_id WHERE l.board_id = ?
    ORDER BY c.position, c.id
  `).all(board.id);
  const checklist = db.prepare(`
    SELECT ci.* FROM checklist_items ci
    JOIN cards c ON c.id = ci.card_id JOIN lists l ON l.id = c.list_id
    WHERE l.board_id = ? ORDER BY ci.position, ci.id
  `).all(board.id);
  const commentCounts = db.prepare(`
    SELECT c.id AS card_id, COUNT(cm.id) AS n FROM cards c
    JOIN lists l ON l.id = c.list_id LEFT JOIN comments cm ON cm.card_id = c.id
    WHERE l.board_id = ? GROUP BY c.id
  `).all(board.id);
  res.json({ board, lists, cards, checklist, commentCounts });
});

app.post('/api/lists', auth, (req, res) => {
  const { board_id, title } = req.body || {};
  if (!board_id || !String(title || '').trim()) return res.status(400).json({ error: 'Thiếu board hoặc tên cột' });
  const info = db.prepare('INSERT INTO lists (board_id, title, position) VALUES (?, ?, ?)')
    .run(board_id, String(title).trim(), nextPosition('lists', 'WHERE board_id = ?', [board_id]));
  broadcast(Number(board_id), { type: 'board-changed', boardId: Number(board_id) });
  res.json({ id: info.lastInsertRowid });
});

app.patch('/api/lists/:id', auth, (req, res) => {
  const boardId = boardIdOfList(req.params.id);
  const { title, position } = req.body || {};
  if (title !== undefined) db.prepare('UPDATE lists SET title = ? WHERE id = ?').run(String(title).trim(), req.params.id);
  if (position !== undefined) db.prepare('UPDATE lists SET position = ? WHERE id = ?').run(Number(position), req.params.id);
  broadcast(boardId, { type: 'board-changed', boardId });
  res.json({ ok: true });
});

app.delete('/api/lists/:id', auth, (req, res) => {
  const boardId = boardIdOfList(req.params.id);
  db.prepare('DELETE FROM lists WHERE id = ?').run(req.params.id);
  broadcast(boardId, { type: 'board-changed', boardId });
  res.json({ ok: true });
});

app.post('/api/cards', auth, (req, res) => {
  const { list_id, title } = req.body || {};
  if (!list_id || !String(title || '').trim()) return res.status(400).json({ error: 'Thiếu cột hoặc tiêu đề thẻ' });
  const info = db.prepare('INSERT INTO cards (list_id, title, position) VALUES (?, ?, ?)')
    .run(list_id, String(title).trim(), nextPosition('cards', 'WHERE list_id = ?', [list_id]));
  const boardId = boardIdOfList(list_id);
  broadcast(boardId, { type: 'board-changed', boardId });
  res.json({ id: info.lastInsertRowid });
});

app.patch('/api/cards/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  const before = boardIdOfCard(id);
  const b = req.body || {};
  const sets = [];
  const vals = [];
  if (b.title !== undefined) { sets.push('title = ?'); vals.push(String(b.title).trim()); }
  if (b.description !== undefined) { sets.push('description = ?'); vals.push(String(b.description)); }
  if (b.due_date !== undefined) { sets.push('due_date = ?'); vals.push(String(b.due_date)); }
  if (b.labels !== undefined) { sets.push('labels = ?'); vals.push(JSON.stringify(b.labels)); }
  if (b.assignee_id !== undefined) { sets.push('assignee_id = ?'); vals.push(b.assignee_id || null); }
  if (b.list_id !== undefined) { sets.push('list_id = ?'); vals.push(Number(b.list_id)); }
  if (b.position !== undefined) { sets.push('position = ?'); vals.push(Number(b.position)); }
  if (sets.length) {
    vals.push(id);
    db.prepare(`UPDATE cards SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }
  const after = boardIdOfCard(id);
  for (const boardId of new Set([before, after])) {
    if (boardId) broadcast(boardId, { type: 'board-changed', boardId });
  }
  res.json({ ok: true });
});

app.delete('/api/cards/:id', auth, (req, res) => {
  const boardId = boardIdOfCard(req.params.id);
  db.prepare('DELETE FROM cards WHERE id = ?').run(req.params.id);
  broadcast(boardId, { type: 'board-changed', boardId });
  res.json({ ok: true });
});

/* ---------- Checklist & bình luận ---------- */

app.post('/api/cards/:id/checklist', auth, (req, res) => {
  const cardId = Number(req.params.id);
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Thiếu nội dung' });
  const info = db.prepare('INSERT INTO checklist_items (card_id, text, position) VALUES (?, ?, ?)')
    .run(cardId, text, nextPosition('checklist_items', 'WHERE card_id = ?', [cardId]));
  const boardId = boardIdOfCard(cardId);
  broadcast(boardId, { type: 'board-changed', boardId });
  res.json({ id: info.lastInsertRowid });
});

app.patch('/api/checklist/:id', auth, (req, res) => {
  const item = db.prepare('SELECT card_id FROM checklist_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Không tồn tại' });
  const { text, checked } = req.body || {};
  if (text !== undefined) db.prepare('UPDATE checklist_items SET text = ? WHERE id = ?').run(String(text).trim(), req.params.id);
  if (checked !== undefined) db.prepare('UPDATE checklist_items SET checked = ? WHERE id = ?').run(checked ? 1 : 0, req.params.id);
  const boardId = boardIdOfCard(item.card_id);
  broadcast(boardId, { type: 'board-changed', boardId });
  res.json({ ok: true });
});

app.delete('/api/checklist/:id', auth, (req, res) => {
  const item = db.prepare('SELECT card_id FROM checklist_items WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM checklist_items WHERE id = ?').run(req.params.id);
  if (item) {
    const boardId = boardIdOfCard(item.card_id);
    broadcast(boardId, { type: 'board-changed', boardId });
  }
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
  broadcast(boardId, { type: 'board-changed', boardId });
  broadcast(boardId, { type: 'comments-changed', cardId });
  res.json({ ok: true });
});

/* ---------- WebSocket: đẩy thay đổi realtime ---------- */

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Mỗi client theo dõi 1 board (hoặc null = chỉ danh sách board)
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
