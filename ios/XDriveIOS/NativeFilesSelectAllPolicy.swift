import Foundation

/// An exact, bounded whole-directory selection assembled from authenticated
/// 64-node Server pages. Page admission is atomic: a malformed response never
/// partly advances the selected IDs or the next required offset.
struct XDriveIOSNativeFilesSelectAllAccumulator {
    let parentID: UInt64
    let total: Int
    let sort: String
    let order: String
    private(set) var nextOffset = 0
    private(set) var snapshots = [UInt64: XDriveIOSNativeFilesNode]()

    init?(parentID: UInt64, total: Int, sort: String, order: String) {
        guard parentID > 0, total > 0,
              total <= XDriveIOSNativeFilesBatchTrashPolicy.maxSelected,
              XDriveIOSNativeFilesPagePolicy.validOrder(sort: sort, order: order)
        else { return nil }
        self.parentID = parentID
        self.total = total
        self.sort = sort
        self.order = order
    }

    mutating func append(_ page: XDriveIOSNativeFilesRange) -> Bool {
        guard nextOffset < total,
              page.total_count == total, page.offset == nextOffset,
              page.limit == XDriveIOSNativeFilesPagePolicy.pageSize,
              page.sort == sort, page.order == order,
              page.items.count == min(XDriveIOSNativeFilesPagePolicy.pageSize,
                                      total - nextOffset),
              Set(page.items.map(\.id)).count == page.items.count,
              page.items.allSatisfy({ node in
                  node.id > 0 && node.parent_id == parentID &&
                  node.revision > 0 && node.size >= 0 &&
                  (node.type == "dir" || node.type == "file") &&
                  !node.name.isEmpty && node.name.utf8.count <= 255 &&
                  snapshots[node.id] == nil
              }) else { return false }
        for node in page.items { snapshots[node.id] = node }
        nextOffset += page.items.count
        return true
    }

    func verifiedSelection() -> [UInt64: XDriveIOSNativeFilesNode]? {
        let ids = Set(snapshots.keys)
        guard nextOffset == total, ids.count == total,
              XDriveIOSNativeFilesSelectionPolicy.validItems(
                  snapshots: snapshots, selectedIDs: ids,
                  parentID: parentID
              ) != nil else { return nil }
        return snapshots
    }
}
