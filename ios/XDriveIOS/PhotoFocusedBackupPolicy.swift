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

    /// A checkpoint is only a finished PhotoKit *scan* boundary; the next
    /// attempt must independently prove every Node receipt before skipping it.
    /// An incomplete 20-upload-cap window is deliberately not saved.
    static func validCheckpoint(completedWindow: Int, nextWindow: Int,
                                visibleTotal: Int) -> Bool {
        guard completedWindow >= 0, completedWindow < Int.max,
              nextWindow == completedWindow + 1, visibleTotal > 0,
              let offset = XDrivePhotoBackupScanWindow.offset(for: nextWindow)
        else { return false }
        return offset < visibleTotal &&
            nextWindow < XDrivePhotoBackupScanWindow.count(
                visibleTotal: visibleTotal
            )
    }

    /// An incomplete/unavailable original is a gap in the completed scan
    /// prefix: continuing to save later windows would skip it on restart.
    /// Preserve only the last prior fully safe boundary, and recheck that
    /// window on the next explicitly authorized foreground run.
    static func canSaveCheckpoint(completedWindow: Int, nextWindow: Int,
                                  visibleTotal: Int,
                                  hadUnavailable: Bool) -> Bool {
        !hadUnavailable && validCheckpoint(
            completedWindow: completedWindow, nextWindow: nextWindow,
            visibleTotal: visibleTotal
        )
    }

    /// Fail closed on edits, Full/Limited scope changes, iCloud behavior,
    /// changed authorized count, malformed offsets or completed libraries.
    /// A trusted scan checkpoint is NOT an original/Server receipt.
    static func trustedResumeWindow(
        requested: Int, previousVisible: Int, currentVisible: Int,
        priorAuthorization: Int, currentAuthorization: Int,
        tokenUnchanged: Bool, previousAllowICloud: Bool, allowICloud: Bool
    ) -> Int {
        guard requested > 0, previousVisible > 0,
              currentVisible == previousVisible,
              priorAuthorization == currentAuthorization,
              tokenUnchanged, previousAllowICloud == allowICloud,
              let offset = XDrivePhotoBackupScanWindow.offset(for: requested),
              offset < currentVisible,
              requested < XDrivePhotoBackupScanWindow.count(
                visibleTotal: currentVisible
              ) else { return 0 }
        return requested
    }

    static func afterWindow(index: Int, visibleTotal: Int, scanned: Int,
                            uploaded: Int, needsReview: Bool,
                            queuedUploaded: Int = 0) -> Step {
        guard index >= 0, visibleTotal >= 0, scanned >= 0,
              uploaded >= 0,
              uploaded <= XDriveIOSPhotoAutoSchedulePolicy.maxNewFiles,
              queuedUploaded >= 0, queuedUploaded <= uploaded,
              // This Focused pass may consume PhotoKit priority revisions
              // before it reads any positional slot. Only non-queue uploads
              // are bounded by scanned slots; total writes remain capped.
              uploaded - queuedUploaded <= scanned,
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
