import BackgroundTasks
import Foundation
import Photos
import UIKit

/// One OS BGProcessingTask for a previously *explicitly approved* Owner.
/// It now makes a real bounded media backup attempt, not merely a grant
/// proof: photos, original video and both Live Photo resources use ONE
/// existing Swift journaled UploadSession/CAS writer.
///
/// In this phase the pre-existing journal Keychain and PhotoKit staging use
/// WhenUnlocked/FileProtection.complete. If protected data is unavailable,
/// fail closed; do not weaken legacy protection or claim locked-screen
/// progress. The OS may postpone/skip a scheduled task or block force-quit.
enum XDriveIOSBackgroundPhotoTask {
    static let identifier = "com.lazyxu.xdrive.ios.photos.backup"
    @MainActor private static var active: Task<Void, Never>?

    static func registerAtLaunch() {
        _ = BGTaskScheduler.shared.register(
            forTaskWithIdentifier: identifier, using: nil
        ) { task in
            guard let work = task as? BGProcessingTask else {
                task.setTaskCompleted(success: false)
                return
            }
            Task { @MainActor in handle(work) }
        }
    }

    @MainActor
    private static func handle(_ task: BGProcessingTask) {
        guard active == nil else {
            task.setTaskCompleted(success: false)
            return
        }
        let operation = Task { @MainActor in
            var successful = false
            // Once an original writer starts, an interrupted create/finalize
            // may have committed remotely. Never auto-reschedule that case.
            var beganOriginalWrite = false
            var attemptedOwner: XDriveNativeOwnerRoot?
            defer {
                active = nil
                // success means the bounded local scan completed with no
                // unresolved ACK; never means all iPhone photos are backed up.
                task.setTaskCompleted(success: successful)
            }
            do {
                try Task.checkCancellation()
                // The grant proves current Owner, independent Device secret,
                // Root, Server instance, expiry and revocation. No Web token.
                let approved = try await XDriveIOSApprovedPhotoBGVault.shared
                    .proveInBackground()
                try Task.checkCancellation()
                guard UIApplication.shared.isProtectedDataAvailable else {
                    // Existing encrypted ledger and exported originals remain
                    // FileProtection.complete / WhenUnlockedThisDeviceOnly.
                    // Try a future OS-admitted window, not an immediate hot
                    // retry, and NEVER read source bytes while locked.
                    try? scheduleApprovedProbe(
                        afterMinutes: approved.intervalMinutes
                    )
                    return
                }
                let access = PHPhotoLibrary.authorizationStatus(for: .readWrite)
                guard access == .authorized || access == .limited else { return }
                let owner = try approved.ownerScope()
                guard let gate = XDriveIOSOriginalRunGate.shared.acquire() else {
                    // A foreground upload consumed this one OS request.
                    // Keep an explicitly approved future OS window, without
                    // running a second writer or reserving a BG scan cursor.
                    await resubmitOnlyIfStillApproved()
                    return
                }
                defer { XDriveIOSOriginalRunGate.shared.release(gate) }
                guard let window = try XDriveIOSBGOriginalWindowStore.shared
                        .reserveDue(owner: owner, approved: approved),
                      let offset = XDrivePhotoBackupScanWindow.offset(
                        for: window
                      ) else {
                    successful = true // no work due, no Server write
                    try? scheduleApprovedProbe(
                        afterMinutes: approved.intervalMinutes
                    )
                    return
                }
                try Task.checkCancellation()
                // One newly committed original max per BGTask, even if the
                // original is a video or an entire still+motion Live ZIP.
                // The exact Owner journal and Go CAS writer are unchanged.
                attemptedOwner = owner
                beganOriginalWrite = true
                let progress = try await XDriveIOSForegroundPhotoBackupMVP(
                    owner: owner, approvedBackgroundGrant: approved
                ).run(
                    allowICloudOriginals: false,
                    startOffset: offset,
                    maximumNewOriginals: 1
                ) { _ in
                    // No inactive WebView progress or long-lived credentials.
                }
                try Task.checkCancellation()
                try XDriveIOSBGOriginalWindowStore.shared.record(
                    owner: owner, approved: approved, report: progress
                )
                successful = !progress.stoppedForReview &&
                    progress.needsReview == 0
                if successful {
                    try? scheduleApprovedProbe(
                        afterMinutes: approved.intervalMinutes
                    )
                }
            } catch is CancellationError {
                // A cancelled writer might already have committed remotely.
                // Preserve an explicit pause even if it could not finish the
                // normal record() call. No automatic resubmission.
                if beganOriginalWrite, let attemptedOwner {
                    try? XDriveIOSBGOriginalWindowStore.shared.pause(
                        owner: attemptedOwner
                    )
                }
            } catch {
                if beganOriginalWrite, let attemptedOwner {
                    // Fail closed after any potentially ambiguous UploadSession
                    // stage; only a trusted zero-pending receipt review may
                    // later clear this durable BG pause.
                    try? XDriveIOSBGOriginalWindowStore.shared.pause(
                        owner: attemptedOwner
                    )
                } else if retryablePreflightNetworkFailure(error) {
                    // Only a transient read-only proof failure, BEFORE a
                    // possible Server write, may keep the BG schedule alive.
                    await resubmitOnlyIfStillApproved()
                }
            }
        }
        active = operation
        task.expirationHandler = { operation.cancel() }
    }

    /// A one-off OS BG request is consumed when it fires. Network failure
    /// before the initial *read-only* grant proof must not permanently
    /// strand a valid user-approved backup. Never resubmit when a network
    /// write might have begun or the Server rejected the grant.
    private static func retryablePreflightNetworkFailure(_ error: Error) -> Bool {
        guard let network = error as? URLError else { return false }
        switch network.code {
        case .timedOut, .networkConnectionLost, .notConnectedToInternet,
             .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed:
            return true
        default:
            return false
        }
    }

    private static func resubmitOnlyIfStillApproved() async {
        do {
            try Task.checkCancellation()
            // A local revoke removes the background-readable credential.
            // Re-read it after any suspension before submitting a new task;
            // do not reuse an old copied grant or bypass server proof.
            guard let grant = try await XDriveIOSApprovedPhotoBGVault.shared.current(),
                  let owner = try? grant.ownerScope(),
                  grant.matches(owner) else { return }
            try Task.checkCancellation()
            try scheduleApprovedProbe(afterMinutes: grant.intervalMinutes)
        } catch {
            // Advisory OS scheduling is never a successful upload receipt.
            // An unreadable/revoked grant cannot start a new task.
        }
    }

    /// A background run must not continue with a copied, now-local-revoked
    /// secret after user disables the device. Server checks grant/Device
    /// status for every scoped request; native task cancellation adds a
    /// separate immediate device-side fence.
    static func revokePendingRequests() {
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier)
        Task { @MainActor in active?.cancel() }
    }

    /// OS scheduling is advisory, not a precise timer and not a promise
    /// that tasks can run after force-quit or before first unlock.
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
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier)
        try BGTaskScheduler.shared.submit(request)
    }

    /// Do not claim locked-screen completion until the old AES-GCM journal,
    /// staging files and OS background transfer are migrated/verified.
    static var hasTrustedBackgroundExecutionGrant: Bool { false }
}
