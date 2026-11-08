import Combine
import Foundation
import SwiftUI

private enum XDriveIOSNativeFilesOperationFailure: Error {
    case invalidOwner, invalidResponse, noPermission, uncertain, server(Int)
}

private final class XDriveIOSNativeFilesOperationsRejectRedirects:
    XDriveIOSServerTLSDelegate, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// The canonical Go FileOperation queue owns all mutations. The iOS client
/// cannot redo a lost acknowledgement or equate HTTP 202 with completion.
private struct XDriveIOSNativeFilesOperationsClient {
    let owner: XDriveNativeOwnerRoot
    let accessToken: String

    private func session() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCache = nil
        config.timeoutIntervalForRequest = 25
        return URLSession(
            configuration: config,
            delegate: XDriveIOSNativeFilesOperationsRejectRedirects(),
            delegateQueue: nil
        )
    }

    private func request(_ id: String? = nil,
                         action: XDriveIOSNativeFilesOperationPolicy.Action? = nil)
        throws -> URLRequest {
        guard owner.ownerID > 0, owner.rootNodeID > 0,
              !owner.instanceID.isEmpty, !accessToken.isEmpty,
              action == nil || id != nil,
              let origin = try? ServerAddress.parse(owner.origin.absoluteString),
              origin == owner.origin,
              var parts = URLComponents(url: origin, resolvingAgainstBaseURL: false),
              parts.scheme == "https" else {
            throw XDriveIOSNativeFilesOperationFailure.invalidOwner
        }
        var path = "/api/v1/file-operations"
        if let id {
            guard UUID(uuidString: id) != nil else {
                throw XDriveIOSNativeFilesOperationFailure.invalidResponse
            }
            path += "/" + id
        }
        if let action { path += "/" + action.rawValue }
        parts.path = path
        parts.queryItems = id == nil ? [
            URLQueryItem(name: "limit",
                         value: String(XDriveIOSNativeFilesOperationPolicy.maximumHistory))
        ] : nil
        parts.fragment = nil
        guard let url = parts.url else {
            throw XDriveIOSNativeFilesOperationFailure.invalidOwner
        }
        var result = URLRequest(url: url)
        result.httpMethod = action == nil ? "GET" : "POST"
        result.httpShouldHandleCookies = false
        result.setValue("Bearer " + accessToken, forHTTPHeaderField: "Authorization")
        result.setValue("application/json", forHTTPHeaderField: "Accept")
        result.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        if action != nil {
            result.setValue("application/json", forHTTPHeaderField: "Content-Type")
            result.httpBody = Data("{}".utf8)
        }
        return result
    }

    private func send(_ request: URLRequest, expectedStatus: Int,
                      using client: URLSession) async throws -> Data {
        let (data, response) = try await client.data(for: request)
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse else {
            throw XDriveIOSNativeFilesOperationFailure.uncertain
        }
        guard http.statusCode == expectedStatus else {
            throw XDriveIOSNativeFilesOperationFailure.server(http.statusCode)
        }
        guard data.count > 0, data.count <= 262_144 else {
            throw XDriveIOSNativeFilesOperationFailure.invalidResponse
        }
        return data
    }

    private func list(_ client: URLSession) async throws
        -> [XDriveIOSNativeFilesOperation] {
        let data = try await send(request(), expectedStatus: 200, using: client)
        guard let items = try? JSONDecoder().decode(
            [XDriveIOSNativeFilesOperation].self, from: data
        ), XDriveIOSNativeFilesOperationPolicy.validHistory(items) else {
            throw XDriveIOSNativeFilesOperationFailure.invalidResponse
        }
        return items
    }

    func list() async throws -> [XDriveIOSNativeFilesOperation] {
        let client = session()
        defer { client.invalidateAndCancel() }
        return try await list(client)
    }

    func submit(_ action: XDriveIOSNativeFilesOperationPolicy.Action,
                original: XDriveIOSNativeFilesOperation) async throws
        -> [XDriveIOSNativeFilesOperation] {
        guard XDriveIOSNativeFilesOperationPolicy.canPerform(action, for: original)
        else { throw XDriveIOSNativeFilesOperationFailure.noPermission }
        let client = session()
        defer { client.invalidateAndCancel() }
        // 202 is only admission to a queued Server worker, never a verified
        // copy/move/delete. An ambiguous POST is never retried automatically.
        let reply = try await send(
            request(original.id, action: action),
            expectedStatus: 202, using: client
        )
        guard let accepted = try? JSONDecoder().decode(
            XDriveIOSNativeFilesOperation.self, from: reply
        ), XDriveIOSNativeFilesOperationPolicy.accepted(
            accepted, action: action, original: original
        ) else { throw XDriveIOSNativeFilesOperationFailure.uncertain }
        // The Server's current Node-bound lineage readback is authoritative,
        // even if its worker completed before the GET could execute.
        let detail = try await send(
            request(accepted.id), expectedStatus: 200, using: client
        )
        guard let verified = try? JSONDecoder().decode(
            XDriveIOSNativeFilesOperation.self, from: detail
        ), XDriveIOSNativeFilesOperationPolicy.valid(verified),
            verified.id == accepted.id, verified.type == accepted.type,
            action == .undo
                ? verified.undo_of_id == original.id
                : verified.redo_of_id == original.id
        else { throw XDriveIOSNativeFilesOperationFailure.uncertain }
        return try await list(client)
    }
}

