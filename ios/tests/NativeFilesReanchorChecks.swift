import Foundation

/// Foundation-only tests: the UI may scroll only to an authenticated,
/// revision-identical Node in the new 64-row Server ordering.
@main
struct XDriveIOSNativeFilesReanchorChecks {
    typealias P = XDriveIOSNativeFilesReanchorPolicy

    static func require(_ condition: @autoclosure () -> Bool, _ message: String) {
        if !condition() {
            fputs("Native Files reanchor failed: \(message)\n", stderr)
            exit(1)
        }
    }

    static func node(_ id: UInt64, revision: UInt64 = 3,
                     parent: UInt64 = 7) -> XDriveIOSNativeFilesNode {
        XDriveIOSNativeFilesNode(
            id: id, parent_id: parent, name: "file-\(id).txt",
            type: "file", size: 100, revision: revision
        )
    }

    static func main() {
        let target = node(42)
        let destination = XDriveIOSNativeFilesChildPosition(
            node_id: 42, revision: 3, index: 130,
            sort: "updated", order: "desc",
            group: "type", folders_first: true
        )
        var rows = (0..<64).map { node(UInt64($0 + 1000)) }
        rows[2] = target
        let page = XDriveIOSNativeFilesRange(
            items: rows, total_count: 512, offset: 128, limit: 64,
            sort: "updated", order: "desc"
        )
        require(P.pageOffset(
            destination, node: target, parentID: 7, sort: "updated",
            order: "desc", grouping: "type", foldersFirst: true
        ) == 128, "100k-capable sort/group ordinal uses only its 64-row page")
        require(P.verifiedDestination(
            page, position: destination, node: target, parentID: 7,
            sort: "updated", order: "desc", grouping: "type", foldersFirst: true
        ), "matching Owner parent, Node revision, sort and 64-row target")

        let changedRevision = node(42, revision: 4)
        require(!P.verifiedDestination(
            page, position: destination, node: changedRevision, parentID: 7,
            sort: "updated", order: "desc", grouping: "type", foldersFirst: true
        ), "stale Node revision never reanchors")
        require(P.pageOffset(
            destination, node: target, parentID: 8, sort: "updated",
            order: "desc", grouping: "type", foldersFirst: true
        ) == nil, "foreign parent cannot reuse an ordinal")
        require(P.pageOffset(
            destination, node: target, parentID: 7, sort: "name",
            order: "asc", grouping: "type", foldersFirst: true
        ) == nil, "sort+order mismatch cannot reuse an ordinal")
        require(P.pageOffset(
            destination, node: target, parentID: 7, sort: "updated",
            order: "desc", grouping: "size", foldersFirst: true
        ) == nil, "group mismatch cannot reuse an ordinal")
        require(P.pageOffset(
            destination, node: target, parentID: 7, sort: "updated",
            order: "desc", grouping: "type", foldersFirst: false
        ) == nil, "folders-first mismatch cannot reuse an ordinal")
        var mismatchedRows = rows
        mismatchedRows[2] = node(99)
        let changedPage = XDriveIOSNativeFilesRange(
            items: mismatchedRows, total_count: 512, offset: 128, limit: 64,
            sort: "updated", order: "desc"
        )
        require(!P.verifiedDestination(
            changedPage, position: destination, node: target, parentID: 7,
            sort: "updated", order: "desc", grouping: "type", foldersFirst: true
        ), "wrong item at ordinal never scrolls")
        let wrongOffset = XDriveIOSNativeFilesRange(
            items: rows, total_count: 512, offset: 64, limit: 64,
            sort: "updated", order: "desc"
        )
        require(!P.verifiedDestination(
            wrongOffset, position: destination, node: target, parentID: 7,
            sort: "updated", order: "desc", grouping: "type", foldersFirst: true
        ), "wrong page must not be guessed or accepted")
        let hugeOrdinal = XDriveIOSNativeFilesChildPosition(
            node_id: 42, revision: 3, index: 10_000_000,
            sort: "updated", order: "desc",
            group: "type", folders_first: true
        )
        require(P.pageOffset(
            hugeOrdinal, node: target, parentID: 7, sort: "updated",
            order: "desc", grouping: "type", foldersFirst: true
        ) == nil, "out-of-range ordinal is rejected")
        print("Native Files verified child-position reanchor checks passed")
    }
}
