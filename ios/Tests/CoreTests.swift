import XCTest
@testable import KaireticCore

final class CoreTests: XCTestCase {
    func json(_ source: String) throws -> JSON { try JSONDecoder().decode(JSON.self, from: Data(source.utf8)) }
    func testDragReorderPositions() {
        XCTAssertEqual(OrderPosition.insertion(at: 0, positions: []), 1024)
        XCTAssertEqual(OrderPosition.insertion(at: 0, positions: [1024, 2048]), 0)
        XCTAssertEqual(OrderPosition.insertion(at: 1, positions: [1024, 2048]), 1536)
        XCTAssertEqual(OrderPosition.insertion(at: 2, positions: [1024, 2048]), 3072)
    }
    func testSQLiteFlagsNullAndNestedOptions() throws {
        let j = try json(#"{"is_admin":1,"disabled":0,"watch":true,"reviewer_id":null,"options":"[\"Cao\",\"Vừa\"]"}"#)
        XCTAssertTrue(j["is_admin"].flag); XCTAssertFalse(j["disabled"].flag); XCTAssertTrue(j["watch"].flag)
        XCTAssertEqual(j["reviewer_id"], .null); XCTAssertEqual(j["options"].parsed.array.map(\.string), ["Cao", "Vừa"])
        XCTAssertEqual(try JSONDecoder().decode(JSON.self, from: JSONEncoder().encode(j)), j)
    }
    func testMirrorsUseSourceMembersLabelsAndChecklist() throws {
        let j = try json(#"{"board":{"id":2,"role":"member"},"cards":[{"id":8,"mirror_of":4,"source_label_ids":[3],"source_members":[{"user_id":7,"name":"An"}],"source_checklist":[{"id":12,"checked":1}]}],"mirrorLabels":[{"id":3,"name":"Ưu tiên"}],"cardMembers":[],"cardLabels":[],"checklist":[]}"#)
        let s = BoardSnapshot(j), c = try XCTUnwrap(s.cards.first)
        XCTAssertFalse(s.canManage); XCTAssertEqual(s.members(of: c).first?.number("user_id"), 7)
        XCTAssertEqual(s.labels(of: c).first?.title, "Ưu tiên"); XCTAssertTrue(s.checklist(of: c).first?.flag("checked") == true)
        XCTAssertTrue(CardFilter.mine.includes(c, snapshot: s, userID: 7, today: "2026-10-26"))
        XCTAssertFalse(CardFilter.unassigned.includes(c, snapshot: s, userID: 7, today: "2026-10-26"))
    }
    func testFiltersAndReviewState() throws {
        let s = BoardSnapshot(try json(#"{"board":{"role":"manager"},"cards":[{"id":1,"due_date":"2026-10-20","due_complete":0,"approval_state":"pending"},{"id":2,"due_date":"","due_complete":1,"approval_state":"approved"}]}"#))
        XCTAssertTrue(s.canManage); XCTAssertEqual(s.cards.first?.reviewLabel, "Chờ duyệt")
        XCTAssertEqual(s.cards.filter { CardFilter.overdue.includes($0, snapshot: s, userID: 9, today: "2026-10-26") }.map(\.id), [1])
        XCTAssertEqual(s.cards.filter { CardFilter.complete.includes($0, snapshot: s, userID: 9, today: "2026-10-26") }.map(\.id), [2])
    }
    func testOriginsOnlyAllowCompanyAndExplicitLocalDebug() {
        for s in ["https://evil.example", "https://task.kairetic.com.evil.example", "https://a:pw@task.kairetic.com", "http://task.kairetic.com", "https://task.kairetic.com/api", "https://task.kairetic.com?x=1"] { XCTAssertFalse(API.validOrigin(URL(string: s)!, allowLocal: true), s) }
        XCTAssertTrue(API.validOrigin(URL(string: "https://task.kairetic.com")!, allowLocal: false))
        XCTAssertTrue(API.validOrigin(URL(string: "http://localhost:3101")!, allowLocal: true))
        XCTAssertFalse(API.validOrigin(URL(string: "http://localhost:3101")!, allowLocal: false))
    }
    func testPrivateFilesCannotSendTokenToOtherOrigins() async throws {
        let api = API(token: "fixture-token")
        for path in ["https://evil.example/u/file.pdf", "//evil.example/u/file.pdf", "http://task.kairetic.com/u/file.pdf", "https://task.kairetic.com:999/u/a", "/api/me"] {
            do { _ = try await api.file(path); XCTFail("Should reject \(path)") } catch { XCTAssertEqual(error as? APIError, .unsafeURL) }
        }
    }
}
final class MockProtocol: URLProtocol {
    static var response: (Int, String) = (200, "{}")
    static var captured: URLRequest?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.captured = request
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: Self.response.0, httpVersion: nil, headerFields: ["Content-Type":"application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(Self.response.1.utf8)); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
final class APITests: XCTestCase {
    var api: API!
    override func setUp() { let c = URLSessionConfiguration.ephemeral; c.protocolClasses = [MockProtocol.self]; api = API(token: "test-session", session: URLSession(configuration: c)) }
    func testBearerAndRequestBody() async throws {
        MockProtocol.response = (200, #"{"ok":true}"#)
        _ = try await api.request("/api/cards/3/review", method: "POST", body: ["action": .string("request_changes"), "note": .string("Sửa lại kịch bản")])
        let r = try XCTUnwrap(MockProtocol.captured)
        XCTAssertEqual(r.value(forHTTPHeaderField: "Authorization"), "Bearer test-session"); XCTAssertEqual(r.httpMethod, "POST")
        XCTAssertEqual(r.url?.path, "/api/cards/3/review"); XCTAssertEqual(r.value(forHTTPHeaderField: "Content-Type"), "application/json")
    }
    func testUnauthorizedAndConflictMessagesArePreserved() async throws {
        for (code, text) in [(401, "Hết phiên"), (409, "Cần gửi người duyệt")] {
            MockProtocol.response = (code, "{\"error\":\"\(text)\"}")
            do { _ = try await api.request("/api/me"); XCTFail("Expected failure") } catch let e as APIError { XCTAssertEqual(e, .server(code, text)); XCTAssertEqual(e.isUnauthorized, code == 401) }
        }
    }
    func testUploadUnicodeFilenameIsQueryEncoded() async throws {
        MockProtocol.response = (200, #"{"id":1}"#)
        _ = try await api.upload("/api/cards/1/upload", data: Data("test".utf8), name: "Kịch bản & final #1.pdf")
        let r = try XCTUnwrap(MockProtocol.captured)
        XCTAssertEqual(URLComponents(url: r.url!, resolvingAgainstBaseURL: false)?.queryItems?.first?.value, "Kịch bản & final #1.pdf")
        XCTAssertEqual(r.value(forHTTPHeaderField: "Content-Type"), "application/octet-stream")
    }
}
