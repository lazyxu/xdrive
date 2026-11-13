import XCTest

/// Real SwiftUI/UIKit Clipboard page on an iOS Simulator. The existing
/// navigation harness intentionally supplies no authenticated Server token.
/// These tests prove the *negative* Owner/Device gates and real page lifetime,
/// not a successful remote Files selection, revoke or upload.
final class XDriveIOSClipboardRuntimeUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    private func find(_ id: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func openClipboard(syntheticOwner: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-xdrive-ui-navigation-smoke"]
        if syntheticOwner {
            // The CI-only Owner fixture has no bearer or installation proof.
            app.launchArguments.append("-xdrive-ui-navigation-synthetic-owner")
        }
        app.launch()
        XCTAssertEqual(app.state, .runningForeground)
        let launcher = find("native-ios-tab-launcher", in: app)
        XCTAssertTrue(launcher.waitForExistence(timeout: 15))
        launcher.tap()
        let shortcut = find("native-ios-launcher-clipboard", in: app)
        let scroll = app.scrollViews.firstMatch
        XCTAssertTrue(scroll.waitForExistence(timeout: 15))
        for _ in 0..<8 {
            if shortcut.exists && shortcut.isHittable { break }
            scroll.swipeUp()
        }
        for _ in 0..<8 {
            if shortcut.exists && shortcut.isHittable { break }
            scroll.swipeDown()
        }
        XCTAssertTrue(shortcut.exists && shortcut.isHittable,
                      "Clipboard must be a reachable native Launcher route")
        shortcut.tap()
        XCTAssertTrue(find("ios-clipboard-draft", in: app)
            .waitForExistence(timeout: 15), "Native Clipboard editor did not mount")
        XCTAssertEqual(app.state, .runningForeground)
        return app
    }

    func testNoSessionClipboardIsVisibleWithoutUnlockAndCannotSend() {
        let app = openClipboard()
        XCTAssertTrue(app.buttons["从本机粘贴"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["启用本机设备定向接收"].exists)
        XCTAssertFalse(app.buttons["发送"].isEnabled,
                       "Empty Clipboard may not issue a blind Server write")
        XCTAssertFalse(app.buttons["从云端 Files 选择现有文件"].exists,
                       "An unverified target cannot expose a privileged cloud picker")
        XCTAssertFalse(app.buttons["撤销所选设备的 Clipboard 接收授权"].exists)
        XCTAssertFalse(app.buttons["解锁加密剪贴板"].exists)
        XCTAssertFalse(app.buttons["加密发送"].exists)
        XCTAssertEqual(app.state, .runningForeground)
    }

    func testSyntheticOwnerStillCannotEnrollRecipientOrRevoke() {
        let app = openClipboard(syntheticOwner: true)
        let enroll = app.buttons["启用本机设备定向接收"].firstMatch
        XCTAssertTrue(enroll.waitForExistence(timeout: 10))
        enroll.tap() // Real authorizedClient must fail: there is no bearer.
        let status = find("ios-clipboard-status", in: app)
        XCTAssertTrue(status.waitForExistence(timeout: 15),
                      "Denied enrollment must show a bounded native failure")
        XCTAssertFalse(app.buttons["撤销本机 Clipboard 接收授权"].exists,
                       "A synthetic Owner must not manufacture a recipient grant")
        XCTAssertFalse(app.buttons["从云端 Files 选择现有文件"].exists)
        XCTAssertFalse(app.buttons["定向发送"].exists)
        XCTAssertEqual(app.state, .runningForeground)
    }

    func testClipboardFilesGalleryRoundTripRestoresActualEditor() {
        let app = openClipboard()
        for _ in 0..<3 {
            let files = find("native-ios-tab-files", in: app)
            XCTAssertTrue(files.waitForExistence(timeout: 15))
            files.tap()
            XCTAssertTrue(find("native-ios-files-section-browse", in: app)
                .waitForExistence(timeout: 15))
            let gallery = find("native-ios-tab-gallery", in: app)
            gallery.tap()
            XCTAssertTrue(find("native-ios-gallery-source-unified", in: app)
                .waitForExistence(timeout: 15))
            let launcher = find("native-ios-tab-launcher", in: app)
            launcher.tap()
            let shortcut = find("native-ios-launcher-clipboard", in: app)
            let scroll = app.scrollViews.firstMatch
            for _ in 0..<8 {
                if shortcut.exists && shortcut.isHittable { break }
                scroll.swipeUp()
            }
            XCTAssertTrue(shortcut.exists && shortcut.isHittable)
            shortcut.tap()
            XCTAssertTrue(find("ios-clipboard-draft", in: app)
                .waitForExistence(timeout: 15))
            XCTAssertFalse(app.buttons["定向发送"].exists,
                           "The new Clipboard page cannot inherit a stale device target")
            XCTAssertEqual(app.state, .runningForeground)
        }
    }
}
