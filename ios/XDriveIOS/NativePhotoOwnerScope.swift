import Foundation

/// Root revision is mutable after writes. Identity comparisons for ongoing
/// native Photos work must fence Server/Owner/root, NOT root revision.
enum XDriveIOSNativePhotoOwnerScope {
    static func matches(_ current: XDriveNativeOwnerRoot?,
                        _ expected: XDriveNativeOwnerRoot) -> Bool {
        guard let current else { return false }
        return current.origin == expected.origin &&
            current.instanceID == expected.instanceID &&
            current.ownerID == expected.ownerID &&
            current.username == expected.username &&
            current.rootNodeID == expected.rootNodeID
    }
}
