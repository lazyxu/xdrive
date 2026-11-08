import Foundation

/// Single-file, foreground streaming download admission. There is no arbitrary
/// 1 GiB file cap: actual free disk and a protected temporary destination govern
/// whether a file can be prepared for the explicit iOS Share Sheet. Batch limits
/// remain independent; this does not claim background download support.
enum XDriveIOSNativeFilesExportCapacityPolicy {
    // URLSession.download writes directly to disk, and the later staging move
    // stays on the same filesystem. Guard Int64 arithmetic without imposing a
    // product-level byte limit on large original files.
    static let maximumSingleFileBytes: Int64 = Int64.max - freeSpaceReserveBytes
    static let freeSpaceReserveBytes: Int64 = 128 * 1_048_576

    /// Samples come directly from URLSessionDownloadDelegate. A Node's actual
    /// byte size is the denominator; HTTP may report an unknown total (-1).
    /// Do not invent 100% until the completed download and revision are proven.
    static func receivedPercent(bytesWritten: Int64,
                                nodeBytes: Int64,
                                httpExpectedBytes: Int64) -> Int? {
        guard nodeBytes > 0, nodeBytes <= maximumSingleFileBytes,
              bytesWritten >= 0, bytesWritten <= nodeBytes,
              httpExpectedBytes == -1 || httpExpectedBytes == nodeBytes else {
            return nil
        }
        return min(99, Int(Double(bytesWritten) * 100.0 / Double(nodeBytes)))
    }

    static func mayStage(size: Int64, availableFreeBytes: Int64?) -> Bool {
        guard size >= 0, size <= maximumSingleFileBytes,
              let availableFreeBytes,
              availableFreeBytes >= freeSpaceReserveBytes else { return false }
        // Avoid overflow when disk space is reported near Int64.max.
        return size <= availableFreeBytes - freeSpaceReserveBytes
    }
}
