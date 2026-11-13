import Foundation
@main struct XDriveIOSPhotoAutoSchedulePolicyChecks {
  static func main() {
    let p = XDriveIOSPhotoAutoSchedulePolicy.self
    // An explicitly confirmed NEW plan starts first-pass catch-up; legacy
    // plans and deliberate prior opt-outs are never silently rewritten.
    precondition(p.initialCatchUpPreference(hasExistingPlan: false, savedPreference: nil))
    precondition(p.initialCatchUpPreference(hasExistingPlan: false, savedPreference: false))
    precondition(!p.initialCatchUpPreference(hasExistingPlan: true, savedPreference: nil))
    precondition(!p.initialCatchUpPreference(hasExistingPlan: true, savedPreference: false))
    precondition(p.initialCatchUpPreference(hasExistingPlan: true, savedPreference: true))
    // Existing schedules preserve whole-library coverage with absent field.
    precondition(p.storedStartRule(raw: nil, newOnlySince: nil) == .everything)
    precondition(p.storedStartRule(raw: "everything", newOnlySince: nil) == .everything)
    precondition(p.storedStartRule(raw: "onlyNew", newOnlySince: nil) == nil)
    precondition(p.storedStartRule(raw: "futureRule", newOnlySince: nil) == nil)
    // "Resume previous" is a UI operation, never a persisted scope.
    precondition(p.storedStartRule(raw: "resumePrevious", newOnlySince: nil) == nil)
    precondition(XDriveIOSPhotoAutoStartRule.allCases.contains(.resumePrevious))
    let enabledAt = Date(timeIntervalSince1970: 2_000_000)
    precondition(p.storedStartRule(raw: "onlyNew", newOnlySince: enabledAt) == .onlyNew)
    let prior = Date(timeIntervalSince1970: 1_999_990)
    let later = Date(timeIntervalSince1970: 2_000_010)
    precondition(p.newOnlyCandidate(capturedAt: prior, modifiedAt: prior, since: enabledAt)
                 == .olderThanStart)
    precondition(p.newOnlyCandidate(capturedAt: prior, modifiedAt: later, since: enabledAt)
                 == .eligible)
    precondition(p.newOnlyCandidate(capturedAt: enabledAt, modifiedAt: nil, since: enabledAt)
                 == .eligible)
    precondition(p.newOnlyCandidate(capturedAt: nil, modifiedAt: nil, since: enabledAt)
                 == .unknownDates)
    precondition(p.newOnlyCandidate(capturedAt: nil, modifiedAt: later, since: enabledAt)
                 == .eligible)
    // An old photo newly imported through PhotoKit history must be taken
    // from the durable inserted queue, not discarded by its capture date.
    // Conversely a positional fallback must not treat a historical image
    // whose dates predate consent as newly authorized.
    precondition(p.newOnlyCandidate(capturedAt: prior, modifiedAt: prior,
                                    since: enabledAt) == .olderThanStart)
    precondition(p.newOnlyCandidate(capturedAt: prior, modifiedAt: later,
                                    since: enabledAt) == .eligible)
    precondition(p.accepts(minutes: 15))
    precondition(p.accepts(minutes: 60))
    precondition(p.accepts(minutes: 1440))
    precondition(!p.accepts(minutes: 0) && !p.accepts(minutes: 1))
    precondition(p.nextWindow(current: 0, visibleTotal: 600, scanned: 256, uploaded: 1,
                              needsReview: false) == 1)
    precondition(p.nextWindow(current: 1, visibleTotal: 600, scanned: 256, uploaded: 3,
                              needsReview: false) == 2)
    // An OS-admitted background batch may confirm up to four new originals.
    // Its partial 256-slot window MUST repeat; only a fully scanned page
    // may advance to the next source segment.
    precondition(p.nextWindow(current: 0, visibleTotal: 600, scanned: 4, uploaded: 4,
                              needsReview: false) == 0)
    precondition(p.nextWindow(current: 0, visibleTotal: 600, scanned: 256, uploaded: 4,
                              needsReview: false) == 1)
    precondition(p.nextWindow(current: 2, visibleTotal: 600, scanned: 88, uploaded: 4,
                              needsReview: false) == 0)
    precondition(p.nextWindow(current: 0, visibleTotal: 600, scanned: 4, uploaded: 4,
                              needsReview: true) == 0)
    precondition(p.nextWindow(current: 2, visibleTotal: 600, scanned: 88, uploaded: 0,
                              needsReview: false) == 0)
    precondition(p.nextWindow(current: 1, visibleTotal: 600, scanned: 35, uploaded: 20,
                              needsReview: false) == 1)
    // Exactly the twentieth original at the last candidate is complete:
    // do not scan it all again or delay the next 256 candidates.
    precondition(p.nextWindow(current: 0, visibleTotal: 600, scanned: 256, uploaded: 20,
                              needsReview: false) == 1)
    precondition(p.nextWindow(current: 2, visibleTotal: 600, scanned: 88, uploaded: 20,
                              needsReview: false) == 0)
    // Expired PhotoKit history can be rebased only after a complete,
    // receipt-verified pass of every currently authorized window.
    precondition(p.fullReconciliationWindowComplete(
      currentWindow: 0, visibleTotal: 600, scanned: 256))
    precondition(p.fullReconciliationWindowComplete(
      currentWindow: 2, visibleTotal: 600, scanned: 88))
    precondition(p.fullReconciliationWindowComplete(
      currentWindow: 0, visibleTotal: 0, scanned: 0))
    precondition(!p.fullReconciliationWindowComplete(
      currentWindow: 0, visibleTotal: 600, scanned: 20))
    precondition(!p.fullReconciliationWindowComplete(
      currentWindow: 3, visibleTotal: 600, scanned: 0))
    precondition(p.fullReconciliationWindowVerified(
      scanned: 256, verified: 250, unsupported: 6, unavailable: 0,
      needsReview: 0, skippedBeforeBaseline: 0, queued: 0,
      stoppedForReview: false))
    precondition(!p.fullReconciliationWindowVerified(
      scanned: 256, verified: 255, unsupported: 0, unavailable: 1,
      needsReview: 0, skippedBeforeBaseline: 0, queued: 0,
      stoppedForReview: false))
    precondition(!p.fullReconciliationWindowVerified(
      scanned: 256, verified: 255, unsupported: 0, unavailable: 0,
      needsReview: 1, skippedBeforeBaseline: 0, queued: 0,
      stoppedForReview: true))
    precondition(!p.fullReconciliationWindowVerified(
      scanned: 256, verified: 255, unsupported: 0, unavailable: 0,
      needsReview: 0, skippedBeforeBaseline: 1, queued: 0,
      stoppedForReview: false))
    precondition(p.shouldCommitFullReconciliation(
      windowComplete: true, followingWindow: 0, passClean: true))
    precondition(!p.shouldCommitFullReconciliation(
      windowComplete: false, followingWindow: 0, passClean: true))
    precondition(!p.shouldCommitFullReconciliation(
      windowComplete: true, followingWindow: 0, passClean: false))
    precondition(!p.shouldCommitFullReconciliation(
      windowComplete: true, followingWindow: 1, passClean: true))
    // A capped partial segment or impossible oversized progress never advances.
    precondition(p.nextWindow(current: 0, visibleTotal: 600, scanned: 255, uploaded: 20,
                              needsReview: false) == 0)
    precondition(p.nextWindow(current: 0, visibleTotal: 600, scanned: 257, uploaded: 20,
                              needsReview: false) == 0)
    precondition(p.nextWindow(current: 1, visibleTotal: 600, scanned: 256, uploaded: 0,
                              needsReview: true) == 1)
    precondition(p.nextWindow(current: 99, visibleTotal: 100, scanned: 0, uploaded: 0,
                              needsReview: false) == 0)
    precondition(p.nextWindow(current: Int.max, visibleTotal: 100,
                              scanned: 0, uploaded: 0, needsReview: false) == 0)
    let now = Date(timeIntervalSince1970: 12345)
    precondition(p.nextDue(after: now, intervalMinutes: 60) ==
                 now.addingTimeInterval(3600))
    precondition(p.nextDue(after: now, intervalMinutes: -5) == nil)

    let fast = now.addingTimeInterval(60)
    let normal = now.addingTimeInterval(3600)
    func due(_ current: Int, _ next: Int, _ total: Int, _ scanned: Int,
             _ uploaded: Int, review: Bool = false, unchanged: Bool = true)
             -> Date? {
      p.nextDueAfterCompletedWindow(at: now, intervalMinutes: 60,
          currentWindow: current, followingWindow: next,
          visibleTotal: total, scanned: scanned, uploaded: uploaded,
          needsReview: review, libraryUnchanged: unchanged)
    }
    precondition(due(0,0,10000,20,20) == fast)
    precondition(due(0,1,10000,256,3) == fast)
    precondition(due(1,2,10000,256,0) == fast)
    precondition(due(39,0,10000,16,0) == normal)
    precondition(due(0,0,20,20,20) == normal)
    precondition(due(0,1,600,256,20) == fast)
    precondition(due(2,0,600,88,20) == normal)
    precondition(due(0,0,20,19,20) == normal)
    precondition(due(0,0,20,20,0) == normal)
    precondition(due(0,0,10000,30,1) == normal)
    precondition(due(0,1,10000,256,1,review:true) == normal)
    precondition(due(0,1,10000,256,1,unchanged:false) == normal)
    precondition(due(0,0,0,0,0) == normal)
    precondition(due(99,0,20,0,0) == normal)
    precondition(due(0,1,10000,257,0) == normal)
    precondition(due(0,1,10000,5,20) == normal)
    precondition(due(0,1,10000,256,21) == normal)
    precondition(p.nextDueAfterCompletedWindow(at:now,intervalMinutes:1,
      currentWindow:0,followingWindow:1,visibleTotal:10000,scanned:256,
      uploaded:0,needsReview:false,libraryUnchanged:true) == nil)
    // Priority PhotoKit revisions are settled before the positional scan.
    // A batch that uploads twenty queued originals without reading a slot
    // still has genuine backlog; only a separately verified queued count
    // authorizes the one-minute first-pass catch-up.
    func queuedDue(_ scanned: Int, _ uploaded: Int, _ queue: Int,
                   review: Bool = false, unchanged: Bool = true) -> Date? {
      p.nextDueAfterCompletedWindow(
        at: now, intervalMinutes: 60, currentWindow: 0, followingWindow: 0,
        visibleTotal: 10000, scanned: scanned, uploaded: uploaded,
        needsReview: review, libraryUnchanged: unchanged,
        queuedUploaded: queue
      )
    }
    precondition(queuedDue(0, 20, 20) == fast)
    precondition(queuedDue(0, 10, 10) == normal)
    precondition(queuedDue(0, 20, 19) == normal)
    precondition(queuedDue(0, 20, 21) == normal)
    precondition(queuedDue(0, 20, 20, review: true) == normal)
    precondition(queuedDue(0, 20, 20, unchanged: false) == normal)
    precondition(queuedDue(1, 20, 19) == fast)
    precondition(p.nextDueAfterCompletedWindow(
      at: now, intervalMinutes: 60, currentWindow: 0, followingWindow: 0,
      visibleTotal: 10000, scanned: 0, uploaded: 20,
      needsReview: false, libraryUnchanged: true
    ) == normal)
    // On the one-item final positional page, a different twenty-item
    // queue may already have uploaded originals. The caller must pass
    // windowUploaded=0, so this completed page still wraps normally.
    precondition(p.nextWindow(
      current: 2, visibleTotal: 513, scanned: 1,
      uploaded: 0, needsReview: false
    ) == 0)

    // A PhotoKit edit or new media wakes only a future due time. An already
    // scheduled earlier/due check is never postponed or requeued repeatedly.
    let soon = now.addingTimeInterval(5)
    precondition(p.earlierDueAfterLibraryChange(
      currentDueAt: normal, at: now) == soon)
    precondition(p.earlierDueAfterLibraryChange(
      currentDueAt: soon, at: now) == nil)
    precondition(p.earlierDueAfterLibraryChange(
      currentDueAt: now.addingTimeInterval(2), at: now) == nil)
    precondition(p.earlierDueAfterLibraryChange(
      currentDueAt: now.addingTimeInterval(-1), at: now) == nil)
    // A transient, confirmed pre-write network failure can bring the next
    // check forward, but never postpone an earlier due time or hot-loop.
    let retrySoon = now.addingTimeInterval(300)
    precondition(p.earlierDueAfterSafePrewriteNetworkFailure(
      currentDueAt: normal, at: now) == retrySoon)
    precondition(p.earlierDueAfterSafePrewriteNetworkFailure(
      currentDueAt: retrySoon, at: now) == nil)
    precondition(p.earlierDueAfterSafePrewriteNetworkFailure(
      currentDueAt: now.addingTimeInterval(-1), at: now) == nil)
    precondition(p.retryablePrewriteNetworkFailure(
      URLError(.notConnectedToInternet)))
    precondition(p.retryablePrewriteNetworkFailure(
      URLError(.networkConnectionLost)))
    precondition(p.retryablePrewriteNetworkFailure(
      URLError(.timedOut)))
    precondition(!p.retryablePrewriteNetworkFailure(
      URLError(.userAuthenticationRequired)))
    precondition(!p.retryablePrewriteNetworkFailure(
      URLError(.cancelled)))
    print("iOS foreground auto backup interval/cursor/catch-up/library wake/safe prewrite retry: PASS")
  }
}
