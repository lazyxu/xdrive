import XCTest
import UIKit

/// Real native Simulator navigation smoke. A multi-color screenshot is only
/// a settled-frame blank-screen guard, never a claim of 60/120 Hz smoothness.
/// The synthetic Owner is deliberately not authenticated; protected cloud
/// operations must fail closed without replacing the Gallery/Files shell.
final class XDriveIOSGalleryFilesFrameContinuityUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

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
        let width = 24, height = 32
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
        let unique = Set(stride(from: 0, to: pixels.count, by: 4).map { index in
            (Int(pixels[index]) << 16) |
            (Int(pixels[index + 1]) << 8) |
            Int(pixels[index + 2])
        })
        XCTAssertGreaterThan(unique.count, 8, "Uniform/blank screen at \(route)")
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
            if action.isHittable { break }
            list.swipeUp()
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

    /// A Files tab remains mounted while its operations Sheet dismisses.
    /// Observe the real SwiftUI modal retirement, not a covered tab, before
    /// attempting navigation to Gallery. This still fails a stuck Sheet.
    private func awaitOperationsSheetRetired(_ app: XCUIApplication) {
        let sheet = target("native-ios-files-operation-history-page", app: app)
        let dismissed = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"), object: sheet)
        let status = XCTWaiter.wait(for: [dismissed], timeout: 12)
        if status != .completed {
            let evidence = XCTAttachment(screenshot: app.screenshot())
            evidence.name = "operation-history-sheet-stuck-after-done"
            evidence.lifetime = .keepAlways
            add(evidence)
            print("IOS_NATIVE_NAV_ERROR operations-sheet-persisted appState=\(app.state.rawValue)")
        }
        XCTAssertEqual(status, .completed,
                       "Operations Sheet remained mounted after Done; Gallery tab is covered")
        XCTAssertEqual(app.state, .runningForeground,
                       "Native process exited during operations Sheet dismissal")
    }

    func testFilesOperationHistorySheetDenialThenGalleryRetainsNativePages() {
        let app = launch(syntheticOwner: true)
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
        awaitOperationsSheetRetired(app)
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
        awaitOperationsSheetRetired(app)
        assertFiles(app)
        assertVisiblePixels(app, route: "Files after operations foreground")
        tap("native-ios-tab-gallery", app: app)
        let gallery = target("native-ios-gallery-source-unified", app: app)
        guard gallery.waitForExistence(timeout: 15) else {
            let evidence = XCTAttachment(screenshot: app.screenshot())
            evidence.name = "gallery-not-mounted-after-operations-foreground"
            evidence.lifetime = .keepAlways
            add(evidence)
            print("IOS_NATIVE_NAV_ERROR gallery-return-failed appState=\(app.state.rawValue)")
            XCTFail("Gallery source rail was lost after operations Sheet retirement")
            return
        }
        XCTAssertEqual(app.state, .runningForeground)
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


    // These six journeys extend the existing 70 real native Simulator cases.
    // They deliberately compose previously independent page, modal, rotation,
    // foreground and Owner transitions; they do not impersonate a Server login
    // or claim hardware 60/120Hz frame proof.

    func testLocalPhotoDateSheetThenCloudDeniedFilesReturnsLocalChild() {
        let app = launch(syntheticOwner: true)
        openLocalPhotoSource(app)
        assertLocalPhotoContent(app)
        tap("native-ios-local-timeline-open", app: app)
        let done = app.navigationBars.buttons["完成"].firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 15),
                      "PhotoKit date sheet missing before Files denial")
        done.tap()
        assertLocalPhotoContent(app)
        tap("native-ios-tab-files", app: app)
        assertFiles(app)
        tap("native-ios-files-open-root-location", app: app)
        XCTAssertTrue(target("native-ios-files-error-page", app: app)
            .waitForExistence(timeout: 15),
            "Unauthenticated cloud folder must show native recovery")
        tap("native-ios-files-error-return", app: app)
        assertFiles(app)
        tap("native-ios-tab-gallery", app: app)
        assertGallery(app)
        XCTAssertTrue(target("native-ios-gallery-source-local", app: app)
            .waitForExistence(timeout: 15),
            "Cloud Files denial must not replace the real local PhotoKit child")
        assertLocalPhotoContent(app)
        assertVisiblePixels(app, route: "PhotoKit date and denied Files return")
    }

    func testCloudOriginalsHelpThenFilesSearchKeyboardReturnsOriginalsChild() {
        let app = launch(syntheticOwner: true)
        tap("native-ios-gallery-source-originals", app: app)
        assertCloudOriginalsChild(app)
        tap("native-ios-cloud-original-layout-help", app: app)
        let info = app.alerts["云端备份原件说明"].firstMatch
        XCTAssertTrue(info.waitForExistence(timeout: 15),
                      "Real Originals explanation alert was not presented")
        info.buttons["完成"].tap()
        tap("native-ios-tab-files", app: app)
        assertFiles(app)
        let search = app.searchFields["搜索全部文件"].firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 15))
        search.tap()
        search.typeText("cross-route")
        if app.keyboards.buttons["Search"].exists {
            app.keyboards.buttons["Search"].tap()
        } else if app.keyboards.buttons["完成"].exists {
            app.keyboards.buttons["完成"].tap()
        } else {
            search.typeText("\n")
        }
        assertFiles(app)
        tap("native-ios-tab-gallery", app: app)
        assertGallery(app)
        assertCloudOriginalsChild(app)
        assertVisiblePixels(app, route: "Originals help Files keyboard return")
    }

    func testFilesOperationHistoryThenGalleryFilterReturnsSameNativeFilesRail() {
        let app = launch(syntheticOwner: true)
        tap("native-ios-tab-files", app: app)
        openFilesOperationHistoryFromBrowse(app)
        XCTAssertTrue(target("native-ios-files-operation-history-page", app: app)
            .waitForExistence(timeout: 15),
            "Native operation history was not presented")
        let done = target("native-ios-files-operation-history-done", app: app)
        XCTAssertTrue(done.waitForExistence(timeout: 15))
        done.tap()
        assertFiles(app)
        tap("native-ios-tab-gallery", app: app)
        tap("native-ios-gallery-open-filters", app: app)
        let cancel = app.buttons["取消"].firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 15),
                      "Gallery filter sheet missing after Files operation history")
        cancel.tap()
        assertGallery(app)
        tap("native-ios-tab-files", app: app)
        assertFiles(app)
        assertVisiblePixels(app, route: "Files after operations and Gallery filter")
    }

    func testFilesQuickRailLandscapeThenGalleryOriginalsPortraitKeepsChildren() {
        let device = XCUIDevice.shared
        let app = launch(syntheticOwner: true)
        defer { device.orientation = .portrait }
        tap("native-ios-tab-files", app: app)
        for section in ["recent", "favorites", "browse"] {
            tap("native-ios-files-section-\(section)", app: app)
            assertFiles(app)
        }
        device.orientation = .landscapeLeft
        assertFiles(app)
        assertVisiblePixels(app, route: "Files quick rail landscape")
        tap("native-ios-tab-gallery", app: app)
        assertGallery(app)
        device.orientation = .portrait
        tap("native-ios-gallery-source-originals", app: app)
        assertCloudOriginalsChild(app)
        tap("native-ios-tab-files", app: app)
        assertFiles(app)
        assertVisiblePixels(app, route: "Files after Originals rotated return")
    }

    func testSyntheticOwnerAlbumsFilesForegroundRelaunchDoesNotRetainOldScope() {
        let app = launch(syntheticOwner: true)
        tap("native-ios-gallery-source-albums", app: app)
        assertGallery(app)
        tap("native-ios-tab-files", app: app)
        tap("native-ios-files-section-favorites", app: app)
        assertFiles(app)
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertEqual(app.state, .runningForeground)
        assertFiles(app)
        app.terminate()
        app.launchArguments = ["-xdrive-ui-navigation-smoke"]
        app.launch()
        XCTAssertEqual(app.state, .runningForeground)
        tap("native-ios-tab-files", app: app)
        assertFiles(app)
        XCTAssertFalse(target("native-ios-files-open-root-location", app: app).exists,
                       "Synthetic Owner must not survive a fresh signed-out launch")
        tap("native-ios-tab-gallery", app: app)
        assertGallery(app)
        assertVisiblePixels(app, route: "Gallery after synthetic Owner relaunch")
    }

    func testFilesSearchGalleryPeopleBackAndQuickRailRemainAccessible() {
        let app = launch(syntheticOwner: true)
        tap("native-ios-tab-files", app: app)
        let search = app.searchFields["搜索全部文件"].firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 15))
        search.tap()
        search.typeText("people")
        if app.keyboards.buttons["Search"].exists {
            app.keyboards.buttons["Search"].tap()
        } else if app.keyboards.buttons["完成"].exists {
            app.keyboards.buttons["完成"].tap()
        } else {
            search.typeText("\n")
        }
        assertFiles(app)
        tap("native-ios-tab-gallery", app: app)
        tap("native-ios-gallery-people", app: app)
        XCTAssertTrue(target("native-ios-gallery-people-page", app: app)
            .waitForExistence(timeout: 15))
        let back = app.navigationBars.buttons.element(boundBy: 0)
        XCTAssertTrue(back.waitForExistence(timeout: 15))
        back.tap()
        assertGallery(app)
        tap("native-ios-tab-files", app: app)
        for section in ["recent", "browse"] {
            tap("native-ios-files-section-\(section)", app: app)
            assertFiles(app)
        }
        tap("native-ios-tab-gallery", app: app)
        assertGallery(app)
        assertVisiblePixels(app, route: "People after Files keyboard and rail")
    }
}
