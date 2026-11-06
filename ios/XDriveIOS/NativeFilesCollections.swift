import Combine
import Foundation
import SwiftUI

enum XDriveIOSNativeFilesCollectionFailure: Error {
    case invalidOwner
    case staleNode
    case malformed
    case server(Int)
}

private final class XDriveIOSNativeFilesCollectionNoRedirects:
    XDriveIOSServerTLSDelegate, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// Use the existing Server Owner file collection APIs. No WebKit or parallel
/// CAS/file metadata writer is created. The favorite list is bounded to 256,
/// recent to 50, both verified on every read.
struct XDriveIOSNativeFilesCollectionsTransport {
    let owner: XDriveNativeOwnerRoot
    let accessToken: String

    private func session() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCache = nil
        config.timeoutIntervalForRequest = 25
        return URLSession(configuration: config,
                          delegate: XDriveIOSNativeFilesCollectionNoRedirects(),
                          delegateQueue: nil)
    }

    private func request(_ path: String, method: String = "GET",
                         query: [URLQueryItem] = []) throws -> URLRequest {
        guard owner.ownerID > 0, owner.rootNodeID > 0,
              !owner.instanceID.isEmpty, !accessToken.isEmpty,
              path == "/api/v1/file-recent" || path == "/api/v1/file-favorites" ||
                  path.hasPrefix("/api/v1/file-recent/") ||
                  path.hasPrefix("/api/v1/file-favorites/") ||
                  path.hasPrefix("/api/v1/nodes/"),
              let origin = try? ServerAddress.parse(owner.origin.absoluteString),
              origin == owner.origin,
              var components = URLComponents(url: origin, resolvingAgainstBaseURL: false),
              components.scheme == "https" else {
            throw XDriveIOSNativeFilesCollectionFailure.invalidOwner
        }
        components.path = path
        components.queryItems = query.isEmpty ? nil : query
        guard let url = components.url else {
            throw XDriveIOSNativeFilesCollectionFailure.invalidOwner
        }
        var result = URLRequest(url: url)
        result.httpMethod = method
        result.httpShouldHandleCookies = false
        result.setValue("Bearer " + accessToken, forHTTPHeaderField: "Authorization")
        result.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        result.setValue("application/json", forHTTPHeaderField: "Accept")
        return result
    }

    private func send(_ request: URLRequest, in client: URLSession,
                      accepted: Set<Int>, maximumBytes: Int) async throws -> Data {
        let (data, reply) = try await client.data(for: request)
        try Task.checkCancellation()
        guard let http = reply as? HTTPURLResponse else {
            throw XDriveIOSNativeFilesCollectionFailure.malformed
        }
        guard accepted.contains(http.statusCode) else {
            throw XDriveIOSNativeFilesCollectionFailure.server(http.statusCode)
        }
        guard data.count <= maximumBytes else {
            throw XDriveIOSNativeFilesCollectionFailure.malformed
        }
        return data
    }

    private func list(_ kind: XDriveIOSNativeFilesCollectionKind,
                      in client: URLSession) async throws
        -> [XDriveIOSNativeFilesCollectionItem] {
        let path = kind == .recent ? "/api/v1/file-recent" : "/api/v1/file-favorites"
        let query = kind == .recent ? [
            URLQueryItem(name: "limit", value: String(kind.maximumItems))
        ] : []
        let bytes = try await send(
            request(path, query: query), in: client,
            accepted: [200], maximumBytes: 2 * 1_048_576
        )
        guard let items = try? JSONDecoder().decode(
            [XDriveIOSNativeFilesCollectionItem].self, from: bytes
        ), XDriveIOSNativeFilesCollectionsPolicy.validItems(items, kind: kind) else {
            throw XDriveIOSNativeFilesCollectionFailure.malformed
        }
        return items
    }

    func list(_ kind: XDriveIOSNativeFilesCollectionKind) async throws
        -> [XDriveIOSNativeFilesCollectionItem] {
        let client = session()
        defer { client.invalidateAndCancel() }
        return try await list(kind, in: client)
    }

    /// Owner-only, metadata-only clear; a 204 requires empty list readback.
    func clearRecent() async throws {
        let client = session()
        defer { client.invalidateAndCancel() }
        let bytes = try await send(
            request("/api/v1/file-recent", method: "DELETE"),
            in: client, accepted: [204], maximumBytes: 0
        )
        guard bytes.isEmpty else {
            throw XDriveIOSNativeFilesCollectionFailure.malformed
        }
        let remaining = try await list(.recent, in: client)
        guard remaining.isEmpty else {
            throw XDriveIOSNativeFilesCollectionFailure.malformed
        }
    }

    private func requireCurrent(_ node: XDriveIOSNativeFilesNode,
                                client: URLSession) async throws {
        guard node.id > 0, node.parent_id != nil, node.revision > 0,
              (node.type == "file" || node.type == "dir") else {
            throw XDriveIOSNativeFilesCollectionFailure.staleNode
        }
        let data = try await send(
            request("/api/v1/nodes/\(node.id)"), in: client,
            accepted: [200], maximumBytes: 65_536
        )
        guard let current = try? JSONDecoder().decode(
            XDriveIOSNativeFilesNode.self, from: data
        ), current == node else {
            throw XDriveIOSNativeFilesCollectionFailure.staleNode
        }
    }

    func addFavorite(_ node: XDriveIOSNativeFilesNode) async throws {
        let client = session()
        defer { client.invalidateAndCancel() }
        try await requireCurrent(node, client: client)
        let bytes = try await send(
            request("/api/v1/file-favorites/\(node.id)", method: "PUT"),
            in: client, accepted: [200, 201], maximumBytes: 65_536
        )
        guard let favorite = try? JSONDecoder().decode(
            XDriveIOSNativeFilesCollectionItem.self, from: bytes
        ), favorite.node == node,
           XDriveIOSNativeFilesCollectionsPolicy.validItem(favorite, kind: .favorites) else {
            throw XDriveIOSNativeFilesCollectionFailure.malformed
        }
    }

    func removeFavorite(_ selected: XDriveIOSNativeFilesCollectionItem) async throws {
        guard XDriveIOSNativeFilesCollectionsPolicy.validItem(selected, kind: .favorites)
        else { throw XDriveIOSNativeFilesCollectionFailure.staleNode }
        let client = session()
        defer { client.invalidateAndCancel() }
        let before = try await list(.favorites, in: client)
        guard before.contains(selected) else {
            throw XDriveIOSNativeFilesCollectionFailure.staleNode
        }
        try Task.checkCancellation()
        let bytes = try await send(
            request("/api/v1/file-favorites/\(selected.id)", method: "DELETE"),
            in: client, accepted: [204], maximumBytes: 0
        )
        guard bytes.isEmpty else {
            throw XDriveIOSNativeFilesCollectionFailure.malformed
        }
        let after = try await list(.favorites, in: client)
        guard !after.contains(where: { $0.id == selected.id }) else {
            throw XDriveIOSNativeFilesCollectionFailure.malformed
        }
    }

    /// Best-effort metadata only. Called AFTER a verified native Viewer
    /// successfully loads a file; never delay media or report a false receipt.
    func touchViewed(_ node: XDriveIOSNativeFilesNode) async throws {
        guard node.id > 0, node.parent_id != nil, node.revision > 0,
              node.type == "file" else { return }
        let client = session()
        defer { client.invalidateAndCancel() }
        let bytes = try await send(
            request("/api/v1/file-recent/\(node.id)", method: "POST"),
            in: client, accepted: [200], maximumBytes: 65_536
        )
        guard let touched = try? JSONDecoder().decode(
            XDriveIOSNativeFilesCollectionItem.self, from: bytes
        ), touched.id == node.id,
           XDriveIOSNativeFilesCollectionsPolicy.validItem(touched, kind: .recent) else {
            throw XDriveIOSNativeFilesCollectionFailure.malformed
        }
    }
}

