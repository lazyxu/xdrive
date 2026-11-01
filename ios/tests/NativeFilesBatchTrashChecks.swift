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
        check(P.maxSelected == 64, "bounded to one page")
        check(P.validSelection(list, parentID: 9), "real files and folders")
        check(!P.validSelection([], parentID: 9), "empty batch")
        check(!P.validSelection([one, one], parentID: 9), "duplicate ID")
        check(!P.validSelection([one], parentID: 8), "foreign folder")
        check(!P.validSelection([one], parentID: 0), "rootless target")
        check(!P.validSelection(Array(repeating: one, count: 65), parentID: 9),
              "bounded even for invalid large duplicate batch")
        let old = XDriveIOSNativeFilesNode(
            id: 17, parent_id: 9, name: "old", type: "file", size: 0, revision: 0
        )
        check(!P.validSelection([old], parentID: 9), "zero revision")
        let accepted = XDriveIOSNativeFilesBatchTrashReceipt(
            operation_id: "d641ee17-ec39-4d14-b660-c2a76f01ed5a",
            deleted_ids: [16, 15]
        )
        check(P.validReceipt(accepted, for: list), "exact unordered result")
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
