import Foundation

@main enum XDriveIOSNativePhotoTaskStatusPolicyChecks {
    static func main() {
        let p = XDriveIOSNativePhotoTaskStatusPolicy.self
        func state(_ row: String, id: String = "a",
                   pageVerified: Bool = false, owner: Bool = true,
                   busy: Bool = false, active: String? = nil,
                   uncertain: Bool = false) -> String {
            p.displayedState(
                rowState: row, rowID: id, currentPageVerified: pageVerified,
                currentOwnerMatched: owner, uploadBusy: busy,
                activeLocalIdentifier: active,
                stoppedForUnknownReceipt: uncertain
            )
        }
        precondition(state("pending") == "pending")
        precondition(state("waitingICloud") == "waitingICloud")
        precondition(state("failed") == "failed")
        precondition(state("confirmed") == "confirmed") // Historical only
        precondition(state("unverified", pageVerified: true) == "matched")
        precondition(state("pending", busy: true, active: "a") == "processing")
        precondition(state("confirmed", busy: true, active: "a") == "processing")
        precondition(state("pending", busy: true, active: "b") == "pending")
        precondition(state("pending", owner: false, busy: true, active: "a") == "pending")
        precondition(state("pending", active: "a", uncertain: true) == "needsReconciliation")
        precondition(state("confirmed", busy: true, active: "a", uncertain: true) == "needsReconciliation")
        precondition(state("pending", busy: false, active: "a") == "pending")
        precondition(state("pending", owner: false, active: "a", uncertain: true) == "pending")
        precondition(state("pending", id: "", busy: true, active: "") == "pending")
        print("iOS Photo task Owner-safe processing / unknown-ACK status: PASS")
    }
}
