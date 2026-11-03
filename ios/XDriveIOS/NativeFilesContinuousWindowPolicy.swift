import Foundation

/// Bounded native Files scrolling: Server ranges remain 64 entries while the
/// SwiftUI list keeps at most four adjacent ranges. Large folders and global
/// search results are never fully materialized on the iPhone.
enum XDriveIOSNativeFilesContinuousWindowPolicy {
    static let pageSize = 64
    static let maximumVisibleItems = 4 * pageSize
    static let maximumTotal = 10_000_000

    enum Direction: Equatable {
        case previous
        case next
    }

    struct MergePlan: Equatable {
        let startOffset: Int
        let dropFromFront: Int
        let dropFromBack: Int
    }

    static func requestedOffset(direction: Direction, startOffset: Int,
                                loadedCount: Int, total: Int) -> Int? {
        guard startOffset >= 0, startOffset % pageSize == 0,
              total > 0, total <= maximumTotal,
              loadedCount > 0, loadedCount <= maximumVisibleItems,
              startOffset + loadedCount <= total,
              loadedCount % pageSize == 0 || startOffset + loadedCount == total
        else { return nil }
        switch direction {
        case .previous:
            return startOffset >= pageSize ? startOffset - pageSize : nil
        case .next:
            let end = startOffset + loadedCount
            return end < total && end % pageSize == 0 ? end : nil
        }
    }

    /// Reject shifted or repeated identities and changed totals rather than
    /// appending a potentially stale overlapping Server range.
    static func mergePlan(direction: Direction, startOffset: Int,
                          currentIDs: [UInt64], incomingIDs: [UInt64],
                          pageOffset: Int, total: Int,
                          returnedTotal: Int) -> MergePlan? {
        guard total == returnedTotal,
              let expectedOffset = requestedOffset(
                  direction: direction, startOffset: startOffset,
                  loadedCount: currentIDs.count, total: total
              ), pageOffset == expectedOffset,
              !incomingIDs.isEmpty, incomingIDs.count <= pageSize,
              incomingIDs.count == min(pageSize, total - pageOffset),
              Set(currentIDs).count == currentIDs.count,
              Set(incomingIDs).count == incomingIDs.count,
              currentIDs.allSatisfy({ $0 > 0 }),
              incomingIDs.allSatisfy({ $0 > 0 }),
              Set(currentIDs).isDisjoint(with: Set(incomingIDs)) else { return nil }

        let combined = currentIDs.count + incomingIDs.count
        guard combined > currentIDs.count else { return nil }
        if direction == .next {
            // Drop whole old pages only, keeping the next range aligned.
            let drop = combined > maximumVisibleItems ? pageSize : 0
            return MergePlan(startOffset: startOffset + drop,
                             dropFromFront: drop, dropFromBack: 0)
        }

        // A reverse window near the end may have a partial last page.
        // Retire the short suffix, then full pages, to preserve alignment.
        let overflow = max(0, combined - maximumVisibleItems)
        let partialTail = currentIDs.count % pageSize
        let drop: Int
        if overflow == 0 {
            drop = 0
        } else if overflow <= partialTail {
            drop = partialTail
        } else {
            let remaining = overflow - partialTail
            drop = partialTail + ((remaining + pageSize - 1) / pageSize) * pageSize
        }
        guard drop < currentIDs.count + incomingIDs.count,
              drop <= currentIDs.count else { return nil }
        return MergePlan(startOffset: pageOffset,
                         dropFromFront: 0, dropFromBack: drop)
    }
}
