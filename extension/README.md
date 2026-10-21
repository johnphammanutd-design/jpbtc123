# Trợ lý phản biện comment (Chrome + Firefox)

Extension gợi ý câu trả lời phản biện tự nhiên cho comment trái chiều dưới video YouTube.
AI chỉ **gợi ý** — bạn tự đọc, chỉnh sửa và tự đăng bằng tài khoản của mình.
Extension không bao giờ tự đăng comment.

## Cấu trúc

```
extension/
├── manifest.json        # Manifest V3, dùng chung Chrome + Firefox
├── background.js        # Gọi Claude API (nơi duy nhất chạm đến API key)
├── content/
│   ├── youtube.js       # Gắn nút "Gợi ý trả lời" vào comment, panel gợi ý
│   └── youtube.css
└── options/
    ├── options.html     # Nhập API key, chọn model, giọng điệu, hồ sơ giọng kênh
    └── options.js
```

## Cài đặt để thử (developer mode)

### Chrome / Edge / Brave

1. Mở `chrome://extensions`.
2. Bật **Developer mode** (góc phải trên).
3. Bấm **Load unpacked** → chọn thư mục `extension/` này.

> Chrome sẽ cảnh báo key `background.scripts` không nhận ra — bỏ qua được,
> key đó dành cho Firefox; Chrome dùng `service_worker`.

### Firefox

