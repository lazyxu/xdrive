import Combine
import Foundation
import SwiftUI

struct XDriveIOSNativeFilesVersionRecord: Decodable, Hashable, Identifiable {
    let id: UInt64
    let node_id: UInt64
    let revision: UInt64
    let size: Int64
    let sha256: String?
    let created_at: String
}

/// Only the current, exact Owner Node may select a historical original.
/// A restore is a revision-locked Server operation, not a local overwrite.
enum XDriveIOSNativeFilesVersionHistoryPolicy {
    static let maximumRows = 2048

    static func valid(_ rows: [XDriveIOSNativeFilesVersionRecord],
                      for node: XDriveIOSNativeFilesNode) -> Bool {
        guard node.id > 0, node.type == "file", node.revision > 0,
              rows.count <= maximumRows,
              Set(rows.map(\.id)).count == rows.count else { return false }
        return rows.allSatisfy { version in
            version.id > 0 && version.node_id == node.id &&
                version.revision > 0 && version.revision < node.revision &&
                version.size >= 0 && !version.created_at.isEmpty &&
                version.created_at.utf8.count <= 96 &&
                (version.sha256 == nil || version.sha256!.isEmpty ||
                    (version.sha256!.utf8.count == 64 &&
                        version.sha256!.lowercased().utf8.allSatisfy {
                            ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102)
                        }))
        }
    }

    static func validRestored(_ next: XDriveIOSNativeFilesNode,
                              original: XDriveIOSNativeFilesNode,
                              version: XDriveIOSNativeFilesVersionRecord) -> Bool {
        original.id > 0 && original.revision < UInt64.max &&
            next.id == original.id && next.type == "file" &&
            next.parent_id == original.parent_id &&
            next.name == original.name && next.size == version.size &&
            next.revision == original.revision + 1
    }
}

enum XDriveIOSNativeFilesVersionHistoryFailure: Error {
    case invalidScope
    case staleNodeOrVersion
    case malformedResponse
    case server(Int)
}

private final class XDriveIOSNativeVersionNoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

private struct XDriveIOSNativeFilesVersionTransport {
    let owner: XDriveNativeOwnerRoot
    let accessToken: String

    private func endpoint(_ path: String) throws -> URL {
        guard owner.ownerID > 0, owner.rootNodeID > 0,
              !owner.instanceID.isEmpty, !accessToken.isEmpty,
              path.hasPrefix("/api/v1/"), !path.contains("?"), !path.contains("#"),
              let origin = try? ServerAddress.parse(owner.origin.absoluteString),
              origin == owner.origin,
              var components = URLComponents(url: origin, resolvingAgainstBaseURL: false),
              components.scheme == "https" else {
            throw XDriveIOSNativeFilesVersionHistoryFailure.invalidScope
        }
        components.path = path
        components.query = nil
        components.fragment = nil
        guard let url = components.url else {
            throw XDriveIOSNativeFilesVersionHistoryFailure.invalidScope
        }
        return url
    }

    private func newSession() -> URLSession {
        let settings = URLSessionConfiguration.ephemeral
        settings.httpShouldSetCookies = false
        settings.httpCookieAcceptPolicy = .never
        settings.requestCachePolicy = .reloadIgnoringLocalCacheData
        settings.urlCache = nil
        settings.timeoutIntervalForRequest = 25
        return URLSession(configuration: settings,
                          delegate: XDriveIOSNativeVersionNoRedirects(),
                          delegateQueue: nil)
    }

    private func send(_ path: String, method: String = "GET",
                      ifMatch: UInt64? = nil, maximum: Int,
                      session: URLSession) async throws -> Data {
        var request = URLRequest(url: try endpoint(path))
        request.httpMethod = method
        request.httpShouldHandleCookies = false
        request.setValue("Bearer " + accessToken, forHTTPHeaderField: "Authorization")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let ifMatch {
            request.setValue("\"\(ifMatch)\"", forHTTPHeaderField: "If-Match")
        }
        let (data, response) = try await session.data(for: request)
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse else {
            throw XDriveIOSNativeFilesVersionHistoryFailure.malformedResponse
        }
        guard http.statusCode == 200 else {
            throw XDriveIOSNativeFilesVersionHistoryFailure.server(http.statusCode)
        }
        guard data.count <= maximum else {
            throw XDriveIOSNativeFilesVersionHistoryFailure.malformedResponse
        }
        return data
    }

