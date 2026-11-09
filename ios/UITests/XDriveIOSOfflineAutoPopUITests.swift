import XCTest

/// Separates native SwiftUI NavigationStack dismissal from XCUITest gesture
/// injection while using the REAL Files UI on a source-pinned iOS Simulator.
/// Synthetic Owner has no access token: protected reads must still fail closed.
final class XDriveIOSOfflineAutoPopUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    private func app(autoPop: Bool) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [
            "-xdrive-ui-navigation-smoke",
            "-xdrive-ui-navigation-synthetic-owner",
        ]
        if autoPop { app.launchArguments.append("-xdrive-ci-native-autopop") }
        app.launch()
        XCTAssertEqual(app.state, .runningForeground,
                       "The real SwiftUI app terminated at startup")
        return app
    }

    private func tap(_ id: String, in app: XCUIApplication) {
        let control = app.descendants(matching: .any)
            .matching(identifier: id).firstMatch
        XCTAssertTrue(control.waitForExistence(timeout: 15), "Missing \(id)")
        control.tap()
        XCTAssertEqual(app.state, .runningForeground, "Process died after \(id)")
    }

    func testNativeCloudChildPushWithoutPopRemainsAlive() {
        let app = app(autoPop: false)
        tap("native-ios-tab-files", in: app)
        tap("native-ios-files-open-root-location", in: app)
        Thread.sleep(forTimeInterval: 4)
        XCTAssertEqual(app.state, .runningForeground,
                       "Offline cloud child mount caused a real process exit")
        // No navigation operation here. The existing #4128 test observes this
        // path passes; this is the source-pinned control for the auto-pop.
    }

    func testNativeAutoPopReturnsHomeWithoutXCUISwipe() {
        let app = app(autoPop: true)
        tap("native-ios-tab-files", in: app)
        tap("native-ios-files-open-root-location", in: app)
        // Native child .task calls DismissAction after 1.5 seconds. XCTest
        // NEVER calls app.coordinate(...), press(...), or a Back button here.
        // A new, CI-only Home marker is exposed only after the native pop.
        let home = app.staticTexts["native-ios-ci-native-autopop-home"].firstMatch
        let visible = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "isHittable == true"), object: home
        )
        let outcome = XCTWaiter.wait(for: [visible], timeout: 18)
        if outcome != .completed {
            print("NATIVE_AUTOPOP_RESULT home marker not interactive; "
                + "app state=\(app.state.rawValue)")
            // Do not request a second accessibility snapshot here: that masked
            // the primary timeout for ~200s. An external Simulator screenshot,
            // process sample, and app-container stage trace are archived by CI.
        }
        XCTAssertEqual(outcome, .completed,
            "Native SwiftUI dismiss did not restore an interactive Home; "
            + "distinguish app view-graph stall from XCUI gesture injection")
        XCTAssertEqual(app.state, .runningForeground,
                       "App process exited after native SwiftUI dismiss")
    }
}
