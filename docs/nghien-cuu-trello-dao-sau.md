# Đào sâu Trello (10/2026) — giao diện, logic, kết cấu → gap so với hệ thống

*Ngày 16/10/2026. Phương pháp: xem trực tiếp board công khai `trello.com/b/nC8QJJoZ`
(giao diện thật, chi tiết thẻ), tài liệu hỗ trợ chính thức của Atlassian, và các bài
phân tích bản thiết kế lại 2025. Bổ sung cho `nghien-cuu-trello-va-cac-lua-chon-ma-nguon-mo.md`
(tài liệu đó dừng ở mức mô hình dữ liệu + bài học thiết kế).*

## 1. Quan sát trực tiếp giao diện Trello thật

### Mặt trước thẻ (card front) — mọi thứ đọc được không cần mở thẻ
- Ảnh bìa (cover) phủ đỉnh thẻ; nhãn là dải màu **có tên**, bấm vào dải nhãn phóng to/thu nhỏ toàn board.
- Hàng badge dưới tiêu đề, chỉ hiện khi có dữ liệu: 🕐 hạn chót (màu theo trạng thái),
  ≡ có mô tả, 📎 số đính kèm, ☑ tiến độ checklist `2/5`, 💬 số bình luận.
- Avatar thành viên dồn góc phải-dưới thẻ, xếp chồng khi đông.
- **Logic màu hạn chót**: sắp đến hạn (<24h) nền vàng; quá hạn nền đỏ; đã hoàn thành nền xanh lá.
  *(Hệ thống ta đã có đúng logic này — kiểm chứng trên board [SIM] 16/10.)*

### Mặt sau thẻ (card back, bản mới 2025)
- Banner cover trên cùng; chip **tên cột hiện tại** ngay trên tiêu đề (bấm để chuyển cột).
- Bố cục 2 cột: trái = mô tả/checklist/đính kèm; **phải = luồng "Comments and activity"**
  có nút *Show details* (ẩn/hiện sự kiện hệ thống, chỉ giữ bình luận).
- Menu **Add** (thêm members/dates/checklist/attachment) ngay dưới tiêu đề;
  menu **Actions** (copy/move/mirror/archive) góc phải-trên; thanh đáy: Power-Ups • Automation • bật tắt khung comment.
- Đính kèm tách 2 nhóm **Links** và **Files**; mỗi file có nút đặt làm cover.
- **Mỗi thẻ có URL riêng** `trello.com/c/<mã>/<số>-<tên>` — dán link vào chat là mở đúng thẻ.

### Board & điều hướng (bản 2026)
- Header board: tên, sao, bộ chuyển **view** (Board/Table/Calendar/Timeline/Dashboard/Map — view nâng cao là Premium), avatar thành viên "+N", Filter, Share, menu board.
- Cột: đếm số thẻ cạnh tên + nút **thu gọn cột** (collapse) thành dải dọc.
- Điều hướng toàn cục mới: **Inbox** (hộp thu việc cá nhân: từ email chuyển tiếp, Slack, Siri; AI tự rút hạn/độ ưu tiên), **Planner** (kéo thẻ vào lịch Google/Microsoft), xem Inbox+Planner+Board cạnh nhau; phím `g+i`, `g+p`, `g+b`.
- **Mirror card**: một thẻ sống trên nhiều board, sửa một nơi là cập nhật mọi nơi.
- Phím tắt lâu đời vẫn nguyên: `/` tìm kiếm, `f` bộ lọc, `x` xóa lọc, `q` lọc thẻ của tôi,
  `n` thẻ mới, `e` sửa nhanh, `space` gán mình, `d` hạn, `l` nhãn, `m` thành viên, `c` lưu trữ, `j/k` di chuyển giữa thẻ, `b` chuyển board.

## 2. Gap: Trello có — hệ thống ta chưa có (xếp theo giá trị cho đội 15–20 người)