    private func current(_ nodeID: UInt64, session: URLSession) async throws
        -> XDriveIOSNativeFilesNode {
        let data = try await send("/api/v1/nodes/\(nodeID)",
                                  maximum: 65_536, session: session)
        return try JSONDecoder().decode(XDriveIOSNativeFilesNode.self, from: data)
    }

    private func history(_ node: XDriveIOSNativeFilesNode, session: URLSession) async throws
        -> [XDriveIOSNativeFilesVersionRecord] {
        let data = try await send("/api/v1/files/\(node.id)/versions",
                                  maximum: 2_097_152, session: session)
        let versions = try JSONDecoder().decode(
            [XDriveIOSNativeFilesVersionRecord].self, from: data
        )
        guard XDriveIOSNativeFilesVersionHistoryPolicy.valid(versions, for: node) else {
            throw XDriveIOSNativeFilesVersionHistoryFailure.malformedResponse
        }
        return versions
    }

    func load(_ node: XDriveIOSNativeFilesNode) async throws
        -> [XDriveIOSNativeFilesVersionRecord] {
        guard node.type == "file", node.parent_id != nil, node.revision > 0 else {
            throw XDriveIOSNativeFilesVersionHistoryFailure.invalidScope
        }
        let client = newSession()
        defer { client.invalidateAndCancel() }
        guard try await current(node.id, session: client) == node else {
            throw XDriveIOSNativeFilesVersionHistoryFailure.staleNodeOrVersion
        }
        return try await history(node, session: client)
    }

    func restore(_ version: XDriveIOSNativeFilesVersionRecord,
                 in node: XDriveIOSNativeFilesNode) async throws {
        guard node.type == "file", node.parent_id != nil,
              version.node_id == node.id, version.id > 0 else {
            throw XDriveIOSNativeFilesVersionHistoryFailure.invalidScope
        }
        let client = newSession()
        defer { client.invalidateAndCancel() }
        // Fresh reads before the only write. A previous Files page or
        // modal snapshot never independently authorizes a restore.
        guard try await current(node.id, session: client) == node else {
            throw XDriveIOSNativeFilesVersionHistoryFailure.staleNodeOrVersion
        }
        let available = try await history(node, session: client)
        guard available.contains(version) else {
            throw XDriveIOSNativeFilesVersionHistoryFailure.staleNodeOrVersion
        }
        try Task.checkCancellation()
        let response = try await send(
            "/api/v1/files/\(node.id)/versions/\(version.id)/restore",
            method: "POST", ifMatch: node.revision,
            maximum: 65_536, session: client
        )
        let restored = try JSONDecoder().decode(XDriveIOSNativeFilesNode.self,
                                                from: response)
        guard XDriveIOSNativeFilesVersionHistoryPolicy.validRestored(
            restored, original: node, version: version
        ) else { throw XDriveIOSNativeFilesVersionHistoryFailure.malformedResponse }
        // The Server archives the previous current revision and deletes the
        // selected historical entry atomically. Independently read back the
        // exact Node and make sure the selected version ID was consumed.
        guard try await current(node.id, session: client) == restored else {
            throw XDriveIOSNativeFilesVersionHistoryFailure.malformedResponse
        }
        let latest = try await history(restored, session: client)
        guard !latest.contains(where: { $0.id == version.id }) else {
            throw XDriveIOSNativeFilesVersionHistoryFailure.malformedResponse
        }
    }
}

@MainActor
private final class XDriveIOSNativeFilesVersionHistoryModel: ObservableObject {
    @Published private(set) var items: [XDriveIOSNativeFilesVersionRecord] = []
    @Published private(set) var busy = false
    @Published private(set) var verified = false
    @Published private(set) var status: String?

