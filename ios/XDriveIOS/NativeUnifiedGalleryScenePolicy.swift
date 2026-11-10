import Foundation

/// Keep an already verified bounded Gallery window across an unchanged scene
/// return. Permission or PhotoKit snapshot changes invalidate the old pixels;
/// Owner changes have their own immediate invalidation in the native Gallery.
enum XDriveIOSUnifiedGalleryScenePolicy {
    static func requiresResetOnReturn(
        permissionChanged: Bool,
        localAccessGranted: Bool,
        hasEpoch: Bool,
        epochCurrent: Bool
    ) -> Bool {
        if permissionChanged { return true }
        // A consistently denied/unrequested PhotoKit grant has no local media
        // to reconcile. A cloud-only or signed-out wall may remain mounted.
        if !localAccessGranted { return false }
        // An authorized local library may only reuse a verified current epoch.
        return !hasEpoch || !epochCurrent
    }
}
