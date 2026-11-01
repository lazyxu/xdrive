import Combine
import Foundation
import SwiftUI

private enum XDriveIOSNativeFilesReadError: Error {
    case invalidScope
    case invalidPage
    case server(Int)
    case malformed
}

private final class XDriveIOSNativeFilesRejectRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// Read-only use of the existing Server Node and Search endpoints. Each page
/// uses a short-lived, in-memory native Owner bearer; no alternate writer,
/// WebView cookie or implicit File Provider rights are introduced.
private struct XDriveIOSNativeFilesReader {
    let owner: XDriveNativeOwnerRoot
    let accessToken: String

    private func endpoint(_ path: String, query: [URLQueryItem]) throws -> URL {
        guard owner.ownerID > 0, owner.rootNodeID > 0,
              !owner.instanceID.isEmpty, !accessToken.isEmpty,
              let origin = try? ServerAddress.parse(owner.origin.absoluteString),
              origin == owner.origin, path.hasPrefix("/api/v1/"),
              !path.contains("?"), !path.contains("#"),
              var parts = URLComponents(url: origin, resolvingAgainstBaseURL: false),
              parts.scheme == "https" else {
            throw XDriveIOSNativeFilesReadError.invalidScope
        }
        parts.path = path
        parts.queryItems = query
        guard let url = parts.url else {
            throw XDriveIOSNativeFilesReadError.invalidScope
        }
        return url
    }

