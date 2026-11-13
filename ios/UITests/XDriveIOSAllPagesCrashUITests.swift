import XCTest

/// Exercises the real native Dashboard, Launcher and child pages in an iPhone
/// Simulator. The synthetic Owner has NO authenticated Server session; this
/// checks fail-closed routing and process survival, not signed-device media.
final class XDriveIOSAllPagesCrashUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        // A previous crash or interrupted landscape journey must not leave
        // unrelated page cases testing a retained orientation by accident.
        XCUIDevice.shared.orientation = .portrait
    }

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
        let host = element("native-ios-launcher-scroll", app: app)
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
        // The unassigned Dynamic slot opens the *real Gallery Map source*.
        // Returning to Gallery retains MapKit until the user explicitly
        // closes it; requiring Unified immediately after a map shortcut is
        // a stale test assumption, not a proven native crash.
        var mapOpenedByDynamic = false
        for cycle in 0..<3 {
            for (tab, marker) in destinations {
                tap("native-ios-tab-\(tab)", app: app)
                if tab == "gallery" && mapOpenedByDynamic {
                    ready("native-ios-map-source-selector", app: app)
                    let localClose = element("native-ios-map-dismiss", app: app)
                    let cloudClose = element("native-ios-map-close", app: app)
                    if localClose.exists && localClose.isHittable {
                        tap("native-ios-map-dismiss", app: app)
                    } else if cloudClose.exists && cloudClose.isHittable {
                        tap("native-ios-map-close", app: app)
                    } else {
                        capture(app, "map-return-without-close-\(cycle)")
                        XCTFail("Real MapKit Gallery source lost its Done action")
                    }
                    ready("native-ios-unified-photo-gallery", app: app)
                    mapOpenedByDynamic = false
                } else {
                    ready(marker, app: app)
                }
            }
            tap("native-ios-tab-dynamic", app: app)
            // The dynamic slot can also restore a chosen Notes/Clipboard/
            // Backup/Transfers feature. Demand an actual native destination,
            // never a fictitious success in a hidden Gallery.
            let eligible: [XCUIElement] = [
                element("native-ios-map-source-selector", app: app),
                app.buttons["打开地图"].firstMatch,
                element("native-ios-backup-overview", app: app),
                element("ios-clipboard-status", app: app),
                element("native-ios-transfer-overview", app: app),
                app.segmentedControls["笔记来源"].firstMatch
            ]
            XCTAssertTrue(eligible.contains(where: { $0.exists }),
                          "Dynamic tab did not mount its real selected feature or Map shortcut")
            mapOpenedByDynamic = element("native-ios-map-source-selector", app: app).exists
            XCUIDevice.shared.press(.home)
            app.activate()
            XCTAssertEqual(app.state, .runningForeground, "Failed to resume dynamic tab")
            if mapOpenedByDynamic {
                ready("native-ios-map-source-selector", app: app)
            }
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

    // Six extra real tap-driven journeys target tools and transition states
    // that the per-Launcher mount checks alone do not exercise. Synthetic
    // Owner has no Server bearer; no private media or successful mutation
    // is invented by these tests.
    func testNotesFilesGalleryNotesThreeCyclesDoNotExit() {
        let app = launch()
        openLauncher("notes", app: app)
        XCTAssertTrue(app.navigationBars["笔记"].firstMatch.waitForExistence(timeout: 15))
        for cycle in 0..<3 {
            tap("native-ios-tab-files", app: app)
            ready("native-ios-files-section-browse", app: app)
            tap("native-ios-tab-gallery", app: app)
            ready("native-ios-unified-photo-gallery", app: app)
            tap("native-ios-tab-dynamic", app: app)
            XCTAssertTrue(app.navigationBars["笔记"].firstMatch.waitForExistence(timeout: 15),
                          "Notes route did not survive Gallery/Files cycle \(cycle)")
            XCTAssertEqual(app.state, .runningForeground)
        }
        capture(app, "notes-files-gallery-three-cycles")
    }

    func testClipboardNotesTransfersForegroundRoundTripsDoNotExit() {
        let app = launch()
        openLauncher("clipboard", app: app)
        ready("ios-clipboard-draft", app: app)
        XCUIDevice.shared.press(.home)
        app.activate()
        ready("ios-clipboard-draft", app: app)
        openLauncher("notes", app: app)
        XCTAssertTrue(app.navigationBars["笔记"].firstMatch.waitForExistence(timeout: 15))
        openLauncher("transfers", app: app)
        ready("native-ios-transfer-overview", app: app)
        openLauncher("clipboard", app: app)
        ready("ios-clipboard-draft", app: app)
        capture(app, "clipboard-notes-transfers-return")
    }

    func testTransfersRealFileAndBackupDestinationsDoNotExit() {
        let app = launch()
        openLauncher("transfers", app: app)
        ready("native-ios-transfer-overview", app: app)
        let files = app.buttons["打开文件"].firstMatch
        XCTAssertTrue(files.waitForExistence(timeout: 15))
        print("IOS_NATIVE_NAV_TAP_START route=native-ios-transfer-open-files")
        files.tap()
        ready("native-ios-files-section-browse", app: app)
        openLauncher("transfers", app: app)
        ready("native-ios-transfer-overview", app: app)
        let backup = app.buttons["打开相册备份"].firstMatch
        XCTAssertTrue(backup.waitForExistence(timeout: 15))
        print("IOS_NATIVE_NAV_TAP_START route=native-ios-transfer-open-backup")
        backup.tap()
        ready("native-ios-backup-overview", app: app)
        capture(app, "transfers-files-backup")
    }

    func testBackupTaskSheetFilesGalleryDynamicReturnDoNotExit() {
        let app = launch()
        openLauncher("backup", app: app)
        ready("native-ios-backup-overview", app: app)
        tap("native-ios-photos-task-list", app: app)
        let done = element("native-ios-photo-task-list-done", app: app)
        XCTAssertTrue(done.waitForExistence(timeout: 15))
        done.tap()
        let retired = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"), object: done)
        XCTAssertEqual(XCTWaiter.wait(for: [retired], timeout: 12), .completed,
                       "Backup task Sheet remained over app navigation")
        ready("native-ios-backup-overview", app: app)
        tap("native-ios-tab-files", app: app)
        ready("native-ios-files-section-browse", app: app)
        tap("native-ios-tab-gallery", app: app)
        ready("native-ios-unified-photo-gallery", app: app)
        tap("native-ios-tab-dynamic", app: app)
        ready("native-ios-backup-overview", app: app)
        capture(app, "backup-sheet-gallery-return")
    }

    func testSignedOutMinePlaceholdersGalleryReturnDoNotExit() {
        let app = launch(offlineOwner: false)
        tap("native-ios-tab-mine", app: app)
        ready("native-ios-mine-server-account", app: app)
        XCTAssertFalse(element("native-ios-mine-server-account", app: app).isEnabled)
        for (name, message) in [("sync", "同步尚未接通"),
                                ("devices", "设备尚未接通"),
                                ("diagnostics", "诊断尚未接通")] {
            openLauncher(name, app: app)
            XCTAssertTrue(app.staticTexts[message].firstMatch.waitForExistence(timeout: 15),
                          "Actual unavailable child page missing for \(name)")
            XCTAssertEqual(app.state, .runningForeground)
        }
        tap("native-ios-tab-gallery", app: app)
        ready("native-ios-unified-photo-gallery", app: app)
        tap("native-ios-tab-files", app: app)
        ready("native-ios-files-section-browse", app: app)
        capture(app, "mine-placeholders-gallery-return")
    }

    func testLocalMapFilesNotesClipboardReturnDoNotExit() {
        let app = launch(offlineOwner: false)
        openLauncher("map", app: app)
        ready("native-ios-map-source-selector", app: app)
        tap("native-ios-tab-files", app: app)
        ready("native-ios-files-section-browse", app: app)
        openLauncher("notes", app: app)
        XCTAssertTrue(app.navigationBars["笔记"].firstMatch.waitForExistence(timeout: 15))
        openLauncher("clipboard", app: app)
        ready("ios-clipboard-draft", app: app)
        tap("native-ios-tab-gallery", app: app)
        // Gallery still owns the previous local map route, not a fabricated
        // unified page. It must remount its actual MapKit source selector.
        ready("native-ios-map-source-selector", app: app)
        capture(app, "map-files-tools-return")
    }


    /// A real menu/button route, not a coordinate-based stand-in.
    /// Every subpage transition is followed by an actual mounted-page check.
    private func tapNamed(_ title: String, route: String, app: XCUIApplication) {
        let button = app.buttons[title].firstMatch
        XCTAssertTrue(button.waitForExistence(timeout: 15),
                      "Native child action missing: \(title)")
        XCTAssertTrue(button.isHittable,
                      "Native child action is obstructed: \(title)")
        print("IOS_NATIVE_NAV_TAP_START route=\(route)")
        button.tap()
        XCTAssertEqual(app.state, .runningForeground, "Process exited after \(route)")
    }

    private func waitRetired(_ id: String, app: XCUIApplication) {
        let stale = element(id, app: app)
        let retired = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"), object: stale)
        XCTAssertEqual(XCTWaiter.wait(for: [retired], timeout: 12), .completed,
                       "Old child remained mounted after dismissal: \(id)")
    }

    private func openGalleryBackup(_ item: String, app: XCUIApplication) {
        tap("native-ios-tab-gallery", app: app)
        tap("native-ios-gallery-backup-settings", app: app)
        tapNamed(item, route: "native-ios-gallery-backup-child", app: app)
    }

    // Each previously untested child entry has its own XCTest. A failed
    // entry cannot mask later siblings, and the mandatory navigation shard
    // retains the native process crash report plus a tap-adjacent screenshot.
    func testBackupDetailsChildFilesReturnDoesNotExit() {
        let app = launch()
        openLauncher("backup", app: app)
        ready("native-ios-backup-overview", app: app)
        tapNamed("备份详情", route: "native-ios-backup-details", app: app)
        ready("native-ios-backup-portrait-form", app: app)
        capture(app, "backup-details-child")
        tapNamed("返回相册备份", route: "native-ios-backup-details-return", app: app)
        ready("native-ios-backup-overview", app: app)
        tap("native-ios-tab-files", app: app)
        ready("native-ios-files-section-browse", app: app)
        XCTAssertFalse(element("native-ios-backup-portrait-form", app: app).exists)
    }

    func testBackupAuditChildForegroundReturnDoesNotExit() {
        let app = launch()
        openLauncher("backup", app: app)
        ready("native-ios-backup-overview", app: app)
        tapNamed("逐项核验当前云端原件", route: "native-ios-backup-audit", app: app)
        ready("native-ios-backup-portrait-form", app: app)
        XCUIDevice.shared.press(.home)
        app.activate()
        ready("native-ios-backup-portrait-form", app: app)
        capture(app, "backup-audit-foreground")
        tapNamed("返回相册备份", route: "native-ios-backup-audit-return", app: app)
        ready("native-ios-backup-overview", app: app)
        XCTAssertFalse(element("native-ios-backup-portrait-form", app: app).exists)
    }

    func testGalleryBackupSettingsChildReturnDoesNotExit() {
        let app = launch()
        openGalleryBackup("备份设置", app: app)
        ready("native-ios-backup-portrait-form", app: app)
        tap("native-ios-tab-files", app: app)
        ready("native-ios-files-section-browse", app: app)
        tap("native-ios-tab-dynamic", app: app)
        ready("native-ios-backup-portrait-form", app: app)
        capture(app, "gallery-backup-settings-resume")
        tapNamed("返回相册备份", route: "native-ios-gallery-settings-return", app: app)
        ready("native-ios-backup-overview", app: app)
    }

    func testGalleryFocusedBackupChildDoesNotStartUpload() {
        let app = launch()
        openGalleryBackup("集中备份（需确认）", app: app)
        ready("native-ios-backup-portrait-form", app: app)
        XCTAssertFalse(element("native-ios-photos-focused-progress", app: app).exists,
                       "Navigation-only shortcut must not start an upload")
        capture(app, "gallery-backup-focused-no-consent")
        tapNamed("返回相册备份", route: "native-ios-gallery-focused-return", app: app)
        ready("native-ios-backup-overview", app: app)
    }

    func testGalleryBackupQueueSheetRetiresDoesNotExit() {
        let app = launch()
        openGalleryBackup("查看备份任务队列", app: app)
        ready("native-ios-photo-task-list-done", app: app)
        capture(app, "gallery-backup-queue-child")
        tap("native-ios-photo-task-list-done", app: app)
        waitRetired("native-ios-photo-task-list-done", app: app)
        ready("native-ios-backup-overview", app: app)
        tap("native-ios-tab-files", app: app)
        ready("native-ios-files-section-browse", app: app)
    }

    func testGalleryCacheSheetBackgroundDismissDoesNotExit() {
        let app = launch()
        openGalleryBackup("释放本机缓存空间（不删除照片原件）", app: app)
        ready("native-ios-gallery-thumbnail-cache", app: app)
        ready("native-ios-backup-cache-sheet-close", app: app)
        XCUIDevice.shared.press(.home)
        app.activate()
        ready("native-ios-gallery-thumbnail-cache", app: app)
        capture(app, "gallery-cache-after-foreground")
        tap("native-ios-backup-cache-sheet-close", app: app)
        waitRetired("native-ios-gallery-thumbnail-cache", app: app)
        ready("native-ios-unified-photo-gallery", app: app)
    }

    func testFilesTagManagementChildRetiresBeforeNotesDoesNotExit() {
        let app = launch()
        tap("native-ios-tab-files", app: app)
        let browse = element("native-ios-files-section-browse", app: app)
        ready("native-ios-files-section-browse", app: app)
        if (browse.value as? String) != "已选择" {
            tap("native-ios-files-section-browse", app: app)
        }
        XCTAssertEqual(browse.value as? String, "已选择")
        let home = element("native-ios-files-home-list", app: app)
        XCTAssertTrue(home.waitForExistence(timeout: 15), "Browse Home is not mounted")
        let tags = element("native-ios-files-home-manage-tags", app: app)
        for _ in 0..<8 {
            if tags.exists && tags.isHittable { break }
            home.swipeUp()
        }
        XCTAssertTrue(tags.exists && tags.isHittable,
                      "Real Tags Manager entry cannot be reached in Files Home")
        tap("native-ios-files-home-manage-tags", app: app)
        ready("native-ios-files-tag-management", app: app)
        capture(app, "files-tag-manager-child")
        tapNamed("完成", route: "native-ios-files-tag-manager-return", app: app)
        waitRetired("native-ios-files-tag-management", app: app)
        openLauncher("notes", app: app)
        ready("native-ios-notes-page", app: app)
    }

    func testMinePhotoWallChildFilesReturnWithoutSignIn() {
        let app = launch(offlineOwner: false)
        tap("native-ios-tab-mine", app: app)
        ready("native-ios-mine-server-account", app: app)
        tapNamed("相册与照片墙", route: "native-ios-mine-photo-wall", app: app)
        ready("native-ios-unified-photo-gallery", app: app)
        tap("native-ios-tab-files", app: app)
        ready("native-ios-files-section-browse", app: app)
        tap("native-ios-tab-mine", app: app)
        ready("native-ios-mine-server-account", app: app)
        XCTAssertFalse(element("native-ios-mine-server-account", app: app).isEnabled,
                       "Switching children must not manufacture a verified Owner")
        capture(app, "mine-gallery-files-signed-out")
    }

}
