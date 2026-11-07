import CryptoKit
import Foundation

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
    var encrypted: XDriveIOSClipboardCrypto.Encrypted {
        .init(client_event_id: client_event_id, kind: kind, nonce: nonce, ciphertext: ciphertext)
    }
}
struct XDriveIOSClipboardPage: Decodable {
    let items: [XDriveIOSClipboardItem]
    let next_before: UInt64?
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
    init(owner: XDriveNativeOwnerRoot, accessToken: String) throws {
        guard owner.ownerID > 0, owner.origin.scheme == "https",
              !accessToken.isEmpty else { throw XDriveIOSClipboardCrypto.Failure.invalidOwner }
        self.owner = owner
        token = accessToken
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
