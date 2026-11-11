import Combine
import Foundation
import Photos
import UIKit

/// A native, Owner-bound foreground controller. Upload bytes, encrypted ACK
/// journal, deduplication and CAS receipts remain in the existing Swift writer.
/// Focused progress is session-only; it never grants background permission.
struct XDriveIOSFocusedBackupSummary: Equatable {
    var totalVisible = 0
    var totalWindows = 0
    var completedWindows = 0
    var currentWindow = 0
    // Where this explicit session safely resumed, not an upload count.
    var resumedFromWindow = 0
    var confirmedNew = 0
    var hadUnavailable = false
    var limitedAuthorization = false
    var finishedScan = false
    var pausedForReview = false
}

private enum XDriveIOSFocusedBackupFailure: Error {
    case libraryChanged
    case invalidWindow
}

/// Installed once at the native Owner root, never from a gallery row.
/// PhotoKit may call off-main; the observer only advances a saved due time.
private final class XDriveIOSForegroundPhotoLibraryObserver:
    NSObject, PHPhotoLibraryChangeObserver {
    private let onChanged: @MainActor () -> Void

    init(onChanged: @escaping @MainActor () -> Void) {
        self.onChanged = onChanged
        super.init()
    }

    func photoLibraryDidChange(_ changeInstance: PHChange) {
        Task { @MainActor [weak self] in self?.onChanged() }
    }
}

@MainActor
final class XDriveIOSNativePhotoBackupController: ObservableObject {
    @Published private(set) var busy = false
    @Published private(set) var schedule: XDriveIOSPhotoAutoScheduleStore.State?
    @Published private(set) var progress: XDriveIOSPhotoBackupProgress?
    @Published private(set) var focusedSummary: XDriveIOSFocusedBackupSummary?
    // RAM-only manual first-pass position; never persists PhotoKit identities.
    @Published private(set) var manualNextWindow = 0
    /// Read-only UI invalidation only after this Owner's original writer
    /// returns a Server-confirmed new Node receipt. Never asserts a write.
    struct ConfirmedOriginalUpdate: Equatable {
        let owner: XDriveNativeOwnerRoot
        let id: UUID
    }
    @Published private(set) var confirmedOriginalUpdate: ConfirmedOriginalUpdate?
    @Published private(set) var message = "未启动相册备份"
    @Published private(set) var errorMessage: String?

    private enum RunKind { case manual, automatic, focused, single }
    private var running: Task<Void, Never>?
    private var runningOwner: XDriveNativeOwnerRoot?
    // The native login model and backup controller survive tab switches.
    // Persist only the display Owner and a generation marker in RAM; never
    // render an old Owner's photo counts or terminal report after A -> B -> A.
    private var displayOwner: XDriveNativeOwnerRoot?
    private var displayEpoch = UUID()
    private var manualLibraryEpoch: Data?
    private var manualAuthorizationRaw: Int?
    // RAM-only checkpoint identity. An unchanged PhotoKit epoch cannot make
    // a position scanned for Owner-root or Source A valid for Source B.
    private var manualSourceID: UInt64?
    private var manualTargetNodeID: UInt64?
    private var libraryObserver: XDriveIOSForegroundPhotoLibraryObserver?

    func canShowTransferStatus(for owner: XDriveNativeOwnerRoot?) -> Bool {
        guard let owner else { return false }
        return XDriveIOSNativePhotoOwnerScope.matches(displayOwner, owner) &&
            (!busy || XDriveIOSNativePhotoOwnerScope.matches(runningOwner, owner))
    }

    /// Observe changes without enumerating PhotoKit or starting a writer.
    /// The native root owns the observer across tab switches; a late callback
    /// always reads the CURRENT Owner rather than a captured former account.
    func startLibraryChangeMonitoring(login: XDriveIOSNativeOwnerLoginModel) {
        guard libraryObserver == nil else { return }
        let observer = XDriveIOSForegroundPhotoLibraryObserver { [weak self, weak login] in
            guard let self, let login, let owner = login.owner,
                  [.authorized].contains(
                    PHPhotoLibrary.authorizationStatus(for: .readWrite)
                  ) else { return }
            guard (try? XDriveIOSPhotoAutoScheduleStore.shared
                .expediteForLibraryChange(owner: owner)) != nil else { return }
            // Only the already-running foreground timer may enter tickIfDue.
            // Avoid a same-callback scan while PhotoKit is delivering changes.
            self.refresh(owner: owner)
        }
        PHPhotoLibrary.shared().register(observer)
        libraryObserver = observer
    }

    func stopLibraryChangeMonitoring() {
        guard let observer = libraryObserver else { return }
        PHPhotoLibrary.shared().unregisterChangeObserver(observer)
        libraryObserver = nil
    }

    func refresh(owner: XDriveNativeOwnerRoot?) {
        let unchanged: Bool
        switch (displayOwner, owner) {
        case (nil, nil):
            unchanged = true
        case (let previous?, let current?):
            unchanged = XDriveIOSNativePhotoOwnerScope.matches(current, previous)
        default:
            unchanged = false
        }
        if !unchanged {
            displayEpoch = UUID()
            manualNextWindow = 0
            manualLibraryEpoch = nil
            manualAuthorizationRaw = nil
            manualSourceID = nil
            manualTargetNodeID = nil
            progress = nil
            message = "未启动相册备份"
            errorMessage = nil
        }
        // Keep the existing atomic Owner-reset sequence intact. Focused
        // progress is also per-Owner and must be cleared synchronously.
        if !unchanged { focusedSummary = nil }
        displayOwner = owner
        if let last = confirmedOriginalUpdate,
           !XDriveIOSNativePhotoOwnerScope.matches(owner, last.owner) {
            confirmedOriginalUpdate = nil
        }
        schedule = owner.flatMap { XDriveIOSPhotoAutoScheduleStore.shared.status(owner: $0) }
    }

