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

    var isDirectory: Bool { type == "dir" }
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

/// Validate an actual Owner Range before it can replace the currently visible
/// page. Holding just one 64-item page is deliberate even for 100k/115k nodes.
enum XDriveIOSNativeFilesPagePolicy {
    static let pageSize = 64
    static let maximumCount = 10_000_000
    static let maximumQueryCharacters = 200

    static func validOffset(_ offset: Int) -> Bool {
        offset >= 0 && offset <= maximumCount &&
            offset % pageSize == 0
    }

    static func validSearch(_ query: String) -> Bool {
        let value = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return !value.isEmpty &&
            value.unicodeScalars.count <= maximumQueryCharacters
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
