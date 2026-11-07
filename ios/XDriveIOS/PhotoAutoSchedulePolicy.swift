import Foundation

/// Start rule for the *foreground automatic* plan. Manual, Focused and
/// independently approved BGProcessing tasks keep their existing scope.
enum XDriveIOSPhotoAutoStartRule: String, Codable, CaseIterable {
    case everything
    case onlyNew
}

/// Pure, testable foreground-only schedule policy. An iOS system BGTask may
/// run later but must never be misreported as an exact minute scheduler.
enum XDriveIOSPhotoAutoSchedulePolicy {
    enum NewOnlyCandidateDecision: Equatable {
        case eligible
        case olderThanStart
        case unknownDates
    }

    /// Missing rule preserves legacy whole-library behavior. Unknown/new
    /// schemas or lost new-only baseline must never silently upload all.
    static func storedStartRule(
        raw: String?, newOnlySince: Date?
    ) -> XDriveIOSPhotoAutoStartRule? {
        guard let raw else { return .everything }
        guard let rule = XDriveIOSPhotoAutoStartRule(rawValue: raw) else { return nil }
        if rule == .onlyNew {
            guard let since = newOnlySince,
                  since.timeIntervalSince1970.isFinite else { return nil }
        }
        return rule
    }

    /// Since-enable captures and edits, not a claim of full PhotoKit
    /// change-history coverage. An undated item must remain unresolved.
    static func newOnlyCandidate(
        capturedAt: Date?, modifiedAt: Date?, since: Date
    ) -> NewOnlyCandidateDecision {
        guard since.timeIntervalSince1970.isFinite else { return .unknownDates }
        let validDates = [capturedAt, modifiedAt].compactMap { date -> Date? in
            guard let date, date.timeIntervalSince1970.isFinite else { return nil }
            return date
        }
        guard !validDates.isEmpty else { return .unknownDates }
        return validDates.contains(where: { $0 >= since })
            ? .eligible : .olderThanStart
    }

    static let supportedMinutes = [15, 60, 360, 1440]
    static let windowSize = 256
    static let maxNewFiles = 20
    static let catchUpCooldown: TimeInterval = 60
    /// Explicitly enabling a NEW automatic plan also authorizes safe
    /// foreground first-pass catch-up. Never upgrade a legacy saved plan's
    /// nil preference behind the user's back, or override a saved false.
    static func initialCatchUpPreference(
        hasExistingPlan: Bool, savedPreference: Bool?
    ) -> Bool {
        hasExistingPlan ? (savedPreference ?? false) : true
    }
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

    /// A recovery pass may rebase PhotoKit history only after every slot
    /// in the current authorized snapshot has been visited. A 20-upload cap
    /// leaves the window incomplete and must cause the same window to repeat.
    static func fullReconciliationWindowComplete(
        currentWindow: Int, visibleTotal: Int, scanned: Int
    ) -> Bool {
        guard currentWindow >= 0, visibleTotal >= 0, scanned >= 0 else {
            return false
        }
        if visibleTotal == 0 {
            return currentWindow == 0 && scanned == 0
        }
        guard currentWindow <= Int.max / windowSize else { return false }
        let offset = currentWindow * windowSize
        guard offset < visibleTotal else { return false }
        let capacity = min(windowSize, visibleTotal - offset)
        return scanned == capacity
    }

    /// Only supported Photo/Video/Live slots with a current verified receipt
    /// may count as reconciled. Unsupported media are explicit policy skips;
    /// item-local failures, unknown ACKs and filtered slots keep recovery open.
    static func fullReconciliationWindowVerified(
        scanned: Int, verified: Int, unsupported: Int,
        unavailable: Int, needsReview: Int, skippedBeforeBaseline: Int,
        queued: Int, stoppedForReview: Bool
    ) -> Bool {
        guard scanned >= 0, verified >= 0, unsupported >= 0,
              unavailable >= 0, needsReview >= 0,
              skippedBeforeBaseline >= 0, queued >= 0 else { return false }
        return verified + unsupported == scanned &&
            unavailable == 0 && needsReview == 0 &&
            skippedBeforeBaseline == 0 && queued == 0 &&
            !stoppedForReview
    }

    static func shouldCommitFullReconciliation(
        windowComplete: Bool, followingWindow: Int, passClean: Bool
    ) -> Bool {
        windowComplete && followingWindow == 0 && passClean
    }

    static func nextDue(after now: Date, intervalMinutes: Int) -> Date? {
        guard accepts(minutes: intervalMinutes) else { return nil }
        return now.addingTimeInterval(TimeInterval(intervalMinutes * 60))
    }

    /// Explicitly opted-in foreground catch-up for a confirmed safe window.
    /// Priority PhotoKit queue uploads are included in the total write cap,
    /// but do not consume a positional scan slot. Unproven extra writes,
    /// unknown receipts or changed PhotoKit epochs never accelerate a run.
    static func nextDueAfterCompletedWindow(
        at now: Date, intervalMinutes: Int, currentWindow: Int,
        followingWindow: Int, visibleTotal: Int, scanned: Int,
        uploaded: Int, needsReview: Bool, libraryUnchanged: Bool,
        queuedUploaded: Int = 0
    ) -> Date? {
        guard let periodic = nextDue(after: now, intervalMinutes: intervalMinutes)
        else { return nil }
        guard !needsReview, libraryUnchanged,
              currentWindow >= 0, followingWindow >= 0,
              visibleTotal > 0, scanned >= 0,
              uploaded >= 0, uploaded <= maxNewFiles,
              queuedUploaded >= 0, queuedUploaded <= uploaded,
              // Queue uploads can finish before any positional slot is read.
              // Only non-queue uploads are bounded by scanned slots; the
              // combined total still obeys the original 20-write cap.
              uploaded - queuedUploaded <= scanned else { return periodic }
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