    /// A receipt review has independently proven an old, potentially committed
    /// original against the current Server Session AND Owner Node. Reusing the
    /// existing event only re-reads the cloud wall; it never increments upload
    /// progress, resumes an automatic schedule, or treats unknown ACKs as done.
    func signalConfirmedReceiptReadback(
        owner: XDriveNativeOwnerRoot,
        login: XDriveIOSNativeOwnerLoginModel
    ) {
        guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) else { return }
        confirmedOriginalUpdate = ConfirmedOriginalUpdate(owner: owner, id: UUID())
    }

    func cancel() {
        running?.cancel()
    }

    func configure(login: XDriveIOSNativeOwnerLoginModel,
                   expectedOwner: XDriveNativeOwnerRoot,
                   expectedDestination: XDriveIOSPhotoManagedDestination,
                   minutes: Int, allowICloud: Bool,
                   startRule: XDriveIOSPhotoAutoStartRule,
                   enabledAt: Date) async {
        guard !busy, enabledAt.timeIntervalSince1970.isFinite,
              XDriveIOSPhotoAutoSchedulePolicy.accepts(minutes: minutes)
        else { return }
        // Native consent must remain bound to the exact approved Owner.
        guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner) else {
            errorMessage = "确认后服务器或账户已变化，请重新确认；自动备份未开启。"
            return
        }
        let selected = expectedOwner
        refresh(owner: selected)
        let uiEpoch = displayEpoch
        let store = XDriveIOSPhotoAutoScheduleStore.shared
        let stopVersion = store.localStopGeneration
        guard [.authorized].contains(
            PHPhotoLibrary.authorizationStatus(for: .readWrite)
        ) else {
            errorMessage = "请先在本机相册页面授权访问照片。"
            return
        }
        errorMessage = nil
        // Capture the only-new boundary at the user's native confirmation,
        // BEFORE any awaited Server preflight. Do not persist it yet: a
        // rejected Owner/Device/Source/Target must not leave a durable queue
        // checkpoint from a backup plan that was never enabled.
        let consentEpoch: XDriveIOSPhotoKitLibraryEpoch.Snapshot?
        do {
            if startRule == .onlyNew {
                consentEpoch = try XDriveIOSPhotoKitLibraryEpoch.capture()
            } else {
                consentEpoch = nil
            }
        } catch {
            errorMessage = "无法读取当前 PhotoKit 增量基准；自动备份未开启。"
            return
        }
        var configured = false
        do {
            let first = try await login.verifiedAuthorization()
            try Task.checkCancellation()
            guard XDriveIOSNativePhotoOwnerScope.matches(first.owner, selected),
                  XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected) else {
                throw XDriveIOSNativeSessionError.staleSession
            }

            // A user could disable a paused schedule and re-enable it without
            // entering the explicit receipt-review flow. Acquire the same
            // global original gate as manual/BG writers before a trusted
            // ledger read; a pending/unknown ACK must NEVER be bypassed by
            // deleting or recreating an automatic schedule.
            guard let gate = XDriveIOSOriginalRunGate.shared.acquire() else {
                errorMessage = "另一项原件操作或收据核对正在进行；自动备份未开启。"
                return
            }
            defer { XDriveIOSOriginalRunGate.shared.release(gate) }
            if store.status(owner: selected)?.pausedForReview == true {
                errorMessage = "已有因收据不确定而暂停的计划，请先在收据核对区明确恢复。"
                return
            }
            let scope = try await XDriveIOSForegroundBackupIdentity.shared
                .existingLocalScope(owner: selected)
            guard displayEpoch == uiEpoch,
                  XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected)
            else { throw XDriveIOSNativeSessionError.staleSession }
            if let scope {
                let pending = try await XDrivePhotoSyncLedger.shared
                    .pendingReceiptSnapshot(scope: scope, limit: 0).pending
                guard displayEpoch == uiEpoch,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected)
                else { throw XDriveIOSNativeSessionError.staleSession }
                guard pending == 0 else {
                    errorMessage = "当前账户还有 \(pending) 项结果不确定的上传收据，请先核对；自动备份未开启。"
                    return
                }
            } else if store.status(owner: selected)?.enabled == true {
                // A previously enabled schedule with no verifiable ledger is
                // not evidence that the old backup has safely completed.
                errorMessage = "已有计划的加密账本不可验证，未重置或绕过旧收据。"
                return
            }
            try Task.checkCancellation()
            // An Owner/permission switch while awaiting PhotoKit must not
            // activate a now-stale consent or create a running schedule.
            let second = try await login.verifiedAuthorization()
            guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected),
                  XDriveIOSNativePhotoOwnerScope.matches(first.owner, selected),
                  XDriveIOSNativePhotoOwnerScope.matches(second.owner, selected),
                  store.localStopGeneration == stopVersion,
                  displayEpoch == uiEpoch,
                  UIApplication.shared.applicationState == .active,
                  [.authorized].contains(
                    PHPhotoLibrary.authorizationStatus(for: .readWrite)
                  ) else {
                throw XDriveIOSNativeSessionError.staleSession
            }
            // A verified Owner root is NOT an authorized photo destination.
            // Fail closed before persisting any new automatic plan.
            let managed = try await XDriveIOSNativePhotoBackupDestinationModel
                .readExistingForUpload(owner: selected, accessToken: second.accessToken)
            try Task.checkCancellation()
            guard displayEpoch == uiEpoch,
                  store.localStopGeneration == stopVersion,
                  XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected),
                  managed.destination == expectedDestination,
                  UIApplication.shared.applicationState == .active else {
                throw XDriveIOSNativeSessionError.staleSession
            }
            if let consentEpoch {
                // Persist the original, consent-time PhotoKit token ONLY after
                // the current managed target was authenticated. New imports
                // or edits during Server verification remain replayable from
                // this token, including imports with old capture dates.
                // Existing baselines are never advanced over pending edits.
                let changeQueue = try XDriveIOSPhotoKitPersistentBackupQueue(
                    owner: selected
                )
                _ = try await changeQueue.installNewOnlyBaseline(
                    owner: selected,
                    consentToken: consentEpoch.serialized,
                    consentAuthorization: consentEpoch.authorization
                )
                try Task.checkCancellation()
                guard displayEpoch == uiEpoch,
                      store.localStopGeneration == stopVersion,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected),
                      UIApplication.shared.applicationState == .active,
                      PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized
                else { throw XDriveIOSNativeSessionError.staleSession }
            }
            schedule = try store.configure(
                owner: selected, minutes: minutes, allowICloud: allowICloud,
                startRule: startRule, enabledAt: enabledAt,
                sourceID: managed.destination.sourceID,
                targetNodeID: managed.destination.targetNodeID
            )
            message = "已开启原生前台自动增量备份。仅 App 活跃时按计划检查，系统不保证锁屏或强制退出后定时执行。"
            configured = true
        } catch {
            if displayEpoch == uiEpoch,
               XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected) {
                errorMessage = "无法验证当前 Owner、设备备份目标或加密账本，自动备份未开启；不会清除不确定收据。"
            }
        }
        // Do not tick while holding the shared writer gate: it would reject
        // this newly enabled schedule as an overlapping original operation.
        if configured { tickIfDue(login: login) }
    }

    /// Local stop is always possible even when the Server is offline.
    /// Does not erase sealed receipts or any previously backed-up bytes.
    func disable(owner: XDriveNativeOwnerRoot?) {
        cancel()
        if let owner { XDriveIOSPhotoAutoScheduleStore.shared.disable(owner: owner) }
        refresh(owner: owner)
        message = "已停止当前账户的前台自动备份；已有原件和待核对收据仍保留。"
    }

    func startManual(login: XDriveIOSNativeOwnerLoginModel,
                     expectedOwner: XDriveNativeOwnerRoot, allowICloud: Bool) {
        // The exact Server/Owner was captured when native consent was shown.
        // This synchronous MainActor fence precedes any upload or async work.
        guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner) else {
            errorMessage = "确认后服务器或账户已变化；未开始上传原件。"
            return
        }
        // PhotoKit access may be revoked while the native consent sheet is
        // open. The shared writer's guard must not fail silently or leave an
        // earlier successful upload report looking like this attempt.
        guard [.authorized].contains(
            PHPhotoLibrary.authorizationStatus(for: .readWrite)
        ) else {
            if !busy { progress = nil }
            errorMessage = "照片读取权限已变化；未启动原件上传。请先恢复 iOS 照片访问权限。"
            return
        }
        start(login: login, kind: .manual, allowICloud: allowICloud)
    }


    /// Upload one explicitly selected PhotoKit original ahead of the batch
    /// cursor. The selected Owner is captured by the native confirmation UI;
    /// the shared run gate and existing CAS receipt writer still apply.
    func startSingle(login: XDriveIOSNativeOwnerLoginModel,
                     expectedOwner: XDriveNativeOwnerRoot,
                     localIdentifier: String, allowICloud: Bool) {
        guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner),
              !localIdentifier.isEmpty, localIdentifier.utf8.count <= 1024,
              !localIdentifier.contains("\u{0}") else {
            errorMessage = "服务器、账户或所选照片已变化；未启动优先备份。"
            return
        }
        guard [.authorized].contains(
            PHPhotoLibrary.authorizationStatus(for: .readWrite)
        ) else {
            errorMessage = "照片访问权限已变化，无法优先备份所选原件。"
            return
        }
        start(
            login: login, kind: .single, allowICloud: allowICloud,
            singleLocalIdentifier: localIdentifier
        )
    }

    /// A Synology-style concentrated first pass, deliberately foreground
    /// only. An explicit Owner-bound consent is mandatory; it reuses the
    /// exact same CAS/ledger writer as manual and scheduled backup.
    func startFocused(login: XDriveIOSNativeOwnerLoginModel,
                      expectedOwner: XDriveNativeOwnerRoot, allowICloud: Bool) {
        guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner) else {
            errorMessage = "集中备份确认后服务器或账户已改变，未上传原件。"
            return
        }
        guard [.authorized].contains(
            PHPhotoLibrary.authorizationStatus(for: .readWrite)
        ) else {
            errorMessage = "照片读取权限已变化，无法开始集中备份。"
            return
        }
        start(login: login, kind: .focused, allowICloud: allowICloud)
    }

    func tickIfDue(login: XDriveIOSNativeOwnerLoginModel) {
        guard let owner = login.owner,
              let state = XDriveIOSPhotoAutoScheduleStore.shared.status(owner: owner),
              state.enabled, !state.pausedForReview,
              state.nextDueAt <= Date() else { return }
        start(login: login, kind: .automatic, allowICloud: state.allowICloudOriginals)
    }

    private func start(login: XDriveIOSNativeOwnerLoginModel,
                       kind: RunKind, allowICloud: Bool,
                       singleLocalIdentifier: String? = nil) {
        guard !busy, running == nil, let selected = login.owner,
              UIApplication.shared.applicationState == .active,
              [.authorized].contains(
                PHPhotoLibrary.authorizationStatus(for: .readWrite)
              ) else { return }
        // Acquire BEFORE reserveDue, shared with legacy Web manual/auto and
        // BGProcessing. Busy must never consume the next eligible window.
        guard let gate = XDriveIOSOriginalRunGate.shared.acquire() else {
            message = "另一项原件操作正在进行，本次未占用自动备份计划。"
            return
        }
        // A pending task from a former account must not repopulate this
        // Owner's result fields after account switch / logout.
        refresh(owner: selected)
        let uiEpoch = displayEpoch
        busy = true
        runningOwner = selected
        progress = nil
        focusedSummary = kind == .focused ? XDriveIOSFocusedBackupSummary() : nil
        errorMessage = nil
        running = Task { @MainActor [weak self] in
            defer {
                XDriveIOSOriginalRunGate.shared.release(gate)
                self?.running = nil
                self?.runningOwner = nil
                self?.busy = false
            }
            guard let self else { return }
            // These are per-run transient witnesses only. The first possible
            // original write permanently disables fast retry for this run.
            var automaticReservedNextDueAt: Date?
            var beganOriginalWrite = false
            var sourceRunReporter: XDriveIOSPhotoSourceRunReporter?
            // Recorded only after the selected original is already verified
            // AND its pre-write PhotoKit revision has been CAS-settled. The
            // gallery event is dispatched solely at the terminal run boundary.
            var didSettleVerifiedExistingSingle = false
            do {
                _ = try XDriveIOSPhotoBackupNetworkPolicy.shared.requireWiFiIfNeeded(for: selected)
                let verified = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard XDriveIOSNativePhotoOwnerScope.matches(verified.owner, selected),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected),
                      UIApplication.shared.applicationState == .active else {
                    throw XDriveIOSNativeSessionError.staleSession
                }
                // An older manual/BG UploadSession could have lost its
                // finalize ACK after this automatic plan was first enabled.
                // This is a GLOBAL current-Owner receipt gate, not a check
                // limited to the next 256-item PhotoKit window. It runs while
                // holding the same original writer lock as every upload.
                let olderPending = try await XDriveIOSOriginalPendingReceiptPreflight
                    .pendingCount(owner: selected)
                try Task.checkCancellation()
                guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected),
                      UIApplication.shared.applicationState == .active else {
                    throw XDriveIOSNativeSessionError.staleSession
                }
                if olderPending > 0 {
                    // Any foreground original entry point must pause an
                    // already-enabled automatic plan when the global receipt
                    // gate finds an unknown write. Do not wait for a later tick.
                    self.schedule = try XDriveIOSPhotoAutoScheduleStore.shared
                        .pauseForPendingReceipts(owner: selected)
                    self.errorMessage = "当前账户已有 \(olderPending) 项不确定原件收据；请先只读核对，本轮未上传新原件。"
                    return
                }

                // Do this read-only current Owner+Device+Source/Node proof
                // BEFORE reserveDue. An unconfigured target may not consume
                // the schedule or fall back to the old Owner-root writer.
                let managed = try await XDriveIOSNativePhotoBackupDestinationModel
                    .readExistingForUpload(owner: selected, accessToken: verified.accessToken)
                try Task.checkCancellation()
                guard self.displayEpoch == uiEpoch,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected),
                      UIApplication.shared.applicationState == .active else {
                    throw XDriveIOSNativeSessionError.staleSession
                }
                let reporter = XDriveIOSPhotoSourceRunReporter(
                    authority: managed,
                    trigger: kind == .automatic ? "scheduled" : "manual"
                )
                sourceRunReporter = reporter

                if kind == .single {
                    guard let localIdentifier = singleLocalIdentifier else {
                        throw XDriveIOSPhotoBackupMVPError.identityNotVerified
                    }
                    // Capture the queued revision before calling the
                    // shared original writer. Never fetch a new revision
                    // after upload and accidentally confirm a newer edit.
                    var selectedQueue: XDriveIOSPhotoKitPersistentBackupQueue?
                    var selectedRevision: XDriveIOSPhotoBackupChangeQueueStore.Pending?
                    if let plan = XDriveIOSPhotoAutoScheduleStore.shared.status(owner: selected),
                       plan.enabled, plan.backupStartRule == .onlyNew,
                       !plan.pausedForReview,
                       !plan.requiresFullLibraryReconciliation {
                        let queue = try XDriveIOSPhotoKitPersistentBackupQueue(owner: selected)
                        do {
                            // The user explicitly confirmed THIS original.
                            // Only a proven local item failure may transition
                            // back to pending under the current PhotoKit token.
                            // Unknown ACKs were stopped by the global receipt
                            // preflight before reaching this branch.
                            _ = try await queue.retryFailedSingle(
                                owner: selected, localIdentifier: localIdentifier
                            )
                            selectedRevision = try await queue.pendingForSingle(
                                owner: selected, localIdentifier: localIdentifier
                            )
                            if selectedRevision != nil { selectedQueue = queue }
                        } catch XDriveIOSPhotoKitPersistentBackupQueue.Failure.unauthorizedOrChanged {
                            // Do not settle a generation whose authorization
                            // changed; the explicit single writer still uses
                            // current independent Server admission checks.
                        }
                    }
                    try Task.checkCancellation()
                    guard self.displayEpoch == uiEpoch,
                          XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected),
                          XDriveIOSNativePhotoOwnerScope.matches(self.runningOwner, selected),
                          UIApplication.shared.applicationState == .active else {
                        throw XDriveIOSNativeSessionError.staleSession
                    }
                    await reporter.begin()
                    // SourceRun start may suspend. A sign-out or scene/Owner
                    // switch after the one-item PhotoKit queue CAS must abort
                    // before the very first UploadSession.
                    try Task.checkCancellation()
                    guard self.displayEpoch == uiEpoch,
                          XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected),
                          XDriveIOSNativePhotoOwnerScope.matches(self.runningOwner, selected),
                          UIApplication.shared.applicationState == .active else {
                        throw XDriveIOSNativeSessionError.staleSession
                    }
                    let result = try await XDriveIOSForegroundPhotoBackupMVP(
                        owner: selected, managedForeground: managed,
                        onSourceProgress: { value in
                            reporter.enqueueUpdate(value)
                        }
                    ).runSingle(
                        localIdentifier: localIdentifier,
                        allowICloudOriginals: allowICloud,
                        onPotentialWrite: { beganOriginalWrite = true }
                    ) { [weak self] value in
                        guard XDriveIOSNativePhotoOwnerScope.matches(self?.runningOwner, selected),
                              self?.displayEpoch == uiEpoch,
                              XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected)
                        else { return }
                        self?.progress = value
                    }
                    try Task.checkCancellation()
                    guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected),
                          self.displayEpoch == uiEpoch else {
                        throw XDriveIOSNativeSessionError.staleSession
                    }
                    self.progress = result
                    var queueNeedsRecheck = false
                    var queueRevisionSettled = false
                    if (result.uploaded == 1 || result.verifiedAlready == 1),
                       !result.stoppedForReview, result.needsReview == 0,
                       let selectedQueue, let selectedRevision {
                        // runSingle has already verified the current Owner/
                        // Target Node receipt. Only then can this exact queued
                        // PhotoKit revision be atomically marked confirmed.
                        do {
                            queueRevisionSettled = try await selectedQueue.settle(
                                selectedRevision, result: .confirmed, owner: selected
                            )
                            queueNeedsRecheck = !queueRevisionSettled
                        } catch {
                            // A newer edit, local persistence problem or
                            // permission change must leave the pending row
                            // untouched. Never retry an ambiguous write here.
                            queueNeedsRecheck = true
                        }
                    }
                    if queueRevisionSettled && result.verifiedAlready > 0 {
                        // Defer the refresh until the task's terminal Owner
                        // and epoch checks. A resolved prior Server receipt
                        // must not publish while this writer is still active.
                        didSettleVerifiedExistingSingle = true
                    }
                    if result.stoppedForReview || result.needsReview > 0 {
                        // An unknown ACK from a one-photo priority action must
                        // pause the current Owner's foreground schedule now,
                        // not wait for the next timer tick to rediscover it.
                        if let paused = try XDriveIOSPhotoAutoScheduleStore.shared
                            .pauseForPendingReceipts(owner: selected) {
                            self.schedule = paused
                        }
                    }
                    self.message = "单张优先备份：新增 \(result.uploaded)，已验证 \(result.verifiedAlready)，待核对 \(result.needsReview)，不可用 \(result.unavailable)。"
                    if result.stoppedForReview || result.needsReview > 0 {
                        self.schedule = try XDriveIOSPhotoAutoScheduleStore.shared
                            .pauseForPendingReceipts(owner: selected)
                        self.errorMessage = "单张优先备份结果不确定；当前账户的自动备份已暂停，请先核对上传收据。"
                    }
                    if queueNeedsRecheck {
                        self.errorMessage = "服务器原件收据已核验，但 PhotoKit 队列版本未结算；保留待核验记录，不自动重传。"
                    }
                    await reporter.finish(status: "completed")
                } else if kind == .focused {
                    await reporter.begin()
                    try await self.runFocused(
                        login: login, owner: selected, uiEpoch: uiEpoch,
                        allowICloud: allowICloud,
                        initialSourceID: managed.destination.sourceID,
                        initialTargetNodeID: managed.destination.targetNodeID,
                        sourceRunReporter: reporter
                    )
                    await reporter.finish(status: "completed")
                } else {
                    let window: Int
                    let cloud: Bool
                    let newOnlySince: Date?
                    let manualStartEpoch: XDriveIOSPhotoKitLibraryEpoch.Snapshot?
                    var incrementalQueue: XDriveIOSPhotoKitPersistentBackupQueue?
                    var canUseOnlyNewDateFilter = true
                    if kind == .automatic {
                        // Durably replay a bounded PhotoKit change batch before
                        // reserving the positional scan window. The same queue
                        // is then consumed by the existing CAS original writer.
                        if kind == .automatic,
                           var activePlan = XDriveIOSPhotoAutoScheduleStore.shared
                            .status(owner: selected),
                           activePlan.backupStartRule == .onlyNew {
                            // If the process stopped after the full scan but
                            // before its SQLite rebase, finish only the exact
                            // token/authorization generation that was scanned.
                            if activePlan.historyRecoveryReadyToCommit == true,
                               let expectedToken = activePlan.libraryChangeEpoch,
                               let expectedAuthorization = activePlan.libraryAuthorizationRaw {
                                let recoveryQueue = try XDriveIOSPhotoKitPersistentBackupQueue(
                                    owner: selected
                                )
                                do {
                                    try await recoveryQueue.completeFullLibraryReconciliation(
                                        owner: selected, expectedToken: expectedToken,
                                        expectedAuthorization: expectedAuthorization
                                    )
                                    guard let finished = try XDriveIOSPhotoAutoScheduleStore.shared
                                        .finishFullLibraryReconciliation(
                                            owner: selected, expectedToken: expectedToken,
                                            expectedAuthorization: expectedAuthorization
                                        ) else {
                                        throw XDriveIOSPhotoAutoScheduleError.persistenceUnavailable
                                    }
                                    activePlan = finished
                                    self.schedule = finished
                                } catch XDriveIOSPhotoKitPersistentBackupQueue.Failure
                                    .unauthorizedOrChanged {
                                    // The library changed after the last full
                                    // scan. Re-run under the same explicit scope
                                    // consent; do not ask again unless permission expands.
                                    activePlan = try XDriveIOSPhotoAutoScheduleStore.shared
                                        .restartFullLibraryReconciliation(owner: selected) ?? activePlan
                                    self.schedule = activePlan
                                } catch XDriveIOSPhotoKitPersistentBackupQueue.Failure
                                    .authorizationChanged {
                                    // Full/Limited authorization changed after
                                    // consent. Require a fresh scope decision.
                                    activePlan = try XDriveIOSPhotoAutoScheduleStore.shared
                                        .requireFullLibraryReconciliation(owner: selected) ?? activePlan
                                    self.schedule = activePlan
                                }
                            }
                            if activePlan.requiresFullLibraryReconciliation {
                                // History was expired/unavailable. Reconcile
                                // the entire current authorized snapshot with
                                // the shared receipt verifier; never apply the
                                // only-new capture-date filter or stale queue.
                                incrementalQueue = nil
                                canUseOnlyNewDateFilter = false
                            } else {
                                let changeQueue = try XDriveIOSPhotoKitPersistentBackupQueue(
                                    owner: selected
                                )
                                incrementalQueue = changeQueue
                                do {
                                    _ = try await changeQueue.replay(
                                        owner: selected, maximumEvents: 4
                                    )
                                    guard try await changeQueue.isCaughtUp(owner: selected) else {
                                        // Do not let the date-filtered positional
                                        // scan pass an old-dated import while its
                                        // persistent PhotoKit event is still behind
                                        // the bounded replay cursor. Keep this due
                                        // window unreserved; the foreground timer
                                        // will replay the next bounded batch.
                                        self.message = "PhotoKit 增量变更仍在分批回放；本轮暂不扫描，避免漏掉拍摄日期较早的新导入照片。"
                                        await reporter.finish(status: "cancelled")
                                        self.refresh(owner: selected)
                                        return
                                    }
                                } catch XDriveIOSPhotoKitPersistentBackupQueue.Failure
                                    .requiresExplicitBaseline,
                                    XDriveIOSPhotoKitPersistentBackupQueue.Failure.invalidArchivedToken,
                                    XDriveIOSPhotoKitPersistentBackupQueue.Failure.historyUnavailable,
                                    XDriveIOSPhotoKitPersistentBackupQueue.Failure.authorizationChanged {
                                    // A missing, expired, incomplete or
                                    // generation-mismatched history cannot
                                    // justify date filtering. Persist a pause;
                                    // the user must consent before full-scope writes.
                                    activePlan = try XDriveIOSPhotoAutoScheduleStore.shared
                                        .requireFullLibraryReconciliation(owner: selected) ?? activePlan
                                    self.schedule = activePlan
                                    incrementalQueue = nil
                                    canUseOnlyNewDateFilter = false
                                }
                            }
                            // The store independently enforces this consent before
                            // reserveDue. Stop here as well: no scan, new upload,
                            // or changed automatic due time before an Owner
                            // explicitly approves the recovery upload scope.
                            if activePlan.requiresFullLibraryReconciliation &&
                               (activePlan.historyRecoveryRequiresConsent == true ||
                                activePlan.historyRecoveryFullScopeConfirmed != true) {
                                self.message = "PhotoKit 增量历史不可用：请先在备份设置中确认全库核对；未经确认不会补传旧照片。"
                                await reporter.finish(status: "cancelled")
                                self.refresh(owner: selected)
                                return
                            }
                            try Task.checkCancellation()
                            guard self.displayEpoch == uiEpoch,
                                  XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected),
                                  UIApplication.shared.applicationState == .active
                            else { throw XDriveIOSNativeSessionError.staleSession }
                        }
                        _ = try XDriveIOSPhotoBackupNetworkPolicy.shared.requireWiFiIfNeeded(for: selected)
                        guard let due = try XDriveIOSPhotoAutoScheduleStore.shared
                            .reserveDue(owner: selected,
                                        sourceID: managed.destination.sourceID,
                                        targetNodeID: managed.destination.targetNodeID) else {
                            await reporter.finish(status: "cancelled")
                            self.refresh(owner: selected)
                            return
                        }
                        automaticReservedNextDueAt = due.nextDueAt
                        window = due.windowIndex
                        cloud = due.allowICloudOriginals
                        newOnlySince = due.backupStartRule == .onlyNew &&
                            canUseOnlyNewDateFilter ? due.newOnlySince : nil
                        manualStartEpoch = nil
                    } else {
                        // Manual and automatic passes share the same 256-slot
                        // completion policy, but NOT the saved auto schedule.
                        // Even with an unchanged PhotoKit epoch, an index
                        // scanned for a previous Source/Node must not skip
                        // originals in the new managed destination.
                        let sameTarget = XDriveIOSPhotoBackupDestinationCursorPolicy.sameManagedTarget(
                            savedSourceID: self.manualSourceID,
                            savedTargetNodeID: self.manualTargetNodeID,
                            currentSourceID: managed.destination.sourceID,
                            currentTargetNodeID: managed.destination.targetNodeID,
                            ownerRootNodeID: selected.rootNodeID
                        )
                        if !sameTarget {
                            self.manualNextWindow = 0
                            self.manualLibraryEpoch = nil
                            self.manualAuthorizationRaw = nil
                        }
                        self.manualSourceID = managed.destination.sourceID
                        self.manualTargetNodeID = managed.destination.targetNodeID
                        // An old positional index is also unusable after
                        // Photos edits or Full/Limited access changes.
                        let epoch = try XDriveIOSPhotoKitLibraryEpoch.capture()
                        window = XDrivePhotoCursorEpochPolicy.trustedWindow(
                            requested: self.manualNextWindow,
                            hasPriorToken: self.manualLibraryEpoch != nil,
                            tokenUnchanged: XDriveIOSPhotoKitLibraryEpoch.matches(
                                self.manualLibraryEpoch, as: epoch.token
                            ),
                            previousAuthorization: self.manualAuthorizationRaw,
                            currentAuthorization: epoch.authorization
                        )
                        self.manualNextWindow = window
                        cloud = allowICloud
                        newOnlySince = nil
                        manualStartEpoch = epoch
                    }
                    guard let offset = XDrivePhotoBackupScanWindow.offset(for: window)
                    else { throw XDriveIOSPhotoAutoScheduleError.persistenceUnavailable }
                    self.message = kind == .automatic
                        ? "自动增量备份正在检查第 \(window + 1) 段…"
                        : "手动备份正在检查第 \(window + 1) 段…"
                    await reporter.begin()
                    let result = try await XDriveIOSForegroundPhotoBackupMVP(
                        owner: selected, managedForeground: managed,
                        onSourceProgress: { value in
                            reporter.enqueueUpdate(value)
                        }
                    ).run(allowICloudOriginals: cloud, startOffset: offset,
                          newOnlySince: newOnlySince,
                          changeQueue: incrementalQueue,
                          onPotentialWrite: { beganOriginalWrite = true }) { [weak self] value in
                        guard XDriveIOSNativePhotoOwnerScope.matches(self?.runningOwner, selected),
                              self?.displayEpoch == uiEpoch,
                              XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected)
                        else { return }
                        self?.progress = value
                    }
                    try Task.checkCancellation()
                    guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected),
                          self.displayEpoch == uiEpoch else {
                        throw XDriveIOSNativeSessionError.staleSession
                    }
                    self.progress = result
                    if kind == .automatic {
                        let recorded = try XDriveIOSPhotoAutoScheduleStore.shared.recordResult(
                            owner: selected,
                            sourceID: managed.destination.sourceID,
                            targetNodeID: managed.destination.targetNodeID,
                            progress: result
                        )
                        self.schedule = recorded
                        if let recovery = recorded,
                           recovery.historyRecoveryReadyToCommit == true,
                           let expectedToken = recovery.libraryChangeEpoch,
                           let expectedAuthorization = recovery.libraryAuthorizationRaw {
                            let recoveryQueue = try XDriveIOSPhotoKitPersistentBackupQueue(
                                owner: selected
                            )
                            try await recoveryQueue.completeFullLibraryReconciliation(
                                owner: selected, expectedToken: expectedToken,
                                expectedAuthorization: expectedAuthorization
                            )
                            guard let finished = try XDriveIOSPhotoAutoScheduleStore.shared
                                .finishFullLibraryReconciliation(
                                    owner: selected, expectedToken: expectedToken,
                                    expectedAuthorization: expectedAuthorization
                                ) else {
                                throw XDriveIOSPhotoAutoScheduleError.persistenceUnavailable
                            }
                            self.schedule = finished
                        }
                    } else if let initial = manualStartEpoch {
                        // Never advance a manual cursor if PhotoKit changed while
                        // an original was staged/uploaded. Repeat a partial
                        // 20-upload-cap window; wrap only at the authorized end.
                        let completed = try XDriveIOSPhotoKitLibraryEpoch.capture()
                        let unchanged = XDrivePhotoCursorEpochPolicy.canResume(
                            hasPriorToken: true,
                            tokenUnchanged: XDriveIOSPhotoKitLibraryEpoch.matches(
                                initial.serialized, as: completed.token
                            ),
                            previousAuthorization: initial.authorization,
                            currentAuthorization: completed.authorization
                        )
                        self.manualNextWindow = unchanged
                            ? XDriveIOSPhotoAutoSchedulePolicy.nextWindow(
                                current: window, visibleTotal: result.totalVisible,
                                scanned: result.scanned, uploaded: result.windowUploaded,
                                needsReview: result.stoppedForReview || result.needsReview > 0
                              ) : 0
                        self.manualLibraryEpoch = completed.serialized
                        self.manualAuthorizationRaw = completed.authorization
                    }
                    self.message = "本轮确认新增 \(result.uploaded)，已验证存在 \(result.verifiedAlready)，待核对 \(result.needsReview)，不可用 \(result.unavailable)。"
                    if result.stoppedForReview || result.needsReview > 0 {
                        self.schedule = try XDriveIOSPhotoAutoScheduleStore.shared
                            .pauseForPendingReceipts(owner: selected)
                        self.errorMessage = "发现结果不确定的上传收据：当前账户的自动备份已暂停，不会盲目重传。"
                    }
                    await reporter.finish(status: "completed")
                }
            } catch XDriveIOSFocusedBackupFailure.libraryChanged {
                if let reporter = sourceRunReporter { await reporter.finish(status: "partial") }
                XDriveIOSPhotoFocusedResumeStore.shared.clear(owner: selected)
                if self.displayEpoch == uiEpoch,
                   XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected) {
                    self.errorMessage = "集中备份时系统相册或授权范围发生变化，已安全停止；请重新开始整库扫描，不会按旧位置跳过照片。"
                }
            } catch XDriveIOSFocusedBackupFailure.invalidWindow {
                if let reporter = sourceRunReporter { await reporter.finish(status: "failed") }
                XDriveIOSPhotoFocusedResumeStore.shared.clear(owner: selected)
                if self.displayEpoch == uiEpoch,
                   XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected) {
                    self.errorMessage = "集中备份返回的扫描进度无法校验，已停止以避免漏备或重复写入。"
                }
            } catch is CancellationError {
                if let reporter = sourceRunReporter { await reporter.finishAfterCancellation(status: "cancelled") }
                if self.displayEpoch == uiEpoch,
                   XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected) {
                    self.message = "原件任务已取消。可能已经提交的原件须通过加密账本与 Server 收据确认。"
                }
            } catch {
                if let reporter = sourceRunReporter { await reporter.finish(status: "failed") }
                var scheduledNetworkRetry = false
                let networkError = error as? URLError
                let retryableNetwork = error is XDriveIOSPhotoBackupNetworkError ||
                    networkError.map(XDriveIOSPhotoAutoSchedulePolicy.retryablePrewriteNetworkFailure) == true
                if kind == .automatic,
                   let reservedDue = automaticReservedNextDueAt,
                   !beganOriginalWrite, !Task.isCancelled,
                   retryableNetwork,
                   self.displayEpoch == uiEpoch,
                   XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected),
                   UIApplication.shared.applicationState == .active {
                    // A changed/disabled plan or receipt-review pause fails
                    // the expected due-time check. No upload/ACK replay here.
                    if let updated = try? XDriveIOSPhotoAutoScheduleStore.shared
                        .rescheduleSafePrewriteNetworkFailure(
                            owner: selected, expectedNextDueAt: reservedDue
                        ) {
                        self.schedule = updated
                        scheduledNetworkRetry = true
                    }
                }
                if self.displayEpoch == uiEpoch,
                   XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected) {
                    self.errorMessage = scheduledNetworkRetry
                        ? "尚未开始原件写入时网络中断：已保留当前扫描段，前台约 5 分钟后可再次检查；仍需重新验证 Owner 与收据。"
                        : Self.backupInterruptionMessage(error)
                }
            }
            // A successful original may be followed by a PhotoKit scan error,
            // cancellation, or failure persisting the automatic cursor.
            // The per-item progress increments uploaded ONLY after a verified
            // Server receipt, whereas the whole run might not return.
            // Invalidate the cloud wall once at the terminal boundary using
            // only that confirmed count; never interpret an unknown ACK as
            // a successful backup or let an old Owner refresh another account.
            if let current = self.progress,
               (current.uploaded > 0 ||
                (didSettleVerifiedExistingSingle && current.verifiedAlready > 0)),
               self.displayEpoch == uiEpoch,
               XDriveIOSNativePhotoOwnerScope.matches(self.runningOwner, selected),
               XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected) {
                self.confirmedOriginalUpdate = ConfirmedOriginalUpdate(
                    owner: selected, id: UUID()
                )
            } else if (self.focusedSummary?.confirmedNew ?? 0) > 0,
                      self.displayEpoch == uiEpoch,
                      XDriveIOSNativePhotoOwnerScope.matches(self.runningOwner, selected),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected) {
                // The final focused window can contain no new file while
                // previous windows did. Keep the original single-window
                // receipt refresh unchanged and cover this new case.
                self.confirmedOriginalUpdate = ConfirmedOriginalUpdate(
                    owner: selected, id: UUID()
                )
            }
            self.refresh(owner: login.owner)
        }
    }

    private static func backupInterruptionMessage(_ error: Error) -> String {
        if error is XDriveIOSPhotoBackupNetworkError {
            return "等待 Wi-Fi 连接。本轮已停止，结果不确定的上传仍需先核对收据。"
        }
        return "本轮未完成：请检查当前 Owner、iPhone 设备、受管目标目录、照片权限和加密账本；没有证据的原件不会被当作已备份。"
    }

    /// The independent focused session never modifies a saved interval,
    /// BG grant, manual cursor, or persistent encrypted receipt. Each window
    /// re-verifies the Owner to allow native refresh while the App is visible.
    /// A manually approved Focused pass can settle an existing only-new
    /// PhotoKit change queue through the SAME verified original writer. It
    /// never grants a new schedule or silently rebases missing history.
    private func prepareFocusedIncrementalQueue(
        login: XDriveIOSNativeOwnerLoginModel,
        owner: XDriveNativeOwnerRoot, uiEpoch: UUID,
        expectedEpoch: XDriveIOSPhotoKitLibraryEpoch.Snapshot
    ) async throws -> XDriveIOSPhotoKitPersistentBackupQueue? {
        guard let plan = XDriveIOSPhotoAutoScheduleStore.shared.status(owner: owner),
              plan.enabled, plan.backupStartRule == .onlyNew,
              !plan.pausedForReview,
              !plan.requiresFullLibraryReconciliation else { return nil }

        let queue = try XDriveIOSPhotoKitPersistentBackupQueue(owner: owner)
        var replayedEvents = 0
        do {
            while true {
                try Task.checkCancellation()
                guard displayEpoch == uiEpoch,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner),
                      XDriveIOSNativePhotoOwnerScope.matches(runningOwner, owner),
                      UIApplication.shared.applicationState == .active else {
                    throw XDriveIOSNativeSessionError.staleSession
                }
                // A disabled or paused automatic schedule must not be
                // re-enabled by this independent foreground session.
                guard let active = XDriveIOSPhotoAutoScheduleStore.shared
                    .status(owner: owner),
                      active.enabled, active.backupStartRule == .onlyNew,
                      !active.pausedForReview,
                      !active.requiresFullLibraryReconciliation else { return nil }
                let current = try XDriveIOSPhotoKitLibraryEpoch.capture()
                guard current.authorization == expectedEpoch.authorization,
                      XDriveIOSPhotoKitLibraryEpoch.matches(
                          expectedEpoch.serialized, as: current.token
                      ) else { throw XDriveIOSFocusedBackupFailure.libraryChanged }

                // Four history records per durable SQLite transaction.
                // Drain before scanning: even an old-dated new import must
                // not remain hidden behind the positional full-pass cursor.
                let batch = try await queue.replay(owner: owner, maximumEvents: 4)
                if try await queue.isCaughtUp(owner: owner) {
                    return queue
                }
                guard batch.events > 0 else {
                    // Avoid an infinite loop or an unsafe date-based fallback.
                    throw XDriveIOSFocusedBackupFailure.libraryChanged
                }
                replayedEvents += batch.events
                message = "集中备份先恢复 PhotoKit 增量变更（已回放 \(replayedEvents) 条）…"
                await Task.yield()
            }
        } catch XDriveIOSPhotoKitPersistentBackupQueue.Failure.requiresExplicitBaseline,
                XDriveIOSPhotoKitPersistentBackupQueue.Failure.invalidArchivedToken,
                XDriveIOSPhotoKitPersistentBackupQueue.Failure.historyUnavailable {
            // Focused is full-scope, but only-new auto still needs its own
            // explicit consent before a lost baseline can be replaced.
            schedule = try XDriveIOSPhotoAutoScheduleStore.shared
                .requireFullLibraryReconciliation(owner: owner)
            return nil
        } catch XDriveIOSPhotoKitPersistentBackupQueue.Failure.authorizationChanged {
            schedule = try XDriveIOSPhotoAutoScheduleStore.shared
                .requireFullLibraryReconciliation(owner: owner)
            throw XDriveIOSFocusedBackupFailure.libraryChanged
        }
    }

    private func runFocused(
        login: XDriveIOSNativeOwnerLoginModel,
        owner: XDriveNativeOwnerRoot, uiEpoch: UUID, allowICloud: Bool,
        initialSourceID: UInt64, initialTargetNodeID: UInt64,
        sourceRunReporter: XDriveIOSPhotoSourceRunReporter
    ) async throws {
        let initial = try XDriveIOSPhotoKitLibraryEpoch.capture()
        // A constant-time PhotoKit fetch count plus a SECOND epoch witness
        // protects the saved checkpoint from a permission/library mutation
        // between capturing the generation and reading the authorized count.
        let visibleNow = PHAsset.fetchAssets(with: nil).count
        let afterCount = try XDriveIOSPhotoKitLibraryEpoch.capture()
        guard afterCount.authorization == initial.authorization,
              XDriveIOSPhotoKitLibraryEpoch.matches(
                initial.serialized, as: afterCount.token
              ) else { throw XDriveIOSFocusedBackupFailure.libraryChanged }
        let focusedChangeQueue = try await prepareFocusedIncrementalQueue(
            login: login, owner: owner, uiEpoch: uiEpoch,
            expectedEpoch: initial
        )
        // Reuse a checkpoint only after the caller's global current-Owner
        // pending/unknown ACK preflight under the serial original writer gate.
        // A cursor never substitutes for Server-confirmed Node receipts.
        let resume = XDriveIOSPhotoFocusedResumeStore.shared.resume(
            owner: owner, epoch: initial, totalVisible: visibleNow,
            allowICloud: allowICloud,
            sourceID: initialSourceID, targetNodeID: initialTargetNodeID
        )
        var window = resume.nextWindow
        var sourceRunBase = XDriveIOSPhotoSourceRunCounts()
        var confirmedNew = 0
        var hadUnavailable = resume.hadUnavailable
        var expectedTotal: Int? = visibleNow
        var initialProgress = XDriveIOSFocusedBackupSummary()
        initialProgress.resumedFromWindow = window
        initialProgress.completedWindows = window
        initialProgress.currentWindow = window
        initialProgress.totalVisible = visibleNow
        initialProgress.totalWindows = XDrivePhotoBackupScanWindow.count(
            visibleTotal: visibleNow
        )
        initialProgress.hadUnavailable = hadUnavailable
        initialProgress.limitedAuthorization = initial.authorization ==
            PHAuthorizationStatus.limited.rawValue
        focusedSummary = initialProgress
        if window > 0 {
            message = "已校验同一授权相册与账户，从第 \(window + 1) 段继续集中扫描；历史收据仍须逐项核验。"
        }
        while true {
            try Task.checkCancellation()
            guard displayEpoch == uiEpoch,
                  XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner),
                  XDriveIOSNativePhotoOwnerScope.matches(runningOwner, owner),
                  UIApplication.shared.applicationState == .active else {
                throw XDriveIOSNativeSessionError.staleSession
            }
            let before = try XDriveIOSPhotoKitLibraryEpoch.capture()
            guard before.authorization == initial.authorization,
                  XDriveIOSPhotoKitLibraryEpoch.matches(
                    initial.serialized, as: before.token
                  ) else {
                throw XDriveIOSFocusedBackupFailure.libraryChanged
            }
            guard let offset = XDrivePhotoBackupScanWindow.offset(for: window) else {
                throw XDriveIOSFocusedBackupFailure.invalidWindow
            }
            // A single JWT must not be reused for hours of first backup.
            // Native token renewal is bound to the same currently logged-in
            // Owner/root and is checked before every batch.
            let auth = try await login.verifiedAuthorization()
            try Task.checkCancellation()
            guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, owner),
                  XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner),
                  displayEpoch == uiEpoch,
                  UIApplication.shared.applicationState == .active else {
                throw XDriveIOSNativeSessionError.staleSession
            }
            // Never reuse a previously authorized destination across a
            // later first-pass window, or allow a renamed/revoked Source.
            let managed = try await XDriveIOSNativePhotoBackupDestinationModel
                .readExistingForUpload(owner: owner, accessToken: auth.accessToken)
            guard managed.destination.sourceID == initialSourceID,
                  managed.destination.targetNodeID == initialTargetNodeID else {
                XDriveIOSPhotoFocusedResumeStore.shared.clear(owner: owner)
                throw XDriveIOSFocusedBackupFailure.libraryChanged
            }
            try Task.checkCancellation()
            guard displayEpoch == uiEpoch,
                  XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner),
                  UIApplication.shared.applicationState == .active else {
                throw XDriveIOSNativeSessionError.staleSession
            }
            message = "集中备份正在处理第 \(window + 1) 段…"
            let alreadyNew = confirmedNew
            let unavailableBefore = hadUnavailable
            let currentWindow = window
            let result = try await XDriveIOSForegroundPhotoBackupMVP(
                owner: owner, managedForeground: managed,
                onSourceProgress: { value in
                    sourceRunReporter.enqueueUpdate(value, base: sourceRunBase)
                }
            ).run(
                allowICloudOriginals: allowICloud, startOffset: offset,
                changeQueue: focusedChangeQueue
            ) { [weak self] value in
                guard let self,
                      self.displayEpoch == uiEpoch,
                      XDriveIOSNativePhotoOwnerScope.matches(self.runningOwner, owner),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner)
                else { return }
                self.progress = value
                var live = self.focusedSummary ?? XDriveIOSFocusedBackupSummary()
                live.currentWindow = currentWindow
                live.totalVisible = value.totalVisible
                live.totalWindows = XDrivePhotoBackupScanWindow.count(
                    visibleTotal: value.totalVisible
                )
                live.confirmedNew = alreadyNew + value.uploaded
                live.hadUnavailable = unavailableBefore ||
                    value.unavailable > 0 || value.videosNotSupported > 0 ||
                    value.liveNotSupported > 0
                live.limitedAuthorization = value.isLimited
                self.focusedSummary = live
            }
            try Task.checkCancellation()
            guard displayEpoch == uiEpoch,
                  XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner),
                  XDriveIOSNativePhotoOwnerScope.matches(runningOwner, owner),
                  UIApplication.shared.applicationState == .active else {
                throw XDriveIOSNativeSessionError.staleSession
            }
            let after = try XDriveIOSPhotoKitLibraryEpoch.capture()
            guard after.authorization == initial.authorization,
                  XDriveIOSPhotoKitLibraryEpoch.matches(
                    initial.serialized, as: after.token
                  ) else {
                throw XDriveIOSFocusedBackupFailure.libraryChanged
            }
            if let expectedTotal, expectedTotal != result.totalVisible {
                throw XDriveIOSFocusedBackupFailure.libraryChanged
            }
            expectedTotal = result.totalVisible
            sourceRunBase.add(result)
            confirmedNew += result.uploaded
            hadUnavailable = hadUnavailable || result.unavailable > 0 ||
                result.videosNotSupported > 0 || result.liveNotSupported > 0
            var state = focusedSummary ?? XDriveIOSFocusedBackupSummary()
            state.currentWindow = window
            state.totalVisible = result.totalVisible
            state.totalWindows = XDrivePhotoBackupScanWindow.count(
                visibleTotal: result.totalVisible
            )
            state.confirmedNew = confirmedNew
            state.hadUnavailable = hadUnavailable
            state.limitedAuthorization = result.isLimited
            progress = result

            let decision = XDriveIOSPhotoFocusedBackupPolicy.afterWindow(
                index: window, visibleTotal: result.totalVisible,
                scanned: result.scanned, uploaded: result.uploaded,
                needsReview: result.stoppedForReview || result.needsReview > 0,
                queuedUploaded: result.changeQueueUploaded
            )
            switch decision {
            case .repeatWindow(let same):
                // This is permitted only after the 20-file cap. Re-read every
                // prior confirmed original and Node; never trust stale flags.
                window = same
            case .nextWindow(let next):
                // Only a contiguous prefix with NO unavailable/unsupported
                // media may be skipped on a later run. Once one original was
                // unavailable, keep the previous safe checkpoint and let
                // the next explicit run revisit the first unresolved window.
                // Do not silently jump past the gap after later windows.
                if !hadUnavailable {
                    try XDriveIOSPhotoFocusedResumeStore.shared.saveCompletedWindow(
                        owner: owner, completedWindow: window, nextWindow: next,
                        totalVisible: result.totalVisible, epoch: after,
                        allowICloud: allowICloud, hadUnavailable: hadUnavailable,
                        sourceID: initialSourceID, targetNodeID: initialTargetNodeID
                    )
                }
                state.completedWindows += 1
                window = next
            case .finished:
                XDriveIOSPhotoFocusedResumeStore.shared.clear(owner: owner)
                state.completedWindows = state.totalWindows
                state.finishedScan = true
                focusedSummary = state
                message = hadUnavailable
                    ? "集中扫描已遍历当前授权媒体，新增 \(confirmedNew) 个原件；部分原件不可用或格式不支持，不能宣称整库已备份。"
                    : "集中扫描已遍历当前授权媒体，新增 \(confirmedNew) 个原件；这不是对全库云端原件的逐项实时验收。"
                if result.isLimited {
                    message += " 当前仅授权部分照片。"
                }
                return
            case .pausedForReview:
                state.pausedForReview = true
                focusedSummary = state
                errorMessage = "集中备份因不确定上传收据暂停；需先只读核对，不会自动重传。"
                return
            case .invalidProgress:
                XDriveIOSPhotoFocusedResumeStore.shared.clear(owner: owner)
                throw XDriveIOSFocusedBackupFailure.invalidWindow
            }
            focusedSummary = state
            await Task.yield()
        }
    }

}
