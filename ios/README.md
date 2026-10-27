# Kairetic iOS

Ứng dụng SwiftUI native cho công ty, dùng chung tài khoản và API tại `https://task.kairetic.com`. Không dùng WebView. Yêu cầu iOS/iPadOS 17 trở lên. Không có thư viện bên thứ ba.

## Chạy bằng Xcode

Mở `Kairetic.xcodeproj`, chọn scheme **Kairetic**, chọn iPhone Simulator rồi Run. Đăng nhập bằng tài khoản của hệ thống web. Scheme **Kairetic Demo** dùng riêng `http://localhost:3101` để kiểm thử với backend demo, không cần tài khoản Apple Developer trả phí.

Bản Release cố định máy chủ HTTPS của công ty. Token nằm trong Keychain, không lưu mật khẩu. 401 thu hồi phiên trên máy; đăng xuất xóa dữ liệu phiên và tệp xem trước. Tệp `/u/` được tải bằng Bearer và không gửi token sang liên kết bên ngoài. Không tự gửi lại thao tác ghi khi mất mạng.

Để thử trên iPhone cá nhân, đăng nhập Apple Account trong **Xcode → Settings → Accounts**, chọn **Personal Team** ở **Signing & Capabilities**, kết nối iPhone, chọn thiết bị rồi Run. Không cần gửi thông tin đăng nhập qua chat. Tài khoản miễn phí cần cài lại định kỳ; tài liệu Apple hiện nêu thời hạn provisioning 7 ngày: https://developer.apple.com/help/account/basics/about-your-developer-account.

Máy Mac phát triển đã cấu hình Personal Team và cài bản ký lên iPhone cá nhân; xem phạm vi kiểm tra ở cuối tài liệu. Để giữ lựa chọn Team khi tái tạo project, sao chép `Signing.local.xcconfig.example` thành `Signing.local.xcconfig`, điền Team ID của mình rồi mở lại project. Tệp local được Git bỏ qua; chứng chỉ/khóa riêng vẫn do Xcode và Keychain quản lý. Không đưa chứng chỉ, khóa riêng hoặc provisioning profile vào kho mã.

TestFlight và phát hành có chữ ký cho nhiều nhân viên cần chuẩn bị Apple Developer Program và cấu hình phân phối. Chưa có cấu hình TestFlight hay khóa APNs; bản cài Personal Team hiện tại phục vụ thử trên thiết bị cá nhân.

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

1. Đã kiểm tra các luồng cơ bản trên iPhone 18 Pro mô phỏng (iOS 27.0) qua Xcode/Device Hub: đăng nhập nhân viên và leader, Tổng quan, bảng/cột, thẻ, gửi duyệt, leader duyệt, chuyển kỳ lặp và menu quản lý bảng. Đợt Inbox ở cuối tài liệu đã thử kéo tay nắm, bàn phím phần mềm, một số biểu mẫu, chế độ tối và cỡ chữ trợ năng. Đã cài/chạy và đăng nhập hệ thống công ty trên iPhone thật, phạm vi ghi ở cuối tài liệu. Cần kiểm tra tiếp các biểu mẫu còn lại, kéo thả thẻ, VoiceOver, mọi cỡ màn hình, quyền tệp/ảnh và chuyển app; chưa nghiệm thu toàn bộ chức năng.
2. Thông báo trong app có dữ liệu thật; **push khi app đóng chưa có**. Backend hiện có Web Push, cần thêm APNs cho native và cấu hình Apple để hoàn thành mục này. Nhắc hạn không được hứa sẽ hiện ở nền iOS khi chưa làm bước đó.
3. Cần mạng để xem/lưu, chưa có bộ nhớ đệm ngoại tuyến hoặc hàng đợi đồng bộ.
4. Chia sẻ dùng liên kết web `#c/ID`; app cũng xử lý `kairetic://card/ID`. Universal Links HTTPS chưa được cấu hình.
5. Đợt đối chiếu đã thêm bộ lọc nhiều người/nhiều nhãn theo một/tất cả lựa chọn, lọc hạn và hoạt động, thu gọn/mở rộng tất cả cột. “Việc của tôi” đã lấy toàn bộ thẻ được giao trên các bảng đang mở, có lựa chọn đang làm/đã xong/tất cả, bỏ giới hạn 100 của Planner. Đợt hoàn thiện tiếp theo đã thêm thư viện mẫu, sửa nhanh, Photos và ảnh nền Kanban; đã bổ sung tiếp kéo sắp xếp Inbox và sắp xếp Bảng kê. Share extension vẫn chưa có; xem phần nghiệm thu UI mới nhất ở cuối tài liệu.
6. Cần chọn phương án phân phối nội bộ và hoàn tất biểu mẫu/quyền riêng tư/cấu hình phát hành trước khi đưa lên TestFlight. Không suy ra rằng app nội bộ bắt buộc phải dùng Apple Enterprise.

## Kiểm chứng ngày 26/10/2026

- Build **Debug arm64 iOS Simulator**: thành công.
- Build **Release arm64 iPhoneOS** chưa ký: thành công.
- Swift Package trước đợt đối chiếu: 10 test, không lỗi; gồm kiểm thử API mock và một luồng tích hợp thực bằng URLSession với backend demo riêng.
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

`generate-project.py` tái tạo project/plist/scheme từ nguồn. Debug và Release cùng đọc `Signing.xcconfig`, tệp này tùy chọn nạp `Signing.local.xcconfig`; generator không ghi đè tệp local. Chạy lại sẽ thay các thay đổi cấu hình đã chỉnh trực tiếp trong project, vì vậy lưu lựa chọn Development Team trong tệp local nếu muốn giữ. Khi không có tệp local, vẫn build Simulator bình thường và chọn Team trong Xcode khi cần cài lên thiết bị.

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

## Đối chiếu web và iOS — đợt kiểm tra 26/10/2026

Phạm vi: đối chiếu frontend web hiện tại (`app/public/index.html`, `work-features.js`), API/ACL (`server.js`, `work-routes.js`, `access.js`) và mã nguồn native `ios/`. Dữ liệu kiểm thử chỉ ở localhost:3101. Giữ nguyên dữ liệu và quyền của nhân viên trên production.

**Cách đọc:** “Có mã” chỉ xác nhận đường xử lý trong mã nguồn; “API” là kiểm thử thực bằng URLSession; “UI” là đã thao tác qua Xcode/Device Hub. Không coi “Có mã” là đã nghiệm thu đầy đủ màn hình.

### Những lỗi/khoảng thiếu đã xử lý trong đợt này

