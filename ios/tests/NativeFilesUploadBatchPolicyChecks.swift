import Foundation

@main
struct NativeFilesUploadBatchPolicyChecks {
    private static func check(_ ok: @autoclosure () -> Bool, _ label: String) {
        if !ok() {
            fputs("native Files multi-upload: \(label)\n", stderr)
            exit(1)
        }
    }

    static func main() {
        typealias P = XDriveIOSNativeFilesUploadBatchPolicy
        let single = URL(fileURLWithPath: "/tmp/document.pdf")
        let video = URL(fileURLWithPath: "/tmp/clip.mov")
        check(P.validSelection([single]), "existing single upload allowed")
        check(P.validSelection([single, video]), "two distinct originals")
        check(!P.validSelection([]), "empty picker")
        check(!P.validSelection([single, URL(fileURLWithPath: "/tmp/DOCUMENT.PDF")]),
              "case insensitive collision")
        check(!P.validSelection([single, single]), "duplicate provider URL")
        check(!P.validSelection([URL(string: "https://example.com/document.pdf")!]),
              "cannot upload a web URL")
        check(!P.validSelection([URL(fileURLWithPath: "/tmp/bad?.txt")]),
              "invalid source name")
        let eight = (1...8).map { URL(fileURLWithPath: "/tmp/document-\($0).pdf") }
        check(P.validSelection(eight), "bounded eight")
        check(!P.validSelection(eight + [single]), "nine rejected before any upload")
        print("native Files sequential multi-upload selection: PASS")
    }
}
