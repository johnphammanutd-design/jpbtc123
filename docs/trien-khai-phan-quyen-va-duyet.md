# Bản sửa phân quyền và duyệt công việc — 26/10/2026

## Phạm vi

Đây là bản cập nhật web/API làm nền cho iOS. Giữ Express, SQLite và giao diện web hiện có. Chưa phải ứng dụng iOS native. Mã ứng dụng `19d10ef` đã được triển khai lên task.kairetic.com từ máy Codex vào ngày 26/10/2026.

- Mọi bảng cần quyền truy cập rõ ràng. Giám đốc/quản trị (`is_admin`) thấy và quản lý tất cả bảng. Thành viên được cấp vai trò `member` hoặc `manager` theo bảng. Leader quản lý các bảng được giám đốc gắn với team của họ. Không giới hạn số team hoặc số leader.
- API kiểm tra quyền cho cả dữ liệu con, file đính kèm và WebSocket. Cookie chỉ dùng để trình duyệt hiển thị file được cấp quyền; API tiếp tục yêu cầu Bearer token.
- Nhân viên/leader gửi duyệt; người duyệt yêu cầu sửa hoặc duyệt hoàn thành. Người thực hiện không tự duyệt. Công việc do leader thực hiện cần giám đốc duyệt. Lịch sử duyệt được giữ lại.
- Chọn các cột của quy trình trong Menu → Phân quyền & team. Bảng có các tên cột mặc định sẽ tự nhận cấu hình Chờ duyệt / Hoàn thành / Đang làm. Bảng có cột khác có thể giữ nguyên cột hoặc cấu hình riêng.
- Sửa nội dung công việc đang chờ/đã duyệt sẽ mở lại công việc. Hoàn thành qua tự động hóa không bỏ qua bước duyệt. Việc lặp sau khi được duyệt chuyển hạn, xóa dấu checklist và bắt đầu chu kỳ duyệt mới.
- Sao chép giữ cả tham chiếu người nhận việc đã khóa (không cấp lại quyền đăng nhập), ngày/giờ, cấu hình lặp, nhắc hạn, nhãn, thành viên, checklist, trường tùy chỉnh và đính kèm theo lựa chọn. Sao chép bảng giữ quyền và cấu hình tự động hóa. Di chuyển giữa bảng ánh xạ nhãn/trường; yêu cầu cấp quyền bảng đích cho người nhận việc trước.
- Checklist có nhiều nhóm, người phụ trách/hạn từng việc con và chuyển việc con thành thẻ. Có sửa bình luận/phản ứng, chỉnh nhãn/màu, trường ô đánh dấu, sửa nhanh, di chuyển thẻ và thao tác hàng loạt với cột.
- Sửa lệch ngày Lịch và màn hình Bảng kê còn hiện trong Planner. Planner tự hiện việc được giao có hạn. Nhắc hạn xét giờ Việt Nam mỗi phút, loại công việc đã lưu trữ/bảng đã đóng.
- Thêm tổng quan theo team, bộ lọc bất kỳ/tất cả trong nhóm thành viên/nhãn, bộ lọc hoạt động, ẩn cột không có kết quả, xuất JSON dữ liệu bảng. Xuất JSON không thay thế backup SQLite.

## Bắt buộc chuẩn bị trước khi cập nhật production

Bản cũ cho phép mọi tài khoản thấy bảng `workspace`. Bản mới chỉ cho xem bảng được cấp quyền. **Không tự gán tất cả nhân viên vào mọi bảng để giữ cách cũ.** Cần kế hoạch cấp quyền cho các bảng đang mở trước khi bật bản mới, để nhân viên tiếp tục thấy đúng công việc.

1. Backup DB đang chạy bằng `scripts/backup-db.mjs` (SQLite online backup); lưu cả thư mục uploads và vapid.json. Không sao chép riêng file DB khi còn WAL đang hoạt động.
2. Trích danh sách tài khoản/bảng bằng bản mã mới trong môi trường có thư viện đã cài:

   ```sh
   DATA_DIR=/data node scripts/configure-access.mjs --inventory
   ```

   Lệnh chỉ đọc, không trả password hash hay session token. Chuẩn bị kế hoạch theo mẫu dưới, dùng đúng username/ID từ inventory. Tất cả bảng đang mở phải xuất hiện trong kế hoạch:

   ```json
   {
     "teams": [
       {"name": "Tên team", "members": [
         {"username": "username-leader", "role": "leader"},
         {"username": "username-nhan-vien", "role": "member"}
       ]}
     ],
     "boards": [
       {"id": 123, "team": "Tên team", "members": [
         {"username": "username-leader", "role": "manager"},
         {"username": "username-nhan-vien", "role": "member"}
       ]}
     ]
   }
   ```

3. Kiểm tra kế hoạch (không sửa DB hoặc chạy migration):

   ```sh
   DATA_DIR=/data node scripts/configure-access.mjs access-plan.json
   ```

