import Combine
import Foundation

private enum XDriveIOSNativeFilesQuickAccessFailure: Error {
    case invalidOwner, invalidInput, malformed, uncertain, server(Int)
}

private final class XDriveIOSNativeFilesQuickAccessNoRedirect:
    XDriveIOSServerTLSDelegate, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// Uses the same four Go /file-quick-access routes as PWA; no client-owned
/// directory ordering, no new Server writer and no repeated uncertain PUT.
struct XDriveIOSNativeFilesQuickAccessClient {
    let owner: XDriveNativeOwnerRoot
    let accessToken: String

    enum Action {
        case pin(XDriveIOSNativeFilesNode)
        case unpin(UInt64)
        case reorder([UInt64])
        case toggle(XDriveIOSNativeFilesNode)
    }

    private func session() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCache = nil
        config.timeoutIntervalForRequest = 25
        return URLSession(configuration: config,
                          delegate: XDriveIOSNativeFilesQuickAccessNoRedirect(),
                          delegateQueue: nil)
    }

    private func request(_ path: String, method: String = "GET",
                         body: Data? = nil) throws -> URLRequest {
        let base = "/api/v1/file-quick-access"
        let pieces = path.split(separator: "/")
        guard path == base || path == base + "/order" ||
              (path.hasPrefix(base + "/") && pieces.count == 4 &&
               UInt64(pieces[3]).map({ $0 > 0 }) == true),
              owner.ownerID > 0, owner.rootNodeID > 0,
              !owner.instanceID.isEmpty, !accessToken.isEmpty,
              let origin = try? ServerAddress.parse(owner.origin.absoluteString),
              origin == owner.origin,
              var parts = URLComponents(url: origin, resolvingAgainstBaseURL: false),
              parts.scheme == "https" else {
            throw XDriveIOSNativeFilesQuickAccessFailure.invalidOwner
        }
        parts.path = path
        parts.queryItems = nil
        parts.fragment = nil
        guard let url = parts.url else {
            throw XDriveIOSNativeFilesQuickAccessFailure.invalidInput
        }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.httpShouldHandleCookies = false
        req.setValue("Bearer " + accessToken, forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = body
        }
        return req
    }

    private func send(_ req: URLRequest, accepted: [Int],
                      in session: URLSession) async throws -> (Int, Data) {
        let (data, response) = try await session.data(for: req)
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse else {
            throw XDriveIOSNativeFilesQuickAccessFailure.uncertain
        }
        guard accepted.contains(http.statusCode) else {
            throw XDriveIOSNativeFilesQuickAccessFailure.server(http.statusCode)
        }
        guard data.count <= 524_288,
              !data.isEmpty || http.statusCode == 204 else {
            throw XDriveIOSNativeFilesQuickAccessFailure.malformed
        }
        return (http.statusCode, data)
    }

    private func list(in session: URLSession) async throws
        -> [XDriveIOSNativeFilesQuickAccessItem] {
        let (_, data) = try await send(
            request("/api/v1/file-quick-access"),
            accepted: [200], in: session
        )
        guard let items = try? JSONDecoder().decode(
            [XDriveIOSNativeFilesQuickAccessItem].self, from: data
        ), XDriveIOSNativeFilesQuickAccessPolicy.validList(items) else {
            throw XDriveIOSNativeFilesQuickAccessFailure.malformed
        }
        return items
    }

    func list() async throws -> [XDriveIOSNativeFilesQuickAccessItem] {
        let client = session()
        defer { client.invalidateAndCancel() }
        return try await list(in: client)
    }

    func perform(_ action: Action,
                 previous: [XDriveIOSNativeFilesQuickAccessItem]) async throws
        -> [XDriveIOSNativeFilesQuickAccessItem] {
        guard XDriveIOSNativeFilesQuickAccessPolicy.validList(previous) else {
            throw XDriveIOSNativeFilesQuickAccessFailure.invalidInput
        }
        if case .toggle(let folder) = action {
            guard XDriveIOSNativeFilesQuickAccessPolicy.canPin(folder) else {
                throw XDriveIOSNativeFilesQuickAccessFailure.invalidInput
            }
            return try await perform(
                previous.contains(where: { $0.id == folder.id })
                    ? .unpin(folder.id) : .pin(folder),
                previous: previous
            )
        }
        let client = session()
        defer { client.invalidateAndCancel() }
        switch action {
        case .toggle:
            throw XDriveIOSNativeFilesQuickAccessFailure.invalidInput
        case .pin(let folder):
            guard XDriveIOSNativeFilesQuickAccessPolicy.canPin(folder),
                  !previous.contains(where: { $0.id == folder.id }),
                  previous.count < XDriveIOSNativeFilesQuickAccessPolicy.maximumItems else {
                throw XDriveIOSNativeFilesQuickAccessFailure.invalidInput
            }
            let (_, data) = try await send(
                request("/api/v1/file-quick-access/\(folder.id)", method: "PUT"),
                accepted: [200, 201], in: client
            )
            guard let receipt = try? JSONDecoder().decode(
                XDriveIOSNativeFilesQuickAccessItem.self, from: data
            ), XDriveIOSNativeFilesQuickAccessPolicy.valid(receipt),
                receipt.id == folder.id else {
                throw XDriveIOSNativeFilesQuickAccessFailure.uncertain
            }
            let next = try await list(in: client)
            guard next.contains(where: { $0.id == folder.id }) else {
                throw XDriveIOSNativeFilesQuickAccessFailure.uncertain
            }
            return next
        case .unpin(let id):
            guard previous.contains(where: { $0.id == id }) else {
                throw XDriveIOSNativeFilesQuickAccessFailure.invalidInput
            }
            _ = try await send(
                request("/api/v1/file-quick-access/\(id)", method: "DELETE"),
                accepted: [204], in: client
            )
            let next = try await list(in: client)
            guard !next.contains(where: { $0.id == id }) else {
                throw XDriveIOSNativeFilesQuickAccessFailure.uncertain
            }
            return next
        case .reorder(let ids):
            guard XDriveIOSNativeFilesQuickAccessPolicy.canReorder(
                ids, items: previous
            ) else { throw XDriveIOSNativeFilesQuickAccessFailure.invalidInput }
            _ = try await send(
                request("/api/v1/file-quick-access/order", method: "PUT",
                        body: try JSONEncoder().encode(["node_ids": ids])),
                accepted: [204], in: client
            )
            let next = try await list(in: client)
            guard next.map(\.id) == ids else {
                throw XDriveIOSNativeFilesQuickAccessFailure.uncertain
            }
            return next
        }
    }
}

