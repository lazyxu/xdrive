import Foundation
import Security

/// The previous standalone SwiftUI login saved its own refresh token under
/// this exact private Keychain service/account. The only remaining login
/// surface is the canonical PWA; its HttpOnly cookies must not be migrated
/// from, or replaced with, this unrelated native secret.
///
/// Remove only that retired credential. The iPhone's independent
/// com.lazyxu.xdrive.ios.device-identity.v1 and foreground backup ledger
/// Keychain entries are unrelated and must remain untouched.
enum XDriveIOSRetiredNativeLogin {
    static func purgeLegacyRefreshToken() {
        let exactLegacyQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.lazyxu.xdrive.ios.session",
            kSecAttrAccount as String: "xdrive.refresh"
        ]
        // Idempotent. On a locked/unavailable Keychain, retry on a future
        // launch rather than reading, logging or exporting the old secret.
        // A Server-side session may remain until its normal expiry; this
        // is local credential retirement, not proof of remote revocation.
        _ = SecItemDelete(exactLegacyQuery as CFDictionary)
    }
}
