import Foundation

/// A bounded exact Node/revision selection lives independently of the
/// 4x64 visible directory window. Server atomic writers revalidate every
/// revision; these helpers only validate the native in-memory snapshots.
enum XDriveIOSNativeFilesSelectionPolicy {
    static func validItems(snapshots: [UInt64: XDriveIOSNativeFilesNode],
                           selectedIDs: Set<UInt64>, parentID: UInt64)
        -> [XDriveIOSNativeFilesNode]? {
        guard parentID > 0, !selectedIDs.isEmpty,
              selectedIDs.count <= XDriveIOSNativeFilesBatchTrashPolicy.maxSelected,
              Set(snapshots.keys) == selectedIDs else { return nil }
        let items = snapshots.values.sorted { $0.id < $1.id }
        return XDriveIOSNativeFilesBatchTrashPolicy.validSelection(
            items, parentID: parentID
        ) ? items : nil
    }

    /// Only a selected Node that has reappeared with changed content or
    /// parent is invalid. Evicted (unloaded) rows are NOT deselected.
    static func conflictingIDs(visible: [XDriveIOSNativeFilesNode],
                               snapshots: [UInt64: XDriveIOSNativeFilesNode])
        -> Set<UInt64> {
        Set(visible.filter {
            guard let selected = snapshots[$0.id] else { return false }
            return selected != $0
        }.map(\.id))
    }
}
