import XCTest
import UIKit

/// Actual no-Session SwiftUI routes with a synthetic Owner and no bearer.
/// These are native mount/Back/AX regressions, NOT a real signed-iPhone FPS test.
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
        let control = element(id, app)
        XCTAssertTrue(control.waitForExistence(timeout: 15),
                      "Missing native route: \(id)")
        control.tap()
        XCTAssertEqual(app.state, .runningForeground)
    }

    private func files(_ app: XCUIApplication) {
        tap("native-ios-tab-files", app)
        XCTAssertTrue(element("native-ios-files-section-browse", app)
            .waitForExistence(timeout: 15))
    }

    private func expect(_ id: String, _ app: XCUIApplication) {
        XCTAssertTrue(element(id, app).waitForExistence(timeout: 15),
                      "Missing fail-closed recovery page: \(id)")
        XCTAssertEqual(app.state, .runningForeground)
    }

    func testCloudFolderNoSessionIsSmallNativeRecoveryInsteadOfFilesList() {
        let app = launch()
        files(app)
        tap("native-ios-files-open-root-location", app)
        expect("native-ios-files-error-page", app)
        XCTAssertFalse(element("native-ios-files-grid", app).exists)
        XCTAssertFalse(element("native-ios-files-retry", app).exists)
        tap("native-ios-files-error-return", app)
        expect("native-ios-files-section-browse", app)
    }

    func testRecentlyDeletedNoSessionDoesNotMountDestructiveRows() {
        let app = launch()
        files(app)
        tap("native-ios-files-open-trash", app)
        expect("native-ios-files-trash-error-page", app)
        XCTAssertFalse(element("native-ios-files-trash-retry", app).exists)
        let destructive = app.buttons.matching(
            NSPredicate(format: "identifier BEGINSWITH %@",
                        "native-ios-files-trash-delete-")
        ).firstMatch
        XCTAssertFalse(destructive.exists)
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
    }

    func testNoSessionCloudReturnAfterGalleryAlbumRoundtrip() {
        let app = launch()
        tap("native-ios-gallery-source-albums", app)
        expect("native-ios-gallery-source-unified", app)
        files(app)
        tap("native-ios-files-open-root-location", app)
        expect("native-ios-files-error-page", app)
        tap("native-ios-files-error-return", app)
        tap("native-ios-tab-gallery", app)
        expect("native-ios-gallery-source-unified", app)
    }

    func testNoSessionTrashReturnAfterGalleryFilterDismissal() {
        let app = launch()
        files(app)
        tap("native-ios-files-open-trash", app)
        expect("native-ios-files-trash-error-page", app)
        tap("native-ios-files-trash-error-return", app)
        tap("native-ios-tab-gallery", app)
        tap("native-ios-gallery-open-filters", app)
        let cancel = app.buttons["取消"].firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 15))
        cancel.tap()
        expect("native-ios-gallery-source-unified", app)
    }

    func testRepeatedDeniedCloudDoesNotRenderProtectedRowsOrRetry() {
        let app = launch()
        files(app)
        for _ in 0..<3 {
            tap("native-ios-files-open-root-location", app)
            expect("native-ios-files-error-page", app)
            XCTAssertFalse(element("native-ios-files-grid", app).exists)
            XCTAssertFalse(element("native-ios-files-retry", app).exists)
            tap("native-ios-files-error-return", app)
            expect("native-ios-files-section-browse", app)
        }
    }

    func testRepeatedDeniedTrashDoesNotRenderDestructiveRowsOrRetry() {
        let app = launch()
        files(app)
        for _ in 0..<3 {
            tap("native-ios-files-open-trash", app)
            expect("native-ios-files-trash-error-page", app)
            XCTAssertFalse(element("native-ios-files-trash-retry", app).exists)
            tap("native-ios-files-trash-error-return", app)
            expect("native-ios-files-section-browse", app)
        }
    }
}
