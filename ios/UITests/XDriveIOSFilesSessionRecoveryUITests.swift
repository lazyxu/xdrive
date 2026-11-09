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
        // Observe the actual tap, not only the start of the XCTest case.
        print("IOS_NATIVE_NAV_TAP_START route=\(id)")
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

    /// Repeating iOS foreground reactivation must not turn a locally denied
    /// Trash route into a partially authorized, destructive list.
    func testTrashDenialAcrossRepeatedForegroundActivationsStaysReadOnly() {
        let app = launch()
        files(app)
        tap("native-ios-files-open-trash", app)
        expect("native-ios-files-trash-error-page", app)
        for _ in 0..<3 {
            XCUIDevice.shared.press(.home)
            app.activate()
            expect("native-ios-files-trash-error-page", app)
            XCTAssertFalse(element("native-ios-files-trash-retry", app).exists)
            XCTAssertFalse(element("native-ios-files-trash-restore-0", app).exists)
        }
        tap("native-ios-files-trash-error-return", app)
        expect("native-ios-files-section-browse", app)
    }

    /// Files' rail must remain independent of the denied Server folder tree,
    /// even if Recent/Favorites were opened immediately before Cloud.
    func testFilesQuickRailThenCloudDenialKeepsProtectedGridAbsent() {
        let app = launch()
        files(app)
        for section in ["recent", "favorites", "browse"] {
            tap("native-ios-files-section-\(section)", app)
            expect("native-ios-files-section-browse", app)
        }
        tap("native-ios-files-open-root-location", app)
        expect("native-ios-files-error-page", app)
        XCTAssertFalse(element("native-ios-files-grid", app).exists)
        tap("native-ios-files-error-return", app)
        tap("native-ios-tab-gallery", app)
        expect("native-ios-gallery-source-unified", app)
    }

    func testCloudDenialGalleryFilterFilesReturnCanReenterDeniedChild() {
        let app = launch()
        files(app)
        tap("native-ios-files-open-root-location", app)
        expect("native-ios-files-error-page", app)
        tap("native-ios-files-error-return", app)
        tap("native-ios-tab-gallery", app)
        tap("native-ios-gallery-open-filters", app)
        let cancel = app.buttons["取消"].firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 15))
        cancel.tap()
        tap("native-ios-tab-files", app)
        expect("native-ios-files-section-browse", app)
        tap("native-ios-files-open-root-location", app)
        expect("native-ios-files-error-page", app)
        XCTAssertFalse(element("native-ios-files-retry", app).exists)
        tap("native-ios-files-error-return", app)
    }

    func testTrashDenialPeopleBackThenTrashDenialDoesNotLeakRows() {
        let app = launch()
        files(app)
        tap("native-ios-files-open-trash", app)
        expect("native-ios-files-trash-error-page", app)
        tap("native-ios-files-trash-error-return", app)
        tap("native-ios-tab-gallery", app)
        tap("native-ios-gallery-people", app)
        expect("native-ios-gallery-people-page", app)
        let back = app.navigationBars.buttons.element(boundBy: 0)
        XCTAssertTrue(back.waitForExistence(timeout: 15))
        back.tap()
        expect("native-ios-gallery-source-unified", app)
        files(app)
        tap("native-ios-files-open-trash", app)
        expect("native-ios-files-trash-error-page", app)
        XCTAssertFalse(element("native-ios-files-trash-retry", app).exists)
        tap("native-ios-files-trash-error-return", app)
    }

    /// Capture native fail-closed pixels at both child routes before AX
    /// enumeration can mask a broken navigation shell with a 120s timeout.
    func testCloudAndTrashDenialsCaptureVisibleNativeRecoveryScreens() {
        let app = launch()
        files(app)
        for route in [
            ("native-ios-files-open-root-location", "native-ios-files-error-page",
             "native-ios-files-error-return"),
            ("native-ios-files-open-trash", "native-ios-files-trash-error-page",
             "native-ios-files-trash-error-return"),
        ] {
            tap(route.0, app)
            let shot = XCTAttachment(screenshot: app.screenshot())
            shot.name = route.1 + "-visible-recovery"
            shot.lifetime = .keepAlways
            add(shot)
            expect(route.1, app)
            tap(route.2, app)
            expect("native-ios-files-section-browse", app)
        }
    }

    /// Recent and Favorites can live below the fold in native Files Home.
    /// Search this Home List only; never force an unreadable child AX tree.
    private func openHomeShortcut(_ id: String, _ app: XCUIApplication) {
        let item = element(id, app)
        if !item.exists {
            // SwiftUI List is exposed as a table or collection depending
            // on Simulator/iOS version; do not assume the AX container type.
            let collection = app.collectionViews.firstMatch
            let list = collection.exists ? collection : app.tables.firstMatch
            if list.exists {
                // A prior child can leave the Home list below Recent.
                // Search in both directions with a bounded swipe budget.
                for _ in 0..<5 {
                    if item.exists { break }
                    list.swipeUp()
                }
                for _ in 0..<10 {
                    if item.exists { break }
                    list.swipeDown()
                }
            }
        }
        tap(id, app)
    }

    func testRecentShortcutNoSessionShowsReadOnlyNativeRecovery() {
        let app = launch()
        files(app)
        openHomeShortcut("native-ios-files-open-recent", app)
        expect("native-ios-files-recent-error-page", app)
        XCTAssertFalse(element("native-ios-files-grid", app).exists)
        XCTAssertFalse(element("native-ios-files-recent-retry", app).exists)
        tap("native-ios-files-recent-error-return", app)
        expect("native-ios-files-section-browse", app)
    }

    func testFavoritesShortcutNoSessionShowsReadOnlyNativeRecovery() {
        let app = launch()
        files(app)
        openHomeShortcut("native-ios-files-open-favorites", app)
        expect("native-ios-files-favorites-error-page", app)
        XCTAssertFalse(element("native-ios-files-grid", app).exists)
        XCTAssertFalse(element("native-ios-files-favorites-retry", app).exists)
        tap("native-ios-files-favorites-error-return", app)
        expect("native-ios-files-section-browse", app)
    }

    func testRecentAfterTrashDeniedKeepsGalleryMounted() {
        let app = launch()
        files(app)
        tap("native-ios-files-open-trash", app)
        expect("native-ios-files-trash-error-page", app)
        tap("native-ios-files-trash-error-return", app)
        openHomeShortcut("native-ios-files-open-recent", app)
        expect("native-ios-files-recent-error-page", app)
        tap("native-ios-files-recent-error-return", app)
        tap("native-ios-tab-gallery", app)
        expect("native-ios-gallery-source-unified", app)
    }

    func testFavoritesAfterCloudDeniedKeepsGalleryMounted() {
        let app = launch()
        files(app)
        tap("native-ios-files-open-root-location", app)
        expect("native-ios-files-error-page", app)
        tap("native-ios-files-error-return", app)
        openHomeShortcut("native-ios-files-open-favorites", app)
        expect("native-ios-files-favorites-error-page", app)
        tap("native-ios-files-favorites-error-return", app)
        tap("native-ios-tab-gallery", app)
        expect("native-ios-gallery-source-unified", app)
    }

    func testRecentFavoritesQuickRailDeniedThenAlbumsRemainUsable() {
        let app = launch()
        files(app)
        openHomeShortcut("native-ios-files-open-recent", app)
        expect("native-ios-files-recent-error-page", app)
        tap("native-ios-files-recent-error-return", app)
        for section in ["recent", "favorites", "browse"] {
            tap("native-ios-files-section-\(section)", app)
            expect("native-ios-files-section-browse", app)
        }
        openHomeShortcut("native-ios-files-open-favorites", app)
        expect("native-ios-files-favorites-error-page", app)
        XCTAssertFalse(element("native-ios-files-grid", app).exists)
        tap("native-ios-files-favorites-error-return", app)
        tap("native-ios-tab-gallery", app)
        tap("native-ios-gallery-source-albums", app)
        expect("native-ios-gallery-source-unified", app)
    }

    func testRecentFavoritesRepeatedDenialsNeverRetainOldScope() {
        let app = launch()
        files(app)
        for _ in 0..<2 {
            openHomeShortcut("native-ios-files-open-recent", app)
            expect("native-ios-files-recent-error-page", app)
            XCTAssertFalse(element("native-ios-files-recent-retry", app).exists)
            tap("native-ios-files-recent-error-return", app)
            openHomeShortcut("native-ios-files-open-favorites", app)
            expect("native-ios-files-favorites-error-page", app)
            XCTAssertFalse(element("native-ios-files-favorites-retry", app).exists)
            tap("native-ios-files-favorites-error-return", app)
            expect("native-ios-files-section-browse", app)
        }
        app.terminate()
        app.launchArguments = ["-xdrive-ui-navigation-smoke"]
        app.launch()
        XCTAssertEqual(app.state, .runningForeground)
        files(app)
        // Files Home keeps the shortcut visible after logout, but the
        // now-missing Owner makes it non-interactive; stale rows stay retired.
        let recent = element("native-ios-files-open-recent", app)
        XCTAssertTrue(recent.waitForExistence(timeout: 15))
        XCTAssertFalse(recent.isEnabled,
                       "Signed-out Files Home must not enter Recent")
    }

    func testRecentFavoritesErrorScreensHaveActualSimulatorEvidence() {
        let app = launch()
        files(app)
        for route in [
            ("native-ios-files-open-recent", "native-ios-files-recent-error-page",
             "native-ios-files-recent-error-return"),
            ("native-ios-files-open-favorites", "native-ios-files-favorites-error-page",
             "native-ios-files-favorites-error-return"),
        ] {
            openHomeShortcut(route.0, app)
            let screenshot = XCTAttachment(screenshot: app.screenshot())
            screenshot.name = route.1 + "-before-AX"
            screenshot.lifetime = .keepAlways
            add(screenshot)
            expect(route.1, app)
            tap(route.2, app)
            expect("native-ios-files-section-browse", app)
        }
    }

}
