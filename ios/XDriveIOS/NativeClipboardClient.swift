import CommonCrypto
import CryptoKit
import Foundation

// Same Web/PWA AES-GCM v1 wire contract: 310k PBKDF2/HMAC-SHA256,
// 256-bit AES, 96-bit nonce, ciphertext||16-byte tag and exact UTF-8 AAD.
enum XDriveIOSClipboardCrypto {
    static let checkEventID = "00000000-0000-4000-8000-000000000001"
    static let checkText = "xDrive Clipboard Vault v1"
    static let maxTextBytes = 65_536

    enum Failure: LocalizedError {
        case invalidKey, invalidMessage, invalidCiphertext, invalidOwner, wrongPassword, http(Int)
        var errorDescription: String? {
            switch self {
            case .invalidKey: return "剪贴板口令或加密参数无效。"
            case .invalidMessage: return "剪贴板文本必须在 1–65536 字节之间。"
            case .invalidCiphertext: return "剪贴板密文格式或验证失败。"
            case .invalidOwner: return "当前账号或服务器已变化，请重新登录。"
            case .wrongPassword: return "剪贴板口令不正确，或加密数据已损坏。"
            case .http(let code): return "剪贴板服务器请求失败（HTTP \(code)）。"
            }
        }
    }

    struct Encrypted: Encodable {
        let client_event_id: String
        let kind: String
        let nonce: String
        let ciphertext: String
    }

    static func key(_ password: String, salt: String) throws -> SymmetricKey {
        guard password.utf16.count >= 12 && password.utf16.count <= 256,
              let saltBytes = Data(base64Encoded: salt),
              saltBytes.count == 16 else { throw Failure.invalidKey }
        var output = [UInt8](repeating: 0, count: 32)
        // Read this before withUnsafeMutableBufferPointer to satisfy Swift's
        // exclusive access rules and keep CommonCrypto's 256-bit output fixed.
        let derivedCount = output.count
        let utf8 = Array(password.utf8CString)
        let status = utf8.withUnsafeBufferPointer { pass in
            saltBytes.withUnsafeBytes { rawSalt in
                output.withUnsafeMutableBufferPointer { derived in
                    CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2),
                        pass.baseAddress, utf8.count - 1,
                        rawSalt.bindMemory(to: UInt8.self).baseAddress, saltBytes.count,
                        CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), 310_000,
                        derived.baseAddress, derivedCount)
                }
            }
        }
        guard status == kCCSuccess else { throw Failure.invalidKey }
        return SymmetricKey(data: Data(output))
    }

    static func kind(_ text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.range(of: #"^https?://\S+$"#, options: .regularExpression) != nil
            ? "text/uri-list" : "text/plain"
    }
    private static func aad(_ scope: String, _ eventID: String, _ kind: String) -> Data {
        Data("xdrive-clipboard-v1|\(scope)|\(eventID)|\(kind)".utf8)
    }
    static func encrypt(_ text: String, key: SymmetricKey, scope: String,
                        eventID: String = UUID().uuidString.lowercased()) throws -> Encrypted {
        let plain = Data(text.utf8)
        guard !plain.isEmpty && plain.count <= maxTextBytes,
              UUID(uuidString: eventID) != nil else { throw Failure.invalidMessage }
        let mediaKind = kind(text)
        let nonce = AES.GCM.Nonce()
        let box = try AES.GCM.seal(plain, using: key, nonce: nonce,
                               authenticating: aad(scope, eventID, mediaKind))
        return Encrypted(client_event_id: eventID, kind: mediaKind,
                         nonce: Data(nonce).base64EncodedString(),
                         ciphertext: (box.ciphertext + box.tag).base64EncodedString())
    }
    static func decrypt(_ wire: Encrypted, key: SymmetricKey, scope: String) throws -> String {
        guard UUID(uuidString: wire.client_event_id) != nil,
              wire.kind == "text/plain" || wire.kind == "text/uri-list",
              let iv = Data(base64Encoded: wire.nonce), iv.count == 12,
              let encrypted = Data(base64Encoded: wire.ciphertext),
              encrypted.count >= 17 && encrypted.count <= maxTextBytes + 16
        else { throw Failure.invalidCiphertext }
        let nonce = try AES.GCM.Nonce(data: iv)
        let tag = encrypted.suffix(16)
        let body = encrypted.dropLast(16)
        let box = try AES.GCM.SealedBox(nonce: nonce, ciphertext: body, tag: tag)
        let plain = try AES.GCM.open(box, using: key,
                                     authenticating: aad(scope, wire.client_event_id, wire.kind))
        guard !plain.isEmpty && plain.count <= maxTextBytes,
              let text = String(data: plain, encoding: .utf8) else {
            throw Failure.invalidCiphertext
        }
        return text
    }
    static func check(key: SymmetricKey, scope: String) throws -> Encrypted {
        try encrypt(checkText, key: key, scope: scope, eventID: checkEventID)
    }
    static func verify(key: SymmetricKey, scope: String,
                       nonce: String, ciphertext: String) throws {
        let check = Encrypted(client_event_id: checkEventID,
                              kind: "text/plain", nonce: nonce, ciphertext: ciphertext)
        guard (try? decrypt(check, key: key, scope: scope)) == checkText else {
            throw Failure.wrongPassword
        }
    }
}

