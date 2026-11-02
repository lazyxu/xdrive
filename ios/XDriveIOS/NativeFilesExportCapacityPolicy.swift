import Foundation

/// Single-file, foreground original export admission. Batch export keeps its
/// independent 512 MiB aggregate cap; no browser or background path uses this.
enum XDriveIOSNativeFilesExportCapacityPolicy {
    static let maximumSingleFileBytes: Int64 = 1_073_741_824
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
