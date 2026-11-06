import Foundation

/// Original media have no app-defined byte ceilings. Retained compatibility
/// accessors express the Int64 metadata range, not separate PhotoKit limits.
/// Physical staging, Owner quota, Server MaxUploadBytes and OS task lifetime
/// remain independently enforced.
enum XDriveIOSOriginalBackupMediaPolicy {
    static let stillLimit: Int64 = .max
    static let videoLimit: Int64 = .max
    static let backgroundVideoLimit: Int64 = .max

    static func eligible(kind: String, isLive: Bool) -> Bool {
        !isLive && (kind == "image" || kind == "video")
    }

    static func maxBytes(kind: String) -> Int64? {
        switch kind {
        case "image", "video": return Int64.max
        default: return nil
        }
    }
}