    private func get<T: Decodable>(_ url: URL) async throws -> T {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 25
        let client = URLSession(configuration: configuration,
                                delegate: XDriveIOSNativeFilesRejectRedirects(),
                                delegateQueue: nil)
        defer { client.invalidateAndCancel() }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.httpShouldHandleCookies = false
        request.setValue("Bearer " + accessToken, forHTTPHeaderField: "Authorization")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await client.data(for: request)
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse else {
            throw XDriveIOSNativeFilesReadError.malformed
        }
        guard http.statusCode == 200 else {
            throw XDriveIOSNativeFilesReadError.server(http.statusCode)
        }
        guard data.count <= 2 * 1_048_576 else {
            throw XDriveIOSNativeFilesReadError.malformed
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    func children(parentID: UInt64, offset: Int,
                  sort: String, order: String) async throws -> XDriveIOSNativeFilesRange {
        guard parentID > 0,
              XDriveIOSNativeFilesPagePolicy.validOffset(offset),
              XDriveIOSNativeFilesPagePolicy.validOrder(sort: sort, order: order)
        else { throw XDriveIOSNativeFilesReadError.invalidPage }
        let url = try endpoint("/api/v1/nodes/\(parentID)/children", query: [
            URLQueryItem(name: "offset", value: String(offset)),
            URLQueryItem(name: "limit", value: String(XDriveIOSNativeFilesPagePolicy.pageSize)),
            URLQueryItem(name: "sort", value: sort),
            URLQueryItem(name: "order", value: order)
        ])
        let page: XDriveIOSNativeFilesRange = try await get(url)
        guard XDriveIOSNativeFilesPagePolicy.validChildren(
            page, parentID: parentID, offset: offset, sort: sort, order: order
        ) else { throw XDriveIOSNativeFilesReadError.invalidPage }
        return page
    }

    func search(_ query: String, offset: Int,
                sort: String, order: String) async throws -> XDriveIOSNativeFilesSearchRange {
        guard XDriveIOSNativeFilesPagePolicy.validSearch(query),
              XDriveIOSNativeFilesPagePolicy.validOffset(offset),
              XDriveIOSNativeFilesPagePolicy.validOrder(sort: sort, order: order)
        else { throw XDriveIOSNativeFilesReadError.invalidPage }
        let url = try endpoint("/api/v1/search", query: [
            URLQueryItem(name: "q", value: query.trimmingCharacters(in: .whitespacesAndNewlines)),
            URLQueryItem(name: "offset", value: String(offset)),
            URLQueryItem(name: "limit", value: String(XDriveIOSNativeFilesPagePolicy.pageSize)),
            URLQueryItem(name: "sort", value: sort),
            URLQueryItem(name: "order", value: order)
        ])
        let page: XDriveIOSNativeFilesSearchRange = try await get(url)
        guard XDriveIOSNativeFilesPagePolicy.validResults(
            page, offset: offset, sort: sort, order: order
        ) else { throw XDriveIOSNativeFilesReadError.invalidPage }
        return page
    }
}

private struct XDriveIOSNativeFilesEntry: Identifiable {
    let node: XDriveIOSNativeFilesNode
    let path: String?
    var id: UInt64 { node.id }
}

@MainActor
private final class XDriveIOSNativeFilesPageModel: ObservableObject {
    @Published private(set) var entries: [XDriveIOSNativeFilesEntry] = []
    @Published private(set) var total = 0
    @Published private(set) var loading = false
    @Published private(set) var errorMessage: String?

    private var epoch = UUID()
    private var job: Task<Void, Never>?

    func invalidate() {
        epoch = UUID()
        job?.cancel()
        job = nil
        entries = []
        total = 0
        loading = false
        errorMessage = nil
    }

    func load(login: XDriveIOSNativeOwnerLoginModel, folderID: UInt64,
              offset: Int, query: String, sort: String, order: String) {
        invalidate()
        guard let expected = login.owner else {
            errorMessage = "请先验证原生服务器账户。"
            return
        }
        let ticket = epoch
        loading = true
        job = Task { @MainActor [weak self] in
            defer {
                if self?.epoch == ticket {
                    self?.loading = false
                    self?.job = nil
                }
            }
            do {
                // Re-prove the exact Server installation, Owner and root on
                // every page/search read. A replaced account cannot publish
                // stale filenames even after an A->B->A navigation sequence.
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expected) else {
                    throw XDriveIOSNativeFilesReadError.invalidScope
                }
                let reader = XDriveIOSNativeFilesReader(
                    owner: auth.owner, accessToken: auth.accessToken
                )
                let found: [XDriveIOSNativeFilesEntry]
                let count: Int
                if query.isEmpty {
                    let page = try await reader.children(
                        parentID: folderID, offset: offset, sort: sort, order: order
                    )
                    found = page.items.map { XDriveIOSNativeFilesEntry(node: $0, path: nil) }
                    count = page.total_count
                } else {
                    let page = try await reader.search(
                        query, offset: offset, sort: sort, order: order
                    )
                    found = page.items.map {
                        XDriveIOSNativeFilesEntry(node: $0.node, path: $0.path)
                    }
                    count = page.total_count
                }
                try Task.checkCancellation()
                guard self?.epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { return }
                self?.entries = found
                self?.total = count
                self?.errorMessage = nil
            } catch is CancellationError {
                // Navigation and tab changes cancel disposable reads only.
            } catch {
                guard self?.epoch == ticket else { return }
                self?.entries = []
                self?.total = 0
                if let failure = error as? XDriveIOSNativeFilesReadError {
                    switch failure {
                    case .server(401), .server(403), .server(404), .invalidScope:
                        self?.errorMessage = "账户、目录或文件访问权限已变化，已清除旧列表。"
                    case .server(429), .server(503):
                        self?.errorMessage = "服务器暂时繁忙，请重试当前页面。"
                    default:
                        self?.errorMessage = "无法验证云端文件列表，请刷新后重试。"
                    }
                } else {
                    self?.errorMessage = "文件读取失败，请检查网络后重试。"
                }
            }
        }
    }
}

private struct XDriveIOSNativeFilesFolder: Hashable {
    let id: UInt64
    let name: String
}

/// iOS fixed Files tab: genuine native bounded Owner directory navigation
/// and whole-library search. File previews reuse a separate, read-only native
/// Viewer. Uploads, downloads and mutations remain unavailable.
struct XDriveIOSNativeFilesBrowser: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    @Environment(\.scenePhase) private var phase
    @StateObject private var model = XDriveIOSNativeFilesPageModel()
    @State private var offset = 0
    @State private var queryDraft = ""
    @State private var activeQuery = ""
    @State private var sort = "name"
    @State private var order = "asc"
    @State private var searchError: String?
    @State private var selectedFile: XDriveIOSNativeFilesEntry?
    @State private var selectedOwner: XDriveNativeOwnerRoot?
    @State private var returnOwner: XDriveNativeOwnerRoot?
    @State private var lastViewedFile: XDriveIOSNativeFilesNode?
    private let folder: XDriveIOSNativeFilesFolder?

