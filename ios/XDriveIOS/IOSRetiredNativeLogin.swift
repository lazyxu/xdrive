import Foundation
import Security

/// The retired pre-v2 client saved a refresh token in this exact Keychain
/// service/account. The current native Owner v2 account never imports it.
/// This narrowly scoped deletion is credential hygiene, NOT a WebView
/// fallback, a login surface, or authority to clear the current v2 session.
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