| # | Khoảng trống | Trello làm gì | Độ khó ta làm |
|---|---|---|---|
| 1 | **Thông báo trong app** | Chuông + đỏ số chưa đọc: được gán việc, bị @mention, sắp đến hạn, thẻ mình theo dõi có thay đổi | Vừa — đã có WS realtime + activity log làm nền |
| 2 | **URL riêng từng thẻ** | `/c/<id>` chia sẻ được, mở thẳng thẻ | Dễ — hash route `#card/<id>` + global search đã có sẵn nền |
| 3 | **Upload file thật** | Kéo-thả file vào thẻ, file đầu tiên tự thành cover | Vừa — hiện chỉ có đính kèm link |
| 4 | **Table view** | Mọi thẻ thành bảng: cột người/hạn/nhãn, sort + sửa inline | Vừa |
| 5 | **Kéo-thả sắp xếp cột** | Kéo cả cột đổi vị trí | Dễ — nền pointer-drag đã có |
| 6 | **Thu gọn cột** | Collapse cột thành dải dọc | Dễ |
| 7 | **Phím tắt** | Bộ phím một-chạm thao tác nhanh | Dễ–vừa |
| 8 | **Sửa nhanh (quick edit)** | Chuột phải/nút bút trên thẻ: đổi tên, hạn, nhãn không mở thẻ | Vừa |
| 9 | **Board riêng tư theo nhóm** | Visibility: private/workspace/public per board | Vừa — cần bảng board_members |
| 10 | Checklist nâng cao | Giao việc con + hạn cho từng dòng checklist (Premium) | Vừa |
| 11 | Custom fields | Trường tự định nghĩa trên thẻ (Premium) | Khó vừa |
| 12 | Timeline/Dashboard view | Gantt + biểu đồ thống kê (Premium) | Khó vừa |
| — | Inbox/Planner/AI/Mirror/Power-Ups | Hệ sinh thái Atlassian, lịch ngoài, AI | **Không nên làm** — vượt nhu cầu nội bộ, trái nguyên tắc "không xây thừa" |

Những thứ ta **đã ngang hoặc hơn Trello Free**: automation rule server-side (Trello Free giới hạn 250 lượt/tháng — ta không giới hạn), nhãn có tên, nhiều người/thẻ, lưu trữ/khôi phục, nhật ký 16 loại sự kiện, realtime, calendar view (Trello thu phí), bộ lọc, tìm kiếm toàn cục.

## 2b. Quan sát bản Trello MỚI qua tài khoản đăng nhập của user (16/10/2026, Claude in Chrome)

*Tài khoản Free, giao diện tiếng Việt, dark mode — thấy nguyên bản redesign 2025/2026 đang chạy thật
(board "Team Task", "cong viec tuan toi" của user). Chính xác hơn mọi tài liệu second-hand ở mục 1-2.*

**Bố cục 3 pane + thanh điều hướng đáy**: `Hộp thư đến | Trình lập kế hoạch | Bảng thông tin | Chuyển đổi các bảng`
+ nút giọng nói — mở được đồng thời Inbox + Planner + Board cạnh nhau, kéo giãn từng pane.
- **Inbox**: ô "Thêm thẻ" trên cùng; nguồn vào: email chuyển tiếp, giọng nói, extension Chrome, mobile,
  Slack, Teams, Messenger; ghi chú "Chỉ mình bạn có thể thấy Hộp thư đến" (riêng tư từng người).
  → Inbox ta làm trùng concept (quick add + riêng tư + chuyển thành thẻ); Trello hơn ở nguồn vào ngoài.
- **Planner**: 6 chế độ xem (Ngày/Tuần/Tháng/Tùy chỉnh/Chương trình [mặc định, danh sách ngày dọc]/Vừa màn hình),
  banner "Kết nối tài khoản lịch" (Google/Microsoft), từng ngày hiện "Chưa lên kế hoạch nào".
  → Planner ta ≈ chế độ "Tuần"; thiếu: chế độ danh sách dọc (agenda), nối lịch ngoài (không cần).

**Board**: mỗi cột có **màu nền riêng** (10 màu + gỡ màu); cột có nút **thu gọn** cạnh số đếm; cột Done gắn 🎉.
Hover thẻ hiện **bút ✎ sửa nhanh**. Nút "+ Thêm thẻ" dưới đáy cột kèm icon mở từ template.
**Menu cột** rất giàu: Thêm thẻ / Sao chép / Di chuyển / Di chuyển tất cả thẻ / **Sắp xếp theo** / **Theo dõi**
/ đổi màu / **automation ngay trong menu** ("Khi thêm thẻ vào danh sách", "Hàng ngày sắp xếp theo",
"Thứ 2 hàng tuần sắp xếp theo", "Tạo quy tắc") / Lưu trữ cột / Lưu trữ tất cả thẻ trong cột.

