import Foundation

@main struct XDriveIOSPhotoFocusedBackupPolicyChecks {
    static func main() {
        let p = XDriveIOSPhotoFocusedBackupPolicy.self
        let step = p.afterWindow
        // Completed boundaries persist; a partially scanned capped window
        // and a fully completed final window have no next checkpoint.
        precondition(p.validCheckpoint(completedWindow: 0, nextWindow: 1,
                                       visibleTotal: 600))
        precondition(p.validCheckpoint(completedWindow: 1, nextWindow: 2,
                                       visibleTotal: 600))
        precondition(!p.validCheckpoint(completedWindow: 1, nextWindow: 1,
                                        visibleTotal: 600))
        precondition(!p.validCheckpoint(completedWindow: 1, nextWindow: 3,
                                        visibleTotal: 600))
        precondition(!p.validCheckpoint(completedWindow: 0, nextWindow: 1,
                                        visibleTotal: 256))
        precondition(!p.validCheckpoint(completedWindow: -1, nextWindow: 0,
                                        visibleTotal: 600))
        precondition(!p.validCheckpoint(completedWindow: Int.max, nextWindow: 0,
                                        visibleTotal: 600))
        precondition(!p.validCheckpoint(completedWindow: 0, nextWindow: 1,
                                        visibleTotal: 0))
        precondition(p.validCheckpoint(completedWindow: 389, nextWindow: 390,
                                       visibleTotal: 100_000))
        precondition(!p.validCheckpoint(completedWindow: 390, nextWindow: 391,
                                        visibleTotal: 100_000))

        func resume(_ requested: Int, _ priorTotal: Int, _ currentTotal: Int,
                    _ oldAuthorization: Int = 3, _ newAuthorization: Int = 3,
                    _ unchanged: Bool = true,
                    _ priorCloud: Bool = false, _ cloud: Bool = false) -> Int {
            p.trustedResumeWindow(
                requested: requested,
                previousVisible: priorTotal, currentVisible: currentTotal,
                priorAuthorization: oldAuthorization,
                currentAuthorization: newAuthorization,
                tokenUnchanged: unchanged,
                previousAllowICloud: priorCloud, allowICloud: cloud
            )
        }
        precondition(resume(1, 600, 600) == 1)
        precondition(resume(2, 600, 600) == 2)
        precondition(resume(390, 100_000, 100_000) == 390)
        precondition(resume(1, 600, 600, 3, 4) == 0)
        precondition(resume(1, 600, 600, 3, 3, false) == 0)
        precondition(resume(1, 600, 601) == 0)
        precondition(resume(1, 600, 600, 3, 3, true, false, true) == 0)
        precondition(resume(1, 600, 600, 3, 3, true, true, false) == 0)
        precondition(resume(0, 600, 600) == 0)
        precondition(resume(-1, 600, 600) == 0)
        precondition(resume(Int.max, 600, 600) == 0)
        precondition(resume(3, 600, 600) == 0)
        precondition(resume(1, 0, 0) == 0)
        precondition(resume(1, 256, 256) == 0)
        // The iCloud mode and authorization may be equal after an actual
        // restart, but no generation equality means no checkpoint reuse.
        precondition(resume(1, 600, 600, 4, 4, false, true, true) == 0)
        precondition(step(0, 0, 0, 0, false) == .finished)
        precondition(step(0, 256, 20, 20, false) == .repeatWindow(0))
        precondition(step(0, 256, 256, 20, false) == .finished)
        precondition(step(0, 600, 256, 12, false) == .nextWindow(1))
        precondition(step(1, 600, 30, 20, false) == .repeatWindow(1))
        precondition(step(1, 600, 256, 20, false) == .nextWindow(2))
        precondition(step(2, 600, 88, 0, false) == .finished)
        precondition(step(2, 600, 88, 20, false) == .finished)
        precondition(step(0, 600, 5, 0, true) == .pausedForReview)
        precondition(step(0, 600, 20, 20, true) == .pausedForReview)
        precondition(step(0, 600, 0, 0, true) == .pausedForReview)
        precondition(step(0, 600, 5, 0, false) == .invalidProgress)
        precondition(step(0, 600, 10, 20, false) == .invalidProgress)
        precondition(step(0, 600, 257, 1, false) == .invalidProgress)
        precondition(step(3, 600, 0, 0, false) == .invalidProgress)
        precondition(step(-1, 600, 0, 0, false) == .invalidProgress)
        precondition(step(Int.max, 600, 0, 0, false) == .invalidProgress)
        precondition(step(0, -1, 0, 0, false) == .invalidProgress)
        precondition(step(0, 0, 1, 0, false) == .invalidProgress)
        precondition(step(0, 0, 0, 0, true) == .invalidProgress)
        // 100k assets occupy 391 windows; a complete final short window
        // terminates instead of re-scanning the newest 256 forever.
        precondition(XDrivePhotoBackupScanWindow.count(visibleTotal: 100_000) == 391)
        precondition(step(389, 100_000, 256, 0, false) == .nextWindow(390))
        precondition(step(390, 100_000, 160, 0, false) == .finished)
        var window = 0
        var windowsChecked = 0
        var finished = false
        while !finished {
            let offset = XDrivePhotoBackupScanWindow.offset(for: window)!
            let checked = XDrivePhotoBackupScanWindow.capacity(
                visibleTotal: 100_000, offset: offset
            )
            windowsChecked += 1
            switch step(window, 100_000, checked, 0, false) {
            case .nextWindow(let next):
                precondition(next == window + 1)
                window = next
            case .finished:
                precondition(windowsChecked == 391 && window == 390)
                finished = true
            default:
                preconditionFailure("safe 100k read-only pass must advance")
            }
            precondition(windowsChecked <= 391)
        }
        print("iOS focused PhotoKit window progression and unsafe-retry stops: PASS")
    }
}
