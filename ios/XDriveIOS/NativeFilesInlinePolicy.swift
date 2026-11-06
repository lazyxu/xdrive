import Foundation

/// Independent bounded policy so CI can execute the 100k/115k inline
/// window rules without UIKit or creating a real Server connection.
enum XDriveIOSNativeFilesInlinePolicy {
    static let maximumBranches = 4
    static let maximumDepth = 3

    static func validParent(_ node: XDriveIOSNativeFilesNode) -> Bool {
        node.isDirectory && node.id > 0 && node.revision > 0 &&
            node.parent_id != nil
    }

    static func canExpand(activeBranches: Int, depth: Int) -> Bool {
        activeBranches >= 0 && activeBranches < maximumBranches &&
            depth > 0 && depth <= maximumDepth
    }

    static func validWindow(_ nodes: [XDriveIOSNativeFilesNode],
                            parentID: UInt64, startOffset: Int,
                            total: Int) -> Bool {
        guard parentID > 0, startOffset >= 0,
              startOffset % XDriveIOSNativeFilesContinuousWindowPolicy.pageSize == 0,
              total >= 0 && total <= XDriveIOSNativeFilesContinuousWindowPolicy.maximumTotal,
              nodes.count <= XDriveIOSNativeFilesContinuousWindowPolicy.maximumVisibleItems,
              startOffset + nodes.count <= total,
              !(nodes.isEmpty && startOffset < total),
              nodes.count % XDriveIOSNativeFilesContinuousWindowPolicy.pageSize == 0 ||
                startOffset + nodes.count == total,
              Set(nodes.map(\.id)).count == nodes.count else { return false }
        return nodes.allSatisfy {
            $0.id > 0 && $0.revision > 0 && $0.parent_id == parentID &&
                ($0.type == "dir" || $0.type == "file")
        }
    }
}
