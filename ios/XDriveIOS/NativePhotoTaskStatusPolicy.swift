import Foundation

/// Presentation-only overlay for one currently active original. The durable
/// PhotoKit queue and cloud Node receipts remain the sole source of truth.
enum XDriveIOSNativePhotoTaskStatusPolicy {
    static func displayedState(
        rowState: String, rowID: String, currentPageVerified: Bool,
        currentOwnerMatched: Bool, uploadBusy: Bool,
        activeLocalIdentifier: String?, stoppedForUnknownReceipt: Bool
    ) -> String {
        guard !rowID.isEmpty, currentOwnerMatched,
              activeLocalIdentifier == rowID else {
            return currentPageVerified ? "matched" : rowState
        }
        // A lost final ACK is never "failed" or "confirmed". Keep this
        // warning after the writer has stopped until current Owner review.
        if stoppedForUnknownReceipt { return "needsReconciliation" }
        if uploadBusy { return "processing" }
        return currentPageVerified ? "matched" : rowState
    }
}
