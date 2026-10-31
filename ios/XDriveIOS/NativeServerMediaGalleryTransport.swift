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
    }
    let node: Node
    let metadata: Metadata
    let asset_kind: String?
    let live_photo: Bool?

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
              search: String = "") async throws -> XDriveIOSNativeMediaRange {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        guard offset >= 0 && offset <= 10_000_000,
              query.unicodeScalars.count <= 200 else {
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
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              bytes.count <= 2 * 1_048_576,
              let kind = http.value(forHTTPHeaderField: "Content-Type")?.lowercased(),
              ["image/jpeg", "image/png", "image/heic", "image/webp"]
                .contains(where: { kind.hasPrefix($0) })
        else { throw XDriveIOSNativeMediaReadFailure.malformed }
        let image = await Task.detached(priority: .utility) { () -> CGImage? in
            guard let source = CGImageSourceCreateWithData(
                bytes as CFData, [kCGImageSourceShouldCache: false] as CFDictionary
            ) else { return nil }
            let opts: [String: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways as String: true,
                kCGImageSourceCreateThumbnailWithTransform as String: true,
                kCGImageSourceThumbnailMaxPixelSize as String: 280,
                kCGImageSourceShouldCacheImmediately as String: false
            ]
            return CGImageSourceCreateThumbnailAtIndex(source, 0, opts as CFDictionary)
        }.value
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
        let bounded = await Task.detached(priority: .utility) { () -> CGImage? in
            guard let source = CGImageSourceCreateWithData(
                still as CFData, [kCGImageSourceShouldCache: false] as CFDictionary
            ) else { return nil }
            let options: [String: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways as String: true,
                kCGImageSourceCreateThumbnailWithTransform as String: true,
                kCGImageSourceThumbnailMaxPixelSize as String: 4096,
                kCGImageSourceShouldCacheImmediately as String: false
            ]
            return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
        }.value
        try Task.checkCancellation()
        guard let bounded else {
            throw XDriveIOSNativeMediaReadFailure.malformed
        }
        return (UIImage(cgImage: bounded), nil)
    }
}
