import Combine
import Foundation
import SwiftUI

enum XDriveIOSNativeFilesFolderArchiveFailure: Error {
    case staleFolder
    case invalidOwner
    case invalidResponse
    case tooLarge
    case insufficientDisk
    case preparationFailed
    case server(Int)
}

/// A prepared ZIP represents a Server snapshot, not a locally reassembled tree.
/// The user still has to choose "Save to Files" in the iOS system share sheet.
struct XDriveIOSNativeFilesPreparedArchive: Identifiable {
    let id = UUID()
    let fileURL: URL
    let directoryURL: URL

    func discard() {
        try? FileManager.default.removeItem(at: directoryURL)
    }
}

private struct XDriveIOSNativeFilesArchiveTicket: Decodable {
    let url: String
}

private final class XDriveIOSNativeFilesArchiveNoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// A single foreground folder -> Server-prepared ZIP ticket -> verified
/// app-private original. No nested local enumeration or unbounded download.
struct XDriveIOSNativeFilesFolderArchiveReader {
    let owner: XDriveNativeOwnerRoot
    let accessToken: String

    private func endpoint(_ path: String) throws -> URL {
        guard owner.ownerID > 0, owner.rootNodeID > 0,
              !owner.instanceID.isEmpty, !accessToken.isEmpty,
              path.hasPrefix("/api/v1/"), !path.contains("?"), !path.contains("#"),
              let origin = try? ServerAddress.parse(owner.origin.absoluteString),
              origin == owner.origin,
              var components = URLComponents(url: origin, resolvingAgainstBaseURL: false),
              components.scheme == "https" else {
            throw XDriveIOSNativeFilesFolderArchiveFailure.invalidOwner
        }
        components.path = path
        components.query = nil
        components.fragment = nil
        guard let value = components.url else {
            throw XDriveIOSNativeFilesFolderArchiveFailure.invalidOwner
        }
        return value
    }

    private func makeSession() -> URLSession {
        let settings = URLSessionConfiguration.ephemeral
        settings.httpShouldSetCookies = false
        settings.httpCookieAcceptPolicy = .never
        settings.requestCachePolicy = .reloadIgnoringLocalCacheData
        settings.urlCache = nil
        settings.timeoutIntervalForRequest = 30
        settings.timeoutIntervalForResource = 1800
        return URLSession(configuration: settings,
                          delegate: XDriveIOSNativeFilesArchiveNoRedirects(),
                          delegateQueue: nil)
    }

