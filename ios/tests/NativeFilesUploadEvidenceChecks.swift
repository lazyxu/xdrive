import Foundation

@main
struct XDriveIOSNativeFilesUploadEvidenceChecks {
    static func require(_ ok: @autoclosure () -> Bool, _ message: String) {
        if !ok() {
            fputs("native Files upload evidence failure: \(message)\n", stderr)
            exit(1)
        }
    }
    static func main() {
        let hash = String(repeating: "a", count: 64)
        let correct = XDriveIOSNativeFilesUploadNodeEvidence(
            id: 17, parentID: 9, name: "报告.pdf",
            type: "file", size: 1024, revision: 3, sha256: hash
        )
        func matches(_ evidence: XDriveIOSNativeFilesUploadNodeEvidence,
                     parent: UInt64 = 9, name: String = "报告.pdf",
                     bytes: Int64 = 1024, id: UInt64 = 17,
                     revision: UInt64 = 3, digest: String = String(repeating:"a", count:64)) -> Bool {
            XDriveIOSNativeFilesUploadConfirmationPolicy.matches(
                evidence, parentID: parent, name: name, bytes: bytes,
                receiptNodeID: id, receiptRevision: revision,
                receiptSHA256: digest
            )
        }
        require(matches(correct), "exact node receipt")
        require(!matches(correct, parent: 10), "cross-directory")
        require(!matches(correct, name: "other.pdf"), "name changed")
        require(!matches(correct, bytes: 1025), "wrong size")
        require(!matches(correct, id: 18), "wrong ID")
        require(!matches(correct, revision: 4), "old revision")
        require(!matches(correct, digest: String(repeating: "b", count: 64)), "wrong hash")
        require(!matches(correct, digest: "bad"), "malformed hash")
        let noParent = XDriveIOSNativeFilesUploadNodeEvidence(
            id: 17, parentID: nil, name: "报告.pdf",
            type: "file", size: 1024, revision: 3, sha256: hash
        )
        require(!matches(noParent), "root must not be a file")
        let wrongType = XDriveIOSNativeFilesUploadNodeEvidence(
            id: 17, parentID: 9, name: "报告.pdf",
            type: "dir", size: 1024, revision: 3, sha256: hash
        )
        require(!matches(wrongType), "directory is not committed file")
        print("native Files exact original receipt checks passed")
    }
}
