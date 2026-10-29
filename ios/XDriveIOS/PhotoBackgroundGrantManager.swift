import CryptoKit
import Foundation
import Security

/// Safe public metadata only; the raw grant and independent Device token
/// remain private native Keychain values, never WKWebView responses.
struct XDriveIOSPhotoBackgroundGrantStatus {
    let enrolled: Bool
    let enabled: Bool
    let revokePending: Bool
    let expiresAt: Date?
}

enum XDriveIOSPhotoBackgroundGrantError: Error {
    case invalidOwner
    case missingDeviceIdentity
    case invalidGrantResponse
    case serverRejected(Int)
    case unavailableKeychain(OSStatus)
    case corruptKeychain
    case remoteRevokePending
}

private struct IOSPhotoGrantResponse: Decodable {
    let id: String
    let device_id: String
    let root_node_id: UInt64
    let grant_secret: String
    let expires_at: String
}

private struct IOSPhotoGrantProof: Decodable {
    let grant_id: String
    let owner_id: UInt64
    let device_id: String
    let root_node_id: UInt64
    let server_instance_id: String
    let expires_at: String
    let upload_authorized: Bool
}

private struct IOSPhotoNativeGrant: Codable {
    let origin: String
    let serverInstance: String
    let ownerID: UInt64
    let rootNodeID: UInt64
    let username: String
    let deviceID: String
    let grantID: String
    let rawSecret: String
    let expiresAt: Date
    var revokePending: Bool

    func matches(_ owner: XDriveNativeOwnerRoot) -> Bool {
        origin == owner.origin.absoluteString &&
        serverInstance == owner.instanceID &&
        ownerID == owner.ownerID && rootNodeID == owner.rootNodeID &&
        username == owner.username &&
        UUID(uuidString: deviceID) != nil &&
        UUID(uuidString: grantID) != nil &&
        XDriveIOSPhotoBackgroundGrantManager.validSecret(rawSecret)
    }
}

private struct IOSPhotoGrantRequest: Encodable {
    let device_id: String
}

private final class XDriveIOSPhotoGrantRejectRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// Separate native-only grant lifecycle; this DOES NOT run the background
/// photo uploader. Server Root/Device admission is independently checked
/// before issuance; Keychain secrets are never returned to the shared UI.
///
/// On iOS 16+ a WhenUnlockedThisDeviceOnly grant is NOT available for BG
/// processing while locked; deliberately fail closed until both grant and
/// device identity migrate to an explicitly approved, restricted policy.
actor XDriveIOSPhotoBackgroundGrantManager {
    static let shared = XDriveIOSPhotoBackgroundGrantManager()
    private init() {}

    private let service = "com.lazyxu.xdrive.ios.photos.background.grant.v1"

    static func validSecret(_ value: String) -> Bool {
        XDriveIOSPhotoBackgroundGrantPolicy.validOpaqueSecret(value)
    }

    /// UI may display only this status; never expose raw Keychain bytes.
    func localStatus(owner: XDriveNativeOwnerRoot) throws
        -> XDriveIOSPhotoBackgroundGrantStatus {
        let stored = try read(owner: owner)
        return XDriveIOSPhotoBackgroundGrantStatus(
            enrolled: stored != nil,
            enabled: stored != nil && !stored!.revokePending &&
                stored!.expiresAt > Date(),
            revokePending: stored?.revokePending ?? false,
            expiresAt: stored?.expiresAt
        )
    }

    /// Must be called only after an explicit UIKit confirmation of native
    /// iPhone Device registration AND background grant issuance.
    func enableAfterNativeConfirmation(
        owner: XDriveNativeOwnerRoot, accessToken: String,
        deviceName: String = "xDrive iPhone", clientVersion: String = "ios-bg-v1"
    ) async throws -> XDriveIOSPhotoBackgroundGrantStatus {
        try await verifyOwner(owner, accessToken: accessToken)
        let enrollment = XDriveIOSDeviceEnrollment.shared
        let existing = try await enrollment.verifyExisting(
            owner: owner, accessToken: accessToken
        )
        if existing == nil {
            _ = try await enrollment.enroll(
                owner: owner, accessToken: accessToken,
                displayName: deviceName, version: clientVersion
            )
        }
        guard let proof = try await enrollment.backgroundPhotoDeviceProof(
            owner: owner, accessToken: accessToken
        ) else {
            throw XDriveIOSPhotoBackgroundGrantError.missingDeviceIdentity
        }
        let body = try JSONEncoder().encode(
            IOSPhotoGrantRequest(device_id: proof.deviceID)
        )
        let (bytes, status) = try await request(
            owner: owner, method: "POST",
            path: "/api/v1/ios/photos/background-grants",
            accessToken: accessToken, device: proof, body: body
        )
        guard status == 201, bytes.count <= 4096,
              let response = try? JSONDecoder().decode(
                IOSPhotoGrantResponse.self, from: bytes
              ) else {
            throw XDriveIOSPhotoBackgroundGrantError.invalidGrantResponse
        }
        let credential = try checkedResponse(
            response, owner: owner, deviceID: proof.deviceID
        )
        // Save the new secret before reporting anything as enabled.
        // If this fails, the Owner can still revoke the grant by its ID in
        // the Server Devices/Grants UI without relying on this device.
        try save(credential, owner: owner)
        return try localStatus(owner: owner)
    }

    /// The old PWA login token is used only to re-verify scope. The native
    /// grant and Device credential travel separately in an ephemeral HTTPS
    /// request which explicitly refuses redirects.
    func verifyRemote(owner: XDriveNativeOwnerRoot, accessToken: String)
        async throws -> XDriveIOSPhotoBackgroundGrantStatus {
        try await verifyOwner(owner, accessToken: accessToken)
        guard let grant = try read(owner: owner) else {
            return try localStatus(owner: owner)
        }
        guard !grant.revokePending, grant.expiresAt > Date(),
              let device = try await XDriveIOSDeviceEnrollment.shared
                .backgroundPhotoDeviceProof(owner: owner, accessToken: accessToken),
              device.deviceID == grant.deviceID else {
            throw XDriveIOSPhotoBackgroundGrantError.invalidOwner
        }
        let (bytes, status) = try await request(
            owner: owner, method: "GET",
            path: "/api/v1/ios/photos/background-grants/proof",
            device: device, rawGrant: grant.rawSecret
        )
        guard status == 200, bytes.count <= 4096,
              let proof = try? JSONDecoder().decode(
                IOSPhotoGrantProof.self, from: bytes
              ),
              proof.grant_id == grant.grantID,
              proof.owner_id == owner.ownerID,
              proof.root_node_id == owner.rootNodeID,
              proof.server_instance_id == owner.instanceID,
              proof.device_id == grant.deviceID,
              proof.upload_authorized else {
            throw XDriveIOSPhotoBackgroundGrantError.invalidGrantResponse
        }
        return try localStatus(owner: owner)
    }

    /// Disable immediately in the local persisted state before contacting
    /// Server. On a network failure retain a *revocation-pending* record:
    /// the future background Runner must refuse it and UI can retry.
    func disable(owner: XDriveNativeOwnerRoot, accessToken: String) async throws
        -> XDriveIOSPhotoBackgroundGrantStatus {
        guard var grant = try read(owner: owner) else {
            return try localStatus(owner: owner)
        }
        // Local disable always succeeds first, even with no Server/network
        // session. A later Owner-authenticated attempt can revoke remotely.
        grant.revokePending = true
        try save(grant, owner: owner)
        XDriveIOSBackgroundPhotoTask.revokePendingRequests()
        try await verifyOwner(owner, accessToken: accessToken)
        guard let id = UUID(uuidString: grant.grantID) else {
            throw XDriveIOSPhotoBackgroundGrantError.corruptKeychain
        }
        let (_, status) = try await request(
            owner: owner, method: "POST",
            path: "/api/v1/ios/photos/background-grants/\(id.uuidString.lowercased())/revoke",
            accessToken: accessToken
        )
        guard status == 200 else {
            throw XDriveIOSPhotoBackgroundGrantError.remoteRevokePending
        }
        try delete(owner: owner)
        return try localStatus(owner: owner)
    }

    private func checkedResponse(_ response: IOSPhotoGrantResponse,
                                 owner: XDriveNativeOwnerRoot,
                                 deviceID: String) throws -> IOSPhotoNativeGrant {
        guard UUID(uuidString: response.id) != nil,
              response.device_id == deviceID,
              response.root_node_id == owner.rootNodeID,
              Self.validSecret(response.grant_secret),
              let expires = Self.parseDate(response.expires_at),
              XDriveIOSPhotoBackgroundGrantPolicy.validExpiration(
                expires, now: Date()
              ) else {
            throw XDriveIOSPhotoBackgroundGrantError.invalidGrantResponse
        }
        return IOSPhotoNativeGrant(
            origin: owner.origin.absoluteString,
            serverInstance: owner.instanceID,
            ownerID: owner.ownerID, rootNodeID: owner.rootNodeID,
            username: owner.username, deviceID: deviceID,
            grantID: response.id, rawSecret: response.grant_secret,
            expiresAt: expires, revokePending: false
        )
    }

    private static func parseDate(_ value: String) -> Date? {
        let full = ISO8601DateFormatter()
        full.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = full.date(from: value) { return d }
        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]
        return standard.date(from: value)
    }

    private func verifyOwner(_ owner: XDriveNativeOwnerRoot,
                             accessToken: String) async throws {
        guard !accessToken.isEmpty else {
            throw XDriveIOSPhotoBackgroundGrantError.invalidOwner
        }
        let current = try await XDriveNativeOwnerRootVerifier(
            origin: owner.origin, accessToken: accessToken,
            expectedUsername: owner.username
        ).verify()
        guard current == owner else {
            throw XDriveIOSPhotoBackgroundGrantError.invalidOwner
        }
    }

    private func request(
        owner: XDriveNativeOwnerRoot, method: String, path: String,
        accessToken: String? = nil,
        device: XDriveIOSBackgroundDeviceProof? = nil,
        rawGrant: String? = nil,
        body: Data? = nil
    ) async throws -> (Data, Int) {
        guard method == "GET" || method == "POST",
              path.hasPrefix("/api/v1/ios/photos/background-grants"),
              (accessToken == nil || !accessToken!.isEmpty),
              (rawGrant == nil || Self.validSecret(rawGrant!)),
              let origin = try? ServerAddress.parse(owner.origin.absoluteString),
              origin == owner.origin,
              var components = URLComponents(
                url: origin, resolvingAgainstBaseURL: false
              ) else {
            throw XDriveIOSPhotoBackgroundGrantError.invalidOwner
        }
        components.path = path
        components.query = nil
        components.fragment = nil
        guard let url = components.url else {
            throw XDriveIOSPhotoBackgroundGrantError.invalidOwner
        }
        let cfg = URLSessionConfiguration.ephemeral
        cfg.httpShouldSetCookies = false
        cfg.httpCookieAcceptPolicy = .never
        cfg.urlCache = nil
        cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
        cfg.timeoutIntervalForRequest = 20
        let session = URLSession(
            configuration: cfg,
            delegate: XDriveIOSPhotoGrantRejectRedirects(),
            delegateQueue: nil
        )
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpShouldHandleCookies = false
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        if let accessToken {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }
        if let device {
            request.setValue(device.deviceID, forHTTPHeaderField: "X-XDrive-Device-ID")
            request.setValue(device.secret, forHTTPHeaderField: "X-XDrive-Device-Token")
        }
        if let rawGrant {
            request.setValue(rawGrant, forHTTPHeaderField: "X-XDrive-IOS-Photo-Grant")
        }
        if let body {
            request.httpBody = body
            request.setValue("application/json; charset=utf-8",
                             forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, data.count <= 4096 else {
            throw XDriveIOSPhotoBackgroundGrantError.invalidGrantResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw XDriveIOSPhotoBackgroundGrantError.serverRejected(http.statusCode)
        }
        return (data, http.statusCode)
    }

    private func account(owner: XDriveNativeOwnerRoot) throws -> String {
        let origin = try ServerAddress.parse(owner.origin.absoluteString)
        guard origin == owner.origin, !owner.instanceID.isEmpty,
              owner.ownerID > 0, owner.rootNodeID > 0 else {
            throw XDriveIOSPhotoBackgroundGrantError.invalidOwner
        }
        let scope = origin.absoluteString + "\n" + owner.instanceID +
            "\n" + String(owner.ownerID) + "\n" + String(owner.rootNodeID)
        return SHA256.hash(data: Data(scope.utf8))
            .map { String(format: "%02x", $0) }.joined()
    }

    private func keychainQuery(owner: XDriveNativeOwnerRoot) throws -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: try account(owner: owner)
        ]
    }

    private func read(owner: XDriveNativeOwnerRoot) throws -> IOSPhotoNativeGrant? {
        var query = try keychainQuery(owner: owner)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var found: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &found)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else {
            throw XDriveIOSPhotoBackgroundGrantError.unavailableKeychain(status)
        }
        guard let bytes = found as? Data,
              let value = try? JSONDecoder().decode(
                IOSPhotoNativeGrant.self, from: bytes
              ), value.matches(owner) else {
            throw XDriveIOSPhotoBackgroundGrantError.corruptKeychain
        }
        return value
    }

    private func save(_ value: IOSPhotoNativeGrant,
                      owner: XDriveNativeOwnerRoot) throws {
        guard value.matches(owner) else {
            throw XDriveIOSPhotoBackgroundGrantError.invalidOwner
        }
        let bytes = try JSONEncoder().encode(value)
        var query = try keychainQuery(owner: owner)
        var insert = query
        insert[kSecValueData as String] = bytes
        insert[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let status = SecItemAdd(insert as CFDictionary, nil)
        if status == errSecSuccess { return }
        if status != errSecDuplicateItem {
            throw XDriveIOSPhotoBackgroundGrantError.unavailableKeychain(status)
        }
        let change: [String: Any] = [kSecValueData as String: bytes]
        let update = SecItemUpdate(query as CFDictionary, change as CFDictionary)
        guard update == errSecSuccess else {
            throw XDriveIOSPhotoBackgroundGrantError.unavailableKeychain(update)
        }
    }

    private func delete(owner: XDriveNativeOwnerRoot) throws {
        let status = SecItemDelete(try keychainQuery(owner: owner) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw XDriveIOSPhotoBackgroundGrantError.unavailableKeychain(status)
        }
    }
}
