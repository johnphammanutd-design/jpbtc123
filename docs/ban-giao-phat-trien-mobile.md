# Bàn giao — phát triển ỨNG DỤNG DI ĐỘNG cho Bảng công việc (task.kairetic.com)

*Ngày 25/10/2026. Dành cho phiên Codex/agent trên máy khác: đọc file này là đủ bối cảnh
để xây mobile app bám vào backend hiện có, không cần đọc lịch sử chat nào.
Tình trạng tổng của dự án: `tinh-trang-du-an.md`; nghiên cứu Trello: `nghien-cuu-trello-dao-sau.md`.*

## 0. Việc cần làm

Xây **ứng dụng di động** (khuyến nghị React Native/Expo hoặc Flutter — chưa chốt, người làm tự đề xuất)
dùng **nguyên backend hiện có** làm API server. KHÔNG viết lại backend — nó đang chạy production
cho đội ~15–20 người tại https://task.kairetic.com. Web hiện tại đã là PWA cài được lên điện thoại,
mobile app native là bước nâng trải nghiệm (độ mượt kéo-thả, push ổn định hơn trên iOS).

## 1. Công nghệ hiện tại

| Lớp | Công nghệ |
|---|---|
| Backend | Node.js ≥20 (Docker chạy node:22-alpine), **Express 4**, ESM (`"type":"module"`) |
| DB | **SQLite 1 file** qua **better-sqlite3 v12**, WAL mode, migration tự chạy khi boot (`src/db.js`) |
| Realtime | **ws** (WebSocket) tại `/ws` |
| Push | **web-push** (VAPID tự sinh, lưu `DATA_DIR/vapid.json`) |
| AI | Gọi thẳng `api.anthropic.com` server-side, model mặc định `claude-haiku-5-5` |
| Frontend web | **1 file** `public/index.html` — HTML/CSS/JS thuần, KHÔNG build step, không framework |
| PWA | `public/manifest.webmanifest`, `public/sw.js`, icon sinh bằng `scripts/make-icons.mjs` |
| Đóng gói | Docker + docker-compose (`app/Dockerfile`, `app/docker-compose.yml`), volume `kanban-data` mount `/data` |

Toàn bộ backend nằm trong **`app/src/server.js` (~1500 dòng)** + **`app/src/db.js`** (schema/migrations).
Đọc 2 file đó là hiểu 100% hệ thống.

## 2. Mã nguồn & cách chạy

- Repo: `https://github.com/johnphammanutd-design/jpbtc123.git`
- Nhánh làm việc DUY NHẤT: **`claude/trello-like-task-system-xuc1bz`** — mọi thay đổi commit + push vào đây.
- Chạy local:
  ```
  cd app && npm install && npm start     # → http://localhost:3000
  ```
  DB mới tự tạo tài khoản `admin`/`admin123` (đổi bằng env). Dữ liệu ở `app/data/kanban.db`.
- Dữ liệu mẫu: `node scripts/seed-youtube-board.mjs` (board quy trình video),
  `node scripts/seed-sim-team.mjs` (đội giả lập 6 người + 16 thẻ + nhật ký 3 tuần — rất hợp để dev UI),
  gỡ bằng `scripts/remove-sim-team.mjs`.
- Kiểm chứng kéo-thả web (regression, không bắt buộc cho mobile): `scripts/rea-verify.mjs`
  (cần Chrome headless cổng 9222 + CLI `rea-agents`; trên Windows xem comment đầu file).
- Docker local: `cd app && docker compose up -d --build`.

## 3. Cấu trúc database (SQLite, tất cả trong `src/db.js`)

Bảng chính (cột quan trọng; `*` = thêm bởi migration, mặc định an toàn với DB cũ):

