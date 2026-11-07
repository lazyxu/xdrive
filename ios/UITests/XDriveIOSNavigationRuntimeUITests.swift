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
    private func find(_ identifier: String, in app: XCUIApplication) -> XCUIElement {
        // SwiftUI may surface its nested custom toolbar as an "Other" element.
        // Query the exact identifier, not an assumed AX element type.
        let element = app.descendants(matching: .any)
            .matching(identifier: identifier).firstMatch
        if !element.waitForExistence(timeout: 20) {
            print("NAV_SMOKE missing \(identifier); app state=\(app.state.rawValue)")
            print("NAV_SMOKE hierarchy:\n\(app.debugDescription)")
            let capture = XCTAttachment(screenshot: app.screenshot())
            capture.name = "missing-\(identifier)"
            capture.lifetime = .keepAlways
            add(capture)
        }
        return element
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
}
