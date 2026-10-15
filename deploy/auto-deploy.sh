#!/usr/bin/env bash
# Tự động triển khai "Bảng công việc" lên VPS (Ubuntu/Debian) tại task.kairetic.com
# Chạy trong phiên SSH trên VPS:
#   curl -fsSL https://raw.githubusercontent.com/johnphammanutd-design/jpbtc123/claude/trello-like-task-system-xuc1bz/deploy/auto-deploy.sh -o auto-deploy.sh
#   bash auto-deploy.sh
# Script an toàn chạy lại nhiều lần (idempotent). Chi tiết thủ công: docs/trien-khai-task-kairetic.md
set -euo pipefail

DOMAIN="task.kairetic.com"
REPO="https://github.com/johnphammanutd-design/jpbtc123.git"
BRANCH="claude/trello-like-task-system-xuc1bz"
APP_DIR="$HOME/jpbtc123"
SUDO="sudo"; [ "$(id -u)" = 0 ] && SUDO=""

step() { printf '\n\033[1;34m== %s ==\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*"; }

step "[1/7] Kiểm tra DNS của $DOMAIN"
IP_VPS=$(curl -fsS -4 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
IP_DNS=$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)
echo "IP VPS: $IP_VPS — DNS trỏ về: ${IP_DNS:-chưa phân giải được}"
if [ "$IP_DNS" != "$IP_VPS" ]; then
  warn "DNS chưa trỏ đúng về VPS này (có thể chưa lan truyền). HTTPS có thể xin chứng chỉ thất bại — chạy lại script sau khi DNS đúng."
fi

step "[2/7] Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | $SUDO sh
fi
docker compose version >/dev/null 2>&1 || { warn "Thiếu docker compose plugin"; exit 1; }

step "[3/7] Lấy code (nhánh $BRANCH)"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$BRANCH" && git -C "$APP_DIR" checkout "$BRANCH" && git -C "$APP_DIR" pull origin "$BRANCH"
else
  git clone -b "$BRANCH" "$REPO" "$APP_DIR"
fi

step "[4/7] Mật khẩu quản trị"
ENV_FILE="$APP_DIR/app/.env"
if [ -f "$ENV_FILE" ]; then
  echo "Đã có $ENV_FILE — giữ nguyên mật khẩu cũ."
else
  while true; do
    read -rsp "Đặt mật khẩu cho tài khoản admin (>=8 ký tự, không hiện khi gõ): " ADMIN_PW < /dev/tty; echo
    [ "${#ADMIN_PW}" -ge 8 ] && break
    warn "Mật khẩu quá ngắn, nhập lại."
  done
  printf 'ADMIN_USERNAME=admin\nADMIN_PASSWORD=%s\n' "$ADMIN_PW" > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "Đã ghi $ENV_FILE (chmod 600)."
fi

step "[5/7] Chạy app (cổng 3000, chỉ loopback)"
cd "$APP_DIR/app"
$SUDO docker compose up -d --build
for i in $(seq 1 20); do
  curl -fsS localhost:3000/api/boards >/dev/null 2>&1 && break || true
  code=$(curl -s -o /dev/null -w '%{http_code}' localhost:3000/api/boards || true)
  [ "$code" = "401" ] && break
  sleep 2
done
code=$(curl -s -o /dev/null -w '%{http_code}' localhost:3000/api/boards || true)
if [ "$code" = "401" ]; then echo "App chạy OK (trả 401 khi chưa đăng nhập — đúng)."; else
  warn "App chưa phản hồi đúng (mã $code). Xem log: docker compose logs kanban"; exit 1
fi

step "[6/7] Reverse proxy + HTTPS cho $DOMAIN"
if $SUDO ss -tln | grep -qE '[:.]80\s'; then
  if command -v nginx >/dev/null 2>&1; then
    echo "Phát hiện Nginx đang chạy — thêm site $DOMAIN (không đụng site hiện có)."
    $SUDO cp "$APP_DIR/deploy/nginx-task.kairetic.com.conf" "/etc/nginx/sites-available/$DOMAIN"
    $SUDO ln -sf "/etc/nginx/sites-available/$DOMAIN" "/etc/nginx/sites-enabled/$DOMAIN"
    $SUDO nginx -t && $SUDO systemctl reload nginx
    if ! command -v certbot >/dev/null 2>&1; then
      $SUDO apt-get update -qq && $SUDO apt-get install -y -qq certbot python3-certbot-nginx
    fi
    $SUDO certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect \
      || warn "certbot thất bại (thường do DNS chưa lan truyền). Chạy lại sau: sudo certbot --nginx -d $DOMAIN"
  else
    warn "Cổng 80 đang bị chiếm bởi dịch vụ KHÔNG phải nginx (Apache/panel?)."
    warn "Tự thêm reverse proxy tới 127.0.0.1:3000 theo docs/trien-khai-task-kairetic.md rồi bỏ qua bước này."
  fi
else
  echo "Cổng 80 trống — dùng Caddy (tự lo HTTPS)."
  if ! command -v caddy >/dev/null 2>&1; then
    $SUDO apt-get update -qq
    $SUDO apt-get install -y -qq caddy || {
      $SUDO apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl
      curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | $SUDO gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
      curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | $SUDO tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
      $SUDO apt-get update -qq && $SUDO apt-get install -y -qq caddy
    }
  fi
  $SUDO cp "$APP_DIR/deploy/Caddyfile" /etc/caddy/Caddyfile
  $SUDO systemctl enable --now caddy
  $SUDO systemctl reload caddy || $SUDO systemctl restart caddy
fi

step "[7/7] Board mẫu + sao lưu hằng đêm"
$SUDO docker compose exec -T kanban node scripts/seed-youtube-board.mjs || warn "Seed board mẫu lỗi — chạy tay sau."
CRON_LINE="0 2 * * * cd $APP_DIR/app && docker compose cp kanban:/data/kanban.db \$HOME/backup-kanban-\$(date +\%F).db && ls -t \$HOME/backup-kanban-*.db | tail -n +15 | xargs -r rm"
( crontab -l 2>/dev/null | grep -v 'backup-kanban' || true ; echo "$CRON_LINE" ) | crontab -
echo "Đã đặt cron sao lưu 2h sáng, giữ 14 bản."

printf '\n\033[1;32m✔ XONG!\033[0m Mở https://%s — đăng nhập admin + mật khẩu vừa đặt.\n' "$DOMAIN"
echo "Việc còn lại trong giao diện: (1) Người dùng → tạo tài khoản cho đội; (2) gửi đội docs/huong-dan-su-dung-cho-doi.md"
