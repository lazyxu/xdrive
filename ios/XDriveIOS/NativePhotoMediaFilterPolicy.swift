import Foundation

/// Gallery-only media selection. Offsets refer to the actual PhotoKit fetch
/// for that media type, never to a filtered in-memory subset of 64 tiles.
enum XDriveIOSNativePhotoMediaFilter: String, CaseIterable, Identifiable {
    case all, photos, videos

    var id: String { rawValue }
    var title: String {
        switch self {
        case .all: return "全部"
        case .photos: return "照片"
        case .videos: return "视频"
        }
    }
    func includes(kind: String) -> Bool {
        switch self {
        case .all: return kind == "image" || kind == "video"
        case .photos: return kind == "image"
        case .videos: return kind == "video"
        }
    }

    var expectedKind: String? {
        switch self {
        case .all: return nil
        case .photos: return "image"
        case .videos: return "video"
        }
    }
}
