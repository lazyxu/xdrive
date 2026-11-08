import Foundation

/// The share sheet never receives an xDrive bearer, E2EE vault key, or Owner ID.
/// It only prepares an explicit local-only system paste; the native app must
/// still be opened, verified, unlocked, and asked to encrypt/send separately.
enum XDriveIOSClipboardSharePolicy {
    static let maxTextBytes = 65_536

    static func acceptable(_ raw: String?) -> String? {
        guard let text = raw, !text.isEmpty, !text.contains("\u{0000}"),
              text.utf8.count <= maxTextBytes else { return nil }
        return text
    }
}
