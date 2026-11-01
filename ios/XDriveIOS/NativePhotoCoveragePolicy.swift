import Foundation

/// A read-only count of historical sealed original-upload operations.
/// These are operation records, never unique current PHAssets and never a
/// proof that an old cloud Node still exists.
struct XDriveIOSNativePhotoReceiptTally: Equatable {
    private(set) var totalOperations = 0
    private(set) var historicallyConfirmed = 0
    private(set) var uncertain = 0
    private(set) var preparedOnly = 0
    private(set) var incompleteReceipt = 0

    mutating func include(state: String, hasVerifiedReceipt: Bool) {
        totalOperations += 1
        switch state {
        case "confirmed":
            if hasVerifiedReceipt { historicallyConfirmed += 1 }
            else { incompleteReceipt += 1 }
        case "creating", "uploading", "finalizing", "needsReconciliation":
            uncertain += 1
        case "prepared":
            preparedOnly += 1
        default:
            incompleteReceipt += 1
        }
    }

    var classifiedOperations: Int {
        historicallyConfirmed + uncertain + preparedOnly + incompleteReceipt
    }
}

/// A current authorized Photos count and historical Owner-bound receipt
/// counts are two different populations. Never divide one by the other to
/// display "N% backed up" or infer whole-library completion.
struct XDriveIOSNativePhotoCoverageSnapshot: Equatable {
    let localImages: Int
    let localVideos: Int
    let limitedAuthorization: Bool
    let historicLedger: XDriveIOSNativePhotoReceiptTally?
    let checkedAt: Date

    var currentAuthorizedMedia: Int { localImages + localVideos }
    var hasExistingLedger: Bool { historicLedger != nil }
    var wholeLibraryCompletionVerified: Bool { false }
}