- **users**: id, username (unique), name, password_hash (`scrypt salt:hash`), is_admin, disabled, created_at
- **sessions**: token (PK, 64 hex), user_id, created_at — hết hạn sau `SESSION_TTL_DAYS` (30) ngày
- **boards**: id, title, position, background (`blue|ocean|…` hoặc `url:/u/<file>`), closed,
  powerups (JSON `{vote,wip,ai}`), visibility (`workspace|private`)
- **lists**: id, board_id, title, position, archived, wip_limit, color (hex hoặc '')
- **cards**: id, list_id, title, description, due_date (`YYYY-MM-DD`), due_time (`HH:MM`),
  start_date, recur (`''|daily|weekly|monthly`), remind (`none|0d|1d|2d|7d`), due_complete,
  cover (màu hex hoặc `url:/u/<file>`), position (REAL — chèn giữa = trung bình 2 bên),
  archived, is_template, mirror_of (id thẻ gốc hoặc NULL), created_at
  — còn 2 cột legacy không dùng: assignee_id, labels
- **labels**: id, board_id, name, color, position · **card_labels**: (card_id, label_id)
- **card_members**: (card_id, user_id) · **card_watchers**: (card_id, user_id) · **board_watchers**: (board_id, user_id)
- **board_members**: (board_id, user_id) — chỉ có nghĩa khi board private
- **checklist_items**: id, card_id, text, checked, position
- **comments**: id, card_id, user_id, text, created_at
- **attachments**: id, card_id, url (link ngoài hoặc `/u/<file>`), name, created_at
- **activity**: id, board_id, card_id, user_id, type (17 loại — xem `activityText()` trong index.html), data (JSON), created_at
- **notifications**: id, user_id, actor_id, type (`assigned|mention|comment|moved|due_soon|due_overdue|completed|created`), board_id, card_id, data (JSON), read, created_at
- **automation_rules**: board_id, trigger_list_id, actions JSON `{due_complete,check_all,label_id,member_id,cover}`
- **auto_schedules**: board_id, cadence (`daily|weekly`), weekday (1=T2…7=CN), actions JSON `{sort:{list_id,by}}|{archive_done_list_id}`, last_run
- **due_rules**: board_id, trigger (`overdue|due_tomorrow`), actions `{label_id,move_list_id}` · **due_rule_applied**: dedupe (rule_id, card_id)
- **card_buttons**: board_id, name, actions `{move_list_id,due_shift_days,label_id,complete}`, position
- **board_fields**: id, board_id, name, type (`text|number|date|select`), options (JSON mảng), position · **card_field_values**: (card_id, field_id, value)
- **card_votes**: (card_id, user_id) · **board_stars**: (user_id, board_id)
- **inbox_items**: id, user_id, text, date, position — inbox cá nhân
- **planner_slots**: (user_id, card_id) PK, date — lịch tuần cá nhân
- **push_subs**: id, user_id, endpoint (unique), sub_json

Vị trí sắp xếp dùng chuẩn "position REAL, bước 1024, chèn giữa = (a+b)/2" cho boards/lists/cards/labels.

## 4. Đăng nhập & phân quyền

- `POST /api/login {username,password}` → `{token, user:{id,username,name,is_admin}}`.
  Token = 32 byte hex, lưu bảng sessions. **Sai 5 lần → khóa IP+username 15 phút** (HTTP 429).
- Mọi API sau đó: header **`Authorization: Bearer <token>`**. 401 = token hỏng/hết hạn (30 ngày).
- `POST /api/logout` xóa token. `GET /api/me` trả user hiện tại. `POST /api/me/password {current,password}` đổi mật khẩu.
- **Phân quyền** (đơn giản, 2 tầng):
  - `is_admin`: tạo/khóa user + đặt lại mật khẩu (`/api/users*`), xóa board; thấy mọi board kể cả private.
  - Board `visibility='private'`: chỉ người có trong `board_members` (hoặc admin) — chặn ở
    danh sách board, `GET /api/boards/:id` (403), `/api/cards/:id/locate`, `/api/search`.
  - Ngoài ra mọi user đăng nhập làm được mọi thứ trên board họ thấy (mô hình tin nhau nội bộ).
