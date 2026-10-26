import Foundation

public enum APIError: LocalizedError, Equatable {
    case server(Int, String), invalidResponse, unsafeURL
    public var errorDescription: String? {
        switch self {
        case .server(_, let message): return message
        case .invalidResponse: return "Máy chủ trả dữ liệu không hợp lệ."
        case .unsafeURL: return "Đường dẫn không thuộc máy chủ công ty."
        }
    }
    public var isUnauthorized: Bool { if case .server(401, _) = self { return true }; return false }
}
/// Authenticated requests never follow redirects, preventing credential forwarding.
private final class NoRedirect: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
public final class API: @unchecked Sendable {
    public let origin: URL
    public let token: String?
    private let session: URLSession
    public init(origin: URL = URL(string: "https://task.kairetic.com")!, token: String? = nil, session: URLSession? = nil) {
        self.origin = origin; self.token = token
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 30; config.httpCookieStorage = nil; config.urlCache = nil
        self.session = session ?? URLSession(configuration: config, delegate: NoRedirect(), delegateQueue: nil)
    }
    public static func validOrigin(_ url: URL, allowLocal: Bool) -> Bool {
        guard url.user == nil, url.password == nil, url.query == nil, url.fragment == nil, url.path == "" || url.path == "/" else { return false }
        if url.scheme == "https", url.host == "task.kairetic.com", url.port == nil || url.port == 443 { return true }
        return allowLocal && url.scheme == "http" && ["localhost", "127.0.0.1", "::1"].contains(url.host ?? "")
    }
    public func request(_ path: String, method: String = "GET", body: [String: JSON]? = nil) async throws -> JSON {
        guard path.hasPrefix("/api/"), !path.contains(".."), var components = URLComponents(url: origin, resolvingAgainstBaseURL: false) else { throw APIError.unsafeURL }
        let parts = path.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
        components.path = String(parts[0]); components.percentEncodedQuery = parts.count == 2 ? String(parts[1]) : nil
        guard let url = components.url else { throw APIError.unsafeURL }
        var r = URLRequest(url: url); r.httpMethod = method
        if let token { r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body { r.httpBody = try JSONEncoder().encode(JSON.object(body)); r.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let (data, response) = try await session.data(for: r)
        try validate(data, response)
        return try JSONDecoder().decode(JSON.self, from: data)
    }
    public func upload(_ path: String, data: Data, name: String) async throws -> JSON {
        guard path.hasPrefix("/api/cards/") || path.hasPrefix("/api/boards/"), !path.contains(".."), var c = URLComponents(url: origin, resolvingAgainstBaseURL: false) else { throw APIError.unsafeURL }
        c.path = path; c.queryItems = [URLQueryItem(name: "name", value: name)]
        var r = URLRequest(url: c.url!); r.httpMethod = "POST"; r.httpBody = data
        r.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        if let token { r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let (d, response) = try await session.data(for: r); try validate(d, response)
        return try JSONDecoder().decode(JSON.self, from: d)
    }
    public func file(_ path: String) async throws -> Data {
        guard let url = URL(string: path, relativeTo: origin)?.absoluteURL, url.scheme == origin.scheme, url.host == origin.host, url.port == origin.port, url.path.hasPrefix("/u/"), url.user == nil, url.password == nil else { throw APIError.unsafeURL }
        var r = URLRequest(url: url)
        if let token { r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let (data, response) = try await session.data(for: r); try validate(data, response); return data
    }
    public func export(_ path: String) async throws -> Data {
        guard path.hasPrefix("/api/boards/"), path.hasSuffix("/export.csv") || path.hasSuffix("/export.json"), let url = URL(string: path, relativeTo: origin) else { throw APIError.unsafeURL }
        var r = URLRequest(url: url); if let token { r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let (data, response) = try await session.data(for: r); try validate(data, response); return data
    }
    private func validate(_ data: Data, _ response: URLResponse) throws {
        guard let h = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200..<300).contains(h.statusCode) else {
            let message = (try? JSONDecoder().decode(JSON.self, from: data)["error"].string) ?? ""
            throw APIError.server(h.statusCode, message.isEmpty ? "Không thể thực hiện yêu cầu (\(h.statusCode))." : message)
        }
    }
}
