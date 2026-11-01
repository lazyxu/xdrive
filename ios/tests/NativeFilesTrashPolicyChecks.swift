import Foundation

@main
struct XDriveIOSNativeFilesTrashPolicyChecks {
    private static func verify(_ ok: @autoclosure () -> Bool, _ name: String) {
        if !ok() {
            fputs("iOS native Files trash: \(name)\n", stderr)
            exit(1)
        }
    }

    static func main() {
        typealias P = XDriveIOSNativeFilesTrashPolicy
        let deleted = XDriveIOSNativeFilesTrashNode(
            id: 35, parent_id: 5, name: "report.pdf", type: "file",
            size: 123, revision: 7, deleted_at: "2026-11-01T05:00:00Z"
        )
        let folder = XDriveIOSNativeFilesTrashNode(
            id: 36, parent_id: 5, name: "images", type: "dir",
            size: 0, revision: 3, deleted_at: "2026-10-30T05:00:00Z"
        )
        let good = XDriveIOSNativeFilesTrashRange(
            items: [deleted, folder], total_count: 2,
            total_count_included: true, offset: 0, limit: P.pageSize,
            sort: P.sort, order: P.order
        )
        verify(P.validRange(good, offset: 0), "valid bounded trash page")
        let missingCount = XDriveIOSNativeFilesTrashRange(
            items: [deleted], total_count: 2,
            total_count_included: false, offset: 0, limit: P.pageSize,
            sort: P.sort, order: P.order
        )
        verify(!P.validRange(missingCount, offset: 0), "missing count")
        let duplicate = XDriveIOSNativeFilesTrashRange(
            items: [deleted, deleted], total_count: 2,
            total_count_included: true, offset: 0, limit: P.pageSize,
            sort: P.sort, order: P.order
        )
        verify(!P.validRange(duplicate, offset: 0), "duplicate ids")
        let wrongSort = XDriveIOSNativeFilesTrashRange(
            items: [deleted], total_count: 1,
            total_count_included: true, offset: 0, limit: P.pageSize,
            sort: "name", order: P.order
        )
        verify(!P.validRange(wrongSort, offset: 0), "unverified order")
        let noDeleted = XDriveIOSNativeFilesTrashNode(
            id: 35, parent_id: 5, name: "report.pdf", type: "file",
            size: 123, revision: 7, deleted_at: nil
        )
        verify(!P.validDeleted(noDeleted), "active Node cannot enter trash")
        let restored = XDriveIOSNativeFilesTrashNode(
            id: 35, parent_id: 5, name: "report.pdf", type: "file",
            size: 123, revision: 8, deleted_at: nil
        )
        verify(P.validRestored(restored, from: deleted), "exact restore")
        verify(!P.validRestored(noDeleted, from: deleted), "no stale revision")
        let wrongParent = XDriveIOSNativeFilesTrashNode(
            id: 35, parent_id: 9, name: "report.pdf", type: "file",
            size: 123, revision: 8, deleted_at: nil
        )
        verify(!P.validRestored(wrongParent, from: deleted), "original parent")
        let emptyBeyond = XDriveIOSNativeFilesTrashRange(
            items: [], total_count: 60, total_count_included: true,
            offset: 64, limit: P.pageSize, sort: P.sort, order: P.order
        )
        verify(P.validRange(emptyBeyond, offset: 64), "last page deleted")
        print("native Files trash range / restore contract: PASS")
    }
}
