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
struct XDriveIOSNativeFilesReader {
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
    @Published private(set) var startOffset = 0
    @Published private(set) var loading = false
    @Published private(set) var loadingAdjacent = false
    @Published private(set) var verifiedPage = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var adjacentError: String?

    private var epoch = UUID()
    private var adjacentTicket = UUID()
    private var job: Task<Void, Never>?
    private var adjacentJob: Task<Void, Never>?

    func cancelAdjacent() {
        adjacentTicket = UUID()
        adjacentJob?.cancel()
        adjacentJob = nil
        loadingAdjacent = false
    }

    func invalidate() {
        epoch = UUID()
        job?.cancel()
        job = nil
        cancelAdjacent()
        entries = []
        total = 0
        startOffset = 0
        verifiedPage = false
        loading = false
        errorMessage = nil
        adjacentError = nil
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
                // Prove the same Owner/root on every directory/search read.
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
                self?.startOffset = offset
                self?.verifiedPage = true
                self?.errorMessage = nil
            } catch is CancellationError {
                // Navigation, owner changes and refresh cancel obsolete reads.
            } catch {
                guard self?.epoch == ticket else { return }
                self?.entries = []
                self?.total = 0
                self?.startOffset = 0
                self?.verifiedPage = false
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

    /// Load only one neighboring Server range. A four-range window keeps the
    /// view lazy, allows forward/backward finger scrolling, and never loads a
    /// 100k-node directory into memory.
    func loadAdjacent(_ direction: XDriveIOSNativeFilesContinuousWindowPolicy.Direction,
                      login: XDriveIOSNativeOwnerLoginModel, folderID: UInt64,
                      query: String, sort: String, order: String) {
        guard !loading, !loadingAdjacent, verifiedPage, adjacentError == nil,
              let expected = login.owner else { return }
        let oldEntries = entries
        let oldIDs = oldEntries.map(\.id)
        let oldStart = startOffset
        let oldTotal = total
        guard let requestOffset = XDriveIOSNativeFilesContinuousWindowPolicy.requestedOffset(
            direction: direction, startOffset: oldStart,
            loadedCount: oldEntries.count, total: oldTotal
        ) else { return }

        adjacentTicket = UUID()
        let ticket = adjacentTicket
        let pageTicket = epoch
        loadingAdjacent = true
        adjacentJob = Task { @MainActor [weak self] in
            defer {
                if self?.epoch == pageTicket && self?.adjacentTicket == ticket {
                    self?.loadingAdjacent = false
                    self?.adjacentJob = nil
                }
            }
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expected) else {
                    throw XDriveIOSNativeFilesReadError.invalidScope
                }
                let reader = XDriveIOSNativeFilesReader(
                    owner: auth.owner, accessToken: auth.accessToken
                )
                let found: [XDriveIOSNativeFilesEntry]
                let returnedTotal: Int
                let returnedOffset: Int
                if query.isEmpty {
                    let page = try await reader.children(
                        parentID: folderID, offset: requestOffset, sort: sort, order: order
                    )
                    found = page.items.map { XDriveIOSNativeFilesEntry(node: $0, path: nil) }
                    returnedTotal = page.total_count
                    returnedOffset = page.offset
                } else {
                    let page = try await reader.search(
                        query, offset: requestOffset, sort: sort, order: order
                    )
                    found = page.items.map {
                        XDriveIOSNativeFilesEntry(node: $0.node, path: $0.path)
                    }
                    returnedTotal = page.total_count
                    returnedOffset = page.offset
                }
                try Task.checkCancellation()
                guard let self, self.epoch == pageTicket,
                      self.adjacentTicket == ticket,
                      self.startOffset == oldStart,
                      self.total == oldTotal,
                      self.entries.map(\.id) == oldIDs,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { return }
                guard let plan = XDriveIOSNativeFilesContinuousWindowPolicy.mergePlan(
                    direction: direction, startOffset: oldStart,
                    currentIDs: oldIDs, incomingIDs: found.map(\.id),
                    pageOffset: returnedOffset, total: oldTotal,
                    returnedTotal: returnedTotal
                ) else { throw XDriveIOSNativeFilesReadError.invalidPage }

                var updated = direction == .next
                    ? oldEntries + found : found + oldEntries
                if plan.dropFromFront > 0 {
                    updated.removeFirst(plan.dropFromFront)
                }
                if plan.dropFromBack > 0 {
                    updated.removeLast(plan.dropFromBack)
                }
                self.startOffset = plan.startOffset
                self.entries = updated
                self.adjacentError = nil
            } catch is CancellationError {
                // Never append cancelled or stale adjacent results.
            } catch {
                guard let self, self.epoch == pageTicket,
                      self.adjacentTicket == ticket else { return }
                if let failure = error as? XDriveIOSNativeFilesReadError {
                    switch failure {
                    case .server(401), .server(403), .server(404), .invalidScope:
                        self.entries = []
                        self.total = 0
                        self.verifiedPage = false
                        self.adjacentError = "文件访问权限已变化，请重新验证账户后刷新。"
                    case .invalidPage:
                        self.adjacentError = "文件列表在滚动期间发生变化，请刷新后继续。"
                    default:
                        self.adjacentError = "无法加载更多文件，请刷新当前目录重试。"
                    }
                } else {
                    self.adjacentError = "网络读取失败，请刷新当前目录重试。"
                }
            }
        }
    }
}

