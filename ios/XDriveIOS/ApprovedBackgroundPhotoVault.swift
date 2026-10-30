import BackgroundTasks
import Foundation
import Security

/// The only long-lived, background-readable native credential. Written ONLY
/// after an explicit UIKit Owner+Root consent and real Server grant proof.
/// It never travels into a WKWebView, a URL query or UserDefaults.
///
/// AfterFirstUnlockThisDeviceOnly allows an OS BGProcessingTask to read this
/// record while the screen is locked *after the first unlock after reboot*.
/// It is not synchronised or migrated to another iPhone.
struct XDriveIOSApprovedPhotoBGCredential: Codable, CustomStringConvertible {
    let origin: String
    let instanceID: String
    let ownerID: UInt64
    let rootNodeID: UInt64
    let rootRevision: UInt64
    let username: String
    let deviceID: String
    let deviceToken: String
    let grantID: String
    let grantSecret: String
    let expiresAt: Date
    let approvedAt: Date
    let intervalMinutes: Int

    var description: String {
        "XDriveIOSApprovedPhotoBGCredential(owner: \(ownerID), " +
        "device: [redacted], grant: [redacted])"
    }

    func matches(_ owner: XDriveNativeOwnerRoot, now: Date = Date()) -> Bool {
        origin == owner.origin.absoluteString &&
        instanceID == owner.instanceID &&
        ownerID == owner.ownerID && rootNodeID == owner.rootNodeID &&
        username == owner.username &&
        UUID(uuidString: deviceID) != nil &&
        UUID(uuidString: grantID) != nil &&
        XDriveIOSPhotoBackgroundGrantPolicy.validOpaqueSecret(grantSecret) &&
        (32...256).contains(deviceToken.utf8.count) &&
        XDriveIOSBGApprovalPolicy.validLifetime(
            approvedAt: approvedAt, expiresAt: expiresAt, now: now
        ) &&
        XDriveIOSBGApprovalPolicy.validInterval(intervalMinutes)
    }

    func ownerScope() throws -> XDriveNativeOwnerRoot {
        let url = try ServerAddress.parse(origin)
        guard !instanceID.isEmpty, !username.isEmpty, ownerID > 0,
              rootNodeID > 0 else {
            throw XDriveIOSPhotoBGVaultFailure.corrupt
        }
        return XDriveNativeOwnerRoot(
            origin: url, instanceID: instanceID,
            ownerID: ownerID, username: username,
            rootNodeID: rootNodeID, rootRevision: rootRevision
        )
    }
}

enum XDriveIOSPhotoBGVaultFailure: Error {
    case corrupt
    case differentOwnerStillApproved
    case keychain(OSStatus)
    case serverRejected
    case invalidProof
}

