import Foundation

/// L2 is a feature-owned intent, not an orientation change. The custom native
/// five-slot bar disappears for a focused native PhotoKit map even while signed
/// out (local Photos authority does NOT depend on Server Owner login). A cloud
/// Gallery focus still requires a verified Owner; Files/backup are unaffected.
enum XDriveIOSNativeFocusVisibilityPolicy {
    static func showsBar(
        tab: String, gallerySource: String, focused: Bool, ownerVerified: Bool
    ) -> Bool {
        // Photos on iOS 26 keeps Library / Collections / Search visible
        // over the Map. Only an Owner-verified cloud L2 focus hides L1.
        if tab == "gallery" && gallerySource == "map" { return true }
        return !(tab == "gallery" && focused &&
                 gallerySource == "cloud" && ownerVerified)
    }

    /// A departed Gallery child cannot set the current source's L2 focus.
    /// Source changes and non-Gallery tabs always reject the old event, even
    /// if its delayed value is false (which would override new L2 focus).
    static func acceptsFocusUpdate(
        tab: String, gallerySource: String, callbackSource: String,
        ownerVerified: Bool
    ) -> Bool {
        tab == "gallery" && gallerySource == callbackSource &&
            (callbackSource == "map" ||
             (callbackSource == "cloud" && ownerVerified))
    }
}
