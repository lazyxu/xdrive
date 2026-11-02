import AVFoundation
import AVKit
import Combine
import Foundation
import ImageIO
import Photos
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

// Independent current-Node check for an Owner-root item restored to Photos.
private struct XDriveIOSNativeCloudOriginalProof: Decodable {
    let id: UInt64
    let parent_id: UInt64?
    let name: String
    let type: String
    let size: Int64
    let revision: UInt64
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
    case invalidScope, server(Int), invalidResponse, notSupported, tooLarge
}

// Only an authenticated still *body* over the pixel-preview buffer or
// undecodable by ImageIO can request the existing revision-bound thumbnail.
enum XDriveIOSNativeCloudStillFallback: Error {
    case unavailable
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

    /// Streams at most `maximum` response bytes. URLSession.data(for:) buffers
    /// the complete body before returning, so it cannot enforce an in-memory
    /// preview limit for a very large cloud original. Stop at byte maximum+1
    /// and let the caller choose an explicitly labeled derivative fallback.
    private func readBoundedResponse(
        _ client: URLSession, request: URLRequest, maximum: Int
    ) async throws -> (data: Data, response: HTTPURLResponse) {
        guard maximum > 0 else {
            throw XDriveIOSNativeCloudReadError.invalidScope
        }
        let (stream, response) = try await client.bytes(for: request)
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse else {
            throw XDriveIOSNativeCloudReadError.invalidResponse
        }
        guard http.statusCode == 200 else {
            throw XDriveIOSNativeCloudReadError.server(http.statusCode)
        }

        var data = Data()
        var chunk: [UInt8] = []
        let chunkSize = 64 * 1024
        chunk.reserveCapacity(chunkSize)
        for try await byte in stream {
            // Exactly maximum bytes are accepted. The first excess byte
            // aborts the stream instead of buffering the rest of the file.
            guard data.count + chunk.count < maximum else {
                throw XDriveIOSNativeCloudReadError.tooLarge
            }
            chunk.append(byte)
            if chunk.count == chunkSize {
                data.append(contentsOf: chunk)
                chunk.removeAll(keepingCapacity: true)
                try Task.checkCancellation()
            }
        }
        try Task.checkCancellation()
        if !chunk.isEmpty { data.append(contentsOf: chunk) }
        guard data.count <= maximum else {
            throw XDriveIOSNativeCloudReadError.tooLarge
        }
        return (data, http)
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
        let (bytes, response) = try await readBoundedResponse(
            client, request: request(url), maximum: 2 * 1_048_576
        )
        guard let kind = response.value(forHTTPHeaderField: "Content-Type")?.lowercased(),
              kind.hasPrefix("image/jpeg") || kind.hasPrefix("image/png") ||
                kind.hasPrefix("image/heic") || kind.hasPrefix("image/webp"),
              !bytes.isEmpty else {
            throw XDriveIOSNativeCloudReadError.invalidResponse
        }
        // ImageIO downsamples off the UI actor. Do not decode an untrusted
        // derivative to full-resolution UIImage before bounding its pixels.
        let decodeWork = Task.detached(priority: .utility) { () -> CGImage? in
            guard !Task.isCancelled,
                  let source = CGImageSourceCreateWithData(
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
            let decoded = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
            return Task.isCancelled ? nil : decoded
        }
        let image = await withTaskCancellationHandler {
            await decodeWork.value
        } onCancel: {
            decodeWork.cancel()
        }
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
              XDriveIOSNativeFilesViewerPolicy.validTicketPath(
                ticket.url, nodeID: node.id
              ),
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
        let bytes: Data
        do {
            let response = try await readBoundedResponse(
                client, request: request(url, bearer: false),
                maximum: 32 * 1_048_576
            )
            bytes = response.data
        } catch XDriveIOSNativeCloudReadError.tooLarge {
            // Stop the signed-body stream at 32 MiB; never buffer the
            // remaining original merely to discover it needs a thumbnail.
            throw XDriveIOSNativeCloudStillFallback.unavailable
        }
        // Compressed data size is not a bound on decoded pixels: a small
        // HEIC/JPEG can otherwise expand to an enormous UIImage on MainActor.
        // Decode at most 4096px on a utility actor while keeping the signed
        // preview ticket and verified Owner-scoped request unchanged.
        let decodeWork = Task.detached(priority: .utility) { () -> CGImage? in
            guard !Task.isCancelled, !bytes.isEmpty,
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
            let decoded = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
            return Task.isCancelled ? nil : decoded
        }
        let decoded = await withTaskCancellationHandler {
            await decodeWork.value
        } onCancel: {
            decodeWork.cancel()
        }
        try Task.checkCancellation()
        guard let decoded else {
            throw XDriveIOSNativeCloudStillFallback.unavailable
        }
        return (UIImage(cgImage: decoded), nil)
    }


    private func requireCurrentOriginal(
        _ node: XDriveIOSNativeCloudOriginal, session client: URLSession
    ) async throws {
        let url = try endpoint("/api/v1/nodes/\(node.id)")
        let (data, response) = try await client.data(for: request(url))
        try Task.checkCancellation()
        try check(response, size: data.count, maximum: 65_536)
        let current = try JSONDecoder().decode(
            XDriveIOSNativeCloudOriginalProof.self, from: data
        )
        guard current.id == node.id, current.parent_id == owner.rootNodeID,
              current.name == node.name, current.type == node.type,
              current.size == node.size, current.revision == node.revision
        else { throw XDriveIOSNativeCloudReadError.invalidResponse }
    }

    /// Downloads one original, never a 4096px preview or thumbnail. The
    /// short-lived signed ticket must resolve to this exact Node, on the
    /// already verified Owner origin. The caller deletes the returned folder.
    func downloadOriginalForPhotos(_ node: XDriveIOSNativeCloudOriginal) async throws -> URL {
        let ext = (node.name as NSString).pathExtension.lowercased()
        let supported = (node.isImage &&
            ["jpg", "jpeg", "png", "heic", "heif", "tif", "tiff"].contains(ext)) ||
            (node.isVideo && ["mov", "mp4", "m4v"].contains(ext))
        guard supported, !node.isLiveArchive,
              node.id > 0, node.revision > 0, node.type == "file",
              node.size > 0, node.size <= 4 * 1_073_741_824,
              XDriveIOSBackgroundOriginalNamePolicy.valid(node.name),
              !accessToken.isEmpty
        else { throw XDriveIOSNativeCloudReadError.notSupported }
        let client = session()
        defer { client.invalidateAndCancel() }
        try await requireCurrentOriginal(node, session: client)
        let ticketURL = try endpoint("/api/v1/files/\(node.id)/download-ticket")
        let (ticketBytes, ticketResponse) = try await client.data(
            for: request(ticketURL, method: "POST")
        )
        try Task.checkCancellation()
        try check(ticketResponse, size: ticketBytes.count, maximum: 32_768)
        let ticket = try JSONDecoder().decode(
            XDriveIOSNativeCloudDownloadTicket.self, from: ticketBytes
        )
        let expectedPath = "/api/v1/file-download/\(node.id)"
        guard let parsed = URLComponents(string: ticket.url),
              parsed.scheme == nil, parsed.host == nil,
              parsed.user == nil, parsed.password == nil,
              parsed.fragment == nil, parsed.path == expectedPath,
              let query = parsed.queryItems, query.count == 1,
              query[0].name == "ticket",
              let secret = query[0].value, !secret.isEmpty,
              secret.utf8.count <= 8192,
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
              resolved.port == origin.port, let signedURL = resolved.url
        else { throw XDriveIOSNativeCloudReadError.invalidResponse }

        var download = request(signedURL, bearer: false)
        download.setValue("application/octet-stream", forHTTPHeaderField: "Accept")
        let (temporary, response) = try await client.download(for: download)
        defer { try? FileManager.default.removeItem(at: temporary) }
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse,
              http.statusCode == 200,
              (http.expectedContentLength < 0 ||
                http.expectedContentLength == node.size),
              let attributes = try? FileManager.default.attributesOfItem(
                atPath: temporary.path
              ),
              attributes[.type] as? FileAttributeType == .typeRegular,
              (attributes[.size] as? NSNumber)?.int64Value == node.size
        else { throw XDriveIOSNativeCloudReadError.invalidResponse }
        // Do not import a same-ID replacement or an item moved from Owner root.
        try await requireCurrentOriginal(node, session: client)
        try Task.checkCancellation()

        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(
            "xdrive-ios-restore-\(UUID().uuidString)", isDirectory: true
        )
        try FileManager.default.createDirectory(
            at: folder, withIntermediateDirectories: false,
            attributes: [.posixPermissions: NSNumber(value: 0o700)]
        )
        do {
            // Keep the resource's original extension for PhotoKit's decoder,
            // but never use an untrusted remote basename as a local path.
            let file = folder.appendingPathComponent("original.\(ext)")
            try FileManager.default.moveItem(at: temporary, to: file)
            try Task.checkCancellation()
            return file
        } catch {
            try? FileManager.default.removeItem(at: folder)
            throw error
        }
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
            case .invalidScope, .invalidResponse, .notSupported, .tooLarge:
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
    // Frozen foreground Owner and at most 48 currently loaded backed-up originals.
    let presentingOwner: XDriveNativeOwnerRoot?
    let loadedNodes: [XDriveIOSNativeCloudOriginal]
    let onViewed: ((XDriveIOSNativeCloudOriginal) -> Bool)?
    @State private var activeNode: XDriveIOSNativeCloudOriginal?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase
    @State private var previewRequestID = UUID()
    // Reuse the native Files verified-Node exporter, never a second download writer.
    @StateObject private var exporter = XDriveIOSNativeFilesExportModel()
    @State private var still: UIImage?
    @State private var stillIsThumbnailOnly = false
    @State private var player: AVPlayer?
    @State private var liveResources: XDriveIOSLivePreviewFiles?
    @State private var showingLiveMotion = false
    @State private var nativeLiveReady = false
    @State private var nativeLiveUnavailable = false
    @State private var showsStaticStill = false
    @State private var showChrome = true
    @State private var nativeLivePlaybackRequest: UUID?
    @State private var error: String?
    @State private var photoRestoreEpoch = UUID()
    @State private var photoRestoreTask: Task<Void, Never>?
    @State private var restoringToPhotos = false
    @State private var requestingPhotoRestorePermission = false
    @State private var photoRestoreNotice = ""
    @State private var showsPhotoRestoreNotice = false

    private var viewed: XDriveIOSNativeCloudOriginal { activeNode ?? node }

    private func key(_ item: XDriveIOSNativeCloudOriginal)
        -> XDriveIOSNativePhotoAssetViewerNeighborKey {
        XDriveIOSNativePhotoAssetViewerNeighborKey(
            nodeID: item.id, revision: item.revision,
            previewable: item.isImage || item.isVideo || item.isLiveArchive
        )
    }

    private var currentOwnerAuthorized: Bool {
        guard phase == .active, let owner = presentingOwner else { return false }
        return XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner)
    }

    private var exportNode: XDriveIOSNativeFilesNode? {
        // Files export re-reads this exact Node and rejects a changed revision,
        // parent, name or size before and after the signed original download.
        guard currentOwnerAuthorized, let owner = presentingOwner,
              viewed.type == "file", viewed.id > 0, viewed.revision > 0,
              viewed.size >= 0, viewed.size <= 512 * 1_048_576,
              XDriveIOSBackgroundOriginalNamePolicy.valid(viewed.name)
        else { return nil }
        return XDriveIOSNativeFilesNode(
            id: viewed.id, parent_id: owner.rootNodeID,
            name: viewed.name, type: viewed.type,
            size: viewed.size, revision: viewed.revision
        )
    }

    private var loadedPosition: Int? {
        XDriveIOSNativePhotoAssetViewerNeighborPolicy.loadedIndex(
            current: key(viewed), in: loadedNodes.map(key),
            ownerAuthorized: currentOwnerAuthorized
        )
    }

    private func neighbor(_ direction: Int) -> XDriveIOSNativeCloudOriginal? {
        guard let index = XDriveIOSNativePhotoAssetViewerNeighborPolicy.neighborIndex(
            current: key(viewed), in: loadedNodes.map(key),
            direction: direction, ownerAuthorized: currentOwnerAuthorized
        ) else { return nil }
        return loadedNodes[index]
    }

    private func showNeighbor(_ direction: Int) {
        guard let next = neighbor(direction), onViewed?(next) == true else { return }
        cancelPhotoRestore()
        // Retire the previous signed still/video, Live pair and temporary
        // originals before presenting a different verified loaded Node.
        exporter.invalidate()
        player?.pause()
        player = nil
        still = nil
        stillIsThumbnailOnly = false
        error = nil
        liveResources?.discard()
        liveResources = nil
        showingLiveMotion = false
        nativeLiveReady = false
        nativeLiveUnavailable = false
        showsStaticStill = false
        nativeLivePlaybackRequest = nil
        activeNode = next
        // The previous .task receives cancellation; its request ID cannot
        // update pixels or create a player after this new generation begins.
        previewRequestID = UUID()
    }

    private func toggleChrome() {
        guard currentOwnerAuthorized else { return }
        withAnimation(.easeInOut(duration: 0.18)) { showChrome.toggle() }
    }

    var body: some View {
        NavigationStack {
            Group {
                if viewed.isLiveArchive, let still {
                    VStack(spacing: 10) {
                        if showingLiveMotion, let player {
                            XDriveIOSNativeAVPlayerStatusObserver(
                                player: player,
                                content: VideoPlayer(player: player)
                                    .onAppear {
                                        if currentOwnerAuthorized { player.play() }
                                    }
                                    .onDisappear { player.pause() },
                                onFailed: { playbackLoadFailed($0) }
                            )
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
                                    guard currentOwnerAuthorized,
                                          liveResources?.folderURL == resources.folderURL
                                    else { return }
                                    nativeLiveReady = ready
                                    if !ready { nativeLiveUnavailable = true }
                                }
                                .xdriveCloudLivePhotoPaging { showNeighbor($0) }
                                .simultaneousGesture(TapGesture().onEnded { toggleChrome() })
                                .id(resources.folderURL)
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .accessibilityLabel("云端实况照片，长按播放或左右滑动切换")
                        } else {
                            XDriveIOSNativeZoomablePhotoView(image: still)
                                .onNavigateSwipe { showNeighbor($0) }
                                .onChromeTap { toggleChrome() }
                                .accessibilityLabel("云端 Live 静态原件")
                        }
                        if showChrome {
                        if nativeLiveReady && currentOwnerAuthorized && !showingLiveMotion {
                            HStack(spacing: 12) {
                                Button("播放原生实况") {
                                    guard currentOwnerAuthorized else { return }
                                    showsStaticStill = false
                                    nativeLivePlaybackRequest = UUID()
                                }
                                .accessibilityIdentifier("native-ios-cloud-live-native-playback")
                                Button(showsStaticStill ? "返回原生实况" : "放大静态原件") {
                                    guard currentOwnerAuthorized else { return }
                                    showsStaticStill.toggle()
                                }
                            }
                        }
                        if nativeLiveUnavailable && currentOwnerAuthorized &&
                            !showingLiveMotion {
                            Button("重试原生实况配对") {
                                guard currentOwnerAuthorized, liveResources != nil else { return }
                                // A valid ZIP may fail Photos' first pairing.
                                // Reuse its verified files without redownloading.
                                nativeLivePlaybackRequest = nil
                                nativeLiveReady = false
                                showsStaticStill = false
                                nativeLiveUnavailable = false
                            }
                            .accessibilityIdentifier("native-ios-original-live-pair-retry")
                        }
                        Button(showingLiveMotion ? "返回静态原件" : "播放原始动态视频") {
                            guard currentOwnerAuthorized, player != nil else { return }
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
                        .disabled(!currentOwnerAuthorized || player == nil)
                        .accessibilityIdentifier("native-ios-cloud-live-motion-toggle")
                        Text(nativeLiveUnavailable
                             ? "原生实况配对不可用，仍可查看静态原件和播放原始动态视频。"
                             : "已校验 Live ZIP 双资源；优先显示原生同步实况，保留独立视频回退。")
                            .font(.caption).foregroundStyle(.secondary)
                        }
                        if let error {
                            Text(error).font(.caption).foregroundStyle(.secondary)
                            Button("重试") { retryPreview() }
                                .accessibilityIdentifier("native-ios-original-live-retry")
                        }
                    }
                } else if let still {
                    VStack(spacing: 8) {
                        XDriveIOSNativeZoomablePhotoView(image: still)
                            .onNavigateSwipe { showNeighbor($0) }
                            .onChromeTap { toggleChrome() }
                            .accessibilityLabel("云端照片，可双指缩放或双击放大")
                        if showChrome && stillIsThumbnailOnly {
                            Text("原件适屏预览过大或无法解码；当前仅显示低清缩略图。可重新加载高清原件预览。")
                                .font(.caption).foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal, 8)
                                .accessibilityIdentifier("native-ios-original-still-lowres")
                        }
                    }
                } else if let player {
                    XDriveIOSNativeAVPlayerStatusObserver(
                        player: player,
                        content: VideoPlayer(player: player)
                            .onAppear {
                                if currentOwnerAuthorized { player.play() }
                            }
                            .onDisappear { player.pause() },
                        onFailed: { playbackLoadFailed($0) }
                    )
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
            .overlay(alignment: .topLeading) {
                if showChrome, let still {
                    XDriveIOSNativeViewerQualityPanel(
                        fileName: viewed.name,
                        source: viewed.isLiveArchive
                            ? "实况静态原件 · 适屏解码" :
                            stillIsThumbnailOnly ? "缩略图回退" : "原件 · 适屏解码",
                        image: still,
                        originalBytes: viewed.size,
                        archiveOriginal: viewed.isLiveArchive,
                        liveFiles: liveResources
                    )
                }
            }
            .background(Color.black.ignoresSafeArea())
            .navigationTitle(viewed.isLiveArchive ? "实况照片" :
                viewed.isVideo ? "视频" : "照片")
            .navigationBarTitleDisplayMode(.inline)
            .safeAreaInset(edge: .bottom) {
                if showChrome && (loadedNodes.count > 1 || exporter.status != nil ||
                   (currentOwnerAuthorized && viewed.size > 512 * 1_048_576)) {
                    VStack(spacing: 8) {
                        if let status = exporter.status {
                            Text(status)
                                .font(.caption).foregroundStyle(.secondary)
                                .accessibilityIdentifier("native-ios-original-export-status")
                        }
                        if currentOwnerAuthorized && viewed.size > 512 * 1_048_576 {
                            Text("原件超过目前 512 MiB 的原生导出上限，无法在此直接导出。")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        if loadedNodes.count > 1 {
                            HStack(spacing: 12) {
                                Button("上一项") { showNeighbor(-1) }
                                    .disabled(neighbor(-1) == nil)
                                    .frame(minHeight: 44)
                                    .accessibilityIdentifier("native-ios-original-viewer-previous")
                                Spacer(minLength: 4)
                                Text(loadedPosition.map {
                                    "\($0 + 1)/\(loadedNodes.count)（已加载）"
                                } ?? "当前原件已变化")
                                    .font(.caption).monospacedDigit()
                                    .accessibilityIdentifier("native-ios-original-viewer-position")
                                Spacer(minLength: 4)
                                Button("下一项") { showNeighbor(1) }
                                    .disabled(neighbor(1) == nil)
                                    .frame(minHeight: 44)
                                    .accessibilityIdentifier("native-ios-original-viewer-next")
                            }
                        }
                    }
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    .background(.ultraThinMaterial)
                }
            }
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button { dismiss() } label: {
                        Label("返回图库", systemImage: "chevron.left")
                    }
                    .accessibilityIdentifier("native-ios-original-viewer-back")
                }
                ToolbarItem(placement: .navigationBarLeading) {
                    if let file = exporter.prepared,
                       file.nodeID == viewed.id,
                       file.revision == viewed.revision,
                       currentOwnerAuthorized {
                        ShareLink(item: file.fileURL) {
                            Label("分享或保存原件", systemImage: "square.and.arrow.up")
                        }
                        .accessibilityIdentifier("native-ios-original-share")
                    } else {
                        Button {
                            guard let node = exportNode else { return }
                            exporter.prepare(node, login: login)
                        } label: {
                            Label(exporter.busy ? "正在下载" : "导出原件",
                                  systemImage: "square.and.arrow.up")
                        }
                        .disabled(exporter.busy || exportNode == nil)
                        .accessibilityIdentifier("native-ios-original-export")
                    }
                }
                ToolbarItem(placement: .navigationBarLeading) {
                    if currentOwnerAuthorized, player != nil {
                        Button {
                            retryPreview()
                        } label: {
                            Image(systemName: "arrow.clockwise")
                        }
                        .accessibilityLabel("重新加载云端原件视频")
                        .accessibilityIdentifier("native-ios-original-player-reload")
                    }
                }
                ToolbarItem(placement: .navigationBarLeading) {
                    if currentOwnerAuthorized && stillIsThumbnailOnly {
                        Button { retryPreview() } label: {
                            Image(systemName: "arrow.clockwise")
                        }
                        .accessibilityLabel("重新加载高清原件预览")
                        .accessibilityIdentifier("native-ios-original-still-reload")
                    }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    if restoringToPhotos {
                        ProgressView().accessibilityLabel("正在恢复原件到 iOS 照片")
                    } else {
                        Button {
                            restoreCurrentOriginalToPhotos()
                        } label: {
                            Label("保存到 iOS 照片", systemImage: "square.and.arrow.down")
                        }
                        .disabled(!currentOwnerAuthorized ||
                                  !(viewed.isImage || viewed.isVideo || viewed.isLiveArchive))
                        .accessibilityIdentifier("native-ios-cloud-original-save-to-photos")
                    }
                }
            }
            .toolbar(showChrome ? .visible : .hidden, for: .navigationBar)
            .alert("保存到 iOS 照片", isPresented: $showsPhotoRestoreNotice) {
                Button("完成", role: .cancel) {}
            } message: {
                Text(photoRestoreNotice)
            }
        }
        .preferredColorScheme(.dark)
        .statusBarHidden(!showChrome)
        .onChange(of: viewed.id) { _ in showChrome = true }
        .onChange(of: error) { message in
            if message != nil { showChrome = true }
        }
        .task(id: previewRequestID) {
            guard phase == .active, let before = presentingOwner,
                  XDriveIOSNativePhotoOwnerScope.matches(login.owner, before)
            else { return }
            let target = viewed
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
                if target.isLiveArchive {
                    let live = try await reader.livePreview(target)
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
                    stillIsThumbnailOnly = false
                    player = AVPlayer(url: live.files.motionURL)
                    showingLiveMotion = false
                    nativeLiveReady = false
                    nativeLiveUnavailable = false
                    showsStaticStill = false
                    nativeLivePlaybackRequest = nil
                } else {
                    do {
                        let media = try await reader.preview(target)
                        try Task.checkCancellation()
                        guard phase == .active, previewRequestID == requestID,
                              XDriveIOSNativePhotoOwnerScope.matches(auth.owner, before),
                              XDriveIOSNativePhotoOwnerScope.matches(login.owner, before)
                        else { return }
                        still = media.image
                        stillIsThumbnailOnly = false
                        if let url = media.videoURL {
                            player = AVPlayer(url: url)
                        }
                    } catch XDriveIOSNativeCloudStillFallback.unavailable {
                        // No silent low-res success for videos, Live, tickets,
                        // HTTP failures, denied Owners or cancelled requests.
                        guard target.isImage, !target.isVideo, !target.isLiveArchive
                        else { throw XDriveIOSNativeCloudReadError.notSupported }
                        let thumbnail = try await reader.thumbnail(target)
                        try Task.checkCancellation()
                        guard phase == .active, previewRequestID == requestID,
                              XDriveIOSNativePhotoOwnerScope.matches(auth.owner, before),
                              XDriveIOSNativePhotoOwnerScope.matches(login.owner, before)
                        else { return }
                        still = thumbnail
                        stillIsThumbnailOnly = true
                        error = nil
                    }
                }
            } catch is CancellationError {
                // Scene/Owner/view navigation invalidated the earlier request.
            } catch {
                guard phase == .active, !Task.isCancelled,
                      previewRequestID == requestID,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, before)
                else { return }
                self.error = target.isLiveArchive
                    ? "此 Live ZIP 原件无法读取或未通过双资源校验；请检查空间、网络与权限。"
                    : "此文件的云端预览不可用，未读取其他账户的数据。"
            }
        }
        // Explicitly recover from a failed AVPlayer item instead of leaving
        // a blank native VideoPlayer. A Live still is retained as fallback.
        .onReceive(NotificationCenter.default.publisher(
            for: .AVPlayerItemFailedToPlayToEndTime
        ).receive(on: RunLoop.main)) { notification in
            guard currentOwnerAuthorized,
                  let failed = notification.object as? AVPlayerItem,
                  let playing = player?.currentItem, failed === playing else { return }
            player?.pause()
            player?.replaceCurrentItem(with: nil)
            player = nil
            showingLiveMotion = false
            error = "媒体播放失败，可重新读取当前云端原件。"
        }
        .onChange(of: phase) { state in
            if state != .active {
                showChrome = true
                // The native Photos permission sheet may temporarily mark
                // the scene inactive. There is no network transfer yet: let
                // authorization return, but still cancel on real background.
                if state != .inactive || !requestingPhotoRestorePermission {
                    cancelPhotoRestore()
                }
                exporter.invalidate()
                // Never keep a signed video URL or rendered still alive while
                // the app is inactive/backgrounded. The next foreground
                // request must independently re-verify native Owner/root.
                player?.pause()
                player = nil
                still = nil
                stillIsThumbnailOnly = false
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
            cancelPhotoRestore()
            // Retire the former Owner's signed media URL immediately.
            exporter.invalidate()
            player?.pause()
            player = nil
            still = nil
            stillIsThumbnailOnly = false
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
            cancelPhotoRestore()
            exporter.invalidate()
            player?.pause()
            player = nil
            still = nil
            stillIsThumbnailOnly = false
            liveResources?.discard()
            liveResources = nil
            showingLiveMotion = false
            nativeLiveReady = false
            nativeLiveUnavailable = false
            showsStaticStill = false
            nativeLivePlaybackRequest = nil
        }
    }


