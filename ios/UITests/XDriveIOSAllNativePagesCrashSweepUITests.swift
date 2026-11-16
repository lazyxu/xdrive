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
        let scroll = element("native-ios-launcher-scroll", app)
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

    private func waitRetired(_ id: String, _ app: XCUIApplication) {
        let target = element(id, app)
        let gone = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"), object: target)
        XCTAssertEqual(XCTWaiter.wait(for: [gone], timeout: 12), .completed,
                       "Old native child remained after Done: " + id)
    }


    /// Favorites is behind a persistent DisclosureGroup; a collapsed route
    /// cannot be mislabeled as an App crash or missing native destination.
    private func favoritesDisclosure(_ app: XCUIApplication) -> XCUIElement {
        let home = element("native-ios-files-home-list", app)
        XCTAssertTrue(home.waitForExistence(timeout: 15), "Files Home not mounted")
        let disclosure = element("native-ios-files-favorites-disclosure", app)
        for _ in 0..<10 {
            if disclosure.exists && disclosure.isHittable { break }
            home.swipeUp()
        }
        XCTAssertTrue(disclosure.exists && disclosure.isHittable,
                      "Favorites DisclosureGroup is inaccessible")
        return disclosure
    }

    private func ensureFavoritesExpanded(_ app: XCUIApplication) {
        let disclosure = favoritesDisclosure(app)
        if (disclosure.value as? String) == "已折叠" {
            print("IOS_NATIVE_NAV_TAP_START route=native-ios-files-favorites-disclosure")
            disclosure.tap()
        }
        let expanded = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "value == %@", "已展开"), object: disclosure)
        XCTAssertEqual(XCTWaiter.wait(for: [expanded], timeout: 8), .completed,
                       "Favorites group did not expand before child navigation")
    }

    /// Expand the genuine collapsed Tags disclosure before opening its child.
    /// A hidden management Button is not evidence of an application crash.
    private func ensureTagsExpanded(_ app: XCUIApplication) {
        let home = element("native-ios-files-home-list", app)
        XCTAssertTrue(home.waitForExistence(timeout: 15), "Files Home not mounted")
        let disclosure = element("native-ios-files-home-tags-disclosure", app)
        for _ in 0..<12 {
            if disclosure.exists && disclosure.isHittable { break }
            home.swipeUp()
        }
        if !(disclosure.exists && disclosure.isHittable) {
            for _ in 0..<12 {
                if disclosure.exists && disclosure.isHittable { break }
                home.swipeDown()
            }
        }
        XCTAssertTrue(disclosure.exists && disclosure.isHittable,
                      "Actual Files Tags disclosure inaccessible")
        if (disclosure.value as? String) == "已折叠" {
            print("IOS_NATIVE_NAV_TAP_START route=native-ios-files-home-tags-disclosure")
            disclosure.tap()
        }
        let expanded = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "value == %@", "已展开"), object: disclosure)
        XCTAssertEqual(XCTWaiter.wait(for: [expanded], timeout: 8), .completed,
                       "Files Tags group did not expand before opening management")
    }

    /// The home editor is behind the real collapsed More management group.
    /// Expand the native control rather than treating hidden children as crashes.
    private func ensureMoreExpanded(_ app: XCUIApplication) {
        let home = element("native-ios-files-home-list", app)
        XCTAssertTrue(home.waitForExistence(timeout: 15), "Files Home not mounted")
        let disclosure = element("native-ios-files-home-more-disclosure", app)
        for _ in 0..<12 {
            if disclosure.exists && disclosure.isHittable { break }
            home.swipeUp()
        }
        if !(disclosure.exists && disclosure.isHittable) {
            for _ in 0..<12 {
                if disclosure.exists && disclosure.isHittable { break }
                home.swipeDown()
            }
        }
        XCTAssertTrue(disclosure.exists && disclosure.isHittable,
                      "Actual Files More management disclosure inaccessible")
        if (disclosure.value as? String) == "已折叠" {
            print("IOS_NATIVE_NAV_TAP_START route=native-ios-files-home-more-disclosure")
            disclosure.tap()
        }
        let expanded = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "value == %@", "已展开"), object: disclosure)
        XCTAssertEqual(XCTWaiter.wait(for: [expanded], timeout: 8), .completed,
                       "Files More management group did not expand")
    }

    private func filesHomeChild(_ id: String, page: String, _ app: XCUIApplication) {
        tap("native-ios-tab-files", app)
        ready("native-ios-files-section-browse", app)
        // An Owner can restore Recent/Favorites. Existence of Browse alone
        // does not mean the actual Home list is mounted.
        tap("native-ios-files-section-browse", app)
        let selected = element("native-ios-files-section-browse", app)
        let selectedExpectation = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "value == %@", "已选择"), object: selected)
        XCTAssertEqual(XCTWaiter.wait(for: [selectedExpectation], timeout: 8),
                       .completed, "Files Browse must be selected before opening Home child")
        let home = element("native-ios-files-home-list", app)
        XCTAssertTrue(home.waitForExistence(timeout: 15), "Files Home not mounted")
        if id == "native-ios-files-open-favorites" { ensureFavoritesExpanded(app) }
        if id == "native-ios-files-home-manage-tags" { ensureTagsExpanded(app) }
        if id == "native-ios-files-home-edit-inline" { ensureMoreExpanded(app) }
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
        waitRetired("native-ios-files-saved-searches-page", app)
        filesHomeChild("native-ios-files-open-operations",
                       page: "native-ios-files-operation-history-page", app)
        tap("native-ios-files-operation-history-done", app)
        waitRetired("native-ios-files-operation-history-page", app)
        filesHomeChild("native-ios-files-home-manage-tags",
                       page: "native-ios-files-tag-management", app)
        tapNamed("完成", app)
        waitRetired("native-ios-files-tag-management", app)
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
        // Master Notes uses a real segmented Picker("笔记来源"),
        // not the AX identifier added only on the unmerged #4298 branch.
        let picker = app.segmentedControls.firstMatch
        XCTAssertTrue(picker.waitForExistence(timeout: 15),
                      "Native Notes source segmented control missing")
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


    /// Open the actual Gallery backup menu. Never start a backup or invent
    /// an authenticated Owner in the synthetic-Owner test environment.
    private func openGalleryBackup(_ child: String, _ app: XCUIApplication) {
        tap("native-ios-tab-gallery", app)
        // Live Simulator screenshots show the Gallery backup Menu visible,
        // but SwiftUI can expose its identifier on an AX wrapper which is
        // not hittable. Require a *real* hittable Button or Menu label.
        let candidates = [
            app.buttons.matching(identifier: "native-ios-gallery-backup-settings").firstMatch,
            app.buttons["备份"].firstMatch,
            app.buttons.matching(identifier: "native-ios-gallery-backup-settings-compact").firstMatch
        ]
        var target: XCUIElement?
        for _ in 0..<48 {
            target = candidates.first(where: { $0.exists && $0.isHittable })
            if target != nil { break }
            Thread.sleep(forTimeInterval: 0.25)
        }
        guard let backup = target else {
            capture(app, "gallery-backup-menu-not-hittable")
            XCTFail("No real Gallery backup Menu became hittable")
            return
        }
        print("IOS_NATIVE_NAV_TAP_START route=native-ios-gallery-backup-settings")
        backup.tap()
        XCTAssertEqual(app.state, .runningForeground)
        tapNamed(child, app)
    }

    /// Real unmodified sign-in screen, not the smoke Dashboard with a
    /// fabricated Owner. A recovery marker is cleared without supplying
    /// credentials or performing any network authentication.
    private func launchRealSignedOut() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-xdrive.ios.native.launch-checkpoint.v1", "ready"]
        app.launch()
        XCTAssertEqual(app.state, .runningForeground)
        ready("native-ios-login-server", app)
        ready("native-ios-login-username", app)
        ready("native-ios-login-password", app)
        return app
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

    func testFilesFourDeniedChildrenWithOrientationAndOwnerFenceDoNotExit() {
        let app = launch()
        let routes: [(String, String, String)] = [
            ("native-ios-files-open-root-location", "native-ios-files-error-page",
             "native-ios-files-error-return"),
            ("native-ios-files-open-recent", "native-ios-files-recent-error-page",
             "native-ios-files-recent-error-return"),
            ("native-ios-files-open-favorites", "native-ios-files-favorites-error-page",
             "native-ios-files-favorites-error-return"),
            ("native-ios-files-open-trash", "native-ios-files-trash-error-page",
             "native-ios-files-trash-error-return")
        ]
        defer { XCUIDevice.shared.orientation = .portrait }
        for (index, route) in routes.enumerated() {
            filesHomeChild(route.0, page: route.1, app)
            XCTAssertFalse(element("native-ios-files-grid", app).exists,
                           "A synthetic Owner has no authenticated protected rows")
            if index == 1 {
                XCUIDevice.shared.orientation = .landscapeLeft
                ready(route.1, app)
                XCUIDevice.shared.orientation = .portrait
            } else if index == 2 {
                XCUIDevice.shared.press(.home)
                app.activate()
                ready(route.1, app)
            }
            tap(route.2, app)
            waitRetired(route.1, app)
            ready("native-ios-files-home-list", app)
            tap("native-ios-tab-gallery", app)
            ready("native-ios-unified-photo-gallery", app)
        }
        capture(app, "files-four-denied-children")
    }


    /// Reproduces the persisted-collapsed route, without fabricating a bearer
    /// session or presenting protected rows in the CI synthetic Owner.
    func testFilesFavoriteDisclosureCollapseExpandAndReturnKeepsProcessAlive() {
        let app = launch()
        tap("native-ios-tab-files", app)
        tap("native-ios-files-section-browse", app)
        ready("native-ios-files-home-list", app)
        let disclosure = favoritesDisclosure(app)
        if (disclosure.value as? String) == "已展开" {
            print("IOS_NATIVE_NAV_TAP_START route=native-ios-files-favorites-disclosure")
            disclosure.tap()
        }
        let collapsed = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "value == %@", "已折叠"), object: disclosure)
        XCTAssertEqual(XCTWaiter.wait(for: [collapsed], timeout: 8), .completed,
                       "Native favorites group did not collapse")
        XCTAssertFalse(element("native-ios-files-open-favorites", app).exists,
                       "Favorites child must not remain mounted in a collapsed group")
        XCUIDevice.shared.press(.home)
        app.activate()
        ready("native-ios-files-home-list", app)
        filesHomeChild("native-ios-files-open-favorites",
                       page: "native-ios-files-favorites-error-page", app)
        XCTAssertFalse(element("native-ios-files-grid", app).exists,
                       "Synthetic Owner must not access protected Favorites")
        tap("native-ios-files-favorites-error-return", app)
        waitRetired("native-ios-files-favorites-error-page", app)
        tap("native-ios-tab-gallery", app)
        ready("native-ios-unified-photo-gallery", app)
        tap("native-ios-tab-files", app)
        ready("native-ios-files-home-list", app)
        XCTAssertEqual(app.state, .runningForeground)
        capture(app, "files-favorites-collapse-expand-return")
    }

    func testGalleryBackupSettingsQueueAndFilesReturnDoNotExit() {
        let app = launch()
        openGalleryBackup("备份设置", app)
        ready("native-ios-backup-portrait-form", app)
        XCUIDevice.shared.press(.home)
        app.activate()
        ready("native-ios-backup-portrait-form", app)
        tapNamed("返回相册备份", app)
        ready("native-ios-backup-overview", app)
        tap("native-ios-photos-task-list", app)
        ready("native-ios-photo-task-list-done", app)
        tap("native-ios-photo-task-list-done", app)
        waitRetired("native-ios-photo-task-list-done", app)
        tap("native-ios-tab-files", app)
        ready("native-ios-files-section-browse", app)
        XCTAssertFalse(element("native-ios-backup-portrait-form", app).exists)
        capture(app, "gallery-backup-settings-queue-files")
    }

    func testGalleryThumbnailCacheSheetForegroundDismissDoesNotExit() {
        let app = launch()
        openGalleryBackup("释放本机缓存空间（不删除照片原件）", app)
        ready("native-ios-gallery-thumbnail-cache", app)
        ready("native-ios-backup-cache-sheet-close", app)
        XCUIDevice.shared.press(.home)
        app.activate()
        ready("native-ios-gallery-thumbnail-cache", app)
        tap("native-ios-backup-cache-sheet-close", app)
        waitRetired("native-ios-gallery-thumbnail-cache", app)
        ready("native-ios-unified-photo-gallery", app)
        tap("native-ios-tab-files", app)
        ready("native-ios-files-section-browse", app)
        capture(app, "gallery-cache-sheet-dismissed")
    }

    func testNotesRecentFeaturePickerRotationAndTransfersDoNotExit() {
        let app = launch()
        openLauncher("notes", app)
        ready("native-ios-notes-page", app)
        tapNamed("最近功能", app)
        XCTAssertTrue(app.navigationBars["最近功能"].firstMatch
            .waitForExistence(timeout: 15), "Real recent-features child missing")
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertEqual(app.state, .runningForeground)
        XCUIDevice.shared.orientation = .portrait
        tapNamed("完成", app)
        ready("native-ios-notes-page", app)
        openLauncher("transfers", app)
        ready("native-ios-transfer-overview", app)
        tap("native-ios-tab-files", app)
        ready("native-ios-files-section-browse", app)
        XCTAssertFalse(app.navigationBars["最近功能"].firstMatch.exists)
        capture(app, "notes-recent-transfers-retired")
    }

    func testRealSignedOutPasswordShowHideOrientationAndForegroundDoNotExit() {
        let app = launchRealSignedOut()
        let scroll = app.scrollViews.containing(.any, identifier: "native-ios-login-password").firstMatch
        XCTAssertTrue(scroll.waitForExistence(timeout: 15))
        let show = app.buttons["显示密码"].firstMatch
        for _ in 0..<6 {
            if show.exists && show.isHittable { break }
            scroll.swipeUp()
        }
        XCTAssertTrue(show.exists && show.isHittable,
                      "Native login password control is inaccessible")
        tapNamed("显示密码", app)
        XCTAssertTrue(app.buttons["隐藏密码"].firstMatch
            .waitForExistence(timeout: 15))
        tapNamed("隐藏密码", app)
        XCTAssertTrue(show.waitForExistence(timeout: 15))
        defer { XCUIDevice.shared.orientation = .portrait }
        XCUIDevice.shared.orientation = .landscapeLeft
        ready("native-ios-login-server", app)
        XCUIDevice.shared.orientation = .portrait
        XCUIDevice.shared.press(.home)
        app.activate()
        ready("native-ios-login-password", app)
        XCTAssertFalse(element("native-ios-files-grid", app).exists)
        capture(app, "real-signed-out-password-rotation")
    }

    func testRealSignedOutLANHelpWithoutCertificatePairingDoesNotExit() {
        let app = launchRealSignedOut()
        // The current compact login folds LAN options by default.
        // Tap the real disclosure: never grant implicit LAN or Owner access.
        tap("native-ios-login-advanced-connection", app)
        let ip = element("native-ios-login-lan-ip", app)
        XCTAssertTrue(ip.waitForExistence(timeout: 15))
        ip.tap()
        // Documentation-only TEST-NET address. Do not sign in, pair a
        // certificate, install a trust root or submit this value to Server.
        ip.typeText("192.0.2.4")
        ready("native-ios-lan-certificate-help", app)
        tap("native-ios-lan-certificate-help", app)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(
            format: "label CONTAINS %@", "登录前检测一次内网 HTTPS")).firstMatch
            .waitForExistence(timeout: 10),
            "The native LAN help must expand after an explicit tap")
        ready("native-ios-lan-https-pairing", app)
        XCUIDevice.shared.press(.home)
        app.activate()
        ready("native-ios-lan-certificate-help", app)
        XCTAssertEqual(app.state, .runningForeground)
        capture(app, "real-signed-out-lan-help")
    }

    func testMinePhotoWallChildGalleryAndFilesKeepSignedOutFence() {
        let app = launch(owner: false)
        tap("native-ios-tab-mine", app)
        ready("native-ios-mine-server-account", app)
        tapNamed("相册与照片墙", app)
        ready("native-ios-unified-photo-gallery", app)
        tap("native-ios-tab-files", app)
        ready("native-ios-files-section-browse", app)
        tap("native-ios-tab-mine", app)
        ready("native-ios-mine-server-account", app)
        XCTAssertFalse(element("native-ios-mine-server-account", app).isEnabled,
                       "No-session Mine child must not create a verified Owner")
        XCTAssertFalse(element("native-ios-files-grid", app).exists)
        capture(app, "mine-photo-wall-files-signed-out")
    }




    func testLauncherSearchKeyboardForegroundFilesReturnDoesNotExit() {
        let app = launch(owner: false)
        tap("native-ios-tab-launcher", app)
        let search = element("native-ios-launcher-search", app)
        XCTAssertTrue(search.waitForExistence(timeout: 15))
        print("IOS_NATIVE_NAV_TAP_START route=native-ios-launcher-search")
        search.tap()
        search.typeText("no-route-123")
        // Assert the full asynchronous SwiftUI value rather than an
        // intermediate keyboard update. Truncation still fails the test.
        let expected = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "value == %@", "no-route-123"),
            object: search)
        XCTAssertEqual(XCTWaiter.wait(for: [expected], timeout: 8), .completed,
                       "Launcher search dropped typed characters")
        XCTAssertFalse(element("native-ios-launcher-files", app).exists)
        XCUIDevice.shared.press(.home)
        app.activate()
        ready("native-ios-launcher-search", app)
        tap("native-ios-tab-files", app)
        ready("native-ios-files-section-browse", app)
        tap("native-ios-tab-gallery", app)
        ready("native-ios-unified-photo-gallery", app)
        XCTAssertFalse(element("native-ios-files-grid", app).exists)
        capture(app, "launcher-search-keyboard-files-gallery")
    }

    func testDynamicRecentPickerTwiceFilesGalleryForegroundDoesNotExit() {
        let app = launch()
        for round in 0..<2 {
            openLauncher("notes", app)
            ready("native-ios-notes-page", app)
            tapNamed("最近功能", app)
            XCTAssertTrue(app.navigationBars["最近功能"].firstMatch.waitForExistence(timeout: 15))
            if round == 0 {
                XCUIDevice.shared.press(.home)
                app.activate()
                XCTAssertTrue(app.navigationBars["最近功能"].firstMatch.waitForExistence(timeout: 15))
            }
            tapNamed("完成", app)
            ready("native-ios-notes-page", app)
            tap("native-ios-tab-files", app)
            ready("native-ios-files-section-browse", app)
            tap("native-ios-tab-gallery", app)
            ready("native-ios-unified-photo-gallery", app)
            XCTAssertFalse(app.navigationBars["最近功能"].firstMatch.exists)
        }
        capture(app, "recent-picker-repeated-retirement")
    }

    func testFilesQuickRailNineSwitchesForegroundAndNoSessionDoesNotExit() {
        let app = launch()
        tap("native-ios-tab-files", app)
        ready("native-ios-files-section-browse", app)
        for cycle in 0..<3 {
            for name in ["recent", "favorites", "browse"] {
                let id = "native-ios-files-section-" + name
                tap(id, app)
                let selected = element(id, app)
                let expectation = XCTNSPredicateExpectation(
                    predicate: NSPredicate(format: "value == %@", "已选择"), object: selected)
                XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 8), .completed)
                XCTAssertEqual(app.state, .runningForeground)
                if name != "browse" {
                    XCTAssertFalse(element("native-ios-files-grid", app).exists)
                }
            }
            if cycle == 1 {
                XCUIDevice.shared.press(.home)
                app.activate()
                ready("native-ios-files-section-browse", app)
            }
            tap("native-ios-tab-gallery", app)
            ready("native-ios-unified-photo-gallery", app)
            tap("native-ios-tab-files", app)
            ready("native-ios-files-section-browse", app)
        }
        capture(app, "files-quick-rail-nine-switches")
    }

    func testFilesHomeEditThenSavedHistorySheetsRetireDoesNotExit() {
        let app = launch()
        filesHomeChild("native-ios-files-home-edit-inline",
                       page: "native-ios-files-home-list", app)
        let edit = element("native-ios-files-home-edit-inline", app)
        let started = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label CONTAINS %@", "完成首页整理"), object: edit)
        XCTAssertEqual(XCTWaiter.wait(for: [started], timeout: 8), .completed)
        filesHomeChild("native-ios-files-home-edit-inline",
                       page: "native-ios-files-home-list", app)
        let finished = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label CONTAINS %@", "直接编辑浏览首页"), object: edit)
        XCTAssertEqual(XCTWaiter.wait(for: [finished], timeout: 8), .completed)
        filesHomeChild("native-ios-files-open-saved-searches",
                       page: "native-ios-files-saved-searches-page", app)
        tap("native-ios-files-saved-searches-done", app)
        waitRetired("native-ios-files-saved-searches-page", app)
        filesHomeChild("native-ios-files-open-operations",
                       page: "native-ios-files-operation-history-page", app)
        tap("native-ios-files-operation-history-done", app)
        waitRetired("native-ios-files-operation-history-page", app)
        tap("native-ios-tab-gallery", app)
        ready("native-ios-unified-photo-gallery", app)
        tap("native-ios-tab-files", app)
        ready("native-ios-files-home-list", app)
        capture(app, "files-edit-and-management-sheets")
    }

    func testMineSignedOutCacheDisabledThroughRotationForegroundDoesNotExit() {
        let app = launch(owner: false)
        tap("native-ios-tab-mine", app)
        let cache = app.buttons["缩略图缓存"].firstMatch
        XCTAssertTrue(cache.waitForExistence(timeout: 15))
        XCTAssertFalse(cache.isEnabled, "Signed-out Owner may not open thumbnail cache")
        defer { XCUIDevice.shared.orientation = .portrait }
        XCUIDevice.shared.orientation = .landscapeLeft
        ready("native-ios-mine-server-account", app)
        XCUIDevice.shared.orientation = .portrait
        XCUIDevice.shared.press(.home)
        app.activate()
        ready("native-ios-mine-server-account", app)
        XCTAssertFalse(cache.isEnabled)
        tap("native-ios-tab-gallery", app)
        ready("native-ios-unified-photo-gallery", app)
        tap("native-ios-tab-files", app)
        ready("native-ios-files-section-browse", app)
        XCTAssertFalse(element("native-ios-files-grid", app).exists)
        capture(app, "mine-cache-signed-out-denial")
    }

    func testRealSignedOutPasswordPreferenceToggleRestoresOriginalDoesNotExit() {
        let app = launchRealSignedOut()
        // Preserve the compact login default: preferences are opened deliberately.
        tap("native-ios-login-preferences", app)
        let toggle = element("native-ios-remember-password", app)
        let scroll = app.scrollViews.containing(
            .any, identifier: "native-ios-login-password").firstMatch
        XCTAssertTrue(scroll.waitForExistence(timeout: 15))
        for _ in 0..<8 {
            if toggle.exists && toggle.isHittable { break }
            scroll.swipeUp()
        }
        XCTAssertTrue(toggle.exists && toggle.isHittable)
        guard let original = toggle.value as? String else {
            XCTFail("Native preference must expose an original value")
            return
        }
        print("IOS_NATIVE_NAV_TAP_START route=native-ios-remember-password")
        toggle.tap()
        XCTAssertNotEqual(toggle.value as? String, original)
        toggle.tap()
        XCTAssertEqual(toggle.value as? String, original)
        XCUIDevice.shared.press(.home)
        app.activate()
        ready("native-ios-login-password", app)
        XCTAssertFalse(element("native-ios-files-grid", app).exists)
        capture(app, "real-signed-out-reversible-preference")
    }


    /// Test a real interrupted startup stage via Foundation UserDefaults'
    /// process argument domain. This does not fake a valid Owner session.
    private func launchInterruptedCheckpoint(_ phase: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-xdrive.ios.native.launch-checkpoint.v1", phase]
        app.launch()
        XCTAssertEqual(app.state, .runningForeground,
                       "Process exited while rendering interrupted-startup recovery")
        ready("native-ios-startup-recovery", app)
        ready("native-ios-startup-phase", app)
        let previous = element("native-ios-startup-phase", app)
        XCTAssertTrue(previous.label.contains(phase),
                      "Actual recovery UI must identify the interrupted phase")
        return app
    }

    func testInterruptedWorkspaceSafeEntryForegroundNoCrash() {
        let app = launchInterruptedCheckpoint("mountingWorkspace")
        tap("native-ios-startup-safe-entry", app)
        ready("native-ios-startup-safe-mode", app)
        ready("native-ios-login-server", app)
        ready("native-ios-login-username", app)
        waitRetired("native-ios-startup-recovery", app)
        XCUIDevice.shared.press(.home)
        app.activate()
        ready("native-ios-startup-safe-mode", app)
        XCTAssertFalse(element("native-ios-five-slot-bar", app).exists,
                       "Safe startup without a Server session cannot mount private workspace")
        capture(app, "interrupted-workspace-safe-entry-foreground")
    }

    func testInterruptedSessionFullRetryRendersLoginNoCrash() {
        let app = launchInterruptedCheckpoint("restoringSession")
        tap("native-ios-startup-retry", app)
        ready("native-ios-login-server", app)
        ready("native-ios-login-password", app)
        waitRetired("native-ios-startup-recovery", app)
        XCTAssertFalse(element("native-ios-startup-safe-mode", app).exists,
                       "Full retry must not silently take the safe-startup route")
        XCTAssertFalse(element("native-ios-five-slot-bar", app).exists,
                       "A retry without authorization cannot expose a cloud workspace")
        capture(app, "interrupted-session-full-retry-login")
    }

    func testTransfersFilesBackupRoundTripAndForegroundNoCrash() {
        let app = launch()
        openLauncher("transfers", app)
        ready("native-ios-transfer-overview", app)
        tapNamed("打开文件", app)
        ready("native-ios-files-section-browse", app)
        XCTAssertFalse(element("native-ios-files-grid", app).exists,
                       "Unauthenticated Owner cannot expose protected cloud file rows")
        openLauncher("transfers", app)
        ready("native-ios-transfer-overview", app)
        tapNamed("打开相册备份", app)
        ready("native-ios-backup-overview", app)
        XCUIDevice.shared.press(.home)
        app.activate()
        ready("native-ios-backup-overview", app)
        openLauncher("transfers", app)
        ready("native-ios-transfer-overview", app)
        capture(app, "transfers-files-backup-foreground")
    }

    func testBackupDetailsChildFilesReturnNoCrash() {
        let app = launch()
        openLauncher("backup", app)
        ready("native-ios-backup-overview", app)
        tapNamed("备份详情", app)
        ready("native-ios-backup-portrait-form", app)
        tapNamed("返回相册备份", app)
        ready("native-ios-backup-overview", app)
        XCTAssertFalse(element("native-ios-backup-portrait-form", app).exists,
                       "Backup details child remained mounted after returning")
        tap("native-ios-tab-files", app)
        ready("native-ios-files-section-browse", app)
        openLauncher("backup", app)
        ready("native-ios-backup-overview", app)
        capture(app, "backup-details-files-return")
    }

    func testGalleryFocusedBackupConsentDoesNotAutoUploadNoCrash() {
        let app = launch()
        openGalleryBackup("集中备份（需确认）", app)
        ready("native-ios-backup-portrait-form", app)
        XCTAssertFalse(element("native-ios-photos-focused-progress", app).exists,
                       "Opening focused backup must not automatically start an upload")
        XCUIDevice.shared.press(.home)
        app.activate()
        ready("native-ios-backup-portrait-form", app)
        tapNamed("返回相册备份", app)
        ready("native-ios-backup-overview", app)
        tap("native-ios-tab-gallery", app)
        ready("native-ios-unified-photo-gallery", app)
        capture(app, "gallery-focused-backup-no-consent")
    }

    func testNotesSourcesThreeRoundsClipboardFilesNoCrash() {
        let app = launch()
        defer { XCUIDevice.shared.orientation = .portrait }
        openLauncher("notes", app)
        ready("native-ios-notes-page", app)
        let picker = app.segmentedControls.firstMatch
        XCTAssertTrue(picker.waitForExistence(timeout: 15),
                      "Real Notes source Picker absent")
        for round in 0..<3 {
            for source in ["iOS 备份", "我的备忘录"] {
                let option = picker.buttons[source].firstMatch
                XCTAssertTrue(option.waitForExistence(timeout: 15),
                              "Real Notes source child missing: " + source)
                XCTAssertTrue(option.isHittable, "Notes source selector obstructed")
                print("IOS_NATIVE_NAV_TAP_START route=native-ios-notes-source")
                option.tap()
                ready("native-ios-notes-page", app)
            }
            if round == 1 {
                XCUIDevice.shared.orientation = .landscapeLeft
                ready("native-ios-notes-page", app)
                XCUIDevice.shared.orientation = .portrait
            }
        }
        openLauncher("clipboard", app)
        ready("ios-clipboard-draft", app)
        tap("native-ios-tab-files", app)
        ready("native-ios-files-section-browse", app)
        XCTAssertFalse(element("native-ios-files-grid", app).exists)
        capture(app, "notes-sources-clipboard-files")
    }


    /// MapKit -> denied Files child -> read-only Backup queue -> MapKit.
    /// This re-enters real native view graphs without an authenticated token.
    func testMapRecentDeniedBackupQueueMapForegroundDoesNotExit() {
        let app = launch()
        openLauncher("map", app)
        ready("native-ios-map-source-selector", app)
        filesHomeChild("native-ios-files-open-recent",
                       page: "native-ios-files-recent-error-page", app)
        XCTAssertFalse(element("native-ios-files-grid", app).exists)
        tap("native-ios-files-recent-error-return", app)
        waitRetired("native-ios-files-recent-error-page", app)
        openLauncher("backup", app)
        ready("native-ios-backup-overview", app)
        tap("native-ios-photos-task-list", app)
        ready("native-ios-photo-task-list-done", app)
        tap("native-ios-photo-task-list-done", app)
        waitRetired("native-ios-photo-task-list-done", app)
        openLauncher("map", app)
        ready("native-ios-map-source-selector", app)
        XCUIDevice.shared.press(.home)
        app.activate()
        ready("native-ios-map-source-selector", app)
        XCTAssertFalse(element("native-ios-files-grid", app).exists)
        capture(app, "map-denied-recent-backup-map-foreground")
    }

    /// The real native Files tag manager must retire through rotation,
    /// preserving the previously selected Map and Owner's no-bearer fence.
    func testFilesTagSheetRotationMapReturnDoesNotExit() {
        let app = launch()
        let device = XCUIDevice.shared
        defer { device.orientation = .portrait }
        openLauncher("map", app)
        ready("native-ios-map-source-selector", app)
        filesHomeChild("native-ios-files-home-manage-tags",
                       page: "native-ios-files-tag-management", app)
        device.orientation = .landscapeLeft
        ready("native-ios-files-tag-management", app)
        device.orientation = .portrait
        tapNamed("完成", app)
        waitRetired("native-ios-files-tag-management", app)
        device.press(.home)
        app.activate()
        ready("native-ios-files-section-browse", app)
        tap("native-ios-tab-gallery", app)
        ready("native-ios-map-source-selector", app)
        XCTAssertFalse(element("native-ios-files-grid", app).exists)
        tap("native-ios-tab-files", app)
        ready("native-ios-files-section-browse", app)
        capture(app, "files-tag-rotation-map-return")
    }

    /// Cloud Originals must not accidentally reuse a denied Files folder
    /// or resurrect it when returning from the Notes subpage.
    func testOriginalsDeniedCloudNotesGalleryReturnDoesNotExit() {
        let app = launch()
        openLauncher("originals", app)
        ready("native-ios-cloud-original-layout-help", app)
        filesHomeChild("native-ios-files-open-root-location",
                       page: "native-ios-files-error-page", app)
        XCTAssertFalse(element("native-ios-files-grid", app).exists)
        tap("native-ios-files-error-return", app)
        waitRetired("native-ios-files-error-page", app)
        openLauncher("notes", app)
        ready("native-ios-notes-page", app)
        tap("native-ios-tab-gallery", app)
        ready("native-ios-cloud-original-layout-help", app)
        XCTAssertFalse(element("native-ios-files-grid", app).exists)
        capture(app, "originals-denied-files-notes-gallery")
    }

    /// The read-only Backup Audit and Queue are separate children; after
    /// foreground return they must not expose protected Cloud Files.
    func testBackupAuditQueueDeniedFilesReturnDoesNotExit() {
        let app = launch()
        openLauncher("backup", app)
        ready("native-ios-backup-overview", app)
        tapNamed("逐项核验当前云端原件", app)
        ready("native-ios-backup-portrait-form", app)
        XCUIDevice.shared.press(.home)
        app.activate()
        ready("native-ios-backup-portrait-form", app)
        tapNamed("返回相册备份", app)
        ready("native-ios-backup-overview", app)
        tap("native-ios-photos-task-list", app)
        ready("native-ios-photo-task-list-done", app)
        tap("native-ios-photo-task-list-done", app)
        waitRetired("native-ios-photo-task-list-done", app)
        filesHomeChild("native-ios-files-open-root-location",
                       page: "native-ios-files-error-page", app)
        XCTAssertFalse(element("native-ios-files-grid", app).exists)
        tap("native-ios-files-error-return", app)
        waitRetired("native-ios-files-error-page", app)
        openLauncher("backup", app)
        ready("native-ios-backup-overview", app)
        capture(app, "backup-audit-queue-denied-files-return")
    }

    /// Device receiver denial remains denied across Notes source switching,
    /// Files navigation and a background/foreground lifecycle.
    func testClipboardDeniedReceiverNotesFilesForegroundDoesNotExit() {
        let app = launch()
        openLauncher("clipboard", app)
        ready("ios-clipboard-draft", app)
        tapNamed("启用本机设备定向接收", app)
        ready("ios-clipboard-status", app)
        XCTAssertFalse(app.staticTexts["设备定向接收已启用"].firstMatch.exists)
        openLauncher("notes", app)
        ready("native-ios-notes-page", app)
        let source = app.segmentedControls.firstMatch
        XCTAssertTrue(source.waitForExistence(timeout: 15))
        let iosBackup = source.buttons["iOS 备份"].firstMatch
        XCTAssertTrue(iosBackup.waitForExistence(timeout: 15))
        print("IOS_NATIVE_NAV_TAP_START route=native-ios-notes-backup-after-clipboard")
        iosBackup.tap()
        ready("native-ios-notes-page", app)
        tap("native-ios-tab-files", app)
        ready("native-ios-files-section-browse", app)
        XCUIDevice.shared.press(.home)
        app.activate()
        ready("native-ios-files-section-browse", app)
        openLauncher("clipboard", app)
        ready("ios-clipboard-draft", app)
        XCTAssertFalse(app.staticTexts["设备定向接收已启用"].firstMatch.exists)
        XCTAssertFalse(element("native-ios-files-grid", app).exists)
        capture(app, "clipboard-denial-notes-files-foreground")
    }


    /// Focus real signed-out credential fields, then resume the same native
    /// login screen; keyboard and scene changes must never authenticate Owner.
    func testSignedOutLoginThreeFieldsKeyboardForegroundNoCrash() {
        let app = launchRealSignedOut()
        // Scope the container to the actual password control: a retained
        // offscreen ScrollView or a different child cannot be used to swipe.
        let scroll = app.scrollViews.containing(
            .any, identifier: "native-ios-login-password").firstMatch
        XCTAssertTrue(scroll.waitForExistence(timeout: 15))
        for id in ["native-ios-login-server", "native-ios-login-username",
                   "native-ios-login-password"] {
            let field = element(id, app)
            XCTAssertTrue(field.waitForExistence(timeout: 15),
                          "Real signed-out field missing: " + id)
            for _ in 0..<8 {
                if field.isHittable { break }
                scroll.swipeUp()
            }
            XCTAssertTrue(field.isHittable, "Real sign-in field inaccessible: " + id)
            print("IOS_NATIVE_NAV_TAP_START route=" + id)
            field.tap()
            XCTAssertEqual(app.state, .runningForeground)
        }
        XCUIDevice.shared.press(.home)
        app.activate()
        for id in ["native-ios-login-server", "native-ios-login-username",
                   "native-ios-login-password", "native-ios-login-submit"] {
            ready(id, app)
        }
        XCTAssertFalse(element("native-ios-mine-server-account", app).exists,
                       "Keyboard and foreground cannot implicitly authenticate Owner")
        capture(app, "signed-out-login-fields-keyboard-foreground")
    }

    /// Real Launcher placeholders must survive orientation and foreground
    /// changes, then return to protected Files without a usable bearer.
    func testUnavailableLauncherFourToolsRotationForegroundFilesNoCrash() {
        let app = launch()
        let device = XCUIDevice.shared
        defer { device.orientation = .portrait }
        let routes = [
            ("sync", "同步尚未接通"), ("storage", "存储尚未接通"),
            ("devices", "设备尚未接通"), ("diagnostics", "诊断尚未接通")
        ]
        for (index, route) in routes.enumerated() {
            openLauncher(route.0, app)
            let placeholder = app.staticTexts[route.1].firstMatch
            XCTAssertTrue(placeholder.waitForExistence(timeout: 15),
                          "Actual unavailable Launcher route missing: " + route.0)
            if index.isMultiple(of: 2) {
                device.orientation = .landscapeLeft
                XCTAssertTrue(placeholder.waitForExistence(timeout: 15))
                device.orientation = .portrait
                device.press(.home)
                app.activate()
                XCTAssertTrue(placeholder.waitForExistence(timeout: 15))
            }
            tap("native-ios-tab-files", app)
            ready("native-ios-files-section-browse", app)
            XCTAssertFalse(element("native-ios-files-grid", app).exists)
        }
        capture(app, "launcher-placeholders-rotation-files-no-session")
    }

    /// Three actual unauthorized cloud-folder child pushes and returns on
    /// the same Files view tree, including one foreground transition.
    func testFilesRootDeniedThreeCyclesForegroundGalleryNoCrash() {
        let app = launch()
        for cycle in 0..<3 {
            filesHomeChild("native-ios-files-open-root-location",
                           page: "native-ios-files-error-page", app)
            XCTAssertFalse(element("native-ios-files-grid", app).exists)
            if cycle == 1 {
                XCUIDevice.shared.press(.home)
                app.activate()
                ready("native-ios-files-error-page", app)
            }
            tap("native-ios-files-error-return", app)
            waitRetired("native-ios-files-error-page", app)
            tap("native-ios-tab-gallery", app)
            ready("native-ios-unified-photo-gallery", app)
            tap("native-ios-tab-files", app)
            ready("native-ios-files-section-browse", app)
            XCTAssertEqual(app.state, .runningForeground)
        }
        capture(app, "files-cloud-root-denied-three-cycles")
    }

    /// Gallery backup-queue and thumbnail-cache children are distinct
    /// sheets. Reopening them must retire old state and never upload.
    func testGalleryBackupQueueCacheTwoRoundsFilesNoCrash() {
        let app = launch()
        for cycle in 0..<2 {
            openGalleryBackup("查看备份任务队列", app)
            ready("native-ios-photo-task-list-done", app)
            tap("native-ios-photo-task-list-done", app)
            waitRetired("native-ios-photo-task-list-done", app)
            ready("native-ios-backup-overview", app)
            openGalleryBackup("释放本机缓存空间（不删除照片原件）", app)
            ready("native-ios-gallery-thumbnail-cache", app)
            if cycle == 0 {
                XCUIDevice.shared.press(.home)
                app.activate()
                ready("native-ios-gallery-thumbnail-cache", app)
            }
            tap("native-ios-backup-cache-sheet-close", app)
            waitRetired("native-ios-gallery-thumbnail-cache", app)
            tap("native-ios-tab-gallery", app)
            ready("native-ios-unified-photo-gallery", app)
            tap("native-ios-tab-files", app)
            ready("native-ios-files-section-browse", app)
            XCTAssertFalse(element("native-ios-gallery-thumbnail-cache", app).exists)
            XCTAssertFalse(element("native-ios-files-grid", app).exists)
        }
        capture(app, "gallery-queue-cache-files-two-rounds")
    }

    /// Files tags, saved searches and operation history must retire after
    /// rotation and foreground interruptions without a stale sheet or grid.
    func testFilesManagementThreeSheetsRotationGalleryNoCrash() {
        let app = launch()
        let device = XCUIDevice.shared
        defer { device.orientation = .portrait }
        filesHomeChild("native-ios-files-home-manage-tags",
                       page: "native-ios-files-tag-management", app)
        device.orientation = .landscapeLeft
        ready("native-ios-files-tag-management", app)
        device.orientation = .portrait
        tapNamed("完成", app)
        waitRetired("native-ios-files-tag-management", app)
        for (entry, page, done) in [
            ("native-ios-files-open-saved-searches",
             "native-ios-files-saved-searches-page", "native-ios-files-saved-searches-done"),
            ("native-ios-files-open-operations",
             "native-ios-files-operation-history-page", "native-ios-files-operation-history-done")
        ] {
            filesHomeChild(entry, page: page, app)
            device.press(.home)
            app.activate()
            ready(page, app)
            tap(done, app)
            waitRetired(page, app)
            tap("native-ios-tab-gallery", app)
            ready("native-ios-unified-photo-gallery", app)
        }
        tap("native-ios-tab-files", app)
        ready("native-ios-files-section-browse", app)
        for id in ["native-ios-files-tag-management",
                   "native-ios-files-saved-searches-page",
                   "native-ios-files-operation-history-page"] {
            XCTAssertFalse(element(id, app).exists, "Old Files modal still mounted: " + id)
        }
        XCTAssertFalse(element("native-ios-files-grid", app).exists)
        capture(app, "files-management-three-sheets-rotation")
    }


    /// The original iOS 26.6 EXC_BAD_ACCESS occurred while constructing the
    /// Files view graph. Recreate the actual process three times, rather than
    /// merely switching an already mounted tab. Synthetic Owner has no bearer.
    func testFilesDirectSyntheticOwnerColdRelaunchThreeTimesKeepsShellAlive() {
        let app = XCUIApplication()
        app.launchArguments = ["-xdrive-ui-navigation-smoke",
                               "-xdrive-ui-files-direct",
                               "-xdrive-ui-navigation-synthetic-owner"]
        for cycle in 0..<3 {
            app.launch()
            ready("native-ios-files-section-browse", app)
            ready("native-ios-files-open-root-location", app)
            XCUIDevice.shared.press(.home)
            app.activate()
            ready("native-ios-files-section-browse", app)
            XCTAssertFalse(element("native-ios-files-grid", app).exists,
                           "Cold Files root exposed private rows in cycle \(cycle)")
            if cycle < 2 { app.terminate() }
        }
        capture(app, "files-direct-cold-relaunch-three-cycles")
    }

    /// Terminate the app on the real read-only cloud-error child. On the next
    /// launch the unauthenticated Owner must not resurrect a stale cloud grid.
    func testFilesDeniedRootColdRelaunchDoesNotResurrectPrivateGrid() {
        let app = launch()
        for cycle in 0..<2 {
            filesHomeChild("native-ios-files-open-root-location",
                           page: "native-ios-files-error-page", app)
            XCTAssertFalse(element("native-ios-files-grid", app).exists,
                           "No-session cloud failure displayed protected rows")
            app.terminate()
            app.launch()
            // Cold restart intentionally restores Gallery before Files.
            ready("native-ios-unified-photo-gallery", app)
            tap("native-ios-tab-files", app)
            ready("native-ios-files-section-browse", app)
            tap("native-ios-files-section-browse", app)
            ready("native-ios-files-home-list", app)
            XCTAssertFalse(element("native-ios-files-error-page", app).exists,
                           "Cold Files home retained failed child from cycle \(cycle)")
            XCTAssertFalse(element("native-ios-files-grid", app).exists)
        }
        capture(app, "files-error-cold-relaunch-no-private-grid")
    }

    /// Kill and rebuild the app while each distinct Files sheet is visible.
    /// A cold Owner-less launch cannot revive a retained sheet/viewer tree.
    func testFilesManagementSheetsAfterColdRelaunchDoNotRestoreStalePresentation() {
        let app = launch()
        let children = [
            ("native-ios-files-open-saved-searches",
             "native-ios-files-saved-searches-page"),
            ("native-ios-files-open-operations",
             "native-ios-files-operation-history-page")
        ]
        for (entry, page) in children {
            filesHomeChild(entry, page: page, app)
            XCTAssertFalse(element("native-ios-files-grid", app).exists)
            app.terminate()
            app.launch()
            // Cold restart intentionally restores Gallery before Files.
            ready("native-ios-unified-photo-gallery", app)
            tap("native-ios-tab-files", app)
            ready("native-ios-files-section-browse", app)
            tap("native-ios-files-section-browse", app)
            ready("native-ios-files-home-list", app)
            XCTAssertFalse(element(page, app).exists,
                           "Cold Files home resurrected dismissed child: \(page)")
            XCTAssertFalse(element("native-ios-files-grid", app).exists)
        }
        capture(app, "files-two-sheets-cold-relaunch")
    }

    /// Cold restart after actual PhotoKit, Albums, Originals and Map roots,
    /// then mount Files on every new process. No synthetic media is invented.
    func testLauncherPhotoPagesFilesColdRelaunchSurviveNoCrash() {
        let app = launch()
        let roots = [
            ("local", "native-ios-local-timeline-open"),
            ("albums", "native-ios-album-create"),
            ("originals", "native-ios-cloud-original-layout-help"),
            ("map", "native-ios-map-source-selector")
        ]
        for (route, marker) in roots {
            openLauncher(route, app)
            ready(marker, app)
            tap("native-ios-tab-files", app)
            ready("native-ios-files-section-browse", app)
            XCTAssertFalse(element("native-ios-files-grid", app).exists)
            app.terminate()
            app.launch()
            ready("native-ios-tab-launcher", app)
        }
        capture(app, "photo-pages-files-cold-relaunch")
    }

    /// Native Notes, Clipboard, Transfers and Backup share the same root
    /// lifecycle but use distinct child graphs. Re-enter Files on fresh apps.
    func testLauncherToolPagesFilesColdRelaunchSurviveNoCrash() {
        let app = launch()
        let roots = [
            ("notes", "native-ios-notes-page"),
            ("clipboard", "ios-clipboard-draft"),
            ("transfers", "native-ios-transfer-overview"),
            ("backup", "native-ios-backup-overview")
        ]
        for (route, marker) in roots {
            openLauncher(route, app)
            ready(marker, app)
            tap("native-ios-tab-files", app)
            ready("native-ios-files-section-browse", app)
            XCTAssertFalse(element("native-ios-files-grid", app).exists)
            app.terminate()
            app.launch()
            ready("native-ios-tab-launcher", app)
        }
        capture(app, "tool-pages-files-cold-relaunch")
    }

}
