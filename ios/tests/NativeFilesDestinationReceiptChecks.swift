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
        let directory = XDriveIOSNativeFilesNode(
            id: 50, parent_id: 2, name: "相册", type: "dir", size: 0, revision: 3
        )
        let copiedDirectory = XDriveIOSNativeFilesNode(
            id: 51, parent_id: 7, name: "相册", type: "dir", size: 0, revision: 1
        )
        let movedDirectory = XDriveIOSNativeFilesNode(
            id: 50, parent_id: 7, name: "相册", type: "dir", size: 0, revision: 4
        )
        check(P.copied(original: directory, result: copiedDirectory, targetID: 7),
              "directory copy")
        check(P.moved(original: directory, result: movedDirectory, targetID: 7),
              "directory move")
        check(!P.copied(original: directory, result: copiedDirectory, targetID: 50),
              "directory copy into self")
        check(!P.moved(original: directory, result: movedDirectory, targetID: 50),
              "directory move into self")
        check(!P.copied(original: directory, result: copy, targetID: 7),
              "copy wrong node kind")
        check(!P.moved(original: directory, result: moved, targetID: 7),
              "move wrong node kind")
        let root = XDriveIOSNativeFilesNode(
            id: 1, parent_id: nil, name: "root", type: "dir", size: 0, revision: 1
        )
        check(!P.copied(original: root, result: copiedDirectory, targetID: 7),
              "root cannot be copied")
        check(!P.moved(original: root, result: movedDirectory, targetID: 7),
              "root cannot be moved")
        print("native Files directory target receipt checks passed")
    }
}