| Vấn đề trước kiểm tra | Kết quả sửa | Bằng chứng |
|---|---|---|
| Việc của tôi dùng Planner, thiếu việc đã xong và giới hạn 100 | Tổng hợp toàn bộ bảng được cấp quyền; chọn đang làm/đã xong/tất cả; báo lỗi nếu tải chưa đủ | Test 121 thẻ gồm việc đã xong, không trùng, không lấy người khác |
| Giám đốc tự gửi duyệt vẫn có thể thấy nút quyết định không hợp lệ | Chỉ hiện quyết định khi có tên trong danh sách người duyệt hợp lệ và khác người gửi | Test quyền native + API chặn tự duyệt |
| Leader qua team không lưu được phân quyền nếu thiếu quyền quản lý tường minh của chính mình | Giữ quyền quản lý cho leader trong dữ liệu gửi; khóa lựa chọn tự hạ quyền trên biểu mẫu | Luồng ba vai trò gọi cùng `AccessPayload` với app và qua API |
| Lọc ít lựa chọn hơn web | Thêm nhiều người/nhãn theo một hoặc tất cả, hạn 7 ngày/không hạn, hoạt động gần đây; xóa/hủy/áp dụng lọc | Test các kết hợp đúng/sai, người chưa giao, nhãn rỗng |
| Quá hạn chỉ xét ngày; ngày theo múi giờ thiết bị | Xét đúng giờ/phút theo giờ công ty Asia/Ho_Chi_Minh | Test 11:59/12:01 khi hiện tại 12:00 và qua nửa đêm Việt Nam |
| Thông báo/nhật ký duyệt hiện tên kỹ thuật thay tiếng Việt | Khớp `review_requested`, `review_submit`, `review_approve`, `review_request_changes`; kèm ghi chú yêu cầu sửa | Test tên sự kiện thực từ server |
| Vai trò leader không cập nhật sau thay đổi team | Tải lại `/me` cùng dữ liệu khi refresh | Đối chiếu mã; cần thêm thử UI thay vai trò ngay trong phiên |
| WIP hiển thị theo số thẻ đã lọc và vẫn hiện khi tắt tiện ích | Dùng tổng số thẻ thực của cột, tôn trọng tiện ích; hiển thị số kết quả lọc riêng | Đối chiếu mã; cần thêm thử kéo thả/WIP trực tiếp |
| Thiếu thao tác thu gọn đồng loạt, màu cột không phản ánh trên màn hình | Thêm mở/thu tất cả cột, hiển thị màu cột đã lưu | Có mã; thử UI nằm trong danh sách nghiệm thu |

### Ma trận tính năng

Web có các nhóm dưới đây trong mã nguồn; các giới hạn chung như APNs/offline được ghi riêng để tránh hiểu sai là tính năng web đã có.