- File upload phục vụ tại `GET /u/<24hex>.<ext>` **không cần auth** — bảo vệ bằng tên file không đoán được
  (kiểu link đính kèm Trello). HTML/SVG bị ép `Content-Disposition: attachment` chống XSS.

## 5. API hiện có (75 endpoint — đủ cho mobile, không cần thêm gì để ra MVP)

Tất cả JSON trừ ghi chú khác. Lỗi: `{error:"thông điệp tiếng Việt"}` + status 4xx/5xx.

**Tài khoản**: `POST /api/login` · `POST /api/logout` · `GET /api/me` · `POST /api/me/password`
· `GET /api/users` · admin: `POST /api/users {username,name,password,is_admin}` · `PATCH /api/users/:id {password?|disabled?|is_admin?|name?}`

**Boards**: `GET /api/boards` (kèm card_count, starred) · `POST /api/boards {title,background}` (tự tạo 4 cột)
· `PATCH /api/boards/:id {title?|background?|closed?|powerups?|visibility?}` · `DELETE /api/boards/:id` (admin)
· `GET /api/boards/:id` — **payload chính**: `{board, lists, cards, checklist, commentCounts, attachmentCounts,
labels, cardLabels, cardMembers, rules, voteCounts, myVotes, myWatches, watchingBoard, schedules, dueRules,
cardButtons, boardMembers, fields, fieldValues}`; thẻ mirror đã được phủ sẵn dữ liệu gốc
· `POST /api/boards/:id/star` · `POST /api/boards/:id/watch` · `POST /api/boards/:id/copy`
· `PUT /api/boards/:id/members {user_ids}` · `GET /api/boards/:id/archived` · `GET /api/boards/:id/activity`
· `GET /api/boards/:id/export.csv` (text/csv) · `POST /api/boards/:id/background?name=x.png` (body = bytes ảnh, ≤10MB)

**Lists**: `POST /api/lists {board_id,title}` · `PATCH /api/lists/:id {title?|position?|archived?|wip_limit?|color?}`
· `POST /api/lists/:id/sort {by: title|due|created}` · `DELETE /api/lists/:id`

**Cards**: `POST /api/cards {list_id,title}` · `PATCH /api/cards/:id` (nhận title, description, due_date,
start_date, due_time, recur, remind, due_complete, cover, archived, is_template, list_id, position —
đây là endpoint kéo-thả: gửi `{list_id, position}`; hoàn thành thẻ có recur sẽ tự dời hạn)
· `POST /api/cards/:id/copy {list_id?}` · `DELETE /api/cards/:id` · `GET /api/cards/:id/locate` → `{board_id}`
· `POST /api/cards/:id/join` · `POST /api/cards/:id/watch` · `POST /api/cards/:id/vote`
· `POST /api/cards/:id/merge {target_id}` · `POST /api/cards/:id/mirror {list_id}`
· `POST /api/cards/:id/apply-button/:buttonId` · `GET /api/cards/:id/activity`
· labels/members: `PUT /api/cards/:id/labels {label_ids}` · `PUT /api/cards/:id/members {user_ids}`
· field: `PUT /api/cards/:id/field/:fieldId {value}` ('' = xóa)

**Checklist/Comment/Đính kèm**: `POST /api/cards/:id/checklist {text}` · `PATCH /api/checklist/:id {text?|checked?}`
· `DELETE /api/checklist/:id` · `GET|POST /api/cards/:id/comments {text}` (bình luận hỗ trợ `@username` → notification mention)
· `GET|POST /api/cards/:id/attachments {url,name?}` · `DELETE /api/attachments/:id`
· **Upload file**: `POST /api/cards/:id/upload?name=<tên-gốc>&cover=1?` — body = raw bytes (Content-Type tùy ý,
≤25MB), KHÔNG multipart; trả `{url:"/u/…"}`; ảnh đầu tiên tự thành cover

