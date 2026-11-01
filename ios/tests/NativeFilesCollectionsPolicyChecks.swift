import Foundation

@main
struct NativeFilesCollectionsPolicyChecks {
    private static func check(_ accepted: @autoclosure () -> Bool, _ label: String) {
        if !accepted() {
            fputs("native Files collections policy: \(label)\n", stderr)
            exit(1)
        }
    }

    static func main() {
        typealias P = XDriveIOSNativeFilesCollectionsPolicy
        let file = XDriveIOSNativeFilesNode(id: 42, parent_id: 7,
                                            name: "a.pdf", type: "file", size: 18, revision: 4)
        let folder = XDriveIOSNativeFilesNode(id: 73, parent_id: 7,
                                              name: "Docs", type: "dir", size: 0, revision: 2)
        let recent = XDriveIOSNativeFilesCollectionItem(
            node: file, path: "home/a.pdf", accessed_at: "2026-11-01T09:00:00Z", favorited_at: nil
        )
        let favorite = XDriveIOSNativeFilesCollectionItem(
            node: file, path: "home/a.pdf", accessed_at: nil, favorited_at: "2026-11-01T09:00:00Z"
        )
        let recentDir = XDriveIOSNativeFilesCollectionItem(
            node: folder, path: "home/Docs", accessed_at: "2026-11-01T09:00:00Z", favorited_at: nil
        )
        check(P.validItems([recent, recentDir], kind: .recent), "file/dir recent")
        check(P.validItems([favorite], kind: .favorites), "file favorite")
        check(!P.validItem(recentDir, kind: .favorites), "cannot favorite a folder")
        check(!P.validItem(recent, kind: .favorites), "wrong timestamp kind")
        check(!P.validItems([favorite, favorite], kind: .favorites), "duplicate IDs")
        check(!P.validItems(Array(repeating: recent, count: 51), kind: .recent), "recent cap")
        check(!P.validItems(Array(repeating: favorite, count: 257), kind: .favorites), "favorite cap")
        let invalid = XDriveIOSNativeFilesCollectionItem(
            node: file, path: "", accessed_at: nil, favorited_at: "x"
        )
        check(!P.validItem(invalid, kind: .favorites), "missing real path")
        let root = XDriveIOSNativeFilesNode(id: 1, parent_id: nil,
                                            name: "root", type: "dir", size: 0, revision: 1)
        let rootRecent = XDriveIOSNativeFilesCollectionItem(
            node: root, path: "root", accessed_at: "x", favorited_at: nil
        )
        check(!P.validItem(rootRecent, kind: .recent), "root is not a recent entry")
        print("native Files recent/favorites Owner projection policy: PASS")
    }
}
