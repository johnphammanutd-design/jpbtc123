import Foundation

public enum CompanyClock {
    public static let timeZone = TimeZone(identifier: "Asia/Ho_Chi_Minh")!
    private static func formatter(_ pattern: String) -> DateFormatter {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = Calendar(identifier: .gregorian); f.timeZone = timeZone; f.dateFormat = pattern; f.isLenient = false
        return f
    }
    public static func day(_ date: Date) -> String { formatter("yyyy-MM-dd").string(from: date) }
    public static func time(_ date: Date) -> String { formatter("HH:mm").string(from: date) }
    public static func date(_ value: String) -> Date? { formatter("yyyy-MM-dd").date(from: value) }
    public static func wallTime(_ value: String) -> Date? { formatter("HH:mm").date(from: value) }
    public static func due(_ card: Record) -> Date? {
        guard !card.text("due_date").isEmpty else { return nil }
        return formatter("yyyy-MM-dd HH:mm").date(from: card.text("due_date") + " " + (card.text("due_time").isEmpty ? "23:59" : card.text("due_time")))
    }
    public static func overdue(_ card: Record, now: Date = Date()) -> Bool {
        guard !card.flag("due_complete"), let due = due(card) else { return false }
        return due < now
    }
    public static func activity(_ value: String) -> Date? {
        let iso = ISO8601DateFormatter()
        let s = value.replacingOccurrences(of: " ", with: "T")
        let full = s.hasSuffix("Z") || s.dropFirst(10).contains("+") ? s : s + "Z"
        if let d = iso.date(from: full) { return d }
        iso.formatOptions.insert(.withFractionalSeconds); return iso.date(from: full)
    }
}
public struct ReviewCapabilities: Equatable {
    public let canSubmit: Bool
    public let canDecide: Bool
    public init(card: Record, snapshot: BoardSnapshot, review: JSON, user: Record) {
        let active = !card.flag("archived") && !snapshot.board.flag("closed") && !card.flag("is_template")
        let pending = card.text("approval_state") == "pending"
        canSubmit = active && !pending && !card.flag("due_complete") && review["can_submit"].flag
        canDecide = active && pending && card.number("submitted_by") != user.id
            && review["candidates"].rows.contains { $0.id == user.id }
            && (user.flag("is_admin") || card.number("reviewer_id") == user.id)
    }
}
public struct BoardFilter: Equatable, Sendable {
    public enum Match: String, CaseIterable, Sendable { case any = "Một trong các lựa chọn", all = "Tất cả lựa chọn" }
    public enum Due: String, CaseIterable, Sendable { case all = "Tất cả", overdue = "Quá hạn", week = "Trong 7 ngày", none = "Không có hạn" }
    public var quick: CardFilter = .all
    public var text = ""
    /// 0 = unassigned, -1 = the current user; positive values are user IDs.
    public var memberIDs = Set<Int>()
    public var memberMatch: Match = .any
    /// 0 = no label; positive values are label IDs.
    public var labelIDs = Set<Int>()
    public var labelMatch: Match = .any
    public var due: Due = .all
    public var activityDays = 0 // -28 = no activity in the last 28 days
    public init() {}
    public var active: Bool { self != BoardFilter() }
    public func includes(_ card: Record, snapshot: BoardSnapshot, userID: Int, now: Date = Date()) -> Bool {
        if quick == .overdue {
            if !CompanyClock.overdue(card, now: now) { return false }
        } else if !quick.includes(card, snapshot: snapshot, userID: userID, today: CompanyClock.day(now)) { return false }
        if !text.isEmpty && !(card.title + " " + card.text("description")).localizedCaseInsensitiveContains(text) { return false }
        let members = Set(snapshot.members(of: card).map { $0.number("user_id") })
        let labels = Set(snapshot.labels(of: card).map(\.id))
        if !memberIDs.isEmpty {
            let hits = memberIDs.map { $0 == 0 ? members.isEmpty : members.contains($0 == -1 ? userID : $0) }
            if memberMatch == .all ? hits.contains(false) : !hits.contains(true) { return false }
        }
        if !labelIDs.isEmpty {
            let hits = labelIDs.map { $0 == 0 ? labels.isEmpty : labels.contains($0) }
            if labelMatch == .all ? hits.contains(false) : !hits.contains(true) { return false }
        }
        switch due {
        case .all: break
        case .overdue: if !CompanyClock.overdue(card, now: now) { return false }
        case .none: if !card.text("due_date").isEmpty { return false }
        case .week:
            var calendar = Calendar(identifier: .gregorian); calendar.timeZone = CompanyClock.timeZone
            let end = CompanyClock.day(calendar.date(byAdding: .day, value: 7, to: now)!)
            if card.text("due_date") < CompanyClock.day(now) || card.text("due_date") > end { return false }
        }
        if activityDays != 0 {
            let raw = card.text("last_activity").isEmpty ? card.text("created_at") : card.text("last_activity")
            guard let last = CompanyClock.activity(raw) else { return false }
            let age = now.timeIntervalSince(last)
            if activityDays < 0 ? age < 28 * 86400 : age > Double(activityDays) * 86400 { return false }
        }
        return true
    }
}
public enum WorkFeed {
    public static func mine(snapshots: [BoardSnapshot], userID: Int) -> [Record] {
        var seen = Set<Int>(), result: [Record] = []
        for s in snapshots where !s.board.flag("closed") {
            for c in s.cards where !c.flag("archived") && !c.flag("is_template") && c.number("mirror_of") == 0 {
                guard s.members(of: c).contains(where: { $0.number("user_id") == userID }), seen.insert(c.id).inserted else { continue }
                var value = c.value.object; value["board_id"] = .id(s.board.id); value["board_title"] = .string(s.board.title)
                value["list_title"] = .string(s.lists.first { $0.id == c.number("list_id") }?.title ?? "")
                result.append(Record(.object(value)))
            }
        }
        return result.sorted {
            if $0.flag("due_complete") != $1.flag("due_complete") { return !$0.flag("due_complete") }
            let a = $0.text("due_date"), b = $1.text("due_date")
            if a.isEmpty != b.isEmpty { return !a.isEmpty }
            if a != b { return a < b }; return $0.id > $1.id
        }
    }
}
public enum EventText {
    public static func notification(_ n: Record) -> String {
        let labels = ["assigned":"đã giao việc cho bạn", "mention":"đã nhắc đến bạn", "comment":"đã bình luận", "review_requested":"đã gửi công việc chờ bạn duyệt", "review_submitted":"đã gửi duyệt", "review_approved":"đã duyệt công việc", "review_changes":"yêu cầu chỉnh sửa", "due_soon":"công việc sắp đến hạn", "due_overdue":"công việc quá hạn", "moved":"đã di chuyển công việc", "completed":"đã hoàn thành công việc", "created":"đã tạo công việc"]
        let actor = n.text("actor_name")
        let action = labels[n.text("type")] ?? "có cập nhật công việc"
        let note = n["data"].parsed["note"].string
        return (actor.isEmpty ? "" : actor + " ") + action + (note.isEmpty ? "" : ": " + note)
    }
    public static func activity(_ r: Record) -> String {
        let d = r["data"].parsed
        let names = ["card_created":"Tạo thẻ", "card_moved":"Di chuyển thẻ", "card_updated":"Cập nhật thẻ", "card_archived":"Lưu trữ thẻ", "card_restored":"Khôi phục thẻ", "card_completed":"Hoàn thành", "review_submit":"Gửi duyệt", "review_approve":"Duyệt hoàn thành", "review_request_changes":"Yêu cầu chỉnh sửa", "review_reopened":"Mở lại công việc sau khi nội dung đổi", "comment_added":"Bình luận", "attachment_added":"Thêm đính kèm", "members_changed":"Thay đổi người phụ trách", "checklist_updated":"Cập nhật checklist", "labels_changed":"Cập nhật nhãn"]
        let detail = d["note"].string.isEmpty ? (d["text"].string.isEmpty ? (d["title"].string.isEmpty ? r.text("card_title") : d["title"].string) : d["text"].string) : d["note"].string
        return (names[r.text("type")] ?? "Cập nhật công việc") + (detail.isEmpty ? "" : " · " + detail)
    }
}

public enum AccessPayload {
    /// A non-admin manager must keep an explicit manager grant when replacing board membership.
    public static func boardMembers(selection: [String: JSON], people: [Record], actor: Record) -> [JSON] {
        var members: [JSON] = people.compactMap { person in
            guard let role = selection[String(person.id)]?.string, ["manager", "member"].contains(role) else { return nil }
            return .object(["user_id": .id(person.id), "role": .string(role)])
        }
        if !actor.flag("is_admin"), actor.id > 0 {
            members.removeAll { $0["user_id"].int == actor.id }
            members.append(.object(["user_id": .id(actor.id), "role": .string("manager")]))
        }
        return members
    }
}
