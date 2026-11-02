import Combine
import Foundation
import SwiftUI

private enum XDriveIOSNativeFilesManualUploadFailure: Error {
    case invalidOwner
    case folderChanged
    case missingOrInconsistentReceipt
    case server(Int)
    case malformed
}

private struct XDriveIOSNativeFilesUploadNodeDTO: Decodable {
    let id: UInt64
    let parent_id: UInt64?
    let name: String
    let type: String
    let size: Int64
    let revision: UInt64
    let sha256: String?
}

private final class XDriveIOSNativeFilesUploadDenyRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// Read-only trust checks before and after the existing UploadSession writer.
/// Photo backup's root-only receipt verifier stays unchanged; nested Files
/// folders require their own exact parent Node evidence.
private struct XDriveIOSNativeFilesUploadReadback {
    let owner: XDriveNativeOwnerRoot
    let accessToken: String

    private func getNode(_ id: UInt64) async throws -> XDriveIOSNativeFilesUploadNodeDTO {
        guard id > 0, owner.ownerID > 0, owner.rootNodeID > 0,
              !owner.instanceID.isEmpty, !accessToken.isEmpty,
              let origin = try? ServerAddress.parse(owner.origin.absoluteString),
              origin == owner.origin,
              var components = URLComponents(url: origin, resolvingAgainstBaseURL: false),
              components.scheme == "https" else {
            throw XDriveIOSNativeFilesManualUploadFailure.invalidOwner
        }
        components.path = "/api/v1/nodes/\(id)"
        guard let url = components.url else {
            throw XDriveIOSNativeFilesManualUploadFailure.invalidOwner
        }
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 25
        let session = URLSession(configuration: config,
                                 delegate: XDriveIOSNativeFilesUploadDenyRedirect(),
                                 delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.httpShouldHandleCookies = false
        request.setValue("Bearer " + accessToken, forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        let (data, response) = try await session.data(for: request)
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse else {
            throw XDriveIOSNativeFilesManualUploadFailure.malformed
        }
        guard http.statusCode == 200 else {
            throw XDriveIOSNativeFilesManualUploadFailure.server(http.statusCode)
        }
        guard data.count <= 65_536,
              let node = try? JSONDecoder().decode(
                XDriveIOSNativeFilesUploadNodeDTO.self, from: data
              ) else {
            throw XDriveIOSNativeFilesManualUploadFailure.malformed
        }
        return node
    }

    func requireDestination(_ parentID: UInt64, expectedName: String?) async throws {
        guard parentID > 0 else {
            throw XDriveIOSNativeFilesManualUploadFailure.invalidOwner
        }
        if parentID == owner.rootNodeID {
            guard expectedName == nil else {
                throw XDriveIOSNativeFilesManualUploadFailure.folderChanged
            }
            return // Native verifiedAuthorization() re-proves the exact root.
        }
        guard let expectedName, !expectedName.isEmpty else {
            throw XDriveIOSNativeFilesManualUploadFailure.folderChanged
        }
        let node = try await getNode(parentID)
        guard node.id == parentID, node.parent_id != nil,
              node.type == "dir", node.revision > 0,
              node.name == expectedName else {
            throw XDriveIOSNativeFilesManualUploadFailure.folderChanged
        }
    }

    func requireCommitted(_ receipt: XDriveNativeUploadReceipt,
                          parentID: UInt64, name: String,
                          byteCount: Int64) async throws {
        guard receipt.nodeID > 0 else {
            throw XDriveIOSNativeFilesManualUploadFailure.missingOrInconsistentReceipt
        }
        let node = try await getNode(receipt.nodeID)
        let evidence = XDriveIOSNativeFilesUploadNodeEvidence(
            id: node.id, parentID: node.parent_id, name: node.name, type: node.type,
            size: node.size, revision: node.revision, sha256: node.sha256
        )
        guard receipt.nodeName == name,
              receipt.bytes == byteCount,
              XDriveIOSNativeFilesUploadConfirmationPolicy.matches(
                evidence, parentID: parentID, name: name, bytes: byteCount,
                receiptNodeID: receipt.nodeID, receiptRevision: receipt.revision,
                receiptSHA256: receipt.sha256
              ) else {
            throw XDriveIOSNativeFilesManualUploadFailure.missingOrInconsistentReceipt
        }
    }
}

/// One or at most eight explicit foreground files. A single Owner-bound
/// OriginalRunGate covers the whole sequential batch, and each document is
/// staged/verified/retired separately using ONE UploadSession/CAS writer.
/// If any item fails or loses an ACK, do not submit another item.
@MainActor
final class XDriveIOSNativeFilesManualUploadModel: ObservableObject {
    @Published private(set) var busy = false
    @Published private(set) var status: String?
    private var epoch = UUID()
    private var running: Task<Void, Never>?

    func invalidate() {
        epoch = UUID()
        running?.cancel()
        running = nil
        busy = false
        status = nil
    }

    /// Cancellation is uncertain once a Server POST may have been submitted;
    /// do not free the global writer gate until the task has actually settled.
    func cancelCurrentTransfer() {
        guard busy, let running else { return }
        running.cancel()
        status = "已请求取消上传；若服务器已接收请求，结果可能不确定。请刷新云端目录核对。"
    }

    func pickerFailed() {
        guard !busy else { return }
        status = "没有选择可读取的文件，未上传。"
    }

    /// Keep existing single-file caller semantics and every receipt check.
    func start(fileURL: URL, login: XDriveIOSNativeOwnerLoginModel,
               parentID: UInt64, expectedFolderName: String?,
               onConfirmed: @MainActor @escaping () -> Void) {
        start(files: [fileURL], login: login, parentID: parentID,
              expectedFolderName: expectedFolderName, onConfirmed: onConfirmed)
    }

    /// Picker-only, bounded multi-select. No fan-out, background queue,
    /// retrying a lost response, or alternate writer.
    func start(files: [URL], login: XDriveIOSNativeOwnerLoginModel,
               parentID: UInt64, expectedFolderName: String?,
               onConfirmed: @MainActor @escaping () -> Void) {
        guard !busy, running == nil, let expected = login.owner,
              parentID > 0 else {
            status = "当前账户或目录不可上传；请先刷新。"
            return
        }
        guard XDriveIOSNativeFilesUploadBatchPolicy.validSelection(files) else {
            status = "一次最多选择 8 个不同文件名的有效文件，未提交任何上传。"
            return
        }
        // Keep one exclusive run for the entire batch, not once per item:
        // concurrent manual, photo or sign-out operations cannot interleave.
        guard let gate = XDriveIOSOriginalRunGate.shared.acquire() else {
            status = "另一项原件上传或退出操作正在进行；本次未开始上传。"
            return
        }
        let ticket = UUID()
        epoch = ticket
        busy = true
        status = "正在检查文件和目标目录…"
        running = Task { @MainActor in
            var confirmed = 0
            defer {
                XDriveIOSOriginalRunGate.shared.release(gate)
                if epoch == ticket {
                    running = nil
                    busy = false
                }
            }
            do {
                for (index, fileURL) in files.enumerated() {
                    try Task.checkCancellation()
                    let name = try await uploadOne(
                        fileURL: fileURL, index: index, count: files.count,
                        login: login, expected: expected, ticket: ticket,
                        parentID: parentID, expectedFolderName: expectedFolderName
                    )
                    confirmed += 1
                    status = files.count == 1
                        ? "服务器已确认文件“\(name)”的原件收据；请在当前文件夹核对。"
                        : "服务器已确认 \(confirmed)/\(files.count) 项；正在核对下一项。"
                }
                try Task.checkCancellation()
                guard epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected) else {
                    throw XDriveIOSNativeFilesManualUploadFailure.invalidOwner
                }
                status = files.count == 1
                    ? status
                    : "全部 \(confirmed) 项已有真实服务器原件收据；正在刷新当前目录。"
                onConfirmed()
            } catch is CancellationError {
                if epoch == ticket {
                    status = files.count == 1
                        ? "本次已取消。若上传请求已发出，结果可能不确定，请先检查目录，勿盲目重传。"
                        : "已确认 \(confirmed)/\(files.count) 项。本次已取消；当前请求结果可能不确定，请刷新目录核对，勿盲目重传。"
                }
            } catch XDriveManualDocumentStageError.tooLarge {
                if epoch == ticket {
                    status = "已确认 \(confirmed)/\(files.count) 项；当前文件超过 1 GiB，后续未提交。"
                }
            } catch XDriveManualDocumentStageError.insufficientDiskSpace {
                if epoch == ticket {
                    status = "已确认 \(confirmed)/\(files.count) 项；手机可用暂存空间不足（需额外保留 128 MiB），后续未提交。"
                }
            } catch XDriveManualDocumentStageError.invalidName {
                if epoch == ticket {
                    status = "已确认 \(confirmed)/\(files.count) 项；当前文件名无效，后续未提交。"
                }
            } catch XDriveManualDocumentStageError.notAnAccessibleFile {
                if epoch == ticket {
                    status = "已确认 \(confirmed)/\(files.count) 项；无法读取当前提供者文件，后续未提交。"
                }
            } catch {
                guard epoch == ticket else { return }
                let prefix = files.count == 1 ? "" : "已确认 \(confirmed)/\(files.count) 项；"
                if let failure = error as? XDriveIOSNativeFilesManualUploadFailure {
                    switch failure {
                    case .invalidOwner, .folderChanged, .server(401),
                         .server(403), .server(404):
                        status = prefix + "目标目录或账户权限已变化，请重新进入目录。上传是否提交需核对。"
                    default:
                        status = prefix + "上传未获得完整确认；请刷新目录核对，不要盲目重复提交。"
                    }
                } else {
                    status = prefix + "上传未获得完整确认；请刷新目录核对，不要盲目重复提交。"
                }
            }
        }
    }

    /// One complete item at a time: temporary private staging is discarded
    /// before the next file, and every POST has a current Owner/destination
    /// proof and a new verified Node+SHA receipt.
    private func uploadOne(
        fileURL: URL, index: Int, count: Int,
        login: XDriveIOSNativeOwnerLoginModel,
        expected: XDriveNativeOwnerRoot, ticket: UUID,
        parentID: UInt64, expectedFolderName: String?
    ) async throws -> String {
        let initial = try await login.verifiedAuthorization()
        try Task.checkCancellation()
        guard epoch == ticket,
              XDriveIOSNativePhotoOwnerScope.matches(initial.owner, expected),
              XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected) else {
            throw XDriveIOSNativeFilesManualUploadFailure.invalidOwner
        }
        try await XDriveIOSNativeFilesUploadReadback(
            owner: initial.owner, accessToken: initial.accessToken
        ).requireDestination(parentID, expectedName: expectedFolderName)
        try Task.checkCancellation()
        status = "正在处理第 \(index + 1)/\(count) 个文件…"

        let staged = try await XDriveManualDocumentStager.stage(fileURL)
        defer { staged.delete() }
        try Task.checkCancellation()
        guard epoch == ticket,
              XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected) else {
            throw XDriveIOSNativeFilesManualUploadFailure.invalidOwner
        }
        status = "正在上传第 \(index + 1)/\(count) 项“\(staged.originalName)”；结果不明确时停止后续文件。"

