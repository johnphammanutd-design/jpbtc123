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
5. Đợt đối chiếu đã thêm bộ lọc nhiều người/nhiều nhãn theo một/tất cả lựa chọn, lọc hạn và hoạt động, thu gọn/mở rộng tất cả cột. “Việc của tôi” đã lấy toàn bộ thẻ được giao trên các bảng đang mở, có lựa chọn đang làm/đã xong/tất cả, bỏ giới hạn 100 của Planner. Chọn ảnh riêng từ Photos, share extension và một số thao tác sắp xếp nâng cao vẫn cần hoàn thiện.
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
| Lịch và bảng kê | Có mã | Cần UI kiểm tra lịch/thẻ không có ngày/bảng kê |
| Lọc từ khóa/người/nhãn/trạng thái/hạn/hoạt động | Có | Test logic nhiều điều kiện; UI đã mở bộ lọc, chọn nhân viên và nhận đúng 1/1 thẻ; các tổ hợp khác chưa thử UI |
| Thu gọn/mở cột, tất cả cột | Có mã | Chưa nghiệm thu thao tác tất cả cột |
| Tạo/đổi tên/sắp thứ tự cột, WIP, màu | Có mã | Chưa thử UI toàn bộ |
| Sắp xếp theo tên/hạn/mới tạo | Có mã | API hiện có; chưa thử từng lựa chọn native |
| Sao chép cột/chuyển tất cả/lưu trữ tất cả thẻ | Có mã | Cần UI kiểm tra hàng loạt và quyền |
| Tạo/sửa thẻ và mô tả Markdown | Có | UI xem; API tạo/sửa; Markdown mới hiển thị dạng hỗ trợ của SwiftUI, chưa có trình soạn thảo định dạng |
| Nhiều người phụ trách và người duyệt | Có | API kiểm tra giao việc, tự tham gia/rời, người nhận phải có quyền; UI xem người |
| Nhãn của thẻ và quản lý nhãn | Có mã | API/thẻ mẫu; chưa thử thêm/sửa/xóa nhãn native |
| Ngày bắt đầu/hạn/giờ/lặp/nhắc | Có | API lặp cuối tháng/reset checklist; UI đã thấy kỳ mới; biểu mẫu ngày/giờ vẫn nhập văn bản |
| Gửi duyệt → yêu cầu sửa → gửi lại → duyệt | Có | API đủ hai tầng; UI nhân viên→leader ở đợt đầu, giám đốc yêu cầu leader sửa ở đợt này; UI chặn ghi chú rỗng |
| Chặn tự duyệt, người khác duyệt thay không đúng quyền | Có | API âm tính + chính sách nút native |
| Sửa nội dung mở lại việc đã gửi duyệt | Có | API xác nhận; bình luận không làm mất trạng thái chờ duyệt |
| Checklist nhiều nhóm, người/hạn việc con, chuyển thành thẻ | Có | API nhóm/người/hạn và reset kỳ; cần UI chuyển việc con thành thẻ |
| Bình luận/sửa/xóa/@mention/phản ứng | Có | API bình luận và phản ứng; UI nhập/sửa cần thử thêm |
| Đính kèm link/tệp, tải có xác thực, Quick Look | Có | API upload/download, chặn ngoài quyền và sau thu hồi; UI file picker/Quick Look chưa nghiệm thu |
| Chọn ảnh trực tiếp từ Photos | Thiếu lối chọn riêng | Hiện dùng Files; không coi tương đương chọn thư viện Photos |
| Màu bìa/ảnh bìa từ đính kèm | Có mã | Cần thử ảnh lớn/định dạng ảnh trên iPhone |
| Trường tùy chỉnh chữ/số/ngày/select/checkbox | Có mã | Giá trị demo hiển thị; chưa thử UI mọi kiểu |
| Bình chọn/theo dõi/tham gia | Có mã | Chưa thử UI toàn bộ; nhắc đẩy nền ghi riêng |
| Sao chép thẻ, chọn nội dung giữ lại | Có mã | API nền đã có kiểm thử; chưa nghiệm thu UI mỗi lựa chọn |
| Di chuyển xuyên bảng | Có, còn khác UX web | API chặn không đủ quyền; danh sách đích native còn hiện cả bảng có quyền xem nên có thể chọn xong mới nhận lỗi |
| Thẻ đối xứng | Có | Đọc dữ liệu gốc/mở gốc theo quyền; test nguồn thành viên/nhãn/checklist; cần UI xuyên bảng |
| Hợp nhất thẻ | Có mã | Chưa thử UI và khôi phục thẻ nguồn sau hợp nhất |
| Mẫu thẻ | Một phần | Có đánh dấu mẫu và sao chép; thiếu thư viện/chọn mẫu riêng khi tạo thẻ |
| Sửa nhanh thẻ ngay trên bảng | Thiếu lối riêng | Hiện mở chi tiết thẻ để sửa |
| Lưu trữ/khôi phục thẻ và cột | Có mã | Cần thêm UI, nhất là thẻ nằm trong cột đã lưu trữ |
| Nhật ký bảng/thẻ, lịch sử duyệt | Có | Khớp tên sự kiện trong test; chưa nghiệm thu mọi loại sự kiện |
| Nền màu/ảnh của bảng | Một phần | Có lưu nền và ảnh thu nhỏ; ảnh nền chưa phủ màn hình Kanban |
| Sao chép/đóng/mở/xóa bảng | Có mã | Cần UI thử trên bảng demo có đủ dữ liệu |
| Xuất CSV/JSON và chia sẻ tệp | Có mã | Cần kiểm tra file xuất trong Files/Excel thực tế |
| Automation theo cột/lịch/hạn/nút | Có mã | Bộ tạo hành động cơ bản; chưa UI thử từng loại và mọi tổ hợp |
| AI tóm tắt/mô tả/checklist | Có mã | Chưa gọi nhà cung cấp trong kiểm thử, không phát sinh chi phí AI |
| Tìm kiếm toàn cục | Có | API không lộ thẻ sau thu hồi quyền; còn UI tìm kiếm |
| Inbox và chuyển thành thẻ | Có | API thực; UI cần thử sửa/ngày/chuyển |
| Kéo thả sắp xếp Inbox | Thiếu | Thứ tự hiện tại lấy từ server; chưa có thao tác native đổi thứ tự |
| Planner cá nhân và lịch tự động từ hạn | Có | API thực, phân biệt lịch cá nhân với lịch đến hạn; cần UI đổi ngày |
| Việc của tôi, đã hoàn thành và hơn 100 việc | Đã sửa | Test 121 thẻ; UI nhân viên chuyển Đang làm/Đã xong, thấy đúng thẻ demo tương ứng |
| Thông báo trong app | Có | API và ánh xạ tiếng Việt; cần UI mở thông báo/đánh dấu đã đọc |
| Cập nhật realtime/foreground | Có mã | Có kết nối lại; cần thử hai máy và mất mạng/khôi phục mạng |
| Liên kết chia sẻ thẻ | Có một phần | Web link và custom scheme; chưa Universal Links HTTPS |
| Push khi app đóng | Chưa có trên native | Web dùng Web Push; cần thêm APNs/Apple để phát native |
| Offline/đồng bộ lại | Chưa có | Không có hàng đợi ghi; API web hiện tại cũng không cung cấp đồng bộ xung đột |
| iPhone thật/TestFlight | Chưa thực hiện | Chưa có chứng chỉ/phân phối; Simulator không thay thế thử thiết bị thật |
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

Phần còn thiếu rõ nhất so với web: thư viện mẫu riêng, sửa nhanh trên bảng, kéo thả Inbox, lối chọn ảnh trực tiếp từ Photos, nền ảnh phủ Kanban và một số lựa chọn sắp xếp. Các đường xử lý còn lại đã có mã nhưng còn nhiều mục chưa nghiệm thu UI. Push nền APNs, Universal Links, offline và thử iPhone thật là các hạng mục riêng; không coi đợt đối chiếu này là hoàn tất toàn bộ app.
