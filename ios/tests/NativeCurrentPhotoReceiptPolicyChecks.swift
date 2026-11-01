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
        precondition(Policy.canVerifySingleOriginal(kind: "image", isLive: false))
        precondition(Policy.canVerifySingleOriginal(kind: "video", isLive: false))
        precondition(!Policy.canVerifySingleOriginal(kind: "image", isLive: true))
        precondition(!Policy.canVerifySingleOriginal(kind: "unsupported", isLive: false))

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
