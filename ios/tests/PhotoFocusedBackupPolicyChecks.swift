import Foundation

@main struct XDriveIOSPhotoFocusedBackupPolicyChecks {
    static func main() {
        let p = XDriveIOSPhotoFocusedBackupPolicy.self
        let step = p.afterWindow
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
        print("iOS focused PhotoKit window progression and unsafe-retry stops: PASS")
    }
}
