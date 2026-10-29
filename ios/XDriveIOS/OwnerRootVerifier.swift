import Foundation

/// Server-proven identity of the currently authenticated Owner and root.
/// No local identifier, credential, or user-entered name is an Owner ID.
struct XDriveNativeOwnerRoot: Equatable {
    let origin: URL
    let instanceID: String
    let ownerID: UInt64
    let username: String
    let rootNodeID: UInt64
    let rootRevision: UInt64
}

enum XDriveNativeOwnerRootFailure: Error {
    case invalidSession
    case missingServerIdentity
    case ownerChanged
    case invalidServerReply
    case serverStatus(Int)
}

/// Read-only Owner identity probe using the same authenticated xDrive
/// /me and /nodes/root routes as PWA and Android. The native access token
/// exists only in memory and is never passed into WKWebView or persisted.
struct XDriveNativeOwnerRootVerifier {
    let origin: URL
    let accessToken: String
    let expectedUsername: String

    func verify() async throws -> XDriveNativeOwnerRoot {
        let cleanOrigin = try ServerAddress.parse(origin.absoluteString)
        guard !accessToken.isEmpty, !expectedUsername.isEmpty else {
            throw XDriveNativeOwnerRootFailure.invalidSession
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 20
        let session = URLSession(
            configuration: configuration,
            delegate: XDriveNativeOwnerRejectRedirects(),
            delegateQueue: nil
        )
        defer { session.invalidateAndCancel() }

        let me: NativeOwnerIdentityDTO = try await get(
            "/api/v1/me", origin: cleanOrigin, session: session
        )
        guard me.id > 0, me.username == expectedUsername,
              me.role == "user" || me.role == "admin",
              me.must_change_password == false else {
            throw XDriveNativeOwnerRootFailure.ownerChanged
        }
        // This is the Server-issued PostgreSQL installation ID, NOT
        // a host-name or IP heuristic. Older Servers omit the field;
        // no durable native photo sync scope is safe in that case.
        guard let instanceID = me.pwa_offline_instance_id,
              !instanceID.isEmpty, instanceID.utf8.count <= 256,
              !instanceID.unicodeScalars.contains(where: {
                  CharacterSet.controlCharacters.contains($0)
              }) else {
            throw XDriveNativeOwnerRootFailure.missingServerIdentity
        }
        try Task.checkCancellation()
        let root: NativeOwnerRootDTO = try await get(
            "/api/v1/nodes/root", origin: cleanOrigin, session: session
        )
        guard root.id > 0, root.type == "dir",
              root.parent_id == nil, root.revision > 0 else {
            throw XDriveNativeOwnerRootFailure.invalidServerReply
        }
        return XDriveNativeOwnerRoot(
            origin: cleanOrigin,
            instanceID: instanceID,
            ownerID: me.id,
            username: me.username,
            rootNodeID: root.id,
            rootRevision: root.revision
        )
    }

    private func get<T: Decodable>(
        _ path: String, origin: URL, session: URLSession
    ) async throws -> T {
        guard var parts = URLComponents(url: origin, resolvingAgainstBaseURL: false),
              path.hasPrefix("/api/v1/") else {
            throw XDriveNativeOwnerRootFailure.invalidSession
        }
        parts.path = path
        guard let url = parts.url else { throw XDriveNativeOwnerRootFailure.invalidSession }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 20
        request.httpShouldHandleCookies = false
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw XDriveNativeOwnerRootFailure.invalidServerReply
        }
        guard (200..<300).contains(http.statusCode) else {
            throw XDriveNativeOwnerRootFailure.serverStatus(http.statusCode)
        }
        guard data.count <= 65536,
              let value = try? JSONDecoder().decode(T.self, from: data) else {
            throw XDriveNativeOwnerRootFailure.invalidServerReply
        }
        return value
    }
}

private struct NativeOwnerIdentityDTO: Decodable {
    let id: UInt64
    let username: String
    let role: String
    let must_change_password: Bool
    let pwa_offline_instance_id: String?
}

private struct NativeOwnerRootDTO: Decodable {
    let id: UInt64
    let parent_id: UInt64?
    let type: String
    let revision: UInt64
}

private final class XDriveNativeOwnerRejectRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}
