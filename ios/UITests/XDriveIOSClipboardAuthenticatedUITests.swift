import XCTest
import UIKit
import Foundation

/// Real native sign-in and current Owner authorization over a TLS-verified
/// loopback fixture. The Server is deliberately fake, never production NAS.
/// These tests cannot pass by setting a synthetic Owner without a bearer.
final class XDriveIOSClipboardAuthenticatedUITests: XCTestCase {
    private let origin = "https://127.0.0.1:19443"
    private let deviceName = "Fixture iPhone · ios"

    private struct Stats: Decodable {
        let writes: Int
        let last_node: Int
        let upload_creates: Int
        let upload_chunks: Int
        let upload_finalizes: Int
        let revoke_attempts: Int
        let revokes: Int
    }

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    private func node(_ id: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func fill(_ element: XCUIElement, with value: String) {
        XCTAssertTrue(element.waitForExistence(timeout: 25))
        element.tap()
        if let current = element.value as? String,
           current != element.placeholderValue, !current.isEmpty {
            element.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue,
                                    count: current.count))
        }
        element.typeText(value)
    }

    /// User fills the production login form. No launch argument, synthetic
    /// session, test bypass, bearer injection or mocked SwiftUI ViewModel.
    private func signIn(_ user: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launch()
        let server = node("native-ios-login-server", in: app)
        XCTAssertTrue(server.waitForExistence(timeout: 30),
                      "Normal native login must mount for isolated HTTPS Owner")
        fill(server, with: origin)
        fill(node("native-ios-login-username", in: app), with: user)
        let secret = app.secureTextFields.firstMatch
        fill(secret, with: "fixture-password")

        // Tests must not store a refresh credential in device Keychain.
        let keep = app.switches["保持登录"].firstMatch
        for _ in 0..<6 {
            if keep.exists && keep.isHittable { break }
            app.scrollViews.firstMatch.swipeUp()
        }
        XCTAssertTrue(keep.exists && keep.isHittable)
        if (keep.value as? String) == "1" { keep.tap() }

        let submit = node("native-ios-login-submit", in: app)
        XCTAssertTrue(submit.waitForExistence(timeout: 15))
        submit.tap()
        let launcher = node("native-ios-tab-launcher", in: app)
        XCTAssertTrue(launcher.waitForExistence(timeout: 40),
                      "Real HTTPS login/Owner/root verification never completed")
        return app
    }

    private func openClipboard(_ app: XCUIApplication) {
        let launcher = node("native-ios-tab-launcher", in: app)
        XCTAssertTrue(launcher.waitForExistence(timeout: 15))
        launcher.tap()
        let shortcut = node("native-ios-launcher-clipboard", in: app)
        let scroll = app.scrollViews.firstMatch
        for _ in 0..<10 {
            if shortcut.exists && shortcut.isHittable { break }
            scroll.swipeUp()
        }
        XCTAssertTrue(shortcut.exists && shortcut.isHittable)
        shortcut.tap()
        XCTAssertTrue(node("ios-clipboard-draft", in: app)
            .waitForExistence(timeout: 20))
    }

    private func chooseDevice(_ app: XCUIApplication) {
        let menu = node("ios-clipboard-target-picker", in: app)
        XCTAssertTrue(menu.waitForExistence(timeout: 20))
        menu.tap()
        let selected = app.buttons[deviceName].firstMatch
        XCTAssertTrue(selected.waitForExistence(timeout: 15),
                      "Real authenticated device directory was not populated")
        selected.tap()
        XCTAssertTrue(app.buttons["定向发送"].firstMatch
            .waitForExistence(timeout: 15))
    }

    private func chooseImageReference(_ app: XCUIApplication) {
        let segment = app.descendants(matching: .any).matching(
            NSPredicate(format: "label == %@", "现有云端图片引用")).firstMatch
        XCTAssertTrue(segment.waitForExistence(timeout: 15))
        segment.tap()
        XCTAssertTrue(app.buttons["从云端 Files 选择现有文件"]
            .waitForExistence(timeout: 15))
    }

    private func currentStats(_ user: String) async throws -> Stats {
        let address = URL(string: origin + "/__fixture/stats?user=" + user)!
        let (body, response) = try await URLSession.shared.data(from: address)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        return try JSONDecoder().decode(Stats.self, from: body)
    }

    private func waitStats(_ user: String, test: (Stats) -> Bool) async throws -> Stats {
        var observed = try await currentStats(user)
        for _ in 0..<35 {
            if test(observed) { return observed }
            try await Task.sleep(nanoseconds: 300_000_000)
            observed = try await currentStats(user)
        }
        XCTFail("Expected exact authenticated Clipboard operation counts never appeared")
        return observed
    }

    private func waitMessage(_ text: String, in app: XCUIApplication) {
        let message = node("ios-clipboard-status", in: app)
        XCTAssertTrue(message.waitForExistence(timeout: 20))
        let expected = NSPredicate(format: "label CONTAINS %@", text)
        let result = XCTNSPredicateExpectation(predicate: expected, object: message)
        XCTAssertEqual(XCTWaiter.wait(for: [result], timeout: 25), .completed)
    }

    func testOwnerCloudFileSelectionNeedsSeparateDirectedSend() async throws {
        let user = "ui_cloud_valid"
        let app = signIn(user)
        openClipboard(app)
        chooseDevice(app)
        chooseImageReference(app)
        app.buttons["从云端 Files 选择现有文件"].tap()
        let row = app.buttons["clip.png"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 20))
        row.tap()
        waitMessage("已从当前 Owner 的 Files 核验文件", in: app)
        let observedWrites = try await currentStats(user)
        XCTAssertEqual(observedWrites.writes, 0)
        app.buttons["定向发送"].tap()
        let receipt = try await waitStats(user) { $0.writes == 1 }
        XCTAssertEqual(receipt.last_node, 55)
    }

    func testOwnerStaleCloudNodeCannotBecomeSendableReference() async throws {
        let user = "ui_cloud_stale"
        let app = signIn(user)
        openClipboard(app)
        chooseDevice(app)
        chooseImageReference(app)
        app.buttons["从云端 Files 选择现有文件"].tap()
        let row = app.buttons["clip.png"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 20))
        row.tap()
        waitMessage("所选云端文件已变化或权限失效", in: app)
        let observedWrites = try await currentStats(user)
        XCTAssertEqual(observedWrites.writes, 0)
        app.buttons["定向发送"].tap()
        let observedWrites = try await currentStats(user)
        XCTAssertEqual(observedWrites.writes, 0)
    }

    private func rejectedRevoke(_ user: String) async throws {
        let app = signIn(user)
        openClipboard(app)
        chooseDevice(app)
        let revoke = app.buttons["撤销所选设备的 Clipboard 接收授权"]
        XCTAssertTrue(revoke.exists)
        revoke.tap()
        let cancel = app.buttons["取消"].firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 10))
        cancel.tap()
        let observedRevoke_attempts = try await currentStats(user)
        XCTAssertEqual(observedRevoke_attempts.revoke_attempts, 0)

        revoke.tap()
        let confirm = app.buttons["确认撤销"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 10))
        confirm.tap()
        waitMessage("撤销未确认", in: app)
        let receipt = try await waitStats(user) { $0.revoke_attempts == 1 }
        XCTAssertEqual(receipt.revokes, 0)
        XCTAssertEqual(receipt.writes, 0)
        XCTAssertTrue(app.buttons["撤销所选设备的 Clipboard 接收授权"].exists)
    }

    func testOwnerRevoke403FailsClosedWithoutAutoRetry() async throws {
        try await rejectedRevoke("ui_revoke403")
    }

    func testOwnerRevoke404FailsClosedWithoutAutoRetry() async throws {
        try await rejectedRevoke("ui_revoke404")
    }

    private func putTwoPixelPNGOnSystemClipboard() {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 2, height: 2))
        let image = renderer.image { context in
            UIColor.systemBlue.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 2, height: 2))
        }
        let data = image.pngData()!
        UIPasteboard.general.setData(data, forPasteboardType: "public.png")
        XCTAssertEqual(UIPasteboard.general.data(forPasteboardType: "public.png"), data)
    }

    private func importOSPNG(_ user: String) -> XCUIApplication {
        let app = signIn(user)
        openClipboard(app)
        chooseDevice(app)
        chooseImageReference(app)
        putTwoPixelPNGOnSystemClipboard()
        app.buttons["读取本机剪贴板图片并上传"].tap()
        // The consent is an OS prompt, not an xDrive bypass. A simulator
        // without a prompt continues directly; a visible one is confirmed.
        let alert = app.alerts.firstMatch
        if alert.waitForExistence(timeout: 2) {
            let allow = alert.buttons["Allow Paste"].exists
                ? alert.buttons["Allow Paste"] : alert.buttons["允许粘贴"]
            XCTAssertTrue(allow.exists)
            allow.tap()
        }
        return app
    }

    func testOwnerSystemPNGUploadsVerifiedCASBeforeDirectedSend() async throws {
        let user = "ui_cas_ok"
        let app = importOSPNG(user)
        waitMessage("原件已上传到当前 Owner 的 CAS", in: app)
        let uploaded = try await waitStats(user) { $0.upload_finalizes == 1 }
        XCTAssertEqual(uploaded.upload_creates, 1)
        XCTAssertEqual(uploaded.upload_chunks, 1)
        XCTAssertEqual(uploaded.writes, 0)
        app.buttons["定向发送"].tap()
        let sent = try await waitStats(user) { $0.writes == 1 }
        XCTAssertEqual(sent.last_node, 60)
    }

    func testOwnerCASMismatchedReadbackNeverSends() async throws {
        let user = "ui_cas_bad"
        let app = importOSPNG(user)
        waitMessage("本机文件上传未确认", in: app)
        let attempted = try await waitStats(user) { $0.upload_finalizes == 1 }
        XCTAssertEqual(attempted.upload_chunks, 1)
        XCTAssertEqual(attempted.writes, 0)
        app.buttons["定向发送"].tap()
        let observedWrites = try await currentStats(user)
        XCTAssertEqual(observedWrites.writes, 0)
    }

    func testRealOwnerPageAndForegroundRoundtripCannotReuseOldTarget() async throws {
        let user = "ui_lifecycle"
        let app = signIn(user)
        openClipboard(app)
        chooseDevice(app)
        node("native-ios-tab-files", in: app).tap()
        node("native-ios-tab-gallery", in: app).tap()
        XCUIDevice.shared.press(.home)
        app.activate()
        openClipboard(app)
        let picker = node("ios-clipboard-target-picker", in: app)
        XCTAssertTrue(picker.exists)
        XCTAssertFalse(app.buttons["定向发送"].exists,
                       "Re-entered Clipboard must not replay old target")
        let observedWrites = try await currentStats(user)
        XCTAssertEqual(observedWrites.writes, 0)
    }
}
