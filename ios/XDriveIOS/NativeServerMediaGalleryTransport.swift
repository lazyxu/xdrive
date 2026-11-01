import AVFoundation
import Foundation
import ImageIO
import SwiftUI
import UIKit

// Canonical Go Server media DTOs, scoped by independently verified Owner/Root.
// The backed-up `-xios-` original list is intentionally a separate source.
struct XDriveIOSNativeMediaItem: Decodable, Identifiable {
    struct Node: Decodable {
        let id: UInt64
        let name: String
        let type: String
        let size: Int64
        let revision: UInt64
    }
    struct Metadata: Decodable {
        let media_kind: String
        let has_thumbnail: Bool
        let container_kind: String?
    }
    struct Resource: Decodable, Equatable {
        let kind: String
        let node_id: UInt64
        let role: String
        let name: String
        let mime_type: String?
        let size: Int64
    }
    let node: Node
    let metadata: Metadata
    let asset_kind: String?
    let live_photo: Bool?
    let resources: [Resource]?

    var id: UInt64 { node.id }
    var isVideo: Bool {
        asset_kind == "video" || metadata.media_kind == "video"
    }
    var isLive: Bool {
        asset_kind == "live_photo" || live_photo == true
    }
    var supportsPreview: Bool {
        node.type == "file" && (isVideo || isLive ||
            asset_kind == "image" || metadata.media_kind == "image")
    }
}

struct XDriveIOSNativeMediaAlbum: Decodable, Identifiable {
    let id: String
    let name: String
    let kind: String
    let item_count: Int
}

struct XDriveIOSNativeMediaRange: Decodable {
    let items: [XDriveIOSNativeMediaItem]
    let total_count: Int
    let offset: Int
    let limit: Int
}

private struct XDriveIOSNativeMediaPreviewTicket: Decodable {
    let url: String
    let kind: String
    let mime_type: String
}

enum XDriveIOSNativeMediaReadFailure: Error {
    case invalidScope
    case invalidPage
    case unsupported
    case response(Int)
    case malformed
    case tooLarge
}

/// Never follow an authenticated Owner request to another origin.
private final class XDriveIOSNativeMediaRejectRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// Read-only native transport. Uses the same Server's documented media
/// endpoints as Web/PWA; never imports a browser cookie or writes CAS.
struct XDriveIOSNativeMediaGalleryReader {
    static let pageSize = 48
    let owner: XDriveNativeOwnerRoot
    let accessToken: String

