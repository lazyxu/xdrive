import Foundation

@main enum XDriveIOSPhotoKitReadOnlyPerformancePolicyChecks {
    static func main() {
        func sample(_ n: Int, scanned: Int? = nil, windows: Int? = nil,
                    pages: Int? = nil, elapsed: Double = 12,
                    peak: Int64? = 80 * 1024 * 1024)
            -> XDriveIOSPhotoKitReadOnlyPerformanceSample {
            XDriveIOSPhotoKitReadOnlyPerformanceSample(
                total: n, scanned: scanned ?? n,
                windows: windows ?? XDrivePhotoBackupScanWindow.count(visibleTotal: n),
                pages: pages ?? (n == 0 ? 0 : 1 + (n - 1) / 64),
                elapsedMS: elapsed, firstPageMS: 1, slowestPageMS: 3,
                peakResidentBytes: peak, measuredAt: Date()
            )
        }
        precondition(sample(0).complete)
        precondition(sample(10_000).complete)
        precondition(sample(100_000).complete)
        precondition(!sample(100_000, scanned: 99_999).complete)
        precondition(!sample(10_000, windows: 1).complete)
        precondition(!sample(100_000, pages: 1562).complete)
        precondition(!sample(10_000, elapsed: .nan).complete)
        precondition(!sample(10_000, peak: -1).complete)
        print("iOS Photos read-only real-device measurement sample integrity: PASS")
    }
}
