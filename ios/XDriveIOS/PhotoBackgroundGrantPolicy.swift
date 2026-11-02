import Foundation

/// Pure contract shared by native Keychain admission and macOS/Linux tests.
/// Opaque, 256-bit URL-safe base64 secret. Never a Web bearer or JWT.
enum XDriveIOSPhotoBackgroundGrantPolicy {
    static let maximumTTL: TimeInterval = 15 * 24 * 3600
    /// A native foreground Owner may explicitly renew an existing, still-valid
    /// approved background grant in its last 72 hours. Expired grants cannot
    /// be rotated; they require an Owner-reviewed revoke/new approval flow.
    static let renewalWindow: TimeInterval = 72 * 3600

    static func mayOfferRenewal(expiresAt: Date?, now: Date = Date()) -> Bool {
        guard let expiresAt else { return false }
        let remaining = expiresAt.timeIntervalSince(now)
        return remaining > 0 && remaining <= renewalWindow
    }

    static func validOpaqueSecret(_ value: String) -> Bool {
        guard value.utf8.count == 43, value.unicodeScalars.allSatisfy({
            let v = $0.value
            return (v >= 65 && v <= 90) || (v >= 97 && v <= 122) ||
                   (v >= 48 && v <= 57) || v == 45 || v == 95
        }) else { return false }
        let normal = value.replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/") + "="
        guard let raw = Data(base64Encoded: normal), raw.count == 32 else {
            return false
        }
        return raw.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "") == value
    }

    static func validExpiration(_ expiry: Date, now: Date) -> Bool {
        expiry > now && expiry < now.addingTimeInterval(maximumTTL)
    }
}
