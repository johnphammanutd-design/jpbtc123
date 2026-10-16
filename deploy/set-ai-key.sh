#!/usr/bin/env bash
# Bật trợ lý AI cho task.kairetic.com: hỏi ANTHROPIC_API_KEY ngay trong terminal
# (không hiện khi gõ, không đi qua chat/lịch sử), ghi vào .env trên VPS MỚI
# (139.180.145.29, đi 2 chặng SSH qua VPS cũ) rồi khởi động lại app.
# Chạy từ PC Render 02:
#   & "C:\Program Files\Git\bin\bash.exe" "C:\Users\Render 02\Desktop\Code\jpbtc123\deploy\set-ai-key.sh"
set -euo pipefail

read -rsp "Dán ANTHROPIC_API_KEY (sk-ant-…, không hiện khi gõ): " KEY < /dev/tty; echo
case "$KEY" in
  sk-ant-*) ;;
  *) echo "⚠ Key không đúng định dạng sk-ant-… — hủy, chưa thay đổi gì."; exit 1 ;;
esac

echo "Đang ghi key vào VPS mới và khởi động lại app…"
ssh -i ~/.ssh/vultr -o BatchMode=yes root@149.28.132.148 \
  "ssh -i /root/.ssh/migrate_tmp -o BatchMode=yes root@139.180.145.29 '
    set -e
    cd /root/jpbtc123/app
    grep -v \"^ANTHROPIC_API_KEY=\" .env > /tmp/env.new || true
    echo \"ANTHROPIC_API_KEY=$KEY\" >> /tmp/env.new
    mv /tmp/env.new .env && chmod 600 .env
    docker compose up -d 2>&1 | tail -1
    sleep 3
    echo \"const on=!!process.env.ANTHROPIC_API_KEY;console.log(on?\\\"AI: BẬT ✔\\\":\\\"AI: vẫn tắt ✗\\\")\" | docker compose exec -T kanban node
  '"
echo "Xong. Mở một thẻ bất kỳ trên https://task.kairetic.com — nếu board đã bật Tiện ích AI sẽ thấy hàng nút ✨."
