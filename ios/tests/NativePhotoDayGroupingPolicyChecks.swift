import Foundation

@main
struct NativePhotoDayGroupingPolicyChecks {
    static func main() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 8 * 3600)!
        let parse = ISO8601DateFormatter()
        parse.formatOptions = [.withInternetDateTime]
        let p: (String) -> Date = { timestamp in
            guard let date = parse.date(from: timestamp) else {
                preconditionFailure("Invalid test timestamp")
            }
            return date
        }
        let dates: [Date?] = [
            p("2026-11-01T00:00:00Z"),
            p("2026-10-31T16:00:00Z"),
            p("2026-10-31T15:59:59Z"),
            nil, nil,
            p("2026-10-31T10:00:00Z"),
        ]
        let sections = XDriveIOSNativePhotoDayGroupingPolicy.sections(
            dates: dates, calendar: calendar
        )
        precondition(sections.count == 4)
        precondition(sections.map(\.startIndex) == [0, 2, 3, 5])
        precondition(sections.map(\.endIndex) == [2, 3, 5, 6])
        precondition(sections.map(\.count) == [2, 1, 2, 1])
        precondition(sections.map(\.title) == [
            "2026 年 11 月 1 日", "2026 年 10 月 31 日",
            "未知日期", "2026 年 10 月 31 日"
        ])
        precondition(Set(sections.map(\.id)).count == sections.count)
        precondition(XDriveIOSNativePhotoDayGroupingPolicy.sections(dates: []).isEmpty)
        precondition(XDriveIOSNativePhotoDayGroupingPolicy.sections(
            dates: Array(repeating: nil, count: 65)
        ).isEmpty)
        let maximum = XDriveIOSNativePhotoDayGroupingPolicy.sections(
            dates: Array(repeating: nil, count: 64)
        )
        precondition(maximum.count == 1)
        precondition(maximum[0].count == 64)
        // Exactly one previous slot, not a full-page array, determines
        // whether an otherwise identical day heading should repeat.
        let continued = XDriveIOSNativePhotoDayGroupingPolicy.sections(
            dates: [p("2026-11-01T02:00:00Z"),
                    p("2026-11-01T01:00:00Z"),
                    p("2026-10-31T13:00:00Z")],
            previousCapturedAt: p("2026-11-01T03:00:00Z"),
            hasPreviousPage: true, calendar: calendar
        )
        precondition(continued.count == 2)
        precondition(continued[0].continuesPreviousPage)
        precondition(!continued[1].continuesPreviousPage)
        let differentDay = XDriveIOSNativePhotoDayGroupingPolicy.sections(
            dates: [p("2026-10-31T13:00:00Z")],
            previousCapturedAt: p("2026-11-01T03:00:00Z"),
            hasPreviousPage: true, calendar: calendar
        )
        precondition(!differentDay[0].continuesPreviousPage)
        let unknownContinuation = XDriveIOSNativePhotoDayGroupingPolicy.sections(
            dates: [nil], previousCapturedAt: nil,
            hasPreviousPage: true, calendar: calendar
        )
        precondition(unknownContinuation[0].continuesPreviousPage)
        let firstPage = XDriveIOSNativePhotoDayGroupingPolicy.sections(
            dates: [nil], hasPreviousPage: false, calendar: calendar
        )
        precondition(!firstPage[0].continuesPreviousPage)
        // Exercise all 1,563 separate 64-slot windows of a 100k-photo
        // gallery without retaining 100k dates or PhotoKit IDs. Each
        // synthetic date runs for 137 assets, crossing page boundaries.
        let totalSlots = 100_000
        let assetsPerDay = 137
        let expectedDays = (totalSlots + assetsPerDay - 1) / assetsPerDay
        let initialEpoch: TimeInterval = 1_700_000_000
        var firstHeadingCount = 0
        var viewedSlots = 0
        for offset in stride(from: 0, to: totalSlots, by: 64) {
            let count = min(64, totalSlots - offset)
            let pageDates: [Date?] = (0..<count).map { index in
                let dayNumber = (offset + index) / assetsPerDay
                return Date(timeIntervalSince1970:
                    initialEpoch - Double(dayNumber) * 86_400)
            }
            let previous: Date? = offset > 0 ? Date(
                timeIntervalSince1970:
                    initialEpoch - Double((offset - 1) / assetsPerDay) * 86_400
            ) : nil
            let pages = XDriveIOSNativePhotoDayGroupingPolicy.sections(
                dates: pageDates, previousCapturedAt: previous,
                hasPreviousPage: offset > 0, calendar: calendar
            )
            precondition(!pages.isEmpty && pages.count <= 2)
            precondition(pages.map(\.count).reduce(0, +) == count)
            let continued = offset > 0 &&
                (offset - 1) / assetsPerDay == offset / assetsPerDay
            precondition(pages[0].continuesPreviousPage == continued)
            firstHeadingCount += pages.filter { !$0.continuesPreviousPage }.count
            viewedSlots += count
        }
        precondition(viewedSlots == totalSlots)
        precondition(firstHeadingCount == expectedDays)
        print("iOS native PhotoKit actual-day section policy: PASS")
    }
}
