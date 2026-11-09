import XCTest

/// Real SwiftUI routing on an iOS 18.5 Simulator. The synthetic Owner has
/// NO active Session, token or protected Server grant. Successful UI recovery
/// is never reported as successful Server file access or measured frame rate.
final class XDriveIOSFilesSessionRecoveryUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    private func launch(owner: Bool = true) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-xdrive-ui-navigation-smoke"]
        if owner { app.launchArguments.append("-xdrive-ui-navigation-synthetic-owner") }
        app.launch()
        XCTAssertEqual(app.state, .runningForeground)
        return app
    }

    private func element(_ id: String, _ app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func tap(_ id: String, _ app: XCUIApplication) {
        let target = element(id, app)
        XCTAssertTrue(target.waitForExistence(timeout: 15), "Missing native route: \\(id)")
        target.tap()
        XCTAssertEqual(app.state, .runningForeground, "App exited after \\(id)")
    }

    private func files(_ app: XCUIApplication) {
        tap("native-ios-tab-files", app)
        XCTAssertTrue(element("native-ios-files-section-browse", app)
            .waitForExistence(timeout: 12))
    }

    private func expect(_ id: String, _ app: XCUIApplication) {
        XCTAssertTrue(element(id, app).waitForExistence(timeout: 12),
                      "Expected small native no-Session surface \\(id)")
        XCTAssertEqual(app.state, .runningForeground)
    }

    func testCloudFolderNoSessionIsSmallNativeRecoveryInsteadOfFilesList() {
        let app = launch()
        files(app)
        tap("native-ios-files-open-root-location", app)
        expect("native-ios-files-error-page", app)
        XCTAssertTrue(app.staticTexts["当前账户未完成登录验证"].exists)
        XCTAssertFalse(element("native-ios-files-grid", app).exists,
                       "No token must not materialize a protected file grid")
        tap("native-ios-files-error-return", app)
        expect("native-ios-files-section-browse", app)
    }

    func testRecentlyDeletedNoSessionDoesNotMountDestructiveRows() {
        let app = launch()
        files(app)
        tap("native-ios-files-open-trash", app)
        expect("native-ios-files-trash-error-page", app)
        let delete = app.buttons.matching(
            NSPredicate(format: "identifier BEGINSWITH %@",
                        "native-ios-files-trash-delete-")
        ).firstMatch
        XCTAssertFalse(delete.exists, "Unauthenticated Trash showed a delete action")
        tap("native-ios-files-trash-error-return", app)
        expect("native-ios-files-section-browse", app)
    }

    func testCloudRetryCannotPromoteSyntheticOwnerIntoAuthenticatedReader() {
        let app = launch()
        files(app)
        tap("native-ios-files-open-root-location", app)
        expect("native-ios-files-error-page", app)
        for _ in 0..<2 {
            tap("native-ios-files-retry", app)
            expect("native-ios-files-error-page", app)
            XCTAssertFalse(element("native-ios-files-grid", app).exists)
        }
        tap("native-ios-files-error-return", app)
        expect("native-ios-files-section-browse", app)
    }

    func testTrashRetryCannotRestoreUnverifiedDeletionActions() {
        let app = launch()
        files(app)
        tap("native-ios-files-open-trash", app)
        expect("native-ios-files-trash-error-page", app)
        tap("native-ios-files-trash-retry", app)
        expect("native-ios-files-trash-error-page", app)
        XCTAssertFalse(element("native-ios-files-trash-restore-0", app).exists)
        tap("native-ios-files-trash-error-return", app)
        expect("native-ios-files-section-browse", app)
    }

    func testAlternatingDeniedCloudAndTrashChildrenKeepsHomeRail() {
        let app = launch()
        files(app)
        for _ in 0..<2 {
            tap("native-ios-files-open-root-location", app)
            expect("native-ios-files-error-page", app)
            tap("native-ios-files-error-return", app)
            expect("native-ios-files-section-browse", app)
            tap("native-ios-files-open-trash", app)
            expect("native-ios-files-trash-error-page", app)
            tap("native-ios-files-trash-error-return", app)
            expect("native-ios-files-section-browse", app)
        }
    }

    func testDeniedChildBackgroundResumeRetainsExplicitRecoveryAndGallery() {
        let app = launch()
        files(app)
        tap("native-ios-files-open-root-location", app)
        expect("native-ios-files-error-page", app)
        XCUIDevice.shared.press(.home)
        app.activate()
        expect("native-ios-files-error-page", app)
        let captured = app.screenshot()
        XCTAssertGreaterThan(captured.image.size.height, 0)
        tap("native-ios-files-error-return", app)
        tap("native-ios-tab-gallery", app)
        expect("native-ios-gallery-source-unified", app)
    }

    func testSignedOutOwnerCannotExposeCloudLocationAfterRelaunch() {
        let app = launch()
        files(app)
        expect("native-ios-files-open-root-location", app)
        app.terminate()
        app.launchArguments = ["-xdrive-ui-navigation-smoke"]
        app.launch()
        XCTAssertEqual(app.state, .runningForeground)
        files(app)
        XCTAssertFalse(element("native-ios-files-open-root-location", app).exists)
        tap("native-ios-tab-gallery", app)
        expect("native-ios-gallery-source-unified", app)
    }
}
