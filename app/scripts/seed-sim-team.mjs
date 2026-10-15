// Giả lập đội đang hoạt động: board "[SIM] Sản xuất video" + 6 thành viên giả
// với 3 tuần dữ liệu (thẻ, gán người, hạn chót, checklist, bình luận, nhật ký).
// Mục đích: có dữ liệu thật tay để phát triển tính năng đợt 2 (thông báo, bộ lọc,
// Table view…) mà KHÔNG đụng board pilot của đội thật.
//
// - Board riêng, tên bắt đầu "[SIM]" — xóa toàn bộ bằng scripts/remove-sim-team.mjs
// - User giả username "sim.*", disabled=1 (không ai đăng nhập được)
// - Chạy lại an toàn: board [SIM] đã tồn tại thì thoát, không tạo trùng
// Dùng:  node scripts/seed-sim-team.mjs
import { db, hashPassword } from '../src/db.js';
import crypto from 'node:crypto';

const BOARD_TITLE = '[SIM] Sản xuất video';
if (db.prepare('SELECT id FROM boards WHERE title = ?').get(BOARD_TITLE)) {
  console.log(`Board "${BOARD_TITLE}" đã tồn tại — không tạo lại. Gỡ bằng remove-sim-team.mjs nếu muốn làm mới.`);
  process.exit(0);
}