| Nhóm tính năng | iOS sau đợt sửa | Mức kiểm chứng / phần còn lại |
|---|---|---|
| Đăng nhập/khôi phục phiên/đăng xuất | Có | UI nhân viên/leader ở đợt đầu; API phiên và khóa tài khoản; cần thử hết hạn Keychain trên thiết bị thật |
| Đổi mật khẩu; tạo/sửa/khóa tài khoản | Có mã | API quyền quản trị; chưa đổi mật khẩu bằng UI trong đợt này |
| Giám đốc thấy toàn bộ, leader theo team, nhân viên theo quyền bảng | Có | UI ba vai trò; API hai leader/team và nhân viên không tự có quyền từ team |
| Nhiều hơn 3 team | Có | API 4 team QA; UI giám đốc hiển thị tổng cộng 5 team demo |
| Tổng quan và thống kê theo team | Có | UI đợt đầu + API; chưa kiểm chứng từng chỉ số qua mọi trạng thái |
| Danh sách bảng, gắn sao, bảng đóng | Có mã | UI xem bảng; thao tác đóng/gắn sao cần kiểm thử bổ sung |
| Cấp quyền member/manager; giữ quyền leader | Có | API qua đúng hàm dựng dữ liệu native; UI leader đã mở và lưu thành công quyền bảng demo |
| Gắn bảng với team, cột chờ duyệt/hoàn thành/cần sửa | Có mã | API luồng duyệt; cần thử đổi cấu hình trực tiếp trên UI |
| Kanban vuốt/chọn cột | Có | UI đã thao tác |
| Kéo thả thẻ trong/giữa cột | Có mã | Test tính vị trí; chưa kiểm chứng cử chỉ kéo trên bản mới |
| Lịch và bảng kê | Đã thêm sắp xếp Bảng kê | UI đổi tên/hạn, tăng/giảm dần; năm trường có test logic; lịch vẫn cần nghiệm thu thêm |
| Lọc từ khóa/người/nhãn/trạng thái/hạn/hoạt động | Có | Test logic nhiều điều kiện; UI đã mở bộ lọc, chọn nhân viên và nhận đúng 1/1 thẻ; các tổ hợp khác chưa thử UI |
| Thu gọn/mở cột, tất cả cột | Có mã | Chưa nghiệm thu thao tác tất cả cột |
| Tạo/đổi tên/sắp thứ tự cột, WIP, màu | Có mã | Chưa thử UI toàn bộ |
| Sắp xếp theo tên/hạn/mới tạo | Có | Đã thử đủ ba lựa chọn menu native và thấy thứ tự đổi; API kiểm tra lưu và chặn nhân viên |
| Sao chép cột/chuyển tất cả/lưu trữ tất cả thẻ | Có mã | Cần UI kiểm tra hàng loạt và quyền |
| Tạo/sửa thẻ và mô tả Markdown | Có | UI xem; API tạo/sửa; Markdown mới hiển thị dạng hỗ trợ của SwiftUI, chưa có trình soạn thảo định dạng |
| Nhiều người phụ trách và người duyệt | Đã sửa luồng chọn | UI giám đốc giao leader, leader giao nhân viên qua hai bước; tải ứng viên duyệt sau khi lưu người phụ trách. API kiểm tra no-op/xung đột/thử lại |
| Nhãn của thẻ và quản lý nhãn | Có mã | API/thẻ mẫu; chưa thử thêm/sửa/xóa nhãn native |
| Ngày bắt đầu/hạn/giờ/lặp/nhắc | Có | API lặp cuối tháng/reset checklist; UI đã thấy kỳ mới; UI đã mở bộ chọn ngày/giờ và gỡ hạn cũng gỡ giờ; thay đổi thử được hủy, không đổi kỳ lặp của thẻ |
| Gửi duyệt → yêu cầu sửa → gửi lại → duyệt | Có | UI đủ vòng nhân viên→leader và leader→giám đốc; chặn ghi chú rỗng, nhân viên đọc được ghi chú, hai thẻ sang Hoàn thành; API xác nhận lịch sử |
| Chặn tự duyệt, người khác duyệt thay không đúng quyền | Có | API âm tính + chính sách nút native |
| Sửa nội dung mở lại việc đã gửi duyệt | Có | API xác nhận; bình luận không làm mất trạng thái chờ duyệt |
| Checklist nhiều nhóm, người/hạn việc con, chuyển thành thẻ | Có | API nhóm/người/hạn và reset kỳ; cần UI chuyển việc con thành thẻ |
| Bình luận/sửa/xóa/@mention/phản ứng | Có | API bình luận và phản ứng; UI nhập/sửa cần thử thêm |
| Đính kèm link/tệp, tải có xác thực, Quick Look | Có | API upload/download, chặn ngoài quyền và sau thu hồi; UI file picker/Quick Look chưa nghiệm thu |
| Chọn ảnh trực tiếp từ Photos | Đã thêm | UI mở Photos, chọn ảnh phong cảnh trong Simulator, tải lên và xem bằng Quick Look; có xử lý ảnh lớn/định dạng ở luồng riêng |
| Màu bìa/ảnh bìa từ đính kèm | Có mã | Cần thử ảnh lớn/định dạng ảnh trên iPhone |
| Trường tùy chỉnh chữ/số/ngày/select/checkbox | Có mã | Giá trị demo hiển thị; chưa thử UI mọi kiểu |
| Bình chọn/theo dõi/tham gia | Có mã | Chưa thử UI toàn bộ; nhắc đẩy nền ghi riêng |
| Sao chép thẻ, chọn nội dung giữ lại | Có mã | API nền đã có kiểm thử; chưa nghiệm thu UI mỗi lựa chọn |
| Di chuyển xuyên bảng | Có, còn khác UX web | API chặn không đủ quyền; danh sách đích native còn hiện cả bảng có quyền xem nên có thể chọn xong mới nhận lỗi |
| Thẻ đối xứng | Có | Đọc dữ liệu gốc/mở gốc theo quyền; test nguồn thành viên/nhãn/checklist; cần UI xuyên bảng |
| Hợp nhất thẻ | Có mã | Chưa thử UI và khôi phục thẻ nguồn sau hợp nhất |
| Mẫu thẻ | Đã thêm thư viện | Chọn mẫu ngay trong cột hoặc menu Thẻ mới, đặt tên/cột đích, chọn giữ người phụ trách. UI đã tạo bản sao; API kiểm tra đủ dữ liệu và reset hoàn thành |
| Sửa nhanh thẻ ngay trên bảng | Đã thêm | Nút bút chì/nhấn giữ thẻ mở sửa tên, ngày/giờ, nhãn. UI đã lưu đủ các trường đó; không hiện sửa trực tiếp cho thẻ đối xứng hoặc bảng đóng |
| Lưu trữ/khôi phục thẻ và cột | Có mã | Cần thêm UI, nhất là thẻ nằm trong cột đã lưu trữ |
| Nhật ký bảng/thẻ, lịch sử duyệt | Có | Khớp tên sự kiện trong test; chưa nghiệm thu mọi loại sự kiện |
| Nền màu/ảnh của bảng | Đã hiển thị Kanban | UI chọn ảnh nền từ Photos và thấy ảnh phủ khu vực Kanban; tiêu đề cột/nút dùng nền vật liệu để dễ đọc |
| Sao chép/đóng/mở/xóa bảng | Có mã | Cần UI thử trên bảng demo có đủ dữ liệu |
| Xuất CSV/JSON và chia sẻ tệp | Có mã | Cần kiểm tra file xuất trong Files/Excel thực tế |
| Automation theo cột/lịch/hạn/nút | Có mã | Bộ tạo hành động cơ bản; chưa UI thử từng loại và mọi tổ hợp |
| AI tóm tắt/mô tả/checklist | Có mã | Chưa gọi nhà cung cấp trong kiểm thử, không phát sinh chi phí AI |
| Tìm kiếm toàn cục | Có | UI nhân viên tìm được việc được giao, không thấy sentinel bảng riêng; ô nhập luôn hiện. API chặn bảng riêng/tìm kiếm |
| Inbox và chuyển thành thẻ | Có | UI sửa nhiều dòng, chọn ngày và lưu khi bàn phím mở; chuyển thành thẻ có API, chưa thử UI đợt này |
| Kéo thả sắp xếp Inbox | Đã thêm | UI đã kéo mục cuối lên đầu; API xác nhận thứ tự lưu, đăng nhập lại giữ thứ tự và chặn tài khoản khác. Menu và hành động trợ năng có mã, chưa thử bằng VoiceOver |
| Planner cá nhân và lịch tự động từ hạn | Có | API thực, phân biệt lịch cá nhân với lịch đến hạn; cần UI đổi ngày |
| Việc của tôi, đã hoàn thành và hơn 100 việc | Đã sửa | Test 121 thẻ; UI nhân viên chuyển Đang làm/Đã xong, thấy đúng thẻ demo tương ứng |
| Thông báo trong app | Có | UI nhân viên nhận/mở đúng yêu cầu sửa có ghi chú; thời gian đổi sang giờ công ty. Push nền vẫn chưa có |
| Cập nhật realtime/foreground | Có mã | Có kết nối lại; cần thử hai máy và mất mạng/khôi phục mạng |
| Liên kết chia sẻ thẻ | Có một phần | Web link và custom scheme; chưa Universal Links HTTPS |
| Push khi app đóng | Chưa có trên native | Web dùng Web Push; cần thêm APNs/Apple để phát native |
| Offline/đồng bộ lại | Chưa có | Không có hàng đợi ghi; API web hiện tại cũng không cung cấp đồng bộ xung đột |
| iPhone thật/TestFlight | Đã cài/chạy iPhone cá nhân | Personal Team, đăng nhập hệ thống thật; TestFlight chưa cấu hình. Xem đợt thử thiết bị ở cuối tài liệu |
| Giao diện tối/chữ lớn/VoiceOver/xoay ngang | Chưa nghiệm thu | Không suy từ build thành công rằng đã đạt khả năng tiếp cận |

### Kiểm thử ba vai trò bằng API native

`RoleAuditTests` dùng chính `API`, `ReviewCapabilities`, `AccessPayload` của app, gọi backend demo thực qua URLSession:

- Giám đốc quản lý tài khoản/team, ít nhất 4 team và 2 leader trong một team.
- Nhân viên chỉ vào bảng được cấp quyền; không tự cấp quyền, tạo team/tài khoản/cột quản lý.
- Leader có quyền quản lý theo team và có thể giao quyền bảng mà không tự hạ quyền.
- Việc của leader phải do giám đốc duyệt; leader khác và người thực hiện bị chặn.
- Yêu cầu sửa bắt buộc ghi chú; gửi lại và duyệt hoàn thành đúng trạng thái.
- Bình luận/phản ứng không làm mất chờ duyệt; sửa nội dung có mở lại quy trình.
- Thu hồi bảng chặn đọc bảng, định vị thẻ, tìm kiếm và tệp đã đính kèm.
- Khóa tài khoản làm token cũ nhận 401.

Các bảng/thẻ QA được xóa trong cleanup; tài khoản QA được khóa. Bốn team `[QA iOS]` trống được giữ trong **dữ liệu demo** để kiểm tra màn hình quản trị. Không áp dụng các thao tác này trên công ty thật.

### Kết quả chạy lại sau đối chiếu

