import XCTest
@testable import KaireticCore

/// Runs only against an explicitly selected loopback demo server, never production.
final class LiveWorkflowTests: XCTestCase {
    func testNativeClientStaffLeaderDirectorWorkflow() async throws {
        guard let value = ProcessInfo.processInfo.environment["KAIRETIC_TEST_ORIGIN"], let origin = URL(string: value), origin.scheme == "http", ["localhost", "127.0.0.1"].contains(origin.host ?? "") else { throw XCTSkip("Set KAIRETIC_TEST_ORIGIN to the isolated local demo backend.") }
        func login(_ name: String) async throws -> API {
            let j = try await API(origin: origin).request("/api/login", method: "POST", body: ["username": .string(name), "password": .string("codex-demo-2026")])
            return API(origin: origin, token: j["token"].string)
        }
        let staff = try await login("staff.demo"), leader = try await login("leader.demo"), director = try await login("admin")
        let boards = try await staff.request("/api/boards")["boards"].rows
        let demoBoard = try XCTUnwrap(boards.first { $0.title.hasPrefix("[DEMO]") })
        XCTAssertEqual(demoBoard.text("role"), "member")
        let s = BoardSnapshot(try await staff.request("/api/boards/\(demoBoard.id)"))
        XCTAssertEqual(s.lists.count, 4)
        let list = try XCTUnwrap(s.lists.first)
        let created = try await staff.request("/api/cards", method: "POST", body: ["list_id": .id(list.id), "title": .string("[iOS TEST] \(UUID().uuidString)")])
        let id = created["id"].int
        _ = try await staff.request("/api/cards/\(id)", method: "PATCH", body: ["due_date": .string("2026-10-31"), "due_time": .string("17:00"), "start_date": .string("2026-10-30"), "recur": .string("monthly")])
        let group = try await staff.request("/api/cards/\(id)/checklists", method: "POST", body: ["title": .string("Bàn giao")])["id"].int
        let check = try await staff.request("/api/cards/\(id)/checklist", method: "POST", body: ["text": .string("Đối chiếu kết quả"), "group_id": .id(group), "checked": .bool(true)])["id"].int
        do { _ = try await staff.request("/api/cards/\(id)", method: "PATCH", body: ["due_complete": .bool(true)]); XCTFail("Approval bypass") } catch let e as APIError { if case .server(let status, _) = e { XCTAssertEqual(status, 409) } else { throw e } }
        _ = try await leader.request("/api/cards/\(id)/reviewer", method: "PUT", body: ["reviewer_id": .id(2)])
        _ = try await staff.request("/api/cards/\(id)/review", method: "POST", body: ["action": .string("submit"), "note": .string("Đã gửi kết quả")])
        do { _ = try await staff.request("/api/cards/\(id)/review", method: "POST", body: ["action": .string("approve")]); XCTFail("Self approval") } catch let e as APIError { if case .server(let status, _) = e { XCTAssertEqual(status, 403) } else { throw e } }
        _ = try await leader.request("/api/cards/\(id)/review", method: "POST", body: ["action": .string("request_changes"), "note": .string("Bổ sung dẫn chứng")])
        let revision = try await staff.request("/api/cards/\(id)/review")
        XCTAssertEqual(revision["state"].string, "changes_requested")
        _ = try await staff.request("/api/cards/\(id)/review", method: "POST", body: ["action": .string("submit")])
        _ = try await leader.request("/api/cards/\(id)/review", method: "POST", body: ["action": .string("approve")])
        let after = BoardSnapshot(try await staff.request("/api/boards/\(demoBoard.id)"))
        let card = try XCTUnwrap(after.cards.first { $0.id == id })
        XCTAssertEqual(card.text("due_date"), "2026-11-30"); XCTAssertFalse(card.flag("due_complete")); XCTAssertEqual(card.text("approval_state"), "in_progress")
        XCTAssertFalse(after.rows("checklist").first { $0.id == check }?.flag("checked") ?? true)
        // Attachment binary transfer and access control share the same native URLSession client.
        let attachment = try await staff.upload("/api/cards/\(id)/upload", data: Data("Kairetic iOS demo".utf8), name: "ban-giao.txt")
        let data = try await staff.file(attachment["url"].string)
        XCTAssertEqual(String(data: data, encoding: .utf8), "Kairetic iOS demo")
        let inbox = try await staff.request("/api/inbox", method: "POST", body: ["text": .string("[iOS TEST] Ý tưởng")])["id"].int
        let converted = try await staff.request("/api/inbox/\(inbox)/convert", method: "POST", body: ["list_id": .id(list.id)])["id"].int
        _ = try await staff.request("/api/planner", method: "PUT", body: ["card_id": .id(converted), "date": .string("2026-10-27")])
        let planner = try await staff.request("/api/planner")
        XCTAssertTrue(planner["slots"].rows.contains { $0.number("card_id") == converted })
        let hidden = try await director.request("/api/boards", method: "POST", body: ["title": .string("[iOS TEST] Quyền riêng tư")])["id"].int
        do { _ = try await staff.request("/api/boards/\(hidden)"); XCTFail("Unauthorized board") } catch let e as APIError { if case .server(let status, _) = e { XCTAssertEqual(status, 403) } else { throw e } }
        _ = try await director.request("/api/boards/\(hidden)", method: "DELETE")
        // Dedicated demo records created above are disposable; production is unreachable by this test.
        _ = try await director.request("/api/cards/\(id)", method: "DELETE")
        _ = try await director.request("/api/cards/\(converted)", method: "DELETE")
    }
}
