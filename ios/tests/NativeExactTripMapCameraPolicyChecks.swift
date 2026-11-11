import Foundation

@main
struct NativeExactTripMapCameraPolicyChecks {
    static func main() {
        typealias Point = XDriveIOSNativeExactTripMapPoint
        typealias Policy = XDriveIOSNativeExactTripMapCameraPolicy
        let single = Policy.fit([Point(latitude: 35, longitude: 139)])
        precondition(single != nil)
        precondition(single!.latitude == 35 && single!.longitude == 139)
        precondition(single!.latitudeSpan >= 0.06 && single!.longitudeSpan >= 0.06)

        // Two real points across the dateline should fit into a narrow
        // camera, not a world-wide 359-degree selection.
        let dateline = Policy.fit([
            Point(latitude: 10, longitude: 179.8),
            Point(latitude: 10, longitude: -179.8)
        ])
        precondition(dateline != nil)
        precondition(dateline!.longitudeSpan < 1)
        precondition(abs(dateline!.longitude) >= 179)

        let twoCountries = Policy.fit([
            Point(latitude: 35, longitude: 139),
            Point(latitude: 37, longitude: -122)
        ])
        precondition(twoCountries != nil && twoCountries!.longitudeSpan < 130)

        // The old two-cut shortcut expanded four multi-continent points to
        // 359°, although a 200° arc contains all four exact locations.
        let multiContinent = [
            Point(latitude: 25, longitude: -170),
            Point(latitude: 35, longitude: -10),
            Point(latitude: -30, longitude: 10),
            Point(latitude: 12, longitude: 170)
        ]
        let multiFrame = Policy.fit(multiContinent)
        precondition(multiFrame != nil)
        precondition(multiFrame!.longitudeSpan == 250)
        precondition(multiFrame!.longitude == -90)
        for point in multiContinent {
            let difference = (point.longitude - multiFrame!.longitude + 540)
                .truncatingRemainder(dividingBy: 360) - 180
            precondition(abs(difference) <= multiFrame!.longitudeSpan / 2)
        }
        // A different ordering cannot change the geographic camera.
        let reordered = Policy.fit(Array(multiContinent.reversed()))
        precondition(reordered != nil)
        precondition(reordered!.longitude == multiFrame!.longitude)
        precondition(reordered!.longitudeSpan == multiFrame!.longitudeSpan)

        // EXIF -180 and +180 are the same position on the WGS84 circle.
        let sameMeridian = Policy.fit([
            Point(latitude: 0, longitude: 180),
            Point(latitude: 0, longitude: -180)
        ])
        precondition(sameMeridian != nil)
        precondition(sameMeridian!.longitudeSpan == 0.06)

        // A truly polar trip must not cut off the two genuine latitudes.
        let polar = Policy.fit([
            Point(latitude: -89, longitude: 20),
            Point(latitude: 89, longitude: 30)
        ])
        precondition(polar != nil && polar!.latitudeSpan >= 178)

        precondition(Policy.fit([]) == nil)
        precondition(Policy.fit([Point(latitude: 91, longitude: 0)]) == nil)
        precondition(Policy.fit([Point(latitude: 0, longitude: 181)]) == nil)
        precondition(Policy.fit([Point(latitude: .nan, longitude: 0)]) == nil)
        precondition(Policy.fit([Point(latitude: 0, longitude: .infinity)]) == nil)
        let maximum = Array(repeating: Point(latitude: 11, longitude: 21), count: 64)
        precondition(Policy.fit(maximum) != nil)
        precondition(Policy.fit(maximum + [Point(latitude: 11, longitude: 21)]) == nil)

        // Server aggregates may span many degrees while their sample pin
        // occupies only one coordinate. Initial fit must show the full region.
        let aggregateRegion = Point(
            latitude: 35, longitude: 139,
            displayBounds: XDriveIOSNativeExactTripMapBounds(
                west: 130, south: 30, east: 150, north: 45))
        let fittedRegion = Policy.fitIncludingDisplayBounds([aggregateRegion])
        precondition(fittedRegion != nil)
        precondition(fittedRegion!.latitudeSpan >= 18.7)
        precondition(fittedRegion!.longitudeSpan >= 25)

        // Cover both sides of the antimeridian, not a 340-degree detour.
        let datelineRegion = Point(
            latitude: 0, longitude: 179,
            displayBounds: XDriveIOSNativeExactTripMapBounds(
                west: 170, south: -10, east: -170, north: 10))
        let fittedDatelineRegion = Policy.fitIncludingDisplayBounds([datelineRegion])
        precondition(fittedDatelineRegion != nil)
        precondition(fittedDatelineRegion!.longitudeSpan >= 25)
        precondition(fittedDatelineRegion!.longitudeSpan < 35)
        precondition(abs(fittedDatelineRegion!.longitude) >= 170)

        // Real 360-degree display bounds must not be shrunk to a sample dot.
        let worldRegion = Point(
            latitude: 0, longitude: 0,
            displayBounds: XDriveIOSNativeExactTripMapBounds(
                west: -180, south: -80, east: 180, north: 80))
        let fittedWorld = Policy.fitIncludingDisplayBounds([worldRegion])
        precondition(fittedWorld != nil)
        precondition(fittedWorld!.longitudeSpan == 360)
        precondition(fittedWorld!.latitudeSpan == 180)

        let invalidRegion = Point(
            latitude: 0, longitude: 0,
            displayBounds: XDriveIOSNativeExactTripMapBounds(
                west: 50, south: 0, east: 50, north: 1))
        precondition(Policy.fitIncludingDisplayBounds([invalidRegion]) == nil)
        precondition(Policy.fitIncludingDisplayBounds(
            Array(repeating: aggregateRegion, count: 65)) == nil)
        let plainFit = Policy.fitIncludingDisplayBounds(multiContinent)
        precondition(plainFit?.longitudeSpan == multiFrame?.longitudeSpan)
        precondition(plainFit?.longitude == multiFrame?.longitude)

        print("exact Owner trip WGS84 circular camera and dateline policy PASS")
    }
}
