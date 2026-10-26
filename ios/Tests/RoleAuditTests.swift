import XCTest
@testable import KaireticCore

final class RoleAuditTests: XCTestCase {
    func testThreeRolesMultipleTeamsAndPermissionBoundaries() async throws {
        guard let raw = ProcessInfo.processInfo.environment["KAIRETIC_TEST_ORIGIN"], let origin = URL(string: raw), origin.scheme == "http", ["localhost", "127.0.0.1"].contains(origin.host ?? "") else { throw XCTSkip("Requires an isolated local demo server") }
        func login(_ username: String) async throws -> API {
            let result = try await API(origin: origin).request("/api/login", method: "POST", body: ["username": .string(username), "password": .string("codex-demo-2026")])
            return API(origin: origin, token: result["token"].string)
        }
        let admin = try await login("admin"), leader = try await login("leader.demo"), staff = try await login("staff.demo")
        let leaderMe = try await leader.request("/api/me")["user"], staffMe = try await staff.request("/api/me")["user"]
        let leaderID = leaderMe["id"].int, staffID = staffMe["id"].int
        let tag = String(UUID().uuidString.prefix(8)).lowercased()
        let otherName = "qa-leader-" + tag, outsiderName = "qa-outsider-" + tag
        let otherID = try await admin.request("/api/users", method: "POST", body: ["username": .string(otherName), "name": .string("Leader QA"), "password": .string("codex-demo-2026")])["id"].int
        let outsiderID = try await admin.request("/api/users", method: "POST", body: ["username": .string(outsiderName), "name": .string("Nhân viên ngoài bảng QA"), "password": .string("codex-demo-2026")])["id"].int
        let other = try await login(otherName), outsider = try await login(outsiderName)
        var teamIDs: [Int] = []
        let existingTeams = try await admin.request("/api/teams")["teams"].rows
        for i in 1...4 {
            let name = "[QA iOS] Team \(i)"
            if let found = existingTeams.first(where: { $0.title == name }) { teamIDs.append(found.id) }
            else { teamIDs.append(try await admin.request("/api/teams", method: "POST", body: ["name": .string(name)])["id"].int) }
        }
        let board = try await admin.request("/api/boards", method: "POST", body: ["title": .string("[QA iOS] Phân quyền \(tag)")])["id"].int
        let privateBoard = try await admin.request("/api/boards", method: "POST", body: ["title": .string("[QA iOS] Giám đốc \(tag)")])["id"].int
        func expect(_ api: API, _ path: String, _ status: Int, method: String = "GET", body: [String: JSON]? = nil) async throws {
            do { _ = try await api.request(path, method: method, body: body); XCTFail("Expected \(status): \(method) \(path)") }
            catch APIError.server(let code, _) { XCTAssertEqual(code, status, path) }
        }
        func cleanup() async throws {
            _ = try await admin.request("/api/boards/\(board)", method: "DELETE")
            _ = try await admin.request("/api/boards/\(privateBoard)", method: "DELETE")
            for id in teamIDs { _ = try await admin.request("/api/teams/\(id)/members", method: "PUT", body: ["members": .array([])]) }
            for id in [otherID, outsiderID] { _ = try await admin.request("/api/users/\(id)", method: "PATCH", body: ["disabled": .bool(true)]) }
        }
        do {
            _ = try await admin.request("/api/teams/\(teamIDs[0])/members", method: "PUT", body: ["members": .array([
                .object(["user_id": .id(leaderID), "role": .string("leader")]), .object(["user_id": .id(otherID), "role": .string("leader")]), .object(["user_id": .id(staffID), "role": .string("member")])])])
            _ = try await admin.request("/api/boards/\(board)/team", method: "PUT", body: ["team_id": .id(teamIDs[0])])
            let teams = try await admin.request("/api/teams")["teams"].rows
            XCTAssertGreaterThanOrEqual(teams.count, 4)
            XCTAssertEqual(teams.first { $0.id == teamIDs[0] }?["members"].rows.filter { $0.text("role") == "leader" }.count, 2)
            // Team membership does not silently grant employees access to every team board.
            try await expect(staff, "/api/boards/\(board)", 403)
            try await expect(outsider, "/api/boards/\(board)", 403)
            let l = try await leader.request("/api/boards/\(board)"), l2 = try await other.request("/api/boards/\(board)")
            XCTAssertEqual(l["board"]["role"].string, "manager"); XCTAssertEqual(l2["board"]["role"].string, "manager")
            try await expect(leader, "/api/teams", 403, method: "POST", body: ["name": .string("Cannot create")])
            try await expect(staff, "/api/users", 403, method: "POST", body: ["username": .string("cannot-create")])
            _ = try await leader.request("/api/boards/\(board)/members", method: "PUT", body: ["members": .array(AccessPayload.boardMembers(selection: [String(staffID): .string("member")], people: [Record(staffMe)], actor: Record(leaderMe)))])
            let staffBoard = BoardSnapshot(try await staff.request("/api/boards/\(board)"))
            XCTAssertFalse(staffBoard.canManage)
            try await expect(staff, "/api/boards/\(board)/members", 403, method: "PUT", body: ["members": .array([])])
            try await expect(staff, "/api/lists", 403, method: "POST", body: ["board_id": .id(board), "title": .string("Cannot create column")])
            let list = try XCTUnwrap(staffBoard.lists.first).id
            let job = try await admin.request("/api/cards", method: "POST", body: ["list_id": .id(list), "title": .string("Giám đốc giao leader")])["id"].int
            _ = try await admin.request("/api/cards/\(job)/members", method: "PUT", body: ["user_ids": .array([.id(leaderID)])])
            // Leader work must go to the director, even with another board manager available.
            try await expect(other, "/api/cards/\(job)/reviewer", 400, method: "PUT", body: ["reviewer_id": .id(otherID)])
            _ = try await admin.request("/api/cards/\(job)/reviewer", method: "PUT", body: ["reviewer_id": .id(1)])
            _ = try await leader.request("/api/cards/\(job)/review", method: "POST", body: ["action": .string("submit")])
            let pending = BoardSnapshot(try await admin.request("/api/boards/\(board)"))
            let pendingCard = try XCTUnwrap(pending.cards.first { $0.id == job })
            let state = try await admin.request("/api/cards/\(job)/review")
            XCTAssertTrue(ReviewCapabilities(card: pendingCard, snapshot: pending, review: state, user: Record(.object(["id": .id(1), "is_admin": .bool(true)]))).canDecide)
            XCTAssertFalse(ReviewCapabilities(card: pendingCard, snapshot: pending, review: state, user: Record(leaderMe)).canDecide)
            try await expect(leader, "/api/cards/\(job)/review", 403, method: "POST", body: ["action": .string("approve")])
            try await expect(other, "/api/cards/\(job)/review", 403, method: "POST", body: ["action": .string("approve")])
            try await expect(admin, "/api/cards/\(job)/review", 400, method: "POST", body: ["action": .string("request_changes"), "note": .string("")])
            _ = try await admin.request("/api/cards/\(job)/review", method: "POST", body: ["action": .string("request_changes"), "note": .string("Bổ sung kết quả")])
            _ = try await leader.request("/api/cards/\(job)/review", method: "POST", body: ["action": .string("submit")])
            _ = try await admin.request("/api/cards/\(job)/review", method: "POST", body: ["action": .string("approve")])
            let done = BoardSnapshot(try await leader.request("/api/boards/\(board)"))
            XCTAssertTrue(done.cards.first { $0.id == job }?.flag("due_complete") == true)
            // The same client verifies staff assignment, comments and invalidation of a pending review.
            let staffJob = try await staff.request("/api/cards", method: "POST", body: ["list_id": .id(list), "title": .string("Leader giao nhân viên")])["id"].int
            try await expect(staff, "/api/cards/\(staffJob)/members", 403, method: "PUT", body: ["user_ids": .array([.id(staffID), .id(otherID)])])
            _ = try await leader.request("/api/cards/\(staffJob)/reviewer", method: "PUT", body: ["reviewer_id": .id(leaderID)])
            _ = try await staff.request("/api/cards/\(staffJob)/review", method: "POST", body: ["action": .string("submit")])
            let cm = try await staff.request("/api/cards/\(staffJob)/comments", method: "POST", body: ["text": .string("Đã bàn giao @leader.demo")])["id"].int
            _ = try await leader.request("/api/comments/\(cm)/reactions", method: "POST", body: ["emoji": .string("✅")])
            let comments = try await staff.request("/api/cards/\(staffJob)/comments")["comments"].rows
            XCTAssertEqual(comments.first { $0.id == cm }?["reactions"].rows.first?.number("count"), 1)
            let stillPending = try await staff.request("/api/cards/\(staffJob)/review")
            XCTAssertEqual(stillPending["state"].string, "pending")
            _ = try await staff.request("/api/cards/\(staffJob)", method: "PATCH", body: ["description": .string("Đã sửa nội dung sau khi gửi")])
            let reopened = try await staff.request("/api/cards/\(staffJob)/review")
            XCTAssertEqual(reopened["state"].string, "in_progress")
            let file = try await staff.upload("/api/cards/\(staffJob)/upload", data: Data("QA private attachment".utf8), name: "ket-qua.txt")
            do { _ = try await outsider.file(file["url"].string); XCTFail("Private upload leaked") }
            catch APIError.server(let code, _) { XCTAssertEqual(code, 403) }
            // Revocation is enforced across the feed, search, locate and attachment endpoints.
            _ = try await leader.request("/api/boards/\(board)/members", method: "PUT", body: ["members": .array(AccessPayload.boardMembers(selection: [:], people: [Record(staffMe)], actor: Record(leaderMe)))])
            try await expect(staff, "/api/boards/\(board)", 403)
            try await expect(staff, "/api/cards/\(staffJob)/locate", 403)
            let search = try await staff.request("/api/search?q=Leader%20giao")
            XCTAssertFalse(search["cards"].rows.contains { $0.id == staffJob })
            do { _ = try await staff.file(file["url"].string); XCTFail("Revoked attachment remained accessible") }
            catch APIError.server(let code, _) { XCTAssertEqual(code, 403) }
            // A disabled account loses even otherwise valid bearer sessions.
            _ = try await admin.request("/api/users/\(outsiderID)", method: "PATCH", body: ["disabled": .bool(true)])
            try await expect(outsider, "/api/me", 401)
            try await cleanup()
        } catch { try? await cleanup(); throw error }
    }
}
