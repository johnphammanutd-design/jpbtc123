import SwiftUI

struct BoardScreen: View {
    @EnvironmentObject var state: AppState
    @Environment(\.dynamicTypeSize) private var typeSize
    let boardID: Int
    @State private var snapshot: BoardSnapshot?
    @State private var error: String?
    @State private var view = "Kanban"
    @State private var filter = BoardFilter()
    @State private var showFilters = false
    @State private var selectedList = 0
    @State private var selectedDate = Date()
    @State private var edit: EditRequest?
    @State private var collapsed = Set<Int>()
    @State private var showTemplates = false
    @State private var templateListID = 0
    @State private var quickEdit: QuickEditRequest?
    @State private var tableOrdering = TableOrdering()
    var body: some View {
        Group {
            if let s = snapshot {
                VStack(spacing: 0) {
                    VStack(spacing: 10) {
                        Group { if typeSize.isAccessibilitySize { viewPicker.pickerStyle(.menu) } else { viewPicker.pickerStyle(.segmented) } }
                        FlowLayout {
                            Button { showFilters = true } label: { Label(filter.active ? "Đang lọc" : "Bộ lọc", systemImage: filter.active ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle") }
                            Menu { Button("Thu gọn tất cả cột") { collapsed = Set(s.lists.map(\.id)) }; Button("Mở rộng tất cả cột") { collapsed = [] } } label: { Image(systemName: "rectangle.compress.vertical").accessibilityLabel("Thu gọn hoặc mở rộng cột") }
                            if !s.board.flag("closed") { Menu { Button("Tạo thẻ trống") { createCard(s) }; Button("Tạo thẻ từ mẫu") { templateListID = selectedList; showTemplates = true } } label: { Label("Thẻ mới", systemImage: "plus") } }
                        }.font(.subheadline).padding(.vertical, 3)
                        if let error { Text(error).font(.caption).foregroundStyle(.red) }
                        if s.board.flag("closed") { Badge(text: "Bảng đã đóng", color: .orange) }
                    }.padding().background(.background)
                    if view == "Kanban" {
                        if s.lists.isEmpty { EmptyState(title: "Bảng chưa có cột", symbol: "rectangle.split.3x1") }
                        else {
                            Picker("Chuyển cột", selection: $selectedList) { ForEach(s.lists) { Text($0.title).tag($0.id) } }.pickerStyle(.menu).padding(.top, 4).background(.regularMaterial)
                            TabView(selection: $selectedList) { ForEach(s.lists) { list in column(list, s) .tag(list.id) } }.tabViewStyle(.page(indexDisplayMode: .always))
                        }
                    } else if view == "Lịch" {
                        ScrollView { DatePicker("Ngày đến hạn", selection: $selectedDate, displayedComponents: .date).datePickerStyle(.graphical).padding(.horizontal); cardsList(filtered(s).filter { $0.text("due_date") == dateString(selectedDate) }, s); let noDate = filtered(s).filter { $0.text("due_date").isEmpty }; if !noDate.isEmpty { Text("Chưa đặt ngày · \(noDate.count) thẻ").font(.caption).foregroundStyle(.secondary).padding() } }
                    } else {
                        BoardTableView(snapshot: s, cards: filtered(s), ordering: $tableOrdering)
                    }
                }.background { BoardBackdrop(background: s.board.text("background")) }
                .navigationTitle(s.board.title).navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    Button { state.handle { _ = try await state.mutate("/api/boards/\(boardID)/star"); try await load() } } label: { Image(systemName: state.boards.first { $0.id == boardID }?.flag("starred") == true ? "star.fill" : "star").accessibilityLabel("Gắn sao bảng") }
                    NavigationLink { BoardSettings(boardID: boardID) } label: { Image(systemName: "ellipsis.circle").accessibilityLabel("Menu bảng") }
                }
                .searchable(text: $filter.text, prompt: "Tìm thẻ trong bảng")
            } else if let error { VStack { EmptyState(title: error, symbol: "wifi.exclamationmark"); Button("Thử lại") { state.handle { try await load() } } } }
            else { ProgressView("Đang tải bảng…") }
        }
        .sheet(item: $edit) { EditSheet($0) }
        .sheet(item: $quickEdit) { QuickEditSheet($0) }
        .sheet(isPresented: $showTemplates) { if let snapshot { TemplatePickerSheet(snapshot: snapshot, listID: templateListID == 0 ? snapshot.lists.first?.id ?? 0 : templateListID) } }
        .sheet(isPresented: $showFilters) { if let snapshot { BoardFilterSheet(filter: $filter, snapshot: snapshot) } }
        .task(id: state.revision) { do { try await load(); state.watch(boardID) } catch is CancellationError {} catch { self.error = error.localizedDescription } }
        .onDisappear { state.watch(nil) }
    }
    private var viewPicker: some View { Picker("Cách xem", selection: $view) { ForEach(["Kanban", "Lịch", "Bảng kê"], id: \.self) { Text($0) } } }
    func load() async throws {
        do { let data = try await state.call("/api/boards/\(boardID)"); try Task.checkCancellation(); let s = BoardSnapshot(data); snapshot = s; error = nil; if !s.lists.contains(where: { $0.id == selectedList }) { selectedList = s.lists.first?.id ?? 0 } }
        catch { if case APIError.server(let status, _) = error, [401, 403, 404].contains(status) { snapshot = nil }; throw error }
    }
    func filtered(_ s: BoardSnapshot) -> [Record] { s.cards.filter { filter.includes($0, snapshot: s, userID: state.user?.id ?? 0) } }
    func column(_ list: Record, _ s: BoardSnapshot) -> some View {
        let cards = filtered(s).filter { $0.number("list_id") == list.id }
        let total = s.cards.filter { $0.number("list_id") == list.id }.count
        let showWIP = s.board["powerups"].parsed["wip"].flag && list.number("wip_limit") > 0
        return ScrollView {
            VStack(spacing: 12) {
                HStack { Text(list.title).font(.title3.bold()); Badge(text: showWIP ? "\(total) / \(list.number("wip_limit"))" : "\(cards.count)", color: showWIP && total > list.number("wip_limit") ? .red : brand); Spacer(); Menu {
                    Button(collapsed.contains(list.id) ? "Mở rộng cột" : "Thu gọn cột") { if !collapsed.insert(list.id).inserted { collapsed.remove(list.id) } }
                    Button("Theo dõi / bỏ theo dõi cột") { state.handle { _ = try await state.mutate("/api/lists/\(list.id)/watch") } }
                    if s.canManage {
                        Button("Sửa cột / WIP / vị trí") { editList(list, s) }
                        Menu("Sắp xếp toàn bộ thẻ") { ForEach([("title", "Tên thẻ A → Z"), ("due", "Ngày hết hạn sớm trước"), ("created", "Mới tạo trước")], id: \.0) { option in Button(option.1) { state.handle { _ = try await state.mutate("/api/lists/\(list.id)/sort", "POST", ["by": .string(option.0)]) } } } }
                        Button("Sao chép cột") { edit = EditRequest(title: "Sao chép cột", fields: [.text("title", "Tên cột", list.title + " · Bản sao", required: true)]) { v in _ = try await state.mutate("/api/lists/\(list.id)/copy", "POST", v) } }
                        Button("Chuyển tất cả thẻ") { edit = EditRequest(title: "Chuyển thẻ trong cột", fields: [.pick("list_id", "Cột đích", s.lists.filter { $0.id != list.id }.map { (String($0.id), $0.title) }, String(s.lists.first { $0.id != list.id }?.id ?? 0))]) { v in _ = try await state.mutate("/api/lists/\(list.id)/move-cards", "POST", ["list_id": .id(v["list_id"]?.int ?? 0)]) } }
                        DestructiveButton(title: "Lưu trữ thẻ trong cột", detail: "Có thể khôi phục từ kho lưu trữ.") { state.handle { _ = try await state.mutate("/api/lists/\(list.id)/archive-cards") } }
                        DestructiveButton(title: "Lưu trữ cột", detail: "Có thể khôi phục cột từ kho lưu trữ.") { state.handle { _ = try await state.mutate("/api/lists/\(list.id)", "PATCH", ["archived": .bool(true)]) } }
                    }
                } label: { Image(systemName: "ellipsis").padding(8).accessibilityLabel("Menu cột \(list.title)") } }.padding(10).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 13))
                if !collapsed.contains(list.id) {
                    if cards.isEmpty { EmptyState(title: "Cột này chưa có thẻ").background(.regularMaterial, in: RoundedRectangle(cornerRadius: 15)) }
                    if filter.active { Text("Hiển thị \(cards.count)/\(total) thẻ").font(.caption).foregroundStyle(.secondary) }
                    ForEach(cards) { card in
                        NavigationLink { CardScreen(cardID: card.id) } label: { CardTile(card: card, snapshot: s, reservesActionSpace: !s.board.flag("closed") && card.number("mirror_of") == 0) }.buttonStyle(.plain)
                            .overlay(alignment: .topTrailing) {
                                if !s.board.flag("closed"), card.number("mirror_of") == 0 { Button { quickEdit = QuickEditRequest(card: card, snapshot: s) } label: { Image(systemName: "pencil").frame(width: 44, height: 44) }.buttonStyle(.borderless).accessibilityLabel("Sửa nhanh \(card.title)") }
                            }
                            .contextMenu { if !s.board.flag("closed"), card.number("mirror_of") == 0 { Button("Sửa nhanh", systemImage: "pencil") { quickEdit = QuickEditRequest(card: card, snapshot: s) } } }
                            .draggable("kairetic-card:\(card.id)")
                            .dropDestination(for: String.self) { items, _ in
                                guard !s.board.flag("closed"), let item = items.first, item.hasPrefix("kairetic-card:"), let id = Int(item.dropFirst(14)), id != card.id, s.cards.contains(where: { $0.id == id }) else { return false }
                                let all = s.cards.filter { $0.number("list_id") == list.id && $0.id != id }
                                let index = all.firstIndex { $0.id == card.id } ?? 0
                                let position = OrderPosition.insertion(at: index, positions: all.map { $0["position"].double })
                                state.handle { _ = try await state.mutate("/api/cards/\(id)", "PATCH", ["list_id": .id(list.id), "position": .number(position)]) }; return true
                            }
                    }
                    if !s.board.flag("closed") {
                        FlowLayout {
                            Button { createCard(s, list: list.id) } label: { Label("Thêm thẻ", systemImage: "plus") }
                            Button { templateListID = list.id; showTemplates = true } label: { Label("Từ mẫu", systemImage: "rectangle.stack.badge.plus") }.accessibilityLabel("Tạo thẻ từ mẫu trong \(list.title)")
                        }.font(.subheadline).padding(12).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                    }
                }
            }.padding(.horizontal).padding(.top, 10).padding(.bottom, 45)
                .background(list.text("color").isEmpty ? Color.clear : Color(hex: list.text("color")).opacity(0.12))
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