    init(login: XDriveIOSNativeOwnerLoginModel) {
        self.login = login
        folder = nil
    }

    private init(login: XDriveIOSNativeOwnerLoginModel,
                 folder: XDriveIOSNativeFilesFolder) {
        self.login = login
        self.folder = folder
    }

    private var parentID: UInt64? {
        guard let owner = login.owner else { return nil }
        return folder?.id ?? owner.rootNodeID
    }

    var body: some View {
        ScrollViewReader { returnScroll in
        List {
            Section {
                HStack(spacing: 8) {
                    TextField("搜索全部文件", text: $queryDraft)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.search)
                        .onSubmit { submitSearch() }
                        .accessibilityIdentifier("native-ios-files-search-input")
                    Button("搜索") { submitSearch() }
                        .accessibilityIdentifier("native-ios-files-search")
                    if !activeQuery.isEmpty || !queryDraft.isEmpty {
                        Button("清除") {
                            queryDraft = ""
                            activeQuery = ""
                            searchError = nil
                            reload(resetOffset: true)
                        }
                        .accessibilityIdentifier("native-ios-files-clear-search")
                    }
                }
                if !activeQuery.isEmpty {
                    Text("全库搜索：\(activeQuery)")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if let searchError {
                    Text(searchError).foregroundStyle(.orange).font(.footnote)
                }
                HStack {
                    Picker("排序", selection: $sort) {
                        Text("名称").tag("name")
                        Text("修改时间").tag("updated")
                        Text("大小").tag("size")
                        Text("类型").tag("type")
                    }
                    Picker("顺序", selection: $order) {
                        Text("升序").tag("asc")
                        Text("降序").tag("desc")
                    }
                }
            }
            if model.loading {
                HStack { ProgressView(); Text("正在读取当前页…") }
            } else if let error = model.errorMessage {
                Text(error).foregroundStyle(.orange)
                Button("重试当前页") { reload() }
                    .accessibilityIdentifier("native-ios-files-retry")
            } else if model.entries.isEmpty {
                Label("当前目录或搜索结果为空。", systemImage: "folder")
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 96)
            }
            ForEach(model.entries) { entry in
                if entry.node.isDirectory {
                    NavigationLink(value: XDriveIOSNativeFilesFolder(
                        id: entry.node.id, name: entry.node.name
                    )) {
                        row(entry)
                    }
                    .accessibilityIdentifier("native-ios-files-folder-\(entry.node.id)")
                    .id(entry.node.id)
                } else {
                    Button {
                        guard !model.loading, let owner = login.owner,
                              model.entries.contains(where: { $0.node == entry.node })
                        else { return }
                        selectedOwner = owner
                        returnOwner = owner
                        lastViewedFile = entry.node
                        selectedFile = entry
                    } label: {
                        row(entry)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("native-ios-files-file-\(entry.node.id)")
                    .id(entry.node.id)
                }
            }
            Section {
                HStack {
                    Button("上一页") {
                        offset = max(0, offset - XDriveIOSNativeFilesPagePolicy.pageSize)
                        reload()
                    }
                    .disabled(offset == 0 || model.loading)
                    Spacer()
                    Text(model.total == 0 ? "0 / 0" :
                        "\(offset + 1)–\(min(offset + model.entries.count, model.total)) / \(model.total)")
                        .font(.footnote.monospacedDigit())
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button("下一页") {
                        offset += XDriveIOSNativeFilesPagePolicy.pageSize
                        reload()
                    }
                    .disabled(model.loading || model.total == 0 ||
                              offset + model.entries.count >= model.total)
                }
                .accessibilityIdentifier("native-ios-files-page-controls")
            }
        }
        .listStyle(.plain)
        .navigationTitle(folder?.name ?? "文件")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: XDriveIOSNativeFilesFolder.self) { next in
            XDriveIOSNativeFilesBrowser(login: login, folder: next)
        }
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    reload()
                } label: {
                    Label("刷新", systemImage: "arrow.clockwise")
                }
                .accessibilityIdentifier("native-ios-files-refresh")
            }
        }
        .fullScreenCover(item: $selectedFile, onDismiss: {
            selectedOwner = nil
            // Re-read the exact current directory/search page before returning
            // focus to the last still-valid Node and revision.
            reload()
        }) { initial in
            if let openedOwner = selectedOwner {
                XDriveIOSNativeFilesViewer(
                    initial: initial.node,
                    loadedItems: model.entries.map(\.node).filter {
                        $0.type == "file" && $0.parent_id == initial.node.parent_id
                    },
                    openedOwner: openedOwner,
                    login: login,
                    onNavigate: { next in
                        guard phase == .active, !model.loading,
                              selectedFile?.id == initial.id,
                              XDriveIOSNativePhotoOwnerScope.matches(
                                  login.owner, openedOwner
                              ),
                              model.entries.contains(where: { $0.node == next })
                        else { return false }
                        lastViewedFile = next
                        return true
                    }
                )
            } else {
                Text("当前账户已变化，请返回文件列表。")
            }
        }
        .onAppear { reload() }
        .onDisappear { if selectedFile == nil { model.invalidate() } }
        .onChange(of: login.owner) { _ in
            selectedFile = nil
            selectedOwner = nil
            returnOwner = nil
            lastViewedFile = nil
            offset = 0
            model.invalidate()
        }
        .onChange(of: sort) { _ in reload(resetOffset: true) }
        .onChange(of: order) { _ in reload(resetOffset: true) }
        .onChange(of: model.loading) { loading in
            guard !loading, selectedFile == nil,
                  let target = lastViewedFile else { return }
            if let owner = returnOwner,
               XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner),
               model.entries.contains(where: { $0.node == target }) {
                returnScroll.scrollTo(target.id, anchor: .center)
            }
            lastViewedFile = nil
            returnOwner = nil
        }
        }
    }

    private func row(_ entry: XDriveIOSNativeFilesEntry) -> some View {
        HStack(spacing: 12) {
            Image(systemName: entry.node.isDirectory ? "folder.fill" : "doc")
                .foregroundStyle(entry.node.isDirectory ? Color.accentColor : Color.secondary)
                .frame(width: 26)
            VStack(alignment: .leading, spacing: 3) {
                Text(entry.node.name).lineLimit(2)
                if let path = entry.path {
                    Text(path).font(.caption).foregroundStyle(.secondary)
                        .lineLimit(1)
                } else if !entry.node.isDirectory {
                    Text(ByteCountFormatter.string(
                        fromByteCount: entry.node.size, countStyle: .file
                    )).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 6)
        }
        .contentShape(Rectangle())
        .frame(minHeight: 44)
    }

    private func submitSearch() {
        let query = queryDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard query.isEmpty || XDriveIOSNativeFilesPagePolicy.validSearch(query) else {
            searchError = "搜索词最多 200 个字符。"
            return
        }
        searchError = nil
        activeQuery = query
        reload(resetOffset: true)
    }

    private func reload(resetOffset: Bool = false) {
        if resetOffset { offset = 0 }
        guard let parentID else {
            model.invalidate()
            return
        }
        model.load(login: login, folderID: parentID, offset: offset,
                   query: activeQuery, sort: sort, order: order)
    }
}
