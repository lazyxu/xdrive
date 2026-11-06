import Combine
import Foundation
import SwiftUI

private enum XDriveIOSNativeFilesSavedSearchFailure: Error {
    case invalidOwner, invalidInput, malformed, uncertain, server(Int)
}

private final class XDriveIOSNativeFilesSavedSearchNoRedirect: XDriveIOSServerTLSDelegate, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// Only canonical Server file organization endpoints. Mutations are one-shot;
/// never replay a POST/PATCH/PUT/DELETE after an unknown response.
struct XDriveIOSNativeFilesSavedSearchClient {
    let owner: XDriveNativeOwnerRoot
    let accessToken: String

    private func session() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 25
        return URLSession(configuration: config,
                          delegate: XDriveIOSNativeFilesSavedSearchNoRedirect(),
                          delegateQueue: nil)
    }

    private func request(_ path: String, method: String = "GET",
                         body: Data? = nil) throws -> URLRequest {
        let base = "/api/v1/file-saved-searches"
        let components = path.split(separator: "/")
        guard path == base || path == base + "/order" ||
              (path.hasPrefix(base + "/") && components.count == 4 &&
                UInt64(components[3]).map({ $0 > 0 }) == true),
              owner.ownerID > 0, owner.rootNodeID > 0, !owner.instanceID.isEmpty,
              !accessToken.isEmpty,
              let origin = try? ServerAddress.parse(owner.origin.absoluteString),
              origin == owner.origin,
              var parts = URLComponents(url: origin, resolvingAgainstBaseURL: false),
              parts.scheme == "https" else {
            throw XDriveIOSNativeFilesSavedSearchFailure.invalidOwner
        }
        parts.path = path
        parts.queryItems = nil
        parts.fragment = nil
        guard let url = parts.url else {
            throw XDriveIOSNativeFilesSavedSearchFailure.invalidInput
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

    private func send(_ request: URLRequest, expected: Int,
                      client: URLSession) async throws -> Data {
        let (data, response) = try await client.data(for: request)
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse else {
            throw XDriveIOSNativeFilesSavedSearchFailure.uncertain
        }
        guard http.statusCode == expected else {
            throw XDriveIOSNativeFilesSavedSearchFailure.server(http.statusCode)
        }
        guard data.count <= 262_144,
              expected != 204 || data.isEmpty else {
            throw XDriveIOSNativeFilesSavedSearchFailure.malformed
        }
        return data
    }

    private func list(in client: URLSession) async throws
        -> [XDriveIOSNativeFilesSavedSearch] {
        let data = try await send(
            request("/api/v1/file-saved-searches"), expected: 200, client: client
        )
        guard let items = try? JSONDecoder().decode(
            [XDriveIOSNativeFilesSavedSearch].self, from: data
        ), XDriveIOSNativeFilesSavedSearchPolicy.validList(items) else {
            throw XDriveIOSNativeFilesSavedSearchFailure.malformed
        }
        return items
    }

    func list() async throws -> [XDriveIOSNativeFilesSavedSearch] {
        let client = session()
        defer { client.invalidateAndCancel() }
        return try await list(in: client)
    }

    enum Action {
        case create(XDriveIOSNativeFilesSavedSearchInput)
        case update(UInt64, XDriveIOSNativeFilesSavedSearchInput)
        case delete(UInt64)
        case reorder([UInt64])
    }

    func perform(_ action: Action,
                 previous: [XDriveIOSNativeFilesSavedSearch]) async throws
        -> [XDriveIOSNativeFilesSavedSearch] {
        guard XDriveIOSNativeFilesSavedSearchPolicy.validList(previous) else {
            throw XDriveIOSNativeFilesSavedSearchFailure.invalidInput
        }
        let path: String
        let method: String
        let payload: Data?
        let responseStatus: Int
        switch action {
        case .create(let input):
            guard previous.count < XDriveIOSNativeFilesSavedSearchPolicy.maximumItems,
                  XDriveIOSNativeFilesSavedSearchPolicy.validInput(
                    name: input.name, query: input.query, filters: input.filters
                  ) else { throw XDriveIOSNativeFilesSavedSearchFailure.invalidInput }
            path = "/api/v1/file-saved-searches"
            method = "POST"
            payload = try JSONEncoder().encode(input)
            responseStatus = 201
        case .update(let id, let input):
            guard previous.contains(where: { $0.id == id }),
                  XDriveIOSNativeFilesSavedSearchPolicy.validInput(
                    name: input.name, query: input.query, filters: input.filters
                  ) else { throw XDriveIOSNativeFilesSavedSearchFailure.invalidInput }
            path = "/api/v1/file-saved-searches/\(id)"
            method = "PATCH"
            payload = try JSONEncoder().encode(input)
            responseStatus = 200
        case .delete(let id):
            guard previous.contains(where: { $0.id == id }) else {
                throw XDriveIOSNativeFilesSavedSearchFailure.invalidInput
            }
            path = "/api/v1/file-saved-searches/\(id)"
            method = "DELETE"
            payload = nil
            responseStatus = 204
        case .reorder(let ids):
            guard XDriveIOSNativeFilesSavedSearchPolicy.validReorder(
                ids, items: previous
              ) else { throw XDriveIOSNativeFilesSavedSearchFailure.invalidInput }
            path = "/api/v1/file-saved-searches/order"
            method = "PUT"
            payload = try JSONEncoder().encode(["ids": ids])
            responseStatus = 204
        }
        let client = session()
        defer { client.invalidateAndCancel() }
        let data = try await send(
            request(path, method: method, body: payload),
            expected: responseStatus, client: client
        )
        let current = try await list(in: client)
        switch action {
        case .create(let input):
            guard let created = try? JSONDecoder().decode(
                XDriveIOSNativeFilesSavedSearch.self, from: data
            ), XDriveIOSNativeFilesSavedSearchPolicy.valid(created),
                !previous.contains(where: { $0.id == created.id }),
                created.name == input.name, created.query == input.query,
                created.filters == input.filters,
                current.contains(created) else {
                throw XDriveIOSNativeFilesSavedSearchFailure.uncertain
            }
        case .update(let id, let input):
            guard let changed = try? JSONDecoder().decode(
                XDriveIOSNativeFilesSavedSearch.self, from: data
            ), changed.id == id,
                changed.name == input.name, changed.query == input.query,
                changed.filters == input.filters,
                current.contains(changed) else {
                throw XDriveIOSNativeFilesSavedSearchFailure.uncertain
            }
        case .delete(let id):
            guard current.count + 1 == previous.count,
                  !current.contains(where: { $0.id == id }) else {
                throw XDriveIOSNativeFilesSavedSearchFailure.uncertain
            }
        case .reorder(let ids):
            guard current.map(\.id) == ids else {
                throw XDriveIOSNativeFilesSavedSearchFailure.uncertain
            }
        }
        return current
    }
}

@MainActor
final class XDriveIOSNativeFilesSavedSearchModel: ObservableObject {
    @Published private(set) var items: [XDriveIOSNativeFilesSavedSearch] = []
    @Published private(set) var loading = false
    @Published private(set) var busy = false
    @Published private(set) var verified = false
    @Published private(set) var status: String?

    private let expected: XDriveNativeOwnerRoot
    private var epoch = UUID()
    private var job: Task<Void, Never>?

    init(owner: XDriveNativeOwnerRoot) { expected = owner }

    func matches(_ current: XDriveNativeOwnerRoot?) -> Bool {
        guard let current else { return false }
        return verified && XDriveIOSNativePhotoOwnerScope.matches(current, expected)
    }

    func invalidate() {
        epoch = UUID()
        job?.cancel()
        job = nil
        verified = false
        loading = false
        busy = false
        items = []
        status = nil
    }

    func load(login: XDriveIOSNativeOwnerLoginModel) {
        guard !busy, !loading else { return }
        guard let owner = login.owner,
              XDriveIOSNativePhotoOwnerScope.matches(owner, expected) else {
            invalidate()
            return
        }
        let ticket = UUID()
        epoch = ticket
        loading = true
        job = Task { @MainActor [weak self] in
            defer {
                if self?.epoch == ticket { self?.loading = false; self?.job = nil }
            }
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expected) else {
                    throw XDriveIOSNativeFilesSavedSearchFailure.invalidOwner
                }
                let entries = try await XDriveIOSNativeFilesSavedSearchClient(
                    owner: auth.owner, accessToken: auth.accessToken
                ).list()
                guard let self, self.epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { return }
                self.items = entries
                self.verified = true
                self.status = nil
            } catch is CancellationError {
            } catch {
                guard let self, self.epoch == ticket else { return }
                self.verified = false
                self.items = []
                self.status = "无法验证当前账户的智能文件夹，请检查网络后重试。"
            }
        }
    }

    func perform(_ action: XDriveIOSNativeFilesSavedSearchClient.Action,
                 login: XDriveIOSNativeOwnerLoginModel) {
        guard verified, !busy, !loading,
              matches(login.owner) else { return }
        let previous = items
        let ticket = UUID()
        epoch = ticket
        busy = true
        status = nil
        job = Task { @MainActor [weak self] in
            defer {
                if self?.epoch == ticket { self?.busy = false; self?.job = nil }
            }
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expected) else {
                    throw XDriveIOSNativeFilesSavedSearchFailure.invalidOwner
                }
                let next = try await XDriveIOSNativeFilesSavedSearchClient(
                    owner: auth.owner, accessToken: auth.accessToken
                ).perform(action, previous: previous)
                try Task.checkCancellation()
                guard let self, self.epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { return }
                self.items = next
                self.verified = true
                self.status = "已按服务器回执更新智能文件夹。"
            } catch is CancellationError {
            } catch {
                guard let self, self.epoch == ticket else { return }
                // A mutation may have committed but its ACK/readback was lost:
                // keep last verified UI as provisional; never auto replay.
                self.verified = false
                self.status = "操作结果未确认，请先刷新服务器列表核对，不要重复提交。"
            }
        }
    }
}

