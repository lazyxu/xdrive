import Foundation

/// Native Files MVP multi-export uses ONLY the current verified directory
/// page. It stages 2-8 originals sequentially through the existing signed
/// single-file export reader, bounded by 512 MiB across the entire batch.
enum XDriveIOSNativeFilesBatchExportPolicy {
    static let maximumFiles = 32
    static let maximumAggregateBytes: Int64 = 2 * 1_073_741_824
    static let maximumPerFileBytes: Int64 = 1_073_741_824

    static func validSelection(
        _ nodes: [XDriveIOSNativeFilesNode], parentID: UInt64
    ) -> Bool {
        guard parentID > 0, (2...maximumFiles).contains(nodes.count),
              Set(nodes.map(\.id)).count == nodes.count else { return false }
        var total: Int64 = 0
        var names = Set<String>()
        for node in nodes {
            guard node.id > 0, node.revision > 0,
                  node.parent_id == parentID, node.type == "file",
                  node.size >= 0, node.size <= maximumPerFileBytes,
                  XDriveIOSNativeFilesFolderNamePolicy.normalized(node.name) == node.name,
                  names.insert(node.name.lowercased()).inserted,
                  total <= maximumAggregateBytes - node.size else { return false }
            total += node.size
        }
        return true
    }
}
