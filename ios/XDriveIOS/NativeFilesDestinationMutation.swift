import Combine
import Foundation

enum XDriveIOSNativeFilesDestinationFailure: Error {
    case invalidScope
    case sourceChanged
    case destinationChanged
    case malformedReceipt
    case server(Int)
}

/// A one-shot, Owner-authenticated transport for a selected file's copy/move.
/// It never schedules a background task, assumes successful writes, or replays
/// a POST/PATCH after an uncertain network ACK.
private struct XDriveIOSNativeFilesDestinationWriter {
    let owner: XDriveNativeOwnerRoot
    let accessToken: String

    private final class DenyRedirects: NSObject, URLSessionTaskDelegate {
        func urlSession(_ session: URLSession, task: URLSessionTask,
                        willPerformHTTPRedirection response: HTTPURLResponse,
                        newRequest request: URLRequest,
                        completionHandler: @escaping (URLRequest?) -> Void) {
            completionHandler(nil)
        }
    }

    private func session() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 25
        return URLSession(configuration: config,
                          delegate: DenyRedirects(), delegateQueue: nil)
    }

    private func endpoint(_ path: String) throws -> URL {
        guard owner.ownerID > 0, owner.rootNodeID > 0,
              !owner.instanceID.isEmpty, !accessToken.isEmpty,
              let origin = try? ServerAddress.parse(owner.origin.absoluteString),
              origin == owner.origin, path.hasPrefix("/api/v1/"),
              !path.contains("?"), !path.contains("#"),
              var components = URLComponents(url: origin, resolvingAgainstBaseURL: false),
              components.scheme == "https" else {
            throw XDriveIOSNativeFilesDestinationFailure.invalidScope
        }
        components.path = path
        components.query = nil
        guard let url = components.url else {
            throw XDriveIOSNativeFilesDestinationFailure.invalidScope
        }
        return url
    }

    private func request(_ url: URL, method: String, body: Data? = nil,
                         revision: UInt64? = nil) -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpShouldHandleCookies = false
        request.setValue("Bearer " + accessToken, forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        if let revision {
            request.setValue("\"\(revision)\"", forHTTPHeaderField: "If-Match")
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body
        }
        return request
    }

    private func response(_ url: URL, session: URLSession,
                          method: String = "GET", body: Data? = nil,
                          revision: UInt64? = nil,
                          accepted: Int) async throws -> Data {
        let (data, result) = try await session.data(
            for: request(url, method: method, body: body, revision: revision)
        )
        try Task.checkCancellation()
        guard let http = result as? HTTPURLResponse else {
            throw XDriveIOSNativeFilesDestinationFailure.malformedReceipt
        }
        guard http.statusCode == accepted else {
            throw XDriveIOSNativeFilesDestinationFailure.server(http.statusCode)
        }
        guard data.count <= 65_536 else {
            throw XDriveIOSNativeFilesDestinationFailure.malformedReceipt
        }
        return data
    }

    private func readNode(_ id: UInt64, session: URLSession) async throws
        -> XDriveIOSNativeFilesNode {
        guard id > 0 else { throw XDriveIOSNativeFilesDestinationFailure.invalidScope }
        let data = try await response(
            endpoint("/api/v1/nodes/\(id)"), session: session, accepted: 200
        )
        guard let result = try? JSONDecoder().decode(XDriveIOSNativeFilesNode.self, from: data),
              result.id == id else {
            throw XDriveIOSNativeFilesDestinationFailure.malformedReceipt
        }
        return result
    }

    func perform(_ kind: XDriveIOSNativeFilesDestinationKind,
                 original: XDriveIOSNativeFilesNode,
                 destination: XDriveIOSNativeFilesDestination) async throws {
        guard original.id > 0, original.revision > 0,
              original.parent_id != nil, original.type == "file",
              destination.id > 0,
              kind != .move || original.parent_id != destination.id
        else { throw XDriveIOSNativeFilesDestinationFailure.invalidScope }
        let client = session()
        defer { client.invalidateAndCancel() }

        let source = try await readNode(original.id, session: client)
        guard source == original else {
            throw XDriveIOSNativeFilesDestinationFailure.sourceChanged
        }
        let target = try await readNode(destination.id, session: client)
        guard target.id == destination.id, target.type == "dir",
              target.revision > 0,
              (destination.id == owner.rootNodeID
                ? target.parent_id == nil
                : target.parent_id != nil && target.name == destination.name)
        else { throw XDriveIOSNativeFilesDestinationFailure.destinationChanged }
        try Task.checkCancellation()

        let created: XDriveIOSNativeFilesNode
        switch kind {
        case .copy:
            let bytes = try await response(
                endpoint("/api/v1/nodes/\(original.id)/copy"),
                session: client, method: "POST",
                body: JSONEncoder().encode(["parent_id": destination.id]),
                accepted: 201
            )
            guard let result = try? JSONDecoder().decode(
                XDriveIOSNativeFilesNode.self, from: bytes
            ),
            XDriveIOSNativeFilesDestinationReceiptPolicy.copied(
                original: original, result: result, targetID: destination.id
            ) else {
                throw XDriveIOSNativeFilesDestinationFailure.malformedReceipt
            }
            created = result
        case .move:
            let bytes = try await response(
                endpoint("/api/v1/nodes/\(original.id)"),
                session: client, method: "PATCH",
                body: JSONEncoder().encode(["parent_id": destination.id]),
                revision: original.revision, accepted: 200
            )
            guard let result = try? JSONDecoder().decode(
                XDriveIOSNativeFilesNode.self, from: bytes
            ),
            XDriveIOSNativeFilesDestinationReceiptPolicy.moved(
                original: original, result: result, targetID: destination.id
            ) else {
                throw XDriveIOSNativeFilesDestinationFailure.malformedReceipt
            }
            created = result
        }

        // A server response alone must not synthesize a new local file. The
        // exact committed Node must be visible to the current Owner on GET.
        let saved = try await readNode(created.id, session: client)
        guard saved == created else {
            throw XDriveIOSNativeFilesDestinationFailure.malformedReceipt
        }
        if kind == .copy {
            // The canonical copy endpoint has no If-Match parameter. Verify
            // that the source still has the precise selected version after
            // the copy; otherwise report an uncertain result, never success.
            let unchangedSource = try await readNode(original.id, session: client)
            guard unchangedSource == original else {
                throw XDriveIOSNativeFilesDestinationFailure.sourceChanged
            }
        }
    }
}

