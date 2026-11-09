import UIKit

/// An APNs background hint is advisory and untrusted input. It never starts a
/// PhotoKit read, uses a Web bearer, or treats delivery as an upload receipt.
/// Until Apple-signed APNs registration and an Owner-bound Server sender exist,
/// this delegate alone does NOT provide APNs delivery.
final class XDriveIOSPhotoBackupRemoteHintDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didReceiveRemoteNotification userInfo: [AnyHashable: Any],
                     fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        guard XDriveIOSPhotoBackupResiliencePolicy.isSilentPhotoWakeHint(userInfo) else {
            completionHandler(.noData)
            return
        }
        Task { @MainActor in
            await XDriveIOSBackgroundPhotoTask.rearmAfterRemoteWakeHint()
            // No bytes have been fetched or uploaded by this callback.
            completionHandler(.noData)
        }
    }
}
