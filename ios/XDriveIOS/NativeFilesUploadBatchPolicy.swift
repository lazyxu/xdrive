import Foundation

/// First native Files multi-pick MVP: at most eight documents, uploaded
/// sequentially through the existing single Original UploadSession writer.
/// Case-insensitive duplicate names would collide on Server; reject the
/// selection BEFORE uploading any item rather than skipping or overwriting.
enum XDriveIOSNativeFilesUploadBatchPolicy {
    static let maximumFiles = 8
    // Foreground Files originals use the existing 8 MiB chunked Server writer.
    // Only a single picked file is staged at a time, even in an eight-file batch.
    static let maximumStagedFileBytes: Int64 = 1_073_741_824
    static let freeDiskReserveBytes: Int64 = 128 * 1_048_576

    static func mayStage(bytes: Int64, freeDiskBytes: Int64?) -> Bool {
        guard bytes >= 0, bytes <= maximumStagedFileBytes,
              let freeDiskBytes, freeDiskBytes >= freeDiskReserveBytes else {
            return false
        }
        // Subtract rather than add to avoid overflow for extreme file sizes.
        return bytes <= freeDiskBytes - freeDiskReserveBytes
    }


    static func validSelection(_ files: [URL]) -> Bool {
        guard !files.isEmpty, files.count <= maximumFiles,
              files.allSatisfy({ $0.isFileURL }) else { return false }
        let names = files.map(\.lastPathComponent)
        guard names.allSatisfy({
            XDriveIOSNativeFilesFolderNamePolicy.normalized($0) == $0
        }) else { return false }
        return Set(names.map { $0.lowercased() }).count == files.count
    }
}
