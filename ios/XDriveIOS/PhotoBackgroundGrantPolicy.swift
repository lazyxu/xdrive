import Foundation

/// Pure contract shared by native Keychain admission and macOS/Linux tests.
/// Opaque, 256-bit URL-safe base64 secret. Never a Web bearer or JWT.
enum XDriveIOSPhotoBackgroundGrantPolicy {
    static let maximumTTL: TimeInterval = 15 * 24 * 3600

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
