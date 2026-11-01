import Combine
import Foundation
import SwiftUI

private enum XDriveIOSNativeFilesLocateFailure: Error {
    case ownerChanged
    case nodeChanged
    case invalidLocation
    case server(Int)
}

private final class XDriveIOSNativeFilesLocateNoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// Re-read the selected Node on both sides of the Server-authoritative
/// location projection; only its exact current parent becomes a route.
private struct XDriveIOSNativeFilesLocateReader {
    let owner: XDriveNativeOwnerRoot
    let accessToken: String

    private func endpoint(_ path: String, query: [URLQueryItem] = []) throws -> URL {
        guard owner.ownerID > 0, owner.rootNodeID > 0, !owner.instanceID.isEmpty,
              !accessToken.isEmpty, path.hasPrefix("/api/v1/nodes/"),
              !path.contains("?"), !path.contains("#"),
              let origin = try? ServerAddress.parse(owner.origin.absoluteString),
              origin == owner.origin,
              var components = URLComponents(url: origin, resolvingAgainstBaseURL: false),
              components.scheme == "https" else {
            throw XDriveIOSNativeFilesLocateFailure.ownerChanged
        }
        components.path = path
        components.queryItems = query.isEmpty ? nil : query
        guard let url = components.url else {
            throw XDriveIOSNativeFilesLocateFailure.ownerChanged
        }
        return url
    }

    private func read<T: Decodable>(
        _ path: String, maximumBytes: Int, query: [URLQueryItem] = []
    ) async throws -> T {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCache = nil
        config.timeoutIntervalForRequest = 25
        let client = URLSession(configuration: config,
            delegate: XDriveIOSNativeFilesLocateNoRedirects(), delegateQueue: nil)
        defer { client.invalidateAndCancel() }
        var request = URLRequest(url: try endpoint(path, query: query))
        request.httpMethod = "GET"
        request.httpShouldHandleCookies = false
        request.setValue("Bearer " + accessToken, forHTTPHeaderField: "Authorization")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await client.data(for: request)
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse else {
            throw XDriveIOSNativeFilesLocateFailure.invalidLocation
        }
        guard http.statusCode == 200 else {
            throw XDriveIOSNativeFilesLocateFailure.server(http.statusCode)
        }
        guard data.count <= maximumBytes,
              let result = try? JSONDecoder().decode(T.self, from: data) else {
            throw XDriveIOSNativeFilesLocateFailure.invalidLocation
        }
        return result
    }

    func locate(_ selected: XDriveIOSNativeFilesNode) async throws
        -> XDriveIOSNativeFilesLocatedPage {
        guard selected.id > 0, selected.revision > 0,
              selected.parent_id != nil else {
            throw XDriveIOSNativeFilesLocateFailure.nodeChanged
        }
        let before: XDriveIOSNativeFilesNode = try await read(
            "/api/v1/nodes/\(selected.id)", maximumBytes: 65_536
        )
        guard before == selected else {
            throw XDriveIOSNativeFilesLocateFailure.nodeChanged
        }
        let location: XDriveIOSNativeFilesLocationDTO = try await read(
            "/api/v1/nodes/\(selected.id)/location", maximumBytes: 2 * 1_048_576
        )
        guard let parent = XDriveIOSNativeFilesLocationPolicy.parent(
            of: selected, at: location, ownerRootID: owner.rootNodeID
        ) else { throw XDriveIOSNativeFilesLocateFailure.invalidLocation }
        let position: XDriveIOSNativeFilesPositionDTO = try await read(
            "/api/v1/nodes/\(parent.id)/children/position",
            maximumBytes: 65_536,
            query: [
                URLQueryItem(name: "node_id", value: String(selected.id)),
                URLQueryItem(name: "sort", value: "name"),
                URLQueryItem(name: "order", value: "asc")
            ]
        )
        guard let offset = XDriveIOSNativeFilesLocationPolicy.pageOffset(
            of: selected, position: position
        ) else { throw XDriveIOSNativeFilesLocateFailure.invalidLocation }
        try Task.checkCancellation()
        let after: XDriveIOSNativeFilesNode = try await read(
            "/api/v1/nodes/\(selected.id)", maximumBytes: 65_536
        )
        guard after == selected else {
            throw XDriveIOSNativeFilesLocateFailure.nodeChanged
        }
        return XDriveIOSNativeFilesLocatedPage(folder: parent, offset: offset)
    }
}

