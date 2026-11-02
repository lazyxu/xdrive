import Foundation

/// Numeric-only cursor for one current, authenticated Server PhotoAsset Range.
/// The policy contains no Owner credentials, Node IDs, signed URLs or media.
enum XDriveIOSNativePhotoAssetRangeCursorPolicy {
    static let pageSize = 48
    static let maximumTotal = 10_000_000

    static func validPage(offset: Int, count: Int, total: Int) -> Bool {
        total > 0 && total <= maximumTotal &&
        offset >= 0 && offset < total && offset % pageSize == 0 &&
        count > 0 && count <= pageSize &&
        count == min(pageSize, total - offset)
    }

    /// A next/previous action is admitted only from the LAST/FIRST loaded
    /// slot of this exact 48-item page. Skipping unknown Server rows or
    /// several arbitrary pages is deliberately not allowed.
    static func adjacentOffset(
        current: Int, count: Int, total: Int,
        selectedIndex: Int, direction: Int
    ) -> Int? {
        guard validPage(offset: current, count: count, total: total),
              selectedIndex >= 0 && selectedIndex < count,
              direction == -1 || direction == 1 else { return nil }
        if direction < 0 {
            guard selectedIndex == 0, current >= pageSize else { return nil }
            return current - pageSize
        }
        guard selectedIndex == count - 1, current < total - count else {
            return nil
        }
        return current + pageSize
    }
}
