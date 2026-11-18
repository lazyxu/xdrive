import XCTest
import UIKit

/// Real native Simulator navigation smoke. A multi-color screenshot is only
/// a settled-frame blank-screen guard, never a claim of 60/120 Hz smoothness.
/// The synthetic Owner is deliberately not authenticated; protected cloud
/// operations must fail closed without replacing the Gallery/Files shell.
final class XDriveIOSGalleryFilesFrameContinuityUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    /// CI starts a real simctl recorder after the XCTest "started" log line.
    /// Measured first decoded video frames appeared up to ~17 seconds late.
    /// Let recording begin BEFORE the first real navigation tap; the H.264
    /// gate still rejects clips lacking two genuine pre-tap decoded frames.
    /// This is a test-only bounded prelude, not a no-flicker assertion.
    private func waitForRealH264RecordingPrelude() {
        Thread.sleep(forTimeInterval: 24)
    }

    private func launch(syntheticOwner: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-xdrive-ui-navigation-smoke"]
        if syntheticOwner {
            app.launchArguments.append("-xdrive-ui-navigation-synthetic-owner")
        }
        app.launch()
        XCTAssertEqual(app.state, .runningForeground, "Native app exited at launch")
        return app
    }

    private func target(_ id: String, app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func tap(_ id: String, app: XCUIApplication) {
        let element = target(id, app: app)
        XCTAssertTrue(element.waitForExistence(timeout: 15), "No native control: \(id)")
        print("IOS_NATIVE_NAV_TAP_START route=\(id)")
        element.tap()
        XCTAssertEqual(app.state, .runningForeground, "Native process exited at \(id)")
    }

    private func assertGallery(_ app: XCUIApplication) {
        XCTAssertTrue(target("native-ios-gallery-source-unified", app: app)
            .waitForExistence(timeout: 15), "Gallery source rail was lost")
    }

    private func assertFiles(_ app: XCUIApplication) {
        XCTAssertTrue(target("native-ios-files-section-browse", app: app)
            .waitForExistence(timeout: 15), "Files quick rail was lost")
    }

    private func assertVisiblePixels(_ app: XCUIApplication, route: String) {
        guard let image = app.screenshot().image.cgImage else {
            XCTFail("Could not sample native screenshot at \(route)")
            return
        }
        // The colorful native tab/navigation bars can hide an entirely blank
        // child. Sample the live child viewport at 96x64, not the full shell.
        let width = 96, height = 64
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let rendered = pixels.withUnsafeMutableBytes { bytes -> Bool in
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
        XCTAssertTrue(rendered, "Missing screenshot bitmap at \(route)")
        guard rendered else { return }
        // Sample only the content viewport. Colorful tab chrome does not
        // establish that the returned PhotoKit or Files child actually painted.
        var unique = Set<Int>()
        for y in (height / 5)..<(height * 4 / 5) {
            for x in (width / 8)..<(width * 7 / 8) {
                let index = (y * width + x) * 4
                unique.insert((Int(pixels[index]) << 16) |
                    (Int(pixels[index + 1]) << 8) | Int(pixels[index + 2]))
            }
        }
        XCTAssertGreaterThan(unique.count, 8, "Uniform/blank child viewport at \(route)")
    }

    private func openLocalPhotoSource(_ app: XCUIApplication) {
        tap("native-ios-gallery-source-menu", app: app)
        let local = app.buttons["本机照片"].firstMatch
        XCTAssertTrue(local.waitForExistence(timeout: 15),
                      "Native PhotoKit source was missing from the Gallery menu")
        local.tap()
        XCTAssertTrue(target("native-ios-gallery-source-local", app: app)
            .waitForExistence(timeout: 15), "Local PhotoKit source did not mount")
    }

    // A colorful tab bar does not prove that the local PhotoKit child has
    // rendered. Verify the actual child controls AND one explicit permission
    // state before accepting a nonblank whole-screen screenshot.
    private func assertLocalPhotoContent(_ app: XCUIApplication) {
        XCTAssertTrue(target("native-ios-local-timeline-open", app: app)
            .waitForExistence(timeout: 15), "Local PhotoKit child was not mounted")
        let authorized = target("native-ios-local-gallery-media-filter", app: app).exists
        let requesting = app.buttons["允许查看本机相册"].firstMatch.exists
        let denied = app.staticTexts["相册权限不可用，请在 iOS 设置中允许访问。"]
            .firstMatch.exists
        XCTAssertTrue(authorized || requesting || denied,
                      "PhotoKit must render an authorized, request or denied state")
    }

    func testLocalPhotoTimelineDateSheetDismissThenFilesReturnKeepsContent() {
        let app = launch()
        waitForRealH264RecordingPrelude()
        openLocalPhotoSource(app)
        assertLocalPhotoContent(app)
        tap("native-ios-local-timeline-open", app: app)
        let done = target("native-ios-local-timeline-done", app: app)
        XCTAssertTrue(done.waitForExistence(timeout: 15),
                      "Local PhotoKit timeline date Sheet was not presented")
        done.tap()
        assertLocalPhotoContent(app)
        tap("native-ios-tab-files", app: app)
        assertFiles(app)
        tap("native-ios-tab-gallery", app: app)
        assertGallery(app)
        assertLocalPhotoContent(app)
        assertVisiblePixels(app, route: "Local dates dismissed after Files return")
    }

    func testLocalPhotoWithFilesQuickSectionsPreservesLocalChild() {
        let app = launch(syntheticOwner: true)
        openLocalPhotoSource(app)
        assertLocalPhotoContent(app)
        tap("native-ios-tab-files", app: app)
        for section in ["recent", "favorites", "browse", "recent", "browse"] {
            tap("native-ios-files-section-\(section)", app: app)
            assertFiles(app)
        }
        tap("native-ios-tab-gallery", app: app)
        assertGallery(app)
        XCTAssertTrue(target("native-ios-gallery-source-local", app: app)
            .waitForExistence(timeout: 15))
        assertLocalPhotoContent(app)
        assertVisiblePixels(app, route: "Local Photos after Files sections")
    }

    func testLocalPhotoGalleryFilesRoundTripsKeepRealNativePixels() {
        let app = launch()
        waitForRealH264RecordingPrelude()
        openLocalPhotoSource(app)
        assertGallery(app)
        assertLocalPhotoContent(app)
        assertVisiblePixels(app, route: "Local PhotoKit initial")
        for index in 0..<3 {
            tap("native-ios-tab-files", app: app)
            assertFiles(app)
            assertVisiblePixels(app, route: "Files after local Photos \(index)")
            tap("native-ios-tab-gallery", app: app)
            assertGallery(app)
            XCTAssertTrue(target("native-ios-gallery-source-local", app: app)
                .waitForExistence(timeout: 15), "Local source was reset by Files")
            assertLocalPhotoContent(app)
            assertVisiblePixels(app, route: "Local Photos after Files \(index)")
        }
    }

    func testLocalPhotoGalleryForegroundAndFilesReturnRemainNonBlank() {
        let app = launch()
        waitForRealH264RecordingPrelude()
        openLocalPhotoSource(app)
        assertLocalPhotoContent(app)
        assertVisiblePixels(app, route: "Local Photos before background")
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertEqual(app.state, .runningForeground)
        assertGallery(app)
        assertVisiblePixels(app, route: "Local Photos after foreground")
        tap("native-ios-tab-files", app: app)
        assertFiles(app)
        tap("native-ios-tab-gallery", app: app)
        assertGallery(app)
        XCTAssertTrue(target("native-ios-gallery-source-local", app: app)
            .waitForExistence(timeout: 15))
        assertLocalPhotoContent(app)
        assertVisiblePixels(app, route: "Local Photos after foreground and Files")
    }

    private func assertCloudOriginalsChild(_ app: XCUIApplication) {
        XCTAssertTrue(target("native-ios-cloud-original-layout-help", app: app)
            .waitForExistence(timeout: 15), "Cloud Originals native child did not mount")
        // These smoke runs intentionally have no authenticated Server token.
        // They must never manufacture a protected cloud tile in the UI.
        XCTAssertFalse(target("native-ios-cloud-original-tile", app: app).exists,
                       "No-session test leaked cloud Original thumbnail rows")
    }

    func testCloudOriginalsFilesRapidReturnKeepsNativeChild() {
        let app = launch()
        waitForRealH264RecordingPrelude()
        tap("native-ios-gallery-source-originals", app: app)
        assertCloudOriginalsChild(app)
        assertVisiblePixels(app, route: "Originals initial child")
        for index in 0..<3 {
            tap("native-ios-tab-files", app: app)
            assertFiles(app)
            tap("native-ios-tab-gallery", app: app)
            assertGallery(app)
            assertCloudOriginalsChild(app)
            assertVisiblePixels(app, route: "Originals after Files \(index)")
        }
    }

    func testCloudOriginalsBackgroundFilesReturnKeepsNativeChild() {
        let app = launch()
        tap("native-ios-gallery-source-originals", app: app)
        assertCloudOriginalsChild(app)
        XCUIDevice.shared.press(.home)
        XCTAssertTrue(app.wait(for: .runningBackground, timeout: 12),
                      "Cloud Originals process stopped while backgrounded")
        app.activate()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 18),
                      "Cloud Originals failed to return to foreground")
        assertCloudOriginalsChild(app)
        tap("native-ios-tab-files", app: app)
        assertFiles(app)
        tap("native-ios-tab-gallery", app: app)
        assertCloudOriginalsChild(app)
        assertVisiblePixels(app, route: "Originals foreground Files return")
    }

    func testCloudOriginalsHelpDismissFilesReturnKeepsChild() {
        let app = launch()
        waitForRealH264RecordingPrelude()
        tap("native-ios-gallery-source-originals", app: app)
        assertCloudOriginalsChild(app)
        tap("native-ios-cloud-original-layout-help", app: app)
        let info = app.alerts["云端备份原件说明"].firstMatch
        XCTAssertTrue(info.waitForExistence(timeout: 15), "Originals help alert missing")
        info.buttons["完成"].tap()
        assertCloudOriginalsChild(app)
        tap("native-ios-tab-files", app: app)
        assertFiles(app)
        tap("native-ios-tab-gallery", app: app)
        assertCloudOriginalsChild(app)
        assertVisiblePixels(app, route: "Originals after help and Files")
    }

    func testCloudOriginalsFilesQuickSectionsReturnKeepsChild() {
        let app = launch(syntheticOwner: true)
        tap("native-ios-gallery-source-originals", app: app)
        assertCloudOriginalsChild(app)
        tap("native-ios-tab-files", app: app)
        for section in ["recent", "favorites", "browse", "recent", "browse"] {
            tap("native-ios-files-section-\(section)", app: app)
            assertFiles(app)
        }
        tap("native-ios-tab-gallery", app: app)
        assertCloudOriginalsChild(app)
        assertVisiblePixels(app, route: "Originals after Files sections")
    }

    /// The Files Home '整理' section is below the initial iPhone 16 fold.
    /// The real Simulator failure was a direct accessibility lookup of an
    /// unmounted Lazy List row, not a native Files process crash.
    /// Retain the actual Browse List and its scroll position across sheets.
    /// The Cloud Root *row* can be offscreen in SwiftUI's lazy List after a
    /// history/saved-search return, so it cannot prove whether Home mounted.
    private func openFilesOperationHistoryFromBrowse(_ app: XCUIApplication) {
        assertFiles(app)
        tap("native-ios-files-section-browse", app: app)
        let browse = target("native-ios-files-section-browse", app: app)
        let selected = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "value == %@", "已选择"), object: browse)
        XCTAssertEqual(XCTWaiter.wait(for: [selected], timeout: 8), .completed)
        let home = target("native-ios-files-home-list", app: app)
        XCTAssertTrue(home.waitForExistence(timeout: 15),
                      "Actual Files Browse List must stay mounted")
        let action = target("native-ios-files-open-operations", app: app)
        for _ in 0..<8 {
            if action.exists && action.isHittable { break }
            home.swipeUp()
        }
        if !(action.exists && action.isHittable) {
            for _ in 0..<8 {
                if action.exists && action.isHittable { break }
                home.swipeDown()
            }
        }
        XCTAssertTrue(action.waitForExistence(timeout: 10),
                      "Files History row was not loaded in real Browse List")
        XCTAssertTrue(action.isHittable, "Files History row not tappable")
        print("IOS_NATIVE_NAV_TAP_START route=native-ios-files-open-operations")
        action.tap()
        XCTAssertEqual(app.state, .runningForeground,
                       "Native app exited opening Files operations")
    }


    func testFilesOperationHistorySheetDenialThenGalleryRetainsNativePages() {
        let app = launch(syntheticOwner: true)
        waitForRealH264RecordingPrelude()
        tap("native-ios-tab-files", app: app)
        assertFiles(app)
        openFilesOperationHistoryFromBrowse(app)
        XCTAssertTrue(target("native-ios-files-operation-history-page", app: app)
            .waitForExistence(timeout: 15),
            "The native Files operation-history sheet was not presented")
        let done = target("native-ios-files-operation-history-done", app: app)
        XCTAssertTrue(done.waitForExistence(timeout: 15),
                      "Operation history has no close action after denial")
        done.tap()
        assertFiles(app)
        tap("native-ios-tab-gallery", app: app)
        assertGallery(app)
        assertVisiblePixels(app, route: "Gallery after denied Files operation history")
    }

    func testFilesOperationHistoryBackgroundThenFilesGalleryReturn() {
        let app = launch(syntheticOwner: true)
        waitForRealH264RecordingPrelude()
        tap("native-ios-tab-files", app: app)
        openFilesOperationHistoryFromBrowse(app)
        XCTAssertTrue(target("native-ios-files-operation-history-page", app: app)
            .waitForExistence(timeout: 15))
        XCUIDevice.shared.press(.home)
        XCTAssertTrue(app.wait(for: .runningBackground, timeout: 12),
                      "Files History process stopped while backgrounded")
        app.activate()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 18),
                      "Files History failed to return to foreground")
        let done = target("native-ios-files-operation-history-done", app: app)
        XCTAssertTrue(done.waitForExistence(timeout: 15))
        done.tap()
        assertFiles(app)
        assertVisiblePixels(app, route: "Files after operations foreground")
        tap("native-ios-tab-gallery", app: app)
        assertGallery(app)
        assertVisiblePixels(app, route: "Gallery after operations foreground")
    }

    /// Regression kept from the older #4298 crash matrix: two distinct
    /// History -> background/foreground -> Files -> Gallery transitions.
    /// Guard the actual process before activation; an AX timeout is not an
    /// app-process crash unless the independently audited report proves it.
    func testFilesOperationHistoryTwoForegroundGalleryReturnCyclesKeepRealPage() {
        let app = launch(syntheticOwner: true)
        for cycle in 0..<2 {
            tap("native-ios-tab-files", app: app)
            openFilesOperationHistoryFromBrowse(app)
            let sheet = target("native-ios-files-operation-history-page", app: app)
            XCTAssertTrue(sheet.waitForExistence(timeout: 15))
            XCUIDevice.shared.press(.home)
            XCTAssertTrue(app.wait(for: .runningBackground, timeout: 12),
                          "Files History process stopped in background cycle \\(cycle)")
            app.activate()
            XCTAssertTrue(app.wait(for: .runningForeground, timeout: 18),
                          "Files History failed foreground recovery cycle \\(cycle)")
            XCTAssertTrue(sheet.waitForExistence(timeout: 15),
                          "Files History sheet disappeared after foreground cycle \\(cycle)")
            tap("native-ios-files-operation-history-done", app: app)
            let retired = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "exists == false"), object: sheet)
            XCTAssertEqual(XCTWaiter.wait(for: [retired], timeout: 12), .completed,
                           "Files History modal remained after Done in cycle \\(cycle)")
            assertFiles(app)
            tap("native-ios-tab-gallery", app: app)
            assertGallery(app)
            assertVisiblePixels(app, route: "Gallery after History foreground cycle \\(cycle)")
        }
    }

    /// A disposable synthetic Owner with no bearer must never survive a
    /// signed-out cold relaunch, even after Albums and Files Favorites.
    func testSyntheticOwnerAlbumsFilesForegroundRelaunchDoesNotRetainOldScope() {
        let app = launch(syntheticOwner: true)
        tap("native-ios-gallery-source-albums", app: app)
        assertGallery(app)
        tap("native-ios-tab-files", app: app)
        tap("native-ios-files-section-favorites", app: app)
        assertFiles(app)
        XCUIDevice.shared.press(.home)
        XCTAssertTrue(app.wait(for: .runningBackground, timeout: 12),
                      "Synthetic Owner Files process stopped in background")
        app.activate()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 18),
                      "Synthetic Owner Files did not foreground")
        assertFiles(app)
        app.terminate()
        XCTAssertEqual(app.state, .notRunning)
        app.launchArguments = ["-xdrive-ui-navigation-smoke"]
        app.launch()
        XCTAssertEqual(app.state, .runningForeground)
        tap("native-ios-tab-files", app: app)
        assertFiles(app)
        XCTAssertFalse(target("native-ios-files-open-root-location", app: app).exists,
                       "Signed-out cold relaunch retained a private Owner folder")
        XCTAssertFalse(target("native-ios-files-grid", app: app).exists,
                       "Signed-out cold relaunch exposed prior Owner rows")
        tap("native-ios-tab-gallery", app: app)
        assertGallery(app)
        assertVisiblePixels(app, route: "Gallery after signed-out Owner cold relaunch")
    }

    func testRapidGalleryFilesAlternationKeepsBothNativeShellsAndPixels() {
        let app = launch()
        for index in 0..<4 {
            tap("native-ios-tab-files", app: app)
            assertFiles(app)
            assertVisiblePixels(app, route: "Files \(index)")
            tap("native-ios-tab-gallery", app: app)
            assertGallery(app)
            assertVisiblePixels(app, route: "Gallery \(index)")
        }
    }

    func testGalleryAlbumsOriginalsAndUnifiedRoundTripsKeepPixels() {
        let app = launch()
        waitForRealH264RecordingPrelude()
        for source in ["albums", "unified", "originals", "unified"] {
            tap("native-ios-gallery-source-\(source)", app: app)
            assertVisiblePixels(app, route: "Gallery \(source)")
        }
        assertGallery(app)
    }

    func testGalleryFilterDismissThenFilesReturnDoesNotBlankTheWall() {
        let app = launch()
        waitForRealH264RecordingPrelude()
        tap("native-ios-gallery-open-filters", app: app)
        let cancel = app.buttons["取消"].firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 15), "Filter sheet was not presented")
        cancel.tap()
        assertGallery(app)
        assertVisiblePixels(app, route: "Filter dismissed")
        tap("native-ios-tab-files", app: app)
        assertFiles(app)
        tap("native-ios-tab-gallery", app: app)
        assertGallery(app)
        assertVisiblePixels(app, route: "Gallery after Files")
    }

    func testFilesRecentFavoritesBrowseRapidSwitchRetainsReadableRail() {
        let app = launch(syntheticOwner: true)
        waitForRealH264RecordingPrelude()
        tap("native-ios-tab-files", app: app)
        for section in ["recent", "favorites", "browse",
                        "favorites", "recent", "browse"] {
            tap("native-ios-files-section-\(section)", app: app)
            assertFiles(app)
            assertVisiblePixels(app, route: "Files \(section)")
        }
    }

    func testNoSessionCloudDenialReturnsToFilesAndGalleryWithoutBlankPage() {
        let app = launch(syntheticOwner: true)
        waitForRealH264RecordingPrelude()
        tap("native-ios-tab-files", app: app)
        tap("native-ios-files-open-root-location", app: app)
        XCTAssertTrue(target("native-ios-files-error-page", app: app)
            .waitForExistence(timeout: 15), "Cloud authorization failure must stay native")
        assertVisiblePixels(app, route: "Cloud denied")
        tap("native-ios-files-error-return", app: app)
        assertFiles(app)
        tap("native-ios-tab-gallery", app: app)
        assertGallery(app)
        assertVisiblePixels(app, route: "Gallery after Cloud denied")
    }

    func testGalleryPeopleChildBackThenFilesReturnRetainsVisualHierarchy() {
        let app = launch(syntheticOwner: true)
        waitForRealH264RecordingPrelude()
        tap("native-ios-gallery-people", app: app)
        XCTAssertTrue(target("native-ios-gallery-people-page", app: app)
            .waitForExistence(timeout: 15), "Gallery People child disappeared")
        assertVisiblePixels(app, route: "People child")
        let back = app.navigationBars.buttons.element(boundBy: 0)
        XCTAssertTrue(back.waitForExistence(timeout: 15), "Gallery People Back missing")
        back.tap()
        assertGallery(app)
        tap("native-ios-tab-files", app: app)
        assertFiles(app)
        assertVisiblePixels(app, route: "Files after People")
        tap("native-ios-tab-gallery", app: app)
        assertGallery(app)
    }

    /// The Files Home uses a lazily mounted List. Reach the *real* row,
    /// rather than treating an off-screen accessibility lookup as a crash.
    /// Saved Searches can be above the current retained History scroll
    /// offset. Check the mounted Home List and search in both directions.
    private func openFilesSavedSearchesFromBrowse(_ app: XCUIApplication) {
        assertFiles(app)
        tap("native-ios-files-section-browse", app: app)
        let browse = target("native-ios-files-section-browse", app: app)
        let selected = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "value == %@", "已选择"), object: browse)
        XCTAssertEqual(XCTWaiter.wait(for: [selected], timeout: 8), .completed)
        let home = target("native-ios-files-home-list", app: app)
        XCTAssertTrue(home.waitForExistence(timeout: 15),
                      "Actual Files Browse List must stay mounted")
        let action = target("native-ios-files-open-saved-searches", app: app)
        for _ in 0..<10 {
            if action.exists && action.isHittable { break }
            home.swipeUp()
        }
        if !(action.exists && action.isHittable) {
            for _ in 0..<10 {
                if action.exists && action.isHittable { break }
                home.swipeDown()
            }
        }
        XCTAssertTrue(action.waitForExistence(timeout: 10),
                      "Saved Searches row was not loaded in real Browse List")
        XCTAssertTrue(action.isHittable, "Saved Searches row not tappable")
        print("IOS_NATIVE_NAV_TAP_START route=native-ios-files-open-saved-searches")
        action.tap()
        XCTAssertEqual(app.state, .runningForeground)
    }


    func testFilesSavedSearchesRepeatedDismissalAndGalleryRoundTrips() {
        let app = launch(syntheticOwner: true)
        waitForRealH264RecordingPrelude()
        tap("native-ios-tab-files", app: app)
        for cycle in 0..<2 {
            openFilesSavedSearchesFromBrowse(app)
            XCTAssertTrue(target("native-ios-files-saved-searches-page", app: app)
                .waitForExistence(timeout: 15), "Saved Searches sheet did not mount")
            tap("native-ios-files-saved-searches-done", app: app)
            assertFiles(app)
            assertVisiblePixels(app, route: "Saved Searches dismissed \(cycle)")
            tap("native-ios-tab-gallery", app: app)
            assertGallery(app)
            assertVisiblePixels(app, route: "Gallery after Saved Searches \(cycle)")
            tap("native-ios-tab-files", app: app)
            assertFiles(app)
        }
    }

    func testFilesOperationHistoryThenSavedSearchesKeepsBothSheetsIndependent() {
        let app = launch(syntheticOwner: true)
        waitForRealH264RecordingPrelude()
        tap("native-ios-tab-files", app: app)
        openFilesOperationHistoryFromBrowse(app)
        XCTAssertTrue(target("native-ios-files-operation-history-page", app: app)
            .waitForExistence(timeout: 15))
        tap("native-ios-files-operation-history-done", app: app)
        assertFiles(app)
        openFilesSavedSearchesFromBrowse(app)
        XCTAssertTrue(target("native-ios-files-saved-searches-page", app: app)
            .waitForExistence(timeout: 15))
        tap("native-ios-files-saved-searches-done", app: app)
        assertFiles(app)
        tap("native-ios-tab-gallery", app: app)
        assertGallery(app)
        assertVisiblePixels(app, route: "Gallery after two Files sheets")
    }

    func testFilesCloudDenialThenQuickSectionsKeepNativeContent() {
        let app = launch(syntheticOwner: true)
        waitForRealH264RecordingPrelude()
        tap("native-ios-tab-files", app: app)
        tap("native-ios-files-open-root-location", app: app)
        XCTAssertTrue(target("native-ios-files-error-page", app: app)
            .waitForExistence(timeout: 15), "Denied cloud folder must fail closed")
        tap("native-ios-files-error-return", app: app)
        assertFiles(app)
        for section in ["recent", "favorites", "browse", "recent", "browse"] {
            tap("native-ios-files-section-\(section)", app: app)
            assertFiles(app)
            assertVisiblePixels(app, route: "Files after denied cloud \(section)")
        }
        tap("native-ios-tab-gallery", app: app)
        assertGallery(app)
        assertVisiblePixels(app, route: "Gallery after Files denial")
    }

    func testLocalPhotoTimelineSheetRepeatedAfterFilesReturns() {
        let app = launch()
        waitForRealH264RecordingPrelude()
        openLocalPhotoSource(app)
        for cycle in 0..<2 {
            assertLocalPhotoContent(app)
            tap("native-ios-local-timeline-open", app: app)
            let done = target("native-ios-local-timeline-done", app: app)
            XCTAssertTrue(done.waitForExistence(timeout: 15),
                          "Real PhotoKit date sheet is missing its own close control")
            if cycle == 0 {
                // The original real Simulator regression happened on
                // Home -> foreground while this exact date sheet was open.
                // Do not count an auto-dismissed sheet as a pass.
                XCUIDevice.shared.press(.home)
                app.activate()
                XCTAssertEqual(app.state, .runningForeground)
                XCTAssertTrue(done.waitForExistence(timeout: 15),
                              "Local PhotoKit date sheet disappeared after foreground")
            }
            done.tap()
            assertLocalPhotoContent(app)
            tap("native-ios-tab-files", app: app)
            assertFiles(app)
            tap("native-ios-tab-gallery", app: app)
            assertGallery(app)
            assertLocalPhotoContent(app)
            assertVisiblePixels(app, route: "Local date sheet Files return \(cycle)")
        }
    }

    func testGalleryPeopleRepeatedBackAndFilesReentryKeepsContent() {
        let app = launch(syntheticOwner: true)
        waitForRealH264RecordingPrelude()
        for cycle in 0..<2 {
            tap("native-ios-gallery-people", app: app)
            XCTAssertTrue(target("native-ios-gallery-people-page", app: app)
                .waitForExistence(timeout: 15), "Gallery People child did not mount")
            let back = app.navigationBars.buttons.element(boundBy: 0)
            XCTAssertTrue(back.waitForExistence(timeout: 15))
            back.tap()
            assertGallery(app)
            tap("native-ios-tab-files", app: app)
            assertFiles(app)
            tap("native-ios-tab-gallery", app: app)
            assertGallery(app)
            assertVisiblePixels(app, route: "People child Files return \(cycle)")
        }
    }

    func testGallerySourceFilterAndOriginalsRepeatedFilesReturn() {
        let app = launch()
        waitForRealH264RecordingPrelude()
        for cycle in 0..<2 {
            tap("native-ios-gallery-source-albums", app: app)
            assertGallery(app)
            tap("native-ios-gallery-source-unified", app: app)
            tap("native-ios-gallery-open-filters", app: app)
            let cancel = app.buttons["取消"].firstMatch
            XCTAssertTrue(cancel.waitForExistence(timeout: 15),
                          "Unified Gallery filter sheet was not presented")
            cancel.tap()
            assertGallery(app)
            tap("native-ios-tab-files", app: app)
            assertFiles(app)
            tap("native-ios-tab-gallery", app: app)
            tap("native-ios-gallery-source-originals", app: app)
            assertCloudOriginalsChild(app)
            tap("native-ios-gallery-source-unified", app: app)
            assertGallery(app)
            assertVisiblePixels(app, route: "Gallery source/filter Files return \(cycle)")
        }
    }

    // Independent real XCUITest + simctl-video navigation sequences.
    // No synthetic screenshots, bearer token or private media is installed.
    func testOriginalsHelpHistoryReturnWithoutGhostAlert() {
        let app = launch(syntheticOwner: true)
        waitForRealH264RecordingPrelude()
        tap("native-ios-gallery-source-originals", app: app)
        assertCloudOriginalsChild(app)
        tap("native-ios-cloud-original-layout-help", app: app)
        let alert = app.alerts["云端备份原件说明"].firstMatch
        XCTAssertTrue(alert.waitForExistence(timeout: 15))
        alert.buttons["完成"].tap()
        tap("native-ios-tab-files", app: app)
        openFilesOperationHistoryFromBrowse(app)
        XCTAssertTrue(target("native-ios-files-operation-history-page", app: app)
            .waitForExistence(timeout: 15))
        tap("native-ios-files-operation-history-done", app: app)
        assertFiles(app)
        tap("native-ios-tab-gallery", app: app)
        assertCloudOriginalsChild(app)
        XCTAssertFalse(alert.exists, "Originals help unexpectedly reopened")
        assertVisiblePixels(app, route: "Originals return after Files history")
    }

    func testHistoryForegroundAlbumsReturnWithoutGhostSheet() {
        let app = launch(syntheticOwner: true)
        waitForRealH264RecordingPrelude()
        tap("native-ios-tab-files", app: app)
        openFilesOperationHistoryFromBrowse(app)
        let sheet = target("native-ios-files-operation-history-page", app: app)
        XCTAssertTrue(sheet.waitForExistence(timeout: 15))
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertEqual(app.state, .runningForeground)
        XCTAssertTrue(sheet.waitForExistence(timeout: 15))
        tap("native-ios-files-operation-history-done", app: app)
        assertFiles(app)
        tap("native-ios-tab-gallery", app: app)
        tap("native-ios-gallery-source-albums", app: app)
        assertGallery(app)
        assertVisiblePixels(app, route: "Albums after Files foreground")
        tap("native-ios-tab-files", app: app)
        assertFiles(app)
        XCTAssertFalse(sheet.exists, "History sheet leaked across tabs")
        assertVisiblePixels(app, route: "Files after Albums return")
    }

    func testLocalPhotoFavoritesRecentDateAfterFilesReturn() {
        let app = launch()
        waitForRealH264RecordingPrelude()
        openLocalPhotoSource(app)
        assertLocalPhotoContent(app)
        tap("native-ios-tab-files", app: app)
        for section in ["favorites", "recent", "browse"] {
            tap("native-ios-files-section-\(section)", app: app)
            assertFiles(app)
        }
        tap("native-ios-tab-gallery", app: app)
        assertGallery(app)
        assertLocalPhotoContent(app)
        tap("native-ios-local-timeline-open", app: app)
        let done = target("native-ios-local-timeline-done", app: app)
        XCTAssertTrue(done.waitForExistence(timeout: 15))
        done.tap()
        assertLocalPhotoContent(app)
        assertVisiblePixels(app, route: "Local Photos date after Files rail")
    }

    func testPeopleCloudDenialPeopleReentryKeepsContent() {
        let app = launch(syntheticOwner: true)
        waitForRealH264RecordingPrelude()
        tap("native-ios-gallery-people", app: app)
        XCTAssertTrue(target("native-ios-gallery-people-page", app: app)
            .waitForExistence(timeout: 15))
        let back = app.navigationBars.buttons.element(boundBy: 0)
        XCTAssertTrue(back.waitForExistence(timeout: 15))
        back.tap()
        assertGallery(app)
        tap("native-ios-tab-files", app: app)
        tap("native-ios-files-open-root-location", app: app)
        XCTAssertTrue(target("native-ios-files-error-page", app: app)
            .waitForExistence(timeout: 15))
        XCTAssertFalse(target("native-ios-files-grid", app: app).exists,
                       "Unauthenticated Files unexpectedly exposed cloud content")
        tap("native-ios-files-error-return", app: app)
        assertFiles(app)
        tap("native-ios-tab-gallery", app: app)
        tap("native-ios-gallery-people", app: app)
        XCTAssertTrue(target("native-ios-gallery-people-page", app: app)
            .waitForExistence(timeout: 15))
        let secondBack = app.navigationBars.buttons.element(boundBy: 0)
        XCTAssertTrue(secondBack.waitForExistence(timeout: 15))
        secondBack.tap()
        assertGallery(app)
        assertVisiblePixels(app, route: "People reentry after cloud denial")
    }

    func testSavedSearchFilterHistorySheetsStayIndependent() {
        let app = launch(syntheticOwner: true)
        waitForRealH264RecordingPrelude()
        tap("native-ios-tab-files", app: app)
        openFilesSavedSearchesFromBrowse(app)
        let saved = target("native-ios-files-saved-searches-page", app: app)
        XCTAssertTrue(saved.waitForExistence(timeout: 15))
        tap("native-ios-files-saved-searches-done", app: app)
        assertFiles(app)
        tap("native-ios-tab-gallery", app: app)
        tap("native-ios-gallery-open-filters", app: app)
        let cancel = app.buttons["取消"].firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 15))
        cancel.tap()
        assertGallery(app)
        tap("native-ios-tab-files", app: app)
        openFilesOperationHistoryFromBrowse(app)
        XCTAssertTrue(target("native-ios-files-operation-history-page", app: app)
            .waitForExistence(timeout: 15))
        XCTAssertFalse(saved.exists, "Saved Search sheet leaked into History")
        tap("native-ios-files-operation-history-done", app: app)
        assertFiles(app)
        assertVisiblePixels(app, route: "Files after Saved Search Filter History")
    }

    func testAlbumsOriginalsFilesSectionRoundTripKeepsSource() {
        let app = launch(syntheticOwner: true)
        waitForRealH264RecordingPrelude()
        tap("native-ios-gallery-source-albums", app: app)
        assertGallery(app)
        assertVisiblePixels(app, route: "Albums before Files rail")
        tap("native-ios-tab-files", app: app)
        for section in ["recent", "favorites", "browse"] {
            tap("native-ios-files-section-\(section)", app: app)
            assertFiles(app)
        }
        tap("native-ios-tab-gallery", app: app)
        assertGallery(app)
        tap("native-ios-gallery-source-originals", app: app)
        assertCloudOriginalsChild(app)
        tap("native-ios-tab-files", app: app)
        assertFiles(app)
        tap("native-ios-tab-gallery", app: app)
        assertCloudOriginalsChild(app)
        tap("native-ios-gallery-source-unified", app: app)
        assertGallery(app)
        assertVisiblePixels(app, route: "Unified after Albums Originals Files")
    }
}
