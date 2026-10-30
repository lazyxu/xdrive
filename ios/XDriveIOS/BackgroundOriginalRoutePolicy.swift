import Foundation

/// A background photo grant is NOT an ordinary User JWT. Translate only the
/// exact Go UploadSession operations which #3166 scoped to Owner/Root/iOS-HMAC
/// namespace. No arbitrary /nodes, /files, admin or SourceRun paths.
enum XDriveIOSBackgroundUploadRoutePolicy {
    private static let oldPrefix = "/api/v1/uploads"
    private static let scopedPrefix = "/api/v1/ios/photos/background/uploads"

    static func translatedPath(_ path: String) -> String? {
        if path == oldPrefix { return scopedPrefix }
        guard path.hasPrefix(oldPrefix + "/") else { return nil }
        let tail = String(path.dropFirst(oldPrefix.count + 1))
        let parts = tail.split(separator: "/", omittingEmptySubsequences: false)
        guard !parts.isEmpty, let id = UUID(uuidString: String(parts[0])),
              id.uuidString.lowercased() == String(parts[0]).lowercased() else {
            return nil
        }
        switch parts.count {
        case 1:
            break // Exact single-session GET
        case 2:
            guard parts[1] == "finalize" else { return nil }
        case 3:
            guard parts[1] == "chunks",
                  let index = Int(parts[2]), index >= 0, index <= 255,
                  String(index) == String(parts[2]) else { return nil }
        default:
            return nil
        }
        return scopedPrefix + "/" + tail
    }
}

/// Exactly matches the backend's restricted "-xios-" original filename
/// namespace without accepting attacker-controlled directories/Node paths.
enum XDriveIOSBackgroundOriginalNamePolicy {
    static func valid(_ name: String) -> Bool {
        guard let range = name.range(of: "-xios-", options: .backwards),
              !name[..<range.lowerBound].isEmpty,
              !name.hasSuffix(" "), !name.hasSuffix("."),
              name.utf8.count <= 255,
              !name.unicodeScalars.contains(where: {
                  $0.value < 32 || "<>:\\\"/|?*".unicodeScalars.contains($0)
              }) else { return false }

        let after = String(name[range.upperBound...])
        let parts = after.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count <= 2 else { return false }
        let blocks = parts[0].split(separator: "-", omittingEmptySubsequences: false)
        guard blocks.count == 2, blocks[0].utf8.count == 24,
              blocks[1].utf8.count == 12 else { return false }
        let isHex: (Substring) -> Bool = { value in
            value.utf8.allSatisfy { ($0 >= 48 && $0 <= 57) ||
                                  ($0 >= 97 && $0 <= 102) }
        }
        guard isHex(blocks[0]), isHex(blocks[1]) else { return false }
        if parts.count == 2 {
            guard !parts[1].isEmpty, parts[1].utf8.count <= 12,
                  parts[1].utf8.allSatisfy({
                      ($0 >= 48 && $0 <= 57) || ($0 >= 65 && $0 <= 90) ||
                      ($0 >= 97 && $0 <= 122)
                  }) else { return false }
        }
        let stem = name.split(separator: ".", omittingEmptySubsequences: false)
            .first?.uppercased() ?? ""
        let reserved = Set(["CON", "PRN", "AUX", "NUL",
            "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
            "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"])
        return !reserved.contains(stem)
    }
}
