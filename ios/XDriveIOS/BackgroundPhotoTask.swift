import BackgroundTasks
import Foundation

/// iOS system scheduling is not an exact clock. A BGProcessingTask runs only
/// after the device and OS admit the task; force-quit may prevent relaunch.
///
/// PHASE 1: a previously approved, AfterFirstUnlockThisDeviceOnly native
/// credential can independently prove its *current* Owner/Device/Root grant
/// even while there is NO WKWebView login session. This still does not create
/// upload sessions or read PhotoKit assets. Actual background uploads require
/// separate bounded encrypted journal and redirect-safe file task plumbing.
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
            // BGProcessingTask expiration cancels URLSession.data(for:)
            // in the native-only Server proof; no upload task is detached.
            let operation = Task<Void, Never> {
                do {
                    let grant = try await XDriveIOSApprovedPhotoBGVault.shared
                        .proveInBackground()
                    try Task.checkCancellation()
                    // Reschedule only if the still-approved, time-bounded
                    // grant remains valid. Never mint an access token.
                    try? scheduleApprovedProbe(
                        afterMinutes: grant.intervalMinutes
                    )
                    // This success reports ONLY that the grant proof
                    // check completed; it is not a backed-up photo.
                    work.setTaskCompleted(success: true)
                } catch {
                    work.setTaskCompleted(success: false)
                    // Rejected/revoked/unavailable tokens must not cause a
                    // hot retry or an unauthorized background upload.
                }
            }
            work.expirationHandler = { operation.cancel() }
        }
    }

    /// Explicit User-approved native grant is a prerequisite, not inferred
    /// from iOS Device identity or the shared PWA's stored settings.
    /// This requests *only a future read-only proof*. No media is uploaded.
    static func scheduleApprovedProbe(afterMinutes minutes: Int) throws {
        guard XDriveIOSBGApprovalPolicy.validInterval(minutes) else {
            throw XDriveIOSPhotoBGVaultFailure.corrupt
        }
        let request = BGProcessingTaskRequest(identifier: identifier)
        request.requiresExternalPower = false
        request.requiresNetworkConnectivity = true
        request.earliestBeginDate = Date().addingTimeInterval(
            TimeInterval(minutes * 60)
        )
        // Native explicit enable/rotation may replace the old due request.
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier)
        try BGTaskScheduler.shared.submit(request)
    }

    static func revokePendingRequests() {
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier)
    }

    /// An installed and proved grant can authorize *only scoped native
    /// operations*, never make the legacy WebView auth available to BGTask.
    /// No media write path is wired in this phase.
    static var hasTrustedBackgroundExecutionGrant: Bool { false }
}
