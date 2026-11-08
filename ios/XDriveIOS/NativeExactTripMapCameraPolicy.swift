import Foundation

/// Pure WGS84 camera framing. No PhotoKit, URLSession or MapKit references:
/// the caller passes only <=64 Server-verified trip location representatives.
/// Presentation-only bounds for a Server-verified aggregated trip region.
/// Never used as a PhotoAsset Range selector or permission to view members.
struct XDriveIOSNativeExactTripMapBounds {
    let west: Double
    let south: Double
    let east: Double
    let north: Double
}

struct XDriveIOSNativeExactTripMapPoint {
    let latitude: Double
    let longitude: Double
    var displayBounds: XDriveIOSNativeExactTripMapBounds? = nil
}

struct XDriveIOSNativeExactTripCameraFrame {
    let latitude: Double
    let longitude: Double
    let latitudeSpan: Double
    let longitudeSpan: Double
}

enum XDriveIOSNativeExactTripMapCameraPolicy {
    static func fit(_ points: [XDriveIOSNativeExactTripMapPoint])
        -> XDriveIOSNativeExactTripCameraFrame? {
        guard !points.isEmpty,
              points.count <= XDriveIOSNativeOwnerMapOverviewPolicy.maximumCells,
              points.allSatisfy({
                  $0.latitude.isFinite && $0.longitude.isFinite &&
                  abs($0.latitude) <= 90 && abs($0.longitude) <= 180
              })
        else { return nil }

        let latitudes = points.map(\.latitude)
        guard let minLat = latitudes.min(), let maxLat = latitudes.max()
        else { return nil }
        // Longitude lives on a circle, not a line. Cutting only at Greenwich
        // or the antimeridian can create a near-worldwide camera for three or
        // more genuine places. Cut instead at the largest GPS-free arc.
        // +180 and -180 are one WGS84 meridian.
        let longitudes = points.map { point -> Double in
            let angle = point.longitude.truncatingRemainder(dividingBy: 360)
            return angle < 0 ? angle + 360 : angle
        }.sorted()
        var largestGap = -1.0
        var firstCovered = longitudes[0]
        for index in longitudes.indices {
            let next = index + 1 == longitudes.count
                ? longitudes[0] + 360 : longitudes[index + 1]
            let gap = next - longitudes[index]
            if gap > largestGap {
                largestGap = gap
                firstCovered = next.truncatingRemainder(dividingBy: 360)
            }
        }
        let smallestSpan = max(0, 360 - largestGap)
        let midpoint = (firstCovered + smallestSpan / 2)
            .truncatingRemainder(dividingBy: 360)
        let longitude = midpoint > 180 ? midpoint - 360 : midpoint
        return XDriveIOSNativeExactTripCameraFrame(
            latitude: (minLat + maxLat) / 2,
            longitude: longitude,
            // Never clip genuine polar members with an arbitrary 160° cap.
            latitudeSpan: min(180, max(0.06, (maxLat - minLat) * 1.25)),
            longitudeSpan: min(359, max(0.06, smallestSpan * 1.25)))
    }
    /// Fit ALL of each verified aggregate's geographic region, not just its
    /// representative coordinate. Each [west,east] is a covered WGS84 arc;
    /// find the largest uncovered arc to avoid incorrectly cutting through
    /// a dateline-crossing aggregate or clipping distant trip locations.
    /// This is bounded to the same 64 trusted entries as fit(_:) and never
    /// creates new photo identities or an authorization range.
    static func fitIncludingDisplayBounds(_ points: [XDriveIOSNativeExactTripMapPoint])
        -> XDriveIOSNativeExactTripCameraFrame? {
        guard let ordinary = fit(points) else { return nil }
        guard points.contains(where: { $0.displayBounds != nil }) else {
            return ordinary
        }

        func circle(_ longitude: Double) -> Double {
            let angle = longitude.truncatingRemainder(dividingBy: 360)
            return angle < 0 ? angle + 360 : angle
        }
        var south = points.map(\.latitude).min()!
        var north = points.map(\.latitude).max()!
        var occupied: [(start: Double, end: Double)] = []
        occupied.reserveCapacity(points.count * 3)
        for point in points {
            let longitude = circle(point.longitude)
            occupied.append((start: longitude, end: longitude))
            guard let bounds = point.displayBounds else { continue }
            guard [bounds.west, bounds.east, bounds.south, bounds.north]
                .allSatisfy({ $0.isFinite }),
                (-180...180).contains(bounds.west),
                (-180...180).contains(bounds.east),
                (-90...90).contains(bounds.south),
                (-90...90).contains(bounds.north),
                bounds.south < bounds.north, bounds.west != bounds.east
            else { return nil }
            south = min(south, bounds.south)
            north = max(north, bounds.north)
            let arcWidth = bounds.west < bounds.east
                ? bounds.east - bounds.west
                : 360 - bounds.west + bounds.east
            let start = circle(bounds.west)
            let end = start + arcWidth
            if end <= 360 {
                occupied.append((start: start, end: end))
            } else {
                occupied.append((start: start, end: 360))
                occupied.append((start: 0, end: end - 360))
            }
        }
        occupied.sort {
            $0.start == $1.start ? $0.end < $1.end : $0.start < $1.start
        }
        var merged: [(start: Double, end: Double)] = []
        merged.reserveCapacity(occupied.count)
        for part in occupied {
            if let previous = merged.last, part.start <= previous.end {
                merged[merged.count - 1].end = max(previous.end, part.end)
            } else {
                merged.append(part)
            }
        }
        guard let first = merged.first else { return nil }
        var largestGap = -1.0
        var firstCovered = first.start
        for index in merged.indices {
            let next = index + 1 < merged.count
                ? merged[index + 1].start : first.start + 360
            let gap = max(0, next - merged[index].end)
            if gap > largestGap {
                largestGap = gap
                firstCovered = next.truncatingRemainder(dividingBy: 360)
            }
        }
        let smallestSpan = max(0, 360 - largestGap)
        let midpoint = (firstCovered + smallestSpan / 2)
            .truncatingRemainder(dividingBy: 360)
        return XDriveIOSNativeExactTripCameraFrame(
            latitude: (south + north) / 2,
            longitude: midpoint > 180 ? midpoint - 360 : midpoint,
            latitudeSpan: min(180, max(0.06, (north - south) * 1.25)),
            // A full-world display rectangle is 360 degrees, not 359.
            longitudeSpan: min(360, max(0.06, smallestSpan * 1.25)))
    }

}
