import Foundation

@main
struct XDriveIOSNativeFilesBatchTrashChecks {
    static func check(_ condition: @autoclosure () -> Bool, _ message: String) {
        if !condition() { fputs("Files batch trash: \(message)\n", stderr); exit(1) }
    }
    static func main() {
        typealias P = XDriveIOSNativeFilesBatchTrashPolicy
        let one = XDriveIOSNativeFilesNode(
            id: 15, parent_id: 9, name: "a.txt", type: "file", size: 5, revision: 2
        )
        let two = XDriveIOSNativeFilesNode(
            id: 16, parent_id: 9, name: "folder", type: "dir", size: 0, revision: 4
        )
        let list = [one, two]
        check(P.maxSelected == 200, "matches atomic Server batch limit")
        check(P.validSelection(list, parentID: 9), "real files and folders")
        check(!P.validSelection([], parentID: 9), "empty batch")
        check(!P.validSelection([one, one], parentID: 9), "duplicate ID")
        check(!P.validSelection([one], parentID: 8), "foreign folder")
        check(!P.validSelection([one], parentID: 0), "rootless target")
        let bulk = (0..<200).map { index in
            XDriveIOSNativeFilesNode(
                id: UInt64(1_000 + index), parent_id: 9,
                name: "node-\(index).txt", type: "file",
                size: 1, revision: 2
            )
        }
        check(P.validSelection(bulk, parentID: 9), "200 unique loaded Owner Nodes")
        check(!P.validSelection(bulk + [one], parentID: 9),
              "201 different Nodes exceed Server batch limit")
        check(!P.validSelection(Array(repeating: one, count: 65), parentID: 9),
              "large duplicate ID batch refused")
        let old = XDriveIOSNativeFilesNode(
            id: 17, parent_id: 9, name: "old", type: "file", size: 0, revision: 0
        )
        check(!P.validSelection([old], parentID: 9), "zero revision")
        let accepted = XDriveIOSNativeFilesBatchTrashReceipt(
            operation_id: "d641ee17-ec39-4d14-b660-c2a76f01ed5a",
            deleted_ids: [16, 15]
        )
        check(P.validReceipt(accepted, for: list), "exact unordered result")
        let bulkReceipt = XDriveIOSNativeFilesBatchTrashReceipt(
            operation_id: accepted.operation_id,
            deleted_ids: bulk.map(\.id).reversed()
        )
        check(P.validReceipt(bulkReceipt, for: bulk),
              "200-item exact atomic Server receipt")
        let shortBulkReceipt = XDriveIOSNativeFilesBatchTrashReceipt(
            operation_id: accepted.operation_id,
            deleted_ids: Array(bulk.map(\.id).dropLast())
        )
        check(!P.validReceipt(shortBulkReceipt, for: bulk),
              "200-item incomplete Server receipt rejected")
        let duplicated = XDriveIOSNativeFilesBatchTrashReceipt(
            operation_id: accepted.operation_id, deleted_ids: [15, 15]
        )
        check(!P.validReceipt(duplicated, for: list), "duplicated Server ID")
        let missing = XDriveIOSNativeFilesBatchTrashReceipt(
            operation_id: accepted.operation_id, deleted_ids: [15]
        )
        check(!P.validReceipt(missing, for: list), "missing Server ID")
        let unknown = XDriveIOSNativeFilesBatchTrashReceipt(
            operation_id: accepted.operation_id, deleted_ids: [15, 19]
        )
        check(!P.validReceipt(unknown, for: list), "foreign Server ID")
        let forged = XDriveIOSNativeFilesBatchTrashReceipt(
            operation_id: "not-a-uuid", deleted_ids: [15, 16]
        )
        check(!P.validReceipt(forged, for: list), "invalid operation receipt")
        print("native Files bounded batch trash checks passed")
    }
}
