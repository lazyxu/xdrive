import Foundation

/// Camera framing is a display policy only. Source/Owner membership is still
/// proved by the underlying bounded PhotoKit and signed cloud readers.
enum XDriveIOSNativeUnifiedMapCameraPolicy {
    struct Point {
        let latitude: Double
        let longitude: Double
    }
    struct Fit {
        let latitude: Double
        let longitude: Double
        let latitudeDelta: Double
        let longitudeDelta: Double
    }

    static func fit(_ points: [Point]) -> Fit? {
        let valid = points.filter {
            $0.latitude.isFinite && $0.longitude.isFinite &&
            (-90.0...90.0).contains($0.latitude) &&
            (-180.0...180.0).contains($0.longitude)
        }
        guard !valid.isEmpty else { return nil }
        let south = valid.map(\.latitude).min()!
        let north = valid.map(\.latitude).max()!
        let sorted = valid.map { point -> Double in
            let value = point.longitude + 180.0
            return (value.truncatingRemainder(dividingBy: 360.0) + 360.0)
                .truncatingRemainder(dividingBy: 360.0)
        }.sorted()
        var largestGap = -1.0
        var gapIndex = 0
        for index in sorted.indices {
            let next = index + 1 == sorted.count ? sorted[0] + 360.0 : sorted[index + 1]
            let gap = next - sorted[index]
            if gap > largestGap { largestGap = gap; gapIndex = index }
        }
        // Complement of the largest gap is the shortest circular arc containing
        // all GPS representatives, including points straddling ±180 longitude.
        let arc = max(0.0, 360.0 - largestGap)
        let start = sorted[(gapIndex + 1) % sorted.count]
        let wrappedCenter = (start + arc / 2)
            .truncatingRemainder(dividingBy: 360.0)
        let centerLongitude = wrappedCenter + 180.0 > 180.0
            ? wrappedCenter - 180.0 : wrappedCenter + 180.0
        return Fit(
            latitude: (south + north) / 2.0,
            longitude: centerLongitude,
            latitudeDelta: min(160.0, max(0.18, (north - south) * 1.35)),
            longitudeDelta: min(355.0, max(0.18, arc * 1.35))
        )
    }

    static func shouldRefine(
        latitudeSpan: Double, longitudeSpan: Double,
        lastLatitudeSpan: Double, lastLongitudeSpan: Double
    ) -> Bool {
        guard latitudeSpan.isFinite, longitudeSpan.isFinite,
              lastLatitudeSpan.isFinite, lastLongitudeSpan.isFinite,
              latitudeSpan > 0, longitudeSpan > 0,
              lastLatitudeSpan > 0, lastLongitudeSpan > 0 else { return true }
        // Tiny MapKit region drift does not continuously restart a 10k-page
        // scan. Deliberate zoom changes and substantial pans are handled by
        // the separate viewport containment check on the current camera.
        return abs(latitudeSpan - lastLatitudeSpan) / lastLatitudeSpan > 0.12 ||
               abs(longitudeSpan - lastLongitudeSpan) / lastLongitudeSpan > 0.12
    }
}
