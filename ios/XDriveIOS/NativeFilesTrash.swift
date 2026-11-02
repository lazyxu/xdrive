import Combine
import Foundation
import SwiftUI

private enum XDriveIOSNativeFilesTrashFailure: Error {
    case invalidOwner
    case staleSelection
    case malformed
    case server(Int)
}

private final class XDriveIOSNativeFilesTrashRejectRedirects:
    NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// Reuses the canonical /trash endpoints. Writes require the selected Node
/// to still be on this exact verified page, plus the Server If-Match fence.
private struct XDriveIOSNativeFilesTrashTransport {
    let owner: XDriveNativeOwnerRoot
    let accessToken: String

    enum Action {
        case restore
        case permanentlyDelete
    }

    private func client() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCache = nil
        config.timeoutIntervalForRequest = 25
        return URLSession(configuration: config,
                          delegate: XDriveIOSNativeFilesTrashRejectRedirects(),
                          delegateQueue: nil)
    }

    private func endpoint(_ path: String, query: [URLQueryItem] = []) throws -> URL {
        guard owner.ownerID > 0, owner.rootNodeID > 0,
              !owner.instanceID.isEmpty, !accessToken.isEmpty,
              path == "/api/v1/trash" || path.hasPrefix("/api/v1/trash/") ||
                  path.hasPrefix("/api/v1/nodes/"),
              let origin = try? ServerAddress.parse(owner.origin.absoluteString),
              origin == owner.origin,
              var url = URLComponents(url: origin, resolvingAgainstBaseURL: false),
              url.scheme == "https" else {
            throw XDriveIOSNativeFilesTrashFailure.invalidOwner
        }
        url.path = path
        url.queryItems = query.isEmpty ? nil : query
        guard let result = url.url else {
            throw XDriveIOSNativeFilesTrashFailure.invalidOwner
        }
        return result
    }

    private func request(_ path: String, method: String = "GET",
                         revision: UInt64? = nil,
                         query: [URLQueryItem] = []) throws -> URLRequest {
        var req = URLRequest(url: try endpoint(path, query: query))
        req.httpMethod = method
        req.httpShouldHandleCookies = false
        req.setValue("Bearer " + accessToken, forHTTPHeaderField: "Authorization")
        req.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let revision {
            req.setValue("\"\(revision)\"", forHTTPHeaderField: "If-Match")
        }
        return req
    }

    private func response(_ request: URLRequest, in session: URLSession,
                          status: Int, maxBytes: Int) async throws -> Data {
        let (data, response) = try await session.data(for: request)
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse else {
            throw XDriveIOSNativeFilesTrashFailure.malformed
        }
        guard http.statusCode == status else {
            throw XDriveIOSNativeFilesTrashFailure.server(http.statusCode)
        }
        guard data.count <= maxBytes else {
            throw XDriveIOSNativeFilesTrashFailure.malformed
        }
        return data
    }

    private func page(_ offset: Int, session: URLSession) async throws
        -> XDriveIOSNativeFilesTrashRange {
        guard XDriveIOSNativeFilesPagePolicy.validOffset(offset) else {
            throw XDriveIOSNativeFilesTrashFailure.malformed
        }
        let query = [
            URLQueryItem(name: "range", value: "true"),
            URLQueryItem(name: "offset", value: String(offset)),
            URLQueryItem(name: "limit", value: String(XDriveIOSNativeFilesTrashPolicy.pageSize)),
            URLQueryItem(name: "sort", value: XDriveIOSNativeFilesTrashPolicy.sort),
            URLQueryItem(name: "order", value: XDriveIOSNativeFilesTrashPolicy.order),
            URLQueryItem(name: "include_count", value: "true")
        ]
        let data = try await response(
            request("/api/v1/trash", query: query), in: session,
            status: 200, maxBytes: 256 * 1024
        )
        guard let page = try? JSONDecoder().decode(
            XDriveIOSNativeFilesTrashRange.self, from: data
        ), XDriveIOSNativeFilesTrashPolicy.validRange(page, offset: offset) else {
            throw XDriveIOSNativeFilesTrashFailure.malformed
        }
        return page
    }

    func page(_ offset: Int) async throws -> XDriveIOSNativeFilesTrashRange {
        let session = client()
        defer { session.invalidateAndCancel() }
        return try await page(offset, session: session)
    }

    func perform(_ action: Action, node: XDriveIOSNativeFilesTrashNode,
                 offset: Int) async throws {
        guard XDriveIOSNativeFilesTrashPolicy.validDeleted(node) else {
            throw XDriveIOSNativeFilesTrashFailure.staleSelection
        }
        let session = client()
        defer { session.invalidateAndCancel() }
        let verified = try await page(offset, session: session)
        guard verified.items.contains(node) else {
            throw XDriveIOSNativeFilesTrashFailure.staleSelection
        }
        try Task.checkCancellation()
        switch action {
        case .restore:
            let data = try await response(
                request("/api/v1/trash/\(node.id)/restore",
                        method: "POST", revision: node.revision),
                in: session, status: 200, maxBytes: 65_536
            )
            guard let restored = try? JSONDecoder().decode(
                XDriveIOSNativeFilesTrashNode.self, from: data
            ), XDriveIOSNativeFilesTrashPolicy.validRestored(restored, from: node)
            else {
                throw XDriveIOSNativeFilesTrashFailure.malformed
            }
            // Confirm the current live Node rather than trusting a stale list
            // or claiming success on an unrelated response payload.
            let currentData = try await response(
                request("/api/v1/nodes/\(node.id)"), in: session,
                status: 200, maxBytes: 65_536
            )
            guard let current = try? JSONDecoder().decode(
                XDriveIOSNativeFilesTrashNode.self, from: currentData
            ), current == restored else {
                throw XDriveIOSNativeFilesTrashFailure.malformed
            }
        case .permanentlyDelete:
            let data = try await response(
                request("/api/v1/trash/\(node.id)",
                        method: "DELETE", revision: node.revision),
                in: session, status: 204, maxBytes: 0
            )
            guard data.isEmpty else {
                throw XDriveIOSNativeFilesTrashFailure.malformed
            }
        }
    }
}

