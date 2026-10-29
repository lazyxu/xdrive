import Foundation

/// Bounded byte work for foreground/foreground-authorized automatic iOS
/// originals. Live Photo pairing is a separate all-or-nothing bundle path.
enum XDriveIOSOriginalBackupMediaPolicy {
    static let stillLimit: Int64 = 128 * 1_048_576
    static let videoLimit: Int64 = 1_073_741_824

    static func eligible(kind: String, isLive: Bool) -> Bool {
        !isLive && (kind == "image" || kind == "video")
    }

    static func maxBytes(kind: String) -> Int64? {
        switch kind {
        case "image": return stillLimit
        case "video": return videoLimit
        default: return nil
        }
    }
}
