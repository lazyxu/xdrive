import Foundation

@main
struct XDriveIOSPhotoAssetViewerNeighborPolicyChecks {
    static func main() {
        typealias Key = XDriveIOSNativePhotoAssetViewerNeighborKey
        let rows = (1...48).map { Key(nodeID: UInt64($0), revision: 7, previewable: true) }
        func check(_ condition: Bool, _ reason: String) {
            guard condition else {
                fputs("PhotoAsset Viewer neighbors: \(reason)\n", stderr)
                exit(1)
            }
        }
        func index(_ id: UInt64, _ rev: UInt64 = 7,
                   _ data: [Key] = rows, authorized: Bool = true) -> Int? {
            XDriveIOSNativePhotoAssetViewerNeighborPolicy.loadedIndex(
                current: Key(nodeID: id, revision: rev, previewable: true),
                in: data, ownerAuthorized: authorized)
        }
        func neighbor(_ id: UInt64, _ delta: Int, _ data: [Key] = rows,
                      authorized: Bool = true) -> Int? {
            XDriveIOSNativePhotoAssetViewerNeighborPolicy.neighborIndex(
                current: Key(nodeID: id, revision: 7, previewable: true),
                in: data, direction: delta, ownerAuthorized: authorized)
        }
        check(index(24) == 23, "exact current loaded Node and revision")
        check(neighbor(24, -1) == 22, "previous loaded item")
        check(neighbor(24, 1) == 24, "next loaded item")
        check(neighbor(1, -1) == nil, "start boundary")
        check(neighbor(48, 1) == nil, "end boundary")
        check(neighbor(24, 0) == nil, "zero direction")
        check(neighbor(24, 2) == nil, "skip direction")
        check(neighbor(24, -2) == nil, "reverse skip direction")
        check(index(24, 6) == nil, "stale revision")
        check(index(24, 8) == nil, "newer revision")
        check(index(49) == nil, "evicted Node")
        check(index(0) == nil, "zero Node ID")
        check(index(24, 0) == nil, "zero source revision")
        check(index(24, 7, rows, authorized: false) == nil, "revoked Owner")
        check(neighbor(24, 1, rows, authorized: false) == nil, "revoked navigation")
        check(index(24, 7, rows + [Key(nodeID: 49, revision: 7,
                                         previewable: true)]) == nil, "overlong page")
        check(index(24, 7, rows + [rows[23]]) == nil, "duplicate Node ID")
        check(index(24, 7, [Key(nodeID: 24, revision: 7, previewable: true),
                            Key(nodeID: 24, revision: 8, previewable: true)]) == nil,
              "duplicate ID with changed revision")
        check(index(24, 7, [Key(nodeID: 24, revision: 7, previewable: true),
                            Key(nodeID: 0, revision: 7, previewable: true)]) == nil,
              "malformed Node")
        check(index(24, 7, []) == nil, "empty page")
        let unsupported = rows.enumerated().map { i, key in
            Key(nodeID: key.nodeID, revision: key.revision, previewable: i != 24)
        }
        check(neighbor(24, 1, unsupported) == nil, "unsupported next item")
        check(index(25, 7, unsupported) == nil, "unsupported current item")
        print("native PhotoAsset Viewer bounded neighbor policy checks passed")
    }
}
