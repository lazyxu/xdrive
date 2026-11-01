import Foundation

/// Dates represent the current authorized PhotoKit snapshot only; no asset
/// identifiers, pixels or upload receipts are held by this calendar index.
enum XDriveIOSNativePhotoTimelineScale: String, CaseIterable, Identifiable {
    case year, month, day

    var id: String { rawValue }
    var title: String {
        switch self {
        case .year: return "年"
        case .month: return "月"
        case .day: return "日"
        }
    }
}

struct XDriveIOSNativePhotoTimelineGroup: Identifiable, Equatable {
    let scale: XDriveIOSNativePhotoTimelineScale
    let key: String
    let title: String
    // Index into a creationDate-descending PHFetchResult, not a persistent ID.
    let firstSlot: Int
    var mediaCount: Int

    var id: String { "\(scale.rawValue):\(key)" }
    var firstPageOffset: Int { (firstSlot / 64) * 64 }
}

struct XDriveIOSNativePhotoTimelineIndex {
    let totalSlots: Int
    let indexedMediaCount: Int
    let years: [XDriveIOSNativePhotoTimelineGroup]
    let months: [XDriveIOSNativePhotoTimelineGroup]
    let days: [XDriveIOSNativePhotoTimelineGroup]

    func groups(for scale: XDriveIOSNativePhotoTimelineScale) -> [XDriveIOSNativePhotoTimelineGroup] {
        switch scale {
        case .year: return years
        case .month: return months
        case .day: return days
        }
    }
}

/// O(number of calendar periods), not O(number of PHAsset IDs), retained memory.
/// The PhotoKit reader appends only authorized photos/videos and uses the
/// original slot offset, even if an unsupported asset was skipped.
struct XDriveIOSNativePhotoTimelineBuilder {
    private let calendar: Calendar
    private var years: [XDriveIOSNativePhotoTimelineGroup] = []
    private var months: [XDriveIOSNativePhotoTimelineGroup] = []
    private var days: [XDriveIOSNativePhotoTimelineGroup] = []
    private var yearKeys: [String: Int] = [:]
    private var monthKeys: [String: Int] = [:]
    private var dayKeys: [String: Int] = [:]
    private var totalMedia = 0

    init(calendar: Calendar = .current) { self.calendar = calendar }

    mutating func append(capturedAt: Date?, slot: Int) {
        guard slot >= 0 else { return }
        let components = capturedAt.map {
            calendar.dateComponents([.year, .month, .day], from: $0)
        }
        let year = components?.year
        let month = components?.month
        let day = components?.day
        let unknown = "unknown"

        let yKey = year.map(String.init) ?? unknown
        let mKey = (year != nil && month != nil) ? "\(year!)-\(month!)" : unknown
        let dKey = (year != nil && month != nil && day != nil)
            ? "\(year!)-\(month!)-\(day!)" : unknown

        Self.accumulate(&years, lookup: &yearKeys, scale: .year,
                        key: yKey, title: year.map { "\($0) 年" } ?? "未知日期", slot: slot)
        Self.accumulate(&months, lookup: &monthKeys, scale: .month,
                        key: mKey, title: (year != nil && month != nil)
                            ? "\(year!) 年 \(month!) 月" : "未知日期", slot: slot)
        Self.accumulate(&days, lookup: &dayKeys, scale: .day,
                        key: dKey, title: (year != nil && month != nil && day != nil)
                            ? "\(year!) 年 \(month!) 月 \(day!) 日" : "未知日期", slot: slot)
        totalMedia += 1
    }

    func finish(totalSlots: Int) -> XDriveIOSNativePhotoTimelineIndex {
        XDriveIOSNativePhotoTimelineIndex(
            totalSlots: totalSlots, indexedMediaCount: totalMedia,
            years: years, months: months, days: days
        )
    }

    private static func accumulate(
        _ groups: inout [XDriveIOSNativePhotoTimelineGroup],
        lookup: inout [String: Int],
        scale: XDriveIOSNativePhotoTimelineScale,
        key: String, title: String, slot: Int
    ) {
        if let found = lookup[key] {
            groups[found].mediaCount += 1
        } else {
            lookup[key] = groups.count
            groups.append(XDriveIOSNativePhotoTimelineGroup(
                scale: scale, key: key, title: title,
                firstSlot: slot, mediaCount: 1
            ))
        }
    }
}


/// Numeric-only virtual page policy. The LazyVStack stores N/64 page
/// descriptors, never a library-sized list of PhotoKit identifiers.
enum XDriveIOSNativePhotoVirtualPagePolicy {
    static let pageSize = 64

    static func pageCount(total: Int) -> Int {
        guard total > 0 else { return 0 }
        return (total - 1) / pageSize + 1
    }

    static func normalizedAnchor(requested: Int, total: Int) -> Int {
        guard total > 0 else { return 0 }
        let safe = max(0, requested)
        return min((safe / pageSize) * pageSize, ((total - 1) / pageSize) * pageSize)
    }
}


/// Bounded, transient local Photos selection; never part of route persistence.
enum XDriveIOSNativePhotoSelectionPolicy {
    static let maximumItems = 128

    static func canAdd(selectedCount: Int, identifier: String,
                       alreadySelected: Bool) -> Bool {
        !alreadySelected && selectedCount >= 0 && selectedCount < maximumItems &&
        !identifier.isEmpty && identifier.utf8.count <= 1024
    }
}