struct XDriveIOSClipboardVault: Decodable {
    let owner_id: UInt64
    let salt: String
    let kdf: String
    let iterations: Int
    let check_nonce: String
    let check_ciphertext: String
    let aad_scope: String
}
struct XDriveIOSClipboardItem: Codable, Identifiable {
    let id: UInt64
    let client_event_id: String
    let kind: String
    let nonce: String
    let ciphertext: String
    let created_at: String
    let expires_at: String
    let target_device_id: String?
    let ephemeral_key: String?
    let wrapped_key: String?
    let node_id: UInt64?
    var encrypted: XDriveIOSClipboardCrypto.Encrypted {
        .init(client_event_id: client_event_id, kind: kind, nonce: nonce, ciphertext: ciphertext)
    }
}
struct XDriveIOSClipboardPage: Decodable {
    let items: [XDriveIOSClipboardItem]
    let next_before: UInt64?
}

struct XDriveIOSClipboardTargetDevice: Decodable, Identifiable {
    let device_id: String
    let name: String
    let platform: String
    let public_key: String
    var id: String { device_id }
}

private struct XDriveIOSClipboardTargetDirectory: Decodable {
    let devices: [XDriveIOSClipboardTargetDevice]
}

struct XDriveIOSClipboardDirectedWrite: Encodable {
    let client_event_id: String
    let kind: String
    let target_device_id: String
    let ephemeral_key: String
    let wrapped_key: String
    let nonce: String
    let ciphertext: String
    let node_id: UInt64?
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
/// clipboard passphrase/derived key are never written into Keychain or local files.
struct XDriveIOSNativeClipboardClient {
    let owner: XDriveNativeOwnerRoot
    let token: String
    let deviceProof: XDriveIOSBackgroundDeviceProof?
    init(owner: XDriveNativeOwnerRoot, accessToken: String,
         deviceProof: XDriveIOSBackgroundDeviceProof? = nil) throws {
        guard owner.ownerID > 0, owner.origin.scheme == "https",
              !accessToken.isEmpty else { throw XDriveIOSClipboardCrypto.Failure.invalidOwner }
        self.owner = owner
        token = accessToken
        self.deviceProof = deviceProof
    }

    var newVaultScope: String { 
        let components = URLComponents(url: owner.origin, resolvingAgainstBaseURL: false)
        let host = components?.host ?? ""
        let port = components?.port.map { ":\($0)" } ?? ""
        return "https://\(host)\(port):\(owner.ownerID)"
    }

