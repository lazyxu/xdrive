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

    private enum RunKind { case manual, automatic, focused }
    private var running: Task<Void, Never>?
    private var runningOwner: XDriveNativeOwnerRoot?
    // The native login model and backup controller survive tab switches.
    // Persist only the display Owner and a generation marker in RAM; never
    // render an old Owner's photo counts or terminal report after A -> B -> A.
    private var displayOwner: XDriveNativeOwnerRoot?
    private var displayEpoch = UUID()
    private var manualLibraryEpoch: Data?
    private var manualAuthorizationRaw: Int?

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
            progress = nil
            focusedSummary = nil
            message = "未启动相册备份"
            errorMessage = nil
        }
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
                   minutes: Int, allowICloud: Bool) async {
        guard !busy, XDriveIOSPhotoAutoSchedulePolicy.accepts(minutes: minutes)
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
        guard [.authorized, .limited].contains(
            PHPhotoLibrary.authorizationStatus(for: .readWrite)
        ) else {
            errorMessage = "请先在本机相册页面授权访问照片。"
            return
        }
        errorMessage = nil
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
            let second = try await login.verifiedAuthorization()
            guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected),
                  XDriveIOSNativePhotoOwnerScope.matches(first.owner, selected),
                  XDriveIOSNativePhotoOwnerScope.matches(second.owner, selected),
                  store.localStopGeneration == stopVersion,
                  displayEpoch == uiEpoch,
                  UIApplication.shared.applicationState == .active,
                  [.authorized, .limited].contains(
                    PHPhotoLibrary.authorizationStatus(for: .readWrite)
                  ) else {
                throw XDriveIOSNativeSessionError.staleSession
            }
            schedule = try store.configure(
                owner: selected, minutes: minutes, allowICloud: allowICloud
            )
            message = "已开启原生前台自动增量备份。仅 App 活跃时按计划检查，系统不保证锁屏或强制退出后定时执行。"
            configured = true
        } catch {
            if displayEpoch == uiEpoch,
               XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected) {
                errorMessage = "无法验证当前 Owner 或既有加密账本，自动备份未开启；不会清除不确定收据。"
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
        guard [.authorized, .limited].contains(
            PHPhotoLibrary.authorizationStatus(for: .readWrite)
        ) else {
            if !busy { progress = nil }
            errorMessage = "照片读取权限已变化；未启动原件上传。请先恢复 iOS 照片访问权限。"
            return
        }
        start(login: login, kind: .manual, allowICloud: allowICloud)
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
        guard [.authorized, .limited].contains(
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
                       kind: RunKind, allowICloud: Bool) {
        guard !busy, running == nil, let selected = login.owner,
              UIApplication.shared.applicationState == .active,
              [.authorized, .limited].contains(
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
            do {
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
                    if kind == .automatic {
                        // Persist a durable pause, not a consumed next window.
                        // A later explicit receipt review can safely resume.
                        self.schedule = try XDriveIOSPhotoAutoScheduleStore.shared
                            .pauseForPendingReceipts(owner: selected)
                    }
                    self.errorMessage = "当前账户已有 \(olderPending) 项不确定原件收据；请先只读核对，本轮未上传新原件。"
                    return
                }

                if kind == .focused {
                    try await self.runFocused(
                        login: login, owner: selected, uiEpoch: uiEpoch,
                        allowICloud: allowICloud
                    )
                } else {
                    let window: Int
                    let cloud: Bool
                    let manualStartEpoch: XDriveIOSPhotoKitLibraryEpoch.Snapshot?
                    if kind == .automatic {
                        guard let due = try XDriveIOSPhotoAutoScheduleStore.shared
                            .reserveDue(owner: selected) else {
                            self.refresh(owner: selected)
                            return
                        }
                        window = due.windowIndex
                        cloud = due.allowICloudOriginals
                        manualStartEpoch = nil
                    } else {
                        // Manual and automatic passes share the same 256-slot
                        // completion policy, but NOT the saved auto schedule.
                        // An old positional index is unusable after Photos edits
                        // or Full/Limited access changes; restart from the front.
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
                        manualStartEpoch = epoch
                    }
                    guard let offset = XDrivePhotoBackupScanWindow.offset(for: window)
                    else { throw XDriveIOSPhotoAutoScheduleError.persistenceUnavailable }
                    self.message = kind == .automatic
                        ? "自动增量备份正在检查第 \(window + 1) 段…"
                        : "手动备份正在检查第 \(window + 1) 段…"
                    let result = try await XDriveIOSForegroundPhotoBackupMVP(
                        owner: selected, accessToken: verified.accessToken
                    ).run(allowICloudOriginals: cloud, startOffset: offset) { [weak self] value in
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
                        self.schedule = try XDriveIOSPhotoAutoScheduleStore.shared.recordResult(
                            owner: selected, progress: result
                        )
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
                                scanned: result.scanned, uploaded: result.uploaded,
                                needsReview: result.stoppedForReview || result.needsReview > 0
                              ) : 0
                        self.manualLibraryEpoch = completed.serialized
                        self.manualAuthorizationRaw = completed.authorization
                    }
                    self.message = "本轮确认新增 \(result.uploaded)，已验证存在 \(result.verifiedAlready)，待核对 \(result.needsReview)，不可用 \(result.unavailable)。"
                    if result.stoppedForReview {
                        self.errorMessage = "发现结果不确定的上传收据：本轮已暂停，不会盲目重传。"
                    }
                }
            } catch XDriveIOSFocusedBackupFailure.libraryChanged {
                if self.displayEpoch == uiEpoch,
                   XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected) {
                    self.errorMessage = "集中备份时系统相册或授权范围发生变化，已安全停止；请重新开始整库扫描，不会按旧位置跳过照片。"
                }
            } catch XDriveIOSFocusedBackupFailure.invalidWindow {
                if self.displayEpoch == uiEpoch,
                   XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected) {
                    self.errorMessage = "集中备份返回的扫描进度无法校验，已停止以避免漏备或重复写入。"
                }
            } catch is CancellationError {
                if self.displayEpoch == uiEpoch,
                   XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected) {
                    self.message = "原件任务已取消。可能已经提交的原件须通过加密账本与 Server 收据确认。"
                }
            } catch {
                if self.displayEpoch == uiEpoch,
                   XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected) {
                    self.errorMessage = "本轮未完成：请检查当前 Owner、PhotoKit 权限、连接与本机加密账本；不能假定上传成功。"
                }
            }
            // A successful original may be followed by a PhotoKit scan error,
            // cancellation, or failure persisting the automatic cursor.
            // The per-item progress increments uploaded ONLY after a verified
            // Server receipt, whereas the whole run might not return.
            // Invalidate the cloud wall once at the terminal boundary using
            // only that confirmed count; never interpret an unknown ACK as
            // a successful backup or let an old Owner refresh another account.
            if (self.progress?.uploaded ?? 0) > 0 ||
               (self.focusedSummary?.confirmedNew ?? 0) > 0 {
                if self.displayEpoch == uiEpoch,
                   XDriveIOSNativePhotoOwnerScope.matches(self.runningOwner, selected),
                   XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected) {
                    self.confirmedOriginalUpdate = ConfirmedOriginalUpdate(
                        owner: selected, id: UUID()
                    )
                }
            }
            /* Only verified new receipts produce a cloud-wall refresh.
               The foreground focused session may have uploaded several
               completed windows before the final window returned 0. */
            /*
               Legacy single-window terminal handling is superseded by
               the Owner-fenced block above.
            */
            self.refresh(owner: login.owner)
        }
    }
    /// The independent focused session never modifies a saved interval,
    /// BG grant, manual cursor, or persistent encrypted receipt. Each window
    /// re-verifies the Owner to allow native refresh while the App is visible.
    private func runFocused(
        login: XDriveIOSNativeOwnerLoginModel,
        owner: XDriveNativeOwnerRoot, uiEpoch: UUID, allowICloud: Bool
    ) async throws {
        let initial = try XDriveIOSPhotoKitLibraryEpoch.capture()
        var window = 0
        var confirmedNew = 0
        var hadUnavailable = false
        var expectedTotal: Int?
        focusedSummary = XDriveIOSFocusedBackupSummary()
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
            message = "集中备份正在处理第 \(window + 1) 段…"
            let alreadyNew = confirmedNew
            let unavailableBefore = hadUnavailable
            let result = try await XDriveIOSForegroundPhotoBackupMVP(
                owner: owner, accessToken: auth.accessToken
            ).run(allowICloudOriginals: allowICloud, startOffset: offset) { [weak self] value in
                guard let self,
                      self.displayEpoch == uiEpoch,
                      XDriveIOSNativePhotoOwnerScope.matches(self.runningOwner, owner),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner)
                else { return }
                self.progress = value
                var live = self.focusedSummary ?? XDriveIOSFocusedBackupSummary()
                live.currentWindow = window
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
                needsReview: result.stoppedForReview || result.needsReview > 0
            )
            switch decision {
            case .repeatWindow(let same):
                // This is permitted only after the 20-file cap. Re-read every
                // prior confirmed original and Node; never trust stale flags.
                window = same
            case .nextWindow(let next):
                state.completedWindows += 1
                window = next
            case .finished:
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
                throw XDriveIOSFocusedBackupFailure.invalidWindow
            }
            focusedSummary = state
            await Task.yield()
        }
    }

}
