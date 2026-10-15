// Dựng sẵn board "Sản xuất video" theo quy trình kênh YouTube:
// cột quy trình, nhãn chuẩn, rule automation và thẻ mẫu có checklist.
// Chạy trên máy chủ (cùng DATA_DIR với app):  node scripts/seed-youtube-board.mjs
// Chạy lại an toàn: nếu board cùng tên đã tồn tại thì script bỏ qua, không tạo trùng.
import { db } from '../src/db.js';

const BOARD_TITLE = 'Sản xuất video';

const existing = db.prepare('SELECT id FROM boards WHERE title = ?').get(BOARD_TITLE);
if (existing) {
  console.log(`Board "${BOARD_TITLE}" đã tồn tại (id ${existing.id}) — không tạo lại.`);
  process.exit(0);
}

const nextPos = (table, where, params) =>
  db.prepare(`SELECT COALESCE(MAX(position), 0) + 1024 AS p FROM ${table} ${where}`).get(...params).p;

const boardId = db.prepare('INSERT INTO boards (title, position, background) VALUES (?, ?, ?)')
  .run(BOARD_TITLE, nextPos('boards', '', []), 'forest').lastInsertRowid;

const listIds = {};
for (const title of ['Ý tưởng', 'Kịch bản', 'Sản xuất', 'Duyệt', 'Đã đăng']) {
  listIds[title] = db.prepare('INSERT INTO lists (board_id, title, position) VALUES (?, ?, ?)')
    .run(boardId, title, nextPos('lists', 'WHERE board_id = ?', [boardId])).lastInsertRowid;
}

// Nhãn chuẩn của kênh (màu theo bảng màu Trello)
const labelIds = {};
const LABELS = [
  ['Kịch bản', '#61bd4f'],
  ['Voice', '#c377e0'],
  ['Edit', '#f2d600'],
  ['Thumbnail', '#ff9f1a'],
  ['SEO', '#0079bf'],
  ['Gấp', '#eb5a46'],
];
for (const [name, color] of LABELS) {
  labelIds[name] = db.prepare('INSERT INTO labels (board_id, name, color, position) VALUES (?, ?, ?, ?)')
    .run(boardId, name, color, nextPos('labels', 'WHERE board_id = ?', [boardId])).lastInsertRowid;
}

// Automation: thẻ vào "Đã đăng" → đánh dấu hoàn thành hạn + tick toàn bộ checklist
db.prepare('INSERT INTO automation_rules (board_id, trigger_list_id, actions) VALUES (?, ?, ?)')
  .run(boardId, listIds['Đã đăng'], JSON.stringify({ due_complete: true, check_all: true }));

// Thẻ mẫu kèm checklist chuẩn — đội nhìn vào là hiểu cách dùng
function card(listTitle, title, labels = [], checklist = [], description = '') {
  const listId = listIds[listTitle];
  const id = db.prepare('INSERT INTO cards (list_id, title, description, position) VALUES (?, ?, ?, ?)')
    .run(listId, title, description, nextPos('cards', 'WHERE list_id = ?', [listId])).lastInsertRowid;
  for (const l of labels) {
    db.prepare('INSERT INTO card_labels (card_id, label_id) VALUES (?, ?)').run(id, labelIds[l]);
  }
  for (const text of checklist) {
    db.prepare('INSERT INTO checklist_items (card_id, text, position) VALUES (?, ?, ?)')
      .run(id, text, nextPos('checklist_items', 'WHERE card_id = ?', [id]));
  }
  return id;
}

card('Ý tưởng', '[MẪU] Tập 13 — Ý tưởng câu chuyện', [],
  ['Chủ đề & cảm xúc chính', 'Khảo sát bình luận khán giả', 'Chốt góc kể'],
  'Nhân bản thẻ này (nút Sao chép) cho mỗi tập mới. Mỗi thẻ = 1 video, kéo dần qua các cột theo tiến độ.');
card('Kịch bản', '[MẪU] Tập 12 — Kịch bản', ['Kịch bản'],
  ['Dàn ý 3 hồi', 'Bản nháp 1', 'Đọc soát & chỉnh giọng kể', 'Duyệt kịch bản']);
card('Sản xuất', '[MẪU] Tập 11 — Sản xuất', ['Voice', 'Edit', 'Thumbnail'],
  ['Thu voice', 'Edit video', 'Làm thumbnail (2 phương án)', 'Tiêu đề + mô tả SEO']);
card('Duyệt', '[MẪU] Tập 10 — Duyệt cuối', ['SEO'],
  ['Xem bản final', 'Check thumbnail + tiêu đề khớp nội dung', 'Lên lịch đăng']);

console.log(`Đã tạo board "${BOARD_TITLE}" (id ${boardId}): 5 cột quy trình, ${LABELS.length} nhãn, 1 rule automation, 4 thẻ mẫu.`);
