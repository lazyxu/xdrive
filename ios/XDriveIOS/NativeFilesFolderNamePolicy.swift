import Foundation

/// Same conservative UTF-8 filename envelope as the existing native Files
/// document stager. The Go Server remains the final name/ACL authority.
enum XDriveIOSNativeFilesFolderNamePolicy {
    static func normalized(_ draft: String) -> String? {
        let name = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name != ".", name != "..",
              name.utf8.count <= 255, !name.hasSuffix("."),
              !name.unicodeScalars.contains(where: {
                  $0.value < 32 || "/\\<>:\"|?*".unicodeScalars.contains($0)
              }) else { return nil }
        let stem = name.components(separatedBy: ".").first?.uppercased() ?? ""
        guard !["CON", "PRN", "AUX", "NUL",
                 "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
                 "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"]
                .contains(stem) else { return nil }
        return name
    }
}

