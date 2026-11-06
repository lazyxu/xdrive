import Combine
import Foundation
import Photos

/// Read-only counters for the current Owner's local incremental PhotoKit
/// discovery queue. No source IDs, photo identifiers, bytes or upload rights
/// are sent to the Server. Counts must never be presented as backup coverage.
@MainActor
final class XDriveIOSNativePhotoQueueSummaryModel: ObservableObject {
    @Published private(set) var counts: XDriveIOSPhotoBackupChangeQueueStore.Counts?
    @Published private(set) var busy = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var notice: String?
    private var generation = UUID()
    private var job: Task<Void, Never>?

    func cancel() {
        job?.cancel()
        job = nil
        generation = UUID()
        counts = nil
        errorMessage = nil
        notice = nil
        busy = false
    }

    /// Requeue only failures that the original writer proved were item-local
    /// and pre-write safe. The queue actor revalidates Owner, authorization,
    /// PhotoKit baseline and each exact row revision before changing state.
    func retryFailed(login: XDriveIOSNativeOwnerLoginModel) {
        guard !busy, let selected = login.owner else { return }
        guard [.authorized].contains(
            PHPhotoLibrary.authorizationStatus(for: .readWrite)
        ) else {
            errorMessage = "恢复失败项需要当前账户的照片访问权限。"
            return
        }
        job?.cancel()
        generation = UUID()
        let ticket = generation
        busy = true
        errorMessage = nil
        notice = nil
        job = Task { @MainActor [weak self, weak login] in
            guard let self, let login else { return }
            defer {
                if self.generation == ticket {
                    self.busy = false
                    self.job = nil
                }
            }
            do {
                let verified = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard self.generation == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(verified.owner, selected),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected) else {
                    return
                }
                let queue = try XDriveIOSPhotoKitPersistentBackupQueue(owner: selected)
                let requeued = try await queue.retryFailedCandidates(
                    owner: selected, limit: 64
                )
                try Task.checkCancellation()
                guard self.generation == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected) else {
                    return
                }
                self.counts = try await queue.summary(owner: selected)
                if requeued > 0 {
                    _ = try? XDriveIOSPhotoAutoScheduleStore.shared
                        .expediteForLibraryChange(owner: selected)
                    self.notice = "已重新排队 \(requeued) 项安全失败的原件；下次前台自动检查会优先处理。"
                } else {
                    self.notice = "当前没有可安全重试的失败项。"
                }
            } catch is CancellationError {
                return
            } catch {
                guard self.generation == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected) else {
                    return
                }
                self.errorMessage = "无法安全恢复失败项；未改变不确定上传收据或服务器原件。"
            }
        }
    }

    func refresh(login: XDriveIOSNativeOwnerLoginModel) {
        cancel()
        guard let selected = login.owner else { return }
        guard [.authorized].contains(
            PHPhotoLibrary.authorizationStatus(for: .readWrite)
        ) else {
            errorMessage = "读取照片变更队列需要当前账户的照片访问权限。"
            return
        }
        let ticket = generation
        busy = true
        job = Task { @MainActor [weak self, weak login] in
            guard let self, let login else { return }
            defer {
                if self.generation == ticket {
                    self.busy = false
                    self.job = nil
                }
            }
            do {
                let verified = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard self.generation == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(verified.owner, selected),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected) else {
                    return
                }
                let queue = try XDriveIOSPhotoKitPersistentBackupQueue(owner: selected)
                let result = try await queue.summary(owner: selected)
                try Task.checkCancellation()
                guard self.generation == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected) else {
                    return
                }
                self.counts = result
            } catch is CancellationError {
                return
            } catch {
                guard self.generation == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, selected) else {
                    return
                }
                self.errorMessage = "无法读取当前账户的本机变更队列；不会推断任何照片已备份。"
            }
        }
    }
}
