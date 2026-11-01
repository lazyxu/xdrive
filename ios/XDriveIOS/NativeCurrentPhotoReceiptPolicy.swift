import Foundation

/// Reproduces the *existing* native Owner Files original destination name,
/// so an explicit read-only proof can locate the exact current-media receipt.
/// No PhotoKit identifiers or server credentials are serialized by this policy.
enum XDriveIOSNativeCurrentPhotoReceiptPolicy {
    static func destinationName(originalFilename: String,
                                tag: String, sha256: String) -> String? {
        guard validSourceFilename(originalFilename),
              tag.utf8.count == 24, tag.utf8.allSatisfy(isLowerHex),
              sha256.utf8.count == 64, sha256.utf8.allSatisfy(isLowerHex)
        else { return nil }
        let source = originalFilename as NSString
        let stem = source.deletingPathExtension
        let ext = source.pathExtension
        let prefix = String(stem.prefix(90))
        let suffix = "-xios-" + tag + "-" + String(sha256.prefix(12))
        let output = prefix + suffix + (ext.isEmpty ? "" : "." + ext)
        return validSourceFilename(output) ? output : nil
    }

    static func canVerifySingleOriginal(kind: String, isLive: Bool) -> Bool {
        (kind == "image" && !isLive) || kind == "video"
    }

    /// A local .confirmed bit or historical record count never suffices.
    /// Success requires an exact receipt *and* a fresh authenticated Node
    /// readback, followed by a new PhotoKit source-revision check.
    static func canPublishCurrentProof(
        matchedRoleAndDigest: Bool,
        historicalConfirmed: Bool,
        completeReceipt: Bool,
        ownerNodeReadbackSucceeded: Bool,
        sourceStillSame: Bool
    ) -> Bool {
        matchedRoleAndDigest && historicalConfirmed && completeReceipt &&
        ownerNodeReadbackSucceeded && sourceStillSame
    }

    private static func isLowerHex(_ ch: UInt8) -> Bool {
        (48...57).contains(ch) || (97...102).contains(ch)
    }

    private static func validSourceFilename(_ name: String) -> Bool {
        guard !name.isEmpty, name != ".", name != "..",
              name.utf8.count <= 255,
              !name.hasSuffix(" "), !name.hasSuffix(".") else { return false }
        let invalid: Set<UInt32> = [34, 42, 47, 58, 60, 62, 63, 92, 124]
        guard !name.unicodeScalars.contains(where: {
            $0.value < 32 || invalid.contains($0.value)
        }) else { return false }
        let stem = (name.components(separatedBy: ".").first ?? "").uppercased()
        let reserved: Set<String> = [
            "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3",
            "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
            "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6",
            "LPT7", "LPT8", "LPT9"
        ]
        return !reserved.contains(stem)
    }
}
