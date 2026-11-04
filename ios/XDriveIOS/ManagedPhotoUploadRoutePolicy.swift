import Foundation

/// Only the six existing Go UploadSession method/paths may be redirected to
/// an Owner + registered-iPhone + Source-managed API. A user-supplied URL or
/// path never becomes upload authority.
enum XDriveIOSManagedPhotoUploadRoutePolicy {
    private static let background = "/api/v1/ios/photos/background/uploads"
    private static let managed = "/api/v1/ios/photos/managed/uploads"

    static func translatedPath(_ path: String) -> String? {
        guard let checked = XDriveIOSBackgroundUploadRoutePolicy.translatedPath(path),
              checked == background || checked.hasPrefix(background + "/")
        else { return nil }
        return managed + String(checked.dropFirst(background.count))
    }
}

/// A background grant is not a JWT. Translate only the canonical existing
/// UploadSession methods to the separately authenticated restricted BG group.
/// Keep historical root-only GET and receipt aliases read-only for recovery.
enum XDriveIOSManagedPhotoBackgroundUploadRoutePolicy {
    private static let legacy = "/api/v1/ios/photos/background/uploads"
    private static let managed = "/api/v1/ios/photos/background-managed/uploads"

    static func translatedPath(_ path: String) -> String? {
        guard let checked = XDriveIOSBackgroundUploadRoutePolicy.translatedPath(path),
              checked == legacy || checked.hasPrefix(legacy + "/")
        else { return nil }
        return managed + String(checked.dropFirst(legacy.count))
    }
}
