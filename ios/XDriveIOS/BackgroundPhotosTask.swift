import BackgroundTasks
import Foundation
import Photos
import UIKit

/// iOS system scheduler for a previously and explicitly authorized foreground
/// schedule. It never fabricates a native login or exports a Web cookie.
/// IMPORTANT: until a revocable server-issued background credential exists,
/// the bearer is RAM-only. A cold relaunch cannot upload unattended.
/// One physical PhotoKit/UploadSession executor across WebView and BGTasks.
/// This does not confer SourceRun authority or serialize other device apps.
@MainActor
final class XDriveIOSPhotoRunGate {
    static let shared = XDriveIOSPhotoRunGate()
    private init() {}
    private var held = false

    func acquire() -> Bool {
        guard !held else { return false }
        held = true
        return true
    }

    func release() { held = false }
}

@MainActor
final class XDriveIOSBackgroundPhotos {
    static let shared = XDriveIOSBackgroundPhotos()
    private init() {}

    private struct EphemeralAuthorization {
        let owner: XDriveNativeOwnerRoot
        let accessToken: String
    }
    private var authorization: EphemeralAuthorization?
    private var running: Task<Void, Never>?
    private var isScheduled = false

    /// Re-arm only after a fresh same-origin /me + Owner/root verification.
    /// AccessToken is never persisted; BG launches after process termination
    /// must stop until the PWA login explicitly reestablishes its session.
    func arm(owner: XDriveNativeOwnerRoot, accessToken: String) {
        guard !accessToken.isEmpty,
              let state = XDriveIOSPhotoAutoScheduleStore.shared.status(owner: owner),
              state.enabled, !state.pausedForReview else {
            disarm()
            return
        }
        let sameOwnerScope = authorization.map { prior in
            prior.owner.origin == owner.origin &&
            prior.owner.instanceID == owner.instanceID &&
            prior.owner.ownerID == owner.ownerID &&
            prior.owner.rootNodeID == owner.rootNodeID &&
            prior.owner.username == owner.username
        } ?? false
        if !sameOwnerScope {
            // A new root revision is ordinary Owner activity, not a new
            // account. Only a genuinely changed owner/server/root cancels
            // the previous scheduled/running native task.
            running?.cancel()
            BGTaskScheduler.shared.cancel(
                taskRequestWithIdentifier: XDriveIOSBackgroundPhotoTask.identifier
            )
            isScheduled = false
        }
        authorization = EphemeralAuthorization(
            owner: owner, accessToken: accessToken
        )
        submitIfEligible()
    }

    func disarm() {
        authorization = nil
        running?.cancel()
        BGTaskScheduler.shared.cancel(
            taskRequestWithIdentifier: XDriveIOSBackgroundPhotoTask.identifier
        )
        isScheduled = false
    }

    private func submitIfEligible() {
        guard let current = authorization,
              let state = XDriveIOSPhotoAutoScheduleStore.shared.status(
                owner: current.owner
              ), state.enabled, !state.pausedForReview else {
            return
        }
        // An already-pending BG request must not be repeatedly canceled by
        // the foreground 60-second poll. OS scheduling is not a timer.
        guard !isScheduled else { return }
        // A BGProcessingTaskRequest is only an OS scheduling *request*.
        // earliestBeginDate is not a promise of exact 15/60-minute execution.
        let request = BGProcessingTaskRequest(
            identifier: XDriveIOSBackgroundPhotoTask.identifier
        )
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = false
        request.earliestBeginDate = max(
            state.nextDueAt, Date().addingTimeInterval(60)
        )
        do {
            // One pending request per app across all scenes.
            try BGTaskScheduler.shared.submit(request)
            isScheduled = true
        } catch {
            isScheduled = false
            // Fail closed. The foreground visible scheduler remains the
            // source of truthful user-facing progress; no guessed BG success.
        }
    }

    func handle(_ task: BGProcessingTask) {
        isScheduled = false
        guard running == nil,
              let authorization,
              let schedule = XDriveIOSPhotoAutoScheduleStore.shared.status(
                owner: authorization.owner
              ), schedule.enabled, !schedule.pausedForReview,
              UIApplication.shared.applicationState != .active else {
            task.setTaskCompleted(success: false)
            return
        }
        task.expirationHandler = { [weak self] in
            Task { @MainActor [weak self] in
                self?.running?.cancel()
            }
        }
        running = Task { @MainActor [weak self] in
            guard let self else {
                task.setTaskCompleted(success: false)
                return
            }
            var successful = false
            defer {
                self.running = nil
                task.setTaskCompleted(success: successful)
                // Reschedule only if the same short-lived credential is
                // still available in process memory. Do not persist it or
                // auto-enroll a new device on a cold relaunch.
                self.submitIfEligible()
            }
            do {
                try Task.checkCancellation()
                let current: XDriveNativeOwnerRoot
                do {
                    current = try await XDriveNativeOwnerRootVerifier(
                        origin: authorization.owner.origin,
                        accessToken: authorization.accessToken,
                        expectedUsername: authorization.owner.username
                    ).verify()
                } catch {
                    // A suspended in-memory Web token may have expired or
                    // been revoked. Stop requesting more BG launches until
                    // the user logs in and a fresh Owner probe arms it.
                    self.authorization = nil
                    return
                }
                // Logout, local emergency OFF or BGTask expiry can happen
                // while the async HTTPS Owner/root probe is in flight.
                // Never advance the persisted due cursor or read PhotoKit
                // after the already canceled task receives a late success.
                try Task.checkCancellation()
                guard current.origin == authorization.owner.origin,
                      current.instanceID == authorization.owner.instanceID,
                      current.ownerID == authorization.owner.ownerID,
                      current.rootNodeID == authorization.owner.rootNodeID,
                      PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized ||
                      PHPhotoLibrary.authorizationStatus(for: .readWrite) == .limited else {
                    return
                }
                guard XDriveIOSPhotoRunGate.shared.acquire() else { return }
                defer { XDriveIOSPhotoRunGate.shared.release() }
                guard let due = try XDriveIOSPhotoAutoScheduleStore.shared
                    .reserveDue(owner: current),
                      let offset = XDrivePhotoBackupScanWindow.offset(
                        for: due.windowIndex
                      ) else {
                    // Not yet due or no longer authorized: no media read.
                    successful = true
                    return
                }
                let report = try await XDriveIOSForegroundPhotoBackupMVP(
                    owner: current, accessToken: authorization.accessToken
                ).run(
                    allowICloudOriginals: due.allowICloudOriginals,
                    startOffset: offset
                ) { _ in
                    // Do not send BG progress to an inactive WebView.
                }
                try Task.checkCancellation()
                let next = try XDriveIOSPhotoAutoScheduleStore.shared.recordResult(
                    owner: current, progress: report
                )
                successful = next != nil && !report.stoppedForReview
            } catch is CancellationError {
                // Existing encrypted intent remains durable, and ambiguous
                // UploadSession acknowledgements must be read-only verified.
            } catch {
                // Expired token, unavailable Keychain/PhotoKit, TLS failure or
                // server revocation must never authorize an offline replay.
            }
        }
    }
}
