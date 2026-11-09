import XCTest
import UIKit

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
    // Settled, small-sample frame check. This cannot prove that no individual
    // 60/120Hz frame flashed during an animated route transition.
    private func assertNonuniformFrame(_ app: XCUIApplication, _ label: String) {
        let shot = app.screenshot()
        guard let source = shot.image.cgImage else {
            XCTFail("Missing real Simulator frame: " + label)
            return
        }
        let width = 24, height = 32
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let drawn = pixels.withUnsafeMutableBytes { bytes -> Bool in
            guard let pointer = bytes.baseAddress,
                  let context = CGContext(
                    data: pointer, width: width, height: height,
                    bitsPerComponent: 8, bytesPerRow: width * 4,
                    space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                  ) else { return false }
            context.draw(source, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        XCTAssertTrue(drawn, "Could not sample native frame after " + label)
        guard drawn else { return }
        let colors = Set(stride(from: 0, to: pixels.count, by: 4).map { i in
            (Int(pixels[i]) << 16) |
            (Int(pixels[i + 1]) << 8) | Int(pixels[i + 2])
        })
        XCTAssertGreaterThan(colors.count, 8, "Visually blank native page: " + label)
    }

    func testNoSessionCloudReturnAfterGalleryAlbumRoundtrip() {
        let app = launch()
        tap("native-ios-tab-gallery", app)
        tap("native-ios-gallery-source-albums", app)
        expect("native-ios-gallery-source-unified", app)
        files(app)
        tap("native-ios-files-open-root-location", app)
        expect("native-ios-files-error-page", app)
        tap("native-ios-files-error-return", app)
        tap("native-ios-tab-gallery", app)
        expect("native-ios-gallery-source-unified", app)
        assertNonuniformFrame(app, "Gallery after denied Cloud Files")
    }

    func testNoSessionTrashReturnAfterGalleryFilterDismissal() {
        let app = launch()
        tap("native-ios-tab-gallery", app)
        tap("native-ios-gallery-open-filters", app)
        let cancel = app.buttons["取消"].firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 15))
        cancel.tap()
        files(app)
        tap("native-ios-files-open-trash", app)
        expect("native-ios-files-trash-error-page", app)
        tap("native-ios-files-trash-error-return", app)
        tap("native-ios-tab-gallery", app)
        expect("native-ios-gallery-source-unified", app)
    }

    func testNoSessionCloudRetryThenImmediateBackNeverReopensOldChild() {
        let app = launch()
        files(app)
        for _ in 0..<3 {
            tap("native-ios-files-open-root-location", app)
            expect("native-ios-files-error-page", app)
            tap("native-ios-files-retry", app)
            tap("native-ios-files-error-return", app)
            expect("native-ios-files-section-browse", app)
            XCTAssertFalse(element("native-ios-files-error-page", app).exists)
        }
        // The cancelled verification must never repush the old destination.
        Thread.sleep(forTimeInterval: 0.6)
        expect("native-ios-files-section-browse", app)
        XCTAssertEqual(app.state, .runningForeground)
    }

    func testNoSessionTrashRetryThenImmediateBackCannotExposeDeletion() {
        let app = launch()
        files(app)
        for _ in 0..<2 {
            tap("native-ios-files-open-trash", app)
            expect("native-ios-files-trash-error-page", app)
            tap("native-ios-files-trash-retry", app)
            tap("native-ios-files-trash-error-return", app)
            expect("native-ios-files-section-browse", app)
        }
        Thread.sleep(forTimeInterval: 0.6)
        XCTAssertFalse(element("native-ios-files-trash-error-page", app).exists)
        XCTAssertEqual(app.state, .runningForeground)
    }

    func testNoSessionTrashRecoverySurvivesRepeatedForegroundActivation() {
        let app = launch()
        files(app)
        tap("native-ios-files-open-trash", app)
        expect("native-ios-files-trash-error-page", app)
        for _ in 0..<2 {
            XCUIDevice.shared.press(.home)
            app.activate()
            expect("native-ios-files-trash-error-page", app)
        }
        tap("native-ios-files-trash-error-return", app)
        expect("native-ios-files-section-browse", app)
        assertNonuniformFrame(app, "Files after Trash foreground recovery")
    }

    func testNoSessionFilesQuickRailSwitchDoesNotExposeCloudChildren() {
        let app = launch()
        files(app)
        for section in ["recent", "favorites", "browse", "recent", "browse"] {
            tap("native-ios-files-section-\(section)", app)
            expect("native-ios-files-section-browse", app)
        }
        tap("native-ios-files-open-root-location", app)
        expect("native-ios-files-error-page", app)
        XCTAssertFalse(element("native-ios-files-grid", app).exists)
        tap("native-ios-files-error-return", app)
        expect("native-ios-files-section-browse", app)
    }

    func testNoSessionCloudAndTrashErrorPagesAreNotSolidBlankScreens() {
        let app = launch()
        files(app)
        for _ in 0..<2 {
            tap("native-ios-files-open-root-location", app)
            expect("native-ios-files-error-page", app)
            assertNonuniformFrame(app, "No-session Cloud error")
            tap("native-ios-files-error-return", app)
            tap("native-ios-files-open-trash", app)
            expect("native-ios-files-trash-error-page", app)
            assertNonuniformFrame(app, "No-session Trash error")
            tap("native-ios-files-trash-error-return", app)
            expect("native-ios-files-section-browse", app)
        }
    }


    /// The collection shortcuts previously instantiated a full authorized
    /// projection even when the synthetic Owner had no login Session. Probe
    /// the real native destinations rather than accepting a static assertion.
    private func openHomeShortcut(_ id: String, _ app: XCUIApplication) {
        let item = element(id, app)
        if !item.exists {
            let list = app.collectionViews.firstMatch
            if list.exists {
                for _ in 0..<5 {
                    list.swipeUp()
                    if item.exists { break }
                }
            }
        }
        tap(id, app)
    }

    func testRecentShortcutNoSessionShowsRecoverableNativeChild() {
        let app = launch()
        files(app)
        openHomeShortcut("native-ios-files-open-recent", app)
        expect("native-ios-files-recent-error-page", app)
        XCTAssertFalse(element("native-ios-files-grid", app).exists)
        assertNonuniformFrame(app, "Recent no-Session child")
        tap("native-ios-files-recent-error-return", app)
        expect("native-ios-files-section-browse", app)
    }

    func testFavoritesShortcutNoSessionShowsRecoverableNativeChild() {
        let app = launch()
        files(app)
        openHomeShortcut("native-ios-files-open-favorites", app)
        expect("native-ios-files-favorites-error-page", app)
        XCTAssertFalse(element("native-ios-files-grid", app).exists)
        assertNonuniformFrame(app, "Favorites no-Session child")
        tap("native-ios-files-favorites-error-return", app)
        expect("native-ios-files-section-browse", app)
    }

    func testRecentRetryBackCannotLeaveStaleOwnerProjection() {
        let app = launch()
        files(app)
        openHomeShortcut("native-ios-files-open-recent", app)
        expect("native-ios-files-recent-error-page", app)
        tap("native-ios-files-recent-retry", app)
        expect("native-ios-files-recent-error-page", app)
        tap("native-ios-files-recent-error-return", app)
        expect("native-ios-files-section-browse", app)
        XCTAssertFalse(element("native-ios-files-recent-error-page", app).exists)
        tap("native-ios-tab-gallery", app)
        expect("native-ios-gallery-source-unified", app)
    }

    func testFavoritesRetryBackCannotLeaveStaleOwnerProjection() {
        let app = launch()
        files(app)
        openHomeShortcut("native-ios-files-open-favorites", app)
        expect("native-ios-files-favorites-error-page", app)
        tap("native-ios-files-favorites-retry", app)
        expect("native-ios-files-favorites-error-page", app)
        tap("native-ios-files-favorites-error-return", app)
        expect("native-ios-files-section-browse", app)
        XCTAssertFalse(element("native-ios-files-favorites-error-page", app).exists)
        assertNonuniformFrame(app, "Files after Favorites retry/back")
    }

    func testRecentAfterTrashDeniedReturnKeepsGalleryAvailable() {
        let app = launch()
        files(app)
        tap("native-ios-files-open-trash", app)
        expect("native-ios-files-trash-error-page", app)
        tap("native-ios-files-trash-error-return", app)
        expect("native-ios-files-section-browse", app)
        openHomeShortcut("native-ios-files-open-recent", app)
        expect("native-ios-files-recent-error-page", app)
        tap("native-ios-files-recent-error-return", app)
        tap("native-ios-tab-gallery", app)
        expect("native-ios-gallery-source-unified", app)
        assertNonuniformFrame(app, "Gallery after Trash and Recent")
    }

    func testFavoritesAfterCloudDeniedReturnKeepsGalleryAvailable() {
        let app = launch()
        files(app)
        tap("native-ios-files-open-root-location", app)
        expect("native-ios-files-error-page", app)
        tap("native-ios-files-error-return", app)
        expect("native-ios-files-section-browse", app)
        openHomeShortcut("native-ios-files-open-favorites", app)
        expect("native-ios-files-favorites-error-page", app)
        tap("native-ios-files-favorites-error-return", app)
        tap("native-ios-tab-gallery", app)
        expect("native-ios-gallery-source-unified", app)
        assertNonuniformFrame(app, "Gallery after Cloud and Favorites")
    }

    func testDeniedCollectionsAcrossFilesRailAndAlbumsNeverExposeRows() {
        let app = launch()
        files(app)
        openHomeShortcut("native-ios-files-open-recent", app)
        expect("native-ios-files-recent-error-page", app)
        tap("native-ios-files-recent-error-return", app)
        for section in ["recent", "favorites", "browse"] {
            tap("native-ios-files-section-\\(section)", app)
            expect("native-ios-files-section-browse", app)
        }
        openHomeShortcut("native-ios-files-open-favorites", app)
        expect("native-ios-files-favorites-error-page", app)
        XCTAssertFalse(element("native-ios-files-grid", app).exists)
        tap("native-ios-files-favorites-error-return", app)
        tap("native-ios-tab-gallery", app)
        tap("native-ios-gallery-source-albums", app)
        expect("native-ios-gallery-source-unified", app)
        assertNonuniformFrame(app, "Albums after denied Files collections")
    }
}
