import Foundation
import SwiftUI

/// Read-only labels for PhotoKit's Owner-local incremental change queue.
/// These are historical discovery/receipt states, never proof that a remote
/// Node currently exists or that the entire library is backed up.
struct XDriveIOSNativeVisiblePhotoQueueBadge: Equatable {
    let title: String
    let symbol: String
    let explanation: String
}

enum XDriveIOSNativeVisiblePhotoQueueBadgePolicy {
    static func badge(for state: String?,
                      failureReasonCode: String? = nil)
        -> XDriveIOSNativeVisiblePhotoQueueBadge? {
        switch state {
        case "pending":
            return .init(title: "待传", symbol: "clock",
                         explanation: "增量变更待处理，未确认备份")
        case "waitingICloud":
            return .init(title: "iCloud", symbol: "icloud",
                         explanation: "正在等待获得 iCloud 原件，尚未备份")
        case "failed":
            // The persisted reason is an allowlisted, exact-revision local
            // diagnosis, never raw HTTP error text or a claim of failed
            // Server mutation. Unknown codes fall back to generic status.
            let known = failureReasonCode.flatMap {
                XDriveIOSPhotoBackupIssueReason(rawValue: $0)
            }
            let explanation = known.map {
                "原件处理失败：\($0.displayText)。当前版本尚未备份，核验后重试"
            } ?? "原件处理失败，需核验后重试"
            return .init(title: "失败", symbol: "exclamationmark.triangle",
                         explanation: explanation)
        case "confirmed":
            return .init(title: "曾确认", symbol: "checkmark.circle",
                         explanation: "该次变更曾通过云端收据核验，当前云端原件仍需重新核验")
        default:
            // Missing, deleted, unknown and never-scanned originals must not
            // receive a green cloud check mark or fabricated upload state.
            return nil
        }
    }
}

private struct XDriveIOSNativePhotoQueueBadgeOwnerKey: EnvironmentKey {
    static let defaultValue: XDriveNativeOwnerRoot? = nil
}

extension EnvironmentValues {
    var xdriveNativePhotoQueueBadgeOwner: XDriveNativeOwnerRoot? {
        get { self[XDriveIOSNativePhotoQueueBadgeOwnerKey.self] }
        set { self[XDriveIOSNativePhotoQueueBadgeOwnerKey.self] = newValue }
    }
}


/// Lightweight UI-only refresh marker. It never uploads data or changes the
/// PhotoKit scan task identifier, so visible page contents stay mounted.
struct XDriveIOSNativePhotoQueueBadgeRefresh: Equatable {
    let busy: Bool
    let confirmedID: UUID?
}

private struct XDriveIOSNativePhotoQueueBadgeRefreshKey: EnvironmentKey {
    static let defaultValue = XDriveIOSNativePhotoQueueBadgeRefresh(
        busy: false, confirmedID: nil
    )
}

extension EnvironmentValues {
    var xdriveNativePhotoQueueBadgeRefresh: XDriveIOSNativePhotoQueueBadgeRefresh {
        get { self[XDriveIOSNativePhotoQueueBadgeRefreshKey.self] }
        set { self[XDriveIOSNativePhotoQueueBadgeRefreshKey.self] = newValue }
    }
}
