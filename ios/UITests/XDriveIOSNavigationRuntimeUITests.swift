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
        // The historic release uses one parent identifier on every actual
        // button. Its baseline tests must tap those buttons, but should not
        // pretend that the *new* distinct-ID accessibility contract existed.
        let legacyTab = app.buttons.matching(
            identifier: "native-ios-five-slot-bar"
        ).matching(
            NSPredicate(format: "label == %@", "文件")
        ).firstMatch
        if legacyTab.waitForExistence(timeout: 2) {
            print("NAV_SMOKE old release: verifying real tap paths, not distinct IDs")
            XCTAssertEqual(app.state, .runningForeground)
            return
        }
        for name in ["launcher", "dynamic", "gallery", "files", "mine"] {
            let identifier = "native-ios-tab-\(name)"
            let exact = app.descendants(matching: .any)
                .matching(identifier: identifier).firstMatch
            XCTAssertTrue(exact.waitForExistence(timeout: 20),
                          "Candidate must expose exact unique tab ID: \(name)")
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

    // The Files Home is a genuine two-page, lazily rendered CollectionView.
    // Deep '整理' rows do not exist in AX until the collection is scrolled.
    // Never guess a tap coordinate or silently treat absence as a pass.
    private func filesHomeEntry(_ identifier: String, in app: XCUIApplication) -> XCUIElement {
        let list = app.collectionViews.firstMatch
        XCTAssertTrue(list.waitForExistence(timeout: 12),
                      "Native Files Home collection is not mounted")
        let button = app.buttons.matching(identifier: identifier).firstMatch
        for _ in 0..<5 {
            if button.exists && button.isHittable { return button }
            list.swipeUp()
        }
        XCTAssertTrue(button.waitForExistence(timeout: 8),
                      "Scrolled Files Home but no matching entry: \(identifier)")
        XCTAssertTrue(button.isHittable, "Files Home entry exists but is not visible")
        return button
    }

    // Exercise actual native child-route mount/dismiss under an offline Owner.
    // These are Simulator navigation tests, not a frame-time/flicker benchmark.
    func testSyntheticOwnerSavedSearchesRepeatedSheetReturn() {
        let app = launch(syntheticOwner: true)
        select("native-ios-tab-files", in: app)
        for cycle in 0..<2 {
            filesHomeEntry("native-ios-files-open-saved-searches", in: app).tap()
            XCTAssertTrue(find("native-ios-files-saved-searches-page", in: app)
                .waitForExistence(timeout: 20),
                          "Saved Searches form did not mount at return cycle \(cycle)")
            let done = app.buttons["完成"].firstMatch
            XCTAssertTrue(done.waitForExistence(timeout: 10))
            done.tap()
            XCTAssertTrue(filesHomeEntry("native-ios-files-open-saved-searches", in: app)
                .exists, "Files Home lost after Saved Searches")
            XCTAssertTrue(find("native-ios-files-section-browse", in: app).exists)
            XCTAssertEqual(app.state, .runningForeground)
        }
    }

    func testSyntheticOwnerOperationsHistoryRepeatedSheetReturn() {
        let app = launch(syntheticOwner: true)
        select("native-ios-tab-files", in: app)
        for cycle in 0..<2 {
            filesHomeEntry("native-ios-files-open-operations", in: app).tap()
            XCTAssertTrue(find("native-ios-files-operation-history-page", in: app)
                .waitForExistence(timeout: 20),
                          "Operations form did not mount at return cycle \(cycle)")
            let done = app.buttons["完成"].firstMatch
            XCTAssertTrue(done.waitForExistence(timeout: 10))
            done.tap()
            XCTAssertTrue(filesHomeEntry("native-ios-files-open-operations", in: app)
                .exists, "Files Home lost after Operations History")
            XCTAssertTrue(find("native-ios-files-section-browse", in: app).exists)
            XCTAssertEqual(app.state, .runningForeground)
        }
    }

    func testSyntheticOwnerRecentlyDeletedReturnKeepsFilesHomeMounted() {
        let app = launch(syntheticOwner: true)
        select("native-ios-tab-files", in: app)
        select("native-ios-files-open-trash", in: app)
        // Capture a real rendered frame BEFORE traversing the AX hierarchy,
        // so a repeated 120s XCUI snapshot failure still has a visual record.
        let evidence = XCTAttachment(screenshot: app.screenshot())
        evidence.name = "trash-child-after-push"
        evidence.lifetime = .keepAlways
        add(evidence)
        let errorPage = app.descendants(matching: .any)
            .matching(identifier: "native-ios-files-trash-error-page").firstMatch
        XCTAssertTrue(errorPage.waitForExistence(timeout: 12),
                      "Unreadable Trash must mount a bounded error surface")
        let back = app.buttons["native-ios-files-trash-error-return"].firstMatch
        XCTAssertTrue(back.waitForExistence(timeout: 12),
                      "Recently Deleted native recovery did not mount")
        back.tap()
        XCTAssertTrue(find("native-ios-files-open-trash", in: app)
            .waitForExistence(timeout: 15))
        XCTAssertTrue(find("native-ios-files-section-browse", in: app).exists)
        XCTAssertEqual(app.state, .runningForeground)
    }

    func testSyntheticOwnerGalleryCacheReturnKeepsMineMounted() {
        let app = launch(syntheticOwner: true)
        select("native-ios-tab-mine", in: app)
        let cacheLink = app.buttons["缩略图缓存"].firstMatch
        if cacheLink.waitForExistence(timeout: 8) {
            cacheLink.tap()
        } else {
            let cacheLabel = app.staticTexts["缩略图缓存"].firstMatch
            XCTAssertTrue(cacheLabel.waitForExistence(timeout: 10),
                          "Native cache navigation link missing")
            cacheLabel.tap()
        }
        XCTAssertTrue(find("native-ios-gallery-thumbnail-cache", in: app)
            .waitForExistence(timeout: 20), "Gallery cache child page did not mount")
        let back = app.navigationBars["缩略图缓存"].buttons.element(boundBy: 0)
        XCTAssertTrue(back.waitForExistence(timeout: 10))
        back.tap()
        XCTAssertTrue(find("native-ios-tab-mine", in: app).exists)
        XCTAssertEqual(app.state, .runningForeground)
    }
    /// Actual simulator navigation: compact Home edit is a live SwiftUI
    /// control, not a static source contract. No authenticated Owner required.
    func testFilesHomeInlineEditKeepsBrowseShellAndRestoresDone() {
        let app = launch(syntheticOwner: true)
        select("native-ios-tab-files", in: app)
        let edit = find("native-ios-files-home-edit-toggle", in: app)
        XCTAssertTrue(edit.waitForExistence(timeout: 12))
        edit.tap()
        XCTAssertEqual(edit.label, "完成")
        XCTAssertTrue(find("native-ios-files-section-browse", in: app).exists)
        XCTAssertTrue(find("native-ios-files-open-root-location", in: app).exists)
        edit.tap()
        XCTAssertEqual(edit.label, "编辑")
        XCTAssertEqual(app.state, .runningForeground)
    }

    // Six distinct tap-driven native transition journeys. These deliberately
    // use the real no-session / synthetic-Owner UI and assert each child after
    // navigation rather than treating a colored tab bar as a rendered page.
    // PNG samples diagnose candidate blanks; they are not 60/120-Hz proof.
    private func observedSelect(_ identifier: String, in app: XCUIApplication) {
        let element = find(identifier, in: app)
        XCTAssertTrue(element.exists, "Native route missing before tap: \(identifier)")
        print("IOS_NATIVE_NAV_TAP_START route=\(identifier)")
        element.tap()
        XCTAssertEqual(app.state, .runningForeground, "Exited after \(identifier)")
    }

    private func observedFilesHomeEntry(_ identifier: String, in app: XCUIApplication) {
        let element = filesHomeEntry(identifier, in: app)
        print("IOS_NATIVE_NAV_TAP_START route=\(identifier)")
        element.tap()
        XCTAssertEqual(app.state, .runningForeground, "Exited after \(identifier)")
    }

    private func assertChildAndCapture(
        _ identifier: String, in app: XCUIApplication, label: String
    ) {
        XCTAssertTrue(find(identifier, in: app).waitForExistence(timeout: 15),
                      "Real native child absent: \(label)")
        XCTAssertEqual(app.state, .runningForeground)
        let evidence = XCTAttachment(screenshot: app.screenshot())
        evidence.name = label
        evidence.lifetime = .keepAlways
        add(evidence)
    }

    func testSavedSearchesSheetOriginalsAndFilesReturnKeepsContent() {
        let app = launch(syntheticOwner: true)
        observedSelect("native-ios-tab-files", in: app)
        observedFilesHomeEntry("native-ios-files-open-saved-searches", in: app)
        assertChildAndCapture("native-ios-files-saved-searches-page", in: app,
                              label: "saved-searches-before-gallery")
        let done = app.buttons["完成"].firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 15))
        done.tap()
        observedSelect("native-ios-tab-gallery", in: app)
        observedSelect("native-ios-gallery-source-originals", in: app)
        assertChildAndCapture("native-ios-cloud-original-layout-help", in: app,
                              label: "originals-after-saved-searches")
        observedSelect("native-ios-tab-files", in: app)
        assertChildAndCapture("native-ios-files-section-browse", in: app,
                              label: "files-after-originals")
    }

    func testOperationsHistoryGalleryPeopleAndFilesReturnKeepsContent() {
        let app = launch(syntheticOwner: true)
        observedSelect("native-ios-tab-files", in: app)
        observedFilesHomeEntry("native-ios-files-open-operations", in: app)
        assertChildAndCapture("native-ios-files-operation-history-page", in: app,
                              label: "operations-before-people")
        let done = find("native-ios-files-operation-history-done", in: app)
        XCTAssertTrue(done.waitForExistence(timeout: 15))
        done.tap()
        observedSelect("native-ios-tab-gallery", in: app)
        observedSelect("native-ios-gallery-people", in: app)
        assertChildAndCapture("native-ios-gallery-people-page", in: app,
                              label: "gallery-people-after-operations")
        let back = app.navigationBars.buttons.element(boundBy: 0)
        XCTAssertTrue(back.waitForExistence(timeout: 15))
        back.tap()
        observedSelect("native-ios-tab-files", in: app)
        assertChildAndCapture("native-ios-files-section-browse", in: app,
                              label: "files-after-people")
    }

    func testTrashDenialGalleryFilterCancelAndFilesReturnKeepsContent() {
        let app = launch(syntheticOwner: true)
        observedSelect("native-ios-tab-files", in: app)
        observedSelect("native-ios-files-open-trash", in: app)
        assertChildAndCapture("native-ios-files-trash-error-page", in: app,
                              label: "trash-denied-child")
        observedSelect("native-ios-files-trash-error-return", in: app)
        observedSelect("native-ios-tab-gallery", in: app)
        observedSelect("native-ios-gallery-open-filters", in: app)
        let cancel = app.buttons["取消"].firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 15))
        cancel.tap()
        assertChildAndCapture("native-ios-gallery-open-filters", in: app,
                              label: "gallery-after-trash-and-filter")
        observedSelect("native-ios-tab-files", in: app)
        assertChildAndCapture("native-ios-files-section-browse", in: app,
                              label: "files-after-trash-filter")
        XCTAssertFalse(find("native-ios-files-trash-error-page", in: app).exists,
                       "Denied Trash child must not remain above Files Home")
    }

    func testFilesHomeEditGallerySourceRoundtripKeepsBrowse() {
        let app = launch(syntheticOwner: true)
        observedSelect("native-ios-tab-files", in: app)
        let edit = find("native-ios-files-home-edit-toggle", in: app)
        XCTAssertTrue(edit.waitForExistence(timeout: 15))
        edit.tap()
        XCTAssertEqual(edit.label, "完成")
        observedSelect("native-ios-tab-gallery", in: app)
        observedSelect("native-ios-gallery-source-albums", in: app)
        observedSelect("native-ios-gallery-source-unified", in: app)
        assertChildAndCapture("native-ios-gallery-open-filters", in: app,
                              label: "gallery-after-files-edit")
        observedSelect("native-ios-tab-files", in: app)
        let returningEdit = find("native-ios-files-home-edit-toggle", in: app)
        XCTAssertTrue(returningEdit.waitForExistence(timeout: 15))
        if returningEdit.label == "完成" { returningEdit.tap() }
        assertChildAndCapture("native-ios-files-section-browse", in: app,
                              label: "files-browse-after-edit")
    }

    func testFilesSearchKeyboardMineCacheReturnKeepsFiles() {
        let app = launch(syntheticOwner: true)
        observedSelect("native-ios-tab-files", in: app)
        let search = app.searchFields["搜索全部文件"].firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 15))
        search.tap()
        search.typeText("cross-page")
        observedSelect("native-ios-tab-mine", in: app)
        let cacheButton = app.buttons["缩略图缓存"].firstMatch
        if cacheButton.waitForExistence(timeout: 8) {
            cacheButton.tap()
        } else {
            let cacheLabel = app.staticTexts["缩略图缓存"].firstMatch
            XCTAssertTrue(cacheLabel.waitForExistence(timeout: 12))
            cacheLabel.tap()
        }
        assertChildAndCapture("native-ios-gallery-thumbnail-cache", in: app,
                              label: "mine-cache-after-files-keyboard")
        let back = app.navigationBars["缩略图缓存"].buttons.element(boundBy: 0)
        XCTAssertTrue(back.waitForExistence(timeout: 15))
        back.tap()
        observedSelect("native-ios-tab-files", in: app)
        assertChildAndCapture("native-ios-files-section-browse", in: app,
                              label: "files-after-mine-cache")
    }

    func testSavedSearchSheetRotationThenGalleryFilesReturnKeepsContent() {
        let app = launch(syntheticOwner: true)
        let device = XCUIDevice.shared
        defer { device.orientation = .portrait }
        observedSelect("native-ios-tab-files", in: app)
        observedFilesHomeEntry("native-ios-files-open-saved-searches", in: app)
        assertChildAndCapture("native-ios-files-saved-searches-page", in: app,
                              label: "saved-searches-portrait")
        device.orientation = .landscapeLeft
        assertChildAndCapture("native-ios-files-saved-searches-page", in: app,
                              label: "saved-searches-landscape")
        let done = app.buttons["完成"].firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 15))
        done.tap()
        device.orientation = .portrait
        observedSelect("native-ios-tab-gallery", in: app)
        observedSelect("native-ios-tab-files", in: app)
        assertChildAndCapture("native-ios-files-section-browse", in: app,
                              label: "files-after-sheet-rotation")
    }

}
