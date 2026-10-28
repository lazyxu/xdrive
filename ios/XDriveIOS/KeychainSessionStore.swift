import Foundation
import Security

/// Only the rotating refresh credential is persisted. No passwords or access
/// tokens are stored, and credentials cannot migrate to another device.
struct StoredCredential: Codable {
    let server: String
    let username: String
    let refreshToken: String
}

enum KeychainSessionStore {
    private static let service = "com.lazyxu.xdrive.ios.session"
    private static let account = "xdrive.refresh"

    private static var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }

    static func load() -> StoredCredential? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess,
              let data = result as? Data,
              let saved = try? JSONDecoder().decode(StoredCredential.self, from: data),
              !saved.refreshToken.isEmpty,
              (try? ServerAddress.parse(saved.server)) != nil else {
            clear()
            return nil
        }
        return saved
    }

    static func save(_ credential: StoredCredential) throws {
        let data = try JSONEncoder().encode(credential)
        var request = query
        request[kSecValueData as String] = data
        request[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        clear()
        let status = SecItemAdd(request as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainError.writeFailed }
    }

    static func clear() {
        _ = SecItemDelete(query as CFDictionary)
    }

    enum KeychainError: Error {
        case writeFailed
    }
}
