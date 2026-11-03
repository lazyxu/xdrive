import Foundation

/// One explicitly user-initiated foreground pass across the currently
/// authorized PhotoKit library. Never infer successful cloud coverage from
/// a cursor or a returned scan count.
enum XDriveIOSPhotoFocusedBackupPolicy {
    enum Step: Equatable {
        case repeatWindow(Int)
        case nextWindow(Int)
        case finished
        case pausedForReview
        case invalidProgress
    }

    static func afterWindow(index: Int, visibleTotal: Int, scanned: Int,
                            uploaded: Int, needsReview: Bool) -> Step {
        guard index >= 0, visibleTotal >= 0, scanned >= 0,
              uploaded >= 0,
              uploaded <= XDriveIOSPhotoAutoSchedulePolicy.maxNewFiles,
              uploaded <= scanned,
              let offset = XDrivePhotoBackupScanWindow.offset(for: index)
        else { return .invalidProgress }

        if visibleTotal == 0 {
            return index == 0 && scanned == 0 && uploaded == 0 && !needsReview
                ? .finished : .invalidProgress
        }
        guard offset < visibleTotal else { return .invalidProgress }
        let capacity = XDrivePhotoBackupScanWindow.capacity(
            visibleTotal: visibleTotal, offset: offset
        )
        guard scanned <= capacity else { return .invalidProgress }
        // A current-Owner lost ACK must pause the whole focused operation,
        // even if the current window has other candidates remaining.
        if needsReview { return .pausedForReview }

        if scanned < capacity {
            // Only the real 20-new-original bound can justify revisiting
            // a partial window. Everything else is a missing scan guarantee.
            return uploaded == XDriveIOSPhotoAutoSchedulePolicy.maxNewFiles
                ? .repeatWindow(index) : .invalidProgress
        }
        let windowCount = XDrivePhotoBackupScanWindow.count(visibleTotal: visibleTotal)
        return index + 1 == windowCount ? .finished : .nextWindow(index + 1)
    }
}
