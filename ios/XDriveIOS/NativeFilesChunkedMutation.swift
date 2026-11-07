import Combine
import Foundation

/// Explicit multi-transaction operations. The Go endpoint remains atomic at
/// 200 nodes per request; a 2048-node selection is NEVER one atomic write.
enum XDriveIOSNativeFilesChunkedAction {
    case trash
    case target(kind: XDriveIOSNativeFilesDestinationKind,
                destination: XDriveIOSNativeFilesDestination)
}

/// A bounded foreground operation. Every chunk has an independent verified
/// Server receipt; cancellation or unknown ACK stops future chunks, without
/// retrying an operation which may already have committed.
@MainActor
final class XDriveIOSNativeFilesChunkedMutationModel: ObservableObject {
    @Published private(set) var busy = false
    @Published private(set) var status: String?
    private var generation = UUID()
    private var running: Task<Void, Never>?

    func invalidate() {
        generation = UUID()
        running?.cancel()
        running = nil
        busy = false
        status = nil
    }

    func cancelCurrent() {
        guard busy, let running else { return }
        running.cancel()
        status = "已请求停止后续批次；当前服务器请求结果可能不确定，必须核对。"
    }

    func perform(
        _ action: XDriveIOSNativeFilesChunkedAction,
        items: [XDriveIOSNativeFilesNode], parentID: UInt64,
        login: XDriveIOSNativeOwnerLoginModel,
        onSettled: @MainActor @escaping (String) -> Void
    ) {
        guard !busy, running == nil, let owner = login.owner,
              let batches = XDriveIOSNativeFilesChunkedPolicy.groups(
                  items, parentID: parentID
              ) else {
            status = "选择无效，不能分批提交；未发起服务器写入。"
            return
        }
        let token = UUID()
        generation = token
        busy = true
        status = "准备处理 \(items.count) 项，共 \(batches.count) 个独立服务器事务。"
        running = Task { @MainActor in
            var confirmed = 0
            var outcome = ""
            defer {
                if generation == token {
                    busy = false
                    running = nil
                }
            }
            do {
                for (index, batch) in batches.enumerated() {
                    try Task.checkCancellation()
                    let before = try await login.verifiedAuthorization()
                    try Task.checkCancellation()
                    guard generation == token,
                          XDriveIOSNativePhotoOwnerScope.matches(before.owner, owner),
                          XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner)
                    else { throw CancellationError() }
                    status = "正在执行第 \(index + 1)/\(batches.count) 批；已确认 \(confirmed)/\(items.count) 项。"
                    switch action {
                    case .trash:
                        try await XDriveIOSNativeFilesBatchTrashWriter(
                            owner: before.owner, accessToken: before.accessToken
                        ).trash(batch, parentID: parentID)
                    case .target(let kind, let destination):
                        try await XDriveIOSNativeFilesBatchTargetWriter(
                            owner: before.owner, accessToken: before.accessToken
                        ).perform(kind, items: batch,
                                  sourceParentID: parentID, destination: destination)
                    }
                    // The receipt alone is not permission to keep issuing new
                    // requests after logout, Owner change or cancellation.
                    try Task.checkCancellation()
                    let after = try await login.verifiedAuthorization()
                    try Task.checkCancellation()
                    guard generation == token,
                          XDriveIOSNativePhotoOwnerScope.matches(after.owner, owner),
                          XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner)
                    else { throw CancellationError() }
                    confirmed += batch.count
                    status = "服务器确认 \(confirmed)/\(items.count) 项；每批独立提交。"
                }
                outcome = "已完成 \(confirmed)/\(items.count) 项（\(batches.count) 次独立服务器事务）。"
            } catch {
                // Previous receipts are durable. A request in flight may have
                // committed without a usable ACK; never blindly replay it.
                outcome = "已核验 \(confirmed)/\(items.count) 项，后续停止。当前批次可能已提交；各批次不会整体回滚。请刷新并核对，不要盲目重试。"
            }
            guard generation == token,
                  XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner)
            else { return }
            status = outcome
            onSettled(outcome)
        }
    }
}
