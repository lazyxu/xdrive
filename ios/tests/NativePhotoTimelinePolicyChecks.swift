import Foundation

@main
struct NativePhotoTimelinePolicyChecks {
    static func main() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 8 * 3600)!
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        var index = XDriveIOSNativePhotoTimelineBuilder(calendar: calendar)
        let samples: [(String?, Int)] = [
            ("2026-11-01T02:00:00Z", 0),
            ("2026-10-31T15:00:00Z", 1),
            ("2026-10-31T14:00:00Z", 2),
            ("2026-10-29T20:00:00Z", 65),
            ("2025-01-04T08:00:00Z", 129),
            (nil, 130),
            (nil, 131),
        ]
        for (timestamp, slot) in samples {
            index.append(capturedAt: timestamp.flatMap(formatter.date(from:)), slot: slot)
        }
        let result = index.finish(totalSlots: 132)
        precondition(result.indexedMediaCount == 7 && result.totalSlots == 132)
        precondition(result.years.map(\.mediaCount) == [4, 1, 2])
        precondition(result.months.map(\.mediaCount) == [1, 3, 1, 2])
        precondition(result.days.map(\.mediaCount) == [1, 2, 1, 1, 2])
        precondition(result.years[0].key == "2026" && result.years[1].key == "2025")
        precondition(result.months[0].title == "2026 年 11 月")
        precondition(result.days[1].title == "2026 年 10 月 31 日")
        precondition(result.days[2].firstSlot == 65)
        precondition(result.days[2].firstPageOffset == 64)
        precondition(result.days[3].firstPageOffset == 128)
        precondition(result.days.last?.title == "未知日期")
        precondition(result.days.last?.id == "day:unknown")
        precondition(result.groups(for: .day).count == 5)
        // Even if the input contains a non-contiguous repeated calendar key,
        // keep a unique row with its earliest offset rather than duplicate IDs.
        var repeated = XDriveIOSNativePhotoTimelineBuilder(calendar: calendar)
        repeated.append(capturedAt: formatter.date(from: "2026-11-01T02:00:00Z"), slot: 0)
        repeated.append(capturedAt: nil, slot: 64)
        repeated.append(capturedAt: formatter.date(from: "2026-11-01T02:00:00Z"), slot: 128)
        let repeatedResult = repeated.finish(totalSlots: 129)
        precondition(repeatedResult.days.count == 2)
        precondition(repeatedResult.days[0].mediaCount == 2)
        precondition(repeatedResult.days[0].firstPageOffset == 0)
        // Continuous wall virtualizes pages without constructing PHAsset arrays.
        let virtual = XDriveIOSNativePhotoVirtualPagePolicy.self
        precondition(virtual.pageCount(total: 0) == 0)
        precondition(virtual.pageCount(total: 1) == 1)
        precondition(virtual.pageCount(total: 63) == 1)
        precondition(virtual.pageCount(total: 64) == 1)
        precondition(virtual.pageCount(total: 65) == 2)
        precondition(virtual.pageCount(total: 100_000) == 1563)
        precondition(virtual.pageCount(total: Int.max) > 0)
        precondition(virtual.normalizedAnchor(requested: -1, total: 100) == 0)
        precondition(virtual.normalizedAnchor(requested: 120, total: 300) == 64)
        precondition(virtual.normalizedAnchor(requested: Int.max, total: 100) == 64)
        precondition(virtual.normalizedAnchor(requested: 500, total: 0) == 0)
        precondition(XDriveIOSNativePhotoSelectionPolicy.canAdd(
            selectedCount: 0, identifier: "photo-1", alreadySelected: false
        ))
        precondition(!XDriveIOSNativePhotoSelectionPolicy.canAdd(
            selectedCount: 128, identifier: "photo-2", alreadySelected: false
        ))
        precondition(!XDriveIOSNativePhotoSelectionPolicy.canAdd(
            selectedCount: -1, identifier: "photo", alreadySelected: false
        ))
        precondition(!XDriveIOSNativePhotoSelectionPolicy.canAdd(
            selectedCount: 1, identifier: "", alreadySelected: false
        ))
        precondition(!XDriveIOSNativePhotoSelectionPolicy.canAdd(
            selectedCount: 1, identifier: "photo-1", alreadySelected: true
        ))
        precondition(!XDriveIOSNativePhotoSelectionPolicy.canAdd(
            selectedCount: 1, identifier: String(repeating: "a", count: 1025),
            alreadySelected: false
        ))
        print("iOS Photos whole-library timeline grouping and page jumps: PASS")
    }
}