- **17 test Swift qua, 0 lỗi**, bao gồm hai bài tích hợp API thực và các kiểm thử dữ liệu/quyền/bộ lọc. Bài 121 thẻ là kiểm thử tổng hợp dữ liệu trong bộ nhớ; không tạo 121 công việc vào công ty hay vào bản demo.
- Build **Release iPhoneOS arm64 chưa ký** thành công; bản Debug mới đã build và chạy lại trực tiếp bằng Xcode trên **iPhone 18 Pro / iOS 27.0**.
- UI leader: khôi phục phiên từ Keychain, mở bảng, lọc theo nhân viên thấy đúng 1/1 thẻ, mở phân quyền và lưu thành công mà giữ quyền quản lý.
- UI giám đốc: vào Tổng quan toàn công ty, mở công việc leader, không gửi được yêu cầu sửa khi trống ghi chú, điền ghi chú và chuyển công việc sang Cần chỉnh sửa; xem 5 team demo trong quản trị. Chưa thêm/sửa team hoặc tạo tài khoản bằng UI trong đợt này.
- UI nhân viên: đăng nhập, không có nút tạo bảng, vào Việc của tôi và chuyển Đang làm/Đã xong, thấy đúng việc đã duyệt. Việc hoàn thành dùng fixture `[DEMO QA]` tạo qua quy trình gửi/duyệt bình thường để giữ lại cho người dùng xem thử.
- Xcode có một phiên LLDB/Run bị kẹt khi thay app. Đã dừng tác vụ, đóng riêng Kairetic trong App Switcher, mở lại Xcode và chạy thành công; scheme **Kairetic Demo** hiện tắt **Debug executable** để thử giao diện. Scheme Kairetic bình thường vẫn dùng debugger. Không xóa dữ liệu Simulator hoặc sửa cài đặt bảo mật hệ thống.

Đợt bổ sung Inbox và Bảng kê bên dưới đã thêm kéo sắp xếp Inbox, sắp xếp Bảng kê theo năm trường/hai chiều. Các đường xử lý còn lại đã có mã nhưng còn nhiều mục chưa nghiệm thu UI. Push nền APNs, Universal Links, offline và thử iPhone thật là các hạng mục riêng; không coi đợt đối chiếu này là hoàn tất toàn bộ app.

## Hoàn thiện thao tác hằng ngày — 26/10/2026

### Đã bổ sung

1. **Thư viện mẫu ngay trong bảng:** nút Từ mẫu ở từng cột và Thẻ mới → Tạo thẻ từ mẫu. Chỉ lấy mẫu gốc đang hoạt động của bảng có quyền xem; cho chọn tên mới, cột đích, giữ/bỏ người phụ trách. Mô tả, nhãn, trường, checklist và đính kèm được sao chép qua API hiện có; thẻ mới không mang cờ mẫu, chưa hoàn thành và việc con chưa được đánh dấu xong. Ngày/giờ trong mẫu được giữ giống web, có thông tin nhắc ở biểu mẫu nếu mẫu có ngày hạn.
2. **Sửa nhanh trên Kanban:** nút bút chì trên thẻ hoặc nhấn giữ → Sửa nhanh. Có tên, bộ chọn ngày/giờ native, gỡ hạn và nhiều nhãn. Chỉ gửi trường đã đổi để tránh mở lại duyệt khi bấm Lưu mà không sửa gì. Trước khi lưu tải lại thẻ để phát hiện nội dung đã đổi từ máy khác. Đây là kiểm tra trước khi ghi, không thay thế khóa/version phía máy chủ. Nếu tên/ngày đã lưu nhưng nhãn lỗi mạng, biểu mẫu nói rõ phần đã lưu và cho thử lại.
3. **Photos trong đính kèm và nền bảng:** dùng bộ chọn ảnh hệ thống, tải file đã chọn vào thư mục tạm riêng, xử lý ảnh ở actor nền. Ảnh được xoay đúng chiều, thu nhỏ tối đa 2560 px, xuất JPEG và không mang GPS/EXIF của ảnh gốc. Giới hạn sau xử lý 25 MB cho đính kèm, 10 MB cho nền; không đọc toàn bộ ảnh gốc thành bitmap. Người dùng vẫn có Files để gửi tệp gốc. Ảnh Photos là ảnh tĩnh JPEG; không coi đây là đường giữ nguyên ảnh động/Live Photo.
4. **Ảnh nền Kanban:** tải bằng Bearer giống đính kèm, giới hạn khung theo kích thước màn hình, cắt ảnh phủ nền và dùng nền vật liệu dưới tiêu đề cột/nút. Không nhúng token vào URL ảnh hoặc mở rộng quyền đọc file.

### Kiểm chứng

- **23 test Swift/API qua, 0 lỗi**, gồm 3 bài tích hợp backend demo thực. Các test mới bao phủ lọc mẫu, trường sửa nhanh/no-op, phát hiện xung đột/thử lại sau ghi một phần, xử lý ảnh có GPS, giới hạn kích thước/dung lượng và ảnh hỏng.
- Luồng API mới: tạo mẫu có người/checklist có hạn/nhãn/đính kèm, sao chép có và không giữ người, xác nhận trạng thái mới chưa hoàn thành, sửa nhanh mở lại chờ duyệt, upload/download JPEG có xác thực và đổi nền; nhân viên bị chặn đổi nền bảng.
- Debug Simulator đã build và chạy bằng Xcode. Release iPhoneOS arm64 chưa ký đã build thành công; vẫn chưa có bản cài ký cho iPhone thật.
- UI đã mở thư viện mẫu, chọn mẫu có 2 việc con/1 đính kèm, tạo thẻ mới; dùng bút chì đổi tên thành `QA-EDIT-UI-01`, thêm ngày/giờ và nhãn, thấy kết quả trên bảng.
- UI đã mở Photos, chọn ảnh phong cảnh trong Simulator, thấy ảnh thành đính kèm và ảnh bìa, mở xem ảnh thành công bằng Quick Look; sau đó chọn ảnh nền từ Photos và thấy ảnh phủ Kanban.
- Toàn bộ thao tác dùng localhost:3101 và fixture demo. Không triển khai/sửa dữ liệu trên website production.

### Chưa coi là đã kiểm chứng

Chưa thử trên iPhone thật, iCloud Photos chậm, ảnh 100 MB, hết dung lượng máy, mọi định dạng ảnh hoặc giao diện chữ lớn/chế độ tối. Kiểm tra xung đột sửa nhanh đã có test logic, chưa thử đồng thời hai người trên hai thiết bị. APNs, offline, Universal Links và phân phối vẫn là các bước riêng.


## Inbox, Bảng kê và trải nghiệm iPhone — 26/10/2026

### Chức năng mới

