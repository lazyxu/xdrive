import Foundation

/// One read-only, transient progress fraction for the currently selected
/// 256-slot PhotoKit backup window. No ledger or current-Owner Node proof
/// can be derived from the fraction of *scanned* slots.
struct XDriveIOSNativeBackupWindowReadProgress: Equatable {
    let capacity: Int
    let scanned: Int
    let confirmed: Int
    let unavailable: Int
    let needsReview: Int
    let unsupported: Int

    var remaining: Int { capacity - scanned }
    var fractionScanned: Double {
        Double(scanned) / Double(capacity)
    }

    static func current(
        totalVisible: Int, startOffset: Int, scanned: Int,
        uploaded: Int, verifiedAlready: Int, unavailable: Int,
        needsReview: Int, unsupported: Int
    ) -> Self? {
        let capacity = XDrivePhotoBackupScanWindow.capacity(
            visibleTotal: totalVisible, offset: startOffset
        )
        guard capacity > 0, capacity <= XDrivePhotoBackupScanWindow.maxItems,
              scanned >= 0, scanned <= capacity else { return nil }

        // Operation outcome counts cannot exceed the number of slots read.
        // Verify subtraction rather than summing untrusted counts, so even
        // impossible Int.max inputs cannot overflow the read-only UI.
        var unclassified = scanned
        for value in [uploaded, verifiedAlready, unavailable, needsReview, unsupported] {
            guard value >= 0, value <= unclassified else { return nil }
            unclassified -= value
        }
        return Self(
            capacity: capacity, scanned: scanned,
            confirmed: uploaded + verifiedAlready,
            unavailable: unavailable, needsReview: needsReview,
            unsupported: unsupported
        )
    }
}
