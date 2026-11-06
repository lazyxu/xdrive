import AppIntents
import CryptoKit
import Foundation

/// An Apple Shortcut selects each Notes item and explicitly passes its text.
/// iOS does not grant apps a Notes database entitlement or change listener.
struct XDriveBackupAppleNoteIntent: AppIntent {
    static var title: LocalizedStringResource = "备份 Apple 备忘录到 xDrive"
    static var description = IntentDescription(
        "将快捷指令提供的文本导入 xDrive「iOS备份」Markdown。若提供稳定的来源标识，更新原笔记并保留旧版；留空则每次生成独立备份。"
    )
    static var openAppWhenRun = false

    @Parameter(title: "Apple 备忘录标题") var noteTitle: String
    @Parameter(title: "Apple 备忘录纯文本或 Markdown") var noteText: String
    @Parameter(title: "Apple 备忘录稳定标识（选填）") var sourceIdentifier: String?

    static var parameterSummary: some ParameterSummary {
        Summary("将 \(\.$noteTitle) 备份到 xDrive")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let result = try await XDriveIOSNotesImportRunner.backup(
            title: noteTitle, text: noteText, sourceIdentifier: sourceIdentifier
        )
        if result.newNote {
            return .result(dialog: "xDrive 已保存新的只读笔记备份。")
        }
        return .result(dialog: "xDrive 已核对并保存本次备份；旧版本保留。")
    }
}

enum XDriveIOSNotesImportError: LocalizedError {
    case noSavedOwner
    case ownerChanged
    case anotherUploadActive
    case server(Int)
    case invalidReceipt
    case uncertainCommit

    var errorDescription: String? {
        switch self {
        case .noSavedOwner:
            return "请在 xDrive 原生 App 登录目标服务器并启用保持登录，然后解锁设备重试。"
        case .ownerChanged:
            return "服务器、账号或文件根目录身份发生变化，本次未继续上传。"
        case .anotherUploadActive:
            return "有其他原件备份操作正在进行，本次未开始。"
        case .server(let status):
            if status == 404 { return "服务器暂不支持新版笔记 API，请升级 xDrive Server。" }
            return "笔记接口请求失败（HTTP \(status)）。"
        case .invalidReceipt:
            return "服务器笔记收据、Owner 目录或内容哈希核对失败。"
        case .uncertainCommit:
            return "备份提交结果不确定，请在云端 iOS备份 中核对，避免手动重复提交。"
        }
    }
}

private struct XDriveIOSNotesNamespaceDTO: Decodable {
    let ios_backup_node_id: UInt64
}

private struct XDriveIOSNotesReceiptDTO: Decodable {
    let id: String
    let source: String
    let title: String
    let node_id: UInt64
    let revision: UInt64
    let sha256: String
    let bytes: Int64
    let markdown: String?
}

private struct XDriveIOSNotesNodeDTO: Decodable {
    let id: UInt64
    let parent_id: UInt64?
    let name: String
    let type: String
    let size: Int64
    let revision: UInt64
    let sha256: String?
}

private final class XDriveIOSNotesDenyRedirect: XDriveIOSServerTLSDelegate, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// HTTPS-only requests using the existing short-lived, verified Owner bearer.
/// Never grant a normal Notes endpoint the separate Photo BG credential.
private struct XDriveIOSNotesHTTP {
    let origin: URL
    let accessToken: String

