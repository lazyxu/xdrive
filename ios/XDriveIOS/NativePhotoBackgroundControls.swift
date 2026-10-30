import Combine
import Foundation
import Photos
import UIKit

/// Native UI control for the existing scoped BG grant and one-original BGTask.
/// The existing Owner journal and UploadSession/CAS writer stay authoritative.
@MainActor
final class XDriveIOSNativeBackgroundPhotoControls: ObservableObject {
    @Published private(set) var busy = false
    @Published private(set) var checking = false
    @Published private(set) var status: XDriveIOSPhotoBackgroundGrantStatus?
    @Published private(set) var serverVerified = false
    @Published private(set) var notice: String?
    @Published private(set) var errorMessage: String?

    private var readGeneration = UUID()
    private let manager = XDriveIOSPhotoBackgroundGrantManager.shared

    func invalidateRead() {
        // Do not cancel an accepted grant issue in the middle of an
        // uncertain Server ACK. Native sign-out is fenced by the writer gate.
        readGeneration = UUID()
        checking = false
        status = nil
        serverVerified = false
    }

    func refresh(login: XDriveIOSNativeOwnerLoginModel) {
        guard !busy else { return }
        readGeneration = UUID()
        let ticket = readGeneration
        status = nil
        serverVerified = false
        guard let owner = login.owner else {
            checking = false
            return
        }
        checking = true
        Task { @MainActor [weak self] in
            do {
                let local = try await XDriveIOSPhotoBackgroundGrantManager.shared
                    .localStatus(owner: owner)
                guard self?.readGeneration == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner)
                else { return }
                self?.status = local
                self?.checking = false
                if local.enabled {
                    do {
                        let auth = try await login.verifiedAuthorization()
                        guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, owner)
                        else { throw XDriveIOSNativeSessionError.staleSession }
                        let remote = try await XDriveIOSPhotoBackgroundGrantManager.shared
                            .verifyRemote(owner: owner, accessToken: auth.accessToken)
                        guard self?.readGeneration == ticket,
                              XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner)
                        else { return }
                        self?.status = remote
                        self?.serverVerified = remote.enabled
                    } catch {
                        // A local grant never proves the Server still allows
                        // a background write.
                        guard self?.readGeneration == ticket,
                              XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner)
                        else { return }
                        self?.serverVerified = false
                    }
                }
            } catch {
                guard self?.readGeneration == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner)
                else { return }
                self?.status = nil
                self?.checking = false
                self?.serverVerified = false
                self?.errorMessage = "本机后台授权状态无法安全读取；未修改权限。"
            }
        }
    }

    /// Invoked only after explicit native Owner + Root + Device confirmation.
    func enable(login: XDriveIOSNativeOwnerLoginModel,
                expectedOwner: XDriveNativeOwnerRoot) {
        guard !busy, !checking, status?.enrolled == false,
              XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner),
              UIApplication.shared.applicationState == .active,
              [.authorized, .limited].contains(
                PHPhotoLibrary.authorizationStatus(for: .readWrite)
              ) else {
            errorMessage = "请先验证当前账户、相册权限和后台授权状态。"
            return
        }
        guard let gate = XDriveIOSOriginalRunGate.shared.acquire() else {
            errorMessage = "原件上传或收据核对正在执行；后台授权未修改。"
            return
        }
        busy = true
        readGeneration = UUID()
        errorMessage = nil
        notice = nil
        let stopVersion = XDriveIOSPhotoAutoScheduleStore.shared.localStopGeneration
        Task { @MainActor in
            defer {
                XDriveIOSOriginalRunGate.shared.release(gate)
                busy = false
                refresh(login: login)
            }
            do {
                let existing = try await manager.localStatus(owner: expectedOwner)
                guard !existing.enrolled else {
                    errorMessage = "已有本机后台授权或待撤销记录，不会重复签发。"
                    return
                }
                guard XDriveIOSPhotoAutoScheduleStore.shared
                    .status(owner: expectedOwner)?.pausedForReview != true
                else {
                    errorMessage = "存在暂停的自动计划，请先核对不确定上传收据。"
                    return
                }
                // A new BG grant must not bypass pending/lost finalize ACKs
                // already preserved by the shared encrypted original ledger.
                if let scope = try await XDriveIOSForegroundBackupIdentity.shared
                    .existingLocalScope(owner: expectedOwner) {
                    let pending = try await XDrivePhotoSyncLedger.shared
                        .pendingReceiptSnapshot(scope: scope, limit: 0).pending
                    guard pending == 0 else {
                        errorMessage = "还有 \(pending) 项不确定收据，请先核对。"
                        return
                    }
                }
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expectedOwner),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner),
                      XDriveIOSPhotoAutoScheduleStore.shared.localStopGeneration == stopVersion,
                      UIApplication.shared.applicationState == .active,
                      [.authorized, .limited].contains(
                        PHPhotoLibrary.authorizationStatus(for: .readWrite)
                      ) else { throw XDriveIOSNativeSessionError.staleSession }
                _ = try await manager.enableAfterNativeConfirmation(
                    owner: expectedOwner, accessToken: auth.accessToken
                )
                let fresh = try await login.verifiedAuthorization()
                guard XDriveIOSNativePhotoOwnerScope.matches(fresh.owner, expectedOwner),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner)
                else { throw XDriveIOSNativeSessionError.staleSession }
                let remote = try await manager.verifyRemote(
                    owner: expectedOwner, accessToken: fresh.accessToken
                )
                guard remote.enabled else {
                    throw XDriveIOSPhotoBackgroundGrantError.invalidGrantResponse
                }
                status = remote
                serverVerified = true
                notice = "服务器已确认授权。iOS 决定后台执行时机，单次最多尝试一个原件；锁定状态可能无法读取原件。"
            } catch {
                // A lost ACK may still have issued a real remote grant.
                if XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner) {
                    status = try? await manager.localStatus(owner: expectedOwner)
                    serverVerified = false
                    errorMessage = "授权结果未确认，可能已有远端授权；请刷新或在服务器撤销，勿重复申请。"
                }
            }
        }
    }

    /// Stop first without connectivity; an offline revoke remains pending.
    func disable(login: XDriveIOSNativeOwnerLoginModel,
                 expectedOwner: XDriveNativeOwnerRoot) {
        guard !busy, !checking,
              XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner)
        else {
            errorMessage = "账户已变化或后台任务尚未结束。"
            return
        }
        guard let gate = XDriveIOSOriginalRunGate.shared.acquire() else {
            errorMessage = "另一个原件任务尚未结束；请完成后再停用后台授权。"
            return
        }
        busy = true
        readGeneration = UUID()
        errorMessage = nil
        notice = nil
        Task { @MainActor in
            defer {
                XDriveIOSOriginalRunGate.shared.release(gate)
                busy = false
                refresh(login: login)
            }
            var localStopped = false
            do {
                let local = try await manager.stopLocally(owner: expectedOwner)
                localStopped = true
                if XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner) {
                    status = local
                    serverVerified = false
                    notice = "本机后台任务已停止，正在尝试撤销服务器授权。"
                }
                let auth = try await login.verifiedAuthorization()
                guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expectedOwner),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner)
                else { throw XDriveIOSNativeSessionError.staleSession }
                let revoked = try await manager.disable(
                    owner: expectedOwner, accessToken: auth.accessToken
                )
                guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner)
                else { return }
                status = revoked
                serverVerified = false
                notice = "本机任务已停止，服务器已确认当前账户授权撤销。"
            } catch {
                guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner)
                else { return }
                status = try? await manager.localStatus(owner: expectedOwner)
                serverVerified = false
                errorMessage = localStopped
                    ? "本机已停止，远端撤销待网络恢复后重试。"
                    : "无法确认本机后台密钥已停用；请解锁后重试。"
            }
        }
    }
}