1. Mở `about:debugging#/runtime/this-firefox`.
2. Bấm **Load Temporary Add-on…** → chọn file `extension/manifest.json`.
3. (Tạm thời — mất khi đóng Firefox. Muốn cài cố định phải ký qua
   [addons.mozilla.org](https://addons.mozilla.org) hoặc dùng Firefox Developer Edition
   với `xpinstall.signatures.required = false`.)

> Firefox cần bản **121 trở lên** (đã khai báo trong `browser_specific_settings`).

## Thiết lập

1. Mở trang **Cài đặt** của extension (chuột phải icon → Options, hoặc từ trang quản lý extension).
2. Dán **Claude API key** (lấy tại console.anthropic.com). Key chỉ lưu trong
   `storage.local` của trình duyệt và chỉ gửi tới `api.anthropic.com`.
3. (Tùy chọn) Chọn model, giọng ưu tiên, và mô tả **hồ sơ giọng kênh** để AI viết đúng chất bạn.

## Dùng thử

1. Mở một video YouTube bất kỳ, kéo xuống phần bình luận.
2. Cạnh mỗi comment sẽ có nút **💬 Gợi ý trả lời**.
3. Bấm nút → extension phân loại comment (góp ý có lý / hiểu sai / chê vô căn cứ / troll)
   và đưa 3 phương án trả lời theo 3 giọng: phản biện, hài hước, lịch sự.
4. Bấm **Chép** hoặc **Điền vào ô trả lời** → sửa lại theo ý bạn → tự bấm đăng.

Với comment troll thuần túy, AI sẽ khuyên bỏ qua hoặc chỉ đáp một câu hóa giải nhẹ.

### Tối ưu kéo tương tác (v0.2.0)

Mỗi câu gợi ý được soạn để người nhận **muốn trả lời lại**: kết bằng móc tương
tác (câu hỏi mở nhắm đúng điểm họ quan tâm, lời mời chia sẻ trải nghiệm, thách
thức thiện chí), trích lại từ ngữ của chính họ để tạo cảm giác được lắng nghe,
và khơi tò mò về chi tiết trong video họ có thể đã bỏ lỡ. Để làm được việc đó,
extension gửi kèm ngữ cảnh đầy đủ: tiêu đề + mô tả video, tối đa 8 comment khác
dưới video (không khí thảo luận chung) và comment gốc của thread nếu đang trả
lời một reply. Kéo tương tác bằng tò mò và lý lẽ — không dùng chọc giận/mỉa mai,
vì comment làm người đọc nổi nóng dễ bị report và hại đề xuất của kênh.

### Phương án góc nhìn tâm lý + pháp lý (v0.8.0)

Mỗi lần gợi ý trả lời có thêm phương án thứ tư: phản biện bằng một hiện tượng tâm lý
học phổ biến (ví dụ trí nhớ về giá cả bị dựng lại theo thời gian) và, khi thật sự liên
quan, một nguyên tắc pháp lý chung (ví dụ phân biệt nêu ý kiến với khẳng định sự thật).
Nói bằng lời thường, kết bằng câu hỏi mời người comment trả lời lại.

Ràng buộc đặt sẵn trong prompt: không xưng là nhà tâm lý/luật sư/chuyên gia, không chẩn
đoán hay gán nhãn tâm lý người comment, không trích điều luật hay án lệ khi ngữ cảnh
không có, không bịa, không dùng pháp lý để dọa kiện hay tố cáo. Panel luôn nhắc bạn
kiểm tra lại độ chính xác (nhất là phần pháp lý, luật tùy từng nơi) trước khi đăng. Tắt
trong Cài đặt bằng ô **Thêm phương án góc nhìn tâm lý + pháp lý**.

### Bản dịch tiếng Việt (v0.7.0)

Comment tiếng Anh (hoặc ngôn ngữ khác) được dịch sang tiếng Việt để bạn đọc nhanh:

- Nút **🌐 Dịch** cạnh mỗi comment: bấm một lần để hiện bản dịch ngay dưới comment,
  bấm lần nữa để ẩn. Comment vốn là tiếng Việt thì không dịch.
- **Gợi ý trả lời**: bản dịch của comment hiện dưới comment, và dưới từng câu trả lời
  tiếng Anh có một dòng dịch nhỏ để bạn biết mình sắp đăng gì. Nút Chép và Điền chỉ dùng
  bản tiếng Anh.
- **Quét comment trái chiều** và **Comment ghim**: bản dịch được kèm sẵn trong cùng một
  lần gọi, không tốn thêm lượt gọi.
- Trong Cài đặt có ô **Kèm bản dịch tiếng Việt** để tắt, tiết kiệm khoảng 30–60% chi phí
  mỗi lần gọi. Nút 🌐 Dịch luôn dùng được.

### Quét comment trái chiều

Trên trang xem video có nút nổi **🔍 Quét comment trái chiều** (góc phải dưới):
bấm một lần, extension phân loại tối đa 30 comment đang hiển thị trong một lần
gọi API duy nhất, gắn badge màu cho từng comment (xanh = tích cực, vàng = góp ý
có lý, đỏ = hiểu sai / chê vô căn cứ / troll) và viền đỏ các comment nên trả
lời trước. Muốn quét thêm thì cuộn tải thêm comment rồi bấm quét lại.

### Lịch sử câu đã dùng

Mỗi lần bạn bấm **Chép** hoặc **Điền vào ô trả lời**, câu đó được ghi vào lịch
sử (30 câu gần nhất, lưu cục bộ). Các lần gợi ý sau, AI được nhắc tránh lặp lại
khuôn câu đã dùng — comment trả lời nghe đỡ "một màu".

## Chi phí — so sánh API (khảo sát 10/2026)

Mỗi lần gợi ý (kèm bản dịch tiếng Việt và phương án góc nhìn chuyên gia) tốn khoảng **1.500 token input + 600 token output**. Chi phí ước tính
cho **1.000 lần gợi ý** theo từng API (USD, giá /1M token input|output):

| API | Giá input | Giá output | ~1.000 lần gợi ý |
|---|---|---|---|
| **Claude Haiku 4.5** (mặc định) | $1.00 | $5.00 | ~$4.50 |
| Claude Sonnet 5.5 | $2.00 | $10.00 | ~$9.00 |
| Claude Opus 5.5 | $4.00 | $20.00 | ~$18.00 |
| OpenAI GPT-5 nano | $0.05 | $0.40 | **~$0.32** |
| Google Gemini 2.5 Flash-Lite | $0.10 | $0.40 | ~$0.39 |
| DeepSeek chat (v4-flash) | $0.14 | $0.28 | ~$0.38 |

Mặc định là **Claude Haiku 4.5** — model rẻ nhất nhà Claude: tài khoản có API
credit hàng tháng của Anthropic (ví dụ $200/tháng kèm gói Max) thì $200 tương
đương ~80.000 lần gợi ý mỗi tháng. Cần văn phong mượt hơn thì nâng lên Sonnet
5.5 hoặc Opus 5.5; không có credit và muốn rẻ nhất tuyệt đối thì chọn OpenAI
GPT-5 nano — đổi model/nhà cung cấp chỉ là một dropdown trong trang Cài đặt,
key của từng nhà được lưu riêng.

## Ghi chú kỹ thuật

- Gọi API qua `fetch` từ background script với `host_permissions` cho đúng 4
  domain API nên không vướng CORS; không cần bundler hay npm.
- Hỗ trợ 4 nhà cung cấp: OpenAI, Google Gemini, DeepSeek, Anthropic Claude.
  Mỗi nhà một API key, lưu riêng trong `storage.local`, chỉ gửi tới đúng API đó.
- Cấu hình cũ (bản chỉ có Claude) được tự chuyển sang dạng mới khi mở lại.
- Selector DOM của YouTube thay đổi theo thời gian; content script hỗ trợ cả
  `ytd-comment-view-model` (mới) lẫn `ytd-comment-renderer` (cũ) và dùng
  MutationObserver để bắt comment tải thêm khi cuộn.
