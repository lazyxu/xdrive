import CryptoKit
import Foundation

enum XDriveIOSNativeNotesError: LocalizedError {
    case invalidOwner
    case malformedIdentity
    case invalidResponse
    case tooLarge
    case staleRevision
    case http(Int)

    var errorDescription: String? {
        switch self {
        case .invalidOwner: return "请重新验证当前 xDrive Server 和账号。"
        case .malformedIdentity: return "备忘录标识或版本无效。"
        case .invalidResponse: return "服务器返回的备忘录内容无法校验。"
        case .tooLarge: return "备忘录内容超出 1 MiB 限制。"
        case .staleRevision: return "其他设备已更新这条备忘录；当前草稿保留。"
        case .http(let status):
            if status == 404 { return "当前服务器尚未接通备忘录 API，或备忘录不存在。" }
            return "备忘录服务器请求失败（HTTP \(status)）。"
        }
    }
}

enum XDriveIOSNativeNoteSource: String, CaseIterable, Identifiable {
    case mine, ios_notes

    var id: String { rawValue }
    var title: String {
        switch self {
        case .mine: return "我的备忘录"
        case .ios_notes: return "iOS 备份"
        }
    }
    var writable: Bool { self == .mine }
}

struct XDriveIOSNativeNoteSummary: Decodable, Identifiable, Hashable {
    let id: String
    let source: String
    let title: String
    let node_id: UInt64
    let revision: UInt64
    let sha256: String
    let bytes: Int64
    let created_at: String
    let updated_at: String

    var isMine: Bool { source == XDriveIOSNativeNoteSource.mine.rawValue }
}

struct XDriveIOSNativeNoteDetail: Decodable {
    let id: String
    let source: String
    let title: String
    let node_id: UInt64
    let revision: UInt64
    let sha256: String
    let bytes: Int64
    let markdown: String
}

struct XDriveIOSNativeNotePage: Decodable {
    let items: [XDriveIOSNativeNoteSummary]
    let next_offset: Int
}

struct XDriveIOSNativeNoteVersion: Decodable, Identifiable {
    let id: UInt64
    let revision: UInt64
    let sha256: String
    let bytes: Int64
}

private struct XDriveIOSNativeNoteVersionPage: Decodable {
    let items: [XDriveIOSNativeNoteVersion]
    let node_id: UInt64
}

private struct XDriveIOSNativeNoteNamespace: Decodable {
    let ios_backup_node_id: UInt64
    let my_notes_node_id: UInt64
}

private struct XDriveIOSNativeNoteWrite: Encodable {
    let title: String
    let markdown: String
    let expected_revision: UInt64?
}

private struct XDriveIOSNativeManualNoteImportWrite: Encodable {
    let title: String
    let markdown: String
    let external_id: String?
}

private final class XDriveIOSNativeNotesNoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

// A native UI transport for the exact Server/Owner already verified by the
// existing native login. It never stores a bearer or opens a WKWebView.
struct XDriveIOSNativeNotesClient {
    let origin: URL
    let accessToken: String

    init(owner: XDriveNativeOwnerRoot, accessToken: String) throws {
        guard owner.origin.scheme?.lowercased() == "https",
              !accessToken.isEmpty else {
            throw XDriveIOSNativeNotesError.invalidOwner
        }
        self.origin = owner.origin
        self.accessToken = accessToken
    }

    private func noteID(_ id: String) throws -> String {
        guard let parsed = UUID(uuidString: id) else {
            throw XDriveIOSNativeNotesError.malformedIdentity
        }
        return parsed.uuidString.lowercased()
    }

    private func endpoint(_ path: String, query: [URLQueryItem] = []) throws -> URL {
        guard path.hasPrefix("/api/v1/notes") ||
              path.hasPrefix("/api/v1/files/"),
              !path.contains("?"), !path.contains("#"),
              !path.contains(".."),
              var components = URLComponents(url: origin, resolvingAgainstBaseURL: false),
              components.scheme?.lowercased() == "https" else {
            throw XDriveIOSNativeNotesError.invalidOwner
        }
        components.path = path
        components.queryItems = query.isEmpty ? nil : query
        guard let result = components.url, result.host == origin.host else {
            throw XDriveIOSNativeNotesError.invalidOwner
        }
        return result
    }

