import SwiftUI

@main
struct XDriveIOSApp: App {
    init() {
        // Retire ONLY the obsolete second-login refresh credential. Native
        // Owner v2, PhotoKit source journal and BG grants are separate.
        XDriveIOSRetiredNativeLogin.purgeLegacyRefreshToken()
        XDriveIOSBackgroundPhotoTask.registerAtLaunch()
    }

    var body: some Scene {
        WindowGroup {
            // Native SwiftUI is the entry for the Photos backup/view MVP.
            // The old WebView source remains available for rollback only.
            XDriveIOSNativeOwnerLoginScreen()
        }
    }
}
