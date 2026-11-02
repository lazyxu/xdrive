import Foundation

@main
struct NativePhotoMediaFilterChecks {
    static func main() {
        let filters = XDriveIOSNativePhotoMediaFilter.allCases
        precondition(filters.map(\.rawValue) == [
            "all", "photos", "videos", "favorites", "livePhotos", "screenshots"
        ])
        precondition(filters.map(\.title) == [
            "全部", "照片", "视频", "收藏", "实况", "截屏"
        ])
        precondition(filters.map(\.expectedKind) == [
            nil, "image", "video", nil, "image", "image"
        ])
        precondition(Set(filters.map(\.id)).count == 6)
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
        precondition(XDriveIOSNativePhotoMediaFilter.livePhotos.requiresLive)
        precondition(!XDriveIOSNativePhotoMediaFilter.livePhotos.requiresFavorite)
        precondition(!XDriveIOSNativePhotoMediaFilter.livePhotos.requiresScreenshot)
        precondition(XDriveIOSNativePhotoMediaFilter.livePhotos.includes(kind: "image"))
        precondition(!XDriveIOSNativePhotoMediaFilter.livePhotos.includes(kind: "video"))
        precondition(XDriveIOSNativePhotoMediaFilter.screenshots.requiresScreenshot)
        precondition(!XDriveIOSNativePhotoMediaFilter.screenshots.requiresLive)
        precondition(!XDriveIOSNativePhotoMediaFilter.screenshots.requiresFavorite)
        precondition(XDriveIOSNativePhotoMediaFilter.screenshots.includes(kind: "image"))
        precondition(!XDriveIOSNativePhotoMediaFilter.screenshots.includes(kind: "video"))
        print("iOS PhotoKit all/photos/videos/favorites/live/screenshots policy: PASS")
    }
}
