import Foundation

@main
struct NativeBackupWindowReadProgressChecks {
    static func main() {
        typealias Policy = XDriveIOSNativeBackupWindowReadProgress
        let empty = Policy.current(
            totalVisible: 300, startOffset: 0, scanned: 0,
            uploaded: 0, verifiedAlready: 0, unavailable: 0,
            needsReview: 0, unsupported: 0
        )
        precondition(empty?.capacity == 256)
        precondition(empty?.scanned == 0)
        precondition(empty?.remaining == 256)
        precondition(empty?.fractionScanned == 0)

        let active = Policy.current(
            totalVisible: 300, startOffset: 0, scanned: 20,
            uploaded: 5, verifiedAlready: 10, unavailable: 2,
            needsReview: 1, unsupported: 1
        )
        precondition(active?.scanned == 20)
        precondition(active?.remaining == 236)
        precondition(active?.confirmed == 15)
        precondition(active?.unavailable == 2)
        precondition(active?.needsReview == 1)
        precondition(active?.unsupported == 1)
        precondition(active?.fractionScanned == 20.0 / 256.0)

        // Last authorized range is smaller, and 100% READ is not 100%
        // BACKED UP when an iCloud-only original is inaccessible.
        let last = Policy.current(
            totalVisible: 280, startOffset: 256, scanned: 24,
            uploaded: 0, verifiedAlready: 22, unavailable: 2,
            needsReview: 0, unsupported: 0
        )
        precondition(last?.capacity == 24)
        precondition(last?.remaining == 0)
        precondition(last?.fractionScanned == 1)
        precondition(last?.confirmed == 22)

        // Fail closed rather than accidentally showing a stale full bar.
        for (total, offset, count) in [
            (0, 0, 0), (5, 256, 0), (256, 256, 0),
            (300, -1, 0), (300, 0, 257), (300, 256, 45),
            (300, 0, -1)
        ] {
            precondition(Policy.current(
                totalVisible: total, startOffset: offset, scanned: count,
                uploaded: 0, verifiedAlready: 0, unavailable: 0,
                needsReview: 0, unsupported: 0
            ) == nil)
        }
        precondition(Policy.current(
            totalVisible: 300, startOffset: 0, scanned: 5,
            uploaded: 4, verifiedAlready: 2, unavailable: 0,
            needsReview: 0, unsupported: 0
        ) == nil)
        precondition(Policy.current(
            totalVisible: 300, startOffset: 0, scanned: 3,
            uploaded: 0, verifiedAlready: 0, unavailable: -1,
            needsReview: 0, unsupported: 0
        ) == nil)
        precondition(Policy.current(
            totalVisible: Int.max, startOffset: Int.max - 5,
            scanned: 5, uploaded: 0, verifiedAlready: 5,
            unavailable: 0, needsReview: 0, unsupported: 0
        )?.fractionScanned == 1)
        print("iOS bounded backup window read progress checks: PASS")
    }
}
