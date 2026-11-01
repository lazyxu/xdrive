import Combine
import Foundation
import Photos
import UIKit

/// Explicitly read-only recovery for an uncertain native PhotoKit ACK.
/// It reuses the same sealed Owner journal and resume-proof protocol as the
/// former Web Host. No fresh UploadSession or finalize is created here.
@MainActor
final class XDriveIOSNativePhotoReceiptReviewController: ObservableObject {
    enum Mode: Equatable { case idle, checking, reviewing, resuming }

    struct Summary: Equatable {
        var checked = 0
        var confirmed = 0
        var activeUnverified = 0
        var noEvidence = 0
        var expired = 0
        var ambiguous = 0
    }

    /// Read-only notification after at least one previously uncertain ACK
    /// is proven against BOTH its UploadSession and current Owner Node.
    struct ConfirmedReadback: Equatable {
        let owner: XDriveNativeOwnerRoot
        let id: UUID
    }

    @Published private(set) var confirmedReadback: ConfirmedReadback?
    @Published private(set) var mode: Mode = .idle
    @Published private(set) var pending: Int?
    @Published private(set) var hasLedgerScope = false
    @Published private(set) var summary: Summary?
    @Published private(set) var notice: String?
    @Published private(set) var errorMessage: String?

    private var generation = UUID()
    private var work: Task<Void, Never>?
    private static let maxPerReview = 20

    var busy: Bool { mode != .idle }

    func cancel() {
        generation = UUID()
        work?.cancel()
        work = nil
        confirmedReadback = nil
        mode = .idle
        pending = nil
        hasLedgerScope = false
        summary = nil
        notice = nil
        errorMessage = nil
    }

    func refresh(login: XDriveIOSNativeOwnerLoginModel) {
        guard mode == .idle, let expected = login.owner else { return }
        let epoch = UUID()
        generation = epoch
        pending = nil
        summary = nil
        hasLedgerScope = false
        notice = nil
        errorMessage = nil
        mode = .checking
        work = Task { @MainActor [weak self] in
            guard let self else { return }
            defer {
                if self.generation == epoch {
                    self.mode = .idle
                    self.work = nil
                }
            }
            do {
                let verified = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard XDriveIOSNativePhotoOwnerScope.matches(verified.owner, expected)
                else { throw XDriveIOSNativeSessionError.staleSession }
                // This method MUST NOT create a new Keychain identity merely
                // to display an empty pending-receipt status.
                let scope = try await XDriveIOSForegroundBackupIdentity.shared
                    .existingLocalScope(owner: expected)
                let count: Int
                if let scope {
                    count = try await XDrivePhotoSyncLedger.shared
                        .pendingReceiptSnapshot(scope: scope, limit: 0).pending
                } else {
                    count = 0
                }
                try Task.checkCancellation()
                guard self.generation == epoch,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { return }
                self.pending = count
                self.hasLedgerScope = scope != nil
                self.notice = scope == nil
                    ? "当前设备没有可验证的既有加密备份账本；不能据此恢复一个已暂停的计划。"
                    : "已读取当前 Owner 的加密账本；状态检查未发送任何上传请求。"
            } catch is CancellationError {
                // Never publish an old Owner's receipt count.
            } catch {
                guard self.generation == epoch else { return }
                self.errorMessage = "无法安全读取当前 Owner 的账本或服务器身份；待核对数量未知。"
            }
        }
    }

