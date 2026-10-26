import SwiftUI

struct InboxScreen: View {
    @EnvironmentObject private var state: AppState
    @State private var items: [Record] = []
    @State private var edit: EditRequest?
    @State private var destination: DestinationRequest?
    @State private var text = ""
    @State private var busy = false
    @State private var loading = false
    @State private var ordering = false
    @State private var needsReload = false
    @State private var error: String?
    var body: some View {
        List {
            if !ordering {
                Section("Ghi nhanh ý tưởng hoặc công việc") {
                    TextField("Nội dung", text: $text, axis: .vertical).lineLimit(2...5).accessibilityIdentifier("inbox.new")
                    Button("Thêm vào Inbox") { add() }.disabled(busy || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty).accessibilityIdentifier("inbox.add")
                }
            }
            if busy { ProgressView("Đang lưu…") }
            if let error {
                Section { Text(error).foregroundStyle(.red); Button("Tải lại Inbox") { Task { await load() } }.disabled(busy || loading) }
            }
            if loading && items.isEmpty { ProgressView("Đang tải Inbox…") }
            else if items.isEmpty { EmptyState(title: "Inbox trống", symbol: "tray") }
            Section {
                ForEach(items) { item in row(item).moveDisabled(busy || loading || needsReload || !ordering) }
                    .onMove { source, target in
                        if let move = InboxOrdering.intent(items: items, source: source, destination: target) { saveOrder(move) }
                    }
            } header: {
                if !items.isEmpty { Text("Công việc đã ghi · \(items.count)") }
            } footer: {
                if items.count > 1 { Text(ordering ? "Giữ và kéo tay nắm bên phải để đổi thứ tự. Thứ tự được lưu cho tài khoản của bạn." : "Bấm Sắp xếp để kéo đổi thứ tự. Có thể dùng menu nhấn giữ để đưa một mục lên đầu hoặc xuống cuối.") }
            }
        }.navigationTitle("Inbox").inputSupport()
        .environment(\.editMode, Binding(get: { ordering ? .active : .inactive }, set: { ordering = $0.isEditing }))
        .toolbar { Button(ordering ? "Xong" : "Sắp xếp", systemImage: ordering ? "checkmark" : "arrow.up.arrow.down") { withAnimation { ordering.toggle() } }.disabled(busy || loading || needsReload || (!ordering && items.count < 2)).accessibilityIdentifier("inbox.reorder") }
        .sheet(item: $edit) { EditSheet($0) }.sheet(item: $destination) { DestinationSheet($0) }
        .task(id: state.revision) { if !busy { await load() } }
        .refreshable { if !busy { await load() } }
    }
    private func row(_ item: Record) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(item.text("text")).fontWeight(.medium).fixedSize(horizontal: false, vertical: true)
            if !item.text("date").isEmpty { Label(item.text("date"), systemImage: "calendar").font(.caption).foregroundStyle(.secondary) }
            if !ordering {
                FlowLayout {
                    Button("Thành thẻ") {
                        destination = DestinationRequest(title: "Chuyển Inbox thành thẻ", initialBoard: state.boards.first { !$0.flag("closed") }?.id ?? 0) { list, _, _ in
                            _ = try await state.mutate("/api/inbox/\(item.id)/convert", "POST", ["list_id": .id(list)]); await load()
                        }
                    }.disabled(state.boards.allSatisfy { $0.flag("closed") })
                    Button("Sửa") {
                        edit = EditRequest(title: "Sửa Inbox", fields: [FormField(id: "text", label: "Nội dung", value: item["text"], kind: .multiline, required: true), FormField(id: "date", label: "Ngày dự kiến", value: item["date"], kind: .date)]) { values in
                            _ = try await state.mutate("/api/inbox/\(item.id)", "PATCH", values); await load()
                        }
                    }
                    DestructiveButton(title: "Xóa") { state.handle { _ = try await state.mutate("/api/inbox/\(item.id)", "DELETE"); await load() } }
                }.font(.subheadline).buttonStyle(.borderless).disabled(busy || needsReload)
            }
        }.padding(.vertical, 5).accessibilityIdentifier("inbox.item.\(item.id)")
        .contextMenu {
            Button("Đưa lên đầu", systemImage: "arrow.up.to.line") { saveOrder(InboxMove(itemID: item.id, beforeID: items.first?.id)) }.disabled(item.id == items.first?.id || busy || needsReload)
            Button("Đưa xuống cuối", systemImage: "arrow.down.to.line") { saveOrder(InboxMove(itemID: item.id, beforeID: nil)) }.disabled(item.id == items.last?.id || busy || needsReload)
        }
        .accessibilityAction(named: Text("Đưa lên một vị trí")) {
            if let index = items.firstIndex(where: { $0.id == item.id }), index > 0 { saveOrder(InboxMove(itemID: item.id, beforeID: items[index - 1].id)) }
        }
        .accessibilityAction(named: Text("Đưa xuống một vị trí")) {
            if let index = items.firstIndex(where: { $0.id == item.id }), index + 1 < items.count { saveOrder(InboxMove(itemID: item.id, beforeID: index + 2 < items.count ? items[index + 2].id : nil)) }
        }
    }
    private func load() async {
        loading = true; defer { loading = false }
        do { let result = try await state.call("/api/inbox")["items"].rows; try Task.checkCancellation(); items = result; needsReload = false; error = nil }
        catch is CancellationError {} catch { self.error = error.localizedDescription; needsReload = true }
    }
    private func add() {
        guard !busy else { return }; busy = true
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            defer { busy = false }
            do { _ = try await state.mutate("/api/inbox", "POST", ["text": .string(value)]); text = ""; await load() }
            catch { self.error = error.localizedDescription }
        }
    }
    private func saveOrder(_ move: InboxMove) {
        guard !busy, !loading, !needsReload else { return }
        let previous = items
        guard let preview = try? InboxOrdering.plan(move, items: items), !preview.writes.isEmpty else { return }
        items = preview.items; busy = true; error = nil
        Task {
            defer { busy = false }
            do {
                let latest = try await state.call("/api/inbox")["items"].rows
                let plan = try InboxOrdering.plan(move, items: latest)
                for write in plan.writes { _ = try await state.call("/api/inbox/\(write.id)", "PATCH", ["position": .number(write.position)]) }
                let confirmed = try await state.call("/api/inbox")["items"].rows
                items = confirmed; needsReload = false; state.revision += 1
            } catch {
                // A response can be lost after a write. Show the canonical order before accepting another move.
                let saveError = error.localizedDescription
                do { items = try await state.call("/api/inbox")["items"].rows; needsReload = false; self.error = "Chưa xác nhận được thao tác sắp xếp. Danh sách đã tải lại từ máy chủ. " + saveError }
                catch { items = previous; needsReload = true; self.error = "Chưa xác nhận được thứ tự đã lưu. Hãy tải lại Inbox khi có mạng trước khi sắp xếp tiếp. " + saveError }
            }
        }
    }
}
