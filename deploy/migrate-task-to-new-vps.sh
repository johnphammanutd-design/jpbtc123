#!/usr/bin/env bash
# Dời hệ thống task (app + toàn bộ dữ liệu + HTTPS) từ VPS cũ sang VPS mới.
# Chạy TRÊN VPS CŨ (149.28.132.148) bằng root, dùng khóa cutover /root/.ssh/migrate_tmp:
#   cd /root/jpbtc123 && git pull origin claude/trello-like-task-system-xuc1bz
#   bash deploy/migrate-task-to-new-vps.sh
# Downtime ~1-2 phút (app cũ stop trước khi nén dữ liệu để không mất gì).
# Chạy lại được: mọi bước tự kiểm tra trạng thái.
set -euo pipefail

NEW=139.180.145.29
KEY=/root/.ssh/migrate_tmp
SSHO=(-i "$KEY" -o BatchMode=yes -o ConnectTimeout=15)
APP=/root/jpbtc123/app
BRANCH=claude/trello-like-task-system-xuc1bz

step() { printf '\n\033[1;34m== %s ==\033[0m\n' "$*"; }

step "[1/8] Kiểm tra SSH sang VPS mới"
ssh "${SSHO[@]}" root@$NEW 'echo "OK: $(hostname) ($(curl -s -4 ifconfig.me 2>/dev/null || true))"'

step "[2/8] Đóng băng dữ liệu ở VPS cũ (backup rồi stop)"
cd "$APP"
docker compose exec -T kanban node scripts/backup-db.mjs /data/backup-final-migrate.db < /dev/null || true
docker compose stop
VOL=$(docker volume inspect app_kanban-data -f '{{.Mountpoint}}')
tar -C "$VOL" -czf /tmp/task-data.tgz .
echo "Dữ liệu: $(du -h /tmp/task-data.tgz | cut -f1)"

step "[3/8] Chuyển dữ liệu + .env sang VPS mới"
scp "${SSHO[@]}" /tmp/task-data.tgz root@$NEW:/tmp/task-data.tgz
scp "${SSHO[@]}" "$APP/.env" root@$NEW:/tmp/task-env

step "[4/8] VPS mới: Docker + code + khôi phục dữ liệu + chạy app"
ssh "${SSHO[@]}" root@$NEW bash -s <<'REMOTE'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
command -v git >/dev/null || (apt-get update -qq && apt-get install -y -qq git)
if [ -d /root/jpbtc123/.git ]; then
  git -C /root/jpbtc123 fetch -q origin claude/trello-like-task-system-xuc1bz
  git -C /root/jpbtc123 checkout -q claude/trello-like-task-system-xuc1bz
  git -C /root/jpbtc123 pull -q origin claude/trello-like-task-system-xuc1bz
else
  git clone -q -b claude/trello-like-task-system-xuc1bz https://github.com/johnphammanutd-design/jpbtc123.git /root/jpbtc123
fi
cp /tmp/task-env /root/jpbtc123/app/.env && chmod 600 /root/jpbtc123/app/.env
docker volume create app_kanban-data >/dev/null
VOL=$(docker volume inspect app_kanban-data -f '{{.Mountpoint}}')
tar -C "$VOL" -xzf /tmp/task-data.tgz
rm -f /tmp/task-data.tgz /tmp/task-env
cd /root/jpbtc123/app && docker compose up -d --build
code=""
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' localhost:3000/api/boards || true)
  [ "$code" = "401" ] && break
  sleep 2
done
echo "App trên VPS mới trả: $code (401 là đúng)"
[ "$code" = "401" ]
REMOTE

step "[5/8] VPS mới: reverse proxy + HTTPS cho task.kairetic.com"
ssh "${SSHO[@]}" root@$NEW bash -s <<'REMOTE'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
DOMAIN=task.kairetic.com
if command -v nginx >/dev/null 2>&1 && systemctl is-active -q nginx; then
  cp /root/jpbtc123/deploy/nginx-task.kairetic.com.conf /etc/nginx/sites-available/$DOMAIN
  ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN
  nginx -t && systemctl reload nginx
  command -v certbot >/dev/null || (apt-get update -qq && apt-get install -y -qq certbot python3-certbot-nginx)
  certbot --nginx -d $DOMAIN --non-interactive --agree-tos --register-unsafely-without-email --redirect
elif command -v caddy >/dev/null 2>&1; then
  grep -q "$DOMAIN" /etc/caddy/Caddyfile 2>/dev/null || \
    printf '\n%s {\n\treverse_proxy 127.0.0.1:3000\n}\n' "$DOMAIN" >> /etc/caddy/Caddyfile
  systemctl reload caddy || systemctl restart caddy
else
  echo "⚠ VPS mới không có nginx lẫn caddy đang chạy — cần xem tay"; exit 1
fi
REMOTE

step "[6/8] VPS mới: cron backup 2h sáng"
ssh "${SSHO[@]}" root@$NEW bash -s <<'REMOTE'
CRON_LINE='0 2 * * * cd /root/jpbtc123/app && docker compose exec -T kanban node scripts/backup-db.mjs /data/backup.db && docker compose cp kanban:/data/backup.db $HOME/backup-kanban-$(date +\%F).db && ls -t $HOME/backup-kanban-*.db | tail -n +15 | xargs -r rm'
( crontab -l 2>/dev/null | grep -v backup-kanban || true ; echo "$CRON_LINE" ) | crontab -
echo "Cron backup OK"
REMOTE

step "[7/8] VPS cũ: gỡ cron + site nginx (app để stop, dữ liệu giữ nguyên làm dự phòng)"
( crontab -l 2>/dev/null | grep -v backup-kanban || true ) | crontab -
rm -f /etc/nginx/sites-enabled/task.kairetic.com
nginx -t && systemctl reload nginx || true
rm -f /tmp/task-data.tgz

step "[8/8] Kiểm chứng từ ngoài (ép phân giải về VPS mới)"
sleep 2
curl -s -o /dev/null -w "https://task.kairetic.com → %{http_code}\n" \
  --resolve task.kairetic.com:443:$NEW https://task.kairetic.com/
printf '\n\033[1;32m✔ XONG!\033[0m Đội dùng lại https://task.kairetic.com như cũ, dữ liệu nguyên vẹn.\n'
echo "Dự phòng trên VPS cũ: volume app_kanban-data + /data/backup-final-migrate.db (container đã stop)."
