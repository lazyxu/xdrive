import Foundation

/// A bounded, read-only summary for the CURRENT 256-slot backup window.
/// No PhotoKit IDs, filenames, URLs, location or account credentials are stored.
enum XDriveIOSPhotoBackupIssueReason: String, Equatable {
    case notVisible
    case originalMissing
    case iCloudDownloadRequired
    case incompleteLivePair
    case resourceTooLarge
    case sourceChanged
    case unsupported
    case unavailable

    var displayText: String {
        switch self {
        case .notVisible: return "此照片目前不在已授权范围内"
        case .originalMissing: return "系统未提供完整原件"
        case .iCloudDownloadRequired: return "原件仅在 iCloud，需在获准的前台任务中下载后再核验"
        case .incompleteLivePair: return "Live Photo 缺少静态或动态原件"
        case .resourceTooLarge: return "原件字节数超出可表示范围，尚未备份"
        case .sourceChanged: return "读取期间原件发生变化"
        case .unsupported: return "尚不支持这种媒体类型"
        case .unavailable: return "原件暂时不可用，请检查 iCloud 或照片状态"
        }
    }
}

struct XDriveIOSPhotoBackupIssue: Equatable, Identifiable {
    /// One-based ordinal of the CURRENT authorized PhotoKit enumeration.
    /// This is a scan position, NOT a stable photo identifier.
    let position: Int
    let mediaKind: String
    let reason: XDriveIOSPhotoBackupIssueReason

    var id: Int { position }
    var mediaLabel: String {
        switch mediaKind {
        case "live": return "实况照片"
        case "video": return "视频"
        case "image": return "照片"
        default: return "媒体"
        }
    }
}

struct XDriveIOSPhotoBackupIssueSummary: Equatable {
    static let maxVisible = 20
    private(set) var entries: [XDriveIOSPhotoBackupIssue] = []
    private(set) var additionalCount = 0

    var total: Int { entries.count + additionalCount }

    mutating func append(position: Int, mediaKind: String,
                         reason: XDriveIOSPhotoBackupIssueReason) {
        guard position > 0 else { return }
        if entries.count < Self.maxVisible {
            entries.append(XDriveIOSPhotoBackupIssue(
                position: position, mediaKind: mediaKind, reason: reason
            ))
        } else {
            additionalCount += 1
        }
    }
}
