import Foundation

/// One currently scanned PhotoKit page, not a spatial index of 100k media.
enum XDriveIOSNativePhotoMapPolicy {
    static let pageSize = 64

    static func validCoordinate(latitude: Double, longitude: Double) -> Bool {
        latitude.isFinite && longitude.isFinite &&
        abs(latitude) <= 90 && abs(longitude) <= 180
    }

    static func validPage(total: Int, start: Int, next: Int, rows: Int, pins: Int) -> Bool {
        total >= 0 && start >= 0 && start <= next && next <= total &&
        next - start <= pageSize && rows == next - start &&
        pins >= 0 && pins <= rows
    }

    static func markerLabel(_ count: Int) -> String {
        "当前页此位置\(max(0, min(pageSize, count)))张照片"
    }
}