**Card back mới (xác nhận tận mắt)**: chip tên cột góc trên-trái (đổi cột tại chỗ); **nút tròn ○ cạnh tiêu đề
= đánh dấu hoàn thành cả thẻ** (tính năng card-complete 2025); hàng nút `+ Thêm | Nhãn | Ngày | Việc cần làm |
Thành viên` ngay dưới tiêu đề; cột phải "Nhận xét và hoạt động" + nút "Hiện chi tiết"; thanh đáy nổi
`Power-up | Tự động hóa | Nhận xét`; góc trên-phải: đặt cover, menu "…", đóng.

**Automation (Butler) đầy đủ 5 nhánh**: Quy tắc / **Theo lịch** (hằng ngày, thứ 2 hằng tuần…) / **Ngày đến hạn**
(trigger theo hạn) / **Nút thẻ** / **Nút bảng** (custom buttons). Trình tạo rule 3 bước
(trigger → action → review), 6 nhóm trigger: Card Move, Card Changes, Dates, Checklists, Card Content, Fields;
mỗi trigger là câu có chip chỉnh được ("when a card is [added to] list [X] [by me/by anyone]").

**Bộ lọc**: từ khóa; thành viên (+ "Không có thành viên", "Các thẻ chỉ định cho tôi");
**Card status** (đã/chưa hoàn tất); ngày hết hạn (không có / quá hạn / ngày mai / tuần sau / **tháng sau**,
icon màu theo mức); nhãn (+ "Không có nhãn").

**Gap mới phát hiện so với bảng mục 2** (ứng viên đợt 3):
| Gap | Ghi chú |
|---|---|
| Màu nền cột | 10 màu, rất dễ làm (cột `color` + picker trong menu cột) |
| Thu gọn cột | đã nằm bảng cũ #6 |
| Sắp xếp cột (sort theo tên/hạn/ngày tạo) | menu cột |
| Đánh dấu hoàn thành CẢ THẺ (○ cạnh tiêu đề + lọc theo card status) | ta mới có hoàn thành *hạn* |
| Sửa nhanh ✎ khi hover thẻ | bảng cũ #8 |
| Automation theo lịch + theo ngày đến hạn + nút thẻ/bảng | mở rộng bảng rules hiện có |
| Bộ lọc thêm: không thành viên / thẻ của tôi / không nhãn / card status | nhẹ |
| Theo dõi (watch) cột/thẻ | gắn với hệ thông báo đã có |

## 3. Đề xuất đợt 2 (chờ chốt sau pilot, thứ tự ưu tiên)

**Nhóm A — làm ngay được, chạm đúng nhu cầu đội:**
1. Thông báo trong app (chuông + badge; sự kiện: được gán, @mention trong bình luận, thẻ sắp đến hạn 24h, thẻ trễ hạn) — ứng viên số 1 trong tài liệu tình trạng, nay có thêm căn cứ từ Trello.
2. URL riêng từng thẻ (chia sẻ trong chat nội bộ — khớp thói quen đội YouTube gửi link cho nhau).
3. Upload file + cover từ file (hiện đội phải dùng link Drive).

**Nhóm B — nâng trải nghiệm trưởng nhóm:**
4. Table view (quét nhanh toàn bộ: ai, hạn nào, cột nào).
5. Kéo-thả cột + thu gọn cột.

**Nhóm C — polish:** phím tắt, quick edit, board riêng tư.

*Dữ liệu giả lập phục vụ phát triển các tính năng trên: board `[SIM] Sản xuất video`
(scripts/seed-sim-team.mjs — 6 thành viên khóa đăng nhập, 16 thẻ, 15 bình luận, 73 dòng
nhật ký trải 3 tuần, có đủ thẻ trễ hạn/sắp đến hạn/hoàn thành). Gỡ: remove-sim-team.mjs.*

## Nguồn
- Board công khai quan sát trực tiếp: trello.com/b/nC8QJJoZ (card back, badge, bố cục)
- trello.com/tour — bộ tính năng chính thức 2026 (Inbox/Boards/Planner)
- support.atlassian.com/trello/docs/new-trello-support — điều hướng mới, phím g+i/g+p/g+b
- support.atlassian.com/trello/docs/new-card-back — bố cục card back mới (Add/Actions/thanh đáy)
- fastcompany.com/91283192/trello-2025-redesign; uctoday.com (bản cập nhật AI + Slack) — bối cảnh bản 2025
