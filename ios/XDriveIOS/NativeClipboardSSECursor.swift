import Foundation

/// Owner-scoped Clipboard SSE v1 decoder. Carries invalidation only, never
/// plaintext, ciphertext, keys or OS pasteboard bytes. Cursor is in-memory.
struct XDriveIOSClipboardSSECursor {
    enum FrameError: Error { case invalidFrame }
    private(set) var cursor: UInt64
    private var event: String?
    private var nextID: UInt64?
    private var hasData = false

    init(after: UInt64 = 0) { cursor = after }

    /// One bounded UTF-8 line, without CR/LF. Notify only on complete frames.
    mutating func acceptLine(_ line: String) throws -> Bool {
        guard line.utf8.count <= 4096 && !line.contains("\u{0000}") else {
            throw FrameError.invalidFrame
        }
        if line.isEmpty {
            let shouldRefresh = hasData && (
                (event == "sync" && nextID == nil) ||
                (event == "change" && nextID != nil && nextID! > cursor)
            )
            if shouldRefresh && event == "change" { cursor = nextID! }
            event = nil
            nextID = nil
            hasData = false
            return shouldRefresh
        }
        if line.hasPrefix(":") { return false } // Heartbeat.
        guard let colon = line.firstIndex(of: ":"), colon != line.startIndex else {
            throw FrameError.invalidFrame
        }
        let field = String(line[..<colon])
        let rawValue = String(line[line.index(after: colon)...])
        let value = rawValue.hasPrefix(" ") ? String(rawValue.dropFirst()) : rawValue
        switch field {
        case "event":
            guard value == "sync" || value == "change" else {
                throw FrameError.invalidFrame
            }
            event = value
        case "id":
            guard !value.isEmpty, value.utf8.allSatisfy({ $0 >= 48 && $0 <= 57 }),
                  let parsed = UInt64(value), parsed > 0 else {
                throw FrameError.invalidFrame
            }
            nextID = parsed
        case "data":
            guard value == "{}" else { throw FrameError.invalidFrame }
            hasData = true
        case "retry":
            guard let delay = Int(value), (0...60_000).contains(delay) else {
                throw FrameError.invalidFrame
            }
        default:
            throw FrameError.invalidFrame
        }
        return false
    }
}
