import Foundation

/// Pure, testable foreground-only schedule policy. An iOS system BGTask may
/// run later but must never be misreported as an exact minute scheduler.
enum XDriveIOSPhotoAutoSchedulePolicy {
    static let supportedMinutes = [15, 60, 360, 1440]
    static let windowSize = 256
    static let maxNewFiles = 20
    static let catchUpCooldown: TimeInterval = 60
    // PHChange callbacks are advisory. Give PhotoKit a short settling delay;
    // the existing 60-second active-scene timer remains the only poller.
    static let photoLibraryChangeDelay: TimeInterval = 5
    // Only a proven pre-write transient network outage can be rescheduled
    // sooner than the user-selected interval. No immediate retry loop.
    static let prewriteNetworkRetryDelay: TimeInterval = 5 * 60

    static func accepts(minutes: Int) -> Bool {
        supportedMinutes.contains(minutes)
    }

    /// An authorized library change can make a long regular interval stale.
    /// Never delay an already-due check, and never create a timer/upload here.
    static func earlierDueAfterLibraryChange(currentDueAt: Date,
                                              at now: Date) -> Date? {
        let soon = now.addingTimeInterval(photoLibraryChangeDelay)
        return currentDueAt > soon ? soon : nil
    }

    /// Never retry unknown post-write outcomes, authentication/permission
    /// errors or cancelled tasks. The caller must independently prove that
    /// this run has NOT begun any original mutation.
    static func retryablePrewriteNetworkFailure(_ error: URLError) -> Bool {
        switch error.code {
        case .notConnectedToInternet, .networkConnectionLost, .timedOut,
             .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed:
            return true
        default:
            return false
        }
    }

    /// Keep an earlier PhotoKit-triggered due time. The existing foreground
    /// 60-second timer is the only executor; this function never uploads.
    static func earlierDueAfterSafePrewriteNetworkFailure(
        currentDueAt: Date, at now: Date
    ) -> Date? {
        let soon = now.addingTimeInterval(prewriteNetworkRetryDelay)
        return currentDueAt > soon ? soon : nil
    }

    static func nextWindow(current: Int, visibleTotal: Int,
                           scanned: Int, uploaded: Int,
                           needsReview: Bool) -> Int {
        guard !needsReview, current >= 0, visibleTotal > 0,
              scanned >= 0, uploaded >= 0 else { return current }
        let offset = current > Int.max / windowSize
            ? Int.max : current * windowSize
        let capacity = offset >= visibleTotal ? 0 : min(windowSize, visibleTotal - offset)
        // A cap of 20 only blocks advancement if it was hit before the
        // final authorized slot. Otherwise the window is fully examined;
        // replaying it delays the next 256 items by an entire interval.
        // Ledger SHA/Owner verification still skips confirmed originals.
        if offset >= visibleTotal { return 0 }
        guard scanned == capacity, uploaded <= maxNewFiles,
              uploaded <= scanned else { return current }
        let count = 1 + (visibleTotal - 1) / windowSize
        return (current + 1) % count
    }

    static func nextDue(after now: Date, intervalMinutes: Int) -> Date? {
        guard accepts(minutes: intervalMinutes) else { return nil }
        return now.addingTimeInterval(TimeInterval(intervalMinutes * 60))
    }

    /// Explicitly opted-in foreground catch-up for a confirmed safe window.
    /// No accelerated rescan after unknown receipts, changed PhotoKit epoch,
    /// malformed progress, or the end of a complete library pass.
    static func nextDueAfterCompletedWindow(
        at now: Date, intervalMinutes: Int, currentWindow: Int,
        followingWindow: Int, visibleTotal: Int, scanned: Int,
        uploaded: Int, needsReview: Bool, libraryUnchanged: Bool
    ) -> Date? {
        guard let periodic = nextDue(after: now, intervalMinutes: intervalMinutes)
        else { return nil }
        guard !needsReview, libraryUnchanged,
              currentWindow >= 0, followingWindow >= 0,
              visibleTotal > 0, scanned >= 0,
              uploaded >= 0, uploaded <= maxNewFiles,
              uploaded <= scanned else { return periodic }
        let offset = currentWindow > Int.max / windowSize
            ? Int.max : currentWindow * windowSize
        guard offset < visibleTotal else { return periodic }
        let capacity = min(windowSize, visibleTotal - offset)
        guard scanned <= capacity else { return periodic }
        // Upload-cap acceleration is only needed for an unfinished window.
        // On the exact final slot, nextWindow advances to the next page;
        // a final-page wrap returns to the normal user-selected interval.
        let reachedUploadCap = uploaded == maxNewFiles && scanned < capacity
        // Do not accelerate the wrap to the first page after a full pass.
        let hasAnotherWindow = scanned == capacity &&
            followingWindow != 0 && followingWindow != currentWindow
        return reachedUploadCap || hasAnotherWindow
            ? now.addingTimeInterval(catchUpCooldown) : periodic
    }
}