@MainActor
enum XDriveIOSNativeFilesRecentRecorder {
    static func recordLoadedPreview(_ node: XDriveIOSNativeFilesNode,
                                    owner: XDriveNativeOwnerRoot,
                                    accessToken: String,
                                    login: XDriveIOSNativeOwnerLoginModel) {
        guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) else { return }
        Task { @MainActor in
            guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner) else { return }
            // A missing optional recent-access receipt must never break Viewer.
            try? await XDriveIOSNativeFilesCollectionsTransport(
                owner: owner, accessToken: accessToken
            ).touchViewed(node)
        }
    }
}

@MainActor
final class XDriveIOSNativeFilesCollectionPageModel: ObservableObject {
    @Published private(set) var items: [XDriveIOSNativeFilesCollectionItem] = []
    @Published private(set) var loading = false
    @Published private(set) var verified = false
    @Published private(set) var error: String?
    private var epoch = UUID()
    private var running: Task<Void, Never>?

    func invalidate() {
        epoch = UUID()
        running?.cancel()
        running = nil
        items = []
        loading = false
        verified = false
        error = nil
    }

    func load(_ kind: XDriveIOSNativeFilesCollectionKind,
              login: XDriveIOSNativeOwnerLoginModel) {
        invalidate()
        guard let expected = login.owner else {
            error = "请先验证原生服务器账户。"
            return
        }
        let ticket = epoch
        loading = true
        running = Task { @MainActor in
            defer {
                if epoch == ticket {
                    loading = false
                    running = nil
                }
            }
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expected)
                else { throw XDriveIOSNativeFilesCollectionFailure.invalidOwner }
                let fetched = try await XDriveIOSNativeFilesCollectionsTransport(
                    owner: auth.owner, accessToken: auth.accessToken
                ).list(kind)
                try Task.checkCancellation()
                guard epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { return }
                items = fetched
                verified = true
                error = nil
            } catch is CancellationError {
                // Disposable metadata read was superseded.
            } catch {
                guard epoch == ticket else { return }
                items = []
                verified = false
                if let reason = error as? XDriveIOSNativeFilesCollectionFailure {
                    switch reason {
                    case .invalidOwner, .server(401), .server(403), .server(404):
                        self.error = "服务器或账户已变化，请重新验证。"
                    case .server(429), .server(503):
                        self.error = "服务器暂时繁忙，请重试。"
                    default:
                        self.error = "当前列表无法验证，请重试。"
                    }
                } else {
                    self.error = "云端文件读取失败，请检查网络。"
                }
            }
        }
    }
}