@MainActor
private final class XDriveIOSNativeFilesTrashPageModel: ObservableObject {
    @Published private(set) var items: [XDriveIOSNativeFilesTrashNode] = []
    @Published private(set) var total = 0
    @Published private(set) var verified = false
    @Published private(set) var loading = false
    @Published private(set) var error: String?
    @Published private(set) var continuationError: String?

    private var loadedIDs = Set<UInt64>()
    private var epoch = UUID()
    private var running: Task<Void, Never>?

    var canLoadMore: Bool {
        verified && !loading && continuationError == nil &&
            !items.isEmpty && items.count < total &&
            XDriveIOSNativeFilesPagePolicy.validOffset(items.count)
    }

    func pageOffset(for item: XDriveIOSNativeFilesTrashNode) -> Int? {
        guard verified, let index = items.firstIndex(of: item) else { return nil }
        return index / XDriveIOSNativeFilesTrashPolicy.pageSize *
            XDriveIOSNativeFilesTrashPolicy.pageSize
    }

    func invalidate() {
        epoch = UUID()
        running?.cancel()
        running = nil
        items = []
        loadedIDs.removeAll()
        total = 0
        loading = false
        verified = false
        error = nil
        continuationError = nil
    }

    func load(login: XDriveIOSNativeOwnerLoginModel, offset: Int) {
        invalidate()
        guard offset == 0 else {
            error = "回收站仅从当前云端列表顶部开始读取。"
            return
        }
        read(login: login, offset: 0, appending: false)
    }

    func loadMore(login: XDriveIOSNativeOwnerLoginModel) {
        guard canLoadMore else { return }
        read(login: login, offset: items.count, appending: true)
    }

    func retryMore(login: XDriveIOSNativeOwnerLoginModel) {
        guard verified, !loading, continuationError != nil else { return }
        continuationError = nil
        loadMore(login: login)
    }

