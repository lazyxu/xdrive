import XCTest
import UIKit

/// Test-only navigation through VISIBLE controls. The candidate Photos
/// Library intentionally hides xDrive's other five tab controls instead of
/// stacking two tab bars. Old published baselines still expose direct tabs.
/// Never use invisible view IDs or coordinate taps as a substitute for real UX.
enum XDriveIOSNativePhotosTestNavigator {
    private static func found(_ id: String, in app: XCUIApplication) -> XCUIElement {
        // SwiftUI Menu labels may be surfaced as an identifier-less Button
        // even when the Menu's accessibilityIdentifier is attached to an
        // enclosing Other. Prefer the actual hittable Button by its explicit
        // user-facing accessibility label; never tap the non-hittable wrapper.
        if id == "native-ios-gallery-more-menu" {
            let identified = app.buttons.matching(identifier: id).firstMatch
            if identified.exists && identified.isHittable { return identified }
            let labelled = app.buttons.matching(
                NSPredicate(format: "label == %@", "图库来源、备份与 xDrive")
            ).firstMatch
            if labelled.exists && labelled.isHittable { return labelled }
            if identified.exists { return identified }
        }
        let button = app.buttons.matching(identifier: id).firstMatch
        if button.exists { return button }
        return app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    /// Normal Gallery/Files UI tests need a genuine user-visible Photos
    /// decision before tapping More. A first-run system sheet covers the
    /// native toolbar, making an otherwise valid route non-hittable.
    /// Dedicated PhotoKit denied/Limited/Settings tests NEVER call this.
    static func acceptInitialFullPhotosForNavigation(in app: XCUIApplication) {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let systemAlert = springboard.alerts.firstMatch
        let alert = systemAlert.waitForExistence(timeout: 5)
            ? systemAlert : app.alerts.firstMatch
        guard alert.exists else { return }
        let title = alert.label
        guard title.localizedCaseInsensitiveContains("Photo Library") ||
              title.contains("照片") || title.contains("相簿") else {
            XCTFail("Unexpected system prompt blocks Gallery navigation: " + title)
            return
        }
        for label in ["Allow Full Access", "Allow Access to All Photos",
                      "Allow Access to All Photos and Videos", "Full Access",
                      "允许完全访问", "允许访问所有照片", "允许访问全部照片"] {
            let button = alert.buttons[label].firstMatch
            if button.exists && button.isHittable {
                button.tap()
                print("IOS_NATIVE_REAL_FULL_PHOTOKIT_PROMPT_ACCEPTED")
                return
            }
        }
        XCTFail("Real iOS Photos permission has no Full Access action: "
            + alert.debugDescription)
    }

    /// iOS 18.5 sometimes exposes the real SwiftUI toolbar Menu as a
    /// non-hittable AX proxy despite a full-sized on-screen button. This is
    /// NOT permission to tap an invisible destination: require the exact
    /// labelled Menu, a genuine 44pt visible frame, a foreground app and no
    /// system/application alert before sending a user-visible Menu tap.
    private static func verifiedGalleryMoreFrame(
        _ menu: XCUIElement, in app: XCUIApplication
    ) -> Bool {
        guard menu.exists, app.state == .runningForeground,
              menu.label == "图库来源、备份与 xDrive",
              !app.alerts.firstMatch.exists,
              !XCUIApplication(bundleIdentifier: "com.apple.springboard")
                  .alerts.firstMatch.exists else { return false }
        let frame = menu.frame
        let screen = app.frame
        return frame.width >= 44 && frame.height >= 44 &&
            frame.intersects(screen) &&
            frame.midX >= screen.minX && frame.midX <= screen.maxX &&
            frame.midY >= screen.minY && frame.midY <= screen.maxY
    }

    static func visible(_ id: String, in app: XCUIApplication) -> XCUIElement {
        switch id {
        case "native-ios-tab-gallery", "native-ios-gallery-source-unified":
            let library = found("native-ios-photos-library-tab", in: app)
            return library.exists ? library : found(id, in: app)
        case "native-ios-gallery-source-albums":
            let collections = found("native-ios-photos-collections-tab", in: app)
            return collections.exists ? collections : found(id, in: app)
        case "native-ios-gallery-source-menu":
            let menu = found("native-ios-gallery-more-menu", in: app)
            return menu.exists ? menu : found(id, in: app)
        case "native-ios-gallery-source-local":
            let label = app.navigationBars["本机照片"].firstMatch
            return label.exists ? label : found(id, in: app)
        default:
            return found(id, in: app)
        }
    }

    // Files Home groups optional routes in genuine DisclosureGroups. An
    // absent lazy child cannot be "found" by tapping a hidden element.
    // Scroll the actual List first, then expand the real user-visible group.
    private static func tapFilesHomeDisclosureRoute(
        _ id: String, in app: XCUIApplication
    ) -> Bool {
        let list = app.collectionViews.firstMatch
        guard list.waitForExistence(timeout: 12) else { return false }
        let target = found(id, in: app)
        func scanVisibleRows() -> Bool {
            for _ in 0..<10 {
                if target.exists && target.isHittable {
                    target.tap()
                    return true
                }
                list.swipeUp()
            }
            return false
        }
        if scanVisibleRows() { return true }
        for _ in 0..<10 { list.swipeDown() }
        let groupName = id == "native-ios-files-open-favorites"
            ? "收藏夹和常用收藏" : "更多管理"
        let disclosure = app.buttons.matching(
            NSPredicate(format: "label CONTAINS %@", groupName)
        ).firstMatch
        for _ in 0..<10 {
            if disclosure.exists && disclosure.isHittable { break }
            list.swipeUp()
        }
        guard disclosure.exists && disclosure.isHittable else { return false }
        // If the target is already mounted the user has expanded the group.
        // Otherwise reveal it through the real DisclosureGroup button.
        if target.exists && target.isHittable {
            target.tap()
            return true
        }
        disclosure.tap()
        if target.exists && target.isHittable {
            target.tap()
            return true
        }
        return scanVisibleRows()
    }

    @discardableResult
    static func tap(_ id: String, in app: XCUIApplication) -> Bool {
        // Signed-out Photos uses the real PhotoKit media filter, not the
        // Owner-only unified search sheet. Both paths must remain hittable.
        if id == "native-ios-gallery-open-filters" {
            let ownerMenu = found(id, in: app)
            if ownerMenu.exists && ownerMenu.isHittable {
                ownerMenu.tap()
                let action = app.buttons["搜索与筛选"].firstMatch
                guard action.waitForExistence(timeout: 10) && action.isHittable
                else { return false }
                action.tap()
                return true
            }
            // In authenticated Gallery, SwiftUI may not hoist the retained
            // ZStack child's toolbar into the parent NavigationStack.
            // Use the genuine Photos bottom Search control to reach the
            // *same* verified Owner/PhotoKit filter editor. A signed-out
            // gallery must not enter that Owner-only reader.
            let unifiedWall = found("native-ios-unified-photo-gallery", in: app)
            if unifiedWall.exists {
                let nativeSearch = found("native-ios-photos-search", in: app)
                if nativeSearch.exists && nativeSearch.isHittable {
                    nativeSearch.tap()
                    let cancel = app.buttons["取消"].firstMatch
                    return cancel.waitForExistence(timeout: 10) && cancel.isHittable
                }
            }
            // Signed-out local PhotoKit exposes a native media Menu and a
            // separate Photos search editor. Existing return/Cancel journeys
            // must use a sheet with an actual Cancel action, not invent one
            // for a system Menu. Independently test the Menu's real choices.
            let localMenu = found("native-ios-local-gallery-media-filter", in: app)
            guard localMenu.exists && localMenu.isHittable else { return false }
            let localSearch = found("native-ios-photos-search", in: app)
            guard localSearch.exists && localSearch.isHittable else { return false }
            localSearch.tap()
            // Native PhotoKit metadata search uses Done, whereas the
            // authenticated Owner filter editor uses Cancel. Do not assert
            // a control that does not exist in the real local screen.
            let close = app.buttons["完成"].firstMatch
            return close.waitForExistence(timeout: 10) && close.isHittable
        }
        let direct = found(id, in: app)
        if direct.exists && direct.isHittable { direct.tap(); return true }
        if id == "native-ios-files-open-favorites" ||
           id == "native-ios-files-open-operations" {
            return tapFilesHomeDisclosureRoute(id, in: app)
        }
        // The original c83/b9 toolbar remains a real usable baseline.
        let legacy: [String: String] = [
            "native-ios-tab-files": "文件",
            "native-ios-tab-mine": "我的",
            "native-ios-tab-launcher": "全部",
            "native-ios-tab-gallery": "图库",
            "native-ios-tab-dynamic": "地图"
        ]
        if let title = legacy[id] {
            let old = app.buttons.matching(identifier: "native-ios-five-slot-bar")
                .matching(NSPredicate(format: "label == %@", title)).firstMatch
            if old.exists && old.isHittable { old.tap(); return true }
            // Archived b9/c83 use a real UIKit TabBar with SF Symbol IDs.
            // Follow only that exact visible tab, never a hidden candidate
            // TabView destination or synthetic navigation.
            let system = app.tabBars.buttons
                .matching(NSPredicate(format: "label == %@", title)).firstMatch
            if system.exists && system.isHittable { system.tap(); return true }
        }

        let idToGalleryTab: [String: String] = [
            "native-ios-gallery-source-unified": "native-ios-photos-library-tab",
            "native-ios-gallery-source-albums": "native-ios-photos-collections-tab",
            "native-ios-tab-gallery": "native-ios-photos-library-tab"
        ]
        if let actual = idToGalleryTab[id] {
            let action = found(actual, in: app)
            if action.exists && action.isHittable { action.tap(); return true }
        }
        // The genuine Photos timeline can temporarily replace both tabs
        // with Year/Month/All. Restore the real bar before navigating; never
        // attempt to tap a hidden SwiftUI TabView destination.
        if id == "native-ios-tab-gallery" ||
           id == "native-ios-gallery-source-unified" ||
           id == "native-ios-gallery-source-albums" {
            let compact = found("native-ios-photos-return-tabs", in: app)
            if compact.exists && compact.isHittable {
                compact.tap()
                let restoredID = id == "native-ios-gallery-source-albums"
                    ? "native-ios-photos-collections-tab"
                    : "native-ios-photos-library-tab"
                let restored = found(restoredID, in: app)
                guard restored.waitForExistence(timeout: 10) &&
                      restored.isHittable else { return false }
                restored.tap()
                return true
            }
        }

        // People is available both in an authenticated unified Gallery
        // menu and as the genuine Photos Collections destination. When
        // signed out there is no Owner-only filter menu to tap.
        if id == "native-ios-gallery-people" {
            let menu = found("native-ios-gallery-open-filters", in: app)
            if menu.exists && menu.isHittable {
                menu.tap()
                let action = app.buttons["人物与宠物"].firstMatch
                guard action.waitForExistence(timeout: 10) && action.isHittable
                else { return false }
                action.tap()
                return true
            }
            let collections = found("native-ios-photos-collections-tab", in: app)
            guard collections.exists && collections.isHittable else { return false }
            collections.tap()
            let people = found("native-ios-collections-people", in: app)
            if people.waitForExistence(timeout: 10) && people.isHittable {
                people.tap()
                return true
            }
            // Only scroll the real Collections sheet; an inaccessible
            // destination still fails rather than injecting a child view.
            let list = app.scrollViews.firstMatch
            for _ in 0..<5 {
                guard list.exists else { break }
                list.swipeUp()
                if people.exists && people.isHittable {
                    people.tap()
                    return true
                }
            }
            return false
        }
        if id == "native-ios-gallery-source-menu" {
            let menu = found("native-ios-gallery-more-menu", in: app)
            if (menu.exists && menu.isHittable) ||
               verifiedGalleryMoreFrame(menu, in: app) {
                menu.tap()
                return true
            }
        }

        let sourceCommands: [String: String] = [
            "native-ios-gallery-source-originals": "备份原件",
            "native-ios-gallery-source-cloud": "云端图库",
            "native-ios-gallery-source-local": "本机照片"
        ]
        let globalCommands: [String: String] = [
            "native-ios-tab-files": "文件",
            "native-ios-tab-mine": "我的",
            "native-ios-tab-launcher": "全部功能",
            "native-ios-tab-dynamic": "地图"
        ]
        if let title = sourceCommands[id] ?? globalCommands[id] {
            let menu = found("native-ios-gallery-more-menu", in: app)
            let normalHit = menu.exists && menu.isHittable
            guard normalHit || verifiedGalleryMoreFrame(menu, in: app) else {
                print("IOS_NATIVE_GALLERY_MORE_MENU_NOT_VISIBLE",
                      menu.debugDescription)
                return false
            }
            if !normalHit {
                print("IOS_NATIVE_GALLERY_MORE_AX_PROXY_FRAME_VERIFIED")
            }
            // A real first-use Photos permission alert can interrupt this
            // menu tap. After XCTest has actually dismissed the system alert,
            // retry the SAME visible menu once, not an invisible tab or fake
            // navigation route. Keep every failed route a real XCTest failure.
            for attempt in 0..<2 {
                guard (menu.exists && menu.isHittable) ||
                      verifiedGalleryMoreFrame(menu, in: app) else {
                    return false
                }
                menu.tap()
                // New Gallery options are genuine Buttons inside a
                // sectioned sheet. Legacy builds may still show MenuItems.
                // Prefer the actionable sheet row, without waiting eight
                // seconds for a MenuItem that cannot exist in this layout.
                let action = app.buttons.matching(
                    NSPredicate(format: "label == %@", title)).firstMatch
                if action.waitForExistence(timeout: attempt == 0 ? 8 : 5) &&
                   action.isHittable {
                    action.tap()
                    return true
                }
                let menuItem = app.menuItems.matching(
                    NSPredicate(format: "label == %@", title)).firstMatch
                if menuItem.exists && menuItem.isHittable {
                    menuItem.tap()
                    return true
                }
                if app.alerts.firstMatch.exists ||
                   XCUIApplication(bundleIdentifier: "com.apple.springboard")
                       .alerts.firstMatch.exists { return false }
            }
            return false
        }
        return false
    }
}

/// Real simulator app-exit and native tab/rail UI checks. This uses the actual
/// Dashboard and Files/Gallery screens, but has no authenticated Server Owner.
final class XDriveIOSNavigationRuntimeUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    /// The iOS Photos UI must not show the system five-slot TabBar below
    /// Library / Collections / Search. Test actual Simulator hit-testing.
    func testGalleryPhotosBarDoesNotStackSystemTabBar() {
        let app = XCUIApplication()
        app.launchArguments = ["-xdrive-ui-navigation-smoke"]
        app.launch()
        XCTAssertEqual(app.state, .runningForeground)
        let bar = app.descendants(matching: .any)
            .matching(identifier: "native-ios-photos-bottom-bar").firstMatch
        XCTAssertTrue(bar.waitForExistence(timeout: 20),
                      "Native Photos bottom bar did not mount")
        for id in ["native-ios-photos-library-tab",
                   "native-ios-photos-collections-tab",
                   "native-ios-photos-search"] {
            let button = app.buttons.matching(identifier: id).firstMatch
            XCTAssertTrue(button.waitForExistence(timeout: 10) && button.isHittable,
                          "Missing distinct native Photos control: \(id)")
        }
        for title in ["全部", "地图", "图库", "文件", "我的"] {
            let systemTab = app.tabBars.buttons.matching(
                NSPredicate(format: "label == %@", title)).firstMatch
            XCTAssertFalse(systemTab.exists && systemTab.isHittable,
                           "System UITabBar overlaps Photos chrome: \(title)")
        }
    }
    /// Local media-type Menu and search sheet are separate native Photos
    /// controls; neither may silently disappear when the cloud Owner is nil.
    func testSignedOutPhotoKitMediaFilterMenuRemainsReachable() {
        let app = XCUIApplication()
        app.launchArguments = ["-xdrive-ui-navigation-smoke"]
        app.launch()
        XDriveIOSNativePhotosTestNavigator.acceptInitialFullPhotosForNavigation(in: app)
        let menu = app.descendants(matching: .any)
            .matching(identifier: "native-ios-local-gallery-media-filter").firstMatch
        XCTAssertTrue(menu.waitForExistence(timeout: 20) && menu.isHittable,
                      "Real local PhotoKit media filter must exist")
        menu.tap()
        let choices = ["照片", "视频", "收藏", "实况", "截屏"]
        let visibleChoices = choices.filter { label in
            let action = app.menuItems[label].firstMatch
            let button = app.buttons[label].firstMatch
            let toggle = app.switches[label].firstMatch
            return (action.exists && action.isHittable) ||
                   (button.exists && button.isHittable) ||
                   (toggle.exists && toggle.isHittable)
        }
        XCTAssertGreaterThanOrEqual(visibleChoices.count, 2,
                                    "Actual PhotoKit filter Menu exposes no usable media choices")
        XCTAssertEqual(app.state, .runningForeground)
    }

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
        let exact = XDriveIOSNativePhotosTestNavigator.visible(identifier, in: app)
        if exact.exists && exact.isHittable { return exact }
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
        // Real tap markers align continuous H.264 with actionable AX routes.
        print("IOS_NATIVE_NAV_TAP_START route=\(identifier)")
        if !XDriveIOSNativePhotosTestNavigator.tap(identifier, in: app) {
            let control = find(identifier, in: app)
            XCTAssertTrue(control.exists && control.isHittable, "Missing actionable \(identifier)")
            control.tap()
        }
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
        // Archived c83 displayed the five destinations directly; the
        // candidate follows native Photos and must NEVER stack both bars.
        let legacy = app.buttons.matching(identifier: "native-ios-five-slot-bar")
            .matching(NSPredicate(format: "label == %@", "文件")).firstMatch
        if legacy.exists && legacy.isHittable {
            XCTAssertEqual(app.state, .runningForeground)
            return
        }
        let photos = find("native-ios-photos-bottom-bar", in: app)
        XCTAssertTrue(photos.waitForExistence(timeout: 15))
        XCTAssertFalse(find("native-ios-five-slot-bar", in: app).exists,
                       "Gallery must not show two bottom navigation bars")
        for id in ["native-ios-photos-library-tab",
                   "native-ios-photos-collections-tab", "native-ios-photos-search"] {
            XCTAssertTrue(find(id, in: app).exists, "Missing native Photos action " + id)
        }
        // All xDrive destinations remain reachable through real user taps
        // and keep distinct AX IDs on their own five-slot screen.
        select("native-ios-tab-files", in: app)
        XCTAssertTrue(find("native-ios-files-section-browse", in: app).exists)
        for name in ["launcher", "dynamic", "gallery", "files", "mine"] {
            let id = "native-ios-tab-\(name)"
            XCTAssertTrue(app.descendants(matching: .any)
                .matching(identifier: id).firstMatch.exists,
                "xDrive destination lost from non-Gallery bar: " + id)
        }
        select("native-ios-tab-gallery", in: app)
        XCTAssertTrue(find("native-ios-photos-bottom-bar", in: app).exists)
        XCTAssertFalse(find("native-ios-five-slot-bar", in: app).exists)
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
        // No authenticated Owner: the default unified source is the native
        // PhotoKit wall, not the Owner-scoped cloud filter toolbar.
        XCTAssertTrue(find("native-ios-local-timeline-open", in: app)
            .waitForExistence(timeout: 15),
                      "Signed-out PhotoKit wall disappeared after source return")
        XCTAssertTrue(find("native-ios-gallery-more-menu", in: app).isHittable,
                      "Gallery source options became inaccessible")
    }

    func testGalleryFilterCancelRestoresSameTab() {
        // The real unified filter editor is Owner-scoped. A synthetic Owner
        // has no bearer or private media access in this XCTest.
        let app = launch(syntheticOwner: true)
        select("native-ios-gallery-open-filters", in: app)
        let cancel = app.buttons["取消"].firstMatch.exists
            ? app.buttons["取消"].firstMatch : app.buttons["完成"].firstMatch
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
        // Restore the actual Browse rail first. A previous Recent/Favorites
        // route must not misdirect a deep Files Home operation.
        let browse = app.descendants(matching: .any)
            .matching(identifier: "native-ios-files-section-browse").firstMatch
        XCTAssertTrue(browse.waitForExistence(timeout: 15), "Files Browse rail is missing")
        if (browse.value as? String) != "已选择" {
            XCTAssertTrue(browse.isHittable, "Files Browse rail is obstructed")
            print("IOS_NATIVE_NAV_TAP_START route=native-ios-files-section-browse")
            browse.tap()
        }
        // Scan the real Files Home List, not an unrelated mounted TabView.
        let list = app.descendants(matching: .any)
            .matching(identifier: "native-ios-files-home-list").firstMatch
        XCTAssertTrue(list.waitForExistence(timeout: 15),
                      "Native Files Browse Home list is not mounted")
        let button = app.buttons.matching(identifier: identifier).firstMatch
        for _ in 0..<12 {
            if button.exists && button.isHittable { return button }
            list.swipeUp()
        }
        for _ in 0..<12 {
            if button.exists && button.isHittable { return button }
            list.swipeDown()
        }
        // Collapsed Files Home sections are not exposed in the lazy AX tree.
        // Open the real, visible group before requesting its child route.
        let sectionTitle: String? =
            identifier == "native-ios-files-open-operations" ? "更多管理" :
            identifier == "native-ios-files-open-favorites" ? "收藏夹和常用收藏" : nil
        if let sectionTitle {
            let disclosure = app.buttons.matching(
                NSPredicate(format: "label CONTAINS %@", sectionTitle)
            ).firstMatch
            for _ in 0..<12 {
                if disclosure.exists && disclosure.isHittable { break }
                list.swipeUp()
            }
            if disclosure.exists && disclosure.isHittable &&
               !(button.exists && button.isHittable) { disclosure.tap() }
            for _ in 0..<12 {
                if button.exists && button.isHittable { return button }
                list.swipeUp()
            }
        }
        if !(button.exists && button.isHittable) {
            print("FILES_HOME_UNREACHABLE " + identifier +
                  " AX hierarchy:\n" + app.debugDescription)
            let evidence = XCTAttachment(screenshot: app.screenshot())
            evidence.name = "files-home-unreachable-" + identifier
            evidence.lifetime = .keepAlways
            add(evidence)
        }
        XCTAssertTrue(button.exists && button.isHittable,
                      "Real Files Home entry remains unreachable: \(identifier)")
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
        print("IOS_NATIVE_NAV_TAP_START route=\(identifier)")
        if !XDriveIOSNativePhotosTestNavigator.tap(identifier, in: app) {
            let control = find(identifier, in: app)
            XCTAssertTrue(control.exists && control.isHittable,
                          "Native route missing before tap: \(identifier)")
            control.tap()
        }
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
        let cancel = app.buttons["取消"].firstMatch.exists
            ? app.buttons["取消"].firstMatch : app.buttons["完成"].firstMatch
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

    /// Directly mounts the REAL native Viewer through the DEBUG-only
    /// navigation harness. Five media kinds, two foreground cycles and
    /// repeated dismissal must not crash. No bearer or private file data:
    /// successful decoded-media playback is intentionally NOT claimed.
    func testFilesViewerFiveMediaKindsNoSessionForegroundAndDismissNoCrash() {
        let app = XCUIApplication()
        app.launchArguments = [
            "-xdrive-ui-navigation-smoke",
            "-xdrive-ui-navigation-synthetic-owner",
            "-xdrive-ui-files-viewer-no-session"
        ]
        app.launch()
        let root = app.descendants(matching: .any)
            .matching(identifier: "native-ios-files-viewer-smoke-root").firstMatch
        XCTAssertTrue(root.waitForExistence(timeout: 20),
                      "Debug-only file Viewer fixture did not mount")
        for kind in ["image", "video", "pdf", "audio", "text"] {
            let open = app.buttons["native-ios-files-viewer-smoke-" + kind].firstMatch
            if !open.waitForExistence(timeout: 15) {
                print("IOS_VIEWER_SMOKE_MISSING kind=" + kind
                      + " AX hierarchy:\n" + app.debugDescription)
                let evidence = XCTAttachment(screenshot: app.screenshot())
                evidence.name = "missing-real-viewer-launcher-" + kind
                evidence.lifetime = .keepAlways
                add(evidence)
            }
            XCTAssertTrue(open.exists, "Missing real Viewer launcher for " + kind)
            XCTAssertTrue(open.isHittable,
                          "Real Viewer launcher is present but not tappable for " + kind)
            print("IOS_NATIVE_NAV_TAP_START route=native-ios-files-viewer-smoke-" + kind)
            open.tap()
            let error = app.descendants(matching: .any)
                .matching(identifier: "native-ios-files-viewer-error-scroll").firstMatch
            XCTAssertTrue(error.waitForExistence(timeout: 20),
                          "No-Session Viewer did not fail closed for " + kind)
            XCTAssertEqual(app.state, .runningForeground,
                           "File Viewer lost the foreground process at " + kind)
            if kind == "video" || kind == "pdf" {
                XCUIDevice.shared.press(.home)
                XCTAssertNotEqual(app.state, .notRunning,
                                  "File Viewer process terminated in background at " + kind)
                app.activate()
                XCTAssertTrue(app.wait(for: .runningForeground, timeout: 18),
                              "File Viewer did not restore foreground at " + kind)
                XCTAssertTrue(error.waitForExistence(timeout: 20),
                              "File Viewer failed to repaint no-session state at " + kind)
            }
            let done = app.navigationBars.buttons["完成"].firstMatch
            XCTAssertTrue(done.waitForExistence(timeout: 15),
                          "File Viewer lost its Done escape at " + kind)
            print("IOS_NATIVE_NAV_TAP_START route=native-ios-files-viewer-smoke-done")
            done.tap()
            XCTAssertTrue(root.waitForExistence(timeout: 15),
                          "File Viewer modal did not return to its root at " + kind)
            XCTAssertTrue(open.waitForExistence(timeout: 15),
                          "File Viewer changed its root launcher after " + kind)
            XCTAssertEqual(app.state, .runningForeground)
        }
        let proof = XCTAttachment(screenshot: app.screenshot())
        proof.name = "files-viewer-five-no-session-types-foreground-dismiss"
        proof.lifetime = .keepAlways
        add(proof)
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


    // Regression: the old toolbar Menu could exist in the real Simulator
    // AX hierarchy while failing hit testing, blocking every child route.
    // All six cases below operate actual SwiftUI controls (not hidden tabs).
    private func openReachableGalleryOptions(_ app: XCUIApplication) {
        XDriveIOSNativePhotosTestNavigator.acceptInitialFullPhotosForNavigation(in: app)
        let more = app.buttons.matching(
            identifier: "native-ios-gallery-more-menu").firstMatch
        XCTAssertTrue(more.waitForExistence(timeout: 20) && more.isHittable,
                      "Visible Gallery More button must be genuinely tappable")
        print("IOS_NATIVE_NAV_TAP_START route=native-ios-gallery-more-menu")
        more.tap()
        let done = app.buttons.matching(
            identifier: "native-ios-gallery-options-done").firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 15) && done.isHittable,
                      "Gallery options did not expose an actionable Done button")
    }

    private func chooseReachableGalleryOption(
        _ label: String, in app: XCUIApplication
    ) {
        openReachableGalleryOptions(app)
        let action = app.buttons.matching(
            NSPredicate(format: "label == %@", label)).firstMatch
        // The actual options List may need a swipe on compact iPhones.
        for _ in 0..<5 {
            if action.exists && action.isHittable { break }
            let list = app.collectionViews.firstMatch.exists
                ? app.collectionViews.firstMatch : app.scrollViews.firstMatch
            guard list.exists else { break }
            list.swipeUp()
        }
        XCTAssertTrue(action.waitForExistence(timeout: 12) && action.isHittable,
                      "Gallery option is not reachable: \(label)")
        print("IOS_NATIVE_NAV_TAP_START route=native-ios-gallery-option-\(label)")
        action.tap()
        XCTAssertEqual(app.state, .runningForeground,
                       "Gallery option exited the native app: \(label)")
    }

    private func assertSingleNativePhotosBar(_ app: XCUIApplication) {
        let photosBar = app.descendants(matching: .any)
            .matching(identifier: "native-ios-photos-bottom-bar").firstMatch
        XCTAssertTrue(photosBar.waitForExistence(timeout: 15),
                      "Photos bottom bar disappeared")
        for title in ["全部", "地图", "图库", "文件", "我的"] {
            let system = app.tabBars.buttons.matching(
                NSPredicate(format: "label == %@", title)).firstMatch
            XCTAssertFalse(system.exists && system.isHittable,
                           "Second native TabBar is hit-testable: \(title)")
        }
    }

    func testGalleryOptionsMoreButtonIsTappableAndDismisses() {
        let app = launch()
        openReachableGalleryOptions(app)
        for title in ["全部照片", "本机照片", "云端图库", "备份原件",
                      "地图", "文件", "全部功能", "我的"] {
            let item = app.buttons.matching(
                NSPredicate(format: "label == %@", title)).firstMatch
            // A native List may lazily expose the last rows only when scrolled.
            // Actually reveal them instead of mistaking virtualization for
            // an inaccessible command or claiming an invisible row is usable.
            for _ in 0..<6 {
                if item.exists && item.isHittable { break }
                let list = app.collectionViews.firstMatch.exists
                    ? app.collectionViews.firstMatch : app.scrollViews.firstMatch
                guard list.exists else { break }
                list.swipeUp()
            }
            XCTAssertTrue(item.exists && item.isHittable,
                          "Inaccessible Gallery option: \(title)")
        }
        let close = app.buttons.matching(
            identifier: "native-ios-gallery-options-done").firstMatch
        print("IOS_NATIVE_NAV_TAP_START route=native-ios-gallery-options-done")
        close.tap()
        assertSingleNativePhotosBar(app)
        XCTAssertEqual(app.state, .runningForeground)
    }

    func testGalleryOptionsFilesRoundTripsWithoutDuplicateTabBar() {
        let app = launch()
        for cycle in 0..<3 {
            chooseReachableGalleryOption("文件", in: app)
            XCTAssertTrue(find("native-ios-files-section-browse", in: app)
                .waitForExistence(timeout: 15), "Files did not mount: \(cycle)")
            XCTAssertFalse(find("native-ios-photos-bottom-bar", in: app).exists,
                           "Photos bar overlapped Files navigation")
            select("native-ios-tab-gallery", in: app)
            assertSingleNativePhotosBar(app)
        }
    }

    func testGalleryOptionsLocalPhotosAndUnifiedSourceKeepNativeShell() {
        let app = launch()
        chooseReachableGalleryOption("本机照片", in: app)
        XCTAssertTrue(find("native-ios-local-timeline-open", in: app)
            .waitForExistence(timeout: 15), "Actual local PhotoKit page missing")
        chooseReachableGalleryOption("全部照片", in: app)
        XCTAssertTrue(find("native-ios-local-timeline-open", in: app)
            .waitForExistence(timeout: 15), "Signed-out unified PhotoKit wall missing")
        assertSingleNativePhotosBar(app)
    }

    func testGalleryOptionsOriginalsToFilesToGalleryRemainsNative() {
        let app = launch(syntheticOwner: true)
        chooseReachableGalleryOption("备份原件", in: app)
        XCTAssertTrue(find("native-ios-cloud-original-layout-help", in: app)
            .waitForExistence(timeout: 15), "Originals child shell was lost")
        chooseReachableGalleryOption("文件", in: app)
        XCTAssertTrue(find("native-ios-files-section-browse", in: app)
            .waitForExistence(timeout: 15), "Files shell lost after Originals")
        select("native-ios-tab-gallery", in: app)
        assertSingleNativePhotosBar(app)
        XCTAssertEqual(app.state, .runningForeground)
    }

    func testGalleryOptionsCollectionsFilesAndLibraryReturn() {
        let app = launch()
        select("native-ios-gallery-source-albums", in: app)
        XCTAssertTrue(app.navigationBars["精选集"].firstMatch
            .waitForExistence(timeout: 15), "Collections did not mount")
        chooseReachableGalleryOption("文件", in: app)
        XCTAssertTrue(find("native-ios-files-section-browse", in: app)
            .waitForExistence(timeout: 15), "Files did not mount from Collections")
        select("native-ios-tab-gallery", in: app)
        chooseReachableGalleryOption("全部照片", in: app)
        assertSingleNativePhotosBar(app)
    }

    func testGalleryOptionsLauncherAndMineRoutesKeepFilesReachable() {
        let app = launch()
        chooseReachableGalleryOption("全部功能", in: app)
        XCTAssertTrue(find("native-ios-launcher-search", in: app)
            .waitForExistence(timeout: 15), "Launcher not mounted from Gallery")
        select("native-ios-tab-gallery", in: app)
        chooseReachableGalleryOption("我的", in: app)
        XCTAssertTrue(find("native-ios-mine-server-account", in: app)
            .waitForExistence(timeout: 15), "Mine not mounted from Gallery")
        select("native-ios-tab-files", in: app)
        XCTAssertTrue(find("native-ios-files-section-browse", in: app)
            .waitForExistence(timeout: 15), "Files not mounted after Mine")
        select("native-ios-tab-gallery", in: app)
        assertSingleNativePhotosBar(app)
    }

    func testGalleryOptionsForegroundDismissFilesReturnDoesNotLoseRoute() {
        let app = launch()
        openReachableGalleryOptions(app)
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertEqual(app.state, .runningForeground)
        let done = app.buttons.matching(
            identifier: "native-ios-gallery-options-done").firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 15),
                      "Options should not turn into a blank page on foreground")
        done.tap()
        chooseReachableGalleryOption("文件", in: app)
        XCTAssertTrue(find("native-ios-files-section-browse", in: app)
            .waitForExistence(timeout: 15))
        select("native-ios-tab-gallery", in: app)
        assertSingleNativePhotosBar(app)
    }

}