    func request<T: Decodable>(_ type: T.Type, method: String, path: String,
                               body: Data? = nil, acceptStatus: ClosedRange<Int> = 200...299)
        async throws -> (T, Int) {
        guard origin.scheme?.lowercased() == "https",
              !accessToken.isEmpty,
              path.hasPrefix("/api/v1/notes/") || path == "/api/v1/notes" ||
              path.hasPrefix("/api/v1/nodes/"),
              !path.contains("?"), !path.contains("#"),
              var components = URLComponents(url: origin, resolvingAgainstBaseURL: false)
        else { throw XDriveIOSNotesImportError.invalidReceipt }
        components.path = path
        components.query = nil
        components.fragment = nil
        guard let url = components.url else {
            throw XDriveIOSNotesImportError.invalidReceipt
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpShouldHandleCookies = false
        request.timeoutInterval = 60
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
            request.httpBody = body
        }
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCache = nil
        let session = URLSession(configuration: config,
                                 delegate: XDriveIOSNotesDenyRedirect(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        let (data, reply) = try await session.data(for: request)
        guard let http = reply as? HTTPURLResponse else {
            throw XDriveIOSNotesImportError.invalidReceipt
        }
        guard acceptStatus.contains(http.statusCode) else {
            throw XDriveIOSNotesImportError.server(http.statusCode)
        }
        guard data.count <= 3 * 1_048_576,
              let decoded = try? JSONDecoder().decode(T.self, from: data) else {
            throw XDriveIOSNotesImportError.invalidReceipt
        }
        return (decoded, http.statusCode)
    }
}

private struct XDriveIOSNotesImportRequest: Encodable {
    let title: String
    let markdown: String
    let external_id: String
}

@MainActor
enum XDriveIOSNotesImportRunner {
    struct BackupResult {
        let newNote: Bool
    }

    static func backup(title: String, text: String, sourceIdentifier: String?)
        async throws -> BackupResult {
        let snapshot = try XDriveIOSNotesImportPolicy.prepare(
            title: title, text: text, externalID: sourceIdentifier
        )
        guard let lock = XDriveIOSOriginalRunGate.shared.acquire() else {
            throw XDriveIOSNotesImportError.anotherUploadActive
        }
        defer { XDriveIOSOriginalRunGate.shared.release(lock) }

        guard let saved = try XDriveIOSNativeOwnerSessionStore.load() else {
            throw XDriveIOSNotesImportError.noSavedOwner
        }
        let origin = try ServerAddress.parse(saved.origin)
        let refreshed = try await AuthService(origin: origin).refresh(token: saved.refreshToken)
        try Task.checkCancellation()
        guard refreshed.must_change_password != true,
              refreshed.username == saved.username,
              let access = [refreshed.access_token, refreshed.token]
                .compactMap({ $0 }).first(where: { !$0.isEmpty }),
              !refreshed.refresh_token.isEmpty else {
            throw XDriveIOSNotesImportError.ownerChanged
        }
        let verified = try await XDriveNativeOwnerRootVerifier(
            origin: origin, accessToken: access,
            expectedUsername: saved.username
        ).verify()
        try Task.checkCancellation()
        guard verified.origin.absoluteString == saved.origin,
              verified.instanceID == saved.serverInstanceID,
              verified.ownerID == saved.ownerID,
              verified.username == saved.username,
              verified.rootNodeID == saved.rootNodeID,
              try XDriveIOSNativeOwnerSessionStore.load() == saved else {
            throw XDriveIOSNotesImportError.ownerChanged
        }
        let newCredentials = XDriveIOSNativeOwnerCredential(
            origin: saved.origin,
            username: saved.username,
            serverInstanceID: saved.serverInstanceID,
            ownerID: saved.ownerID,
            rootNodeID: saved.rootNodeID,
            refreshToken: refreshed.refresh_token
        )
        try XDriveIOSNativeOwnerSessionStore.save(newCredentials)

        let http = XDriveIOSNotesHTTP(origin: origin, accessToken: access)
        let (namespace, _) = try await http.request(
            XDriveIOSNotesNamespaceDTO.self,
            method: "POST", path: "/api/v1/notes/namespace", body: Data("{}".utf8)
        )
        guard namespace.ios_backup_node_id > 0 else {
            throw XDriveIOSNotesImportError.invalidReceipt
        }
        try Task.checkCancellation()
        guard try XDriveIOSNativeOwnerSessionStore.load() == newCredentials else {
            throw XDriveIOSNotesImportError.ownerChanged
        }

        let sha = SHA256.hash(data: Data(snapshot.markdown.utf8))
            .map { String(format: "%02x", $0) }.joined()
        let input = XDriveIOSNotesImportRequest(
            title: snapshot.title,
            markdown: snapshot.markdown,
            external_id: snapshot.externalID
        )
        // This POST owns the only write. A network timeout or missing ACK is
        // UNKNOWN, not a reason to send a second POST in this invocation.
        let note: XDriveIOSNotesReceiptDTO
        let created: Bool
        do {
            let (result, status) = try await http.request(
                XDriveIOSNotesReceiptDTO.self, method: "POST",
                path: "/api/v1/notes/ios/import",
                body: try JSONEncoder().encode(input), acceptStatus: 200...201
            )
            note = result
            created = status == 201
        } catch XDriveIOSNotesImportError.server(let status) {
            throw XDriveIOSNotesImportError.server(status)
        } catch {
            throw XDriveIOSNotesImportError.uncertainCommit
        }

        guard UUID(uuidString: note.id) != nil,
              note.source == "ios_notes",
              note.title == snapshot.title,
              note.node_id > 0, note.revision > 0,
              note.sha256.lowercased() == sha,
              note.bytes == Int64(snapshot.markdown.utf8.count) else {
            throw XDriveIOSNotesImportError.invalidReceipt
        }
        // Verify both domain Note readback and actual Node parent/sha. A
        // successful HTTP status alone is not evidence that a note is backed
        // up in the intended managed iOS directory.
        let (detail, _) = try await http.request(
            XDriveIOSNotesReceiptDTO.self, method: "GET",
            path: "/api/v1/notes/\(note.id)"
        )
        let (node, _) = try await http.request(
            XDriveIOSNotesNodeDTO.self, method: "GET",
            path: "/api/v1/nodes/\(note.node_id)"
        )
        guard detail.id == note.id, detail.node_id == note.node_id,
              detail.source == "ios_notes", detail.revision == note.revision,
              detail.sha256.lowercased() == sha,
              detail.markdown == snapshot.markdown,
              node.id == note.node_id,
              node.parent_id == namespace.ios_backup_node_id,
              node.type == "file", node.name == note.id + ".md",
              node.revision == note.revision,
              node.size == Int64(snapshot.markdown.utf8.count),
              node.sha256?.lowercased() == sha else {
            throw XDriveIOSNotesImportError.invalidReceipt
        }
        return BackupResult(newNote: created)
    }
}
