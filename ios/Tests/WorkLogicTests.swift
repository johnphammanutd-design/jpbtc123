import XCTest
@testable import KaireticCore

final class WorkLogicTests: XCTestCase {
    func testDisplayedEventTimesUseCompanyTimezone() {
        XCTAssertEqual(CompanyClock.displayTimestamp("2026-10-26 13:01:41"), "26/10/2026 20:01")
        XCTAssertEqual(CompanyClock.displayTimestamp("2026-10-26T20:01:41+07:00"), "26/10/2026 20:01")
        XCTAssertEqual(CompanyClock.displayTimestamp("2026-10-26T08:01:41-05:00"), "26/10/2026 20:01")
        XCTAssertEqual(CompanyClock.displayTimestamp("2026-10-26T18:30:00.123Z"), "27/10/2026 01:30")
        XCTAssertEqual(CompanyClock.displayTimestamp("unrecognized"), "unrecognized")
    }

    func json(_ text: String) throws -> JSON { try JSONDecoder().decode(JSON.self, from: Data(text.utf8)) }
    let now = ISO8601DateFormatter().date(from: "2026-10-26T05:00:00Z")!
    func testCompanyDatesAndMinutePrecision() throws {
        XCTAssertEqual(CompanyClock.day(ISO8601DateFormatter().date(from: "2026-10-25T18:00:00Z")!), "2026-10-26")
        let before = Record(try json(#"{"due_date":"2026-10-26","due_time":"11:59","due_complete":0}"#))
        let after = Record(try json(#"{"due_date":"2026-10-26","due_time":"12:01","due_complete":0}"#))
        XCTAssertTrue(CompanyClock.overdue(before, now: now)); XCTAssertFalse(CompanyClock.overdue(after, now: now))
        XCTAssertEqual(CompanyClock.due(before), ISO8601DateFormatter().date(from: "2026-10-26T04:59:00Z"))
        XCTAssertNotNil(CompanyClock.activity("2026-10-26 04:59:00"))
        XCTAssertNotNil(CompanyClock.activity("2026-10-26T04:59:00.123Z"))
    }
    func testFiltersCombinePeopleLabelsActivityAndDueTime() throws {
        let s = BoardSnapshot(try json(#"{"board":{"id":1},"cards":[{"id":1,"title":"Kịch bản video","due_date":"2026-10-26","due_time":"11:59","last_activity":"2026-10-26 00:00:00"}],"cardMembers":[{"card_id":1,"user_id":7},{"card_id":1,"user_id":8}],"labels":[{"id":11},{"id":12}],"cardLabels":[{"card_id":1,"label_id":11},{"card_id":1,"label_id":12}]}"#))
        let card = try XCTUnwrap(s.cards.first)
        var f = BoardFilter(); f.memberIDs = [7, 8]; f.memberMatch = .all; f.labelIDs = [11, 12]; f.labelMatch = .all
        f.text = "KỊCH BẢN"; f.due = .overdue; f.activityDays = 7
        XCTAssertTrue(f.includes(card, snapshot: s, userID: 7, now: now))
        f.memberIDs.insert(9); XCTAssertFalse(f.includes(card, snapshot: s, userID: 7, now: now))
        f.memberMatch = .any; XCTAssertTrue(f.includes(card, snapshot: s, userID: 7, now: now))
        f.labelIDs = [99]; XCTAssertFalse(f.includes(card, snapshot: s, userID: 7, now: now))
        f.labelIDs = [11]; f.activityDays = -28; XCTAssertFalse(f.includes(card, snapshot: s, userID: 7, now: now))
        f.activityDays = 0; f.due = .none; XCTAssertFalse(f.includes(card, snapshot: s, userID: 7, now: now))
        f.due = .week; XCTAssertTrue(f.includes(card, snapshot: s, userID: 7, now: now))
    }
    func testEmptyAssignmentsAndLabelsUseSpecialFilters() throws {
        let s = BoardSnapshot(try json(#"{"board":{"id":1},"cards":[{"id":1}]}"#))
        let c = try XCTUnwrap(s.cards.first)
        var f = BoardFilter(); f.memberIDs = [0]; f.labelIDs = [0]
        XCTAssertTrue(f.includes(c, snapshot: s, userID: 7, now: now))
        f.memberIDs = [-1]; XCTAssertFalse(f.includes(c, snapshot: s, userID: 7, now: now))
    }
    func testReviewCannotBeDecidedBySubmitterEvenWhenDirector() throws {
        let s = BoardSnapshot(try json(#"{"board":{"id":1,"role":"manager"}}"#))
        let c = Record(try json(#"{"id":1,"approval_state":"pending","submitted_by":1,"reviewer_id":2}"#))
        let review = try json(#"{"can_submit":true,"candidates":[{"id":2,"is_admin":true}]}"#)
        let sender = Record(try json(#"{"id":1,"is_admin":true}"#)), reviewer = Record(try json(#"{"id":2,"is_admin":true}"#))
        XCTAssertFalse(ReviewCapabilities(card: c, snapshot: s, review: review, user: sender).canDecide)
        XCTAssertFalse(ReviewCapabilities(card: c, snapshot: s, review: review, user: sender).canSubmit)
        XCTAssertTrue(ReviewCapabilities(card: c, snapshot: s, review: review, user: reviewer).canDecide)
        let staleReviewer = Record(try json(#"{"id":3,"is_admin":false}"#))
        XCTAssertFalse(ReviewCapabilities(card: c, snapshot: s, review: review, user: staleReviewer).canDecide)
    }
    func testMyWorkIncludesMoreThan100AndCompletedWithoutMirrors() {
        let cards: [JSON] = (1...121).map { .object(["id": .id($0), "title": .string("Task \($0)"), "list_id": .id(4), "due_complete": .bool($0 == 121)]) }
        let members: [JSON] = (1...121).map { .object(["card_id": .id($0), "user_id": .id(7)]) }
        let snapshot = BoardSnapshot(.object(["board": .object(["id": .id(1), "title": .string("Bảng A")]), "cards": .array(cards), "cardMembers": .array(members)]))
        let feed = WorkFeed.mine(snapshots: [snapshot, snapshot], userID: 7)
        XCTAssertEqual(feed.count, 121); XCTAssertTrue(feed.last?.flag("due_complete") == true)
        XCTAssertEqual(feed.first?.text("board_title"), "Bảng A")
        XCTAssertTrue(WorkFeed.mine(snapshots: [snapshot], userID: 9).isEmpty)
    }
    func testEventLabelsMatchActualServerNames() throws {
        let n = Record(try json(#"{"type":"review_requested","actor_name":"Leader","data":"{\"note\":\"Kiểm tra file\"}"}"#))
        XCTAssertEqual(EventText.notification(n), "Leader đã gửi công việc chờ bạn duyệt: Kiểm tra file")
        let a = Record(try json(#"{"type":"review_request_changes","data":"{\"note\":\"Sửa dẫn chứng\"}"}"#))
        XCTAssertEqual(EventText.activity(a), "Yêu cầu chỉnh sửa · Sửa dẫn chứng")
    }
}