@MainActor
final class XDriveIOSNativeFilesFavoriteMutationModel: ObservableObject {
    @Published private(set) var busy = false
    @Published private(set) var status: String?
    private var epoch = UUID()
    private var running: Task<Void, Never>?

    private enum Action {
        case add(XDriveIOSNativeFilesNode)
        case remove(XDriveIOSNativeFilesCollectionItem)
    }

    func invalidate() {
        epoch = UUID()
        running?.cancel()
        running = nil
        busy = false
        status = nil
    }

    func add(_ node: XDriveIOSNativeFilesNode,
             login: XDriveIOSNativeOwnerLoginModel) {
        perform(.add(node), login: login) {}
    }

    func remove(_ item: XDriveIOSNativeFilesCollectionItem,
                login: XDriveIOSNativeOwnerLoginModel,
                onConfirmed: @MainActor @escaping () -> Void) {
        perform(.remove(item), login: login, onConfirmed: onConfirmed)
    }

    private func perform(_ action: Action, login: XDriveIOSNativeOwnerLoginModel,
                         onConfirmed: @MainActor @escaping () -> Void) {
        guard !busy, running == nil, let expected = login.owner else {
            status = "请先验证当前账户。"
            return
        }
        let ticket = UUID()
        epoch = ticket
        busy = true
        status = "正在核对云端收藏状态…"
        running = Task { @MainActor in
            defer {
                if epoch == ticket {
                    busy = false
                    running = nil
                }
            }
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expected),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { throw XDriveIOSNativeFilesCollectionFailure.invalidOwner }
                let transport = XDriveIOSNativeFilesCollectionsTransport(
                    owner: auth.owner, accessToken: auth.accessToken
                )
                switch action {
                case .add(let node):
                    try await transport.addFavorite(node)
                case .remove(let item):
                    try await transport.removeFavorite(item)
                }
                try Task.checkCancellation()
                let after = try await login.verifiedAuthorization()
                guard epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(after.owner, expected),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { return }
                status = "服务器已确认收藏操作。"
                // A confirmed collection reload must not be blocked by busy.
                busy = false
                running = nil
                onConfirmed()
            } catch is CancellationError {
                if epoch == ticket {
                    status = "已取消；如果请求已提交，请刷新核对。"
                }
            } catch {
                guard epoch == ticket else { return }
                if let failure = error as? XDriveIOSNativeFilesCollectionFailure {
                    switch failure {
                    case .staleNode, .server(409), .server(412):
                        status = "文件版本或收藏状态已变化，请刷新再试。"
                    case .invalidOwner, .server(401), .server(403), .server(404):
                        status = "账户或文件已变化，请重新验证。"
                    default:
                        status = "收藏操作结果未确认；请刷新核对，不要自动重试。"
                    }
                } else {
                    status = "收藏操作结果未确认；请刷新核对，不要自动重试。"
                }
            }
        }
    }
}

