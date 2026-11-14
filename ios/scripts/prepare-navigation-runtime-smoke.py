#!/usr/bin/env python3
"""Instrument an isolated CI checkout only; never mutate release source."""
from pathlib import Path
import sys
root = Path(sys.argv[1]).resolve()
app = root / "ios/XDriveIOS/XDriveIOSApp.swift"
project = root / "ios/project.yml"
s = app.read_text()
# In this disposable CI worktree only, permit a synthetic Owner for UI testing.
# The model's authenticated Session remains absent: protected requests fail
# closed, and no credentials, upload grants or endpoints are invented.
login = root / "ios/XDriveIOS/NativeOwnerLoginModel.swift"
login_source = login.read_text()
owner_needle = "@Published private(set) var owner: XDriveNativeOwnerRoot?"
if login_source.count(owner_needle) != 1:
    raise SystemExit("Cannot prepare scoped synthetic Owner smoke harness")
login.write_text(login_source.replace(owner_needle, "@Published var owner: XDriveNativeOwnerRoot?"))
# Original b9 and the new diagnostic recovery root have different,
# explicitly whitelisted parameter labels. Unknown app entrypoints fail closed.
entrypoints = (
    "            XDriveIOSNativeStartupRoot(interruptedStage: interruptedStage)",
    "            XDriveIOSNativeStartupRoot(interruption: interruption)",
)
matches = [entry for entry in entrypoints if s.count(entry) == 1]
if len(matches) != 1 or sum(s.count(entry) for entry in entrypoints) != 1:
    raise SystemExit("Unexpected iOS App entry; test harness must be audited")
key = matches[0]
fixture = """#if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-xdrive-ui-navigation-smoke") {
                XDriveIOSNativeNavigationSmokeRoot()
            } else {
""" + key + """
            }
#else
""" + key + """
#endif"""
s = s.replace(key, fixture)
s += """
#if DEBUG
/// Simulator fixture mounts real native Files/Gallery with no saved Owner.
@MainActor
private struct XDriveIOSNativeNavigationSmokeRoot: View {
    @StateObject private var login = XDriveIOSNativeOwnerLoginModel()
    @StateObject private var backup = XDriveIOSNativePhotoBackupController()
    @State private var backupLaunchNonce = UUID()
    var body: some View {
        Group {
            if ProcessInfo.processInfo.arguments.contains("-xdrive-ui-photo-backup-direct") {
                // CI-only real Backup UI; no synthetic upload receipts, Server
                // tokens, PhotoKit authorization or modified production build.
                NavigationStack {
                    XDriveIOSNativePhotoBackupScreen(
                        login: login, controller: backup,
                        launchNonce: backupLaunchNonce,
                        onShowCloudOriginals: {}
                    )
                }
            } else if ProcessInfo.processInfo.arguments.contains("-xdrive-ui-files-direct") {
                NavigationStack {
                    XDriveIOSNativeFilesBrowser(login: login)
                        .navigationTitle("文件")
                }
            } else {
                XDriveIOSNativePhotosDashboard(
                    login: login, backup: backup, signingOut: false,
                    logoutWarning: nil, onSignOut: { _ in }
                )
            }
        }
        .onAppear {
            if ProcessInfo.processInfo.arguments.contains("-xdrive-ui-navigation-synthetic-owner") {
                // Deliberately no active Session/token: real transport stays
                // authorization-denied even though Owner-only UI can mount.
                login.owner = XDriveNativeOwnerRoot(
                    origin: URL(string: "https://simulator-owner.invalid")!,
                    instanceID: "smoke-only", ownerID: 7,
                    username: "simulator", rootNodeID: 9, rootRevision: 1
                )
            }
        }
    }
}
#endif
"""
# Historical c83/b9 sources must compile using their ACTUAL Backup screen
# initializer. Only current candidates have the explicit launchNonce API.
# This adapts a disposable test harness; it does not rewrite release code.
backup_api = (root / "ios/XDriveIOS/NativePhotoBackupScreen.swift").read_text()
if "var launchNonce:" not in backup_api:
    old_argument = "                        launchNonce: backupLaunchNonce,\n"
    if s.count(old_argument) != 1:
        raise SystemExit("Unexpected historical Backup constructor")
    s = s.replace(old_argument, "")
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
