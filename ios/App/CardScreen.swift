import SwiftUI
import QuickLook
import UniformTypeIdentifiers

struct CardScreen: View {
    @EnvironmentObject var state: AppState
    @Environment(\.dismiss) private var dismiss
    let cardID: Int
    @State private var resolvedID = 0
    @State private var snapshot: BoardSnapshot?
    @State private var card: Record?
    @State private var review: JSON = .null
    @State private var comments: [Record] = []
    @State private var attachments: [Record] = []
    @State private var activity: [Record] = []
    @State private var error: String?
    @State private var tab = "Nội dung"
    @State private var edit: EditRequest?
    @State private var destinationRequest: DestinationRequest?
    @State private var comment = ""
    @State private var busy = false
    @State private var importing = false
    @State private var preview: URL?
    @State private var aiResult: String?
    @State private var aiEnabled = false
    var body: some View {
        Group {
            if let c = card, let s = snapshot {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        Surface {
                            HStack { Badge(text: c.reviewLabel, color: c.text("approval_state") == "pending" ? .orange : c.flag("due_complete") ? .green : brand); if c.flag("is_template") { Badge(text: "Mẫu") }; Spacer() }
                            if c.text("cover").hasPrefix("url:/u/") { AuthenticatedImage(path: String(c.text("cover").dropFirst(4))).frame(height: 160).clipped().clipShape(RoundedRectangle(cornerRadius: 10)) }
                            else if c.text("cover").hasPrefix("#") { RoundedRectangle(cornerRadius: 10).fill(Color(hex: c.text("cover"))).frame(height: 75) }
                            Text(c.title).font(.title2.bold()).textSelection(.enabled)
                            Text(s.board.title).font(.caption).foregroundStyle(.secondary)
                            if resolvedID != cardID { Label("Đang mở nội dung thẻ gốc", systemImage: "rectangle.on.rectangle").font(.caption).foregroundStyle(.secondary) }
                            if let error { Text(error).foregroundStyle(.red).font(.footnote) }
                            reviewButtons(c, s)
                        }
                        Picker("Chi tiết thẻ", selection: $tab) { ForEach(["Nội dung", "Trao đổi", "Hoạt động"], id: \.self) { Text($0) } }.pickerStyle(.segmented).padding(.horizontal)
                        if tab == "Trao đổi" { commentsView(c, s) }
                        else if tab == "Hoạt động" { Surface { ActivityList(rows: activity); if activity.isEmpty { EmptyState(title: "Chưa có hoạt động") }; Divider(); Text("Lịch sử duyệt").font(.headline); ForEach(review["events"].rows) { e in VStack(alignment: .leading, spacing: 5) { Text(e.text("author") + " · " + (["submit":"Gửi duyệt", "approve":"Duyệt hoàn thành", "request_changes":"Yêu cầu chỉnh sửa"][e.text("action")] ?? e.text("action"))).font(.subheadline.bold()); Text(e.text("note")); Text(e.text("created_at")).font(.caption).foregroundStyle(.secondary) } } } }
                        else { content(c, s) }
                    }.padding(.vertical)
                }.background(canvas).refreshable { await reload() }
                .toolbar { Menu { cardMenu(c, s) } label: { Image(systemName: "ellipsis.circle").accessibilityLabel("Thao tác với thẻ") } }
            } else if let error { EmptyState(title: error, symbol: "exclamationmark.lock") }
            else { ProgressView("Đang tải thẻ…") }
        }.navigationTitle("Chi tiết công việc").navigationBarTitleDisplayMode(.inline)
        .task(id: state.revision) { await reload() }
        .sheet(item: $edit) { EditSheet($0) }
        .sheet(item: $destinationRequest) { DestinationSheet($0) }
        .quickLookPreview($preview)
        .fileImporter(isPresented: $importing, allowedContentTypes: [.item]) { result in
            switch result { case .success(let url): upload(url); case .failure(let e): error = e.localizedDescription }
        }
        .alert("Trợ lý AI", isPresented: Binding(get: { aiResult != nil }, set: { if !$0 { aiResult = nil } })) { Button("Đóng") { aiResult = nil } } message: { Text(aiResult ?? "") }
    }
    func reload() async {
        do {
            var id = cardID
            var location = try await state.call("/api/cards/\(id)/locate")
            var data = try await state.call("/api/boards/\(location["board_id"].int)")
            var s = BoardSnapshot(data)
            var found = s.cards.first { $0.id == id }
            if found == nil, location["archived"].flag { found = try await state.call("/api/boards/\(s.board.id)/archived")["cards"].rows.first { $0.id == id } }
            if let mirror = found, mirror.number("mirror_of") > 0 {
                id = mirror.number("mirror_of"); location = try await state.call("/api/cards/\(id)/locate"); data = try await state.call("/api/boards/\(location["board_id"].int)"); s = BoardSnapshot(data); found = s.cards.first { $0.id == id }
                if found == nil, location["archived"].flag { found = try await state.call("/api/boards/\(s.board.id)/archived")["cards"].rows.first { $0.id == id } }
            }
            guard let found else { throw APIError.server(404, "Không tìm thấy thẻ trong bảng đang hoạt động.") }
            let loadedID = id
            async let r = state.call("/api/cards/\(loadedID)/review")
            async let cm = state.call("/api/cards/\(loadedID)/comments")
            async let at = state.call("/api/cards/\(loadedID)/attachments")
            async let ac = state.call("/api/cards/\(loadedID)/activity")
            async let ai = state.call("/api/ai/status")
            let results = try await (r, cm, at, ac, ai)
            try Task.checkCancellation()
            resolvedID = id; snapshot = s; card = found; review = results.0; comments = results.1["comments"].rows; attachments = results.2["attachments"].rows; activity = results.3["activity"].rows; aiEnabled = results.4["enabled"].flag; error = nil; state.watch(s.board.id)
        } catch is CancellationError {} catch {
            if case APIError.server(let status, _) = error, [401, 403, 404].contains(status) { card = nil; snapshot = nil; comments = []; attachments = []; activity = []; review = .null }
            self.error = error.localizedDescription
        }
    }
    @ViewBuilder func reviewButtons(_ c: Record, _ s: BoardSnapshot) -> some View {
        let active = !c.flag("archived") && !s.board.flag("closed") && !c.flag("is_template")
        let permission = ReviewCapabilities(card: c, snapshot: s, review: review, user: state.user ?? Record())
        if c.flag("archived") {
            Button("Khôi phục thẻ") { run { _ = try await state.mutate("/api/cards/\(resolvedID)", "PATCH", ["archived": .bool(false)]) } }.buttonStyle(.borderedProminent)
        } else if active, c.text("approval_state") == "pending", permission.canDecide {
            HStack { Button("Duyệt hoàn thành") { reviewAction("approve") }.buttonStyle(.borderedProminent); Button("Yêu cầu sửa") { reviewAction("request_changes") }.buttonStyle(.bordered) }.disabled(busy)
        } else if permission.canSubmit {
            Button("Gửi duyệt") { reviewAction("submit") }.buttonStyle(.borderedProminent).disabled(busy)
        }
    }
    func reviewAction(_ action: String) {
        let title = ["submit":"Gửi duyệt", "approve":"Duyệt hoàn thành", "request_changes":"Yêu cầu chỉnh sửa"][action] ?? "Duyệt"
        edit = EditRequest(title: title, fields: [FormField(id: "note", label: action == "request_changes" ? "Nội dung cần chỉnh sửa" : "Ghi chú bàn giao / duyệt", kind: .multiline, required: action == "request_changes")], note: action == "approve" && card?.text("recur").isEmpty == false ? "Công việc lặp sẽ chuyển sang kỳ tiếp theo sau khi được duyệt." : "", submit: title) { v in
            _ = try await state.mutate("/api/cards/\(resolvedID)/review", "POST", ["action": .string(action), "note": v["note"] ?? .string("")]); await reload()
        }
    }
    @ViewBuilder func content(_ c: Record, _ s: BoardSnapshot) -> some View {
        Surface {
            Button { members(c, s) } label: { Label("Thành viên & người duyệt", systemImage: "person.2").font(.headline) }
            Text(s.members(of: c).map { $0.text("name") }.joined(separator: ", ").isEmpty ? "Chưa giao người phụ trách" : s.members(of: c).map { $0.text("name") }.joined(separator: ", ")).font(.subheadline)
            Text("Người duyệt: " + (state.users.first { $0.id == c.number("reviewer_id") }?.title ?? "Chọn tự động khi gửi duyệt")).font(.caption).foregroundStyle(.secondary)
            Divider()
            Button { dates(c) } label: { Label("Ngày, hạn & nhắc việc", systemImage: "calendar.badge.clock") }
            Text(c.text("due_date").isEmpty ? "Chưa đặt hạn" : "\(c.text("due_date")) · \(c.text("due_time"))").font(.subheadline)
            if !c.text("recur").isEmpty { Text(["daily":"Lặp hằng ngày", "weekly":"Lặp hằng tuần", "monthly":"Lặp hằng tháng"][c.text("recur")] ?? c.text("recur")).font(.caption).foregroundStyle(.secondary) }
            Divider()
            Button { labels(c, s) } label: { Label("Nhãn", systemImage: "tag") }
            if s.labels(of: c).isEmpty { Text("Chưa gắn nhãn").font(.caption).foregroundStyle(.secondary) }
            ForEach(s.labels(of: c)) { l in Badge(text: l.text("name").isEmpty ? "Nhãn" : l.text("name"), color: Color(hex: l.text("color"))) }
        }
        Surface {
            HStack { Text("Mô tả").font(.headline); Spacer(); Button("Sửa") { edit = EditRequest(title: "Nội dung thẻ", fields: [.text("title", "Tên công việc", c.title, required: true), FormField(id: "description", label: "Mô tả", value: c["description"], kind: .multiline)]) { v in _ = try await state.mutate("/api/cards/\(resolvedID)", "PATCH", v) } } }
            Text(.init(c.text("description").isEmpty ? "Chưa có mô tả" : c.text("description"))).textSelection(.enabled)
        }
        checklist(c, s)
        Surface {
            HStack { Text("Đính kèm").font(.headline); Spacer(); Menu { Button("Thêm đường dẫn") { edit = EditRequest(title: "Thêm đường dẫn", fields: [.text("name", "Tên đính kèm"), .text("url", "Đường dẫn https://", required: true)]) { v in _ = try await state.mutate("/api/cards/\(resolvedID)/attachments", "POST", v) } }; Button("Chọn tệp hoặc ảnh") { importing = true } } label: { Image(systemName: "plus").accessibilityLabel("Thêm đính kèm") } }
            if attachments.isEmpty { Text("Chưa có tệp hoặc đường dẫn").font(.caption).foregroundStyle(.secondary) }
            ForEach(attachments) { a in HStack {
                Button { openAttachment(a) } label: { Label(a.text("name"), systemImage: "paperclip").lineLimit(2).multilineTextAlignment(.leading) }; Spacer()
                Menu { if a.text("url").hasPrefix("/u/") { Button("Dùng làm ảnh bìa") { run { _ = try await state.mutate("/api/cards/\(resolvedID)", "PATCH", ["cover": .string("url:" + a.text("url"))]) } } }; DestructiveButton(title: "Xóa đính kèm") { run { _ = try await state.mutate("/api/attachments/\(a.id)", "DELETE") } } } label: { Image(systemName: "ellipsis") }
            } }
            if busy { ProgressView() }
        }
        if !s.rows("fields").isEmpty { Surface { HStack { Text("Trường tùy chỉnh").font(.headline); Spacer(); Button("Sửa") { customFields(c, s) } }; ForEach(s.rows("fields")) { f in let value = s.rows("fieldValues").first { $0.number("card_id") == c.id && $0.number("field_id") == f.id }?.text("value") ?? ""; LabeledContent(f.title, value: f.text("type") == "checkbox" ? (value == "1" ? "Đã đánh dấu" : "Chưa đánh dấu") : (value.isEmpty ? "—" : value)) } } }
        if s.json["board"]["powerups"].parsed["vote"].flag { Surface { Button { run { _ = try await state.mutate("/api/cards/\(resolvedID)/vote") } } label: { Label("Bình chọn · \(s.count("voteCounts", card: c.id))" + (s.json["myVotes"].array.map(\.int).contains(c.id) ? " · Bạn đã chọn" : ""), systemImage: "hand.thumbsup") } } }
        if !s.rows("cardButtons").isEmpty { Surface { Text("Nút hành động").font(.headline); ForEach(s.rows("cardButtons")) { b in Button(b.title) { run { _ = try await state.mutate("/api/cards/\(resolvedID)/apply-button/\(b.id)") } } } } }
        if aiEnabled, s.json["board"]["powerups"].parsed["ai"].flag { Surface { Text("Trợ lý AI").font(.headline); ForEach([("summary", "Tóm tắt tình trạng"), ("describe", "Gợi ý mô tả"), ("checklist", "Gợi ý checklist")], id: \.0) { a in Button(a.1) { run { aiResult = try await state.call("/api/ai/card/\(resolvedID)", "POST", ["action": .string(a.0)])["text"].string } } }; Text("Kết quả là gợi ý; nội dung thẻ chỉ đổi khi bạn lưu.").font(.caption).foregroundStyle(.secondary) } }
    }
    @ViewBuilder func checklist(_ c: Record, _ s: BoardSnapshot) -> some View {
        let checks = s.checklist(of: c)
        let groups = s.rows("checklistGroups").filter { $0.number("card_id") == c.id }
        Surface {
            HStack { Text("Checklist").font(.headline); Spacer(); Menu { Button("Thêm nhóm checklist") { edit = EditRequest(title: "Thêm checklist", fields: [.text("title", "Tên checklist", required: true)]) { v in _ = try await state.mutate("/api/cards/\(resolvedID)/checklists", "POST", v) } }; Button("Thêm việc con") { editCheck(nil, group: nil, s: s) } } label: { Image(systemName: "plus").accessibilityLabel("Thêm checklist") } }
            ProgressView(value: Double(checks.filter { $0.flag("checked") }.count), total: Double(max(checks.count, 1)))
            Text("\(checks.filter { $0.flag("checked") }.count)/\(checks.count) đã xong").font(.caption).foregroundStyle(.secondary)
            ForEach(checks.filter { $0.number("group_id") == 0 }) { item in checklistRow(item, s) }
            ForEach(groups) { group in
                HStack { Text(group.title).font(.subheadline.bold()); Spacer(); Menu {
                    Button("Thêm việc con") { editCheck(nil, group: group.id, s: s) }
                    Button("Đổi tên") { edit = EditRequest(title: "Đổi tên checklist", fields: [.text("title", "Tên checklist", group.title, required: true)]) { v in _ = try await state.mutate("/api/checklists/\(group.id)", "PATCH", v) } }
                    DestructiveButton(title: "Xóa nhóm checklist") { run { _ = try await state.mutate("/api/checklists/\(group.id)", "DELETE") } }
                } label: { Image(systemName: "ellipsis").accessibilityLabel("Menu checklist \(group.title)") } }
                ForEach(checks.filter { $0.number("group_id") == group.id }) { item in checklistRow(item, s) }
            }
            if checks.isEmpty { Text("Chia nhỏ công việc để theo dõi tiến độ.").font(.caption).foregroundStyle(.secondary) }
        }
    }
    func checklistRow(_ item: Record, _ s: BoardSnapshot) -> some View {
        HStack(alignment: .top) {
            Button { run { _ = try await state.mutate("/api/checklist/\(item.id)", "PATCH", ["checked": .bool(!item.flag("checked"))]) } } label: { Image(systemName: item.flag("checked") ? "checkmark.circle.fill" : "circle").font(.title3).foregroundStyle(item.flag("checked") ? .green : .secondary).accessibilityLabel((item.flag("checked") ? "Bỏ hoàn thành " : "Hoàn thành ") + item.text("text")) }.disabled(busy)
            VStack(alignment: .leading, spacing: 5) { Text(item.text("text")).strikethrough(item.flag("checked")); if item.number("user_id") > 0 || !item.text("due_date").isEmpty { Text((state.users.first { $0.id == item.number("user_id") }?.title ?? "") + " · " + item.text("due_date") + " " + item.text("due_time")).font(.caption).foregroundStyle(.secondary) } }; Spacer()
            Menu { Button("Sửa nội dung / người / hạn") { editCheck(item, group: item.number("group_id"), s: s) }; Button("Chuyển thành thẻ") { run { _ = try await state.mutate("/api/checklist/\(item.id)/convert") } }; DestructiveButton(title: "Xóa việc con") { run { _ = try await state.mutate("/api/checklist/\(item.id)", "DELETE") } } } label: { Image(systemName: "ellipsis").accessibilityLabel("Menu việc con") }
        }.padding(.vertical, 5)
    }
    func editCheck(_ item: Record?, group: Int?, s: BoardSnapshot) {
        let eligible = s.rows("eligibleMembers").filter { s.canManage || $0.id == state.user?.id || $0.id == item?.number("user_id") }
        edit = EditRequest(title: item == nil ? "Thêm việc con" : "Sửa việc con", fields: [.text("text", "Nội dung", item?.text("text") ?? "", required: true), .pick("user_id", "Phụ trách", [("0", "Chưa giao")] + eligible.map { (String($0.id), $0.title) }, String(item?.number("user_id") ?? 0)), FormField(id: "due_date", label: "Ngày hết hạn", value: .string(item?.text("due_date") ?? ""), kind: .date), .text("due_time", "Giờ hết hạn HH:MM", item?.text("due_time") ?? "")]) { v in
            var b = v; b["user_id"] = v["user_id"]?.int == 0 ? .null : .id(v["user_id"]?.int ?? 0)
            if let item { _ = try await state.mutate("/api/checklist/\(item.id)", "PATCH", b) }
            else { if let group, group > 0 { b["group_id"] = .id(group) }; _ = try await state.mutate("/api/cards/\(resolvedID)/checklist", "POST", b) }
        }
    }
    func members(_ c: Record, _ s: BoardSnapshot) {
        let ids = s.members(of: c).map { $0.number("user_id") }
        let options = s.rows("eligibleMembers").filter { s.canManage || $0.id == state.user?.id }.map { ($0.id, $0.title) }
        var fields = [FormField(id: "user_ids", label: "Người phụ trách", value: .array(ids.map(JSON.id)), kind: .multi(options))]
        if s.canManage { fields.append(.pick("reviewer_id", "Người duyệt", [("0", "Giữ người duyệt hiện tại / tự động")] + review["candidates"].rows.map { (String($0.id), $0.title) }, "0")) }
        edit = EditRequest(title: "Thành viên & người duyệt", fields: fields, note: s.canManage ? "Người nhận phải có quyền vào bảng. Người thực hiện không được tự duyệt." : "Bạn có thể tham gia hoặc rời thẻ bằng tài khoản của mình.") { v in
            _ = try await state.mutate("/api/cards/\(resolvedID)/members", "PUT", ["user_ids": v["user_ids"] ?? .array([])])
            if let reviewer = v["reviewer_id"], reviewer.int > 0 { _ = try await state.mutate("/api/cards/\(resolvedID)/reviewer", "PUT", ["reviewer_id": .id(reviewer.int)]) }
        }
    }
    func labels(_ c: Record, _ s: BoardSnapshot) { edit = EditRequest(title: "Nhãn của thẻ", fields: [FormField(id: "label_ids", label: "Nhãn", value: .array(s.labels(of: c).map { .id($0.id) }), kind: .multi(s.rows("labels").map { ($0.id, $0.text("name").isEmpty ? $0.text("color") : $0.text("name")) }))]) { v in _ = try await state.mutate("/api/cards/\(resolvedID)/labels", "PUT", v) } }
    func dates(_ c: Record) {
        edit = EditRequest(title: "Ngày & nhắc việc", fields: [FormField(id: "start_date", label: "Ngày bắt đầu", value: c["start_date"], kind: .date), FormField(id: "due_date", label: "Ngày hết hạn", value: c["due_date"], kind: .date), .text("due_time", "Giờ hết hạn HH:MM", c.text("due_time")), .pick("recur", "Lặp lại", [("", "Không lặp"), ("daily", "Hằng ngày"), ("weekly", "Hằng tuần"), ("monthly", "Hằng tháng")], c.text("recur")), .pick("remind", "Nhắc trước hạn", [("none", "Không nhắc"), ("0d", "Đúng hạn"), ("5m", "5 phút"), ("15m", "15 phút"), ("1h", "1 giờ"), ("1d", "1 ngày"), ("2d", "2 ngày"), ("7d", "7 ngày")], c.text("remind"))]) { v in _ = try await state.mutate("/api/cards/\(resolvedID)", "PATCH", v) }
    }
    func customFields(_ c: Record, _ s: BoardSnapshot) {
        let fields = s.rows("fields").map { f -> FormField in
            let val = s.rows("fieldValues").first { $0.number("card_id") == c.id && $0.number("field_id") == f.id }?["value"] ?? .string("")
            switch f.text("type") {
            case "select": return .pick(String(f.id), f.title, [("", "Chưa chọn")] + f["options"].parsed.array.map { ($0.string, $0.string) }, val.string)
            case "checkbox": return FormField(id: String(f.id), label: f.title, value: .bool(val.flag), kind: .toggle)
            case "number": return FormField(id: String(f.id), label: f.title, value: val, kind: .integer)
            case "date": return FormField(id: String(f.id), label: f.title, value: val, kind: .date)
            default: return .text(String(f.id), f.title, val.string)
            }
        }
        edit = EditRequest(title: "Trường tùy chỉnh", fields: fields) { v in for f in s.rows("fields") { _ = try await state.mutate("/api/cards/\(resolvedID)/field/\(f.id)", "PUT", ["value": .string(v[String(f.id)]?.string ?? "")]) } }
    }
    @ViewBuilder func commentsView(_ c: Record, _ s: BoardSnapshot) -> some View {
        Surface {
            if comments.isEmpty { Text("Chưa có trao đổi").foregroundStyle(.secondary) }
            ForEach(comments) { cm in
                VStack(alignment: .leading, spacing: 10) {
                    HStack { Text(cm.text("author")).font(.subheadline.bold()); Spacer(); Menu {
                        if cm.number("user_id") == state.user?.id { Button("Sửa bình luận") { edit = EditRequest(title: "Sửa bình luận", fields: [FormField(id: "text", label: "Bình luận", value: cm["text"], kind: .multiline, required: true)]) { v in _ = try await state.mutate("/api/comments/\(cm.id)", "PATCH", v) } } }
                        if cm.number("user_id") == state.user?.id || s.canManage { DestructiveButton(title: "Xóa bình luận") { run { _ = try await state.mutate("/api/comments/\(cm.id)", "DELETE") } } }
                    } label: { Image(systemName: "ellipsis") } }
                    Text(cm.text("text")).textSelection(.enabled)
                    Text(cm.text("created_at") + (cm.text("edited_at").isEmpty ? "" : " · đã sửa")).font(.caption2).foregroundStyle(.secondary)
                    HStack { ForEach(["👍", "✅", "❤️", "👀", "🎉"], id: \.self) { emoji in let r = cm["reactions"].rows.first { $0.text("emoji") == emoji }; Button(emoji + ((r?.number("count") ?? 0) > 0 ? " \(r?.number("count") ?? 0)" : "")) { run { _ = try await state.mutate("/api/comments/\(cm.id)/reactions", "POST", ["emoji": .string(emoji)]) } }.font(.caption).padding(5).background(r?.flag("mine") == true ? brand.opacity(0.15) : Color.clear, in: Capsule()) } }
                    Divider()
                }
            }
            TextField("Bình luận · hỗ trợ @username", text: $comment, axis: .vertical).lineLimit(3...8)
            Button("Gửi bình luận") { let text = comment; run { _ = try await state.mutate("/api/cards/\(resolvedID)/comments", "POST", ["text": .string(text)]); comment = "" } }.buttonStyle(.borderedProminent).disabled(busy || comment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
    }
    @ViewBuilder func cardMenu(_ c: Record, _ s: BoardSnapshot) -> some View {
        Button("Di chuyển thẻ") { destination("move", c, s) }
        Button("Sao chép thẻ") { destination("copy", c, s) }
        Button("Tạo thẻ đối xứng") { destination("mirror", c, s) }
        Button("Hợp nhất vào thẻ khác") { edit = EditRequest(title: "Hợp nhất thẻ", fields: [.pick("target_id", "Thẻ nhận nội dung", s.cards.filter { $0.id != c.id && !$0.flag("is_template") && $0.number("mirror_of") == 0 }.map { (String($0.id), $0.title) }, String(s.cards.first { $0.id != c.id }?.id ?? 0))], note: "Thẻ nguồn sẽ được lưu trữ, vẫn giữ lại dữ liệu để tra cứu.") { v in _ = try await state.mutate("/api/cards/\(resolvedID)/merge", "POST", ["target_id": .id(v["target_id"]?.int ?? 0)]); dismiss() } }
        Divider()
        Button(s.members(of: c).contains { $0.number("user_id") == state.user?.id } ? "Rời thẻ" : "Tham gia thẻ") { run { _ = try await state.mutate("/api/cards/\(resolvedID)/join") } }
        Button(s.json["myWatches"].array.map(\.int).contains(c.id) ? "Bỏ theo dõi thẻ" : "Theo dõi thẻ") { run { _ = try await state.mutate("/api/cards/\(resolvedID)/watch") } }
        Button(c.flag("is_template") ? "Bỏ đánh dấu mẫu" : "Đặt làm thẻ mẫu") { run { _ = try await state.mutate("/api/cards/\(resolvedID)", "PATCH", ["is_template": .bool(!c.flag("is_template"))]) } }
        Button("Màu bìa") { edit = EditRequest(title: "Màu bìa", fields: [.text("cover", "Mã màu #RRGGBB (trống để bỏ)", c.text("cover"))]) { v in _ = try await state.mutate("/api/cards/\(resolvedID)", "PATCH", v) } }
        ShareLink(item: URL(string: "https://task.kairetic.com/#c/\(c.id)")!) { Label("Chia sẻ liên kết thẻ", systemImage: "square.and.arrow.up") }
        Divider()
        Button("Lưu trữ thẻ") { run { _ = try await state.mutate("/api/cards/\(resolvedID)", "PATCH", ["archived": .bool(true)]); dismiss() } }
        if s.canManage { DestructiveButton(title: "Xóa thẻ vĩnh viễn") { run { _ = try await state.mutate("/api/cards/\(resolvedID)", "DELETE"); dismiss() } } }
    }
    func destination(_ action: String, _ c: Record, _ s: BoardSnapshot) {
        destinationRequest = DestinationRequest(title: action == "copy" ? "Sao chép thẻ" : action == "mirror" ? "Tạo thẻ đối xứng" : "Di chuyển thẻ", initialBoard: s.board.id, cardTitle: c.title, copying: action == "copy") { list, title, options in
            var b: [String: JSON] = ["list_id": .id(list)]
            if action == "copy" { b.merge(options) { _, new in new }; b["title"] = .string(title) }
            if action == "move" { _ = try await state.mutate("/api/cards/\(resolvedID)", "PATCH", b); await reload() }
            else { _ = try await state.mutate("/api/cards/\(resolvedID)/\(action)", "POST", b) }
        }
    }
    func run(_ op: @escaping () async throws -> Void) { guard !busy else { return }; busy = true; Task { defer { busy = false }; do { try await op(); await reload() } catch { self.error = error.localizedDescription } } }
    func upload(_ url: URL) {
        run {
            let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }
            let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
            guard size <= 25 * 1024 * 1024 else { throw APIError.server(413, "Tệp tối đa 25 MB.") }
            _ = try await state.upload("/api/cards/\(resolvedID)/upload", data: Data(contentsOf: url), name: url.lastPathComponent); state.revision += 1
        }
    }
    func openAttachment(_ a: Record) {
        if a.text("url").hasPrefix("/u/") {
            run {
                let data = try await state.file(a.text("url"))
                let directory = FileManager.default.temporaryDirectory.appendingPathComponent("Kairetic/\(UUID().uuidString)", isDirectory: true)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.complete])
                let filename = URL(fileURLWithPath: a.text("name")).lastPathComponent
                let file = directory.appendingPathComponent(filename.isEmpty ? "attachment" : filename)
                try data.write(to: file, options: [.atomic, .completeFileProtection]); preview = file
            }
        } else if let url = URL(string: a.text("url")), ["https", "http"].contains(url.scheme ?? "") { UIApplication.shared.open(url) }
    }
}