    private func request(
        method: String, path: String,
        query: [URLQueryItem] = [], body: Data? = nil,
        ifMatch: UInt64? = nil
    ) async throws -> (Data, HTTPURLResponse) {
        var request = URLRequest(url: try endpoint(path, query: query))
        request.httpMethod = method
        request.httpShouldHandleCookies = false
        request.timeoutInterval = 30
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            guard body.count <= 6 * 1_048_576 + 8192 else {
                throw XDriveIOSNativeNotesError.tooLarge
            }
            request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
            request.httpBody = body
        }
        if let ifMatch {
            request.setValue(String(ifMatch), forHTTPHeaderField: "If-Match")
        }
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCache = nil
        config.timeoutIntervalForRequest = 30
        let session = URLSession(
            configuration: config,
            delegate: XDriveIOSNativeNotesNoRedirect(),
            delegateQueue: nil
        )
        defer { session.invalidateAndCancel() }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw XDriveIOSNativeNotesError.invalidResponse
        }
        if http.statusCode == 409 {
            throw XDriveIOSNativeNotesError.staleRevision
        }
        guard (200...299).contains(http.statusCode) else {
            throw XDriveIOSNativeNotesError.http(http.statusCode)
        }
        guard data.count <= 2 * 1_048_576 else {
            throw XDriveIOSNativeNotesError.tooLarge
        }
        return (data, http)
    }

    private func decode<T: Decodable>(
        _ type: T.Type, method: String = "GET", path: String,
        query: [URLQueryItem] = [], body: Data? = nil
    ) async throws -> T {
        let (data, _) = try await request(
            method: method, path: path, query: query, body: body
        )
        guard let value = try? JSONDecoder().decode(type, from: data) else {
            throw XDriveIOSNativeNotesError.invalidResponse
        }
        return value
    }

    func initializeNamespace() async throws {
        let result = try await decode(
            XDriveIOSNativeNoteNamespace.self,
            method: "POST", path: "/api/v1/notes/namespace", body: Data("{}".utf8)
        )
        guard result.ios_backup_node_id > 0, result.my_notes_node_id > 0 else {
            throw XDriveIOSNativeNotesError.invalidResponse
        }
    }

    func list(source: XDriveIOSNativeNoteSource, search: String, offset: Int = 0)
        async throws -> XDriveIOSNativeNotePage {
        guard offset >= 0, offset <= 10_000_000, offset % 50 == 0,
              search.utf8.count <= 200 else {
            throw XDriveIOSNativeNotesError.malformedIdentity
        }
        return try await decode(
            XDriveIOSNativeNotePage.self, path: "/api/v1/notes",
            query: [
                URLQueryItem(name: "source", value: source.rawValue),
                URLQueryItem(name: "q", value: search),
                URLQueryItem(name: "offset", value: String(offset))
            ]
        )
    }

    func detail(id: String) async throws -> XDriveIOSNativeNoteDetail {
        let result = try await decode(
            XDriveIOSNativeNoteDetail.self,
            path: "/api/v1/notes/\(noteID(id))"
        )
        guard result.id.lowercased() == id.lowercased(),
              result.bytes >= 0, result.bytes <= 1_048_576,
              Int64(result.markdown.utf8.count) == result.bytes,
              SHA256.hash(data: Data(result.markdown.utf8))
                .map { String(format: "%02x", $0) }.joined() == result.sha256.lowercased(),
              result.source == XDriveIOSNativeNoteSource.mine.rawValue ||
              result.source == XDriveIOSNativeNoteSource.ios_notes.rawValue
        else { throw XDriveIOSNativeNotesError.invalidResponse }
        return result
    }

    func create(title: String, markdown: String) async throws -> XDriveIOSNativeNoteSummary {
        let input = XDriveIOSNativeNoteWrite(
            title: title, markdown: markdown, expected_revision: nil
        )
        return try await decode(
            XDriveIOSNativeNoteSummary.self,
            method: "POST", path: "/api/v1/notes",
            body: try JSONEncoder().encode(input)
        )
    }

    // User-selected .md is a new independent iOS backup. Never synthesize a
    // native Apple Notes identity from the file name or content.
    func importIOSMarkdown(
        title: String, markdown: String, externalID: String? = nil
    ) async throws -> XDriveIOSNativeNoteSummary {
        guard !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              title.utf8.count <= 255, markdown.utf8.count <= 1_048_576,
              !title.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }),
              !markdown.unicodeScalars.contains(where: { $0.value == 0 })
        else { throw XDriveIOSNativeNotesError.tooLarge }
        if let externalID {
            let prefix = "manual-md:"
            guard externalID.hasPrefix(prefix),
                  UUID(uuidString: String(externalID.dropFirst(prefix.count))) != nil,
                  externalID.utf8.count <= 255 else {
                throw XDriveIOSNativeNotesError.malformedIdentity
            }
        }
        let input = XDriveIOSNativeManualNoteImportWrite(
            title: title, markdown: markdown, external_id: externalID
        )
        let note = try await decode(
            XDriveIOSNativeNoteSummary.self,
            method: "POST", path: "/api/v1/notes/ios/import",
            body: try JSONEncoder().encode(input)
        )
        let computed = SHA256.hash(data: Data(markdown.utf8))
            .map { String(format: "%02x", $0) }.joined()
        guard note.source == XDriveIOSNativeNoteSource.ios_notes.rawValue,
              UUID(uuidString: note.id) != nil, note.revision > 0,
              (externalID != nil || note.revision == 1),
              note.title == title, note.bytes == Int64(markdown.utf8.count),
              note.sha256.lowercased() == computed else {
            throw XDriveIOSNativeNotesError.invalidResponse
        }
        return note
    }

    func update(id: String, title: String, markdown: String, revision: UInt64)
        async throws -> XDriveIOSNativeNoteSummary {
        guard revision > 0 else { throw XDriveIOSNativeNotesError.malformedIdentity }
        let input = XDriveIOSNativeNoteWrite(
            title: title, markdown: markdown, expected_revision: revision
        )
        return try await decode(
            XDriveIOSNativeNoteSummary.self,
            method: "PUT", path: "/api/v1/notes/\(noteID(id))",
            body: try JSONEncoder().encode(input)
        )
    }

    func delete(id: String, revision: UInt64) async throws {
        guard revision > 0 else { throw XDriveIOSNativeNotesError.malformedIdentity }
        let (_, response) = try await request(
            method: "DELETE", path: "/api/v1/notes/\(noteID(id))",
            ifMatch: revision
        )
        guard response.statusCode == 204 else {
            throw XDriveIOSNativeNotesError.invalidResponse
        }
    }

    func versions(id: String) async throws -> [XDriveIOSNativeNoteVersion] {
        let page = try await decode(
            XDriveIOSNativeNoteVersionPage.self,
            path: "/api/v1/notes/\(noteID(id))/versions"
        )
        return page.items
    }


    // Binary images use the same verified Owner HTTPS origin and ephemeral
    // no-cookie/no-redirect session as Markdown. Never request a remote URL
    // embedded in Markdown or place credentials in a media link.
    private func imageRequest(
        method: String, path: String,
        body: Data? = nil, contentType: String? = nil
    ) async throws -> (Data, HTTPURLResponse) {
        var request = URLRequest(url: try endpoint(path))
        request.httpMethod = method
        request.httpShouldHandleCookies = false
        request.timeoutInterval = 120
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        request.setValue("image/*", forHTTPHeaderField: "Accept")
        if let body, let contentType {
            guard body.count <= 20 * 1_048_576 + 8_192 else {
                throw XDriveIOSNativeNotesError.tooLarge
            }
            request.setValue(contentType, forHTTPHeaderField: "Content-Type")
            request.httpBody = body
        }
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCache = nil
        config.timeoutIntervalForRequest = 120
        let session = URLSession(
            configuration: config,
            delegate: XDriveIOSNativeNotesNoRedirect(),
            delegateQueue: nil
        )
        defer { session.invalidateAndCancel() }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw XDriveIOSNativeNotesError.invalidResponse
        }
        guard (200...299).contains(http.statusCode) else {
            throw XDriveIOSNativeNotesError.http(http.statusCode)
        }
        guard data.count <= 20 * 1_048_576 else {
            throw XDriveIOSNativeNotesError.tooLarge
        }
        return (data, http)
    }

    private func imageAssetName(_ path: String, noteID: String) throws -> String {
        let ownerID = try self.noteID(noteID)
        let parts = path.split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0] == "_assets",
              parts[1].lowercased() == ownerID else {
            throw XDriveIOSNativeNotesError.malformedIdentity
        }
        let filename = String(parts[2])
        let pieces = filename.split(separator: ".", omittingEmptySubsequences: false)
        guard pieces.count == 2, UUID(uuidString: String(pieces[0])) != nil,
              ["png", "jpg", "gif", "webp", "heic"].contains(String(pieces[1])),
              !path.contains("%"), !path.contains("?"), !path.contains("#") else {
            throw XDriveIOSNativeNotesError.malformedIdentity
        }
        return filename
    }

    func readNoteImage(noteID: String, relativePath: String) async throws -> Data {
        let id = try self.noteID(noteID)
        let filename = try imageAssetName(relativePath, noteID: id)
        let (data, response) = try await imageRequest(
            method: "GET", path: "/api/v1/notes/\(id)/images/\(filename)"
        )
        let type = response.value(forHTTPHeaderField: "Content-Type")?
            .split(separator: ";").first.map(String.init)?.lowercased() ?? ""
        guard data.count > 0,
              ["image/png", "image/jpeg", "image/gif", "image/webp",
               "image/heic"].contains(type) else {
            throw XDriveIOSNativeNotesError.invalidResponse
        }
        return data
    }

    func uploadMyNoteImage(noteID: String, bytes: Data) async throws -> String {
        try await uploadNoteImage(noteID: noteID, bytes: bytes, source: .mine)
    }

    /// An explicit manual-import transaction may append immutable pictures to
    /// an iOS backup. The ordinary Notes editor remains read-only.
    func importIOSNoteImage(noteID: String, bytes: Data) async throws -> String {
        try await uploadNoteImage(noteID: noteID, bytes: bytes, source: .ios_notes)
    }

    private func uploadNoteImage(
        noteID: String, bytes: Data, source: XDriveIOSNativeNoteSource
    ) async throws -> String {
        let id = try self.noteID(noteID)
        guard bytes.count > 0, bytes.count <= 20 * 1_048_576 else {
            throw XDriveIOSNativeNotesError.tooLarge
        }
        let boundary = "xdrive-notes-" + UUID().uuidString.lowercased()
        var multipart = Data(
            ("--\(boundary)\r\n" +
             "Content-Disposition: form-data; name=\"image\"; filename=\"original\"\r\n" +
             "Content-Type: application/octet-stream\r\n\r\n").utf8
        )
        multipart.append(bytes)
        multipart.append(Data("\r\n--\(boundary)--\r\n".utf8))
        let path = source == .mine
            ? "/api/v1/notes/mine/\(id)/images"
            : "/api/v1/notes/ios/images/import/\(id)"
        let (response, http) = try await imageRequest(
            method: "POST", path: path,
            body: multipart, contentType: "multipart/form-data; boundary=\(boundary)"
        )
        guard http.statusCode == 201 else {
            throw XDriveIOSNativeNotesError.invalidResponse
        }
        struct Receipt: Decodable {
            let node_id: UInt64
            let relative_path: String
            let sha256: String
            let bytes: Int64
        }
        guard let result = try? JSONDecoder().decode(Receipt.self, from: response),
              result.node_id > 0, result.bytes == Int64(bytes.count) else {
            throw XDriveIOSNativeNotesError.invalidResponse
        }
        let checksum = SHA256.hash(data: bytes)
            .map { String(format: "%02x", $0) }.joined()
        guard result.sha256.lowercased() == checksum else {
            throw XDriveIOSNativeNotesError.invalidResponse
        }
        _ = try imageAssetName(result.relative_path, noteID: id)
        return result.relative_path
    }

    func previousMarkdown(nodeID: UInt64, versionID: UInt64) async throws -> String {
        guard nodeID > 0, versionID > 0 else {
            throw XDriveIOSNativeNotesError.malformedIdentity
        }
        let (data, _) = try await request(
            method: "GET",
            path: "/api/v1/files/\(nodeID)/versions/\(versionID)/content"
        )
        guard data.count <= 1_048_576,
              let result = String(data: data, encoding: .utf8) else {
            throw XDriveIOSNativeNotesError.invalidResponse
        }
        return result
    }
}
