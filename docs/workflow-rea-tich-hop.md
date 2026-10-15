# Tích hợp REA (Reverse Engineer Anything) vào workflow Trello nội bộ

*Cập nhật 10/2026 — đã chạy thật trong phiên cloud, số liệu bên dưới là kết quả thực.*

## Vai trò của REA trong workflow

Môi trường cloud của phiên làm việc **chặn trello.com** (chính sách mạng egress), nên không
quan sát Trello thật từ đây. REA được dùng theo hai vai:

1. **Máy đo & kiểm chứng cho chính app của chúng ta** (chạy được trong cloud — đã làm):
   REA attach vào Chrome headless qua CDP, thu Evidence khách quan về những gì giao diện
   thực sự làm — thay cho "nhìn bằng mắt thấy có vẻ đúng".
2. **Kính soi Trello thật trên máy cá nhân** (hướng dẫn cuối tài liệu): nơi mạng không bị chặn.

## Pipeline đã dựng (chạy lại được bằng `app/scripts/rea-verify.mjs`)

```
Chrome headless (CDP :9222)
   ├── Playwright  → đăng nhập, thực hiện kéo thẻ, DỪNG GIỮA CHỪNG
   └── REA         → thu Evidence từng pha:
        1. capture-web-screenshot  (idle)        → ev_9354c2…
        2. inspect-web-page        (DOM baseline) → ev_c8791b…
        3. inspect-web-event-listeners '.card'    → ev_78ce05…
        4. capture-web-screenshot  (giữa lúc kéo) → ev_85bda1…
        5. capture-web-screenshot  (sau khi thả)  → ev_0c7441…
        6. compare-web-screenshots (idle ↔ kéo)   → 90.574 pixel đổi (6,99%)
```

## Kết quả kiểm chứng nâng cấp kéo-thả kiểu Trello (15/10/2026)

| Hạng mục | Thiết kế | REA/CDP đo được |
|---|---|---|
| Thẻ ma nghiêng khi nhấc | 4° | `matrix(0.997564, 0.0697565, …)` = đúng 4° |
| Đổ bóng khi kéo | 0 12px 24px | `rgba(9,30,66,0.45) 0px 12px 24px` ✓ |
| Lớp hiển thị | trên cùng | `z-index: 1000` ✓ |
| Placeholder | cao bằng thẻ, nằm ở cột đích | `height 73.69px`, `inList: "2"` ✓ |
| Trạng thái kéo toàn cục | body.is-dragging | `true` ✓ |
| Dữ liệu sau thả | thẻ sang cột 2 | `{"list_id":2,"position":2048}` ✓ |
| Animation đổi pixel thật | có | 90.574/1.296.000 pixel thay đổi, delta tối đa 232 |

## Nâng cấp giao diện đi kèm đợt này (app/public/index.html)

- Bỏ HTML5 drag-and-drop, thay bằng **pointer-based drag** như Trello thật:
  ngưỡng 5px phân biệt click/kéo, thẻ ma bám con trỏ nghiêng 4°, placeholder giữ chỗ,
  các thẻ khác **trượt chỗ bằng FLIP animation** (150ms ease), thả thì thẻ ma
  "bay" về vị trí placeholder (180ms cubic-bezier(.2,0,0,1)) rồi mới hạ xuống.
- Tự cuộn board khi kéo sát mép (ngang) và cuộn cột (dọc).
- Realtime an toàn khi kéo: cập nhật từ người khác được hoãn đến khi thả tay.
- Modal chi tiết thẻ có animation mở (scale + fade 180ms).
- Hỗ trợ cảm ứng (pointer events + touch-action).

## Chạy lại kiểm chứng (CI thủ công)

```bash
cd app && npm i -D playwright-core && npm i -g rea-agents
# Terminal 1: chrome headless
chromium --headless=new --remote-debugging-port=9222 --no-sandbox &
# Terminal 2: app với dữ liệu mẫu
node src/server.js
# Terminal 3:
node scripts/rea-verify.mjs   # in các evidence id + ảnh vào ./rea-out
```

## Soi Trello thật trên máy cá nhân (khi cần đối chiếu)

```bash
npm i -g rea-agents
# Mở Chrome có cổng CDP, đăng nhập Trello, mở board:
chrome --remote-debugging-port=9222
rea list-browser-targets http://127.0.0.1:9222
rea inspect-web-page http://127.0.0.1:9222 <TARGET_ID> --allowed-origins https://trello.com
rea inspect-web-event-listeners http://127.0.0.1:9222 <TARGET_ID> '[data-testid="trello-card"]' --allowed-origins https://trello.com
rea capture-web-screenshot ...   # chụp từng pha thao tác như pipeline trên
```

Giới hạn cần nhớ: REA cho *bằng chứng về hành vi* (class, transform, listener, pixel) —
không sinh code; phần tái tạo vẫn do Claude/đội dev viết bằng code riêng của dự án.
