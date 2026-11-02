import Foundation

/// Gallery-only media selection. Offsets refer to the actual PhotoKit fetch
/// for that media type, never to a filtered in-memory subset of 64 tiles.
enum XDriveIOSNativePhotoMediaFilter: String, CaseIterable, Identifiable {
    case all, photos, videos, favorites, livePhotos, screenshots

    var id: String { rawValue }
    var title: String {
        switch self {
        case .all: return "全部"
        case .photos: return "照片"
        case .videos: return "视频"
        case .favorites: return "收藏"
        case .livePhotos: return "实况"
        case .screenshots: return "截屏"
        }
    }
    func includes(kind: String) -> Bool {
        switch self {
        case .all, .favorites: return kind == "image" || kind == "video"
        case .photos, .livePhotos, .screenshots: return kind == "image"
        case .videos: return kind == "video"
        }
    }

    var requiresFavorite: Bool { self == .favorites }
    var requiresLive: Bool { self == .livePhotos }
    var requiresScreenshot: Bool { self == .screenshots }

    var expectedKind: String? {
        switch self {
        case .all, .favorites: return nil
        case .photos, .livePhotos, .screenshots: return "image"
        case .videos: return "video"
        }
    }
}
