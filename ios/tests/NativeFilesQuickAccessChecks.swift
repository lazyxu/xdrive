import Foundation

@main
struct XDriveIOSNativeFilesQuickAccessChecks {
    static func require(_ ok: @autoclosure () -> Bool, _ name: String) {
        if !ok() {
            fputs("iOS Files Quick Access failed: \(name)\n", stderr)
            exit(1)
        }
    }

    static func item(_ id: UInt64, position: Int,
                     parent: UInt64? = 7,
                     kind: String = "dir") -> XDriveIOSNativeFilesQuickAccessItem {
        let node = XDriveIOSNativeFilesNode(
            id: id, parent_id: parent, name: "work-\(id)",
            type: kind, size: 0, revision: 2
        )
        return XDriveIOSNativeFilesQuickAccessItem(
            node: node, path: "/Work/\(id)", position: position
        )
    }

    static func main() {
        typealias P = XDriveIOSNativeFilesQuickAccessPolicy
        let a = item(42, position: 0)
        let b = item(88, position: 3)
        require(P.maximumItems == 64, "Server pinned-directory cap")
        require(P.valid(a), "real Owner directory with version and parent")
        require(P.validList([a, b]), "allow sparse persisted positions after deletion")
        require(!P.validList([a, a]), "duplicate node identity")
        require(P.canReorder([88, 42], items: [a, b]),
                "exact authenticated IDs may change order")
        require(!P.canReorder([42, 42], items: [a, b]),
                "reject duplicate reordered Node IDs")
        require(!P.canReorder([42], items: [a, b]),
                "reject incomplete order")
        require(!P.canReorder([42, 999], items: [a, b]),
                "reject another Owner's unknown Node")
        require(!P.valid(item(0, position: 0)), "zero ID rejected")
        require(!P.valid(item(43, position: -1)), "negative position rejected")
        require(!P.valid(item(99, position: 1, parent: nil)),
                "root may not be pinned")
        require(!P.valid(item(99, position: 1, kind: "file")),
                "file may not be pinned as shortcut")
        require(!P.canPin(item(99, position: 1, kind: "file").node),
                "files not eligible for folder pin")
        require(!P.validList((0..<65).map {
            item(UInt64($0 + 1), position: $0)
        }), "never load more than 64 quick-access folders")
        let json = Data(#"{"node":{"id":42,"parent_id":7,"name":"work-42","type":"dir","size":0,"revision":2},"path":"/Work/42","position":0,"pinned_at":"2026-11-06T01:00:00Z","crumbs":[]}"#.utf8)
        let parsed = try? JSONDecoder().decode(
            XDriveIOSNativeFilesQuickAccessItem.self, from: json
        )
        require(parsed?.id == 42 && parsed?.position == 0,
                "decode existing Server Quick Access JSON projection")
        require(parsed.map(P.valid) == true,
                "validate trusted Server Node quick-access projection")
        print("native Files Quick Access Server contract passed")
    }
}
