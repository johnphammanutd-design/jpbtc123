import XCTest
@testable import KaireticCore

private final class TransportProbe: @unchecked Sendable {
    enum Outcome { case failure(URLError.Code), response(Int, String) }
    let outcome: Outcome
    private let lock = NSLock()
    private var count = 0
    init(_ outcome: Outcome) { self.outcome = outcome }
    func record() { lock.lock(); defer { lock.unlock() }; count += 1 }
    var requests: Int { lock.lock(); defer { lock.unlock() }; return count }
}

private final class TransportRegistry: @unchecked Sendable {
    private let lock = NSLock()
    private var probes: [String: TransportProbe] = [:]
    subscript(path: String) -> TransportProbe? {
        get { lock.lock(); defer { lock.unlock() }; return probes[path] }
        set { lock.lock(); defer { lock.unlock() }; probes[path] = newValue }
    }
}

private final class FailingTransport: URLProtocol {
    static let registry = TransportRegistry()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let probe = Self.registry[request.url!.path] else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse)); return
        }
        probe.record()
        switch probe.outcome {
        case .failure(let code): client?.urlProtocol(self, didFailWithError: URLError(code))
        case .response(let status, let body):
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(body.utf8))
            client?.urlProtocolDidFinishLoading(self)
        }
    }
    override func stopLoading() {}
}

final class TransportTests: XCTestCase {
    func testInterruptedWritesPropagateFailureWithoutAutomaticRetry() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [FailingTransport.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        let api = API(token: "transport-fixture", session: session)
        for code in [URLError.Code.notConnectedToInternet, .networkConnectionLost, .timedOut, .cancelled] {
            let path = "/api/cards/" + UUID().uuidString
            let probe = TransportProbe(.failure(code))
            FailingTransport.registry[path] = probe
            defer { FailingTransport.registry[path] = nil }
            do {
                _ = try await api.request(path, method: "POST", body: ["title": .string("Synthetic network fixture")])
                XCTFail("A failed transport must not be reported as a successful save")
            } catch { XCTAssertEqual((error as? URLError)?.code, code) }
            XCTAssertEqual(probe.requests, 1, "A lost response may follow a committed write; never replay it automatically")
        }
    }

    func testRevokedFileReturnsPermissionErrorInsteadOfPreviewData() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [FailingTransport.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        let path = "/u/" + UUID().uuidString + ".txt"
        let probe = TransportProbe(.response(403, #"{"error":"Bạn chưa được cấp quyền vào bảng này"}"#))
        FailingTransport.registry[path] = probe
        defer { FailingTransport.registry[path] = nil }
        do {
            _ = try await API(token: "transport-fixture", session: session).file(path)
            XCTFail("A denied download must not be returned as file content")
        } catch { XCTAssertEqual(error as? APIError, .server(403, "Bạn chưa được cấp quyền vào bảng này")) }
        XCTAssertEqual(probe.requests, 1)
    }
}
