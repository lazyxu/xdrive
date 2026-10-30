import AVFoundation
import AVKit
import Combine
import Foundation
import SwiftUI
import UIKit

struct XDriveIOSNativeCloudOriginal: Decodable, Identifiable {
    let id: UInt64
    let name: String
    let type: String
    let size: Int64
    let revision: UInt64

    var isLiveArchive: Bool { name.hasPrefix("Live-xios-") && name.lowercased().hasSuffix(".zip") }
    var isImage: Bool {
        ["jpg", "jpeg", "png", "heic", "heif", "webp", "tif", "tiff"]
            .contains((name as NSString).pathExtension.lowercased())
    }
    var isVideo: Bool {
        ["mov", "mp4", "m4v", "avi"].contains(
            (name as NSString).pathExtension.lowercased()
        )
    }
}

private struct XDriveIOSNativeCloudOriginalPage: Decodable {
    let items: [XDriveIOSNativeCloudOriginal]
    let total_count: Int
    let offset: Int
    let limit: Int
}

private struct XDriveIOSNativeCloudPreviewTicket: Decodable {
    let url: String
    let kind: String
    let mime_type: String
}

enum XDriveIOSNativeCloudReadError: Error {
    case invalidScope, server(Int), invalidResponse, notSupported
}

private final class XDriveIOSNativeRejectReadRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// Exactly the same Owner Files root used by the original backup writer.
/// No PWA cookie, JS bearer or background device grant enters the reader.
struct XDriveIOSNativeCloudOriginalReader {
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
                          delegate: XDriveIOSNativeRejectReadRedirect(),
                          delegateQueue: nil)
    }

    private func endpoint(_ path: String, query: [URLQueryItem] = []) throws -> URL {
        let origin = try ServerAddress.parse(owner.origin.absoluteString)
        guard origin == owner.origin, path.hasPrefix("/api/v1/"),
              var parts = URLComponents(url: origin, resolvingAgainstBaseURL: false)
        else { throw XDriveIOSNativeCloudReadError.invalidScope }
        parts.path = path
        parts.queryItems = query.isEmpty ? nil : query
        guard let result = parts.url else {
            throw XDriveIOSNativeCloudReadError.invalidScope
        }
        return result
    }

    private func request(_ url: URL, method: String = "GET",
                         bearer: Bool = true) -> URLRequest {
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = 25
        req.httpShouldHandleCookies = false
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        if bearer { req.setValue("Bearer " + accessToken, forHTTPHeaderField: "Authorization") }
        return req
    }

    private func check(_ response: URLResponse, size: Int,
                       maximum: Int) throws {
        guard let http = response as? HTTPURLResponse else {
            throw XDriveIOSNativeCloudReadError.invalidResponse
        }
        guard http.statusCode == 200 else {
            throw XDriveIOSNativeCloudReadError.server(http.statusCode)
        }
        guard size <= maximum else {
            throw XDriveIOSNativeCloudReadError.invalidResponse
        }
    }

    func page(offset: Int) async throws -> (nodes: [XDriveIOSNativeCloudOriginal], total: Int) {
        guard owner.ownerID > 0, owner.rootNodeID > 0,
              !owner.instanceID.isEmpty, !accessToken.isEmpty,
              offset >= 0, offset <= 1_000_000 else {
            throw XDriveIOSNativeCloudReadError.invalidScope
        }
        let url = try endpoint("/api/v1/nodes/\(owner.rootNodeID)/children", query: [
            URLQueryItem(name: "offset", value: String(offset)),
            URLQueryItem(name: "limit", value: "48"),
            URLQueryItem(name: "sort", value: "updated"),
            URLQueryItem(name: "order", value: "desc")
        ])
        let client = session()
        defer { client.invalidateAndCancel() }
        let (bytes, reply) = try await client.data(for: request(url))
        try Task.checkCancellation()
        try check(reply, size: bytes.count, maximum: 1_048_576)
        let result = try JSONDecoder().decode(
            XDriveIOSNativeCloudOriginalPage.self, from: bytes
        )
        guard result.offset == offset, result.limit == 48,
              result.total_count >= 0, result.total_count <= 1_000_000,
              result.items.count <= 48 else {
            throw XDriveIOSNativeCloudReadError.invalidResponse
        }
        // Only originals created with the canonical "-xios-" Owner-root
        // namespace are shown here, not every unrelated root folder/file.
        let originals = result.items.filter {
            $0.id > 0 && $0.revision > 0 &&
            $0.type == "file" && $0.size >= 0 &&
            XDriveIOSBackgroundOriginalNamePolicy.valid($0.name)
        }
        return (originals, result.total_count)
    }

    func preview(_ node: XDriveIOSNativeCloudOriginal) async throws
        -> (image: UIImage?, videoURL: URL?) {
        guard node.id > 0, node.revision > 0, node.type == "file",
              XDriveIOSBackgroundOriginalNamePolicy.valid(node.name),
              node.isImage || node.isVideo else {
            throw XDriveIOSNativeCloudReadError.notSupported
        }
        let client = session()
        defer { client.invalidateAndCancel() }
        let path = try endpoint("/api/v1/files/\(node.id)/preview-ticket")
        let (ticketBytes, ticketReply) = try await client.data(
            for: request(path, method: "POST")
        )
        try Task.checkCancellation()
        try check(ticketReply, size: ticketBytes.count, maximum: 32_768)
        let ticket = try JSONDecoder().decode(
            XDriveIOSNativeCloudPreviewTicket.self, from: ticketBytes
        )
        guard ticket.url.hasPrefix("/api/v1/file-preview/"),
              !ticket.url.hasPrefix("//"),
              (node.isImage && ticket.kind == "image") ||
                (node.isVideo && ticket.kind == "video"),
              let parsed = URLComponents(string: ticket.url),
              parsed.scheme == nil, parsed.host == nil,
              parsed.user == nil, parsed.password == nil,
              let origin = URLComponents(
                url: try ServerAddress.parse(owner.origin.absoluteString),
                resolvingAgainstBaseURL: false
              ),
              var final = URLComponents(url: owner.origin, resolvingAgainstBaseURL: false)
        else { throw XDriveIOSNativeCloudReadError.invalidResponse }
        final.path = parsed.path
        final.percentEncodedQuery = parsed.percentEncodedQuery
        final.fragment = nil
        guard final.host == origin.host, final.port == origin.port,
              final.scheme == "https", let url = final.url else {
            throw XDriveIOSNativeCloudReadError.invalidResponse
        }
        if node.isVideo { return (nil, url) }
        // Ticket is a short-lived, same-origin path. Never put the native
        // bearer into the URL or into AVPlayer.
        let (bytes, reply) = try await client.data(
            for: request(url, bearer: false)
        )
        try Task.checkCancellation()
        try check(reply, size: bytes.count, maximum: 32 * 1_048_576)
        guard let image = UIImage(data: bytes) else {
            throw XDriveIOSNativeCloudReadError.invalidResponse
        }
        return (image, nil)
    }
}

