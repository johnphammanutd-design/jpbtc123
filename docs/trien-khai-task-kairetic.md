# Triển khai Bảng công việc lên VPS — task.kairetic.com

*Hướng dẫn từng lệnh, cho VPS đang chạy sẵn kairetic.com. Thời gian: ~30–45 phút.*

## Bước 0 — Trỏ DNS (làm trước, DNS cần thời gian lan truyền)

Vào trang quản lý DNS của kairetic.com, thêm bản ghi:

| Loại | Tên | Giá trị |
|---|---|---|
| A | `task` | IP của VPS |

Kiểm tra (chạy ở máy bất kỳ): `nslookup task.kairetic.com` phải trả về IP VPS.

## Bước 1 — SSH vào VPS, kiểm tra môi trường

```bash
ssh user@IP_VPS

# Docker đã có chưa?
docker --version || curl -fsSL https://get.docker.com | sh

# Cổng 80/443 đang do gì chiếm? (quyết định bước 4 đi nhánh nào)
sudo ss -tlnp | grep -E ':80 |:443 '
```

## Bước 2 — Lấy code và đặt mật khẩu admin

```bash
git clone https://github.com/johnphammanutd-design/jpbtc123.git
cd jpbtc123/app

# BẮT BUỘC: sửa 2 dòng ADMIN_USERNAME / ADMIN_PASSWORD trong docker-compose.yml
nano docker-compose.yml
```

> Mật khẩu này chỉ dùng cho lần khởi tạo đầu tiên. Sau khi đăng nhập vẫn nên
> bấm "Đổi mật khẩu" lần nữa để mật khẩu không nằm trong file cấu hình.

## Bước 3 — Chạy app

```bash
docker compose up -d --build
# Kiểm tra: phải thấy JSON lỗi "Chưa đăng nhập..." (tức app sống):
curl -s localhost:3000/api/boards
```

## Bước 4 — Mở HTTPS qua tên miền (chọn MỘT nhánh)

### Nhánh A — Cổng 80/443 còn trống → dùng Caddy (đơn giản nhất)

```bash
sudo apt install -y caddy          # Debian/Ubuntu
sudo cp ../deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy tự xin chứng chỉ HTTPS. Xong — mở https://task.kairetic.com

### Nhánh B — VPS đã chạy Nginx cho kairetic.com

```bash
sudo cp ../deploy/nginx-task.kairetic.com.conf /etc/nginx/sites-available/task.kairetic.com
sudo ln -s /etc/nginx/sites-available/task.kairetic.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# HTTPS bằng certbot (nếu chưa có):
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d task.kairetic.com
```

## Bước 5 — Khởi tạo dữ liệu cho đội

```bash
# Dựng sẵn board "Sản xuất video" (5 cột quy trình, nhãn chuẩn, automation, thẻ mẫu):
docker compose exec kanban node scripts/seed-youtube-board.mjs
```

Rồi mở https://task.kairetic.com, đăng nhập admin:
1. **Đổi mật khẩu** (nút trên thanh đầu trang).
2. **Người dùng** → tạo tài khoản cho từng thành viên (15–20 người, mật khẩu ≥ 6 ký tự).
3. Gửi cho đội link + tài khoản + trang `docs/huong-dan-su-dung-cho-doi.md`.

## Bước 6 — Sao lưu tự động hằng đêm

```bash
crontab -e
# Thêm dòng (2h sáng mỗi ngày, giữ 14 bản gần nhất):
0 2 * * * cd ~/jpbtc123/app && docker compose cp kanban:/data/kanban.db ~/backup-kanban-$(date +\%F).db && ls -t ~/backup-kanban-*.db | tail -n +15 | xargs -r rm
```

## Bảo mật đã bật sẵn trong app (không cần cấu hình thêm)

- Sai mật khẩu 5 lần → khóa IP + tài khoản đó 15 phút (chống dò mật khẩu)
- Phiên đăng nhập tự hết hạn sau 30 ngày (đổi bằng biến môi trường `SESSION_TTL_DAYS`)
- Security headers: CSP, X-Frame-Options, nosniff… (app tự gửi)
- Khóa tài khoản → hủy ngay mọi phiên đang đăng nhập của người đó

## Khi có bản cập nhật mới

```bash
cd ~/jpbtc123 && git pull
cd app && docker compose up -d --build   # dữ liệu nằm trong volume, không mất
```

## Sự cố thường gặp

| Hiện tượng | Nguyên nhân & cách xử lý |
|---|---|
| Mở domain ra trang kairetic.com cũ | DNS chưa lan truyền hoặc thiếu server_name — chờ DNS/kiểm tra bước 4 |
| Realtime không chạy (phải F5 mới thấy) | Proxy chưa cho WebSocket — nhánh B: kiểm tra 2 dòng Upgrade/Connection |
| "Sai quá 5 lần..." | Tính năng chống dò mật khẩu — chờ 15 phút |
| Hết dung lượng đĩa | Xem bản sao lưu cũ `~/backup-kanban-*` và `docker system prune` |