    private func read(login: XDriveIOSNativeOwnerLoginModel, offset: Int,
                      appending: Bool) {
        guard !loading, XDriveIOSNativeFilesPagePolicy.validOffset(offset) else { return }
        guard let expected = login.owner else {
            invalidate()
            error = "请先验证服务器账户。"
            return
        }
        let ticket = epoch
        loading = true
        running = Task { @MainActor [weak self] in
            defer {
                if self?.epoch == ticket {
                    self?.loading = false
                    self?.running = nil
                }
            }
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expected)
                else { throw XDriveIOSNativeFilesTrashFailure.invalidOwner }
                let page = try await XDriveIOSNativeFilesTrashTransport(
                    owner: auth.owner, accessToken: auth.accessToken
                ).page(offset)
                try Task.checkCancellation()
                guard let self, self.epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { return }

                if appending {
                    guard XDriveIOSNativeFilesTrashPolicy.validAppend(
                        alreadyLoadedIDs: self.loadedIDs,
                        alreadyLoadedCount: self.items.count,
                        total: self.total, next: page
                    ) else { throw XDriveIOSNativeFilesTrashFailure.malformed }
                    self.items.append(contentsOf: page.items)
                    self.loadedIDs.formUnion(page.items.map(\.id))
                } else {
                    self.items = page.items
                    self.loadedIDs = Set(page.items.map(\.id))
                    self.total = page.total_count
                }
                self.verified = true
                self.error = nil
                self.continuationError = nil
            } catch is CancellationError {
                // Navigation, background or a changed Owner retires this read.
            } catch {
                guard let self, self.epoch == ticket else { return }
                let fatal: Bool
                if let reason = error as? XDriveIOSNativeFilesTrashFailure {
                    switch reason {
                    case .invalidOwner, .malformed,
                         .server(401), .server(403), .server(404):
                        fatal = true
                    default:
                        fatal = false
                    }
                } else {
                    fatal = false
                }
                let message: String
                if let reason = error as? XDriveIOSNativeFilesTrashFailure {
                    switch reason {
                    case .invalidOwner, .server(401), .server(403), .server(404):
                        message = "账户或回收站访问已变化，请重新验证。"
                    case .malformed:
                        message = "回收站数量或排序已变化，请刷新重试。"
                    case .server(429), .server(503):
                        message = "服务器暂时繁忙，请重试。"
                    default:
                        message = "回收站列表无法验证，请刷新重试。"
                    }
                } else {
                    message = "读取回收站失败，请检查网络后重试。"
                }
                if !appending || fatal {
                    self.items = []
                    self.loadedIDs.removeAll()
                    self.total = 0
                    self.verified = false
                    self.error = message
                    self.continuationError = nil
                } else {
                    // Keep previously verified rows; never publish a failed
                    // range, and retry only after an explicit user action.
                    self.continuationError = message
                }
            }
        }
    }
}

@MainActor
private final class XDriveIOSNativeFilesTrashMutationModel: ObservableObject {
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

    func perform(_ action: XDriveIOSNativeFilesTrashTransport.Action,
                 node: XDriveIOSNativeFilesTrashNode, offset: Int,
                 login: XDriveIOSNativeOwnerLoginModel,
                 onConfirmed: @MainActor @escaping () -> Void) {
        guard !busy, running == nil,
              let expected = login.owner,
              XDriveIOSNativeFilesTrashPolicy.validDeleted(node) else {
            status = "请选择当前已验证的回收站项目。"
            return
        }
        let ticket = UUID()
        epoch = ticket
        busy = true
        status = "正在核对服务器、项目及版本…"
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
                else { throw XDriveIOSNativeFilesTrashFailure.invalidOwner }
                status = "正在提交带版本校验的回收站操作…"
                try await XDriveIOSNativeFilesTrashTransport(
                    owner: auth.owner, accessToken: auth.accessToken
                ).perform(action, node: node, offset: offset)
                try Task.checkCancellation()
                let after = try await login.verifiedAuthorization()
                guard epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(after.owner, expected),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { return }
                status = "服务器已确认操作，正在刷新回收站。"
                // Release the write gate *before* the confirmed callback:
                // the screen's reload intentionally refuses to run while busy.
                busy = false
                running = nil
                onConfirmed()
            } catch is CancellationError {
                if epoch == ticket {
                    status = "请求已取消；若服务器已提交，请刷新核对，不要重复操作。"
                }
            } catch {
                guard epoch == ticket else { return }
                if let reason = error as? XDriveIOSNativeFilesTrashFailure {
                    switch reason {
                    case .staleSelection, .server(409), .server(412):
                        status = "原文件夹不存在、重名冲突或版本已变化，请刷新后重新选择。"
                    case .invalidOwner, .server(401), .server(403), .server(404):
                        status = "账户或文件已变化，请重新验证。"
                    default:
                        status = "操作结果未确认；请刷新回收站核对，不能盲目重试。"
                    }
                } else {
                    status = "操作结果未确认；请刷新回收站核对，不能盲目重试。"
                }
            }
        }
    }
}

