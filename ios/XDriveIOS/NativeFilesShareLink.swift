import Combine
import Foundation
import SwiftUI
import UIKit

enum XDriveIOSNativeFilesShareFailure: Error {
    case invalidOwner
    case changedNode
    case invalidResponse
    case server(Int)
}

struct XDriveIOSNativeFilesShareRecord: Decodable, Identifiable {
    let id: UInt64
    let node_id: UInt64
    let access: String
    let status: String
}

struct XDriveIOSNativeFilesCreatedShareLink {
    let id: UInt64
    let url: URL
}

private struct XDriveIOSNativeFilesCreatedShareResponse: Decodable {
    let id: UInt64
    let node_id: UInt64
    let access: String
    let status: String
    let token: String
}

private struct XDriveIOSNativeFilesCreateShareBody: Encodable {
    let access: String
    let expires_at: Date?
    let password = ""
}

private final class XDriveIOSNativeFilesShareDenyRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// An Owner-only Server share. The opaque public capability token is returned
/// only once on creation and remains in memory for an explicit native copy/share.
/// Existing share listings deliberately do not reconstruct or store tokens.
struct XDriveIOSNativeFilesShareTransport {
    enum Action {
        case load
        case create(access: String, expiryDays: Int)
        case revoke(UInt64)
    }

    struct Outcome {
        let records: [XDriveIOSNativeFilesShareRecord]
        let created: XDriveIOSNativeFilesCreatedShareLink?
    }

    let owner: XDriveNativeOwnerRoot
    let accessToken: String

    private func endpoint(_ path: String) throws -> URL {
        guard owner.ownerID > 0, owner.rootNodeID > 0,
              !owner.instanceID.isEmpty, !accessToken.isEmpty,
              path.hasPrefix("/api/v1/"), !path.contains("?"), !path.contains("#"),
              let origin = try? ServerAddress.parse(owner.origin.absoluteString),
              origin == owner.origin,
              var parts = URLComponents(url: origin, resolvingAgainstBaseURL: false),
              parts.scheme == "https" else {
            throw XDriveIOSNativeFilesShareFailure.invalidOwner
        }
        parts.path = path
        parts.query = nil
        parts.fragment = nil
        guard let url = parts.url else {
            throw XDriveIOSNativeFilesShareFailure.invalidOwner
        }
        return url
    }

    private func session() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCache = nil
        config.timeoutIntervalForRequest = 25
        return URLSession(configuration: config,
                          delegate: XDriveIOSNativeFilesShareDenyRedirects(),
                          delegateQueue: nil)
    }

    private func send(_ path: String, method: String,
                      body: Data? = nil, expecting expected: Int,
                      maximumBytes: Int, session: URLSession) async throws -> Data {
        var request = URLRequest(url: try endpoint(path))
        request.httpMethod = method
        request.httpShouldHandleCookies = false
        request.setValue("Bearer " + accessToken, forHTTPHeaderField: "Authorization")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await session.data(for: request)
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse else {
            throw XDriveIOSNativeFilesShareFailure.invalidResponse
        }
        guard http.statusCode == expected else {
            throw XDriveIOSNativeFilesShareFailure.server(http.statusCode)
        }
        guard data.count <= maximumBytes else {
            throw XDriveIOSNativeFilesShareFailure.invalidResponse
        }
        return data
    }

    private func list(_ nodeID: UInt64, session: URLSession) async throws
        -> [XDriveIOSNativeFilesShareRecord] {
        let data = try await send("/api/v1/nodes/\(nodeID)/shares",
                                  method: "GET", expecting: 200,
                                  maximumBytes: 1_048_576, session: session)
        let rows = try JSONDecoder().decode([XDriveIOSNativeFilesShareRecord].self, from: data)
        guard rows.count <= 2048, Set(rows.map(\.id)).count == rows.count,
              rows.allSatisfy({
                $0.id > 0 && $0.node_id == nodeID &&
                ["read_only", "view_upload"].contains($0.access) &&
                ["active", "expired", "revoked"].contains($0.status)
              }) else { throw XDriveIOSNativeFilesShareFailure.invalidResponse }
        return rows
    }

    func perform(_ action: Action, node: XDriveIOSNativeFilesNode) async throws -> Outcome {
        guard node.id > 0, node.revision > 0, node.parent_id != nil,
              node.type == "file" || node.isDirectory else {
            throw XDriveIOSNativeFilesShareFailure.changedNode
        }
        let client = session()
        defer { client.invalidateAndCancel() }
        // A stale Files row must not create/revoke a share for a newer Node.
        let snapshot = try await send("/api/v1/nodes/\(node.id)",
                                      method: "GET", expecting: 200,
                                      maximumBytes: 65_536, session: client)
        guard try JSONDecoder().decode(XDriveIOSNativeFilesNode.self, from: snapshot) == node else {
            throw XDriveIOSNativeFilesShareFailure.changedNode
        }
        var created: XDriveIOSNativeFilesCreatedShareLink?
        switch action {
        case .load:
            break
        case .create(let access, let expiryDays):
            guard XDriveIOSNativeFilesShareLinkPolicy.validAccess(
                access, isDirectory: node.isDirectory
            ), XDriveIOSNativeFilesShareLinkPolicy.allowedExpiryDays.contains(expiryDays) else {
                throw XDriveIOSNativeFilesShareFailure.invalidResponse
            }
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            let body = try encoder.encode(XDriveIOSNativeFilesCreateShareBody(
                access: access,
                expires_at: XDriveIOSNativeFilesShareLinkPolicy.expiry(
                    days: expiryDays, now: Date()
                )
            ))
            let response = try await send("/api/v1/nodes/\(node.id)/shares",
                                          method: "POST", body: body,
                                          expecting: 201, maximumBytes: 32_768,
                                          session: client)
            let dto = try JSONDecoder().decode(XDriveIOSNativeFilesCreatedShareResponse.self,
                                                from: response)
            guard dto.id > 0, dto.node_id == node.id, dto.access == access,
                  dto.status == "active",
                  let url = XDriveIOSNativeFilesShareLinkPolicy.url(
                    origin: owner.origin, token: dto.token
                  ) else { throw XDriveIOSNativeFilesShareFailure.invalidResponse }
            created = .init(id: dto.id, url: url)
        case .revoke(let id):
            guard id > 0, try await list(node.id, session: client).contains(where: {
                $0.id == id && $0.status == "active"
            }) else { throw XDriveIOSNativeFilesShareFailure.invalidResponse }
            _ = try await send("/api/v1/shares/\(id)", method: "DELETE",
                               expecting: 204, maximumBytes: 0, session: client)
        }
        let rows = try await list(node.id, session: client)
        if let created {
            guard rows.contains(where: { $0.id == created.id && $0.status == "active" }) else {
                throw XDriveIOSNativeFilesShareFailure.invalidResponse
            }
        }
        return Outcome(records: rows, created: created)
    }
}

