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
        let captured_at: String?
        let latitude: Double?
        let longitude: Double?
        let thumbnail_version: String?
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
    let content_key: String?
    var contentIdentity: String { content_key ?? "legacy:\(node.id):\(node.revision)" }
    var validContentIdentity: Bool { content_key.map(XDriveIOSNativePhotoContentPolicy.valid) ?? true }
    let asset_id: UInt64?
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

struct XDriveIOSNativeMediaDateGroup: Decodable, Equatable {
    let key: String
    let item_count: Int
    let start_index: Int
}

struct XDriveIOSNativeMediaDateGroupSets: Decodable {
    let year: [XDriveIOSNativeMediaDateGroup]
    let month: [XDriveIOSNativeMediaDateGroup]
    let day: [XDriveIOSNativeMediaDateGroup]
}

struct XDriveIOSNativeMediaRange: Decodable {
    let items: [XDriveIOSNativeMediaItem]
    let total_count: Int
    let offset: Int
    let limit: Int
    // Complete Owner-filtered timeline from offset-zero Server Range only.
    // Date indices never authorize opening a media Node.
    let timeline_group_sets: XDriveIOSNativeMediaDateGroupSets?

    // Keep four-argument fixture/production initializers source-compatible.
    init(items: [XDriveIOSNativeMediaItem], total_count: Int,
         offset: Int, limit: Int,
         timeline_group_sets: XDriveIOSNativeMediaDateGroupSets? = nil) {
        self.items = items
        self.total_count = total_count
        self.offset = offset
        self.limit = limit
        self.timeline_group_sets = timeline_group_sets
    }
}

/// An index is a hint for choosing a 48-item range, never media authorization.
/// All displayed Nodes must still pass the normal Owner Reader and revision checks.
struct XDriveIOSNativeOwnerPlaceDateJump: Equatable {
    let key: String
    let startIndex: Int
    let offset: Int
}

