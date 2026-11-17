import Foundation

/// Preserve existing names for valid originals; only normalize unusually
/// named imported PhotoKit resources into safe and stable Server Node names.
enum XDriveIOSOriginalBackupFilenamePolicy {
    static func destinationName(originalFilename: String,
                                destinationTag: String?,
                                fullSHA256: String) -> String? {
        guard fullSHA256.utf8.count == 64,
              fullSHA256.utf8.allSatisfy(isLowercaseHex) else { return nil }
        if let destinationTag {
            guard destinationTag.utf8.count == 24,
                  destinationTag.utf8.allSatisfy(isLowercaseHex) else { return nil }
        }

        let source = originalFilename as NSString
        let stem = source.deletingPathExtension
        let ext = source.pathExtension
        let hashPrefix = String(fullSHA256.prefix(12))
        let suffix: String
        if let destinationTag {
            suffix = "-xios-" + destinationTag + "-" + hashPrefix
            let legacy = String(stem.prefix(90)) + suffix +
                (ext.isEmpty ? "" : "." + ext)
            if validServerFilename(legacy) { return legacy }
        } else {
            if validServerFilename(originalFilename) { return originalFilename }
            suffix = "-xios-" + hashPrefix
        }

        // PhotoKit originals from imported libraries can have reserved DOS
        // names, separators or very long UTF-8 names. They are metadata, not
        // paths; always keep the byte payload and receipt protocol unchanged.
        let safeExtension = ext.utf8.count > 0 && ext.utf8.count <= 16 &&
            ext.utf8.allSatisfy({ ($0 >= 48 && $0 <= 57) ||
                                  ($0 >= 65 && $0 <= 90) ||
                                  ($0 >= 97 && $0 <= 122) })
            ? "." + ext : ""
        let budget = 255 - suffix.utf8.count - safeExtension.utf8.count
        guard budget >= 5 else { return nil }
        let normalizedStem = sanitizedStem(stem)
        var boundedStem = ""
        for character in normalizedStem {
            let part = String(character)
            if boundedStem.utf8.count + part.utf8.count > budget { break }
            boundedStem.append(character)
        }
        boundedStem = boundedStem.trimmingCharacters(in: CharacterSet(charactersIn: " ."))
        if boundedStem.isEmpty { boundedStem = "Photo" }
        let result = boundedStem + suffix + safeExtension
        return validServerFilename(result) ? result : nil
    }

    static func validServerFilename(_ name: String) -> Bool {
        guard !name.isEmpty, name != ".", name != "..",
              name.utf8.count <= 255,
              !name.hasSuffix(" "), !name.hasSuffix(".") else { return false }
        let bad = Set<UInt32>([34, 42, 47, 58, 60, 62, 63, 92, 124])
        guard !name.unicodeScalars.contains(where: {
            $0.value < 32 || bad.contains($0.value)
        }) else { return false }
        let stem = (name.components(separatedBy: ".").first ?? "").uppercased()
        let reserved = Set([
            "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3",
            "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
            "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6",
            "LPT7", "LPT8", "LPT9"
        ])
        return !reserved.contains(stem)
    }

    private static func isLowercaseHex(_ byte: UInt8) -> Bool {
        (byte >= 48 && byte <= 57) || (byte >= 97 && byte <= 102)
    }

    private static func sanitizedStem(_ source: String) -> String {
        let bad = Set<UInt32>([34, 42, 47, 58, 60, 62, 63, 92, 124])
        var output = ""
        for scalar in source.unicodeScalars {
            if scalar.value < 32 || scalar.value == 127 || bad.contains(scalar.value) {
                output.append("_")
            } else {
                output.unicodeScalars.append(scalar)
            }
        }
        return output.trimmingCharacters(in: CharacterSet(charactersIn: " ."))
    }
}
