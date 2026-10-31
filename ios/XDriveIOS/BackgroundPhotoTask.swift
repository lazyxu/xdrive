import BackgroundTasks
import Foundation
import Photos
import UIKit

/// One BGTask invocation's expiration signal. It is actor-confined; manual
/// revocation must never be mistaken for OS expiration.
@MainActor
private final class XDriveIOSBGExpirationSignal {
    var systemExpired = false
}

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
    @MainActor private static var activeRunID: UUID?
    // Incremented by explicit native local stop/revocation, not by an
    // automatic system expiration. A late expired task cannot re-arm a
    // previously stopped Owner's system schedule.
    @MainActor private static var localStopVersion: UInt64 = 0

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
        let runID = UUID()
        let stopVersionAtStart = localStopVersion
        let expiration = XDriveIOSBGExpirationSignal()
        let operation = Task { @MainActor in
            var successful = false
            // Once an original writer starts, an interrupted create/finalize
            // may have committed remotely. Never auto-reschedule that case.
            var beganOriginalWrite = false
            var attemptedOwner: XDriveNativeOwnerRoot?
            defer {
                active = nil
                activeRunID = nil
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
                // A foreground or earlier BG writer can leave a lost ACK
                // outside this BG scan window. A new system task must never
                // use its separate Device grant to bypass that Owner journal.
                // Check under the global original-writer lock, BEFORE the
                // BG cursor reserves a new due window.
                let olderPending = try await XDriveIOSOriginalPendingReceiptPreflight
                    .pendingCount(owner: owner)
                try Task.checkCancellation()
                guard approved.matches(owner) else {
                    throw XDriveIOSPhotoBGVaultFailure.corrupt
                }
                if olderPending > 0 {
                    try XDriveIOSBGOriginalWindowStore.shared.pause(owner: owner)
                    // No new upload or automatic resubmit until the user
                    // finishes trusted Owner receipt review and consents.
                    return
                }
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
                let progress = try await XDriveIOSForegroundPhotoBackupMVP(
                    owner: owner, approvedBackgroundGrant: approved
                ).run(
                    allowICloudOriginals: false,
                    startOffset: offset,
                    maximumNewOriginals: 1,
                    onPotentialWrite: { beganOriginalWrite = true }
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
                if beganOriginalWrite, let attemptedOwner {
                    // A cancelled writer might have committed remotely.
                    // Only a trusted receipt review can clear this pause.
                    try? XDriveIOSBGOriginalWindowStore.shared.pause(
                        owner: attemptedOwner
                    )
                } else if expiration.systemExpired &&
                          localStopVersion == stopVersionAtStart {
                    // A one-shot OS request was consumed BEFORE any possible
                    // UploadSession write. Re-arm at the Owner's *original*
                    // advisory interval, not an immediate retry. The current
                    // Task is cancelled, so the helper must use an explicit
                    // system-expiration fence instead of Task cancellation.
                    await resubmitOnlyIfStillApproved(
                        afterSystemExpirationAt: stopVersionAtStart
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
        activeRunID = runID
        task.expirationHandler = {
            // The expiration callback may arrive off MainActor. Set the
            // distinct system-expiration reason on MainActor BEFORE cancelling
            // the operation; a manual stop never sets this marker.
            Task { @MainActor in
                guard activeRunID == runID else { return }
                expiration.systemExpired = true
                operation.cancel()
            }
        }
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

    @MainActor
    private static func resubmitOnlyIfStillApproved(
        afterSystemExpirationAt expectedStopVersion: UInt64? = nil
    ) async {
        do {
            if let expectedStopVersion {
                guard localStopVersion == expectedStopVersion else { return }
            } else {
                try Task.checkCancellation()
            }
            // A local revoke removes the background-readable credential.
            // Re-read it instead of using a copied stale grant. The exception
            // for system expiration is limited to the cancellation check, NOT
            // to any credential/Owner/expiry or explicit stop fence.
            guard let grant = try await XDriveIOSApprovedPhotoBGVault.shared.current(),
                  let owner = try? grant.ownerScope(),
                  grant.matches(owner) else { return }
            if let expectedStopVersion {
                guard localStopVersion == expectedStopVersion else { return }
            } else {
                try Task.checkCancellation()
            }
            try scheduleApprovedProbe(afterMinutes: grant.intervalMinutes)
        } catch {
            // No guaranteed OS scheduling, and no upload-success receipt.
            // Unreadable, expired or revoked grant fails closed.
        }
    }

    /// A background run must not continue with a copied, now-local-revoked
    /// secret after user disables the device. Server checks grant/Device
    /// status for every scoped request; native task cancellation adds a
    /// separate immediate device-side fence.
    static func revokePendingRequests() {
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier)
        Task { @MainActor in
            localStopVersion &+= 1
            // A concurrently expiring read-only task may have re-submitted
            // between the synchronous cancel and this actor turn. Cancel a
            // second time *after* advancing the stop fence so no late
            // approval can re-arm this user's explicit local opt-out.
            BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier)
            active?.cancel()
        }
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