    private func session() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 25
        return URLSession(
            configuration: configuration,
            delegate: XDriveIOSNativeMediaRejectRedirect(),
            delegateQueue: nil
        )
    }

    private func endpoint(_ path: String, query: [URLQueryItem] = []) throws -> URL {
        guard owner.ownerID > 0, owner.rootNodeID > 0,
              !owner.instanceID.isEmpty, !accessToken.isEmpty,
              let origin = try? ServerAddress.parse(owner.origin.absoluteString),
              origin == owner.origin, path.hasPrefix("/api/v1/"),
              !path.contains("?"), !path.contains("#"),
              var components = URLComponents(url: origin, resolvingAgainstBaseURL: false),
              components.scheme == "https"
        else { throw XDriveIOSNativeMediaReadFailure.invalidScope }
        // Album IDs are individually percent-encoded. Do not double-encode
        // their '%' escapes when constructing the URLComponents path.
        components.percentEncodedPath = path
        components.queryItems = query.isEmpty ? nil : query
        guard let url = components.url else {
            throw XDriveIOSNativeMediaReadFailure.invalidScope
        }
        return url
    }

    private func read(_ url: URL, method: String = "GET",
                      bearer: Bool = true, maximum: Int) async throws -> Data {
        let client = session()
        defer { client.invalidateAndCancel() }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpShouldHandleCookies = false
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if bearer {
            request.setValue("Bearer " + accessToken, forHTTPHeaderField: "Authorization")
        }
        let (bytes, response) = try await client.data(for: request)
        try Task.checkCancellation()
        guard let reply = response as? HTTPURLResponse else {
            throw XDriveIOSNativeMediaReadFailure.malformed
        }
        guard reply.statusCode == 200 else {
            throw XDriveIOSNativeMediaReadFailure.response(reply.statusCode)
        }
        guard bytes.count <= maximum else {
            throw XDriveIOSNativeMediaReadFailure.tooLarge
        }
        return bytes
    }

    private func albumSegment(_ id: String) throws -> String {
        guard !id.isEmpty && id.utf8.count <= 256,
              let escaped = id.addingPercentEncoding(
                withAllowedCharacters: CharacterSet(
                    charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
                )
              ), !escaped.isEmpty else {
            throw XDriveIOSNativeMediaReadFailure.invalidScope
        }
        return escaped
    }

    func page(offset: Int, albumID: String? = nil,
              placeID: String? = nil, search: String = "") async throws -> XDriveIOSNativeMediaRange {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        guard offset >= 0 && offset <= 10_000_000,
              query.unicodeScalars.count <= 200,
              (placeID == nil || (
                  albumID == nil &&
                  XDriveIOSNativeOwnerMapSelectionPolicy.canonicalPlaceID(placeID!)
              )) else {
            throw XDriveIOSNativeMediaReadFailure.invalidPage
        }
        let path: String
        if let albumID {
            path = "/api/v1/media/albums/\(try albumSegment(albumID))/items"
        } else {
            path = "/api/v1/media/items"
        }
        var parameters = [
            URLQueryItem(name: "range", value: "true"),
            URLQueryItem(name: "limit", value: String(Self.pageSize)),
            URLQueryItem(name: "offset", value: String(offset))
        ]
        if !query.isEmpty {
            parameters.append(URLQueryItem(name: "q", value: query))
        }
        if let placeID {
            // Original Server Owner GPS place, never synthetic map-region.
            parameters.append(URLQueryItem(name: "place", value: placeID))
            parameters.append(URLQueryItem(name: "has_location", value: "true"))
        }
        let url = try endpoint(path, query: parameters)
        let data = try await read(url, maximum: 2 * 1_048_576)
        let page = try JSONDecoder().decode(XDriveIOSNativeMediaRange.self, from: data)
        guard page.offset == offset, page.limit == Self.pageSize,
              page.total_count >= 0, page.total_count <= 10_000_000,
              page.items.count <= Self.pageSize,
              page.offset + page.items.count <= page.total_count,
              !(page.items.isEmpty && offset < page.total_count),
              page.items.allSatisfy({
                $0.id > 0 && $0.node.revision > 0 && $0.node.size >= 0 &&
                $0.node.type == "file"
              })
        else { throw XDriveIOSNativeMediaReadFailure.invalidPage }
        return page
    }

    /// Bounded WGS84 Owner map overview; MapKit must never receive BD09.
    /// Reuses this Reader's HTTPS-only, no-redirect authenticated transport.
    func mapOverview(
        bounds: XDriveIOSNativeOwnerMapBounds,
        detail: Bool = false
    ) async throws -> XDriveIOSNativeOwnerMapOverview {
        guard XDriveIOSNativeOwnerMapOverviewPolicy.validBounds(bounds) else {
            throw XDriveIOSNativeMediaReadFailure.invalidPage
        }
        var query = [
            URLQueryItem(name: "west", value: String(bounds.west)),
            URLQueryItem(name: "south", value: String(bounds.south)),
            URLQueryItem(name: "east", value: String(bounds.east)),
            URLQueryItem(name: "north", value: String(bounds.north))
        ]
        if detail { query.append(URLQueryItem(name: "detail", value: "1")) }
        let url = try endpoint("/api/v1/media/places/overview", query: query)
        let bytes = try await read(url, maximum: XDriveIOSNativeOwnerMapOverviewPolicy.maximumBytes)
        let overview = try JSONDecoder().decode(XDriveIOSNativeOwnerMapOverview.self, from: bytes)
        guard XDriveIOSNativeOwnerMapOverviewPolicy.valid(overview) else {
            throw XDriveIOSNativeMediaReadFailure.invalidPage
        }
        return overview
    }

    func albums() async throws -> [XDriveIOSNativeMediaAlbum] {
        let url = try endpoint("/api/v1/media/albums")
        let data = try await read(url, maximum: 2 * 1_048_576)
        let albums = try JSONDecoder().decode([XDriveIOSNativeMediaAlbum].self, from: data)
        guard albums.count <= 2048,
              albums.allSatisfy({
                !$0.id.isEmpty && $0.id.utf8.count <= 256 &&
                $0.item_count >= 0 && $0.item_count <= 10_000_000
              }) else {
            throw XDriveIOSNativeMediaReadFailure.invalidPage
        }
        return albums
    }

    func thumbnail(_ item: XDriveIOSNativeMediaItem) async throws -> UIImage {
        guard item.id > 0, item.node.revision > 0, item.supportsPreview else {
            throw XDriveIOSNativeMediaReadFailure.unsupported
        }
        let url = try endpoint("/api/v1/media/items/\(item.id)/thumbnail", query: [
            URLQueryItem(name: "v", value: "4"),
            URLQueryItem(name: "revision", value: String(item.node.revision))
        ])
        let client = session()
        defer { client.invalidateAndCancel() }
        var request = URLRequest(url: url)
        request.setValue("Bearer " + accessToken, forHTTPHeaderField: "Authorization")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        request.httpShouldHandleCookies = false
        let (bytes, response) = try await client.data(for: request)
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse else {
            throw XDriveIOSNativeMediaReadFailure.malformed
        }
        // Match the paginated Owner Reader: the map must distinguish
        // revoked credentials (401/403) from missing image derivatives.
        // Otherwise it cannot invalidate old pins and cover thumbnails.
        guard http.statusCode == 200 else {
            throw XDriveIOSNativeMediaReadFailure.response(http.statusCode)
        }
        guard bytes.count <= 2 * 1_048_576,
              let kind = http.value(forHTTPHeaderField: "Content-Type")?.lowercased(),
              ["image/jpeg", "image/png", "image/heic", "image/webp"]
                .contains(where: { kind.hasPrefix($0) })
        else { throw XDriveIOSNativeMediaReadFailure.malformed }
        // An unstructured decode doesn't inherit the tile's cancellation.
        // Explicitly propagate L3 foreground preemption into the utility
        // worker, without turning a cancelled thumbnail into a success.
        let decodeWork = Task.detached(priority: .utility) { () -> CGImage? in
            guard !Task.isCancelled,
                  let source = CGImageSourceCreateWithData(
                bytes as CFData, [kCGImageSourceShouldCache: false] as CFDictionary
            ) else { return nil }
            let opts: [String: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways as String: true,
                kCGImageSourceCreateThumbnailWithTransform as String: true,
                kCGImageSourceThumbnailMaxPixelSize as String: 280,
                kCGImageSourceShouldCacheImmediately as String: false
            ]
            let decoded = CGImageSourceCreateThumbnailAtIndex(source, 0, opts as CFDictionary)
            return Task.isCancelled ? nil : decoded
        }
        let image = await withTaskCancellationHandler {
            await decodeWork.value
        } onCancel: {
            decodeWork.cancel()
        }
        try Task.checkCancellation()
        guard let image else { throw XDriveIOSNativeMediaReadFailure.malformed }
        return UIImage(cgImage: image)
    }

    /// A short-lived, same-origin preview ticket is required before playback.
    /// The native access bearer is never part of the signed URL.
    func preview(_ item: XDriveIOSNativeMediaItem) async throws
        -> (image: UIImage?, videoURL: URL?) {
        guard item.supportsPreview else {
            throw XDriveIOSNativeMediaReadFailure.unsupported
        }
        let ticketURL = try endpoint("/api/v1/files/\(item.id)/preview-ticket")
        let data = try await read(ticketURL, method: "POST", maximum: 32_768)
        let ticket = try JSONDecoder().decode(XDriveIOSNativeMediaPreviewTicket.self, from: data)
        guard ticket.url.hasPrefix("/api/v1/file-preview/"),
              !ticket.url.hasPrefix("//"),
              (item.isVideo ? ticket.kind == "video" : ticket.kind == "image"),
              let parsed = URLComponents(string: ticket.url),
              parsed.scheme == nil, parsed.host == nil,
              parsed.user == nil, parsed.password == nil,
              let origin = URLComponents(url: owner.origin, resolvingAgainstBaseURL: false),
              var final = URLComponents(url: owner.origin, resolvingAgainstBaseURL: false)
        else { throw XDriveIOSNativeMediaReadFailure.malformed }
        final.path = parsed.path
        final.percentEncodedQuery = parsed.percentEncodedQuery
        final.fragment = nil
        guard final.scheme == "https",
              final.host == origin.host, final.port == origin.port,
              let signedURL = final.url else {
            throw XDriveIOSNativeMediaReadFailure.malformed
        }
        if item.isVideo { return (nil, signedURL) }
        let still = try await read(signedURL, bearer: false, maximum: 32 * 1_048_576)
        // Preview responses can be compressed yet huge when decoded.
        // Downsample off the MainActor instead of allocating unbounded pixels.
        // The selected Viewer may close or switch Owner while ImageIO decodes
        // the bounded still. Cancel the detached worker with its parent task.
        let decodeWork = Task.detached(priority: .utility) { () -> CGImage? in
            guard !Task.isCancelled,
                  let source = CGImageSourceCreateWithData(
                still as CFData, [kCGImageSourceShouldCache: false] as CFDictionary
            ) else { return nil }
            let options: [String: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways as String: true,
                kCGImageSourceCreateThumbnailWithTransform as String: true,
                kCGImageSourceThumbnailMaxPixelSize as String: 4096,
                kCGImageSourceShouldCacheImmediately as String: false
            ]
            let decoded = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
            return Task.isCancelled ? nil : decoded
        }
        let bounded = await withTaskCancellationHandler {
            await decodeWork.value
        } onCancel: {
            decodeWork.cancel()
        }
        try Task.checkCancellation()
        guard let bounded else {
            throw XDriveIOSNativeMediaReadFailure.malformed
        }
        return (UIImage(cgImage: bounded), nil)
    }
}