4. Trong cửa sổ cập nhật đã thống nhất: dừng phiên bản cũ sau khi backup, chạy `--apply` bằng bản mã mới để chạy migration và áp dụng quyền, rồi khởi động bản mới. Kế hoạch chỉ thay thành viên của những team/bảng có trong file; không xóa team cũ.

   ```sh
   DATA_DIR=/data node scripts/configure-access.mjs access-plan.json --apply
   ```

   Các lệnh trên là lệnh **trong môi trường ứng dụng**, không mặc định là lệnh trên máy cá nhân. Khi dùng Docker, cần chạy với đúng volume production đã backup; không tạo volume mới do đổi thư mục Compose. Không đưa DATA_DIR demo lên production.

5. Kiểm tra bằng tài khoản giám đốc, leader và nhân viên: bảng được cấp/không được cấp, giao việc, gửi duyệt, yêu cầu sửa, duyệt hoàn thành, tải file và kết nối realtime. Kiểm tra migration với `PRAGMA foreign_key_check`.

Migration giữ nguyên tài khoản, mật khẩu, công việc cũ và checklist. Công việc cũ đã hoàn thành giữ trạng thái hoàn thành; việc chưa hoàn thành áp dụng luồng duyệt mới. Các cột/bảng mới được thêm theo cách chạy lại được. Không xóa các cột mới để rollback; nếu cần rollback cả DB, phải có kế hoạch bảo toàn những cập nhật phát sinh sau backup.

## Kiểm thử và xem thử

Trong `app/`, cài đúng `package-lock.json` bằng `npm ci`, sau đó chạy `npm test`.

Bộ kiểm thử sử dụng DB tạm riêng, bao gồm migration từ schema cũ, phân quyền endpoint và biến thể URL, duyệt nhân viên/leader, chặn tự động hóa bỏ qua duyệt, sao chép/di chuyển dữ liệu, công việc lặp, file, Planner, WebSocket và khả năng khôi phục sau hợp nhất.

Chạy demo độc lập:

```sh
DATA_DIR=/duong-dan-rieng/review-demo ADMIN_PASSWORD=codex-demo-2026 node scripts/seed-review-demo.mjs
DATA_DIR=/duong-dan-rieng/review-demo HOST=127.0.0.1 PORT=3100 node src/server.js
```

Tài khoản demo: `admin`, `leader.demo`, `staff.demo`; mật khẩu demo chung `codex-demo-2026`. Chỉ dùng trên DB demo riêng và cổng loopback. Script từ chối DB đã có bảng công việc.

## Giới hạn còn lại

Chưa làm ứng dụng iOS native, push APNs/FCM, đồng bộ lịch ngoài, offline sync, các chế độ Timeline/Map, chợ Power-Ups hoặc toàn bộ bộ máy Butler của Trello. Table hiện vẫn là bảng kê cơ bản; mô tả có toolbar Markdown và xem trước, chưa phải bộ soạn thảo WYSIWYG đầy đủ. Mirror trên web mở thẻ gốc để sửa; cần quyền cả bảng gốc và bảng đặt mirror. Chưa kiểm chứng gửi push thực tế hoặc AI trên production.

Máy Codex đã xác thực GitHub CLI và SSH theo lựa chọn của chủ dự án. Khóa riêng và thông tin đăng nhập chỉ lưu cục bộ, không nằm trong kho mã. Khi thiết lập một máy khác, cần cấp quyền cho máy đó và xác minh fingerprint máy chủ; không gửi khóa riêng/mật khẩu qua chat.

Thư viện `body-parser` được khóa ở bản 1.20.9 để nhận bản vá [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828).

## Xác nhận đợt triển khai 26/10/2026

- 21 nhóm kiểm thử đạt trong image production trên Node.js 22; `npm audit --omit=dev` không báo lỗ hổng đã biết tại thời điểm kiểm tra.
- Bản sao dữ liệu thật qua kiểm tra migration, cấp quyền và sao chép tất cả bảng đang mở; tài khoản đã khóa vẫn giữ tham chiếu lịch sử mà không được cấp lại quyền truy cập.
- Trước khởi động bản mới, đã so sánh dữ liệu ở 27 bảng gốc, ngoại trừ các quyền/thuộc tính hiển thị được thay theo kế hoạch đã chốt. Khóa VAPID giữ nguyên; kiểm tra SQLite và khóa ngoại đạt.
- Website trả đúng các file giao diện của bản phát hành; API chưa đăng nhập trả 401. Đã xem trực tiếp màn hình tổng quan, xác nhận ngày hạn trên lịch và Bảng kê được ẩn khi chuyển sang Planner.
- Quyền xem được giữ theo yêu cầu chủ dự án bằng quyền thành viên cụ thể. Việc chia team, chỉ định leader và thu hẹp quyền theo bảng sẽ do chủ dự án thiết lập trong giao diện.
