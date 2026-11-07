import Foundation

enum XDriveIOSNativeFilesChunkedPolicy {
    static func groups(_ nodes: [XDriveIOSNativeFilesNode],
                       parentID: UInt64) -> [[XDriveIOSNativeFilesNode]]? {
        guard parentID > 0,
              nodes.count > XDriveIOSNativeFilesBatchTrashPolicy.maxSelected,
              nodes.count <= XDriveIOSNativeFilesSelectionPolicy.maximumSelectedSnapshots,
              Set(nodes.map(\.id)).count == nodes.count,
              nodes.allSatisfy({
                  $0.id > 0 && $0.revision > 0 && $0.parent_id == parentID &&
                  ($0.type == "file" || $0.type == "dir")
              }) else { return nil }
        let ordered = nodes.sorted { $0.id < $1.id }
        let limit = XDriveIOSNativeFilesBatchTrashPolicy.maxSelected
        return stride(from: 0, to: ordered.count, by: limit).map {
            Array(ordered[$0..<min($0 + limit, ordered.count)])
        }
    }
}
