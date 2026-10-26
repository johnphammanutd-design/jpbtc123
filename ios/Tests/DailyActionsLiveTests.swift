import XCTest
@testable import KaireticCore

final class DailyActionsLiveTests: XCTestCase {
    func testTemplatesQuickEditAndAuthenticatedPhotosAgainstDemo() async throws {
        guard let raw = ProcessInfo.processInfo.environment["KAIRETIC_TEST_ORIGIN"], let origin = URL(string: raw), origin.scheme == "http", ["localhost", "127.0.0.1"].contains(origin.host ?? "") else { throw XCTSkip("Requires isolated local demo backend") }
        func login(_ name: String) async throws -> API {
            let result = try await API(origin: origin).request("/api/login", method: "POST", body: ["username": .string(name), "password": .string("codex-demo-2026")])
            return API(origin: origin, token: result["token"].string)
        }
        let admin = try await login("admin"), leader = try await login("leader.demo"), staff = try await login("staff.demo")
        let boardID = try await admin.request("/api/boards", method: "POST", body: ["title": .string("[QA PHOTO] " + UUID().uuidString)])["id"].int
        _ = try await admin.request("/api/boards/\(boardID)/members", method: "PUT", body: ["members": .array([
            .object(["user_id": .id(2), "role": .string("manager")]), .object(["user_id": .id(3), "role": .string("member")])])])
        let initial = BoardSnapshot(try await leader.request("/api/boards/\(boardID)"))
        let board = initial.board
        let list = try XCTUnwrap(initial.lists.first).id
        let source = try await leader.request("/api/cards", method: "POST", body: ["list_id": .id(list), "title": .string("[iOS TEST] Template \(UUID().uuidString)")])["id"].int
        var created: [Int] = [source]
        do {
            _ = try await leader.request("/api/cards/\(source)", method: "PATCH", body: ["description": .string("Đầu ra theo mẫu"), "is_template": .bool(true), "due_date": .string("2026-11-30"), "due_time": .string("17:00")])
            _ = try await leader.request("/api/cards/\(source)/members", method: "PUT", body: ["user_ids": .array([.id(3)])])
            let group = try await leader.request("/api/cards/\(source)/checklists", method: "POST", body: ["title": .string("Bàn giao")])["id"].int
            _ = try await leader.request("/api/cards/\(source)/checklist", method: "POST", body: ["group_id": .id(group), "text": .string("Có người và hạn"), "checked": .bool(true), "user_id": .id(3), "due_date": .string("2026-11-29"), "due_time": .string("16:00")])
            _ = try await leader.request("/api/cards/\(source)/attachments", method: "POST", body: ["url": .string("https://example.com/template.pdf"), "name": .string("Tài liệu mẫu")])
            let label = try XCTUnwrap(initial.rows("labels").first).id
            _ = try await leader.request("/api/cards/\(source)/labels", method: "PUT", body: ["label_ids": .array([.id(label)])])
            let snapshot = BoardSnapshot(try await staff.request("/api/boards/\(board.id)"))
            XCTAssertTrue(TemplateCards.available(in: snapshot).contains { $0.id == source })
            let copied = try await staff.request("/api/cards/\(source)/copy", method: "POST", body: TemplateCards.copyBody(title: "Công việc từ mẫu", listID: list, keepMembers: true))["id"].int; created.append(copied)
            let copiedSnapshot = BoardSnapshot(try await staff.request("/api/boards/\(board.id)"))
            let card = try XCTUnwrap(copiedSnapshot.cards.first { $0.id == copied })
            XCTAssertFalse(card.flag("is_template")); XCTAssertFalse(card.flag("due_complete")); XCTAssertEqual(card.text("description"), "Đầu ra theo mẫu")
            XCTAssertEqual(card.text("due_time"), "17:00"); XCTAssertEqual(copiedSnapshot.labels(of: card).map(\.id), [label])
            let item = try XCTUnwrap(copiedSnapshot.checklist(of: card).first)
            XCTAssertFalse(item.flag("checked")); XCTAssertEqual(item.number("user_id"), 3); XCTAssertEqual(item.text("due_time"), "16:00")
            let attachments = try await staff.request("/api/cards/\(copied)/attachments")
            XCTAssertEqual(attachments["attachments"].rows.first?.text("name"), "Tài liệu mẫu")
            let unassigned = try await staff.request("/api/cards/\(source)/copy", method: "POST", body: TemplateCards.copyBody(title: "Mẫu không giữ người", listID: list, keepMembers: false))["id"].int; created.append(unassigned)
            let withoutMembers = BoardSnapshot(try await staff.request("/api/boards/\(board.id)"))
            let noMemberCard = try XCTUnwrap(withoutMembers.cards.first { $0.id == unassigned })
            XCTAssertTrue(withoutMembers.members(of: noMemberCard).isEmpty); XCTAssertEqual(withoutMembers.checklist(of: noMemberCard).first?.number("user_id"), 0)
            _ = try await leader.request("/api/cards/\(copied)/reviewer", method: "PUT", body: ["reviewer_id": .id(2)])
            _ = try await staff.request("/api/cards/\(copied)/review", method: "POST", body: ["action": .string("submit")])
            var edit = QuickCardDraft(card: card, snapshot: copiedSnapshot); let original = edit
            edit.title = "Đã sửa nhanh"; edit.dueDate = "2026-12-01"
            _ = try await staff.request("/api/cards/\(copied)", method: "PATCH", body: edit.changes(from: original))
            let review = try await staff.request("/api/cards/\(copied)/review")
            XCTAssertEqual(review["state"].string, "in_progress")
            // Use the existing project icon as a non-personal fixture; the same preparation code handles Photos.
            let path = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Assets.xcassets/AppIcon.appiconset/AppIcon.png")
            let photo = try await PhotoPreparation.shared.prepare(url: path, maximumBytes: 10 * 1024 * 1024)
            let file = try await staff.upload("/api/cards/\(copied)/upload", data: photo.data, name: photo.filename)
            let downloaded = try await staff.file(file["url"].string)
            XCTAssertEqual(downloaded, photo.data)
            _ = try await leader.upload("/api/boards/\(board.id)/background", data: photo.data, name: photo.filename)
            let withBackground = BoardSnapshot(try await staff.request("/api/boards/\(board.id)"))
            XCTAssertTrue(withBackground.board.text("background").hasPrefix("url:/u/"))
            let backgroundBytes = try await staff.file(String(withBackground.board.text("background").dropFirst(4)))
            XCTAssertEqual(backgroundBytes, photo.data)
            do { _ = try await staff.upload("/api/boards/\(board.id)/background", data: photo.data, name: photo.filename); XCTFail("Member must not change board background") }
            catch APIError.server(let status, _) { XCTAssertEqual(status, 403) }
        } catch {
            for id in created { _ = try? await admin.request("/api/cards/\(id)", method: "DELETE") }
            _ = try? await admin.request("/api/boards/\(board.id)", method: "DELETE"); throw error
        }
        for id in created { _ = try await admin.request("/api/cards/\(id)", method: "DELETE") }
        _ = try await admin.request("/api/boards/\(board.id)", method: "DELETE")
    }
}
