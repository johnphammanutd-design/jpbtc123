import SwiftUI
import Security

struct CredentialVault {
    let origin: String
    private var query: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.kairetic.task.session", kSecAttrAccount as String: origin] }
    func read() -> String? {
        var q = query; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    func save(_ token: String) throws {
        let data = Data(token.utf8)
        let update = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if update == errSecSuccess { return }
        var q = query; q[kSecValueData as String] = data; q[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        guard update == errSecItemNotFound, SecItemAdd(q as CFDictionary, nil) == errSecSuccess else { throw APIError.server(0, "Không thể lưu phiên đăng nhập an toàn.") }
    }
    func clear() { SecItemDelete(query as CFDictionary) }
}
@MainActor final class AppState: ObservableObject {
    @Published var user: Record?
    @Published var boards: [Record] = []
    @Published var users: [Record] = []
    @Published var overview: JSON = .null
    @Published var notifications: [Record] = []
    @Published var unread = 0
    @Published var restoring = true
    @Published var revision = 0
    @Published var message: String?
    @Published var refreshNotice: String?
    @Published var connected = false
    let origin: URL
    private var token: String?
    private var socket: URLSessionWebSocketTask?
    private var socketTask: Task<Void, Never>?
    private var watchedBoard: Int?
    private var boardSubscriptions = BoardSubscriptions()
    private var reloadTask: Task<Void, Never>?
    var api: API { API(origin: origin, token: token) }
    var isDirector: Bool { user?.flag("is_admin") == true }
    var canCreate: Bool { isDirector || user?.flag("is_leader") == true }
    var vault: CredentialVault { CredentialVault(origin: origin.absoluteString) }
    init() {
        var selected = URL(string: "https://task.kairetic.com")!
        #if DEBUG
        if let s = ProcessInfo.processInfo.environment["KAIRETIC_API_ORIGIN"], let url = URL(string: s), API.validOrigin(url, allowLocal: true) { selected = url }
        #endif
        origin = selected
    }
    func restore() async {
        defer { restoring = false }
        token = vault.read()
        guard token != nil else { return }
        do { user = Record(try await call("/api/me")["user"]); try await refresh(); connect() }
        catch { message = error.localizedDescription }
    }
    func login(username: String, password: String) async throws {
        let result = try await API(origin: origin).request("/api/login", method: "POST", body: ["username": .string(username), "password": .string(password)])
        let newToken = result["token"].string
        guard !newToken.isEmpty else { throw APIError.invalidResponse }
        try vault.save(newToken); token = newToken; user = Record(result["user"])
        try await refresh(); connect()
    }
    private func authenticated<T>(_ operation: (API) async throws -> T) async throws -> T {
        let startedToken = token
        do {
            let result = try await operation(api)
            guard token == startedToken else { throw CancellationError() }
            return result
        } catch {
            if token == startedToken, (error as? APIError)?.isUnauthorized == true { clearSession(); message = "Phiên đăng nhập đã hết hạn. Anh/chị vui lòng đăng nhập lại." }
            throw error
        }
    }
    @discardableResult func call(_ path: String, _ method: String = "GET", _ body: [String: JSON]? = nil) async throws -> JSON {
        try await authenticated { try await $0.request(path, method: method, body: body) }
    }
    func upload(_ path: String, data: Data, name: String) async throws -> JSON { try await authenticated { try await $0.upload(path, data: data, name: name) } }
    func file(_ path: String) async throws -> Data { try await authenticated { try await $0.file(path) } }
    func export(_ path: String) async throws -> Data { try await authenticated { try await $0.export(path) } }
    func refresh() async throws {
        async let b = call("/api/boards")
        async let u = call("/api/users")
        async let o = call("/api/overview")
        async let n = call("/api/notifications")
        async let me = call("/api/me")
        let result = try await (b, u, o, n, me)
        // Do not restore protected state after a concurrent 401 or logout.
        guard token != nil else { return }
        boards = result.0["boards"].rows; users = result.1["users"].rows; overview = result.2
        notifications = result.3["notifications"].rows; unread = result.3["unread"].int; user = Record(result.4["user"])
        refreshNotice = nil
    }
    // Returning from Settings while offline must not cover the current form with an alert.
    func refreshOnActivation() async {
        do { try await refresh(); revision += 1 }
        catch is CancellationError {}
        catch let error as URLError where error.code == .cancelled {}
        catch { if user != nil { refreshNotice = "Chưa tải được dữ liệu mới. Kiểm tra kết nối rồi thử lại." } }
    }
    func myWork() async throws -> [Record] {
        let available = boards.filter { !$0.flag("closed") }
        let snapshots = try await withThrowingTaskGroup(of: BoardSnapshot?.self) { group in
            for board in available {
                group.addTask {
                    do { return BoardSnapshot(try await self.call("/api/boards/\(board.id)")) }
                    catch APIError.server(let status, _) where status == 403 || status == 404 { return nil }
                }
            }
            var result: [BoardSnapshot] = []
            for try await snapshot in group { if let snapshot { result.append(snapshot) } }
            return result
        }
        return WorkFeed.mine(snapshots: snapshots, userID: user?.id ?? 0)
    }
    @discardableResult func mutate(_ path: String, _ method: String = "POST", _ body: [String: JSON] = [:]) async throws -> JSON {
        let result = try await call(path, method, body)
        revision += 1
        // A successful write must not be reported as failed if refreshing later fails.
        do { try await refresh() } catch { message = "Đã lưu. Chưa tải được dữ liệu mới: \(error.localizedDescription)" }
        return result
    }
    func logout() async {
        do { _ = try await call("/api/logout", "POST", [:]); clearSession() }
        catch { clearSession(); message = "Đã đăng xuất trên máy này. Chưa thu hồi được phiên trên máy chủ do mất kết nối." }
    }
    private func clearSession() {
        disconnect(); vault.clear(); token = nil; user = nil; boards = []; users = []; overview = .null; notifications = []; unread = 0; revision += 1
        boardSubscriptions = BoardSubscriptions(); watchedBoard = nil
        refreshNotice = nil
        try? FileManager.default.removeItem(at: FileManager.default.temporaryDirectory.appendingPathComponent("Kairetic"))
    }
    func watch(_ id: Int?, owner: UUID) {
        boardSubscriptions.set(id, owner: owner)
        let next = boardSubscriptions.boardID
        guard next != watchedBoard else { return }
        watchedBoard = next; sendWatch()
    }
    private func sendWatch() {
        guard let socket, let data = try? JSONEncoder().encode(JSON.object(["type": .string("watch"), "boardId": watchedBoard.map(JSON.id) ?? .null])), let s = String(data: data, encoding: .utf8) else { return }
        Task { try? await socket.send(.string(s)) }
    }
    func connect() {
        disconnect(); guard let token else { return }
        var c = URLComponents(url: origin, resolvingAgainstBaseURL: false)!
        c.scheme = origin.scheme == "https" ? "wss" : "ws"; c.path = "/ws"; c.queryItems = [URLQueryItem(name: "token", value: token)]
        socketTask = Task { [weak self] in
            var delay: UInt64 = 1
            while !Task.isCancelled {
                guard let self, self.token != nil else { break }
                let ws = URLSession.shared.webSocketTask(with: c.url!); self.socket = ws; ws.resume(); self.sendWatch()
                do {
                    while !Task.isCancelled {
                        let result = try await ws.receive()
                        self.connected = true; delay = 1
                        let data: Data
                        switch result { case .data(let d): data = d; case .string(let s): data = Data(s.utf8); @unknown default: continue }
                        guard let j = try? JSONDecoder().decode(JSON.self, from: data), ["board-changed", "boards-changed", "comments-changed", "notification"].contains(j["type"].string) else { continue }
                        self.reloadTask?.cancel()
                        self.reloadTask = Task { [weak self] in
                            try? await Task.sleep(nanoseconds: 300_000_000)
                            guard !Task.isCancelled, let self else { return }
                            self.revision += 1
                            do { try await self.refresh() } catch { /* Pull to refresh remains available. */ }
                        }
                    }
                } catch { self.connected = false }
                ws.cancel(with: .goingAway, reason: nil)
                do { try await Task.sleep(nanoseconds: delay * 1_000_000_000) } catch { break }
                delay = min(delay * 2, 30)
                if !Task.isCancelled { try? await self.refresh(); self.revision += 1 }
            }
        }
    }
    func disconnect() { socketTask?.cancel(); socketTask = nil; socket?.cancel(with: .goingAway, reason: nil); socket = nil; reloadTask?.cancel(); connected = false }
    func handle(_ operation: @escaping () async throws -> Void) { Task { do { try await operation() } catch { message = error.localizedDescription } } }
}
