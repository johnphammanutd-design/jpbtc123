import XCTest
@testable import KaireticCore

final class OrderingTests: XCTestCase {
    private func item(_ id: Int, _ position: Double) -> Record { Record(.object(["id": .id(id), "position": .number(position)])) }
    func testInboxNativeMoveIndicesAndNoOp() throws {
        let items = [item(1, 1024), item(2, 2048), item(3, 3072)]
        XCTAssertNil(InboxOrdering.intent(items: items, source: [1], destination: 1))
        XCTAssertNil(InboxOrdering.intent(items: items, source: [1], destination: 2))
        XCTAssertNil(InboxOrdering.intent(items: items, source: [9], destination: 0))
        let up = try XCTUnwrap(InboxOrdering.intent(items: items, source: [2], destination: 0))
        XCTAssertEqual(try InboxOrdering.plan(up, items: items).items.map(\.id), [3, 1, 2])
        let down = try XCTUnwrap(InboxOrdering.intent(items: items, source: [0], destination: 3))
        let plan = try InboxOrdering.plan(down, items: items)
        XCTAssertEqual(plan.items.map(\.id), [2, 3, 1]); XCTAssertEqual(plan.writes.count, 1)
        XCTAssertEqual(plan.writes.first?.position, 4096)
    }
    func testInboxReappliesIntentToFreshDataAndRejectsMissingAnchor() throws {
        let move = InboxMove(itemID: 1, beforeID: 3)
        let fresh = [item(4, 0), item(1, 1024), item(2, 2048), item(3, 3072)]
        let plan = try InboxOrdering.plan(move, items: fresh)
        XCTAssertEqual(plan.items.map(\.id), [4, 2, 1, 3]); XCTAssertEqual(plan.writes.first?.position, 2560)
        XCTAssertThrowsError(try InboxOrdering.plan(move, items: [item(1, 1024)]))
        XCTAssertThrowsError(try InboxOrdering.plan(InboxMove(itemID: 9, beforeID: nil), items: fresh))
    }
    func testInboxRebalancesDuplicateOrUnrepresentablePositions() throws {
        let equal = [item(1, 1024), item(2, 1024), item(3, 1024)]
        let plan = try InboxOrdering.plan(InboxMove(itemID: 3, beforeID: 2), items: equal)
        XCTAssertEqual(plan.items.map(\.id), [1, 3, 2]); XCTAssertEqual(plan.writes.map(\.position), [1024, 2048, 3072])
        let close = [item(1, 1), item(2, 1.nextUp), item(3, 3)]
        XCTAssertEqual(try InboxOrdering.plan(InboxMove(itemID: 3, beforeID: 2), items: close).writes.count, 3)
    }
    private func snapshot() throws -> BoardSnapshot {
        BoardSnapshot(try JSONDecoder().decode(JSON.self, from: Data(#"{"lists":[{"id":1,"title":"Z"},{"id":2,"title":"A"}],"cards":[{"id":1,"list_id":1,"title":"Video 10","due_date":"2026-10-26","due_time":"17:00"},{"id":2,"list_id":2,"title":"Video 2","due_date":"2026-10-26","due_time":"09:00","due_complete":1},{"id":3,"list_id":2,"title":"Video 2","due_date":""}],"cardMembers":[{"card_id":1,"user_id":10,"name":"Z"},{"card_id":2,"user_id":11,"name":"A"}]}"#.utf8)))
    }
    func testTableKeysAndStableTiesDoNotMutateKanban() throws {
        let s = try snapshot(); var ordering = TableOrdering()
        XCTAssertEqual(ordering.sorted(s.cards, snapshot: s).map(\.id), [2, 3, 1])
        ordering.key = .title; XCTAssertEqual(ordering.sorted(s.cards, snapshot: s).map(\.id), [2, 3, 1])
        ordering.ascending = false; XCTAssertEqual(ordering.sorted(s.cards, snapshot: s).map(\.id), [1, 2, 3])
        ordering.key = .complete; ordering.ascending = true
        XCTAssertEqual(ordering.sorted(s.cards, snapshot: s).map(\.id), [1, 3, 2])
        XCTAssertEqual(s.cards.map(\.id), [1, 2, 3])
    }
    func testTableDueUsesTimeAndKeepsUndatedLastBothDirections() throws {
        let s = try snapshot(); var ordering = TableOrdering(); ordering.key = .due
        XCTAssertEqual(ordering.sorted(s.cards, snapshot: s).map(\.id), [2, 1, 3])
        ordering.ascending = false; XCTAssertEqual(ordering.sorted(s.cards, snapshot: s).map(\.id), [1, 2, 3])
    }
    func testTableUsesResolvedMembersForMirrors() throws {
        let s = BoardSnapshot(try JSONDecoder().decode(JSON.self, from: Data(#"{"cards":[{"id":1},{"id":2,"mirror_of":99,"source_members":[{"name":"An"}]}],"cardMembers":[{"card_id":1,"name":"Binh"}]}"#.utf8)))
        var ordering = TableOrdering(); ordering.key = .members
        XCTAssertEqual(ordering.sorted(s.cards, snapshot: s).map(\.id), [2, 1])
    }
}
