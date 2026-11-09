import XCTest

/// Real SwiftUI / XCUITest for the exact published b9d5f9695826 source.
/// Synthetic Owner has NO token or authorized Server: read failures fail
/// closed. Simulator results do not prove a physical signed IPA is crash-free.
final class XDriveIOSB9ReleaseCrashUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    private func record(_ app: XCUIApplication, _ stage: String) {
        print("B9_CRASH stage=\(stage) appState=\(app.state.rawValue)")
        if app.state == .runningForeground {
            print("B9_CRASH AX hierarchy:\n\(app.debugDescription)")
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
        // The smoke harness has a synthetic Owner identity but no actual
        // authenticated Session. At source b9 its native sheets show an
        // explicit "account changed" denial instead of an operation history.
        // This is NOT a logged-in Owner success or a crash reproduction.
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
        if !field.waitForExistence(timeout: 16) { record(app, "restart-not-mounted") }
        XCTAssertTrue(field.exists, "Normal restart entered recovery or failed to mount")
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
                "history", message: "账户已经变化，请关闭操作历史。",
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
                "saved-search", message: "账户已经变化，请关闭智能文件夹。",
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
