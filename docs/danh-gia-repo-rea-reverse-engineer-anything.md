# Đánh giá morluto/rea (REA — "Reverse Engineer Anything") cho dự án Trello nội bộ

*Cập nhật 10/2026. Đã clone và đọc trực tiếp mã nguồn + tài liệu (v6.5.0, giấy phép MIT).*

## REA là gì

MCP server + CLI cho phép agent AI (Claude Code, Cursor…) **phân tích phần mềm không có mã nguồn**:
binary native (qua Hopper/Ghidra/IDA), app Electron, .NET, Android, Flutter, firmware, và
**website đang chạy** (qua Chrome DevTools Protocol). Khẩu hiệu của nó khớp đúng mong muốn của
dự án: *"Thấy một tính năng bạn thích → hiểu nó hoạt động thế nào → dựng phiên bản cho dự án của bạn."*

## Phần liên quan trực tiếp đến chúng ta: nhóm công cụ quan sát web

| Công cụ REA | Giúp gì cho Trello nội bộ |
|---|---|
| `inspect_web_page` | Chụp cấu trúc DOM, accessibility tree, script, WebSocket của trang thật (ví dụ board Trello đang mở) |
| `observe_web_session` | Mở "cửa sổ quan sát" trong lúc người dùng thao tác (kéo thẻ) → ghi lại chuỗi sự kiện có thứ tự |
| `compare_web_captures` / `compare_web_screenshots` | So sánh trạng thái trước/sau một thao tác → chỉ ra chính xác class CSS nào bật/tắt, node nào di chuyển |
| `analyze_web_bundle` | Phân tích tĩnh bundle JS (không chạy code): sơ đồ chunk, route, vendor — hiểu app được tổ chức thế nào |
| Electron observation | Tương tự cho app desktop (Notion, Slack…) |

Mọi kết quả kèm "Evidence" (bằng chứng + giới hạn của kết luận) — thiết kế để agent như tôi
đọc rồi **tự xây lại tính năng**, không phải để bê code của họ về.

## Đánh giá thẳng thắn

**REA giúp được:**
- Trả lời chính xác những câu video khó truyền đạt hết: thẻ Trello khi nhấc lên được áp
  transform gì, lớp phủ/đổ bóng là element nào, placeholder được chèn ở đâu trong DOM,
  class nào gắn vào lúc nào. Đây là phần "đo đạc" bổ sung cho video bạn quay.
- Khi muốn học một tính năng từ app desktop đóng (không phải web) — vùng mà DevTools
  không với tới được.

**REA không giúp được / không cần:**
- Nó tạo ra *hiểu biết có bằng chứng*, không tạo ra code dùng lại — phần xây vẫn là việc của tôi.
- Với website, bản chất nó là "DevTools có kỷ luật + xuất bằng chứng cho agent". Phần lớn
  thông số giao diện Trello tôi đã nắm hoặc đọc được từ video bạn gửi + các codebase MIT
  (jira_clone, Focalboard…). REA là tăng độ chính xác, không phải điều kiện bắt buộc.
- Chạy đúng kiểu cần **máy của bạn**: nó attach vào Chrome bạn đang đăng nhập (CDP).
  Trong phiên cloud này không có Chrome đăng nhập Trello của bạn.

**Pháp lý:** quan sát trang web đang hiển thị (DOM/CSS — thứ DevTools nào cũng thấy) để
học cách làm là vùng an toàn; dịch ngược/sao chép code độc quyền của Atlassian thì không.
Hệ thống nội bộ của chúng ta viết bằng code riêng nên không vướng.

## Cách dùng đề xuất (nếu muốn dùng)

1. Trên máy cá nhân có Claude Code: `npx rea-agents setup` → chọn Claude Code → khởi động lại.
2. Mở Chrome với board Trello thật, bật cổng CDP theo `docs/browser-observation.md`.
3. Nhắc agent: *"Dùng REA quan sát thao tác kéo thẻ trên board này, xuất evidence về
   transform/class/timing của animation"*.
4. Mang kết quả (evidence bundle) vào phiên này — tôi chuyển thành code trong `app/`.

Kết luận: **repo đáng giá, đúng triết lý dự án, nhưng là "kính hiển vi" tùy chọn** —
video bạn quay + codebase mở vẫn là nguồn chính; REA dùng khi cần soi chi tiết mà
video không đủ phân giải.
