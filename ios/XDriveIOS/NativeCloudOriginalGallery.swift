import AVFoundation
import AVKit
import Combine
import Foundation
import ImageIO
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

private struct XDriveIOSNativeCloudDownloadTicket: Decodable {
    let url: String
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

    /// Authenticated, revision-bound derivative for a visible tile only.
    /// Never download a full original merely to render an image grid.
    /// Missing/pending Server thumbnails leave a placeholder instead.
    func thumbnail(_ node: XDriveIOSNativeCloudOriginal) async throws -> UIImage {
        guard node.id > 0, node.revision > 0, node.type == "file",
              XDriveIOSBackgroundOriginalNamePolicy.valid(node.name),
              node.isImage || node.isVideo, !accessToken.isEmpty else {
            throw XDriveIOSNativeCloudReadError.notSupported
        }
        let url = try endpoint("/api/v1/media/items/\(node.id)/thumbnail", query: [
            URLQueryItem(name: "v", value: "4"),
            URLQueryItem(name: "revision", value: String(node.revision))
        ])
        let client = session()
        defer { client.invalidateAndCancel() }
        let (bytes, response) = try await client.data(for: request(url))
        try Task.checkCancellation()
        try check(response, size: bytes.count, maximum: 2 * 1_048_576)
        guard let http = response as? HTTPURLResponse,
              let kind = http.value(forHTTPHeaderField: "Content-Type")?.lowercased(),
              kind.hasPrefix("image/jpeg") || kind.hasPrefix("image/png") ||
                kind.hasPrefix("image/heic") || kind.hasPrefix("image/webp"),
              !bytes.isEmpty else {
            throw XDriveIOSNativeCloudReadError.invalidResponse
        }
        // ImageIO downsamples off the UI actor. Do not decode an untrusted
        // derivative to full-resolution UIImage before bounding its pixels.
        let image = await Task.detached(priority: .utility) { () -> CGImage? in
            guard let source = CGImageSourceCreateWithData(
                bytes as CFData, [kCGImageSourceShouldCache: false] as CFDictionary
            ) else { return nil }
            // NSDictionary keys must be bridged String/NSString, not CFString
            // as a Swift Dictionary key (CFString is not Hashable).
            let options: [String: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways as String: true,
                kCGImageSourceCreateThumbnailWithTransform as String: true,
                kCGImageSourceThumbnailMaxPixelSize as String: 280,
                kCGImageSourceShouldCacheImmediately as String: false
            ]
            return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
        }.value
        try Task.checkCancellation()
        guard let image else {
            throw XDriveIOSNativeCloudReadError.invalidResponse
        }
        return UIImage(cgImage: image)
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
        // Compressed data size is not a bound on decoded pixels: a small
        // HEIC/JPEG can otherwise expand to an enormous UIImage on MainActor.
        // Decode at most 4096px on a utility actor while keeping the signed
        // preview ticket and verified Owner-scoped request unchanged.
        let decoded = await Task.detached(priority: .utility) { () -> CGImage? in
            guard !bytes.isEmpty,
                  let source = CGImageSourceCreateWithData(
                    bytes as CFData,
                    [kCGImageSourceShouldCache: false] as CFDictionary
                  ), CGImageSourceGetCount(source) > 0 else { return nil }
            let options: [String: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways as String: true,
                kCGImageSourceCreateThumbnailWithTransform as String: true,
                kCGImageSourceThumbnailMaxPixelSize as String: 4096,
                kCGImageSourceShouldCacheImmediately as String: false
            ]
            return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
        }.value
        try Task.checkCancellation()
        guard let decoded else {
            throw XDriveIOSNativeCloudReadError.invalidResponse
        }
        return (UIImage(cgImage: decoded), nil)
    }

