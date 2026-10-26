import XCTest
@testable import KaireticCore

final class AssignmentLiveTests: XCTestCase {
    @MainActor func testReviewerEligibilityChangesAfterSavingMembersAgainstDemo() async throws {
        guard let raw = ProcessInfo.processInfo.environment["KAIRETIC_TEST_ORIGIN"], let origin = URL(string: raw), origin.scheme == "http", ["localhost", "127.0.0.1"].contains(origin.host ?? "") else { throw XCTSkip("Requires isolated local demo backend") }
        func login(_ name: String) async throws -> API {
            let result = try await API(origin: origin).request("/api/login", method: "POST", body: ["username": .string(name), "password": .string("codex-demo-2026")])
            return API(origin: origin, token: result["token"].string)
        }
        let admin = try await login("admin"), leader = try await login("leader.demo"), staff = try await login("staff.demo")
        let boardID = try await admin.request("/api/boards", method: "POST", body: ["title": .string("[QA ASSIGN] " + UUID().uuidString)])["id"].int
        do {
            _ = try await admin.request("/api/boards/\(boardID)/members", method: "PUT", body: ["members": .array([.object(["user_id": .id(2), "role": .string("manager")]), .object(["user_id": .id(3), "role": .string("member")])])])
            let board = BoardSnapshot(try await admin.request("/api/boards/\(boardID)"))
            let card = try await admin.request("/api/cards", method: "POST", body: ["title": .string("QA assignment sequence"), "list_id": .id(try XCTUnwrap(board.lists.first).id)])["id"].int
            let request: (String, String, [String: JSON]?) async throws -> JSON = { path, method, body in try await admin.request(path, method: method, body: body) }
            let staleReview = try await admin.request("/api/cards/\(card)/review")
            XCTAssertFalse(staleReview["candidates"].rows.contains { $0.id == 1 })
            var wrote = 0
            let assignedLeader = try await AssignmentFlow.saveMembers(cardID: card, boardID: boardID, original: [], selected: [2], request: request, didWrite: { wrote += 1 })
            XCTAssertEqual(assignedLeader.review["candidates"].rows.map(\.id), [1]); XCTAssertEqual(wrote, 1)
            _ = try await admin.request("/api/cards/\(card)/reviewer", method: "PUT", body: ["reviewer_id": .id(1)])
            let assignedStaff = try await AssignmentFlow.saveMembers(cardID: card, boardID: boardID, original: [2], selected: [3], request: request, didWrite: { wrote += 1 })
            XCTAssertTrue(assignedStaff.review["candidates"].rows.contains { $0.id == 2 })
            XCTAssertFalse(assignedStaff.review["candidates"].rows.contains { $0.id == 3 })
            _ = try await admin.request("/api/cards/\(card)/reviewer", method: "PUT", body: ["reviewer_id": .id(2)])
            _ = try await staff.request("/api/cards/\(card)/review", method: "POST", body: ["action": .string("submit")])
            _ = try await AssignmentFlow.saveMembers(cardID: card, boardID: boardID, original: [3], selected: [3], request: request, didWrite: { XCTFail("No-op should preserve pending review") })
            let pending = try await leader.request("/api/cards/\(card)/review"); XCTAssertEqual(pending["state"].string, "pending")
            let memberResult = try await AssignmentFlow.saveMembers(cardID: card, boardID: boardID, original: [3], selected: [3], request: { path, method, body in try await staff.request(path, method: method, body: body) }, didWrite: { XCTFail("No change") })
            XCTAssertFalse(memberResult.canManage); XCTAssertEqual(memberResult.review, .null)
            _ = try await leader.request("/api/cards/\(card)/review", method: "POST", body: ["action": .string("approve")])
        } catch { _ = try? await admin.request("/api/boards/\(boardID)", method: "DELETE"); throw error }
        _ = try await admin.request("/api/boards/\(boardID)", method: "DELETE")
    }
}
