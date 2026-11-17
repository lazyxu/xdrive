import Foundation

/// Executable pure-Swift protocol checks; can run without UIKit or an iPhone:
/// swiftc XDriveIOS/NativeClipboardSSECursor.swift tests/ClipboardSSECursorChecks.swift -o /tmp/clipboard-sse-check
@main struct ClipboardSSECursorChecks {
    private static func require(_ condition: Bool) { precondition(condition) }

    static func feed(_ cursor: inout XDriveIOSClipboardSSECursor,
                     _ lines: [String]) throws -> Bool {
        var result = false
        for line in lines { result = try cursor.acceptLine(line) }
        return result
    }

    static func rejects(_ line: String) -> Bool {
        var cursor = XDriveIOSClipboardSSECursor()
        do { _ = try cursor.acceptLine(line); return false }
        catch { return true }
    }

    static func main() async throws {
        var first = XDriveIOSClipboardSSECursor()
        require(try feed(&first, ["retry: 2000", "event: sync", "data: {}", ""]))
        precondition(first.cursor == 0)
        require(try feed(&first, ["id: 31", "event: change", "data: {}", ""]))
        precondition(first.cursor == 31)
        require(!(try feed(&first, [": ping", "id: 31", "event: change", "data: {}", ""])))
        precondition(first.cursor == 31)

        // A partial frame never signals; reconnect must keep the last committed ID.
        _ = try first.acceptLine("id: 32")
        _ = try first.acceptLine("event: change")
        var resumed = XDriveIOSClipboardSSECursor(after: first.cursor)
        require(try feed(&resumed, ["event: sync", "data: {}", ""]))
        require(try feed(&resumed, ["id: 32", "event: change", "data: {}", ""]))
        precondition(resumed.cursor == 32)
        require(!(try feed(&resumed, ["event: change", "data: {}", ""])))
        require(!(try feed(&resumed, ["event: sync", ""])))

        for invalid in ["id: 0", "id: -1", "id: 18446744073709551616",
                        "event: secret", "data: secret", "data: {\"ciphertext\":\"leak\"}",
                        "unknown: value", String(repeating: "x", count: 4097)] {
            precondition(rejects(invalid), "Unexpectedly accepted invalid frame")
        }
        // A stream may emit complete events and then throw: its stored
        // progress must survive, without accepting incomplete or stale IDs.
        let live = XDriveIOSClipboardSSEProgress()
        await live.advance(41)
        await live.advance(40)
        let before = await live.current()
        precondition(before == 41)
        await live.advance(42)
        let after = await live.current()
        precondition(after == 42)
        print("iOS Clipboard SSE: cursor, framing, disconnect progress and privacy checks passed")
    }
}
