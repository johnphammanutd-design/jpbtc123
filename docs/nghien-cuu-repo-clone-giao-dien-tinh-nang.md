# Repo GitHub để "clone" giao diện & tính năng website — phục vụ nâng cấp hệ thống Kanban

*Cập nhật: 10/2026. Số sao GitHub đã kiểm chứng tại thời điểm viết.*

## Sự thật cần nắm trước

Không có công cụ nào clone được **tính năng** (logic nghiệp vụ, backend) của một website bất kỳ —
vì tính năng nằm ở máy chủ của họ, không tải về được. Những gì clone được:

1. **Giao diện (nhìn thấy gì)** → công cụ AI chuyển ảnh chụp/URL thành code giao diện.
2. **Tính năng** → chỉ lấy được từ **mã nguồn mở** có giấy phép cho phép, bằng cách đọc và
   chuyển cách làm của họ vào code của mình.

## Nhóm 1 — Clone giao diện từ ảnh chụp / URL

| Repo | Sao | Làm gì | Điều kiện |
|---|---|---|---|
| [abi/screenshot-to-code](https://github.com/abi/screenshot-to-code) | **80.1k** ⭐, đang phát triển tích cực | Ảnh chụp màn hình / bản Figma / video màn hình → HTML+Tailwind, React, Vue… | Cần API key OpenAI / Anthropic / Gemini |
| [firecrawl/open-lovable](https://github.com/firecrawl/open-lovable) | ~26.8k ⭐ | Nhập URL → tái tạo thành app React (Vite + Tailwind + shadcn/ui) | Cần API key Firecrawl + E2B + 1 AI provider |
| HTTrack (công cụ cổ điển) | — | Tải bản sao tĩnh HTML/CSS/ảnh của trang | Chỉ ra bản "chết", không có logic |

**Lưu ý thực tế**: hai repo đầu bản chất là lớp vỏ gọi các model AI (trong đó có Claude).
Trong phiên làm việc này, tôi làm được trực tiếp việc đó — đưa tôi ảnh chụp giao diện bạn
thích (Trello, Linear, Notion…), tôi tái tạo bằng code luôn, không cần dựng thêm công cụ.
Hai repo trên hữu ích khi bạn muốn đội tự vận hành quy trình này ngoài phiên Claude.

## Nhóm 2 — Mã nguồn mở để "mượn" tính năng (giá trị thật nằm ở đây)

| Repo | Giấy phép | Dùng để học/lấy gì |
|---|---|---|
| [oldboyxx/jira_clone](https://github.com/oldboyxx/jira_clone) | MIT | ~11k ⭐. Codebase React + Node gọn, dễ đọc; modal chi tiết issue, kéo-thả, cấu trúc project chuẩn |
| [mattermost-community/focalboard](https://github.com/mattermost-community/focalboard) | MIT/Apache | Hết bảo trì nhưng **MIT = được phép lấy code**: custom properties, nhiều view (bảng/lưới/lịch), filter |
| [wekan/wekan](https://github.com/wekan/wekan) | MIT | Tính năng Trello đầy đủ nhất: swimlane, WIP limit, import Trello, rule tự động |
| [kanboard/kanboard](https://github.com/kanboard/kanboard) | MIT | Automation rule "nếu–thì" kiểu Butler, phân tích cycle time — mô hình đơn giản dễ chuyển sang Node |
| [plankanban/planka](https://github.com/plankanban/planka) | v1 AGPL / v2 fair-code | **Chỉ để tham khảo UX, không copy code** (AGPL lây lan giấy phép; v2 không phải open source thuần) |

## Khuyến nghị cho việc nâng cấp hệ thống của chúng ta

1. **Giao diện "đỉnh cao"**: chọn chuẩn thẩm mỹ muốn theo (Trello hiện đại / Linear tối giản).
   Gửi ảnh chụp màn hình mẫu vào phiên Claude → tái tạo trực tiếp vào `app/public/`.
2. **Tính năng**: ưu tiên chuyển từ các repo MIT theo thứ tự giá trị với đội 15–20 người:
   - Nhiều chế độ xem (lịch theo hạn chót, bảng tổng hợp theo người) — học Focalboard
   - Bộ lọc theo người/nhãn/hạn + tìm kiếm — học jira_clone
   - Automation "nếu–thì" đơn giản (thẻ vào cột Hoàn thành → tự tick checklist, ghi log) — học Kanboard
   - Nhật ký hoạt động (ai làm gì, lúc nào) — có sẵn mô hình ở cả 3 repo trên
3. **Pháp lý**: lấy ý tưởng/cách làm từ repo MIT là hợp lệ (giữ ghi công khi copy nguyên đoạn).
   Không copy code AGPL/fair-code vào dự án riêng. Bắt chước bố cục giao diện để dùng nội bộ
   là bình thường; không sao chép logo/tên thương hiệu Trello.

## Nguồn

- https://github.com/abi/screenshot-to-code (80.1k sao, kiểm chứng 10/2026)
- https://github.com/firecrawl/open-lovable · https://www.firecrawl.dev/blog/open-lovable-tutorial
- https://github.com/oldboyxx/jira_clone
- https://github.com/mattermost-community/focalboard · https://github.com/wekan/wekan · https://github.com/kanboard/kanboard