- **Inbox:** bấm Sắp xếp rồi kéo tay nắm bên phải; có menu Đưa lên đầu/Đưa xuống cuối và thao tác trợ năng lên/xuống một vị trí. Trước khi ghi, tải danh sách mới nhất rồi áp dụng vị trí đích theo ID. Không làm mất mục vừa được thêm từ máy khác. Vị trí trùng hoặc hết khoảng số thực được đánh lại theo bước 1024. Nếu mất phản hồi sau ghi, tải lại thứ tự từ máy chủ; nếu chưa tải được thì khóa sắp xếp tới khi người dùng Tải lại. API hiện tại không có transaction/version cho nhiều PATCH; không coi kiểm tra phía app là khóa đồng thời trên server.
- **Bảng kê:** xếp theo cột, tên thẻ, người phụ trách (kể cả thẻ đối xứng), hạn gồm giờ hoặc hoàn thành; tăng/giảm dần. Thẻ chưa có hạn luôn ở cuối khi xếp theo hạn. Tiêu chí tên/người/cột dùng so sánh tiếng Việt và số tự nhiên. Đây là thứ tự xem riêng, không ghi vị trí Kanban. Các trường bằng nhau giữ thứ tự gốc.
- **Menu cột:** giữ ba kiểu sắp xếp đang có trên web: tên A→Z, hạn sớm trước, mới tạo trước. Ghi rõ áp dụng toàn bộ thẻ, kể cả thẻ đang bị lọc ẩn. Chỉ quản lý được dùng API sắp xếp toàn cột.
- **Nhập liệu:** có nút Ẩn bàn phím trên các màn nhập và vuốt cuộn để đóng bàn phím; ngày/giờ tùy chọn trong biểu mẫu dùng bộ chọn native, có thể gỡ; gỡ hạn cũng gỡ giờ, giờ chỉ bật khi đã có ngày. Planner bắt buộc chọn ngày.
- **Chữ lớn/màu:** nhãn và cụm nút tự xuống hàng, nhãn dùng chữ theo màu hệ thống thay vì màu vàng/nhạt khó đọc. Bộ chọn phân đoạn chuyển thành menu ở cỡ chữ trợ năng, thẻ và Bảng kê cho chữ xuống dòng, Tổng quan chuyển thành một cột. Sau thử UI, đã chỉnh màu nút/liên kết cho nền tối, tăng chiều cao ô soạn theo chữ và gom bộ lọc/cột/tạo thẻ vào menu ở chữ trợ năng để nhường diện tích cho thẻ; giữ tên cách xem trên một dòng.

### Đã kiểm chứng

- **30 test Swift/API qua, 0 lỗi**, gồm 4 bài tích hợp backend demo thực. Các test mới kiểm tra kéo lên/xuống/no-op, thay đổi danh sách từ máy khác, xóa đích kéo, vị trí trùng và hết độ chính xác; đủ năm trường Bảng kê, hai chiều, trường bằng nhau, hạn không đặt và người phụ trách thẻ đối xứng.
- API thực: thứ tự Inbox được giữ khi đăng nhập lại; tài khoản khác không nhìn thấy/sửa được mục Inbox đó. Ba kiểu sắp xếp cột lưu đúng thứ tự và không thay trạng thái hoàn thành; nhân viên bị chặn sắp xếp toàn cột.
- Debug Simulator và Release iPhoneOS arm64 chưa ký đã build thành công bằng xcodebuild. Bài kiểm tra Photos nay dùng bảng QA riêng để không thay ảnh nền demo đang dùng.
- **UI Xcode/Device Hub, iPhone 18 Pro / iOS 27.0:** đã kéo mục Inbox cuối lên đầu bằng tay nắm. Rời màn hình/chạy lại app vẫn đúng thứ tự; GET API xác nhận các mục 18 → 16 → 17, vị trí 0 → 1024 → 2048.
- **Bàn phím/biểu mẫu:** bật bàn phím iPhone trên màn hình, dùng nút ẩn bàn phím thành công; nhập/sửa nhiều dòng và bấm Lưu khi bàn phím mở, thấy nội dung và ngày 27/10 được lưu. Mở bộ chọn giờ trên thẻ, gỡ ngày hạn làm giờ về tắt và khóa chọn giờ; Hủy rồi xác nhận ngày/giờ gốc vẫn giữ nguyên.
- **Chế độ tối/chữ lớn:** thử Inbox, biểu mẫu soạn/sửa, Tổng quan, Task, Kanban, Bảng kê và bộ lọc với giao diện tối; tăng 6 mức chữ từ cỡ ban đầu tới cỡ trợ năng. Đã cuộn tới các trường/nút, xác nhận menu thay bộ chọn phân đoạn, nhãn xuống dòng và Tổng quan một cột. Thử lại các chỉnh sửa màu, ô soạn và thanh công cụ trực tiếp trong Xcode. Sau thử đã để Simulator ở giao diện sáng và cỡ chữ ban đầu.
- **Sắp xếp native:** đã chọn đủ tên A→Z, hạn sớm trước, mới tạo trước từ menu cột và thấy thẻ đổi thứ tự. Bảng kê mở đủ năm tiêu chí, đã đổi tên/hạn và hai chiều, xác nhận thẻ đầu danh sách thay đổi theo lựa chọn. Các tiêu chí còn lại có test logic, chưa thao tác UI mọi tổ hợp.
- Dữ liệu kiểm thử chỉ ở localhost:3101. Chưa kiểm tra thiết bị thật, VoiceOver đọc toàn luồng, mức chữ trợ năng lớn nhất hoặc mọi menu/mọi kích thước màn hình. Không coi các màn đã thử là nghiệm thu đầy đủ toàn app.


## Quy trình công ty qua ba vai trò — 26/10/2026

### Lỗi phát hiện và sửa trong khi thử UI

- Biểu mẫu cũ tải ứng viên người duyệt trước khi thay người phụ trách. Khi giám đốc chọn leader thực hiện, menu vẫn hiện leader và thiếu giám đốc; máy chủ chặn lựa chọn sai nhưng giao diện gây nhầm. Đã thay bằng hai bước: **lưu người phụ trách → tải danh sách hợp lệ từ API → chọn/lưu người duyệt**. Không suy đoán ứng viên từ vai trò trên máy. Khi bấm Tiếp tục, người phụ trách đã được lưu; Đóng ở bước hai không hoàn tác bước một, biểu mẫu ghi rõ điều này.
- Trước khi lưu người phụ trách, tải lại thẻ để tránh ghi đè thay đổi từ máy khác; bỏ qua PUT nếu không đổi người. Nếu đã lưu nhưng tải người duyệt lỗi, báo rõ phần đã lưu và cho thử lại. Trước khi lưu người duyệt, kiểm tra lại danh sách trên API. Không có ứng viên thì cho hoàn tất phân công và chọn người duyệt sau, không tạo quyền tự duyệt. Kiểm tra client không thay thế kiểm tra/khóa đồng thời phía server.
- Thông báo/nhật ký/bình luận/lịch sử duyệt đang hiện chuỗi UTC từ SQLite. Đã đổi hiển thị sang **Asia/Ho_Chi_Minh**, dạng ngày/tháng/năm giờ:phút; có test UTC, offset dương/âm, phần giây thập phân và qua nửa đêm.
- Ô tìm kiếm trước đó ẩn tới khi kéo xuống. Đã cho hiện luôn để người dùng có thể nhập ngay khi vào màn Tìm kiếm.

