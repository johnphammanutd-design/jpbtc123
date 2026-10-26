# Tình trạng dự án — Bảng công việc công ty (Trello nội bộ)

## Cập nhật iOS — 26/10/2026

Đã bổ sung tiếp thư viện mẫu trong bảng, sửa nhanh qua bút chì/nhấn giữ, chọn ảnh Photos cho đính kèm và ảnh nền, hiển thị nền ảnh Kanban. **23 test Swift/API qua**; đã thử các thao tác này trong Xcode, gồm tạo thẻ từ mẫu, sửa tên/ngày/giờ/nhãn, tải ảnh Photos lên/xem Quick Look và đổi nền bằng Photos. Ảnh được tối ưu/loại metadata trước khi gửi; dùng dữ liệu demo riêng, không sửa production. Chi tiết và giới hạn nằm ở mục “Hoàn thiện thao tác hằng ngày” trong `ios/README.md`.

Đợt đối chiếu tiếp theo đã sửa danh sách Việc của tôi (bỏ giới hạn 100, thêm việc đã xong), bộ lọc nhiều người/nhãn/hạn/hoạt động, giữ quyền quản lý khi leader lưu phân quyền, nút duyệt theo danh sách hợp lệ, giờ quá hạn theo công ty, tên sự kiện tiếng Việt và cập nhật vai trò trong phiên. **17 test Swift qua**, gồm hai luồng tích hợp backend demo thực; đã thử UI cả ba vai trò, lưu quyền leader, giám đốc yêu cầu sửa có ghi chú, danh sách 5 team và nhân viên xem việc đã xong. Ma trận tính năng và phần chưa có/chưa kiểm chứng nằm trong [ios/README.md](../ios/README.md#đối-chiếu-web-và-ios--đợt-kiểm-tra-26102026). Không đổi dữ liệu hoặc quyền production.

Đã thêm ứng dụng SwiftUI native trong `ios/`, kết nối cùng API/tài khoản/phân quyền với web. Có các màn hình Tổng quan, Task/bảng/thẻ/gửi duyệt, Inbox/Planner, thông báo và quản trị team/tài khoản; menu bảng/thẻ bao phủ nhiều chức năng hiện có. Đã build Debug Simulator và Release iPhoneOS chưa ký; 10 test Swift/API (gồm luồng backend demo thực) qua. Đã chạy qua giao diện Xcode trên iPhone 18 Pro mô phỏng (iOS 27.0); kiểm tra đăng nhập nhân viên/leader, bảng/thẻ/menu và luồng nhân viên gửi duyệt → leader duyệt → công việc lặp chuyển kỳ. Lỗi CoreSimulatorService từ sandbox dòng lệnh không cản chạy trực tiếp bằng Xcode. Chưa kiểm thử trên iPhone thật hoặc nghiệm thu mọi màn hình. Chưa có push nền APNs, chữ ký/phân phối hay kiểm chứng đầy đủ mức tương đương web. Người dùng hiện chưa có Apple Developer trả phí; không cản việc phát triển/build. Chi tiết chức năng, giới hạn và cách chạy: [ios/README.md](../ios/README.md).

## Cập nhật Codex — 26/10/2026 (đã triển khai web)

Bản web/API mới đã thêm phân quyền bảng/team/leader, quy trình gửi duyệt/yêu cầu sửa/duyệt hoàn thành, checklist nhiều nhóm có người và hạn, sửa bình luận/phản ứng, sao chép dữ liệu đầy đủ hơn, công cụ thao tác cột, tổng quan theo team và các sửa lỗi lịch/Planner/nhắc hạn/công việc lặp. Đã qua 21 nhóm kiểm thử trên Node.js 22 trong image triển khai, kiểm tra migration/sao chép trên bản sao dữ liệu thật và kiểm tra giao diện production bằng Chrome. Đây là nền web/API cho mobile; chưa phải app iOS native.

**Phân quyền production:** phiên bản mới yêu cầu cấp quyền cho mọi bảng; không còn tự cho mọi nhân viên xem bảng workspace. Theo lựa chọn của chủ dự án, quyền xem hiện tại đã được giữ bằng các quyền thành viên cụ thể; chưa tự gán team hoặc leader. Chi tiết, kế hoạch cấp quyền và quy trình backup/cập nhật nằm tại [trien-khai-phan-quyen-va-duyet.md](trien-khai-phan-quyen-va-duyet.md).

Máy Mac đã xác thực GitHub CLI và SSH production. Mã ứng dụng `19d10ef` đã được đẩy lên nhánh làm việc và triển khai tại https://task.kairetic.com. Đã sao lưu trước chuyển, đối chiếu dữ liệu gốc và giữ khóa VAPID. Ảnh Docker cũ được giữ để có thể quay lại khi cần. Các mô tả “đã ngang Trello”, “75 API đủ mobile” và mô hình phân quyền hai tầng trong tài liệu bàn giao cũ là tình trạng trước đợt kiểm tra này, không phải kết luận của bản hiện tại.


*Cập nhật: 15/10/2026. File này để bất kỳ phiên Claude nào (local/VPS) hoặc thành viên đội
mở ra là nắm được toàn bộ, không cần đọc lại lịch sử chat.*

## Dự án là gì

Hệ thống quản lý mục tiêu/task tự host kiểu Trello cho công ty ~15–20 người
(công ty vận hành kênh YouTube Dad Revenge). Toàn bộ code nằm trong repo này,
nhánh làm việc: **`claude/trello-like-task-system-xuc1bz`**.

## Đã hoàn thành (tất cả đã test + push)

### Ứng dụng `app/` — clone bộ tính năng Trello, bản v3
- **Stack**: Node.js + Express + SQLite (1 file, WAL) + WebSocket; frontend 1 file
  HTML thuần không cần build (`app/public/index.html`); Docker + docker-compose.
- **Tài khoản**: đăng nhập theo phiên, admin tạo/khóa người dùng, đổi/đặt lại mật khẩu.
- **Board**: nhiều board, phông nền 8 màu, gắn sao, đóng/mở lại, menu board.
- **Thẻ**: kéo-thả chuẩn Trello (pointer-based, thẻ nghiêng 4°, placeholder,
  FLIP animation, thả bay về chỗ — đã kiểm chứng bằng REA từng con số),
  ảnh bìa, nhãn có tên theo board, nhiều thành viên/thẻ (avatar), hạn chót +
  đánh dấu hoàn thành, checklist, đính kèm link, bình luận, sao chép,
  lưu trữ/khôi phục (không xóa thẳng).
- **Chế độ xem Lịch** theo hạn chót; **bộ lọc** (từ khóa/người/nhãn/hạn);
  **tìm kiếm toàn cục** nhảy thẳng tới thẻ.
- **Automation kiểu Butler**: rule "thẻ vào cột X → hoàn thành hạn / tick checklist /
  gắn nhãn / gán người", chạy server-side.
- **Nhật ký hoạt động**: 16 loại sự kiện, theo board và theo thẻ.
- **Realtime**: WebSocket đẩy thay đổi tới mọi người đang mở board; không phá thao tác kéo.
- **Bảo mật**: sai mật khẩu 5 lần → khóa 15 phút; phiên hết hạn 30 ngày;
  security headers (CSP…); cổng 3000 chỉ bind loopback.

### Công cụ kèm theo
- `app/scripts/seed-youtube-board.mjs` — dựng board mẫu "Sản xuất video"
  (Ý tưởng → Kịch bản → Sản xuất → Duyệt → Đã đăng, 6 nhãn, 1 rule, 4 thẻ [MẪU]).
- `app/scripts/rea-verify.mjs` — kiểm chứng kéo-thả bằng REA + Playwright (regression).
- `deploy/auto-deploy.sh` — triển khai VPS một lệnh (xem bên dưới).

### Tài liệu `docs/`
| File | Nội dung |
|---|---|
| `nghien-cuu-trello-va-cac-lua-chon-ma-nguon-mo.md` | Nghiên cứu Trello + Planka/WeKan/Kanboard…, kế hoạch 4 tuần |
| `nghien-cuu-repo-clone-giao-dien-tinh-nang.md` | screenshot-to-code, open-lovable, codebase MIT đáng mượn |
| `danh-gia-repo-rea-reverse-engineer-anything.md` | Đánh giá REA (morluto/rea) |
| `workflow-rea-tich-hop.md` | Pipeline REA đã chạy thật + số liệu kiểm chứng drag |
| `trien-khai-task-kairetic.md` | Triển khai VPS từng lệnh (DNS, Docker, HTTPS 2 nhánh, backup) |
| `huong-dan-su-dung-cho-doi.md` | Hướng dẫn 3 phút cho nhân viên |
| `tinh-trang-du-an.md` | File này |

## Trạng thái triển khai — ĐÃ LÊN MẠNG 16/10/2026, ĐÃ DỜI SANG VPS MỚI cùng ngày

- **https://task.kairetic.com đang chạy trên VPS MỚI 139.180.145.29** (DNS đổi 16/10
  theo kế hoạch tách VPS; app + toàn bộ dữ liệu dời bằng `deploy/migrate-task-to-new-vps.sh`
  chạy từ VPS cũ qua khóa `/root/.ssh/migrate_tmp`). Nginx + certbot (hết hạn 13/01/2027,
  tự gia hạn), Docker container `app-kanban-1`, cổng 3000 chỉ loopback, code `/root/jpbtc123`,
  cron backup 2h sáng. **Dự phòng trên VPS cũ 149.28.132.148**: volume `app_kanban-data`
  + `/data/backup-final-migrate.db`, container đã stop — đúng trạng thái lúc dời.
  PC Render 02 vào VPS mới bằng cách SSH qua VPS cũ (khóa migrate_tmp).