        // File-provider staging and hashing can take time. Re-prove this
        // Owner and parent immediately before each new UploadSession POST.
        let beforeUpload = try await login.verifiedAuthorization()
        try Task.checkCancellation()
        guard epoch == ticket,
              XDriveIOSNativePhotoOwnerScope.matches(beforeUpload.owner, expected),
              XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected) else {
            throw XDriveIOSNativeFilesManualUploadFailure.invalidOwner
        }
        try await XDriveIOSNativeFilesUploadReadback(
            owner: beforeUpload.owner, accessToken: beforeUpload.accessToken
        ).requireDestination(parentID, expectedName: expectedFolderName)
        try Task.checkCancellation()
        let writer = try XDriveNativeUploadSessionTransport(
            origin: beforeUpload.owner.origin, accessToken: beforeUpload.accessToken
        )
        let receipt = try await writer.uploadOnce(
            from: staged.fileURL, name: staged.originalName, parentID: parentID
        )

        // No next upload starts until this exact item's durable Node
        // identity, revision, byte count and SHA-256 have been read back.
        let afterUpload = try await login.verifiedAuthorization()
        try Task.checkCancellation()
        guard epoch == ticket,
              XDriveIOSNativePhotoOwnerScope.matches(afterUpload.owner, expected),
              XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected) else {
            throw XDriveIOSNativeFilesManualUploadFailure.invalidOwner
        }
        let proof = XDriveIOSNativeFilesUploadReadback(
            owner: afterUpload.owner, accessToken: afterUpload.accessToken
        )
        try await proof.requireDestination(parentID, expectedName: expectedFolderName)
        try await proof.requireCommitted(receipt, parentID: parentID,
                                         name: staged.originalName,
                                         byteCount: staged.byteCount)
        try Task.checkCancellation()
        guard epoch == ticket,
              XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected) else {
            throw XDriveIOSNativeFilesManualUploadFailure.invalidOwner
        }
        return staged.originalName
    }
}
