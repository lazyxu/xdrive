import Foundation

@main
struct XDriveIOSPhotoBackupDestinationCursorPolicyChecks {
    static func main() {
        typealias P = XDriveIOSPhotoBackupDestinationCursorPolicy
        let match: (UInt64?, UInt64?, UInt64, UInt64, UInt64) -> Bool = {
            P.sameManagedTarget(savedSourceID: $0, savedTargetNodeID: $1,
                                currentSourceID: $2, currentTargetNodeID: $3,
                                ownerRootNodeID: $4)
        }
        precondition(match(10, 42, 10, 42, 1))
        precondition(!match(nil, nil, 10, 42, 1))
        precondition(!match(10, nil, 10, 42, 1))
        precondition(!match(nil, 42, 10, 42, 1))
        precondition(!match(10, 42, 11, 42, 1))
        precondition(!match(10, 42, 10, 43, 1))
        precondition(!match(10, 42, 10, 1, 1))
        precondition(!match(10, 42, 10, 0, 1))
        precondition(!match(10, 42, 0, 42, 1))
        precondition(!match(10, 42, 10, 42, 0))
        print("PASS: iOS backup cursor never crosses managed Source/Node boundaries")
    }
}
