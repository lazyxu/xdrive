import Combine
import Foundation
import SwiftUI
import UIKit

/// A native system sheet shares the actual verified private temporary files.
/// A successful download alone is NOT a Save to Files receipt.
struct XDriveIOSNativeFilesBatchShareSheet: UIViewControllerRepresentable {
    let files: [URL]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: files, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

/// Read-only 2-8-file export. Uses the SAME signed single-file reader as the
/// accepted native Files download sheet. Never starts archive/backup writers.
@MainActor
final class XDriveIOSNativeFilesBatchExportModel: ObservableObject {
    @Published private(set) var prepared: [XDriveIOSNativeFilesPreparedExport] = []
    @Published private(set) var busy = false
    @Published private(set) var status: String?

    private var epoch = UUID()
    private var task: Task<Void, Never>?

    func invalidate() {
        epoch = UUID()
        task?.cancel()
        task = nil
        prepared.forEach { $0.discard() }
        prepared = []
        busy = false
        status = nil
    }

    func invalidSelection() {
        guard !busy && prepared.isEmpty else { return }
        status = "批量导出仅支持同一文件夹内的 2–8 个不同文件；总原件大小不能超过 512 MiB。"
    }

    func cancelCurrentTransfer() {
        guard busy, let task else { return }
        task.cancel()
        status = "已请求取消批量下载；已取得的临时文件正在清理，未保存到 iPhone。"
    }

    func prepare(
        _ selected: [XDriveIOSNativeFilesNode], parentID: UInt64,
        login: XDriveIOSNativeOwnerLoginModel
    ) {
        guard !busy, task == nil, prepared.isEmpty else { return }
        guard XDriveIOSNativeFilesBatchExportPolicy.validSelection(
            selected, parentID: parentID
        ) else {
            invalidSelection()
            return
        }
        guard let expected = login.owner else {
            status = "当前服务器账户未验证，无法导出。"
            return
        }
        let ticket = UUID()
        epoch = ticket
        busy = true
        status = "准备依次读取 \(selected.count) 个文件，暂不估算下载速度。"
        task = Task { @MainActor in
            var staged: [XDriveIOSNativeFilesPreparedExport] = []
            var published = false
            defer {
                // All partially completed downloads remain private and are
                // discarded on cancellation, HTTP failure or Owner switch.
                if !published {
                    staged.forEach { $0.discard() }
                }
                if epoch == ticket {
                    task = nil
                    busy = false
                }
            }
            do {
                for (index, node) in selected.enumerated() {
                    try Task.checkCancellation()
                    let before = try await login.verifiedAuthorization()
                    try Task.checkCancellation()
                    guard epoch == ticket,
                          XDriveIOSNativePhotoOwnerScope.matches(before.owner, expected),
                          XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                    else { throw CancellationError() }

                    status = "正在下载并验证第 \(index + 1)/\(selected.count) 项；已确认 \(staged.count) 项。"
                    let file = try await XDriveIOSNativeFilesExportReader(
                        owner: before.owner, accessToken: before.accessToken
                    ).prepare(node)
                    staged.append(file)
                    try Task.checkCancellation()

                    let after = try await login.verifiedAuthorization()
                    try Task.checkCancellation()
                    guard epoch == ticket,
                          XDriveIOSNativePhotoOwnerScope.matches(after.owner, expected),
                          XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                    else { throw CancellationError() }
                }
                try Task.checkCancellation()
                guard epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { throw CancellationError() }

                prepared = staged
                published = true
                status = "已核对并暂存 \(staged.count) 个原文件；点击系统分享选择保存位置，尚未保存到 iPhone。"
            } catch is CancellationError {
                if epoch == ticket {
                    status = "批量下载已取消；临时文件将清理，未自动保存到 iPhone。"
                }
            } catch {
                guard epoch == ticket else { return }
                if let failure = error as? XDriveIOSNativeFilesExportFailure {
                    switch failure {
                    case .unsupported:
                        status = "所选文件或大小不支持导出；已停止并清理临时文件。"
                    case .staleNode, .server(401), .server(403), .server(404):
                        status = "文件版本或账户权限已改变；已停止并清理临时文件。"
                    default:
                        status = "文件下载或校验失败；已停止并清理临时文件。"
                    }
                } else {
                    status = "批量下载失败；已停止并清理临时文件。"
                }
            }
        }
    }
}
