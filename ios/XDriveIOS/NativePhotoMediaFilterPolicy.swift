import Foundation
import Photos

/// The UI exposes independent PhotoKit predicates. The media-type switches
/// default to both on; subtype/favorite predicates are intersected with them.
enum XDriveIOSNativePhotoMediaFilterCriterion: String, CaseIterable, Identifiable {
    case photos, videos, favorites, livePhotos, screenshots

    var id: String { rawValue }
    var title: String {
        switch self {
        case .photos: return "照片"
        case .videos: return "视频"
        case .favorites: return "收藏"
        case .livePhotos: return "实况"
        case .screenshots: return "截屏"
        }
    }

    fileprivate var mask: UInt8 {
        switch self {
        case .photos: return 1 << 0
        case .videos: return 1 << 1
        case .favorites: return 1 << 2
        case .livePhotos: return 1 << 3
        case .screenshots: return 1 << 4
        }
    }
}

/// A stable, serializable combination of PhotoKit list predicates.
/// Numeric offsets always refer to the exact filtered PHFetchResult.
struct XDriveIOSNativePhotoMediaFilter: Hashable, CaseIterable, Identifiable, RawRepresentable {
    private let bits: UInt8

    private init(bits: UInt8) { self.bits = bits }

    // RawRepresentable's default equality compares rawValue. Our rawValue
    // consults isAll, so compare the canonical bitset directly to avoid recursion.
    static func == (lhs: Self, rhs: Self) -> Bool { lhs.bits == rhs.bits }
    func hash(into hasher: inout Hasher) { hasher.combine(bits) }

    static let all = Self(bits: (1 << 0) | (1 << 1))
    static let photos = Self(bits: 1 << 0)
    static let videos = Self(bits: 1 << 1)
    static let favorites = Self(bits: (1 << 0) | (1 << 1) | (1 << 2))
    static let livePhotos = Self(bits: (1 << 0) | (1 << 3))
    static let screenshots = Self(bits: (1 << 0) | (1 << 4))

    static let allCases: [Self] = [
        .all, .photos, .videos, .favorites, .livePhotos, .screenshots
    ]

    var id: String { rawValue }

    var rawValue: String {
        if isAll { return "all" }
        return XDriveIOSNativePhotoMediaFilterCriterion.allCases
            .filter { isEnabled($0) }
            .map(\.rawValue)
            .joined(separator: "+")
    }

    init?(rawValue: String) {
        if rawValue == "all" {
            self = .all
            return
        }
        let names = rawValue.split(separator: "+", omittingEmptySubsequences: false)
        guard !names.isEmpty else { return nil }
        var value: UInt8 = 0
        for name in names {
            guard let criterion = XDriveIOSNativePhotoMediaFilterCriterion(
                rawValue: String(name)
            ) else { return nil }
            value |= criterion.mask
        }
        guard value & (Self.photos.bits | Self.videos.bits) != 0 else { return nil }
        guard value & (Self.livePhotos.bits & ~Self.photos.bits) == 0 ||
              value & Self.photos.bits != 0 else { return nil }
        guard value & (Self.screenshots.bits & ~Self.photos.bits) == 0 ||
              value & Self.photos.bits != 0 else { return nil }
        self.bits = value
    }

    var title: String {
        let hasPhotos = isEnabled(.photos)
        let hasVideos = isEnabled(.videos)
        var parts: [String] = []
        if hasPhotos && hasVideos { parts.append("照片和视频") }
        else if hasPhotos { parts.append("照片") }
        else if hasVideos { parts.append("视频") }
        if requiresFavorite { parts.append("收藏") }
        if requiresLive { parts.append("实况") }
        if requiresScreenshot { parts.append("截屏") }
        return parts.joined(separator: " · ")
    }

    var isAll: Bool { bits == Self.all.bits }

    var allItemsTitle: String {
        isAll ? "所有媒体（查看全部）" : "所有\(title)（查看全部）"
    }

    var emptyMessage: String {
        isAll
            ? "当前已授权图库中没有可浏览的照片或视频。"
            : "当前已授权图库中没有\(title)内容。"
    }

    func isEnabled(_ criterion: XDriveIOSNativePhotoMediaFilterCriterion) -> Bool {
        bits & criterion.mask != 0
    }

    /// Keep at least one media type selected. Live/screenshot imply Photos;
    /// turning Photos off clears those image-only subtype constraints.
    func setting(
        _ criterion: XDriveIOSNativePhotoMediaFilterCriterion,
        enabled: Bool
    ) -> Self {
        var next = bits
        if enabled { next |= criterion.mask }
        else { next &= ~criterion.mask }

        switch criterion {
        case .photos:
            if !enabled {
                next &= ~(XDriveIOSNativePhotoMediaFilterCriterion.livePhotos.mask |
                          XDriveIOSNativePhotoMediaFilterCriterion.screenshots.mask)
                if next & XDriveIOSNativePhotoMediaFilterCriterion.videos.mask == 0 {
                    next |= XDriveIOSNativePhotoMediaFilterCriterion.videos.mask
                }
            }
        case .videos:
            if !enabled && next & XDriveIOSNativePhotoMediaFilterCriterion.photos.mask == 0 {
                next |= XDriveIOSNativePhotoMediaFilterCriterion.photos.mask
            }
        case .livePhotos, .screenshots:
            if enabled {
                next |= XDriveIOSNativePhotoMediaFilterCriterion.photos.mask
            }
        case .favorites:
            break
        }
        return Self(bits: next)
    }

    var requiresFavorite: Bool { isEnabled(.favorites) }
    var requiresLive: Bool { isEnabled(.livePhotos) }
    var requiresScreenshot: Bool { isEnabled(.screenshots) }

    /// PhotoKit's typed fetch is used whenever one media type or an image
    /// subtype is selected. nil means the real all-media fetch.
    var fetchKind: String? {
        if requiresLive || requiresScreenshot { return "image" }
        let hasPhotos = isEnabled(.photos)
        let hasVideos = isEnabled(.videos)
        if hasPhotos && !hasVideos { return "image" }
        if hasVideos && !hasPhotos { return "video" }
        return nil
    }

    var expectedKind: String? { fetchKind }

    func includes(kind: String) -> Bool {
        switch kind {
        case "image": return isEnabled(.photos)
        case "video": return isEnabled(.videos) && !requiresLive && !requiresScreenshot
        default: return false
        }
    }

    /// Build one AND predicate so favorite, Live and screenshot filters can
    /// be combined without silently dropping any selected condition.
    func applyPredicates(to options: PHFetchOptions) {
        var predicates: [NSPredicate] = []
        if requiresFavorite {
            predicates.append(NSPredicate(format: "favorite == YES"))
        }
        if requiresLive {
            predicates.append(NSPredicate(
                format: "(mediaSubtypes & %d) != 0",
                PHAssetMediaSubtype.photoLive.rawValue
            ))
        }
        if requiresScreenshot {
            predicates.append(NSPredicate(
                format: "(mediaSubtypes & %d) != 0",
                PHAssetMediaSubtype.photoScreenshot.rawValue
            ))
        }
        if predicates.count == 1 {
            options.predicate = predicates[0]
        } else if !predicates.isEmpty {
            options.predicate = NSCompoundPredicate(andPredicateWithSubpredicates: predicates)
        }
    }
}
