import XCTest

/// Actual native pages and child routes under a disposable CI synthetic Owner.
/// That Owner has NO authenticated Session. This tests real view mounting,
/// navigation, denial and process survival, not protected cloud content.
final class XDriveIOSAllNativePagesCrashSweepUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
    }

    private func launch(owner: Bool = true) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-xdrive-ui-navigation-smoke"]
        if owner { app.launchArguments.append("-xdrive-ui-navigation-synthetic-owner") }
        app.launch()
        XCTAssertEqual(app.state, .runningForeground, "Native process exited at launch")
        return app
    }

    private func element(_ id: String, _ app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func ready(_ id: String, _ app: XCUIApplication) {
        let target = element(id, app)
        if !target.waitForExistence(timeout: 18) { capture(app, "missing-" + id) }
        XCTAssertTrue(target.exists, "Native destination missing: " + id)
        XCTAssertEqual(app.state, .runningForeground, "Native process exited at " + id)
    }

    private func capture(_ app: XCUIApplication, _ stage: String) {
        guard app.state == .runningForeground else { return }
        let evidence = XCTAttachment(screenshot: app.screenshot())
        evidence.name = "all-native-pages-" + stage
        evidence.lifetime = .keepAlways
        add(evidence)
    }

    private func tap(_ id: String, _ app: XCUIApplication) {
        let target = element(id, app)
        if !target.waitForExistence(timeout: 15) { capture(app, "missing-action-" + id) }
        XCTAssertTrue(target.exists, "Native action missing: " + id)
        print("IOS_NATIVE_NAV_TAP_START route=" + id)
        target.tap()
        XCTAssertEqual(app.state, .runningForeground, "Native process exited after " + id)
    }

    private func tapNamed(_ title: String, _ app: XCUIApplication) {
        let target = app.buttons[title].firstMatch
        XCTAssertTrue(target.waitForExistence(timeout: 15), "Native button missing: " + title)
        XCTAssertTrue(target.isHittable, "Native button not reachable: " + title)
        print("IOS_NATIVE_NAV_TAP_START route=native-ios-child-action")
        target.tap()
        XCTAssertEqual(app.state, .runningForeground)
    }

    /// Reach a real lazy Launcher tile via its ScrollView. No coordinate
    /// guesses, invented credentials or fake destination view.
    private func openLauncher(_ route: String, _ app: XCUIApplication) {
        tap("native-ios-tab-launcher", app)
        ready("native-ios-launcher-search", app)
        let button = element("native-ios-launcher-" + route, app)
        let scroll = app.scrollViews.firstMatch
        XCTAssertTrue(scroll.waitForExistence(timeout: 15), "Launcher scroll missing")
        for _ in 0..<10 {
            if button.exists && button.isHittable { break }
            scroll.swipeUp()
        }
        if !(button.exists && button.isHittable) {
            for _ in 0..<10 {
                if button.exists && button.isHittable { break }
                scroll.swipeDown()
            }
        }
        XCTAssertTrue(button.exists && button.isHittable,
                      "Real Launcher route inaccessible: " + route)
        print("IOS_NATIVE_NAV_TAP_START route=native-ios-launcher-" + route)
        button.tap()
        XCTAssertEqual(app.state, .runningForeground)
    }

    private func filesHomeChild(_ id: String, page: String, _ app: XCUIApplication) {
        tap("native-ios-tab-files", app)
        ready("native-ios-files-section-browse", app)
        let home = app.collectionViews.firstMatch
        XCTAssertTrue(home.waitForExistence(timeout: 15), "Files Home not mounted")
        let target = element(id, app)
        for _ in 0..<10 {
            if target.exists && target.isHittable { break }
            home.swipeUp()
        }
        if !(target.exists && target.isHittable) {
            for _ in 0..<10 {
                if target.exists && target.isHittable { break }
                home.swipeDown()
            }
        }
        XCTAssertTrue(target.exists && target.isHittable, "Files Home child absent: " + id)
        print("IOS_NATIVE_NAV_TAP_START route=" + id)
        target.tap()
        ready(page, app)
    }

    func testLauncherPhotoDestinationsAndMapAcrossFilesDoNotExit() {
        let app = launch()
        let pages: [(String, String)] = [
            ("local", "native-ios-local-timeline-open"),
            ("albums", "native-ios-album-create"),
            ("cloud", "native-ios-server-gallery-search"),
            ("originals", "native-ios-cloud-original-layout-help"),
            ("map", "native-ios-map-source-selector")
        ]
        for (route, marker) in pages {
            openLauncher(route, app)
            ready(marker, app)
            tap("native-ios-tab-files", app)
            ready("native-ios-files-section-browse", app)
            XCTAssertEqual(app.state, .runningForeground)
        }
        capture(app, "photos-map-files")
    }

    func testLauncherToolDestinationsReturnWithoutExit() {
        let app = launch()
        let pages: [(String, String)] = [
            ("files", "native-ios-files-section-browse"),
            ("notes", "native-ios-notes-page"),
            ("clipboard", "ios-clipboard-draft"),
            ("backup", "native-ios-backup-overview"),
            ("transfers", "native-ios-transfer-overview")
        ]
        for (route, marker) in pages {
            openLauncher(route, app)
            ready(marker, app)
            tap("native-ios-tab-gallery", app)
            XCTAssertEqual(app.state, .runningForeground)
        }
        capture(app, "tools-gallery-return")
    }

    func testLauncherUnavailablePagesRemainExplicitAndSafe() {
        let app = launch(owner: false)
        let pages: [(String, String)] = [
            ("sync", "同步尚未接通"),
            ("storage", "存储尚未接通"),
            ("devices", "设备尚未接通"),
            ("diagnostics", "诊断尚未接通")
        ]
        for (route, message) in pages {
            openLauncher(route, app)
            XCTAssertTrue(app.staticTexts[message].firstMatch.waitForExistence(timeout: 15),
                          "Unavailable native page missing explicit placeholder: " + route)
            XCTAssertEqual(app.state, .runningForeground)
        }
        capture(app, "unavailable-pages")
    }

    func testFilesDeniedCloudTrashAndBackgroundReturnDoNotExit() {
        let app = launch()
        tap("native-ios-tab-files", app)
        for cycle in 0..<2 {
            tap("native-ios-files-open-root-location", app)
            ready("native-ios-files-error-page", app)
            XCTAssertFalse(element("native-ios-files-grid", app).exists)
            if cycle == 0 {
                XCUIDevice.shared.press(.home)
                app.activate()
                ready("native-ios-files-error-page", app)
            }
            tap("native-ios-files-error-return", app)
            ready("native-ios-files-section-browse", app)
            tap("native-ios-files-open-trash", app)
            ready("native-ios-files-trash-error-page", app)
            tap("native-ios-files-trash-error-return", app)
            ready("native-ios-files-section-browse", app)
            tap("native-ios-tab-gallery", app)
            tap("native-ios-tab-files", app)
            XCTAssertEqual(app.state, .runningForeground)
        }
        capture(app, "files-cloud-trash-foreground")
    }

    func testFilesSavedHistoryAndTagSheetsRetireAcrossTabs() {
        let app = launch()
        filesHomeChild("native-ios-files-open-saved-searches",
                       page: "native-ios-files-saved-searches-page", app)
        tap("native-ios-files-saved-searches-done", app)
        filesHomeChild("native-ios-files-open-operations",
                       page: "native-ios-files-operation-history-page", app)
        tap("native-ios-files-operation-history-done", app)
        filesHomeChild("native-ios-files-home-manage-tags",
                       page: "native-ios-files-tag-management", app)
        tapNamed("完成", app)
        tap("native-ios-tab-gallery", app)
        tap("native-ios-tab-files", app)
        ready("native-ios-files-section-browse", app)
        for id in ["native-ios-files-saved-searches-page",
                   "native-ios-files-operation-history-page",
                   "native-ios-files-tag-management"] {
            XCTAssertFalse(element(id, app).exists, "Stale Files child survived: " + id)
        }
        capture(app, "files-three-sheets-return")
    }

    func testGalleryPeopleFilterAndMapChildrenReturnDoNotExit() {
        let app = launch()
        tap("native-ios-gallery-people", app)
        ready("native-ios-gallery-people-page", app)
        let back = app.navigationBars.buttons.element(boundBy: 0)
        XCTAssertTrue(back.waitForExistence(timeout: 15))
        back.tap()
        tap("native-ios-gallery-open-filters", app)
        tap("native-ios-unified-gallery-show-map", app)
        ready("native-ios-map-source-selector", app)
        tap("native-ios-map-dismiss", app)
        ready("native-ios-unified-photo-gallery", app)
        XCUIDevice.shared.press(.home)
        app.activate()
        ready("native-ios-unified-photo-gallery", app)
        capture(app, "gallery-people-filter-map")
    }

    func testNotesSourceSwitchAndClipboardFileTabsDoNotExit() {
        let app = launch()
        openLauncher("notes", app)
        ready("native-ios-notes-source-picker", app)
        let picker = element("native-ios-notes-source-picker", app)
        for title in ["iOS 备份", "我的备忘录"] {
            let option = picker.buttons[title].firstMatch
            XCTAssertTrue(option.waitForExistence(timeout: 15))
            print("IOS_NATIVE_NAV_TAP_START route=native-ios-notes-source")
            option.tap()
            ready("native-ios-notes-page", app)
        }
        openLauncher("clipboard", app)
        ready("ios-clipboard-draft", app)
        tap("native-ios-tab-files", app)
        ready("native-ios-files-section-browse", app)
        XCUIDevice.shared.press(.home)
        app.activate()
        ready("native-ios-files-section-browse", app)
        capture(app, "notes-clipboard-files")
    }

    func testClipboardDeniedReceiverAndTransfersReturnDoNotExit() {
        let app = launch()
        openLauncher("clipboard", app)
        tapNamed("启用本机设备定向接收", app)
        ready("ios-clipboard-status", app)
        XCTAssertFalse(app.staticTexts["设备定向接收已启用"].firstMatch.exists,
                       "Synthetic Owner cannot obtain a receiver grant")
        openLauncher("transfers", app)
        ready("native-ios-transfer-overview", app)
        openLauncher("clipboard", app)
        ready("ios-clipboard-draft", app)
        XCTAssertFalse(app.staticTexts["设备定向接收已启用"].firstMatch.exists)
        capture(app, "clipboard-denial-transfers")
    }

    func testBackupAuditQueueAndFilesReturnDoNotExit() {
        let app = launch()
        openLauncher("backup", app)
        tapNamed("逐项核验当前云端原件", app)
        ready("native-ios-backup-portrait-form", app)
        XCUIDevice.shared.press(.home)
        app.activate()
        ready("native-ios-backup-portrait-form", app)
        tapNamed("返回相册备份", app)
        ready("native-ios-backup-overview", app)
        tap("native-ios-photos-task-list", app)
        tap("native-ios-photo-task-list-done", app)
        ready("native-ios-backup-overview", app)
        tap("native-ios-tab-files", app)
        ready("native-ios-files-section-browse", app)
        capture(app, "backup-audit-queue-files")
    }

    func testMineSignedOutControlsAndGalleryReturnDoNotExit() {
        let app = launch(owner: false)
        tap("native-ios-tab-mine", app)
        ready("native-ios-mine-server-account", app)
        XCTAssertTrue(app.staticTexts["尚未登录"].firstMatch.waitForExistence(timeout: 15))
        XCTAssertFalse(element("native-ios-mine-server-account", app).isEnabled)
        tap("native-ios-tab-gallery", app)
        ready("native-ios-unified-photo-gallery", app)
        tap("native-ios-tab-files", app)
        ready("native-ios-files-section-browse", app)
        capture(app, "mine-signed-out-gallery-files")
    }
}
