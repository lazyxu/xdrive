import Foundation

/// Read-only, on-device PhotoKit metadata measurement. This is NOT a backed-up
/// byte count, photo decode benchmark, UI frame-time sample or cloud coverage.
struct XDriveIOSPhotoKitReadOnlyPerformanceSample: Equatable {
    let total: Int
    let scanned: Int
    let windows: Int
    let pages: Int
    let elapsedMS: Double
    let firstPageMS: Double
    let slowestPageMS: Double
    let peakResidentBytes: Int64?
    let measuredAt: Date

    var complete: Bool {
        guard total >= 0, scanned == total,
              windows == XDrivePhotoBackupScanWindow.count(visibleTotal: total),
              pages == (total == 0 ? 0 : 1 + (total - 1) / 64),
              elapsedMS.isFinite, elapsedMS >= 0,
              firstPageMS.isFinite, firstPageMS >= 0,
              slowestPageMS.isFinite, slowestPageMS >= firstPageMS,
              (peakResidentBytes == nil || peakResidentBytes! >= 0),
              measuredAt.timeIntervalSince1970.isFinite else { return false }
        return true
    }
}
