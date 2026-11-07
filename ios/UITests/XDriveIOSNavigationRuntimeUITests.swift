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
        return app
    }
    private func select(_ identifier: String, in app: XCUIApplication) {
        let control = app.buttons[identifier]
        XCTAssertTrue(control.waitForExistence(timeout: 20), "Missing \(identifier)")
        control.tap()
        XCTAssertEqual(app.state, .runningForeground, "App exited at \(identifier)")
    }
    func testFilesFirstOpenAndSixGalleryReturnsDoNotExit() {
        let app = launch()
        XCTAssertTrue(app.buttons["native-ios-tab-gallery"].waitForExistence(timeout: 25))
        for index in 0..<6 {
            select("native-ios-tab-files", in: app)
            XCTAssertTrue(app.buttons["native-ios-files-section-browse"].waitForExistence(timeout: 20),
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
                XCTAssertTrue(app.buttons["native-ios-files-section-browse"].waitForExistence(timeout: 15))
            }
        }
        XCTAssertEqual(app.state, .runningForeground)
    }
    func testSyntheticOwnerFilesRootDoesNotCrashOnAuthFailure() {
        let app = launch(syntheticOwner: true)
        select("native-ios-tab-files", in: app)
        let root = app.buttons["native-ios-files-open-root-location"]
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
    func testFilesTopLevelNavigationRemainsResponsive() {
        let app = launch()
        for tab in ["files", "mine", "files", "launcher", "files", "gallery"] {
            select("native-ios-tab-\(tab)", in: app)
        }
        XCTAssertEqual(app.state, .runningForeground)
    }
}
