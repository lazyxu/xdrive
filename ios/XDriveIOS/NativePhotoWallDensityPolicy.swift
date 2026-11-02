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
