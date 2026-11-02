import Foundation

@main
struct NativeFilesExportCapacityPolicyChecks {
    private static func check(_ accepted: @autoclosure () -> Bool, _ label: String) {
        if !accepted() {
            fputs("iOS Files single-export capacity: \(label)\n", stderr)
            exit(1)
        }
    }
    static func main() {
        typealias Policy = XDriveIOSNativeFilesExportCapacityPolicy
        let max = Policy.maximumSingleFileBytes
        let reserve = Policy.freeSpaceReserveBytes
        check(max == 1_073_741_824, "1 GiB single-file upper bound")
        check(reserve == 128 * 1_048_576, "128 MiB device reserve")
        check(Policy.mayStage(size: 0, availableFreeBytes: reserve),
              "empty original with exact reserve")
        check(Policy.mayStage(size: max, availableFreeBytes: max + reserve),
              "exact size and free-capacity limits")
        check(!Policy.mayStage(size: max + 1, availableFreeBytes: Int64.max),
              "oversized original rejected before signed download")
        check(!Policy.mayStage(size: max, availableFreeBytes: max + reserve - 1),
              "insufficient remaining disk space")
        check(!Policy.mayStage(size: -1, availableFreeBytes: max + reserve),
              "negative original size")
        check(!Policy.mayStage(size: 1, availableFreeBytes: nil),
              "unknown local disk capacity")
        check(!Policy.mayStage(size: 1, availableFreeBytes: -1),
              "negative local disk capacity")
        check(Policy.mayStage(size: max, availableFreeBytes: Int64.max),
              "no overflow with very large free capacity")
        check(Policy.receivedPercent(
            bytesWritten: 500, nodeBytes: 1_000, httpExpectedBytes: 1_000
        ) == 50, "half of actual downloaded bytes")
        check(Policy.receivedPercent(
            bytesWritten: 750, nodeBytes: 1_000, httpExpectedBytes: -1
        ) == 75, "unknown HTTP total with known verified Node bytes")
        check(Policy.receivedPercent(
            bytesWritten: 1_000, nodeBytes: 1_000, httpExpectedBytes: 1_000
        ) == 99, "never declare fully verified from transport callback")
        check(Policy.receivedPercent(
            bytesWritten: 0, nodeBytes: 1_000, httpExpectedBytes: -1
        ) == 0, "valid zero-byte progress sample")
        check(Policy.receivedPercent(
            bytesWritten: -1, nodeBytes: 1_000, httpExpectedBytes: 1_000
        ) == nil, "negative count")
        check(Policy.receivedPercent(
            bytesWritten: 1_001, nodeBytes: 1_000, httpExpectedBytes: 1_000
        ) == nil, "more bytes than verified Node")
        check(Policy.receivedPercent(
            bytesWritten: 500, nodeBytes: 1_000, httpExpectedBytes: 999
        ) == nil, "conflicting content-length")
        check(Policy.receivedPercent(
            bytesWritten: 0, nodeBytes: 0, httpExpectedBytes: 0
        ) == nil, "empty original has no percentage")
        check(Policy.receivedPercent(
            bytesWritten: 1, nodeBytes: max + 1, httpExpectedBytes: -1
        ) == nil, "oversized original cannot display percent")
        print("iOS Files 1 GiB single-original export capacity and real byte progress: PASS")
    }
}
