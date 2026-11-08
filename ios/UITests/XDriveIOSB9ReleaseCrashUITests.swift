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

    private func mountedSheet(_ name: String, section: String,
                              in app: XCUIApplication, stage: String) {
        let navigation = app.navigationBars[name].firstMatch
        let heading = app.staticTexts[section].firstMatch
        let visible = navigation.waitForExistence(timeout: 5) ||
                      heading.waitForExistence(timeout: 5)
        if !visible { record(app, "sheet-absent-\(stage)") }
        alive(app, stage)
        XCTAssertTrue(visible, "Navigation failure; NOT proof of process crash")
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
        XCTAssertTrue(entry("native-ios-files-section-browse", in: app).exists)
        // No Session/token is provided: this does not assert a successful
        // authenticated file read or create an unsafe test credential.
    }

    func testPublishedB9OperationHistorySheetRepeatAndDismiss() {
        let app = launch(owner: true)
        tap("native-ios-tab-files", in: app)
        for cycle in 0..<2 {
            homeButton("native-ios-files-open-operations", in: app).tap()
            alive(app, "history-open-\(cycle)")
            mountedSheet("操作历史", section: "服务器文件操作（最近 50 项）",
                         in: app, stage: "history-mount-\(cycle)")
            let done = app.buttons["完成"].firstMatch
            XCTAssertTrue(done.waitForExistence(timeout: 10))
            done.tap()
            alive(app, "history-dismiss-\(cycle)")
            XCTAssertTrue(entry("native-ios-files-section-browse", in: app).exists)
        }
    }

    func testPublishedB9SavedSearchSheetRepeatAndDismiss() {
        let app = launch(owner: true)
        tap("native-ios-tab-files", in: app)
        for cycle in 0..<2 {
            homeButton("native-ios-files-open-saved-searches", in: app).tap()
            alive(app, "saved-search-open-\(cycle)")
            mountedSheet("智能文件夹", section: "新建智能文件夹",
                         in: app, stage: "saved-search-mount-\(cycle)")
            let done = app.buttons["完成"].firstMatch
            XCTAssertTrue(done.waitForExistence(timeout: 10))
            done.tap()
            alive(app, "saved-search-dismiss-\(cycle)")
            XCTAssertTrue(entry("native-ios-files-section-browse", in: app).exists)
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
