import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'kanban.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS boards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  position REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  position REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_date TEXT NOT NULL DEFAULT '',
  labels TEXT NOT NULL DEFAULT '[]',
  position REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  checked INTEGER NOT NULL DEFAULT 0,
  position REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lists_board ON lists(board_id);
CREATE INDEX IF NOT EXISTS idx_cards_list ON cards(list_id);
CREATE INDEX IF NOT EXISTS idx_checklist_card ON checklist_items(card_id);
CREATE INDEX IF NOT EXISTS idx_comments_card ON comments(card_id);
`);

/* ---------- Migration v2: bộ tính năng Trello đầy đủ ---------- */

const hasColumn = (table, col) =>
  db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);

if (!hasColumn('boards', 'background'))
  db.exec("ALTER TABLE boards ADD COLUMN background TEXT NOT NULL DEFAULT 'blue'");
if (!hasColumn('boards', 'closed'))
  db.exec('ALTER TABLE boards ADD COLUMN closed INTEGER NOT NULL DEFAULT 0');
if (!hasColumn('lists', 'archived'))
  db.exec('ALTER TABLE lists ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
if (!hasColumn('cards', 'cover'))
  db.exec("ALTER TABLE cards ADD COLUMN cover TEXT NOT NULL DEFAULT ''");
if (!hasColumn('cards', 'due_complete'))
  db.exec('ALTER TABLE cards ADD COLUMN due_complete INTEGER NOT NULL DEFAULT 0');
if (!hasColumn('cards', 'archived'))
  db.exec('ALTER TABLE cards ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');

db.exec(`
CREATE TABLE IF NOT EXISTS labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL,
  position REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS card_labels (
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (card_id, label_id)
);
CREATE TABLE IF NOT EXISTS card_members (
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (card_id, user_id)
);
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  card_id INTEGER REFERENCES cards(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS automation_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  trigger_list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  actions TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS board_stars (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, board_id)
);
CREATE INDEX IF NOT EXISTS idx_labels_board ON labels(board_id);
CREATE INDEX IF NOT EXISTS idx_activity_board ON activity(board_id, id);
CREATE INDEX IF NOT EXISTS idx_activity_card ON activity(card_id, id);
CREATE INDEX IF NOT EXISTS idx_attachments_card ON attachments(card_id);
`);

// Bảng màu nhãn mặc định của board (trùng bảng màu Trello)
export const DEFAULT_LABEL_COLORS = ['#61bd4f', '#f2d600', '#ff9f1a', '#eb5a46', '#c377e0', '#0079bf'];

export function ensureBoardLabels(boardId) {
  const n = db.prepare('SELECT COUNT(*) AS n FROM labels WHERE board_id = ?').get(boardId).n;
  if (n > 0) return;
  const ins = db.prepare('INSERT INTO labels (board_id, name, color, position) VALUES (?, ?, ?, ?)');
  DEFAULT_LABEL_COLORS.forEach((color, i) => ins.run(boardId, '', color, (i + 1) * 1024));
}

// Dữ liệu cũ: labels JSON theo chỉ số màu → bảng card_labels; assignee đơn → card_members
const migrated = db.prepare("SELECT COUNT(*) AS n FROM card_labels").get().n;
if (migrated === 0) {
  const boards = db.prepare('SELECT id FROM boards').all();
  for (const b of boards) ensureBoardLabels(b.id);
  const cards = db.prepare("SELECT id, list_id, labels, assignee_id FROM cards WHERE labels != '[]' OR assignee_id IS NOT NULL").all();
  const boardOf = db.prepare('SELECT board_id FROM lists WHERE id = ?');
  const labelByIndex = db.prepare('SELECT id FROM labels WHERE board_id = ? ORDER BY position LIMIT 1 OFFSET ?');
  const insCL = db.prepare('INSERT OR IGNORE INTO card_labels (card_id, label_id) VALUES (?, ?)');
  const insCM = db.prepare('INSERT OR IGNORE INTO card_members (card_id, user_id) VALUES (?, ?)');
  for (const c of cards) {
    const boardId = boardOf.get(c.list_id)?.board_id;
    if (!boardId) continue;
    try {
      for (const idx of JSON.parse(c.labels || '[]')) {
        const label = labelByIndex.get(boardId, idx);
        if (label) insCL.run(c.id, label.id);
      }
    } catch {}
    if (c.assignee_id) insCM.run(c.id, c.assignee_id);
  }
}

/* ---------- Migration v3: đợt 2 — thông báo, Inbox, Planner, Power-ups ---------- */

if (!hasColumn('boards', 'powerups'))
  db.exec("ALTER TABLE boards ADD COLUMN powerups TEXT NOT NULL DEFAULT '{}'");
if (!hasColumn('lists', 'wip_limit'))
  db.exec('ALTER TABLE lists ADD COLUMN wip_limit INTEGER NOT NULL DEFAULT 0');

db.exec(`
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  board_id INTEGER REFERENCES boards(id) ON DELETE CASCADE,
  card_id INTEGER REFERENCES cards(id) ON DELETE CASCADE,
  data TEXT NOT NULL DEFAULT '{}',
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS inbox_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  date TEXT NOT NULL DEFAULT '',
  position REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS planner_slots (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  PRIMARY KEY (user_id, card_id)
);
CREATE TABLE IF NOT EXISTS card_votes (
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (card_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read, id);
CREATE INDEX IF NOT EXISTS idx_inbox_user ON inbox_items(user_id, position);
`);

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

// Tài khoản quản trị đầu tiên: đặt qua biến môi trường, mặc định admin/admin123
// (bắt buộc đổi mật khẩu sau lần đăng nhập đầu — nhắc trong README).
const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (userCount === 0) {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  db.prepare('INSERT INTO users (username, name, password_hash, is_admin) VALUES (?, ?, ?, 1)')
    .run(username, 'Quản trị viên', hashPassword(password));
  console.log(`[init] Đã tạo tài khoản quản trị "${username}". Hãy đổi mật khẩu ngay sau khi đăng nhập.`);
}