/// A lost DELETE acknowledgment is never automatically replayed.
@MainActor
final class XDriveIOSNativeFilesRecentClearModel: ObservableObject {
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

    func clear(login: XDriveIOSNativeOwnerLoginModel,
               onConfirmed: @MainActor @escaping () -> Void) {
        guard !busy, running == nil, let expected = login.owner else {
            status = "请先验证当前账户。"
            return
        }
        let ticket = UUID()
        epoch = ticket
        busy = true
        status = "正在清空最近使用记录…"
        running = Task { @MainActor in
            defer {
                if epoch == ticket {
                    busy = false
                    running = nil
                }
            }
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expected),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { throw XDriveIOSNativeFilesCollectionFailure.invalidOwner }
                try await XDriveIOSNativeFilesCollectionsTransport(
                    owner: auth.owner, accessToken: auth.accessToken
                ).clearRecent()
                try Task.checkCancellation()
                let after = try await login.verifiedAuthorization()
                guard epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(after.owner, expected),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { return }
                status = "最近使用记录已清空，云端文件及收藏未删除。"
                busy = false
                running = nil
                onConfirmed()
            } catch is CancellationError {
                if epoch == ticket {
                    status = "已停止等待；若请求已提交，请刷新确认。"
                }
            } catch {
                guard epoch == ticket else { return }
                status = "清空结果未确认，请刷新最近使用；不要自动重试。"
            }
        }
    }
}

/// Files-owned recent/favorites subroute. Entries always come from one exact
/// Owner projection and open the same L3 native Files Viewer.
/// Collection actions preserve the exact Owner and projected Node.
private struct XDriveIOSNativeFilesCollectionManageIntent: Identifiable {
    let id = UUID()
    let owner: XDriveNativeOwnerRoot
    let item: XDriveIOSNativeFilesCollectionItem
    let quickAction: XDriveIOSNativeFilesQuickAction?
}