    private func request<T: Decodable>(
        _ path: String, method: String = "GET", body: Data? = nil,
        before: UInt64? = nil, response: T.Type
    ) async throws -> T {
        guard path.hasPrefix("/api/v1/clipboard/"), !path.contains(".."),
              !path.contains("?"), !path.contains("#"),
              var url = URLComponents(url: owner.origin, resolvingAgainstBaseURL: false) else {
            throw XDriveIOSClipboardCrypto.Failure.invalidOwner
        }
        url.path = path
        if let before { url.queryItems = [URLQueryItem(name: "before", value: String(before))] }
        guard let endpoint = url.url, endpoint.host == owner.origin.host else {
            throw XDriveIOSClipboardCrypto.Failure.invalidOwner
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
            guard body.count < 130_000 else { throw XDriveIOSClipboardCrypto.Failure.invalidMessage }
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
            throw XDriveIOSClipboardCrypto.Failure.http((result as? HTTPURLResponse)?.statusCode ?? 0)
        }
        return try JSONDecoder().decode(response, from: data)
    }
    /// Foreground Owner invalidation stream. Never transports Clipboard
    /// content: each complete sync/change frame only triggers GET /items.
    /// A stream is bounded server-side to 20s; callers reverify the Owner
    /// bearer and run an authoritative GET on every reconnect.
    func watchChanges(after: UInt64, onChange: () async -> Void) async throws -> UInt64 {
        guard var url = URLComponents(url: owner.origin, resolvingAgainstBaseURL: false) else {
            throw XDriveIOSClipboardCrypto.Failure.invalidOwner
        }
        url.path = "/api/v1/clipboard/events"
        url.queryItems = [URLQueryItem(name: "after", value: String(after))]
        guard let endpoint = url.url, endpoint.host == owner.origin.host,
              endpoint.scheme == "https" else {
            throw XDriveIOSClipboardCrypto.Failure.invalidOwner
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
            throw XDriveIOSClipboardCrypto.Failure.http(
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

    func enrollClipboardDevice(publicKey: String) async throws {
        guard deviceProof != nil, Data(base64Encoded: publicKey)?.count == 32 else {
            throw XDriveIOSClipboardCrypto.Failure.invalidOwner
        }
        struct Body: Encodable { let public_key: String }
        struct Receipt: Decodable { let device_id: String; let public_key: String }
        let result = try await request("/api/v1/clipboard/devices/self",
            method: "PUT", body: JSONEncoder().encode(Body(public_key: publicKey)),
            response: Receipt.self)
        guard result.device_id == deviceProof?.deviceID, result.public_key == publicKey else {
            throw XDriveIOSClipboardCrypto.Failure.invalidOwner
        }
    }

    func vault() async throws -> XDriveIOSClipboardVault {
        let v = try await request("/api/v1/clipboard/vault", response: XDriveIOSClipboardVault.self)
        guard v.owner_id == owner.ownerID, v.kdf == "PBKDF2-SHA256",
              v.iterations == 310000, Data(base64Encoded: v.salt)?.count == 16 else {
            throw XDriveIOSClipboardCrypto.Failure.invalidOwner
        }
        return v
    }
    func check(_ value: XDriveIOSClipboardCrypto.Encrypted, scope: String) async throws -> XDriveIOSClipboardVault {
        struct Body: Encodable { let nonce: String; let ciphertext: String; let scope: String }
        let bytes = try JSONEncoder().encode(Body(nonce: value.nonce, ciphertext: value.ciphertext, scope: scope))
        let result = try await request("/api/v1/clipboard/vault/check", method: "PUT",
                                       body: bytes, response: XDriveIOSClipboardVault.self)
        guard result.owner_id == owner.ownerID else {
            throw XDriveIOSClipboardCrypto.Failure.invalidOwner
        }
        return result
    }
    func list(before: UInt64? = nil) async throws -> XDriveIOSClipboardPage {
        let page = try await request("/api/v1/clipboard/items", before: before,
                                     response: XDriveIOSClipboardPage.self)
        guard page.items.count <= 50 else { throw XDriveIOSClipboardCrypto.Failure.invalidCiphertext }
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
            throw XDriveIOSClipboardCrypto.Failure.invalidCiphertext
        }
        var ids = Set<String>()
        for device in directory.devices {
            guard UUID(uuidString: device.device_id) != nil,
                  ids.insert(device.device_id).inserted,
                  !device.name.isEmpty, device.name.count <= 128,
                  !device.platform.isEmpty, device.platform.count <= 32,
                  let publicBytes = Data(base64Encoded: device.public_key),
                  publicBytes.count == 32, publicBytes.contains(where: { $0 != 0 }) else {
                throw XDriveIOSClipboardCrypto.Failure.invalidCiphertext
            }
        }
        return directory.devices
    }

    func sendDirected(_ wire: XDriveIOSClipboardDirectedWrite) async throws
        -> XDriveIOSClipboardItem {
        guard UUID(uuidString: wire.client_event_id) != nil,
              UUID(uuidString: wire.target_device_id) != nil,
              let ephemeral = Data(base64Encoded: wire.ephemeral_key), ephemeral.count == 32,
              let wrapped = Data(base64Encoded: wire.wrapped_key), wrapped.count == 60,
              let iv = Data(base64Encoded: wire.nonce), iv.count == 12,
              let encrypted = Data(base64Encoded: wire.ciphertext),
              (17...65_552).contains(encrypted.count) else {
            throw XDriveIOSClipboardCrypto.Failure.invalidCiphertext
        }
        let media = wire.kind == "image/x-xdrive-node-ref" ||
                    wire.kind == "application/x-xdrive-node-ref"
        guard (media && (wire.node_id ?? 0) > 0) ||
              (!media && wire.node_id == nil &&
               (wire.kind == "text/plain" || wire.kind == "text/uri-list")) else {
            throw XDriveIOSClipboardCrypto.Failure.invalidCiphertext
        }
        // The receiver's installation header must not be reused as a
        // sender grant; only the Owner bearer and selected public key go out.
        let sender = try XDriveIOSNativeClipboardClient(owner: owner, accessToken: token)
        let value = try await sender.request("/api/v1/clipboard/items",
            method: "POST", body: JSONEncoder().encode(wire),
            response: XDriveIOSClipboardItem.self)
        guard value.client_event_id == wire.client_event_id,
              value.target_device_id == wire.target_device_id,
              value.ephemeral_key == wire.ephemeral_key,
              value.wrapped_key == wire.wrapped_key,
              value.nonce == wire.nonce,
              value.ciphertext == wire.ciphertext,
              value.kind == wire.kind, value.node_id == wire.node_id else {
            throw XDriveIOSClipboardCrypto.Failure.invalidCiphertext
        }
        return value
    }

    func send(_ wire: XDriveIOSClipboardCrypto.Encrypted) async throws -> XDriveIOSClipboardItem {
        let bytes = try JSONEncoder().encode(wire)
        let received = try await request("/api/v1/clipboard/items", method: "POST",
                                         body: bytes, response: XDriveIOSClipboardItem.self)
        guard received.client_event_id == wire.client_event_id &&
              received.ciphertext == wire.ciphertext && received.nonce == wire.nonce &&
              received.kind == wire.kind else { throw XDriveIOSClipboardCrypto.Failure.invalidCiphertext }
        return received
    }
    func delete(_ id: UInt64) async throws {
        guard id > 0 else { throw XDriveIOSClipboardCrypto.Failure.invalidMessage }
        try await noContent("/api/v1/clipboard/items/\(id)")
    }
    func clear() async throws { try await noContent("/api/v1/clipboard/items") }

    private func noContent(_ path: String) async throws {
        guard path.hasPrefix("/api/v1/clipboard/items"), !path.contains("?"),
              let url = URL(string: path, relativeTo: owner.origin)?.absoluteURL else {
            throw XDriveIOSClipboardCrypto.Failure.invalidOwner
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
            throw XDriveIOSClipboardCrypto.Failure.http((response as? HTTPURLResponse)?.statusCode ?? 0)
        }
    }
}