/// Native SwiftUI CRUD for the same 64 Owner Saved Searches as Web/PWA.
/// Tapping a saved rule lets the parent launch its existing Server Range search.
struct XDriveIOSNativeFilesSavedSearchesScreen: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let expectedOwner: XDriveNativeOwnerRoot
    let onOpen: (XDriveIOSNativeFilesSavedSearch) -> Void
    @StateObject private var model: XDriveIOSNativeFilesSavedSearchModel
    @Environment(\.dismiss) private var dismiss
    @State private var draftName = ""
    @State private var draftQuery: String
    @State private var draftFilters: XDriveIOSNativeFilesSavedSearchFilters
    @State private var editing: XDriveIOSNativeFilesSavedSearch?
    @State private var editedName = ""
    @State private var deleteTarget: XDriveIOSNativeFilesSavedSearch?

    init(login: XDriveIOSNativeOwnerLoginModel,
         expectedOwner: XDriveNativeOwnerRoot,
         proposedQuery: String,
         proposedFilters: XDriveIOSNativeFilesSearchFilterState,
         onOpen: @escaping (XDriveIOSNativeFilesSavedSearch) -> Void) {
        self.login = login
        self.expectedOwner = expectedOwner
        self.onOpen = onOpen
        _model = StateObject(wrappedValue: XDriveIOSNativeFilesSavedSearchModel(owner: expectedOwner))
        _draftQuery = State(initialValue: proposedQuery)
        _draftFilters = State(initialValue: XDriveIOSNativeFilesSavedSearchFilters(from: proposedFilters))
    }

    private var validCreate: Bool {
        XDriveIOSNativeFilesSavedSearchPolicy.validInput(
            name: draftName.trimmingCharacters(in: .whitespacesAndNewlines),
            query: draftQuery.trimmingCharacters(in: .whitespacesAndNewlines),
            filters: draftFilters
        ) && model.items.count < XDriveIOSNativeFilesSavedSearchPolicy.maximumItems
    }

    var body: some View {
        Form {
            if !XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner) {
                Section { Label("账户已经变化，请关闭此页面。", systemImage: "lock") }
            } else {
                Section("已保存的智能文件夹") {
                    if model.loading && !model.verified {
                        ProgressView("正在验证智能文件夹…")
                    }
                    if model.verified && model.items.isEmpty {
                        Text("尚无智能文件夹。可在下面按关键词或筛选条件新建。")
                            .foregroundStyle(.secondary)
                    }
                    if model.matches(login.owner) {
                        ForEach(model.items) { item in
                            let index = model.items.firstIndex(where: { $0.id == item.id }) ?? 0
                            HStack {
                                Button {
                                    guard model.matches(login.owner) else { return }
                                    dismiss()
                                    onOpen(item)
                                } label: {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Label(item.name, systemImage: "folder.badge.gearshape")
                                        Text(item.query.isEmpty ? "按筛选条件" : item.query)
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                                .buttonStyle(.plain)
                                Spacer(minLength: 4)
                                Menu {
                                    Button("重命名") {
                                        editing = item
                                        editedName = item.name
                                    }
                                    Button("以当前搜索替换规则") {
                                        let q = draftQuery.trimmingCharacters(in: .whitespacesAndNewlines)
                                        guard XDriveIOSNativeFilesSavedSearchPolicy.validInput(
                                            name: item.name, query: q, filters: draftFilters
                                        ) else { return }
                                        model.perform(.update(item.id, .init(
                                            name: item.name, query: q, filters: draftFilters
                                        )), login: login)
                                    }
                                    .disabled(!XDriveIOSNativeFilesSavedSearchPolicy.validInput(
                                        name: item.name,
                                        query: draftQuery.trimmingCharacters(in: .whitespacesAndNewlines),
                                        filters: draftFilters
                                    ))
                                    Divider()
                                    Button("上移") { reorder(index, by: -1) }
                                        .disabled(index == 0)
                                    Button("下移") { reorder(index, by: 1) }
                                        .disabled(index == model.items.count - 1)
                                    Button("删除", role: .destructive) { deleteTarget = item }
                                } label: {
                                    Image(systemName: "ellipsis.circle")
                                        .frame(minWidth: 44, minHeight: 44)
                                }
                                .disabled(model.busy || model.loading)
                            }
                        }
                    }
                }
                Section("新建智能文件夹") {
                    TextField("名称", text: $draftName)
                    TextField("搜索词（也可仅使用已有筛选条件）", text: $draftQuery)
                        .autocorrectionDisabled()
                    Text(draftFilters.native.hasActiveFilters
                         ? "将同时保存当前类型、日期、大小、同步文件夹和标签筛选。"
                         : "输入至少两个字符的搜索词，或先从 Files 搜索结果打开此页。")
                        .font(.footnote).foregroundStyle(.secondary)
                    Button("保存为智能文件夹") {
                        guard validCreate, model.matches(login.owner) else { return }
                        let name = draftName.trimmingCharacters(in: .whitespacesAndNewlines)
                        let query = draftQuery.trimmingCharacters(in: .whitespacesAndNewlines)
                        model.perform(.create(.init(name: name, query: query,
                                                    filters: draftFilters)), login: login)
                        draftName = ""
                    }
                    .disabled(!validCreate || !model.matches(login.owner) || model.busy)
                }
                if let item = editing {
                    Section("重命名智能文件夹") {
                        TextField("名称", text: $editedName)
                        Button("保存名称") {
                            let name = editedName.trimmingCharacters(in: .whitespacesAndNewlines)
                            guard XDriveIOSNativeFilesSavedSearchPolicy.validInput(
                                name: name, query: item.query, filters: item.filters
                            ) else { return }
                            model.perform(.update(item.id, .init(
                                name: name, query: item.query, filters: item.filters
                            )), login: login)
                            editing = nil
                        }
                        .disabled(model.busy || !model.matches(login.owner))
                        Button("取消", role: .cancel) { editing = nil }
                    }
                }
                if let status = model.status {
                    Section("状态") { Text(status).foregroundStyle(.secondary) }
                }
            }
        }
        .navigationTitle("智能文件夹")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("刷新") { model.load(login: login) }
                    .disabled(model.loading || model.busy)
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("完成") { dismiss() }
            }
        }
        .task { model.load(login: login) }
        .onChange(of: login.owner) { owner in
            if !XDriveIOSNativePhotoOwnerScope.matches(owner, expectedOwner) {
                model.invalidate()
            }
        }
        .onDisappear { model.invalidate() }
        .confirmationDialog(
            "删除这个智能文件夹？", isPresented: Binding(
                get: { deleteTarget != nil },
                set: { if !$0 { deleteTarget = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("确认删除", role: .destructive) {
                if let item = deleteTarget {
                    model.perform(.delete(item.id), login: login)
                }
                deleteTarget = nil
            }
            Button("取消", role: .cancel) { deleteTarget = nil }
        } message: {
            Text("只删除保存的搜索规则，不删除任何云端文件。")
        }
    }

    private func reorder(_ index: Int, by direction: Int) {
        guard model.matches(login.owner), !model.busy,
              index >= 0, index < model.items.count,
              index + direction >= 0,
              index + direction < model.items.count else { return }
        var ids = model.items.map(\.id)
        ids.swapAt(index, index + direction)
        model.perform(.reorder(ids), login: login)
    }
}