/// Native Files never claims a successful copy/move until an exact Server
/// receipt and current Owner/root verification have completed.
@MainActor
final class XDriveIOSNativeFilesDestinationMutationModel: ObservableObject {
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

    func perform(
        _ kind: XDriveIOSNativeFilesDestinationKind,
        original: XDriveIOSNativeFilesNode,
        destination: XDriveIOSNativeFilesDestination,
        login: XDriveIOSNativeOwnerLoginModel,
        onConfirmed: @MainActor @escaping () -> Void
    ) {
        guard !busy, running == nil, let expected = login.owner else {
            status = "当前账户或文件操作状态不可用；请重新验证。"
            return
        }
        let ticket = UUID()
        epoch = ticket
        busy = true
        status = "正在确认文件和目标目录的权限…"
        running = Task { @MainActor in
            defer {
                if epoch == ticket { busy = false; running = nil }
            }
            do {
                let credentials = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(
                        credentials.owner, expected
                      ), XDriveIOSNativePhotoOwnerScope.matches(
                        login.owner, expected
                      ) else {
                    throw XDriveIOSNativeFilesDestinationFailure.invalidScope
                }
                try await XDriveIOSNativeFilesDestinationWriter(
                    owner: credentials.owner, accessToken: credentials.accessToken
                ).perform(kind, original: original, destination: destination)
                try Task.checkCancellation()
                let after = try await login.verifiedAuthorization()
                guard epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(after.owner, expected),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { return }
                status = kind == .copy
                    ? "服务器已确认复制结果，正在刷新文件列表。"
                    : "服务器已确认移动结果，正在刷新文件列表。"
                onConfirmed()
            } catch is CancellationError {
                if epoch == ticket {
                    status = "操作已取消。若请求已发出，请刷新核对结果，不要直接重试。"
                }
            } catch {
                guard epoch == ticket else { return }
                if let failure = error as? XDriveIOSNativeFilesDestinationFailure {
                    switch failure {
                    case .server(409), .server(412), .sourceChanged,
                         .destinationChanged:
                        status = "源文件已变化或目标冲突，请刷新目录后重新选择。"
                    case .server(401), .server(403), .server(404), .invalidScope:
                        status = "账户或目标目录授权已变化，请重新验证。"
                    default:
                        status = "复制或移动结果未确认，请先核对云端，不要盲目重复操作。"
                    }
                } else {
                    status = "复制或移动结果未确认，请先核对云端，不要盲目重复操作。"
                }
            }
        }
    }
}