private struct XDriveIOSNativeFilesBatchDestinationIntent: Identifiable {
    let id = UUID()
    let owner: XDriveNativeOwnerRoot
    let items: [XDriveIOSNativeFilesNode]
    let sourceParentID: UInt64
    let kind: XDriveIOSNativeFilesDestinationKind
}

private struct XDriveIOSNativeFilesLocateIntent: Identifiable {
    let id = UUID()
    let owner: XDriveNativeOwnerRoot
    let node: XDriveIOSNativeFilesNode
}

private struct XDriveIOSNativeFilesManagementIntent: Identifiable {
    let id = UUID()
    let owner: XDriveNativeOwnerRoot
    let file: XDriveIOSNativeFilesNode?
    let directory: XDriveIOSNativeFilesNode?
}

private struct XDriveIOSNativeFilesVersionIntent: Identifiable {
    let id = UUID()
    let owner: XDriveNativeOwnerRoot
    let node: XDriveIOSNativeFilesNode
}

private struct XDriveIOSNativeFilesFolder: Hashable {
    let id: UInt64
    let name: String
}

/// iOS fixed Files tab: genuine native bounded Owner directory navigation
/// and whole-library search. File previews use the separate native L3 Viewer;
/// Owner-bound creation, transfers and mutations live in the native action sheet.
struct XDriveIOSNativeFilesBrowser: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    @Environment(\.scenePhase) private var phase
    @StateObject private var model = XDriveIOSNativeFilesPageModel()
    @StateObject private var batchTrash = XDriveIOSNativeFilesBatchTrashModel()
    @StateObject private var batchTarget = XDriveIOSNativeFilesBatchTargetModel()
    @StateObject private var batchExport = XDriveIOSNativeFilesBatchExportModel()
    @State private var showingBatchShare = false
    @State private var batchDestinationIntent: XDriveIOSNativeFilesBatchDestinationIntent?
    @State private var selecting = false
    @State private var selectedIDs = Set<UInt64>()
    @State private var showingBatchTrashConfirmation = false
    @State private var offset = 0
    @State private var queryDraft = ""
    @State private var activeQuery = ""
    @State private var sort = "name"
    @AppStorage("xdrive.ios.files.view-mode.v1") private var viewMode = "list"
    @State private var order = "asc"
    @State private var searchError: String?
    @State private var selectedFile: XDriveIOSNativeFilesEntry?
    @State private var managementIntent: XDriveIOSNativeFilesManagementIntent?
    @State private var versionHistoryIntent: XDriveIOSNativeFilesVersionIntent?
    @State private var locateIntent: XDriveIOSNativeFilesLocateIntent?
    @State private var selectedOwner: XDriveNativeOwnerRoot?
    @State private var returnOwner: XDriveNativeOwnerRoot?
    @State private var lastViewedFile: XDriveIOSNativeFilesNode?
    @State private var didRestoreLocatedFile = false
    @State private var locatedFileNotice: String?
    private let folder: XDriveIOSNativeFilesFolder?
    private let focusedNode: XDriveIOSNativeFilesNode?

    init(login: XDriveIOSNativeOwnerLoginModel,
         initialOffset: Int = 0, focus: XDriveIOSNativeFilesNode? = nil) {
        self.login = login
        folder = nil
        focusedNode = focus
        _offset = State(initialValue: initialOffset)
    }

    private init(login: XDriveIOSNativeOwnerLoginModel,
                 folder: XDriveIOSNativeFilesFolder) {
        self.login = login
        self.folder = folder
        focusedNode = nil
    }

    /// Files-owned recent and search-result folder navigation.
    init(login: XDriveIOSNativeOwnerLoginModel, folderID: UInt64,
         folderName: String, initialOffset: Int = 0,
         focus: XDriveIOSNativeFilesNode? = nil) {
        self.login = login
        self.folder = XDriveIOSNativeFilesFolder(id: folderID, name: folderName)
        focusedNode = focus
        _offset = State(initialValue: initialOffset)
    }

    private var parentID: UInt64? {
        guard let owner = login.owner else { return nil }
        return folder?.id ?? owner.rootNodeID
    }

    private var canSelectPage: Bool {
        !model.loading && model.verifiedPage && activeQuery.isEmpty &&
            login.owner != nil && !model.entries.isEmpty &&
            !batchTrash.busy && !batchTarget.busy &&
            !batchExport.busy && batchExport.prepared.isEmpty
    }

    private var chosenItems: [XDriveIOSNativeFilesNode] {
        model.entries.filter { selectedIDs.contains($0.id) }.map(\.node)
    }

    private var filesHeader: some View {
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
                if let locatedFileNotice {
                    Text(locatedFileNotice).foregroundStyle(.orange).font(.footnote)
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
                Picker("显示方式", selection: $viewMode) {
                    Text("列表").tag("list")
                    Text("网格").tag("grid")
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("native-ios-files-view-mode")
                if folder == nil {
                    NavigationLink {
                        XDriveIOSNativeFilesCollectionScreen(login: login, kind: .recent)
                    } label: {
                        Label("最近使用", systemImage: "clock")
                    }
                    .disabled(login.owner == nil || batchTrash.busy || batchTarget.busy)
                    .accessibilityIdentifier("native-ios-files-open-recent")
                    NavigationLink {
                        XDriveIOSNativeFilesCollectionScreen(login: login, kind: .favorites)
                    } label: {
                        Label("收藏夹", systemImage: "star")
                    }
                    .disabled(login.owner == nil || batchTrash.busy || batchTarget.busy)
                    .accessibilityIdentifier("native-ios-files-open-favorites")
                }
                NavigationLink {
                    XDriveIOSNativeFilesTrashScreen(login: login)
                } label: {
                    Label("回收站", systemImage: "trash")
                }
                .disabled(login.owner == nil || batchTrash.busy || batchTarget.busy)
                .accessibilityIdentifier("native-ios-files-open-trash")
            }
    }

    @ViewBuilder private var filesLoadStatus: some View {
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
    }

    @ViewBuilder private func fileEntryRow(_ entry: XDriveIOSNativeFilesEntry) -> some View {
                    if selecting {
                        Button { toggleSelection(entry) } label: {
                            HStack(spacing: 12) {
                                Image(systemName: selectedIDs.contains(entry.id)
                                      ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(Color.accentColor)
                                row(entry)
                            }
                        }
                        .buttonStyle(.plain)
                        .disabled(!canSelectPage)
                        .accessibilityIdentifier("native-ios-files-select-\(entry.id)")
                    } else if entry.node.isDirectory {
                        HStack(spacing: 8) {
                            NavigationLink(value: XDriveIOSNativeFilesFolder(
                                id: entry.node.id, name: entry.node.name
                            )) {
                                row(entry)
                            }
                            .accessibilityIdentifier("native-ios-files-folder-\(entry.node.id)")
                            Button {
                                openManagement(for: entry.node)
                            } label: {
                                Image(systemName: "ellipsis.circle")
                                    .frame(minWidth: 44, minHeight: 44)
                            }
                            .accessibilityLabel("管理文件夹 \(entry.node.name)")
                            .accessibilityIdentifier("native-ios-files-folder-more-\(entry.node.id)")
                            if !activeQuery.isEmpty {
                                Button { requestLocation(for: entry) } label: {
                                    Image(systemName: "folder.badge.questionmark")
                                        .frame(minWidth: 44, minHeight: 44)
                                }
                                .accessibilityLabel("定位文件夹 \(entry.node.name) 的位置")
                                .accessibilityIdentifier("native-ios-files-locate-\(entry.id)")
                            }
                        }
                        .contextMenu {
                            Button("文件夹操作") { openManagement(for: entry.node) }
                        }
                        .id(entry.node.id)
                    } else {
                        HStack(spacing: 8) {
                            Button { openViewer(entry) } label: {
                                row(entry)
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("native-ios-files-file-\(entry.node.id)")
                            Button {
                                openManagement(for: entry.node)
                            } label: {
                                Image(systemName: "ellipsis.circle")
                                    .frame(minWidth: 44, minHeight: 44)
                            }
                            .accessibilityLabel("管理 \(entry.node.name)")
                            .accessibilityIdentifier("native-ios-files-more-\(entry.node.id)")
                            if !activeQuery.isEmpty {
                                Button { requestLocation(for: entry) } label: {
                                    Image(systemName: "folder.badge.questionmark")
                                        .frame(minWidth: 44, minHeight: 44)
                                }
                                .accessibilityLabel("定位 \(entry.node.name) 所在文件夹")
                                .accessibilityIdentifier("native-ios-files-locate-\(entry.id)")
                            }
                        }
                        .contextMenu {
                            Button("文件操作") { openManagement(for: entry.node) }
                            Button("版本历史") { openVersionHistory(for: entry.node) }
                        }
                        .id(entry.node.id)
                    }
    }

    /// No Previous/Next buttons: reaching either rendered edge reads the next
    /// contiguous Server range, with a fixed four-range memory window.
    private var filesContinuousStatus: some View {
        Section {
            if model.loadingAdjacent {
                HStack(spacing: 10) {
                    ProgressView()
                    Text("正在继续加载文件…")
                        .foregroundStyle(.secondary)
                }
                .accessibilityIdentifier("native-ios-files-loading-adjacent")
            }
            if let message = model.adjacentError {
                Text(message).foregroundStyle(.orange)
                Button("刷新文件列表") { reload(resetOffset: true) }
                    .accessibilityIdentifier("native-ios-files-continuous-retry")
            }
        }
    }

    private func requestContinuousNeighbor(for visibleID: UInt64) {
        guard !selecting, selectedFile == nil, !model.loading,
              model.verifiedPage, !model.loadingAdjacent,
              let parentID, let index = model.entries.firstIndex(where: {
                  $0.id == visibleID
              }) else { return }
        let threshold = min(8, max(1, model.entries.count / 4))
        if index >= model.entries.count - threshold {
            model.loadAdjacent(
                .next, login: login, folderID: parentID,
                query: activeQuery, sort: sort, order: order
            )
        } else if index < threshold {
            model.loadAdjacent(
                .previous, login: login, folderID: parentID,
                query: activeQuery, sort: sort, order: order
            )
        }
    }

    @ViewBuilder private var filesBatchOperations: some View {
            if selecting {
                Section("批量操作") {
                    Text("已选 \(selectedIDs.count) 项（最多 64 项，限当前载入的同一文件夹）")
                        .font(.footnote).foregroundStyle(.secondary)
                    Button("选择当前载入项目（最多 64 项）") {
                        guard canSelectPage else { return }
                        let remaining = max(
                            0, XDriveIOSNativeFilesPagePolicy.pageSize - selectedIDs.count
                        )
                        selectedIDs.formUnion(model.entries.filter {
                            !selectedIDs.contains($0.id)
                        }.prefix(remaining).map(\.id))
                    }
                    .disabled(!canSelectPage)
                    Button("清空选择") { selectedIDs.removeAll() }
                        .disabled(batchTrash.busy || batchTarget.busy ||
                              batchExport.busy || !batchExport.prepared.isEmpty ||
                              selectedIDs.isEmpty)
                    Button("已选项复制到…") {
                        openBatchDestination(.copy)
                    }
                    .disabled(!canSelectPage || selectedIDs.isEmpty)
                    .accessibilityIdentifier("native-ios-files-batch-copy")
                    Button("已选项移动到…") {
                        openBatchDestination(.move)
                    }
                    .disabled(!canSelectPage || selectedIDs.isEmpty)
                    .accessibilityIdentifier("native-ios-files-batch-move")
                    Button("已选项批量下载并导出") {
                        guard canSelectPage, let sourceParentID = parentID,
                              selectedIDs == Set(chosenItems.map(\.id)),
                              XDriveIOSNativeFilesBatchExportPolicy.validSelection(
                                  chosenItems, parentID: sourceParentID
                              ) else {
                            batchExport.invalidSelection()
                            return
                        }
                        batchExport.prepare(
                            chosenItems, parentID: sourceParentID, login: login
                        )
                    }
                    .disabled(!canSelectPage || selectedIDs.isEmpty)
                    .accessibilityIdentifier("native-ios-files-batch-export")
                    if batchExport.busy {
                        ProgressView("正在顺序下载和核对文件…")
                        Button("取消批量下载", role: .cancel) {
                            batchExport.cancelCurrentTransfer()
                        }
                        .accessibilityIdentifier("native-ios-files-batch-export-cancel")
                    }
                    if !batchExport.prepared.isEmpty {
                        Button("用系统分享导出 \(batchExport.prepared.count) 个文件") {
                            showingBatchShare = true
                        }
                        .accessibilityIdentifier("native-ios-files-batch-export-share")
                        Button("删除临时下载文件") {
                            batchExport.invalidate()
                        }
                    }
                    if let status = batchExport.status {
                        Text(status).font(.footnote).foregroundStyle(.secondary)
                            .accessibilityIdentifier("native-ios-files-batch-export-status")
                    }
                    Button("已选项移入回收站", role: .destructive) {
                        showingBatchTrashConfirmation = true
                    }
                    .disabled(!canSelectPage || selectedIDs.isEmpty)
                    .accessibilityIdentifier("native-ios-files-batch-trash")
                    if batchTrash.busy {
                        ProgressView("正在处理已选项目…")
                        Button("取消批量操作", role: .cancel) {
                            batchTrash.cancelCurrent()
                        }
                    }
                    if let status = batchTrash.status {
                        Text(status).font(.footnote).foregroundStyle(.secondary)
                            .accessibilityIdentifier("native-ios-files-batch-status")
                    }
                    if batchTarget.busy {
                        ProgressView("服务器正在处理本页批量复制/移动…")
                        Button("取消批量复制/移动", role: .cancel) {
                            batchTarget.cancelCurrent()
                        }
                        .accessibilityIdentifier("native-ios-files-batch-target-cancel")
                    }
                    if let status = batchTarget.status {
                        Text(status).font(.footnote).foregroundStyle(.secondary)
                            .accessibilityIdentifier("native-ios-files-batch-target-status")
                    }
                }
            }
    }

    private var filesList: some View {
        List {
            filesHeader
            filesLoadStatus
            if viewMode == "grid" {
                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 128, maximum: 184), spacing: 10)],
                    spacing: 10
                ) {
                    ForEach(model.entries) { entry in
                        gridTile(entry)
                            .id(entry.id)
                            .onAppear { requestContinuousNeighbor(for: entry.id) }
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .listRowInsets(EdgeInsets())
                .listRowSeparator(.hidden)
                .accessibilityIdentifier("native-ios-files-grid")
            } else {
                ForEach(model.entries) { entry in
                    fileEntryRow(entry)
                        .onAppear { requestContinuousNeighbor(for: entry.id) }
                }
            }
            filesContinuousStatus
            filesBatchOperations
        }
    }

    private var filesChrome: some View {
        filesList
        .listStyle(.plain)
        .navigationTitle(folder?.name ?? "文件")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: XDriveIOSNativeFilesFolder.self) { next in
            XDriveIOSNativeFilesBrowser(login: login, folder: next)
        }
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button(selecting ? "完成多选" : "多选") {
                    guard canSelectPage || selecting,
                          !batchTrash.busy, !batchTarget.busy,
                          !batchExport.busy, batchExport.prepared.isEmpty
                    else { return }
                    model.cancelAdjacent()
                    selecting.toggle()
                    selectedIDs.removeAll()
                }
                .disabled((!canSelectPage && !selecting) || batchTarget.busy ||
                          batchExport.busy || !batchExport.prepared.isEmpty)
                .accessibilityIdentifier("native-ios-files-multi-select")
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button { openManagement(for: nil) } label: {
                    Label("文件夹操作", systemImage: "folder.badge.gearshape")
                }
                .disabled(model.loading || !model.verifiedPage || selecting ||
                          batchTrash.busy || batchTarget.busy ||
                          batchExport.busy || !batchExport.prepared.isEmpty ||
                          login.owner == nil || !activeQuery.isEmpty)
                .accessibilityIdentifier("native-ios-files-folder-actions")
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    reload()
                } label: {
                    Label("刷新", systemImage: "arrow.clockwise")
                }
                .accessibilityIdentifier("native-ios-files-refresh")
                .disabled(batchTrash.busy || batchTarget.busy ||
                          batchExport.busy || !batchExport.prepared.isEmpty)
            }
        }
    }

    private var filesModals: some View {
        filesChrome
        .sheet(isPresented: $showingBatchShare, onDismiss: {
            batchExport.invalidate()
            selecting = false
            selectedIDs.removeAll()
            reload()
        }) {
            XDriveIOSNativeFilesBatchShareSheet(
                files: batchExport.prepared.map(\.fileURL)
            )
        }
        .sheet(item: $batchDestinationIntent) { intent in
            if XDriveIOSNativePhotoOwnerScope.matches(login.owner, intent.owner) {
                XDriveIOSNativeFilesDestinationPicker(
                    login: login, originalOwner: intent.owner,
                    selected: intent.items[0], selectedItems: intent.items,
                    kind: intent.kind
                ) { target in
                    batchDestinationIntent = nil
                    guard selecting, canSelectPage,
                          let owner = login.owner,
                          XDriveIOSNativePhotoOwnerScope.matches(owner, intent.owner),
                          selectedIDs == Set(intent.items.map(\.id)),
                          intent.items.allSatisfy({ selected in
                            model.entries.contains(where: { $0.node == selected })
                          }) else { return }
                    batchTarget.perform(
                        intent.kind, items: intent.items,
                        sourceParentID: intent.sourceParentID,
                        destination: target, login: login
                    ) {
                        selecting = false
                        selectedIDs.removeAll()
                        reload(resetOffset: true)
                    }
                }
            } else {
                Text("账户已变化，请关闭后重新选择。")
                    .foregroundStyle(.secondary)
            }
        }
        .confirmationDialog(
            "将 \(selectedIDs.count) 项及所含子文件移入回收站？",
            isPresented: $showingBatchTrashConfirmation,
            titleVisibility: .visible
        ) {
            Button("确认批量移入回收站", role: .destructive) {
                guard selecting, canSelectPage,
                      let folderID = parentID,
                      selectedIDs == Set(chosenItems.map(\.id)),
                      XDriveIOSNativeFilesBatchTrashPolicy.validSelection(
                        chosenItems, parentID: folderID
                      ) else { return }
                batchTrash.trash(
                    chosenItems, parentID: folderID, login: login
                ) {
                    selecting = false
                    selectedIDs.removeAll()
                    reload(resetOffset: true)
                }
            }
        } message: {
            Text("包括选中文件夹的所有子文件。结果不确定时先刷新目录，不能重复提交。")
        }
        .sheet(item: $locateIntent, onDismiss: {
            reload()
        }) { intent in
            NavigationStack {
                if XDriveIOSNativePhotoOwnerScope.matches(login.owner, intent.owner) {
                    XDriveIOSNativeFilesLocateScreen(
                        login: login, selected: intent.node, openedOwner: intent.owner
                    )
                } else {
                    Text("账户已经变化，请关闭并重新搜索。")
                }
            }
        }
        .sheet(item: $managementIntent, onDismiss: {
            reload()
        }) { intent in
            if XDriveIOSNativePhotoOwnerScope.matches(login.owner, intent.owner) {
                XDriveIOSNativeFilesManagementPanel(
                    login: login, expectedOwner: intent.owner,
                    folderID: folder?.id ?? intent.owner.rootNodeID,
                    folderName: folder?.name,
                    file: intent.file,
                    directory: intent.directory
                ) {
                    managementIntent = nil
                    reload()
                }
            } else {
                Text("当前账户已变化，请关闭并重新选择文件。")
                    .foregroundStyle(.secondary)
            }
        }
        .sheet(item: $versionHistoryIntent, onDismiss: {
            reload()
        }) { intent in
            if XDriveIOSNativePhotoOwnerScope.matches(login.owner, intent.owner) {
                XDriveIOSNativeFilesVersionHistoryScreen(
                    login: login, openedOwner: intent.owner, node: intent.node
                ) {
                    // The sheet's onDismiss refreshes once after Server receipt.
                    versionHistoryIntent = nil
                }
            } else {
                Text("当前账户已变化，请关闭后重新进入文件版本历史。")
            }
        }
        .fullScreenCover(item: $selectedFile, onDismiss: {
            selectedOwner = nil
            // Resume on the bounded Server range containing the last opened
            // file, not silently at the first range of a large directory.
            if let viewed = lastViewedFile,
               let index = model.entries.firstIndex(where: { $0.id == viewed.id }) {
                offset = model.startOffset +
                    (index / XDriveIOSNativeFilesPagePolicy.pageSize) *
                    XDriveIOSNativeFilesPagePolicy.pageSize
            }
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
    }

    var body: some View {
        ScrollViewReader { returnScroll in
            filesModals
        .onAppear { reload() }
        .onDisappear { if selectedFile == nil { model.invalidate() } }
        .onDisappear {
            batchTrash.invalidate()
            batchTarget.invalidate()
            if !showingBatchShare { batchExport.invalidate() }
            batchDestinationIntent = nil
            selecting = false
            selectedIDs.removeAll()
            showingBatchTrashConfirmation = false
        }
        .onChange(of: login.owner) { _ in
            batchTrash.invalidate()
            batchTarget.invalidate()
            batchExport.invalidate()
            showingBatchShare = false
            batchDestinationIntent = nil
            selecting = false
            selectedIDs.removeAll()
            showingBatchTrashConfirmation = false
            managementIntent = nil
            versionHistoryIntent = nil
            locateIntent = nil
            selectedFile = nil
            selectedOwner = nil
            returnOwner = nil
            lastViewedFile = nil
            offset = 0
            model.invalidate()
        }
        .onChange(of: model.verifiedPage) { now in
            if !now { selectedIDs.removeAll(); selecting = false }
        }
        .onChange(of: sort) { _ in reload(resetOffset: true) }
        .onChange(of: order) { _ in reload(resetOffset: true) }
        .onChange(of: model.loading) { loading in
            guard !loading, selectedFile == nil else { return }
            if !didRestoreLocatedFile, let focusedNode, model.verifiedPage {
                didRestoreLocatedFile = true
                if model.entries.contains(where: { $0.node == focusedNode }) {
                    returnScroll.scrollTo(focusedNode.id, anchor: .center)
                } else {
                    locatedFileNotice = "文件排序或版本已变化；请返回搜索结果重新定位。"
                }
            }
            guard let target = lastViewedFile else { return }
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

    /// Both display modes operate on the same, currently verified 64-item
    /// Owner page. No grid-specific reads or copied mutation pipelines.
    private func toggleSelection(_ entry: XDriveIOSNativeFilesEntry) {
        guard canSelectPage,
              model.entries.contains(where: { $0.node == entry.node }) else { return }
        if selectedIDs.contains(entry.id) {
            selectedIDs.remove(entry.id)
        } else if selectedIDs.count < XDriveIOSNativeFilesPagePolicy.pageSize {
            selectedIDs.insert(entry.id)
        }
    }

    private func openViewer(_ entry: XDriveIOSNativeFilesEntry) {
        guard !model.loading, model.verifiedPage,
              let owner = login.owner,
              model.entries.contains(where: { $0.node == entry.node }) else { return }
        model.cancelAdjacent()
        selectedOwner = owner
        returnOwner = owner
        lastViewedFile = entry.node
        selectedFile = entry
    }

    @ViewBuilder
    private func gridTile(_ entry: XDriveIOSNativeFilesEntry) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if selecting {
                Button { toggleSelection(entry) } label: { gridLabel(entry) }
                    .buttonStyle(.plain)
                    .disabled(!canSelectPage)
                    .accessibilityIdentifier("native-ios-files-select-\(entry.id)")
            } else if entry.node.isDirectory {
                NavigationLink(value: XDriveIOSNativeFilesFolder(
                    id: entry.node.id, name: entry.node.name
                )) {
                    gridLabel(entry)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("native-ios-files-folder-\(entry.id)")
            } else {
                Button { openViewer(entry) } label: { gridLabel(entry) }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("native-ios-files-file-\(entry.node.id)")
            }
            if !selecting {
                Button { openManagement(for: entry.node) } label: {
                    Image(systemName: "ellipsis.circle")
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .trailing)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("管理 \(entry.node.name)")
                .accessibilityIdentifier(entry.node.isDirectory
                    ? "native-ios-files-folder-more-\(entry.id)"
                    : "native-ios-files-more-\(entry.id)")
                if !activeQuery.isEmpty {
                    Button { requestLocation(for: entry) } label: {
                        Label("定位", systemImage: "folder.badge.questionmark")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .accessibilityIdentifier("native-ios-files-locate-\(entry.id)")
                }
            }
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(Color(uiColor: .secondarySystemGroupedBackground),
                    in: RoundedRectangle(cornerRadius: 12))
        .contextMenu {
            if !selecting {
                Button(entry.node.isDirectory ? "文件夹操作" : "文件操作") {
                    openManagement(for: entry.node)
                }
                if !entry.node.isDirectory {
                    Button("版本历史") { openVersionHistory(for: entry.node) }
                }
            }
        }
    }

    private func gridLabel(_ entry: XDriveIOSNativeFilesEntry) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            ZStack(alignment: .topTrailing) {
                XDriveIOSNativeFilesThumbnailTile(
                    node: entry.node, login: login,
                    height: 72, viewerActive: selectedFile != nil
                )
                if selecting {
                    Image(systemName: selectedIDs.contains(entry.id)
                          ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(Color.accentColor)
                        .padding(6)
                        .accessibilityHidden(true)
                }
            }
            Text(entry.node.name)
                .font(.footnote)
                .lineLimit(2)
                .frame(maxWidth: .infinity, minHeight: 36, alignment: .topLeading)
            Text(entry.path ?? (entry.node.isDirectory ? "文件夹" :
                ByteCountFormatter.string(fromByteCount: entry.node.size,
                                          countStyle: .file)))
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            if let modifiedDate = entry.node.modifiedDate {
                Text("修改于 \(XDriveIOSNativeFilesDatePolicy.display(modifiedDate))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 130, alignment: .topLeading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityValue(selecting
            ? (selectedIDs.contains(entry.id) ? "已选中" : "未选中") : "")
    }

    private func row(_ entry: XDriveIOSNativeFilesEntry) -> some View {
        HStack(spacing: 12) {
            XDriveIOSNativeFilesThumbnailTile(
                node: entry.node, login: login,
                height: 40, width: 40, viewerActive: selectedFile != nil
            )
            VStack(alignment: .leading, spacing: 3) {
                Text(entry.node.name).lineLimit(2)
                if let path = entry.path {
                    Text(path).font(.caption).foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                HStack(spacing: 8) {
                    if !entry.node.isDirectory {
                        Text(ByteCountFormatter.string(
                            fromByteCount: entry.node.size, countStyle: .file
                        )).font(.caption).foregroundStyle(.secondary)
                    }
                    if let modifiedDate = entry.node.modifiedDate {
                        Text("修改于 \(XDriveIOSNativeFilesDatePolicy.display(modifiedDate))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
            }
            Spacer(minLength: 6)
        }
        .contentShape(Rectangle())
        .frame(minHeight: 44)
    }

    private func requestLocation(for entry: XDriveIOSNativeFilesEntry) {
        guard !model.loading, model.verifiedPage,
              !activeQuery.isEmpty, !selecting,
              let owner = login.owner,
              model.entries.contains(where: { $0.node == entry.node }) else { return }
        returnOwner = owner
        lastViewedFile = entry.node
        locateIntent = XDriveIOSNativeFilesLocateIntent(owner: owner, node: entry.node)
    }

    private func openBatchDestination(_ kind: XDriveIOSNativeFilesDestinationKind) {
        guard selecting, canSelectPage,
              let owner = login.owner, let sourceParentID = parentID,
              !chosenItems.isEmpty,
              selectedIDs == Set(chosenItems.map(\.id)),
              XDriveIOSNativeFilesBatchTrashPolicy.validSelection(
                chosenItems, parentID: sourceParentID
              ) else { return }
        batchDestinationIntent = XDriveIOSNativeFilesBatchDestinationIntent(
            owner: owner, items: chosenItems, sourceParentID: sourceParentID,
            kind: kind
        )
    }

    private func openVersionHistory(for node: XDriveIOSNativeFilesNode) {
        guard !selecting, !model.loading, model.verifiedPage,
              !batchTrash.busy, !batchTarget.busy, !batchExport.busy,
              batchExport.prepared.isEmpty,
              node.type == "file", let owner = login.owner,
              model.entries.contains(where: { $0.node == node }) else { return }
        versionHistoryIntent = XDriveIOSNativeFilesVersionIntent(
            owner: owner, node: node
        )
    }

    private func openManagement(for node: XDriveIOSNativeFilesNode?) {
        guard !model.loading, model.verifiedPage, selectedFile == nil,
              let owner = login.owner,
              node != nil || activeQuery.isEmpty else { return }
        if let node {
            guard model.entries.contains(where: { $0.node == node }) else { return }
        }
        managementIntent = XDriveIOSNativeFilesManagementIntent(
            owner: owner,
            file: node?.isDirectory == false ? node : nil,
            directory: node?.isDirectory == true ? node : nil
        )
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
        selecting = false
        selectedIDs.removeAll()
        batchExport.invalidate()
        batchTarget.invalidate()
        batchDestinationIntent = nil
        if resetOffset { offset = 0 }
        guard let parentID else {
            model.invalidate()
            return
        }
        model.load(login: login, folderID: parentID, offset: offset,
                   query: activeQuery, sort: sort, order: order)
    }
}
