import XCTest

/// Real SwiftUI / XCUITest for the exact published b9d5f9695826 source.
/// Synthetic Owner has NO token or authorized Server: read failures fail
/// closed. Simulator results do not prove a physical signed IPA is crash-free.
final class XDriveIOSB9ReleaseCrashUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    private func record(_ app: XCUIApplication, _ stage: String) {
        print("B9_CRASH stage=\(stage) appState=\(app.state.rawValue)")
        if app.state == .runningForeground {
            // An AX hierarchy dump can itself block for 120s when an unreadable
            // Files child is present. Capture pixels before any AX enumeration.
            let attachment = XCTAttachment(screenshot: app.screenshot())
            attachment.name = "b9-\(stage)"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
    }

    private func alive(_ app: XCUIApplication, _ stage: String,
                       file: StaticString = #filePath, line: UInt = #line) {
        if app.state != .runningForeground { record(app, stage) }
        XCTAssertEqual(app.state, .runningForeground,
            "Process exited at \(stage), inspect matching Simulator .ips",
            file: file, line: line)
    }

    private func launch(smoke: Bool = true, owner: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        if smoke {
            app.launchArguments = ["-xdrive-ui-navigation-smoke"]
            if owner {
                app.launchArguments.append("-xdrive-ui-navigation-synthetic-owner")
            }
        }
        app.launch()
        alive(app, "launch")
        return app
    }

    private func entry(_ id: String, in app: XCUIApplication) -> XCUIElement {
        let control = app.descendants(matching: .any)
            .matching(identifier: id).firstMatch
        if !control.waitForExistence(timeout: 12) { record(app, "missing-\(id)") }
        XCTAssertTrue(control.exists, "Native element missing: \(id)")
        alive(app, "find-\(id)")
        return control
    }

    private func tap(_ id: String, in app: XCUIApplication) {
        entry(id, in: app).tap()
        alive(app, "tap-\(id)")
    }

    private func homeButton(_ id: String, in app: XCUIApplication) -> XCUIElement {
        // Files Home uses a lazy native collection. Do NOT fake coordinates or
        // claim a crash merely because a deep row has not been materialized.
        let list = app.collectionViews.firstMatch
        XCTAssertTrue(list.waitForExistence(timeout: 12))
        let button = app.buttons.matching(identifier: id).firstMatch
        for _ in 0..<7 {
            if button.exists && button.isHittable { return button }
            list.swipeUp()
            alive(app, "scroll-\(id)")
        }
        record(app, "unreachable-\(id)")
        XCTAssertTrue(button.exists && button.isHittable,
                      "Native Files Home entry missing: \(id)")
        return button
    }

    private func assertNoSessionSheetDenial(
        _ id: String, message: String, in app: XCUIApplication, cycle: Int
    ) {
        // A synthetic Owner is the *same identity* while the auth Session is
        // absent. The real screen therefore mounts, but its protected GET
        // fails closed and publishes the read error. "Account changed" is only
        // correct for an actual Owner mismatch; never assert that false case.
        let denied = app.staticTexts[message].firstMatch
        if !denied.waitForExistence(timeout: 8) {
            record(app, "unexpected-\(id)-\(cycle)")
        }
        alive(app, "synthetic-owner-\(id)-\(cycle)")
        XCTAssertTrue(denied.exists,
            "Missing expected fail-closed no-Session screen for \(id). " +
            "Do not fake a successful authenticated Owner in Simulator.")
    }

    func testPublishedB9RealColdStartAndRestart() {
        let app = XCUIApplication()
        // The real startup root runs; this only initializes the non-secret
        // previous-launch checkpoint. It does NOT install a fake login.
        app.launchArguments = ["-xdrive.ios.native.launch-checkpoint.v1", "ready"]
        app.launch()
        alive(app, "real-cold-start")
        let field = app.descendants(matching: .any)
            .matching(identifier: "native-ios-login-server").firstMatch
        if !field.waitForExistence(timeout: 16) { record(app, "login-not-mounted") }
        XCTAssertTrue(field.exists)
        Thread.sleep(forTimeInterval: 4)
        alive(app, "startup-stabilized")
        app.terminate()
        app.launchArguments = []
        app.launch()
        alive(app, "real-second-start")
        if !field.waitForExistence(timeout: 16) {
            // The cold-launch checkpoint intentionally treats termination
            // before workspace readiness as an incomplete start. Recovery
            // must be usable rather than misclassified as an App crash.
            let rescue = app.buttons["native-ios-startup-safe-entry"].firstMatch
            if !rescue.waitForExistence(timeout: 8) {
                record(app, "restart-not-mounted")
            }
            XCTAssertTrue(rescue.exists,
                          "Neither normal login nor safe startup recovery mounted")
            rescue.tap()
            alive(app, "recovery-safe-entry")
            XCTAssertTrue(field.waitForExistence(timeout: 20),
                          "Safe startup could not mount the native login form")
        }
        XCTAssertTrue(field.exists, "Native login must be reachable after restart")
    }

    func testPublishedB9EightRealGalleryFilesTabRoundTrips() {
        let app = launch()
        for cycle in 0..<8 {
            tap("native-ios-tab-files", in: app)
            XCTAssertTrue(entry("native-ios-files-section-browse", in: app).exists,
                          "Files view did not mount at cycle \(cycle)")
            tap("native-ios-tab-gallery", in: app)
            alive(app, "gallery-return-\(cycle)")
        }
    }

    func testPublishedB9OfflineOwnerFolderDoesNotTerminateProcess() {
        let app = launch(owner: true)
        tap("native-ios-tab-files", in: app)
        tap("native-ios-files-open-root-location", in: app)
        alive(app, "offline-owner-open")
        // An offline synthetic Owner cannot load private Server contents,
        // but entering a child route must not kill the native process.
        // Do not query a Files-local rail in a pushed directory: that is a
        // separate UX feature and can stall XCUI accessibility snapshots.
        Thread.sleep(forTimeInterval: 2)
        alive(app, "offline-owner-after-denied-read")
        // No Session/token is provided; never invent a successful file read.
    }

    func testPublishedB9OperationHistorySyntheticOwnerFailsClosed() {
        for cycle in 0..<2 {
            let app = launch(owner: true)
            tap("native-ios-tab-files", in: app)
            homeButton("native-ios-files-open-operations", in: app).tap()
            alive(app, "history-open-\(cycle)")
            assertNoSessionSheetDenial(
                "history", message: "无法验证文件操作历史，请检查网络后重试。",
                in: app, cycle: cycle)
            app.terminate()
        }
    }

    func testPublishedB9SavedSearchSyntheticOwnerFailsClosed() {
        for cycle in 0..<2 {
            let app = launch(owner: true)
            tap("native-ios-tab-files", in: app)
            homeButton("native-ios-files-open-saved-searches", in: app).tap()
            alive(app, "saved-search-open-\(cycle)")
            assertNoSessionSheetDenial(
                "saved-search", message: "无法验证当前账户的智能文件夹，请检查网络后重试。",
                in: app, cycle: cycle)
            app.terminate()
        }
    }

    func testPublishedB9FilesSceneBackgroundAndForeground() {
        let app = launch(owner: true)
        tap("native-ios-tab-files", in: app)
        for cycle in 0..<3 {
            XCUIDevice.shared.press(.home)
            app.activate()
            alive(app, "files-reactivate-\(cycle)")
            XCTAssertTrue(entry("native-ios-files-section-browse", in: app).exists)
        }
    }
}
