import XCTest

/// Exercises the real native Dashboard, Launcher and child pages in an iPhone
/// Simulator. The synthetic Owner has NO authenticated Server session; this
/// checks fail-closed routing and process survival, not signed-device media.
final class XDriveIOSAllPagesCrashUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    private func launch(offlineOwner: Bool = true) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-xdrive-ui-navigation-smoke"]
        if offlineOwner {
            app.launchArguments.append("-xdrive-ui-navigation-synthetic-owner")
        }
        app.launch()
        XCTAssertEqual(app.state, .runningForeground, "Process exited on native startup")
        return app
    }

    private func element(_ id: String, app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func capture(_ app: XCUIApplication, _ stage: String) {
        print("IOS_ALL_PAGES_CRASH stage=\(stage) appState=\(app.state.rawValue)")
        guard app.state == .runningForeground else { return }
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "all-pages-\(stage)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func ready(_ id: String, app: XCUIApplication) {
        let item = element(id, app: app)
        if !item.waitForExistence(timeout: 18) {
            capture(app, "missing-\(id)")
        }
        XCTAssertTrue(item.exists, "Actual native child page missing: \(id)")
        XCTAssertEqual(app.state, .runningForeground, "Process exited at \(id)")
    }

    private func tap(_ id: String, app: XCUIApplication) {
        let target = element(id, app: app)
        if !target.waitForExistence(timeout: 15) {
            capture(app, "untappable-\(id)")
        }
        XCTAssertTrue(target.exists, "Native action is missing: \(id)")
        print("IOS_NATIVE_NAV_TAP_START route=\(id)")
        target.tap()
        XCTAssertEqual(app.state, .runningForeground, "Process exited after tapping \(id)")
    }

    /// The Launcher is a genuinely lazy scrollable grid. Do not replace a
    /// missing route with a coordinate tap or a fake authenticated Owner.
    private func openLauncher(_ route: String, app: XCUIApplication) {
        tap("native-ios-tab-launcher", app: app)
        ready("native-ios-launcher-search", app: app)
        let host = app.scrollViews.firstMatch
        XCTAssertTrue(host.waitForExistence(timeout: 15), "Real Launcher scroll host missing")
        let identifier = "native-ios-launcher-\(route)"
        let target = element(identifier, app: app)
        for _ in 0..<8 {
            if target.exists && target.isHittable { break }
            host.swipeUp()
        }
        if !target.exists || !target.isHittable {
            for _ in 0..<8 {
                if target.exists && target.isHittable { break }
                host.swipeDown()
            }
        }
        XCTAssertTrue(target.exists && target.isHittable,
                      "Launcher entry cannot be reached through the real grid: \(route)")
        tap(identifier, app: app)
    }

    private func verifyLauncher(
        _ route: String, marker: String? = nil, title: String? = nil,
        placeholder: String? = nil, offlineOwner: Bool = true
    ) {
        let app = launch(offlineOwner: offlineOwner)
        openLauncher(route, app: app)
        if let marker {
            ready(marker, app: app)
        } else if let title {
            let bar = app.navigationBars[title].firstMatch
            XCTAssertTrue(bar.waitForExistence(timeout: 18),
                          "Real native tool navigation bar missing: \(title)")
        } else if let placeholder {
            let text = app.staticTexts[placeholder].firstMatch
            XCTAssertTrue(text.waitForExistence(timeout: 18),
                          "Expected unimplemented native page, not an invented data screen: \(route)")
        } else {
            XCTFail("Every Launcher entry must prove its actual destination")
        }
        capture(app, "launcher-\(route)")
        XCTAssertEqual(app.state, .runningForeground)
    }

    // Every implemented Launcher route is an independent XCTest: a failure
    // on one page cannot silently skip the remaining route cases.
    func testLauncherLocalPageDoesNotCrash() {
        verifyLauncher("local", marker: "native-ios-local-timeline-open", offlineOwner: false)
    }
    func testLauncherAlbumsPageDoesNotCrash() {
        verifyLauncher("albums", marker: "native-ios-album-create", offlineOwner: false)
    }
    func testLauncherCloudPageDoesNotCrash() {
        verifyLauncher("cloud", marker: "native-ios-server-gallery-search")
    }
    func testLauncherOriginalsPageDoesNotCrash() {
        verifyLauncher("originals", marker: "native-ios-cloud-original-layout-help")
    }
    func testLauncherMapPageDoesNotCrash() {
        verifyLauncher("map", marker: "native-ios-map-source-selector", offlineOwner: false)
    }
    func testLauncherFilesPageDoesNotCrash() {
        verifyLauncher("files", marker: "native-ios-files-section-browse")
    }
    func testLauncherNotesPageDoesNotCrash() {
        verifyLauncher("notes", title: "笔记")
    }
    func testLauncherClipboardPageDoesNotCrash() {
        verifyLauncher("clipboard", marker: "ios-clipboard-draft")
    }
    func testLauncherBackupPageDoesNotCrash() {
        verifyLauncher("backup", marker: "native-ios-backup-overview")
    }
    func testLauncherTransfersPageDoesNotCrash() {
        verifyLauncher("transfers", marker: "native-ios-transfer-overview")
    }

    // The remaining four Launcher entries intentionally show actual, safe
    // placeholder pages. They are NOT counted as implemented functionality.
    func testLauncherSyncPlaceholderDoesNotCrash() {
        verifyLauncher("sync", placeholder: "同步尚未接通")
    }
    func testLauncherStoragePlaceholderDoesNotCrash() {
        verifyLauncher("storage", placeholder: "存储尚未接通")
    }
    func testLauncherDevicesPlaceholderDoesNotCrash() {
        verifyLauncher("devices", placeholder: "设备尚未接通")
    }
    func testLauncherDiagnosticsPlaceholderDoesNotCrash() {
        verifyLauncher("diagnostics", placeholder: "诊断尚未接通")
    }

    func testFiveTabsWithForegroundReturnDoNotCrash() {
        let app = launch()
        let destinations: [(String, String)] = [
            ("launcher", "native-ios-launcher-search"),
            ("gallery", "native-ios-unified-photo-gallery"),
            ("files", "native-ios-files-section-browse"),
            ("mine", "native-ios-mine-server-account")
        ]
        for cycle in 0..<3 {
            for (tab, marker) in destinations {
                tap("native-ios-tab-\(tab)", app: app)
                ready(marker, app: app)
            }
            tap("native-ios-tab-dynamic", app: app)
            let map = app.descendants(matching: .any).matching(
                identifier: "native-ios-map-source-selector"
            ).firstMatch
            XCTAssertTrue(map.waitForExistence(timeout: 12),
                          "Dynamic tab did not mount the actual native MapKit route")
            XCUIDevice.shared.press(.home)
            app.activate()
            XCTAssertEqual(app.state, .runningForeground, "Failed to resume dynamic tab")
            capture(app, "five-tabs-cycle-\(cycle)")
        }
    }

    func testDynamicRecentPickerSwitchAndDismissDoesNotCrash() {
        let app = launch()
        openLauncher("notes", app: app)
        XCTAssertTrue(app.navigationBars["笔记"].firstMatch.waitForExistence(timeout: 15))
        let recent = app.buttons["最近功能"].firstMatch
        XCTAssertTrue(recent.waitForExistence(timeout: 15))
        print("IOS_NATIVE_NAV_TAP_START route=native-ios-dynamic-recent")
        recent.tap()
        XCTAssertTrue(app.navigationBars["最近功能"].firstMatch.waitForExistence(timeout: 15))
        capture(app, "recent-sheet-open")
        let done = app.buttons["完成"].firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 15))
        done.tap()
        XCTAssertTrue(app.navigationBars["笔记"].firstMatch.waitForExistence(timeout: 15))
        openLauncher("clipboard", app: app)
        ready("ios-clipboard-draft", app: app)
        XCTAssertTrue(recent.waitForExistence(timeout: 15))
        recent.tap()
        XCTAssertTrue(app.navigationBars["最近功能"].firstMatch.waitForExistence(timeout: 15))
        let notes = app.buttons["笔记"].firstMatch
        XCTAssertTrue(notes.waitForExistence(timeout: 15))
        notes.tap()
        XCTAssertTrue(app.navigationBars["笔记"].firstMatch.waitForExistence(timeout: 15))
        capture(app, "recent-sheet-switch-to-notes")
    }

    func testFilesDeniedThenNotesClipboardTransfersDoesNotCrash() {
        let app = launch()
        openLauncher("files", app: app)
        tap("native-ios-files-open-root-location", app: app)
        ready("native-ios-files-error-page", app: app)
        capture(app, "denied-files-child")
        tap("native-ios-files-error-return", app: app)
        ready("native-ios-files-section-browse", app: app)

        openLauncher("notes", app: app)
        XCTAssertTrue(app.navigationBars["笔记"].firstMatch.waitForExistence(timeout: 15))
        openLauncher("clipboard", app: app)
        ready("ios-clipboard-draft", app: app)
        openLauncher("transfers", app: app)
        ready("native-ios-transfer-overview", app: app)
        openLauncher("files", app: app)
        ready("native-ios-files-section-browse", app: app)
        XCTAssertFalse(element("native-ios-files-error-page", app: app).exists,
                       "Denied Files child survived across unrelated native pages")
        capture(app, "files-tools-return")
    }

    func testSignedOutMineOwnerControlsFailClosedWithoutCrash() {
        let app = launch(offlineOwner: false)
        tap("native-ios-tab-mine", app: app)
        ready("native-ios-mine-server-account", app: app)
        XCTAssertTrue(app.staticTexts["尚未登录"].firstMatch.waitForExistence(timeout: 12))
        let signOut = element("native-ios-mine-server-account", app: app)
        XCTAssertFalse(signOut.isEnabled,
                       "Signed-out Mine may not offer an executable Owner logout")
        capture(app, "mine-signed-out")
        tap("native-ios-tab-gallery", app: app)
        ready("native-ios-unified-photo-gallery", app: app)
    }

    func testToolPagesBackgroundAndRotationDoNotCrash() {
        let app = launch()
        let device = XCUIDevice.shared
        defer { device.orientation = .portrait }
        openLauncher("notes", app: app)
        XCTAssertTrue(app.navigationBars["笔记"].firstMatch.waitForExistence(timeout: 15))
        device.orientation = .landscapeLeft
        XCTAssertEqual(app.state, .runningForeground)
        device.orientation = .portrait
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(app.navigationBars["笔记"].firstMatch.waitForExistence(timeout: 15))

        openLauncher("clipboard", app: app)
        ready("ios-clipboard-draft", app: app)
        XCUIDevice.shared.press(.home)
        app.activate()
        ready("ios-clipboard-draft", app: app)

        openLauncher("backup", app: app)
        ready("native-ios-backup-overview", app: app)
        openLauncher("transfers", app: app)
        ready("native-ios-transfer-overview", app: app)
        capture(app, "tools-background-rotation")
    }
}
