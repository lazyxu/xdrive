import Foundation

@main
struct XDriveIOSNativeFilesChunkedPolicyChecks {
    static func check(_ ok: @autoclosure () -> Bool, _ message: String) {
        if !ok() {
            fputs("native Files chunked policy failed: \(message)\n", stderr)
            exit(1)
        }
    }
    static func node(_ id: UInt64, parent: UInt64 = 7,
                     revision: UInt64 = 1) -> XDriveIOSNativeFilesNode {
        XDriveIOSNativeFilesNode(
            id: id, parent_id: parent, name: "file-\(id).txt",
            type: "file", size: 42, revision: revision
        )
    }
    static func main() {
        typealias P = XDriveIOSNativeFilesChunkedPolicy
        let twoHundred = (1...200).map { node(UInt64($0)) }
        check(P.groups(twoHundred, parentID: 7) == nil,
              "single atomic transaction remains on existing writer")
        let twoHundredOne = (1...201).map { node(UInt64($0)) }
        let two = P.groups(twoHundredOne, parentID: 7)
        check(two?.count == 2 && two?[0].count == 200 && two?[1].count == 1,
              "201 nodes use two independently bounded transactions")
        check(two?[0].first?.id == 1 && two?[1].first?.id == 201,
              "deterministic non-overlapping chunk membership")
        let maximum = (1...2048).map { node(UInt64($0)) }
        let groups = P.groups(maximum, parentID: 7)
        check(groups?.count == 11 && groups?.last?.count == 48,
              "2048 snapshots have ten full chunks and a final 48")
        check(groups?.flatMap { $0.map(\.id) } == maximum.map(\.id),
              "every selected Node is processed exactly once")
        check(P.groups((1...2049).map { node(UInt64($0)) }, parentID: 7) == nil,
              "never materialize 100k selection into a foreground batch")
        check(P.groups(twoHundredOne + [node(1)], parentID: 7) == nil,
              "duplicate Node rejected before any POST")
        check(P.groups(twoHundredOne.dropLast() + [node(201, parent: 9)],
                       parentID: 7) == nil,
              "cross-parent selection rejected")
        check(P.groups(twoHundredOne.dropLast() + [node(201, revision: 0)],
                       parentID: 7) == nil,
              "stale revision rejected")
        check(P.groups(twoHundredOne, parentID: 0) == nil,
              "unknown Owner parent rejected")
        check(!XDriveIOSNativeFilesBatchTrashPolicy.validSelection(
            twoHundredOne, parentID: 7),
              "Go atomic batch contract still refuses more than 200")
        print("Native Files chunked selection policy: PASS")
    }
}
