import Foundation

/// Text snapshots explicitly supplied by a user-created Shortcuts workflow.
/// Apple Notes has no public all-notes read API: this never enumerates Notes.
struct XDriveIOSAppleNoteSnapshot {
    let filename: String
    let data: Data
    let sha256: String
}

enum XDriveIOSAppleNotesShortcutError: Error {
    case emptyText
    case textTooLarge
    case invalidSHA256
}

enum XDriveIOSAppleNotesShortcutPolicy {
    static let maximumTextBytes = 1_048_576
    static let maximumTitleBytes = 96

    /// Preserve Shortcut-provided UTF-8 exactly; do not pretend to recover
    /// embedded images, checklists, handwriting or native Notes metadata.
    static func prepare(title: String, text: String, sha256: String) throws
        -> XDriveIOSAppleNoteSnapshot {
        guard !text.isEmpty else { throw XDriveIOSAppleNotesShortcutError.emptyText }
        guard text.utf8.count <= maximumTextBytes else {
            throw XDriveIOSAppleNotesShortcutError.textTooLarge
        }
        guard sha256.utf8.count == 64, sha256.utf8.allSatisfy({
            (48...57).contains($0) || (97...102).contains($0)
        }) else { throw XDriveIOSAppleNotesShortcutError.invalidSHA256 }
        let cleaned = title.replacingOccurrences(
            of: "\\s+", with: " ", options: .regularExpression
        ).map { character -> Character in
            character.unicodeScalars.contains(where: {
                $0.value < 32 || $0.value == 127 ||
                "/\\\\<>:\"|?*".unicodeScalars.contains($0)
            }) ? "-" : character
        }
        var name = ""
        for character in cleaned {
            let part = String(character)
            if name.utf8.count + part.utf8.count > maximumTitleBytes { break }
            name.append(character)
        }
        name = name.trimmingCharacters(
            in: CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: ".-"))
        )
        if name.isEmpty { name = "Untitled" }
        // Content-addressed, non-destructive revisions. The server must still
        // prove the FULL SHA-256 before an existing filename can be skipped.
        let filename = "AppleNote-\(name)-\(sha256.prefix(20)).txt"
        return XDriveIOSAppleNoteSnapshot(
            filename: filename, data: Data(text.utf8), sha256: sha256
        )
    }

    static func matchesExisting(filename: String, expected: XDriveIOSAppleNoteSnapshot,
                                parentID: UInt64?, expectedParentID: UInt64,
                                type: String, bytes: Int64, sha256: String?) -> Bool {
        filename == expected.filename && parentID == expectedParentID &&
            type == "file" && bytes == Int64(expected.data.count) &&
            sha256?.lowercased() == expected.sha256
    }
}
