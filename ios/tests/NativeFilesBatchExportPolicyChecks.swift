import Foundation

@main
struct XDriveIOSNativeFilesBatchExportPolicyChecks {
    private static func check(_ ok: @autoclosure () -> Bool, _ name: String) {
        if !ok() {
            fputs("native Files multi-export selection: \(name)\n", stderr)
            exit(1)
        }
    }
    static func main() {
        typealias P = XDriveIOSNativeFilesBatchExportPolicy
        let a = XDriveIOSNativeFilesNode(id: 11, parent_id: 3,
            name: "one.pdf", type: "file", size: 150_000, revision: 2)
        let b = XDriveIOSNativeFilesNode(id: 12, parent_id: 3,
            name: "two.mov", type: "file", size: 100_000, revision: 3)
        check(P.validSelection([a, b], parentID: 3), "two distinct files")
        check(!P.validSelection([a], parentID: 3), "single-item path remains separate")
        check(!P.validSelection([], parentID: 3), "empty selection")
        check(!P.validSelection([a, a], parentID: 3), "duplicate node")
        let differentName = XDriveIOSNativeFilesNode(id: 15, parent_id: 3,
            name: "ONE.PDF", type: "file", size: 4, revision: 1)
        check(!P.validSelection([a, differentName], parentID: 3),
              "case-insensitive duplicate filename")
        let wrongParent = XDriveIOSNativeFilesNode(id: 12, parent_id: 4,
            name: "two.mov", type: "file", size: 4, revision: 1)
        check(!P.validSelection([a, wrongParent], parentID: 3),
              "cross-folder selection")
        let folder = XDriveIOSNativeFilesNode(id: 16, parent_id: 3,
            name: "files", type: "dir", size: 0, revision: 1)
        check(!P.validSelection([a, folder], parentID: 3),
              "no folder within multi-export")
        let huge = XDriveIOSNativeFilesNode(id: 18, parent_id: 3,
            name: "huge.mp4", type: "file", size: P.maximumAggregateBytes,
            revision: 2)
        check(!P.validSelection([a, huge], parentID: 3), "aggregate size limit")
        let eight = (1...8).map { n in
            XDriveIOSNativeFilesNode(id: UInt64(n + 100), parent_id: 3,
                name: "document-\(n).pdf", type: "file", size: 1, revision: 1)
        }
        check(P.validSelection(eight, parentID: 3), "eight distinct files")
        check(!P.validSelection(eight + [a], parentID: 3), "nine files rejected")
        check(!P.validSelection([a,b], parentID: 0), "unknown folder")
        print("native Files bounded multi-export policy: PASS")
    }
}