    private var epoch = UUID()
    private var job: Task<Void, Never>?

    func invalidate() {
        epoch = UUID()
        job?.cancel()
        job = nil
        items = []
        verified = false
        busy = false
        status = nil
    }

    func load(node: XDriveIOSNativeFilesNode, login: XDriveIOSNativeOwnerLoginModel,
              openedOwner: XDriveNativeOwnerRoot) {
        run(node: node, version: nil, login: login, openedOwner: openedOwner,
            onConfirmed: nil)
    }

    func restore(_ version: XDriveIOSNativeFilesVersionRecord,
                 node: XDriveIOSNativeFilesNode,
                 login: XDriveIOSNativeOwnerLoginModel,
                 openedOwner: XDriveNativeOwnerRoot,
                 onConfirmed: @MainActor @escaping () -> Void) {
        guard verified && items.contains(version) else { return }
        run(node: node, version: version, login: login,
            openedOwner: openedOwner, onConfirmed: onConfirmed)
    }

    private func run(node: XDriveIOSNativeFilesNode,
                     version: XDriveIOSNativeFilesVersionRecord?,
                     login: XDriveIOSNativeOwnerLoginModel,
                     openedOwner: XDriveNativeOwnerRoot,
                     onConfirmed: (@MainActor () -> Void)?) {
        guard !busy, job == nil else { return }
        guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, openedOwner) else {
            invalidate()
            status = "当前账户已变化，版本操作不可用。"
            return
        }
        let ticket = UUID()
        epoch = ticket
        busy = true
        status = version == nil ? "正在核对当前文件与历史记录…" : "正在核对当前文件版本…"
        job = Task { @MainActor in
            defer {
                if epoch == ticket {
                    job = nil
                    busy = false
                }
            }
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(auth.owner, openedOwner),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, openedOwner) else {
                    throw XDriveIOSNativeFilesVersionHistoryFailure.invalidScope
                }
                let reader = XDriveIOSNativeFilesVersionTransport(
                    owner: auth.owner, accessToken: auth.accessToken
                )
                if let version {
                    status = "正在请求服务器恢复修订 \(version.revision)，不会自动重试。"
                    try await reader.restore(version, in: node)
                    try Task.checkCancellation()
                    let after = try await login.verifiedAuthorization()
                    guard epoch == ticket,
                          XDriveIOSNativePhotoOwnerScope.matches(after.owner, openedOwner),
                          XDriveIOSNativePhotoOwnerScope.matches(login.owner, openedOwner) else {
                        return
                    }
                    status = "服务器已确认恢复并核对最新修订，正在刷新文件列表。"
                    onConfirmed?()
                } else {
                    let listed = try await reader.load(node)
                    try Task.checkCancellation()
                    let after = try await login.verifiedAuthorization()
                    guard epoch == ticket,
                          XDriveIOSNativePhotoOwnerScope.matches(after.owner, openedOwner),
                          XDriveIOSNativePhotoOwnerScope.matches(login.owner, openedOwner) else {
                        return
                    }
                    items = listed
                    verified = true
                    status = listed.isEmpty ? "当前文件没有可恢复的历史版本。" : nil
                }
            } catch is CancellationError {
                if epoch == ticket {
                    verified = false
                    items = []
                    status = "操作已取消；如果恢复请求已发出，请刷新文件确认，不要重试。"
                }
            } catch {
                guard epoch == ticket else { return }
                verified = false
                items = []
                if let failure = error as? XDriveIOSNativeFilesVersionHistoryFailure {
                    switch failure {
                    case .staleNodeOrVersion, .server(409), .server(412):
                        status = "文件或历史版本已发生变化，请返回列表重新打开。"
                    case .invalidScope, .server(401), .server(403), .server(404):
                        status = "当前账户、权限或文件已变化，无法操作。"
                    default:
                        status = version == nil
                            ? "历史版本读取失败；可检查网络后刷新。"
                            : "恢复结果无法确认；请刷新当前目录核对，不要再次提交。"
                    }
                } else {
                    status = version == nil
                        ? "历史版本读取失败；可检查网络后刷新。"
                        : "恢复结果无法确认；请刷新当前目录核对，不要再次提交。"
                }
            }
        }
    }
}

