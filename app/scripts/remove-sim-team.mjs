// Gỡ sạch dữ liệu giả lập do seed-sim-team.mjs tạo:
// xóa board "[SIM] Sản xuất video" (cascade cột/thẻ/bình luận/nhật ký/nhãn/rule)
// và các user "sim.*" đang bị khóa. Không đụng bất cứ dữ liệu nào khác.
// Dùng:  node scripts/remove-sim-team.mjs
import { db } from '../src/db.js';

const board = db.prepare("SELECT id FROM boards WHERE title = '[SIM] Sản xuất video'").get();
if (board) {
  db.prepare('DELETE FROM boards WHERE id = ?').run(board.id);
  console.log(`Đã xóa board [SIM] (id ${board.id}) cùng toàn bộ cột/thẻ/bình luận/nhật ký.`);
} else {
  console.log('Không thấy board [SIM] — bỏ qua.');
}

const users = db.prepare("SELECT id, username FROM users WHERE username LIKE 'sim.%' AND disabled = 1").all();
for (const u of users) db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
console.log(`Đã xóa ${users.length} user SIM (${users.map(u => u.username).join(', ') || 'không có'}).`);