### Thao tác thực trong Xcode/Device Hub

Dùng iPhone 18 Pro / iOS 27.0 và ba tài khoản demo, toàn bộ thao tác ghi của quy trình dưới đây thực hiện trong giao diện app. Bảng riêng và thẻ sentinel dùng làm fixture kiểm tra ACL được chuẩn bị qua API demo.

1. **Giám đốc:** tạo bảng `[DEMO E2E] QA-ROLE-FLOW-01`, gắn Team thử nghiệm, cấp quyền Thành viên cho Nhân viên Demo. Leader nhận quyền quản lý từ team, không cần cố định số team. Tạo `QA-DIRECTOR-TO-LEADER-01`, giao Leader Demo và chọn Quản trị viên duyệt qua biểu mẫu mới.
2. **Leader:** đăng nhập, thấy bảng team với quyền Quản lý, không thấy `[DEMO E2E] Director-only`. Tạo `QA-LEADER-TO-STAFF-01`, giao Nhân viên Demo và chọn Leader Demo duyệt. Gửi công việc riêng lên giám đốc; không có nút tự duyệt.
3. **Nhân viên:** không có nút tạo bảng, chỉ thấy các bảng được cấp quyền với vai trò Thành viên. Tìm `QA-PRIVATE-NOT-VISIBLE` không có kết quả; tìm `QA-LEADER-TO-STAFF-01` có đúng kết quả. Biểu mẫu thành viên chỉ cho thay đổi tham gia/rời bằng tài khoản của mình. Gửi duyệt việc được giao, không có nút tự duyệt.
4. **Leader:** mở việc nhân viên trong Cần bạn duyệt. Bấm yêu cầu sửa mà không ghi chú bị chặn. Nhập `QA-ADD-RESULT-01` và gửi; thẻ thành Cần chỉnh sửa.
5. **Nhân viên:** mở thông báo có nguyên ghi chú của leader, bổ sung mô tả `QA-RESULT-UPDATED-01`, lưu và gửi duyệt lại.
6. **Leader:** thấy nội dung đã sửa, duyệt hoàn thành công việc nhân viên. **Giám đốc:** đăng nhập, mở việc leader gửi và duyệt hoàn thành.

### Đối chiếu dữ liệu và phạm vi

- API xác nhận hai thẻ ở trạng thái `approved`, `due_complete=1`, cột Hoàn thành. Thẻ leader có chuỗi **leader gửi → giám đốc duyệt**; thẻ nhân viên có chuỗi **nhân viên gửi → leader yêu cầu sửa có ghi chú → nhân viên gửi lại → leader duyệt**. Nội dung sửa, người phụ trách và người duyệt khớp UI.
- API xác nhận nhân viên là member, leader là manager qua team; leader và nhân viên GET bảng riêng bị 403, tìm kiếm không trả thẻ sentinel. Không sửa quyền/dữ liệu production. Hai thẻ đã duyệt được giữ trên bảng demo cho người dùng xem lại.
- **36 test Swift/API qua, 0 lỗi**, gồm 5 bài tích hợp thực trên backend demo. Các test bổ sung bảo vệ thứ tự lưu người→tải ứng viên, no-op giữ chờ duyệt, thử lại sau lỗi tải và xung đột giao việc; test giờ công ty gồm qua ngày.
- Debug Simulator đã build/chạy trực tiếp bằng Xcode; Release iPhoneOS arm64 chưa ký đã build thành công. UI đã xác nhận giờ công ty trong thông báo/nhật ký/lịch sử và ô tìm kiếm hiện ngay, chi tiết bên dưới.
- Chưa thử iPhone thật, push nền APNs, mạng chập chờn trên hai thiết bị đồng thời hoặc mọi tổ hợp phân quyền/nhiều người phụ trách bằng UI. Đây là nghiệm thu các kịch bản nêu trên, không phải tuyên bố hoàn tất toàn bộ app.


### Xác nhận giao diện trên bản cuối

- Thông báo giám đốc hiển thị lần gửi của leader là `26/10/2026 19:54`; nhật ký/lịch sử thẻ nhân viên hiện các mốc 19:58 → 20:01 → 20:03 → 20:06 theo giờ công ty. Ghi chú yêu cầu sửa `QA-ADD-RESULT-01` vẫn hiện đầy đủ.
- Mở Tìm kiếm đã thấy ô nhập ngay, không kéo xuống; nhập tên thẻ đã duyệt vẫn tìm và mở được.
- App đang đăng nhập giám đốc demo, ở bảng `[DEMO E2E] QA-ROLE-FLOW-01` → cột Hoàn thành với đủ hai công việc, để người dùng xem lại. Giao diện sáng và cỡ chữ thông thường.

## Cài và mở trên iPhone thật — 26/10/2026

- **iPhone 16 Pro Max / iOS 27.0.1**, Kairetic **0.1.0 (1)**, scheme **Kairetic**, máy chủ `https://task.kairetic.com`.
- Người dùng tự đăng nhập Apple Account, bật Developer Mode, đồng ý tạo chứng chỉ/hồ sơ và tự tin cậy chứng chỉ trên iPhone. Xcode tạo Apple Development và managed provisioning profile trong Personal Team, build/ký/cài thành công. Sau bước tin cậy, Xcode báo **Running Kairetic on iPhone** và Device Hub hiển thị màn hình đăng nhập của app.
- Người dùng tự đăng nhập tài khoản công ty trong app. Đã thấy Tổng quan có thống kê, Task có danh sách bảng theo tài khoản, mở một bảng sản xuất ở Kanban và mở chi tiết thẻ có mô tả/checklist/thành viên/ngày/nhãn. Việc của tôi tải xong và hiện trạng thái Không có công việc cho tài khoản đang thử. Không suy ra số việc của toàn công ty từ màn này.
- Những thao tác trên hệ thống thật chỉ đăng nhập và xem; không tạo thẻ thử, sửa nội dung, giao việc, đổi quyền hoặc gửi/duyệt công việc production. Luồng ghi qua ba vai trò trước đó vẫn là nghiệm thu trên backend demo, chưa thử toàn bộ trên iPhone thật.
- Đã xác minh chữ ký của `.app` bằng `codesign --verify --strict`. Metadata trong profile kèm app có thiết bị đang thử và hạn **02/11/2026 21:57:54 (Asia/Ho_Chi_Minh)**; sau hạn cần build/cài lại bằng Xcode với Personal Team, không phải thời hạn của tài khoản công ty hay dữ liệu trên server.
- Lựa chọn Team của Mac này nằm trong `Signing.local.xcconfig`, được Git bỏ qua. Project/generator đọc cấu hình này cho cả Debug/Release. `plutil` kiểm tra project hợp lệ; `xcodebuild -showBuildSettings` xác nhận cả hai cấu hình đọc Team và giữ bundle `com.kairetic.task`, ký Automatic. Không lưu Apple Account, UDID, khóa riêng hoặc provisioning profile trong kho mã.
- Chưa cấu hình TestFlight/APNs, chưa thử mọi chức năng, ảnh/tệp thực, mạng yếu hoặc VoiceOver trên thiết bị này. Đợt cài thiết bị chỉ đổi cấu hình ký/tài liệu, không đổi logic nghiệp vụ; kết quả 36 test Swift/API của bản trước vẫn được ghi ở phần trên.

