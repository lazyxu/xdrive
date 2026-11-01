import Foundation

/// Confirm only an exact Server Node receipt for a single real-file move/copy.
enum XDriveIOSNativeFilesDestinationReceiptPolicy {
    static func copied(
        original: XDriveIOSNativeFilesNode,
        result: XDriveIOSNativeFilesNode,
        targetID: UInt64
    ) -> Bool {
        original.id > 0 && original.revision > 0 &&
            original.parent_id != nil && original.type == "file" &&
            targetID > 0 && result.id > 0 && result.id != original.id &&
            result.revision > 0 && result.parent_id == targetID &&
            result.type == "file" && result.size == original.size &&
            !result.name.isEmpty && result.name.utf8.count <= 255
    }

    static func moved(
        original: XDriveIOSNativeFilesNode,
        result: XDriveIOSNativeFilesNode,
        targetID: UInt64
    ) -> Bool {
        original.id > 0 && original.revision > 0 &&
            original.parent_id != nil && original.type == "file" &&
            targetID > 0 && original.parent_id != targetID &&
            result.id == original.id && result.parent_id == targetID &&
            result.type == "file" && result.name == original.name &&
            result.size == original.size &&
            result.revision > original.revision
    }
}
