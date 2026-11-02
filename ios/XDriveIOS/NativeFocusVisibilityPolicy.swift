import Foundation

/// L2 is a feature-owned intent, not an orientation change. The custom native
/// five-slot bar disappears only for the verified Owner's Gallery PhotoAsset
/// focus, never while Files/backup or a different Gallery source is active.
enum XDriveIOSNativeFocusVisibilityPolicy {
    static func showsBar(
        tab: String, gallerySource: String, focused: Bool, ownerVerified: Bool
    ) -> Bool {
        !(ownerVerified && tab == "gallery" &&
          (gallerySource == "cloud" || gallerySource == "map") && focused)
    }

    /// A departed Gallery child cannot set the current source's L2 focus.
    /// Source changes and non-Gallery tabs always reject the old event, even
    /// if its delayed value is false (which would override new L2 focus).
    static func acceptsFocusUpdate(
        tab: String, gallerySource: String, callbackSource: String,
        ownerVerified: Bool
    ) -> Bool {
        ownerVerified && tab == "gallery" && gallerySource == callbackSource &&
            (callbackSource == "cloud" || callbackSource == "map")
    }
}
