import Foundation

@main
struct XDriveIOSOriginalBackupMediaPolicyChecks {
    static func main() {
        precondition(XDriveIOSOriginalBackupMediaPolicy.eligible(kind: "image", isLive: false))
        precondition(XDriveIOSOriginalBackupMediaPolicy.eligible(kind: "video", isLive: false))
        precondition(!XDriveIOSOriginalBackupMediaPolicy.eligible(kind: "image", isLive: true))
        precondition(!XDriveIOSOriginalBackupMediaPolicy.eligible(kind: "live", isLive: true))
        precondition(!XDriveIOSOriginalBackupMediaPolicy.eligible(kind: "unknown", isLive: false))
        precondition(XDriveIOSOriginalBackupMediaPolicy.maxBytes(kind: "image") == 128 * 1_048_576)
        precondition(XDriveIOSOriginalBackupMediaPolicy.maxBytes(kind: "video") == 1_073_741_824)
        precondition(XDriveIOSOriginalBackupMediaPolicy.maxBytes(kind: "live") == nil)
        print("iOS original still/video bounded media policy: PASS")
    }
}
