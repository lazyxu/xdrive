import Foundation

/// Canonical Owner file-quick-access DTO from the Go Server, not a local
/// Favorites projection. An entry is a real non-root directory Node.
struct XDriveIOSNativeFilesQuickAccessItem: Decodable, Identifiable {
    let node: XDriveIOSNativeFilesNode
    let path: String
    let position: Int
    var id: UInt64 { node.id }
}

enum XDriveIOSNativeFilesQuickAccessPolicy {
    static let maximumItems = 64

    static func valid(_ item: XDriveIOSNativeFilesQuickAccessItem) -> Bool {
        item.node.id > 0 && item.node.revision > 0 &&
            item.node.type == "dir" && item.node.parent_id != nil &&
            !item.node.name.isEmpty && item.node.name.utf8.count <= 255 &&
            item.position >= 0 && item.position < 1_000_000 &&
            item.path.utf8.count <= 4096
    }

    static func validList(_ items: [XDriveIOSNativeFilesQuickAccessItem]) -> Bool {
        items.count <= maximumItems &&
            Set(items.map(\.id)).count == items.count &&
            items.allSatisfy(valid)
    }

    static func canReorder(_ ids: [UInt64],
                           items: [XDriveIOSNativeFilesQuickAccessItem]) -> Bool {
        validList(items) && ids.count == items.count &&
            Set(ids).count == ids.count &&
            Set(ids) == Set(items.map(\.id))
    }

    static func canPin(_ node: XDriveIOSNativeFilesNode) -> Bool {
        node.id > 0 && node.revision > 0 &&
            node.type == "dir" && node.parent_id != nil
    }
}