@MainActor
final class XDriveIOSNativeFilesShareModel: ObservableObject {
    @Published private(set) var records: [XDriveIOSNativeFilesShareRecord] = []
    @Published private(set) var created: XDriveIOSNativeFilesCreatedShareLink?
    @Published private(set) var busy = false
    @Published private(set) var notice: String?

    private var epoch = UUID()
    private var job: Task<Void, Never>?

    func invalidate() {
        epoch = UUID()
        job?.cancel()
        job = nil
        records = []
        created = nil
        busy = false
        notice = nil
    }

    func load(_ node: XDriveIOSNativeFilesNode, login: XDriveIOSNativeOwnerLoginModel,
              expectedOwner: XDriveNativeOwnerRoot) {
        run(.load, node: node, login: login, expectedOwner: expectedOwner)
    }

    func create(_ node: XDriveIOSNativeFilesNode, access: String, expiryDays: Int,
                login: XDriveIOSNativeOwnerLoginModel, expectedOwner: XDriveNativeOwnerRoot) {
        run(.create(access: access, expiryDays: expiryDays), node: node,
            login: login, expectedOwner: expectedOwner)
    }

    func revoke(_ shareID: UInt64, node: XDriveIOSNativeFilesNode,
                login: XDriveIOSNativeOwnerLoginModel, expectedOwner: XDriveNativeOwnerRoot) {
        guard records.contains(where: { $0.id == shareID && $0.status == "active" }) else { return }
        run(.revoke(shareID), node: node, login: login, expectedOwner: expectedOwner)
    }

    private func run(_ action: XDriveIOSNativeFilesShareTransport.Action,
                     node: XDriveIOSNativeFilesNode,
                     login: XDriveIOSNativeOwnerLoginModel,
                     expectedOwner: XDriveNativeOwnerRoot) {
        guard !busy else { return }
        guard XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner) else {
            invalidate()
            notice = "当前服务器或账户已变化，请重新打开文件。"
            return
        }
        let ticket = UUID()
        epoch = ticket
        busy = true
        notice = "正在向当前服务器验证文件和分享状态…"
        job = Task { @MainActor in
            defer {
                if epoch == ticket {
                    busy = false
                    job = nil
                }
            }
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expectedOwner),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner) else {
                    throw XDriveIOSNativeFilesShareFailure.invalidOwner
                }
                let result = try await XDriveIOSNativeFilesShareTransport(
                    owner: auth.owner, accessToken: auth.accessToken
                ).perform(action, node: node)
                let after = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(after.owner, expectedOwner),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner) else {
                    throw XDriveIOSNativeFilesShareFailure.invalidOwner
                }
                records = result.records
                if let newLink = result.created { created = newLink }
                if let oldLink = created,
                   !records.contains(where: { $0.id == oldLink.id && $0.status == "active" }) {
                    created = nil
                }
                switch action {
                case .load:
                    notice = "已读取当前文件的分享链接状态。"
                case .create:
                    notice = "服务器已确认创建。请立即复制或通过系统分享保存链接。"
                case .revoke:
                    notice = "服务器已确认撤销链接。"
                }
            } catch is CancellationError {
                // Leaving the Files panel cancels disposable reads; unknown
                // write outcomes must not be presented as successful.
            } catch {
                guard epoch == ticket else { return }
                records = []
                if let failure = error as? XDriveIOSNativeFilesShareFailure {
                    switch failure {
                    case .invalidOwner, .changedNode, .server(401), .server(403), .server(404):
                        notice = "账户、文件版本或权限已变化，请刷新文件列表后再操作。"
                        return
                    default: break
                    }
                }
                switch action {
                case .load:
                    notice = "无法读取分享链接，请检查网络后重试。"
                case .create:
                    notice = "创建结果未能确认。请刷新已有链接核对，避免重复创建。"
                case .revoke:
                    notice = "撤销结果未能确认。请刷新已有链接核对，不要重复操作。"
                }
            }
        }
    }
}

