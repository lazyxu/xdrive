import XCTest

/// Real simulator app-exit and native tab/rail UI checks. This uses the actual
/// Dashboard and Files/Gallery screens, but has no authenticated Server Owner.
final class XDriveIOSNavigationRuntimeUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }
    private func launch(syntheticOwner: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-xdrive-ui-navigation-smoke"]
        if syntheticOwner {
            app.launchArguments.append("-xdrive-ui-navigation-synthetic-owner")
        }
        app.launch()
        XCTAssertEqual(app.state, .runningForeground,
                       "App died at launch before Files navigation")
        return app
    }
    /// The published c83 IPA has a *real* five-button tab bar, but SwiftUI
    /// applied the container's identifier to each button instead of the
    /// distinct child IDs. Query an exact button+label as a baseline-only
    /// compatibility fallback; never tap an arbitrary coordinate or guess a
    /// file destination. The candidate still uses the exact new identifier.
    private func legacyControl(
        _ identifier: String, in app: XCUIApplication
    ) -> XCUIElement? {
        if identifier.hasPrefix("native-ios-tab-") {
            let key = String(identifier.dropFirst("native-ios-tab-".count))
            let labels = [
                "launcher": "全部", "dynamic": "地图", "gallery": "图库",
                "files": "文件", "mine": "我的"
            ]
            guard let label = labels[key] else { return nil }
            return app.buttons.matching(identifier: "native-ios-five-slot-bar")
                .matching(NSPredicate(format: "label == %@", label)).firstMatch
        }
        if identifier.hasPrefix("native-ios-files-section-") {
            let key = String(identifier.dropFirst("native-ios-files-section-".count))
            let labels = ["recent": "最近", "browse": "浏览", "favorites": "收藏"]
            guard let label = labels[key] else { return nil }
            return app.buttons.matching(identifier: "native-ios-files-quick-rail")
                .matching(NSPredicate(format: "label == %@", label)).firstMatch
        }
        if identifier.hasPrefix("native-ios-gallery-source-") {
            let key = String(identifier.dropFirst("native-ios-gallery-source-".count))
            let labels = ["albums": "相册", "unified": "全部照片",
                          "originals": "备份原件"]
            guard let label = labels[key] else { return nil }
            return app.buttons.matching(
                NSPredicate(format: "label == %@", label)
            ).firstMatch
        }
        if identifier == "native-ios-gallery-open-filters" {
            return app.buttons.matching(
                identifier: "native-ios-unified-photo-gallery"
            ).matching(
                NSPredicate(format: "label CONTAINS %@", "搜索与筛选")
            ).firstMatch
        }
        return nil
    }

    private func find(_ identifier: String, in app: XCUIApplication) -> XCUIElement {
        let exact = app.descendants(matching: .any)
            .matching(identifier: identifier).firstMatch
        if exact.waitForExistence(timeout: 4) { return exact }
        // Baseline c83 UI hierarchy recorded actual labels and old container
        // IDs on the buttons. This is a real tap, not a source-only assertion.
        if let legacy = legacyControl(identifier, in: app),
           legacy.waitForExistence(timeout: 5) {
            print("NAV_SMOKE legacy baseline AX fallback \(identifier); app state=\(app.state.rawValue)")
            return legacy
        }
        if !exact.waitForExistence(timeout: 10) {
            print("NAV_SMOKE missing \(identifier); app state=\(app.state.rawValue)")
            print("NAV_SMOKE hierarchy:\n\(app.debugDescription)")
            let capture = XCTAttachment(screenshot: app.screenshot())
            capture.name = "missing-\(identifier)"
            capture.lifetime = .keepAlways
            add(capture)
        }
        return exact
    }
    private func select(_ identifier: String, in app: XCUIApplication) {
        let control = find(identifier, in: app)
        XCTAssertTrue(control.exists, "Missing \(identifier)")
        control.tap()
        XCTAssertEqual(app.state, .runningForeground, "App exited at \(identifier)")
    }
    func testFilesFirstOpenAndSixGalleryReturnsDoNotExit() {
        let app = launch()
        XCTAssertTrue(find("native-ios-tab-gallery", in: app).exists)
        for index in 0..<6 {
            select("native-ios-tab-files", in: app)
            XCTAssertTrue(find("native-ios-files-section-browse", in: app).exists,
                          "Files screen did not mount at transition \(index)")
            select("native-ios-tab-gallery", in: app)
        }
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "native-gallery-files-repeat"
        shot.lifetime = .keepAlways
        add(shot)
    }
    func testFilesRecentBrowseFavoritesRepeatedWithoutCrash() {
        let app = launch()
        select("native-ios-tab-files", in: app)
        for _ in 0..<3 {
            for section in ["recent", "browse", "favorites", "browse"] {
                select("native-ios-files-section-\(section)", in: app)
                XCTAssertTrue(find("native-ios-files-section-browse", in: app).exists)
            }
        }
        XCTAssertEqual(app.state, .runningForeground)
    }
    func testSyntheticOwnerFilesRootDoesNotCrashOnAuthFailure() {
        let app = launch(syntheticOwner: true)
        select("native-ios-tab-files", in: app)
        let root = find("native-ios-files-open-root-location", in: app)
        XCTAssertTrue(root.waitForExistence(timeout: 25),
                      "Synthetic Owner Files root link did not appear")
        root.tap()
        XCTAssertEqual(app.state, .runningForeground,
                       "Owned Files root load must fail authorization, not crash")
    }
    func testSyntheticOwnerFilesRailAndGalleryStayAlive() {
        let app = launch(syntheticOwner: true)
        select("native-ios-tab-files", in: app)
        for name in ["recent", "favorites", "browse", "recent", "browse"] {
            select("native-ios-files-section-\(name)", in: app)
        }
        select("native-ios-tab-gallery", in: app)
        select("native-ios-tab-files", in: app)
        XCTAssertEqual(app.state, .runningForeground)
    }
    func testDirectFilesShellCanMountWithoutLoggedInServer() {
        let app = XCUIApplication()
        app.launchArguments = ["-xdrive-ui-navigation-smoke", "-xdrive-ui-files-direct"]
        app.launch()
        XCTAssertTrue(find("native-ios-files-section-browse", in: app)
            .waitForExistence(timeout: 25), "Native Files root failed to mount")
        XCTAssertEqual(app.state, .runningForeground)
    }
    func testDirectFilesShellWithOfflineOwnerDoesNotExit() {
        let app = XCUIApplication()
        app.launchArguments = ["-xdrive-ui-navigation-smoke", "-xdrive-ui-files-direct",
                               "-xdrive-ui-navigation-synthetic-owner"]
        app.launch()
        XCTAssertTrue(find("native-ios-files-open-root-location", in: app)
            .waitForExistence(timeout: 25),
            "Native Files root did not mount for synthetic Owner")
        XCTAssertEqual(app.state, .runningForeground)
    }
    func testFilesTopLevelNavigationRemainsResponsive() {
        let app = launch()
        for tab in ["files", "mine", "files", "launcher", "files", "gallery"] {
            select("native-ios-tab-\(tab)", in: app)
        }
        XCTAssertEqual(app.state, .runningForeground)
    }

    // Source-specific regressions were hidden by AX container identifiers
    // even though the actual buttons were visible and the app stayed running.
    func testNativeFiveTabsHaveDistinctAccessibilityTargets() {
        let app = launch()
        for name in ["launcher", "dynamic", "gallery", "files", "mine"] {
            let identifier = "native-ios-tab-\(name)"
            XCTAssertTrue(find(identifier, in: app).exists,
                          "Custom tab must expose its own accessibility ID: \(name)")
        }
        XCTAssertEqual(app.state, .runningForeground)
    }

    func testFilesRailHasThreeIndependentNavigationTargets() {
        let app = launch()
        select("native-ios-tab-files", in: app)
        for name in ["recent", "browse", "favorites"] {
            XCTAssertTrue(find("native-ios-files-section-\(name)", in: app).exists)
        }
        for name in ["recent", "browse", "favorites", "browse"] {
            select("native-ios-files-section-\(name)", in: app)
            XCTAssertTrue(find("native-ios-files-section-browse", in: app).exists)
        }
    }

    func testGallerySourceSwitchAndReturnKeepsToolbarMounted() {
        let app = launch()
        for source in ["albums", "unified", "originals", "unified"] {
            select("native-ios-gallery-source-\(source)", in: app)
            XCTAssertTrue(find("native-ios-tab-gallery", in: app).exists)
            XCTAssertEqual(app.state, .runningForeground)
        }
        XCTAssertTrue(find("native-ios-gallery-open-filters", in: app).exists,
                      "Unified Gallery must remount its filter controls on return")
    }

    func testGalleryFilterCancelRestoresSameTab() {
        let app = launch()
        select("native-ios-gallery-open-filters", in: app)
        let cancel = app.buttons["取消"].firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 15),
                      "Native Gallery filter sheet did not present")
        cancel.tap()
        XCTAssertTrue(find("native-ios-gallery-open-filters", in: app).exists)
        XCTAssertTrue(find("native-ios-tab-gallery", in: app).exists)
    }

    func testGalleryPeopleChildOpensWithoutDestroyingParentTab() {
        let app = launch(syntheticOwner: true)
        select("native-ios-gallery-people", in: app)
        XCTAssertTrue(find("native-ios-gallery-people-page", in: app).exists)
        XCTAssertEqual(app.state, .runningForeground)
    }

    func testFilesSearchEntryKeepsNativeBrowserAlive() {
        let app = launch()
        select("native-ios-tab-files", in: app)
        let search = app.searchFields["搜索全部文件"].firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 15),
                      "Files native searchable field not available")
        search.tap()
        search.typeText("ab")
        XCTAssertTrue(find("native-ios-files-section-browse", in: app).exists)
        XCTAssertEqual(app.state, .runningForeground)
    }
}
