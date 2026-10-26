import SwiftUI

@main struct KaireticApp: App {
    @StateObject private var state = AppState()
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(state).tint(brand).environment(\.timeZone, CompanyClock.timeZone).task { await state.restore() }
                .onChange(of: phase) { _, value in
                    if value == .active, state.user != nil { state.connect(); state.handle { try await state.refresh(); state.revision += 1 } }
                    if value == .background { state.disconnect() }
                }
        }
    }
}
struct CardLink: Identifiable { let id: Int }
struct RootView: View {
    @EnvironmentObject var state: AppState
    @State private var linkedCard: CardLink?
    var body: some View {
        Group {
            if state.restoring { ProgressView("Đang kết nối…") }
            else if state.user == nil { LoginScreen() }
            else {
                TabView {
                    NavigationStack { OverviewScreen() }.tabItem { Label("Tổng quan", systemImage: "square.grid.2x2") }
                    NavigationStack { TaskHome() }.tabItem { Label("Task", systemImage: "rectangle.split.3x1") }
                    NavigationStack { NotificationsScreen() }.tabItem { Label("Thông báo", systemImage: "bell") }.badge(state.unread)
                    NavigationStack { ProfileScreen() }.tabItem { Label("Cá nhân", systemImage: "person.crop.circle") }
                }
            }
        }
        .alert("Thông báo", isPresented: Binding(get: { state.message != nil }, set: { if !$0 { state.message = nil } })) { Button("Đóng") { state.message = nil } } message: { Text(state.message ?? "") }
        .sheet(item: $linkedCard) { card in NavigationStack { CardScreen(cardID: card.id).toolbar { ToolbarItem(placement: .cancellationAction) { Button("Đóng") { linkedCard = nil } } } } }
        .onOpenURL { url in
            guard url.scheme == "kairetic", url.host == "card", let id = Int(url.lastPathComponent), id > 0, state.user != nil else { return }
            linkedCard = CardLink(id: id)
        }
    }
}
struct LoginScreen: View {
    @EnvironmentObject var state: AppState
    @State private var username = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 25) {
                Image(systemName: "square.stack.3d.up.fill").font(.system(size: 46)).foregroundStyle(brand).padding(.top, 65)
                VStack(alignment: .leading, spacing: 9) {
                    Text("KAIRETIC").font(.caption.weight(.bold)).tracking(3).foregroundStyle(brand)
                    Text("Công việc kết nối.\nĐội ngũ đồng hành.").font(.largeTitle.bold())
                    Text("Đăng nhập bằng tài khoản công ty để tiếp tục.").foregroundStyle(.secondary)
                }
                VStack(spacing: 16) {
                    TextField("Tên đăng nhập", text: $username).textContentType(.username).textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier("login.username")
                    Divider()
                    SecureField("Mật khẩu", text: $password).textContentType(.password).accessibilityIdentifier("login.password")
                }.padding(20).background(.background, in: RoundedRectangle(cornerRadius: 16))
                if let error { Text(error).font(.subheadline).foregroundStyle(.red) }
                Button { signIn() } label: { HStack { Spacer(); if busy { ProgressView().tint(.white) } else { Text("Đăng nhập").fontWeight(.semibold) }; Spacer() }.padding(8) }.buttonStyle(.borderedProminent).tint(actionFill).controlSize(.large).disabled(busy || username.isEmpty || password.isEmpty).accessibilityIdentifier("login.submit")
                Label(state.origin.host ?? "", systemImage: "lock.shield").font(.footnote).foregroundStyle(.secondary)
                #if DEBUG
                if state.origin.scheme == "http" { Badge(text: "Môi trường thử nghiệm riêng", color: .orange) }
                #endif
            }.padding(26).frame(maxWidth: 530)
        }.frame(maxWidth: .infinity).background(canvas).inputSupport().disabled(busy).onSubmit(signIn)
    }
    func signIn() {
        guard !busy else { return }; busy = true; error = nil
        Task { do { try await state.login(username: username.trimmingCharacters(in: .whitespacesAndNewlines), password: password); password = "" } catch { self.error = error.localizedDescription }; busy = false }
    }
}
struct OverviewScreen: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    @EnvironmentObject var state: AppState
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 6) { Text("Chào \(state.user?.text("name") ?? "")").font(.title2.bold()); Text(state.isDirector ? "Tình hình vận hành công ty" : "Công việc trong các bảng được cấp quyền").foregroundStyle(.secondary) }.padding(.horizontal)
                LazyVGrid(columns: typeSize.isAccessibilitySize ? [GridItem(.flexible())] : [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    metric("Đang thực hiện", max(0, state.overview["stats"]["total"].int - state.overview["stats"]["done"].int), "square.stack", brand)
                    metric("Chờ duyệt", state.overview["stats"]["pending"].int, "checkmark.seal", .orange)
                    metric("Quá hạn", state.overview["stats"]["overdue"].int, "clock.badge.exclamationmark", .red)
                    metric("Hoàn thành", state.overview["stats"]["done"].int, "checkmark.circle", .green)
                }.padding(.horizontal)
                if state.canCreate {
                    Surface { Text("Theo team").font(.headline); ForEach(state.overview["teams"].rows) { team in HStack { VStack(alignment: .leading) { Text(team.title).fontWeight(.medium); Text("\(team.number("total")) việc · \(team.number("done")) hoàn thành").font(.caption).foregroundStyle(.secondary) }; Spacer(); Badge(text: "\(team.number("pending")) chờ duyệt", color: .orange) } } }
                }
                Text("Cần bạn duyệt").font(.title3.bold()).padding(.horizontal)
                let pending = state.overview["cards"].rows.filter { $0.text("approval_state") == "pending" && ($0.number("reviewer_id") == state.user?.id || state.isDirector) }
                if pending.isEmpty { EmptyState(title: "Không có việc chờ bạn duyệt", symbol: "checkmark.seal") }
                ForEach(pending) { card in NavigationLink { CardScreen(cardID: card.id) } label: { CardTile(card: card) }.buttonStyle(.plain).padding(.horizontal) }
            }.padding(.vertical)
        }.background(canvas).navigationTitle("Tổng quan").refreshable { do { try await state.refresh() } catch { state.message = error.localizedDescription } }
    }
    func metric(_ title: String, _ n: Int, _ icon: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 14) { Image(systemName: icon).foregroundStyle(color); Text("\(n)").font(.largeTitle.bold()); Text(title).font(.subheadline).foregroundStyle(.secondary) }.padding(17).frame(maxWidth: .infinity, alignment: .leading).background(.background, in: RoundedRectangle(cornerRadius: 17))
    }
}
struct TaskHome: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    @EnvironmentObject var state: AppState
    @State private var tab = "boards"
    @State private var myCards: [Record] = []
    @State private var workStatus = "active"
    @State private var workLoading = false
    @State private var workError: String?
    @State private var edit: EditRequest?
    @State private var closed = false
    private var workPicker: some View { Picker("Danh sách công việc", selection: $tab) { Text("Bảng").tag("boards"); Text("Việc của tôi").tag("mine"); Text("Chờ duyệt").tag("review") } }
    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                Group { if typeSize.isAccessibilitySize { workPicker.pickerStyle(.menu) } else { workPicker.pickerStyle(.segmented) } }
                FlowLayout { NavigationLink { InboxScreen() } label: { Label("Inbox", systemImage: "tray") }; NavigationLink { PlannerScreen() } label: { Label("Planner", systemImage: "calendar") }; NavigationLink { SearchScreen() } label: { Image(systemName: "magnifyingglass").accessibilityLabel("Tìm công việc") } }.buttonStyle(.bordered)
                if tab == "boards" {
                    ForEach(state.boards.filter { $0.flag("closed") == closed }.sorted { $0.flag("starred") && !$1.flag("starred") }) { board in
                        NavigationLink { BoardScreen(boardID: board.id) } label: { HStack(spacing: 14) {
                            Group {
                                if board.text("background").hasPrefix("url:/u/") { AuthenticatedImage(path: String(board.text("background").dropFirst(4))) }
                                else { RoundedRectangle(cornerRadius: 12).fill(boardColor(board.text("background"))).overlay(Image(systemName: "rectangle.split.3x1").foregroundStyle(.white)) }
                            }.frame(width: 55, height: 65).clipped().clipShape(RoundedRectangle(cornerRadius: 12))
                            VStack(alignment: .leading, spacing: 8) { Text(board.title).font(.headline).foregroundStyle(.primary); Label("\(board.number("card_count")) thẻ · \(board.text("role") == "manager" ? "Quản lý" : "Thành viên")", systemImage: "lock").font(.caption).foregroundStyle(.secondary) }; Spacer(); if board.flag("starred") { Image(systemName: "star.fill").foregroundStyle(.orange) }
                        }.padding(15).background(.background, in: RoundedRectangle(cornerRadius: 17)) }.buttonStyle(.plain)
                    }
                    if state.boards.filter({ $0.flag("closed") == closed }).isEmpty { EmptyState(title: closed ? "Chưa có bảng đã đóng" : "Chưa được cấp quyền vào bảng") }
                    Toggle("Bảng đã đóng", isOn: $closed).font(.subheadline).padding(.vertical)
                } else {
                    if tab == "mine" {
                        Picker("Trạng thái việc của tôi", selection: $workStatus) { Text("Đang làm").tag("active"); Text("Đã xong").tag("done"); Text("Tất cả").tag("all") }.pickerStyle(.segmented)
                        if workLoading { ProgressView("Đang tải công việc…") }
                        if let workError { Text(workError).font(.footnote).foregroundStyle(.red) }
                    }
                    let cards = tab == "mine" ? myCards.filter { workStatus == "all" || $0.flag("due_complete") == (workStatus == "done") } : state.overview["cards"].rows.filter { $0.text("approval_state") == "pending" && ($0.number("reviewer_id") == state.user?.id || state.isDirector) }
                    if cards.isEmpty { EmptyState(title: "Không có công việc") }
                    ForEach(cards) { c in NavigationLink { CardScreen(cardID: c.id) } label: { CardTile(card: c) }.buttonStyle(.plain) }
                }
            }.padding()
        }.background(canvas).navigationTitle("Task")
        .toolbar { if state.canCreate { Button { edit = EditRequest(title: "Tạo bảng", fields: [.text("title", "Tên bảng", required: true)]) { v in _ = try await state.mutate("/api/boards", "POST", v) } } label: { Image(systemName: "plus").accessibilityLabel("Tạo bảng") } } }
        .sheet(item: $edit) { EditSheet($0) }
        .task(id: "\(state.revision)-\(tab)") { if tab == "mine" { await loadMyWork() } }
        .refreshable { do { try await state.refresh(); if tab == "mine" { await loadMyWork() } } catch { state.message = error.localizedDescription } }
    }
    func loadMyWork() async {
        workLoading = true; workError = nil
        defer { workLoading = false }
        do { let cards = try await state.myWork(); try Task.checkCancellation(); myCards = cards }
        catch is CancellationError {}
        catch { myCards = []; workError = "Chưa tải đủ công việc. Kéo xuống để thử lại. " + error.localizedDescription }
    }

}
func boardColor(_ name: String) -> Color {
    switch name { case "forest": return Color(hex: "36765d"); case "sunset": return Color(hex: "b66c53"); case "violet", "purple": return Color(hex: "705aa7"); default: return brand }
}
struct NotificationsScreen: View {
    @EnvironmentObject var state: AppState
    var body: some View {
        List {
            if state.notifications.isEmpty { EmptyState(title: "Chưa có thông báo", symbol: "bell") }
            ForEach(state.notifications) { n in
                NavigationLink { CardScreen(cardID: n.number("card_id")) } label: { VStack(alignment: .leading, spacing: 8) {
                    HStack { if !n.flag("read") { Circle().fill(brand).frame(width: 7, height: 7) }; Text(n.text("card_title")).fontWeight(n.flag("read") ? .regular : .semibold) }
                    Text(notificationText(n)).font(.subheadline).foregroundStyle(.secondary)
                    Text(CompanyClock.displayTimestamp(n.text("created_at"))).font(.caption).foregroundStyle(.secondary)
                }.padding(.vertical, 5) }.simultaneousGesture(TapGesture().onEnded { state.handle { _ = try await state.mutate("/api/notifications/read", "POST", ["ids": .array([.id(n.id)])]) } })
            }
        }.navigationTitle("Thông báo").toolbar { Button("Đọc hết") { state.handle { _ = try await state.mutate("/api/notifications/read") } }.disabled(state.unread == 0) }
        .refreshable { do { try await state.refresh() } catch { state.message = error.localizedDescription } }
    }
    func notificationText(_ n: Record) -> String { EventText.notification(n) }
}
struct SearchScreen: View {
    @EnvironmentObject var state: AppState
    @State private var query = ""
    @State private var results: [Record] = []
    @State private var error: String?
    @State private var busy = false
    var body: some View {
        List { if busy { ProgressView() }; if let error { Text(error).foregroundStyle(.red) }; ForEach(results) { c in NavigationLink { CardScreen(cardID: c.id) } label: { CardTile(card: c) } }; if results.isEmpty && !busy { EmptyState(title: query.isEmpty ? "Tìm trong các bảng được cấp quyền" : "Chưa tìm thấy công việc", symbol: "magnifyingglass") } }
        .navigationTitle("Tìm kiếm").searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Tên hoặc nội dung công việc").onSubmit(of: .search) { search() }
    }
    func search() { busy = true; error = nil; Task { defer { busy = false }; do { let q = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed.subtracting(CharacterSet(charactersIn: "&+?=#"))) ?? ""; results = try await state.call("/api/search?q=\(q)")["cards"].rows } catch { self.error = error.localizedDescription } } }
}
