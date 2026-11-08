import XCTest
import UIKit

/// The real Simulator app, using the same native Files/Gallery screens as a
/// signed-in user. The synthetic Owner has no access token: failed protected
/// reads may show an error, but must not kill or replace a navigation shell.
/// These are mount/return/crash checks, not proof of zero dropped frames.
final class XDriveIOSGalleryFilesStabilityUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    private func launch(syntheticOwner: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-xdrive-ui-navigation-smoke"]
        if syntheticOwner {
            app.launchArguments.append("-xdrive-ui-navigation-synthetic-owner")
        }
        app.launch()
        XCTAssertEqual(app.state, .runningForeground, "Native app exited during launch")
        return app
    }

    private func target(_ id: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func select(_ id: String, in app: XCUIApplication) {
        let control = target(id, in: app)
        XCTAssertTrue(control.waitForExistence(timeout: 15),
                      "Missing native navigation control: \(id)")
        control.tap()
        XCTAssertEqual(app.state, .runningForeground, "App exited after \(id)")
    }

    private func checkFilesHome(_ app: XCUIApplication) {
        XCTAssertTrue(target("native-ios-files-section-browse", in: app)
            .waitForExistence(timeout: 15), "Files quick rail disappeared")
        XCTAssertEqual(app.state, .runningForeground)
    }

    private func checkGallery(_ app: XCUIApplication) {
        XCTAssertTrue(target("native-ios-gallery-source-unified", in: app)
            .waitForExistence(timeout: 15), "Gallery source rail disappeared")
        XCTAssertEqual(app.state, .runningForeground)
    }

    func testRapidGalleryFilesTabOscillationPreservesBothShells() {
        let app = launch()
        for _ in 0..<8 {
            select("native-ios-tab-files", in: app)
            checkFilesHome(app)
            select("native-ios-tab-gallery", in: app)
            checkGallery(app)
        }
    }

    func testFilesQuickRailAlternatingSectionsReturnsToBrowse() {
        let app = launch(syntheticOwner: true)
        select("native-ios-tab-files", in: app)
        for _ in 0..<3 {
            for section in ["recent", "favorites", "browse"] {
                select("native-ios-files-section-\(section)", in: app)
                checkFilesHome(app)
            }
        }
    }

    func testGallerySourcesAlternateWithoutLosingSourceRail() {
        let app = launch()
        for _ in 0..<2 {
            for source in ["albums", "unified", "originals", "unified"] {
                select("native-ios-gallery-source-\(source)", in: app)
                checkGallery(app)
            }
        }
    }

    func testRepeatedFilterDismissalRestoresSameGallery() {
        let app = launch()
        for _ in 0..<3 {
            select("native-ios-gallery-open-filters", in: app)
            let cancel = app.buttons["取消"].firstMatch
            XCTAssertTrue(cancel.waitForExistence(timeout: 15),
                          "Gallery filter editor did not mount")
            cancel.tap()
            checkGallery(app)
            XCTAssertTrue(target("native-ios-gallery-open-filters", in: app)
                .waitForExistence(timeout: 10))
        }
    }

    func testOfflineOwnerCloudFilesBackKeepsHomeAndDoesNotExit() {
        let app = launch(syntheticOwner: true)
        select("native-ios-tab-files", in: app)
        checkFilesHome(app)
        select("native-ios-files-open-root-location", in: app)
        // The synthetic Owner has no token; its cloud read must fail closed.
        XCTAssertTrue(target("native-ios-files-retry", in: app)
            .waitForExistence(timeout: 25),
                      "Unauthorized Cloud read did not publish a recoverable error")
        // The old global navigationBars snapshot repeatedly blocked for 120s.
        // On error the native child offers a direct, accessible return action.
        select("native-ios-files-error-return", in: app)
        checkFilesHome(app)
        XCTAssertTrue(target("native-ios-files-open-root-location", in: app)
            .waitForExistence(timeout: 15))
    }

    func testOfflineOwnerGalleryPeopleChildBackRestoresSource() {
        let app = launch(syntheticOwner: true)
        select("native-ios-gallery-people", in: app)
        XCTAssertTrue(target("native-ios-gallery-people-page", in: app)
            .waitForExistence(timeout: 15), "People child did not mount")
        let back = app.navigationBars.buttons.element(boundBy: 0)
        XCTAssertTrue(back.waitForExistence(timeout: 15),
                      "People child back button not available")
        back.tap()
        checkGallery(app)
    }
    /// Retained after returning to the native tab, rather than accepting a
    /// screen-sized solid flash as successful merely because the app is alive.
    /// This is a sampled, *settled* frame guard; it is not a 60/120fps claim.
    private func assertNotSolidScreen(_ app: XCUIApplication, _ reason: String) {
        let screenshot = app.screenshot()
        guard let image = screenshot.image.cgImage else {
            XCTFail("No screenshot CGImage after " + reason)
            return
        }
        let width = 24, height = 32
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let rendered = pixels.withUnsafeMutableBytes { buffer -> Bool in
            guard let base = buffer.baseAddress,
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
        XCTAssertTrue(rendered, "Screenshot could not be sampled after " + reason)
        guard rendered else { return }
        let unique = Set(stride(from: 0, to: pixels.count, by: 4).map { offset in
            (Int(pixels[offset]) << 16) |
            (Int(pixels[offset + 1]) << 8) |
            Int(pixels[offset + 2])
        })
        XCTAssertGreaterThan(unique.count, 8,
                             "Native page became visually uniform after " + reason)
    }

    func testGalleryFilesAlternationRetainsNonBlankSettledFrames() {
        let app = launch()
        let started = Date()
        for _ in 0..<3 {
            select("native-ios-tab-files", in: app)
            checkFilesHome(app)
            assertNotSolidScreen(app, "Files tab mount")
            select("native-ios-tab-gallery", in: app)
            checkGallery(app)
            assertNotSolidScreen(app, "Gallery tab mount")
        }
        // A diagnostic for future comparative profiling. XCUITest event
        // dispatch/screenshot overhead is not equivalent to user-perceived FPS.
        print("IOS_GALLERY_FILES_SCREEN_AUDIT elapsed=\(Date().timeIntervalSince(started))")
    }

    func testGalleryFilterCancelAfterTabAndSourceRoundTrips() {
        let app = launch()
        for _ in 0..<3 {
            select("native-ios-gallery-source-albums", in: app)
            select("native-ios-gallery-source-unified", in: app)
            select("native-ios-gallery-open-filters", in: app)
            let cancel = app.buttons["取消"].firstMatch
            XCTAssertTrue(cancel.waitForExistence(timeout: 15),
                          "Filter cancel action missing after source switch")
            cancel.tap()
            select("native-ios-tab-files", in: app)
            checkFilesHome(app)
            select("native-ios-tab-gallery", in: app)
            checkGallery(app)
            XCTAssertTrue(target("native-ios-gallery-open-filters", in: app)
                .waitForExistence(timeout: 10))
        }
    }

    func testGalleryPeopleChildReturnRepeatsWithoutLosingGallerySource() {
        let app = launch(syntheticOwner: true)
        for _ in 0..<3 {
            select("native-ios-gallery-people", in: app)
            XCTAssertTrue(target("native-ios-gallery-people-page", in: app)
                .waitForExistence(timeout: 15))
            let back = app.navigationBars.buttons.element(boundBy: 0)
            XCTAssertTrue(back.waitForExistence(timeout: 15),
                          "Native People back was unavailable")
            back.tap()
            checkGallery(app)
        }
    }

}
