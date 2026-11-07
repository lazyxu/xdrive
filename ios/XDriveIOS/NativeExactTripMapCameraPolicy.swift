import Foundation

/// Pure WGS84 camera framing. No PhotoKit, URLSession or MapKit references:
/// the caller passes only <=64 Server-verified trip location representatives.
struct XDriveIOSNativeExactTripMapPoint {
    let latitude: Double
    let longitude: Double
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
}
