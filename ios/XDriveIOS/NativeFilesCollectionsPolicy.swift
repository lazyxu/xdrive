import Foundation

/// Exact bounded Owner projections from existing file-recent/file-favorites REST.
enum XDriveIOSNativeFilesCollectionKind: String {
    case recent
    case favorites

    var maximumItems: Int { self == .recent ? 50 : 256 }
    var title: String { self == .recent ? "最近使用" : "收藏夹" }
}

struct XDriveIOSNativeFilesCollectionItem: Decodable, Hashable, Identifiable {
    let node: XDriveIOSNativeFilesNode
    let path: String
    let accessed_at: String?
    let favorited_at: String?

    var id: UInt64 { node.id }
}

enum XDriveIOSNativeFilesCollectionsPolicy {
    static func validItem(_ item: XDriveIOSNativeFilesCollectionItem,
                          kind: XDriveIOSNativeFilesCollectionKind) -> Bool {
        let node = item.node
        guard node.id > 0, node.parent_id != nil, node.revision > 0,
              node.type == "file" || (kind == .recent && node.type == "dir"),
              node.size >= 0, !node.name.isEmpty, node.name.utf8.count <= 255,
              !item.path.isEmpty, item.path.utf8.count <= 4096 else {
            return false
        }
        let stamp = kind == .recent ? item.accessed_at : item.favorited_at
        return stamp != nil && !(stamp ?? "").isEmpty
    }

    static func validItems(_ items: [XDriveIOSNativeFilesCollectionItem],
                           kind: XDriveIOSNativeFilesCollectionKind) -> Bool {
        guard items.count <= kind.maximumItems,
              Set(items.map(\.id)).count == items.count else { return false }
        return items.allSatisfy { validItem($0, kind: kind) }
    }
}
