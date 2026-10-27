import Foundation

/// Navigation transitions can keep both the departing and arriving screens alive.
/// A screen releases only its own subscription, never the next screen's watch.
public struct BoardSubscriptions: Sendable {
    private struct Entry: Sendable { let owner: UUID; let boardID: Int }
    private var entries: [Entry] = []
    public init() {}
    public var boardID: Int? { entries.last?.boardID }
    public mutating func set(_ boardID: Int?, owner: UUID) {
        if let boardID, boardID > 0 {
            if entries.contains(where: { $0.owner == owner && $0.boardID == boardID }) { return }
            entries.removeAll { $0.owner == owner }
            entries.append(Entry(owner: owner, boardID: boardID))
        } else { entries.removeAll { $0.owner == owner } }
    }
}
