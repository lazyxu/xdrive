import Foundation

/// Short-lived camera viewport; west > east represents dateline crossing.
/// It is a WGS84 display filter, not a photo-content authorization token.
struct XDriveIOSNativeLocalMapViewport: Equatable {
    let west: Double
    let south: Double
    let east: Double
    let north: Double
}

/// Transient, in-memory grid of explicitly accessible PhotoKit GPS metadata.
/// Never writes GPS/PhotoKit localIdentifiers to disk, sync or the cloud.
/// Bounded to 64 representative identities even for a 100k-photo library.
enum XDriveIOSNativeLocalMapSpatialPolicy {
    static let maximumCells = 64
    static let maximumLevel = 16
    static let initialCellDegrees = 0.01

    static func viewportBounds(
        latitude: Double, longitude: Double,
        latitudeSpan: Double, longitudeSpan: Double
    ) -> XDriveIOSNativeLocalMapViewport? {
        guard latitude.isFinite && abs(latitude) <= 90,
              longitude.isFinite && abs(longitude) <= 180,
              latitudeSpan.isFinite && latitudeSpan > 0 && latitudeSpan <= 180,
              longitudeSpan.isFinite && longitudeSpan > 0 && longitudeSpan <= 360
        else { return nil }
        let south = max(-90.0, latitude - latitudeSpan / 2)
        let north = min(90.0, latitude + latitudeSpan / 2)
        guard south < north else { return nil }
        if longitudeSpan >= 360 {
            return XDriveIOSNativeLocalMapViewport(
                west: -180, south: south, east: 180, north: north
            )
        }
        func normalized(_ value: Double) -> Double {
            var angle = value.truncatingRemainder(dividingBy: 360)
            if angle > 180 { angle -= 360 }
            if angle < -180 { angle += 360 }
            return angle
        }
        let west = normalized(longitude - longitudeSpan / 2)
        let east = normalized(longitude + longitudeSpan / 2)
        guard west != east else { return nil }
        return XDriveIOSNativeLocalMapViewport(
            west: west, south: south, east: east, north: north
        )
    }

    static func includes(
        _ viewport: XDriveIOSNativeLocalMapViewport?,
        latitude: Double, longitude: Double
    ) -> Bool {
        guard latitude.isFinite && longitude.isFinite,
              (-90...90).contains(latitude), (-180...180).contains(longitude)
        else { return false }
        guard let viewport else { return true }
        guard latitude >= viewport.south && latitude <= viewport.north else {
            return false
        }
        // WGS84 uses two numeric encodings for the same antimeridian.
        // A camera ending at +180 includes EXIF -180, and vice versa.
        let boundaryLongitude = longitude == -180 && viewport.east == 180 ? 180 :
            longitude == 180 && viewport.west == -180 ? -180 : longitude
        if viewport.west <= viewport.east {
            return boundaryLongitude >= viewport.west && boundaryLongitude <= viewport.east
        }
        return boundaryLongitude >= viewport.west || boundaryLongitude <= viewport.east
    }

    /// A bounded cell album belongs to the WGS84 camera scanned. MapKit
    /// round-off is allowed; a real camera gesture revokes old Cell actions.
    static func matchesViewport(
        _ scanned: XDriveIOSNativeLocalMapViewport,
        current: XDriveIOSNativeLocalMapViewport?
    ) -> Bool {
        guard let current,
              [scanned.west, scanned.south, scanned.east, scanned.north,
               current.west, current.south, current.east, current.north]
                .allSatisfy({ $0.isFinite }) else { return false }
        let latTolerance = max(0.00001, (scanned.north - scanned.south) * 0.02)
        let longitudeSpan = scanned.west <= scanned.east
            ? scanned.east - scanned.west : 360 - scanned.west + scanned.east
        let lonTolerance = max(0.00001, longitudeSpan * 0.02)
        func longitudeDistance(_ a: Double, _ b: Double) -> Double {
            let delta = abs(a - b).truncatingRemainder(dividingBy: 360)
            return min(delta, 360 - delta)
        }
        return abs(scanned.south - current.south) <= latTolerance &&
               abs(scanned.north - current.north) <= latTolerance &&
               longitudeDistance(scanned.west, current.west) <= lonTolerance &&
               longitudeDistance(scanned.east, current.east) <= lonTolerance
    }

