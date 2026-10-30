import Combine
import Foundation
import Photos
import UIKit

/// A native, Owner-bound foreground controller. Upload bytes, encrypted ACK
/// journal, deduplication and CAS receipts remain in the existing Swift writer.
@MainActor
final class XDriveIOSNativePhotoBackupController: ObservableObject {
    @Published private(set) var busy = false
    @Published private(set) var schedule: XDriveIOSPhotoAutoScheduleStore.State?
    @Published private(set) var progress: XDriveIOSPhotoBackupProgress?
    @Published private(set) var message = "未启动相册备份"
    @Published private(set) var errorMessage: String?

    private enum RunKind { case manual, automatic }
    private var running: Task<Void, Never>?
    private var runningOwner: XDriveNativeOwnerRoot?

    func refresh(owner: XDriveNativeOwnerRoot?) {
        schedule = owner.flatMap { XDriveIOSPhotoAutoScheduleStore.shared.status(owner: $0) }
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
            if let scope {
                let pending = try await XDrivePhotoSyncLedger.shared
                    .pendingReceiptSnapshot(scope: scope, limit: 0).pending
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
            errorMessage = "无法验证当前 Owner 或既有加密账本，自动备份未开启；不会清除不确定收据。"
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
        start(login: login, kind: .manual, allowICloud: allowICloud)
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
        busy = true
        runningOwner = selected
        progress = nil
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
                let window: Int
                let cloud: Bool
                if kind == .automatic {
                    guard let due = try XDriveIOSPhotoAutoScheduleStore.shared
                        .reserveDue(owner: selected) else {
                        self.refresh(owner: selected)
                        return
                    }
                    window = due.windowIndex
                    cloud = due.allowICloudOriginals
                } else {
                    // Manual scan is always the first bounded 256-item window.
                    window = 0
                    cloud = allowICloud
                }
                guard let offset = XDrivePhotoBackupScanWindow.offset(for: window)
                else { throw XDriveIOSPhotoAutoScheduleError.persistenceUnavailable }
                self.message = kind == .automatic
                    ? "自动增量备份正在检查第 \(window + 1) 段…"
                    : "手动备份正在检查已授权相册…"
                let result = try await XDriveIOSForegroundPhotoBackupMVP(
                    owner: selected, accessToken: verified.accessToken
                ).run(allowICloudOriginals: cloud, startOffset: offset) { [weak self] value in
                    guard XDriveIOSNativePhotoOwnerScope.matches(self?.runningOwner, selected)
                    else { return }
                    self?.progress = value
                }
                try Task.checkCancellation()
                guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected) else {
                    throw XDriveIOSNativeSessionError.staleSession
                }
                self.progress = result
                if kind == .automatic {
                    self.schedule = try XDriveIOSPhotoAutoScheduleStore.shared.recordResult(
                        owner: selected, progress: result
                    )
                }
                self.message = "本轮确认新增 \(result.uploaded)，已验证存在 \(result.verifiedAlready)，待核对 \(result.needsReview)，不可用 \(result.unavailable)。"
                if result.stoppedForReview {
                    self.errorMessage = "发现结果不确定的上传收据：本轮已暂停，不会盲目重传。"
                }
            } catch is CancellationError {
                self.message = "原件任务已取消。可能已经提交的原件须通过加密账本与 Server 收据确认。"
            } catch {
                self.errorMessage = "本轮未完成：请检查当前 Owner、PhotoKit 权限、连接与本机加密账本；不能假定上传成功。"
            }
            self.refresh(owner: login.owner)
        }
    }
}
