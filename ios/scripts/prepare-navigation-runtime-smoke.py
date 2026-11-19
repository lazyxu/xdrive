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
key = "            XDriveIOSNativeStartupRoot(interruptedStage: interruptedStage)"
if s.count(key) != 1:
    raise SystemExit("Unexpected iOS App entry; test harness must be audited")
# Historical c83 source has XDriveIOSNativeOwnerLoginScreen() only; the
# modern signed-out view explicitly supports safeStartup. The historical
# navigation baseline must compile against its REAL initializer, not the
# candidate's newer API. Do not insert the compact-login launch route into
# historical sources: only current candidates execute that new XCTest.
screen = root / "ios/XDriveIOS/NativeOwnerLoginScreen.swift"
login_view = screen.read_text()
supports_compact_login = "    var safeStartup = false" in login_view
if supports_compact_login:
    compact_entry = """            if ProcessInfo.processInfo.arguments.contains("-xdrive-ui-login-compact-smoke") {
                // Test the real native signed-out form without restoring
                // credentials, injecting an Owner, or starting auto backup.
                XDriveIOSNativeOwnerLoginScreen(safeStartup: true)
            } else """
else:
    # Historical c83 is an informational Gallery/Files navigation baseline.
    # The compact login XCTest is never selected on that historical source.
    # Do not weaken this guard into a catch-all initializer fallback.
    compact_entry = "            "
s = s.replace(key, """#if DEBUG
""" + compact_entry + """if ProcessInfo.processInfo.arguments.contains("-xdrive-ui-navigation-smoke") {
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
            } else if ProcessInfo.processInfo.arguments.contains("-xdrive-ui-files-viewer-no-session") {
                // Debug-only real Viewer graph, mounted with a synthetic Owner
                // but deliberately no login Session, bearer, private rows, or
                // media. This exercises UI lifetime, NOT authenticated preview.
                if let owner = login.owner {
                    XDriveIOSNativeFilesViewerNoSessionSmoke(login: login, owner: owner)
                } else {
                    ProgressView("正在准备无会话 Viewer 回归…")
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

/// A CI-only fail-closed lifecycle fixture; never exists in release source.
/// Nodes are synthetic metadata only and no bearer/Server is provisioned.
@MainActor
private struct XDriveIOSNativeFilesViewerNoSessionSmoke: View {
    @ObservedObject var login: XDriveIOSNativeOwnerLoginModel
    let owner: XDriveNativeOwnerRoot
    @State private var selected: XDriveIOSNativeFilesNode?

    private func open(_ kind: String, name: String, nodeID: UInt64) -> some View {
        Button("打开 " + kind + " 预览") {
            selected = XDriveIOSNativeFilesNode(
                id: nodeID, parent_id: owner.rootNodeID, name: name,
                type: "file", size: 4096, revision: 1
            )
        }
        .accessibilityIdentifier("native-ios-files-viewer-smoke-" + kind)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                open("image", name: "smoke.jpg", nodeID: 1001)
                open("video", name: "smoke.mp4", nodeID: 1002)
                open("pdf", name: "smoke.pdf", nodeID: 1003)
                open("audio", name: "smoke.mp3", nodeID: 1004)
                open("text", name: "smoke.txt", nodeID: 1005)
            }
            .padding(24)
            .navigationTitle("文件 Viewer 回归")
            .accessibilityIdentifier("native-ios-files-viewer-smoke-root")
        }
        .fullScreenCover(item: $selected) { node in
            XDriveIOSNativeFilesViewer(
                initial: node, loadedItems: [node],
                openedOwner: owner, login: login,
                onNavigate: { _ in false }
            )
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
