import Foundation

@main
struct XDriveIOSNativeFilesBatchTargetChecks {
    private static func verify(_ condition: @autoclosure () -> Bool, _ name: String) {
        if !condition() { fputs("native Files batch target: \(name)\n", stderr); exit(1) }
    }

    static func main() {
        typealias P = XDriveIOSNativeFilesBatchTargetPolicy
        let file = XDriveIOSNativeFilesNode(
            id: 11, parent_id: 4, name: "a.pdf", type: "file", size: 23, revision: 3
        )
        let folder = XDriveIOSNativeFilesNode(
            id: 12, parent_id: 4, name: "photos", type: "dir", size: 0, revision: 5
        )
        let selected = [file, folder]
        verify(P.validSelection(selected, sourceParentID: 4,
                                destinationID: 5, kind: .move), "valid verified page")
        verify(P.validSelection(selected, sourceParentID: 4,
                                destinationID: 4, kind: .copy), "copy in same folder")
        verify(!P.validSelection(selected, sourceParentID: 4,
                                 destinationID: 4, kind: .move), "no-op move rejected")
        verify(!P.validSelection(selected, sourceParentID: 4,
                                 destinationID: 12, kind: .copy), "folder self target")
        verify(!P.validSelection([file, file], sourceParentID: 4,
                                 destinationID: 5, kind: .copy), "duplicate ID")
        verify(!P.validSelection([file, folder], sourceParentID: 8,
                                 destinationID: 5, kind: .copy), "foreign parent")
        verify(!P.validSelection([], sourceParentID: 4,
                                 destinationID: 5, kind: .copy), "empty")
        verify(!P.validSelection(Array(repeating: file, count: 65),
                                 sourceParentID: 4, destinationID: 5,
                                 kind: .copy), "single page cap")

        let newFile = XDriveIOSNativeFilesNode(
            id: 21, parent_id: 5, name: "a (1).pdf", type: "file", size: 23, revision: 1
        )
        let newFolder = XDriveIOSNativeFilesNode(
            id: 22, parent_id: 5, name: "photos", type: "dir", size: 0, revision: 1
        )
        let movedFile = XDriveIOSNativeFilesNode(
            id: 11, parent_id: 5, name: "a.pdf", type: "file", size: 23, revision: 4
        )
        let movedFolder = XDriveIOSNativeFilesNode(
            id: 12, parent_id: 5, name: "photos", type: "dir", size: 0, revision: 6
        )
        let receiptID = "1d2c3b4a-5e6f-4a70-b821-aabbccddeeff"
        let goodCopy = XDriveIOSNativeFilesBatchTargetReceipt(
            operation_id: receiptID, items: [newFile, newFolder]
        )
        let goodMove = XDriveIOSNativeFilesBatchTargetReceipt(
            operation_id: receiptID, items: [movedFile, movedFolder]
        )
        verify(P.validReceipt(goodCopy, original: selected,
                              sourceParentID: 4, destinationID: 5, kind: .copy),
               "new copy IDs and Server-chosen name")
        verify(P.validReceipt(goodMove, original: selected,
                              sourceParentID: 4, destinationID: 5, kind: .move),
               "exact moved IDs and revision")
        let malformed = XDriveIOSNativeFilesBatchTargetReceipt(
            operation_id: "bad", items: goodCopy.items
        )
        verify(!P.validReceipt(malformed, original: selected,
                               sourceParentID: 4, destinationID: 5, kind: .copy),
               "invalid operation UUID")
        let reused = XDriveIOSNativeFilesBatchTargetReceipt(
            operation_id: receiptID, items: [movedFile, newFolder]
        )
        verify(!P.validReceipt(reused, original: selected,
                               sourceParentID: 4, destinationID: 5, kind: .copy),
               "copy reused source ID")
        let duplicate = XDriveIOSNativeFilesBatchTargetReceipt(
            operation_id: receiptID, items: [newFile, newFile]
        )
        verify(!P.validReceipt(duplicate, original: selected,
                               sourceParentID: 4, destinationID: 5, kind: .copy),
               "duplicate server result IDs")
        let oldMove = XDriveIOSNativeFilesBatchTargetReceipt(
            operation_id: receiptID, items: [file, movedFolder]
        )
        verify(!P.validReceipt(oldMove, original: selected,
                               sourceParentID: 4, destinationID: 5, kind: .move),
               "old parent/revision")
        let wrongType = XDriveIOSNativeFilesNode(
            id: 22, parent_id: 5, name: "photos", type: "file", size: 0, revision: 1
        )
        verify(!P.validReceipt(.init(operation_id: receiptID,
                                     items: [newFile, wrongType]),
                               original: selected, sourceParentID: 4,
                               destinationID: 5, kind: .copy), "wrong kind")
        let wrongParent = XDriveIOSNativeFilesNode(
            id: 22, parent_id: 6, name: "photos", type: "dir", size: 0, revision: 1
        )
        verify(!P.validReceipt(.init(operation_id: receiptID,
                                     items: [newFile, wrongParent]),
                               original: selected, sourceParentID: 4,
                               destinationID: 5, kind: .copy), "wrong target")
        print("native Files one-page copy/move receipt checks passed")
    }
}