**Nhãn**: `POST /api/boards/:id/labels {name,color}` · `PATCH /api/labels/:id` · `DELETE /api/labels/:id`

**Automation**: `POST /api/boards/:id/rules {trigger_list_id,actions}` · `DELETE /api/rules/:id`
· `POST /api/boards/:id/schedules {cadence,weekday,actions}` · `DELETE /api/schedules/:id`
· `POST /api/boards/:id/due-rules {trigger,actions}` · `DELETE /api/due-rules/:id`
· `POST /api/boards/:id/buttons {name,actions}` · `DELETE /api/buttons/:id`
(server tự chạy automation trong tick mỗi giờ — mobile không cần làm gì)

**Fields**: `POST /api/boards/:id/fields {name,type,options?}` · `DELETE /api/fields/:id`

**Thông báo**: `GET /api/notifications` → `{notifications[≤50], unread}` · `POST /api/notifications/read {ids?}` (không ids = đọc hết)

**Push**: `GET /api/push/key` → VAPID public key · `POST /api/push/subscribe {subscription}` (PushSubscription JSON)
· `POST /api/push/unsubscribe {endpoint}` — mobile native có thể dùng chính Web Push qua WebView/Expo
hoặc đăng ký endpoint FCM riêng (sẽ cần thêm cột platform — việc của đợt mobile)

**Khác**: `GET /api/search?q=` (≥2 ký tự, tôn trọng board private) · Inbox: `GET|POST /api/inbox`,
`PATCH|DELETE /api/inbox/:id`, `POST /api/inbox/:id/convert {list_id}` · Planner: `GET /api/planner`,
`PUT /api/planner {card_id,date}`, `DELETE /api/planner/:cardId`
· AI: `GET /api/ai/status` → `{enabled}` · `POST /api/ai/card/:id {action: summary|describe|checklist}` → `{text}`

**Deep link**: web dùng hash `#c/<cardId>`, `#b/<boardId>`, `#planner` — mobile nên map scheme tương tự
(push payload có `url: "/#c/<id>"`).

## 6. Cập nhật thời gian thực

- WebSocket: `wss://task.kairetic.com/ws?token=<token>` (dev: `ws://localhost:3000/ws?token=…`).
- Client gửi: `{"type":"watch","boardId":<id|null>}` để chọn board đang xem.
- Server đẩy: `{"type":"board-changed","boardId"}` (reload board đang xem) ·
  `{"type":"boards-changed"}` (reload danh sách board) ·
  `{"type":"comments-changed","cardId"}` · `{"type":"notification"}` (refresh chuông — gửi theo user, mọi socket của user đó).
- Mẫu client chuẩn: xem `connectWS()` trong `public/index.html` (tự reconnect sau 3s).
- Web Push: mọi notification trong app đồng thời đẩy tới các thiết bị đã subscribe (bảng push_subs).
  Payload: `{title, body, url, tag}`.

## 7. Triển khai (production)

- **Chạy tại**: VPS **139.180.145.29** (Vultr) — domain **https://task.kairetic.com** (DNS đã trỏ đúng).
  Nginx reverse proxy + Let's Encrypt (tự gia hạn, hiện hết hạn 13/01/2027). App trong Docker,
  container `app-kanban-1`, cổng 3000 chỉ bind loopback. Mã trên VPS: `/root/jpbtc123`.
- **SSH vào VPS mới**: PC Render 02 đi 2 chặng:
  `ssh -i ~/.ssh/vultr root@149.28.132.148` (VPS cũ) → `ssh -i /root/.ssh/migrate_tmp root@139.180.145.29`.
  Máy khác muốn vào thẳng: thêm public key vào `authorized_keys` của VPS mới (nhờ chủ dự án).
