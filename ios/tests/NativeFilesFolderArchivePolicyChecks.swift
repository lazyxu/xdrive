import Foundation

@main
struct NativeFilesFolderArchivePolicyChecks {
    private static func check(_ condition: @autoclosure () -> Bool, _ message: String) {
        if !condition() {
            fputs("native Files folder ZIP policy: \(message)\n", stderr)
            exit(1)
        }
    }

    static func main() {
        typealias P = XDriveIOSNativeFilesFolderArchivePolicy
        let id = "123e4567-e89b-42d3-a456-426614174000"
        check(P.validRunID(id), "UUID run ID")
        check(!P.validRunID("123"), "reject malformed run ID")
        check(P.validFilename("photos.zip"), "ZIP filename")
        check(!P.validFilename("../photos.zip"), "reject traversal")
        check(!P.validFilename("folder/other.zip"), "reject separator")
        check(!P.validFilename(".hidden.zip"), "reject hidden name")
        let f = P.Entry(path: "folder/file.txt", size: 1024)
        let completed = P.Snapshot(
            transfer_id: id, state: "completed", filename: "folder.zip",
            total_bytes: 1024, files: [f], error: nil
        )
        check(P.validReady(completed, runID: id), "verified prepared manifest")
        check(!P.validReady(completed, runID: UUID().uuidString), "other transfer rejected")
        check(!P.validReady(.init(
            transfer_id: id, state: "running", filename: "folder.zip",
            total_bytes: 1024, files: [f], error: nil
        ), runID: id), "running is not completed")
        check(!P.validReady(.init(
            transfer_id: id, state: "completed", filename: "folder.zip",
            total_bytes: 1023, files: [f], error: nil
        ), runID: id), "mismatched sum")
        check(!P.validReady(.init(
            transfer_id: id, state: "completed", filename: "folder.zip",
            total_bytes: P.maximumOriginalBytes + 1, files: [], error: nil
        ), runID: id), "oversized source")
        check(!P.validReady(.init(
            transfer_id: id, state: "completed", filename: "folder.zip",
            total_bytes: 0, files: [.init(path: "../bad", size: 0)], error: nil
        ), runID: id), "path validation")
        check(P.validReady(.init(
            transfer_id: id, state: "completed", filename: "empty.zip",
            total_bytes: nil, files: nil, error: nil
        ), runID: id), "empty folder allowed when omitempty elides zeros")
        check(P.hasCapacity(freeDiskBytes: P.maximumArchiveBytes + P.freeDiskReserveBytes),
              "exact local disk bound")
        check(!P.hasCapacity(freeDiskBytes: P.maximumArchiveBytes + P.freeDiskReserveBytes - 1),
              "not enough local capacity")
        check(!P.hasCapacity(freeDiskBytes: nil), "unknown local capacity")
        check(!P.hasCapacity(freeDiskBytes: -1), "negative capacity")
        check(P.hasCapacity(freeDiskBytes: Int64.max), "overflow-safe capacity")
        check(P.validDownloadedBytes(22), "minimal ZIP envelope")
        check(P.validDownloadedBytes(P.maximumArchiveBytes), "maximum ZIP")
        check(!P.validDownloadedBytes(P.maximumArchiveBytes + 1), "oversized ZIP")
        check(!P.validDownloadedBytes(21), "invalid truncated ZIP")
        print("iOS native Files folder ZIP download policy: PASS")
    }
}