@MainActor
final class XDriveIOSNativeCloudOriginalModel: ObservableObject {
    @Published private(set) var nodes: [XDriveIOSNativeCloudOriginal] = []
    @Published private(set) var total = 0
    @Published private(set) var scanned = 0
    @Published private(set) var busy = false
    @Published private(set) var error: String?

    private var epoch = UUID()
    private var work: Task<Void, Never>?

    func cancel() {
        epoch = UUID()
        work?.cancel()
        work = nil
        busy = false
    }

    func reload(login: XDriveIOSNativeOwnerLoginModel) {
        cancel()
        nodes = []
        total = 0
        scanned = 0
        loadNext(login: login)
    }

    func loadNext(login: XDriveIOSNativeOwnerLoginModel) {
        guard !busy, let expected = login.owner,
              scanned == 0 || scanned < total else { return }
        let start = scanned
        let ticket = epoch
        busy = true
        error = nil
        work = Task { @MainActor [weak self] in
            defer { if self?.epoch == ticket { self?.busy = false; self?.work = nil } }
            do {
                let auth = try await login.verifiedAuthorization()
                guard auth.owner == expected else {
                    throw XDriveIOSNativeSessionError.staleSession
                }
                let reply = try await XDriveIOSNativeCloudOriginalReader(
                    owner: expected, accessToken: auth.accessToken
                ).page(offset: start)
                try Task.checkCancellation()
                guard self?.epoch == ticket, login.owner == expected else { return }
                self?.nodes.append(contentsOf: reply.nodes)
                self?.total = reply.total
                self?.scanned = min(reply.total, start + 48)
            } catch {
                guard self?.epoch == ticket else { return }
                self?.error = "无法读取当前账户的云端原件列表，请检查网络与权限后重试。"
            }
        }
    }
}