## Quy trình trên iPhone thật và web công ty — 26/10/2026

Sau đợt cài ban đầu, người dùng đồng ý thử quy trình trên một bảng riêng và tự đăng nhập quản trị trên web. Đợt này có thao tác ghi trên hệ thống thật, giới hạn ở **bảng QA mới số 7** và **thẻ thử số 29**; không thao tác sửa công việc, team hoặc quyền của các bảng cũ. Bảng QA không gắn team, quản trị giữ quyền quản lý và tài khoản đang dùng trên iPhone được cấp Thành viên chỉ cho bảng mới.

### Kết quả thao tác thực

1. **Web quản trị:** tạo bảng QA với Cần làm / Đang làm / Chờ duyệt / Hoàn thành, tạo thẻ `[QA iPhone] Kiểm tra quy trình duyệt — 01`, giao tài khoản nhân viên trên iPhone và chọn quản trị làm người duyệt sau khi lưu người thực hiện.
2. **iPhone 16 Pro Max / iOS 27.0.1:** app khởi động lại vẫn khôi phục phiên, Việc của tôi có thẻ vừa giao. Mở thẻ thấy đúng mô tả, người phụ trách và người duyệt. Gửi duyệt thành công; thẻ thành Chờ duyệt, nhân viên không có nút tự duyệt.
3. **Web quản trị:** gửi yêu cầu sửa với ghi chú `QA-IPHONE-CHANGE-01`. iPhone nhận thông báo có đầy đủ ghi chú và thời gian theo giờ công ty.
4. **iPhone:** mở thẻ từ thông báo, sửa mô tả thành `QA-IPHONE-01: Da bo sung ket qua theo yeu cau sua. Du lieu thu rieng.` và lưu. Web đọc lại đúng nội dung; iPhone gửi duyệt lần hai thành công.
5. **Web quản trị:** duyệt hoàn thành. Giao diện xác nhận Đã duyệt hoàn thành và checkbox Hoàn thành được chọn. Lịch sử có đúng **nhân viên gửi → quản trị yêu cầu sửa có ghi chú → nhân viên gửi lại → quản trị duyệt**. Nội dung bổ sung vẫn giữ nguyên.
6. **iPhone:** nhận thông báo được duyệt, mở ra đúng thẻ Đã duyệt; nhật ký có các tác giả/hành động/thời gian tương ứng. Việc của tôi → Đã xong có thẻ thử. Giữ bảng và thẻ QA để người dùng xem lại.

### Lỗi thông báo được phát hiện và sửa

Trước sửa, chạm thông báo trên iPhone đánh dấu đã đọc nhưng không mở thẻ. Dòng `NavigationLink` gắn thêm `simultaneousGesture` để gọi API đọc thông báo. Đã bỏ gesture trên dòng và chuyển đánh dấu đã đọc sang task của màn chi tiết sau khi điều hướng; thông báo vốn đã đọc không gửi lại thao tác này.

- Build Debug arm64 iPhoneOS thành công; Xcode đã ký/cài/chạy bản sửa lên cùng iPhone và giữ phiên công ty.
- UI kiểm tra lại thông báo yêu cầu sửa **đã đọc**: mở được đúng thẻ cần chỉnh sửa.
- UI kiểm tra thông báo hoàn thành mới **chưa đọc**: mở được thẻ đã duyệt, đánh dấu riêng thông báo đó; badge vẫn còn thông báo giao việc chưa đọc.
- Không thêm test mô phỏng cử chỉ bằng logic Foundation. Kiểm chứng bản sửa bằng build và thao tác thực trên thiết bị; bộ 36 test trước đó không chạy lại trong đợt chỉ sửa điều hướng này.

Đợt này kiểm tra **hai phía nhân viên iPhone và quản trị web**, chưa thay thế nghiệm thu mọi vai trò/mọi thao tác trên iPhone. Không thay đổi backend production, không thêm APNs/offline/TestFlight. Bảng thử: `https://task.kairetic.com/#b/7`; thẻ thử: `https://task.kairetic.com/#c/29` (vẫn yêu cầu đăng nhập và quyền truy cập).

## Chuẩn bị kiểm tra độ ổn định — 26/10/2026

- Tạo riêng **thẻ QA số 30** trong bảng QA số 7, giao cùng tài khoản nhân viên trên iPhone, mô tả có mã `QA-WEB-02`. Thẻ đã duyệt số 29 giữ nguyên. Đính kèm `qa-iphone-access.txt`, chỉ chứa nội dung giả lập, để thử tải tệp và thu hồi quyền. Web báo tải lên thành công; GET URL tệp không có phiên bị chặn **HTTP 401**.
- Xcode đã khởi động lại riêng app trên iPhone; màn Tổng quan trở lại với phiên công ty đã khôi phục, không yêu cầu nhập lại mật khẩu. Điều này xác nhận khôi phục phiên sau lần chạy lại đó, chưa xác nhận mọi trường hợp chuyển nền/mất mạng.
- Thêm **2 test API qua URLSession với URLProtocol giả lập**, đều qua: POST gặp không có mạng / mất kết nối / timeout / hủy phải trả lỗi và chỉ phát một request; tải tệp nhận HTTP 403 phải trả lỗi quyền, không trả nội dung lỗi làm dữ liệu xem trước. Registry của stub tách theo đường dẫn UUID và có khóa để không lẫn giữa các tình huống. Các test này không kết nối production và không thay thế thử mất mạng trên iPhone thật.
- Kiểm thử điều khiển thiết bị đang dừng ở kết nối: Device Hub nhận được hình nhưng các lần chạm không chuyển tab; nối lại phiên hiển thị và chạy lại app vẫn chưa giải quyết. Phản chiếu iPhone yêu cầu khóa điện thoại và bật Wi-Fi trên Mac, trong khi Mac đang dùng Ethernet và Wi-Fi tắt. Chưa thay cài đặt Wi-Fi khi chưa được người dùng đồng ý.
- **Chưa nghiệm thu trong đợt này:** đồng bộ hai chiều khi app đang mở, lưu khi mất mạng, thu hồi/khôi phục quyền bảng và tệp, chuyển nền/mở lại. Chưa thực hiện thu hồi quyền của bảng QA; quyền bảng cũ không được sửa. Thẻ 30 và tệp chỉ là dữ liệu chuẩn bị cho các bước còn lại.

## Kiểm tra ổn định trên Simulator — 27/10/2026

