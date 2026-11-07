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


/// A read-only check of a path returned by the *authenticated Server*, not
/// client-side target selection or an upload permission. New managed Push
/// targets are flat; previously provisioned device-group and historic folder
/// layouts remain readable without silently migrating existing originals.
enum XDriveIOSPhotoBackupDestinationPathPolicy {
    static func accepts(path: String, name: String, deviceID: String) -> Bool {
        guard XDriveIOSPhotoBackupDestinationNamePolicy.normalized(name) == name,
              let deviceUUID = UUID(uuidString: deviceID) else { return false }
        let segments = path.split(separator: "/", omittingEmptySubsequences: false)
        guard segments.first == "同步文件夹",
              segments.last == Substring(name) else { return false }

        switch segments.count {
        case 3:
            // Exactly one leaf: 同步文件夹/Push/<SourceName>.
            return segments[1] == "Push"
        case 4:
            // A previously created managed target is never moved or inferred
            // from a display path. Its exact Owner/Device/Source/Target IDs
            // must still pass the separate live Server binding readback.
            let namespace = segments[1]
            guard namespace == "Push" || namespace == "设备备份" else {
                return false
            }
            let group = String(segments[2])
            guard !group.isEmpty, group != ".", group != "..",
                  group.utf8.count <= 255, !group.hasSuffix("."),
                  !group.contains("\\"),
                  !group.unicodeScalars.contains(where: {
                      $0.value < 32 || $0.value == 127
                  }) else { return false }
            if namespace == "设备备份" {
                // Historical, noncanonical layout: existing targets only.
                return true
            }
            // The prior Push layout used a device-specific Server group
            // ending in the first 12 lowercase hex digits of its UUID.
            // Reject any other nested Push path or another device's group.
            let compactID = deviceUUID.uuidString
                .replacingOccurrences(of: "-", with: "").lowercased()
            let suffix = "_" + String(compactID.prefix(12))
            return group.utf8.count > suffix.utf8.count && group.hasSuffix(suffix)
        default:
            // Reject extra depth, empty segments, trailing slashes and
            // unrelated Pull/Owner-root paths, even if the leaf matches.
            return false
        }
    }
}
