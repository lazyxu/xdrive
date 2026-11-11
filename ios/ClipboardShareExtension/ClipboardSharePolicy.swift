import Foundation

/// The share sheet never receives an xDrive bearer, E2EE vault key, or Owner ID.
/// It only prepares an explicit, short-lived local paste. Native Files/CAS
/// upload and directed Clipboard send require separate foreground user taps.
enum XDriveIOSClipboardSharePolicy {
    static let maxTextBytes = 65_536
    static let maxFileBytes = 64 * 1_048_576

    static func acceptableFileSize(_ size: Int) -> Bool {
        size > 0 && size <= maxFileBytes
    }

    static func acceptableFileName(_ name: String?) -> String? {
        guard let name, !name.isEmpty, name == name.trimmingCharacters(in: .whitespacesAndNewlines),
              name != "." && name != "..", name.utf8.count <= 255,
              !name.contains("/") && !name.contains("\\") &&
              !name.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 })
        else { return nil }
        return name
    }

    static func acceptable(_ raw: String?) -> String? {
        guard let text = raw, !text.isEmpty, !text.contains("\u{0000}"),
              text.utf8.count <= maxTextBytes else { return nil }
        return text
    }
}
