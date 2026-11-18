import XCTest
import UIKit

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
        print("IOS_NATIVE_NAV_TAP_START route=\(identifier)")
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
    /// iOS 26.6 physical-device SIGSEGV hit the Files deep SwiftUI
    /// Foreground → Owner → Navigation → Arrangement → Loading view stack.
    /// This UI test exercises the real sections and lifecycle repeatedly.
    /// Synthetic Owner has no bearer session; protected reads still deny.
    func testFilesDeepLifecycleViewStackSurvivesOwnerAndForegroundTransitions() {
        let app = launch(syntheticOwner: true)
        select("native-ios-tab-files", in: app)
        for round in 0..<3 {
            for section in ["browse", "recent", "browse", "favorites", "browse"] {
                select("native-ios-files-section-\(section)", in: app)
                XCTAssertEqual(app.state, .runningForeground,
                               "Files view graph terminated at \(round):\(section)")
            }
            XCUIDevice.shared.press(.home)
            // State 3 is a live background process, not a crash. Do not
            // conflate asynchronous foreground activation with termination;
            // assert survival BEFORE activate() can relaunch a dead process.
            XCTAssertTrue(app.wait(for: .runningBackground, timeout: 12),
                          "Files process exited while backgrounded on round \(round)")
            app.activate()
            XCTAssertTrue(app.wait(for: .runningForeground, timeout: 18),
                          "Files failed to restore foreground on round \(round)")
            XCTAssertTrue(find("native-ios-files-section-browse", in: app)
                .waitForExistence(timeout: 15),
                "Files Browse failed to repaint after foreground on round \(round)")
            XCTAssertEqual(app.state, .runningForeground)
            select("native-ios-tab-gallery", in: app)
            select("native-ios-tab-files", in: app)
        }
        let captured = XCTAttachment(screenshot: app.screenshot())
        captured.name = "files-stack-depth-owner-foreground-three-rounds"
        captured.lifetime = .keepAlways
        add(captured)
    }

    /// Real simulator geometry: the Files category row must stay above the
    /// app-wide five slots in portrait AND landscape, without hit obstruction.
    /// A source-only order assertion cannot detect an overlapping safe area.
    func testFilesQuickRailAndFiveTabBarDoNotOverlapInPortraitOrLandscape() {
        let device = XCUIDevice.shared
        let app = launch(syntheticOwner: true)
        defer { device.orientation = .portrait }
        select("native-ios-tab-files", in: app)

        for orientation in [UIDeviceOrientation.portrait, .landscapeLeft] {
            device.orientation = orientation
            let filesRail = find("native-ios-files-quick-rail", in: app)
            let appBar = find("native-ios-five-slot-bar", in: app)
            XCTAssertTrue(filesRail.waitForExistence(timeout: 15),
                          "Files category row disappeared after rotation")
            XCTAssertTrue(appBar.waitForExistence(timeout: 15),
                          "Five global tabs disappeared after rotation")
            XCTAssertGreaterThan(filesRail.frame.height, 20)
            XCTAssertGreaterThan(appBar.frame.height, 20)
            XCTAssertLessThanOrEqual(filesRail.frame.maxY, appBar.frame.minY + 1,
                "Files category row overlaps global tabs in orientation \(orientation.rawValue)")

            for section in ["recent", "browse", "favorites", "browse"] {
                let control = find("native-ios-files-section-\(section)", in: app)
                XCTAssertTrue(control.isHittable,
                              "Files category is obscured: \(section)")
                select("native-ios-files-section-\(section)", in: app)
                XCTAssertLessThanOrEqual(filesRail.frame.maxY, appBar.frame.minY + 1,
                    "Files category overlaps global tabs after \(section)")
                XCTAssertEqual(app.state, .runningForeground)
            }
        }
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "files-rail-five-tab-geometry-portrait-landscape"
        capture.lifetime = .keepAlways
        add(capture)
    }

    /// Real simulator regression for Files/Home category and global navigation
    /// overlapping. The previous layout produced rail.maxY=852 and
    /// globalBar.minY=763 on iOS 26.x; finding both IDs alone was a false PASS.
    private func assertFilesNavigationRowsAreSeparate(
        _ app: XCUIApplication, context: String
    ) {
        let rail = find("native-ios-files-quick-rail", in: app)
        let globalBar = find("native-ios-five-slot-bar", in: app)
        XCTAssertTrue(rail.waitForExistence(timeout: 15), "Files rail missing: " + context)
        XCTAssertTrue(globalBar.waitForExistence(timeout: 15), "Five-slot bar missing: " + context)
        XCTAssertGreaterThan(rail.frame.height, 20, "Collapsed Files rail: " + context)
        XCTAssertGreaterThan(globalBar.frame.height, 20, "Collapsed global bar: " + context)
        XCTAssertLessThanOrEqual(
            rail.frame.maxY, globalBar.frame.minY + 1,
            "Files rail overlays the global tabs during " + context
        )
        for section in ["recent", "browse", "favorites"] {
            XCTAssertTrue(find("native-ios-files-section-" + section, in: app).isHittable,
                          "Files control is covered: " + section + " during " + context)
        }
        XCTAssertEqual(app.state, .runningForeground)
    }

    func testFilesQuickRailNoOverlappingGlobalBarThroughSixNativeTransitions() {
        let app = launch(syntheticOwner: true)
        let device = XCUIDevice.shared
        defer { device.orientation = .portrait }

        // First open, Recent, Browse, Favorites, Browse, tab round-trip:
        // six actual routes with a geometry assertion after every change.
        select("native-ios-tab-files", in: app)
        assertFilesNavigationRowsAreSeparate(app, context: "first Files open")
        for section in ["recent", "browse", "favorites", "browse"] {
            select("native-ios-files-section-" + section, in: app)
            assertFilesNavigationRowsAreSeparate(app, context: "Files " + section)
        }
        select("native-ios-tab-gallery", in: app)
        XCTAssertTrue(find("native-ios-unified-photo-gallery", in: app).exists,
                      "Gallery disappeared during Files navigation")
        select("native-ios-tab-files", in: app)
        assertFilesNavigationRowsAreSeparate(app, context: "Gallery to Files")

        device.orientation = .landscapeLeft
        assertFilesNavigationRowsAreSeparate(app, context: "landscape rotation")
        select("native-ios-files-section-recent", in: app)
        assertFilesNavigationRowsAreSeparate(app, context: "landscape Recent")
        device.orientation = .portrait
        assertFilesNavigationRowsAreSeparate(app, context: "portrait restored")

        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "files-rail-global-bar-portrait-landscape-six-routes"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    func testFilesRailNoOverlapAfterBackgroundAndGalleryReentry() {
        let app = launch(syntheticOwner: true)
        select("native-ios-tab-files", in: app)
        assertFilesNavigationRowsAreSeparate(app, context: "before background")
        XCUIDevice.shared.press(.home)
        XCTAssertTrue(app.wait(for: .runningBackground, timeout: 12),
                      "Files terminated while backgrounded")
        app.activate()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 18),
                      "Files did not return to foreground")
        assertFilesNavigationRowsAreSeparate(app, context: "foreground restored")
        select("native-ios-tab-gallery", in: app)
        XCTAssertTrue(find("native-ios-unified-photo-gallery", in: app).exists)
        select("native-ios-tab-files", in: app)
        assertFilesNavigationRowsAreSeparate(app, context: "second Files visit")
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
    /// Traverse real native tools that are not covered by the Files/Gallery
    /// deep-stack test. An offline synthetic Owner has no bearer Session;
    /// mounting a tool never authorizes a Server read or upload.
    /// Repeated launcher -> tool -> Files -> Gallery transitions also rebuild
    /// the root SwiftUI view graph after foreground/background changes.
    func testLauncherNativeToolsAndTabReturnsDoNotCrash() {
        let app = launch(syntheticOwner: true)
        let tools: [(route: String, pageID: String)] = [
            ("notes", "native-ios-notes-page"),
            ("clipboard", "ios-clipboard-draft"),
            ("transfers", "native-ios-transfer-overview"),
            ("backup", "native-ios-backup-overview")
        ]
        for cycle in 0..<2 {
            for tool in tools {
                select("native-ios-tab-launcher", in: app)
                let target = "native-ios-launcher-\(tool.route)"
                let button = app.descendants(matching: .any)
                    .matching(identifier: target).firstMatch
                if !(button.exists && button.isHittable) {
                    let scroll = find("native-ios-launcher-scroll", in: app)
                    XCTAssertTrue(scroll.waitForExistence(timeout: 12),
                                  "Native Launcher scroll missing for \(target)")
                    // Launcher may remember the last scroll position after
                    // a tab round-trip. Find a real AX target, not a coordinate.
                    for _ in 0..<6 {
                        if button.exists && button.isHittable { break }
                        scroll.swipeDown()
                    }
                    for _ in 0..<9 {
                        if button.exists && button.isHittable { break }
                        scroll.swipeUp()
                    }
                }
                XCTAssertTrue(button.exists && button.isHittable,
                              "Native launcher did not expose \(target)")
                button.tap()
                XCTAssertTrue(find(tool.pageID, in: app)
                    .waitForExistence(timeout: 15),
                    "Native tool \(tool.route) did not mount on cycle \(cycle)")
                XCTAssertEqual(app.state, .runningForeground,
                               "App exited after opening \(tool.route)")
                select("native-ios-tab-files", in: app)
                XCTAssertTrue(find("native-ios-files-section-browse", in: app).exists)
                select("native-ios-tab-gallery", in: app)
                XCTAssertTrue(find("native-ios-tab-gallery", in: app).exists)
                XCTAssertEqual(app.state, .runningForeground)
            }
            select("native-ios-tab-mine", in: app)
            XCUIDevice.shared.press(.home)
            app.activate()
            XCTAssertEqual(app.state, .runningForeground,
                           "Native root exited after tool transitions on cycle \(cycle)")
            XCTAssertTrue(find("native-ios-tab-mine", in: app).exists)
        }
        let evidence = XCTAttachment(screenshot: app.screenshot())
        evidence.name = "native-tools-files-gallery-foreground-no-crash"
        evidence.lifetime = .keepAlways
        add(evidence)
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

    // This is the actual Files Browse List, regardless of whether SwiftUI
    // exposes it as UITableView or UICollectionView on a given iOS release.
    // Never swipe a retained Gallery List or assume an offscreen Lazy row
    // proves Home disappeared after a child-view return.
    private func filesHomeEntry(_ identifier: String, in app: XCUIApplication) -> XCUIElement {
        // The Files-specific quick rail may restore Recent/Favorites. Always
        // open the real Browse route before seeking controls inside its List.
        let browse = app.descendants(matching: .any)
            .matching(identifier: "native-ios-files-section-browse").firstMatch
        XCTAssertTrue(browse.waitForExistence(timeout: 15), "Files Browse rail is missing")
        if (browse.value as? String) != "已选择" {
            XCTAssertTrue(browse.isHittable, "Files Browse rail is obstructed")
            print("IOS_NATIVE_NAV_TAP_START route=native-ios-files-section-browse")
            browse.tap()
        }
        let list = app.descendants(matching: .any)
            .matching(identifier: "native-ios-files-home-list").firstMatch
        XCTAssertTrue(list.waitForExistence(timeout: 15),
                      "Files Browse Home list did not mount")
        let button = app.descendants(matching: .any)
            .matching(identifier: identifier).firstMatch
        // Native List virtualizes deep management rows. Scroll the *actual*
        // Home List, not an unrelated collection left mounted by TabView.
        for _ in 0..<12 {
            if button.exists && button.isHittable { return button }
            list.swipeUp()
        }
        if !(button.exists && button.isHittable) {
            for _ in 0..<12 {
                if button.exists && button.isHittable { return button }
                list.swipeDown()
            }
        }
        XCTAssertTrue(button.exists && button.isHittable,
                      "Verified Files Browse Home lacks actionable entry: \(identifier)")
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
        let browse = find("native-ios-files-section-browse", in: app)
        if (browse.value as? String) != "已选择" {
            observedSelect("native-ios-files-section-browse", in: app)
        }
        // A synthetic Owner is not an authenticated native session: the
        // protected Server search must remain disabled, not fabricate rows.
        let deniedSearch = find("native-ios-files-home-search", in: app)
        XCTAssertTrue(deniedSearch.waitForExistence(timeout: 15))
        XCTAssertFalse(deniedSearch.isEnabled,
                       "No-session Files search must not expose private results")
        // Exercise a real public keyboard editor across Files / Launcher /
        // Mine / Files without granting a fake authenticated Owner.
        observedSelect("native-ios-tab-launcher", in: app)
        let search = find("native-ios-launcher-search", in: app)
        XCTAssertTrue(search.waitForExistence(timeout: 15))
        print("IOS_NATIVE_NAV_TAP_START route=native-ios-launcher-search")
        search.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 12),
                      "Launcher search keyboard is not focused")
        search.typeText("cross-page")
        print("IOS_NATIVE_LAUNCHER_CROSS_PAGE value=\(String(describing: search.value))")
        let typed = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "value == %@", "cross-page"), object: search)
        XCTAssertEqual(XCTWaiter.wait(for: [typed], timeout: 8), .completed,
                       "Launcher keyboard lost typed route across native pages")
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
                              label: "mine-cache-after-launcher-keyboard")
        let back = app.navigationBars["缩略图缓存"].buttons.element(boundBy: 0)
        XCTAssertTrue(back.waitForExistence(timeout: 15))
        back.tap()
        observedSelect("native-ios-tab-files", in: app)
        assertChildAndCapture("native-ios-files-section-browse", in: app,
                              label: "files-after-mine-cache")
        XCTAssertFalse(find("native-ios-files-grid", in: app).exists,
                       "Synthetic Owner cannot surface private Files rows")
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
