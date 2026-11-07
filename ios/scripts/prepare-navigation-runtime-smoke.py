#!/usr/bin/env python3
"""Instrument an isolated CI checkout only; never mutate release source."""
from pathlib import Path
import sys
root = Path(sys.argv[1]).resolve()
app = root / "ios/XDriveIOS/XDriveIOSApp.swift"
project = root / "ios/project.yml"
s = app.read_text()
key = "            XDriveIOSNativeStartupRoot(interruptedStage: interruptedStage)"
if s.count(key) != 1:
    raise SystemExit("Unexpected iOS App entry; test harness must be audited")
s = s.replace(key, """#if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-xdrive-ui-navigation-smoke") {
                XDriveIOSNativeNavigationSmokeRoot()
            } else {
                XDriveIOSNativeStartupRoot(interruptedStage: interruptedStage)
            }
#else
            XDriveIOSNativeStartupRoot(interruptedStage: interruptedStage)
#endif""")
s += """
#if DEBUG
/// Simulator fixture mounts real native Files/Gallery with no saved Owner.
@MainActor
private struct XDriveIOSNativeNavigationSmokeRoot: View {
    @StateObject private var login = XDriveIOSNativeOwnerLoginModel()
    @StateObject private var backup = XDriveIOSNativePhotoBackupController()
    var body: some View {
        XDriveIOSNativePhotosDashboard(
            login: login, backup: backup, signingOut: false,
            logoutWarning: nil, onSignOut: { _ in }
        )
    }
}
#endif
"""
app.write_text(s)
spec = project.read_text()
if "xDriveIOSNavigationUITests" in spec or "\nschemes:" in spec:
    raise SystemExit("Unexpected XcodeGen scheme; audit needed")
spec += """
  xDriveIOSNavigationUITests:
    type: bundle.ui-testing
    platform: iOS
    sources:
      - path: UITests
    dependencies:
      - target: xDriveIOS
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: com.lazyxu.xdrive.ios.navigation-uitests
schemes:
  xDriveIOS:
    build:
      targets:
        xDriveIOS: all
        xDriveIOSNavigationUITests: [test]
    test:
      targets:
        - xDriveIOSNavigationUITests
"""
project.write_text(spec)
print("CI-only native navigation smoke harness:", root)
