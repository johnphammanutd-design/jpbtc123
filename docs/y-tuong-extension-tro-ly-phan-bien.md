# Tổng hợp ý tưởng: Extension "Trợ lý phản biện comment" dùng AI

> Extension trình duyệt giúp chủ kênh / người dùng **soạn câu trả lời phản biện** cho các
> comment trái chiều dưới video (YouTube, Facebook...). AI chỉ **gợi ý** — người dùng tự
> đọc, chỉnh sửa và tự đăng bằng tài khoản của mình. Không auto-đăng, không tài khoản ảo.

## 1. Bài toán

- Chủ kênh / người làm nội dung nhận nhiều comment trái chiều, chê bai, hiểu sai nội dung.
- Trả lời từng comment vừa tốn thời gian, vừa dễ "nóng máu" viết câu kém khôn ngoan.
- Một câu phản biện tốt (sắc bén nhưng có lý lẽ) thường kéo thêm thảo luận và giữ chân
  người xem tốt hơn là cãi vã thuần cảm xúc.

## 2. Ý tưởng cốt lõi

Extension chạy trên trang video, với mỗi comment trái chiều sẽ:

1. **Đọc ngữ cảnh**: nội dung comment + tiêu đề/mô tả video (và transcript nếu có).
2. **Phân loại comment**: góp ý có lý / hiểu sai nội dung / chê vô căn cứ / khiêu khích (troll).
3. **Gợi ý 2–3 phương án trả lời** theo các giọng khác nhau, viết tự nhiên như văn nói:
   - *Phản biện bằng lý lẽ*: chỉ ra điểm sai, dẫn lại nội dung trong video.
   - *Hài hước / dí dỏm*: hóa giải nhẹ nhàng, dễ được người xem khác đồng tình.
   - *Lịch sự ghi nhận*: với góp ý có lý — ghi nhận và bổ sung góc nhìn.
4. Người dùng **chọn, sửa lại theo ý mình, rồi tự bấm đăng**. Extension chỉ điền sẵn vào ô
   trả lời, không tự gửi.

### Vì sao "gợi ý" thay vì "tự đăng"?

- Người đăng vẫn là chủ tài khoản thật → không vi phạm chính sách tương tác giả mạo
  (fake/coordinated engagement) của YouTube, Facebook, TikTok — thứ có thể làm bay kênh.
- Câu trả lời qua tay người dùng chỉnh sửa → giữ đúng cá tính kênh, tự nhiên thật sự.
- Troll/khiêu khích rõ ràng: AI sẽ gợi ý **bỏ qua hoặc ghim một câu hóa giải ngắn** thay vì
  lao vào cãi tay đôi — về dài hạn tốt cho hình ảnh kênh hơn.

## 3. Tính năng chính (MVP)

| Tính năng | Mô tả |
|---|---|
| Nút "Gợi ý trả lời" | Hiện cạnh mỗi comment; bấm vào là sinh 2–3 phương án |
| Chọn giọng điệu | Phản biện sắc bén / hài hước / lịch sự — người dùng đặt mặc định |
| Hồ sơ giọng kênh | Người dùng mô tả cách xưng hô, từ hay dùng → AI viết đúng chất kênh |
| Phát hiện comment trái chiều | Quét danh sách comment, đánh dấu comment tiêu cực/hiểu sai để ưu tiên trả lời |
| Điền sẵn vào ô reply | Chỉ điền, không gửi — người dùng sửa và bấm đăng |
| Lịch sử | Lưu các câu đã dùng để không lặp lại một khuôn |

### Tính năng mở rộng (sau MVP)

- Tóm tắt "tình hình comment" của video: bao nhiêu % tích cực/tiêu cực, chủ đề tranh luận chính.
- Gợi ý **comment ghim** tổng hợp trả lời chung cho các thắc mắc lặp lại.
- Hỗ trợ nhiều nền tảng: YouTube trước, sau đó Facebook, TikTok (web).

## 4. Kiến trúc kỹ thuật

```
Chrome Extension (Manifest V3)
├── content script  : đọc DOM trang video (comment, tiêu đề), gắn nút "Gợi ý",
│                     điền draft vào ô trả lời
├── popup / options : cấu hình giọng điệu, hồ sơ kênh, API key
└── background (service worker)
    └── gọi Claude API (model: claude-sonnet-5-5) với prompt:
        ngữ cảnh video + comment + giọng điệu → trả về 2–3 phương án reply
```

- **Model**: Claude Sonnet (nhanh, rẻ, đủ tốt cho văn hội thoại tiếng Việt). Có thể cho
  người dùng tự nhập API key của họ ở bản đầu.
- **Prompt hệ thống** ép các ràng buộc: trả lời ngắn (1–3 câu), văn nói tự nhiên, có lý lẽ
  cụ thể từ nội dung video, **không công kích cá nhân, không miệt thị**, không bịa thông tin.
- Không lưu dữ liệu comment lên server riêng ở bản MVP (xử lý tại chỗ + gọi API).

## 5. Ranh giới thiết kế (đã chốt)

Những thứ extension **cố tình không làm**, vì vừa rủi ro khóa kênh vừa phản tác dụng:

- ❌ Tự động đăng comment hàng loạt / lên lịch đăng.
- ❌ Đăng từ nhiều tài khoản, seeding, giả làm người xem trung lập.
- ❌ Tối ưu câu chữ để kích động, xúc phạm, câu war thuần cảm xúc.
- ✅ Thay vào đó: phản biện có lý lẽ + giọng tự nhiên → thảo luận thật, tương tác bền.

## 6. Lộ trình gợi ý

1. **Tuần 1–2**: khung extension MV3, đọc comment YouTube, nút gợi ý + gọi API, điền draft.
2. **Tuần 3**: tùy chọn giọng điệu, hồ sơ giọng kênh, phân loại comment trái chiều.
3. **Tuần 4**: đánh dấu comment cần ưu tiên, lịch sử câu đã dùng, đóng gói lên Chrome Web Store.