    /// Fetch the exact verified Owner's original ZIP to a temporary file.
    /// Unlike the grid, this is only called from the foreground L3 Viewer.
    /// The signed download URL is never passed to AVPlayer or persisted.
    func livePreview(_ node: XDriveIOSNativeCloudOriginal) async throws
        -> (image: UIImage, files: XDriveIOSLivePreviewFiles) {
        guard node.isLiveArchive, node.id > 0, node.revision > 0,
              node.type == "file",
              XDriveIOSBackgroundOriginalNamePolicy.valid(node.name),
              node.size > 0,
              UInt64(node.size) <= XDriveIOSLivePreviewArchive.maximumArchiveBytes,
              !accessToken.isEmpty else {
            throw XDriveIOSNativeCloudReadError.notSupported
        }
        let client = session()
        defer { client.invalidateAndCancel() }
        let ticketURL = try endpoint("/api/v1/files/\(node.id)/download-ticket")
        let (ticketData, ticketReply) = try await client.data(
            for: request(ticketURL, method: "POST")
        )
        try Task.checkCancellation()
        try check(ticketReply, size: ticketData.count, maximum: 32_768)
        let ticket = try JSONDecoder().decode(
            XDriveIOSNativeCloudDownloadTicket.self, from: ticketData
        )
        // Only one signed, same-origin path for THIS file ID is accepted.
        let expectedPath = "/api/v1/file-download/\(node.id)"
        guard let parsed = URLComponents(string: ticket.url),
              parsed.scheme == nil, parsed.host == nil,
              parsed.user == nil, parsed.password == nil,
              parsed.fragment == nil, parsed.path == expectedPath,
              let query = parsed.queryItems, query.count == 1,
              query[0].name == "ticket", !(query[0].value ?? "").isEmpty,
              (query[0].value ?? "").utf8.count <= 8192,
              let origin = URLComponents(
                url: try ServerAddress.parse(owner.origin.absoluteString),
                resolvingAgainstBaseURL: false
              ),
              var resolved = URLComponents(url: owner.origin,
                                           resolvingAgainstBaseURL: false)
        else { throw XDriveIOSNativeCloudReadError.invalidResponse }
        resolved.path = expectedPath
        resolved.percentEncodedQuery = parsed.percentEncodedQuery
        resolved.fragment = nil
        guard resolved.scheme == "https", resolved.host == origin.host,
              resolved.port == origin.port, let url = resolved.url else {
            throw XDriveIOSNativeCloudReadError.invalidResponse
        }
        var download = request(url, bearer: false)
        download.setValue("application/zip", forHTTPHeaderField: "Accept")
        let (temporary, response) = try await client.download(for: download)
        defer { try? FileManager.default.removeItem(at: temporary) }
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              let attributes = try? FileManager.default.attributesOfItem(
                atPath: temporary.path
              ),
              (attributes[.type] as? FileAttributeType) == .typeRegular,
              (attributes[.size] as? NSNumber)?.int64Value == node.size else {
            throw XDriveIOSNativeCloudReadError.invalidResponse
        }

        // CRC, local/central ZIP headers, two roles and manifest are validated
        // on a utility worker, using at most 1 MiB per read. No main-thread
        // unzip or unbounded Data for a 1 GiB original pair.
        let decodeWork = Task.detached(priority: .utility) {
            () throws -> (files: XDriveIOSLivePreviewFiles, image: CGImage) in
            let files = try XDriveIOSLivePreviewArchive.extract(temporary)
            do {
                try Task.checkCancellation()
                guard let source = CGImageSourceCreateWithURL(
                    files.stillURL as CFURL,
                    [kCGImageSourceShouldCache: false] as CFDictionary
                ), CGImageSourceGetCount(source) > 0 else {
                    throw XDriveIOSNativeCloudReadError.invalidResponse
                }
                let options: [String: Any] = [
                    kCGImageSourceCreateThumbnailFromImageAlways as String: true,
                    kCGImageSourceCreateThumbnailWithTransform as String: true,
                    kCGImageSourceThumbnailMaxPixelSize as String: 4096,
                    kCGImageSourceShouldCacheImmediately as String: false
                ]
                guard let image = CGImageSourceCreateThumbnailAtIndex(
                    source, 0, options as CFDictionary
                ) else { throw XDriveIOSNativeCloudReadError.invalidResponse }
                try Task.checkCancellation()
                return (files, image)
            } catch {
                files.discard()
                throw error
            }
        }
        // Viewer preemption must cancel *both* remote download and bounded
        // ZIP/decode work rather than letting a detached worker run to 1 GiB.
        let verified = try await withTaskCancellationHandler {
            try await decodeWork.value
        } onCancel: {
            decodeWork.cancel()
        }
        do {
            try Task.checkCancellation()
            return (UIImage(cgImage: verified.image), verified.files)
        } catch {
            verified.files.discard()
            throw error
        }
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
    // Page offsets can overlap when automatic backup inserts new files.
    // Keep tile/Viewer identities unique within this Owner generation.
    private var seenNodeIDs = Set<UInt64>()
    // Never persisted or sent to a URL/JS: one current-Owner bearer in RAM
    // from the last independently verified page request.
    private var currentReader: XDriveIOSNativeCloudOriginalReader?

    /// Opening L3 Viewer retires *all* in-flight page/thumbnail generations
    /// while retaining the verified 48-item wall and visible scroll anchor.
    /// On route/Owner/scene changes the existing invalidate/cancel still wins.
    func suspendForViewer() {
        epoch = UUID()
        work?.cancel()
        work = nil
        busy = false
    }

    func cancel() {
        epoch = UUID()
        currentReader = nil
        work?.cancel()
        work = nil
        busy = false
    }

    func thumbnail(_ node: XDriveIOSNativeCloudOriginal,
                   login: XDriveIOSNativeOwnerLoginModel) async throws -> UIImage {
        let token = epoch
        guard let reader = currentReader,
              XDriveIOSNativePhotoOwnerScope.matches(login.owner, reader.owner)
        else { throw XDriveIOSNativeCloudReadError.invalidScope }
        let picture = try await reader.thumbnail(node)
        try Task.checkCancellation()
        guard epoch == token,
              XDriveIOSNativePhotoOwnerScope.matches(login.owner, reader.owner)
        else { throw XDriveIOSNativeCloudReadError.invalidScope }
        return picture
    }

    /// Share the native PhotoAsset wall's read-failure policy. Previously any
    /// 401/403, malformed page, or TLS failure kept older original filenames
    /// and a stale RAM bearer visible after the Server had denied access.
    /// Only transient transport/rate-limit/server failures may retain a
    /// previously verified Owner page and retry its exact offset.
    private static func canRetainPage(after error: Error) -> Bool {
        if let failure = error as? XDriveIOSNativeCloudReadError {
            switch failure {
            case .server(let status):
                return XDriveIOSNativeMediaPageRetryPolicy
                    .permitsRetainingPreviousPage(httpStatus: status)
            case .invalidScope, .invalidResponse, .notSupported:
                return false
            }
        }
        guard let network = error as? URLError else { return false }
        return XDriveIOSNativeMediaPageRetryPolicy
            .permitsRetainingPreviousPage(urlError: network.code)
    }

    /// Drop all prior Owner rows and the RAM-only thumbnail reader.
    func invalidate() {
        cancel()
        nodes = []
        seenNodeIDs.removeAll()
        total = 0
        scanned = 0
        error = nil
    }

    func reload(login: XDriveIOSNativeOwnerLoginModel) {
        invalidate()
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
                // Verify the exact current Owner before retaining ANY older
                // filenames. A revoked/expired login must retire cached rows
                // even if this is only a follow-up paginated request.
                let auth: (owner: XDriveNativeOwnerRoot, accessToken: String)
                do {
                    auth = try await login.verifiedAuthorization()
                } catch is CancellationError {
                    throw CancellationError()
                } catch {
                    guard self?.epoch == ticket else { return }
                    self?.invalidate()
                    self?.error = "当前账户身份验证失败；已清除旧备份原件列表，请重新登录或重试。"
                    return
                }
                // Async Owner validation can finish after Viewer suspension,
                // route leave, or A -> B account replacement. The retired
                // page must not invalidate a newer Owner's verified wall.
                guard self?.epoch == ticket else { return }
                guard XDriveIOSNativePhotoOwnerScope.matches(auth.owner, expected),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else {
                    self?.invalidate()
                    self?.error = "服务器或 Owner 已变化；旧备份原件列表已清除。"
                    return
                }
                let reply = try await XDriveIOSNativeCloudOriginalReader(
                    owner: expected, accessToken: auth.accessToken
                ).page(offset: start)
                try Task.checkCancellation()
                guard self?.epoch == ticket,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, expected)
                else { return }
                guard let model = self else { return }
                model.currentReader = XDriveIOSNativeCloudOriginalReader(
                    owner: expected, accessToken: auth.accessToken
                )
                // Uploads can move older nodes into both adjacent pages.
                // Retain the first visible occurrence of each node ID.
                for node in reply.nodes {
                    guard model.seenNodeIDs.insert(node.id).inserted else { continue }
                    model.nodes.append(node)
                }
                // Always advance by server rows, NOT new unique tiles.
                model.total = reply.total
                model.scanned = min(reply.total, start + 48)
            } catch is CancellationError {
                // A retired generation must never overwrite the current wall.
            } catch {
                guard self?.epoch == ticket else { return }
                guard XDriveIOSNativeCloudOriginalModel.canRetainPage(after: error) else {
                    self?.invalidate()
                    self?.error = "云端原件访问已失效或数据无效；旧页面已清除，请重新验证账户。"
                    return
                }
                // Retry the same Server offset without discarding an already
                // verified Owner page on a temporary network/503/429 failure.
                self?.error = "云端原件读取暂时失败；已保留已验证页面，可重试当前批次。"
            }
        }
    }
}

