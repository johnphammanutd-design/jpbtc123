# Bảng công việc công ty (Kanban kiểu Trello)

Hệ thống quản lý mục tiêu/task tự host cho đội ngũ 15–20 người: nhiều board dùng chung,
kéo-thả thẻ giữa các cột, gán người phụ trách, hạn chót, nhãn màu, checklist, bình luận,
và cập nhật **realtime** — người này kéo thẻ, màn hình người kia tự đổi theo.

- Backend: Node.js + Express + SQLite (file duy nhất, tự sao lưu dễ dàng) + WebSocket
- Frontend: 1 trang HTML thuần, không cần build
- Đăng nhập bằng tài khoản do quản trị viên cấp (không có đăng ký mở)

## Chạy thử trên máy cá nhân

```bash
cd app
npm install
npm start
# Mở http://localhost:3000 — đăng nhập admin / admin123
```

## Triển khai lên VPS công ty (Docker)

```bash
cd app
# 1. Sửa ADMIN_USERNAME / ADMIN_PASSWORD trong docker-compose.yml
# 2. Dựng và chạy
docker compose up -d --build
```

Ứng dụng chạy ở cổng 3000. Để dùng qua tên miền + HTTPS, đặt một reverse proxy
(Caddy khuyến nghị vì tự lo chứng chỉ SSL):

```
# Caddyfile
task.congty.vn {
    reverse_proxy localhost:3000
}
```

> WebSocket đi cùng đường `/ws` — Caddy và Nginx (có `proxy_set_header Upgrade/Connection`)
> đều hỗ trợ, không cần cấu hình thêm với Caddy.

## Sau khi cài xong — checklist cho quản trị viên

1. Đăng nhập tài khoản admin → **Đổi mật khẩu** ngay.
2. Vào **Người dùng** → tạo tài khoản cho từng thành viên (mật khẩu ≥ 6 ký tự).
3. Tạo board đầu tiên — board mới có sẵn 4 cột: Cần làm → Đang làm → Chờ duyệt → Hoàn thành
   (đổi tên cột tùy quy trình).
4. Quy ước với đội: mỗi thẻ phải có **người phụ trách + hạn chót**; nhãn màu thống nhất
   (ví dụ: xanh lá = kịch bản, cam = thumbnail, đỏ = gấp).

## Sao lưu dữ liệu

Toàn bộ dữ liệu nằm trong 1 file SQLite tại volume `kanban-data` (`/data/kanban.db`).
Sao lưu định kỳ:

```bash
docker compose exec kanban sh -c "sqlite3 /data/kanban.db '.backup /data/backup.db'" 2>/dev/null \
  || docker compose cp kanban:/data/kanban.db ./backup-$(date +%F).db
```

(Cách đơn giản nhất: `docker compose cp` file ra ngoài mỗi đêm bằng cron.)

## Phân quyền hiện tại (giữ đơn giản có chủ đích)

- **Quản trị viên**: tạo/khóa tài khoản, đặt lại mật khẩu.
- **Mọi thành viên**: xem và chỉnh sửa mọi board (mô hình "cả công ty cùng nhìn một bảng").
- Chưa có: board riêng tư theo nhóm, phân quyền chỉ-đọc. Thêm sau nếu thực tế cần.

## Giới hạn đã biết

- Chưa có đính kèm tệp (dán link Google Drive vào mô tả/bình luận thay thế).
- Chưa có thông báo đẩy/email khi được gán việc.
- Phiên đăng nhập không tự hết hạn (đăng xuất sẽ hủy phiên; khóa tài khoản hủy mọi phiên).
