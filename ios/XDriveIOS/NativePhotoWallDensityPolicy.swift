import Foundation

/// Presentation-only density of the local, authorized PhotoKit wall.
/// Values are not persisted and never enter backup cursors or media identity.
enum XDriveIOSNativePhotoWallDensity: String, CaseIterable, Identifiable {
    case compact, standard, large

    var id: String { rawValue }

    var title: String {
        switch self {
        case .compact: return "紧凑"
        case .standard: return "标准"
        case .large: return "大图"
        }
    }

    /// Adaptive cell widths are bounded while each visible thumbnail stays
    /// square. Portrait and landscape both use the actual available width.
    var minimumCellWidth: CGFloat {
        switch self {
        case .compact: return 58
        case .standard: return 82
        case .large: return 120
        }
    }

    var maximumCellWidth: CGFloat {
        switch self {
        case .compact: return 78
        case .standard: return 110
        case .large: return 165
        }
    }

    func zoomedIn() -> Self {
        switch self {
        case .compact: return .standard
        case .standard, .large: return .large
        }
    }

    func zoomedOut() -> Self {
        switch self {
        case .compact, .standard: return .compact
        case .large: return .standard
        }
    }

    /// Ignore accidental small scale changes caused by scroll gestures.
    func applyingPinch(_ magnification: CGFloat) -> Self {
        guard magnification.isFinite, magnification > 0 else { return self }
        if magnification >= 1.2 { return zoomedIn() }
        if magnification <= 0.83 { return zoomedOut() }
        return self
    }
}

 
/// Presentation-only: show the complete composition inside a stable square slot.
enum XDriveIOSNativePhotoWallFraming: String, CaseIterable, Identifiable {
    case square, complete
    var id: String { rawValue }
    var title: String {
        switch self {
        case .square: return "方形裁切"
        case .complete: return "完整图片（原比例）"
        }
    }
}


/// Shared *visible-window* date grouping. This changes presentation only:
/// an Owner's whole place is never inferred from its first 48-item page.
enum XDriveIOSNativePhotoWallTimeScale: String, CaseIterable, Identifiable {
    case all, year, month, day
    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: return "全部"
        case .year: return "年"
        case .month: return "月"
        case .day: return "日"
        }
    }

    func key(for date: Date?) -> String {
        guard self != .all else { return "all" }
        guard let date else { return "unknown" }
        let parts = Calendar.current.dateComponents([.year, .month, .day], from: date)
        guard let year = parts.year, let month = parts.month, let day = parts.day else {
            return "unknown"
        }
        return key(year: year, month: month, day: day)
    }

    func key(forISO8601 value: String?) -> String {
        guard self != .all else { return "all" }
        guard let value else { return "unknown" }
        let parts = String(value.prefix(10)).split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0].count == 4, parts[1].count == 2,
              parts[2].count == 2,
              let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2]),
              year > 0, month >= 1, month <= 12, day >= 1, day <= 31
        else { return "unknown" }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let components = DateComponents(year: year, month: month, day: day)
        guard let date = calendar.date(from: components) else { return "unknown" }
        let validated = calendar.dateComponents([.year, .month, .day], from: date)
        guard validated.year == year, validated.month == month, validated.day == day
        else { return "unknown" }
        // Interpret the *instant* in the same device calendar as native
        // Gallery, not the RFC3339 string's original UTC calendar day.
        guard let instant = try? Date(value, strategy: .iso8601) else {
            return "unknown"
        }
        return key(for: instant)
    }

    private func key(year: Int, month: Int, day: Int) -> String {
        let yearText = String(format: "%04d", year)
        let monthText = String(format: "%02d", month)
        let dayText = String(format: "%02d", day)
        switch self {
        case .all: return "all"
        case .year: return yearText
        case .month: return yearText + "-" + monthText
        case .day: return yearText + "-" + monthText + "-" + dayText
        }
    }

    func label(for key: String) -> String {
        if key == "unknown" { return "拍摄日期未知" }
        switch self {
        case .all: return "全部"
        case .year: return key + " 年"
        case .month:
            let parts = key.split(separator: "-")
            return parts.count == 2 ? "\(parts[0]) 年 \(parts[1]) 月" : key
        case .day:
            let parts = key.split(separator: "-")
            return parts.count == 3
                ? "\(parts[0]) 年 \(parts[1]) 月 \(parts[2]) 日" : key
        }
    }
}

