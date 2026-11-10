import Foundation

// Owner-authenticated plaintext Clipboard; no custom vault or E2EE encryption.
enum XDriveIOSClipboardPolicy {
    static let maxTextBytes = 65_536
    enum Failure: LocalizedError {
        case invalidMessage, invalidOwner, invalidPayload, http(Int)
        var errorDescription: String? {
            switch self {
            case .invalidMessage: return "剪贴板文本必须在 1–65536 字节之间。"
            case .invalidOwner: return "当前账号或服务器已变化，请重新登录。"
            case .invalidPayload: return "剪贴板消息或设备身份无效。"
            case .http(let code): return "剪贴板服务器请求失败（HTTP \(code)）。"
            }
        }
    }
    static func kind(_ text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.range(of: #"^https?://\S+$"#, options: .regularExpression) != nil
            ? "text/uri-list" : "text/plain"
    }
}

struct XDriveIOSClipboardItem: Codable, Identifiable {
    let id: UInt64
    let client_event_id: String
    let kind: String
    let content: String
    let created_at: String
    let expires_at: String
    let target_device_id: String?
    let node_id: UInt64?
}
struct XDriveIOSClipboardPage: Decodable {
    let items: [XDriveIOSClipboardItem]
    let next_before: UInt64?
}
struct XDriveIOSClipboardTargetDevice: Decodable, Identifiable {
    let device_id: String
    let name: String
    let platform: String
    var id: String { device_id }
}
private struct XDriveIOSClipboardTargetDirectory: Decodable {
    let devices: [XDriveIOSClipboardTargetDevice]
}
struct XDriveIOSClipboardWrite: Encodable {
    let client_event_id: String
    let kind: String
    let content: String
    let target_device_id: String?
    let node_id: UInt64?

    init(_ content: String, kind: String, targetID: String? = nil,
         nodeID: UInt64 = 0, eventID: String = UUID().uuidString.lowercased()) throws {
        guard UUID(uuidString: eventID) != nil,
              (1...XDriveIOSClipboardPolicy.maxTextBytes).contains(Data(content.utf8).count)
        else { throw XDriveIOSClipboardPolicy.Failure.invalidMessage }
        let isReference = kind == "image/x-xdrive-node-ref" ||
                          kind == "application/x-xdrive-node-ref"
        let isText = kind == "text/plain" || kind == "text/uri-list"
        guard (isText && nodeID == 0) ||
              (isReference && nodeID > 0 && content == "asset:\(nodeID)" && targetID != nil)
        else { throw XDriveIOSClipboardPolicy.Failure.invalidPayload }
        if let targetID, UUID(uuidString: targetID) == nil {
            throw XDriveIOSClipboardPolicy.Failure.invalidPayload
        }
        self.client_event_id = eventID
        self.kind = kind
        self.content = content
        self.target_device_id = targetID
        self.node_id = nodeID > 0 ? nodeID : nil
    }
}

private final class XDriveIOSClipboardRejectRedirects:
    XDriveIOSServerTLSDelegate, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// HTTPS and bearer are sourced only from the native verified Owner; the
/// The current verified Owner bearer alone authorizes Clipboard requests.
struct XDriveIOSNativeClipboardClient {
    let owner: XDriveNativeOwnerRoot
    let token: String
    let deviceProof: XDriveIOSBackgroundDeviceProof?
    init(owner: XDriveNativeOwnerRoot, accessToken: String,
         deviceProof: XDriveIOSBackgroundDeviceProof? = nil) throws {
        guard owner.ownerID > 0, owner.origin.scheme == "https",
              !accessToken.isEmpty else { throw XDriveIOSClipboardPolicy.Failure.invalidOwner }
        self.owner = owner
        token = accessToken
        self.deviceProof = deviceProof
    }

