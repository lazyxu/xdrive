import Foundation
@main struct XDriveIOSPhotoAutoSchedulePolicyChecks {
  static func main() {
    let p = XDriveIOSPhotoAutoSchedulePolicy.self
    precondition(p.accepts(minutes: 15))
    precondition(p.accepts(minutes: 60))
    precondition(p.accepts(minutes: 1440))
    precondition(!p.accepts(minutes: 0) && !p.accepts(minutes: 1))
    precondition(p.nextWindow(current: 0, visibleTotal: 600, scanned: 256, uploaded: 1,
                              needsReview: false) == 1)
    precondition(p.nextWindow(current: 1, visibleTotal: 600, scanned: 256, uploaded: 3,
                              needsReview: false) == 2)
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
    print("iOS foreground auto backup interval/cursor/opt-in catch-up safety: PASS")
  }
}
