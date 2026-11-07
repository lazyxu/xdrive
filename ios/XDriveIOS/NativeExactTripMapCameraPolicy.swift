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
        let longitudes = points.map(\.longitude)
        guard let minLat = latitudes.min(), let maxLat = latitudes.max(),
              let rawMin = longitudes.min(), let rawMax = longitudes.max()
        else { return nil }
        let shifted = longitudes.map { $0 < 0 ? $0 + 360 : $0 }
        guard let shiftedMin = shifted.min(), let shiftedMax = shifted.max()
        else { return nil }
        let unwrappedSpan = rawMax - rawMin
        let wrappedSpan = shiftedMax - shiftedMin
        let wrap = wrappedSpan < unwrappedSpan
        let smallestSpan = wrap ? wrappedSpan : unwrappedSpan
        let midpoint = wrap ? (shiftedMin + shiftedMax) / 2 :
            (rawMin + rawMax) / 2
        let longitude = midpoint > 180 ? midpoint - 360 : midpoint
        return XDriveIOSNativeExactTripCameraFrame(
            latitude: (minLat + maxLat) / 2,
            longitude: longitude,
            latitudeSpan: min(160, max(0.06, (maxLat - minLat) * 1.25)),
            longitudeSpan: min(359, max(0.06, smallestSpan * 1.25)))
    }
}
