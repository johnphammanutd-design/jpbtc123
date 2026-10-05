# Nghiên cứu Trello & các lựa chọn mã nguồn mở — Xây dựng hệ thống mục tiêu/task cho công ty

*Cập nhật: 10/2025. Tài liệu phân biệt rõ: **[Đã kiểm chứng]** từ nguồn công khai, **[Suy luận]** từ kinh nghiệm triển khai, **[Cần thử nghiệm]** với đội ngũ thực tế.*

---

## 1. Trello hoạt động như thế nào — những gì đáng học hỏi

### 1.1. Mô hình dữ liệu cốt lõi (rất đơn giản, đó là lý do nó thành công)

```
Workspace (công ty/nhóm)
└── Board (dự án / luồng công việc)
    └── List (cột = trạng thái hoặc giai đoạn: To Do → Doing → Done)
        └── Card (một task/mục tiêu cụ thể)
            ├── Mô tả, bình luận, tệp đính kèm
            ├── Checklist (việc con)
            ├── Nhãn màu (label), hạn chót (due date)
            └── Thành viên được gán
```

**[Đã kiểm chứng]** Card kéo-thả giữa các List khi công việc tiến triển; toàn bộ trạng thái dự án đọc được bằng mắt trong một màn hình. Đây là nguyên lý Kanban: *trực quan hóa luồng công việc, giới hạn việc đang làm dở*.

### 1.2. Các tính năng tạo khác biệt của Trello

**[Đã kiểm chứng]** theo tài liệu và các bài đánh giá 2025:

| Tính năng | Giá trị thực tế |
|---|---|
| **Butler (tự động hóa)** | Luật "nếu–thì": card vào cột Done → tự đánh dấu hoàn thành, gắn nhãn, thông báo. Free: 250 lượt chạy/tháng; Premium: không giới hạn |
| **Power-Ups (tích hợp)** | Kết nối lịch, Slack, Google Drive… Mọi gói (kể cả Free) được dùng không giới hạn Power-Ups |
| **Nhiều chế độ xem** (Premium) | Timeline, Calendar, Dashboard — cùng dữ liệu, nhiều góc nhìn |
| **Giá** | Free: 10 board, 10 người/workspace. Standard ~5 USD/người/tháng. Premium ~10 USD/người/tháng |

### 1.3. Bài học thiết kế rút ra *(áp dụng cho hệ thống của công ty)*

1. **Đơn giản trước, sức mạnh sau**: người mới dùng được trong 5 phút; tính năng nâng cao (automation, custom field) chỉ xuất hiện khi cần.
2. **Trạng thái = vị trí**: không bắt người dùng điền form "status"; kéo card sang cột khác là xong.
3. **Một card là một đơn vị trách nhiệm**: có người được gán, có hạn chót, có checklist đo được tiến độ.
4. **Tự động hóa việc lặp lại** để con người chỉ làm việc cần suy nghĩ.

---

## 2. Các lựa chọn mã nguồn mở được đánh giá cao (tình trạng 10/2025)

**[Đã kiểm chứng]** từ GitHub và trang chủ các dự án:

| Dự án | Giấy phép | Tình trạng phát triển | Điểm mạnh | Lưu ý |
|---|---|---|---|---|
| **Planka** (~12.6k ⭐) | v1: AGPL-3.0; **v2: "PLANKA Community License"** — tự host nội bộ miễn phí, cấm bán lại dịch vụ | Rất tích cực (v2.2.x, commit liên tục) | Giao diện đẹp nhất nhóm, realtime, giống Trello hiện đại; React + PostgreSQL | Dùng nội bộ công ty: miễn phí, hợp lệ. Không được dựng thành SaaS thương mại |
| **WeKan** | MIT | Tích cực, cộng đồng lâu năm | Bám sát Trello nhất về giao diện/khái niệm; import board từ Trello; Docker/Snap | Stack Meteor.js hơi cũ; UI kém bóng bẩy hơn Planka |
| **Kanboard** | MIT | Ổn định, thiên về bảo trì | Siêu nhẹ (PHP + SQLite), cài trong 10 phút, có giới hạn WIP, phân tích thời gian chu kỳ | Giao diện tối giản, không "đẹp"; phù hợp đội kỹ thuật |
| **Vikunja** | AGPL-3.0 | Tích cực | Không chỉ kanban: list, bảng, Gantt, nhắc việc; API tốt; CalDAV | Thiên về quản lý task cá nhân/nhóm nhỏ hơn là PM đầy đủ |
| **Focalboard** | MIT/Apache | **Không còn được bảo trì** (Mattermost ngừng hỗ trợ bản standalone từ 9/2023, repo đang kêu gọi maintainer) | Từng là lựa chọn "Trello + Notion" tốt | **Không khuyến nghị** cho triển khai mới |
| **OpenProject** | GPL-3.0 | Rất tích cực, hậu thuẫn doanh nghiệp | PM đầy đủ: Gantt, Agile board, time tracking, quản lý yêu cầu | Nặng hơn nhiều so với nhu cầu "Trello cho công ty"; đáng cân nhắc nếu sau này cần PM toàn diện |
| **Taiga** | AGPL/MPL | Chậm lại đáng kể những năm gần đây | Scrum/Agile đầy đủ (sprint, backlog, story point) | **[Suy luận]** rủi ro bảo trì dài hạn; kiểm tra lại hoạt động repo trước khi chọn |

