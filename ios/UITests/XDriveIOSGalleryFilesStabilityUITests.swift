import XCTest

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
        // XCTest's global NavigationBar/Back accessibility queries have
        // repeatedly hung in this real SwiftUI pushed-folder layout (~120s)
        // even while the app remains foreground. Exercise iOS's actual
        // interactive navigation POP gesture instead of guessing a back
        // button via a stalled accessibility snapshot.
        XCTAssertEqual(app.state, .runningForeground,
                       "Native process exited while opening offline Files child")
        let leadingEdge = app.coordinate(withNormalizedOffset:
            CGVector(dx: 0.015, dy: 0.48))
        let inside = app.coordinate(withNormalizedOffset:
            CGVector(dx: 0.80, dy: 0.48))
        leadingEdge.press(forDuration: 0.06, thenDragTo: inside)
        XCTAssertEqual(app.state, .runningForeground,
                       "Native process exited during iOS interactive back")
        // This must be a real push/pop, not merely an app-alive assertion:
        // the same Files Home rail and exact root NavigationLink must return.
        let browse = target("native-ios-files-section-browse", in: app)
        if !browse.waitForExistence(timeout: 15) {
            print("OFFLINE_OWNER_FILES no Home after interactive back; state=\(app.state.rawValue)")
            let capture = XCTAttachment(screenshot: app.screenshot())
            capture.name = "offline-owner-back-return"
            capture.lifetime = .keepAlways
            add(capture)
        }
        XCTAssertTrue(browse.exists, "Files Home did not return after native back gesture")
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
}
