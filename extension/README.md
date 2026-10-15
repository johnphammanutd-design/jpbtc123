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

Mỗi lần gợi ý tốn khoảng **1.200 token input + 250 token output**. Chi phí ước tính
cho **1.000 lần gợi ý** theo từng API (USD, giá /1M token input|output):

| API | Giá input | Giá output | ~1.000 lần gợi ý |
|---|---|---|---|
| **Claude Opus 5.5** (mặc định) | $4.00 | $20.00 | ~$9.80 |
| Claude Sonnet 5.5 | $2.00 | $10.00 | ~$4.90 |
| Claude Haiku 4.5 | $1.00 | $5.00 | ~$2.45 |
| OpenAI GPT-5 nano | $0.05 | $0.40 | **~$0.16** |
| Google Gemini 2.5 Flash-Lite | $0.10 | $0.40 | ~$0.22 |
| DeepSeek chat (v4-flash) | $0.14 | $0.28 | ~$0.24 |

Mặc định là **Claude Opus 5.5**: tài khoản có API credit hàng tháng của Anthropic
(ví dụ $200/tháng kèm gói Max) thì dùng Claude trong hạn mức đó không tốn thêm
tiền — $200 tương đương ~20.000 lần gợi ý Opus 5.5 hoặc ~40.000 lần Sonnet 5.5
mỗi tháng. Không có credit và muốn rẻ nhất tuyệt đối: chọn OpenAI GPT-5 nano
trong trang Cài đặt — đổi nhà cung cấp chỉ là một dropdown, key của từng nhà
được lưu riêng.

## Ghi chú kỹ thuật

- Gọi API qua `fetch` từ background script với `host_permissions` cho đúng 4
  domain API nên không vướng CORS; không cần bundler hay npm.
- Hỗ trợ 4 nhà cung cấp: OpenAI, Google Gemini, DeepSeek, Anthropic Claude.
  Mỗi nhà một API key, lưu riêng trong `storage.local`, chỉ gửi tới đúng API đó.
- Cấu hình cũ (bản chỉ có Claude) được tự chuyển sang dạng mới khi mở lại.
- Selector DOM của YouTube thay đổi theo thời gian; content script hỗ trợ cả
  `ytd-comment-view-model` (mới) lẫn `ytd-comment-renderer` (cũ) và dùng
  MutationObserver để bắt comment tải thêm khi cuộn.