/// Read-only native PhotoAsset Live playback. The Server already issues
/// revision/fingerprint-fenced resource tickets for both indexed .livp and
/// verified two-Node Live groups. This reader NEVER extracts a generic ZIP,
/// mints its own media authority or writes a second CAS/media resource.
private enum XDriveIOSNativePhotoAssetLiveMode {
    case container
    case paired
}

extension XDriveIOSNativeMediaGalleryReader {
    private static let maximumStillBytes: Int64 = 64 * 1_048_576
    private static let maximumPairBytes: Int64 = 1_073_741_824

    private func liveMode(_ item: XDriveIOSNativeMediaItem)
        throws -> XDriveIOSNativePhotoAssetLiveMode {
        guard item.id > 0, item.node.revision > 0,
              item.node.type == "file", item.isLive, !item.isVideo,
              item.metadata.media_kind == "image", item.node.size > 0
        else { throw XDriveIOSNativeMediaReadFailure.unsupported }
        if item.metadata.container_kind?.lowercased() == "livp" &&
            item.node.name.lowercased().hasSuffix(".livp") {
            guard UInt64(item.node.size) <= XDriveIOSLivePreviewArchive.maximumArchiveBytes
            else { throw XDriveIOSNativeMediaReadFailure.tooLarge }
            return .container
        }
        // An ordinary still is insufficient proof of a paired motion.
        guard item.asset_kind == "live_photo",
              let resources = item.resources, resources.count == 2,
              let still = resources.first(where: { $0.role == "still" }),
              let motion = resources.first(where: { $0.role == "motion" }),
              still.kind == "node", motion.kind == "node",
              still.node_id == item.id, motion.node_id != item.id,
              still.node_id > 0, motion.node_id > 0,
              still.size > 0, motion.size > 0,
              still.size <= Self.maximumStillBytes,
              motion.size <= Self.maximumPairBytes - still.size,
              (still.mime_type ?? "").hasPrefix("image/"),
              (motion.mime_type ?? "").hasPrefix("video/")
        else { throw XDriveIOSNativeMediaReadFailure.unsupported }
        return .paired
    }

