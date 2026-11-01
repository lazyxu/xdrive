import Combine
import Foundation

enum XDriveIOSNativeFilesMutationFailure: Error {
    case invalidScope
    case staleNode
    case malformedReply
    case server(Int)
}

/// Single current-Owner file rename or trash action. Never use a stale Node
/// revision or replace a failed Server mutation with an optimistic local row.
private struct XDriveIOSNativeFilesMutationTransport {
    let owner: XDriveNativeOwnerRoot
    let accessToken: String

    private final class NoRedirects: NSObject, URLSessionTaskDelegate {
        func urlSession(_ session: URLSession, task: URLSessionTask,
                        willPerformHTTPRedirection response: HTTPURLResponse,
                        newRequest request: URLRequest,
                        completionHandler: @escaping (URLRequest?) -> Void) {
            completionHandler(nil)
        }
    }

    private func makeSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 25
        return URLSession(configuration: config,
                          delegate: NoRedirects(), delegateQueue: nil)
    }

    private func url(_ nodeID: UInt64) throws -> URL {
        guard owner.ownerID > 0, owner.rootNodeID > 0,
              !owner.instanceID.isEmpty, !accessToken.isEmpty,
              nodeID > 0,
              let origin = try? ServerAddress.parse(owner.origin.absoluteString),
              origin == owner.origin,
              var parts = URLComponents(url: origin, resolvingAgainstBaseURL: false),
              parts.scheme == "https" else {
            throw XDriveIOSNativeFilesMutationFailure.invalidScope
        }
        parts.path = "/api/v1/nodes/\(nodeID)"
        guard let u = parts.url else { throw XDriveIOSNativeFilesMutationFailure.invalidScope }
        return u
    }

    private func request(url: URL, method: String, revision: UInt64?,
                         name: String? = nil) throws -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpShouldHandleCookies = false
        request.setValue("Bearer " + accessToken, forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        if let revision {
            request.setValue("\"\(revision)\"", forHTTPHeaderField: "If-Match")
        }
        if let name {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(["name": name])
        }
        return request
    }

    private func checkedResponse(_ response: URLResponse,
                                 accepted: Int) throws {
        guard let http = response as? HTTPURLResponse else {
            throw XDriveIOSNativeFilesMutationFailure.malformedReply
        }
        guard http.statusCode == accepted else {
            throw XDriveIOSNativeFilesMutationFailure.server(http.statusCode)
        }
    }

    private func requireCurrent(_ node: XDriveIOSNativeFilesNode, session: URLSession)
        async throws {
        guard node.id > 0, node.revision > 0, node.parent_id != nil,
              node.type == "file" else {
            throw XDriveIOSNativeFilesMutationFailure.invalidScope
        }
        let (body, response) = try await session.data(for: request(
            url: try url(node.id), method: "GET", revision: nil
        ))
        try Task.checkCancellation()
        try checkedResponse(response, accepted: 200)
        guard body.count <= 65_536,
              let current = try? JSONDecoder().decode(XDriveIOSNativeFilesNode.self, from: body),
              current == node else {
            throw XDriveIOSNativeFilesMutationFailure.staleNode
        }
    }

    func rename(_ node: XDriveIOSNativeFilesNode, to name: String) async throws {
        guard let accepted = XDriveIOSNativeFilesFolderNamePolicy.normalized(name),
              accepted == name, name != node.name else {
            throw XDriveIOSNativeFilesMutationFailure.invalidScope
        }
        let session = makeSession()
        defer { session.invalidateAndCancel() }
        try await requireCurrent(node, session: session)
        try Task.checkCancellation()
        let (bytes, response) = try await session.data(for: request(
            url: try url(node.id), method: "PATCH", revision: node.revision, name: name
        ))
        try Task.checkCancellation()
        try checkedResponse(response, accepted: 200)
        guard bytes.count <= 65_536,
              let renamed = try? JSONDecoder().decode(
                XDriveIOSNativeFilesNode.self, from: bytes
              ),
              renamed.id == node.id,
              renamed.parent_id == node.parent_id,
              renamed.name == name,
              renamed.type == node.type,
              renamed.size == node.size,
              renamed.revision > node.revision else {
            throw XDriveIOSNativeFilesMutationFailure.malformedReply
        }
    }

    func moveToTrash(_ node: XDriveIOSNativeFilesNode) async throws {
        let session = makeSession()
        defer { session.invalidateAndCancel() }
        try await requireCurrent(node, session: session)
        try Task.checkCancellation()
        let (bytes, response) = try await session.data(for: request(
            url: try url(node.id), method: "DELETE", revision: node.revision
        ))
        try Task.checkCancellation()
        try checkedResponse(response, accepted: 204)
        guard bytes.isEmpty else {
            throw XDriveIOSNativeFilesMutationFailure.malformedReply
        }
    }
}

/// Mutation UI status is retired on tab/Owner changes. A lost PATCH or DELETE
/// response is uncertain, not a reason to repeat destructive operations.
@MainActor
final class XDriveIOSNativeFilesMutationModel: ObservableObject {
    @Published private(set) var busy = false
    @Published private(set) var status: String?
    private var epoch = UUID()
    private var running: Task<Void, Never>?

    enum Kind {
        case rename(String)
        case trash
    }

    func invalidate() {
        epoch = UUID()
        running?.cancel()
        running = nil
        busy = false
        status = nil
    }

    func perform(node: XDriveIOSNativeFilesNode, kind: Kind,
                 login: XDriveIOSNativeOwnerLoginModel,
                 onConfirmed: @MainActor @escaping () -> Void) {
        guard !busy, running == nil, let expected = login.owner else {
            status = "当前账户尚未验证，不能修改文件。"
            return
        }
        if case .rename(let name) = kind {
            guard let valid = XDriveIOSNativeFilesFolderNamePolicy.normalized(name),
                  valid == name, name != node.name else {
                status = "新文件名无效或未改变；未发送修改请求。"
                return
            }
        }
        let ticket = UUID()
        epoch = ticket
        busy = true
        status = "正在核对当前文件和版本…"
        running = Task { @MainActor in
            defer {
                if epoch == ticket {
                    running = nil
                    busy = false
                }
            }
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expected),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected) else {
                    throw XDriveIOSNativeFilesMutationFailure.invalidScope
                }
                let transport = XDriveIOSNativeFilesMutationTransport(
                    owner: auth.owner, accessToken: auth.accessToken
                )
                status = "正在向服务器提交带版本校验的文件操作…"
                switch kind {
                case .rename(let name):
                    try await transport.rename(node, to: name)
                case .trash:
                    try await transport.moveToTrash(node)
                }
                try Task.checkCancellation()
                let verified = try await login.verifiedAuthorization()
                guard epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(verified.owner, expected),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected) else {
                    return
                }
                status = "服务器已确认文件操作，正在刷新文件列表。"
                onConfirmed()
            } catch is CancellationError {
                if epoch == ticket {
                    status = "文件操作已取消。如请求已发出，请刷新核对，不要重复操作。"
                }
            } catch {
                guard epoch == ticket else { return }
                if let failure = error as? XDriveIOSNativeFilesMutationFailure {
                    switch failure {
                    case .server(409), .server(412), .staleNode:
                        status = "文件已被修改或同名冲突；请刷新后重新选择。"
                    case .server(401), .server(403), .server(404), .invalidScope:
                        status = "文件访问权限或账户已变化；请重新验证。"
                    default:
                        status = "文件操作结果未确认，请刷新核对后再操作。"
                    }
                } else {
                    status = "文件操作结果未确认，请刷新核对后再操作。"
                }
            }
        }
    }
}
