import Foundation

@main
struct XDriveIOSNativeFilesInlineChecks {
    static func require(_ ok: @autoclosure () -> Bool, _ label: String) {
        if !ok() {
            fputs("native Files inline folder failed: \(label)\n", stderr)
            exit(1)
        }
    }

    static func node(_ id: Int, parent: UInt64 = 9,
                     kind: String = "file", revision: UInt64 = 1)
        -> XDriveIOSNativeFilesNode {
        XDriveIOSNativeFilesNode(
            id: UInt64(id + 1), parent_id: parent,
            name: "child-\(id)", type: kind, size: 1, revision: revision
        )
    }

    static func main() {
        typealias P = XDriveIOSNativeFilesInlinePolicy
        typealias W = XDriveIOSNativeFilesContinuousWindowPolicy
        require(P.maximumBranches == 4, "four active expanded subtrees")
        require(P.maximumDepth == 3, "three nested levels")
        require(P.canExpand(activeBranches: 0, depth: 1) &&
                P.canExpand(activeBranches: 3, depth: 3),
                "bounded expansion allowed")
        require(!P.canExpand(activeBranches: 4, depth: 1) &&
                !P.canExpand(activeBranches: 1, depth: 4),
                "reject too many branches or depth")
        require(P.validParent(node(7, kind: "dir")),
                "a real server folder is eligible")
        require(!P.validParent(node(7)),
                "files are never eligible for disclosure")
        let first = (0..<64).map { node($0) }
        require(P.validWindow(first, parentID: 9, startOffset: 0,
                              total: 115_000), "115k first child page")
        require(!P.validWindow([], parentID: 9, startOffset: 0,
                               total: 115_000), "reject nonprogressing child read")
        require(P.validWindow([], parentID: 9, startOffset: 0, total: 0),
                "verified empty folder is allowed")
        require(!P.validWindow(first, parentID: 8, startOffset: 0,
                               total: 115_000), "no foreign parent child")
        let fourPages = (0..<256).map { node($0) }
        require(P.validWindow(fourPages, parentID: 9, startOffset: 0,
                              total: 115_000), "four 64-node windows")
        require(!P.validWindow((0..<257).map { node($0) },
                               parentID: 9, startOffset: 0,
                               total: 115_000), "never materialize 257 child rows")
        let next = W.mergePlan(direction: .next, startOffset: 0,
                               currentIDs: fourPages.map(\.id),
                               incomingIDs: (256..<320).map { node($0).id },
                               pageOffset: 256, total: 115_000,
                               returnedTotal: 115_000)
        require(next == W.MergePlan(startOffset: 64, dropFromFront: 64,
                                    dropFromBack: 0),
                "forward sliding window")
        let after = (64..<320).map { node($0) }
        require(P.validWindow(after, parentID: 9, startOffset: 64,
                              total: 115_000), "sliding maintains 256 rows")
        let previous = W.mergePlan(direction: .previous, startOffset: 64,
                                   currentIDs: after.map(\.id),
                                   incomingIDs: first.map(\.id),
                                   pageOffset: 0, total: 115_000,
                                   returnedTotal: 115_000)
        require(previous == W.MergePlan(startOffset: 0, dropFromFront: 0,
                                        dropFromBack: 64),
                "reverse scrolling restores earlier children")
        require(!P.validWindow(first + [first[0]], parentID: 9,
                               startOffset: 0, total: 115_000),
                "duplicate child IDs rejected")
        require(!P.validWindow((0..<64).map { node($0, revision: 0) },
                               parentID: 9, startOffset: 0, total: 115_000),
                "unverified revisions rejected")
        require(!P.validWindow(first, parentID: 9, startOffset: 1,
                               total: 115_000), "unaligned offset rejected")
        print("native Files inline bounded paging checks passed")
    }
}