- **Quy trình deploy** (đã làm 7 lần, luôn thế này):
  ```
  # trên VPS mới
  cd /root/jpbtc123/app
  docker compose exec -T kanban node scripts/backup-db.mjs /data/backup-truoc-<ten>.db < /dev/null
  cd .. && git pull origin claude/trello-like-task-system-xuc1bz
  cd app && docker compose up -d --build
  curl -s -o /dev/null -w "%{http_code}" localhost:3000/api/boards   # 401 là đúng
  ```
  LUÔN backup trước. Lưu ý `docker compose exec -T` trong script qua SSH heredoc phải kèm `< /dev/null`.
- **Dữ liệu**: Docker volume `app_kanban-data` mount `/data` (kanban.db + uploads/ + vapid.json + các backup).
  **Backup SQLite WAL bắt buộc qua `scripts/backup-db.mjs`** (better-sqlite3 `.backup()`) — copy file trần sẽ mất dữ liệu trong `-wal`.
  Cron 2h sáng backup về `/root/backup-kanban-*.db`, giữ 14 bản. CHƯA có backup ngoài VPS (rủi ro đã biết).
  Dự phòng nguội: VPS cũ 149.28.132.148 còn nguyên volume + app (đã stop) ở trạng thái 16/10.

## 8. Biến môi trường (đặt trong `app/.env`, docker-compose tự nạp)

| Biến | Bắt buộc? | Ý nghĩa |
|---|---|---|
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | chỉ dùng khi DB trống | tài khoản admin khởi tạo (prod đã đổi trong app, file .env còn giá trị cũ không dùng nữa) |
| `ANTHROPIC_API_KEY` | không — thiếu thì nút AI tự ẩn | key Claude API cho tính năng AI (prod ĐÃ đặt) |
| `AI_MODEL` | không (mặc định `claude-haiku-5-5`) | model AI |
| `PORT` | không (3000) | cổng server |
| `SESSION_TTL_DAYS` | không (30) | hạn phiên đăng nhập |
| `DATA_DIR` | không (`./data`; Docker đặt `/data` sẵn trong image) | nơi chứa DB/uploads/vapid |
| — `vapid.json` | KHÔNG phải env | tự sinh trong `DATA_DIR` lần boot đầu. **GIỮ FILE NÀY**: mất là mọi thiết bị phải đăng ký push lại |

## 9. Lưu ý riêng cho mobile app

1. **Đừng đổi backend API nếu không bắt buộc** — web + PWA production đang dùng. Cần endpoint mới
   (vd đăng ký FCM token native) thì THÊM, đừng sửa hành vi cũ; thêm migration mới trong db.js theo đúng
   pattern `hasColumn`/`CREATE TABLE IF NOT EXISTS` (an toàn với DB cũ).
2. Kéo-thả: chỉ cần `PATCH /api/cards/:id {list_id, position}` — position tính kiểu (trước+sau)/2, xem
   `commitDrop()` trong index.html. Vật lý animation chuẩn Trello đã đo bằng REA: ghost xoay 4°,
   shadow `0 12px 24px rgba(9,30,66,.45)`, placeholder viền đứt nét (xem `nghien-cuu-trello-dao-sau.md` mục 2c).
3. Ngày giờ server đều là chuỗi thuần (`YYYY-MM-DD`, `HH:MM`, created_at là UTC SQLite `YYYY-MM-DD HH:MM:SS`)
   — client tự format; so sánh hạn làm theo ngày (xem `dueBadge()`).
4. Test trên dữ liệu giả lập: seed-sim-team.mjs tạo cả thẻ trễ hạn/sắp hạn/hoàn thành.
5. Quy ước dự án: mọi thay đổi commit + push nhánh trên; tài liệu tiếng Việt trong `docs/`;
   cập nhật `tinh-trang-du-an.md` khi xong việc lớn; làm chính xác, dựa dữ liệu, không xây thừa.
