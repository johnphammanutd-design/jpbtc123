import SwiftUI

struct BoardScreen: View {
    @EnvironmentObject var state: AppState
    let boardID: Int
    @State private var snapshot: BoardSnapshot?
    @State private var error: String?
    @State private var view = "Kanban"
    @State private var filter: CardFilter = .all
    @State private var query = ""
    @State private var selectedList = 0
    @State private var selectedDate = Date()
    @State private var edit: EditRequest?
    @State private var collapsed = Set<Int>()
    var body: some View {
        Group {
            if let s = snapshot {
                VStack(spacing: 0) {
                    VStack(spacing: 10) {
                        Picker("Cách xem", selection: $view) { ForEach(["Kanban", "Lịch", "Bảng kê"], id: \.self) { Text($0) } }.pickerStyle(.segmented)
                        HStack {
                            Menu { Picker("Bộ lọc", selection: $filter) { ForEach(CardFilter.allCases, id: \.self) { Text($0.rawValue).tag($0) } } } label: { Label(filter == .all ? "Bộ lọc" : filter.rawValue, systemImage: "line.3.horizontal.decrease.circle") }
                            Spacer()
                            if !s.board.flag("closed") { Button { createCard(s) } label: { Label("Thẻ mới", systemImage: "plus") } }
                        }.font(.subheadline).padding(.vertical, 3)
                        if let error { Text(error).font(.caption).foregroundStyle(.red) }
                        if s.board.flag("closed") { Badge(text: "Bảng đã đóng", color: .orange) }
                    }.padding().background(.background)
                    if view == "Kanban" {
                        if s.lists.isEmpty { EmptyState(title: "Bảng chưa có cột", symbol: "rectangle.split.3x1") }
                        else {
                            Picker("Chuyển cột", selection: $selectedList) { ForEach(s.lists) { Text($0.title).tag($0.id) } }.pickerStyle(.menu).padding(.top, 4)
                            TabView(selection: $selectedList) { ForEach(s.lists) { list in column(list, s) .tag(list.id) } }.tabViewStyle(.page(indexDisplayMode: .always))
                        }
                    } else if view == "Lịch" {
                        ScrollView { DatePicker("Ngày đến hạn", selection: $selectedDate, displayedComponents: .date).datePickerStyle(.graphical).padding(.horizontal); cardsList(filtered(s).filter { $0.text("due_date") == dateString(selectedDate) }, s); let noDate = filtered(s).filter { $0.text("due_date").isEmpty }; if !noDate.isEmpty { Text("Chưa đặt ngày · \(noDate.count) thẻ").font(.caption).foregroundStyle(.secondary).padding() } }
                    } else {
                        List { ForEach(filtered(s)) { c in NavigationLink { CardScreen(cardID: c.id) } label: { VStack(alignment: .leading, spacing: 8) { Text(c.title).fontWeight(.medium); HStack { Text(s.lists.first { $0.id == c.number("list_id") }?.title ?? ""); Spacer(); Text(c.reviewLabel) }.font(.caption).foregroundStyle(.secondary); Text(s.members(of: c).map { $0.text("name") }.joined(separator: ", ")).font(.caption) } } } }
                    }
                }.background(canvas)
                .navigationTitle(s.board.title).navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    Button { state.handle { _ = try await state.mutate("/api/boards/\(boardID)/star"); try await load() } } label: { Image(systemName: state.boards.first { $0.id == boardID }?.flag("starred") == true ? "star.fill" : "star").accessibilityLabel("Gắn sao bảng") }
                    NavigationLink { BoardSettings(boardID: boardID) } label: { Image(systemName: "ellipsis.circle").accessibilityLabel("Menu bảng") }
                }
                .searchable(text: $query, prompt: "Tìm thẻ trong bảng")
            } else if let error { VStack { EmptyState(title: error, symbol: "wifi.exclamationmark"); Button("Thử lại") { state.handle { try await load() } } } }
            else { ProgressView("Đang tải bảng…") }
        }
        .sheet(item: $edit) { EditSheet($0) }
        .task(id: state.revision) { do { try await load(); state.watch(boardID) } catch is CancellationError {} catch { self.error = error.localizedDescription } }
        .onDisappear { state.watch(nil) }
    }
    func load() async throws {
        do { let data = try await state.call("/api/boards/\(boardID)"); try Task.checkCancellation(); let s = BoardSnapshot(data); snapshot = s; error = nil; if !s.lists.contains(where: { $0.id == selectedList }) { selectedList = s.lists.first?.id ?? 0 } }
        catch { if case APIError.server(let status, _) = error, [401, 403, 404].contains(status) { snapshot = nil }; throw error }
    }
    func filtered(_ s: BoardSnapshot) -> [Record] { s.cards.filter { filter.includes($0, snapshot: s, userID: state.user?.id ?? 0, today: today()) && (query.isEmpty || ($0.title + " " + $0.text("description")).localizedCaseInsensitiveContains(query)) } }
    func column(_ list: Record, _ s: BoardSnapshot) -> some View {
        let cards = filtered(s).filter { $0.number("list_id") == list.id }
        return ScrollView {
            VStack(spacing: 12) {
                HStack { Text(list.title).font(.title3.bold()); Badge(text: "\(cards.count)" + (list.number("wip_limit") > 0 ? " / \(list.number("wip_limit"))" : ""), color: list.number("wip_limit") > 0 && cards.count > list.number("wip_limit") ? .red : brand); Spacer(); Menu {
                    Button(collapsed.contains(list.id) ? "Mở rộng cột" : "Thu gọn cột") { if !collapsed.insert(list.id).inserted { collapsed.remove(list.id) } }
                    Button("Theo dõi / bỏ theo dõi cột") { state.handle { _ = try await state.mutate("/api/lists/\(list.id)/watch") } }
                    if s.canManage {
                        Button("Sửa cột / WIP / vị trí") { editList(list, s) }
                        Menu("Sắp xếp thẻ") { ForEach([("title", "Tên thẻ"), ("due", "Ngày hết hạn"), ("created", "Mới tạo")], id: \.0) { option in Button(option.1) { state.handle { _ = try await state.mutate("/api/lists/\(list.id)/sort", "POST", ["by": .string(option.0)]) } } } }
                        Button("Sao chép cột") { edit = EditRequest(title: "Sao chép cột", fields: [.text("title", "Tên cột", list.title + " · Bản sao", required: true)]) { v in _ = try await state.mutate("/api/lists/\(list.id)/copy", "POST", v) } }
                        Button("Chuyển tất cả thẻ") { edit = EditRequest(title: "Chuyển thẻ trong cột", fields: [.pick("list_id", "Cột đích", s.lists.filter { $0.id != list.id }.map { (String($0.id), $0.title) }, String(s.lists.first { $0.id != list.id }?.id ?? 0))]) { v in _ = try await state.mutate("/api/lists/\(list.id)/move-cards", "POST", ["list_id": .id(v["list_id"]?.int ?? 0)]) } }
                        DestructiveButton(title: "Lưu trữ thẻ trong cột", detail: "Có thể khôi phục từ kho lưu trữ.") { state.handle { _ = try await state.mutate("/api/lists/\(list.id)/archive-cards") } }
                        DestructiveButton(title: "Lưu trữ cột", detail: "Có thể khôi phục cột từ kho lưu trữ.") { state.handle { _ = try await state.mutate("/api/lists/\(list.id)", "PATCH", ["archived": .bool(true)]) } }
                    }
                } label: { Image(systemName: "ellipsis").padding(8).accessibilityLabel("Menu cột \(list.title)") } }
                if !collapsed.contains(list.id) {
                    if cards.isEmpty { EmptyState(title: "Cột này chưa có thẻ") }
                    ForEach(cards) { card in
                        NavigationLink { CardScreen(cardID: card.id) } label: { CardTile(card: card, snapshot: s) }.buttonStyle(.plain).draggable("kairetic-card:\(card.id)")
                            .dropDestination(for: String.self) { items, _ in
                                guard !s.board.flag("closed"), let item = items.first, item.hasPrefix("kairetic-card:"), let id = Int(item.dropFirst(14)), id != card.id, s.cards.contains(where: { $0.id == id }) else { return false }
                                let all = s.cards.filter { $0.number("list_id") == list.id && $0.id != id }
                                let index = all.firstIndex { $0.id == card.id } ?? 0
                                let position = OrderPosition.insertion(at: index, positions: all.map { $0["position"].double })
                                state.handle { _ = try await state.mutate("/api/cards/\(id)", "PATCH", ["list_id": .id(list.id), "position": .number(position)]) }; return true
                            }
                    }
                    if !s.board.flag("closed") { Button { createCard(s, list: list.id) } label: { Label("Thêm thẻ", systemImage: "plus") }.frame(maxWidth: .infinity).padding(10).background(.background.opacity(0.6), in: RoundedRectangle(cornerRadius: 12)) }
                }
            }.padding(.horizontal).padding(.top, 10).padding(.bottom, 45)
        }.refreshable { do { try await load() } catch { self.error = error.localizedDescription } }
        .dropDestination(for: String.self) { items, _ in
            guard !s.board.flag("closed"), let item = items.first, item.hasPrefix("kairetic-card:"), let id = Int(item.dropFirst(14)), s.cards.contains(where: { $0.id == id }) else { return false }
            let position = (s.cards.filter { $0.number("list_id") == list.id }.map { $0["position"].double }.max() ?? 0) + 1024
            state.handle { _ = try await state.mutate("/api/cards/\(id)", "PATCH", ["list_id": .id(list.id), "position": .number(position)]) }; return true
        }
    }
    func cardsList(_ cards: [Record], _ s: BoardSnapshot) -> some View { VStack { if cards.isEmpty { EmptyState(title: "Không có thẻ đến hạn ngày này", symbol: "calendar") }; ForEach(cards) { c in NavigationLink { CardScreen(cardID: c.id) } label: { CardTile(card: c, snapshot: s) }.buttonStyle(.plain) } }.padding(.horizontal) }
    func createCard(_ s: BoardSnapshot, list: Int? = nil) {
        guard let first = s.lists.first else { return }
        edit = EditRequest(title: "Tạo thẻ", fields: [.text("title", "Tên công việc", required: true), .pick("list_id", "Cột", s.lists.map { (String($0.id), $0.title) }, String(list ?? (selectedList == 0 ? first.id : selectedList)))]) { v in
            _ = try await state.mutate("/api/cards", "POST", ["title": v["title"] ?? .null, "list_id": .id(v["list_id"]?.int ?? first.id)])
        }
    }
    func editList(_ list: Record, _ s: BoardSnapshot) {
        let order = s.lists.firstIndex { $0.id == list.id } ?? 0
        edit = EditRequest(title: "Cài đặt cột", fields: [.text("title", "Tên cột", list.title, required: true), FormField(id: "wip_limit", label: "Giới hạn WIP (0 = không giới hạn)", value: list["wip_limit"], kind: .integer), .text("color", "Màu cột (#RRGGBB)", list.text("color")), .pick("order", "Vị trí trong bảng", s.lists.enumerated().map { (String($0.offset), "\($0.offset + 1). \($0.element.title)") }, String(order))]) { v in
            var body = v; body.removeValue(forKey: "order"); body["wip_limit"] = .id(v["wip_limit"]?.int ?? 0)
            let others = s.lists.filter { $0.id != list.id }
            let index = min(max(0, v["order"]?.int ?? order), others.count)
            body["position"] = .number(OrderPosition.insertion(at: index, positions: others.map { $0["position"].double }))
            _ = try await state.mutate("/api/lists/\(list.id)", "PATCH", body)
        }
    }
}
