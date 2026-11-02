import Combine
import CryptoKit
import Foundation
import SwiftUI

enum XDriveIOSNativeFilesHistoricalExportFailure: Error {
    case staleFileOrVersion
    case unsupported
    case invalidOwner
    case invalidTicket
    case invalidDownload
    case insufficientDisk
    case server(Int)
}

struct XDriveIOSNativeFilesPreparedHistoricalExport: Identifiable {
    let id = UUID()
    let versionID: UInt64
    let fileURL: URL
    let directoryURL: URL

    func discard() {
        try? FileManager.default.removeItem(at: directoryURL)
    }
}

private struct XDriveIOSNativeFilesHistoricalTicket: Decodable {
    let url: String
}

private final class XDriveIOSNativeFilesHistoricalNoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// One selected historical version is read-only. It never restores, overwrites
/// the cloud Node, or claims to have written anything to iOS Files.
struct XDriveIOSNativeFilesHistoricalExportReader {
    let owner: XDriveNativeOwnerRoot
    let accessToken: String

    private func endpoint(_ path: String) throws -> URL {
        guard owner.ownerID > 0, owner.rootNodeID > 0,
              !owner.instanceID.isEmpty, !accessToken.isEmpty,
              path.hasPrefix("/api/v1/"), !path.contains("?"), !path.contains("#"),
              let origin = try? ServerAddress.parse(owner.origin.absoluteString),
              origin == owner.origin,
              var parts = URLComponents(url: origin, resolvingAgainstBaseURL: false),
              parts.scheme == "https" else {
            throw XDriveIOSNativeFilesHistoricalExportFailure.invalidOwner
        }
        parts.path = path
        parts.query = nil
        parts.fragment = nil
        guard let url = parts.url else {
            throw XDriveIOSNativeFilesHistoricalExportFailure.invalidOwner
        }
        return url
    }

