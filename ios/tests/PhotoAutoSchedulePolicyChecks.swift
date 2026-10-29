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
    print("iOS foreground auto backup interval/cursor safety: PASS")
  }
}
