import CryptoKit
import Foundation
import Security

/// A private, stable installation *journal namespace* for foreground
/// authenticated Owner Files uploads. This is NOT a Server ClientDevice,
/// Source credential, Root entitlement or background Push capability.
enum XDriveIOSForegroundBackupIdentityError: Error {
    case keychain(OSStatus)
    case invalidKey
}

actor XDriveIOSForegroundBackupIdentity {
    static let shared = XDriveIOSForegroundBackupIdentity()
    private init() {}

    private let service = "com.lazyxu.xdrive.ios.owner-photos-files-v1"
    private let account = "local-journal-profile"
    private var cachedKey: Data?

    /// Reconstruct only the same stable sealed Owner Files ledger scope.
    /// The caller must independently authenticate this Owner/root on Server.
    /// This never reads PhotoKit, creates a Device or uploads any bytes.
    func localScope(owner: XDriveNativeOwnerRoot) throws -> XDrivePhotoSyncScope {
        guard owner.ownerID > 0, owner.rootNodeID > 0,
              !owner.instanceID.isEmpty else {
            throw XDriveIOSForegroundBackupIdentityError.invalidKey
        }
        return try makeScope(owner: owner, key: installationKey())
    }

    /// Read-only existing-credential lookup for uncertain receipt reviews.
    /// Never create a new Keychain secret simply to display zero pending.
    func existingLocalScope(owner: XDriveNativeOwnerRoot) throws -> XDrivePhotoSyncScope? {
        guard owner.ownerID > 0, owner.rootNodeID > 0,
              !owner.instanceID.isEmpty else {
            throw XDriveIOSForegroundBackupIdentityError.invalidKey
        }
        if let cachedKey { return try makeScope(owner: owner, key: cachedKey) }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecReturnData as String: true
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else {
            throw XDriveIOSForegroundBackupIdentityError.keychain(status)
        }
        guard let data = item as? Data, data.count == 32 else {
            throw XDriveIOSForegroundBackupIdentityError.invalidKey
        }
        cachedKey = data
        return try makeScope(owner: owner, key: data)
    }

    private func makeScope(owner: XDriveNativeOwnerRoot, key: Data)
        throws -> XDrivePhotoSyncScope {
        let deviceBytes = SHA256.hash(data: Data("ios-owner-photos-files-id-v1".utf8) + key)
        let id = hex(deviceBytes)
        let localUUID = String(id.prefix(8)) + "-" +
            String(id.dropFirst(8).prefix(4)) + "-" +
            String(id.dropFirst(12).prefix(4)) + "-" +
            String(id.dropFirst(16).prefix(4)) + "-" +
            String(id.dropFirst(20).prefix(12))
        return try XDrivePhotoSyncScope(
            origin: owner.origin, serverInstanceID: owner.instanceID,
            ownerID: owner.ownerID, rootNodeID: owner.rootNodeID,
            deviceID: localUUID
        )
    }

    func localScopeAndTag(owner: XDriveNativeOwnerRoot,
                          localIdentifier: String) throws
        -> (scope: XDrivePhotoSyncScope, tag: String) {
        guard !localIdentifier.isEmpty, localIdentifier.utf8.count <= 4096 else {
            throw XDriveIOSForegroundBackupIdentityError.invalidKey
        }
        let scope = try localScope(owner: owner)
        let key = try installationKey()
        // A keyed, non-reversible asset tag avoids collisions between
        // IMG_0001.HEIC photos from different camera years and Owners.
        // It is never sent as a device credential or PhotoKit ID.
        let prefix = "ios-owner-photos-files-asset-v1\n" +
            scope.origin + "\n" + scope.serverInstanceID + "\n" +
            String(scope.ownerID) + "\n" + String(scope.rootNodeID) + "\n" +
            localIdentifier
        let tag = HMAC<SHA256>.authenticationCode(
            for: Data(prefix.utf8), using: SymmetricKey(data: key)
        )
        return (scope, String(hex(tag).prefix(24)))
    }

    private func installationKey() throws -> Data {
        if let cachedKey { return cachedKey }
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        func readExisting() -> (OSStatus, Data?) {
            var query = base
            query[kSecMatchLimit as String] = kSecMatchLimitOne
            query[kSecReturnData as String] = true
            var item: CFTypeRef?
            let status = SecItemCopyMatching(query as CFDictionary, &item)
            return (status, item as? Data)
        }

        let (status, existing) = readExisting()
        if status == errSecSuccess {
            guard let existing, existing.count == 32 else {
                throw XDriveIOSForegroundBackupIdentityError.invalidKey
            }
            cachedKey = existing
            return existing
        }
        guard status == errSecItemNotFound else {
            throw XDriveIOSForegroundBackupIdentityError.keychain(status)
        }
        var random = [UInt8](repeating: 0, count: 32)
        let result = random.withUnsafeMutableBytes { buffer -> OSStatus in
            guard let address = buffer.baseAddress else { return errSecParam }
            return SecRandomCopyBytes(kSecRandomDefault, buffer.count, address)
        }
        guard result == errSecSuccess else {
            throw XDriveIOSForegroundBackupIdentityError.keychain(result)
        }
        let key = Data(random)
        var insert = base
        insert[kSecValueData as String] = key
        insert[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let added = SecItemAdd(insert as CFDictionary, nil)
        if added == errSecSuccess {
            cachedKey = key
            return key
        }
        // Two scenes can race during the first setup; never replace a
        // previously stored key and orphan all sealed backup operations.
        if added == errSecDuplicateItem {
            let (again, existing) = readExisting()
            if again == errSecSuccess, let existing, existing.count == 32 {
                cachedKey = existing
                return existing
            }
        }
        throw XDriveIOSForegroundBackupIdentityError.keychain(added)
    }

    private func hex<T: Sequence>(_ data: T) -> String where T.Element == UInt8 {
        data.map { String(format: "%02x", $0) }.joined()
    }
}

/// A single read-only Owner journal gate shared by native manual,
/// foreground automatic, and system-approved BG original runs.
/// Call only AFTER authenticating the exact Owner and acquiring the global
/// original writer gate. The *absence* of a first-install Keychain scope is
/// not evidence of an uploaded original; an unreadable/corrupt scope throws
/// and no upload is permitted.
enum XDriveIOSOriginalPendingReceiptPreflight {
    static func pendingCount(owner: XDriveNativeOwnerRoot) async throws -> Int {
        guard let scope = try await XDriveIOSForegroundBackupIdentity.shared
            .existingLocalScope(owner: owner) else { return 0 }
        return try await XDrivePhotoSyncLedger.shared
            .pendingReceiptSnapshot(scope: scope, limit: 0).pending
    }
}
