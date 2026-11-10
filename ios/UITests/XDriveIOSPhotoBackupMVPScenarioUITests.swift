import XCTest

/// Candidate-only real SwiftUI backup navigation in iPhone Simulator.
/// The test harness mounts the production Backup screen with no Server
/// session or forged photo receipt. This tests crash/navigation behavior,
/// not real PhotoKit transfer, APNs, iCloud or signed-device acceptance.
final class XDriveIOSPhotoBackupMVPScenarioUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    private func launch(syntheticOwner: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [
            "-xdrive-ui-navigation-smoke",
            "-xdrive-ui-photo-backup-direct"
        ]
        if syntheticOwner {
            app.launchArguments.append("-xdrive-ui-navigation-synthetic-owner")
        }
        app.launch()
        XCTAssertEqual(app.state, .runningForeground,
                       "Native backup crashed on initial mount")
        return app
    }

    private func find(_ id: String, app: XCUIApplication) -> XCUIElement {
        let element = app.descendants(matching: .any)
            .matching(identifier: id).firstMatch
        if !element.waitForExistence(timeout: 20) {
            print("BACKUP_MVP missing \(id) hierarchy:\n\(app.debugDescription)")
            let attachment = XCTAttachment(screenshot: app.screenshot())
            attachment.name = "backup-missing-\(id)"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
        XCTAssertTrue(element.exists, "Native Backup element not mounted: \(id)")
        return element
    }

    func testOverviewTaskSheetAndReturnRepeatedlyWithoutCrash() {
        let app = launch()
        for cycle in 0..<3 {
            XCTAssertTrue(find("native-ios-backup-overview", app: app).exists)
            find("native-ios-photos-task-list", app: app).tap()
            // Nested NavigationStack titles can be represented as parent
            // bars by the accessibility runtime. The unique sheet Close
            // control is an exact, visible native modal witness instead.
            let done = find("native-ios-photo-task-list-done", app: app)
            XCTAssertTrue(done.isHittable,
                          "Native task sheet must be foreground on cycle \(cycle)")
            done.tap()
            XCTAssertTrue(find("native-ios-backup-overview", app: app).exists)
            XCTAssertFalse(app.buttons["native-ios-photo-task-list-done"].exists,
                           "Closing task sheet must release its modal controls")
            XCTAssertEqual(app.state, .runningForeground,
                           "Backup exited after task sheet cycle \(cycle)")
        }
    }

    func testOfflineOwnerSettingsAndBackgroundReturnStayFailClosed() {
        let app = launch(syntheticOwner: true)
        XCTAssertTrue(find("native-ios-backup-overview", app: app).exists)
        let details = app.buttons["备份详情"].firstMatch
        XCTAssertTrue(details.waitForExistence(timeout: 20))
        details.tap()
        XCTAssertTrue(find("native-ios-backup-portrait-form", app: app).exists)
        // A synthetic identity has no authenticated session or Server receipt;
        // merely viewing settings cannot create a successful backup status.
        XCTAssertFalse(app.staticTexts["当前服务器已确认后台授权"].exists)
        for cycle in 0..<3 {
            XCUIDevice.shared.press(.home)
            app.activate()
            XCTAssertEqual(app.state, .runningForeground,
                           "Backup exited on reactivation \(cycle)")
            XCTAssertTrue(find("native-ios-backup-portrait-form", app: app).exists)
        }
        let back = app.buttons["返回相册备份"].firstMatch
        XCTAssertTrue(back.waitForExistence(timeout: 15))
        back.tap()
        XCTAssertTrue(find("native-ios-backup-overview", app: app).exists)
    }
}
