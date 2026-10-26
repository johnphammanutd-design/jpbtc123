import SwiftUI

struct PlannerScreen: View {
    @EnvironmentObject var state: AppState
    @State private var data: JSON = .null
    @State private var day = Date()
    @State private var edit: EditRequest?
    var body: some View {
        List {
            DatePicker("Ngày xem", selection: $day, displayedComponents: .date).datePickerStyle(.graphical)
            Section("Công việc · \(dateString(day))") {
                let slots = data["slots"].rows.filter { $0.text("date") == dateString(day) }
                if slots.isEmpty { Text("Chưa xếp công việc cho ngày này").foregroundStyle(.secondary) }
                ForEach(slots) { slot in
                    VStack(alignment: .leading, spacing: 8) {
                        NavigationLink { CardScreen(cardID: slot.number("card_id")) } label: { VStack(alignment: .leading, spacing: 6) { Text(slot.title).fontWeight(.medium); Text(slot.text("board_title")).font(.caption).foregroundStyle(.secondary) } }
                        if slot.flag("automatic") { Label("Hiển thị theo ngày đến hạn", systemImage: "clock").font(.caption).foregroundStyle(.secondary) }
                        else { Button("Bỏ lịch cá nhân") { state.handle { _ = try await state.mutate("/api/planner/\(slot.number("card_id"))", "DELETE") } }.font(.caption) }
                    }
                }
            }
            Section("Inbox trong ngày") { ForEach(data["inbox"].rows.filter { $0.text("date") == dateString(day) }) { Text($0.text("text")) } }
        }.navigationTitle("Planner").toolbar { Button("Xếp lịch") { edit = EditRequest(title: "Xếp lịch cá nhân", fields: [.pick("card_id", "Công việc", data["myCards"].rows.map { (String($0.id), $0.title) }, String(data["myCards"].rows.first?.id ?? 0)), FormField(id: "date", label: "Ngày dự kiến", value: .string(dateString(day)), kind: .date, required: true)]) { v in _ = try await state.mutate("/api/planner", "PUT", ["card_id": .id(v["card_id"]?.int ?? 0), "date": v["date"] ?? .null]) } }.disabled(data["myCards"].rows.isEmpty) }
        .sheet(item: $edit) { EditSheet($0) }.task(id: state.revision) { do { data = try await state.call("/api/planner") } catch { state.message = error.localizedDescription } }
    }
}
struct ProfileScreen: View {
    @EnvironmentObject var state: AppState
    @State private var edit: EditRequest?
    var body: some View {
        List {
            Section {
                Label(state.user?.title ?? "", systemImage: "person.crop.circle.fill").font(.title3.bold())
                Text(state.isDirector ? "Giám đốc · toàn công ty" : state.user?.flag("is_leader") == true ? "Leader · quản lý theo team" : "Thành viên · truy cập theo quyền được cấp").font(.caption).foregroundStyle(.secondary)
            }
            Section("Tài khoản") {
                Button("Đổi mật khẩu", systemImage: "key") { edit = EditRequest(title: "Đổi mật khẩu", fields: [FormField(id: "current", label: "Mật khẩu hiện tại", kind: .secure, required: true), FormField(id: "password", label: "Mật khẩu mới", kind: .secure, required: true)]) { v in _ = try await state.mutate("/api/me/password", "POST", v) } }
                NavigationLink { List { Section("Thông báo trong ứng dụng") { Text("Giao việc, bình luận, @mention, hạn và duyệt được đồng bộ khi mở app.") }; Section("Thông báo khi app đóng") { Text("Chưa bật thông báo đẩy iOS. Cần hoàn tất tài khoản Apple Developer, cấu hình APNs và cài bản có chữ ký.").foregroundStyle(.secondary) } }.navigationTitle("Thông báo iPhone") } label: { Label("Thông báo iPhone", systemImage: "bell") }
            }
            if state.isDirector { Section("Quản trị công ty") { NavigationLink { TeamsScreen() } label: { Label("Team & leader", systemImage: "person.3") }; NavigationLink { UsersScreen() } label: { Label("Tài khoản công ty", systemImage: "person.2.badge.key") } } }
            Section("Kết nối") { Label(state.origin.host ?? "", systemImage: "lock.shield"); Text("Dữ liệu đồng bộ với website. Cần mạng để xem và lưu thay đổi.").font(.caption).foregroundStyle(.secondary); Text("Kairetic · bản phát triển 0.1").font(.caption).foregroundStyle(.secondary) }
            Section { Button("Đăng xuất", role: .destructive) { Task { await state.logout() } } }
        }.navigationTitle("Cá nhân").sheet(item: $edit) { EditSheet($0) }
    }
}
struct TeamsScreen: View {
    @EnvironmentObject var state: AppState
    @State private var teams: [Record] = []
    @State private var edit: EditRequest?
    var body: some View {
        List { if teams.isEmpty { EmptyState(title: "Chưa có team", symbol: "person.3") }; ForEach(teams) { team in NavigationLink { TeamScreen(team: team) } label: { VStack(alignment: .leading, spacing: 7) { Text(team.title).fontWeight(.semibold); let members = team["members"].rows; Text("\(members.count) thành viên · \(members.filter { $0.text("role") == "leader" }.count) leader").font(.caption).foregroundStyle(.secondary) } } } }
        .navigationTitle("Team & leader").toolbar { Button("Tạo team") { edit = EditRequest(title: "Tạo team", fields: [.text("name", "Tên team", required: true)]) { v in _ = try await state.mutate("/api/teams", "POST", v) } } }.sheet(item: $edit) { EditSheet($0) }
        .task(id: state.revision) { do { teams = try await state.call("/api/teams")["teams"].rows } catch { state.message = error.localizedDescription } }
    }
}
struct TeamScreen: View {
    @EnvironmentObject var state: AppState
    let team: Record
    @State private var current: Record?
    @State private var edit: EditRequest?
    var body: some View {
        let t = current ?? team
        List {
            Section { Button("Đổi tên team") { edit = EditRequest(title: "Đổi tên team", fields: [.text("name", "Tên team", t.title, required: true)]) { v in _ = try await state.mutate("/api/teams/\(t.id)", "PATCH", v) } }; Button("Thành viên & leader") { members(t) } }
            Section("Thành viên") { ForEach(t["members"].rows, id: \.userID) { m in HStack { Text(m.text("name")); Spacer(); Badge(text: m.text("role") == "leader" ? "Leader" : "Thành viên") } } }
        }.navigationTitle(t.title).sheet(item: $edit) { EditSheet($0) }.task(id: state.revision) { do { current = try await state.call("/api/teams")["teams"].rows.first { $0.id == team.id } } catch { state.message = error.localizedDescription } }
    }
    func members(_ t: Record) {
        let people = state.users.filter { !$0.flag("disabled") }
        let fields = people.map { u in FormField.pick(String(u.id), u.title, [("none", "Không tham gia"), ("member", "Thành viên"), ("leader", "Leader")], t["members"].rows.first { $0.number("user_id") == u.id }?.text("role") ?? "none") }
        edit = EditRequest(title: "Thành viên & leader", fields: fields, note: "Có thể giao nhiều leader trong một team; số team không bị giới hạn.") { v in
            let members: [JSON] = people.compactMap { u in guard let role = v[String(u.id)]?.string, role != "none" else { return nil }; return .object(["user_id": .id(u.id), "role": .string(role)]) }
            _ = try await state.mutate("/api/teams/\(t.id)/members", "PUT", ["members": .array(members)])
        }
    }
}
struct UsersScreen: View {
    @EnvironmentObject var state: AppState
    @State private var edit: EditRequest?
    var body: some View {
        List { ForEach(state.users) { u in Button { editor(u) } label: { HStack { VStack(alignment: .leading, spacing: 6) { Text(u.title).fontWeight(.medium); Text(u.text("username")).font(.caption).foregroundStyle(.secondary) }; Spacer(); Badge(text: u.flag("disabled") ? "Đã khóa" : u.flag("is_admin") ? "Giám đốc" : "Hoạt động", color: u.flag("disabled") ? .orange : brand) } } } }
        .navigationTitle("Tài khoản công ty").toolbar { Button("Tạo") { editor(nil) } }.sheet(item: $edit) { EditSheet($0) }
    }
    func editor(_ u: Record?) {
        var fields = [FormField.text("name", "Tên hiển thị", u?.title ?? "", required: true)]
        if u == nil { fields.append(.text("username", "Tên đăng nhập", required: true)) }
        fields.append(FormField(id: "password", label: u == nil ? "Mật khẩu ban đầu" : "Mật khẩu mới (trống để giữ)", kind: .secure, required: u == nil))
        if u?.id != state.user?.id { fields.append(FormField(id: "is_admin", label: "Quyền giám đốc / quản trị toàn công ty", value: .bool(u?.flag("is_admin") ?? false), kind: .toggle)); if u != nil { fields.append(FormField(id: "disabled", label: "Khóa tài khoản", value: .bool(u?.flag("disabled") ?? false), kind: .toggle)) } }
        edit = EditRequest(title: u == nil ? "Tạo tài khoản" : "Sửa tài khoản", fields: fields) { v in var body = v; if body["password"]?.string.isEmpty == true { body.removeValue(forKey: "password") }; _ = try await state.mutate(u == nil ? "/api/users" : "/api/users/\(u!.id)", u == nil ? "POST" : "PATCH", body) }
    }
}
