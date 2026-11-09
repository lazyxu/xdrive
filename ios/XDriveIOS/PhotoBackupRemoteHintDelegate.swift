import UIKit

/// An APNs background hint is advisory and untrusted input. It never starts a
/// PhotoKit read, uses a Web bearer, or treats delivery as an upload receipt.
/// Until Apple-signed APNs registration and an Owner-bound Server sender exist,
/// this delegate alone does NOT provide APNs delivery.
final class XDriveIOSPhotoBackupRemoteHintDelegate: NSObject, UIApplicationDelegate {
    // One explicit, current Owner grant and local stop epoch are captured
    // before asking the OS for a token. A late APNs callback may not cross
    // Owners or silently reactivate revoked backup schedules.
    @MainActor private static var expectedRegistration:
        (owner: XDriveNativeOwnerRoot, stopEpoch: UInt64)?

    @MainActor
    static func requestRegistrationForApprovedBackgroundOwner(
        _ owner: XDriveNativeOwnerRoot, stopEpoch: UInt64
    ) {
        guard UIApplication.shared.applicationState == .active else { return }
        expectedRegistration = (owner: owner, stopEpoch: stopEpoch)
        UIApplication.shared.registerForRemoteNotifications()
    }

    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in
            guard let expected = Self.expectedRegistration,
                  expected.stopEpoch ==
                    XDriveIOSPhotoAutoScheduleStore.shared.localStopGeneration
            else { return }
            Self.expectedRegistration = nil
            // APNs environment is bound to the build's intended provisioning
            // profile. The APNs service additionally validates the token;
            // unsigned IPA builds have no registered APNs entitlement/token.
            #if DEBUG
            let environment = "development"
            #else
            let environment = "production"
            #endif
            try? await XDriveIOSPhotoBackgroundGrantManager.shared.registerAPNSToken(
                deviceToken, environment: environment,
                expectedOwner: expected.owner
            )
        }
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        Task { @MainActor in Self.expectedRegistration = nil }
        // No device token and no fallback to an unauthenticated send.
        // iOS BGProcessing and foreground backup remain independent.
    }

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