struct XDriveIOSNativeCloudOriginalPreview: View {
    let node: XDriveIOSNativeCloudOriginal
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    @Environment(\.dismiss) private var dismiss
    @State private var still: UIImage?
    @State private var player: AVPlayer?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Group {
                if node.isLiveArchive {
                    ContentUnavailableView("Live 原件已保存为双资源 ZIP", systemImage: "livephoto",
                        description: Text("本阶段尚未接通云端 Live ZIP 解包及动态播放；不能将 ZIP 当作单张照片。"))
                } else if let still {
                    Image(uiImage: still).resizable().scaledToFit()
                } else if let player {
                    VideoPlayer(player: player)
                        .onAppear { player.play() }
                } else if let error {
                    Text(error).foregroundStyle(.red).padding()
                } else {
                    ProgressView("正在安全读取云端预览…")
                }
            }
            .navigationTitle(node.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("完成") { dismiss() }
                }
            }
        }
        .task(id: node.id) {
            guard !node.isLiveArchive, let before = login.owner else { return }
            do {
                let auth = try await login.verifiedAuthorization()
                let media = try await XDriveIOSNativeCloudOriginalReader(
                    owner: auth.owner, accessToken: auth.accessToken
                ).preview(node)
                try Task.checkCancellation()
                guard before == auth.owner, before == login.owner else { return }
                still = media.image
                if let url = media.videoURL {
                    player = AVPlayer(url: url)
                }
            } catch {
                self.error = "此文件的云端预览不可用，未读取其他账户的数据。"
            }
        }
        .onDisappear {
            player?.pause()
            player = nil
            still = nil
        }
    }
}

/// The verified Owner root is the source of truth. A 48-node page is scanned
/// at a time; non-backup files never masquerade as imported PhotoAssets.
struct XDriveIOSNativeCloudOriginalGallery: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    @StateObject private var model = XDriveIOSNativeCloudOriginalModel()
    @State private var selected: XDriveIOSNativeCloudOriginal?

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                Text("当前账户的 Owner 根目录中，已由 iPhone 原件备份写入的文件。按最近更新时间分批检查，每批最多 48 项。")
                    .font(.footnote).foregroundStyle(.secondary)
                Text("已检查根目录 \(model.scanned) / \(model.total) 项")
                    .font(.footnote).monospacedDigit()
                ForEach(model.nodes) { node in
                    Button { selected = node } label: {
                        HStack(spacing: 12) {
                            Image(systemName: node.isLiveArchive ? "livephoto" :
                                node.isVideo ? "video" : "photo")
                                .frame(width: 28)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(node.name).lineLimit(2)
                                Text("\(node.size) bytes · revision \(node.revision)")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundStyle(.secondary)
                        }.padding(8)
                    }.buttonStyle(.plain)
                    Divider()
                }
                if model.busy { ProgressView("正在验证并读取云端目录…") }
                if let error = model.error {
                    Text(error).foregroundStyle(.red)
                    Button("重试") { model.loadNext(login: login) }
                        .buttonStyle(.bordered)
                }
                if model.scanned < model.total && !model.busy {
                    Button("继续检查下一批") { model.loadNext(login: login) }
                        .buttonStyle(.bordered)
                        .accessibilityIdentifier("native-ios-cloud-next")
                }
                if model.scanned > 0 && model.nodes.isEmpty {
                    Text("已检查的目录页没有 iPhone 备份原件，可继续查找后续页；这不代表全库没有文件。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Button("刷新云端原件") { model.reload(login: login) }
                    .disabled(model.busy)
            }.padding()
        }
        .navigationTitle("云端备份原件")
        .sheet(item: $selected) {
            XDriveIOSNativeCloudOriginalPreview(node: $0, login: login)
        }
        .task { model.reload(login: login) }
        .onDisappear {
            model.cancel()
            selected = nil
        }
    }
}