    private func request<T: Decodable>(
        _ path: String, method: String = "GET", body: Data? = nil,
        before: UInt64? = nil, response: T.Type
    ) async throws -> T {
        guard path.hasPrefix("/api/v1/clipboard/"), !path.contains(".."),
              !path.contains("?"), !path.contains("#"),
              var url = URLComponents(url: owner.origin, resolvingAgainstBaseURL: false) else {
            throw XDriveIOSClipboardPolicy.Failure.invalidOwner
        }
        url.path = path
        if let before { url.queryItems = [URLQueryItem(name: "before", value: String(before))] }
        guard let endpoint = url.url, endpoint.host == owner.origin.host else {
            throw XDriveIOSClipboardPolicy.Failure.invalidOwner
        }
        var req = URLRequest(url: endpoint)
        req.httpMethod = method
        req.httpShouldHandleCookies = false
        req.timeoutInterval = 30
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let deviceProof {
            req.setValue(deviceProof.deviceID, forHTTPHeaderField: "X-XDrive-Device-ID")
            req.setValue(deviceProof.secret, forHTTPHeaderField: "X-XDrive-Device-Token")
        }
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        if let body {
            guard body.count < 130_000 else { throw XDriveIOSClipboardPolicy.Failure.invalidMessage }
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = body
        }
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        let session = URLSession(configuration: config,
            delegate: XDriveIOSClipboardRejectRedirects(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        let (data, result) = try await session.data(for: req)
        try Task.checkCancellation()
        guard let http = result as? HTTPURLResponse,
              (200...299).contains(http.statusCode),
              data.count <= 130_000 else {
            throw XDriveIOSClipboardPolicy.Failure.http((result as? HTTPURLResponse)?.statusCode ?? 0)
        }
        return try JSONDecoder().decode(response, from: data)
    }
    /// Foreground Owner invalidation stream. Never transports Clipboard
    /// content: each complete sync/change frame only triggers GET /items.
    /// A stream is bounded server-side to 20s; callers reverify the Owner
    /// bearer and run an authoritative GET on every reconnect.
    func watchChanges(after: UInt64, onChange: () async -> Void) async throws -> UInt64 {
        guard var url = URLComponents(url: owner.origin, resolvingAgainstBaseURL: false) else {
            throw XDriveIOSClipboardPolicy.Failure.invalidOwner
        }
        url.path = "/api/v1/clipboard/events"
        url.queryItems = [URLQueryItem(name: "after", value: String(after))]
        guard let endpoint = url.url, endpoint.host == owner.origin.host,
              endpoint.scheme == "https" else {
            throw XDriveIOSClipboardPolicy.Failure.invalidOwner
        }
        var request = URLRequest(url: endpoint)
        request.httpMethod = "GET"
        request.httpShouldHandleCookies = false
        request.timeoutInterval = 25
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let deviceProof {
            request.setValue(deviceProof.deviceID, forHTTPHeaderField: "X-XDrive-Device-ID")
            request.setValue(deviceProof.secret, forHTTPHeaderField: "X-XDrive-Device-Token")
        }
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        let session = URLSession(configuration: config,
            delegate: XDriveIOSClipboardRejectRedirects(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        let (bytes, response) = try await session.bytes(for: request)
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              http.value(forHTTPHeaderField: "Content-Type")?
                .lowercased().hasPrefix("text/event-stream") == true else {
            throw XDriveIOSClipboardPolicy.Failure.http(
                (response as? HTTPURLResponse)?.statusCode ?? 0)
        }
        var decoder = XDriveIOSClipboardSSECursor(after: after)
        var line = [UInt8]()
        for try await byte in bytes {
            try Task.checkCancellation()
            if byte == 10 { // UTF-8 LF ends one bounded SSE line.
                if line.last == 13 { line.removeLast() }
                guard let text = String(bytes: line, encoding: .utf8) else {
                    throw XDriveIOSClipboardSSECursor.FrameError.invalidFrame
                }
                line.removeAll(keepingCapacity: true)
                if try decoder.acceptLine(text) {
                    try Task.checkCancellation()
                    await onChange()
                }
            } else {
                guard line.count < 4096 else {
                    throw XDriveIOSClipboardSSECursor.FrameError.invalidFrame
                }
                line.append(byte)
            }
        }
        // Incomplete trailing frames are never trusted; reconnect full GET
        // recovers any missed invalidation or pruned change cursor.
        return decoder.cursor
    }

    func enrollClipboardDevice() async throws {
        guard deviceProof != nil else { throw XDriveIOSClipboardPolicy.Failure.invalidOwner }
        struct Receipt: Decodable { let device_id: String }
        let result = try await request("/api/v1/clipboard/devices/self",
            method: "PUT", body: Data("{}".utf8), response: Receipt.self)
        guard result.device_id == deviceProof?.deviceID else {
            throw XDriveIOSClipboardPolicy.Failure.invalidOwner
        }
    }

    func list(before: UInt64? = nil) async throws -> XDriveIOSClipboardPage {
        let page = try await request("/api/v1/clipboard/items", before: before,
                                     response: XDriveIOSClipboardPage.self)
        guard page.items.count <= 50 else { throw XDriveIOSClipboardPolicy.Failure.invalidPayload }
        return page
    }
    /// Public recipient keys are fetched through the current interactive
    /// Owner bearer only. Installation credentials are not required and
    /// must never be exposed in the SwiftUI device picker.
    func devices() async throws -> [XDriveIOSClipboardTargetDevice] {
        let sender = try XDriveIOSNativeClipboardClient(owner: owner, accessToken: token)
        let directory = try await sender.request("/api/v1/clipboard/devices",
            response: XDriveIOSClipboardTargetDirectory.self)
        guard directory.devices.count <= 100 else {
            throw XDriveIOSClipboardPolicy.Failure.invalidPayload
        }
        var ids = Set<String>()
        for device in directory.devices {
            guard UUID(uuidString: device.device_id) != nil,
                  ids.insert(device.device_id).inserted,
                  !device.name.isEmpty, device.name.count <= 128,
                  !device.platform.isEmpty, device.platform.count <= 32 else {
                throw XDriveIOSClipboardPolicy.Failure.invalidPayload
            }
        }
        return directory.devices
    }

    // No E2EE envelope or recipient key: Server enforces Owner, target grant
    // and any referenced Node's current Files permission before acceptance.
    func send(_ wire: XDriveIOSClipboardWrite) async throws -> XDriveIOSClipboardItem {
        guard UUID(uuidString: wire.client_event_id) != nil,
              (1...XDriveIOSClipboardPolicy.maxTextBytes).contains(Data(wire.content.utf8).count)
        else { throw XDriveIOSClipboardPolicy.Failure.invalidMessage }
        let media = wire.kind == "image/x-xdrive-node-ref" ||
                    wire.kind == "application/x-xdrive-node-ref"
        let text = wire.kind == "text/plain" || wire.kind == "text/uri-list"
        guard (media && (wire.node_id ?? 0) > 0 && wire.target_device_id != nil &&
               wire.content == "asset:\(wire.node_id!)") ||
              (text && wire.node_id == nil) else {
            throw XDriveIOSClipboardPolicy.Failure.invalidPayload
        }
        if let target = wire.target_device_id, UUID(uuidString: target) == nil {
            throw XDriveIOSClipboardPolicy.Failure.invalidPayload
        }
        let sender = try XDriveIOSNativeClipboardClient(owner: owner, accessToken: token)
        let value = try await sender.request("/api/v1/clipboard/items",
            method: "POST", body: JSONEncoder().encode(wire),
            response: XDriveIOSClipboardItem.self)
        guard value.client_event_id == wire.client_event_id,
              value.kind == wire.kind, value.content == wire.content,
              value.target_device_id == wire.target_device_id,
              value.node_id == wire.node_id else {
            throw XDriveIOSClipboardPolicy.Failure.invalidPayload
        }
        return value
    }
    func delete(_ id: UInt64) async throws {
        guard id > 0 else { throw XDriveIOSClipboardPolicy.Failure.invalidMessage }
        try await noContent("/api/v1/clipboard/items/\(id)")
    }
    func clear() async throws { try await noContent("/api/v1/clipboard/items") }

    private func noContent(_ path: String) async throws {
        guard path.hasPrefix("/api/v1/clipboard/items"), !path.contains("?"),
              let url = URL(string: path, relativeTo: owner.origin)?.absoluteURL else {
            throw XDriveIOSClipboardPolicy.Failure.invalidOwner
        }
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let deviceProof {
            request.setValue(deviceProof.deviceID, forHTTPHeaderField: "X-XDrive-Device-ID")
            request.setValue(deviceProof.secret, forHTTPHeaderField: "X-XDrive-Device-Token")
        }
        request.httpShouldHandleCookies = false
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        let session = URLSession(configuration: config, delegate: XDriveIOSClipboardRejectRedirects(),
                                 delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        let (_, response) = try await session.data(for: request)
        try Task.checkCancellation()
        guard (response as? HTTPURLResponse)?.statusCode == 204 else {
            throw XDriveIOSClipboardPolicy.Failure.http((response as? HTTPURLResponse)?.statusCode ?? 0)
        }
    }
}
