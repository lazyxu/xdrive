import Foundation

/// A single folder *name*, never a client-composed cloud path. The Server
/// supplies the actual managed Source/Node path after Owner+Device admission.
enum XDriveIOSPhotoBackupDestinationNamePolicy {
    static let maximumBytes = 128
    private static let forbidden = CharacterSet(charactersIn: "<>:\"/\\|?*")
    private static let reserved: Set<String> = {
        var values: Set<String> = ["CON", "PRN", "AUX", "NUL"]
        for index in 1...9 {
            values.insert("COM\(index)")
            values.insert("LPT\(index)")
        }
        return values
    }()

    static func normalized(_ value: String) -> String? {
        let name = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name != ".", name != "..",
              name.utf8.count <= maximumBytes,
              !name.hasSuffix("."),
              !name.unicodeScalars.contains(where: {
                  $0.value < 32 || forbidden.contains($0)
              }) else { return nil }
        let base = String(name.split(separator: ".", maxSplits: 1,
                                     omittingEmptySubsequences: false).first ?? "")
            .uppercased()
        guard !reserved.contains(base) else { return nil }
        return name
    }

    static func suggested(deviceName: String) -> String {
        normalized(deviceName) ?? "iPhone"
    }
}
