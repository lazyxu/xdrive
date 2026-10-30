import Foundation

@main
struct XDriveIOSNativeFocusVisibilityPolicyChecks {
    static func main() {
        func verify(_ tab: String, _ source: String,
                    _ focused: Bool, _ owner: Bool, _ expected: Bool) {
            let actual = XDriveIOSNativeFocusVisibilityPolicy.showsBar(
                tab: tab, gallerySource: source, focused: focused, ownerVerified: owner)
            precondition(actual == expected, "Incorrect iOS bottom bar visibility")
        }

        verify("gallery", "cloud", false, true, true)
        verify("gallery", "cloud", true, true, false)
        verify("gallery", "cloud", true, false, true)
        verify("gallery", "originals", true, true, true)
        verify("gallery", "albums", true, true, true)
        verify("gallery", "local", true, true, true)
        verify("gallery", "map", true, true, false)
        verify("gallery", "map", false, true, true)
        verify("files", "cloud", true, true, true)
        verify("dynamic", "cloud", true, true, true)
        // Rotation is intentionally not an input and must not change L2.
        verify("gallery", "cloud", true, true, false)
        print("native iOS L2 focus visibility: PASS")
    }
}