@MainActor
private final class XDriveIOSNativeFilesLocateModel: ObservableObject {
    @Published private(set) var target: XDriveIOSNativeFilesLocatedPage?
    @Published private(set) var loading = false
    @Published private(set) var error: String?
    private var generation = UUID()
    private var job: Task<Void, Never>?

    func invalidate() {
        generation = UUID()
        job?.cancel()
        job = nil
        target = nil
        loading = false
        error = nil
    }

    func load(login: XDriveIOSNativeOwnerLoginModel,
              selected: XDriveIOSNativeFilesNode,
              expectedOwner: XDriveNativeOwnerRoot) {
        invalidate()
        guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner) else {
            error = "服务器或账户已变化，请返回搜索结果。"
            return
        }
        let ticket = generation
        loading = true
        job = Task { @MainActor in
            defer {
                if generation == ticket {
                    loading = false
                    job = nil
                }
            }
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expectedOwner),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner)
                else { throw XDriveIOSNativeFilesLocateFailure.ownerChanged }
                let folder = try await XDriveIOSNativeFilesLocateReader(
                    owner: auth.owner, accessToken: auth.accessToken
                ).locate(selected)
                try Task.checkCancellation()
                guard generation == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner)
                else { return }
                target = folder
                error = nil
            } catch is CancellationError {
            } catch {
                guard generation == ticket else { return }
                target = nil
                if let failure = error as? XDriveIOSNativeFilesLocateFailure {
                    switch failure {
                    case .nodeChanged, .server(404), .invalidLocation:
                        self.error = "文件版本或所在目录已变化，请返回搜索结果刷新。"
                    case .ownerChanged, .server(401), .server(403):
                        self.error = "账户访问已变化，请重新验证。"
                    default:
                        self.error = "无法定位该文件，请检查网络后重试。"
                    }
                } else {
                    self.error = "读取文件所在位置失败，请重试。"
                }
            }
        }
    }
}

/// Search-origin-owned native subroute. Its verified folder continues using
/// the ONE existing SwiftUI Files browser; never guesses a path from search.
struct XDriveIOSNativeFilesLocateScreen: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let selected: XDriveIOSNativeFilesNode
    let openedOwner: XDriveNativeOwnerRoot

    @Environment(\.dismiss) private var dismiss
    @StateObject private var model = XDriveIOSNativeFilesLocateModel()
    @State private var started = false

    var body: some View {
        Group {
            if let target = model.target,
               XDriveIOSNativePhotoOwnerScope.matches(login.owner, openedOwner) {
                if target.folder.id == openedOwner.rootNodeID {
                    XDriveIOSNativeFilesBrowser(
                        login: login, initialOffset: target.offset, focus: selected
                    )
                } else {
                    XDriveIOSNativeFilesBrowser(
                        login: login, folderID: target.folder.id,
                        folderName: target.folder.name,
                        initialOffset: target.offset, focus: selected
                    )
                }
            } else if model.loading {
                ProgressView("正在验证文件的真实位置…")
            } else {
                VStack(spacing: 16) {
                    Text(model.error ?? "尚未验证文件位置。")
                        .multilineTextAlignment(.center)
                    Button("重试定位") {
                        model.load(login: login, selected: selected, expectedOwner: openedOwner)
                    }
                    .disabled(!XDriveIOSNativePhotoOwnerScope.matches(login.owner, openedOwner))
                    .accessibilityIdentifier("native-ios-files-locate-retry")
                }
                .padding(24)
            }
        }
        .navigationTitle("所在文件夹")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("关闭") { dismiss() }
            }
        }
        .onAppear {
            guard !started else { return }
            started = true
            model.load(login: login, selected: selected, expectedOwner: openedOwner)
        }
        .onDisappear { model.invalidate() }
        .onChange(of: login.owner) { _ in
            model.invalidate()
        }
    }
}
