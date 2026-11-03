import Foundation

@main
struct XDriveIOSNativeAlbumNamePolicyChecks {
    static func main() {
        typealias P = XDriveIOSNativeAlbumNamePolicy
        precondition(P.normalized("  旅行 2026  ") == "旅行 2026")
        precondition(P.normalized("Live Photo & 视频") == "Live Photo & 视频")
        precondition(P.normalized("") == nil)
        precondition(P.normalized(" \t\n ") == nil)
        precondition(P.normalized("照片\n删除") == nil)
        precondition(P.normalized("照片\u{0000}路径") == nil)
        precondition(P.normalized(String(repeating: "甲", count: 80)) != nil)
        precondition(P.normalized(String(repeating: "甲", count: 81)) == nil)
        precondition(P.normalized(String(repeating: "🙂", count: 64)) == nil)
        precondition(P.normalized(String(repeating: "a", count: 80)) != nil)
        print("native PhotoKit user album name policy: PASS")
    }
}
