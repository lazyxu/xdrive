import Foundation

/// The native Files recycle bin only shows top-level, truly deleted Owner
/// Nodes returned by the existing bounded Server trash Range endpoint.
struct XDriveIOSNativeFilesTrashNode: Decodable, Hashable, Identifiable {
    let id: UInt64
    let parent_id: UInt64?
    let name: String
    let type: String
    let size: Int64
    let revision: UInt64
    let deleted_at: String?

    var isDirectory: Bool { type == "dir" }
}

struct XDriveIOSNativeFilesTrashRange: Decodable {
    let items: [XDriveIOSNativeFilesTrashNode]
    let total_count: Int
    let total_count_included: Bool
    let offset: Int
    let limit: Int
    let sort: String
    let order: String
}

/// No synthetic trash records or cross-page selection. A restored Node must
/// be the exact same Node at its original parent, with a newer revision.
enum XDriveIOSNativeFilesTrashPolicy {
    static let sort = "updated"
    static let order = "desc"
    static let pageSize = XDriveIOSNativeFilesPagePolicy.pageSize

    static func validDeleted(_ item: XDriveIOSNativeFilesTrashNode) -> Bool {
        item.id > 0 && item.parent_id != nil && item.revision > 0 &&
            item.size >= 0 && (item.type == "file" || item.type == "dir") &&
            !item.name.isEmpty && item.name.utf8.count <= 255 &&
            !(item.deleted_at ?? "").isEmpty
    }

    static func validRange(_ page: XDriveIOSNativeFilesTrashRange,
                           offset: Int) -> Bool {
        guard XDriveIOSNativeFilesPagePolicy.validOffset(offset),
              page.offset == offset, page.limit == pageSize,
              page.sort == sort, page.order == order,
              page.total_count_included,
              page.total_count >= 0,
              page.total_count <= XDriveIOSNativeFilesPagePolicy.maximumCount,
              page.items.count <= pageSize,
              page.items.count <= max(0, page.total_count - offset),
              !(page.items.isEmpty && offset < page.total_count),
              Set(page.items.map(\.id)).count == page.items.count else {
            return false
        }
        return page.items.allSatisfy(validDeleted)
    }

    static func validRestored(_ restored: XDriveIOSNativeFilesTrashNode,
                              from deleted: XDriveIOSNativeFilesTrashNode) -> Bool {
        validDeleted(deleted) && restored.id == deleted.id &&
            restored.parent_id == deleted.parent_id &&
            restored.name == deleted.name && restored.type == deleted.type &&
            restored.size == deleted.size &&
            restored.revision > deleted.revision && restored.deleted_at == nil
    }
}
