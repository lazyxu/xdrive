import Foundation

/// A transient range in one currently authorized PhotoKit fetch result.
/// Indices are never durable PhotoKit identities or proof of backup completion.
enum XDrivePhotoBackupScanWindow {
    static let maxItems = 256

    /// Return one empty selectable window when the visible library is empty.
    /// (total - 1) avoids overflowing for Int.max.
    static func count(visibleTotal: Int) -> Int {
        guard visibleTotal > 0 else { return 1 }
        return 1 + (visibleTotal - 1) / maxItems
    }

    /// Never overflow when deriving a user-selected page offset.
    static func offset(for index: Int) -> Int? {
        guard index >= 0, index <= Int.max / maxItems else { return nil }
        return index * maxItems
    }

    /// A stale user-selected offset stays empty if permissions shrink.
    /// Silently jumping back to offset zero could reupload newer originals.
    static func capacity(visibleTotal: Int, offset: Int) -> Int {
        guard visibleTotal > 0, offset >= 0, offset < visibleTotal else {
            return 0
        }
        return min(maxItems, visibleTotal - offset)
    }
}
