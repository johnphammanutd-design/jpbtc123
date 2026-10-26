import Foundation

public struct InboxMove: Equatable, Sendable {
    public let itemID: Int
    public let beforeID: Int?
    public init(itemID: Int, beforeID: Int?) { self.itemID = itemID; self.beforeID = beforeID }
}
public struct PositionWrite: Equatable, Sendable {
    public let id: Int
    public let position: Double
}
public struct InboxOrderPlan: Sendable {
    public let items: [Record]
    public let writes: [PositionWrite]
}
public enum InboxOrdering {
    /// SwiftUI's destination is an index in the collection before removing the source.
    public static func intent(items: [Record], source: IndexSet, destination: Int) -> InboxMove? {
        guard source.count == 1, let from = source.first, items.indices.contains(from), (0...items.count).contains(destination) else { return nil }
        let target = destination > from ? destination - 1 : destination
        guard target != from else { return nil }
        var remaining = items; let moved = remaining.remove(at: from)
        return InboxMove(itemID: moved.id, beforeID: target < remaining.count ? remaining[target].id : nil)
    }
    /// Reapply the user's destination to a fresh server snapshot, preserving newly added items.
    public static func plan(_ move: InboxMove, items: [Record]) throws -> InboxOrderPlan {
        guard let from = items.firstIndex(where: { $0.id == move.itemID }), move.beforeID != move.itemID else { throw APIError.server(409, "Mục Inbox đã thay đổi. Hãy tải lại danh sách.") }
        var ordered = items; let moved = ordered.remove(at: from)
        let target: Int
        if let anchor = move.beforeID {
            guard let index = ordered.firstIndex(where: { $0.id == anchor }) else { throw APIError.server(409, "Vị trí đích đã thay đổi. Hãy tải lại danh sách.") }
            target = index
        } else { target = ordered.count }
        ordered.insert(moved, at: target)
        guard ordered.map(\.id) != items.map(\.id) else { return InboxOrderPlan(items: ordered, writes: []) }
        let others = ordered.filter { $0.id != moved.id }
        let positions = others.map { $0["position"].double }
        let position = OrderPosition.insertion(at: target, positions: positions)
        let strictlyOrdered = zip(positions, positions.dropFirst()).allSatisfy { $0 < $1 }
        let fits = position.isFinite && (target == 0 || position > positions[target - 1]) && (target == positions.count || position < positions[target])
        let writes: [PositionWrite] = strictlyOrdered && fits
            ? [PositionWrite(id: moved.id, position: position)]
            : ordered.enumerated().map { PositionWrite(id: $0.element.id, position: Double(($0.offset + 1) * 1024)) }
        let values = Dictionary(uniqueKeysWithValues: writes.map { ($0.id, $0.position) })
        ordered = ordered.map { item in
            guard let position = values[item.id] else { return item }
            var record = item.value.object; record["position"] = .number(position); return Record(.object(record))
        }
        return InboxOrderPlan(items: ordered, writes: writes)
    }
}
