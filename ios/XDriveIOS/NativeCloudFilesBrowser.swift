import Combine
import Foundation
import QuickLook
import SwiftUI
import UniformTypeIdentifiers

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

/// iOS fixed Files tab: genuine native bounded Owner directory navigation,
/// search and 512 MiB single-file export. Preview, batch actions and full
/// durable transfers remain explicitly unavailable until verified.
struct XDriveIOSNativeFilesBrowser: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    @StateObject private var model = XDriveIOSNativeFilesPageModel()
    @StateObject private var exporter = XDriveIOSNativeFilesExportModel()
    @StateObject private var uploader = XDriveIOSNativeFilesManualUploadModel()
    @StateObject private var mutator = XDriveIOSNativeFilesMutationModel()
    @State private var offset = 0
    @State private var queryDraft = ""
    @State private var activeQuery = ""
    @State private var sort = "name"
    @State private var order = "asc"
    @State private var searchError: String?
    @State private var selectedFile: XDriveIOSNativeFilesEntry?
    @State private var quickLookURL: URL?
    @State private var showingRename = false
    @State private var showingTrashConfirm = false
    @State private var renameDraft = ""
    @State private var showingCreateFolder = false
    @State private var showingFileImporter = false
    @State private var newFolderName = ""
    @State private var createBusy = false
    @State private var createNotice: String?
    @State private var createEpoch = UUID()
    @State private var createTask: Task<Void, Never>?
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
                if let createNotice {
                    Text(createNotice).foregroundStyle(.secondary).font(.footnote)
                        .accessibilityIdentifier("native-ios-files-create-status")
                }
                if let uploadStatus = uploader.status {
                    Text(uploadStatus).font(.footnote).foregroundStyle(.secondary)
                        .accessibilityIdentifier("native-ios-files-upload-status")
                }
                if let mutationStatus = mutator.status {
                    Text(mutationStatus).font(.footnote).foregroundStyle(.secondary)
                        .accessibilityIdentifier("native-ios-files-mutation-status")
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
                } else {
                    Button {
                        exporter.invalidate()
                        selectedFile = entry
                    } label: {
                        row(entry)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("native-ios-files-file-\(entry.node.id)")
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
                    showingFileImporter = true
                } label: {
                    Label("上传文件", systemImage: "square.and.arrow.up")
                }
                .disabled(uploader.busy || createBusy || !activeQuery.isEmpty ||
                          login.owner == nil)
                .accessibilityIdentifier("native-ios-files-manual-upload")
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    newFolderName = ""
                    showingCreateFolder = true
                } label: {
                    Label("新建文件夹", systemImage: "folder.badge.plus")
                }
                .disabled(createBusy || !activeQuery.isEmpty || login.owner == nil)
                .accessibilityIdentifier("native-ios-files-create-folder")
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    reload()
                } label: {
                    Label("刷新", systemImage: "arrow.clockwise")
                }
                .accessibilityIdentifier("native-ios-files-refresh")
            }
        }
        .fileImporter(isPresented: $showingFileImporter,
                      allowedContentTypes: [.item]) { result in
            switch result {
            case .success(let url):
                guard activeQuery.isEmpty, let parentID else {
                    uploader.pickerFailed()
                    return
                }
                uploader.start(fileURL: url, login: login, parentID: parentID,
                               expectedFolderName: folder?.name) {
                    reload(resetOffset: true)
                }
            case .failure:
                uploader.pickerFailed()
            }
        }
        .alert("新建文件夹", isPresented: $showingCreateFolder) {
            TextField("文件夹名称", text: $newFolderName)
            Button("创建") { createDirectory() }
            Button("取消", role: .cancel) {}
        } message: {
            Text("仅在当前目录创建。若连接中断导致结果不确定，请刷新目录确认，不要连续重试。")
        }
        .sheet(item: $selectedFile, onDismiss: {
            quickLookURL = nil
            exporter.invalidate()
        }) { entry in
            NavigationStack {
                Form {
                    Section("文件信息") {
                        LabeledContent("名称", value: entry.node.name)
                        LabeledContent("大小", value: ByteCountFormatter.string(
                            fromByteCount: entry.node.size, countStyle: .file
                        ))
                        LabeledContent("类型", value: "文件")
                        if let path = entry.path {
                            LabeledContent("路径", value: path)
                        }
                    }
                    Section("下载与导出") {
                        if let prepared = exporter.prepared,
                           prepared.nodeID == entry.node.id,
                           prepared.revision == entry.node.revision {
                            Button {
                                quickLookURL = prepared.fileURL
                            } label: {
                                Label("原生只读预览", systemImage: "eye")
                            }
                            .accessibilityIdentifier("native-ios-files-quicklook")
                            ShareLink(item: prepared.fileURL) {
                                Label("保存到“文件”或分享", systemImage: "square.and.arrow.up")
                            }
                            Text("需要在系统分享菜单中主动选择保存位置；此处并不代表已经保存。")
                                .font(.footnote).foregroundStyle(.secondary)
                        } else {
                            Button(exporter.busy ? "正在下载…" : "下载并准备系统导出") {
                                exporter.prepare(entry.node, login: login)
                            }
                            .disabled(exporter.busy)
                            Text("首版支持 512 MiB 以内的单个文件；无后台下载，不显示虚构进度。")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                        if let status = exporter.status {
                            Text(status).font(.footnote).foregroundStyle(.secondary)
                                .accessibilityIdentifier("native-ios-files-export-status")
                        }
                    }
                    Section("单文件管理") {
                        Button("重命名文件") {
                            renameDraft = entry.node.name
                            showingRename = true
                        }
                        .disabled(mutator.busy || uploader.busy || exporter.busy)
                        .accessibilityIdentifier("native-ios-files-rename")
                        Button("移入回收站", role: .destructive) {
                            showingTrashConfirm = true
                        }
                        .disabled(mutator.busy || uploader.busy || exporter.busy)
                        .accessibilityIdentifier("native-ios-files-trash")
                        if let status = mutator.status {
                            Text(status).font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                    Text("目录批量操作、复制和跨目录移动仍未接通；原生预览须先下载到临时目录，并以系统支持的类型为准。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                .navigationTitle("文件详情")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("完成") { selectedFile = nil }
                    }
                }
                .quickLookPreview($quickLookURL)
                .alert("重命名文件", isPresented: $showingRename) {
                    TextField("新文件名", text: $renameDraft)
                    Button("保存") {
                        mutator.perform(node: entry.node, kind: .rename(renameDraft),
                                        login: login) {
                            selectedFile = nil
                            reload(resetOffset: true)
                        }
                    }
                    Button("取消", role: .cancel) {}
                } message: {
                    Text("服务器会验证当前文件版本和同名冲突；结果不确定时请先刷新。")
                }
                .confirmationDialog("将“\(entry.node.name)”移入回收站？",
                                    isPresented: $showingTrashConfirm,
                                    titleVisibility: .visible) {
                    Button("确认移入回收站", role: .destructive) {
                        mutator.perform(node: entry.node, kind: .trash,
                                        login: login) {
                            selectedFile = nil
                            reload(resetOffset: true)
                        }
                    }
                } message: {
                    Text("这会修改服务器上的文件。提交后如网络中断，请先刷新核对，不要盲目重复操作。")
                }
            }
        }
        .onAppear { reload() }
        .onDisappear { model.invalidate() }
        .onDisappear {
            quickLookURL = nil
            exporter.invalidate()
        }
        .onDisappear {
            uploader.invalidate()
            showingFileImporter = false
            mutator.invalidate()
            showingRename = false
            showingTrashConfirm = false
        }
        .onDisappear {
            createEpoch = UUID()
            createTask?.cancel()
            createTask = nil
            createBusy = false
            createNotice = nil
        }
        .onChange(of: login.owner) { _ in
            selectedFile = nil
            offset = 0
            model.invalidate()
            quickLookURL = nil
            exporter.invalidate()
            uploader.invalidate()
            mutator.invalidate()
            showingRename = false
            showingTrashConfirm = false
            showingFileImporter = false
            createEpoch = UUID()
            createTask?.cancel()
            createTask = nil
            createBusy = false
            createNotice = nil
            showingCreateFolder = false
        }
        .onChange(of: sort) { _ in reload(resetOffset: true) }
        .onChange(of: order) { _ in reload(resetOffset: true) }
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

    private func createDirectory() {
        guard !createBusy, activeQuery.isEmpty,
              let parentID, let expected = login.owner else {
            createNotice = "当前目录不可创建，请退出搜索并刷新账户。"
            return
        }
        guard let name = XDriveIOSNativeFilesFolderNamePolicy.normalized(newFolderName) else {
            createNotice = "文件夹名称无效，请修改后重试。"
            return
        }
        let epoch = UUID()
        createEpoch = epoch
        createBusy = true
        createNotice = "正在向服务器创建文件夹…"
        createTask = Task { @MainActor in
            defer {
                if createEpoch == epoch {
                    createBusy = false
                    createTask = nil
                }
            }
            do {
                let authorization = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard createEpoch == epoch,
                      XDriveIOSNativePhotoOwnerScope.matches(authorization.owner, expected),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { throw XDriveIOSNativeFilesCreateError.invalidOwner }
                _ = try await XDriveIOSNativeFilesDirectoryCreator(
                    owner: authorization.owner, accessToken: authorization.accessToken
                ).create(parentID: parentID, name: name)
                try Task.checkCancellation()
                guard createEpoch == epoch,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected) else { return }
                createNotice = "服务器已确认创建“\(name)”。"
                reload(resetOffset: true)
            } catch is CancellationError {
                if createEpoch == epoch {
                    createNotice = "操作已取消，若请求已发出，请刷新目录确认结果。"
                }
            } catch {
                guard createEpoch == epoch else { return }
                if let response = error as? XDriveIOSNativeFilesCreateError {
                    switch response {
                    case .server(409):
                        createNotice = "同名文件或文件夹已存在；没有覆盖任何内容。"
                    case .server(401), .server(403), .server(404), .invalidOwner:
                        createNotice = "目录或账户权限已变化，未确认创建；请刷新。"
                    default:
                        createNotice = "创建结果未确认，请先刷新目录核对，不要盲目重复提交。"
                    }
                } else {
                    createNotice = "创建结果未确认，请刷新目录核对后再操作。"
                }
            }
        }
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