    private func cancelPhotoRestore() {
        photoRestoreEpoch = UUID()
        photoRestoreTask?.cancel()
        photoRestoreTask = nil
        restoringToPhotos = false
        requestingPhotoRestorePermission = false
        showsPhotoRestoreNotice = false
    }

    private func canCommitPhotoRestore(
        _ original: XDriveIOSNativeCloudOriginal,
        owner: XDriveNativeOwnerRoot, epoch: UUID
    ) -> Bool {
        currentOwnerAuthorized && !Task.isCancelled &&
        photoRestoreEpoch == epoch &&
        viewed.id == original.id && viewed.revision == original.revision &&
        XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner)
    }

    /// Explicit foreground restore only. PhotoKit receives the real file
    /// or verified still/MOV Live pair, never a downsampled Viewer preview.
    /// This does not alter the Server original or its backup receipt.
    private func restoreCurrentOriginalToPhotos() {
        guard !restoringToPhotos, currentOwnerAuthorized,
              let owner = presentingOwner,
              viewed.isImage || viewed.isVideo || viewed.isLiveArchive
        else { return }
        let original = viewed
        let epoch = UUID()
        photoRestoreEpoch = epoch
        restoringToPhotos = true
        photoRestoreTask = Task { @MainActor in
            defer {
                if photoRestoreEpoch == epoch {
                    restoringToPhotos = false
                    photoRestoreTask = nil
                }
            }
            do {
                // Request add-only access only from the user's restore tap.
                // iOS can mark the app temporarily inactive during its native
                // permission prompt; no download starts until it returns.
                requestingPhotoRestorePermission = true
                let permission = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
                if photoRestoreEpoch == epoch {
                    requestingPhotoRestorePermission = false
                }
                try Task.checkCancellation()
                guard canCommitPhotoRestore(original, owner: owner, epoch: epoch)
                else { return }
                guard permission == .authorized || permission == .limited else {
                    photoRestoreNotice = "请在 iOS 设置中允许 xDrive 向照片添加内容。"
                    showsPhotoRestoreNotice = true
                    return
                }
                let auth = try await login.verifiedAuthorization()
                try Task.checkCancellation()
                guard canCommitPhotoRestore(original, owner: owner, epoch: epoch),
                      XDriveIOSNativePhotoOwnerScope.matches(auth.owner, owner)
                else { return }
                let reader = XDriveIOSNativeCloudOriginalReader(
                    owner: auth.owner, accessToken: auth.accessToken
                )
                if original.isLiveArchive {
                    let verified = try await reader.livePreview(original)
                    defer { verified.files.discard() }
                    guard canCommitPhotoRestore(original, owner: owner, epoch: epoch)
                    else { return }
                    try await PHPhotoLibrary.shared().performChanges {
                        let asset = PHAssetCreationRequest.forAsset()
                        asset.addResource(
                            with: .photo, fileURL: verified.files.stillURL, options: nil
                        )
                        asset.addResource(
                            with: .pairedVideo, fileURL: verified.files.motionURL, options: nil
                        )
                    }
                } else {
                    let file = try await reader.downloadOriginalForPhotos(original)
                    defer {
                        try? FileManager.default.removeItem(at: file.deletingLastPathComponent())
                    }
                    guard canCommitPhotoRestore(original, owner: owner, epoch: epoch)
                    else { return }
                    let resource: PHAssetResourceType = original.isVideo ? .video : .photo
                    try await PHPhotoLibrary.shared().performChanges {
                        let asset = PHAssetCreationRequest.forAsset()
                        asset.addResource(with: resource, fileURL: file, options: nil)
                    }
                }
                try Task.checkCancellation()
                guard canCommitPhotoRestore(original, owner: owner, epoch: epoch)
                else { return }
                photoRestoreNotice = "原件已添加到 iOS 照片，xDrive 云端备份保持不变。"
                showsPhotoRestoreNotice = true
            } catch is CancellationError {
                // Viewer/Owner/scene changed; discard any downloaded originals.
            } catch {
                guard canCommitPhotoRestore(original, owner: owner, epoch: epoch)
                else { return }
                photoRestoreNotice = "保存未完成。请检查照片添加权限、网络、设备空间及原件格式后重试。"
                showsPhotoRestoreNotice = true
            }
        }
    }

    @MainActor
    private func playbackLoadFailed(_ failed: AVPlayerItem) {
        guard currentOwnerAuthorized,
              let playing = player?.currentItem, failed === playing else { return }
        player?.pause()
        player?.replaceCurrentItem(with: nil)
        player = nil
        showingLiveMotion = false
        error = "媒体播放失败，可重新读取当前云端原件。"
    }

    private func retryPreview() {
        guard currentOwnerAuthorized else { return }
        // Do not reuse an expired signed URL, previous player, or old pixels.
        player?.pause()
        player = nil
        still = nil
        stillIsThumbnailOnly = false
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

/// SwiftUI's ForEach identity is the stable Node ID, but a Node revision
/// can change while its tile stays mounted. Tie the tile's private UIImage
/// state to BOTH that revision and the exact verified Owner/root scope.
/// Root revision intentionally isn't part of identity: it changes whenever
/// unrelated originals are backed up and must not refresh every thumbnail.
private struct XDriveIOSNativeCloudOriginalTileIdentity: Hashable {
    let nodeID: UInt64
    let revision: UInt64
    let origin: URL?
    let instanceID: String?
    let ownerID: UInt64?
    let username: String?
    let rootNodeID: UInt64?

    init(node: XDriveIOSNativeCloudOriginal, owner: XDriveNativeOwnerRoot?) {
        nodeID = node.id
        revision = node.revision
        origin = owner?.origin
        instanceID = owner?.instanceID
        ownerID = owner?.ownerID
        username = owner?.username
        rootNodeID = owner?.rootNodeID
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
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var showingGalleryHelp = false
    @StateObject private var model = XDriveIOSNativeCloudOriginalModel()
    @State private var selected: XDriveIOSNativeCloudOriginal?
    // Transient 48-row slice and exact Owner/root of the fullscreen Viewer.
    @State private var viewerOwner: XDriveNativeOwnerRoot?
    @State private var viewerLoadedNodes: [XDriveIOSNativeCloudOriginal] = []
    @State private var viewerReturnNode: XDriveIOSNativeCloudOriginal?
    @AccessibilityFocusState private var accessibilityFocusedNodeID: UInt64?
    @State private var refreshAfterViewer = false
    // An OS BGTask can commit a new original without a foreground writer
    // notification. Revalidate once after returning from an inactive scene.
    @State private var needsForegroundReload = false

    var body: some View {
        ScrollViewReader { returnScroll in
        GeometryReader { viewport in
            // One Owner-scoped read/viewer tree; rotating only changes
            // explanatory copy, not the 48-item page or backup lifecycle.
            let compactGallery = viewport.size.width >= 680 &&
                viewport.size.height < 500 && !dynamicTypeSize.isAccessibilitySize
            ScrollView {
            LazyVStack(alignment: .leading, spacing: compactGallery ? 8 : 12) {
                if !compactGallery {
                    Text("当前账户的 Owner 根目录中，已由 iPhone 原件备份写入的文件。按最近更新时间分批检查，每批最多 48 项。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Text("已检查根目录 \(model.scanned) / \(model.total) 项")
                    .font(.footnote).monospacedDigit()
                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 95, maximum: 150), spacing: 5)],
                    spacing: 9
                ) {
                    ForEach(model.nodes) { node in
                        Button { openViewer(node) } label: {
                            XDriveIOSNativeCloudOriginalTile(
                                node: node, viewerActive: selected != nil,
                                model: model, login: login
                            )
                            // Reset @State thumbnail pixels if an in-place
                            // Server revision or authenticated Owner changes.
                            // ForEach keeps the Node ID for scroll/Viewer focus.
                            .id(XDriveIOSNativeCloudOriginalTileIdentity(
                                node: node, owner: login.owner
                            ))
                        }
                        .buttonStyle(.plain)
                        .id(node.id)
                        .accessibilityFocused($accessibilityFocusedNodeID, equals: node.id)
                        .accessibilityIdentifier("native-ios-cloud-original-tile")
                    }
                }
                if !compactGallery {
                    Text("仅可见项目请求 Server 缩略图；若尚未生成则保留文件图标，不下载大体积原件填充缩略图。")
                        .font(.footnote).foregroundStyle(.secondary)
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
        }
        .navigationTitle("云端备份原件")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button { showingGalleryHelp = true } label: {
                    Image(systemName: "info.circle")
                        .frame(minWidth: 44, minHeight: 44)
                }
                .accessibilityLabel("云端备份原件说明")
                .accessibilityIdentifier("native-ios-cloud-original-layout-help")
            }
        }
        .alert("云端备份原件说明", isPresented: $showingGalleryHelp) {
            Button("完成", role: .cancel) {}
        } message: {
            Text("只显示当前已验证 Owner 根目录中由 iPhone 原件备份写入的文件，每批最多检查 48 项。仅可见项目请求 Server 缩略图；缩略图缺失不代表原件丢失，不下载大体积原件填充。")
        }
        .fullScreenCover(item: $selected, onDismiss: {
            // A new receipt/scene/Owner cannot re-focus an obsolete Node.
            if refreshAfterViewer {
                refreshAfterViewer = false
                model.reload(login: login)
            } else if phase == .active, !needsForegroundReload,
                      let node = viewerReturnNode, let owner = viewerOwner,
                      XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner),
                      model.nodes.contains(where: {
                        $0.id == node.id && $0.revision == node.revision
                      }) {
                returnScroll.scrollTo(node.id, anchor: .center)
                accessibilityFocusedNodeID = node.id
            }
            viewerOwner = nil
            viewerLoadedNodes = []
            viewerReturnNode = nil
        }) { initial in
            XDriveIOSNativeCloudOriginalPreview(
                node: initial, login: login, presentingOwner: viewerOwner,
                loadedNodes: viewerLoadedNodes,
                onViewed: { next in
                    guard phase == .active, !refreshAfterViewer,
                          !needsForegroundReload, selected?.id == initial.id,
                          let owner = viewerOwner,
                          XDriveIOSNativePhotoOwnerScope.matches(login.owner, owner),
                          viewerLoadedNodes.contains(where: {
                            $0.id == next.id && $0.revision == next.revision &&
                            $0.name == next.name && $0.size == next.size &&
                            $0.type == next.type
                          }),
                          model.nodes.contains(where: {
                            $0.id == next.id && $0.revision == next.revision
                          }) else { return false }
                    viewerReturnNode = next
                    accessibilityFocusedNodeID = nil
                    return true
                }
            )
        }
        .onChange(of: selected?.id) { selectedID in
            if selectedID != nil {
                // Do not wait for presenter's onDisappear: SwiftUI can keep
                // the background page mounted while the Viewer is visible.
                model.suspendForViewer()
                accessibilityFocusedNodeID = nil
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
                accessibilityFocusedNodeID = nil
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
            viewerOwner = nil
            viewerLoadedNodes = []
            viewerReturnNode = nil
            accessibilityFocusedNodeID = nil
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

    private func openViewer(_ node: XDriveIOSNativeCloudOriginal) {
        guard phase == .active, let owner = login.owner,
              let index = model.nodes.firstIndex(where: {
                $0.id == node.id && $0.revision == node.revision
              }) else { return }
        // The visible backed-up originals wall can contain multiple 48-row
        // scans, but one Viewer freezes ONLY the already loaded 48-row slice.
        let start = (index / 48) * 48
        viewerLoadedNodes = Array(
            model.nodes[start..<min(start + 48, model.nodes.count)]
        )
        viewerOwner = owner
        viewerReturnNode = node
        accessibilityFocusedNodeID = nil
        selected = node
    }
}
