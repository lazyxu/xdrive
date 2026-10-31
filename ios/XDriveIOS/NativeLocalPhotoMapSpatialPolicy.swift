import Foundation

/// Transient, in-memory grid of explicitly accessible PhotoKit GPS metadata.
/// Never writes GPS/PhotoKit localIdentifiers to disk, sync or the cloud.
/// Bounded to 64 representative identities even for a 100k-photo library.
enum XDriveIOSNativeLocalMapSpatialPolicy {
    static let maximumCells = 64
    static let maximumLevel = 16
    static let initialCellDegrees = 0.01

    struct Key: Hashable {
        let level: Int
        let latitudeCell: Int
        let longitudeCell: Int

        var id: String {
            "grid:\(level):\(latitudeCell):\(longitudeCell)"
        }
    }

    static func key(latitude: Double, longitude: Double, level: Int) -> Key? {
        guard (0...maximumLevel).contains(level),
              latitude.isFinite, longitude.isFinite,
              (-90...90).contains(latitude),
              (-180...180).contains(longitude) else { return nil }
        let step = initialCellDegrees * Double(1 << level)
        // Origin-aligned power-of-two grids ensure coarsening cannot split
        // a previously scanned cell or undercount its members.
        return Key(
            level: level,
            latitudeCell: Int(floor((latitude + 90) / step)),
            longitudeCell: Int(floor((longitude + 180) / step))
        )
    }
}

struct XDriveIOSNativeLocalMapSpatialCell<Payload>: Identifiable {
    let key: XDriveIOSNativeLocalMapSpatialPolicy.Key
    let representative: Payload
    let latitude: Double
    let longitude: Double
    let firstSeen: Int
    var count: Int

    var id: String { key.id }
}

/// Streaming aggregator: O(64) retained representative photos/coordinates,
/// O(1) expected metadata work per input photo, no full-library ID cache.
/// The scanner's PHChange/permission lease remains the source of authority.
struct XDriveIOSNativeLocalMapSpatialIndex<Payload> {
    typealias Policy = XDriveIOSNativeLocalMapSpatialPolicy
    typealias Cell = XDriveIOSNativeLocalMapSpatialCell<Payload>

    private(set) var level = 0
    private(set) var locatedCount = 0
    private var buckets: [Policy.Key: Cell] = [:]

    var cells: [Cell] {
        buckets.values.sorted {
            $0.count == $1.count ? $0.id < $1.id : $0.count > $1.count
        }
    }

    @discardableResult
    mutating func add(latitude: Double, longitude: Double, representative: Payload) -> Bool {
        guard let key = Policy.key(
            latitude: latitude, longitude: longitude, level: level
        ) else { return false }
        locatedCount += 1
        if var cell = buckets[key] {
            cell.count += 1
            buckets[key] = cell
        } else {
            buckets[key] = Cell(
                key: key, representative: representative,
                latitude: latitude, longitude: longitude,
                firstSeen: locatedCount, count: 1
            )
        }
        while buckets.count > Policy.maximumCells {
            guard level < Policy.maximumLevel else {
                // Valid Earth coordinates never exceed 64 cells at level 16.
                // Treat any impossible overflow as a programming error.
                preconditionFailure("unbounded native PhotoKit grid")
            }
            level += 1
            var next: [Policy.Key: Cell] = [:]
            next.reserveCapacity(min(buckets.count, Policy.maximumCells))
            for old in buckets.values {
                guard let newKey = Policy.key(
                    latitude: old.latitude, longitude: old.longitude, level: level
                ) else { preconditionFailure("invalid aggregate coordinate") }
                if var current = next[newKey] {
                    let combined = current.count + old.count
                    if old.firstSeen < current.firstSeen {
                        current = Cell(
                            key: newKey, representative: old.representative,
                            latitude: old.latitude, longitude: old.longitude,
                            firstSeen: old.firstSeen, count: combined
                        )
                    } else {
                        current.count = combined
                    }
                    next[newKey] = current
                } else {
                    next[newKey] = Cell(
                        key: newKey, representative: old.representative,
                        latitude: old.latitude, longitude: old.longitude,
                        firstSeen: old.firstSeen, count: old.count
                    )
                }
            }
            buckets = next
        }
        return true
    }
}
