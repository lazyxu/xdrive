import Foundation

/// Single-file, foreground original export admission. Batch export keeps its
/// independent 512 MiB aggregate cap; no browser or background path uses this.
enum XDriveIOSNativeFilesExportCapacityPolicy {
    static let maximumSingleFileBytes: Int64 = 1_073_741_824
    static let freeSpaceReserveBytes: Int64 = 128 * 1_048_576

    static func mayStage(size: Int64, availableFreeBytes: Int64?) -> Bool {
        guard size >= 0, size <= maximumSingleFileBytes,
              let availableFreeBytes,
              availableFreeBytes >= freeSpaceReserveBytes else { return false }
        // Avoid overflow when disk space is reported near Int64.max.
        return size <= availableFreeBytes - freeSpaceReserveBytes
    }
}
