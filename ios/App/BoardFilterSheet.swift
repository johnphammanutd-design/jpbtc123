import SwiftUI

struct BoardFilterSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Binding private var saved: BoardFilter
    @State private var draft: BoardFilter
    let snapshot: BoardSnapshot
    init(filter: Binding<BoardFilter>, snapshot: BoardSnapshot) {
        _saved = filter; _draft = State(initialValue: filter.wrappedValue); self.snapshot = snapshot
    }
    var body: some View {
        NavigationStack {
            Form {
                Section("Từ khóa & trạng thái") {
                    TextField("Tên hoặc mô tả công việc", text: $draft.text)
                    Picker("Lọc nhanh", selection: $draft.quick) { ForEach(CardFilter.allCases, id: \.self) { Text($0.rawValue).tag($0) } }
                    Picker("Ngày hết hạn", selection: $draft.due) { ForEach(BoardFilter.Due.allCases, id: \.self) { Text($0.rawValue).tag($0) } }
                }
                Section("Người phụ trách") {
                    Picker("Khớp theo", selection: $draft.memberMatch) { ForEach(BoardFilter.Match.allCases, id: \.self) { Text($0.rawValue).tag($0) } }
                    memberToggle(0, "Chưa có người phụ trách")
                    memberToggle(-1, "Của tôi")
                    ForEach(snapshot.rows("eligibleMembers")) { member in memberToggle(member.id, member.title) }
                }
                Section("Nhãn") {
                    Picker("Khớp theo", selection: $draft.labelMatch) { ForEach(BoardFilter.Match.allCases, id: \.self) { Text($0.rawValue).tag($0) } }
                    labelToggle(0, "Không nhãn")
                    ForEach(snapshot.rows("labels")) { label in labelToggle(label.id, label.text("name").isEmpty ? "Nhãn " + label.text("color") : label.text("name")) }
                }
                Section("Hoạt động gần đây") {
                    Picker("Lần cập nhật cuối", selection: $draft.activityDays) {
                        Text("Bất kỳ lúc nào").tag(0)
                        Text("Trong 1 ngày").tag(1); Text("Trong 7 ngày").tag(7)
                        Text("Trong 14 ngày").tag(14); Text("Trong 28 ngày").tag(28)
                        Text("Không hoạt động 28 ngày").tag(-28)
                    }
                }
                Button("Xóa toàn bộ bộ lọc", role: .destructive) { draft = BoardFilter() }
            }.inputSupport().navigationTitle("Bộ lọc công việc").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Hủy") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Áp dụng") { saved = draft; dismiss() }.fontWeight(.semibold) }
            }
        }
    }
    func memberToggle(_ id: Int, _ name: String) -> some View { Toggle(name, isOn: Binding(get: { draft.memberIDs.contains(id) }, set: { on in if on { draft.memberIDs.insert(id) } else { draft.memberIDs.remove(id) } })) }
    func labelToggle(_ id: Int, _ name: String) -> some View { Toggle(name, isOn: Binding(get: { draft.labelIDs.contains(id) }, set: { on in if on { draft.labelIDs.insert(id) } else { draft.labelIDs.remove(id) } })) }
}
