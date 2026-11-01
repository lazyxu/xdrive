import Foundation

enum XDriveIOSNativeFilesDestinationKind: String, Equatable {
    case copy, move

    var title: String { self == .copy ? "复制到…" : "移动到…" }
    var confirmLabel: String { self == .copy ? "复制到此文件夹" : "移动到此文件夹" }
}

/// Batch copy/move is limited to the one Owner-verified 64-row directory
/// page and is committed atomically by the existing Go Server endpoints.
struct XDriveIOSNativeFilesBatchTargetReceipt: Decodable {
    let operation_id: String
    let items: [XDriveIOSNativeFilesNode]
}

enum XDriveIOSNativeFilesBatchTargetPolicy {
    static func validSelection(
        _ items: [XDriveIOSNativeFilesNode],
        sourceParentID: UInt64,
        destinationID: UInt64,
        kind: XDriveIOSNativeFilesDestinationKind
    ) -> Bool {
        XDriveIOSNativeFilesBatchTrashPolicy.validSelection(
            items, parentID: sourceParentID
        ) && destinationID > 0 &&
        !items.contains(where: { $0.isDirectory && $0.id == destinationID }) &&
        (kind != .move || sourceParentID != destinationID)
    }

    static func validReceipt(
        _ receipt: XDriveIOSNativeFilesBatchTargetReceipt,
        original: [XDriveIOSNativeFilesNode],
        sourceParentID: UInt64,
        destinationID: UInt64,
        kind: XDriveIOSNativeFilesDestinationKind
    ) -> Bool {
        guard validSelection(
            original, sourceParentID: sourceParentID,
            destinationID: destinationID, kind: kind
        ), UUID(uuidString: receipt.operation_id) != nil,
            receipt.items.count == original.count,
            Set(receipt.items.map(\.id)).count == original.count else {
            return false
        }
        let sourceIDs = Set(original.map(\.id))
        for (selected, result) in zip(original, receipt.items) {
            guard result.id > 0, result.revision > 0,
                  result.parent_id == destinationID,
                  result.type == selected.type,
                  result.size == selected.size,
                  !result.name.isEmpty, result.name.utf8.count <= 255 else {
                return false
            }
            switch kind {
            case .copy:
                // The Server can auto-rename a colliding copy. The new Node
                // must be different from every selected source, not merely
                // the one at this array position.
                guard !sourceIDs.contains(result.id) else { return false }
            case .move:
                guard result.id == selected.id,
                      result.name == selected.name,
                      result.revision > selected.revision else {
                    return false
                }
            }
        }
        return true
    }
}