struct XDriveIOSNativeFilesCollectionScreen: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let kind: XDriveIOSNativeFilesCollectionKind

    @Environment(\.scenePhase) private var phase
    @StateObject private var model = XDriveIOSNativeFilesCollectionPageModel()
    @StateObject private var favorites = XDriveIOSNativeFilesFavoriteMutationModel()
    @StateObject private var recentClear = XDriveIOSNativeFilesRecentClearModel()
    @State private var showingClearRecentConfirmation = false
    @State private var selectedFile: XDriveIOSNativeFilesCollectionItem?
    @State private var selectedOwner: XDriveNativeOwnerRoot?
    @State private var returnFile: XDriveIOSNativeFilesNode?
    @State private var locateIntent: XDriveIOSNativeFilesCollectionItem?
    @State private var locateOwner: XDriveNativeOwnerRoot?
    @State private var managementIntent: XDriveIOSNativeFilesCollectionManageIntent?
    @State private var filterQuery = ""
    // Match Browse's chosen presentation when switching between Files subroutes.
    @AppStorage("xdrive.ios.files.view-mode.v1") private var viewMode = "list"

    /// Recent and Favorites are bounded Owner projections, not an index of all
    /// Server files. Filter locally; do not create a second search endpoint.
    private var filteredItems: [XDriveIOSNativeFilesCollectionItem] {
        let query = filterQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return model.items }
        return model.items.filter {
            $0.node.name.localizedStandardContains(query) ||
                $0.path.localizedStandardContains(query)
        }
    }

    var body: some View {
        ScrollViewReader { returnScroll in
            List {
                if model.loading {
                    HStack { ProgressView(); Text("正在读取云端文件…") }
                } else if let error = model.error {
                    Text(error).foregroundStyle(.orange)
                    Button("重试") { reload() }
                        .accessibilityIdentifier("native-ios-files-collection-retry")
                } else if model.items.isEmpty {
                    Text(kind == .recent ? "暂时没有最近使用的文件。" : "尚未收藏文件。")
                        .foregroundStyle(.secondary)
                } else if filteredItems.isEmpty {
                    Text("当前已加载的\(kind.title)中无匹配项。")
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("native-ios-files-collection-no-search-matches")
                }
                if viewMode == "grid" {
                    LazyVGrid(
                        columns: [GridItem(.adaptive(minimum: 128, maximum: 184), spacing: 10)],
                        spacing: 10
                    ) {
                        ForEach(filteredItems) { item in
                            gridTile(item)
                                .id(item.id)
                                .contextMenu {
                                    collectionQuickActions(for: item)
                                }
                        }
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .listRowInsets(EdgeInsets())
                    .listRowSeparator(.hidden)
                    .accessibilityIdentifier("native-ios-files-collection-grid")
                } else {
                    ForEach(filteredItems) { item in
                        row(item)
                            .id(item.id)
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                if model.verified && !model.loading && !favorites.busy {
                                    Button {
                                        openManagement(for: item)
                                    } label: {
                                        Label("更多", systemImage: "ellipsis")
                                    }
                                    .tint(.gray)
                                    Button {
                                        openManagement(for: item, quickAction: .shareLink)
                                    } label: {
                                        Label("分享链接", systemImage: "link")
                                    }
                                    .tint(.blue)
                                    Button(role: .destructive) {
                                        openManagement(for: item, quickAction: .trash)
                                    } label: {
                                        Label("删除", systemImage: "trash")
                                    }
                                }
                            }
                            .contextMenu {
                                    collectionQuickActions(for: item)
                                }
                    }
                }
                if favorites.busy {
                    HStack { ProgressView(); Text("正在更新收藏…") }
                }
                if let status = favorites.status {
                    Text(status).foregroundStyle(.secondary).font(.footnote)
                }
                if recentClear.busy {
                    HStack { ProgressView(); Text("正在清空最近记录…") }
                }
                if let status = recentClear.status {
                    Text(status).foregroundStyle(.secondary).font(.footnote)
                        .accessibilityIdentifier("native-ios-files-recent-clear-status")
                }
            }
            .disabled(recentClear.busy)
            .listStyle(.plain)
            .searchable(
                text: $filterQuery,
                placement: .navigationBarDrawer(displayMode: .automatic),
                prompt: kind == .recent ? "筛选最近使用（最多 50 项）" : "筛选收藏夹（最多 256 项）"
            )
            .navigationTitle(kind.title)
            .navigationBarTitleDisplayMode(.inline)
            .confirmationDialog(
                "清空最近使用记录？",
                isPresented: $showingClearRecentConfirmation,
                titleVisibility: .visible
            ) {
                Button("清空最近使用记录", role: .destructive) {
                    guard kind == .recent, phase == .active, model.verified,
                          !model.loading, !model.items.isEmpty,
                          !favorites.busy, !recentClear.busy,
                          selectedFile == nil, locateIntent == nil,
                          managementIntent == nil, login.owner != nil else { return }
                    recentClear.clear(login: login) { reload() }
                }
                .accessibilityIdentifier("native-ios-files-recent-clear-confirm")
            } message: {
                Text("只清除当前账号的最近访问记录，不会删除文件、文件夹或收藏。")
            }
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Menu {
                        Picker("显示方式", selection: $viewMode) {
                            Label("列表", systemImage: "list.bullet").tag("list")
                            Label("图标", systemImage: "square.grid.2x2").tag("grid")
                        }
                        .accessibilityIdentifier("native-ios-files-collection-view-mode")
                        Divider()
                        if kind == .recent {
                            Button(role: .destructive) {
                                guard phase == .active, model.verified,
                                      !model.loading, !model.items.isEmpty,
                                      !favorites.busy, !recentClear.busy,
                                      selectedFile == nil, locateIntent == nil,
                                      managementIntent == nil,
                                      login.owner != nil else { return }
                                showingClearRecentConfirmation = true
                            } label: {
                                Label("清空最近使用记录", systemImage: "trash")
                            }
                            .disabled(!model.verified || model.loading ||
                                      model.items.isEmpty || favorites.busy ||
                                      recentClear.busy)
                            .accessibilityIdentifier("native-ios-files-recent-clear")
                        }
                        Button { reload() } label: {
                            Label("刷新", systemImage: "arrow.clockwise")
                        }
                        .disabled(model.loading || favorites.busy || recentClear.busy)
                    } label: {
                        Label("更多", systemImage: "ellipsis.circle")
                    }
                    .accessibilityIdentifier("native-ios-files-collection-more-options")
                }
            }

            .sheet(item: $managementIntent, onDismiss: {
                reload()
            }) { intent in
                if XDriveIOSNativePhotoOwnerScope.matches(login.owner, intent.owner),
                   let parentID = intent.item.node.parent_id, parentID > 0,
                   XDriveIOSNativeFilesCollectionsPolicy.validItem(intent.item, kind: kind) {
                    XDriveIOSNativeFilesManagementPanel(
                        login: login, expectedOwner: intent.owner,
                        folderID: parentID, folderName: nil,
                        file: intent.item.node.isDirectory ? nil : intent.item.node,
                        directory: intent.item.node.isDirectory ? intent.item.node : nil,
                        initialQuickAction: intent.quickAction
                    ) {
                        managementIntent = nil
                    }
                } else {
                    Text("文件或账户已变化，请关闭后重新选择。")
                        .foregroundStyle(.secondary)
                }
            }
            .sheet(item: $locateIntent, onDismiss: {
                locateOwner = nil
                reload()
            }) { selected in
                NavigationStack {
                    if let openedOwner = locateOwner,
                       XDriveIOSNativePhotoOwnerScope.matches(login.owner, openedOwner) {
                        XDriveIOSNativeFilesLocateScreen(
                            login: login, selected: selected.node,
                            openedOwner: openedOwner
                        )
                    } else {
                        Text("当前服务器或账户已变化，请关闭后重新定位。")
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .fullScreenCover(item: $selectedFile, onDismiss: {
                selectedOwner = nil
                reload()
            }) { initial in
                if let openedOwner = selectedOwner {
                    XDriveIOSNativeFilesViewer(
                        initial: initial.node,
                        loadedItems: neighboringFiles(for: initial),
                        openedOwner: openedOwner,
                        login: login,
                        onNavigate: { next in
                            guard phase == .active, model.verified, !model.loading,
                                  selectedFile?.id == initial.id,
                                  XDriveIOSNativePhotoOwnerScope.matches(
                                    login.owner, openedOwner
                                  ),
                                  filteredItems.contains(where: { $0.node == next })
                            else { return false }
                            returnFile = next
                            return true
                        }
                    )
                } else {
                    Text("当前服务器或账户已变化，请关闭 Viewer。")
                }
            }
            .onAppear { reload() }
            .onDisappear {
                if selectedFile == nil && locateIntent == nil && managementIntent == nil {
                    model.invalidate()
                    favorites.invalidate()
                    recentClear.invalidate()
                    showingClearRecentConfirmation = false
                }
            }
            .onChange(of: login.owner) { _ in
                selectedFile = nil
                selectedOwner = nil
                returnFile = nil
                locateIntent = nil
                locateOwner = nil
                managementIntent = nil
                filterQuery = ""
                showingClearRecentConfirmation = false
                model.invalidate()
                favorites.invalidate()
                recentClear.invalidate()
            }
            .onChange(of: model.loading) { now in
                guard !now, selectedFile == nil, let target = returnFile else { return }
                if model.items.contains(where: { $0.node == target }) {
                    returnScroll.scrollTo(target.id, anchor: .center)
                }
                returnFile = nil
            }
        }
    }

    /// Recent and Favorites reuse the existing Server Node operation panel.
    /// Every menu item is actionable, with destination/version/delete checks
    /// delegated to the same verified writers as the main Files browser.
    @ViewBuilder
    private func collectionQuickActions(
        for item: XDriveIOSNativeFilesCollectionItem
    ) -> some View {
        if model.verified && !model.loading && !favorites.busy {
            if !item.node.isDirectory {
                Button { openFile(item) } label: {
                    Label("预览", systemImage: "eye")
                }
            }
            Button { openManagement(for: item, quickAction: .copy) } label: {
                Label("复制到…", systemImage: "doc.on.doc")
            }
            Button { openManagement(for: item, quickAction: .move) } label: {
                Label("移动到…", systemImage: "folder")
            }
            Button { openManagement(for: item, quickAction: .rename) } label: {
                Label("重命名", systemImage: "pencil")
            }
            if kind == .favorites {
                Button {
                    guard filteredItems.contains(item), model.items.contains(item) else {
                        return
                    }
                    favorites.remove(item, login: login) { reload() }
                } label: {
                    Label("取消收藏", systemImage: "star.slash")
                }
                .accessibilityIdentifier("native-ios-files-unfavorite-\(item.id)")
            } else {
                Button { openManagement(for: item, quickAction: .favorite) } label: {
                    Label("收藏", systemImage: "star")
                }
            }
            Button { openManagement(for: item, quickAction: .shareLink) } label: {
                Label("云端分享链接", systemImage: "link")
            }
            Button { openManagement(for: item, quickAction: .download) } label: {
                Label(item.node.isDirectory ? "下载文件夹 ZIP" : "下载原件",
                      systemImage: "arrow.down.to.line")
            }
            Button { showLocation(for: item) } label: {
                Label("显示所在文件夹", systemImage: "folder")
            }
            Button(role: .destructive) {
                openManagement(for: item, quickAction: .trash)
            } label: {
                Label("移入回收站", systemImage: "trash")
            }
        }
    }

    private func openManagement(
        for item: XDriveIOSNativeFilesCollectionItem,
        quickAction: XDriveIOSNativeFilesQuickAction? = nil
    ) {
        guard phase == .active, model.verified, !model.loading,
              !favorites.busy, selectedFile == nil, locateIntent == nil,
              managementIntent == nil,
              let owner = login.owner, let parentID = item.node.parent_id,
              parentID > 0,
              XDriveIOSNativeFilesCollectionsPolicy.validItem(item, kind: kind),
              filteredItems.contains(item), model.items.contains(item) else { return }
        managementIntent = XDriveIOSNativeFilesCollectionManageIntent(
            owner: owner, item: item, quickAction: quickAction
        )
    }

    /// Recent and Favorite server projections expose a path label but no
    /// guessed navigation target. Use the existing authoritative Node location
    /// reader, which also validates exact Owner, root, parent and revision.
    private func showLocation(for item: XDriveIOSNativeFilesCollectionItem) {
        guard phase == .active, model.verified, !model.loading,
              !favorites.busy, selectedFile == nil,
              let owner = login.owner, filteredItems.contains(item),
              model.items.contains(item), item.node.parent_id != nil else { return }
        locateOwner = owner
        locateIntent = item
    }

    private func openFile(_ item: XDriveIOSNativeFilesCollectionItem) {
        guard model.verified, !model.loading, !favorites.busy,
              let owner = login.owner, filteredItems.contains(item),
              model.items.contains(item) else { return }
        selectedOwner = owner
        returnFile = item.node
        selectedFile = item
    }

    /// The same verified collection items and native destination/Viewer serve
    /// both presentations; switching modes never starts an extra API read.
    /// Recent/Favorites reuse the uncluttered native Files icon grid. Favorite
    /// removal stays in the verified long-press menu instead of a second
    /// permanently visible button beneath every thumbnail.
    private func gridTile(_ item: XDriveIOSNativeFilesCollectionItem) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if item.node.isDirectory {
                NavigationLink {
                    XDriveIOSNativeFilesBrowser(
                        login: login, folderID: item.node.id, folderName: item.node.name
                    )
                } label: {
                    gridEntryLabel(item)
                }
                .buttonStyle(.plain)
                .disabled(!model.verified || model.loading || favorites.busy)
                .accessibilityIdentifier("native-ios-files-recent-folder-\(item.id)")
            } else {
                Button { openFile(item) } label: {
                    gridEntryLabel(item)
                }
                .buttonStyle(.plain)
                .disabled(!model.verified || model.loading || favorites.busy)
                .accessibilityIdentifier("native-ios-files-collection-open-\(item.id)")
            }
        }
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }

    private func gridEntryLabel(_ item: XDriveIOSNativeFilesCollectionItem) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            XDriveIOSNativeFilesThumbnailTile(
                node: item.node, login: login,
                height: 72, viewerActive: selectedFile != nil
            )
            Text(item.node.name)
                .font(.footnote)
                .lineLimit(2)
                .frame(maxWidth: .infinity, minHeight: 36, alignment: .topLeading)
            Text(item.path)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, minHeight: 130, alignment: .topLeading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    /// Tapping a file or folder remains the primary row action; long-press
    /// exposes the same Owner-verified Favorite and management operations.
    private func row(_ item: XDriveIOSNativeFilesCollectionItem) -> some View {
        HStack(spacing: 8) {
            if item.node.isDirectory {
                NavigationLink {
                    XDriveIOSNativeFilesBrowser(
                        login: login, folderID: item.node.id, folderName: item.node.name
                    )
                } label: {
                    entryLabel(item)
                }
                .disabled(!model.verified || model.loading || favorites.busy)
                .accessibilityIdentifier("native-ios-files-recent-folder-\(item.id)")
            } else {
                Button { openFile(item) } label: {
                    entryLabel(item)
                }
                .buttonStyle(.plain)
                .disabled(!model.verified || model.loading || favorites.busy)
                .accessibilityIdentifier("native-ios-files-collection-open-\(item.id)")
            }
        }
        .frame(minHeight: 44)
    }

    private func entryLabel(_ item: XDriveIOSNativeFilesCollectionItem) -> some View {
        HStack(spacing: 12) {
            XDriveIOSNativeFilesThumbnailTile(
                node: item.node, login: login,
                height: 40, width: 40, viewerActive: selectedFile != nil
            )
            VStack(alignment: .leading, spacing: 3) {
                Text(item.node.name).lineLimit(2)
                Text(item.path).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 4)
        }
        .contentShape(Rectangle())
    }

    private func neighboringFiles(
        for selected: XDriveIOSNativeFilesCollectionItem
    ) -> [XDriveIOSNativeFilesNode] {
        guard model.verified, model.items.contains(selected),
              filteredItems.contains(selected) else {
            return [selected.node]
        }
        let neighbors = filteredItems.filter {
            $0.node.type == "file" && $0.node.parent_id == selected.node.parent_id
        }.prefix(XDriveIOSNativeFilesViewerPolicy.maximumLoadedRows).map(\.node)
        return neighbors.contains(selected.node) ? neighbors : [selected.node]
    }

    private func reload() {
        guard !favorites.busy, !recentClear.busy else { return }
        model.load(kind, login: login)
    }
}
