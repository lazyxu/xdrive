import Foundation

/// Metadata-only local-day sections for one currently authorized 64-slot
/// PhotoKit page. No PhotoKit IDs, pixels, upload receipts or global array.
struct XDriveIOSNativePhotoDaySection: Identifiable, Equatable {
    let startIndex: Int
    let endIndex: Int
    let title: String
    // Suppress only the first heading when the preceding verified PhotoKit
    // slot belongs to the same date across a virtual 64-item boundary.
    let continuesPreviousPage: Bool

    var id: Int { startIndex }
    var count: Int { endIndex - startIndex }
}

enum XDriveIOSNativePhotoDayGroupingPolicy {
    /// Splits adjacent slots by their actual creation day in the active
    /// Calendar/time zone. An unsupported media slot still retains its place.
    /// The previous page is inspected by the same authorized PhotoKit
    /// snapshot; only its immediately preceding date is passed here.
    static func sections(
        dates: [Date?], previousCapturedAt: Date? = nil,
        hasPreviousPage: Bool = false, calendar: Calendar = .current
    ) -> [XDriveIOSNativePhotoDaySection] {
        guard !dates.isEmpty, dates.count <= 64 else { return [] }
        var result: [XDriveIOSNativePhotoDaySection] = []
        var runStart = 0
        var lastKey = key(for: dates[0], calendar: calendar)
        let firstContinues = hasPreviousPage &&
            key(for: previousCapturedAt, calendar: calendar) == lastKey

        for index in 1..<dates.count {
            let newKey = key(for: dates[index], calendar: calendar)
            if newKey != lastKey {
                result.append(XDriveIOSNativePhotoDaySection(
                    startIndex: runStart, endIndex: index, title: lastKey.title,
                    continuesPreviousPage: runStart == 0 && firstContinues
                ))
                runStart = index
                lastKey = newKey
            }
        }
        result.append(XDriveIOSNativePhotoDaySection(
            startIndex: runStart, endIndex: dates.count,
            title: lastKey.title, continuesPreviousPage: runStart == 0 && firstContinues
        ))
        return result
    }

    private struct DayKey: Equatable {
        let year: Int?
        let month: Int?
        let day: Int?
        var title: String {
            guard let year, let month, let day else { return "未知日期" }
            return "\(year) 年 \(month) 月 \(day) 日"
        }
    }

    private static func key(for date: Date?, calendar: Calendar) -> DayKey {
        guard let date else { return DayKey(year: nil, month: nil, day: nil) }
        let components = calendar.dateComponents([.year, .month, .day], from: date)
        return DayKey(year: components.year, month: components.month,
                      day: components.day)
    }
}