    /// An MKClusterAnnotation is just a visual union. A tap must select a
    /// nonempty, distinct, bounded subset of the CURRENT PhotoKit cells,
    /// never a stale or fabricated aggregate cell identity.
    static func acceptsCellSelection(
        selectedIDs: [String], currentCellIDs: [String]
    ) -> Bool {
        guard !selectedIDs.isEmpty, selectedIDs.count <= maximumCells,
              currentCellIDs.count <= maximumCells,
              !selectedIDs.contains(""), !currentCellIDs.contains("") else {
            return false
        }
        let selected = Set(selectedIDs)
        let current = Set(currentCellIDs)
        return selected.count == selectedIDs.count &&
            current.count == currentCellIDs.count &&
            selected.isSubset(of: current)
    }

    /// An old MapKit annotation may retain its grid ID, photo count and
    /// representative local ID while the latest PhotoKit scan has a different
    /// representative GPS point or insertion order. Do not open that old pin.
    /// This is an in-memory snapshot check; actual PhotoKit permission and
    /// live Viewer admission remain independently required.
    static func matchesCurrentCell<Payload>(
        _ chosen: XDriveIOSNativeLocalMapSpatialCell<Payload>,
        current: XDriveIOSNativeLocalMapSpatialCell<Payload>,
        representativeID: (Payload) -> String
    ) -> Bool {
        let chosenID = representativeID(chosen.representative)
        let currentID = representativeID(current.representative)
        guard chosen.count > 0, current.count > 0,
              chosen.firstSeen > 0, current.firstSeen > 0,
              !chosenID.isEmpty, !currentID.isEmpty else { return false }
        return chosen.key == current.key &&
               chosen.count == current.count &&
               chosen.firstSeen == current.firstSeen &&
               chosen.latitude == current.latitude &&
               chosen.longitude == current.longitude &&
               chosenID == currentID &&
               key(latitude: chosen.latitude, longitude: chosen.longitude,
                   level: chosen.key.level) == chosen.key &&
               key(latitude: current.latitude, longitude: current.longitude,
                   level: current.key.level) == current.key
    }

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
        // +180 and -180 are the same WGS84 meridian. Canonicalize the grid
        // identity too, not only viewport inclusion, so the same GPS place
        // cannot appear as two count-bearing cells at the antimeridian.
        let wrappedLongitude = longitude == 180 ? -180 : longitude
        // Origin-aligned power-of-two grids ensure coarsening cannot split
        // a previously scanned cell or undercount its members.
        return Key(
            level: level,
            latitudeCell: Int(floor((latitude + 90) / step)),
            longitudeCell: Int(floor((wrappedLongitude + 180) / step))
        )
    }
}



/// The scanned PhotoKit viewport may be larger than the visible camera.
/// Validate that every visible camera coordinate stays inside the bounded,
/// currently verified scan, including WGS84 antimeridian wrap.
extension XDriveIOSNativeLocalMapSpatialPolicy {
    static func containsViewport(
        _ scanned: XDriveIOSNativeLocalMapViewport,
        current: XDriveIOSNativeLocalMapViewport?
    ) -> Bool {
        guard let current,
              [scanned.west, scanned.south, scanned.east, scanned.north,
               current.west, current.south, current.east, current.north]
                .allSatisfy({ $0.isFinite }),
              scanned.south <= scanned.north,
              current.south <= current.north,
              (-90...90).contains(scanned.south),
              (-90...90).contains(scanned.north),
              (-90...90).contains(current.south),
              (-90...90).contains(current.north),
              (-180...180).contains(scanned.west),
              (-180...180).contains(scanned.east),
              (-180...180).contains(current.west),
              (-180...180).contains(current.east),
              current.south >= scanned.south - 0.0000001,
              current.north <= scanned.north + 0.0000001
        else { return false }

        func width(_ v: XDriveIOSNativeLocalMapViewport) -> Double {
            v.west <= v.east ? v.east - v.west :
                360 - v.west + v.east
        }
        let outer = width(scanned)
        let inner = width(current)
        guard outer > 0, inner > 0, inner <= outer + 0.0000001
        else { return false }
        if outer >= 359.999999 { return true }
        let delta = (current.west - scanned.west)
            .truncatingRemainder(dividingBy: 360)
        let start = delta < 0 ? delta + 360 : delta
        return start <= outer + 0.0000001 &&
               start + inner <= outer + 0.0000001
    }
}

