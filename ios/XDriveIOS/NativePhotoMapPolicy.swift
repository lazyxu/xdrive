import Foundation

/// One currently scanned PhotoKit page, not a spatial index of 100k media.
enum XDriveIOSNativePhotoMapPolicy {
    static let pageSize = 64
    // Apple's minimum interactive target also applies in iPad split-screen,
    // landscape and Accessibility Dynamic Type. Measurements are in points.
    static let minimumInteractiveTarget: Double = 44

    static func accessibleMapViewport(width: Double, height: Double) -> Bool {
        width.isFinite && height.isFinite &&
            width >= minimumInteractiveTarget &&
            height >= minimumInteractiveTarget
    }

    /// Both native PhotoKit and Owner-cloud maps use the *actual* safe-area
    /// viewport. Rotation alone never changes the L1/L2 navigation level.
    /// Accessibility text preserves the full explanatory rows.
    static func compactViewport(
        width: Double, height: Double, accessibilityText: Bool
    ) -> Bool {
        width.isFinite && height.isFinite &&
            width >= 680 && height > 0 && height < 500 && !accessibilityText
    }

    static func validCoordinate(latitude: Double, longitude: Double) -> Bool {
        latitude.isFinite && longitude.isFinite &&
        abs(latitude) <= 90 && abs(longitude) <= 180
    }

    static func validPage(total: Int, start: Int, next: Int, rows: Int, pins: Int) -> Bool {
        total >= 0 && start >= 0 && start <= next && next <= total &&
        next - start <= pageSize && rows == next - start &&
        pins >= 0 && pins <= rows &&
        // A nonterminal snapshot page must advance. Otherwise the full
        // 100k PhotoKit map loop can retry the same empty cursor forever.
        // The zero-length page at the actual end remains valid.
        (start == total || next > start)
    }

    /// A delayed MapKit didSelect must never reopen a photo from the old
    /// 64-slot page after a page change, revoke or reload. The caller reads
    /// the currently mounted PhotoKit State page at selection time; this
    /// check accepts only distinct, nonempty members of that exact page.
    static func acceptsSelection(
        selectedIDs: [String], currentPageIDs: [String]
    ) -> Bool {
        guard !selectedIDs.isEmpty, selectedIDs.count <= pageSize,
              currentPageIDs.count <= pageSize else { return false }
        let selectedSet = Set(selectedIDs)
        let pageSet = Set(currentPageIDs)
        return selectedSet.count == selectedIDs.count &&
            pageSet.count == currentPageIDs.count &&
            !selectedSet.contains("") && !pageSet.contains("") &&
            selectedSet.isSubset(of: pageSet)
    }

    /// A Viewer return may reuse its source PhotoKit page camera only while
    /// that very page is still authorized and active. Never carry a camera
    /// from a previous page, revoked PhotoKit subset or background scene.
    static func shouldRestoreCamera(
        savedPageOffset: Int?,
        requestedPageOffset: Int,
        permissionGranted: Bool,
        sceneActive: Bool
    ) -> Bool {
        guard let savedPageOffset, savedPageOffset >= 0,
              requestedPageOffset >= 0 else { return false }
        return permissionGranted && sceneActive &&
            savedPageOffset == requestedPageOffset
    }

    // Each explicit "find GPS" action scans at most 16 consecutive
    // PhotoKit pages (16 * 64 = 1,024 metadata slots). Empty pages do not
    // silently imply there are no valid GPS assets in the full library.
    static let maxSeekGPSPages = 16

    static func shouldSeekNextGPSPage(
        foundPins: Int, finished: Bool, pagesRead: Int
    ) -> Bool {
        foundPins == 0 && !finished &&
        pagesRead >= 1 && pagesRead < maxSeekGPSPages
    }

    static func markerLabel(_ count: Int) -> String {
        "当前页此位置\(max(0, min(pageSize, count)))张照片"
    }
}


/// A transient capture-time predicate shared by native PhotoKit and the Owner
/// map + signed 48-item Range. Always use *absolute* instants for the wire;
/// Calendar supplies each local midnight, including DST/non-24-hour days.
/// Missing capture dates never enter a bounded map selection.
struct XDriveIOSNativePhotoMapCaptureRange: Equatable, Sendable {
    let from: Date
    let to: Date
    let label: String

    var valid: Bool {
        from.timeIntervalSince1970.isFinite &&
        to.timeIntervalSince1970.isFinite &&
        from < to && !label.isEmpty && label.utf8.count <= 80
    }

    func contains(_ capturedAt: Date?) -> Bool {
        guard valid, let capturedAt else { return false }
        return from <= capturedAt && capturedAt < to
    }

    var fromRFC3339: String { ISO8601DateFormatter().string(from: from) }
    var toRFC3339: String { ISO8601DateFormatter().string(from: to) }

    static func day(_ day: Date, calendar: Calendar = .current) -> Self? {
        let start = calendar.startOfDay(for: day)
        guard let end = calendar.date(byAdding: .day, value: 1, to: start)
        else { return nil }
        let parts = calendar.dateComponents([.year, .month, .day], from: day)
        guard let year = parts.year, let month = parts.month, let day = parts.day
        else { return nil }
        let result = Self(from: start, to: end,
                          label: "\(year)年\(month)月\(day)日")
        return result.valid ? result : nil
    }

    static func dayKey(_ key: String, calendar: Calendar = .current) -> Self? {
        let fields = key.split(separator: "-", omittingEmptySubsequences: false)
        guard fields.count == 3, let year = Int(fields[0]),
              let month = Int(fields[1]), let day = Int(fields[2]),
              (1...9999).contains(year), (1...12).contains(month),
              (1...31).contains(day),
              let value = calendar.date(from: DateComponents(
                year: year, month: month, day: day)),
              calendar.dateComponents([.year, .month, .day], from: value) ==
                DateComponents(year: year, month: month, day: day)
        else { return nil }
        return Self.day(value, calendar: calendar)
    }

    static func month(_ year: Int, _ month: Int,
                      calendar: Calendar = .current) -> Self? {
        guard (1...9998).contains(year), (1...12).contains(month),
              let start = calendar.date(from: DateComponents(
                year: year, month: month, day: 1)),
              let end = calendar.date(byAdding: .month, value: 1, to: start)
        else { return nil }
        let range = Self(from: start, to: end, label: "\(year)年\(month)月")
        return range.valid ? range : nil
    }

    static func year(_ year: Int, calendar: Calendar = .current) -> Self? {
        guard (1...9998).contains(year),
              let start = calendar.date(from: DateComponents(year: year, month: 1, day: 1)),
              let end = calendar.date(byAdding: .year, value: 1, to: start)
        else { return nil }
        let range = Self(from: start, to: end, label: "\(year)年")
        return range.valid ? range : nil
    }

    static func recentDays(_ count: Int, now: Date = Date(),
                           calendar: Calendar = .current) -> Self? {
        guard (1...366).contains(count),
              let start = calendar.date(byAdding: .day, value: -(count - 1),
                                        to: calendar.startOfDay(for: now)),
              let end = calendar.date(byAdding: .day, value: 1,
                                      to: calendar.startOfDay(for: now))
        else { return nil }
        let range = Self(from: start, to: end, label: "最近\(count)天")
        return range.valid ? range : nil
    }
}
