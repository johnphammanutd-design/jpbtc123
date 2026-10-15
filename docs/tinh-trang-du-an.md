# Tình trạng dự án — Bảng công việc công ty (Trello nội bộ)

*Cập nhật: 15/10/2026. File này để bất kỳ phiên Claude nào (local/VPS) hoặc thành viên đội
mở ra là nắm được toàn bộ, không cần đọc lại lịch sử chat.*

## Dự án là gì

Hệ thống quản lý mục tiêu/task tự host kiểu Trello cho công ty ~15–20 người
(công ty vận hành kênh YouTube Dad Revenge). Toàn bộ code nằm trong repo này,
nhánh làm việc: **`claude/trello-like-task-system-xuc1bz`**.

## Đã hoàn thành (tất cả đã test + push)

### Ứng dụng `app/` — clone bộ tính năng Trello, bản v3
- **Stack**: Node.js + Express + SQLite (1 file, WAL) + WebSocket; frontend 1 file
  HTML thuần không cần build (`app/public/index.html`); Docker + docker-compose.
- **Tài khoản**: đăng nhập theo phiên, admin tạo/khóa người dùng, đổi/đặt lại mật khẩu.
- **Board**: nhiều board, phông nền 8 màu, gắn sao, đóng/mở lại, menu board.
- **Thẻ**: kéo-thả chuẩn Trello (pointer-based, thẻ nghiêng 4°, placeholder,
  FLIP animation, thả bay về chỗ — đã kiểm chứng bằng REA từng con số),
  ảnh bìa, nhãn có tên theo board, nhiều thành viên/thẻ (avatar), hạn chót +
  đánh dấu hoàn thành, checklist, đính kèm link, bình luận, sao chép,
  lưu trữ/khôi phục (không xóa thẳng).
- **Chế độ xem Lịch** theo hạn chót; **bộ lọc** (từ khóa/người/nhãn/hạn);
  **tìm kiếm toàn cục** nhảy thẳng tới thẻ.
- **Automation kiểu Butler**: rule "thẻ vào cột X → hoàn thành hạn / tick checklist /
  gắn nhãn / gán người", chạy server-side.
- **Nhật ký hoạt động**: 16 loại sự kiện, theo board và theo thẻ.
- **Realtime**: WebSocket đẩy thay đổi tới mọi người đang mở board; không phá thao tác kéo.
- **Bảo mật**: sai mật khẩu 5 lần → khóa 15 phút; phiên hết hạn 30 ngày;
  security headers (CSP…); cổng 3000 chỉ bind loopback.

### Công cụ kèm theo
- `app/scripts/seed-youtube-board.mjs` — dựng board mẫu "Sản xuất video"
  (Ý tưởng → Kịch bản → Sản xuất → Duyệt → Đã đăng, 6 nhãn, 1 rule, 4 thẻ [MẪU]).
- `app/scripts/rea-verify.mjs` — kiểm chứng kéo-thả bằng REA + Playwright (regression).
- `deploy/auto-deploy.sh` — triển khai VPS một lệnh (xem bên dưới).

### Tài liệu `docs/`
| File | Nội dung |
|---|---|
| `nghien-cuu-trello-va-cac-lua-chon-ma-nguon-mo.md` | Nghiên cứu Trello + Planka/WeKan/Kanboard…, kế hoạch 4 tuần |
| `nghien-cuu-repo-clone-giao-dien-tinh-nang.md` | screenshot-to-code, open-lovable, codebase MIT đáng mượn |
| `danh-gia-repo-rea-reverse-engineer-anything.md` | Đánh giá REA (morluto/rea) |
| `workflow-rea-tich-hop.md` | Pipeline REA đã chạy thật + số liệu kiểm chứng drag |
| `trien-khai-task-kairetic.md` | Triển khai VPS từng lệnh (DNS, Docker, HTTPS 2 nhánh, backup) |
| `huong-dan-su-dung-cho-doi.md` | Hướng dẫn 3 phút cho nhân viên |
| `tinh-trang-du-an.md` | File này |

## Trạng thái triển khai — ĐÃ LÊN MẠNG 16/10/2026

- **https://task.kairetic.com đang chạy** trên VPS **149.28.132.148** (Nginx +
  certbot, chứng chỉ hết hạn 13/01/2027, tự gia hạn). App trong Docker,
  container `app-kanban-1`, cổng 3000 chỉ loopback. Code VPS tại `/root/jpbtc123`.
- Phiên Claude local (PC Render 02, khóa `~/.ssh/vultr`) đã deploy bằng
  `deploy/deploy-from-pc.sh` (gọi `auto-deploy.sh` trên VPS, idempotent).
- Mật khẩu admin sinh ngẫu nhiên lần đầu, lưu tại **`/root/task-admin-login.txt`**
  trên VPS (không nằm trong chat/repo). Xem bằng:
  `ssh -i ~/.ssh/vultr root@149.28.132.148 "cat /root/task-admin-login.txt"`
- Board mẫu "Sản xuất video" đã seed (5 cột, 6 nhãn, 1 rule, 4 thẻ [MẪU]).
- Cron backup 2h sáng đã đặt + đã chạy thử OK. **Lưu ý WAL**: backup phải qua
  `scripts/backup-db.mjs` (better-sqlite3 `.backup()`), copy file `.db` trần
  sẽ thiếu dữ liệu trong `-wal` — cron hiện tại đã đúng. Backup chỉ nằm trên
  chính VPS, chưa có bản ngoài máy (rủi ro đã biết toàn VPS).
- Hai sửa lỗi deploy đã push: Dockerfile copy `scripts/` vào image;
  cron trong `auto-deploy.sh` không chết vì `pipefail` khi crontab rỗng.

## Việc còn lại sau khi deploy (theo thứ tự)

1. ~~Đăng nhập admin → đổi mật khẩu → tạo tài khoản cho 15–20 thành viên.~~
   **Xong 16/10/2026** (user tự làm; file `/root/task-admin-login.txt` trên VPS
   giờ chứa mật khẩu cũ, không còn giá trị).
2. Gửi đội `docs/huong-dan-su-dung-cho-doi.md` + link https://task.kairetic.com.
3. **Pilot 2 tuần** với 1 nhóm, đo 3 số: % task nằm trên board; % thẻ có người
   phụ trách + hạn; số task trễ hạn (dùng Nhật ký hoạt động + bộ lọc có sẵn).
4. Sau pilot mới quyết tính năng đợt 2 theo nhu cầu thật. Ứng viên:
   thông báo khi được gán việc (đẩy/email), upload file trực tiếp (hiện dùng link),
   chế độ xem Timeline/Table, kéo-thả sắp xếp cột, board riêng tư theo nhóm.
   User cũng dự định gửi video/ảnh giao diện mẫu để tinh chỉnh animation thêm.

## Ghi chú cho phiên Claude kế tiếp

- Chạy local: `cd app && npm install && npm start` → localhost:3000 (admin/admin123
  với DB mới). Test UI: cần Chromium headless + `app/scripts/rea-verify.mjs`.
- Mọi thay đổi: commit + push lên đúng nhánh `claude/trello-like-task-system-xuc1bz`.
- Dữ liệu production nằm trong Docker volume `kanban-data` trên VPS — backup cron
  2h sáng đã nằm trong auto-deploy.sh. Migration trong `app/src/db.js` tự chạy
  khi nâng version, an toàn với dữ liệu cũ.
- Định hướng chung từ user: làm chính xác, dựa dữ liệu, không xây thừa —
  tính năng mới phải xuất phát từ nhu cầu thật của đội sau khi dùng.
