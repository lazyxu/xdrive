import Foundation

@main
struct XDriveIOSNativeFilesFolderNameChecks {
    static func check(_ pass: @autoclosure () -> Bool, _ reason: String) {
        if !pass() { fputs("native Files folder-name failure: \(reason)\n", stderr); exit(1) }
    }
    static func main() {
        check(XDriveIOSNativeFilesFolderNamePolicy.normalized("报告 2026") == "报告 2026",
              "Unicode and spaces")
        check(XDriveIOSNativeFilesFolderNamePolicy.normalized("  working  ") == "working",
              "trim draft only before POST")
        check(XDriveIOSNativeFilesFolderNamePolicy.normalized("") == nil, "empty")
        check(XDriveIOSNativeFilesFolderNamePolicy.normalized("..") == nil, "parent")
        check(XDriveIOSNativeFilesFolderNamePolicy.normalized("test/dir") == nil, "slash")
        check(XDriveIOSNativeFilesFolderNamePolicy.normalized("a\\b") == nil, "backslash")
        check(XDriveIOSNativeFilesFolderNamePolicy.normalized("CON.txt") == nil, "reserved")
        check(XDriveIOSNativeFilesFolderNamePolicy.normalized("name.") == nil, "trailing period")
        check(XDriveIOSNativeFilesFolderNamePolicy.normalized(String(repeating: "x", count: 256)) == nil,
              "maximum UTF8 bytes")
        print("native Files folder-name checks passed")
    }
}
