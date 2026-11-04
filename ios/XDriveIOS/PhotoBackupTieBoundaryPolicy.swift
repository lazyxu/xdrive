import Foundation

/// Maps a bounded group of equal-date PhotoKit assets to a deterministic
/// logical order. PhotoKit IDs are used transiently and never persisted.
enum XDrivePhotoBackupTieBoundaryPolicy {
    static let maximumGroupSize = 4096

    struct Slot: Equatable {
        let logicalIndex: Int
        let physicalIndex: Int
    }

    static func mappingForGroup(
        identifiers: [String], groupStart: Int,
        windowStart: Int, windowEnd: Int
    ) -> [Slot]? {
        guard !identifiers.isEmpty, identifiers.count <= maximumGroupSize,
              groupStart >= 0, windowStart >= 0, windowEnd >= windowStart,
              groupStart <= Int.max - identifiers.count,
              identifiers.allSatisfy({ !$0.isEmpty }),
              Set(identifiers).count == identifiers.count else { return nil }
        let sorted = identifiers.enumerated().sorted {
            $0.element.utf8.lexicographicallyPrecedes($1.element.utf8)
        }
        let lower = max(groupStart, windowStart)
        let upper = min(groupStart + identifiers.count, windowEnd)
        guard lower < upper else { return [] }
        return (lower..<upper).map { logical in
            Slot(logicalIndex: logical,
                 physicalIndex: groupStart + sorted[logical - groupStart].offset)
        }
    }
}
