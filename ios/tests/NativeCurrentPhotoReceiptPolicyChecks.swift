import Foundation

@main
struct NativeCurrentPhotoReceiptPolicyChecks {
    static func main() {
        let tag = String(repeating: "a", count: 24)
        let digest = String(repeating: "b", count: 64)
        typealias Policy = XDriveIOSNativeCurrentPhotoReceiptPolicy
        precondition(Policy.destinationName(
            originalFilename: "IMG_2026.HEIC", tag: tag, sha256: digest
        ) == "IMG_2026-xios-\(tag)-\(String(digest.prefix(12))).HEIC")
        precondition(Policy.destinationName(
            originalFilename: String(repeating: "X", count: 100) + ".mov",
            tag: tag, sha256: digest
        ) == String(repeating: "X", count: 90) +
            "-xios-\(tag)-\(String(digest.prefix(12))).mov")
        precondition(Policy.destinationName(
            originalFilename: "x.jpg", tag: "0", sha256: digest
        ) == nil)
        precondition(Policy.destinationName(
            originalFilename: "x.jpg", tag: tag, sha256: "DEADBEEF"
        ) == nil)
        precondition(Policy.destinationName(
            originalFilename: "a/b.jpg", tag: tag, sha256: digest
        ) == nil)
        precondition(Policy.destinationName(
            originalFilename: "CON.jpg", tag: tag, sha256: digest
        ) == nil)
        precondition(Policy.canVerifyOriginal(kind: "image", isLive: false))
        precondition(Policy.canVerifyOriginal(kind: "video", isLive: false))
        precondition(Policy.canVerifyOriginal(kind: "image", isLive: true))
        precondition(!Policy.canVerifyOriginal(kind: "video", isLive: true))
        precondition(Policy.liveDestinationName(tag: tag, sha256: digest) ==
                     "Live-xios-\(tag)-\(String(digest.prefix(12))).zip")
        precondition(Policy.liveDestinationName(tag: "bad", sha256: digest) == nil)
        precondition(Policy.liveDestinationName(tag: tag, sha256: "bad") == nil)
        precondition(!Policy.canVerifyOriginal(kind: "unsupported", isLive: false))

        // Existing upload and ZIP64 writers accept originals beyond 1 GiB.
        // Receipt readback must not convert a valid large Node into a false
        // "unverified" result; only non-positive sizes are invalid.
        let testedSizes: [Int64] = [
            1, 1_073_741_824, 1_073_741_825,
            5 * 1_073_741_824, Int64.max
        ]
        for bytes in testedSizes {
            precondition(Policy.fitsStagedPayload(bytes: bytes, isLiveArchive: false))
            precondition(Policy.fitsStagedPayload(bytes: bytes, isLiveArchive: true))
        }
        precondition(!Policy.fitsStagedPayload(bytes: 0, isLiveArchive: false))
        precondition(!Policy.fitsStagedPayload(bytes: 0, isLiveArchive: true))
        precondition(!Policy.fitsStagedPayload(bytes: -1, isLiveArchive: false))
        precondition(!Policy.fitsStagedPayload(bytes: -1, isLiveArchive: true))

        for mask in 0..<32 {
            let allowed = Policy.canPublishCurrentProof(
                matchedRoleAndDigest: mask & 1 != 0,
                historicalConfirmed: mask & 2 != 0,
                completeReceipt: mask & 4 != 0,
                ownerNodeReadbackSucceeded: mask & 8 != 0,
                sourceStillSame: mask & 16 != 0
            )
            precondition(allowed == (mask == 31))
        }
        print("Current still/video PhotoKit original Owner Node proof policy: PASS")
    }
}
