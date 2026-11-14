import Foundation

@main
struct XDriveIOSNativeUnifiedMapCameraPolicyChecks {
    static func main() {
        typealias Camera = XDriveIOSNativeUnifiedMapCameraPolicy
        let points = [
            Camera.Point(latitude: 37.7, longitude: 179.4),
            Camera.Point(latitude: 38.1, longitude: -179.6),
            Camera.Point(latitude: 38.4, longitude: 179.9)
        ]
        guard let fit = Camera.fit(points) else {
            preconditionFailure("date-line points must frame")
        }
        precondition(fit.longitudeDelta < 3.0)
        precondition(fit.latitudeDelta < 2.0)
        precondition(abs(abs(fit.longitude) - 180) < 2.0)
        let single = Camera.fit([.init(latitude: 35, longitude: 139)])
        precondition(single != nil)
        precondition(abs(single!.latitude - 35) < 0.01)
        precondition(abs(single!.longitude - 139) < 0.01)
        precondition(single!.longitudeDelta >= 0.18)
        precondition(Camera.fit([
            .init(latitude: Double.nan, longitude: 139)
        ]) == nil)
        precondition(Camera.shouldRefine(
            latitudeSpan: 1, longitudeSpan: 1,
            lastLatitudeSpan: 10, lastLongitudeSpan: 10))
        precondition(!Camera.shouldRefine(
            latitudeSpan: 1.001, longitudeSpan: 0.999,
            lastLatitudeSpan: 1, lastLongitudeSpan: 1))
        print("native unified map dateline camera framing: PASS")
    }
}
