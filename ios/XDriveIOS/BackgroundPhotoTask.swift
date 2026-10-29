import BackgroundTasks
import Foundation

/// iOS launch-time BGProcessingTask registration. This registers a system
/// callback but deliberately does NOT submit uploads or invent a trusted
/// background bearer. Foreground PWA credentials are never reused here.
///
/// A future backend-issued, revocable Owner/Device/Root-scoped native grant
/// must be verified independently before this handler may submit a request
/// or create an UploadSession. Only then connect an owner-isolated file
/// background URLSession and exact durable acknowledgment recovery.
enum XDriveIOSBackgroundPhotoTask {
    static let identifier = "com.lazyxu.xdrive.ios.photos.backup"

    static func registerAtLaunch() {
        _ = BGTaskScheduler.shared.register(
            forTaskWithIdentifier: identifier, using: nil
        ) { task in
            guard let work = task as? BGProcessingTask else {
                task.setTaskCompleted(success: false)
                return
            }
            // There is no native background execution grant yet.
            // Never treat a WKWebView Cookie, previous frontend opt-in,
            // Device identity-only token, or scheduled wake as upload rights.
            work.expirationHandler = {
                // No upload task was started; nothing to replay or cancel.
            }
            work.setTaskCompleted(success: false)
        }
    }

    static func revokePendingRequests() {
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier)
    }

    /// A future UI can distinguish registered integration from a runnable
    /// background backup. Returning false is intentional and fail-closed.
    static var hasTrustedBackgroundExecutionGrant: Bool { false }
}