enum XDriveIOSNativeOwnerPlaceDateIndexPolicy {
    private static func utcDate(_ day: String) -> Date? {
        let parts = day.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0].count == 4,
              parts[1].count == 2, parts[2].count == 2,
              let y = Int(parts[0]), let m = Int(parts[1]), let d = Int(parts[2]),
              y > 0, (1...12).contains(m), (1...31).contains(d) else { return nil }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(secondsFromGMT: 0)!
        guard let date = cal.date(from: DateComponents(year: y, month: m, day: d))
        else { return nil }
        let verified = cal.dateComponents([.year, .month, .day], from: date)
        return verified.year == y && verified.month == m && verified.day == d
            ? date : nil
    }

    private static func validKey(_ key: String, scale: XDriveIOSNativePhotoWallTimeScale) -> Bool {
        switch scale {
        case .all: return false
        case .year:
            return key.count == 4 && key.allSatisfy { $0.isASCII && $0.isNumber }
                && Int(key).map { $0 > 0 } == true
        case .month:
            return key.count == 7 && key[key.index(key.startIndex, offsetBy: 4)] == "-"
                && utcDate(key + "-01") != nil
        case .day:
            return utcDate(key) != nil
        }
    }

    static func accepts(_ sets: XDriveIOSNativeMediaDateGroupSets, total: Int) -> Bool {
        guard total > 0, total <= 10_000_000 else { return false }
        let modes: [(XDriveIOSNativePhotoWallTimeScale, [XDriveIOSNativeMediaDateGroup])] =
            [(.year, sets.year), (.month, sets.month), (.day, sets.day)]
        for (scale, groups) in modes {
            guard !groups.isEmpty && groups.count <= total else { return false }
            var counted = 0
            var lastKnown: String?
            var ascending: Bool?
            var hasKnown = false
            var hasUnknown = false
            for (position, group) in groups.enumerated() {
                guard group.start_index == counted, group.item_count > 0,
                      group.item_count <= total - counted else { return false }
                counted += group.item_count
                if group.key == "unknown" {
                    // A single unknown date bucket may occur only at one edge.
                    if hasUnknown || (position != 0 && position != groups.count - 1) {
                        return false
                    }
                    hasUnknown = true
                    continue
                }
                guard validKey(group.key, scale: scale) else { return false }
                hasKnown = true
                if let previous = lastKnown {
                    guard group.key != previous else { return false }
                    let increasing = group.key > previous
                    if let ascending, ascending != increasing { return false }
                    ascending = increasing
                }
                lastKnown = group.key
            }
            guard counted == total && hasKnown else { return false }
        }
        return true
    }

    /// Only for old Server responses whose single <=48 row page is the
    /// entire authorized place, with a real monotonic capture-date ordering.
    static func legacyCompleteIndex(
        _ page: XDriveIOSNativeMediaRange
    ) -> XDriveIOSNativeMediaDateGroupSets? {
        guard page.offset == 0, page.total_count > 0, page.total_count <= 48,
              page.items.count == page.total_count else { return nil }
        var days: [String] = []
        for item in page.items {
            guard let timestamp = item.metadata.captured_at else {
                days.append("unknown")
                continue
            }
            let day = String(timestamp.prefix(10))
            guard validKey(day, scale: .day) else { return nil }
            days.append(day)
        }
        let known = days.filter { $0 != "unknown" }
        guard let first = known.first, let last = known.last else { return nil }
        let descending = first >= last
        for i in 1..<known.count {
            if (descending && known[i] > known[i - 1]) ||
               (!descending && known[i] < known[i - 1]) {
                return nil
            }
        }
        func collapse(_ scale: XDriveIOSNativePhotoWallTimeScale)
            -> [XDriveIOSNativeMediaDateGroup]? {
            var result: [XDriveIOSNativeMediaDateGroup] = []
            var seen = Set<String>()
            for (i, day) in days.enumerated() {
                let key: String = day == "unknown" ? "unknown" :
                    scale == .year ? String(day.prefix(4)) :
                    scale == .month ? String(day.prefix(7)) : day
                if let last = result.last, last.key == key {
                    result[result.count - 1] = XDriveIOSNativeMediaDateGroup(
                        key: key, item_count: last.item_count + 1,
                        start_index: last.start_index)
                } else {
                    if !seen.insert(key).inserted { return nil }
                    result.append(XDriveIOSNativeMediaDateGroup(
                        key: key, item_count: 1, start_index: i))
                }
            }
            return result
        }
        guard let y = collapse(.year), let m = collapse(.month),
              let d = collapse(.day) else { return nil }
        let sets = XDriveIOSNativeMediaDateGroupSets(year: y, month: m, day: d)
        return accepts(sets, total: page.total_count) ? sets : nil
    }

    /// O(log days) seek, with at most two verified candidate groups. UTC
    /// date keys are chosen from the calendar day explicitly selected in UI.
    static func nearestDay(
        _ requested: Date, index: XDriveIOSNativeMediaDateGroupSets,
        total: Int, pageSize: Int
    ) -> XDriveIOSNativeOwnerPlaceDateJump? {
        guard total > 0, pageSize > 0 else { return nil }
        let parts = Calendar.current.dateComponents([.year, .month, .day], from: requested)
        guard let y = parts.year, let m = parts.month, let d = parts.day else { return nil }
        let key = String(format: "%04d-%02d-%02d", y, m, d)
        guard let requestedUTC = utcDate(key) else { return nil }
        let days = index.day
        let start = days.first?.key == "unknown" ? 1 : 0
        let end = days.last?.key == "unknown" ? days.count - 1 : days.count
        guard start < end else { return nil }
        let ascending = end - start < 2 || days[start].key < days[start + 1].key
        var low = start
        var high = end
        while low < high {
            let mid = low + (high - low) / 2
            let moveRight = ascending ? days[mid].key < key : days[mid].key > key
            if moveRight { low = mid + 1 } else { high = mid }
        }
        var chosen: XDriveIOSNativeMediaDateGroup?
        var smallest = Double.infinity
        for position in [low - 1, low] where position >= start && position < end {
            let day = days[position]
            guard let timestamp = utcDate(day.key) else { return nil }
            let distance = abs(timestamp.timeIntervalSince(requestedUTC))
            if distance < smallest {
                smallest = distance
                chosen = day
            }
        }
        guard let chosen, chosen.start_index >= 0,
              chosen.start_index < total else { return nil }
        return XDriveIOSNativeOwnerPlaceDateJump(
            key: chosen.key, startIndex: chosen.start_index,
            offset: (chosen.start_index / pageSize) * pageSize)
    }
}

/// Exact per-item identity for a resumed native cloud Viewer. A matching
/// Node ID by itself cannot prove the same media revision, Live pair,
/// thumbnail classification or original bytes after Server reindexing.
extension XDriveIOSNativeMediaItem {
    func sameVisibleRevision(as rhs: Self) -> Bool {
        node.id == rhs.node.id &&
        node.revision == rhs.node.revision &&
        node.name == rhs.node.name &&
        node.type == rhs.node.type &&
        node.size == rhs.node.size &&
        metadata.media_kind == rhs.metadata.media_kind &&
        metadata.has_thumbnail == rhs.metadata.has_thumbnail &&
        metadata.container_kind == rhs.metadata.container_kind &&
        metadata.latitude == rhs.metadata.latitude &&
        metadata.longitude == rhs.metadata.longitude &&
        content_key == rhs.content_key &&
        asset_id == rhs.asset_id &&
        metadata.thumbnail_version == rhs.metadata.thumbnail_version &&
        asset_kind == rhs.asset_kind &&
        live_photo == rhs.live_photo &&
        resources == rhs.resources
    }
}

