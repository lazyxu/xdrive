import Combine
import Foundation
import SwiftUI

enum XDriveIOSNativeFilesExportFailure: Error {
    case unsupported
    case staleNode
    case invalidTicket
    case invalidDownload
    case insufficientDiskSpace
    case server(Int)
}

struct XDriveIOSNativeFilesPreparedExport: Identifiable {
    let id = UUID()
    let nodeID: UInt64
    let revision: UInt64
    let fileURL: URL
    let directoryURL: URL

    func discard() {
        try? FileManager.default.removeItem(at: directoryURL)
    }
}

private struct XDriveIOSFilesDownloadTicket: Decodable {
    let url: String
}

/// Download callbacks report *actual received device bytes*, not simulated
/// time/speed or the Server-side number of bytes scheduled for sending.
private final class XDriveIOSFilesDenyDownloadRedirects: NSObject, URLSessionDownloadDelegate {
    private let onProgress: (Int64, Int64) -> Void

    init(onProgress: @escaping (Int64, Int64) -> Void) {
        self.onProgress = onProgress
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didWriteData bytesWritten: Int64, totalBytesWritten: Int64,
                    totalBytesExpectedToWrite: Int64) {
        onProgress(totalBytesWritten, totalBytesExpectedToWrite)
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didFinishDownloadingTo location: URL) {}

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// One currently verified file, one same-origin signed Server ticket.
/// A file is only staged inside app-private, file-protected temporary storage;
/// Save to Files is an explicit OS share action, NOT assumed on completion.
struct XDriveIOSNativeFilesExportReader {
    static let maximumTemporaryBytes: Int64 = XDriveIOSNativeFilesExportCapacityPolicy.maximumSingleFileBytes

    let owner: XDriveNativeOwnerRoot
    let accessToken: String

    private func endpoint(_ path: String) throws -> URL {
        guard owner.ownerID > 0, owner.rootNodeID > 0,
              !owner.instanceID.isEmpty, !accessToken.isEmpty,
              let origin = try? ServerAddress.parse(owner.origin.absoluteString),
              origin == owner.origin,
              var parts = URLComponents(url: origin, resolvingAgainstBaseURL: false),
              parts.scheme == "https", path.hasPrefix("/api/v1/") else {
            throw XDriveIOSNativeFilesExportFailure.invalidTicket
        }
        parts.path = path
        guard let url = parts.url else {
            throw XDriveIOSNativeFilesExportFailure.invalidTicket
        }
        return url
    }

    private func request(_ url: URL, method: String = "GET",
                         authenticated: Bool = true) -> URLRequest {
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.httpShouldHandleCookies = false
        req.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        if authenticated {
            req.setValue("Bearer " + accessToken, forHTTPHeaderField: "Authorization")
            req.setValue("application/json", forHTTPHeaderField: "Accept")
        }
        return req
    }