    private func currentLiveItem(_ id: UInt64)
        async throws -> XDriveIOSNativeMediaItem {
        let body = try await read(endpoint("/api/v1/media/items/\(id)"),
                                  maximum: 131_072)
        let item = try JSONDecoder().decode(XDriveIOSNativeMediaItem.self, from: body)
        guard item.id == id else { throw XDriveIOSNativeMediaReadFailure.malformed }
        return item
    }

    private func sameLiveSource(_ first: XDriveIOSNativeMediaItem,
                                _ next: XDriveIOSNativeMediaItem) -> Bool {
        first.id == next.id &&
        first.node.revision == next.node.revision &&
        first.node.name == next.node.name &&
        first.node.type == next.node.type &&
        first.node.size == next.node.size &&
        first.metadata.media_kind == next.metadata.media_kind &&
        first.metadata.container_kind == next.metadata.container_kind &&
        first.asset_kind == next.asset_kind &&
        first.live_photo == next.live_photo &&
        first.resources == next.resources
    }

    private func signedLiveURL(_ ticket: XDriveIOSNativeMediaPreviewTicket,
                               path: String, kind: String) throws -> URL {
        guard ticket.kind == kind, ticket.url.hasPrefix(path + "?"),
              let parsed = URLComponents(string: ticket.url),
              parsed.scheme == nil, parsed.host == nil,
              parsed.user == nil, parsed.password == nil,
              parsed.fragment == nil, parsed.path == path,
              let query = parsed.queryItems, query.count == 1,
              query[0].name == "ticket",
              let secret = query[0].value,
              !secret.isEmpty, secret.utf8.count <= 8192,
              let base = URLComponents(url: owner.origin, resolvingAgainstBaseURL: false),
              base.scheme == "https",
              var result = URLComponents(url: owner.origin, resolvingAgainstBaseURL: false)
        else { throw XDriveIOSNativeMediaReadFailure.malformed }
        result.path = path
        result.percentEncodedQuery = parsed.percentEncodedQuery
        result.fragment = nil
        guard result.scheme == "https", result.host == base.host,
              result.port == base.port, let url = result.url
        else { throw XDriveIOSNativeMediaReadFailure.malformed }
        return url
    }

