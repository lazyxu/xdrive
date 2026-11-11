import Foundation

@main struct ClipboardSharePolicyChecks {
    static func main() {
        precondition(XDriveIOSClipboardSharePolicy.acceptable(nil) == nil)
        precondition(XDriveIOSClipboardSharePolicy.acceptable("") == nil)
        precondition(XDriveIOSClipboardSharePolicy.acceptable("x\u{0000}y") == nil)
        precondition(XDriveIOSClipboardSharePolicy.acceptable(String(repeating: "X", count: 65_536)) != nil)
        precondition(XDriveIOSClipboardSharePolicy.acceptable(String(repeating: "X", count: 65_537)) == nil)
        precondition(XDriveIOSClipboardSharePolicy.acceptable("https://example.org/中文") == "https://example.org/中文")
        precondition(XDriveIOSClipboardSharePolicy.acceptable("跨设备\n文本") == "跨设备\n文本")
        precondition(XDriveIOSClipboardSharePolicy.acceptableFileSize(1))
        precondition(XDriveIOSClipboardSharePolicy.acceptableFileSize(64 * 1_048_576))
        precondition(!XDriveIOSClipboardSharePolicy.acceptableFileSize(64 * 1_048_576 + 1))
        precondition(XDriveIOSClipboardSharePolicy.acceptableFileName("照片.heic") == "照片.heic")
        precondition(XDriveIOSClipboardSharePolicy.acceptableFileName("../secret") == nil)
        precondition(XDriveIOSClipboardSharePolicy.acceptableFileName("a/b") == nil)
        print("iOS Clipboard Share: bounded input and no implicit send passed")
    }
}