    private func request(_ path: String, method: String, body: Data? = nil) throws
        -> URLRequest {
        var request = URLRequest(url: try endpoint(path))
        request.httpMethod = method
        request.httpShouldHandleCookies = false
        request.setValue("Bearer " + accessToken, forHTTPHeaderField: "Authorization")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body
        }
        return request
    }

    private func read<T: Decodable>(
        _ path: String, method: String = "GET", body: Data? = nil,
        status: Int = 200, maximumBytes: Int = 8_388_608,
        session: URLSession
    ) async throws -> T {
        let (data, response) = try await session.data(for:
            request(path, method: method, body: body)
        )
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse else {
            throw XDriveIOSNativeFilesFolderArchiveFailure.invalidResponse
        }
        guard http.statusCode == status else {
            throw XDriveIOSNativeFilesFolderArchiveFailure.server(http.statusCode)
        }
        guard data.count <= maximumBytes else {
            throw XDriveIOSNativeFilesFolderArchiveFailure.invalidResponse
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func current(_ folderID: UInt64, session: URLSession) async throws
        -> XDriveIOSNativeFilesNode {
        try await read("/api/v1/nodes/\(folderID)", method: "GET",
                       maximumBytes: 65_536, session: session)
    }

    private func signedURL(runID: String, ticket: String) throws -> URL {
        let path = "/api/v1/archive-download/\(runID)"
        guard XDriveIOSNativeFilesFolderArchivePolicy.validRunID(runID),
              let parts = URLComponents(string: ticket),
              parts.scheme == nil, parts.host == nil,
              parts.user == nil, parts.password == nil,
              parts.fragment == nil, parts.path == path,
              let query = parts.queryItems, query.count == 1,
              query[0].name == "ticket",
              let token = query[0].value, !token.isEmpty,
              token.utf8.count <= 8192,
              var resolved = URLComponents(url: owner.origin, resolvingAgainstBaseURL: false),
              resolved.scheme == "https" else {
            throw XDriveIOSNativeFilesFolderArchiveFailure.invalidResponse
        }
        resolved.path = path
        resolved.percentEncodedQuery = parts.percentEncodedQuery
        resolved.fragment = nil
        guard let url = resolved.url else {
            throw XDriveIOSNativeFilesFolderArchiveFailure.invalidResponse
        }
        return url
    }

    /// Check a complete ZIP envelope, not just HTTP 200 or a downloaded byte
    /// count. ZIP EOCD must occur within the final 65557 bytes (max comment).
    private func verifyZIP(_ url: URL, bytes: Int64) throws {
        guard XDriveIOSNativeFilesFolderArchivePolicy.validDownloadedBytes(bytes) else {
            throw XDriveIOSNativeFilesFolderArchiveFailure.tooLarge
        }
        let stream = try FileHandle(forReadingFrom: url)
        defer { try? stream.close() }
        let prefix = try stream.read(upToCount: 4) ?? Data()
        guard prefix == Data([0x50, 0x4b, 0x03, 0x04]) ||
              prefix == Data([0x50, 0x4b, 0x05, 0x06]) else {
            throw XDriveIOSNativeFilesFolderArchiveFailure.invalidResponse
        }
        try stream.seek(toOffset: UInt64(max(Int64(0), bytes - 65_557)))
        let tail = try stream.readToEnd() ?? Data()
        guard tail.range(of: Data([0x50, 0x4b, 0x05, 0x06])) != nil else {
            throw XDriveIOSNativeFilesFolderArchiveFailure.invalidResponse
        }
    }

    func prepare(_ folder: XDriveIOSNativeFilesNode) async throws
        -> XDriveIOSNativeFilesPreparedArchive {
        guard folder.id > 0, folder.revision > 0,
              folder.isDirectory, folder.parent_id != nil,
              XDriveIOSNativeFilesFolderNamePolicy.normalized(folder.name) == folder.name else {
            throw XDriveIOSNativeFilesFolderArchiveFailure.staleFolder
        }
        let session = makeSession()
        defer { session.invalidateAndCancel() }
        guard try await current(folder.id, session: session) == folder else {
            throw XDriveIOSNativeFilesFolderArchiveFailure.staleFolder
        }

        // POST schedules a durable read-only archive preparation. Never
        // repeat it blindly after an unknown network response.
        let body = try JSONEncoder().encode(["ids": [folder.id]])
        let accepted: XDriveIOSNativeFilesFolderArchivePolicy.Snapshot = try await read(
            "/api/v1/download/archive/prepare",
            method: "POST", body: body, status: 202, session: session
        )
        let runID = accepted.transfer_id
        guard XDriveIOSNativeFilesFolderArchivePolicy.validProgress(
            accepted, runID: runID
        ) else { throw XDriveIOSNativeFilesFolderArchiveFailure.invalidResponse }

        var ready = accepted
        // The Server may prepare large subtrees asynchronously. Bound foreground
        // waiting to three minutes; do not launch a second prepare on timeout.
        for _ in 0..<90 {
            try Task.checkCancellation()
            if ready.state == "completed" { break }
            if ready.state == "failed" || ready.state == "cancelled" ||
               ready.state == "cancel_requested" {
                throw XDriveIOSNativeFilesFolderArchiveFailure.preparationFailed
            }
            try await Task.sleep(nanoseconds: 2_000_000_000)
            ready = try await read(
                "/api/v1/download/archive/prepare/\(runID)",
                session: session
            )
            guard XDriveIOSNativeFilesFolderArchivePolicy.validProgress(
                ready, runID: runID
            ) else { throw XDriveIOSNativeFilesFolderArchiveFailure.invalidResponse }
        }
        guard ready.state == "completed" else {
            throw XDriveIOSNativeFilesFolderArchiveFailure.preparationFailed
        }
        guard XDriveIOSNativeFilesFolderArchivePolicy.validReady(ready, runID: runID),
              let filename = ready.filename else {
            throw XDriveIOSNativeFilesFolderArchiveFailure.tooLarge
        }
        let freeBytes = (try? FileManager.default.attributesOfFileSystem(
            forPath: FileManager.default.temporaryDirectory.path
        ))?[.systemFreeSize] as? NSNumber
        guard XDriveIOSNativeFilesFolderArchivePolicy.hasCapacity(
            freeDiskBytes: freeBytes?.int64Value
        ) else { throw XDriveIOSNativeFilesFolderArchiveFailure.insufficientDisk }
        guard try await current(folder.id, session: session) == folder else {
            throw XDriveIOSNativeFilesFolderArchiveFailure.staleFolder
        }

        let ticket: XDriveIOSNativeFilesArchiveTicket = try await read(
            "/api/v1/download/archive/prepare/\(runID)/download-ticket",
            method: "POST", maximumBytes: 32_768, session: session
        )
        var get = URLRequest(url: try signedURL(runID: runID, ticket: ticket.url))
        get.httpMethod = "GET"
        get.httpShouldHandleCookies = false
        get.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        let (temporary, response) = try await session.download(for: get)
        defer { try? FileManager.default.removeItem(at: temporary) }
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              http.value(forHTTPHeaderField: "Content-Type")?.hasPrefix("application/zip") == true,
              let attrs = try? FileManager.default.attributesOfItem(atPath: temporary.path),
              (attrs[.type] as? FileAttributeType) == .typeRegular,
              let bytes = (attrs[.size] as? NSNumber)?.int64Value else {
            throw XDriveIOSNativeFilesFolderArchiveFailure.invalidResponse
        }
        try verifyZIP(temporary, bytes: bytes)
        // Server writes ZIP entries with zip.Store (no compression): a
        // seemingly valid header/tail may still represent a truncated stream.
        guard bytes >= (ready.total_bytes ?? 0) else {
            throw XDriveIOSNativeFilesFolderArchiveFailure.invalidResponse
        }
        guard try await current(folder.id, session: session) == folder else {
            throw XDriveIOSNativeFilesFolderArchiveFailure.staleFolder
        }
        try Task.checkCancellation()

        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(
            "xdrive-ios-folder-archive-" + UUID().uuidString, isDirectory: true
        )
        try FileManager.default.createDirectory(
            at: directory, withIntermediateDirectories: false,
            attributes: [.posixPermissions: NSNumber(value: 0o700),
                         .protectionKey: FileProtectionType.complete]
        )
        do {
            let target = directory.appendingPathComponent(filename, isDirectory: false)
            try FileManager.default.moveItem(at: temporary, to: target)
            try FileManager.default.setAttributes(
                [.posixPermissions: NSNumber(value: 0o600),
                 .protectionKey: FileProtectionType.complete],
                ofItemAtPath: target.path
            )
            try Task.checkCancellation()
            return XDriveIOSNativeFilesPreparedArchive(
                fileURL: target, directoryURL: directory
            )
        } catch {
            try? FileManager.default.removeItem(at: directory)
            throw error
        }
    }
}

@MainActor
final class XDriveIOSNativeFilesFolderArchiveModel: ObservableObject {
    @Published private(set) var prepared: XDriveIOSNativeFilesPreparedArchive?
    @Published private(set) var busy = false
    @Published private(set) var status: String?

    private var epoch = UUID()
    private var task: Task<Void, Never>?

    func invalidate() {
        epoch = UUID()
        task?.cancel()
        task = nil
        prepared?.discard()
        prepared = nil
        busy = false
        status = nil
    }

    func cancelCurrentTransfer() {
        guard busy, let task else { return }
        task.cancel()
        status = "已请求取消文件夹 ZIP 下载；未保存到 iPhone。"
    }

    func prepare(_ folder: XDriveIOSNativeFilesNode,
                 login: XDriveIOSNativeOwnerLoginModel,
                 expectedOwner: XDriveNativeOwnerRoot) {
        guard !busy, task == nil, prepared == nil else { return }
        guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner) else {
            status = "当前服务器或账户已变化，请重新打开文件夹。"
            return
        }
        let ticket = UUID()
        epoch = ticket
        busy = true
        status = "正在请求服务器准备文件夹 ZIP；暂不估算完成时间。"
        task = Task { @MainActor in
            defer {
                if epoch == ticket {
                    task = nil
                    busy = false
                }
            }
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expectedOwner),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner) else {
                    return
                }
                let archive = try await XDriveIOSNativeFilesFolderArchiveReader(
                    owner: auth.owner, accessToken: auth.accessToken
                ).prepare(folder)
                do {
                    try Task.checkCancellation()
                    let after = try await login.verifiedAuthorization()
                    guard epoch == ticket,
                          XDriveIOSNativePhotoOwnerScope.matches(after.owner, expectedOwner),
                          XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner) else {
                        archive.discard()
                        return
                    }
                    prepared = archive
                    status = "ZIP 已准备好，请在 iOS 系统分享界面选择“存储到文件”；尚未自动保存。"
                } catch {
                    archive.discard()
                    throw error
                }
            } catch is CancellationError {
                if epoch == ticket {
                    status = "文件夹下载已取消；未自动保存到 iPhone。"
                }
            } catch {
                guard epoch == ticket else { return }
                if let failure = error as? XDriveIOSNativeFilesFolderArchiveFailure {
                    switch failure {
                    case .tooLarge:
                        status = "文件夹大小、项目数或 ZIP 超过本次前台限制（源文件合计 512 MiB）。"
                    case .insufficientDisk:
                        status = "手机暂存空间不足，需至少 768 MiB 可用空间。"
                    case .staleFolder, .server(401), .server(403), .server(404):
                        status = "文件夹版本或权限已改变，请刷新文件列表。"
                    case .preparationFailed:
                        status = "服务器 ZIP 准备失败或未及时完成，请稍后刷新后重试。"
                    default:
                        status = "ZIP 下载或校验失败；未保存到 iPhone。"
                    }
                } else {
                    status = "ZIP 下载未完成，可能是网络或服务器暂时不可用。"
                }
            }
        }
    }
}