// Thời gian lùi về quá khứ, định dạng giống datetime('now') của SQLite
const at = (daysAgo, hour = 9, minute = 0) => {
  const d = new Date(Date.now() - daysAgo * 86400e3);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString().slice(0, 19).replace('T', ' ');
};
// due_date trong app là ngày thuần YYYY-MM-DD (frontend so sánh chuỗi và đảo thành DD/MM)
const due = (daysFromNow) => {
  const d = new Date(Date.now() + daysFromNow * 86400e3);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/* ---------- Thành viên giả (khóa đăng nhập) ---------- */
const TEAM = [
  ['sim.an',   'An — Biên kịch (SIM)'],
  ['sim.binh', 'Bình — Voice (SIM)'],
  ['sim.chi',  'Chi — Editor (SIM)'],
  ['sim.dung', 'Dũng — Thumbnail (SIM)'],
  ['sim.lan',  'Lan — SEO/Đăng (SIM)'],
  ['sim.minh', 'Minh — Quản lý kênh (SIM)'],
];
const U = {};
for (const [username, name] of TEAM) {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  U[username] = existing ? existing.id
    : db.prepare('INSERT INTO users (username, name, password_hash, is_admin, disabled, created_at) VALUES (?, ?, ?, 0, 1, ?)')
        .run(username, name, hashPassword(crypto.randomBytes(24).toString('hex')), at(21)).lastInsertRowid;
}

/* ---------- Board, cột, nhãn, rule ---------- */
const boardId = db.prepare('INSERT INTO boards (title, position, background, created_at) VALUES (?, ?, ?, ?)')
  .run(BOARD_TITLE, 99999, 'purple', at(20)).lastInsertRowid;

const L = {};
['Ý tưởng', 'Kịch bản', 'Sản xuất', 'Duyệt', 'Đã đăng'].forEach((t, i) => {
  L[t] = db.prepare('INSERT INTO lists (board_id, title, position) VALUES (?, ?, ?)')
    .run(boardId, t, (i + 1) * 1024).lastInsertRowid;
});

const LB = {};
[['Kịch bản', '#61bd4f'], ['Voice', '#c377e0'], ['Edit', '#f2d600'],
 ['Thumbnail', '#ff9f1a'], ['SEO', '#0079bf'], ['Gấp', '#eb5a46']].forEach(([n, c], i) => {
  LB[n] = db.prepare('INSERT INTO labels (board_id, name, color, position) VALUES (?, ?, ?, ?)')
    .run(boardId, n, c, (i + 1) * 1024).lastInsertRowid;
});

db.prepare('INSERT INTO automation_rules (board_id, trigger_list_id, actions) VALUES (?, ?, ?)')
  .run(boardId, L['Đã đăng'], JSON.stringify({ due_complete: true, check_all: true }));

/* ---------- Tiện ích tạo thẻ + nhật ký ---------- */
const act = (cardId, userId, type, data, when) =>
  db.prepare('INSERT INTO activity (board_id, card_id, user_id, type, data, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(boardId, cardId, userId, type, JSON.stringify(data), when);

let seq = 0;
function simCard(c) {
  seq += 1;
  const id = db.prepare(`INSERT INTO cards
      (list_id, title, description, assignee_id, due_date, position, created_at, due_complete, archived)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`)
    .run(L[c.list], c.title, c.desc || '', U[c.members[0]] || null, c.due || '',
         seq * 1024, at(c.createdDaysAgo, 8 + (seq % 6)), c.dueComplete ? 1 : 0).lastInsertRowid;
  for (const m of c.members) db.prepare('INSERT INTO card_members (card_id, user_id) VALUES (?, ?)').run(id, U[m]);
  for (const lb of c.labels || []) db.prepare('INSERT INTO card_labels (card_id, label_id) VALUES (?, ?)').run(id, LB[lb]);
  (c.checklist || []).forEach(([text, checked], i) =>
    db.prepare('INSERT INTO checklist_items (card_id, text, checked, position) VALUES (?, ?, ?, ?)')
      .run(id, text, checked ? 1 : 0, (i + 1) * 1024));
  for (const [u, name, url, d] of c.files || [])
    db.prepare('INSERT INTO attachments (card_id, url, name, created_at) VALUES (?, ?, ?, ?)').run(id, url, name, at(d));

  // Nhật ký: tạo thẻ → gán người → các lần chuyển cột → bình luận
  act(id, U[c.by || 'sim.minh'], 'card_created', { title: c.title, list: c.firstList || 'Ý tưởng' }, at(c.createdDaysAgo, 8));
  act(id, U[c.by || 'sim.minh'], 'members_changed', { count: c.members.length }, at(c.createdDaysAgo, 8, 30));
  for (const [from, to, d] of c.moves || [])
    act(id, U[c.members[0]], 'card_moved', { from, to }, at(d, 10 + (seq % 7)));
  for (const [u, text, d, h] of c.comments || []) {
    db.prepare('INSERT INTO comments (card_id, user_id, text, created_at) VALUES (?, ?, ?, ?)').run(id, U[u], text, at(d, h || 14));
    act(id, U[u], 'comment_added', { text: text.slice(0, 80) }, at(d, h || 14));
  }
  if (c.dueComplete) act(id, U[c.members[0]], 'card_completed', {}, at(c.doneDaysAgo ?? 1, 17));
  return id;
}

act(null, U['sim.minh'], 'board_created', { title: BOARD_TITLE }, at(20, 8));

/* ---------- Dữ liệu 3 tuần của đội ---------- */
// Đã đăng (xong hẳn, có rule chạy)
simCard({ list: 'Đã đăng', title: 'Tập 21 — Người cha và chiếc xe đạp cũ', by: 'sim.minh',
  members: ['sim.an', 'sim.binh', 'sim.chi', 'sim.lan'], labels: ['Kịch bản', 'Voice', 'Edit', 'SEO'],
  createdDaysAgo: 20, due: due(-14), dueComplete: true, doneDaysAgo: 13,
  desc: 'Video chủ lực tuần 1. Mục tiêu 500k view trong 7 ngày.',
  checklist: [['Kịch bản duyệt', 1], ['Voice thu xong', 1], ['Edit bản final', 1], ['Thumbnail A/B', 1], ['Đăng + SEO', 1]],
  moves: [['Ý tưởng', 'Kịch bản', 19], ['Kịch bản', 'Sản xuất', 17], ['Sản xuất', 'Duyệt', 15], ['Duyệt', 'Đã đăng', 14]],
  comments: [
    ['sim.an', 'Kịch bản bản 2 đã sửa đoạn mở đầu theo góp ý, nhấn xung đột ngay 15 giây đầu.', 18, 9],
    ['sim.minh', 'Duyệt. Chú ý nhịp cắt đoạn giữa, tập trước bị chê lê thê.', 17, 11],
    ['sim.chi', 'Bản edit final đã lên Drive, có 2 phương án nhạc nền.', 15, 16],
    ['sim.lan', 'Đã đăng 20h thứ 6. CTR 24h đầu: 8.2%, giữ chân 42%.', 13, 21],
  ],
  files: [['sim.chi', 'Bản dựng final', 'https://drive.example/sim/tap-21-final', 15]] });

simCard({ list: 'Đã đăng', title: 'Tập 22 — Bữa cơm đoàn tụ', by: 'sim.minh',
  members: ['sim.an', 'sim.chi', 'sim.lan'], labels: ['Kịch bản', 'Edit'],
  createdDaysAgo: 17, due: due(-7), dueComplete: true, doneDaysAgo: 7,
  checklist: [['Kịch bản duyệt', 1], ['Edit final', 1], ['Đăng + SEO', 1]],
  moves: [['Ý tưởng', 'Kịch bản', 16], ['Kịch bản', 'Sản xuất', 13], ['Sản xuất', 'Duyệt', 9], ['Duyệt', 'Đã đăng', 7]],
  comments: [['sim.lan', 'View 48h: 310k, khá hơn trung bình 18%. Comment khen đoạn kết.', 6, 10]] });

simCard({ list: 'Đã đăng', title: 'Tập 23 — Lá thư chưa gửi', by: 'sim.an',
  members: ['sim.an', 'sim.binh', 'sim.chi'], labels: ['Kịch bản', 'Voice'],
  createdDaysAgo: 14, due: due(-3), dueComplete: true, doneDaysAgo: 3,
  checklist: [['Kịch bản duyệt', 1], ['Voice thu', 1], ['Edit final', 1]],
  moves: [['Ý tưởng', 'Kịch bản', 13], ['Kịch bản', 'Sản xuất', 10], ['Sản xuất', 'Duyệt', 5], ['Duyệt', 'Đã đăng', 3]],
  comments: [['sim.binh', 'Thu lại đoạn cuối theo tông trầm hơn, bản v2 trên Drive.', 6, 15]] });

simCard({ list: 'Đã đăng', title: 'Shorts — Cắt highlight Tập 21', by: 'sim.chi',
  members: ['sim.chi', 'sim.lan'], labels: ['Edit', 'SEO'],
  createdDaysAgo: 12, due: due(-5), dueComplete: true, doneDaysAgo: 5,
  checklist: [['Chọn 3 đoạn', 1], ['Dựng dọc 9:16', 1], ['Đăng', 1]],
  moves: [['Ý tưởng', 'Sản xuất', 11], ['Sản xuất', 'Đã đăng', 5]] });

// Duyệt (sắp đến hạn)
simCard({ list: 'Duyệt', title: 'Tập 24 — Món quà sinh nhật muộn', by: 'sim.minh',
  members: ['sim.chi', 'sim.minh'], labels: ['Edit'],
  createdDaysAgo: 10, due: due(1),
  desc: 'Chờ Minh duyệt bản dựng v2. Đã sửa nhịp đoạn giữa theo note hôm qua.',
  checklist: [['Kịch bản duyệt', 1], ['Voice thu', 1], ['Edit v1', 1], ['Edit v2 theo note', 1], ['Minh duyệt final', 0]],
  moves: [['Ý tưởng', 'Kịch bản', 9], ['Kịch bản', 'Sản xuất', 7], ['Sản xuất', 'Duyệt', 2]],
  comments: [
    ['sim.chi', 'V2 đã lên Drive, sửa cả màu ở cảnh bếp bị ám vàng.', 2, 18],
    ['sim.minh', 'Nhận, tối nay duyệt. Nếu ổn thì mai đăng khung 20h.', 1, 9],
  ],
  files: [['sim.chi', 'Bản dựng v2', 'https://drive.example/sim/tap-24-v2', 2]] });

simCard({ list: 'Duyệt', title: 'Thumbnail Tập 24 — chọn 1 trong 3', by: 'sim.dung',
  members: ['sim.dung', 'sim.minh'], labels: ['Thumbnail', 'Gấp'],
  createdDaysAgo: 4, due: due(0, 20),
  checklist: [['3 phương án', 1], ['Minh chọn', 0], ['Xuất 1280x720', 0]],
  comments: [['sim.dung', 'Phương án 2 chữ to hơn, phương án 3 theo style tập 21 (CTR tốt nhất tháng).', 1, 13]] });

// Sản xuất (đang làm, có 1 thẻ QUÁ HẠN)
simCard({ list: 'Sản xuất', title: 'Tập 25 — Chuyến xe về quê', by: 'sim.minh',
  members: ['sim.binh', 'sim.chi'], labels: ['Voice', 'Edit'],
  createdDaysAgo: 8, due: due(3),
  checklist: [['Voice thu', 1], ['Edit nháp', 0], ['Edit final', 0]],
  moves: [['Ý tưởng', 'Kịch bản', 7], ['Kịch bản', 'Sản xuất', 4]],
  comments: [['sim.binh', 'Voice xong sáng nay, chú ý đoạn 03:20 có 2 phương án đọc.', 1, 11]] });

simCard({ list: 'Sản xuất', title: 'Tập 26 — Người hàng xóm tốt bụng (TRỄ HẠN)', by: 'sim.minh',
  members: ['sim.chi'], labels: ['Edit', 'Gấp'],
  createdDaysAgo: 9, due: due(-2),
  desc: 'Trễ 2 ngày do Chi dồn lực cho Tập 24. Cần quyết: dời lịch đăng hay thêm người.',
  checklist: [['Edit nháp', 1], ['Edit final', 0]],
  moves: [['Kịch bản', 'Sản xuất', 6]],
  comments: [
    ['sim.minh', 'Thẻ này trễ hạn rồi, Chi cập nhật tiến độ giúp.', 1, 8],
    ['sim.chi', 'Xin dời sang thứ 5, Tập 24 ưu tiên hơn. Final chắc chắn kịp.', 0, 9],
  ] });

simCard({ list: 'Sản xuất', title: 'Intro 2.0 — làm mới 10 giây đầu kênh', by: 'sim.minh',
  members: ['sim.chi', 'sim.dung'], labels: ['Edit', 'Thumbnail'],
  createdDaysAgo: 15, due: due(7),
  desc: 'Việc nền, không gấp. Thử 2 phong cách: tối giản chữ, và montage nhanh.',
  checklist: [['Moodboard', 1], ['Bản nháp 1', 0], ['Bản nháp 2', 0]] });

// Kịch bản
simCard({ list: 'Kịch bản', title: 'Tập 27 — Đứa con nuôi', by: 'sim.an',
  members: ['sim.an'], labels: ['Kịch bản'],
  createdDaysAgo: 5, due: due(2),
  checklist: [['Outline', 1], ['Bản 1', 0], ['Minh duyệt', 0]],
  moves: [['Ý tưởng', 'Kịch bản', 3]],
  comments: [['sim.an', 'Outline xong, xung đột chính đặt ở phút 4 thay vì cuối như mọi khi — thử nghiệm.', 2, 16]] });

simCard({ list: 'Kịch bản', title: 'Tập 28 — Ông nội và chiếc radio', by: 'sim.an',
  members: ['sim.an', 'sim.minh'], labels: ['Kịch bản'],
  createdDaysAgo: 3, due: due(5),
  checklist: [['Outline', 0], ['Bản 1', 0]] });

simCard({ list: 'Kịch bản', title: 'Kịch bản Shorts tuần này (3 cái)', by: 'sim.lan',
  members: ['sim.an', 'sim.lan'], labels: ['Kịch bản', 'SEO'],
  createdDaysAgo: 2, due: due(2),
  checklist: [['Chọn 3 đoạn từ tập 22-23', 1], ['Viết hook 3 câu', 0]] });

// Ý tưởng
simCard({ list: 'Ý tưởng', title: 'Series mới: "Mẹ kế" — thăm dò', by: 'sim.minh',
  members: ['sim.minh', 'sim.an'], createdDaysAgo: 6,
  desc: 'Đối thủ X đang ăn khách format này. Cần phân tích 10 video top trước khi quyết.',
  comments: [['sim.an', 'Em xem 5 video rồi — điểm chung: mâu thuẫn mở màn trong 20 giây đầu.', 3, 20]] });
simCard({ list: 'Ý tưởng', title: 'Tập 29 — Người thầy năm xưa', by: 'sim.an', members: ['sim.an'], createdDaysAgo: 4 });
simCard({ list: 'Ý tưởng', title: 'Hợp tác kênh bạn — video chéo', by: 'sim.minh', members: ['sim.minh'], createdDaysAgo: 10,
  comments: [['sim.minh', 'Bên kia đồng ý về nguyên tắc, chờ chốt lịch quay.', 5, 10]] });
simCard({ list: 'Ý tưởng', title: 'Phân tích 10 video đối thủ tháng này', by: 'sim.lan', members: ['sim.lan'], createdDaysAgo: 7,
  labels: ['SEO'] });

const stats = {
  users: TEAM.length,
  cards: db.prepare('SELECT COUNT(*) c FROM cards WHERE list_id IN (SELECT id FROM lists WHERE board_id = ?)').get(boardId).c,
  comments: db.prepare(`SELECT COUNT(*) c FROM comments WHERE card_id IN
    (SELECT c.id FROM cards c JOIN lists l ON l.id = c.list_id WHERE l.board_id = ?)`).get(boardId).c,
  activity: db.prepare('SELECT COUNT(*) c FROM activity WHERE board_id = ?').get(boardId).c,
};
console.log(`Đã tạo board "${BOARD_TITLE}" (id ${boardId}): ${stats.users} thành viên SIM (khóa đăng nhập), ` +
  `${stats.cards} thẻ, ${stats.comments} bình luận, ${stats.activity} dòng nhật ký trải 3 tuần.`);
console.log('Gỡ toàn bộ: node scripts/remove-sim-team.mjs');