    private func liveTicket(_ path: String, streamPath: String,
                            kind: String) async throws
        -> (url: URL, mime: String) {
        let data = try await read(endpoint(path), method: "POST", maximum: 32_768)
        let ticket = try JSONDecoder().decode(
            XDriveIOSNativeMediaPreviewTicket.self, from: data
        )
        let mime = ticket.mime_type.lowercased().split(separator: ";", maxSplits: 1)
            .first.map(String.init) ?? ""
        let allowed = kind == "image"
            ? ["image/heic", "image/heif", "image/jpeg"]
            : ["video/quicktime", "video/mp4"]
        guard allowed.contains(mime)
        else { throw XDriveIOSNativeMediaReadFailure.unsupported }
        return (try signedLiveURL(ticket, path: streamPath, kind: kind), mime)
    }

    private func downloadLiveResource(_ ticket: (url: URL, mime: String),
                                      destination: URL, limit: Int64) async throws {
        let client = session()
        defer { client.invalidateAndCancel() }
        var request = URLRequest(url: ticket.url)
        request.httpShouldHandleCookies = false
        request.setValue(ticket.mime, forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        let (temporary, response) = try await client.download(for: request)
        defer { try? FileManager.default.removeItem(at: temporary) }
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse,
              http.statusCode == 200,
              (http.expectedContentLength < 0 ||
                http.expectedContentLength <= limit),
              let actualType = http.value(forHTTPHeaderField: "Content-Type")?
                .lowercased().split(separator: ";", maxSplits: 1).first,
              String(actualType) == ticket.mime,
              let attributes = try? FileManager.default.attributesOfItem(
                atPath: temporary.path
              ),
              (attributes[.type] as? FileAttributeType) == .typeRegular,
              let length = (attributes[.size] as? NSNumber)?.int64Value,
              length > 0, length <= limit
        else { throw XDriveIOSNativeMediaReadFailure.tooLarge }
        try FileManager.default.moveItem(at: temporary, to: destination)
        try FileManager.default.setAttributes(
            [.protectionKey: FileProtectionType.complete], ofItemAtPath: destination.path
        )
        try Task.checkCancellation()
    }

    /// Only a current, verified Owner can reach this reader. Both signed
    /// resources are ephemeral and exact-Node/revision/fingerprint bound by Go.
    /// Even an interrupted download or ImageIO decode removes all staged files.
    func livePreview(_ selected: XDriveIOSNativeMediaItem) async throws
        -> (image: UIImage, files: XDriveIOSLivePreviewFiles) {
        guard !accessToken.isEmpty else {
            throw XDriveIOSNativeMediaReadFailure.invalidScope
        }
        let before = try await currentLiveItem(selected.id)
        guard sameLiveSource(before, selected) else {
            throw XDriveIOSNativeMediaReadFailure.invalidScope
        }
        let mode = try liveMode(before)
        let stillKind = try await liveTicket(
            mode == .container
                ? "/api/v1/media/items/\(selected.id)/live-photo-still-ticket"
                : "/api/v1/files/\(selected.id)/preview-ticket",
            streamPath: mode == .container
                ? "/api/v1/media-live-photo-still/\(selected.id)"
                : "/api/v1/file-preview/\(selected.id)",
            kind: "image"
        )
        let motionKind = try await liveTicket(
            "/api/v1/media/items/\(selected.id)/live-photo-motion-ticket",
            streamPath: "/api/v1/media-live-photo-motion/\(selected.id)",
            kind: "video"
        )
        let manager = FileManager.default
        let directory = manager.temporaryDirectory.appendingPathComponent(
            "xdrive-photoasset-live-" + UUID().uuidString, isDirectory: true
        )
        try manager.createDirectory(at: directory, withIntermediateDirectories: false,
                                    attributes: [.protectionKey: FileProtectionType.complete])
        do {
            let stillExt = stillKind.mime == "image/jpeg"
                ? "jpg" : (stillKind.mime == "image/heic" ? "heic" : "heif")
            let motionExt = motionKind.mime == "video/mp4" ? "mp4" : "mov"
            let stillURL = directory.appendingPathComponent("still." + stillExt)
            let motionURL = directory.appendingPathComponent("motion." + motionExt)
            try await downloadLiveResource(stillKind, destination: stillURL,
                                           limit: Self.maximumStillBytes)
            let stillSize = ((try manager.attributesOfItem(atPath: stillURL.path))[
                .size] as? NSNumber)?.int64Value ?? Self.maximumPairBytes
            let remaining = Self.maximumPairBytes - stillSize
            guard remaining > 0 else { throw XDriveIOSNativeMediaReadFailure.tooLarge }
            try await downloadLiveResource(motionKind, destination: motionURL,
                                           limit: remaining)
            let after = try await currentLiveItem(selected.id)
            guard sameLiveSource(before, after) else {
                throw XDriveIOSNativeMediaReadFailure.invalidScope
            }
            let decoder = Task.detached(priority: .utility) { () -> CGImage? in
                guard !Task.isCancelled,
                      let source = CGImageSourceCreateWithURL(
                        stillURL as CFURL,
                        [kCGImageSourceShouldCache: false] as CFDictionary
                      ), CGImageSourceGetCount(source) > 0 else { return nil }
                let options: [String: Any] = [
                    kCGImageSourceCreateThumbnailFromImageAlways as String: true,
                    kCGImageSourceCreateThumbnailWithTransform as String: true,
                    kCGImageSourceThumbnailMaxPixelSize as String: 4096,
                    kCGImageSourceShouldCacheImmediately as String: false
                ]
                let result = CGImageSourceCreateThumbnailAtIndex(
                    source, 0, options as CFDictionary
                )
                return Task.isCancelled ? nil : result
            }
            let image = await withTaskCancellationHandler {
                await decoder.value
            } onCancel: {
                decoder.cancel()
            }
            try Task.checkCancellation()
            guard let image else { throw XDriveIOSNativeMediaReadFailure.malformed }
            return (UIImage(cgImage: image), XDriveIOSLivePreviewFiles(
                folderURL: directory, stillURL: stillURL, motionURL: motionURL
            ))
        } catch {
            try? manager.removeItem(at: directory)
            throw error
        }
    }
}
