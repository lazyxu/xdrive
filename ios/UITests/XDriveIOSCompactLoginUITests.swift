import XCTest

/// Real native SwiftUI login shell, not a fake Server/Owner/session.
//// The CI-only launch selector mounts the product's actual login screen in
/// safe-startup mode. These checks never submit credentials, pair TLS, or
/// perform emergency stop; that destructive operation remains independently
/// covered by source security contracts.
final class XDriveIOSCompactLoginUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
    }

    private func view(_ id: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func app() -> XCUIApplication {
        let client = XCUIApplication()
        client.launchArguments = ["-xdrive-ui-login-compact-smoke"]
        client.launch()
        XCTAssertEqual(client.state, .runningForeground)
        XCTAssertTrue(view("native-ios-login-server", in: client)
            .waitForExistence(timeout: 20), "Real signed-out form never mounted")
        return client
    }

    private func expand(_ title: String, in client: XCUIApplication) {
        let button = client.buttons[title].firstMatch
        XCTAssertTrue(button.waitForExistence(timeout: 15),
                      "Missing real DisclosureGroup label: \(title)")
        // The login form scrolls on iPhones with compact Dynamic Type/keyboard.
        for _ in 0..<6 {
            if button.isHittable { break }
            client.swipeUp()
        }
        XCTAssertTrue(button.isHittable, "DisclosureGroup not tappable: \(title)")
        button.tap()
        XCTAssertEqual(client.state, .runningForeground)
    }

    private func frame(_ name: String, client: XCUIApplication) {
        let item = XCTAttachment(screenshot: client.screenshot())
        item.name = "native-compact-login-" + name
        item.lifetime = .keepAlways
        add(item)
    }

    func testDefaultFormContainsOnlyCoreFields() {
        let client = app()
        XCTAssertTrue(client.navigationBars["xDrive"].firstMatch.exists)
        for id in ["native-ios-login-server", "native-ios-login-username",
                   "native-ios-login-password", "native-ios-login-submit"] {
            XCTAssertTrue(view(id, in: client).exists, "Core sign-in control missing: \(id)")
        }
        for id in ["native-ios-login-lan-ip", "native-ios-remember-password",
                   "native-ios-keep-signed-in", "native-ios-lan-https-pairing",
                   "native-ios-offline-emergency-stop", "native-ios-prelogin-build",
                   "native-ios-clear-saved-login"] {
            XCTAssertFalse(view(id, in: client).exists,
                           "Optional control shown on compact form: \(id)")
        }
        XCTAssertFalse(client.staticTexts["iOS 原生客户端"].exists)
        XCTAssertFalse(client.staticTexts["连接到你的个人云端"].exists)
        XCTAssertFalse(client.buttons["使用已安全保存的密码重新登录"].exists)
        frame("default", client: client)
    }

    func testAdvancedConnectionAndLANHelpRemainAvailable() {
        let client = app()
        expand("高级连接设置", in: client)
        XCTAssertTrue(view("native-ios-login-lan-ip", in: client)
            .waitForExistence(timeout: 15))
        expand("内网 HTTPS 使用说明", in: client)
        XCTAssertTrue(client.staticTexts.matching(
            NSPredicate(format: "label CONTAINS %@", "登录前检测一次内网 HTTPS")
        ).firstMatch.waitForExistence(timeout: 15))
        frame("advanced-tls-help", client: client)
    }

    func testPreferencesAndAboutRemainReachable() {
        let client = app()
        expand("登录偏好", in: client)
        XCTAssertTrue(view("native-ios-remember-password", in: client)
            .waitForExistence(timeout: 15))
        XCTAssertTrue(view("native-ios-keep-signed-in", in: client).exists)
        expand("关于", in: client)
        XCTAssertTrue(view("native-ios-prelogin-build", in: client)
            .waitForExistence(timeout: 15))
        XCTAssertTrue(view("native-ios-copy-version", in: client).exists)
        frame("preferences-about", client: client)
    }

    func testHelpStillExposesOfflineEmergencyStop() {
        let client = app()
        expand("帮助与紧急操作", in: client)
        let emergency = view("native-ios-offline-emergency-stop", in: client)
        XCTAssertTrue(emergency.waitForExistence(timeout: 15))
        XCTAssertTrue(emergency.isEnabled,
                      "Emergency backup OFF must not require a current Owner")
        // Never invoke a destructive operation just to prove its availability.
        frame("help-emergency", client: client)
    }
}
