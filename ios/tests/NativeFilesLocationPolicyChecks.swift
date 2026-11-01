import Foundation

@main
struct NativeFilesLocationPolicyChecks {
    private static func check(_ ok: @autoclosure () -> Bool, _ name: String) {
        if !ok() {
            fputs("native Files locate: \(name)\n", stderr)
            exit(1)
        }
    }

    static func main() {
        typealias P = XDriveIOSNativeFilesLocationPolicy
        let file = XDriveIOSNativeFilesNode(id: 40, parent_id: 20,
            name: "photo.HEIC", type: "file", size: 100, revision: 3)
        let dir = XDriveIOSNativeFilesNode(id: 20, parent_id: 10,
            name: "2026", type: "dir", size: 0, revision: 2)
        let root = XDriveIOSNativeFilesLocationCrumb(id: 10, name: "")
        let folder = XDriveIOSNativeFilesLocationCrumb(id: 20, name: "2026")
        let fileLocation = XDriveIOSNativeFilesLocationDTO(
            node_id: 40, revision: 3, node_type: "file", parent_id: 20,
            breadcrumbs: [root, folder]
        )
        check(P.parent(of: file, at: fileLocation, ownerRootID: 10) ==
              .init(id: 20, name: "2026"), "file -> parent")
        let dirLocation = XDriveIOSNativeFilesLocationDTO(
            node_id: 20, revision: 2, node_type: "dir", parent_id: 10,
            breadcrumbs: [root, folder]
        )
        check(P.parent(of: dir, at: dirLocation, ownerRootID: 10) ==
              .init(id: 10, name: "云端根目录"), "directory -> root parent")
        let atRoot = XDriveIOSNativeFilesNode(id: 41, parent_id: 10,
            name: "plain.txt", type: "file", size: 4, revision: 1)
        check(P.parent(of: atRoot, at: .init(node_id: 41, revision: 1,
              node_type: "file", parent_id: 10, breadcrumbs: [root]),
              ownerRootID: 10) == .init(id: 10, name: "云端根目录"),
              "file directly inside root")
        check(P.parent(of: file, at: .init(node_id: 40, revision: 2,
              node_type: "file", parent_id: 20, breadcrumbs: [root, folder]),
              ownerRootID: 10) == nil, "reject stale revision")
        check(P.parent(of: file, at: fileLocation, ownerRootID: 11) == nil,
              "reject different root owner")
        check(P.parent(of: file, at: .init(node_id: 40, revision: 3,
              node_type: "file", parent_id: 10, breadcrumbs: [root, folder]),
              ownerRootID: 10) == nil, "reject stale parent")
        check(P.parent(of: file, at: .init(node_id: 40, revision: 3,
              node_type: "file", parent_id: 20, breadcrumbs: [root, root, folder]),
              ownerRootID: 10) == nil, "reject repeated ancestor")
        check(P.parent(of: dir, at: .init(node_id: 20, revision: 2,
              node_type: "dir", parent_id: 10, breadcrumbs: [root]),
              ownerRootID: 10) == nil, "reject missing directory crumb")
        let position = XDriveIOSNativeFilesPositionDTO(
            node_id: 40, revision: 3, index: 137,
            sort: "name", order: "asc", group: "none", folders_first: true
        )
        check(P.pageOffset(of: file, position: position) == 128,
              "exact 64-item page for a large folder")
        check(P.pageOffset(of: file, position: .init(
            node_id: 40, revision: 2, index: 137,
            sort: "name", order: "asc", group: "none", folders_first: true
        )) == nil, "stale position revision")
        check(P.pageOffset(of: file, position: .init(
            node_id: 40, revision: 3, index: 137,
            sort: "updated", order: "asc", group: "none", folders_first: true
        )) == nil, "different sort")
        check(P.pageOffset(of: file, position: .init(
            node_id: 40, revision: 3, index: -1,
            sort: "name", order: "asc", group: "none", folders_first: true
        )) == nil, "negative position")
        check(P.pageOffset(of: file, position: .init(
            node_id: 40, revision: 3, index: 5,
            sort: "name", order: "asc", group: "none", folders_first: false
        )) == nil, "grouping changed")
        print("native Files search locate verified ancestor and page policy: PASS")
    }
}
