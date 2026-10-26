import SwiftUI

struct QuickEditRequest: Identifiable {
    var id: Int { card.id }
    let card: Record
    let snapshot: BoardSnapshot
}
struct QuickEditSheet: View {
    @EnvironmentObject private var state: AppState
    @Environment(\.dismiss) private var dismiss
    let request: QuickEditRequest
    private let original: QuickCardDraft
    @State private var draft: QuickCardDraft
    @State private var busy = false
    @State private var error: String?
    init(_ request: QuickEditRequest) {
        self.request = request; original = QuickCardDraft(card: request.card, snapshot: request.snapshot)
        _draft = State(initialValue: original)
    }
    var body: some View {
        NavigationStack {
            Form {
                Section("Công việc") {
                    TextField("Tên công việc", text: $draft.title, axis: .vertical).lineLimit(1...4).accessibilityIdentifier("quick.title")
                    Toggle("Đặt ngày hết hạn", isOn: Binding(get: { !draft.dueDate.isEmpty }, set: { enabled in draft.dueDate = enabled ? dateString(Date()) : ""; if !enabled { draft.dueTime = "" } }))
                    if !draft.dueDate.isEmpty {
                        DatePicker("Ngày hết hạn", selection: Binding(get: { CompanyClock.date(draft.dueDate) ?? Date() }, set: { draft.dueDate = dateString($0) }), displayedComponents: .date)
                        Toggle("Đặt giờ hết hạn", isOn: Binding(get: { !draft.dueTime.isEmpty }, set: { draft.dueTime = $0 ? "17:00" : "" }))
                        if !draft.dueTime.isEmpty { DatePicker("Giờ hết hạn", selection: Binding(get: { CompanyClock.wallTime(draft.dueTime) ?? Date() }, set: { draft.dueTime = CompanyClock.time($0) }), displayedComponents: .hourAndMinute) }
                    }
                }
                Section("Nhãn") {
                    if request.snapshot.rows("labels").isEmpty { Text("Bảng chưa có nhãn").foregroundStyle(.secondary) }
                    ForEach(request.snapshot.rows("labels")) { label in
                        Toggle(isOn: Binding(get: { draft.labelIDs.contains(label.id) }, set: { on in if on { draft.labelIDs.insert(label.id) } else { draft.labelIDs.remove(label.id) } })) {
                            Label(label.text("name").isEmpty ? "Nhãn" : label.text("name"), systemImage: "tag.fill").foregroundStyle(Color(hex: label.text("color")))
                        }.accessibilityIdentifier("quick.label.\(label.id)")
                    }
                }
                Text("Nếu công việc đã gửi hoặc được duyệt, thay đổi nội dung sẽ yêu cầu gửi duyệt lại.").font(.footnote).foregroundStyle(.secondary)
                if let error { Text(error).font(.footnote).foregroundStyle(.red) }
            }.disabled(busy).navigationTitle("Sửa nhanh thẻ").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Hủy") { dismiss() }.disabled(busy) }
                ToolbarItem(placement: .confirmationAction) { if busy { ProgressView() } else { Button("Lưu") { save() }.fontWeight(.semibold).accessibilityIdentifier("quick.save") } }
            }.interactiveDismissDisabled(busy)
        }.environment(\.timeZone, CompanyClock.timeZone)
    }
    private func save() {
        guard !draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { error = "Vui lòng nhập tên công việc."; return }
        guard !busy else { return }; busy = true; error = nil
        Task {
            var wrote = false
            defer { busy = false; if wrote { state.revision += 1; state.handle { try await state.refresh() } } }
            do {
                let latest = BoardSnapshot(try await state.call("/api/boards/\(request.snapshot.board.id)"))
                guard !latest.board.flag("closed"), let currentCard = latest.cards.first(where: { $0.id == request.id }), currentCard.number("mirror_of") == 0 else { throw APIError.server(409, "Thẻ không còn trong bảng đang hoạt động. Hãy tải lại bảng.") }
                let current = QuickCardDraft(card: currentCard, snapshot: latest)
                guard !draft.conflicts(with: current, original: original) else { throw APIError.server(409, "Thẻ đã được thay đổi trong lúc bạn sửa. Hủy và mở lại để xem nội dung mới.") }
                let changes = draft.changes(from: current)
                if !changes.isEmpty { _ = try await state.call("/api/cards/\(request.id)", "PATCH", changes); wrote = true }
                if draft.labelIDs != current.labelIDs {
                    _ = try await state.call("/api/cards/\(request.id)/labels", "PUT", ["label_ids": .array(draft.labelIDs.sorted().map(JSON.id))]); wrote = true
                }
                dismiss()
            } catch {
                self.error = (wrote ? "Đã lưu phần tiêu đề/ngày hạn; nhãn chưa lưu. Có thể bấm Lưu để thử lại. " : "") + error.localizedDescription
            }
        }
    }
}
struct TemplatePickerSheet: View {
    @EnvironmentObject private var state: AppState
    @Environment(\.dismiss) private var dismiss
    let snapshot: BoardSnapshot
    @State private var selectedTemplate = 0
    @State private var listID: Int
    @State private var title = ""
    @State private var keepMembers = true
    @State private var busy = false
    @State private var error: String?
    init(snapshot: BoardSnapshot, listID: Int) { self.snapshot = snapshot; _listID = State(initialValue: listID) }
    private var templates: [Record] { TemplateCards.available(in: snapshot) }
    var body: some View {
        NavigationStack {
            Form {
                if templates.isEmpty {
                    EmptyState(title: "Bảng chưa có thẻ mẫu", symbol: "rectangle.stack.badge.plus")
                    Text("Mở một thẻ → menu thẻ → Đặt làm thẻ mẫu. Sau đó quay lại đây để tạo công việc theo mẫu đó.").font(.footnote).foregroundStyle(.secondary)
                } else {
                    Section("Mẫu trong bảng này") {
                        ForEach(templates) { card in
                            Button { selectedTemplate = card.id; title = card.title } label: {
                                HStack(alignment: .top) {
                                    VStack(alignment: .leading, spacing: 6) { Text(card.title).fontWeight(.medium); Text("\(snapshot.checklist(of: card).count) việc con · \(snapshot.count("attachmentCounts", card: card.id)) đính kèm").font(.caption).foregroundStyle(.secondary) }
                                    Spacer(); Image(systemName: selectedTemplate == card.id ? "checkmark.circle.fill" : "circle")
                                }.padding(.vertical, 5)
                            }.buttonStyle(.plain)
                        }
                    }
                    if let selected = templates.first(where: { $0.id == selectedTemplate }) {
                        Section("Công việc mới") {
                            TextField("Tên công việc", text: $title, axis: .vertical).accessibilityIdentifier("template.title")
                            Picker("Cột đích", selection: $listID) { ForEach(snapshot.lists) { Text($0.title).tag($0.id) } }
                            Toggle("Giữ người phụ trách trong mẫu", isOn: $keepMembers)
                            if !selected.text("due_date").isEmpty { Text("Ngày hạn được sao chép từ mẫu: \(selected.text("due_date")) \(selected.text("due_time")). Có thể sửa trên thẻ mới.").font(.footnote).foregroundStyle(.secondary) }
                        }
                        if !selected.text("description").isEmpty { Section("Mô tả trong mẫu") { Text(selected.text("description")).font(.subheadline) } }
                        Section { Text("Giữ nội dung, nhãn, trường tùy chỉnh, checklist và đính kèm. Thẻ mới bắt đầu chưa hoàn thành; việc con được bỏ đánh dấu hoàn thành.").font(.footnote).foregroundStyle(.secondary) }
                    }
                }
                if let error { Text(error).foregroundStyle(.red) }
            }.disabled(busy).navigationTitle("Tạo thẻ từ mẫu").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Đóng") { dismiss() }.disabled(busy) }
                ToolbarItem(placement: .confirmationAction) { if busy { ProgressView() } else { Button("Tạo thẻ") { create() }.disabled(selectedTemplate == 0 || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || listID == 0).accessibilityIdentifier("template.create") } }
            }.interactiveDismissDisabled(busy)
        }
    }
    private func create() {
        guard !busy else { return }; busy = true; error = nil
        Task {
            defer { busy = false }
            do {
                let latest = BoardSnapshot(try await state.call("/api/boards/\(snapshot.board.id)"))
                guard !latest.board.flag("closed"), TemplateCards.available(in: latest).contains(where: { $0.id == selectedTemplate }), latest.lists.contains(where: { $0.id == listID }) else { throw APIError.server(409, "Mẫu hoặc cột đích đã thay đổi. Đóng và mở lại để chọn mẫu mới.") }
                _ = try await state.mutate("/api/cards/\(selectedTemplate)/copy", "POST", TemplateCards.copyBody(title: title, listID: listID, keepMembers: keepMembers))
                dismiss()
            } catch { self.error = error.localizedDescription }
        }
    }
}