---

## 3. Khuyến nghị cho công ty

### Phương án A — Tự host một công cụ có sẵn (nhanh nhất, khuyến nghị bắt đầu)

**[Suy luận]** dựa trên tiêu chí: đội ngũ nhỏ, cần dùng ngay, dữ liệu nằm trong tay mình:

- **Chọn chính: Planka v2** — trải nghiệm gần Trello nhất với chất lượng 2025, tự host nội bộ miễn phí và hợp lệ về giấy phép. Cài bằng Docker Compose trong ~30 phút (PostgreSQL + 1 container app).
- **Dự phòng nếu muốn giấy phép MIT thuần túy hoặc máy chủ yếu: Kanboard** (chạy được trên VPS 1GB RAM) hoặc **WeKan** (nếu cần import dữ liệu từ Trello cũ).

Chi phí vận hành ước tính: 1 VPS 2 vCPU/4GB (~5–10 USD/tháng) phục vụ tốt đội < 50 người — **[Suy luận]**, cần đo tải thực tế.

### Phương án B — Tự xây hệ thống riêng (khi có nhu cầu đặc thù)

Chỉ nên tự xây khi Phương án A không đáp ứng được quy trình đặc thù (ví dụ: gắn mục tiêu quý OKR → task, báo cáo riêng cho sản xuất nội dung YouTube). Kiến trúc học từ Trello/Planka:

- **Dữ liệu**: 4 bảng lõi `boards`, `lists (position)`, `cards (position, due_date, assignee)`, `card_checklist_items` + `labels`, `comments`. Sắp xếp bằng số thực/fractional index để kéo-thả không phải ghi lại cả cột.
- **Realtime**: WebSocket phát sự kiện `card.moved`, `card.updated` cho mọi người đang mở board (Planka làm đúng cách này).
- **Giai đoạn 1 tối thiểu**: board/list/card + kéo thả + gán người + hạn chót. Automation và nhiều chế độ xem để giai đoạn 2.

👉 Trong repo này đã có **prototype chạy được**: `prototype/kanban.html` — mở trực tiếp bằng trình duyệt, đủ board → cột → card, kéo-thả, nhãn, hạn chót, checklist, lưu dữ liệu cục bộ (localStorage). Dùng để demo nội bộ và chốt yêu cầu trước khi quyết định Phương án A hay B.

### Lộ trình triển khai đề xuất (4 tuần)

| Tuần | Việc | Kết quả đo được |
|---|---|---|
| 1 | Demo prototype + dựng thử Planka trên VPS, tạo 1 board mẫu theo quy trình thật của công ty | Đội ngũ đồng ý cấu trúc cột (ví dụ: Ý tưởng → Kịch bản → Sản xuất → Duyệt → Đăng) |
| 2 | Chạy song song với cách làm hiện tại cho 1 nhóm | ≥ 80% task của nhóm nằm trên board |
| 3 | Mở cho toàn công ty, quy ước nhãn/hạn chót/người phụ trách | Mỗi task đều có người gán + hạn |
| 4 | Đánh giá: số task trễ hạn, thời gian từ "bắt đầu → xong", phản hồi đội ngũ | Quyết định ở lại Planka hay đầu tư tự xây |

**[Cần thử nghiệm]**: cấu trúc cột phù hợp với quy trình của công ty, ngưỡng WIP mỗi cột, và việc đội ngũ có duy trì cập nhật board hằng ngày hay không — đây là yếu tố quyết định thành bại lớn hơn việc chọn công cụ nào.

---

## Nguồn tham khảo

- [Trello pricing & plans (Forbes Advisor)](https://www.forbes.com/advisor/business/software/trello-pricing/)
- [Trello Review: features, Butler, Power-Ups (ClickUp)](https://clickup.com/learn/topic/project-management/tools/trello/)
- [7 Open Source Trello Alternatives (It's FOSS)](https://itsfoss.com/open-source-trello-alternatives/)
- [Planka — GitHub](https://github.com/plankanban/planka)
- [Planka overview & license history (OpenAlternative)](https://openalternative.co/planka)
- [Mattermost: Ending support for Boards/Focalboard](https://support.mattermost.com/hc/en-us/articles/19614000831252-Ending-support-for-Mattermost-Boards)
- [Focalboard: Call for Maintainers](https://github.com/mattermost-community/focalboard/issues/5038)
- [Best Trello alternative, open source (OpenProject)](https://www.openproject.org/project-management-software-alternatives/best-trello-alternative/)
