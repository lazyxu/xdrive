import Foundation
import Security

/// The list is public metadata only; passwords live in iOS Keychain and never in UserDefaults.
/// Keychain account keys are bound to one canonical HTTPS origin AND username.
struct XDriveIOSNativeLoginProfile: Codable, Hashable, Identifiable {
    let server: String
    let lanIP: String
    let username: String
    // A different LAN endpoint is not allowed to inherit this Server's password.
    var id: String { server + "\u{001F}" + lanIP + "\u{001F}" + username }
}

enum XDriveIOSNativePasswordProfiles {
    private static let listKey = "xdrive.ios.native.login-profiles.v1"
    private static let service = "com.lazyxu.xdrive.ios.saved-login-password.v1"
    private static let limit = 12

    static func profile(server: String, lanIP: String, username: String) -> XDriveIOSNativeLoginProfile? {
        guard server.utf8.count <= 512, lanIP.utf8.count <= 128,
              !username.isEmpty, username.utf8.count <= 128,
              username == username.trimmingCharacters(in: .whitespacesAndNewlines),
              !username.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              let origin = try? ServerAddress.parse(server) else { return nil }
        if !lanIP.isEmpty {
            guard (try? XDriveIOSNativeLANLoginRoute.candidate(origin: origin, ip: lanIP)) != nil
            else { return nil }
        }
        return XDriveIOSNativeLoginProfile(
            server: origin.absoluteString, lanIP: lanIP, username: username)
    }

    static func list() -> [XDriveIOSNativeLoginProfile] {
        guard let data = UserDefaults.standard.data(forKey: listKey),
              data.count <= 16384,
              let decoded = try? JSONDecoder().decode([XDriveIOSNativeLoginProfile].self, from: data)
        else { return [] }
        var seen = Set<String>()
        return decoded.compactMap { item in
            guard let safe = profile(server: item.server, lanIP: item.lanIP,
                                     username: item.username), seen.insert(safe.id).inserted
            else { return nil }
            return safe
        }.prefix(limit).map { $0 }
    }

    /// Called only after authenticated Owner/root verification; never record untrusted guesses.
    static func rememberProfile(_ item: XDriveIOSNativeLoginProfile) {
        guard let safe = profile(server: item.server, lanIP: item.lanIP,
                                 username: item.username) else { return }
        let ordered = [safe] + list().filter { $0.id != safe.id }
        if let data = try? JSONEncoder().encode(Array(ordered.prefix(limit))) {
            UserDefaults.standard.set(data, forKey: listKey)
        }
    }

    private static func query(_ item: XDriveIOSNativeLoginProfile) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: item.id
        ]
    }

    static func password(for item: XDriveIOSNativeLoginProfile) throws -> String? {
        guard profile(server: item.server, lanIP: item.lanIP,
                      username: item.username) == item else { return nil }
        var request = query(item)
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var value: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &value)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else {
            throw XDriveIOSNativeSessionError.keychainUnavailable(status)
        }
        guard let data = value as? Data, let saved = String(data: data, encoding: .utf8),
              !saved.isEmpty, data.count <= 4096 else {
            throw XDriveIOSNativeSessionError.malformedCredential
        }
        return saved
    }

    static func savePassword(_ password: String, for item: XDriveIOSNativeLoginProfile) throws {
        guard profile(server: item.server, lanIP: item.lanIP,
                      username: item.username) == item,
              !password.isEmpty, password.utf8.count <= 4096 else {
            throw XDriveIOSNativeSessionError.malformedCredential
        }
        var request = query(item)
        request[kSecValueData as String] = Data(password.utf8)
        request[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let status = SecItemAdd(request as CFDictionary, nil)
        if status == errSecDuplicateItem {
            let updated = SecItemUpdate(query(item) as CFDictionary, [
                kSecValueData as String: Data(password.utf8),
                kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            ] as CFDictionary)
            guard updated == errSecSuccess else {
                throw XDriveIOSNativeSessionError.keychainUnavailable(updated)
            }
        } else if status != errSecSuccess {
            throw XDriveIOSNativeSessionError.keychainUnavailable(status)
        }
        guard try self.password(for: item) == password else {
            throw XDriveIOSNativeSessionError.malformedCredential
        }
    }

    static func removePassword(for item: XDriveIOSNativeLoginProfile) throws {
        let status = SecItemDelete(query(item) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw XDriveIOSNativeSessionError.keychainUnavailable(status)
        }
    }

    /// Delete only the selected profile; the other account's Keychain and refresh remain intact.
    static func forget(_ item: XDriveIOSNativeLoginProfile) throws {
        try removePassword(for: item)
        let remaining = list().filter { $0.id != item.id }
        if let data = try? JSONEncoder().encode(remaining) {
            UserDefaults.standard.set(data, forKey: listKey)
        }
    }
}
