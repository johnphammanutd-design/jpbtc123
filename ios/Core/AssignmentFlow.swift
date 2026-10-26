import Foundation

public struct AssignmentResult: Sendable {
    public let canManage: Bool
    public let review: JSON
}
public enum AssignmentFlow {
    public static func memberIDs(card: Record, snapshot: BoardSnapshot) -> Set<Int> {
        Set(snapshot.members(of: card).map { $0.number("user_id") })
    }
    /// Reviewer eligibility depends on the saved assignees. Never reuse the pre-edit candidate list.
    @MainActor public static func saveMembers(cardID: Int, boardID: Int, original: Set<Int>, selected: Set<Int>, request: (String, String, [String: JSON]?) async throws -> JSON, didWrite: () -> Void) async throws -> AssignmentResult {
        let snapshot = BoardSnapshot(try await request("/api/boards/\(boardID)", "GET", nil))
        guard !snapshot.board.flag("closed"), let card = snapshot.cards.first(where: { $0.id == cardID }), card.number("mirror_of") == 0 else { throw APIError.server(409, "Thẻ không còn trong bảng đang hoạt động. Hãy tải lại thẻ.") }
        let current = memberIDs(card: card, snapshot: snapshot)
        guard current == original || current == selected else { throw APIError.server(409, "Người phụ trách đã được thay đổi từ máy khác. Đóng và mở lại để xem dữ liệu mới.") }
        if current != selected {
            _ = try await request("/api/cards/\(cardID)/members", "PUT", ["user_ids": .array(selected.sorted().map(JSON.id))])
            didWrite()
        }
        let review = snapshot.canManage ? try await request("/api/cards/\(cardID)/review", "GET", nil) : .null
        return AssignmentResult(canManage: snapshot.canManage, review: review)
    }
    public static func suggestedReviewer(_ review: JSON) -> Int {
        let candidates = review["candidates"].rows
        return candidates.contains(where: { $0.id == review["reviewer_id"].int }) ? review["reviewer_id"].int : candidates.first?.id ?? 0
    }
}
