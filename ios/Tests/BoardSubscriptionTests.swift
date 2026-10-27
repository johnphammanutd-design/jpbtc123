import XCTest
@testable import KaireticCore

final class BoardSubscriptionTests: XCTestCase {
    func testDepartingBoardDoesNotUnsubscribeArrivingCard() {
        var watches = BoardSubscriptions()
        let board = UUID(), card = UUID()
        watches.set(40, owner: board)
        watches.set(40, owner: card)
        watches.set(nil, owner: board)
        XCTAssertEqual(watches.boardID, 40)
        watches.set(nil, owner: card)
        XCTAssertNil(watches.boardID)
    }
    func testReturningToBoardSurvivesDepartingCrossBoardCard() {
        var watches = BoardSubscriptions()
        let board = UUID(), card = UUID()
        watches.set(40, owner: card)
        watches.set(26, owner: board)
        watches.set(nil, owner: card)
        XCTAssertEqual(watches.boardID, 26)
    }
    func testRefreshCannotStealNewerSubscriptionAndUnknownReleaseIsHarmless() {
        var watches = BoardSubscriptions()
        let first = UUID(), second = UUID()
        watches.set(26, owner: first)
        watches.set(40, owner: second)
        watches.set(26, owner: first)
        watches.set(nil, owner: UUID())
        XCTAssertEqual(watches.boardID, 40)
        watches.set(nil, owner: second)
        XCTAssertEqual(watches.boardID, 26)
    }
}
