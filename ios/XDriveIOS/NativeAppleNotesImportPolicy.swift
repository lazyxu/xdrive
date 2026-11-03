import Foundation

/// A Shortcut explicitly supplies the visible Notes title, text and, where
/// possible, a stable Notes identifier. No Apple Notes database access exists.
struct XDriveIOSNotesImportSnapshot {
    let title: String
    let markdown: String
    let externalID: String
}

enum XDriveIOSNotesImportPolicyError: LocalizedError {
    case emptyText
    case textTooLarge
    case invalidTitle
    case invalidSourceID

    var errorDescription: String? {
        switch self {
        case .emptyText: return "快捷指令没有传入可备份的正文。"
        case .textTooLarge: return "这条备忘录正文超过 1 MiB，本次未备份。"
        case .invalidTitle: return "备忘录标题为空或包含不支持的字符。"
        case .invalidSourceID: return "备忘录来源标识格式无效。"
        }
    }
}

enum XDriveIOSNotesImportPolicy {
    static let maximumTextBytes = 1_048_576

    static func prepare(title: String, text: String, externalID: String?)
        throws -> XDriveIOSNotesImportSnapshot {
        let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanTitle.isEmpty, cleanTitle.utf8.count <= 255,
              !cleanTitle.unicodeScalars.contains(where: {
                  $0.value < 32 || $0.value == 127
              }) else { throw XDriveIOSNotesImportPolicyError.invalidTitle }
        guard !text.isEmpty else { throw XDriveIOSNotesImportPolicyError.emptyText }
        guard text.utf8.count <= maximumTextBytes,
              !text.unicodeScalars.contains(where: { $0.value == 0 }) else {
            throw XDriveIOSNotesImportPolicyError.textTooLarge
        }
        let id = (externalID ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard id.utf8.count <= 255,
              !id.unicodeScalars.contains(where: {
                  $0.value < 32 || $0.value == 127
              }) else { throw XDriveIOSNotesImportPolicyError.invalidSourceID }

        // Markdown is the exact user-supplied text. Plain text is valid
        // Markdown; Shortcuts does NOT guarantee rich formatting or images.
        // An empty ID MUST NOT be replaced with title/content/date guesses:
        // two distinct Apple Notes may share all three.
        return XDriveIOSNotesImportSnapshot(
            title: cleanTitle, markdown: text, externalID: id
        )
    }
}
