import Foundation

/// Canonical Server Node shape used by the native Files tab. No browser
/// cache, guessed root identity or locally synthesized file listing.
struct XDriveIOSNativeFilesNode: Decodable, Identifiable, Hashable {
    let id: UInt64
    let parent_id: UInt64?
    let name: String
    let type: String
    let size: Int64
    let revision: UInt64
    var created_at: String? = nil
    var updated_at: String? = nil

    var isDirectory: Bool { type == "dir" }
    var createdDate: Date? {
        guard let value = created_at else { return nil }
        return XDriveIOSNativeFilesDatePolicy.date(from: value)
    }
    var modifiedDate: Date? {
        guard let value = updated_at else { return nil }
        return XDriveIOSNativeFilesDatePolicy.date(from: value)
    }
}

/// Server timestamps use RFC3339Nano. ISO8601DateFormatter's whole-second
/// parser handles ordinary timestamps; the fallback preserves up to all nine
/// fractional digits instead of dropping dates with nanosecond precision.
enum XDriveIOSNativeFilesDatePolicy {
    static func date(from value: String) -> Date? {
        let value = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        if let date = formatter.date(from: value) { return date }

        guard let timeSeparator = value.firstIndex(of: "T"),
              let decimal = value[timeSeparator...].firstIndex(of: "."),
              let timezone = value[value.index(after: decimal)...].firstIndex(where: {
                  $0 == "Z" || $0 == "+" || $0 == "-"
              }) else { return nil }
        let fractionDigits = value[value.index(after: decimal)..<timezone]
        guard !fractionDigits.isEmpty,
              fractionDigits.utf8.count <= 9,
              fractionDigits.utf8.allSatisfy({ $0 >= 48 && $0 <= 57 }),
              let fraction = Double("0." + String(fractionDigits)) else { return nil }

        let wholeSeconds = String(value[..<decimal]) + String(value[timezone...])
        guard let base = formatter.date(from: wholeSeconds) else { return nil }
        return base.addingTimeInterval(fraction)
    }

    static func display(_ date: Date) -> String {
        date.formatted(date: .abbreviated, time: .shortened)
    }
}

struct XDriveIOSNativeFilesRange: Decodable {
    let items: [XDriveIOSNativeFilesNode]
    let total_count: Int
    let offset: Int
    let limit: Int
    let sort: String
    let order: String
}

struct XDriveIOSNativeFilesSearchHit: Decodable {
    let node: XDriveIOSNativeFilesNode
    let path: String
}

struct XDriveIOSNativeFilesSearchRange: Decodable {
    let items: [XDriveIOSNativeFilesSearchHit]
    let total_count: Int
    let offset: Int
    let limit: Int
    let sort: String
    let order: String
}

/// Validate each 64-entry Server Range independently. The iOS presentation
/// may combine adjacent, freshly verified ranges for continuous scrolling;
/// only Server-provided Nodes and paths can enter that window.
enum XDriveIOSNativeFilesPagePolicy {
    static let pageSize = 64
    static let maximumCount = 10_000_000
    static let minimumQueryCharacters = 2
    static let maximumQueryCharacters = 200
    static let maximumQueryUTF8Bytes = 256

    static func validOffset(_ offset: Int) -> Bool {
        offset >= 0 && offset <= maximumCount &&
            offset % pageSize == 0
    }

    static func validSearch(_ query: String) -> Bool {
        let value = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.unicodeScalars.count >= minimumQueryCharacters &&
            value.unicodeScalars.count <= maximumQueryCharacters &&
            value.utf8.count <= maximumQueryUTF8Bytes
    }

    static func validOrder(sort: String, order: String) -> Bool {
        ["name", "updated", "size", "type"].contains(sort) &&
            ["asc", "desc"].contains(order)
    }

    private static func validNodes(_ items: [XDriveIOSNativeFilesNode]) -> Bool {
        guard items.count <= pageSize,
              Set(items.map(\.id)).count == items.count else { return false }
        return items.allSatisfy {
            $0.id > 0 && $0.revision > 0 && $0.size >= 0 &&
                ($0.type == "dir" || $0.type == "file") &&
                !$0.name.isEmpty && $0.name.utf8.count <= 255
        }
    }

    private static func validHeader(total: Int, offset: Int, limit: Int,
                                    sort: String, order: String,
                                    requestedOffset: Int,
                                    requestedSort: String,
                                    requestedOrder: String,
                                    count: Int) -> Bool {
        validOffset(requestedOffset) &&
            total >= 0 && total <= maximumCount &&
            offset == requestedOffset && limit == pageSize &&
            sort == requestedSort && order == requestedOrder &&
            validOrder(sort: sort, order: order) &&
            count <= pageSize && offset + count <= total &&
            !(count == 0 && offset < total)
    }

    static func validChildren(_ page: XDriveIOSNativeFilesRange,
                              parentID: UInt64, offset: Int,
                              sort: String, order: String) -> Bool {
        parentID > 0 &&
            validHeader(total: page.total_count, offset: page.offset,
                        limit: page.limit, sort: page.sort, order: page.order,
                        requestedOffset: offset, requestedSort: sort,
                        requestedOrder: order, count: page.items.count) &&
            validNodes(page.items) &&
            page.items.allSatisfy { $0.parent_id == parentID }
    }

    static func validResults(_ page: XDriveIOSNativeFilesSearchRange,
                             offset: Int, sort: String, order: String) -> Bool {
        validHeader(total: page.total_count, offset: page.offset,
                    limit: page.limit, sort: page.sort, order: page.order,
                    requestedOffset: offset, requestedSort: sort,
                    requestedOrder: order, count: page.items.count) &&
            validNodes(page.items.map(\.node)) &&
            page.items.allSatisfy {
                $0.node.parent_id != nil && !$0.path.isEmpty &&
                    $0.path.utf8.count <= 4096
            }
    }
}


/// A continuous Files window is assembled from individually verified canonical
/// 64-item ranges. Neither a changed result count nor overlapping Node IDs may
/// silently extend an old window (offset pagination is not a snapshot cursor).
enum XDriveIOSNativeFilesContinuousPolicy {
    enum Direction {
        case before, after
    }

    static func validJoin(
        loadedIDs: Set<UInt64>, loadedCount: Int, startOffset: Int, total: Int,
        pageIDs: [UInt64], pageOffset: Int, pageTotal: Int,
        direction: Direction
    ) -> Bool {
        guard loadedCount > 0, loadedIDs.count == loadedCount,
              XDriveIOSNativeFilesPagePolicy.validOffset(startOffset),
              total >= loadedCount && total <= XDriveIOSNativeFilesPagePolicy.maximumCount,
              startOffset <= total - loadedCount,
              XDriveIOSNativeFilesPagePolicy.validOffset(pageOffset),
              !pageIDs.isEmpty,
              pageIDs.count <= XDriveIOSNativeFilesPagePolicy.pageSize,
              Set(pageIDs).count == pageIDs.count,
              Set(pageIDs).isDisjoint(with: loadedIDs),
              pageTotal == total else { return false }

        switch direction {
        case .after:
            // Reject a short nonterminal page: its count would not yield the
            // next legal Server offset and could skip undisplayed items.
            return pageOffset == startOffset + loadedCount &&
                pageOffset < total &&
                (pageIDs.count == XDriveIOSNativeFilesPagePolicy.pageSize ||
                 pageOffset + pageIDs.count == total)
        case .before:
            return startOffset > 0 &&
                pageOffset + XDriveIOSNativeFilesPagePolicy.pageSize == startOffset &&
                pageIDs.count == XDriveIOSNativeFilesPagePolicy.pageSize
        }
    }
}
