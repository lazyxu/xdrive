import Foundation

/// A PhotoKit positional checkpoint is valid only for the same
/// Server-provisioned iPhone Source/Node, not merely the same Owner root.
/// Historical Owner-root or missing IDs must restart at window zero.
enum XDriveIOSPhotoBackupDestinationCursorPolicy {
    static func sameManagedTarget(
        savedSourceID: UInt64?, savedTargetNodeID: UInt64?,
        currentSourceID: UInt64, currentTargetNodeID: UInt64,
        ownerRootNodeID: UInt64
    ) -> Bool {
        currentSourceID > 0 && currentTargetNodeID > 0 &&
            ownerRootNodeID > 0 &&
            currentTargetNodeID != ownerRootNodeID &&
            savedSourceID == currentSourceID &&
            savedTargetNodeID == currentTargetNodeID
    }
}