struct XDriveIOSNativeFilesShareScreen: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let expectedOwner: XDriveNativeOwnerRoot
    let node: XDriveIOSNativeFilesNode

    @Environment(\.dismiss) private var dismiss
    @StateObject private var model = XDriveIOSNativeFilesShareModel()
    @State private var access = "read_only"
    @State private var expiryDays = 7
    @State private var pendingRevoke: UInt64?
    @State private var confirmingRevoke = false

    private var verified: Bool {
        XDriveIOSNativePhotoOwnerScope.matches(login.owner, expectedOwner)
    }

    var body: some View {
        NavigationStack {
            Form {
                if !verified {
                    Label("服务器或账户已变化，分享操作不可用。",
                          systemImage: "exclamationmark.triangle")
                } else {
                    Section("当前项目") {
                        LabeledContent("名称", value: node.name)
                        LabeledContent("类型", value: node.isDirectory ? "文件夹" : "文件")
                    }
                    Section("创建云端分享链接") {
                        if node.isDirectory {
                            Picker("访问权限", selection: $access) {
                                Text("只读").tag("read_only")
                                Text("查看并上传").tag("view_upload")
                            }
                            .disabled(model.busy)
                        } else {
                            LabeledContent("访问权限", value: "只读")
                        }
                        Picker("有效期", selection: $expiryDays) {
                            Text("1 天").tag(1)
                            Text("7 天").tag(7)
                            Text("30 天").tag(30)
                            Text("永久").tag(0)
                        }
                        .disabled(model.busy)
                        Button("创建分享链接") {
                            model.create(node, access: node.isDirectory ? access : "read_only",
                                         expiryDays: expiryDays, login: login,
                                         expectedOwner: expectedOwner)
                        }
                        .disabled(model.busy)
                        .accessibilityIdentifier("native-ios-files-share-create")
                        if let link = model.created {
                            ShareLink(item: link.url) {
                                Label("通过 iOS 系统分享链接", systemImage: "square.and.arrow.up")
                            }
                            Button("复制分享链接") {
                                UIPasteboard.general.url = link.url
                            }
                            .accessibilityIdentifier("native-ios-files-share-copy-link")
                            Text("仅在本次创建后可复制链接；关闭页面后不能从分享列表找回令牌。")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                        Text("任何获得链接的人均可在有效期内访问指定内容。文件夹“查看并上传”允许访客新增文件。")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    Section("已有链接") {
                        if model.records.isEmpty && !model.busy {
                            Text("没有已加载的分享链接。")
                                .foregroundStyle(.secondary)
                        }
                        ForEach(model.records) { record in
                            HStack {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text("#\(record.id) · \(record.access == "view_upload" ? "查看并上传" : "只读")")
                                    Text(record.status == "active" ? "有效" :
                                         (record.status == "expired" ? "已过期" : "已撤销"))
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                if record.status == "active" {
                                    Button("撤销", role: .destructive) {
                                        pendingRevoke = record.id
                                        confirmingRevoke = true
                                    }
                                    .disabled(model.busy)
                                }
                            }
                        }
                        Button("刷新分享列表") {
                            model.load(node, login: login, expectedOwner: expectedOwner)
                        }
                        .disabled(model.busy)
                        .accessibilityIdentifier("native-ios-files-share-refresh")
                    }
                    if model.busy { ProgressView("正在等待服务器确认…") }
                    if let notice = model.notice {
                        Section { Text(notice).font(.footnote).foregroundStyle(.secondary) }
                    }
                }
            }
            .navigationTitle("云端分享")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { dismiss() }
                        .disabled(model.busy)
                }
            }
            .confirmationDialog("撤销这条分享链接？", isPresented: $confirmingRevoke,
                                titleVisibility: .visible) {
                Button("确认撤销", role: .destructive) {
                    if let shareID = pendingRevoke {
                        model.revoke(shareID, node: node, login: login,
                                     expectedOwner: expectedOwner)
                    }
                    pendingRevoke = nil
                }
                Button("取消", role: .cancel) { pendingRevoke = nil }
            } message: {
                Text("撤销后，已经发出的公开链接将无法再访问。请求结果不明确时先刷新列表。")
            }
        }
        .onAppear { model.load(node, login: login, expectedOwner: expectedOwner) }
        .onDisappear { model.invalidate() }
        .onChange(of: login.owner) { _ in
            if !verified {
                model.invalidate()
                dismiss()
            }
        }
    }
}