/// A selective automatic refinement is NOT a new PhotoKit index: each actual
/// scan still keeps <=64 representative cells. Only when the settled camera
/// needs a new geographic scope do we rescan, never on every MapKit drag.
enum XDriveIOSNativeLocalMapAutoRefinePolicy {
    static let settleNanoseconds: UInt64 = 900_000_000
    // No more than two previously verified spatial windows survive in memory
    // during a single uninterrupted, observed PhotoKit generation.
    static let maximumCachedWindows = 2
    static let maximumLatencySamples = 32

    static func canReuse(
        cached: XDriveIOSNativeLocalMapViewport,
        camera: XDriveIOSNativeLocalMapViewport
    ) -> Bool {
        XDriveIOSNativeLocalMapSpatialPolicy.containsViewport(
            cached, current: camera
        ) && !shouldRefine(camera, scanned: cached)
    }

    /// Nearest-rank empirical percentiles, based ONLY on measured non-negative
    /// monotonic milliseconds. Never derive timings from synthetic photo
    /// counts; the consumer keeps the last 32 actual completed scans.
    static func scanPercentiles(
        _ milliseconds: [Double]
    ) -> (p50: Double, p95: Double)? {
        guard !milliseconds.isEmpty,
              milliseconds.count <= maximumLatencySamples,
              milliseconds.allSatisfy({ $0.isFinite && $0 >= 0 }) else {
            return nil
        }
        let ordered = milliseconds.sorted()
        func quantile(_ fraction: Double) -> Double {
            let index = max(0, Int(ceil(fraction * Double(ordered.count))) - 1)
            return ordered[index]
        }
        return (p50: quantile(0.5), p95: quantile(0.95))
    }

    static let maximumLatitudeSpan = 24.0
    static let maximumLongitudeSpan = 48.0

    static func expandedViewport(
        latitude: Double, longitude: Double,
        latitudeSpan: Double, longitudeSpan: Double
    ) -> XDriveIOSNativeLocalMapViewport? {
        guard latitudeSpan.isFinite, longitudeSpan.isFinite,
              latitudeSpan > 0, longitudeSpan > 0 else { return nil }
        return XDriveIOSNativeLocalMapSpatialPolicy.viewportBounds(
            latitude: latitude, longitude: longitude,
            latitudeSpan: min(180, latitudeSpan * 2),
            longitudeSpan: min(360, longitudeSpan * 2)
        )
    }

    static func shouldRefine(
        _ camera: XDriveIOSNativeLocalMapViewport,
        scanned: XDriveIOSNativeLocalMapViewport?
    ) -> Bool {
        let visibleLatitude = camera.north - camera.south
        let visibleLongitude = camera.west <= camera.east ?
            camera.east - camera.west : 360 - camera.west + camera.east
        guard visibleLatitude.isFinite, visibleLongitude.isFinite,
              visibleLatitude > 0, visibleLongitude > 0,
              visibleLatitude <= maximumLatitudeSpan,
              visibleLongitude <= maximumLongitudeSpan
        else { return false }
        guard let scanned else { return true }

        if !XDriveIOSNativeLocalMapSpatialPolicy.containsViewport(
            scanned, current: camera
        ) { return true }

        let scannedLatitude = scanned.north - scanned.south
        let scannedLongitude = scanned.west <= scanned.east ?
            scanned.east - scanned.west : 360 - scanned.west + scanned.east
        // Once the camera has zoomed >=4x inside the last overscan, a finer
        // 64-cell grid is useful. Ordinary pan inside overscan is free.
        return visibleLatitude * 4 <= scannedLatitude &&
               visibleLongitude * 4 <= scannedLongitude
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