/// An index is a hint for choosing a 48-item range, never media authorization.
/// All displayed Nodes must still pass the normal Owner Reader and revision checks.
struct XDriveIOSNativeOwnerPlaceDateJump: Equatable {
    let key: String
    let startIndex: Int
    let offset: Int
}

enum XDriveIOSNativeOwnerPlaceDateIndexPolicy {
    private static func utcDate(_ day: String) -> Date? {
        let parts = day.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0].count == 4,
              parts[1].count == 2, parts[2].count == 2,
              let y = Int(parts[0]), let m = Int(parts[1]), let d = Int(parts[2]),
              y > 0, (1...12).contains(m), (1...31).contains(d) else { return nil }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(secondsFromGMT: 0)!
        guard let date = cal.date(from: DateComponents(year: y, month: m, day: d))
        else { return nil }
        let verified = cal.dateComponents([.year, .month, .day], from: date)
        return verified.year == y && verified.month == m && verified.day == d
            ? date : nil
    }

    private static func validKey(_ key: String, scale: XDriveIOSNativePhotoWallTimeScale) -> Bool {
        switch scale {
        case .all: return false
        case .year:
            return key.count == 4 && key.allSatisfy { $0.isASCII && $0.isNumber }
                && Int(key).map { $0 > 0 } == true
        case .month:
            return key.count == 7 && key[key.index(key.startIndex, offsetBy: 4)] == "-"
                && utcDate(key + "-01") != nil
        case .day:
            return utcDate(key) != nil
        }
    }

    static func accepts(_ sets: XDriveIOSNativeMediaDateGroupSets, total: Int) -> Bool {
        guard total > 0, total <= 10_000_000 else { return false }
        let modes: [(XDriveIOSNativePhotoWallTimeScale, [XDriveIOSNativeMediaDateGroup])] =
            [(.year, sets.year), (.month, sets.month), (.day, sets.day)]
        for (scale, groups) in modes {
            guard !groups.isEmpty && groups.count <= total else { return false }
            var counted = 0
            var lastKnown: String?
            var ascending: Bool?
            var hasKnown = false
            var hasUnknown = false
            for (position, group) in groups.enumerated() {
                guard group.start_index == counted, group.item_count > 0,
                      group.item_count <= total - counted else { return false }
                counted += group.item_count
                if group.key == "unknown" {
                    // A single unknown date bucket may occur only at one edge.
                    if hasUnknown || (position != 0 && position != groups.count - 1) {
                        return false
                    }
                    hasUnknown = true
                    continue
                }
                guard validKey(group.key, scale: scale) else { return false }
                hasKnown = true
                if let previous = lastKnown {
                    guard group.key != previous else { return false }
                    let increasing = group.key > previous
                    if let ascending, ascending != increasing { return false }
                    ascending = increasing
                }
                lastKnown = group.key
            }
            guard counted == total && hasKnown else { return false }
        }
        return true
    }

    /// Only for old Server responses whose single <=48 row page is the
    /// entire authorized place, with a real monotonic capture-date ordering.
    static func legacyCompleteIndex(
        _ page: XDriveIOSNativeMediaRange
    ) -> XDriveIOSNativeMediaDateGroupSets? {
        guard page.offset == 0, page.total_count > 0, page.total_count <= 48,
              page.items.count == page.total_count else { return nil }
        var days: [String] = []
        for item in page.items {
            guard let timestamp = item.metadata.captured_at else {
                days.append("unknown")
                continue
            }
            let day = String(timestamp.prefix(10))
            guard validKey(day, scale: .day) else { return nil }
            days.append(day)
        }
        let known = days.filter { $0 != "unknown" }
        guard let first = known.first, let last = known.last else { return nil }
        let descending = first >= last
        for i in 1..<known.count {
            if (descending && known[i] > known[i - 1]) ||
               (!descending && known[i] < known[i - 1]) {
                return nil
            }
        }
        func collapse(_ scale: XDriveIOSNativePhotoWallTimeScale)
            -> [XDriveIOSNativeMediaDateGroup]? {
            var result: [XDriveIOSNativeMediaDateGroup] = []
            var seen = Set<String>()
            for (i, day) in days.enumerated() {
                let key: String = day == "unknown" ? "unknown" :
                    scale == .year ? String(day.prefix(4)) :
                    scale == .month ? String(day.prefix(7)) : day
                if let last = result.last, last.key == key {
                    result[result.count - 1] = XDriveIOSNativeMediaDateGroup(
                        key: key, item_count: last.item_count + 1,
                        start_index: last.start_index)
                } else {
                    if !seen.insert(key).inserted { return nil }
                    result.append(XDriveIOSNativeMediaDateGroup(
                        key: key, item_count: 1, start_index: i))
                }
            }
            return result
        }
        guard let y = collapse(.year), let m = collapse(.month),
              let d = collapse(.day) else { return nil }
        let sets = XDriveIOSNativeMediaDateGroupSets(year: y, month: m, day: d)
        return accepts(sets, total: page.total_count) ? sets : nil
    }

    /// O(log days) seek, with at most two verified candidate groups. UTC
    /// date keys are chosen from the calendar day explicitly selected in UI.
    static func nearestDay(
        _ requested: Date, index: XDriveIOSNativeMediaDateGroupSets,
        total: Int, pageSize: Int
    ) -> XDriveIOSNativeOwnerPlaceDateJump? {
        guard total > 0, pageSize > 0 else { return nil }
        let parts = Calendar.current.dateComponents([.year, .month, .day], from: requested)
        guard let y = parts.year, let m = parts.month, let d = parts.day else { return nil }
        let key = String(format: "%04d-%02d-%02d", y, m, d)
        guard let requestedUTC = utcDate(key) else { return nil }
        let days = index.day
        let start = days.first?.key == "unknown" ? 1 : 0
        let end = days.last?.key == "unknown" ? days.count - 1 : days.count
        guard start < end else { return nil }
        let ascending = end - start < 2 || days[start].key < days[start + 1].key
        var low = start
        var high = end
        while low < high {
            let mid = low + (high - low) / 2
            let moveRight = ascending ? days[mid].key < key : days[mid].key > key
            if moveRight { low = mid + 1 } else { high = mid }
        }
        var chosen: XDriveIOSNativeMediaDateGroup?
        var smallest = Double.infinity
        for position in [low - 1, low] where position >= start && position < end {
            let day = days[position]
            guard let timestamp = utcDate(day.key) else { return nil }
            let distance = abs(timestamp.timeIntervalSince(requestedUTC))
            if distance < smallest {
                smallest = distance
                chosen = day
            }
        }
        guard let chosen, chosen.start_index >= 0,
              chosen.start_index < total else { return nil }
        return XDriveIOSNativeOwnerPlaceDateJump(
            key: chosen.key, startIndex: chosen.start_index,
            offset: (chosen.start_index / pageSize) * pageSize)
    }
}

