import Foundation

@main
struct XDriveNativePhotoViewerReturnAnchorChecks {
    static func main() {
        let ids = (0..<64).map { "photo-\($0)" }
        func check(_ condition: Bool, _ reason: String) {
            guard condition else {
                fputs("viewer anchor failure: \(reason)\n", stderr)
                exit(1)
            }
        }
        check(XDriveIOSNativePhotoViewerReturnAnchorPolicy.target("photo-39", in: ids, authorized: true) == "photo-39", "same page target")
        check(XDriveIOSNativePhotoViewerReturnAnchorPolicy.target("photo-39", in: ids, authorized: false) == nil, "revoked PhotoKit permission")
        check(XDriveIOSNativePhotoViewerReturnAnchorPolicy.target("deleted", in: ids, authorized: true) == nil, "changed library")
        check(XDriveIOSNativePhotoViewerReturnAnchorPolicy.target(nil, in: ids, authorized: true) == nil, "no Viewer")
        check(XDriveIOSNativePhotoViewerReturnAnchorPolicy.target("", in: ids, authorized: true) == nil, "empty identity")
        check(XDriveIOSNativePhotoViewerReturnAnchorPolicy.target(String(repeating: "x", count: 1025), in: ids, authorized: true) == nil, "oversized identity")
        check(XDriveIOSNativePhotoViewerReturnAnchorPolicy.target("photo-39", in: ids + ["extra"], authorized: true) == nil, "unbounded page")
        check(XDriveIOSNativePhotoViewerReturnAnchorPolicy.target("photo-38", in: Array(ids[0..<32]), authorized: true) == nil, "other page")
        print("native PhotoKit Viewer tile anchor policy checks passed")
    }
}
