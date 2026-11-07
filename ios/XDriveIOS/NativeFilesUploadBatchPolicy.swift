import Foundation

/// Files multi-pick: at most 64 documents, uploaded
/// sequentially through the existing single Original UploadSession writer.
/// Case-insensitive duplicate names would collide on Server; reject the
/// selection BEFORE uploading any item rather than skipping or overwriting.
enum XDriveIOSNativeFilesUploadBatchPolicy {
    static let maximumFiles = 64
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


    /// Confirmed chunks are still provisional until Finalize and exact
    /// Node/revision/SHA readback, so this is capped below 100%.
    static func confirmedProgressPercent(bytes: Int64, totalBytes: Int64) -> Int? {
        guard totalBytes > 0, totalBytes <= maximumStagedFileBytes,
              bytes >= 0, bytes <= totalBytes else { return nil }
        return min(99, Int(Double(bytes) * 100.0 / Double(totalBytes)))
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


/// Foreground-only folder picker MVP. The scan must admit the entire picked
/// subtree before any directory POST or UploadSession can start. These are
/// transfer caps, not a background uploader or an implicit overwrite policy.
enum XDriveIOSNativeFilesFolderUploadPolicy {
    static let maximumFiles = 128
    static let maximumDirectories = 64  // Includes the picked root folder.
    static let maximumDepth = 8          // Includes the picked root folder.
    static let maximumTotalBytes: Int64 = 512 * 1_048_576

    static func validComponent(_ name: String) -> Bool {
        XDriveIOSNativeFilesFolderNamePolicy.normalized(name) == name &&
            !name.hasSuffix(" ")
    }

    static func acceptsDirectory(existing: Int, depth: Int) -> Bool {
        existing >= 0 && existing < maximumDirectories &&
            depth > 0 && depth <= maximumDepth
    }

    static func acceptsFile(existing: Int, totalBytes: Int64,
                            nextBytes: Int64, depth: Int) -> Bool {
        existing >= 0 && existing < maximumFiles &&
            depth > 0 && depth <= maximumDepth &&
            totalBytes >= 0 && totalBytes <= maximumTotalBytes &&
            nextBytes >= 0 && nextBytes <= maximumTotalBytes - totalBytes
    }
}