/// Shared state-only auto-advance gate. No platform permissions, PhotoKit scan,
/// signed Owner range or Viewer is ever started by the shared presentation.
enum XDriveIOSNativePhotoWallWindowPolicy {
    static func shouldAdvance(footVisible: Bool, hasNext: Bool, busy: Bool,
                              failed: Bool, viewerOpen: Bool,
                              scopeActive: Bool) -> Bool {
        footVisible && hasNext && !busy && !failed && !viewerOpen && scopeActive
    }

    /// Only an anchor in the caller's *current verified* window may be restored.
    /// Older windows are re-fetched by the caller before becoming eligible.
    static func canRestore<T: Equatable>(_ anchor: T?, in verifiedIDs: [T],
                                         scopeActive: Bool) -> Bool {
        guard scopeActive, let anchor else { return false }
        // A duplicate tile identifier has no deterministic scroll/focus target.
        var found = false
        for item in verifiedIDs where item == anchor {
            if found { return false }
            found = true
        }
        return found
    }

    static func canRestore<T>(_ anchor: T?, in verifiedItems: [T],
                              scopeActive: Bool,
                              matches: (T, T) -> Bool) -> Bool {
        guard scopeActive, let anchor else { return false }
        // The same ID and revision must identify one unique verified tile.
        var found = false
        for item in verifiedItems where matches(item, anchor) {
            if found { return false }
            found = true
        }
        return found
    }
}