extension XDriveIOSNativeMediaRange {
    func sameVisibleSnapshot(as rhs: Self) -> Bool {
        offset == rhs.offset && limit == rhs.limit &&
        total_count == rhs.total_count &&
        items.count == rhs.items.count &&
        zip(items, rhs.items).allSatisfy { $0.sameVisibleRevision(as: $1) }
    }
}

private struct XDriveIOSNativeMediaPreviewTicket: Decodable {
    let url: String
    let kind: String
    let mime_type: String
}

private struct XDriveIOSNativeMediaOriginalDownloadTicket: Decodable {
    let url: String
}

enum XDriveIOSNativeMediaReadFailure: Error {
    case invalidScope
    case invalidPage
    case unsupported
    case response(Int)
    case malformed
    case tooLarge
}

// This specifically means the *image body* exceeded the native preview
// buffer or ImageIO could not decode it. It never converts bad tickets,
// denied Owner access or transient HTTP failures into a successful preview.
enum XDriveIOSNativeMediaStillPreviewFallback: Error {
    case unavailable
}

/// Never follow an authenticated Owner request to another origin.
private final class XDriveIOSNativeMediaRejectRedirect: XDriveIOSServerTLSDelegate, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// Owner-authenticated native media transport including explicit OCR queue requests.
/// Uses the HTTPS endpoints shared with Web/PWA; never imports cookies or writes CAS.
struct XDriveIOSNativeMediaGalleryReader {
    static let pageSize = 48
    let owner: XDriveNativeOwnerRoot
    let accessToken: String
    // Only map-scoped Readers carry this immutable filter snapshot.
    var mapSelection: XDriveIOSNativeOwnerMapSelection? = nil

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
                      bearer: Bool = true, maximum: Int, body: Data? = nil, expectedStatus: Int = 200) async throws -> Data {
        let client = session()
        defer { client.invalidateAndCancel() }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpShouldHandleCookies = false
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if bearer {
            request.setValue("Bearer " + accessToken, forHTTPHeaderField: "Authorization")
        }
        let (stream, response) = try await client.bytes(for: request)
        try Task.checkCancellation()
        guard let reply = response as? HTTPURLResponse else {
            throw XDriveIOSNativeMediaReadFailure.malformed
        }
        guard reply.statusCode == expectedStatus else {
            throw XDriveIOSNativeMediaReadFailure.response(reply.statusCode)
        }
        guard maximum > 0 else {
            throw XDriveIOSNativeMediaReadFailure.malformed
        }
        var bytes = Data()
        var chunk: [UInt8] = []
        let chunkSize = 64 * 1024
        chunk.reserveCapacity(chunkSize)
        for try await byte in stream {
            // Accept exactly maximum bytes; stop at maximum+1 without
            // materializing the rest of an untrusted preview response.
            guard bytes.count + chunk.count < maximum else {
                throw XDriveIOSNativeMediaReadFailure.tooLarge
            }
            chunk.append(byte)
            if chunk.count == chunkSize {
                bytes.append(contentsOf: chunk)
                chunk.removeAll(keepingCapacity: true)
                try Task.checkCancellation()
            }
        }
        try Task.checkCancellation()
        if !chunk.isEmpty { bytes.append(contentsOf: chunk) }
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

    func ocr(_ target: XDriveIOSNativeOCRTarget) async throws -> XDriveIOSNativeOCRResult? {
        guard target.id > 0, target.revision > 0, target.size >= 0 else {
            throw XDriveIOSNativeMediaReadFailure.invalidScope
        }
        let bytes = try await read(try endpoint("/api/v1/media/items/\(target.id)"), maximum: 128 * 1024)
        return try XDriveIOSNativeOCRPolicy.detail(bytes, target: target)
    }

    /// Explicit whole-Owner reanalysis: same durable queue as Web; one POST, no retry.
    func reanalyzeOCR() async throws {
        let body = try JSONEncoder().encode(["kinds": ["smart_search"]])
        let bytes = try await read(try endpoint("/api/v1/photo-intelligence/reanalyze"),
            method: "POST", maximum: 4096, body: body, expectedStatus: 202)
        try XDriveIOSNativeOCRPolicy.acceptReanalysis(bytes, ownerID: owner.ownerID)
    }

    func page(offset: Int, albumID: String? = nil,
              placeID: String? = nil, search: String = "",
              person: XDriveIOSNativeMediaPerson? = nil,
              captureRange: XDriveIOSNativePhotoMapCaptureRange? = nil)
        async throws -> XDriveIOSNativeMediaRange {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        guard offset >= 0 && offset <= 10_000_000,
              query.unicodeScalars.count <= 200,
              (captureRange == nil || captureRange!.valid),
              (mapSelection == nil || mapSelection!.valid),
              (person == nil || (person!.isValid && albumID == nil && placeID == nil)),
              (placeID == nil || (
                  albumID == nil &&
                  XDriveIOSNativeOwnerMapSelectionPolicy.canonicalPlaceID(placeID!)
              )) else {
            throw XDriveIOSNativeMediaReadFailure.invalidPage
        }
        let path: String
        if let person {
            path = "/api/v1/media/people/\(person.suggested ? "suggestions" : "identities")/\(try albumSegment(person.id))/items"
        } else if let albumID {
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
        if let captureRange {
            parameters.append(URLQueryItem(name: "captured_from",
                                           value: captureRange.fromRFC3339))
            parameters.append(URLQueryItem(name: "captured_to",
                                           value: captureRange.toRFC3339))
            // Explicit UTC instants are independent from the Owner device's
            // day boundary while retaining the calendar-selected membership.
        }
        if let placeID {
            // Original Server Owner GPS place, never synthetic map-region.
            parameters.append(URLQueryItem(name: "place", value: placeID))
            parameters.append(URLQueryItem(name: "has_location", value: "true"))
            // Never fall back to an unfiltered old-Server range on 400.
            if let mapSelection { parameters += mapSelection.queryItems }
        }
        let url = try endpoint(path, query: parameters)
        // Offset-zero place Ranges can include up to 100k date groups;
        // preserve a finite 8 MiB cap without enlarging ordinary pages.
        let maximumBytes = placeID != nil && offset == 0 ? 8 * 1_048_576 : 2 * 1_048_576
        let data = try await read(url, maximum: maximumBytes)
        let page = try JSONDecoder().decode(XDriveIOSNativeMediaRange.self, from: data)
        guard page.offset == offset, page.limit == Self.pageSize,
              page.total_count >= 0, page.total_count <= 10_000_000,
              page.items.count <= Self.pageSize,
              Set(page.items.map(\.contentIdentity)).count == page.items.count,
              page.offset + page.items.count <= page.total_count,
              !(page.items.isEmpty && offset < page.total_count),
              page.items.allSatisfy({
                $0.validContentIdentity && $0.id > 0 && $0.node.revision > 0 && $0.node.size >= 0 &&
                $0.node.type == "file"
              })
        else { throw XDriveIOSNativeMediaReadFailure.invalidPage }
        return page
    }

    /// B2 v2: the read-only, current Owner trips list. The legacy
    /// /media/memories trip:v1 date heuristic is deliberately not accepted.
    /// This shares exactly the existing HTTPS/TLS, no-redirect bearer Reader.
    func exactTrips(timeZone: String, limit: Int = 100) async throws
        -> [XDriveIOSNativeExactTrip] {
        guard XDriveIOSNativeExactTripPolicy.validTimeZone(timeZone),
              (1...XDriveIOSNativeExactTripPolicy.maximumTrips).contains(limit)
        else { throw XDriveIOSNativeMediaReadFailure.invalidScope }
        let url = try endpoint("/api/v1/media/trips", query: [
            URLQueryItem(name: "time_zone", value: timeZone),
            URLQueryItem(name: "limit", value: String(limit))
        ])
        let bytes = try await read(url, maximum: 128 * 1_024)
        let trips = try JSONDecoder().decode([XDriveIOSNativeExactTrip].self, from: bytes)
        guard trips.count <= limit, XDriveIOSNativeExactTripPolicy.validTrips(trips)
        else { throw XDriveIOSNativeMediaReadFailure.invalidPage }
        return trips
    }

    /// Only current v2 trip GPS cells, never the all-Owner map overview.
    /// Both counts and MapKit pin identities must match the trip DTO.
    func exactTripMap(
        _ trip: XDriveIOSNativeExactTrip, timeZone: String,
        bounds: XDriveIOSNativeOwnerMapBounds? = nil
    ) async throws -> XDriveIOSNativeOwnerMapOverview {
        guard XDriveIOSNativeExactTripPolicy.validTrip(trip),
              XDriveIOSNativeExactTripPolicy.validTimeZone(timeZone),
              bounds == nil || XDriveIOSNativeOwnerMapOverviewPolicy.validBounds(bounds!)
        else { throw XDriveIOSNativeMediaReadFailure.invalidScope }
        var parameters = [URLQueryItem(name: "time_zone", value: timeZone)]
        if let bounds {
            parameters += [
                URLQueryItem(name: "west", value: String(bounds.west)),
                URLQueryItem(name: "south", value: String(bounds.south)),
                URLQueryItem(name: "east", value: String(bounds.east)),
                URLQueryItem(name: "north", value: String(bounds.north))
            ]
        }
        let url = try endpoint("/api/v1/media/trips/\(trip.id)/map",
                               query: parameters)
        let bytes = try await read(
            url, maximum: XDriveIOSNativeOwnerMapOverviewPolicy.maximumBytes)
        let result = try JSONDecoder().decode(
            XDriveIOSNativeOwnerMapOverview.self, from: bytes)
        guard result.trip_photo_count == trip.item_count,
              result.total_photo_count <= trip.item_count,
              (bounds != nil || result.total_photo_count == trip.item_count),
              XDriveIOSNativeOwnerMapOverviewPolicy.valid(result),
              result.items.allSatisfy({ facet in
                result.aggregated
                    ? (facet.coordinate_kind == "map_region_sample" &&
                       !XDriveIOSNativeOwnerMapSelectionPolicy.canOpenPhotoRange(facet))
                    : XDriveIOSNativeOwnerMapSelectionPolicy.canOpenPhotoRange(facet)
              })
        else { throw XDriveIOSNativeMediaReadFailure.invalidPage }
        return result
    }

    /// The exact current trip membership is resolved afresh server-side.
    /// A changed total, stale v2 ID, changed Owner or unauthorized current
    /// item must fail closed; no all-Owner date-range fallback is permitted.
    func exactTripPage(
        _ trip: XDriveIOSNativeExactTrip, offset: Int, timeZone: String,
        place: XDriveIOSNativeOwnerMapFacet? = nil
    ) async throws -> XDriveIOSNativeMediaRange {
        let expectedTotal = place?.item_count ?? trip.item_count
        guard XDriveIOSNativeExactTripPolicy.validTrip(trip),
              XDriveIOSNativeExactTripPolicy.validTimeZone(timeZone),
              (place == nil || (
                  XDriveIOSNativeOwnerMapSelectionPolicy.canOpenPhotoRange(place!) &&
                  expectedTotal > 0 && expectedTotal <= trip.item_count
              )),
              offset >= 0,
              offset % Self.pageSize == 0,
              offset < expectedTotal
        else { throw XDriveIOSNativeMediaReadFailure.invalidScope }
        var parameters = [
            URLQueryItem(name: "time_zone", value: timeZone),
            URLQueryItem(name: "range", value: "true"),
            URLQueryItem(name: "limit", value: String(Self.pageSize)),
            URLQueryItem(name: "offset", value: String(offset))
        ]
        if let place {
            // Place must be part of a *trip* call. A regular global place
            // endpoint cannot satisfy this scope or supply its expected count.
            parameters.append(URLQueryItem(name: "place", value: place.id))
        }
        let url = try endpoint(
            "/api/v1/media/trips/\(trip.id)/items", query: parameters)
        let bytes = try await read(url, maximum: 2 * 1_048_576)
        let page = try JSONDecoder().decode(XDriveIOSNativeMediaRange.self, from: bytes)
        guard XDriveIOSNativeExactTripPolicy.validWindow(
            requestedOffset: offset, responseOffset: page.offset,
            responseLimit: page.limit, responseTotal: page.total_count,
            itemIDs: page.items.map(\.id), expectedTotal: expectedTotal
        ), page.items.allSatisfy({
            $0.node.revision > 0 && $0.node.size >= 0 &&
            $0.node.type == "file"
        })
        else { throw XDriveIOSNativeMediaReadFailure.invalidPage }
        return page
    }

    /// Bounded WGS84 Owner map overview; MapKit must never receive BD09.
    /// Reuses this Reader's HTTPS-only, no-redirect authenticated transport.
    func mapOverview(
        bounds: XDriveIOSNativeOwnerMapBounds,
        detail: Bool = false,
        captureRange: XDriveIOSNativePhotoMapCaptureRange? = nil
    ) async throws -> XDriveIOSNativeOwnerMapOverview {
        guard XDriveIOSNativeOwnerMapOverviewPolicy.validBounds(bounds),
              (captureRange == nil || captureRange!.valid),
              (mapSelection == nil || mapSelection!.valid) else {
            throw XDriveIOSNativeMediaReadFailure.invalidPage
        }
        var query = [
            URLQueryItem(name: "west", value: String(bounds.west)),
            URLQueryItem(name: "south", value: String(bounds.south)),
            URLQueryItem(name: "east", value: String(bounds.east)),
            URLQueryItem(name: "north", value: String(bounds.north))
        ]
        if detail { query.append(URLQueryItem(name: "detail", value: "1")) }
        if let mapSelection { query += mapSelection.queryItems }
        if let captureRange {
            query.append(URLQueryItem(name: "captured_from",
                                      value: captureRange.fromRFC3339))
            query.append(URLQueryItem(name: "captured_to",
                                      value: captureRange.toRFC3339))
        }
        let url = try endpoint("/api/v1/media/places/overview", query: query)
        let bytes = try await read(url, maximum: XDriveIOSNativeOwnerMapOverviewPolicy.maximumBytes)
        let overview = try JSONDecoder().decode(XDriveIOSNativeOwnerMapOverview.self, from: bytes)
        guard XDriveIOSNativeOwnerMapOverviewPolicy.valid(overview) else {
            throw XDriveIOSNativeMediaReadFailure.invalidPage
        }
        return overview
    }

    func reanalyzeFaces() async throws {
        struct Receipt: Decodable { let owner_id: UInt64; let accepted: [String] }
        let body = try JSONEncoder().encode(["kinds": ["face"]])
        let bytes = try await read(try endpoint("/api/v1/photo-intelligence/reanalyze"),
            method: "POST", maximum: 8192, body: body, expectedStatus: 202)
        let receipt = try JSONDecoder().decode(Receipt.self, from: bytes)
        guard receipt.owner_id == owner.ownerID, receipt.accepted == ["face"] else {
            throw XDriveIOSNativeMediaReadFailure.invalidScope
        }
    }

    func people(suggested: Bool, offset: Int) async throws -> [XDriveIOSNativeMediaPerson] {
        guard (0...10_000_000).contains(offset) else { throw XDriveIOSNativeMediaReadFailure.invalidPage }
        let path = "/api/v1/media/people/\(suggested ? "suggestions" : "identities")"
        let data = try await read(try endpoint(path, query: [
            URLQueryItem(name: "limit", value: "24"), URLQueryItem(name: "offset", value: String(offset))
        ]), maximum: 131_072)
        let rows = try JSONDecoder().decode([XDriveIOSNativeMediaPerson].self, from: data)
        guard rows.count <= 24, Set(rows.map(\.id)).count == rows.count,
              rows.allSatisfy({ $0.isValid && $0.suggested == suggested }) else {
            throw XDriveIOSNativeMediaReadFailure.invalidPage
        }
        return rows
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

    func exactMatches(_ probes: [XDriveIOSNativeExactPhotoProbe]) async throws -> [XDriveIOSNativeExactPhotoMatch] {
        guard !probes.isEmpty, probes.count <= 8 else { throw XDriveIOSNativeMediaReadFailure.invalidPage }
        let url = try endpoint("/api/v1/media/exact-match")
        let request = try JSONEncoder().encode(["probes": probes])
        let bytes = try await read(url, method: "POST", maximum: 8192, body: request)
        let reply = try JSONDecoder().decode(XDriveIOSNativeExactPhotoReply.self, from: bytes)
        guard reply.matches.count == probes.count, reply.matches.allSatisfy(\.isValid) else {
            throw XDriveIOSNativeMediaReadFailure.invalidPage
        }
        return reply.matches
    }

    func exactFingerprints(_ refs: [XDriveIOSNativeExactPhotoReference]) async throws -> [XDriveIOSNativeExactPhotoProbe?] {
        guard !refs.isEmpty, refs.count <= 8 else { throw XDriveIOSNativeMediaReadFailure.invalidPage }
        let url = try endpoint("/api/v1/media/exact-match")
        let body = try JSONEncoder().encode(["references": refs])
        let bytes = try await read(url, method: "POST", maximum: 8192, body: body)
        let reply = try JSONDecoder().decode(XDriveIOSNativeExactPhotoFingerprints.self, from: bytes)
        guard reply.fingerprints.count == refs.count,
              reply.fingerprints.allSatisfy({ $0 == nil || $0?.fingerprint != nil }) else {
            throw XDriveIOSNativeMediaReadFailure.invalidPage
        }
        return reply.fingerprints
    }

    /// Exact current Node read for a map-wall tap. A previously proved map
    /// count is not a lease to show a photo after a Node revision or metadata
    /// change. This endpoint has the same Owner/TLS/no-redirect gate as page().
    func currentMapItem(_ expected: XDriveIOSNativeMediaItem) async throws
        -> XDriveIOSNativeMediaItem {
        guard expected.id > 0, expected.node.revision > 0,
              expected.validContentIdentity, expected.supportsPreview else {
            throw XDriveIOSNativeMediaReadFailure.invalidScope
        }
        let bytes = try await read(
            try endpoint("/api/v1/media/items/\(expected.id)"),
            maximum: 262_144)
        let item = try JSONDecoder().decode(XDriveIOSNativeMediaItem.self, from: bytes)
        try Task.checkCancellation()
        guard item.id == expected.id,
              item.node.revision == expected.node.revision,
              item.contentIdentity == expected.contentIdentity,
              item.validContentIdentity, item.supportsPreview else {
            throw XDriveIOSNativeMediaReadFailure.invalidPage
        }
        return item
    }

    func matchedMedia(_ match: XDriveIOSNativeExactPhotoMatch) async throws -> XDriveIOSNativeMediaItem {
        guard match.state == .matched, let id = match.node_id else {
            throw XDriveIOSNativeMediaReadFailure.invalidPage
        }
        let bytes = try await read(try endpoint("/api/v1/media/items/\(id)"), maximum: 262_144)
        let item = try JSONDecoder().decode(XDriveIOSNativeMediaItem.self, from: bytes)
        guard item.id == id, item.asset_id == match.asset_id, item.node.revision == match.revision,
              item.supportsPreview else { throw XDriveIOSNativeMediaReadFailure.invalidPage }
        return item
    }

    func thumbnail(_ item: XDriveIOSNativeMediaItem) async throws -> UIImage {
        guard let version = item.metadata.thumbnail_version, version.utf8.count <= 32,
              !version.isEmpty else { return try await downloadThumbnail(item) }
        let cache = XDriveIOSNativePhotoThumbnailCache.shared
        let scope = XDriveIOSNativePhotoThumbnailCache.scope(for: owner)
        let key = XDriveIOSNativePhotoThumbnailCache.key(
            nodeID: item.id, revision: item.node.revision, thumbnailVersion: version
        )
        let ticket = await cache.writeRevision()
        if let bytes = try? await cache.load(scope: scope, key: key),
           let image = UIImage(data: bytes) {
            try Task.checkCancellation()
            return image
        }
        let image = try await downloadThumbnail(item)
        try Task.checkCancellation()
        if let jpeg = image.jpegData(compressionQuality: 0.78) {
            try? await cache.save(jpeg, scope: scope, key: key, expectedRevision: ticket)
        }
        return image
    }

    private func downloadThumbnail(_ item: XDriveIOSNativeMediaItem) async throws -> UIImage {
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
        try await preview(item, maxDecodedPixel: 4096)
    }

    /// Only a user magnifying a displayed ordinary cloud still calls this.
    /// Re-verify the complete selected Owner/Node identity before and after
    /// the same signed preview reader, never mint a second media authority.
    func enhancedStill(_ item: XDriveIOSNativeMediaItem) async throws -> UIImage {
        guard item.supportsPreview, !item.isVideo, !item.isLive else {
            throw XDriveIOSNativeMediaReadFailure.unsupported
        }
        _ = try await currentOriginal(item)
        try Task.checkCancellation()
        let high = try await preview(item, maxDecodedPixel: 6144)
        try Task.checkCancellation()
        _ = try await currentOriginal(item)
        guard let image = high.image else {
            throw XDriveIOSNativeMediaStillPreviewFallback.unavailable
        }
        return image
    }

    private func preview(_ item: XDriveIOSNativeMediaItem, maxDecodedPixel: Int) async throws
        -> (image: UIImage?, videoURL: URL?) {
        guard item.supportsPreview else {
            throw XDriveIOSNativeMediaReadFailure.unsupported
        }
        guard maxDecodedPixel == 4096 || maxDecodedPixel == 6144 else {
            throw XDriveIOSNativeMediaReadFailure.unsupported
        }
        let ticketURL = try endpoint("/api/v1/files/\(item.id)/preview-ticket")
        let data = try await read(ticketURL, method: "POST", maximum: 32_768)
        let ticket = try JSONDecoder().decode(XDriveIOSNativeMediaPreviewTicket.self, from: data)
        guard ticket.url.hasPrefix("/api/v1/file-preview/"),
              XDriveIOSNativeFilesViewerPolicy.validTicketPath(
                ticket.url, nodeID: item.id
              ),
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
        let still: Data
        do {
            still = try await read(signedURL, bearer: false, maximum: 32 * 1_048_576)
        } catch XDriveIOSNativeMediaReadFailure.tooLarge {
            // The preview ticket was valid, but its image body is too large.
            // A separate bounded Owner/revision thumbnail can be requested.
            throw XDriveIOSNativeMediaStillPreviewFallback.unavailable
        }
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
                kCGImageSourceThumbnailMaxPixelSize as String: maxDecodedPixel,
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
            // Do not claim this image is an original-resolution still.
            // The presenting Viewer may try the indexed low-res derivative.
            throw XDriveIOSNativeMediaStillPreviewFallback.unavailable
        }
        return (UIImage(cgImage: bounded), nil)
    }

    /// Generic cloud PhotoAsset names are NOT necessarily iPhone-generated
    /// -xios- backup receipts. Only inspect the untrusted display name here:
    /// the staged local path is a fixed "original.<checked extension>".
    private func validOrdinaryPhotoAssetName(_ name: String) -> Bool {
        guard !name.isEmpty, name.utf8.count <= 255,
              !name.hasSuffix(" "), !name.hasSuffix(".") else { return false }
        return !name.unicodeScalars.contains { scalar in
            scalar.value < 32 || scalar.value == 127 ||
                "/\\:".unicodeScalars.contains(scalar)
        }
    }

    /// Re-fetch the selected logical PhotoAsset. A signed original download
    /// must not silently import a renamed/replaced Node, a changed media
    /// classification or a now-unpaired resource under the old Viewer item.
    private func currentOriginal(_ selected: XDriveIOSNativeMediaItem)
        async throws -> XDriveIOSNativeMediaItem {
        guard selected.validContentIdentity else { throw XDriveIOSNativeMediaReadFailure.invalidScope }
        let path = try selected.content_key.map { "/api/v1/media/content/\(try albumSegment($0))" }
            ?? "/api/v1/media/items/\(selected.id)"
        let url = try endpoint(path)
        let data = try await read(url, maximum: 131_072)
        let current = try JSONDecoder().decode(XDriveIOSNativeMediaItem.self, from: data)
        guard current.contentIdentity == selected.contentIdentity,
              current.id == selected.id,
              current.node.revision == selected.node.revision,
              current.node.name == selected.node.name,
              current.node.type == selected.node.type,
              current.node.size == selected.node.size,
              current.metadata.media_kind == selected.metadata.media_kind,
              current.metadata.container_kind == selected.metadata.container_kind,
              current.asset_kind == selected.asset_kind,
              current.live_photo == selected.live_photo,
              current.resources == selected.resources,
              current.supportsPreview, !current.isLive,
              current.isVideo == selected.isVideo
        else { throw XDriveIOSNativeMediaReadFailure.invalidScope }
        return current
    }

    /// Explicitly restore a single ordinary cloud PhotoAsset's ORIGINAL,
    /// never its 280px thumbnail or the 4096px Viewer derivative. Native
    /// Live Photo is deliberately excluded until both original resources
    /// can be proven as one current pair and atomically imported together.
    func downloadOriginalForPhotos(_ selected: XDriveIOSNativeMediaItem)
        async throws -> URL {
        let ext = (selected.node.name as NSString).pathExtension.lowercased()
        let extensions = selected.isVideo
            ? ["mov", "mp4", "m4v"]
            : ["jpg", "jpeg", "png", "heic", "heif", "tif", "tiff"]
        guard selected.supportsPreview, !selected.isLive,
              selected.node.type == "file", selected.id > 0,
              selected.node.revision > 0, selected.node.size > 0,
              selected.node.size <= 4 * 1_073_741_824,
              extensions.contains(ext),
              validOrdinaryPhotoAssetName(selected.node.name),
              !accessToken.isEmpty else {
            throw XDriveIOSNativeMediaReadFailure.unsupported
        }
        _ = try await currentOriginal(selected)
        try Task.checkCancellation()

        let ticketData = try await read(
            endpoint("/api/v1/files/\(selected.id)/download-ticket"),
            method: "POST", maximum: 32_768
        )
        let ticket = try JSONDecoder().decode(
            XDriveIOSNativeMediaOriginalDownloadTicket.self, from: ticketData
        )
        let expectedPath = "/api/v1/file-download/\(selected.id)"
        guard let parsed = URLComponents(string: ticket.url),
              parsed.scheme == nil, parsed.host == nil,
              parsed.user == nil, parsed.password == nil,
              parsed.fragment == nil, parsed.path == expectedPath,
              let query = parsed.queryItems, query.count == 1,
              query[0].name == "ticket",
              let secret = query[0].value,
              !secret.isEmpty, secret.utf8.count <= 8192,
              let origin = URLComponents(url: owner.origin, resolvingAgainstBaseURL: false),
              var resolved = URLComponents(url: owner.origin, resolvingAgainstBaseURL: false)
        else { throw XDriveIOSNativeMediaReadFailure.malformed }
        resolved.path = expectedPath
        resolved.percentEncodedQuery = parsed.percentEncodedQuery
        resolved.fragment = nil
        guard origin.scheme == "https", resolved.scheme == "https",
              resolved.host == origin.host, resolved.port == origin.port,
              let signedURL = resolved.url
        else { throw XDriveIOSNativeMediaReadFailure.invalidScope }

        let client = session()
        defer { client.invalidateAndCancel() }
        var request = URLRequest(url: signedURL)
        request.httpShouldHandleCookies = false
        request.setValue("application/octet-stream", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        // The short-lived ticket grants the file; do not send an Owner bearer.
        let (temporary, response) = try await client.download(for: request)
        defer { try? FileManager.default.removeItem(at: temporary) }
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse,
              http.statusCode == 200,
              (http.expectedContentLength < 0 ||
                http.expectedContentLength == selected.node.size),
              let attributes = try? FileManager.default.attributesOfItem(
                atPath: temporary.path
              ),
              (attributes[.type] as? FileAttributeType) == .typeRegular,
              (attributes[.size] as? NSNumber)?.int64Value == selected.node.size
        else { throw XDriveIOSNativeMediaReadFailure.malformed }
        _ = try await currentOriginal(selected)
        try Task.checkCancellation()

        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(
            "xdrive-ios-photoasset-restore-" + UUID().uuidString, isDirectory: true
        )
        try FileManager.default.createDirectory(
            at: folder, withIntermediateDirectories: false,
            attributes: [.protectionKey: FileProtectionType.complete]
        )
        do {
            // Keep only a checked extension; do not make a filesystem path
            // from an untrusted Server display name.
            let output = folder.appendingPathComponent("original." + ext)
            try FileManager.default.moveItem(at: temporary, to: output)
            try Task.checkCancellation()
            return output
        } catch {
            try? FileManager.default.removeItem(at: folder)
            throw error
        }
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
            (item.node.name.lowercased().hasSuffix(".livp") ||
             item.node.name.range(of: "^Live-xios-[a-f0-9]{24}-[a-f0-9]{12}\\.zip$", options: [.regularExpression, .caseInsensitive]) != nil) {
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