/// Native Files-owned subroute, not a new tab or a secondary WebView.
struct XDriveIOSNativeFilesTrashScreen: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    @Environment(\.scenePhase) private var phase
    @StateObject private var model = XDriveIOSNativeFilesTrashPageModel()
    @StateObject private var mutation = XDriveIOSNativeFilesTrashMutationModel()
    @State private var offset = 0
    @State private var pendingDelete: XDriveIOSNativeFilesTrashNode?
    @State private var showingDeleteConfirmation = false

    var body: some View {
        List {
            if model.loading {
                HStack { ProgressView(); Text("正在读取回收站…") }
            } else if let error = model.error {
                Text(error).foregroundStyle(.orange)
                Button("重试当前页") { reload() }
                    .accessibilityIdentifier("native-ios-files-trash-retry")
            } else if model.items.isEmpty {
                Text(offset > 0 ? "本页已无项目，请返回上一页。" : "回收站为空。")
                    .foregroundStyle(.secondary)
            }
            ForEach(model.items) { item in
                VStack(alignment: .leading, spacing: 7) {
                    Label(item.name, systemImage: item.isDirectory ? "folder" : "doc")
                        .lineLimit(2)
                    Text(item.isDirectory ? "已删除的文件夹（含子文件）" :
                         ByteCountFormatter.string(
                            fromByteCount: item.size, countStyle: .file
                         ))
                        .font(.caption).foregroundStyle(.secondary)
                    HStack {
                        Button("恢复到原位置") {
                            run(.restore, item)
                        }
                        .disabled(!model.verified || mutation.busy || model.loading)
                        .accessibilityIdentifier("native-ios-files-trash-restore-\(item.id)")
                        Spacer()
                        Button("彻底删除", role: .destructive) {
                            pendingDelete = item
                            showingDeleteConfirmation = true
                        }
                        .disabled(!model.verified || mutation.busy || model.loading)
                        .accessibilityIdentifier("native-ios-files-trash-delete-\(item.id)")
                    }
                    .buttonStyle(.bordered)
                }
                .padding(.vertical, 5)
            }
            Section {
                HStack {
                    Button("上一页") {
                        offset = max(0, offset - XDriveIOSNativeFilesTrashPolicy.pageSize)
                        reload()
                    }
                    .disabled(offset == 0 || mutation.busy || model.loading)
                    Spacer()
                    Text(model.total == 0 ? "0 / 0" :
                        "\(offset + 1)–\(min(offset + model.items.count, model.total)) / \(model.total)")
                        .font(.footnote.monospacedDigit())
                    Spacer()
                    Button("下一页") {
                        offset += XDriveIOSNativeFilesTrashPolicy.pageSize
                        reload()
                    }
                    .disabled(!model.verified || mutation.busy || model.loading ||
                              offset + model.items.count >= model.total)
                }
            }
            if mutation.busy {
                HStack { ProgressView(); Text("正在等待服务器确认…") }
            }
            if let status = mutation.status {
                Text(status).font(.footnote).foregroundStyle(.secondary)
                    .accessibilityIdentifier("native-ios-files-trash-status")
            }
        }
        .navigationTitle("回收站")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button { reload() } label: {
                    Label("刷新回收站", systemImage: "arrow.clockwise")
                }
                .disabled(mutation.busy || model.loading)
                .accessibilityIdentifier("native-ios-files-trash-refresh")
            }
        }
        .confirmationDialog(
            "彻底删除“\(pendingDelete?.name ?? "")”及其全部内容？",
            isPresented: $showingDeleteConfirmation,
            titleVisibility: .visible
        ) {
            Button("确认永久删除", role: .destructive) {
                if let item = pendingDelete {
                    run(.permanentlyDelete, item)
                }
                pendingDelete = nil
            }
        } message: {
            Text("永久删除后无法从回收站恢复；请求状态不明确时只能先刷新核对。")
        }
        .onAppear { reload() }
        .onDisappear {
            model.invalidate()
            mutation.invalidate()
            pendingDelete = nil
            showingDeleteConfirmation = false
        }
        .onChange(of: login.owner) { _ in
            model.invalidate()
            mutation.invalidate()
            pendingDelete = nil
            showingDeleteConfirmation = false
            offset = 0
            reload()
        }
        .onChange(of: phase) { current in
            if current != .active {
                model.invalidate()
                mutation.invalidate()
                pendingDelete = nil
                showingDeleteConfirmation = false
            } else {
                reload()
            }
        }
    }

    private func reload() {
        guard !mutation.busy else { return }
        model.load(login: login, offset: offset)
    }

    private func run(_ action: XDriveIOSNativeFilesTrashTransport.Action,
                     _ item: XDriveIOSNativeFilesTrashNode) {
        guard model.verified, !model.loading, !mutation.busy,
              model.items.contains(item) else { return }
        mutation.perform(action, node: item, offset: offset, login: login) {
            reload()
        }
    }
}
