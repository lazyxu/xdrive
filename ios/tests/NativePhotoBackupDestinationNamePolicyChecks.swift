import Foundation

@main
struct NativePhotoBackupDestinationNamePolicyChecks {
    static func main() {
        typealias P = XDriveIOSPhotoBackupDestinationNamePolicy
        precondition(P.suggested(deviceName: " 我的 iPhone ") == "我的 iPhone")
        precondition(P.suggested(deviceName: "机型/非法") == "iPhone")
        precondition(P.normalized("家庭相册") == "家庭相册")
        precondition(P.normalized(" iPhone 原件 ") == "iPhone 原件")
        precondition(P.normalized("iPhone / Photos") == nil)
        precondition(P.normalized("Photos\\Local") == nil)
        precondition(P.normalized("CON") == nil)
        precondition(P.normalized("LPT2.txt") == nil)
        precondition(P.normalized("..") == nil)
        precondition(P.normalized("folder.") == nil)
        precondition(P.normalized("") == nil)
        precondition(P.normalized(String(repeating: "x", count: 129)) == nil)
        print("PASS: native iOS Photos destination single-name policy")
    }
}
