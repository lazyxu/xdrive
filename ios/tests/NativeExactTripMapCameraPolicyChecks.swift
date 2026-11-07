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

        precondition(Policy.fit([]) == nil)
        precondition(Policy.fit([Point(latitude: 91, longitude: 0)]) == nil)
        precondition(Policy.fit([Point(latitude: 0, longitude: 181)]) == nil)
        precondition(Policy.fit([Point(latitude: .nan, longitude: 0)]) == nil)
        precondition(Policy.fit([Point(latitude: 0, longitude: .infinity)]) == nil)
        let maximum = Array(repeating: Point(latitude: 11, longitude: 21), count: 64)
        precondition(Policy.fit(maximum) != nil)
        precondition(Policy.fit(maximum + [Point(latitude: 11, longitude: 21)]) == nil)

        print("exact Owner trip WGS84 camera and dateline policy PASS")
    }
}