struct XDriveIOSNativeCloudOriginalPreview: View {
    let node: XDriveIOSNativeCloudOriginal
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase
    @State private var previewRequestID = UUID()
    @State private var still: UIImage?
    @State private var player: AVPlayer?
    @State private var liveResources: XDriveIOSLivePreviewFiles?
    @State private var showingLiveMotion = false
    @State private var nativeLiveReady = false
    @State private var nativeLiveUnavailable = false
    @State private var showsStaticStill = false
    @State private var nativeLivePlaybackRequest: UUID?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Group {
                if node.isLiveArchive, let still {
                    VStack(spacing: 10) {
                        if showingLiveMotion, let player {
                            VideoPlayer(player: player)
                                .onAppear { player.play() }
                                .onDisappear { player.pause() }
                        } else if let resources = liveResources,
                                  !nativeLiveUnavailable, !showsStaticStill {
                            ZStack {
                                Image(uiImage: still).resizable().scaledToFit()
                                XDriveIOSNativeCloudPairedLivePhotoView(
                                    files: resources,
                                    placeholder: still,
                                    playbackRequest: nativeLivePlaybackRequest
                                ) { ready in
                                    // The async Photos callback must not make a
                                    // retired Owner/scene or old ZIP visible.
                                    guard phase == .active, login.owner != nil,
                                          liveResources?.folderURL == resources.folderURL
                                    else { return }
                                    nativeLiveReady = ready
                                    if !ready { nativeLiveUnavailable = true }
                                }
                                .id(resources.folderURL)
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .accessibilityLabel("云端实况照片，长按播放")
                        } else {
                            XDriveIOSNativeZoomablePhotoView(image: still)
                                .accessibilityLabel("云端 Live 静态原件")
                        }
                        if nativeLiveReady && !showingLiveMotion {
                            HStack(spacing: 12) {
                                Button("播放原生实况") {
                                    showsStaticStill = false
                                    nativeLivePlaybackRequest = UUID()
                                }
                                .accessibilityIdentifier("native-ios-cloud-live-native-playback")
                                Button(showsStaticStill ? "返回原生实况" : "放大静态原件") {
                                    showsStaticStill.toggle()
                                }
                            }
                        }
                        Button(showingLiveMotion ? "返回静态原件" : "播放原始动态视频") {
                            if showingLiveMotion {
                                player?.pause()
                                nativeLivePlaybackRequest = nil
                            } else {
                                // Unmount and cancel PHLivePhoto's pairing before
                                // starting the standalone fallback AVPlayer.
                                nativeLiveReady = false
                            }
                            showingLiveMotion.toggle()
                        }
                        .accessibilityIdentifier("native-ios-cloud-live-motion-toggle")
                        Text(nativeLiveUnavailable
                             ? "原生实况配对不可用，仍可查看静态原件和播放原始动态视频。"
                             : "已校验 Live ZIP 双资源；优先显示原生同步实况，保留独立视频回退。")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                } else if let still {
                    XDriveIOSNativeZoomablePhotoView(image: still)
                        .accessibilityLabel("云端照片，可双指缩放或双击放大")
                } else if let player {
                    VideoPlayer(player: player)
                        .onAppear { player.play() }
                } else if let error {
                    VStack(spacing: 8) {
                        Text(error).foregroundStyle(.red).padding(.horizontal)
                        Button("重试") { retryPreview() }
                            .accessibilityIdentifier("native-ios-original-viewer-retry")
                    }
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
        .task(id: previewRequestID) {
            guard phase == .active, let before = login.owner else { return }
            let requestID = previewRequestID
            do {
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                // Native Owner refresh may complete after an account switch,
                // scene leave, Viewer dismissal or explicit retry. Never
                // dispatch a preview/download-ticket request with the new
                // Owner's bearer for a node selected under the old Owner.
                guard phase == .active, previewRequestID == requestID,
                      XDriveIOSNativePhotoOwnerScope.matches(auth.owner, before),
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, before)
                else { return }
                let reader = XDriveIOSNativeCloudOriginalReader(
                    owner: auth.owner, accessToken: auth.accessToken
                )
                if node.isLiveArchive {
                    let live = try await reader.livePreview(node)
                    // All rejected/retired generations must remove the
                    // temporary originals, even after a slow download/decode.
                    guard !Task.isCancelled, phase == .active,
                          previewRequestID == requestID,
                          XDriveIOSNativePhotoOwnerScope.matches(auth.owner, before),
                          XDriveIOSNativePhotoOwnerScope.matches(login.owner, before)
                    else { live.files.discard(); return }
                    liveResources?.discard()
                    liveResources = live.files
                    still = live.image
                    player = AVPlayer(url: live.files.motionURL)
                    showingLiveMotion = false
                    nativeLiveReady = false
                    nativeLiveUnavailable = false
                    showsStaticStill = false
                    nativeLivePlaybackRequest = nil
                } else {
                    let media = try await reader.preview(node)
                    try Task.checkCancellation()
                    guard phase == .active, previewRequestID == requestID,
                          XDriveIOSNativePhotoOwnerScope.matches(auth.owner, before),
                          XDriveIOSNativePhotoOwnerScope.matches(login.owner, before)
                    else { return }
                    still = media.image
                    if let url = media.videoURL {
                        player = AVPlayer(url: url)
                    }
                }
            } catch is CancellationError {
                // Scene/Owner/view navigation invalidated the earlier request.
            } catch {
                guard phase == .active, !Task.isCancelled,
                      previewRequestID == requestID,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, before)
                else { return }
                self.error = node.isLiveArchive
                    ? "此 Live ZIP 原件无法读取或未通过双资源校验；请检查空间、网络与权限。"
                    : "此文件的云端预览不可用，未读取其他账户的数据。"
            }
        }
        .onChange(of: phase) { state in
            if state != .active {
                // Never keep a signed video URL or rendered still alive while
                // the app is inactive/backgrounded. The next foreground
                // request must independently re-verify native Owner/root.
                player?.pause()
                player = nil
                still = nil
                error = nil
                liveResources?.discard()
                liveResources = nil
                showingLiveMotion = false
                nativeLiveReady = false
                nativeLiveUnavailable = false
                showsStaticStill = false
                nativeLivePlaybackRequest = nil
            }
            previewRequestID = UUID()
        }
        .onChange(of: login.owner) { _ in
            // Retire the former Owner's signed media URL immediately.
            player?.pause()
            player = nil
            still = nil
            error = nil
            liveResources?.discard()
            liveResources = nil
            showingLiveMotion = false
            nativeLiveReady = false
            nativeLiveUnavailable = false
            showsStaticStill = false
            nativeLivePlaybackRequest = nil
            dismiss()
        }
        .onDisappear {
            player?.pause()
            player = nil
            still = nil
            liveResources?.discard()
            liveResources = nil
            showingLiveMotion = false
            nativeLiveReady = false
            nativeLiveUnavailable = false
            showsStaticStill = false
            nativeLivePlaybackRequest = nil
        }
    }

    private func retryPreview() {
        guard phase == .active, login.owner != nil else { return }
        // Do not reuse an expired signed URL, previous player, or old pixels.
        player?.pause()
        player = nil
        still = nil
        error = nil
        liveResources?.discard()
        liveResources = nil
        showingLiveMotion = false
        nativeLiveReady = false
        nativeLiveUnavailable = false
        showsStaticStill = false
        nativeLivePlaybackRequest = nil
        previewRequestID = UUID()
    }
}

/// Only visible native cells request the Owner-authenticated Server derivative.
/// SwiftUI cancels .task on reuse/disappearance. No cache survives Owner switch.
private struct XDriveIOSNativeCloudOriginalTile: View {
    let node: XDriveIOSNativeCloudOriginal
    // A full-screen Viewer must outrank even an already-composed tile.
    let viewerActive: Bool
    @ObservedObject var model: XDriveIOSNativeCloudOriginalModel
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    @State private var thumb: UIImage?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ZStack(alignment: .bottomTrailing) {
                if let thumb {
                    Image(uiImage: thumb)
                        .resizable().scaledToFill()
                        .frame(maxWidth: .infinity).frame(height: 112).clipped()
                } else {
                    Rectangle().fill(Color(uiColor: .secondarySystemGroupedBackground))
                        .overlay {
                            Image(systemName: node.isLiveArchive ? "livephoto" :
                                  node.isVideo ? "video" : node.isImage ? "photo" : "doc")
                                .foregroundStyle(.secondary)
                        }
                        .frame(height: 112)
                }
                if node.isLiveArchive || node.isVideo {
                    Image(systemName: node.isLiveArchive ? "livephoto" : "play.circle.fill")
                        .foregroundStyle(.white).shadow(radius: 3).padding(6)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 8))
            Text(node.name).font(.caption2).lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(ByteCountFormatter.string(fromByteCount: node.size, countStyle: .file))
                .font(.caption2).foregroundStyle(.secondary)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(node.isLiveArchive
            ? "已备份的 Live ZIP：\(node.name)" : node.isVideo
            ? "已备份视频：\(node.name)" : "已备份照片：\(node.name)")
        .task(id: "\(node.id)-\(node.revision)-\(viewerActive)") {
            // Task-ID transition cancels this request even when fullScreenCover
            // keeps the underlying LazyVGrid mounted.
            guard !viewerActive, thumb == nil,
                  node.isImage || node.isVideo else { return }
            do {
                let image = try await model.thumbnail(node, login: login)
                try Task.checkCancellation()
                thumb = image
            } catch {
                // 404/503 or unavailable thumbnail is not an original-file
                // failure; keep the visible type placeholder and file row.
            }
        }
        .onDisappear {
            // Preserve an already decoded <=280px tile under Viewer; discard
            // it on real navigation, while owner changes rebuild the wall.
            if !viewerActive { thumb = nil }
        }
    }
}

