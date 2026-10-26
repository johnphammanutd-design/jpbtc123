import SwiftUI

struct AssignmentRequest: Identifiable {
    let id = UUID()
    let card: Record
    let snapshot: BoardSnapshot
}
struct AssignmentSheet: View {
    @EnvironmentObject private var state: AppState
    @Environment(\.dismiss) private var dismiss
    let request: AssignmentRequest
    @State private var original: Set<Int>
    @State private var selected: Set<Int>
    @State private var choosingReviewer = false
    @State private var review: JSON = .null
    @State private var reviewerID = 0
    @State private var busy = false
    @State private var membersSaved = false
    @State private var error: String?
    init(_ request: AssignmentRequest) {
        self.request = request
        let ids = AssignmentFlow.memberIDs(card: request.card, snapshot: request.snapshot)
        _original = State(initialValue: ids); _selected = State(initialValue: ids)
    }
    var body: some View {
        NavigationStack {
            Form {
                if choosingReviewer {
                    Section("2. Người duyệt") {
                        Text(membersSaved ? "Đã lưu người phụ trách. Chọn người duyệt để hoàn tất giao việc." : "Người phụ trách được giữ nguyên. Chọn người duyệt cho công việc.").font(.footnote).foregroundStyle(.secondary)
                        if review["candidates"].rows.isEmpty {
                            Text("Chưa có người duyệt hợp lệ. Người thực hiện không tự duyệt; việc của leader cần giám đốc duyệt. Cần quản lý kiểm tra quyền và người phụ trách.").foregroundStyle(.orange)
                            Button("Hoàn tất, chọn người duyệt sau") { dismiss() }
                        } else {
                            Picker("Người duyệt", selection: $reviewerID) { ForEach(review["candidates"].rows) { Text($0.title).tag($0.id) } }.accessibilityIdentifier("assignment.reviewer")
                            Text("Danh sách được tải từ máy chủ sau khi lưu người phụ trách. Người thực hiện không nằm trong danh sách tự duyệt.").font(.footnote).foregroundStyle(.secondary)
                        }
                        Button("Đổi người phụ trách") { choosingReviewer = false; error = nil }
                    }
                } else {
                    Section(request.snapshot.canManage ? "1. Người phụ trách" : "Thành viên thẻ") {
                        Text(request.snapshot.canManage ? "Lưu người phụ trách trước, sau đó chọn người duyệt hợp lệ ở bước tiếp theo." : "Bạn có thể tham gia hoặc rời thẻ bằng tài khoản của mình.").font(.footnote).foregroundStyle(.secondary)
                        if membersSaved { Text("Người phụ trách đã được lưu trong lần bấm trước.").font(.footnote).foregroundStyle(.secondary) }
                        ForEach(request.snapshot.rows("eligibleMembers").filter { request.snapshot.canManage || $0.id == state.user?.id }) { person in
                            Toggle(person.title, isOn: Binding(get: { selected.contains(person.id) }, set: { on in if on { selected.insert(person.id) } else { selected.remove(person.id) } })).accessibilityIdentifier("assignment.member.\(person.id)")
                        }
                    }
                }
                if let error { Text(error).foregroundStyle(.red).font(.footnote) }
            }.disabled(busy).navigationTitle(choosingReviewer ? "Chọn người duyệt" : "Người phụ trách").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(membersSaved ? "Đóng" : "Hủy") { dismiss() }.disabled(busy) }
                ToolbarItem(placement: .confirmationAction) {
                    if busy { ProgressView() }
                    else if choosingReviewer { Button("Lưu") { saveReviewer() }.disabled(reviewerID == 0).accessibilityIdentifier("assignment.save") }
                    else { Button(request.snapshot.canManage ? "Tiếp tục" : "Lưu") { saveMembers() }.accessibilityIdentifier("assignment.next") }
                }
            }.interactiveDismissDisabled(busy)
        }
    }
    private func wrote() { state.revision += 1; state.handle { try await state.refresh() } }
    private func saveMembers() {
        guard !busy else { return }; busy = true; error = nil
        let selection = selected
        Task {
            defer { busy = false }
            do {
                let result = try await AssignmentFlow.saveMembers(cardID: request.card.id, boardID: request.snapshot.board.id, original: original, selected: selection, request: { path, method, body in try await state.call(path, method, body) }, didWrite: {
                    membersSaved = true; original = selection; wrote()
                })
                if result.canManage { review = result.review; reviewerID = AssignmentFlow.suggestedReviewer(review); choosingReviewer = true }
                else { dismiss() }
            } catch { self.error = (membersSaved ? "Người phụ trách đã lưu; chưa hoàn tất chọn người duyệt. Có thể bấm Tiếp tục để tải lại. " : "") + error.localizedDescription }
        }
    }
    private func saveReviewer() {
        guard !busy else { return }; busy = true; error = nil
        Task {
            defer { busy = false }
            do {
                let latest = try await state.call("/api/cards/\(request.card.id)/review")
                guard latest["candidates"].rows.contains(where: { $0.id == reviewerID }) else {
                    review = latest; reviewerID = AssignmentFlow.suggestedReviewer(latest)
                    throw APIError.server(409, "Danh sách người duyệt đã thay đổi. Kiểm tra lựa chọn mới rồi lưu lại.")
                }
                if latest["reviewer_id"].int != reviewerID { _ = try await state.call("/api/cards/\(request.card.id)/reviewer", "PUT", ["reviewer_id": .id(reviewerID)]); wrote() }
                dismiss()
            } catch { self.error = "Người phụ trách vẫn đã lưu. " + error.localizedDescription }
        }
    }
}
