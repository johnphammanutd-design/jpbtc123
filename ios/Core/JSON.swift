import Foundation

/// The existing API mixes SQLite integers, JSON booleans, nulls and nested JSON strings.
public enum JSON: Codable, Equatable, Sendable {
    case object([String: JSON]), array([JSON]), string(String), number(Double), bool(Bool), null
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode([String: JSON].self) { self = .object(v) }
        else { self = .array(try c.decode([JSON].self)) }
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .object(let x): try c.encode(x)
        case .array(let x): try c.encode(x)
        case .string(let x): try c.encode(x)
        case .number(let x): try c.encode(x)
        case .bool(let x): try c.encode(x)
        case .null: try c.encodeNil()
        }
    }
    public subscript(_ key: String) -> JSON { object[key] ?? .null }
    public var object: [String: JSON] { if case .object(let x) = self { return x }; return [:] }
    public var array: [JSON] { if case .array(let x) = self { return x }; return [] }
    public var string: String {
        switch self { case .string(let x): return x; case .number(let x): return x == x.rounded() ? String(Int(x)) : String(x); case .bool(let x): return x ? "1" : "0"; default: return "" }
    }
    public var int: Int { if case .number(let n) = self { return Int(n) }; return Int(string) ?? 0 }
    public var double: Double { if case .number(let n) = self { return n }; return Double(string) ?? 0 }
    public var flag: Bool { switch self { case .bool(let x): return x; case .number(let x): return x != 0; case .string(let x): return x == "1" || x == "true"; default: return false } }
    public var rows: [Record] { array.compactMap { if case .object = $0 { return Record($0) }; return nil } }
    public var parsed: JSON { if case .string(let s) = self, let d = s.data(using: .utf8), let j = try? JSONDecoder().decode(JSON.self, from: d) { return j }; return self }
    public static func id(_ n: Int) -> JSON { .number(Double(n)) }
}
public struct Record: Identifiable, Equatable, Sendable {
    public var value: JSON
    public init(_ value: JSON = .object([:])) { self.value = value }
    public var id: Int { value["id"].int != 0 ? value["id"].int : value["card_id"].int }
    public subscript(_ key: String) -> JSON { value[key] }
    public func text(_ key: String) -> String { value[key].string }
    public func number(_ key: String) -> Int { value[key].int }
    public func flag(_ key: String) -> Bool { value[key].flag }
    public var userID: Int { number("user_id") }
    public var title: String { text("title").isEmpty ? text("name") : text("title") }
    public var reviewLabel: String {
        switch text("approval_state") { case "pending": return "Chờ duyệt"; case "changes_requested": return "Cần chỉnh sửa"; case "approved": return "Đã duyệt"; default: return flag("due_complete") ? "Hoàn thành" : "Đang thực hiện" }
    }
}
public struct BoardSnapshot: Sendable {
    public let json: JSON
    public init(_ json: JSON) { self.json = json }
    public var board: Record { Record(json["board"]) }
    public var lists: [Record] { json["lists"].rows }
    public var cards: [Record] { json["cards"].rows }
    public var canManage: Bool { board.text("role") == "manager" }
    public func rows(_ key: String) -> [Record] { json[key].rows }
    public func members(of card: Record) -> [Record] { card.number("mirror_of") > 0 ? card["source_members"].rows : rows("cardMembers").filter { $0.number("card_id") == card.id } }
    public func checklist(of card: Record) -> [Record] { card.number("mirror_of") > 0 ? card["source_checklist"].rows : rows("checklist").filter { $0.number("card_id") == card.id } }
    public func labels(of card: Record) -> [Record] {
        let ids = card.number("mirror_of") > 0 ? Set(card["source_label_ids"].array.map(\.int)) : Set(rows("cardLabels").filter { $0.number("card_id") == card.id }.map { $0.number("label_id") })
        var seen = Set<Int>()
        return (rows("labels") + rows("mirrorLabels")).filter { ids.contains($0.id) && seen.insert($0.id).inserted }
    }
    public func count(_ key: String, card: Int) -> Int { rows(key).last { $0.number("card_id") == card }?.number("n") ?? 0 }
}
public enum CardFilter: String, CaseIterable, Sendable {
    case all = "Tất cả", mine = "Của tôi", pending = "Chờ duyệt", unassigned = "Chưa giao", unlabeled = "Không nhãn", overdue = "Quá hạn", complete = "Hoàn thành", incomplete = "Chưa hoàn thành"
    public func includes(_ card: Record, snapshot: BoardSnapshot, userID: Int, today: String) -> Bool {
        switch self {
        case .all: return true
        case .mine: return snapshot.members(of: card).contains { $0.number("user_id") == userID }
        case .pending: return card.text("approval_state") == "pending"
        case .unassigned: return snapshot.members(of: card).isEmpty
        case .unlabeled: return snapshot.labels(of: card).isEmpty
        case .overdue: return !card.text("due_date").isEmpty && card.text("due_date") < today && !card.flag("due_complete")
        case .complete: return card.flag("due_complete")
        case .incomplete: return !card.flag("due_complete")
        }
    }
}

public enum OrderPosition {
    public static func insertion(at index: Int, positions: [Double]) -> Double {
        guard !positions.isEmpty else { return 1024 }
        if index <= 0 { return positions[0] - 1024 }
        if index >= positions.count { return positions[positions.count - 1] + 1024 }
        return (positions[index - 1] + positions[index]) / 2
    }
}
