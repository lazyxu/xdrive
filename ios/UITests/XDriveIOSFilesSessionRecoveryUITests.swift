import XCTest
import UIKit

/// Actual no-Session SwiftUI routes with a synthetic Owner and no bearer.
/// These are native mount/Back/AX regressions, NOT a real signed-iPhone FPS test.
final class XDriveIOSFilesSessionRecoveryUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        // The previous XCTest may finish a landscape navigation failure.
        // Every independent test must begin in known portrait geometry,
        // while rotation tests still exercise real iOS orientation changes.
        XCUIDevice.shared.orientation = .portrait
    }

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
        let browse = element("native-ios-files-section-browse", app)
        XCTAssertTrue(browse.waitForExistence(timeout: 15))
        // The real Files quick rail persists Recent/Favorites by Owner.
        // Existence of the Browse button does NOT mean the Browse Home List
        // is mounted; all Home/Organizer tests explicitly enter Browse.
        if (browse.value as? String) != "已选择" {
            tap("native-ios-files-section-browse", app)
        }
        XCTAssertEqual(browse.value as? String, "已选择",
                       "Files Home tests must enter the actual Browse route")
        XCTAssertTrue(element("native-ios-files-home-list", app)
            .waitForExistence(timeout: 15), "Files Browse Home list did not mount")
    }

    private func expect(_ id: String, _ app: XCUIApplication) {
        XCTAssertTrue(element(id, app).waitForExistence(timeout: 15),
                      "Missing fail-closed recovery page: \(id)")
        XCTAssertEqual(app.state, .runningForeground)
    }

    /// A cheap settled-frame guard: fails a uniform native screenshot, not a
    /// claim that every intermediate 60/120 Hz frame was captured.
    private func assertNonuniformFrame(_ app: XCUIApplication, _ route: String) {
        let shot = app.screenshot()
        guard let image = shot.image.cgImage else {
            XCTFail("No native frame after " + route)
            return
        }
        // Preserve the >8-colour blank-frame guard but resolve small text
        // strokes in the very short landscape Organizer sheet. The older
        // 24x32 downsample erased real text and misclassified a valid sheet.
        let width = 96, height = 64
        var rgba = [UInt8](repeating: 0, count: width * height * 4)
        let rendered = rgba.withUnsafeMutableBytes { bytes -> Bool in
            guard let base = bytes.baseAddress,
                  let context = CGContext(
                      data: base, width: width, height: height,
                      bitsPerComponent: 8, bytesPerRow: width * 4,
                      space: CGColorSpaceCreateDeviceRGB(),
                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                  ) else { return false }
            context.interpolationQuality = .low
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        XCTAssertTrue(rendered, "Unable to sample actual screen after " + route)
        guard rendered else { return }
        let colors = Set(stride(from: 0, to: rgba.count, by: 4).map { index in
            (Int(rgba[index]) << 16) |
            (Int(rgba[index + 1]) << 8) |
            Int(rgba[index + 2])
        })
        XCTAssertGreaterThan(colors.count, 8,
                             "Native recovery page was visually uniform after " + route)
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
        if !item.exists || !item.isHittable {
            // Scroll the actual Files Home List, never a retained Gallery
            // collection from the process-wide accessibility hierarchy.
            let list = element("native-ios-files-home-list", app)
            XCTAssertTrue(list.waitForExistence(timeout: 15),
                          "Visible native Files Home List did not mount")
            for _ in 0..<8 {
                if item.exists && item.isHittable { break }
                list.swipeUp()
            }
            for _ in 0..<12 {
                if item.exists && item.isHittable { break }
                list.swipeDown()
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


    func testNoSessionCloudAndTrashErrorPagesAreNotSolidBlankScreens() {
        let app = launch()
        files(app)
        for _ in 0..<2 {
            tap("native-ios-files-open-root-location", app)
            expect("native-ios-files-error-page", app)
            assertNonuniformFrame(app, "Cloud denied child")
            XCTAssertFalse(element("native-ios-files-retry", app).exists)
            tap("native-ios-files-error-return", app)
            expect("native-ios-files-section-browse", app)
            tap("native-ios-files-open-trash", app)
            expect("native-ios-files-trash-error-page", app)
            assertNonuniformFrame(app, "Trash denied child")
            XCTAssertFalse(element("native-ios-files-trash-retry", app).exists)
            tap("native-ios-files-trash-error-return", app)
            expect("native-ios-files-section-browse", app)
        }
    }

    func testNoSessionRecentFavoritesDeniedPagesAreNotSolidBlankScreens() {
        let app = launch()
        files(app)
        for route in [
            ("native-ios-files-open-recent", "native-ios-files-recent-error-page",
             "native-ios-files-recent-error-return"),
            ("native-ios-files-open-favorites", "native-ios-files-favorites-error-page",
             "native-ios-files-favorites-error-return"),
        ] {
            openHomeShortcut(route.0, app)
            expect(route.1, app)
            assertNonuniformFrame(app, route.1)
            XCTAssertFalse(element("native-ios-files-grid", app).exists)
            tap(route.2, app)
            expect("native-ios-files-section-browse", app)
        }
    }

    func testNoSessionCloudTrashRapidBackDoesNotRepushOldChild() {
        let app = launch()
        files(app)
        for _ in 0..<3 {
            tap("native-ios-files-open-root-location", app)
            expect("native-ios-files-error-page", app)
            tap("native-ios-files-error-return", app)
            expect("native-ios-files-section-browse", app)
            XCTAssertFalse(element("native-ios-files-error-page", app).exists)
            tap("native-ios-files-open-trash", app)
            expect("native-ios-files-trash-error-page", app)
            tap("native-ios-files-trash-error-return", app)
            expect("native-ios-files-section-browse", app)
            XCTAssertFalse(element("native-ios-files-trash-error-page", app).exists)
        }
        tap("native-ios-tab-gallery", app)
        expect("native-ios-gallery-source-unified", app)
        tap("native-ios-tab-files", app)
        expect("native-ios-files-section-browse", app)
        XCTAssertFalse(element("native-ios-files-error-page", app).exists)
        XCTAssertFalse(element("native-ios-files-trash-error-page", app).exists)
    }


    // Seven additional *real* tap-driven iOS Simulator journeys exercise the
    // Organizer's nested native routes and their return to both product tabs.
    // The synthetic Owner is deliberately not authenticated; these tests must
    // never claim private cloud data, a successful Server read, or 60/120Hz FPS.
    private func homeAction(_ id: String, _ app: XCUIApplication) -> XCUIElement {
        let list = element("native-ios-files-home-list", app)
        XCTAssertTrue(list.waitForExistence(timeout: 12),
                      "Visible native Files Home List did not mount")
        let action = app.buttons.matching(identifier: id).firstMatch
        for _ in 0..<6 {
            if action.exists && action.isHittable { return action }
            list.swipeUp()
        }
        XCTAssertTrue(action.waitForExistence(timeout: 12),
                      "Files Home did not render \(id)")
        XCTAssertTrue(action.isHittable, "Files Home action is not tappable: \(id)")
        return action
    }

    private func openOrganizer(_ app: XCUIApplication) {
        let action = homeAction("native-ios-files-organize-home", app)
        print("IOS_NATIVE_NAV_TAP_START route=native-ios-files-organize-home")
        action.tap()
        expect("native-ios-files-organize-home-sheet", app)
    }

    private func organizerChild(_ id: String, _ app: XCUIApplication) {
        let control = element(id, app)
        let sheet = element("native-ios-files-organize-home-sheet", app)
        for _ in 0..<4 {
            if control.exists && control.isHittable { break }
            XCTAssertTrue(sheet.exists, "Organizer disappeared before child")
            sheet.swipeUp()
        }
        tap(id, app)
    }

    private func completeOrganizer(_ app: XCUIApplication) {
        let done = app.buttons["完成"].firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 12))
        print("IOS_NATIVE_NAV_TAP_START route=native-ios-files-organize-home-done")
        done.tap()
        // Validate the actual native return, not just the persistent tab bar.
        expect("native-ios-files-section-browse", app)
        let dismissed = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"),
            object: element("native-ios-files-organize-home-sheet", app)
        )
        XCTAssertEqual(XCTWaiter.wait(for: [dismissed], timeout: 12), .completed,
                       "Organizer sheet remained over Files Home")
    }

    private func attachPage(_ app: XCUIApplication, name: String) {
        assertNonuniformFrame(app, name)
        let image = XCTAttachment(screenshot: app.screenshot())
        image.name = name
        image.lifetime = .keepAlways
        add(image)
    }

    func testOrganizeNestedSavedSearchesGalleryOriginalsFilesReturn() {
        let app = launch()
        files(app)
        openOrganizer(app)
        organizerChild("native-ios-files-organize-saved-searches", app)
        expect("native-ios-files-saved-searches-page", app)
        attachPage(app, name: "organizer-saved-search-child")
        tap("native-ios-files-saved-searches-done", app)
        expect("native-ios-files-organize-home-sheet", app)
        completeOrganizer(app)
        tap("native-ios-tab-gallery", app)
        tap("native-ios-gallery-source-originals", app)
        expect("native-ios-cloud-original-layout-help", app)
        attachPage(app, name: "organizer-saved-search-originals")
        files(app)
        XCTAssertFalse(element("native-ios-files-saved-searches-page", app).exists)
    }

    func testOrganizeNestedTagsGalleryPeopleFilesReturn() {
        let app = launch()
        files(app)
        openOrganizer(app)
        organizerChild("native-ios-files-organize-tags", app)
        expect("native-ios-files-tag-management", app)
        attachPage(app, name: "organizer-tag-management-child")
        let tagDone = app.navigationBars["标签"].buttons["完成"].firstMatch
        XCTAssertTrue(tagDone.waitForExistence(timeout: 12))
        tagDone.tap()
        expect("native-ios-files-organize-home-sheet", app)
        completeOrganizer(app)
        tap("native-ios-tab-gallery", app)
        tap("native-ios-gallery-people", app)
        expect("native-ios-gallery-people-page", app)
        let back = app.navigationBars.buttons.element(boundBy: 0)
        XCTAssertTrue(back.waitForExistence(timeout: 15))
        back.tap()
        files(app)
        XCTAssertFalse(element("native-ios-files-tag-management", app).exists)
    }

    func testOrganizeHomeRotationGalleryFilesRoundtrip() {
        let app = launch()
        let device = XCUIDevice.shared
        defer { device.orientation = .portrait }
        files(app)
        openOrganizer(app)
        device.orientation = .landscapeLeft
        expect("native-ios-files-organize-home-sheet", app)
        attachPage(app, name: "organizer-landscape")
        device.orientation = .portrait
        completeOrganizer(app)
        tap("native-ios-tab-gallery", app)
        expect("native-ios-gallery-source-unified", app)
        files(app)
        attachPage(app, name: "files-return-after-organizer-rotation")
    }

    func testOrganizeHomeReopenAfterNestedChildrenHasNoGhostSheet() {
        let app = launch()
        files(app)
        openOrganizer(app)
        organizerChild("native-ios-files-organize-saved-searches", app)
        expect("native-ios-files-saved-searches-page", app)
        tap("native-ios-files-saved-searches-done", app)
        expect("native-ios-files-organize-home-sheet", app)
        organizerChild("native-ios-files-organize-tags", app)
        expect("native-ios-files-tag-management", app)
        let tagDone = app.navigationBars["标签"].buttons["完成"].firstMatch
        XCTAssertTrue(tagDone.waitForExistence(timeout: 12))
        tagDone.tap()
        completeOrganizer(app)
        openOrganizer(app)
        expect("native-ios-files-organize-home-sheet", app)
        XCTAssertFalse(element("native-ios-files-tag-management", app).exists)
        XCTAssertFalse(element("native-ios-files-saved-searches-page", app).exists)
        attachPage(app, name: "organizer-reopen-after-two-children")
        completeOrganizer(app)
    }

    func testOrganizeHomeDeniedCloudRecoveryThenGalleryFilter() {
        let app = launch()
        files(app)
        openOrganizer(app)
        completeOrganizer(app)
        // The Organizer action lives below the fold; explicitly return to
        // the top of Files Home before tapping its protected Cloud child.
        let homeList = app.collectionViews.firstMatch
        for _ in 0..<5 { homeList.swipeDown() }
        tap("native-ios-files-open-root-location", app)
        expect("native-ios-files-error-page", app)
        XCTAssertFalse(element("native-ios-files-grid", app).exists)
        tap("native-ios-files-error-return", app)
        tap("native-ios-tab-gallery", app)
        tap("native-ios-gallery-open-filters", app)
        let cancel = app.buttons["取消"].firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 15))
        cancel.tap()
        expect("native-ios-gallery-source-unified", app)
        files(app)
        XCTAssertFalse(element("native-ios-files-error-page", app).exists)
        attachPage(app, name: "organizer-cloud-denial-files-recovery")
    }

    func testOrganizeHomeThenFilesQuickRailAndGalleryAlternation() {
        let app = launch()
        files(app)
        openOrganizer(app)
        completeOrganizer(app)
        for _ in 0..<2 {
            for section in ["recent", "favorites", "browse"] {
                tap("native-ios-files-section-\(section)", app)
            }
            tap("native-ios-tab-gallery", app)
            tap("native-ios-gallery-source-albums", app)
            tap("native-ios-gallery-source-unified", app)
            files(app)
            XCTAssertFalse(element("native-ios-files-organize-home-sheet", app).exists)
        }
        attachPage(app, name: "organizer-rail-gallery-repeat")
    }

    func testOrganizeHomeSignoutRelaunchNeverRestoresPrivilegedSheet() {
        let app = launch()
        files(app)
        openOrganizer(app)
        completeOrganizer(app)
        app.terminate()
        app.launchArguments = ["-xdrive-ui-navigation-smoke"]
        app.launch()
        XCTAssertEqual(app.state, .runningForeground)
        files(app)
        XCTAssertFalse(element("native-ios-files-open-root-location", app).exists)
        XCTAssertFalse(element("native-ios-files-organize-home-sheet", app).exists)
        tap("native-ios-tab-gallery", app)
        expect("native-ios-gallery-source-unified", app)
        attachPage(app, name: "organizer-signed-out-relaunch-gallery")
    }
}
