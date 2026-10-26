import XCTest
@testable import KaireticCore

final class OrderingLiveTests: XCTestCase {
    func testInboxOrderPersistencePrivacyAndColumnSortAgainstDemo() async throws {
        guard let raw = ProcessInfo.processInfo.environment["KAIRETIC_TEST_ORIGIN"], let origin = URL(string: raw), origin.scheme == "http", ["localhost", "127.0.0.1"].contains(origin.host ?? "") else { throw XCTSkip("Requires isolated local demo backend") }
        func login(_ name: String) async throws -> API {
            let result = try await API(origin: origin).request("/api/login", method: "POST", body: ["username": .string(name), "password": .string("codex-demo-2026")])
            return API(origin: origin, token: result["token"].string)
        }
        let admin = try await login("admin"), staff = try await login("staff.demo"), leader = try await login("leader.demo")
        var inboxIDs: [Int] = []; var boardID = 0
        func cleanup() async throws {
            for id in inboxIDs { _ = try await staff.request("/api/inbox/\(id)", method: "DELETE") }
            if boardID > 0 { _ = try await admin.request("/api/boards/\(boardID)", method: "DELETE") }
        }
        do {
            for title in ["A", "B", "C"] { inboxIDs.append(try await staff.request("/api/inbox", method: "POST", body: ["text": .string("[QA ORDER] " + title)])["id"].int) }
            let items = try await staff.request("/api/inbox")["items"].rows
            let plan = try InboxOrdering.plan(InboxMove(itemID: inboxIDs[2], beforeID: inboxIDs[0]), items: items)
            for write in plan.writes { _ = try await staff.request("/api/inbox/\(write.id)", method: "PATCH", body: ["position": .number(write.position)]) }
            let signedInAgain = try await login("staff.demo")
            let persisted = try await signedInAgain.request("/api/inbox")["items"].rows
            XCTAssertEqual(persisted.filter { inboxIDs.contains($0.id) }.map(\.id), [inboxIDs[2], inboxIDs[0], inboxIDs[1]])
            let someoneElse = try await leader.request("/api/inbox")["items"].rows
            XCTAssertFalse(someoneElse.contains { inboxIDs.contains($0.id) })
            do { _ = try await leader.request("/api/inbox/\(inboxIDs[0])", method: "PATCH", body: ["position": .number(0)]); XCTFail("Inbox is personal") }
            catch APIError.server(let status, _) { XCTAssertEqual(status, 404) }
            boardID = try await admin.request("/api/boards", method: "POST", body: ["title": .string("[QA ORDER] " + UUID().uuidString)])["id"].int
            let initial = BoardSnapshot(try await admin.request("/api/boards/\(boardID)")); let list = try XCTUnwrap(initial.lists.first).id
            _ = try await admin.request("/api/boards/\(boardID)/members", method: "PUT", body: ["members": .array([.object(["user_id": .id(3), "role": .string("member")])])])
            var cardIDs: [Int] = []
            for (title, due) in [("Zebra", ""), ("Alpha", "2026-12-02"), ("Middle", "2026-12-01")] {
                let id = try await admin.request("/api/cards", method: "POST", body: ["title": .string(title), "list_id": .id(list)])["id"].int; cardIDs.append(id)
                if !due.isEmpty { _ = try await admin.request("/api/cards/\(id)", method: "PATCH", body: ["due_date": .string(due)]) }
            }
            for (by, expected) in [("title", [cardIDs[1], cardIDs[2], cardIDs[0]]), ("due", [cardIDs[2], cardIDs[1], cardIDs[0]]), ("created", Array(cardIDs.reversed()))] {
                _ = try await admin.request("/api/lists/\(list)/sort", method: "POST", body: ["by": .string(by)])
                let sorted = BoardSnapshot(try await admin.request("/api/boards/\(boardID)"))
                XCTAssertEqual(sorted.cards.filter { $0.number("list_id") == list }.map(\.id), expected)
                XCTAssertTrue(sorted.cards.allSatisfy { !$0.flag("due_complete") })
            }
            do { _ = try await staff.request("/api/lists/\(list)/sort", method: "POST", body: ["by": .string("title")]); XCTFail("Members may not reorder the whole column") }
            catch APIError.server(let status, _) { XCTAssertEqual(status, 403) }
        } catch { try? await cleanup(); throw error }
        try await cleanup()
    }
}
