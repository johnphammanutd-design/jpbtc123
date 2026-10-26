import XCTest
@testable import KaireticCore

final class AssignmentTests: XCTestCase {
    private func board(_ members: [Int]) -> JSON {
        .object(["board": .object(["id": .id(7), "role": .string("manager")]), "cards": .array([.object(["id": .id(9)])]), "cardMembers": .array(members.map { .object(["card_id": .id(9), "user_id": .id($0)]) })])
    }
    private func review(_ ids: [Int], current: Int = 0) -> JSON { .object(["reviewer_id": .id(current), "candidates": .array(ids.map { .object(["id": .id($0)]) })]) }
    @MainActor func testReviewerListIsFetchedAfterAssigneeCommit() async throws {
        var assigned = false, committed = 0; var calls: [String] = []
        let result = try await AssignmentFlow.saveMembers(cardID: 9, boardID: 7, original: [], selected: [2], request: { path, method, _ in
            calls.append(method + " " + path)
            if path == "/api/boards/7" { return self.board([]) }
            if method == "PUT" { assigned = true; return .object(["ok": .bool(true)]) }
            return self.review(assigned ? [1] : [2])
        }, didWrite: { committed += 1 })
        XCTAssertEqual(calls, ["GET /api/boards/7", "PUT /api/cards/9/members", "GET /api/cards/9/review"])
        XCTAssertEqual(AssignmentFlow.suggestedReviewer(result.review), 1); XCTAssertEqual(committed, 1)
    }
    @MainActor func testUnchangedAssigneesDoNotRewriteOrReopenPendingWork() async throws {
        var calls: [String] = []
        let result = try await AssignmentFlow.saveMembers(cardID: 9, boardID: 7, original: [2], selected: [2], request: { path, method, _ in
            calls.append(method + " " + path)
            return path == "/api/boards/7" ? self.board([2]) : self.review([1, 3], current: 3)
        }, didWrite: { XCTFail("An unchanged selection must not be written") })
        XCTAssertFalse(calls.contains { $0.hasPrefix("PUT") }); XCTAssertEqual(AssignmentFlow.suggestedReviewer(result.review), 3)
    }
    @MainActor func testRetryAfterReviewLoadFailureDoesNotRewriteMembers() async throws {
        var members: [Int] = [], writes = 0, commits = 0, failures = 1
        let request: (String, String, [String: JSON]?) async throws -> JSON = { path, method, _ in
            if path == "/api/boards/7" { return self.board(members) }
            if method == "PUT" { members = [2]; writes += 1; return .object([:]) }
            if failures > 0 { failures -= 1; throw APIError.server(503, "Temporary outage") }
            return self.review([1])
        }
        do { _ = try await AssignmentFlow.saveMembers(cardID: 9, boardID: 7, original: [], selected: [2], request: request, didWrite: { commits += 1 }); XCTFail("Expected review load failure") }
        catch APIError.server(let code, _) { XCTAssertEqual(code, 503) }
        XCTAssertEqual(commits, 1)
        let result = try await AssignmentFlow.saveMembers(cardID: 9, boardID: 7, original: [], selected: [2], request: request, didWrite: { commits += 1 })
        XCTAssertEqual(writes, 1); XCTAssertEqual(commits, 1); XCTAssertEqual(AssignmentFlow.suggestedReviewer(result.review), 1)
    }
    @MainActor func testConcurrentAssignmentIsNotOverwritten() async throws {
        var calls = 0
        do {
            _ = try await AssignmentFlow.saveMembers(cardID: 9, boardID: 7, original: [], selected: [2], request: { _, method, _ in
                calls += 1; XCTAssertEqual(method, "GET"); return self.board([3])
            }, didWrite: { XCTFail("Must not overwrite another manager") })
            XCTFail("Expected concurrent change")
        } catch APIError.server(let code, _) { XCTAssertEqual(code, 409) }
        XCTAssertEqual(calls, 1)
    }
}
