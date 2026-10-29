import SwiftUI

@main
struct XDriveIOSApp: App {
    init() {
        // Retire only the obsolete second-login refresh credential.
        // The shared PWA cookie, photo intent ledger and iPhone Device
        // enrollment are separate and remain untouched.
        XDriveIOSRetiredNativeLogin.purgeLegacyRefreshToken()
    }

    var body: some Scene {
        WindowGroup {
            XDriveWebAppHome()
        }
    }
}
