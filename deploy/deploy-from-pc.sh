#!/usr/bin/env bash
# Chạy từ PC (Git Bash): SSH vào VPS 149.28.132.148 và triển khai task.kairetic.com
# - Tự tạo mật khẩu admin ngẫu nhiên lần đầu (lưu tại /root/task-admin-login.txt trên VPS)
# - Idempotent: chạy lại nhiều lần an toàn
set -euo pipefail

ssh -i ~/.ssh/vultr root@149.28.132.148 'bash -s' <<'EOF'
set -e
export DEBIAN_FRONTEND=noninteractive
if [ ! -d /root/jpbtc123/.git ]; then
  git clone -b claude/trello-like-task-system-xuc1bz https://github.com/johnphammanutd-design/jpbtc123.git /root/jpbtc123
fi
if [ ! -f /root/jpbtc123/app/.env ]; then
  PW=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 16)
  printf 'ADMIN_USERNAME=admin\nADMIN_PASSWORD=%s\n' "$PW" > /root/jpbtc123/app/.env
  chmod 600 /root/jpbtc123/app/.env
  cp /root/jpbtc123/app/.env /root/task-admin-login.txt
  chmod 600 /root/task-admin-login.txt
  echo ">> Đã tạo mật khẩu admin mới — xem tại /root/task-admin-login.txt"
fi
bash /root/jpbtc123/deploy/auto-deploy.sh
EOF
