import Foundation

@main
struct XDriveIOSNativeFilesPageChecks {
    static func require(_ condition: @autoclosure () -> Bool, _ label: String) {
        if !condition() {
            fputs("native Files Range failed: \(label)\n", stderr)
            exit(1)
        }
    }

    static func main() {
        let parent: UInt64 = 7
        let nodes: [XDriveIOSNativeFilesNode] = (0..<64).map { index in
            XDriveIOSNativeFilesNode(
                id: UInt64(100 + index), parent_id: parent,
                name: "file-\(index).txt", type: "file",
                size: Int64(index), revision: 1
            )
        }
        let page = XDriveIOSNativeFilesRange(
            items: nodes, total_count: 100_000,
            offset: 0, limit: 64, sort: "name", order: "asc"
        )
        require(XDriveIOSNativeFilesPagePolicy.validChildren(
            page, parentID: parent, offset: 0, sort: "name", order: "asc"
        ), "bounded 100k Owner directory first page")
        require(!XDriveIOSNativeFilesPagePolicy.validChildren(
            page, parentID: parent + 1, offset: 0, sort: "name", order: "asc"
        ), "reject foreign parent")
        require(!XDriveIOSNativeFilesPagePolicy.validChildren(
            page, parentID: parent, offset: 64, sort: "name", order: "asc"
        ), "reject mismatched offset")
        require(!XDriveIOSNativeFilesPagePolicy.validChildren(
            page, parentID: parent, offset: 0, sort: "updated", order: "desc"
        ), "reject stale sort")
        let repeated = XDriveIOSNativeFilesRange(
            items: [nodes[0], nodes[0]], total_count: 2,
            offset: 0, limit: 64, sort: "name", order: "asc"
        )
        require(!XDriveIOSNativeFilesPagePolicy.validChildren(
            repeated, parentID: parent, offset: 0, sort: "name", order: "asc"
        ), "reject duplicate Node IDs")
        let empty = XDriveIOSNativeFilesRange(
            items: [], total_count: 100_000, offset: 0,
            limit: 64, sort: "name", order: "asc"
        )
        require(!XDriveIOSNativeFilesPagePolicy.validChildren(
            empty, parentID: parent, offset: 0, sort: "name", order: "asc"
        ), "reject non-progressing page")
        require(XDriveIOSNativeFilesPagePolicy.validSearch(" hello "), "search string")
        require(!XDriveIOSNativeFilesPagePolicy.validSearch("  "), "no empty search")
        require(!XDriveIOSNativeFilesPagePolicy.validSearch(String(repeating: "a", count: 201)),
                "bounded search string")
        require(!XDriveIOSNativeFilesPagePolicy.validOffset(65), "page boundary")
        let search = XDriveIOSNativeFilesSearchRange(
            items: nodes.map { XDriveIOSNativeFilesSearchHit(node: $0, path: "/\($0.name)") },
            total_count: 115_000, offset: 0, limit: 64,
            sort: "name", order: "asc"
        )
        require(XDriveIOSNativeFilesPagePolicy.validResults(
            search, offset: 0, sort: "name", order: "asc"
        ), "bounded full-library range")
        let badSearch = XDriveIOSNativeFilesSearchRange(
            items: [XDriveIOSNativeFilesSearchHit(node: nodes[0], path: "")],
            total_count: 1, offset: 0, limit: 64,
            sort: "name", order: "asc"
        )
        require(!XDriveIOSNativeFilesPagePolicy.validResults(
            badSearch, offset: 0, sort: "name", order: "asc"
        ), "reject missing search path")
        print("native Files bounded Owner Range checks passed")
    }
}