    private func newSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCache = nil
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 1_800
        return URLSession(configuration: config,
                          delegate: XDriveIOSNativeFilesHistoricalNoRedirects(),
                          delegateQueue: nil)
    }

    private func send<T: Decodable>(
        _ path: String, method: String, limit: Int,
        session: URLSession
    ) async throws -> T {
        var request = URLRequest(url: try endpoint(path))
        request.httpMethod = method
        request.httpShouldHandleCookies = false
        request.setValue("Bearer " + accessToken, forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        let (data, response) = try await session.data(for: request)
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse else {
            throw XDriveIOSNativeFilesHistoricalExportFailure.invalidDownload
        }
        guard http.statusCode == 200 else {
            throw XDriveIOSNativeFilesHistoricalExportFailure.server(http.statusCode)
        }
        guard data.count <= limit else {
            throw XDriveIOSNativeFilesHistoricalExportFailure.invalidDownload
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func requireCurrent(_ node: XDriveIOSNativeFilesNode, session: URLSession)
        async throws {
        let current: XDriveIOSNativeFilesNode = try await send(
            "/api/v1/nodes/\(node.id)", method: "GET", limit: 65_536,
            session: session
        )
        guard current == node else {
            throw XDriveIOSNativeFilesHistoricalExportFailure.staleFileOrVersion
        }
    }

    private func requireVersion(_ version: XDriveIOSNativeFilesVersionRecord,
                                in node: XDriveIOSNativeFilesNode,
                                session: URLSession) async throws {
        let versions: [XDriveIOSNativeFilesVersionRecord] = try await send(
            "/api/v1/files/\(node.id)/versions", method: "GET", limit: 2_097_152,
            session: session
        )
        guard XDriveIOSNativeFilesVersionHistoryPolicy.valid(versions, for: node),
              versions.contains(version) else {
            throw XDriveIOSNativeFilesHistoricalExportFailure.staleFileOrVersion
        }
    }

    private func resolvedTicket(_ relative: String, nodeID: UInt64,
                                versionID: UInt64) throws -> URL {
        let path = "/api/v1/file-version-download/\(nodeID)/\(versionID)"
        guard let parsed = URLComponents(string: relative),
              parsed.scheme == nil, parsed.host == nil,
              parsed.user == nil, parsed.password == nil,
              parsed.fragment == nil, parsed.path == path,
              let query = parsed.queryItems, query.count == 1,
              query[0].name == "ticket",
              let token = query[0].value, !token.isEmpty,
              token.utf8.count <= 8_192,
              var resolved = URLComponents(url: owner.origin,
                                           resolvingAgainstBaseURL: false),
              resolved.scheme == "https" else {
            throw XDriveIOSNativeFilesHistoricalExportFailure.invalidTicket
        }
        resolved.path = path
        resolved.percentEncodedQuery = parsed.percentEncodedQuery
        resolved.fragment = nil
        guard let url = resolved.url else {
            throw XDriveIOSNativeFilesHistoricalExportFailure.invalidTicket
        }
        return url
    }

    private func sha256(_ fileURL: URL) throws -> String {
        let file = try FileHandle(forReadingFrom: fileURL)
        defer { try? file.close() }
        var digest = SHA256()
        while true {
            try Task.checkCancellation()
            guard let part = try file.read(upToCount: 8 * 1_048_576),
                  !part.isEmpty else { break }
            digest.update(data: part)
        }
        return digest.finalize().map { String(format: "%02x", $0) }.joined()
    }

    func prepare(
        node: XDriveIOSNativeFilesNode,
        version: XDriveIOSNativeFilesVersionRecord
    ) async throws -> XDriveIOSNativeFilesPreparedHistoricalExport {
        guard node.id > 0, node.type == "file", node.parent_id != nil,
              node.revision > 0,
              XDriveIOSNativeFilesFolderNamePolicy.normalized(node.name) == node.name,
              XDriveIOSNativeFilesVersionHistoryPolicy.valid([version], for: node),
              version.size <= XDriveIOSNativeFilesExportCapacityPolicy.maximumSingleFileBytes else {
            throw XDriveIOSNativeFilesHistoricalExportFailure.unsupported
        }
        // URLSession downloads the full original to a temporary file before
        // the user can explicitly choose "Save to Files".
        let free = (try? FileManager.default.attributesOfFileSystem(
            forPath: FileManager.default.temporaryDirectory.path
        ))?[.systemFreeSize] as? NSNumber
        guard XDriveIOSNativeFilesExportCapacityPolicy.mayStage(
            size: version.size, availableFreeBytes: free?.int64Value
        ) else { throw XDriveIOSNativeFilesHistoricalExportFailure.insufficientDisk }

        let session = newSession()
        defer { session.invalidateAndCancel() }
        try await requireCurrent(node, session: session)
        try await requireVersion(version, in: node, session: session)
        try Task.checkCancellation()

        let ticket: XDriveIOSNativeFilesHistoricalTicket = try await send(
            "/api/v1/files/\(node.id)/versions/\(version.id)/download-ticket",
            method: "POST", limit: 32_768, session: session
        )
        var request = URLRequest(url: try resolvedTicket(
            ticket.url, nodeID: node.id, versionID: version.id
        ))
        request.httpMethod = "GET"
        request.httpShouldHandleCookies = false
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        let (temporary, response) = try await session.download(for: request)
        defer { try? FileManager.default.removeItem(at: temporary) }
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse,
              http.statusCode == 200,
              let attributes = try? FileManager.default.attributesOfItem(
                atPath: temporary.path
              ),
              (attributes[.type] as? FileAttributeType) == .typeRegular,
              (attributes[.size] as? NSNumber)?.int64Value == version.size else {
            throw XDriveIOSNativeFilesHistoricalExportFailure.invalidDownload
        }
        if let expectedSHA = version.sha256, !expectedSHA.isEmpty {
            guard http.value(forHTTPHeaderField: "X-Content-SHA256")?.lowercased()
                    == expectedSHA.lowercased(),
                  try sha256(temporary) == expectedSHA.lowercased() else {
                throw XDriveIOSNativeFilesHistoricalExportFailure.invalidDownload
            }
        }
        // Historical entries can be restored/deleted by another session while
        // bytes are in flight. Revalidate the current Node and chosen version.
        try await requireCurrent(node, session: session)
        try await requireVersion(version, in: node, session: session)
        try Task.checkCancellation()

        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(
            "xdrive-ios-file-version-export-" + UUID().uuidString, isDirectory: true
        )
        try FileManager.default.createDirectory(
            at: directory, withIntermediateDirectories: false,
            attributes: [.posixPermissions: NSNumber(value: 0o700),
                         .protectionKey: FileProtectionType.complete]
        )
        do {
            let target = directory.appendingPathComponent(node.name, isDirectory: false)
            try FileManager.default.moveItem(at: temporary, to: target)
            try FileManager.default.setAttributes(
                [.posixPermissions: NSNumber(value: 0o600),
                 .protectionKey: FileProtectionType.complete],
                ofItemAtPath: target.path
            )
            try Task.checkCancellation()
            return XDriveIOSNativeFilesPreparedHistoricalExport(
                versionID: version.id, fileURL: target, directoryURL: directory
            )
        } catch {
            try? FileManager.default.removeItem(at: directory)
            throw error
        }
    }
}

@MainActor
final class XDriveIOSNativeFilesHistoricalExportModel: ObservableObject {
    @Published private(set) var prepared: XDriveIOSNativeFilesPreparedHistoricalExport?
    @Published private(set) var busy = false
    @Published private(set) var status: String?

    private var epoch = UUID()
    private var job: Task<Void, Never>?

    func invalidate() {
        epoch = UUID()
        job?.cancel()
        job = nil
        prepared?.discard()
        prepared = nil
        busy = false
        status = nil
    }

    func cancelCurrentTransfer() {
        guard busy, let job else { return }
        job.cancel()
        status = "已请求取消历史原件下载；没有保存到 iPhone。"
    }

    func prepare(_ version: XDriveIOSNativeFilesVersionRecord,
                 node: XDriveIOSNativeFilesNode,
                 login: XDriveIOSNativeOwnerLoginModel,
                 openedOwner: XDriveNativeOwnerRoot) {
        guard !busy else { return }
        invalidate()
        guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, openedOwner) else {
            status = "当前账户已经变化，请重新打开文件。"
            return
        }
        let ticket = epoch
        busy = true
        status = "正在获取历史修订 \(version.revision) 的原件；下载完成仍需验证。"
        job = Task { @MainActor in
            defer {
                if epoch == ticket { busy = false; job = nil }
            }
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(auth.owner, openedOwner),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, openedOwner) else {
                    return
                }
                let output = try await XDriveIOSNativeFilesHistoricalExportReader(
                    owner: auth.owner, accessToken: auth.accessToken
                ).prepare(node: node, version: version)
                do {
                    try Task.checkCancellation()
                    let after = try await login.verifiedAuthorization()
                    guard epoch == ticket,
                          XDriveIOSNativePhotoOwnerScope.matches(after.owner, openedOwner),
                          XDriveIOSNativePhotoOwnerScope.matches(login.owner, openedOwner) else {
                        output.discard()
                        return
                    }
                    prepared = output
                    status = "历史原件已验证并暂存，请在 iOS 系统分享菜单选择“存储到文件”；尚未自动保存。"
                } catch {
                    output.discard()
                    throw error
                }
            } catch is CancellationError {
                if epoch == ticket { status = "历史原件下载已取消；没有保存到 iPhone。" }
            } catch {
                guard epoch == ticket else { return }
                if let failure = error as? XDriveIOSNativeFilesHistoricalExportFailure {
                    switch failure {
                    case .unsupported:
                        status = "只支持不超过 1 GiB 的常规历史原件下载。"
                    case .insufficientDisk:
                        status = "本机暂存空间不足；原件未下载。"
                    case .staleFileOrVersion, .server(401), .server(403),
                         .server(404), .server(410):
                        status = "文件或历史版本已变化；请返回列表刷新后重新选择。"
                    default:
                        status = "历史原件未完成验证；请检查当前网络后重试。"
                    }
                } else {
                    status = "历史原件下载失败；没有保存到 iPhone。"
                }
            }
        }
    }
}
