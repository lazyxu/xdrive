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


    /// The actual upload writer stores the still+motion pair in ONE ZIP node,
    /// named from the deterministic ZIP hash. Never verify just one part.
    static func liveDestinationName(tag: String, sha256: String) -> String? {
        guard tag.utf8.count == 24, tag.utf8.allSatisfy(isLowerHex),
              sha256.utf8.count == 64, sha256.utf8.allSatisfy(isLowerHex)
        else { return nil }
        let name = "Live-xios-" + tag + "-" + String(sha256.prefix(12)) + ".zip"
        return validSourceFilename(name) ? name : nil
    }

    // A Live ZIP contains up to 1 GiB of original still+motion bytes plus
    // ZIP local headers, manifest and central directory. This is a bounded
    // allowance for deterministic archive overhead, not a larger original.
    static let maximumOriginalBytes: Int64 = 1_073_741_824
    static let maximumLiveZIPOverhead: Int64 = 1_048_576

    static func fitsStagedPayload(bytes: Int64, isLiveArchive: Bool) -> Bool {
        bytes > 0 && bytes <= maximumOriginalBytes +
            (isLiveArchive ? maximumLiveZIPOverhead : 0)
    }

    static func canVerifyOriginal(kind: String, isLive: Bool) -> Bool {
        kind == "image" || (kind == "video" && !isLive)
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
