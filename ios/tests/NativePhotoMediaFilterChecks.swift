import Foundation

@main
struct NativePhotoMediaFilterChecks {
    static func main() {
        let filters = XDriveIOSNativePhotoMediaFilter.allCases
        precondition(filters.map(\.rawValue) == ["all", "photos", "videos"])
        precondition(filters.map(\.title) == ["全部", "照片", "视频"])
        precondition(filters.map(\.expectedKind) == [nil, "image", "video"])
        precondition(Set(filters.map(\.id)).count == 3)
        precondition(XDriveIOSNativePhotoMediaFilter(rawValue: "unknown") == nil)
        precondition(XDriveIOSNativePhotoMediaFilter.all.includes(kind: "image"))
        precondition(XDriveIOSNativePhotoMediaFilter.all.includes(kind: "video"))
        precondition(!XDriveIOSNativePhotoMediaFilter.all.includes(kind: "unsupported"))
        precondition(XDriveIOSNativePhotoMediaFilter.photos.includes(kind: "image"))
        precondition(!XDriveIOSNativePhotoMediaFilter.photos.includes(kind: "video"))
        precondition(XDriveIOSNativePhotoMediaFilter.videos.includes(kind: "video"))
        precondition(!XDriveIOSNativePhotoMediaFilter.videos.includes(kind: "image"))
        print("iOS PhotoKit all/photos/videos filter policy: PASS")
    }
}