- Phiên Claude local (PC Render 02, khóa `~/.ssh/vultr`) đã deploy bằng
  `deploy/deploy-from-pc.sh` (gọi `auto-deploy.sh` trên VPS, idempotent).
- Mật khẩu admin sinh ngẫu nhiên lần đầu, lưu tại **`/root/task-admin-login.txt`**
  trên VPS (không nằm trong chat/repo). Xem bằng:
  `ssh -i ~/.ssh/vultr root@149.28.132.148 "cat /root/task-admin-login.txt"`
- Board mẫu "Sản xuất video" đã seed (5 cột, 6 nhãn, 1 rule, 4 thẻ [MẪU]).
- Cron backup 2h sáng đã đặt + đã chạy thử OK. **Lưu ý WAL**: backup phải qua
  `scripts/backup-db.mjs` (better-sqlite3 `.backup()`), copy file `.db` trần
  sẽ thiếu dữ liệu trong `-wal` — cron hiện tại đã đúng. Backup chỉ nằm trên
  chính VPS, chưa có bản ngoài máy (rủi ro đã biết toàn VPS).
- Hai sửa lỗi deploy đã push: Dockerfile copy `scripts/` vào image;
  cron trong `auto-deploy.sh` không chết vì `pipefail` khi crontab rỗng.

