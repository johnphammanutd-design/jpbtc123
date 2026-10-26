import SwiftUI
import UniformTypeIdentifiers

struct BoardSettings: View {
    @EnvironmentObject var state: AppState
    @Environment(\.dismiss) private var dismiss
    let boardID: Int
    @State private var snapshot: BoardSnapshot?
    @State private var edit: EditRequest?
    @State private var importing = false
    @State private var exportURL: URL?
    @State private var error: String?
    var body: some View {
        List {
            if let s = snapshot {
                Section {
                    Label(s.board.title, systemImage: "rectangle.split.3x1").font(.headline)
                    Text("Quyền của bạn: \(s.canManage ? "Quản lý bảng" : "Thành viên")").font(.caption)
                }
                Section("Quản lý bảng") {
                    Button { boardMembers(s) } label: { Label("Thành viên & quyền truy cập", systemImage: "person.2") }
                    if s.canManage {
                        Button { edit = EditRequest(title: "Thêm cột", fields: [.text("title", "Tên cột", required: true)]) { v in var b = v; b["board_id"] = .id(boardID); _ = try await state.mutate("/api/lists", "POST", b) } } label: { Label("Thêm cột", systemImage: "rectangle.badge.plus") }
                        NavigationLink { LabelsScreen(boardID: boardID) } label: { Label("Nhãn", systemImage: "tag") }
                        NavigationLink { FieldsScreen(boardID: boardID) } label: { Label("Trường tùy chỉnh", systemImage: "slider.horizontal.3") }
                        Button { workflow(s) } label: { Label("Quy trình duyệt", systemImage: "checkmark.seal") }
                        if state.isDirector { Button { team(s) } label: { Label("Gắn bảng với team", systemImage: "person.3") } }
                    }
                }
                Section("Công cụ") {
                    if s.canManage {
                        NavigationLink { AutomationScreen(boardID: boardID) } label: { Label("Tự động hóa", systemImage: "bolt") }
                        Button { powerups(s) } label: { Label("Tiện ích", systemImage: "puzzlepiece.extension") }
                    }
                    NavigationLink { BoardHistoryScreen(boardID: boardID) } label: { Label("Nhật ký hoạt động", systemImage: "clock.arrow.circlepath") }
                    NavigationLink { ArchivesScreen(boardID: boardID, canManage: s.canManage) } label: { Label("Kho lưu trữ", systemImage: "archivebox") }
                    Button(s.json["watchingBoard"].flag ? "Bỏ theo dõi bảng" : "Theo dõi bảng", systemImage: "eye") { state.handle { _ = try await state.mutate("/api/boards/\(boardID)/watch") } }
                    Button("Xuất CSV", systemImage: "square.and.arrow.up") { export("csv") }
                    Button("Xuất dữ liệu JSON", systemImage: "square.and.arrow.up") { export("json") }
                    if let exportURL { ShareLink(item: exportURL) { Label("Chia sẻ tệp đã xuất", systemImage: "square.and.arrow.up") } }
                }
                if s.canManage {
                    Section("Giao diện & thao tác") {
                        Button("Đổi tên bảng", systemImage: "pencil") { edit = EditRequest(title: "Đổi tên bảng", fields: [.text("title", "Tên bảng", s.board.title, required: true)]) { v in _ = try await state.mutate("/api/boards/\(boardID)", "PATCH", v) } }
                        Button("Màu nền bảng", systemImage: "paintpalette") { edit = EditRequest(title: "Phông nền", fields: [.pick("background", "Màu nền", [("ocean", "Đại dương"), ("forest", "Rừng xanh"), ("sunset", "Hoàng hôn"), ("violet", "Tím")], s.board.text("background"))]) { v in _ = try await state.mutate("/api/boards/\(boardID)", "PATCH", v) } }
                        Button("Tải ảnh nền", systemImage: "photo") { importing = true }
                        Button("Sao chép bảng", systemImage: "doc.on.doc") { edit = EditRequest(title: "Sao chép bảng", fields: [.text("title", "Tên bảng mới", s.board.title + " · Bản sao", required: true)]) { v in _ = try await state.mutate("/api/boards/\(boardID)/copy", "POST", v) } }
                        Button(s.board.flag("closed") ? "Mở lại bảng" : "Đóng bảng", systemImage: "archivebox") { state.handle { _ = try await state.mutate("/api/boards/\(boardID)", "PATCH", ["closed": .bool(!s.board.flag("closed"))]); dismiss() } }
                        if state.isDirector { DestructiveButton(title: "Xóa bảng vĩnh viễn", detail: "Toàn bộ cột, thẻ và dữ liệu trong bảng sẽ bị xóa.") { state.handle { _ = try await state.mutate("/api/boards/\(boardID)", "DELETE"); dismiss() } } }
                    }
                }
            } else { ProgressView("Đang tải…") }
            if let error { Text(error).foregroundStyle(.red) }
        }.navigationTitle("Menu bảng").navigationBarTitleDisplayMode(.inline)
        .task(id: state.revision) { do { let data = try await state.call("/api/boards/\(boardID)"); try Task.checkCancellation(); snapshot = BoardSnapshot(data); error = nil } catch is CancellationError {} catch { snapshot = nil; self.error = error.localizedDescription } }
        .sheet(item: $edit) { EditSheet($0) }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.image]) { result in
            if case .success(let url) = result { state.handle {
                let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }
                guard (try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) <= 10 * 1024 * 1024 else { throw APIError.server(413, "Ảnh nền tối đa 10 MB.") }
                _ = try await state.upload("/api/boards/\(boardID)/background", data: Data(contentsOf: url), name: url.lastPathComponent); state.revision += 1
            } }
        }
    }
    func boardMembers(_ s: BoardSnapshot) {
        let roles = s.rows("boardMemberRoles")
        let people = state.users.filter { user in !user.flag("disabled") || roles.contains { $0.number("user_id") == user.id } }
        if !s.canManage { edit = EditRequest(title: "Quyền truy cập", fields: [], note: s.rows("eligibleMembers").map { $0.title }.joined(separator: "\n"), submit: "Đóng") { _ in }; return }
        let fields = people.map { u in FormField.pick(String(u.id), u.title, [("none", "Không cấp quyền"), ("member", "Thành viên"), ("manager", "Quản lý bảng")], roles.first { $0.number("user_id") == u.id }?.text("role") ?? "none") }
        edit = EditRequest(title: "Quyền truy cập bảng", fields: fields, note: "Giám đốc có quyền toàn công ty. Leader của team gắn với bảng có quyền quản lý theo team.") { v in
            let members: [JSON] = people.compactMap { u in guard let role = v[String(u.id)]?.string, role != "none" else { return nil }; return .object(["user_id": .id(u.id), "role": .string(role)]) }
            _ = try await state.mutate("/api/boards/\(boardID)/members", "PUT", ["members": .array(members)])
        }
    }
    func workflow(_ s: BoardSnapshot) {
        let opts = [("0", "Chưa gắn cột")] + s.lists.map { (String($0.id), $0.title) }
        edit = EditRequest(title: "Quy trình duyệt", fields: [.pick("review_list_id", "Cột chờ duyệt", opts, String(s.board.number("review_list_id"))), .pick("done_list_id", "Cột hoàn thành", opts, String(s.board.number("done_list_id"))), .pick("changes_list_id", "Cột cần chỉnh sửa", opts, String(s.board.number("changes_list_id")))], note: "Hoàn thành công việc cần người duyệt xác nhận. Đổi cột không thay thế bước duyệt.") { v in
            let b = v.mapValues { $0.int == 0 ? JSON.null : .id($0.int) }; _ = try await state.mutate("/api/boards/\(boardID)/workflow", "PUT", b)
        }
    }
    func powerups(_ s: BoardSnapshot) {
        let p = s.board["powerups"].parsed
        edit = EditRequest(title: "Tiện ích bảng", fields: [("vote", "Bình chọn"), ("wip", "Hiển thị giới hạn WIP"), ("ai", "Trợ lý AI")].map { FormField(id: $0.0, label: $0.1, value: .bool(p[$0.0].flag), kind: .toggle) }) { v in _ = try await state.mutate("/api/boards/\(boardID)", "PATCH", ["powerups": .object(v)]) }
    }
    func team(_ s: BoardSnapshot) { state.handle {
        let teams = try await state.call("/api/teams")["teams"].rows
        edit = EditRequest(title: "Team phụ trách bảng", fields: [.pick("team_id", "Team", [("0", "Chưa gắn team")] + teams.map { (String($0.id), $0.title) }, String(s.board.number("team_id")))]) { v in _ = try await state.mutate("/api/boards/\(boardID)/team", "PUT", ["team_id": v["team_id"]?.int == 0 ? .null : .id(v["team_id"]?.int ?? 0)]) }
    } }
    func export(_ ext: String) { state.handle {
        let data = try await state.export("/api/boards/\(boardID)/export.\(ext)")
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("Kairetic", isDirectory: true); try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("board-\(boardID).\(ext)"); try data.write(to: url, options: [.atomic, .completeFileProtection]); exportURL = url
    } }
}
struct LabelsScreen: View {
    @EnvironmentObject var state: AppState
    let boardID: Int
    @State private var labels: [Record] = []
    @State private var edit: EditRequest?
    var body: some View {
        List { ForEach(labels) { l in HStack { Button { editor(l) } label: { Label(l.text("name").isEmpty ? "Nhãn không tên" : l.text("name"), systemImage: "tag.fill").foregroundStyle(Color(hex: l.text("color"))) }; Spacer(); DestructiveButton(title: "Xóa") { state.handle { _ = try await state.mutate("/api/labels/\(l.id)", "DELETE") } } } } }
        .navigationTitle("Nhãn").toolbar { Button("Thêm") { editor(nil) } }.sheet(item: $edit) { EditSheet($0) }
        .task(id: state.revision) { do { labels = try await state.call("/api/boards/\(boardID)")["labels"].rows } catch { state.message = error.localizedDescription } }
    }
    func editor(_ l: Record?) { edit = EditRequest(title: l == nil ? "Thêm nhãn" : "Sửa nhãn", fields: [.text("name", "Tên nhãn", l?.text("name") ?? ""), .text("color", "Màu #RRGGBB", l?.text("color") ?? "#61bd4f", required: true)]) { v in _ = try await state.mutate(l == nil ? "/api/boards/\(boardID)/labels" : "/api/labels/\(l!.id)", l == nil ? "POST" : "PATCH", v) } }
}
struct FieldsScreen: View {
    @EnvironmentObject var state: AppState
    let boardID: Int
    @State private var fields: [Record] = []
    @State private var edit: EditRequest?
    var body: some View {
        List { ForEach(fields) { f in HStack { Button { editor(f) } label: { VStack(alignment: .leading) { Text(f.title); Text(f.text("type")).font(.caption).foregroundStyle(.secondary) } }; Spacer(); DestructiveButton(title: "Xóa") { state.handle { _ = try await state.mutate("/api/fields/\(f.id)", "DELETE") } } } } }.navigationTitle("Trường tùy chỉnh").toolbar { Button("Thêm") { editor(nil) } }.sheet(item: $edit) { EditSheet($0) }
        .task(id: state.revision) { do { fields = try await state.call("/api/boards/\(boardID)")["fields"].rows } catch { state.message = error.localizedDescription } }
    }
    func editor(_ f: Record?) {
        var form = [FormField.text("name", "Tên trường", f?.title ?? "", required: true)]
        if f == nil { form.append(.pick("type", "Kiểu dữ liệu", [("text", "Chữ"), ("number", "Số"), ("date", "Ngày"), ("select", "Danh sách chọn"), ("checkbox", "Ô đánh dấu")], "text")) }
        form.append(FormField(id: "options", label: "Lựa chọn (mỗi dòng một giá trị)", value: .string(f?["options"].parsed.array.map(\.string).joined(separator: "\n") ?? ""), kind: .multiline))
        edit = EditRequest(title: f == nil ? "Tạo trường" : "Sửa trường", fields: form) { v in var b = v; b["options"] = .array((v["options"]?.string ?? "").split(separator: "\n").map { .string($0.trimmingCharacters(in: .whitespaces)) }); _ = try await state.mutate(f == nil ? "/api/boards/\(boardID)/fields" : "/api/fields/\(f!.id)", f == nil ? "POST" : "PATCH", b) }
    }
}
struct BoardHistoryScreen: View {
    @EnvironmentObject var state: AppState
    let boardID: Int
    @State private var rows: [Record] = []
    var body: some View { List { ActivityList(rows: rows); if rows.isEmpty { EmptyState(title: "Chưa có hoạt động") } }.navigationTitle("Nhật ký bảng").task(id: state.revision) { do { rows = try await state.call("/api/boards/\(boardID)/activity")["activity"].rows } catch { state.message = error.localizedDescription } } }
}
struct ArchivesScreen: View {
    @EnvironmentObject var state: AppState
    let boardID: Int
    let canManage: Bool
    @State private var data: JSON = .null
    var body: some View {
        List {
            Section("Cột") { ForEach(data["lists"].rows) { l in HStack { Text(l.title); Spacer(); if canManage { Button("Khôi phục") { state.handle { _ = try await state.mutate("/api/lists/\(l.id)", "PATCH", ["archived": .bool(false)]) } } } } } }
            Section("Thẻ") { ForEach(data["cards"].rows) { c in HStack { NavigationLink(c.title) { CardScreen(cardID: c.id) }; if canManage { Button("Khôi phục") { state.handle { _ = try await state.mutate("/api/cards/\(c.id)", "PATCH", ["archived": .bool(false)]) } }.buttonStyle(.bordered) } } } }
        }.navigationTitle("Kho lưu trữ").task(id: state.revision) { do { data = try await state.call("/api/boards/\(boardID)/archived") } catch { state.message = error.localizedDescription } }
    }
}
struct AutomationScreen: View {
    @EnvironmentObject var state: AppState
    let boardID: Int
    @State private var s: BoardSnapshot?
    var body: some View {
        List {
            if let s {
                ForEach([("rules", "Khi vào cột", "rules"), ("schedules", "Theo lịch", "schedules"), ("dueRules", "Theo hạn", "due-rules"), ("cardButtons", "Nút trên thẻ", "buttons")], id: \.0) { group in
                    Section(group.1) { ForEach(s.rows(group.0)) { r in HStack { VStack(alignment: .leading, spacing: 7) { Text(ruleTitle(r, kind: group.0, s: s)).fontWeight(.medium); Text(actionsDescription(r["actions"].parsed, s)).font(.caption).foregroundStyle(.secondary) }; Spacer(); DestructiveButton(title: "Xóa") { state.handle { _ = try await state.mutate("/api/\(group.2)/\(r.id)", "DELETE") } } } } }
                }
                NavigationLink { NewAutomationScreen(s: s) } label: { Label("Thêm tự động hóa", systemImage: "plus") }
            } else { ProgressView() }
        }.navigationTitle("Tự động hóa").task(id: state.revision) { do { s = BoardSnapshot(try await state.call("/api/boards/\(boardID)")) } catch { state.message = error.localizedDescription } }
    }
    func ruleTitle(_ r: Record, kind: String, s: BoardSnapshot) -> String {
        if kind == "cardButtons" { return r.title }
        if kind == "rules" { return "Vào cột " + (s.lists.first { $0.id == r.number("trigger_list_id") }?.title ?? "") }
        if kind == "schedules" { return r.text("cadence") == "weekly" ? "Hằng tuần · ngày \(r.number("weekday"))" : "Hằng ngày" }
        return r.text("trigger") == "overdue" ? "Khi quá hạn" : "Trước hạn một ngày"
    }
    func actionsDescription(_ a: JSON, _ s: BoardSnapshot) -> String {
        var parts: [String] = []
        if a["label_id"].int > 0 { parts.append("Gắn nhãn " + (s.rows("labels").first { $0.id == a["label_id"].int }?.text("name") ?? "")) }
        if a["member_id"].int > 0 { parts.append("Giao việc") }
        if a["move_list_id"].int > 0 { parts.append("Chuyển cột " + (s.lists.first { $0.id == a["move_list_id"].int }?.title ?? "")) }
        if a["check_all"].flag { parts.append("Hoàn thành checklist") }
        if a["due_complete"].flag || a["complete"].flag { parts.append("Đánh dấu hoàn thành (theo quyền duyệt)") }
        if !a["cover"].string.isEmpty { parts.append("Đổi màu bìa") }
        if a["due_shift_days"].int != 0 { parts.append("Dời hạn \(a["due_shift_days"].int) ngày") }
        if a["sort"] != .null { parts.append("Sắp xếp thẻ") }
        if a["archive_done_list_id"].int > 0 { parts.append("Lưu trữ thẻ hoàn thành") }
        return parts.joined(separator: " · ")
    }
}
struct NewAutomationScreen: View {
    @EnvironmentObject var state: AppState
    @Environment(\.dismiss) private var dismiss
    let s: BoardSnapshot
    @State private var kind = "rules"
    @State private var name = ""
    @State private var list = 0
    @State private var move = 0
    @State private var label = 0
    @State private var member = 0
    @State private var complete = false
    @State private var check = false
    @State private var cover = ""
    @State private var shift = "0"
    @State private var cadence = "daily"
    @State private var weekday = 1
    @State private var trigger = "overdue"
    @State private var scheduleAction = "sort"
    @State private var sort = "due"
    @State private var error: String?
    @State private var busy = false
    var body: some View {
        Form {
            Picker("Loại", selection: $kind) { Text("Khi vào cột").tag("rules"); Text("Theo lịch").tag("schedules"); Text("Theo hạn").tag("due-rules"); Text("Nút thẻ").tag("buttons") }
            if kind == "buttons" { TextField("Tên nút", text: $name) }
            if kind == "rules" || kind == "schedules" { Picker(kind == "rules" ? "Cột kích hoạt" : "Cột áp dụng", selection: $list) { Text("Chọn cột").tag(0); ForEach(s.lists) { Text($0.title).tag($0.id) } } }
            if kind == "schedules" {
                Picker("Chu kỳ", selection: $cadence) { Text("Hằng ngày").tag("daily"); Text("Hằng tuần").tag("weekly") }
                if cadence == "weekly" { Picker("Ngày trong tuần", selection: $weekday) { ForEach(1...7, id: \.self) { Text($0 == 7 ? "Chủ nhật" : "Thứ \($0 + 1)").tag($0) } } }
                Picker("Hành động", selection: $scheduleAction) { Text("Sắp xếp thẻ").tag("sort"); Text("Lưu trữ thẻ đã xong").tag("archive") }
                if scheduleAction == "sort" { Picker("Sắp xếp theo", selection: $sort) { Text("Ngày hạn").tag("due"); Text("Tên").tag("title"); Text("Mới tạo").tag("created") } }
            } else {
                if kind == "due-rules" { Picker("Điều kiện", selection: $trigger) { Text("Quá hạn").tag("overdue"); Text("Hạn vào ngày mai").tag("due_tomorrow") } }
                Picker("Gắn nhãn", selection: $label) { Text("Không đổi").tag(0); ForEach(s.rows("labels")) { Text($0.text("name").isEmpty ? $0.text("color") : $0.text("name")).tag($0.id) } }
                if kind != "rules" { Picker("Chuyển đến cột", selection: $move) { Text("Không đổi").tag(0); ForEach(s.lists) { Text($0.title).tag($0.id) } } }
                if kind == "rules" { Picker("Giao việc", selection: $member) { Text("Không đổi").tag(0); ForEach(s.rows("eligibleMembers")) { Text($0.title).tag($0.id) } }; Toggle("Hoàn thành mọi việc con", isOn: $check); TextField("Màu bìa #RRGGBB", text: $cover) }
                if kind == "rules" || kind == "buttons" { Toggle("Đánh dấu hoàn thành", isOn: $complete); Text("Máy chủ vẫn kiểm tra quyền và quy trình duyệt.").font(.caption).foregroundStyle(.secondary) }
                if kind == "buttons" { TextField("Dời hạn số ngày (+/-)", text: $shift).keyboardType(.numbersAndPunctuation) }
            }
            if let error { Text(error).foregroundStyle(.red) }
        }.navigationTitle("Thêm tự động hóa").disabled(busy).toolbar { Button("Tạo") { save() }.disabled(busy) }
    }
    func save() {
        var a: [String: JSON] = [:], b: [String: JSON] = [:]
        if kind == "schedules" {
            guard list > 0 else { error = "Chọn cột áp dụng."; return }
            a = scheduleAction == "sort" ? ["sort": .object(["list_id": .id(list), "by": .string(sort)])] : ["archive_done_list_id": .id(list)]
            b = ["cadence": .string(cadence), "weekday": .id(weekday)]
        } else {
            if label > 0 { a["label_id"] = .id(label) }; if move > 0 { a["move_list_id"] = .id(move) }
            if kind == "rules" { guard list > 0 else { error = "Chọn cột kích hoạt."; return }; b["trigger_list_id"] = .id(list); if member > 0 { a["member_id"] = .id(member) }; if check { a["check_all"] = .bool(true) }; if !cover.isEmpty { a["cover"] = .string(cover) }; if complete { a["due_complete"] = .bool(true) } }
            if kind == "buttons" { guard !name.trimmingCharacters(in: .whitespaces).isEmpty else { error = "Nhập tên nút."; return }; b["name"] = .string(name); if complete { a["complete"] = .bool(true) }; if let days = Int(shift), days != 0 { a["due_shift_days"] = .id(days) } }
            if kind == "due-rules" { b["trigger"] = .string(trigger) }
        }
        guard !a.isEmpty else { error = "Chọn ít nhất một hành động."; return }; b["actions"] = .object(a); busy = true
        Task { defer { busy = false }; do { _ = try await state.mutate("/api/boards/\(s.board.id)/\(kind)", "POST", b); dismiss() } catch { self.error = error.localizedDescription } }
    }
}
