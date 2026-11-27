import XCTest
import UIKit

/// Explicit signed physical-iPhone fixture only. The default Simulator
/// Gallery/Files matrix never selects this class, so a skipped device test
/// cannot masquerade as screenshot or cloud feature acceptance.
final class XDriveIOSFilesSignedParityUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
    }

    private func control(_ id: String, _ app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func tap(_ id: String, _ app: XCUIApplication) {
        let element = control(id, app)
        XCTAssertTrue(element.waitForExistence(timeout: 15),
                      "Missing actual signed-device Files control: " + id)
        XCTAssertTrue(element.isHittable, "Unreachable real Files control: " + id)
        print("IOS_NATIVE_NAV_TAP_START route=" + id)
        element.tap()
        XCTAssertEqual(app.state, .runningForeground)
    }

    private func attachFilesParityFrame(
        _ app: XCUIApplication, _ stage: String, auth: String
    ) {
        XCTAssertEqual(app.state, .runningForeground)
        let image = app.screenshot()
        let attachment = XCTAttachment(screenshot: image)
        attachment.name = "ios-files-native-" + stage
        attachment.lifetime = .keepAlways
        add(attachment)
        print("IOS_FILES_UNIFIED_SNAPSHOT stage=" + stage
              + " auth=" + auth + " provenance=actual-xctest-screenshot")
    }

    /// Run only on a provisioned, signed physical iPhone with a real Owner
    /// session and a real file in cloud root. CI does not opt into this test.
    /// It fails if the real fixture is absent; it never counts a synthetic
    /// no-session screenshot as a populated Files/list/grid/Viewer pass.
    func testFilesSignedDevicePopulatedListGridAndViewerSnapshots() throws {
        let env = ProcessInfo.processInfo.environment
        guard env["XDRIVE_FILES_SIGNED_DEVICE_CAPTURE"] == "1" else {
            throw XCTSkip("Real signed iPhone Owner fixture not provisioned")
        }
        guard let idText = env["XDRIVE_FILES_FIXTURE_FILE_NODE_ID"],
              let fileID = UInt64(idText), fileID > 0 else {
            XCTFail("Set XDRIVE_FILES_FIXTURE_FILE_NODE_ID to a real cloud-root file ID")
            return
        }
        let app = XCUIApplication()
        app.launch()
        tap("native-ios-tab-files", app)
        XCTAssertTrue(control("native-ios-files-home-list", app)
            .waitForExistence(timeout: 15), "Existing signed Owner must be logged in")
        attachFilesParityFrame(app, "real-01-home", auth: "signed-owner")
        for (stage, section) in [
            ("real-02-recent", "recent"),
            ("real-03-favorites", "favorites"),
            ("real-04-browse-return", "browse")
        ] {
            tap("native-ios-files-section-" + section, app)
            let selected = control("native-ios-files-section-" + section, app)
            let expectation = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "value == %@", "已选择"),
                object: selected
            )
            XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 10), .completed)
            attachFilesParityFrame(app, stage, auth: "signed-owner")
        }
        tap("native-ios-files-open-root-location", app)
        XCTAssertTrue(control("native-ios-files-folder-list", app)
            .waitForExistence(timeout: 20), "Real cloud directory not mounted")
        XCTAssertFalse(control("native-ios-files-error-page", app).exists,
                       "Owner authentication failed")
        let file = control("native-ios-files-file-" + String(fileID), app)
        XCTAssertTrue(file.waitForExistence(timeout: 25),
                      "Required real fixture file is not in verified cloud-root window")
        attachFilesParityFrame(app, "real-05-list", auth: "signed-owner")

        tap("native-ios-files-more-options", app)
        attachFilesParityFrame(app, "real-06-more-menu", auth: "signed-owner")
        let displayMenu = app.buttons["显示与排序"].firstMatch
        XCTAssertTrue(displayMenu.waitForExistence(timeout: 15))
        displayMenu.tap()
        let gridOption = app.buttons["图标"].firstMatch
        XCTAssertTrue(gridOption.waitForExistence(timeout: 15))
        gridOption.tap()
        XCTAssertTrue(control("native-ios-files-grid", app)
            .waitForExistence(timeout: 15), "Browse grid did not render")
        attachFilesParityFrame(app, "real-07-grid", auth: "signed-owner")

        let gridFile = control("native-ios-files-file-" + String(fileID), app)
        XCTAssertTrue(gridFile.waitForExistence(timeout: 15))
        gridFile.tap()
        let viewerDone = control("native-ios-files-viewer-done", app)
        XCTAssertTrue(viewerDone.waitForExistence(timeout: 20),
                      "Actual file Viewer did not mount")
        XCTAssertTrue(control("native-ios-files-viewer-previous", app).exists)
        XCTAssertTrue(control("native-ios-files-viewer-next", app).exists)
        attachFilesParityFrame(app, "real-08-viewer", auth: "signed-owner")
        viewerDone.tap()
        XCTAssertTrue(gridFile.waitForExistence(timeout: 15),
                      "Viewer did not return to original grid file")
        attachFilesParityFrame(app, "real-09-grid-return", auth: "signed-owner")
    }

}
