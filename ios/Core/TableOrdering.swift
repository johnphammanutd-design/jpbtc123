import Foundation

public struct TableOrdering: Equatable, Sendable {
    public enum Key: String, CaseIterable, Sendable {
        case list = "Cột", title = "Tên thẻ", members = "Người phụ trách", due = "Ngày hết hạn", complete = "Hoàn thành"
    }
    public var key: Key = .list
    public var ascending = true
    public init() {}
    public func sorted(_ cards: [Record], snapshot: BoardSnapshot) -> [Record] {
        let lists = Dictionary(uniqueKeysWithValues: snapshot.lists.map { ($0.id, $0.title) })
        let keyed = cards.enumerated().map { index, card -> (index: Int, card: Record, value: String) in
            let value: String
            switch key {
            case .list: value = lists[card.number("list_id")] ?? ""
            case .title: value = card.title
            case .members: value = snapshot.members(of: card).map { $0.text("name") }.joined(separator: ", ")
            case .due: value = card.text("due_date").isEmpty ? "" : card.text("due_date") + " " + (card.text("due_time").isEmpty ? "23:59" : card.text("due_time"))
            case .complete: value = card.flag("due_complete") ? "1" : "0"
            }
            return (index, card, value)
        }
        return keyed.sorted { left, right in
            if key == .due, left.value.isEmpty != right.value.isEmpty { return !left.value.isEmpty }
            let result = left.value.compare(right.value, options: [.caseInsensitive, .numeric], locale: Locale(identifier: "vi_VN"))
            if result == .orderedSame { return left.index < right.index }
            return ascending ? result == .orderedAscending : result == .orderedDescending
        }.map(\.card)
    }
}