/// Single active iPhone Owner grant; changing Owner never silently inherits
/// or overwrites another Server's background grant. Old Owners can revoke
/// remotely and explicit local opt-out clears the running credentials.
///
/// The credential exists only in Keychain, not as a new PWA token store.
actor XDriveIOSApprovedPhotoBGVault {
    static let shared = XDriveIOSApprovedPhotoBGVault()
    private init() {}

    private let service = "com.lazyxu.xdrive.ios.photos.bg-approved.v1"
    private let account = "one-explicit-owner"

    func current() throws -> XDriveIOSApprovedPhotoBGCredential? {
        var query = base()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else {
            throw XDriveIOSPhotoBGVaultFailure.keychain(status)
        }
        guard let bytes = item as? Data,
              let credential = try? JSONDecoder().decode(
                XDriveIOSApprovedPhotoBGCredential.self, from: bytes
              ),
              let owner = try? credential.ownerScope(),
              credential.matches(owner) else {
            throw XDriveIOSPhotoBGVaultFailure.corrupt
        }
        return credential
    }

    func install(owner: XDriveNativeOwnerRoot,
                 device: XDriveIOSBackgroundDeviceProof,
                 grantID: String, grantSecret: String, expiresAt: Date,
                 intervalMinutes: Int = 360) throws {
        let now = Date()
        let candidate = XDriveIOSApprovedPhotoBGCredential(
            origin: owner.origin.absoluteString,
            instanceID: owner.instanceID,
            ownerID: owner.ownerID, rootNodeID: owner.rootNodeID,
            rootRevision: owner.rootRevision,
            username: owner.username, deviceID: device.deviceID,
            deviceToken: device.secret, grantID: grantID,
            grantSecret: grantSecret, expiresAt: expiresAt,
            approvedAt: now, intervalMinutes: intervalMinutes
        )
        guard candidate.matches(owner, now: now) else {
            throw XDriveIOSPhotoBGVaultFailure.corrupt
        }
        if let existing = try current(),
           existing.origin != candidate.origin ||
           existing.instanceID != candidate.instanceID ||
           existing.ownerID != candidate.ownerID ||
           existing.rootNodeID != candidate.rootNodeID {
            // Never silently overwrite a prior Owner on account switching.
            throw XDriveIOSPhotoBGVaultFailure.differentOwnerStillApproved
        }
        let bytes = try JSONEncoder().encode(candidate)
        var insert = base()
        insert[kSecValueData as String] = bytes
        insert[kSecAttrAccessible as String] =
            kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let created = SecItemAdd(insert as CFDictionary, nil)
        if created != errSecSuccess {
            guard created == errSecDuplicateItem else {
                throw XDriveIOSPhotoBGVaultFailure.keychain(created)
            }
            let replacement: [String: Any] = [
                kSecValueData as String: bytes
            ]
            let changed = SecItemUpdate(
                base() as CFDictionary, replacement as CFDictionary
            )
            guard changed == errSecSuccess else {
                throw XDriveIOSPhotoBGVaultFailure.keychain(changed)
            }
        }
        // Verify durable re-read before telling the caller "approved".
        guard let stored = try current(),
              stored.grantID == grantID, stored.matches(owner) else {
            throw XDriveIOSPhotoBGVaultFailure.corrupt
        }
    }

    /// Local cancellation is immediate, even if offline. The independently
    /// stored foreground grant remains available for Owner remote revocation
    /// only; a BGTask cannot fall back to it.
    func cancelLocally(owner: XDriveNativeOwnerRoot) throws {
        if let existing = try current() {
            guard existing.origin == owner.origin.absoluteString,
                  existing.instanceID == owner.instanceID,
                  existing.ownerID == owner.ownerID,
                  existing.rootNodeID == owner.rootNodeID else {
                throw XDriveIOSPhotoBGVaultFailure.differentOwnerStillApproved
            }
        }
        let status = SecItemDelete(base() as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw XDriveIOSPhotoBGVaultFailure.keychain(status)
        }
        XDriveIOSBackgroundPhotoTask.revokePendingRequests()
    }

    /// Only a Server response that independently matches BOTH secrets,
    /// current root and Server generation admits a BGTask. Redirects fail.
    /// No photo is read, uploaded, or counted here.
    func proveInBackground() async throws -> XDriveIOSApprovedPhotoBGCredential {
        guard let item = try current(),
              let owner = try? item.ownerScope(),
              item.matches(owner) else {
            throw XDriveIOSPhotoBGVaultFailure.corrupt
        }
        var parts = URLComponents(url: owner.origin, resolvingAgainstBaseURL: false)
        parts?.path = "/api/v1/ios/photos/background-grants/proof"
        parts?.query = nil
        parts?.fragment = nil
        guard let url = parts?.url else {
            throw XDriveIOSPhotoBGVaultFailure.corrupt
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 25
        let session = URLSession(
            configuration: configuration,
            delegate: XDriveIOSPhotoBGDenyRedirects(),
            delegateQueue: nil
        )
        defer { session.invalidateAndCancel() }
        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        req.httpShouldHandleCookies = false
        req.timeoutInterval = 25
        req.setValue(item.deviceID, forHTTPHeaderField: "X-XDrive-Device-ID")
        req.setValue(item.deviceToken, forHTTPHeaderField: "X-XDrive-Device-Token")
        req.setValue(item.grantSecret, forHTTPHeaderField: "X-XDrive-IOS-Photo-Grant")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        let (body, response) = try await session.data(for: req)
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse,
              http.statusCode == 200, body.count <= 4096,
              let proof = try? JSONDecoder().decode(
                XDriveIOSBGOwnerProof.self, from: body
              ),
              proof.grant_id == item.grantID,
              proof.owner_id == item.ownerID,
              proof.device_id == item.deviceID,
              proof.root_node_id == item.rootNodeID,
              proof.server_instance_id == item.instanceID,
              proof.upload_authorized,
              let serverExpiry = XDriveIOSBGDateParser.parse(proof.expires_at),
              serverExpiry <= item.expiresAt,
              serverExpiry > Date() else {
            throw XDriveIOSPhotoBGVaultFailure.serverRejected
        }
        return item
    }

    private func base() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }
}

private struct XDriveIOSBGOwnerProof: Decodable {
    let grant_id: String
    let owner_id: UInt64
    let device_id: String
    let root_node_id: UInt64
    let server_instance_id: String
    let expires_at: String
    let upload_authorized: Bool
}

private enum XDriveIOSBGDateParser {
    static func parse(_ string: String) -> Date? {
        let normal = ISO8601DateFormatter()
        normal.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = normal.date(from: string) { return date }
        let fallback = ISO8601DateFormatter()
        fallback.formatOptions = [.withInternetDateTime]
        return fallback.date(from: string)
    }
}

private final class XDriveIOSPhotoBGDenyRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
