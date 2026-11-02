import Foundation

@main
struct NativeAppleNotesShortcutPolicyChecks {
    private static func check(_ condition: @autoclosure () -> Bool, _ reason: String) {
        if !condition() {
            fputs("native Apple Notes Shortcut policy: \(reason)\n", stderr)
            exit(1)
        }
    }

    static func main() throws {
        typealias P = XDriveIOSAppleNotesShortcutPolicy
        let digest = String(repeating: "a", count: 64)
        let result = try P.prepare(title: "  会议/计划:*?  ", text: "原文\nsecond line 😀", sha256: digest)
        check(result.filename == "AppleNote-会议-计划-\(String(repeating: "a", count: 20)).txt", "safe stable filename")
        check(String(data: result.data, encoding: .utf8) == "原文\nsecond line 😀", "UTF-8 unchanged")
        check(P.matchesExisting(filename: result.filename, expected: result,
                                parentID: 71, expectedParentID: 71, type: "file",
                                bytes: Int64(result.data.count), sha256: digest), "exact full hash match")
        check(!P.matchesExisting(filename: result.filename, expected: result,
                                 parentID: 72, expectedParentID: 71, type: "file",
                                 bytes: Int64(result.data.count), sha256: digest), "different parent rejected")
        check(!P.matchesExisting(filename: result.filename, expected: result,
                                 parentID: 71, expectedParentID: 71, type: "file",
                                 bytes: Int64(result.data.count), sha256: String(repeating: "b", count: 64)), "full digest mismatch rejected")
        check(!P.matchesExisting(filename: result.filename, expected: result,
                                 parentID: 71, expectedParentID: 71, type: "dir",
                                 bytes: Int64(result.data.count), sha256: digest), "folder is not a note")
        let traversal = try P.prepare(title: "../../", text: "x", sha256: digest)
        check(traversal.filename == "AppleNote-Untitled-\(String(repeating: "a", count: 20)).txt", "path traversal removed")
        let longName = String(repeating: "长", count: 150)
        let capped = try P.prepare(title: longName, text: "x", sha256: digest)
        check(capped.filename.utf8.count <= 150, "multibyte filename stays bounded")
        check((try? P.prepare(title: "x", text: "", sha256: digest)) == nil, "no empty backup")
        check((try? P.prepare(title: "x", text: String(repeating: "q", count: P.maximumTextBytes + 1), sha256: digest)) == nil,
              "oversize Shortcut payload rejected")
        check((try? P.prepare(title: "x", text: "text", sha256: "not-a-hash")) == nil,
              "hash validation")
        print("native Apple Notes Shortcut text snapshot and readback policy: PASS")
    }
}
