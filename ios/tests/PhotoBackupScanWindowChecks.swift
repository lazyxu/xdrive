import Foundation

@main
struct PhotoBackupScanWindowChecks {
    static func main() {
        let cases: [(Int, [Int])] = [
            (0, [0]),
            (1, [1]),
            (256, [256]),
            (257, [256, 1]),
            (512, [256, 256]),
            (600, [256, 256, 88]),
        ]
        for (total, expectedCapacities) in cases {
            let count = XDrivePhotoBackupScanWindow.count(visibleTotal: total)
            precondition(count == expectedCapacities.count, "Wrong count for \(total)")
            var represented = 0
            for (index, expected) in expectedCapacities.enumerated() {
                guard let offset = XDrivePhotoBackupScanWindow.offset(for: index) else {
                    preconditionFailure("Invalid offset for \(index)")
                }
                let capacity = XDrivePhotoBackupScanWindow.capacity(
                    visibleTotal: total, offset: offset
                )
                precondition(capacity == expected, "Wrong window \(index) of \(total)")
                represented += capacity
            }
            precondition(represented == total, "Skipped assets in \(total)")
        }

        precondition(XDrivePhotoBackupScanWindow.offset(for: -1) == nil)
        precondition(XDrivePhotoBackupScanWindow.offset(for: Int.max) == nil)
        precondition(XDrivePhotoBackupScanWindow.capacity(visibleTotal: 300, offset: -1) == 0)
        precondition(XDrivePhotoBackupScanWindow.capacity(visibleTotal: 5, offset: 256) == 0)
        precondition(XDrivePhotoBackupScanWindow.capacity(visibleTotal: 256, offset: 256) == 0)
        // PhotoKit authorization shrinks between separate snapshots: do not
        // turn an out-of-range window into an unintended first-window scan.
        precondition(XDrivePhotoBackupScanWindow.capacity(visibleTotal: 250, offset: 512) == 0)
        let finalWindow = XDrivePhotoBackupScanWindow.count(visibleTotal: Int.max) - 1
        guard let safeOffset = XDrivePhotoBackupScanWindow.offset(for: finalWindow) else {
            preconditionFailure("Int.max count produced an overflowing offset")
        }
        precondition(XDrivePhotoBackupScanWindow.capacity(
            visibleTotal: Int.max, offset: safeOffset
        ) > 0)
        print("iOS PhotoKit bounded scan-window edge cases: PASS")
    }
}
