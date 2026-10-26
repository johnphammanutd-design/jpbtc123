import Foundation

public struct QuickCardDraft: Equatable, Sendable {
    public var title: String
    public var dueDate: String
    public var dueTime: String
    public var labelIDs: Set<Int>
    public init(card: Record, snapshot: BoardSnapshot) {
        title = card.title; dueDate = card.text("due_date"); dueTime = card.text("due_time")
        labelIDs = Set(snapshot.labels(of: card).map(\.id))
    }
    public func changes(from previous: QuickCardDraft) -> [String: JSON] {
        var changes: [String: JSON] = [:]
        if title.trimmingCharacters(in: .whitespacesAndNewlines) != previous.title { changes["title"] = .string(title.trimmingCharacters(in: .whitespacesAndNewlines)) }
        if dueDate != previous.dueDate { changes["due_date"] = .string(dueDate) }
        if dueTime != previous.dueTime { changes["due_time"] = .string(dueTime) }
        return changes
    }
    /// A retry may encounter our own first write after a later request failed.
    public func conflicts(with current: QuickCardDraft, original: QuickCardDraft) -> Bool {
        (current.title != original.title && current.title != title.trimmingCharacters(in: .whitespacesAndNewlines)) ||
        (current.dueDate != original.dueDate && current.dueDate != dueDate) ||
        (current.dueTime != original.dueTime && current.dueTime != dueTime) ||
        (current.labelIDs != original.labelIDs && current.labelIDs != labelIDs)
    }
}
public enum TemplateCards {
    public static func available(in snapshot: BoardSnapshot) -> [Record] {
        snapshot.cards.filter { $0.flag("is_template") && !$0.flag("archived") && $0.number("mirror_of") == 0 }
    }
    public static func copyBody(title: String, listID: Int, keepMembers: Bool) -> [String: JSON] {
        ["title": .string(title.trimmingCharacters(in: .whitespacesAndNewlines)), "list_id": .id(listID), "members": .bool(keepMembers), "labels": .bool(true), "fields": .bool(true), "checklists": .bool(true), "attachments": .bool(true)]
    }
}
