import Foundation

@main
struct XDriveIOSNativeClipboardFolderBackPolicyChecks {
    private static func require(_ condition: @autoclosure () -> Bool, _ name: String) {
        guard condition() else {
            fputs("Clipboard folder back failed: \(name)\n", stderr)
            exit(1)
        }
    }

    static func main() {
        var empty: [Int] = []
        require(!XDriveIOSNativeClipboardFolderBackPolicy.retreat(path: &empty),
                "an empty path must be ignored")
        require(empty.isEmpty, "failed retreat must preserve the path")

        var one = [7]
        require(XDriveIOSNativeClipboardFolderBackPolicy.retreat(path: &one),
                "one-level back should succeed")
        require(one.isEmpty, "one-level back should return to the root")
        // Reproduces the same two-dispatch sequence whose former second
        // `removeLast()` crashed with an illegal instruction on Swift 6.2.1.
        require(!XDriveIOSNativeClipboardFolderBackPolicy.retreat(path: &one),
                "second stale tap must not terminate the process")
        require(one.isEmpty, "second stale tap must leave root unchanged")

        var nested = ["A", "B", "C"]
        require(XDriveIOSNativeClipboardFolderBackPolicy.retreat(path: &nested),
                "nested retreat should succeed")
        require(nested == ["A", "B"], "nested retreat must pop exactly one")
        require(XDriveIOSNativeClipboardFolderBackPolicy.retreat(path: &nested),
                "second nested retreat should succeed")
        require(nested == ["A"], "second retreat must not skip the ancestor")
        require(XDriveIOSNativeClipboardFolderBackPolicy.retreat(path: &nested),
                "third nested retreat should succeed")
        require(nested.isEmpty, "nested retreat must reach root")
        require(!XDriveIOSNativeClipboardFolderBackPolicy.retreat(path: &nested),
                "fourth stale tap must be a no-op")

        print("Clipboard folder back double-tap and nested path checks passed")
    }
}