@MainActor
final class XDriveIOSNativeFilesQuickAccessModel: ObservableObject {
    // Same Owner-scoped read model across the Home Browser and child pages.
    // A child pin/unpin updates the Home list without a stale second cache.
    static let shared = XDriveIOSNativeFilesQuickAccessModel()
    @Published private(set) var items: [XDriveIOSNativeFilesQuickAccessItem] = []
    @Published private(set) var verified = false
    @Published private(set) var loading = false
    @Published private(set) var busy = false
    @Published private(set) var status: String?

    private var loadedOwner: XDriveNativeOwnerRoot?
    private var epoch = UUID()
    private var job: Task<Void, Never>?

    func matches(_ current: XDriveNativeOwnerRoot?) -> Bool {
        guard let current, let loadedOwner else { return false }
        return verified && XDriveIOSNativePhotoOwnerScope.matches(
            current, loadedOwner
        )
    }

    func invalidate() {
        epoch = UUID()
        job?.cancel()
        job = nil
        items = []
        verified = false
        loading = false
        busy = false
        status = nil
        loadedOwner = nil
    }

    func load(login: XDriveIOSNativeOwnerLoginModel, force: Bool = false) {
        guard !loading, !busy, let expected = login.owner else { return }
        if matches(expected) && !force { return }
        // Preserve same-Owner verified entries while revalidating, so the
        // Browse home never flashes an empty shortcut section on return.
        if let previous = loadedOwner,
           !XDriveIOSNativePhotoOwnerScope.matches(previous, expected) {
            invalidate()
        }
        loadedOwner = expected
        let ticket = UUID()
        epoch = ticket
        loading = true
        job = Task { @MainActor [weak self] in
            defer {
                if let self, self.epoch == ticket {
                    self.loading = false
                    self.job = nil
                }
            }
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expected)
                else { throw XDriveIOSNativeFilesQuickAccessFailure.invalidOwner }
                let next = try await XDriveIOSNativeFilesQuickAccessClient(
                    owner: auth.owner, accessToken: auth.accessToken
                ).list()
                try Task.checkCancellation()
                guard let self, self.epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { return }
                self.items = next
                self.verified = true
                self.status = nil
            } catch is CancellationError {
            } catch {
                guard let self, self.epoch == ticket else { return }
                self.items = []
                self.verified = false
                self.status = "无法验证快捷目录，请检查网络后重试。"
            }
        }
    }

    func perform(_ action: XDriveIOSNativeFilesQuickAccessClient.Action,
                 login: XDriveIOSNativeOwnerLoginModel) {
        guard !loading, !busy, let expected = login.owner else { return }
        if let previous = loadedOwner,
           !XDriveIOSNativePhotoOwnerScope.matches(expected, previous) {
            invalidate()
        }
        loadedOwner = expected
        let previousItems = items
        let trustedPrevious = matches(expected)
        let ticket = UUID()
        epoch = ticket
        busy = true
        status = nil
        job = Task { @MainActor [weak self] in
            defer {
                if let self, self.epoch == ticket {
                    self.busy = false
                    self.job = nil
                }
            }
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expected)
                else { throw XDriveIOSNativeFilesQuickAccessFailure.invalidOwner }
                let client = XDriveIOSNativeFilesQuickAccessClient(
                    owner: auth.owner, accessToken: auth.accessToken
                )
                let before: [XDriveIOSNativeFilesQuickAccessItem]
                if trustedPrevious {
                    before = previousItems
                } else {
                    before = try await client.list()
                }
                let after = try await client.perform(action, previous: before)
                try Task.checkCancellation()
                guard let self, self.epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { return }
                self.items = after
                self.verified = true
                self.status = "快捷目录已按服务器记录更新。"
            } catch is CancellationError {
            } catch {
                guard let self, self.epoch == ticket else { return }
                self.verified = false
                self.status = "快捷目录操作结果未确认，请刷新核对，不要直接重试。"
            }
        }
    }

    func pin(_ folder: XDriveIOSNativeFilesNode,
             login: XDriveIOSNativeOwnerLoginModel) {
        guard XDriveIOSNativeFilesQuickAccessPolicy.canPin(folder) else { return }
        perform(.pin(folder), login: login)
    }

    func togglePin(_ folder: XDriveIOSNativeFilesNode,
                   login: XDriveIOSNativeOwnerLoginModel) {
        guard XDriveIOSNativeFilesQuickAccessPolicy.canPin(folder) else { return }
        perform(.toggle(folder), login: login)
    }

    func unpin(_ id: UInt64, login: XDriveIOSNativeOwnerLoginModel) {
        perform(.unpin(id), login: login)
    }

    func reorder(_ ids: [UInt64], login: XDriveIOSNativeOwnerLoginModel) {
        perform(.reorder(ids), login: login)
    }
}
