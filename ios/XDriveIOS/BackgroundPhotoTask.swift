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
enum XDriveIOSBGRegistrationFailure: Error {
    case unavailable
}

enum XDriveIOSBackgroundPhotoTask {
    static let identifier = "com.lazyxu.xdrive.ios.photos.backup"
    private static var attemptedRegistration = false
    private(set) static var registeredAtLaunch = false
    @MainActor private static var active: Task<Void, Never>?
    @MainActor private static var activeRunID: UUID?
    // Incremented by explicit native local stop/revocation, not by an
    // automatic system expiration. A late expired task cannot re-arm a
    // previously stopped Owner's system schedule.
    @MainActor private static var localStopVersion: UInt64 = 0

    static func registerAtLaunch() {
        // Apple terminates the process if one identifier is registered twice.
        // SwiftUI may reconstruct its app value; registration is process-once.
        guard !attemptedRegistration else { return }
        attemptedRegistration = true
        guard let allowed = Bundle.main.object(
            forInfoDictionaryKey: "BGTaskSchedulerPermittedIdentifiers"
        ) as? [String], allowed.contains(identifier) else { return }
        registeredAtLaunch = BGTaskScheduler.shared.register(
            forTaskWithIdentifier: identifier, using: nil
        ) { task in
            guard let work = task as? BGProcessingTask else {
                task.setTaskCompleted(success: false)
                return
            }
            Task { @MainActor in handle(work) }
        }
        if registeredAtLaunch {
            // iOS may admit a BGTask while protected photo bytes are locked.
            // Re-arm an approved later OS window after data becomes readable;
            // never run an original writer in this notification callback.
            NotificationCenter.default.addObserver(
                forName: UIApplication.protectedDataDidBecomeAvailableNotification,
                object: nil, queue: .main
            ) { _ in
                Task { @MainActor in await rearmAfterProtectedDataUnlock() }
            }
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
            var sourceRunReporter: XDriveIOSPhotoSourceRunReporter?
            defer {
                active = nil
                activeRunID = nil
                // success means the bounded local scan completed with no
                // unresolved ACK; never means all iPhone photos are backed up.
                task.setTaskCompleted(success: successful)
            }
            do {
                try Task.checkCancellation()
                let network = XDriveIOSPhotoBackupNetworkPolicy.shared
                // The grant proves current Owner, independent Device secret,
                // Root, Server instance, expiry and revocation. No Web token.
                let approved = try await XDriveIOSApprovedPhotoBGVault.shared
                    .proveInBackground()
                // Legacy Owner-root grants are read-only for historical
                // receipts/revocation, never a fresh system BG upload.
                guard approved.hasManagedDestination else {
                    throw XDriveIOSPhotoBGVaultFailure.invalidProof
                }
                let owner = try approved.ownerScope()
                attemptedOwner = owner
                XDriveIOSBGAttemptStatus.record(.started, owner: owner)
                try Task.checkCancellation()
                guard UIApplication.shared.isProtectedDataAvailable else {
                    XDriveIOSBGAttemptStatus.record(.protectedDataUnavailable, owner: owner)
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
                guard access == .authorized else {
                    XDriveIOSBGAttemptStatus.record(.photosPermissionUnavailable, owner: owner)
                    return
                }
                _ = try network.requireWiFiIfNeeded(for: owner)
                guard let gate = XDriveIOSOriginalRunGate.shared.acquire() else {
                    XDriveIOSBGAttemptStatus.record(.otherWriterActive, owner: owner)
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
                    XDriveIOSBGAttemptStatus.record(.pendingReceiptReview, owner: owner)
                    try XDriveIOSBGOriginalWindowStore.shared.pause(owner: owner)
                    // No new upload or automatic resubmit until the user
                    // finishes trusted Owner receipt review and consents.
                    return
                }
                // An explicitly enabled "only new" foreground plan has a
                // durable PhotoKit change queue. The independently authorized
                // BGProcessing task must consume its same replayed revisions
                // before a capture-date-filtered positional scan. No second
                // uploader, authorization shortcut or queue-success receipt.
                var incrementalQueue: XDriveIOSPhotoKitPersistentBackupQueue?
                var newOnlySince: Date?
                if let plan = XDriveIOSPhotoAutoScheduleStore.shared.status(owner: owner),
                   plan.enabled, plan.backupStartRule == .onlyNew {
                    // A BG grant cannot silently bypass this Owner's separate
                    // receipt-review pause, even when the last journal read
                    // currently reports zero outstanding entries.
                    if plan.pausedForReview {
                        XDriveIOSBGAttemptStatus.record(.pendingReceiptReview, owner: owner)
                        try XDriveIOSBGOriginalWindowStore.shared.pause(owner: owner)
                        return
                    }
                    if plan.historyRecoveryRequired == true {
                        XDriveIOSBGAttemptStatus.record(.historyRecoveryRequired, owner: owner)
                        // Only the foreground Owner flow may obtain explicit
                        // full-scope consent and reconcile the expired history.
                        // BG must not bypass that consent or race the full pass.
                        await resubmitRecoveryOnlyIfStillRequired(owner: owner)
                        return
                    }
                    let queue = try XDriveIOSPhotoKitPersistentBackupQueue(owner: owner)
                    do {
                        _ = try await queue.replay(owner: owner, maximumEvents: 4)
                        guard try await queue.isCaughtUp(owner: owner) else {
                            // Preserve the due/cursor reservation until all
                            // bounded PhotoKit history is durable. An imported
                            // old-dated asset must never escape this run.
                            await resubmitOnlyIfStillApproved()
                            return
                        }
                        incrementalQueue = queue
                        newOnlySince = plan.newOnlySince
                    } catch XDriveIOSPhotoKitPersistentBackupQueue.Failure
                        .unauthorizedOrChanged {
                        // A PhotoKit edit can advance the library generation
                        // while its durable change records are being replayed.
                        // SQLite already committed each completed record and
                        // its token atomically. A later OS-approved pass may
                        // safely replay the remaining changes; never reserve
                        // a due window or fall back to a date-filtered scan.
                        try Task.checkCancellation()
                        guard approved.matches(owner) else {
                            throw XDriveIOSPhotoBGVaultFailure.invalidProof
                        }
                        guard PHPhotoLibrary.authorizationStatus(
                            for: .readWrite
                        ) == .authorized else {
                            // Authorization may have changed during the
                            // replay: do not retry with a narrower library.
                            guard let recovery =
                                try XDriveIOSPhotoAutoScheduleStore.shared
                                    .requireFullLibraryReconciliation(owner: owner),
                                recovery.requiresFullLibraryReconciliation else {
                                throw XDriveIOSPhotoBGVaultFailure.invalidProof
                            }
                            await resubmitRecoveryOnlyIfStillRequired(owner: owner)
                            return
                        }
                        await resubmitOnlyIfStillApproved()
                        return
                    } catch XDriveIOSPhotoKitPersistentBackupQueue.Failure
                        .requiresExplicitBaseline,
                        XDriveIOSPhotoKitPersistentBackupQueue.Failure
                        .invalidArchivedToken,
                        XDriveIOSPhotoKitPersistentBackupQueue.Failure
                        .historyUnavailable,
                        XDriveIOSPhotoKitPersistentBackupQueue.Failure
                        .authorizationChanged {
                        // Only-new consent never authorizes a full-date scan.
                        // Reuse the foreground's durable recovery/consent gate.
                        // Preserve the BG due window; do not reserve or write.
                        guard approved.matches(owner),
                              let recovery = try XDriveIOSPhotoAutoScheduleStore.shared
                                  .requireFullLibraryReconciliation(owner: owner),
                              recovery.requiresFullLibraryReconciliation else {
                            throw XDriveIOSPhotoBGVaultFailure.invalidProof
                        }
                        await resubmitRecoveryOnlyIfStillRequired(owner: owner)
                        return
                    }
                    try Task.checkCancellation()
                    guard approved.matches(owner) else {
                        throw XDriveIOSPhotoBGVaultFailure.corrupt
                    }
                }
                _ = try network.requireWiFiIfNeeded(for: owner)
                guard let window = try XDriveIOSBGOriginalWindowStore.shared
                        .reserveDue(owner: owner, approved: approved),
                      let offset = XDrivePhotoBackupScanWindow.offset(
                        for: window
                      ) else {
                    XDriveIOSBGAttemptStatus.record(
                        (try XDriveIOSBGOriginalWindowStore.shared.pausedForReview(owner: owner))
                            ? .pendingReceiptReview : .noDueWindow,
                        owner: owner
                    )
                    successful = true // no work due, no Server write
                    try? scheduleApprovedProbe(
                        afterMinutes: approved.intervalMinutes
                    )
                    return
                }
                try Task.checkCancellation()
                // This task has reserved a real bounded window. Record it in
                // the shared SourceRun history using the same device and
                // separately revocable Background Grant; no Web bearer exists
                // in this OS task.
                let reporter = XDriveIOSPhotoSourceRunReporter(
                    approvedBackgroundGrant: approved, trigger: "scheduled"
                )
                sourceRunReporter = reporter
                await reporter.begin()

                // A small bounded number of serially journaled originals per
                // BGTask, even if an original is a video or paired Live ZIP.
                // The OS expiration handler may stop the batch at any point;
                // no parallel writer, retry or second authentication path.
                attemptedOwner = owner
                let progress = try await XDriveIOSForegroundPhotoBackupMVP(
                    owner: owner, approvedBackgroundGrant: approved,
                    onSourceProgress: { value in
                        reporter.enqueueUpdate(value)
                    }
                ).run(
                    allowICloudOriginals: false,
                    startOffset: offset,
                    maximumNewOriginals: min(
                        XDriveIOSBGOriginalWindowStore.maximumNewOriginalsPerRun,
                        XDriveIOSForegroundPhotoBackupMVP.maxNewOriginalsPerRun
                    ),
                    newOnlySince: newOnlySince,
                    changeQueue: incrementalQueue,
                    onPotentialWrite: { beganOriginalWrite = true }
                ) { _ in
                    // No inactive WebView progress or long-lived credentials.
                }
                try Task.checkCancellation()
                try XDriveIOSBGOriginalWindowStore.shared.record(
                    owner: owner, approved: approved, report: progress
                )
                await reporter.finish(status: progress.stoppedForReview ? "partial" : "completed")
                successful = !progress.stoppedForReview &&
                    progress.needsReview == 0
                XDriveIOSBGAttemptStatus.record(
                    successful ? .completedBoundedWindow : .pendingReceiptReview,
                    owner: owner
                )
                if successful {
                    try? scheduleApprovedProbe(
                        afterMinutes: approved.intervalMinutes
                    )
                }
            } catch is CancellationError {
                if let attemptedOwner {
                    XDriveIOSBGAttemptStatus.record(
                        beganOriginalWrite ? .interruptedAfterWrite :
                            expiration.systemExpired ? .systemExpired : .cancelled,
                        owner: attemptedOwner
                    )
                }
                if let reporter = sourceRunReporter {
                    await reporter.finishAfterCancellation(status: "cancelled")
                }
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
                if let attemptedOwner {
                    let classification: XDriveIOSBGAttemptReason
                    if beganOriginalWrite {
                        classification = .interruptedAfterWrite
                    } else if retryablePreflightNetworkFailure(error) {
                        classification = .networkRetry
                    } else if error is XDriveIOSPhotoBGVaultFailure ||
                              error is XDriveIOSPhotoBackgroundGrantError {
                        classification = .authorizationFailure
                    } else {
                        classification = .otherFailure
                    }
                    XDriveIOSBGAttemptStatus.record(classification, owner: attemptedOwner)
                }
                if let reporter = sourceRunReporter {
                    await reporter.finish(status: "failed")
                }
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
        if error is XDriveIOSPhotoBackupNetworkError { return true }
        if let grant = error as? XDriveIOSPhotoBGVaultFailure,
           case .transientServerStatus(let code) = grant {
            return code == 408 || code == 429 || (500...599).contains(code)
        }
        // An already-confirmed Node may have been checked during this task.
        // Only a transient READ status, with no UploadSession mutation,
        // qualifies for a future OS-admitted attempt. Never rearm on a
        // missing/mismatched Node or a revoked Owner/Device grant.
        if let readback = error as? XDriveIOSNodeReceiptReadbackError,
           case .serverRejected(let code) = readback {
            return code == 408 || code == 429 || (500...599).contains(code)
        }
        if let owner = error as? XDriveNativeOwnerRootFailure,
           case .serverStatus(let code) = owner {
            return code == 408 || code == 429 || (500...599).contains(code)
        }
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
    private static func resubmitRecoveryOnlyIfStillRequired(
        owner: XDriveNativeOwnerRoot
    ) async {
        do {
            guard let grant = try await XDriveIOSApprovedPhotoBGVault.shared.current(),
                  grant.matches(owner),
                  let plan = XDriveIOSPhotoAutoScheduleStore.shared.status(owner: owner),
                  plan.enabled, plan.historyRecoveryRequired == true else { return }
            // Keep the OS request alive while the foreground flow waits for
            // explicit scope consent or finishes its full-library pass.
            try scheduleApprovedProbe(afterMinutes: grant.intervalMinutes)
        } catch {
            // No stale grant, disabled plan or guessed retry.
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

    /// An unlock is a recovery hint, not permission to start an upload.
    /// Require the SAME valid, unrevoked managed grant, Full PhotoKit scope,
    /// no active writer and no pending/uncertain receipts before an OS re-arm.
    /// The original Apple scheduler delay still applies; force-quit cannot be bypassed.
    @MainActor
    private static func rearmAfterProtectedDataUnlock() async {
        guard registeredAtLaunch, active == nil,
              UIApplication.shared.isProtectedDataAvailable,
              PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized
        else { return }
        let stop = localStopVersion
        do {
            guard let grant = try await XDriveIOSApprovedPhotoBGVault.shared.current(),
                  let owner = try? grant.ownerScope(),
                  grant.matches(owner), grant.hasManagedDestination,
                  localStopVersion == stop,
                  try !XDriveIOSBGOriginalWindowStore.shared.pausedForReview(owner: owner)
            else { return }
            guard try await XDriveIOSOriginalPendingReceiptPreflight
                .pendingCount(owner: owner) == 0,
                localStopVersion == stop, active == nil else { return }
            try scheduleApprovedProbe(afterMinutes: grant.intervalMinutes)
            XDriveIOSBGAttemptStatus.record(.scheduledAfterUnlock, owner: owner)
        } catch {
            // A missing/expired/revoked grant or unreadable ledger never
            // authorizes a scan or an unbounded automatic retry.
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
        guard registeredAtLaunch else {
            throw XDriveIOSBGRegistrationFailure.unavailable
        }
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
