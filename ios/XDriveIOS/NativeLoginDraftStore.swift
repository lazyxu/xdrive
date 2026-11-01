import Foundation

/// Non-secret, editable login hints. Never contains a password or bearer.
/// Session persistence remains entirely within native Keychain v2.
struct XDriveIOSNativeLoginDraft: Codable {
    let server: String
    let lanIP: String
    let username: String
}

enum XDriveIOSNativeLoginDraftStore {
    private static let key = "xdrive.ios.native.login-draft.v1"
    private static let legacyServerKey = "xdrive.ios.native.last-server"

    static func load() -> XDriveIOSNativeLoginDraft {
        let fallback = XDriveIOSNativeLoginDraft(
            server: UserDefaults.standard.string(forKey: legacyServerKey) ?? "",
            lanIP: "", username: ""
        )
        guard let bytes = UserDefaults.standard.data(forKey: key),
              let draft = try? JSONDecoder().decode(XDriveIOSNativeLoginDraft.self, from: bytes),
              draft.server.utf8.count <= 512,
              draft.lanIP.utf8.count <= 128,
              draft.username.utf8.count <= 128
        else { return fallback }
        return draft
    }

    /// Clear both the current draft and older fallback server preference.
    /// This does not touch PWA credentials, photos or backup receipts.
    @discardableResult
    static func clear() -> Bool {
        UserDefaults.standard.removeObject(forKey: key)
        UserDefaults.standard.removeObject(forKey: legacyServerKey)
        return UserDefaults.standard.object(forKey: key) == nil &&
            UserDefaults.standard.object(forKey: legacyServerKey) == nil
    }

    static func save(server: String, lanIP: String, username: String) {
        // Drafts may be incomplete while typing. Bounds protect preferences;
        // HTTPS validation occurs before a credential-bearing request.
        guard server.utf8.count <= 512, lanIP.utf8.count <= 128,
              username.utf8.count <= 128,
              !server.contains("\u{0000}"), !lanIP.contains("\u{0000}"),
              !username.contains("\u{0000}") else { return }
        // A user may paste a URL containing credentials or a bearer query.
        // Retain the previous safe draft, never serialize that input.
        if !server.isEmpty {
            guard let origin = try? ServerAddress.parse(server) else { return }
            if !lanIP.isEmpty {
                guard (try? XDriveIOSNativeLANLoginRoute.candidate(
                    origin: origin, ip: lanIP
                )) != nil else { return }
            }
        } else if !lanIP.isEmpty {
            return
        }
        let draft = XDriveIOSNativeLoginDraft(
            server: server, lanIP: lanIP, username: username
        )
        guard let bytes = try? JSONEncoder().encode(draft) else { return }
        UserDefaults.standard.set(bytes, forKey: key)
    }
}
