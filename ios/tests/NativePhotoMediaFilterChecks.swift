import Foundation

@main
struct NativePhotoMediaFilterChecks {
    static func main() {
        let filters = XDriveIOSNativePhotoMediaFilter.allCases
        precondition(filters.map(\.rawValue) == ["all", "photos", "videos", "favorites"])
        precondition(filters.map(\.title) == ["全部", "照片", "视频", "收藏"])
        precondition(filters.map(\.expectedKind) == [nil, "image", "video", nil])
        precondition(Set(filters.map(\.id)).count == 4)
        precondition(XDriveIOSNativePhotoMediaFilter(rawValue: "unknown") == nil)
        precondition(XDriveIOSNativePhotoMediaFilter.all.includes(kind: "image"))
        precondition(XDriveIOSNativePhotoMediaFilter.all.includes(kind: "video"))
        precondition(!XDriveIOSNativePhotoMediaFilter.all.includes(kind: "unsupported"))
        precondition(XDriveIOSNativePhotoMediaFilter.photos.includes(kind: "image"))
        precondition(!XDriveIOSNativePhotoMediaFilter.photos.includes(kind: "video"))
        precondition(XDriveIOSNativePhotoMediaFilter.videos.includes(kind: "video"))
        precondition(!XDriveIOSNativePhotoMediaFilter.videos.includes(kind: "image"))
        precondition(XDriveIOSNativePhotoMediaFilter.favorites.requiresFavorite)
        precondition(!XDriveIOSNativePhotoMediaFilter.photos.requiresFavorite)
        precondition(XDriveIOSNativePhotoMediaFilter.favorites.includes(kind: "video"))
        precondition(XDriveIOSNativePhotoMediaFilter.favorites.includes(kind: "image"))
        precondition(!XDriveIOSNativePhotoMediaFilter.favorites.includes(kind: "unsupported"))
        print("iOS PhotoKit all/photos/videos/favorites filter policy: PASS")
    }
}
