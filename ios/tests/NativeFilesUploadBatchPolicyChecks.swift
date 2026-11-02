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
        let gib = P.maximumStagedFileBytes
        let reserve = P.freeDiskReserveBytes
        check(gib == 1_073_741_824, "one GiB upper bound")
        check(reserve == 128 * 1_048_576, "local staging free-space reserve")
        check(P.mayStage(bytes: 0, freeDiskBytes: reserve), "empty original at exact reserve")
        check(P.mayStage(bytes: gib, freeDiskBytes: gib + reserve),
              "one GiB at exact disk threshold")
        check(!P.mayStage(bytes: gib + 1, freeDiskBytes: Int64.max),
              "over-limit original rejected before copy")
        check(!P.mayStage(bytes: gib, freeDiskBytes: gib + reserve - 1),
              "insufficient disk capacity rejected")
        check(!P.mayStage(bytes: -1, freeDiskBytes: gib + reserve),
              "negative original bytes rejected")
        check(!P.mayStage(bytes: 1, freeDiskBytes: nil),
              "unknown disk capacity cannot authorize a large staging copy")
        check(!P.mayStage(bytes: 1, freeDiskBytes: -1),
              "invalid disk capacity rejected")
        check(P.mayStage(bytes: gib, freeDiskBytes: Int64.max),
              "extreme but valid disk capacity arithmetic does not overflow")
        check(P.confirmedProgressPercent(bytes: 0, totalBytes: 1_000) == 0,
              "no confirmed bytes")
        check(P.confirmedProgressPercent(bytes: 500, totalBytes: 1_000) == 50,
              "half of original acknowledged")
        check(P.confirmedProgressPercent(bytes: 1_000, totalBytes: 1_000) == 99,
              "all chunks acknowledged but Finalize pending")
        check(P.confirmedProgressPercent(bytes: 16, totalBytes: 64) == 25,
              "partial byte progression")
        check(P.confirmedProgressPercent(bytes: -1, totalBytes: 1_000) == nil,
              "negative acknowledged bytes rejected")
        check(P.confirmedProgressPercent(bytes: 1_001, totalBytes: 1_000) == nil,
              "acknowledged overrun rejected")
        check(P.confirmedProgressPercent(bytes: 0, totalBytes: 0) == nil,
              "no percentage for empty original")
        check(P.confirmedProgressPercent(bytes: 1, totalBytes: gib + 1) == nil,
              "must satisfy 1 GiB native bound")
        check(P.confirmedProgressPercent(bytes: gib, totalBytes: gib) == 99,
              "1 GiB completed chunks still provisional")
        print("native Files sequential multi-upload selection and real Server ACK progress: PASS")
    }
}
