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
        // A confirmed Server destination's display path is not upload
        // permission. Accept the new flat managed Push contract and exactly
        // bounded historical layouts; no arbitrary nested directory is valid.
        typealias D = XDriveIOSPhotoBackupDestinationPathPolicy
        let device = "550e8400-e29b-41d4-a716-446655440000"
        let otherDevice = "a18e8400-e29b-41d4-a716-446655440000"
        let name = "家庭相册"
        precondition(D.accepts(
            path: "同步文件夹/Push/家庭相册", name: name, deviceID: device
        ))
        precondition(D.accepts(
            path: "同步文件夹/Push/我的iPhone_550e8400e29b/家庭相册",
            name: name, deviceID: device
        ))
        precondition(D.accepts(
            path: "同步文件夹/设备备份/旧设备/家庭相册",
            name: name, deviceID: device
        ))
        for invalid in [
            "同步文件夹/Push/家庭相册/",
            "同步文件夹/Push//家庭相册",
            "同步文件夹/Push/另一台设备_550e8400e29c/家庭相册",
            "同步文件夹/Push/我的iPhone_550e8400e29b/其它/家庭相册",
            "同步文件夹/Push/../家庭相册",
            "同步文件夹/Pull/家庭相册",
            "我的文件/家庭相册",
            "同步文件夹/设备备份/旧设备/其它/家庭相册",
            "同步文件夹/设备备份/../家庭相册",
            "同步文件夹/设备备份//家庭相册"
        ] {
            precondition(!D.accepts(path: invalid, name: name, deviceID: device))
        }
        precondition(!D.accepts(
            path: "同步文件夹/Push/我的iPhone_550e8400e29b/家庭相册",
            name: name, deviceID: otherDevice
        ))
        precondition(!D.accepts(
            path: "同步文件夹/Push/家庭相册", name: name, deviceID: "not-a-uuid"
        ))
        precondition(!D.accepts(
            path: "同步文件夹/Push/家庭相册",
            name: "家庭相册/不允许嵌套", deviceID: device
        ))
        print("PASS: native iOS Photos destination single-name policy")
    }
}
