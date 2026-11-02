import Foundation

/// Native iOS Files uses the existing Server ZIP snapshot. It never attempts
/// to reconstruct recursive folders locally or to stream an unbounded archive.
enum XDriveIOSNativeFilesFolderArchivePolicy {
    static let maximumOriginalBytes: Int64 = 512 * 1_048_576
    static let maximumArchiveBytes: Int64 = 640 * 1_048_576
    static let freeDiskReserveBytes: Int64 = 128 * 1_048_576
    static let maximumFileEntries = 2048

    struct Entry: Decodable, Equatable {
        let path: String
        let size: Int64
    }

    struct Snapshot: Decodable, Equatable {
        let transfer_id: String
        let state: String
        let filename: String?
        let total_bytes: Int64?
        let files: [Entry]?
        let error: String?
    }

    static func validRunID(_ value: String) -> Bool {
        UUID(uuidString: value) != nil && value.utf8.count == 36
    }

    static func validFilename(_ value: String) -> Bool {
        value.hasSuffix(".zip") && value.utf8.count <= 255 &&
            !value.isEmpty && value != "." && value != ".." &&
            !value.hasPrefix(".") &&
            !value.unicodeScalars.contains(where: {
                $0.value < 32 || "/\\:".unicodeScalars.contains($0)
            })
    }

    static func validProgress(_ snapshot: Snapshot, runID: String) -> Bool {
        snapshot.transfer_id == runID && validRunID(runID) &&
            ["queued", "running", "completed", "failed", "cancel_requested", "cancelled"]
                .contains(snapshot.state)
    }

    static func validReady(_ snapshot: Snapshot, runID: String) -> Bool {
        guard validProgress(snapshot, runID: runID),
              snapshot.state == "completed",
              let filename = snapshot.filename, validFilename(filename) else {
            return false
        }
        // Server uses omitempty for zero bytes and empty directory lists.
        let bytes = snapshot.total_bytes ?? 0
        let files = snapshot.files ?? []
        guard bytes >= 0, bytes <= maximumOriginalBytes,
              files.count <= maximumFileEntries else { return false }
        var sum: Int64 = 0
        for item in files {
            guard !item.path.isEmpty, item.path.utf8.count <= 4096,
                  !item.path.contains("\\"),
                  item.path.split(separator: "/", omittingEmptySubsequences: false)
                    .allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }),
                  item.size >= 0,
                  item.size <= maximumOriginalBytes - sum else { return false }
            sum += item.size
        }
        return sum == bytes
    }

    static func hasCapacity(freeDiskBytes: Int64?) -> Bool {
        guard let freeDiskBytes, freeDiskBytes >= freeDiskReserveBytes else {
            return false
        }
        return maximumArchiveBytes <= freeDiskBytes - freeDiskReserveBytes
    }

    static func validDownloadedBytes(_ bytes: Int64) -> Bool {
        bytes >= 22 && bytes <= maximumArchiveBytes
    }
}
