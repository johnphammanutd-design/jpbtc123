# Kairetic iOS

Ứng dụng SwiftUI native cho công ty, dùng chung tài khoản và API tại `https://task.kairetic.com`. Không dùng WebView. Yêu cầu iOS/iPadOS 17 trở lên. Không có thư viện bên thứ ba.

## Chạy bằng Xcode

Mở `Kairetic.xcodeproj`, chọn scheme **Kairetic**, chọn iPhone Simulator rồi Run. Đăng nhập bằng tài khoản của hệ thống web. Scheme **Kairetic Demo** dùng riêng `http://localhost:3101` để kiểm thử với backend demo, không cần tài khoản Apple Developer trả phí.

Bản Release cố định máy chủ HTTPS của công ty. Token nằm trong Keychain, không lưu mật khẩu. 401 thu hồi phiên trên máy; đăng xuất xóa dữ liệu phiên và tệp xem trước. Tệp `/u/` được tải bằng Bearer và không gửi token sang liên kết bên ngoài. Không tự gửi lại thao tác ghi khi mất mạng.

Để thử trên iPhone cá nhân, đăng nhập Apple Account trong **Xcode → Settings → Accounts**, chọn **Personal Team** ở **Signing & Capabilities**, kết nối iPhone, chọn thiết bị rồi Run. Không cần gửi thông tin đăng nhập qua chat. Tài khoản miễn phí cần cài lại định kỳ; tài liệu Apple hiện nêu thời hạn provisioning 7 ngày: https://developer.apple.com/help/account/basics/about-your-developer-account.

TestFlight và phát hành có chữ ký cho nhiều nhân viên cần chuẩn bị Apple Developer Program và cấu hình phân phối. Dự án chưa có Development Team, chứng chỉ, provisioning profile hay khóa APNs; không coi tệp `.app` chưa ký là bản cài được lên điện thoại.

## Các màn hình đã có mã nguồn

- Tổng quan: tình hình toàn bộ bảng có quyền, số việc đang thực hiện/chờ duyệt/quá hạn/hoàn thành, theo team và việc cần duyệt.
- Task: bảng theo quyền, gắn sao, bảng đóng, việc đang phụ trách, chờ duyệt và tìm kiếm toàn cục.
- Bảng: Kanban chọn/vuốt cột, lịch, bảng kê, tìm kiếm/bộ lọc, tạo thẻ, kéo thả trong/giữa cột, thu gọn cột, menu cột, WIP/màu/vị trí, sắp xếp, sao chép/chuyển/lưu trữ thẻ hàng loạt.
- Thẻ: mô tả Markdown, ảnh/màu bìa, nhãn, nhiều người phụ trách, người duyệt, ngày bắt đầu/hạn/giờ/lặp/nhắc, checklist nhiều nhóm và việc con có người/hạn, trường tùy chỉnh.
- Gửi duyệt → yêu cầu sửa có ghi chú → duyệt hoàn thành. Quyền và công việc lặp do API quyết định; không đặt `due_complete=true` để bỏ qua duyệt.
- Bình luận: thêm/sửa/xóa theo quyền, phản ứng, @username, nhật ký hoạt động và lịch sử duyệt.
- Đính kèm: link, chọn tệp/ảnh, tải có xác thực, xem bằng Quick Look, chọn ảnh bìa, xóa đính kèm.
- Sao chép (chọn dữ liệu giữ lại), di chuyển, hợp nhất, thẻ đối xứng (mở nội dung gốc theo quyền), mẫu thẻ, tham gia/theo dõi, bình chọn, chia sẻ liên kết, lưu trữ/khôi phục.
- Menu bảng: quyền thành viên/quản lý, team phụ trách, cột quy trình duyệt, nhãn, trường, nền, tiện ích, tự động hóa theo cột/lịch/hạn/nút thẻ, kho lưu trữ, lịch sử, xuất CSV/JSON, sao chép, đóng/mở và xóa theo quyền.
- Inbox cá nhân và chuyển thành thẻ; Planner theo ngày. Lịch tự động từ hạn được phân biệt với lịch cá nhân, không cho “bỏ lịch” làm mất ngày hạn.
- Cá nhân: đổi mật khẩu; giám đốc quản lý tài khoản/team/nhiều leader. Không cố định ba team.
- AI: gọi tính năng có sẵn khi máy chủ bật AI; kết quả gợi ý không tự ghi lên thẻ.
- WebSocket: theo dõi bảng đang mở, kết nối lại và tải lại khi app trở về foreground.

## Giới hạn cần kiểm tra trước khi dùng trong công ty

Đây là bản phát triển native đầu tiên, chưa được xác nhận có trải nghiệm/độ hoàn thiện ngang web. Các chức năng trên mô tả mã nguồn hiện có, không phải biên bản nghiệm thu mọi màn hình.

