import Foundation

struct XDriveIOSNativeFilesBatchTrashReceipt: Decodable {
    let operation_id: String
    let deleted_ids: [UInt64]
}

/// A batch is bounded to one actually verified native directory page, never a
/// cached multi-page selection. The Server itself owns revision and subtree
/// atomicity. Require an exact response before displaying success.
enum XDriveIOSNativeFilesBatchTrashPolicy {
    static let maxSelected = XDriveIOSNativeFilesPagePolicy.pageSize

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