@MainActor
final class XDriveIOSNativeFilesOperationsModel: ObservableObject {
    @Published private(set) var items: [XDriveIOSNativeFilesOperation] = []
    @Published private(set) var loading = false
    @Published private(set) var busy = false
    @Published private(set) var verified = false
    @Published private(set) var status: String?

    private var expected: XDriveNativeOwnerRoot
    private var epoch = UUID()
    private var job: Task<Void, Never>?

    init(owner: XDriveNativeOwnerRoot) { expected = owner }

    func updateExpectedOwner(_ owner: XDriveNativeOwnerRoot) {
        guard !XDriveIOSNativePhotoOwnerScope.matches(expected, owner) else { return }
        invalidate()
        expected = owner
    }

    func matches(_ current: XDriveNativeOwnerRoot?) -> Bool {
        guard let current else { return false }
        return verified && XDriveIOSNativePhotoOwnerScope.matches(current, expected)
    }

    func invalidate() {
        epoch = UUID()
        job?.cancel()
        job = nil
        loading = false
        busy = false
        verified = false
        items = []
        status = nil
    }

    func load(login: XDriveIOSNativeOwnerLoginModel) {
        guard !loading, !busy,
              let owner = login.owner,
              XDriveIOSNativePhotoOwnerScope.matches(owner, expected) else {
            return
        }
        epoch = UUID()
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
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expected)
                else { throw XDriveIOSNativeFilesOperationFailure.invalidOwner }
                let result = try await XDriveIOSNativeFilesOperationsClient(
                    owner: auth.owner, accessToken: auth.accessToken
                ).list()
                try Task.checkCancellation()
                guard let self, self.epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { return }
                self.items = result
                self.verified = true
                self.status = nil
            } catch is CancellationError {
            } catch {
                guard let self, self.epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { return }
                self.verified = false
                self.items = []
                self.status = "无法验证文件操作历史，请检查网络后重试。"
            }
        }
    }

    func submit(_ action: XDriveIOSNativeFilesOperationPolicy.Action,
                operation: XDriveIOSNativeFilesOperation,
                login: XDriveIOSNativeOwnerLoginModel,
                onAccepted: @escaping () -> Void) {
        guard matches(login.owner), !busy && !loading,
              items.contains(operation),
              XDriveIOSNativeFilesOperationPolicy.canPerform(action, for: operation)
        else { return }
        let ticket = UUID()
        epoch = ticket
        busy = true
        status = nil
        job = Task { @MainActor [weak self] in
            defer {
                if self?.epoch == ticket {
                    self?.busy = false
                    self?.job = nil
                }
            }
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expected)
                else { throw XDriveIOSNativeFilesOperationFailure.invalidOwner }
                let result = try await XDriveIOSNativeFilesOperationsClient(
                    owner: auth.owner, accessToken: auth.accessToken
                ).submit(action, original: operation)
                try Task.checkCancellation()
                guard let self, self.epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { return }
                self.items = result
                self.verified = true
                self.status = "服务器已接受" + action.label + "任务；请刷新查看最终结果。"
                onAccepted()
            } catch is CancellationError {
            } catch {
                guard let self, self.epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { return }
                // POST may already have committed but the response was lost.
                // Do not offer another write until a real Server list refresh.
                self.verified = false
                self.status = "结果尚未确认。请先刷新操作历史核对，不要重复提交。"
            }
        }
    }
}