1. Đã kiểm tra các luồng cơ bản trên iPhone 18 Pro mô phỏng (iOS 27.0) qua Xcode/Device Hub: đăng nhập nhân viên và leader, Tổng quan, bảng/cột, thẻ, gửi duyệt, leader duyệt, chuyển kỳ lặp và menu quản lý bảng. Cần kiểm tra thêm bàn phím/cuộn ở mọi biểu mẫu, kéo thả, Dynamic Type, VoiceOver, chế độ tối, màn hình nhỏ/lớn, quyền tệp/ảnh và chuyển app; chưa nghiệm thu toàn bộ chức năng hay chạy trên iPhone thật.
2. Thông báo trong app có dữ liệu thật; **push khi app đóng chưa có**. Backend hiện có Web Push, cần thêm APNs cho native và cấu hình Apple để hoàn thành mục này. Nhắc hạn không được hứa sẽ hiện ở nền iOS khi chưa làm bước đó.
3. Cần mạng để xem/lưu, chưa có bộ nhớ đệm ngoại tuyến hoặc hàng đợi đồng bộ.
4. Chia sẻ dùng liên kết web `#c/ID`; app cũng xử lý `kairetic://card/ID`. Universal Links HTTPS chưa được cấu hình.
5. Bộ lọc nhanh có các nhóm cơ bản; bộ lọc nhiều người/nhiều nhãn, thu gọn đồng loạt, giao diện chọn ảnh riêng từ Photos, tiện ích share extension và một số thao tác sắp xếp nâng cao cần tiếp tục hoàn thiện. “Việc của tôi” đang lấy các việc chưa hoàn thành từ Planner (giới hạn API 100); công việc đã hoàn thành vẫn xem được trong bảng.
6. Cần chọn phương án phân phối nội bộ và hoàn tất biểu mẫu/quyền riêng tư/cấu hình phát hành trước khi đưa lên TestFlight. Không suy ra rằng app nội bộ bắt buộc phải dùng Apple Enterprise.

## Kiểm chứng ngày 26/10/2026

- Build **Debug arm64 iOS Simulator**: thành công.
- Build **Release arm64 iPhoneOS** chưa ký: thành công.
- Swift Package: 10 test, không lỗi; gồm kiểm thử API mock và một luồng tích hợp thực bằng URLSession với backend demo riêng.
- Luồng tích hợp: nhân viên tạo thẻ/checklist, không thể hoàn thành tắt hoặc tự duyệt, leader yêu cầu sửa/duyệt, chuyển kỳ tháng 31/10 → 30/11 và reset checklist; tải tệp có xác thực, Inbox → thẻ → Planner, chặn bảng chưa có quyền.
- Không tạo dữ liệu thử trên production, không đổi phân quyền nhân viên trên production.
- Chạy trực tiếp bằng giao diện Xcode đã thành công trên **iPhone 18 Pro / iOS 27.0** trong Device Hub. Dùng tài khoản demo để gửi duyệt, đăng xuất, đăng nhập leader và duyệt công việc lặp: hạn 26/10 → 26/11, checklist vẫn đúng kỳ mới. Đã xem Tổng quan, bảng, thẻ và menu quản lý bảng. Không dùng dữ liệu production cho các thao tác này.
- Lệnh `simctl` và `xcodebuild -downloadPlatform iOS` từ sandbox của Codex báo không kết nối được CoreSimulatorService; đây không phải bằng chứng máy thiếu Simulator. Khi gặp lỗi này, mở dự án trong Xcode/Finder và Run trực tiếp. Xcode trên máy đã có thiết bị mô phỏng dùng được.

## Kiểm thử và tái tạo project

```sh
python3 generate-project.py
swift test --disable-sandbox
xcodebuild -project Kairetic.xcodeproj -scheme Kairetic -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath build CODE_SIGNING_ALLOWED=NO build
```

`generate-project.py` tái tạo project/plist/scheme từ nguồn; không chứa tài khoản ký. Chạy lại generator sẽ thay các thay đổi cấu hình đã chỉnh trực tiếp trong project; lưu lựa chọn Development Team riêng trước khi chạy lại.

Nếu môi trường sandbox không cho Swift mở sandbox con cho macro hệ thống, lệnh build dùng thêm `OTHER_SWIFT_FLAGS=-disable-sandbox`. Cờ này chỉ phục vụ trình biên dịch trong môi trường chạy hiện tại; không nới ATS hay quyền của app.

### Demo riêng cho kiểm thử tích hợp

Từ thư mục `app/`, tạo `DATA_DIR` mới có chữ `demo`, đặt `ADMIN_PASSWORD=codex-demo-2026`, chạy `scripts/seed-review-demo.mjs` rồi server với `HOST=127.0.0.1 PORT=3101`. Không chạy seed lên dữ liệu thật.

```sh
KAIRETIC_TEST_ORIGIN=http://localhost:3101 swift test --disable-sandbox
```

Scheme **Kairetic Demo** đã có biến môi trường này cho bước Run. Test tích hợp chỉ chấp nhận máy chủ loopback HTTP và dùng các tài khoản demo; biến không được đặt thì test này bỏ qua. Bản Debug app có thể đặt biến **KAIRETIC_API_ORIGIN=http://localhost:3101** trong Xcode Scheme để dùng demo; chỉ cho phép localhost/127.0.0.1. Bản Release không đọc biến này. Không đưa mật khẩu thật hoặc token vào Scheme.

## Cấu trúc

- `Core/`: JSON tương thích dữ liệu SQLite, snapshot bảng, lọc/sắp xếp, URLSession API.
- `App/`: SwiftUI, Keychain, WebSocket và các màn hình.
- `Tests/`: kiểm thử Foundation/API và luồng thực với backend demo.
- `Assets.xcassets/`: icon; `make-icon.swift` tạo icon từ hình học bằng Core Graphics.
