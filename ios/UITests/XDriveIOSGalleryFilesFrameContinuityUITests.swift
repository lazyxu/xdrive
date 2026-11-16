import XCTest
import UIKit

/// Real native Simulator navigation smoke. A multi-color screenshot is only
/// a settled-frame blank-screen guard, never a claim of 60/120 Hz smoothness.
/// The synthetic Owner is deliberately not authenticated; protected cloud
/// operations must fail closed without replacing the Gallery/Files shell.
final class XDriveIOSGalleryFilesFrameContinuityUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        // A prior orientation test must not contaminate the next route.
        XCUIDevice.shared.orientation = .portrait
    }

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
        // Test content, not permanently colorful navigation chrome. The
        // previous 24x32 whole-screen downsample aliased sparse landscape
        // pages and missed a white child behind the header/tab rail.
        let contentRegion = CGRect(x: 0, y: CGFloat(image.height) * 0.1875,
            width: CGFloat(image.width), height: CGFloat(image.height) * 0.625)
        guard let content = image.cropping(to: contentRegion) else {
            XCTFail("Could not crop native page content at \(route)")
            return
        }
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
            context.draw(content, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        XCTAssertTrue(rendered, "Missing screenshot bitmap at \(route)")
        guard rendered else { return }
        let unique = Set(stride(from: 0, to: pixels.count, by: 4).map { index in
            (Int(pixels[index]) << 16) |
            (Int(pixels[index + 1]) << 8) |
            Int(pixels[index + 2])
        })
        XCTAssertGreaterThan(unique.count, 8, "Uniform/blank screen at \(route)")
    }


    /// Native size/date menus live in a horizontal filter strip, not the
    /// vertically scrolling Files list. Preserve real hit-test assertions.
    private func visibleFilesFilter(_ id: String, app: XCUIApplication) -> XCUIElement {
        let strip = target("native-ios-files-filter-strip", app: app)
        XCTAssertTrue(strip.waitForExistence(timeout: 15), "Files filter strip not mounted")
        let control = target(id, app: app)
        for _ in 0..<8 {
            if control.exists && control.isHittable { return control }
            strip.swipeLeft()
        }
        for _ in 0..<8 {
            if control.exists && control.isHittable { return control }
            strip.swipeRight()
        }
        XCTAssertTrue(control.exists && control.isHittable,
                      "Actual horizontal Files filter is inaccessible: \(id)")
        return control
    }

    private func applyFilesFilter(_ id: String, choice: String, app: XCUIApplication) {
        let filter = visibleFilesFilter(id, app: app)
        print("IOS_NATIVE_NAV_TAP_START route=\(id)")
        filter.tap()
        XCTAssertEqual(app.state, .runningForeground)
        let option = app.buttons[choice].firstMatch
        XCTAssertTrue(option.waitForExistence(timeout: 15) && option.isHittable,
                      "Actual Files filter option is inaccessible: \(choice)")
        option.tap()
        XCTAssertTrue(target("native-ios-files-error-page", app: app)
            .waitForExistence(timeout: 15),
            "No-Session Owner must fail closed instead of showing private Nodes")
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
        openLocalPhotoSource(app)
        assertLocalPhotoContent(app)
        tap("native-ios-local-timeline-open", app: app)
        let done = app.navigationBars.buttons["完成"].firstMatch
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
        app.activate()
        XCTAssertEqual(app.state, .runningForeground)
        assertCloudOriginalsChild(app)
        tap("native-ios-tab-files", app: app)
        assertFiles(app)
        tap("native-ios-tab-gallery", app: app)
        assertCloudOriginalsChild(app)
        assertVisiblePixels(app, route: "Originals foreground Files return")
    }

    func testCloudOriginalsHelpDismissFilesReturnKeepsChild() {
        let app = launch()
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
    private func openFilesOperationHistoryFromBrowse(_ app: XCUIApplication) {
        assertFiles(app)
        // Files may retain Recent/Favorites after a prior tab visit.
        // Reach the actual Browse Home before looking for its lazy rows.
        tap("native-ios-files-section-browse", app: app)
        // The Cloud root row is lazy and may be absent at a retained deep
        // scroll offset. The real Operation History entry is the only
        // valid proof that this Browse Home route can actually be opened.
        let action = target("native-ios-files-open-operations", app: app)
        // SwiftUI List can surface as UITableView or UICollectionView
        // depending on iOS runtime. Keep a bounded native swipe fallback.
        let table = app.tables.firstMatch
        let collection = app.collectionViews.firstMatch
        let scroll = app.scrollViews.firstMatch
        var list: XCUIElement = app
        if table.exists { list = table }
        else if collection.exists { list = collection }
        else if scroll.exists { list = scroll }
        for _ in 0..<8 {
            if action.exists && action.isHittable { break }
            list.swipeUp()
        }
        for _ in 0..<8 {
            if action.exists && action.isHittable { break }
            list.swipeDown()
        }
        XCTAssertTrue(action.waitForExistence(timeout: 10),
                      "Files Home operation history entry was not loaded after bounded scrolling")
        XCTAssertTrue(action.isHittable,
                      "Files operation history entry must be visible before tapping")
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
        tap("native-ios-tab-files", app: app)
        openFilesOperationHistoryFromBrowse(app)
        XCTAssertTrue(target("native-ios-files-operation-history-page", app: app)
            .waitForExistence(timeout: 15))
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertEqual(app.state, .runningForeground)
        let done = target("native-ios-files-operation-history-done", app: app)
        XCTAssertTrue(done.waitForExistence(timeout: 15))
        done.tap()
        assertFiles(app)
        assertVisiblePixels(app, route: "Files after operations foreground")
        tap("native-ios-tab-gallery", app: app)
        assertGallery(app)
        assertVisiblePixels(app, route: "Gallery after operations foreground")
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
    private func openFilesSavedSearchesFromBrowse(_ app: XCUIApplication) {
        assertFiles(app)
        tap("native-ios-files-section-browse", app: app)
        // The Cloud root row lives above the fold in a lazy SwiftUI List.
        // Actual iOS 18.5 H.264 proves Browse and 智能文件夹 are visible even
        // when that unrelated row is unmounted. Confirm the REAL saved
        // searches action below instead of gating on an offscreen sibling.
        let action = target("native-ios-files-open-saved-searches", app: app)
        let table = app.tables.firstMatch
        let collection = app.collectionViews.firstMatch
        let scroll = app.scrollViews.firstMatch
        let host: XCUIElement = table.exists ? table :
            (collection.exists ? collection : (scroll.exists ? scroll : app))
        for _ in 0..<10 {
            if action.exists && action.isHittable { break }
            host.swipeUp()
        }
        for _ in 0..<10 {
            if action.exists && action.isHittable { break }
            host.swipeDown()
        }
        XCTAssertTrue(action.waitForExistence(timeout: 10),
                      "Files Saved Searches entry was never mounted")
        XCTAssertTrue(action.isHittable,
                      "Files Saved Searches entry must be visible for a real tap")
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
            let done = app.navigationBars.buttons["完成"].firstMatch
            XCTAssertTrue(done.waitForExistence(timeout: 15),
                          "Local date sheet is missing a close control")
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
    // 1. Preserve real Home reachability after a retained non-Browse section.
    func testSavedSearchesAfterFavoritesRecentThenGallery() {
        let app = launch(syntheticOwner: true)
        tap("native-ios-tab-files", app: app)
        for section in ["favorites", "recent"] {
            tap("native-ios-files-section-\(section)", app: app)
            assertFiles(app)
        }
        openFilesSavedSearchesFromBrowse(app)
        XCTAssertTrue(target("native-ios-files-saved-searches-page", app: app)
            .waitForExistence(timeout: 15))
        assertVisiblePixels(app, route: "Saved Searches after Favorites")
        tap("native-ios-files-saved-searches-done", app: app)
        tap("native-ios-tab-gallery", app: app)
        assertGallery(app)
        assertVisiblePixels(app, route: "Gallery after Saved Searches")
    }

    // 2. The operation-history modal must remain coherent after an app wake.
    func testOperationHistoryForegroundFromRecentKeepsSheet() {
        let app = launch(syntheticOwner: true)
        tap("native-ios-tab-files", app: app)
        tap("native-ios-files-section-recent", app: app)
        openFilesOperationHistoryFromBrowse(app)
        XCTAssertTrue(target("native-ios-files-operation-history-page", app: app)
            .waitForExistence(timeout: 15))
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertEqual(app.state, .runningForeground)
        XCTAssertTrue(target("native-ios-files-operation-history-page", app: app)
            .waitForExistence(timeout: 15))
        tap("native-ios-files-operation-history-done", app: app)
        assertFiles(app)
        assertVisiblePixels(app, route: "History after foreground")
    }

    // 3. A dismissed denial must never obstruct the next genuine Files child.
    func testCloudDenialSavedSearchesReturnDoesNotResurrectError() {
        let app = launch(syntheticOwner: true)
        tap("native-ios-tab-files", app: app)
        tap("native-ios-files-open-root-location", app: app)
        XCTAssertTrue(target("native-ios-files-error-page", app: app)
            .waitForExistence(timeout: 15))
        tap("native-ios-files-error-return", app: app)
        openFilesSavedSearchesFromBrowse(app)
        XCTAssertTrue(target("native-ios-files-saved-searches-page", app: app)
            .waitForExistence(timeout: 15))
        XCTAssertFalse(target("native-ios-files-error-page", app: app).exists)
        tap("native-ios-files-saved-searches-done", app: app)
        assertFiles(app)
        assertVisiblePixels(app, route: "Saved Searches after denied cloud")
    }

    // 4. Rotate inside a real Gallery People child and return through Files.
    func testGalleryPeopleRotationFilesGalleryKeepsPage() {
        let app = launch(syntheticOwner: true)
        tap("native-ios-gallery-people", app: app)
        XCTAssertTrue(target("native-ios-gallery-people-page", app: app)
            .waitForExistence(timeout: 15))
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(target("native-ios-gallery-people-page", app: app)
            .waitForExistence(timeout: 15))
        assertVisiblePixels(app, route: "People child landscape")
        XCUIDevice.shared.orientation = .portrait
        let back = app.navigationBars.buttons.element(boundBy: 0)
        XCTAssertTrue(back.waitForExistence(timeout: 15))
        back.tap()
        assertGallery(app)
        tap("native-ios-tab-files", app: app)
        assertFiles(app)
        tap("native-ios-tab-gallery", app: app)
        assertGallery(app)
        assertVisiblePixels(app, route: "People rotation after Files")
    }

    // 5. Originals help and Files operation-history must retire independently.
    func testOriginalsHelpFilesHistoryThenOriginals() {
        let app = launch(syntheticOwner: true)
        tap("native-ios-gallery-source-originals", app: app)
        assertCloudOriginalsChild(app)
        tap("native-ios-cloud-original-layout-help", app: app)
        let info = app.alerts["云端备份原件说明"].firstMatch
        XCTAssertTrue(info.waitForExistence(timeout: 15))
        info.buttons["完成"].tap()
        tap("native-ios-tab-files", app: app)
        openFilesOperationHistoryFromBrowse(app)
        XCTAssertTrue(target("native-ios-files-operation-history-page", app: app)
            .waitForExistence(timeout: 15))
        tap("native-ios-files-operation-history-done", app: app)
        tap("native-ios-tab-gallery", app: app)
        assertCloudOriginalsChild(app)
        assertVisiblePixels(app, route: "Originals after Files History")
    }

    // 6. PhotoKit date sheet must survive a real foreground transition.
    func testLocalPhotoDateSheetForegroundFilesThenLocal() {
        let app = launch()
        openLocalPhotoSource(app)
        assertLocalPhotoContent(app)
        tap("native-ios-local-timeline-open", app: app)
        // Query the actual PhotoKit timeline sheet's stable button ID; the
        // generic navigationBars["完成"] selector may rebind to the underlying
        // parent toolbar on foreground restoration. Still REQUIRE the same
        // date sheet after Home -> activate; never count auto-dismissal as pass.
        let done = target("native-ios-local-timeline-done", app: app)
        XCTAssertTrue(done.waitForExistence(timeout: 15),
                      "Real PhotoKit date sheet did not present its close action")
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertEqual(app.state, .runningForeground)
        if !done.waitForExistence(timeout: 15) {
            print("LOCAL_PHOTOKIT_DATE_FOREGROUND_MISSING AX tree:\n\(app.debugDescription)")
            let shot = XCTAttachment(screenshot: app.screenshot())
            shot.name = "native-local-date-foreground-missing"
            shot.lifetime = .keepAlways
            add(shot)
        }
        XCTAssertTrue(done.exists,
                      "Real PhotoKit timeline date sheet disappeared after foreground")
        done.tap()
        assertLocalPhotoContent(app)
        tap("native-ios-tab-files", app: app)
        assertFiles(app)
        tap("native-ios-tab-gallery", app: app)
        assertLocalPhotoContent(app)
        assertVisiblePixels(app, route: "Local PhotoKit after foreground Files")
    }


    // 1. Denied Cloud and Trash must not leave an overlay on Gallery sources.
    func testCloudTrashDenialsAlbumsOriginalsUnifiedAreReadable() {
        let app = launch(syntheticOwner: true)
        tap("native-ios-tab-files", app: app)
        tap("native-ios-files-open-root-location", app: app)
        XCTAssertTrue(target("native-ios-files-error-page", app: app)
            .waitForExistence(timeout: 15))
        tap("native-ios-files-error-return", app: app)
        tap("native-ios-files-open-trash", app: app)
        XCTAssertTrue(target("native-ios-files-trash-error-page", app: app)
            .waitForExistence(timeout: 15))
        tap("native-ios-files-trash-error-return", app: app)
        assertFiles(app)
        tap("native-ios-tab-gallery", app: app)
        tap("native-ios-gallery-source-albums", app: app)
        assertGallery(app)
        assertVisiblePixels(app, route: "Albums after Cloud/Trash")
        tap("native-ios-gallery-source-originals", app: app)
        assertCloudOriginalsChild(app)
        tap("native-ios-gallery-source-unified", app: app)
        assertGallery(app)
        assertVisiblePixels(app, route: "Unified after Cloud/Trash")
    }

    // 2. Saved Search and Operation History are independent modal lifetimes.
    func testSavedSearchHistoryForegroundAfterReverseSheetSequence() {
        let app = launch(syntheticOwner: true)
        tap("native-ios-tab-files", app: app)
        openFilesSavedSearchesFromBrowse(app)
        XCTAssertTrue(target("native-ios-files-saved-searches-page", app: app)
            .waitForExistence(timeout: 15))
        tap("native-ios-files-saved-searches-done", app: app)
        openFilesOperationHistoryFromBrowse(app)
        XCTAssertTrue(target("native-ios-files-operation-history-page", app: app)
            .waitForExistence(timeout: 15))
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertEqual(app.state, .runningForeground)
        XCTAssertTrue(target("native-ios-files-operation-history-page", app: app)
            .waitForExistence(timeout: 15))
        tap("native-ios-files-operation-history-done", app: app)
        XCTAssertFalse(target("native-ios-files-saved-searches-page", app: app).exists)
        tap("native-ios-tab-gallery", app: app)
        assertGallery(app)
        assertVisiblePixels(app, route: "Gallery after Saved Search/History")
    }

    // 3. People NavigationStack -> real local PhotoKit -> Files rail.
    func testPeopleLocalPhotoKitFilesQuickSectionsPreserveLocalWall() {
        let app = launch(syntheticOwner: true)
        tap("native-ios-gallery-people", app: app)
        XCTAssertTrue(target("native-ios-gallery-people-page", app: app)
            .waitForExistence(timeout: 15))
        let back = app.navigationBars.buttons.element(boundBy: 0)
        XCTAssertTrue(back.waitForExistence(timeout: 15))
        back.tap()
        openLocalPhotoSource(app)
        assertLocalPhotoContent(app)
        tap("native-ios-tab-files", app: app)
        for section in ["recent", "favorites", "browse"] {
            tap("native-ios-files-section-\(section)", app: app)
            assertFiles(app)
        }
        tap("native-ios-tab-gallery", app: app)
        assertGallery(app)
        assertLocalPhotoContent(app)
        assertVisiblePixels(app, route: "Local PhotoKit after People and Files")
    }

    // 4. Cancelled Gallery filter must not reappear after a denied Files child.
    func testGalleryFilterCancelThenCloudDenialKeepsNoGhostSheet() {
        let app = launch(syntheticOwner: true)
        tap("native-ios-gallery-open-filters", app: app)
        let cancel = app.buttons["取消"].firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 15))
        cancel.tap()
        assertGallery(app)
        tap("native-ios-tab-files", app: app)
        tap("native-ios-files-open-root-location", app: app)
        XCTAssertTrue(target("native-ios-files-error-page", app: app)
            .waitForExistence(timeout: 15))
        tap("native-ios-files-error-return", app: app)
        tap("native-ios-tab-gallery", app: app)
        assertGallery(app)
        XCTAssertFalse(target("native-ios-unified-gallery-map-scope", app: app).exists)
        assertVisiblePixels(app, route: "Gallery after filter/Cloud error return")
    }

    // 5. History rotation and Originals foreground should not cross-retain UI.
    func testFilesHistoryRotationOriginalsForegroundPreservesChild() {
        let app = launch(syntheticOwner: true)
        tap("native-ios-tab-files", app: app)
        openFilesOperationHistoryFromBrowse(app)
        XCTAssertTrue(target("native-ios-files-operation-history-page", app: app)
            .waitForExistence(timeout: 15))
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(target("native-ios-files-operation-history-page", app: app)
            .waitForExistence(timeout: 15))
        XCUIDevice.shared.orientation = .portrait
        tap("native-ios-files-operation-history-done", app: app)
        tap("native-ios-tab-gallery", app: app)
        tap("native-ios-gallery-source-originals", app: app)
        assertCloudOriginalsChild(app)
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertEqual(app.state, .runningForeground)
        assertCloudOriginalsChild(app)
        assertVisiblePixels(app, route: "Originals after History rotation")
    }

    // 6. Local PhotoKit date Sheet -> denied Trash -> same local Gallery.
    func testLocalPhotoDateThenTrashDenialRestoresPhotoKit() {
        let app = launch(syntheticOwner: true)
        openLocalPhotoSource(app)
        assertLocalPhotoContent(app)
        tap("native-ios-local-timeline-open", app: app)
        let done = app.navigationBars.buttons["完成"].firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 15))
        done.tap()
        tap("native-ios-tab-files", app: app)
        tap("native-ios-files-open-trash", app: app)
        XCTAssertTrue(target("native-ios-files-trash-error-page", app: app)
            .waitForExistence(timeout: 15))
        tap("native-ios-files-trash-error-return", app: app)
        tap("native-ios-tab-gallery", app: app)
        assertGallery(app)
        assertLocalPhotoContent(app)
        assertVisiblePixels(app, route: "Local PhotoKit after denied Trash")
    }


    func testFilesSizeFilterHorizontalGalleryReturn() {
        let app = launch(syntheticOwner: true)
        waitForRealH264RecordingPrelude()
        tap("native-ios-tab-files", app: app)
        assertFiles(app)
        applyFilesFilter("native-ios-files-search-size-filter", choice: "小于 1 MiB", app: app)
        assertVisiblePixels(app, route: "Files filtered by size")
        tap("native-ios-tab-gallery", app: app)
        assertGallery(app)
        tap("native-ios-tab-files", app: app)
        XCTAssertTrue(visibleFilesFilter("native-ios-files-search-size-filter", app: app)
            .label.contains("文件大小已筛选"), "Size selection was lost on Gallery return")
        assertVisiblePixels(app, route: "testFilesSizeFilterHorizontalGalleryReturn Files return")
        tap("native-ios-tab-gallery", app: app)
        assertGallery(app)
        assertVisiblePixels(app, route: "testFilesSizeFilterHorizontalGalleryReturn Gallery return")
    }


    func testFilesDateThenSizeFiltersKeepNoSessionGuard() {
        let app = launch(syntheticOwner: true)
        waitForRealH264RecordingPrelude()
        tap("native-ios-tab-files", app: app)
        assertFiles(app)
        applyFilesFilter("native-ios-files-search-date-filter", choice: "最近 7 天", app: app)
        applyFilesFilter("native-ios-files-search-size-filter", choice: "1–100 MiB", app: app)
        assertVisiblePixels(app, route: "Files both filters denied")
        assertVisiblePixels(app, route: "testFilesDateThenSizeFiltersKeepNoSessionGuard Files return")
        tap("native-ios-tab-gallery", app: app)
        assertGallery(app)
        assertVisiblePixels(app, route: "testFilesDateThenSizeFiltersKeepNoSessionGuard Gallery return")
    }


    func testFilesSizeFilterAfterQuickRailReentry() {
        let app = launch(syntheticOwner: true)
        waitForRealH264RecordingPrelude()
        tap("native-ios-tab-files", app: app)
        assertFiles(app)
        for section in ["recent", "favorites", "browse"] {
            tap("native-ios-files-section-\(section)", app: app)
            assertFiles(app)
        }
        applyFilesFilter("native-ios-files-search-size-filter", choice: "小于 1 MiB", app: app)
        assertVisiblePixels(app, route: "testFilesSizeFilterAfterQuickRailReentry Files return")
        tap("native-ios-tab-gallery", app: app)
        assertGallery(app)
        assertVisiblePixels(app, route: "testFilesSizeFilterAfterQuickRailReentry Gallery return")
    }


    func testFilesSizeFilterAfterSavedSearchesDismiss() {
        let app = launch(syntheticOwner: true)
        waitForRealH264RecordingPrelude()
        tap("native-ios-tab-files", app: app)
        assertFiles(app)
        openFilesSavedSearchesFromBrowse(app)
        XCTAssertTrue(target("native-ios-files-saved-searches-page", app: app)
            .waitForExistence(timeout: 15))
        tap("native-ios-files-saved-searches-done", app: app)
        assertFiles(app)
        applyFilesFilter("native-ios-files-search-size-filter", choice: "小于 1 MiB", app: app)
        assertVisiblePixels(app, route: "testFilesSizeFilterAfterSavedSearchesDismiss Files return")
        tap("native-ios-tab-gallery", app: app)
        assertGallery(app)
        assertVisiblePixels(app, route: "testFilesSizeFilterAfterSavedSearchesDismiss Gallery return")
    }


    func testFilesSizeFilterAfterCloudDenialReturn() {
        let app = launch(syntheticOwner: true)
        waitForRealH264RecordingPrelude()
        tap("native-ios-tab-files", app: app)
        assertFiles(app)
        tap("native-ios-files-open-root-location", app: app)
        XCTAssertTrue(target("native-ios-files-error-page", app: app)
            .waitForExistence(timeout: 15))
        tap("native-ios-files-error-return", app: app)
        assertFiles(app)
        applyFilesFilter("native-ios-files-search-size-filter", choice: "小于 1 MiB", app: app)
        assertVisiblePixels(app, route: "testFilesSizeFilterAfterCloudDenialReturn Files return")
        tap("native-ios-tab-gallery", app: app)
        assertGallery(app)
        assertVisiblePixels(app, route: "testFilesSizeFilterAfterCloudDenialReturn Gallery return")
    }


    func testFilesSizeFilterAfterForegroundResume() {
        let app = launch(syntheticOwner: true)
        waitForRealH264RecordingPrelude()
        tap("native-ios-tab-files", app: app)
        assertFiles(app)
        applyFilesFilter("native-ios-files-search-size-filter", choice: "小于 1 MiB", app: app)
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertEqual(app.state, .runningForeground)
        assertFiles(app)
        XCTAssertTrue(visibleFilesFilter("native-ios-files-search-size-filter", app: app)
            .label.contains("文件大小已筛选"), "Filter reset after foreground")
        assertVisiblePixels(app, route: "testFilesSizeFilterAfterForegroundResume Files return")
        tap("native-ios-tab-gallery", app: app)
        assertGallery(app)
        assertVisiblePixels(app, route: "testFilesSizeFilterAfterForegroundResume Gallery return")
    }

}
