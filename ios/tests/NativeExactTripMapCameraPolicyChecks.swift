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

        print("exact Owner trip WGS84 circular camera and dateline policy PASS")
    }
}
