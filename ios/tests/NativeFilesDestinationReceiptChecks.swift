import Foundation

@main
struct XDriveIOSNativeFilesDestinationReceiptChecks {
    static func check(_ condition: @autoclosure () -> Bool, _ name: String) {
        if !condition() { fputs("destination receipt: \(name)\n", stderr); exit(1) }
    }
    static func main() {
        let original = XDriveIOSNativeFilesNode(
            id: 9, parent_id: 2, name: "a.jpg", type: "file", size: 8192, revision: 5
        )
        let copy = XDriveIOSNativeFilesNode(
            id: 30, parent_id: 7, name: "a.jpg", type: "file", size: 8192, revision: 1
        )
        let moved = XDriveIOSNativeFilesNode(
            id: 9, parent_id: 7, name: "a.jpg", type: "file", size: 8192, revision: 6
        )
        typealias P = XDriveIOSNativeFilesDestinationReceiptPolicy
        check(P.copied(original: original, result: copy, targetID: 7), "exact copy")
        check(P.moved(original: original, result: moved, targetID: 7), "exact move")
        check(!P.copied(original: original, result: moved, targetID: 7), "same ID copy")
        check(!P.moved(original: original, result: copy, targetID: 7), "changed ID move")
        check(!P.moved(original: original, result: moved, targetID: 2), "same parent")
        check(!P.copied(original: original, result: copy, targetID: 8), "wrong target")
        let stale = XDriveIOSNativeFilesNode(
            id: 9, parent_id: 7, name: "a.jpg", type: "file", size: 8192, revision: 5
        )
        check(!P.moved(original: original, result: stale, targetID: 7), "old revision")
        let wrongSize = XDriveIOSNativeFilesNode(
            id: 30, parent_id: 7, name: "a.jpg", type: "file", size: 8, revision: 1
        )
        check(!P.copied(original: original, result: wrongSize, targetID: 7), "wrong size")
        let wrongKind = XDriveIOSNativeFilesNode(
            id: 30, parent_id: 7, name: "a.jpg", type: "dir", size: 8192, revision: 1
        )
        check(!P.copied(original: original, result: wrongKind, targetID: 7), "wrong type")
        print("native Files directory target receipt checks passed")
    }
}