Do điều khiển iPhone thật qua Device Hub/Phản chiếu iPhone chưa hoạt động ổn định, đợt này chuyển sang **iPhone 18 Pro / iOS 27.0 Simulator**, backend demo loopback riêng. Bảng `[DEMO STABILITY] QA-SYNC-01`, tài khoản demo và tệp văn bản giả lập được dùng để tránh sửa quyền/dữ liệu công ty. Các kết quả dưới đây chưa thay thế nghiệm thu trên iPhone thật.

- **Sửa lỗi mất cập nhật khi mở thẻ:** màn bảng đang rời đi có thể hủy đăng ký realtime của màn thẻ vừa mở. Mỗi màn nay có chủ sở hữu đăng ký riêng; chỉ được gỡ đăng ký của chính mình. Đã thấy mô tả do web lưu tự xuất hiện trên thẻ đang mở; sửa từ app rồi kiểm tra lại trên web cũng khớp.
- **Sửa lỗi tệp vẫn mở khi bị thu hồi quyền:** trước bản sửa, Quick Look còn hiển thị tệp đã tải sau khi nhân viên bị gỡ khỏi bảng. Nay app đóng xem trước, xóa tệp tạm và nội dung thẻ, hiện thông báo không còn quyền; kết quả tải cũ đang chờ cũng không được mở lại nội dung. API demo trả **403** cho bảng, vị trí thẻ và tệp khi quyền bị thu hồi. Sau khi cấp lại quyền thành viên, app tải lại thẻ và hiện nút tệp. Quyền demo đã được khôi phục.
- **Ngắt kết nối trong lúc lưu:** proxy chỉ lắng nghe loopback được đặt giữa app Debug và demo, cắt kết nối nhưng không thay mạng trên máy. Lưu `QA-OFFLINE-01` báo “Đã mất kết nối mạng.” và giữ tên trong biểu mẫu; máy chủ có 0 thẻ. Nối lại không tự gửi thao tác ghi. Bấm lưu lại tạo đúng 1 thẻ; proxy ghi nhận một POST bị ngắt và một POST chuyển thành công. Đây là lỗi kết nối giả lập, chưa phải thử tắt Wi-Fi/4G trên iPhone thật.
- **Bàn phím ngoài:** biểu mẫu EditSheet hỗ trợ Command-S. Đã dùng phím tắt để thực hiện cả lần lưu lỗi và lần thử lại thành công; thao tác vẫn đi qua cơ chế chặn lưu đồng thời của biểu mẫu.
- **Chạy nền/mở lại:** đưa app về Home, sửa mô tả thẻ ở backend demo rồi mở Kairetic từ Home; thẻ hiện mô tả mới. Xcode khởi động lại app với cấu hình demo chuẩn, Tổng quan hiện phiên nhân viên đã khôi phục mà không cần đăng nhập lại.
- **Kiểm chứng:** **41 test Swift/API qua, 0 lỗi**, gồm 3 test mới về chuyển màn/giải phóng đăng ký realtime. Debug Simulator build và chạy bằng Xcode; Release iPhoneOS arm64 chưa ký build thành công.
- Scheme **Kairetic Demo** đã đưa về `http://localhost:3101`; cấu hình proxy tạm `3102` không được lưu vào project. Wi-Fi trên Mac đã đưa lại trạng thái **tắt** sau lần bật tạm được người dùng đồng ý.

Phần còn lại trên thiết bị thật: lặp lại đồng bộ hai chiều, lỗi lưu khi đổi mạng, thu hồi/khôi phục quyền trong lúc xem tệp và chuyển nền. Không kết luận các tình huống này đã qua trên iPhone thật từ kết quả Simulator.

Sau khi người dùng mở khóa thiết bị, Xcode đã cài và chạy bản sửa `289bd9e` bằng scheme **Kairetic** trên **iPhone 16 Pro Max / iOS 27.0.1**. Device Hub hiển thị Tổng quan với phiên công ty được khôi phục, không cần đăng nhập lại. Thử chuyển Task từ Mac vẫn không được điện thoại nhận; phần nghiệm thu tương tác tiếp tục cần thao tác trực tiếp trên iPhone. Lần cài này chưa chứng minh các tình huống ổn định còn lại đã qua trên thiết bị thật.

Người dùng sau đó mở trực tiếp thẻ QA số 30 trên iPhone. Web lưu mô tả `QA-WEB-LIVE-03: Da cap nhat tu web khi the dang mo tren iPhone.`; Device Hub cho thấy chính mô tả mới tự xuất hiện khi màn thẻ vẫn mở, không kéo để tải lại hay khởi động lại app. Đã xác nhận **web → iPhone thật** cho lần cập nhật này.

Ở chiều ngược lại, người dùng sửa mô tả và bấm Lưu trực tiếp trên iPhone. Đóng/mở lại thẻ 30 ở web đọc được `QA-WEB-LIVE-04: Da luu tu iphone`, khớp nội dung hiển thị trên điện thoại. Đã xác nhận **iPhone thật → web** cho lần lưu này; chỉ mô tả thẻ QA số 30 được sửa.

## Sửa thông báo chặn thao tác khi mất mạng — 27/10/2026

Khi người dùng ngắt mạng trên iPhone rồi quay về app, lần tự tải dữ liệu trong `scenePhase.active` bật hộp thoại “Kết nối internet có vẻ như không hoạt động”. Device Hub cho thấy hộp thoại phủ màn thẻ, chưa ở biểu mẫu sửa; vì vậy không ghi nhận lần này là thử lưu offline thành công.

- Lỗi tải tự động khi quay về app nay hiện thông báo phía trên, có Thử lại/Đóng và không che thao tác. Lỗi hết phiên vẫn đi qua cơ chế đăng xuất/cảnh báo hiện có. Thông báo kết nối được xóa sau lần tải thành công hoặc đăng xuất.
- Thử lại trên Simulator/demo: đưa app về Home, ngắt proxy loopback, mở lại Kairetic. Thông báo phía trên xuất hiện, không có hộp thoại chặn; vẫn mở Sửa mô tả và nhập được bản nháp. Lưu trả “Đã mất kết nối mạng.”, giữ bản nháp, máy chủ vẫn giữ mô tả cũ. Nối lại không tự lưu; bấm Lưu lại thì biểu mẫu đóng và mô tả mới khớp máy chủ. Proxy ghi nhận đúng một PATCH bị ngắt và một PATCH chuyển thành công.
- Debug Simulator và Release iPhoneOS arm64 chưa ký đều build thành công. Đợt này chỉ sửa xử lý lỗi/hiển thị khi app hoạt động lại; không đổi Core/API. Bộ 41 test đã qua ở đợt trước; nghiệm thu bản sửa này bằng luồng UI vừa mô tả.
- Scheme demo được đưa lại về cổng 3101, proxy trở về online. Trên iPhone thật vẫn cần thử lại mở Sửa, lưu khi ngắt mạng và lưu lại sau khi kết nối phục hồi với bản mới.