/// The verified Owner root is the source of truth. A 48-node page is scanned
/// at a time; non-backup files never masquerade as imported PhotoAssets.
struct XDriveIOSNativeCloudOriginalGallery: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let confirmedOriginalUpdate: XDriveIOSNativePhotoBackupController.ConfirmedOriginalUpdate?
    @Environment(\.scenePhase) private var phase
    @StateObject private var model = XDriveIOSNativeCloudOriginalModel()
    @State private var selected: XDriveIOSNativeCloudOriginal?
    @State private var refreshAfterViewer = false
    // An OS BGTask can commit a new original without a foreground writer
    // notification. Revalidate once after returning from an inactive scene.
    @State private var needsForegroundReload = false

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                Text("当前账户的 Owner 根目录中，已由 iPhone 原件备份写入的文件。按最近更新时间分批检查，每批最多 48 项。")
                    .font(.footnote).foregroundStyle(.secondary)
                Text("已检查根目录 \(model.scanned) / \(model.total) 项")
                    .font(.footnote).monospacedDigit()
                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 95, maximum: 150), spacing: 5)],
                    spacing: 9
                ) {
                    ForEach(model.nodes) { node in
                        Button { selected = node } label: {
                            XDriveIOSNativeCloudOriginalTile(
                                node: node, viewerActive: selected != nil,
                                model: model, login: login
                            )
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("native-ios-cloud-original-tile")
                    }
                }
                Text("仅可见项目请求 Server 缩略图；若尚未生成则保留文件图标，不下载大体积原件填充缩略图。")
                    .font(.footnote).foregroundStyle(.secondary)
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
        .fullScreenCover(item: $selected, onDismiss: {
            // Never discard an actively playing signed preview. Re-read
            // after the Viewer closes and only for the current Owner.
            if refreshAfterViewer {
                refreshAfterViewer = false
                model.reload(login: login)
            }
        }) {
            XDriveIOSNativeCloudOriginalPreview(node: $0, login: login)
        }
        .onChange(of: selected?.id) { selectedID in
            if selectedID != nil {
                // Do not wait for presenter's onDisappear: SwiftUI can keep
                // the background page mounted while the Viewer is visible.
                model.suspendForViewer()
            }
        }
        .task {
            guard phase == .active else {
                needsForegroundReload = true
                return
            }
            model.reload(login: login)
        }
        .onChange(of: phase) { state in
            if state != .active {
                // Stop directory/thumbnail work while the App is inactive.
                // Keep the selected full-screen Viewer identity for return.
                needsForegroundReload = true
                model.cancel()
                return
            }
            guard needsForegroundReload else { return }
            needsForegroundReload = false
            guard login.owner != nil else {
                refreshAfterViewer = false
                model.invalidate()
                return
            }
            if selected != nil {
                // Never replace the active Viewer with a background refresh.
                refreshAfterViewer = true
            } else {
                // Fresh native Owner/root verification happens in loadNext.
                // Re-reading entries is NOT an upload-success receipt.
                model.reload(login: login)
            }
        }
        .onChange(of: confirmedOriginalUpdate) { update in
            guard let update,
                  XDriveIOSNativePhotoOwnerScope.matches(login.owner, update.owner)
            else { return }
            if phase != .active {
                needsForegroundReload = true
                if selected != nil { refreshAfterViewer = true }
                return
            }
            if selected != nil {
                refreshAfterViewer = true
            } else {
                model.reload(login: login)
            }
        }
        .onChange(of: login.owner) { _ in
            // Old Owner's pending refresh must never select the next Owner.
            refreshAfterViewer = false
            selected = nil
            model.invalidate()
            if login.owner != nil {
                if phase == .active {
                    model.reload(login: login)
                } else {
                    needsForegroundReload = true
                }
            }
        }
        .onDisappear {
            // Presenting a full-screen Viewer may make the wall disappear.
            // Its selected identity must survive that presentation; Owner
            // changes independently clear selection and invalidate the model.
            if selected == nil {
                refreshAfterViewer = false
                model.invalidate()
            }
        }
    }
}
