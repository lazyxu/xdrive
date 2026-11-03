import Foundation

struct XDriveIOSNativeFilesBatchTrashReceipt: Decodable {
    let operation_id: String
    let deleted_ids: [UInt64]
}

/// A batch may include at most 200 different Nodes from the current verified
/// sliding directory window (up to four real 64-item Server pages). The Go
/// Server's atomic batch endpoint caps writes at the same 200 items; it still
/// verifies each Node's Owner, revision, parent and subtree.

enum XDriveIOSNativeFilesBatchTrashPolicy {
    static let maxSelected = 200

    static func validSelection(_ items: [XDriveIOSNativeFilesNode],
                               parentID: UInt64) -> Bool {
        guard parentID > 0,
              !items.isEmpty,
              items.count <= maxSelected,
              Set(items.map(\.id)).count == items.count else { return false }
        return items.allSatisfy {
            $0.id > 0 && $0.revision > 0 &&
                $0.parent_id == parentID &&
                ($0.type == "file" || $0.type == "dir")
        }
    }

    static func validReceipt(_ receipt: XDriveIOSNativeFilesBatchTrashReceipt,
                             for items: [XDriveIOSNativeFilesNode]) -> Bool {
        let selected = items.map(\.id)
        return UUID(uuidString: receipt.operation_id) != nil &&
            receipt.deleted_ids.count == selected.count &&
            Set(receipt.deleted_ids).count == selected.count &&
            Set(receipt.deleted_ids) == Set(selected)
    }
}
