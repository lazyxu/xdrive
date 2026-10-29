import Foundation

/// Pure, testable foreground-only schedule policy. An iOS system BGTask may
/// run later but must never be misreported as an exact minute scheduler.
enum XDriveIOSPhotoAutoSchedulePolicy {
    static let supportedMinutes = [15, 60, 360, 1440]
    static let windowSize = 256
    static let maxNewFiles = 20

    static func accepts(minutes: Int) -> Bool {
        supportedMinutes.contains(minutes)
    }

    static func nextWindow(current: Int, visibleTotal: Int,
                           scanned: Int, uploaded: Int,
                           needsReview: Bool) -> Int {
        guard !needsReview, current >= 0, visibleTotal > 0,
              scanned >= 0, uploaded >= 0 else { return current }
        let offset = current > Int.max / windowSize
            ? Int.max : current * windowSize
        let capacity = offset >= visibleTotal ? 0 : min(windowSize, visibleTotal - offset)
        // When 20 new uploads stop midway, repeat this window next time.
        // Ledger SHA/Owner verification skips real confirmed originals.
        guard scanned >= capacity && uploaded < maxNewFiles else { return current }
        let count = 1 + (visibleTotal - 1) / windowSize
        if current >= count { return 0 }
        return (current + 1) % count
    }

    static func nextDue(after now: Date, intervalMinutes: Int) -> Date? {
        guard accepts(minutes: intervalMinutes) else { return nil }
        return now.addingTimeInterval(TimeInterval(intervalMinutes * 60))
    }
}
