import Foundation
import Security

/// A NEW native-only login credential, deliberately unrelated to the retired
/// com.lazyxu.xdrive.ios.session / xdrive.refresh PWA-era native login.
/// This record is never copied into WKWebView, a JavaScript URL or UserDefaults.
struct XDriveIOSNativeOwnerCredential: Codable, Equatable {
    let origin: String
    let username: String
    let serverInstanceID: String
    let ownerID: UInt64
    let rootNodeID: UInt64
    let refreshToken: String
}

enum XDriveIOSNativeSessionError: Error {
    case malformedCredential
    case keychainUnavailable(OSStatus)
    case staleSession
    case ownerChanged
    case passwordChangeRequired
    case notSignedIn
}

/// Only a verified native Owner may be persisted, after an explicit login.
/// Reading malformed or inaccessible Keychain data never silently yields a
/// fresh empty state, since that could resurrect another Owner on restart.
enum XDriveIOSNativeOwnerSessionStore {
    static let service = "com.lazyxu.xdrive.ios.native-owner-session.v2"
    static let account = "active-verified-owner"

    private static func query() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }

    static func valid(_ value: XDriveIOSNativeOwnerCredential) -> Bool {
        guard let url = try? ServerAddress.parse(value.origin),
              url.absoluteString == value.origin,
              !value.username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              value.username.utf8.count <= 128,
              !value.serverInstanceID.isEmpty,
              value.serverInstanceID.utf8.count <= 256,
              value.ownerID > 0, value.rootNodeID > 0,
              !value.refreshToken.isEmpty, value.refreshToken.utf8.count <= 16384
        else { return false }
        return true
    }

    static func load() throws -> XDriveIOSNativeOwnerCredential? {
        var request = query()
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        request[kSecReturnData as String] = true
        var item: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else {
            throw XDriveIOSNativeSessionError.keychainUnavailable(status)
        }
        guard let bytes = item as? Data,
              let value = try? JSONDecoder().decode(
                XDriveIOSNativeOwnerCredential.self, from: bytes
              ), valid(value) else {
            throw XDriveIOSNativeSessionError.malformedCredential
        }
        return value
    }

    static func save(_ value: XDriveIOSNativeOwnerCredential) throws {
        guard valid(value) else {
            throw XDriveIOSNativeSessionError.malformedCredential
        }
        let bytes = try JSONEncoder().encode(value)
        var request = query()
        request[kSecValueData as String] = bytes
        // Foreground login and refresh only; never lower accessibility to
        // reuse an interactive login credential for background photo tasks.
        request[kSecAttrAccessible as String] =
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let added = SecItemAdd(request as CFDictionary, nil)
        if added == errSecDuplicateItem {
            let replacement: [String: Any] = [
                kSecValueData as String: bytes,
                kSecAttrAccessible as String:
                    kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            ]
            let updated = SecItemUpdate(
                query() as CFDictionary, replacement as CFDictionary
            )
            guard updated == errSecSuccess else {
                throw XDriveIOSNativeSessionError.keychainUnavailable(updated)
            }
        } else if added != errSecSuccess {
            throw XDriveIOSNativeSessionError.keychainUnavailable(added)
        }
        // Only report "keep signed in" when the actual native Keychain
        // returned exactly the verified, Owner-scoped rotated credential.
        guard try load() == value else {
            throw XDriveIOSNativeSessionError.malformedCredential
        }
    }

    static func clear() throws {
        let status = SecItemDelete(query() as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw XDriveIOSNativeSessionError.keychainUnavailable(status)
        }
    }
}
