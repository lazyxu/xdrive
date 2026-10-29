import CryptoKit
import Foundation
import Security

/// A successfully enrolled iPhone is identity evidence only. It does NOT
/// authorize Desktop local_folder Source or PhotoKit backup execution.
struct XDriveIOSDeviceIdentity: CustomStringConvertible {
    let deviceID: String
    let ownerID: UInt64
    let serverInstanceID: String
    let rootNodeID: UInt64

    var description: String {
        "XDriveIOSDeviceIdentity(deviceID: \(deviceID), ownerID: \(ownerID), credential: [redacted])"
    }
}

enum XDriveIOSDeviceEnrollmentError: Error {
    case invalidOwnerScope
    case invalidDeviceName
    case alreadyEnrolledButUnverified
    case operationInProgress
    case invalidResponse
    case serverRejected(Int)
    case unknownEnrollment
    case keychainError(OSStatus)
    case inconsistentDevice
}

/// Credential is never exposed to WKWebView, a logging description, an
/// upload URL or the on-device photo sync ledger.
private struct XDriveIOSStoredDeviceCredential: Codable {
    let origin: String
    let serverInstanceID: String
    let ownerID: UInt64
    let rootNodeID: UInt64
    let username: String
    let deviceID: String
    let deviceToken: String

    func matches(_ owner: XDriveNativeOwnerRoot) -> Bool {
        origin == owner.origin.absoluteString &&
        serverInstanceID == owner.instanceID &&
        ownerID == owner.ownerID &&
        rootNodeID == owner.rootNodeID &&
        username == owner.username &&
        UUID(uuidString: deviceID) != nil &&
        (32...256).contains(deviceToken.utf8.count)
    }

    var identity: XDriveIOSDeviceIdentity {
        XDriveIOSDeviceIdentity(
            deviceID: deviceID, ownerID: ownerID,
            serverInstanceID: serverInstanceID, rootNodeID: rootNodeID
        )
    }
}

private struct XDriveRegisteredIOSDevice: Decodable {
    struct Device: Decodable {
        let id: String
        let name: String
        let platform: String
    }
    let device: Device
    let device_token: String
}

private struct XDriveVerifiedIOSDevice: Decodable {
    let device_id: String
}

private struct XDriveCreateIOSDeviceRequest: Encodable {
    let name: String
    let platform = "ios"
    let client_version: String
}

private final class XDriveIOSIdentityRejectRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// First native iOS Device identity bridge. The user must explicitly initiate
/// enroll(); a startup/Photos scan MUST NOT silently create devices.
actor XDriveIOSDeviceEnrollment {
    static let shared = XDriveIOSDeviceEnrollment()
    private init() {}

    private let keychainService = "com.lazyxu.xdrive.ios.device-identity.v1"
    private var busyScopes = Set<String>()

    /// Verify the *existing* enrollment using the same authenticated Owner.
    /// A revoked, unreadable, or ambiguous credential is never auto-replaced.
    func verifyExisting(owner: XDriveNativeOwnerRoot,
                        accessToken: String) async throws -> XDriveIOSDeviceIdentity? {
        let key = try scopedKey(owner)
        guard !busyScopes.contains(key) else {
            throw XDriveIOSDeviceEnrollmentError.operationInProgress
        }
        busyScopes.insert(key)
        defer { busyScopes.remove(key) }
        guard let credential = try keychainLoad(account: key) else { return nil }
        guard credential.matches(owner) else {
            throw XDriveIOSDeviceEnrollmentError.inconsistentDevice
        }
        try await verifyCurrentOwner(owner, accessToken: accessToken)
        try await verifyRemote(owner: owner, accessToken: accessToken,
                               credential: credential)
        return credential.identity
    }

    /// One explicit registration. If its POST ACK is lost, the caller MUST
    /// show "unknown" and seek user assistance, not automatically register
    /// a second device. The original response carries the only raw secret.
    func enroll(owner: XDriveNativeOwnerRoot, accessToken: String,
                displayName: String, version: String) async throws -> XDriveIOSDeviceIdentity {
        let key = try scopedKey(owner)
        guard !busyScopes.contains(key) else {
            throw XDriveIOSDeviceEnrollmentError.operationInProgress
        }
        busyScopes.insert(key)
        defer { busyScopes.remove(key) }

        let name = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.utf8.count <= 128,
              !name.unicodeScalars.contains(where: {
                  CharacterSet.controlCharacters.contains($0)
              }), version.utf8.count <= 64 else {
            throw XDriveIOSDeviceEnrollmentError.invalidDeviceName
        }
        if try keychainLoad(account: key) != nil {
            // Explicitly verify existing credentials first; never duplicate
            // a Device simply because its most recent proof failed.
            throw XDriveIOSDeviceEnrollmentError.alreadyEnrolledButUnverified
        }
        try await verifyCurrentOwner(owner, accessToken: accessToken)

        let created: XDriveRegisteredIOSDevice
        do {
            let body = try JSONEncoder().encode(
                XDriveCreateIOSDeviceRequest(name: name, client_version: version)
            )
            let (data, status) = try await request(
                origin: owner.origin, accessToken: accessToken,
                method: "POST", path: "/api/v1/devices",
                body: body
            )
            guard status == 201, data.count <= 65536,
                  let decoded = try? JSONDecoder().decode(
                    XDriveRegisteredIOSDevice.self, from: data
                  ) else {
                throw XDriveIOSDeviceEnrollmentError.invalidResponse
            }
            created = decoded
        } catch {
            if Task.isCancelled { throw CancellationError() }
            // Registration may have committed before a timeout or lost ACK.
            throw XDriveIOSDeviceEnrollmentError.unknownEnrollment
        }
        guard UUID(uuidString: created.device.id) != nil,
              created.device.platform == "ios", created.device.name == name,
              (32...256).contains(created.device_token.utf8.count) else {
            throw XDriveIOSDeviceEnrollmentError.invalidResponse
        }
        let credential = XDriveIOSStoredDeviceCredential(
            origin: owner.origin.absoluteString,
            serverInstanceID: owner.instanceID, ownerID: owner.ownerID,
            rootNodeID: owner.rootNodeID, username: owner.username,
            deviceID: created.device.id, deviceToken: created.device_token
        )
        // Save before follow-up verification. If the verification response
        // is lost, keep the secret for a later read-only GET; no re-enroll.
        try keychainSave(credential, account: key)
        try await verifyRemote(owner: owner, accessToken: accessToken,
                               credential: credential)
        return credential.identity
    }

    private func verifyCurrentOwner(_ owner: XDriveNativeOwnerRoot,
                                    accessToken: String) async throws {
        guard !accessToken.isEmpty else {
            throw XDriveIOSDeviceEnrollmentError.invalidOwnerScope
        }
        let current = try await XDriveNativeOwnerRootVerifier(
            origin: owner.origin, accessToken: accessToken,
            expectedUsername: owner.username
        ).verify()
        guard current.origin == owner.origin,
              current.instanceID == owner.instanceID,
              current.ownerID == owner.ownerID,
              current.rootNodeID == owner.rootNodeID else {
            throw XDriveIOSDeviceEnrollmentError.invalidOwnerScope
        }
    }

    private func verifyRemote(owner: XDriveNativeOwnerRoot,
                              accessToken: String,
                              credential: XDriveIOSStoredDeviceCredential) async throws {
        let (data, status) = try await request(
            origin: owner.origin, accessToken: accessToken,
            method: "GET", path: "/api/v1/devices/self",
            deviceID: credential.deviceID, deviceToken: credential.deviceToken
        )
        guard status == 200, data.count <= 65536,
              let verified = try? JSONDecoder().decode(
                XDriveVerifiedIOSDevice.self, from: data
              ), verified.device_id == credential.deviceID else {
            throw XDriveIOSDeviceEnrollmentError.inconsistentDevice
        }
    }

    private func request(origin: URL, accessToken: String, method: String,
                         path: String, body: Data? = nil,
                         deviceID: String? = nil,
                         deviceToken: String? = nil) async throws -> (Data, Int) {
        let clean = try ServerAddress.parse(origin.absoluteString)
        guard path == "/api/v1/devices" || path == "/api/v1/devices/self",
              var components = URLComponents(url: clean, resolvingAgainstBaseURL: false)
        else { throw XDriveIOSDeviceEnrollmentError.invalidOwnerScope }
        components.path = path
        guard let url = components.url else {
            throw XDriveIOSDeviceEnrollmentError.invalidOwnerScope
        }
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 20
        let session = URLSession(
            configuration: config,
            delegate: XDriveIOSIdentityRejectRedirects(),
            delegateQueue: nil
        )
        defer { session.invalidateAndCancel() }

        var req = URLRequest(url: url)
        req.httpMethod = method
        req.httpShouldHandleCookies = false
        req.timeoutInterval = 20
        req.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        if let body {
            req.httpBody = body
            req.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        }
        if let deviceID { req.setValue(deviceID, forHTTPHeaderField: "X-XDrive-Device-ID") }
        if let deviceToken { req.setValue(deviceToken, forHTTPHeaderField: "X-XDrive-Device-Token") }

        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else {
            throw XDriveIOSDeviceEnrollmentError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw XDriveIOSDeviceEnrollmentError.serverRejected(http.statusCode)
        }
        guard data.count <= 65536 else {
            throw XDriveIOSDeviceEnrollmentError.invalidResponse
        }
        return (data, http.statusCode)
    }

    private func scopedKey(_ owner: XDriveNativeOwnerRoot) throws -> String {
        let canonical = try ServerAddress.parse(owner.origin.absoluteString)
        guard canonical == owner.origin,
              !owner.instanceID.isEmpty, owner.ownerID > 0,
              owner.rootNodeID > 0, !owner.username.isEmpty else {
            throw XDriveIOSDeviceEnrollmentError.invalidOwnerScope
        }
        let source = "\(canonical.absoluteString)\n\(owner.instanceID)\n\(owner.ownerID)\n\(owner.rootNodeID)"
        let hash = SHA256.hash(data: Data(source.utf8))
        return "ios-" + hash.map { String(format: "%02x", $0) }.joined()
    }

    private func keychainLoad(account: String) throws -> XDriveIOSStoredDeviceCredential? {
        var query = keychainBase(account: account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else {
            throw XDriveIOSDeviceEnrollmentError.keychainError(status)
        }
        guard let data = result as? Data,
              let credential = try? JSONDecoder().decode(
                XDriveIOSStoredDeviceCredential.self, from: data
              ) else {
            throw XDriveIOSDeviceEnrollmentError.inconsistentDevice
        }
        return credential
    }

    private func keychainSave(_ credential: XDriveIOSStoredDeviceCredential,
                              account: String) throws {
        let data = try JSONEncoder().encode(credential)
        var request = keychainBase(account: account)
        request[kSecValueData as String] = data
        request[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let status = SecItemAdd(request as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw XDriveIOSDeviceEnrollmentError.keychainError(status)
        }
    }

    private func keychainBase(account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: account
        ]
    }
}