    func reconcile(login: XDriveIOSNativeOwnerLoginModel) {
        guard mode == .idle, let expected = login.owner else { return }
        // Reconciliation can mark an existing uncertain journal entry
        // confirmed only after verifying BOTH Server session and Owner Node.
        // It must never overlap a real upload or background writer.
        guard let gate = XDriveIOSOriginalRunGate.shared.acquire() else {
            errorMessage = "另一项原件备份或核对正在进行；未触碰原有收据。"
            return
        }
        let epoch = UUID()
        generation = epoch
        pending = nil
        summary = Summary()
        confirmedReadback = nil
        notice = nil
        errorMessage = nil
        mode = .reviewing
        work = Task { @MainActor [weak self] in
            defer { XDriveIOSOriginalRunGate.shared.release(gate) }
            guard let self else { return }
            defer {
                if self.generation == epoch {
                    self.mode = .idle
                    self.work = nil
                }
            }
            do {
                let verified = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard XDriveIOSNativePhotoOwnerScope.matches(verified.owner, expected),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { throw XDriveIOSNativeSessionError.staleSession }
                guard let scope = try await XDriveIOSForegroundBackupIdentity.shared
                    .existingLocalScope(owner: expected) else {
                    throw XDrivePhotoSyncLedgerError.corruptOrInaccessible
                }
                let ledger = XDrivePhotoSyncLedger.shared
                let snapshot = try await ledger.pendingReceiptSnapshot(
                    scope: scope, limit: Self.maxPerReview
                )
                var tally = Summary()
                // A later network error or inaccessible ledger must not hide
                // originals whose receipts were ALREADY verified in this
                // read-only review. Publish at most one same-Owner wall reload,
                // including a partially completed review. Never signal for an
                // ambiguous/expired/unverified ACK or a retired Owner/task.
                defer {
                    if tally.confirmed > 0, self.generation == epoch,
                       XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected) {
                        self.confirmedReadback = ConfirmedReadback(
                            owner: expected, id: UUID()
                        )
                    }
                }
                for record in snapshot.batch {
                    try Task.checkCancellation()
                    // Native access-token refresh is Owner/Root verified.
                    // Never hand an old Owner bearer into an asynchronous
                    // receipt read after the user switches accounts.
                    let current = try await login.verifiedAuthorization()
                    guard self.generation == epoch,
                          XDriveIOSNativePhotoOwnerScope.matches(current.owner, expected),
                          XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                    else { throw XDriveIOSNativeSessionError.staleSession }

                    let result = try await XDriveIOSPhotoBackupUncertainReceiptRecovery(
                        owner: expected, scope: scope,
                        accessToken: current.accessToken, ledger: ledger
                    ).reconcile(operationID: record.id)
                    try Task.checkCancellation()
                    guard self.generation == epoch,
                          XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                    else { throw XDriveIOSNativeSessionError.staleSession }
                    tally.checked += 1
                    switch result {
                    case .confirmed:
                        tally.confirmed += 1
                    case .activeButUnverified:
                        tally.activeUnverified += 1
                    case .noSessionEvidence:
                        tally.noEvidence += 1
                    case .expiredSession:
                        tally.expired += 1
                    case .ambiguousSession:
                        tally.ambiguous += 1
                    }
                    self.summary = tally
                }
                let latest = try await ledger.pendingReceiptSnapshot(
                    scope: scope, limit: 0
                )
                try Task.checkCancellation()
                guard self.generation == epoch,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { return }
                self.pending = latest.pending
                self.hasLedgerScope = true
                self.notice = "本轮只读核对完成；仅实际验证过的 Server Node 可标记为已确认。其余收据继续保留。"
            } catch is CancellationError {
                // Unknown ACKs remain in the encrypted journal.
            } catch {
                guard self.generation == epoch else { return }
                self.pending = nil
                self.errorMessage = "只读收据核对未完成；不确定的记录继续保留，未执行重复上传。"
            }
        }
    }

    /// The BG original cursor is independent of the foreground schedule.
    /// A successful receipt reconciliation never silently clears its pause:
    /// only a separate, explicit current-Owner confirmation can do that.
    func resumePausedBackground(
        login: XDriveIOSNativeOwnerLoginModel,
        expectedOwner: XDriveNativeOwnerRoot
    ) {
        guard mode == .idle,
              XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner)
        else {
            errorMessage = "服务器或账户已变化；后台原件计划保持暂停。"
            return
        }
        guard let gate = XDriveIOSOriginalRunGate.shared.acquire() else {
            errorMessage = "原件上传或收据核对正在进行；未恢复后台计划。"
            return
        }
        let expected = expectedOwner
        let epoch = UUID()
        generation = epoch
        errorMessage = nil
        notice = nil
        mode = .resuming
        work = Task { @MainActor [weak self] in
            defer { XDriveIOSOriginalRunGate.shared.release(gate) }
            guard let self else { return }
            defer {
                if self.generation == epoch {
                    self.mode = .idle
                    self.work = nil
                }
            }
            do {
                let stopVersion = XDriveIOSPhotoAutoScheduleStore.shared
                    .localStopGeneration
                let verified = try await login.verifiedAuthorization()
                guard XDriveIOSNativePhotoOwnerScope.matches(verified.owner, expected),
                      let scope = try await XDriveIOSForegroundBackupIdentity.shared
                        .existingLocalScope(owner: expected)
                else { throw XDriveIOSNativeSessionError.staleSession }

                // A zero count must come from the trusted encrypted current-
                // Owner ledger, not a saved UI badge or manually edited state.
                let pending = try await XDrivePhotoSyncLedger.shared
                    .pendingReceiptSnapshot(scope: scope, limit: 0).pending
                guard pending == 0 else {
                    throw XDrivePhotoSyncLedgerError.identityMismatch
                }
                try Task.checkCancellation()

                // The User bearer and the independent iPhone Device+grant
                // both re-prove exact Server/Owner/Root, including revocation.
                let fresh = try await login.verifiedAuthorization()
                guard XDriveIOSNativePhotoOwnerScope.matches(fresh.owner, expected)
                else { throw XDriveIOSNativeSessionError.staleSession }
                let remote = try await XDriveIOSPhotoBackgroundGrantManager.shared
                    .verifyRemote(owner: expected, accessToken: fresh.accessToken)
                guard remote.enabled else {
                    throw XDriveIOSPhotoBackgroundGrantError.invalidGrantResponse
                }
                let approved = try await XDriveIOSApprovedPhotoBGVault.shared
                    .proveInBackground()
                let store = XDriveIOSBGOriginalWindowStore.shared
                let paused = try store.pausedForReview(owner: expected)
                try Task.checkCancellation()
                guard self.generation == epoch, pending == 0, paused,
                      approved.matches(expected),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected),
                      XDriveIOSPhotoAutoScheduleStore.shared.localStopGeneration == stopVersion,
                      UIApplication.shared.applicationState == .active,
                      [.authorized, .limited].contains(
                        PHPhotoLibrary.authorizationStatus(for: .readWrite)
                      ) else { throw XDriveIOSNativeSessionError.staleSession }

                // Schedule first; on failure retain the durable BG pause.
                // The OS earliest-attempt is advisory, not a foreground run.
                try XDriveIOSBackgroundPhotoTask.scheduleApprovedProbe(
                    afterMinutes: approved.intervalMinutes
                )
                try store.resumeAfterTrustedReview(
                    owner: expected, approved: approved, trustedPending: pending
                )
                self.pending = 0
                self.hasLedgerScope = true
                self.notice = "全部不确定收据已核验；由你确认重新安排当前 Owner 的系统后台计划。下次执行时机由 iOS 决定。"
            } catch is CancellationError {
                // No implicit resume or ledger destruction.
            } catch {
                guard self.generation == epoch,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { return }
                self.errorMessage = "收据、后台授权、账户或相册权限尚未全部验证；后台原件计划继续暂停。"
            }
        }
    }

    /// Explicit user re-enablement, never automatic after a partial review.
    /// It is intentionally a separate confirmation from the read-only pass.
    func resumePausedAuto(login: XDriveIOSNativeOwnerLoginModel,
                          expectedOwner: XDriveNativeOwnerRoot) {
        guard mode == .idle else { return }
        guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner) else {
            errorMessage = "服务器或账户已变化；旧计划保持暂停。"
            return
        }
        let expected = expectedOwner
        guard let gate = XDriveIOSOriginalRunGate.shared.acquire() else {
            errorMessage = "原件任务正在进行，暂不能恢复计划。"
            return
        }
        let epoch = UUID()
        generation = epoch
        errorMessage = nil
        notice = nil
        mode = .resuming
        work = Task { @MainActor [weak self] in
            defer { XDriveIOSOriginalRunGate.shared.release(gate) }
            guard let self else { return }
            defer {
                if self.generation == epoch {
                    self.mode = .idle
                    self.work = nil
                }
            }
            do {
                let scheduleStore = XDriveIOSPhotoAutoScheduleStore.shared
                let stopGeneration = scheduleStore.localStopGeneration
                let verified = try await login.verifiedAuthorization()
                guard XDriveIOSNativePhotoOwnerScope.matches(verified.owner, expected),
                      let scope = try await XDriveIOSForegroundBackupIdentity.shared
                        .existingLocalScope(owner: expected)
                else { throw XDriveIOSNativeSessionError.staleSession }
                let ledger = XDrivePhotoSyncLedger.shared
                let count = try await ledger.pendingReceiptSnapshot(
                    scope: scope, limit: 0
                ).pending
                try Task.checkCancellation()
                // A zero saved count alone is insufficient: re-prove Owner,
                // scope, PhotoKit authorization, active scene and local stop
                // generation immediately before the only schedule write.
                let latest = try await login.verifiedAuthorization()
                guard self.generation == epoch,
                      count == 0,
                      XDriveIOSNativePhotoOwnerScope.matches(latest.owner, expected),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected),
                      scheduleStore.localStopGeneration == stopGeneration,
                      UIApplication.shared.applicationState == .active,
                      [.authorized, .limited].contains(
                        PHPhotoLibrary.authorizationStatus(for: .readWrite)
                      ),
                      let current = scheduleStore.status(owner: expected),
                      current.enabled, current.pausedForReview
                else { throw XDriveIOSNativeSessionError.staleSession }
                _ = try scheduleStore.configure(
                    owner: expected, minutes: current.intervalMinutes,
                    allowICloud: current.allowICloudOriginals
                )
                self.pending = 0
                self.hasLedgerScope = true
                self.notice = "已由你重新授权恢复前台计划；仅下一次符合条件的前台检查才会开始备份。"
            } catch is CancellationError {
            } catch {
                guard self.generation == epoch else { return }
                self.errorMessage = "收据仍待确认、账户已变更或本机权限不可用；自动备份继续保持暂停。"
            }
        }
    }
}
