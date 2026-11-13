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

/// Presentation-only contiguous sections of a *currently loaded* photo window.
/// Never sorts, widens, or queries a PhotoKit/Owner collection. An unknown date
/// stays in its original position and a repeated nonadjacent date starts another
/// section rather than reordering Viewer identities.
struct XDriveIOSNativePhotoWallVisibleSection<Item>: Identifiable {
    let id: Int
    let key: String
    var items: [Item]
}

func xdriveIOSNativePhotoWallVisibleSections<Item>(
    _ items: [Item],
    scale: XDriveIOSNativePhotoWallTimeScale,
    key: (Item) -> String
) -> [XDriveIOSNativePhotoWallVisibleSection<Item>] {
    var result: [XDriveIOSNativePhotoWallVisibleSection<Item>] = []
    for item in items {
        let groupKey = scale == .all ? "all" : key(item)
        if !result.isEmpty && result[result.count - 1].key == groupKey {
            result[result.count - 1].items.append(item)
        } else {
            result.append(.init(id: result.count, key: groupKey, items: [item]))
        }
    }
    return result
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
