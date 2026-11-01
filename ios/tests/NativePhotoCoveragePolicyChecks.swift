import Foundation

@main
struct NativePhotoCoveragePolicyChecks {
    static func main() {
        var tally = XDriveIOSNativePhotoReceiptTally()
        tally.include(state: "confirmed", hasVerifiedReceipt: true)
        tally.include(state: "confirmed", hasVerifiedReceipt: false)
        tally.include(state: "creating", hasVerifiedReceipt: false)
        tally.include(state: "uploading", hasVerifiedReceipt: true)
        tally.include(state: "finalizing", hasVerifiedReceipt: false)
        tally.include(state: "needsReconciliation", hasVerifiedReceipt: false)
        tally.include(state: "prepared", hasVerifiedReceipt: false)
        tally.include(state: "unknown", hasVerifiedReceipt: true)
        precondition(tally.totalOperations == 8)
        precondition(tally.historicallyConfirmed == 1)
        precondition(tally.uncertain == 4)
        precondition(tally.preparedOnly == 1)
        precondition(tally.incompleteReceipt == 2)
        precondition(tally.classifiedOperations == tally.totalOperations)

        let snapshot = XDriveIOSNativePhotoCoverageSnapshot(
            localImages: 2, localVideos: 3,
            limitedAuthorization: false, historicLedger: tally,
            checkedAt: Date(timeIntervalSince1970: 0)
        )
        precondition(snapshot.currentAuthorizedMedia == 5)
        precondition(snapshot.hasExistingLedger)
        precondition(!snapshot.wholeLibraryCompletionVerified)
        // Even a number of historical receipts exactly equal to the current
        // PhotoKit asset count is NOT proof of current Owner cloud coverage.
        var equalTally = XDriveIOSNativePhotoReceiptTally()
        for _ in 0..<5 {
            equalTally.include(state: "confirmed", hasVerifiedReceipt: true)
        }
        let looksComplete = XDriveIOSNativePhotoCoverageSnapshot(
            localImages: 5, localVideos: 0,
            limitedAuthorization: true, historicLedger: equalTally,
            checkedAt: Date()
        )
        precondition(looksComplete.currentAuthorizedMedia == 5)
        precondition(looksComplete.historicLedger?.historicallyConfirmed == 5)
        precondition(!looksComplete.wholeLibraryCompletionVerified)
        let missing = XDriveIOSNativePhotoCoverageSnapshot(
            localImages: 0, localVideos: 0,
            limitedAuthorization: false, historicLedger: nil,
            checkedAt: Date()
        )
        precondition(!missing.hasExistingLedger)
        precondition(!missing.wholeLibraryCompletionVerified)
        print("Native Photos read-only historical receipt vs whole-library policy: PASS")
    }
}