/// Native historical Server Operations include copy/move/delete/undo/redo.
/// Existing local instant copy/move routes do not invent an undoable lineage.
struct XDriveIOSNativeFilesOperationHistoryScreen: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let expectedOwner: XDriveNativeOwnerRoot
    let onAccepted: () -> Void

    @StateObject private var model: XDriveIOSNativeFilesOperationsModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase
    @State private var isVisible = false
    @State private var pending: Pending?

    private struct Pending {
        let action: XDriveIOSNativeFilesOperationPolicy.Action
        let operation: XDriveIOSNativeFilesOperation
    }

    init(login: XDriveIOSNativeOwnerLoginModel,
         expectedOwner: XDriveNativeOwnerRoot,
         onAccepted: @escaping () -> Void) {
        self.login = login
        self.expectedOwner = expectedOwner
        self.onAccepted = onAccepted
        _model = StateObject(
            wrappedValue: XDriveIOSNativeFilesOperationsModel(owner: expectedOwner)
        )
    }

    private var canInteract: Bool {
        isVisible && phase == .active && model.matches(login.owner) &&
            !model.loading && !model.busy
    }

    var body: some View {
        Form {
            Section("服务器文件操作（最近 50 项）") {
                if model.loading {
                    ProgressView("正在验证操作历史…")
                }
                if isVisible && phase == .active &&
                   model.matches(login.owner) && model.items.isEmpty {
                    Text("暂无可显示的操作历史。")
                        .foregroundStyle(.secondary)
                }
                if isVisible && phase == .active &&
                   model.matches(login.owner) {
                    ForEach(model.items) { item in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(XDriveIOSNativeFilesOperationPolicy.title(item))
                                    .font(.headline)
                                Spacer()
                                Text(XDriveIOSNativeFilesOperationPolicy.statusLabel(item.status))
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Text("已处理 \(item.processed_items)/\(item.total_items) 项")
                                .font(.caption).foregroundStyle(.secondary)
                            if item.undoable || item.redoable {
                                HStack(spacing: 12) {
                                    if XDriveIOSNativeFilesOperationPolicy.canPerform(
                                        .undo, for: item
                                    ) {
                                        Button("撤销") {
                                            guard canInteract, model.items.contains(item) else { return }
                                            pending = Pending(action: .undo, operation: item)
                                        }
                                        .accessibilityIdentifier(
                                            "native-ios-files-undo-\(item.id)"
                                        )
                                    }
                                    if XDriveIOSNativeFilesOperationPolicy.canPerform(
                                        .redo, for: item
                                    ) {
                                        Button("重做") {
                                            guard canInteract, model.items.contains(item) else { return }
                                            pending = Pending(action: .redo, operation: item)
                                        }
                                        .accessibilityIdentifier(
                                            "native-ios-files-redo-\(item.id)"
                                        )
                                    }
                                }
                                .buttonStyle(.bordered)
                                .disabled(!canInteract)
                            }
                        }
                    }
                }
            }
            if model.busy {
                Section { ProgressView("正在向服务器提交…") }
            }
            if phase == .active,
               XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner),
               let status = model.status {
                Section("状态") {
                    Text(status).foregroundStyle(.secondary)
                    if !model.verified {
                        Button("刷新核对") {
                            guard isVisible, phase == .active,
                                  !model.busy, !model.loading else { return }
                            pending = nil
                            model.load(login: login)
                        }
                        .disabled(!isVisible || phase != .active || model.busy || model.loading)
                    }
                }
            }
        }
        .navigationTitle("操作历史")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("刷新") {
                    guard isVisible, phase == .active,
                          !model.busy, !model.loading else { return }
                    pending = nil
                    model.load(login: login)
                }
                .disabled(!isVisible || phase != .active || model.busy || model.loading ||
                          !XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner))
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("完成") { dismiss() }
                    .disabled(model.busy)
            }
        }
        // A pending POST may have committed even if its receipt is delayed.
        .interactiveDismissDisabled(model.busy)
        .onAppear {
            isVisible = true
            loadIfNeeded()
        }
        .onDisappear {
            isVisible = false
            pending = nil
            model.invalidate()
        }
        .onChange(of: phase) { state in
            if state != .active {
                pending = nil
                model.invalidate()
            } else {
                loadIfNeeded()
            }
        }
        .onChange(of: expectedOwner) { owner in
            pending = nil
            model.updateExpectedOwner(owner)
            loadIfNeeded()
        }
        .onChange(of: login.owner) { owner in
            pending = nil
            if !XDriveIOSNativePhotoOwnerScope.matches(owner, expectedOwner) {
                model.invalidate()
            } else {
                loadIfNeeded()
            }
        }
        .confirmationDialog(
            pending.map { $0.action.label + "这个文件操作？" } ?? "文件操作",
            isPresented: Binding(
                get: { pending != nil },
                set: { if !$0 { pending = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("确认" + (pending?.action.label ?? "")) {
                if let snapshot = pending, canInteract,
                   model.items.contains(snapshot.operation),
                   XDriveIOSNativeFilesOperationPolicy.canPerform(
                       snapshot.action, for: snapshot.operation
                   ) {
                    model.submit(
                        snapshot.action, operation: snapshot.operation,
                        login: login, onAccepted: onAccepted
                    )
                }
                pending = nil
            }
            Button("取消", role: .cancel) { pending = nil }
        } message: {
            Text("服务器会重新检查文件版本、权限和冲突；任务接受后不代表已经执行完成。")
        }
    }

    private func loadIfNeeded() {
        guard isVisible, phase == .active, !model.loading, !model.busy,
              XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner),
              !model.matches(login.owner) else { return }
        model.load(login: login)
    }
}
