import Foundation

@main
struct XDriveIOSNativeFilesSelectAllChecks {
    typealias Policy = XDriveIOSNativeFilesSelectAllAccumulator

    static func require(_ ok: @autoclosure () -> Bool, _ message: String) {
        if !ok() {
            fputs("Native Files Select All failed: \(message)\n", stderr)
            exit(1)
        }
    }

    static func node(_ id: UInt64, parent: UInt64 = 7,
                     revision: UInt64 = 1) -> XDriveIOSNativeFilesNode {
        XDriveIOSNativeFilesNode(
            id: id, parent_id: parent, name: "file-\(id).txt",
            type: "file", size: 100, revision: revision
        )
    }

    static func page(_ start: Int, _ count: Int, total: Int,
                     parent: UInt64 = 7, sort: String = "name",
                     order: String = "asc") -> XDriveIOSNativeFilesRange {
        XDriveIOSNativeFilesRange(
            items: (start..<(start + count)).map { node(UInt64($0 + 1), parent: parent) },
            total_count: total, offset: start, limit: 64,
            sort: sort, order: order
        )
    }

    static func main() {
        require(Policy(parentID: 7, total: 0, sort: "name", order: "asc") == nil,
                "empty directory has no selection transaction")
        require(Policy(parentID: 7, total: 201, sort: "name", order: "asc") == nil,
                "cannot exceed 200 selected nodes")
        require(Policy(parentID: 7, total: 100_000, sort: "name", order: "asc") == nil,
                "100k listing is never materialized by Select All")
        require(Policy(parentID: 0, total: 64, sort: "name", order: "asc") == nil,
                "unverified parent is rejected")
        require(Policy(parentID: 7, total: 10, sort: "bogus", order: "asc") == nil,
                "sort must match the Server contract")

        var all = Policy(parentID: 7, total: 200, sort: "name", order: "asc")!
        require(all.verifiedSelection() == nil, "cannot expose partial results")
        require(all.append(page(0, 64, total: 200)), "first 64-item Server page")
        require(all.nextOffset == 64, "next offset after one page")
        require(!all.append(page(128, 64, total: 200)), "shifted second page fails")
        require(all.nextOffset == 64 && all.snapshots.count == 64,
                "rejected range does not change state")
        require(!all.append(page(64, 64, total: 199)), "changed total fails")
        require(!all.append(page(64, 64, total: 200, parent: 999)),
                "foreign parent fails")
        require(!all.append(page(0, 64, total: 200)), "repeated page fails")
        require(all.append(page(64, 64, total: 200)), "second 64-item Server page")
        require(all.append(page(128, 64, total: 200)), "third 64-item Server page")
        require(all.nextOffset == 192 && all.verifiedSelection() == nil,
                "do not commit a 192-of-200 selection")
        require(!all.append(page(192, 7, total: 200)),
                "short final page rejected without committing")
        require(all.nextOffset == 192 && all.snapshots.count == 192,
                "short final page has no partial side effects")
        require(all.append(page(192, 8, total: 200)), "last eight items complete selection")
        require(all.nextOffset == 200 && all.verifiedSelection()?.count == 200,
                "200 verified entries selected across four pages")
        require(all.verifiedSelection()?[1]?.parent_id == 7 &&
                all.verifiedSelection()?[200]?.id == 200,
                "selection carries immutable verified Node snapshots")
        require(!all.append(page(192, 8, total: 200)), "no fifth page after completion")

        var one = Policy(parentID: 7, total: 1, sort: "updated", order: "desc")!
        require(!one.append(page(0, 1, total: 1)), "wrong sort/order rejected")
        require(one.append(page(0, 1, total: 1, sort: "updated", order: "desc")),
                "one-node directory select-all permitted")
        require(one.verifiedSelection()?.count == 1, "one-node completion")

        var duplicate = Policy(parentID: 7, total: 65, sort: "name", order: "asc")!
        require(duplicate.append(page(0, 64, total: 65)), "duplicate setup")
        let repeated = XDriveIOSNativeFilesRange(
            items: [node(64)], total_count: 65, offset: 64,
            limit: 64, sort: "name", order: "asc"
        )
        require(!duplicate.append(repeated), "cross-page duplicate ID rejected")
        require(duplicate.nextOffset == 64 && duplicate.snapshots.count == 64,
                "duplicate ID preserves previous trusted snapshots")

        var malformed = Policy(parentID: 7, total: 2, sort: "name", order: "asc")!
        let duplicatedInside = XDriveIOSNativeFilesRange(
            items: [node(5), node(5)], total_count: 2, offset: 0,
            limit: 64, sort: "name", order: "asc"
        )
        require(!malformed.append(duplicatedInside), "same-page duplicate rejected")
        let invalidRevision = XDriveIOSNativeFilesRange(
            items: [node(5, revision: 0), node(6)], total_count: 2,
            offset: 0, limit: 64, sort: "name", order: "asc"
        )
        require(!malformed.append(invalidRevision), "invalid revision rejected")
        require(malformed.nextOffset == 0 && malformed.snapshots.isEmpty,
                "invalid page cannot partially commit")
        print("Native Files bounded Select All policy passed")
    }
}
