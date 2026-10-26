import SwiftUI
import QuickLook
import UniformTypeIdentifiers

let brand = Color(red: 0.14, green: 0.37, blue: 0.82)
let canvas = Color(uiColor: .systemGroupedBackground)
extension Color {
    init(hex: String) {
        let n = UInt64(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0x356cbb
        self.init(red: Double((n >> 16) & 255) / 255, green: Double((n >> 8) & 255) / 255, blue: Double(n & 255) / 255)
    }
}
func dateString(_ date: Date) -> String { let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"; return f.string(from: date) }
func today() -> String { dateString(Date()) }
struct EmptyState: View {
    var title = "Chưa có dữ liệu"
    var symbol = "tray"
    var body: some View { ContentUnavailableView(title, systemImage: symbol).frame(maxWidth: .infinity).padding(.vertical, 24) }
}
struct Badge: View {
    let text: String
    var color: Color = brand
    var body: some View { Text(text).font(.caption.weight(.medium)).foregroundStyle(color).padding(.horizontal, 9).padding(.vertical, 5).background(color.opacity(0.1), in: Capsule()) }
}
struct Surface<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View { VStack(alignment: .leading, spacing: 12) { content }.padding(16).frame(maxWidth: .infinity, alignment: .leading).background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18)).padding(.horizontal) }
}
struct FormField: Identifiable {
    enum Kind { case text, secure, multiline, toggle, integer, date, choice([(String, String)]), multi([(Int, String)]) }
    var id: String
    var label: String
    var value: JSON = .string("")
    var kind: Kind = .text
    var required = false
    static func text(_ id: String, _ label: String, _ value: String = "", required: Bool = false) -> FormField { FormField(id: id, label: label, value: .string(value), required: required) }
    static func pick(_ id: String, _ label: String, _ options: [(String, String)], _ value: String) -> FormField { FormField(id: id, label: label, value: .string(value), kind: .choice(options)) }
}
struct EditRequest: Identifiable {
    let id = UUID()
    var title: String
    var fields: [FormField]
    var note: String = ""
    var submit: String = "Lưu"
    var action: ([String: JSON]) async throws -> Void
}
struct EditSheet: View {
    let request: EditRequest
    @State private var values: [String: JSON]
    @State private var busy = false
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss
    init(_ request: EditRequest) { self.request = request; _values = State(initialValue: Dictionary(uniqueKeysWithValues: request.fields.map { ($0.id, $0.value) })) }
    func text(_ key: String) -> Binding<String> { Binding(get: { values[key]?.string ?? "" }, set: { values[key] = .string($0) }) }
    func flag(_ key: String) -> Binding<Bool> { Binding(get: { values[key]?.flag ?? false }, set: { values[key] = .bool($0) }) }
    var body: some View {
        NavigationStack {
            Form {
                if !request.note.isEmpty { Text(request.note).font(.footnote).foregroundStyle(.secondary) }
                ForEach(request.fields) { f in
                    switch f.kind {
                    case .text: TextField(f.label, text: text(f.id)).textInputAutocapitalization(.sentences)
                    case .integer: TextField(f.label, text: text(f.id)).keyboardType(.numbersAndPunctuation)
                    case .date: VStack(alignment: .leading) { Text(f.label).font(.caption).foregroundStyle(.secondary); TextField("YYYY-MM-DD (để trống nếu không đặt)", text: text(f.id)).keyboardType(.numbersAndPunctuation) }
                    case .secure: SecureField(f.label, text: text(f.id)).textContentType(.newPassword)
                    case .multiline: Section(f.label) { TextEditor(text: text(f.id)).frame(minHeight: 140) }
                    case .toggle: Toggle(f.label, isOn: flag(f.id))
                    case .choice(let options): Picker(f.label, selection: text(f.id)) { ForEach(options, id: \.0) { Text($0.1).tag($0.0) } }
                    case .multi(let options): Section(f.label) { ForEach(options, id: \.0) { option in
                        Toggle(option.1, isOn: Binding(get: { values[f.id]?.array.map(\.int).contains(option.0) == true }, set: { on in
                            var ids = Set(values[f.id]?.array.map(\.int) ?? []); if on { ids.insert(option.0) } else { ids.remove(option.0) }; values[f.id] = .array(ids.sorted().map(JSON.id))
                        }))
                    } }
                    }
                }
                if let error { Text(error).foregroundStyle(.red) }
            }.disabled(busy).navigationTitle(request.title).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Hủy") { dismiss() }.disabled(busy) }
                ToolbarItem(placement: .confirmationAction) {
                    if busy { ProgressView() } else { Button(request.submit) { save() }.fontWeight(.semibold) }
                }
            }.interactiveDismissDisabled(busy)
        }.tint(brand)
    }
    func save() {
        if let f = request.fields.first(where: { $0.required && (values[$0.id]?.string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true) }) { error = "Vui lòng nhập \(f.label.lowercased())."; return }
        busy = true; error = nil
        Task { do { try await request.action(values); dismiss() } catch { self.error = error.localizedDescription }; busy = false }
    }
}
struct DestructiveButton: View {
    let title: String
    var detail = "Thao tác này không thể khôi phục."
    let action: () -> Void
    @State private var confirm = false
    var body: some View {
        Button(title, role: .destructive) { confirm = true }.confirmationDialog(title, isPresented: $confirm, titleVisibility: .visible) { Button(title, role: .destructive, action: action) } message: { Text(detail) }
    }
}
struct CardTile: View {
    let card: Record
    var snapshot: BoardSnapshot?
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if card.text("cover").hasPrefix("url:/u/") { AuthenticatedImage(path: String(card.text("cover").dropFirst(4))).frame(height: 100).clipped().clipShape(RoundedRectangle(cornerRadius: 8)) }
            if !card.text("cover").isEmpty, card.text("cover").hasPrefix("#") { RoundedRectangle(cornerRadius: 8).fill(Color(hex: card.text("cover"))).frame(height: 38).accessibilityLabel("Ảnh bìa màu") }
            if let snapshot {
                HStack { ForEach(snapshot.labels(of: card)) { Badge(text: $0.text("name").isEmpty ? "Nhãn" : $0.text("name"), color: Color(hex: $0.text("color"))) } }.lineLimit(1)
            }
            Text(card.title).font(.body.weight(.semibold)).foregroundStyle(.primary).multilineTextAlignment(.leading)
            HStack(spacing: 8) {
                if card.flag("is_template") { Badge(text: "Mẫu") }
                if card.number("mirror_of") > 0 { Image(systemName: "rectangle.on.rectangle") }
                if !card.text("due_date").isEmpty { Label(card.text("due_date") + (card.text("due_time").isEmpty ? "" : " · \(card.text("due_time"))"), systemImage: "clock").foregroundStyle(card.text("due_date") < today() && !card.flag("due_complete") ? .red : .secondary) }
                Spacer(minLength: 0)
                if let snapshot {
                    let checks = snapshot.checklist(of: card)
                    if !checks.isEmpty { Label("\(checks.filter { $0.flag("checked") }.count)/\(checks.count)", systemImage: "checklist") }
                    if snapshot.count("commentCounts", card: card.id) > 0 { Label("\(snapshot.count("commentCounts", card: card.id))", systemImage: "text.bubble") }
                    if snapshot.count("attachmentCounts", card: card.id) > 0 { Image(systemName: "paperclip") }
                }
            }.font(.caption)
            if let snapshot {
                let names = snapshot.members(of: card).map { $0.text("name") }.joined(separator: ", ")
                HStack { Text(names.isEmpty ? "Chưa giao" : names).font(.caption).foregroundStyle(.secondary).lineLimit(1); Spacer(); if ["pending", "changes_requested"].contains(card.text("approval_state")) { Badge(text: card.reviewLabel, color: .orange) } }
            } else { Text(card.text("board_title")).font(.caption).foregroundStyle(.secondary) }
        }.padding(15).background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 15)).overlay(RoundedRectangle(cornerRadius: 15).strokeBorder(Color.primary.opacity(0.05)))
    }
}
struct ActivityList: View {
    let rows: [Record]
    var body: some View {
        ForEach(rows) { row in VStack(alignment: .leading, spacing: 5) {
            Text(row.text("user_name").isEmpty ? row.text("author") : row.text("user_name")).font(.subheadline.bold())
            Text(activityText(row)).font(.subheadline)
            Text(row.text("created_at")).font(.caption).foregroundStyle(.secondary)
        }.padding(.vertical, 5) }
    }
    func activityText(_ r: Record) -> String {
        let d = r["data"].parsed
        let names = ["card_created":"Tạo thẻ", "card_moved":"Di chuyển thẻ", "card_updated":"Cập nhật thẻ", "card_archived":"Lưu trữ thẻ", "card_completed":"Hoàn thành", "review_submitted":"Gửi duyệt", "review_approved":"Duyệt hoàn thành", "review_changes":"Yêu cầu chỉnh sửa", "comment_added":"Bình luận", "attachment_added":"Thêm đính kèm", "members_changed":"Thay đổi người phụ trách", "checklist_updated":"Cập nhật checklist", "labels_changed":"Cập nhật nhãn"]
        return (names[r.text("type")] ?? r.text("type").replacingOccurrences(of: "_", with: " ")) + " · " + (d["text"].string.isEmpty ? (d["title"].string.isEmpty ? r.text("card_title") : d["title"].string) : d["text"].string)
    }
}
struct DestinationRequest: Identifiable {
    let id = UUID()
    var title: String
    var initialBoard: Int
    var cardTitle: String? = nil
    var copying = false
    var action: (Int, String, [String: JSON]) async throws -> Void
}
struct DestinationSheet: View {
    @EnvironmentObject var state: AppState
    @Environment(\.dismiss) private var dismiss
    let request: DestinationRequest
    @State private var board: Int
    @State private var list = 0
    @State private var lists: [Record] = []
    @State private var title: String
    @State private var keep: [String: Bool] = ["labels": true, "members": true, "fields": true, "checklists": true, "attachments": true]
    @State private var busy = false
    @State private var loading = false
    @State private var error: String?
    init(_ request: DestinationRequest) { self.request = request; _board = State(initialValue: request.initialBoard); _title = State(initialValue: request.cardTitle ?? "") }
    var body: some View {
        NavigationStack {
            Form {
                Picker("Bảng đích", selection: $board) { ForEach(state.boards.filter { !$0.flag("closed") }) { Text($0.title).tag($0.id) } }
                if loading { ProgressView("Đang tải cột…") }
                Picker("Cột đích", selection: $list) { Text("Chọn cột").tag(0); ForEach(lists) { Text($0.title).tag($0.id) } }
                if request.copying {
                    TextField("Tên thẻ mới", text: $title)
                    ForEach([("labels", "Giữ nhãn"), ("members", "Giữ người phụ trách"), ("fields", "Giữ trường tùy chỉnh"), ("checklists", "Giữ checklist"), ("attachments", "Giữ đính kèm")], id: \.0) { option in Toggle(option.1, isOn: Binding(get: { keep[option.0] ?? true }, set: { keep[option.0] = $0 })) }
                }
                if let error { Text(error).foregroundStyle(.red) }
            }.navigationTitle(request.title).navigationBarTitleDisplayMode(.inline).disabled(busy)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Hủy") { dismiss() }.disabled(busy) }
                ToolbarItem(placement: .confirmationAction) { Button("Lưu") { busy = true; Task { defer { busy = false }; do { try await request.action(list, title, keep.mapValues(JSON.bool)); dismiss() } catch { self.error = error.localizedDescription } } }.disabled(busy || loading || list == 0 || (request.copying && title.trimmingCharacters(in: .whitespaces).isEmpty)) }
            }
            .task(id: board) { lists = []; list = 0; loading = true; defer { loading = false }; do { let data = try await state.call("/api/boards/\(board)"); try Task.checkCancellation(); lists = data["lists"].rows; list = lists.first?.id ?? 0; error = nil } catch is CancellationError {} catch { self.error = error.localizedDescription } }
            .interactiveDismissDisabled(busy)
        }
    }
}
struct AuthenticatedImage: View {
    @EnvironmentObject var state: AppState
    let path: String
    @State private var image: UIImage?
    var body: some View {
        Group { if let image { Image(uiImage: image).resizable().scaledToFill() } else { Rectangle().fill(brand.opacity(0.1)).overlay(Image(systemName: "photo").foregroundStyle(.secondary)) } }
            .task(id: path) { image = nil; if let data = try? await state.file(path) { image = UIImage(data: data) } }
    }
}
