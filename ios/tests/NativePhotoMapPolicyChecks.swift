import Foundation

@main
struct XDriveIOSNativePhotoMapPolicyChecks {
    static func main() {
        precondition(XDriveIOSNativePhotoMapPolicy.validCoordinate(latitude: 0, longitude: 0))
        precondition(XDriveIOSNativePhotoMapPolicy.validCoordinate(latitude: 90, longitude: -180))
        precondition(!XDriveIOSNativePhotoMapPolicy.validCoordinate(latitude: 90.1, longitude: 0))
        precondition(!XDriveIOSNativePhotoMapPolicy.validCoordinate(latitude: .nan, longitude: 0))
        precondition(!XDriveIOSNativePhotoMapPolicy.validCoordinate(latitude: 0, longitude: .infinity))
        precondition(XDriveIOSNativePhotoMapPolicy.validPage(total: 100000, start: 128, next: 192, rows: 64, pins: 53))
        precondition(!XDriveIOSNativePhotoMapPolicy.validPage(total: 100000, start: 0, next: 100000, rows: 100000, pins: 64))
        precondition(!XDriveIOSNativePhotoMapPolicy.validPage(total: 64, start: 0, next: 64, rows: 64, pins: 65))
        precondition(XDriveIOSNativePhotoMapPolicy.markerLabel(27) == "当前页此位置27张照片")
        print("native iOS PhotoKit map policy: PASS")
    }
}
