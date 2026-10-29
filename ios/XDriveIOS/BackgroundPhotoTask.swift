import BackgroundTasks
import Foundation

/// One canonical iOS BGProcessingTask registration, shared with the existing
/// bounded original-media executor. Registration alone grants NO capability:
/// on a cold relaunch the in-memory Owner bearer is absent and the handler
/// completes unsuccessfully without PhotoKit or UploadSession access.
///
/// While the *same process* holds an explicitly configured, still-valid Web
/// Owner token in RAM, the executor re-verifies Server Owner/root, authorization,
/// scheduling and the global run gate. This is not a durable background grant
/// or reliable force-quit/cold-relaunch automatic backup.
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
            Task { @MainActor in
                XDriveIOSBackgroundPhotos.shared.handle(work)
            }
        }
    }

    static func revokePendingRequests() {
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier)
    }

    /// There is still no server-issued, revocable credential that survives
    /// process termination. RAM-only short-lived Owner sessions do not count
    /// as a durable background execution grant.
    static var hasTrustedBackgroundExecutionGrant: Bool { false }
}
