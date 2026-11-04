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
            sort: P.defaultSort, order: P.defaultOrder
        )
        verify(P.validRange(good, offset: 0), "valid bounded trash page")
        let missingCount = XDriveIOSNativeFilesTrashRange(
            items: [deleted], total_count: 2,
            total_count_included: false, offset: 0, limit: P.pageSize,
            sort: P.defaultSort, order: P.defaultOrder
        )
        verify(!P.validRange(missingCount, offset: 0), "missing count")
        let duplicate = XDriveIOSNativeFilesTrashRange(
            items: [deleted, deleted], total_count: 2,
            total_count_included: true, offset: 0, limit: P.pageSize,
            sort: P.defaultSort, order: P.defaultOrder
        )
        verify(!P.validRange(duplicate, offset: 0), "duplicate ids")
        let sortedPage = XDriveIOSNativeFilesTrashRange(
            items: [deleted], total_count: 1,
            total_count_included: true, offset: 0, limit: P.pageSize,
            sort: "updated", order: "desc"
        )
        verify(P.validRange(sortedPage, offset: 0, sort: "updated", order: "desc"),
               "accept supported Server sort and direction")
        verify(!P.validRange(sortedPage, offset: 0),
               "reject a response for a different requested sort")
        verify(P.validSortOrder(sort: "name", order: "asc"), "name ascending")
        verify(P.validSortOrder(sort: "updated", order: "desc"), "deleted date descending")
        verify(P.validSortOrder(sort: "size", order: "asc"), "size ascending")
        verify(P.validSortOrder(sort: "type", order: "desc"), "type descending")
        verify(!P.validSortOrder(sort: "modified", order: "asc"), "reject unsupported sort")
        verify(!P.validSortOrder(sort: "name", order: "sideways"), "reject unsupported order")
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
            offset: 64, limit: P.pageSize, sort: P.defaultSort, order: P.defaultOrder
        )
        verify(P.validRange(emptyBeyond, offset: 64), "last page deleted")
        let firstChunk = (0..<64).map { index in
            XDriveIOSNativeFilesTrashNode(
                id: UInt64(index + 1000), parent_id: 5, name: "old-\(index)",
                type: "file", size: 1, revision: 1,
                deleted_at: "2026-11-01T00:00:00Z"
            )
        }
        let nextChunk = (0..<64).map { index in
            XDriveIOSNativeFilesTrashNode(
                id: UInt64(index + 2000), parent_id: 5, name: "next-\(index)",
                type: "file", size: 1, revision: 1,
                deleted_at: "2026-10-31T00:00:00Z"
            )
        }
        let nextRange = XDriveIOSNativeFilesTrashRange(
            items: nextChunk, total_count: 140, total_count_included: true,
            offset: 64, limit: P.pageSize, sort: P.defaultSort, order: P.defaultOrder
        )
        verify(P.validAppend(
            alreadyLoadedIDs: Set(firstChunk.map(\.id)),
            alreadyLoadedCount: 64, total: 140, next: nextRange
        ), "append a second verified 64-item trash range")
        let sortedNextRange = XDriveIOSNativeFilesTrashRange(
            items: nextChunk, total_count: 140, total_count_included: true,
            offset: 64, limit: P.pageSize, sort: "size", order: "desc"
        )
        verify(P.validAppend(
            alreadyLoadedIDs: Set(firstChunk.map(\.id)),
            alreadyLoadedCount: 64, total: 140, next: sortedNextRange,
            sort: "size", order: "desc"
        ), "append range preserves selected sort and direction")
        verify(!P.validAppend(
            alreadyLoadedIDs: Set(firstChunk.map(\.id)),
            alreadyLoadedCount: 64, total: 140, next: sortedNextRange
        ), "reject append for stale default sort")
        let tailRange = XDriveIOSNativeFilesTrashRange(
            items: Array(firstChunk.prefix(12)), total_count: 140,
            total_count_included: true,
            offset: 128, limit: P.pageSize, sort: P.defaultSort, order: P.defaultOrder
        )
        // Tail must also use globally unique Node IDs.
        let finalChunk = (0..<12).map { index in
            XDriveIOSNativeFilesTrashNode(
                id: UInt64(index + 3000), parent_id: 5, name: "last-\(index)",
                type: "file", size: 1, revision: 1,
                deleted_at: "2026-10-30T00:00:00Z"
            )
        }
        let exactTail = XDriveIOSNativeFilesTrashRange(
            items: finalChunk, total_count: 140, total_count_included: true,
            offset: 128, limit: P.pageSize, sort: P.defaultSort, order: P.defaultOrder
        )
        let firstTwoIDs = Set((firstChunk + nextChunk).map(\.id))
        verify(P.validAppend(
            alreadyLoadedIDs: firstTwoIDs, alreadyLoadedCount: 128,
            total: 140, next: exactTail
        ), "accept terminal short range")
        verify(!P.validAppend(
            alreadyLoadedIDs: firstTwoIDs, alreadyLoadedCount: 128,
            total: 140, next: tailRange
        ), "reject already displayed ID in terminal range")
        let changedTotal = XDriveIOSNativeFilesTrashRange(
            items: nextChunk, total_count: 141, total_count_included: true,
            offset: 64, limit: P.pageSize, sort: P.defaultSort, order: P.defaultOrder
        )
        verify(!P.validAppend(
            alreadyLoadedIDs: Set(firstChunk.map(\.id)),
            alreadyLoadedCount: 64, total: 140, next: changedTotal
        ), "reject changed trash count")
        let shortMiddle = XDriveIOSNativeFilesTrashRange(
            items: Array(nextChunk.prefix(12)), total_count: 140,
            total_count_included: true,
            offset: 64, limit: P.pageSize, sort: P.defaultSort, order: P.defaultOrder
        )
        verify(!P.validAppend(
            alreadyLoadedIDs: Set(firstChunk.map(\.id)),
            alreadyLoadedCount: 64, total: 140, next: shortMiddle
        ), "reject short nonterminal range")
        verify(!P.validAppend(
            alreadyLoadedIDs: Set(firstChunk.map(\.id)),
            alreadyLoadedCount: 65, total: 140, next: nextRange
        ), "reject inconsistent already-loaded identity count")
        verify(!P.validAppend(
            alreadyLoadedIDs: firstTwoIDs, alreadyLoadedCount: 128,
            total: 128, next: exactTail
        ), "do not fetch past authoritative end")
        print("native Files trash range / restore contract: PASS")
    }
}
