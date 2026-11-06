import Foundation

@main
struct XDriveIOSOriginalBackupMediaPolicyChecks {
    static func main() {
        precondition(XDriveIOSOriginalBackupMediaPolicy.eligible(kind: "image", isLive: false))
        precondition(XDriveIOSOriginalBackupMediaPolicy.eligible(kind: "video", isLive: false))
        precondition(!XDriveIOSOriginalBackupMediaPolicy.eligible(kind: "image", isLive: true))
        precondition(!XDriveIOSOriginalBackupMediaPolicy.eligible(kind: "live", isLive: true))
        precondition(!XDriveIOSOriginalBackupMediaPolicy.eligible(kind: "unknown", isLive: false))
        precondition(XDriveIOSOriginalBackupMediaPolicy.maxBytes(kind: "image") == Int64.max)
        precondition(XDriveIOSOriginalBackupMediaPolicy.maxBytes(kind: "video") == Int64.max)
        precondition(XDriveIOSOriginalBackupMediaPolicy.videoLimit == Int64.max)
        precondition(XDriveIOSOriginalBackupMediaPolicy.backgroundVideoLimit == Int64.max)
        precondition(XDriveIOSOriginalBackupMediaPolicy.videoLimit ==
                     XDriveIOSOriginalBackupMediaPolicy.backgroundVideoLimit)
        precondition(XDriveIOSOriginalBackupMediaPolicy.maxBytes(kind: "live") == nil)
        print("iOS original still/video unbounded media policy: PASS")
    }
}
