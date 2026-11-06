import Foundation

@main
struct NativePhotoMediaFilterChecks {
    static func main() {
        let filters = XDriveIOSNativePhotoMediaFilter.allCases
        precondition(filters.map(\.rawValue) == [
            "all", "photos", "videos",
            "photos+videos+favorites", "photos+livePhotos", "photos+screenshots"
        ])
        precondition(filters.map(\.title) == [
            "照片和视频", "照片", "视频", "照片和视频 · 收藏",
            "照片 · 实况", "照片 · 截屏"
        ])
        precondition(filters.map(\.expectedKind) == [
            nil, "image", "video", nil, "image", "image"
        ])
        precondition(Set(filters.map(\.id)).count == 6)
        precondition(XDriveIOSNativePhotoMediaFilter(rawValue: "unknown") == nil)
        precondition(XDriveIOSNativePhotoMediaFilter(rawValue: "photos+unknown") == nil)

        let all = XDriveIOSNativePhotoMediaFilter.all
        precondition(all.isAll)
        precondition(all.includes(kind: "image"))
        precondition(all.includes(kind: "video"))
        precondition(!all.includes(kind: "unsupported"))

        let photos = XDriveIOSNativePhotoMediaFilter.photos
        precondition(photos.includes(kind: "image"))
        precondition(!photos.includes(kind: "video"))
        precondition(photos.fetchKind == "image")

        let videos = XDriveIOSNativePhotoMediaFilter.videos
        precondition(videos.includes(kind: "video"))
        precondition(!videos.includes(kind: "image"))
        precondition(videos.fetchKind == "video")

        let favorites = XDriveIOSNativePhotoMediaFilter.favorites
        precondition(favorites.requiresFavorite)
        precondition(favorites.includes(kind: "video"))
        precondition(favorites.includes(kind: "image"))
        precondition(favorites.fetchKind == nil)

        let live = XDriveIOSNativePhotoMediaFilter.livePhotos
        precondition(live.requiresLive)
        precondition(!live.requiresFavorite)
        precondition(!live.requiresScreenshot)
        precondition(live.includes(kind: "image"))
        precondition(!live.includes(kind: "video"))
        precondition(live.fetchKind == "image")

        let screenshots = XDriveIOSNativePhotoMediaFilter.screenshots
        precondition(screenshots.requiresScreenshot)
        precondition(!screenshots.requiresLive)
        precondition(!screenshots.requiresFavorite)
        precondition(screenshots.includes(kind: "image"))
        precondition(!screenshots.includes(kind: "video"))
        precondition(screenshots.fetchKind == "image")

        let favoriteLive = all
            .setting(.favorites, enabled: true)
            .setting(.livePhotos, enabled: true)
        precondition(favoriteLive.requiresFavorite && favoriteLive.requiresLive)
        precondition(favoriteLive.includes(kind: "image"))
        precondition(!favoriteLive.includes(kind: "video"))
        precondition(favoriteLive.fetchKind == "image")
        precondition(favoriteLive.rawValue == "photos+videos+favorites+livePhotos")
        precondition(XDriveIOSNativePhotoMediaFilter(rawValue: favoriteLive.rawValue) == favoriteLive)

        let photoOnly = all.setting(.videos, enabled: false)
        precondition(photoOnly == .photos)
        let videoOnly = all.setting(.photos, enabled: false)
        precondition(videoOnly == .videos)
        precondition(!videoOnly.requiresLive && !videoOnly.requiresScreenshot)

        let neverEmpty = XDriveIOSNativePhotoMediaFilter.videos
            .setting(.videos, enabled: false)
        precondition(neverEmpty == .photos)

        let liveAndScreenshot = all
            .setting(.livePhotos, enabled: true)
            .setting(.screenshots, enabled: true)
        precondition(liveAndScreenshot.requiresLive && liveAndScreenshot.requiresScreenshot)
        precondition(liveAndScreenshot.fetchKind == "image")

        precondition(all.emptyMessage == "当前已授权图库中没有可浏览的照片或视频。")
        precondition(photos.emptyMessage == "当前已授权图库中没有照片。")
        precondition(videos.emptyMessage == "当前已授权图库中没有视频。")
        precondition(favorites.emptyMessage == "当前已授权图库中没有收藏照片或视频。")
        precondition(live.emptyMessage == "当前已授权图库中没有实况照片。")
        precondition(screenshots.emptyMessage == "当前已授权图库中没有截屏。")
        precondition(favoriteLive.emptyMessage == "当前已授权图库中没有符合收藏及媒体类型筛选条件的照片。")
        precondition(liveAndScreenshot.emptyMessage == "当前已授权图库中没有符合实况和截屏筛选条件的照片。")
        let favoritePhotos = all
            .setting(.videos, enabled: false)
            .setting(.favorites, enabled: true)
        precondition(favoritePhotos.emptyMessage == "当前已授权图库中没有收藏照片。")
        let favoriteVideos = all
            .setting(.photos, enabled: false)
            .setting(.favorites, enabled: true)
        precondition(favoriteVideos.emptyMessage == "当前已授权图库中没有收藏视频。")
        print("iOS PhotoKit combined media filter policy: PASS")
    }
}
