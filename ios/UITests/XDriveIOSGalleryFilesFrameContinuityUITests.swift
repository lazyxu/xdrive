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

    func testFilesOperationHistorySheetDenialThenGalleryRetainsNativePages() {
        let app = launch(syntheticOwner: true)
        tap("native-ios-tab-files", app: app)
        assertFiles(app)
        tap("native-ios-files-open-operations", app: app)
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
        tap("native-ios-files-open-operations", app: app)
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
}