struct XDriveIOSNativeFilesVersionHistoryScreen: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let openedOwner: XDriveNativeOwnerRoot
    let node: XDriveIOSNativeFilesNode
    let onConfirmed: @MainActor () -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase
    @StateObject private var model = XDriveIOSNativeFilesVersionHistoryModel()
    @State private var pendingVersion: XDriveIOSNativeFilesVersionRecord?
    @State private var confirming = false

    private var ownerValid: Bool {
        XDriveIOSNativePhotoOwnerScope.matches(login.owner, openedOwner)
    }

    var body: some View {
        NavigationStack {
            Form {
                if !ownerValid {
                    Label("服务器或账户已变化，请重新打开文件。",
                          systemImage: "exclamationmark.triangle")
                } else {
                    Section("当前文件") {
                        LabeledContent("名称", value: node.name)
                        LabeledContent("当前修订", value: String(node.revision))
                        LabeledContent("当前大小", value: ByteCountFormatter.string(
                            fromByteCount: node.size, countStyle: .file
                        ))
                    }
                    Section("以前的版本") {
                        if model.busy {
                            ProgressView("正在等待服务器确认…")
                        } else if model.verified && model.items.isEmpty {
                            Text("暂无历史版本").foregroundStyle(.secondary)
                        }
                        ForEach(model.items) { version in
                            VStack(alignment: .leading, spacing: 6) {
                                Text("修订 \(version.revision)")
                                    .font(.headline)
                                Text(ByteCountFormatter.string(
                                    fromByteCount: version.size, countStyle: .file
                                ))
                                Text(version.created_at)
                                    .font(.caption).foregroundStyle(.secondary)
                                Button("恢复这个版本") {
                                    pendingVersion = version
                                    confirming = true
                                }
                                .disabled(model.busy || !model.verified)
                                .accessibilityIdentifier("native-ios-files-restore-\(version.id)")
                            }
                            .padding(.vertical, 4)
                        }
                        Button("刷新版本历史") {
                            pendingVersion = nil
                            model.load(node: node, login: login, openedOwner: openedOwner)
                        }
                        .disabled(model.busy)
                        .accessibilityIdentifier("native-ios-files-versions-refresh")
                    }
                    if let status = model.status {
                        Section {
                            Text(status).font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .navigationTitle("版本历史")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }.disabled(model.busy)
                }
            }
            .confirmationDialog("恢复到选中的历史版本？",
                                isPresented: $confirming, titleVisibility: .visible) {
                Button("确认恢复", role: .destructive) {
                    guard let version = pendingVersion,
                          model.verified, model.items.contains(version),
                          ownerValid else { return }
                    model.restore(version, node: node, login: login,
                                  openedOwner: openedOwner) {
                        dismiss()
                        onConfirmed()
                    }
                    pendingVersion = nil
                }
                Button("取消", role: .cancel) { pendingVersion = nil }
            } message: {
                Text("服务器将保存当前内容的历史修订，并用选中的旧版本替换当前文件。若结果不确定，只刷新核对，不能盲目再次恢复。")
            }
        }
        .onAppear {
            if ownerValid {
                model.load(node: node, login: login, openedOwner: openedOwner)
            }
        }
        .onDisappear {
            pendingVersion = nil
            model.invalidate()
        }
        .onChange(of: login.owner) { _ in
            if !ownerValid {
                pendingVersion = nil
                model.invalidate()
                dismiss()
            }
        }
        .onChange(of: phase) { state in
            if state != .active {
                pendingVersion = nil
                model.invalidate()
            } else if ownerValid {
                model.load(node: node, login: login, openedOwner: openedOwner)
            }
        }
    }
}