## Việc còn lại sau khi deploy (theo thứ tự)

1. ~~Đăng nhập admin → đổi mật khẩu → tạo tài khoản cho 15–20 thành viên.~~
   **Xong 16/10/2026** (user tự làm; file `/root/task-admin-login.txt` trên VPS
   giờ chứa mật khẩu cũ, không còn giá trị).
2. Gửi đội `docs/huong-dan-su-dung-cho-doi.md` + link https://task.kairetic.com.
3. **Pilot 2 tuần** với 1 nhóm, đo 3 số: % task nằm trên board; % thẻ có người
   phụ trách + hạn; số task trễ hạn (dùng Nhật ký hoạt động + bộ lọc có sẵn).
4. ~~Sau pilot mới quyết tính năng đợt 2.~~ **User quyết làm đợt 2 ngay 16/10/2026**
   (bỏ nguyên tắc chờ pilot). Đã xây và test local (REA PASS), gồm:
   - **Thông báo 🔔**: chuông + số chưa đọc; sự kiện gán việc, @mention trong bình luận
     (@tên-đăng-nhập), bình luận vào thẻ mình tham gia, thẻ bị chuyển cột, nhắc hạn
     (quét mỗi giờ: đến hạn hôm nay/mai + trễ ≤3 ngày, mỗi thẻ+ngày nhắc 1 lần); realtime qua WS kênh user.
   - **URL riêng từng thẻ**: `#c/<id>` (nút 🔗 Link trong thẻ), `#b/<id>` cho board, `#planner`.
   - **Upload file**: nút 📤 trong thẻ (≤25MB, lưu `/data/uploads`, tên file ngẫu nhiên không đoán được;
     HTML/SVG bị ép tải về chống XSS); ảnh đầu tiên tự thành ảnh bìa; nút 🖼 đặt ảnh bìa từ đính kèm.
   - **Inbox 📥**: thu việc cá nhân nhanh, đặt ngày (hiện trong Planner), chuyển thành thẻ trên board.
   - **Planner 🗓**: lịch tuần cá nhân, kéo thẻ của mình vào ngày (HTML5 DnD), đổi tuần, bỏ lịch.
   - **AI ✨** (cần `ANTHROPIC_API_KEY` trong `app/.env`, model mặc định claude-haiku-5-5):
     tóm tắt thẻ, viết mô tả, gợi ý checklist — server-side, nút tự ẩn khi chưa có key.
   - **Power-ups 🔌 per board** (Menu → Tiện ích): 👍 Vote trên thẻ, 🚦 giới hạn WIP mỗi cột
     (bấm số đếm để đặt, vượt là đỏ), bật/tắt AI.
   Còn lại cho đợt sau: Table/Timeline view, kéo-thả sắp xếp cột, board riêng tư, quick edit, phím tắt.
   User cũng dự định gửi video/ảnh giao diện mẫu để tinh chỉnh animation thêm.

