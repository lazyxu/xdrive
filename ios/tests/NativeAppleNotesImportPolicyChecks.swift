import Foundation

@main
struct NativeAppleNotesImportPolicyChecks {
    private static func check(_ condition: @autoclosure () -> Bool, _ message: String) {
        if !condition() {
            fputs("Apple Notes import policy failed: \(message)\n", stderr)
            exit(1)
        }
    }

    static func main() throws {
        typealias P = XDriveIOSNotesImportPolicy
        let note = try P.prepare(
            title: "  会议记录  ",
            text: "# 会议记录\n\n- 中文和 emoji 😀",
            externalID: "  iCloud-notes:record-42 "
        )
        check(note.title == "会议记录", "trim title")
        check(note.markdown == "# 会议记录\n\n- 中文和 emoji 😀", "UTF-8 retained")
        check(note.externalID == "iCloud-notes:record-42", "stable source trimmed")
        let noIdentifier = try P.prepare(
            title: "会议记录", text: "同名不同笔记", externalID: nil
        )
        check(noIdentifier.externalID.isEmpty, "never guess the source ID from title")
        check((try? P.prepare(title: " ", text: "valid", externalID: nil)) == nil,
              "empty title forbidden")
        check((try? P.prepare(title: "A\nB", text: "valid", externalID: nil)) == nil,
              "control character in title forbidden")
        check((try? P.prepare(title: "a", text: "", externalID: nil)) == nil,
              "empty imported note forbidden")
        check((try? P.prepare(title: "a",
                              text: String(repeating: "t", count: P.maximumTextBytes + 1),
                              externalID: nil)) == nil,
              "UTF-8 bytes bound enforced")
        check((try? P.prepare(title: "a", text: "abc", externalID: "id\u{000A}other")) == nil,
              "invalid native source id forbidden")
        print("Apple Notes explicit Markdown and stable-ID import policy: PASS")
    }
}