    private func read<T: Decodable>(_ url: URL, method: String,
                                    session: URLSession, maximum: Int) async throws -> T {
        let (data, response) = try await session.data(for: request(url, method: method))
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse else {
            throw XDriveIOSNativeFilesExportFailure.invalidDownload
        }
        guard http.statusCode == 200 else {
            throw XDriveIOSNativeFilesExportFailure.server(http.statusCode)
        }
        guard data.count <= maximum else {
            throw XDriveIOSNativeFilesExportFailure.invalidDownload
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    func prepare(
        _ node: XDriveIOSNativeFilesNode,
        onProgress: @escaping (Int64, Int64) -> Void = { _, _ in }
    ) async throws -> XDriveIOSNativeFilesPreparedExport {
        guard node.id > 0, node.revision > 0, node.parent_id != nil,
              node.type == "file", node.size >= 0,
              node.size <= Self.maximumTemporaryBytes,
              XDriveIOSNativeFilesFolderNamePolicy.normalized(node.name) == node.name else {
            throw XDriveIOSNativeFilesExportFailure.unsupported
        }
        // URLSession.download writes to a local temporary file before the
        // protected share staging move. Do not start a 1 GiB transfer if
        // the iPhone cannot accommodate a complete copy with free reserve.
        let freeSpace = (try? FileManager.default.attributesOfFileSystem(
            forPath: FileManager.default.temporaryDirectory.path
        ))?[.systemFreeSize] as? NSNumber
        guard XDriveIOSNativeFilesExportCapacityPolicy.mayStage(
            size: node.size, availableFreeBytes: freeSpace?.int64Value
        ) else { throw XDriveIOSNativeFilesExportFailure.insufficientDiskSpace }

        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCache = nil
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 1800
        let downloadDelegate = XDriveIOSFilesDenyDownloadRedirects(
            onProgress: onProgress
        )
        let session = URLSession(configuration: config,
                                 delegate: downloadDelegate,
                                 delegateQueue: nil)
        defer { session.invalidateAndCancel() }

        // A stale list row cannot mint a download ticket for a newer revision.
        let metadataURL = try endpoint("/api/v1/nodes/\(node.id)")
        let current: XDriveIOSNativeFilesNode = try await read(
            metadataURL, method: "GET", session: session, maximum: 65_536
        )
        guard current == node else { throw XDriveIOSNativeFilesExportFailure.staleNode }

        let ticket: XDriveIOSFilesDownloadTicket = try await read(
            endpoint("/api/v1/files/\(node.id)/download-ticket"),
            method: "POST", session: session, maximum: 32_768
        )
        let exactPath = "/api/v1/file-download/\(node.id)"
        guard let parsed = URLComponents(string: ticket.url),
              parsed.scheme == nil, parsed.host == nil,
              parsed.user == nil, parsed.password == nil,
              parsed.fragment == nil, parsed.path == exactPath,
              let query = parsed.queryItems, query.count == 1,
              query[0].name == "ticket",
              let value = query[0].value, !value.isEmpty, value.utf8.count <= 8192,
              var resolved = URLComponents(url: owner.origin, resolvingAgainstBaseURL: false)
        else { throw XDriveIOSNativeFilesExportFailure.invalidTicket }
        resolved.path = exactPath
        resolved.percentEncodedQuery = parsed.percentEncodedQuery
        resolved.fragment = nil
        guard let signedURL = resolved.url else {
            throw XDriveIOSNativeFilesExportFailure.invalidTicket
        }

        let (temporary, response) = try await session.download(
            for: request(signedURL, authenticated: false)
        )
        defer { try? FileManager.default.removeItem(at: temporary) }
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              let attributes = try? FileManager.default.attributesOfItem(atPath: temporary.path),
              (attributes[.type] as? FileAttributeType) == .typeRegular,
              (attributes[.size] as? NSNumber)?.int64Value == node.size else {
            throw XDriveIOSNativeFilesExportFailure.invalidDownload
        }
        let stillCurrent: XDriveIOSNativeFilesNode = try await read(
            metadataURL, method: "GET", session: session, maximum: 65_536
        )
        guard stillCurrent == node else { throw XDriveIOSNativeFilesExportFailure.staleNode }
        try Task.checkCancellation()

        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(
            "xdrive-ios-files-export-" + UUID().uuidString, isDirectory: true
        )
        try FileManager.default.createDirectory(
            at: folder, withIntermediateDirectories: false,
            attributes: [.posixPermissions: NSNumber(value: 0o700),
                         .protectionKey: FileProtectionType.complete]
        )
        do {
            let target = folder.appendingPathComponent(node.name, isDirectory: false)
            try FileManager.default.moveItem(at: temporary, to: target)
            try FileManager.default.setAttributes(
                [.posixPermissions: NSNumber(value: 0o600),
                 .protectionKey: FileProtectionType.complete],
                ofItemAtPath: target.path
            )
            try Task.checkCancellation()
            return XDriveIOSNativeFilesPreparedExport(
                nodeID: node.id, revision: node.revision,
                fileURL: target, directoryURL: folder
            )
        } catch {
            try? FileManager.default.removeItem(at: folder)
            throw error
        }
    }
}

@MainActor
final class XDriveIOSNativeFilesExportModel: ObservableObject {
    @Published private(set) var prepared: XDriveIOSNativeFilesPreparedExport?
    @Published private(set) var busy = false
    @Published private(set) var status: String?

    private var epoch = UUID()
    private var task: Task<Void, Never>?
    private var lastProgressPercent = -1

    func invalidate() {
        epoch = UUID()
        lastProgressPercent = -1
        task?.cancel()
        task = nil
        prepared?.discard()
        prepared = nil
        busy = false
        status = nil
    }

    /// A cancel only cancels the scoped native download, never asserts
    /// that an exported original has already been written to iPhone Files.
    func cancelCurrentTransfer() {
        guard busy, let task else { return }
        task.cancel()
        status = "已请求取消下载；正在清理临时文件。"
    }

    func prepare(_ node: XDriveIOSNativeFilesNode,
                 login: XDriveIOSNativeOwnerLoginModel) {
        invalidate()
        guard let expected = login.owner else {
            status = "请重新验证当前服务器账户。"
            return
        }
        let ticket = epoch
        busy = true
        status = "正在下载原文件；即将显示接收的真实字节进度。"
        task = Task { @MainActor in
            defer {
                if epoch == ticket {
                    busy = false
                    task = nil
                }
            }
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expected),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { return }
                let output = try await XDriveIOSNativeFilesExportReader(
                    owner: auth.owner, accessToken: auth.accessToken
                ).prepare(node, onProgress: { [weak self] received, expectedHTTP in
                    Task { @MainActor [weak self] in
                        guard let self,
                              self.epoch == ticket,
                              self.busy, self.prepared == nil,
                              XDriveIOSNativePhotoOwnerScope.matches(
                                  login.owner, expected
                              ),
                              let percent = XDriveIOSNativeFilesExportCapacityPolicy
                                .receivedPercent(
                                    bytesWritten: received,
                                    nodeBytes: node.size,
                                    httpExpectedBytes: expectedHTTP
                                ),
                              percent > self.lastProgressPercent else { return }
                        self.lastProgressPercent = percent
                        let actual = ByteCountFormatter.string(
                            fromByteCount: received, countStyle: .file
                        )
                        let original = ByteCountFormatter.string(
                            fromByteCount: node.size, countStyle: .file
                        )
                        self.status = "实际已接收 \(actual) / \(original)（\(percent)%）；完成后仍需校验并选择保存位置。"
                    }
                })
                do {
                    try Task.checkCancellation()
                    let after = try await login.verifiedAuthorization()
                    guard epoch == ticket,
                          XDriveIOSNativePhotoOwnerScope.matches(after.owner, expected),
                          XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                    else { output.discard(); return }
                    prepared = output
                    status = "已准备好原文件。点击系统分享按钮选择“存储到文件”；尚未自动保存到 iPhone。"
                } catch {
                    output.discard()
                    throw error
                }
            } catch is CancellationError {
                if epoch == ticket { status = "下载已取消；没有保存到 iPhone。" }
            } catch {
                guard epoch == ticket else { return }
                if let failure = error as? XDriveIOSNativeFilesExportFailure {
                    switch failure {
                    case .unsupported:
                        status = "当前只支持 1 GiB 以内的常规文件导出，未下载。"
                    case .insufficientDiskSpace:
                        status = "本机暂存空间不足（需额外保留 128 MiB），没有开始下载。"
                    case .staleNode, .server(401), .server(403), .server(404):
                        status = "文件版本或访问权限已变化，请刷新文件列表。"
                    default:
                        status = "下载未完成，请检查当前文件及网络后重试。"
                    }
                } else {
                    status = "下载未完成，请检查网络后重试。"
                }
            }
        }
    }
}
