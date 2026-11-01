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

        precondition(Policy.fitsStagedPayload(
            bytes: Policy.maximumOriginalBytes, isLiveArchive: false
        ))
        precondition(!Policy.fitsStagedPayload(
            bytes: Policy.maximumOriginalBytes + 1, isLiveArchive: false
        ))
        precondition(Policy.fitsStagedPayload(
            bytes: Policy.maximumOriginalBytes + 1, isLiveArchive: true
        ))
        precondition(Policy.fitsStagedPayload(
            bytes: Policy.maximumOriginalBytes + Policy.maximumLiveZIPOverhead,
            isLiveArchive: true
        ))
        precondition(!Policy.fitsStagedPayload(
            bytes: Policy.maximumOriginalBytes + Policy.maximumLiveZIPOverhead + 1,
            isLiveArchive: true
        ))
        precondition(!Policy.fitsStagedPayload(bytes: 0, isLiveArchive: true))
        precondition(!Policy.fitsStagedPayload(bytes: Int64.max, isLiveArchive: true))

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