5. **Đợt 3 — xây 16-17/10/2026** sau khi đào sâu Trello bản mới bằng Claude in Chrome
   (tài khoản đăng nhập của user) + REA đo Trello thật qua CDP (xác nhận ghost 4° trùng app ta;
   xem `nghien-cuu-trello-dao-sau.md` mục 2b/2c):
   - **Màu nền cột** (10 màu Trello, menu cột ⋯), **thu gọn cột** (dải dọc, lưu theo người dùng),
     **sắp xếp thẻ trong cột** (hạn/tên/mới tạo), **lưu trữ cột** chuyển vào menu ⋯.
   - **Hoàn thành cả thẻ**: nút ○ trên thẻ (hover) → ✓ xanh; **sửa nhanh ✎** đổi tiêu đề không mở thẻ.
   - **Bộ lọc mở rộng**: Không có ai / Của tôi / Không nhãn / Đã–Chưa hoàn thành.
   - **Theo dõi thẻ 👁**: nhận thông báo mọi bình luận/di chuyển/hoàn thành dù không là thành viên.
   - **CSS kéo-thả theo số liệu REA đo Trello thật**: placeholder viền đứt nét, cột đích sáng viền.
   REA drag regression PASS sau toàn bộ thay đổi.

6. **Đợt 4 — 17/10/2026**: Butler đầy đủ (automation **theo lịch** hằng ngày/tuần: sort cột,
   lưu trữ thẻ xong; **theo ngày hạn**: quá hạn/trước hạn 1 ngày → nhãn/chuyển cột, dedupe;
   **nút thẻ tùy chỉnh**: chuỗi hành động 1 chạm); **hợp nhất thẻ ⇄**; **Table view "Bảng kê"**
   sort được; **kéo-thả cột** bằng tay cầm ⠿. Audit lần 2: mục 2d tài liệu đào sâu.

7. **Đợt 5 — 17/10/2026**: **ngày bắt đầu + giờ hết hạn** (badge 🕐 dd/mm HH:MM),
   **hạn định kỳ 🔁** (hoàn thành xong tự dời hạn ngày/tuần/tháng + un-check checklist),
   **mức nhắc từng thẻ** (không/0/1/2/7 ngày trước), **theo dõi cả board 👁** (kể cả thẻ mới),
   **thu gọn/mở rộng tất cả cột**, **sao chép board**, **tham gia/rời thẻ 1 chạm**,
   **xuất CSV** (BOM, mở Excel). REA PASS.

8. **Đợt 6 — 17/10/2026** (đóng gần hết audit 2d): **Trường tùy chỉnh** (chữ/số/ngày/danh sách
   chọn — quản lý trong Menu board, điền trong thẻ, giá trị hiện thành chip trên mặt thẻ);
   **Mẫu thẻ 📋** (đặt trong thẻ, dùng qua nút ⧉ đáy cột); **Thẻ đối xứng 🪞** (mirror sang board
   khác, tự đồng bộ tiêu đề/hạn/trạng thái từ gốc, bấm mở thẻ gốc, gỡ bằng ✕);
   **Board riêng tư 🔒** (Menu → Hiển thị & thành viên: chỉ thành viên board + admin thấy/mở,
   chặn cả tìm kiếm và link); **Nền ảnh** (upload ≤10MB trong Menu → Phông nền).
   Chủ động bỏ: email-tới-bảng (cần hạ tầng mail), nhãn dán/sticker (ít giá trị công việc),
   Jira/Power-ups bên thứ ba/nối lịch ngoài (hệ sinh thái Atlassian). REA PASS.

## Ghi chú cho phiên Claude kế tiếp

- Chạy local: `cd app && npm install && npm start` → localhost:3000 (admin/admin123
  với DB mới). Test UI: cần Chromium headless + `app/scripts/rea-verify.mjs`.
- Mọi thay đổi: commit + push lên đúng nhánh `claude/trello-like-task-system-xuc1bz`.
- Dữ liệu production nằm trong Docker volume `kanban-data` trên VPS — backup cron
  2h sáng đã nằm trong auto-deploy.sh. Migration trong `app/src/db.js` tự chạy
  khi nâng version, an toàn với dữ liệu cũ.
- Định hướng chung từ user: làm chính xác, dựa dữ liệu, không xây thừa —
  tính năng mới phải xuất phát từ nhu cầu thật của đội sau khi dùng.
