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
