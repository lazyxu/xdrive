import XCTest
import UIKit

/// Six actual, touch-driven native Gallery/Files child-navigation journeys.
/// The synthetic Owner has no bearer or Server access; every protected
/// cloud child must fail closed. A settled Simulator screenshot is NOT proof
/// of zero 60/120-Hz dropped frames; preserve native video/xcresult evidence.
final class XDriveIOSGalleryFilesSixSubpageUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
    }

    private func launch(syntheticOwner: Bool = true) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-xdrive-ui-navigation-smoke"]
        if syntheticOwner {
            app.launchArguments.append("-xdrive-ui-navigation-synthetic-owner")
        }
        app.launch()
        XCTAssertEqual(app.state, .runningForeground, "Real native process exited at launch")
        return app
    }

    private func control(_ id: String, _ app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func tap(_ id: String, _ app: XCUIApplication) {
        let element = control(id, app)
        XCTAssertTrue(element.waitForExistence(timeout: 15),
                      "Missing actual native navigation control: \(id)")
        print("IOS_NATIVE_NAV_TAP_START route=\(id)")
        element.tap()
        XCTAssertEqual(app.state, .runningForeground,
                       "Actual native process exited after \(id)")
    }

    private func assertVisibleContent(_ app: XCUIApplication, label: String) {
        XCTAssertEqual(app.state, .runningForeground, "Process exited at \(label)")
        guard let image = app.screenshot().image.cgImage else {
            XCTFail("No real native screenshot: \(label)")
            return
        }
        let width = 96, height = 64
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let rendered = pixels.withUnsafeMutableBytes { bytes -> Bool in
            guard let ptr = bytes.baseAddress,
                  let context = CGContext(
                    data: ptr, width: width, height: height,
                    bitsPerComponent: 8, bytesPerRow: width * 4,
                    space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                  ) else { return false }
            context.interpolationQuality = .low
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        XCTAssertTrue(rendered, "Could not decode real native screenshot: \(label)")
        guard rendered else { return }
        // Sample the child viewport, excluding colorful persistent tab chrome.
        var colors = Set<Int>()
        for y in (height / 5)..<(height * 4 / 5) {
            for x in (width / 8)..<(width * 7 / 8) {
                let at = (y * width + x) * 4
                colors.insert((Int(pixels[at]) << 16) |
                    (Int(pixels[at + 1]) << 8) | Int(pixels[at + 2]))
            }
        }
        XCTAssertGreaterThan(colors.count, 8,
                             "Native child viewport was uniform after \(label)")
    }

    private func enterFilesBrowse(_ app: XCUIApplication) {
        tap("native-ios-tab-files", app)
        let browse = control("native-ios-files-section-browse", app)
        XCTAssertTrue(browse.waitForExistence(timeout: 15))
        if (browse.value as? String) != "已选择" {
            tap("native-ios-files-section-browse", app)
            let selected = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "value == %@", "已选择"),
                object: browse
            )
            XCTAssertEqual(XCTWaiter.wait(for: [selected], timeout: 12), .completed,
                           "Actual Files Browse section did not become selected")
        }
        // The Files Home List has a stable AX identifier. Its first Cloud
        // Root row may legitimately remain offscreen when a previous child
        // is dismissed with the same scroll offset.
        XCTAssertTrue(control("native-ios-files-home-list", app)
            .waitForExistence(timeout: 15),
            "Real native Files Home List did not mount")
    }

    private func openFilesSheet(_ entryID: String, pageID: String,
                                _ app: XCUIApplication) {
        enterFilesBrowse(app)
        // Scroll only this Files Home List, not an unrelated retained
        // Gallery List, search overlay, or offscreen modal.
        let list = control("native-ios-files-home-list", app)
        XCTAssertTrue(list.waitForExistence(timeout: 15),
                      "Actual Files Home List is missing before child navigation")
        let entry = control(entryID, app)
        for _ in 0..<10 {
            if entry.exists && entry.isHittable { break }
            list.swipeUp()
        }
        if !entry.exists || !entry.isHittable {
            for _ in 0..<10 {
                if entry.exists && entry.isHittable { break }
                list.swipeDown()
            }
        }
        XCTAssertTrue(entry.exists && entry.isHittable,
                      "Real Files child entry was not reachable: \(entryID)")
        tap(entryID, app)
        XCTAssertTrue(control(pageID, app).waitForExistence(timeout: 15),
                      "Real Files native sheet did not mount: \(pageID)")
        assertVisibleContent(app, label: pageID)
    }

    private func dismissFilesSheet(_ doneID: String, pageID: String,
                                   _ app: XCUIApplication) {
        tap(doneID, app)
        let vanished = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"),
            object: control(pageID, app)
        )
        XCTAssertEqual(XCTWaiter.wait(for: [vanished], timeout: 12), .completed,
                       "Dismissed Files sheet remained mounted: \(pageID)")
    }

    private func unifiedGeneration(_ app: XCUIApplication) -> String {
        let wall = control("native-ios-unified-photo-gallery", app)
        XCTAssertTrue(wall.waitForExistence(timeout: 15),
                      "Actual native unified wall did not mount")
        let value = wall.value as? String ?? ""
        XCTAssertNotNil(UUID(uuidString: value),
                        "Missing real DEBUG Gallery wall-generation diagnostic")
        return value
    }

    private func closePeople(_ app: XCUIApplication) {
        XCTAssertTrue(control("native-ios-gallery-people-page", app)
            .waitForExistence(timeout: 15), "Native People child did not mount")
        let back = app.navigationBars.buttons.element(boundBy: 0)
        XCTAssertTrue(back.waitForExistence(timeout: 15),
                      "Actual People child has no navigation Back control")
        back.tap()
        XCTAssertTrue(control("native-ios-gallery-source-unified", app)
            .waitForExistence(timeout: 15))
    }

    // 1: Filter cancellation, People push/pop and denied cloud Files must not
    // rebuild an unchanged Gallery wall or briefly replace its child content.
    func testFilterPeopleDeniedCloudReturnKeepsVerifiedGalleryGeneration() {
        let app = launch()
        let generation = unifiedGeneration(app)
        tap("native-ios-gallery-open-filters", app)
        let cancel = app.buttons["取消"].firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 15))
        cancel.tap()
        tap("native-ios-gallery-people", app)
        closePeople(app)
        enterFilesBrowse(app)
        tap("native-ios-files-open-root-location", app)
        XCTAssertTrue(control("native-ios-files-error-page", app)
            .waitForExistence(timeout: 15))
        XCTAssertFalse(control("native-ios-files-grid", app).exists,
                       "Unauthenticated cloud route exposed private rows")
        assertVisibleContent(app, label: "denied Files after Gallery People")
        tap("native-ios-files-error-return", app)
        tap("native-ios-tab-gallery", app)
        XCTAssertEqual(unifiedGeneration(app), generation,
                       "Unchanged Gallery wall was recreated after nested Files denial")
        assertVisibleContent(app, label: "Gallery after filter People and Files denial")
    }

    // 2: Two different Files sheets must retire separately across a Gallery
    // child switch; neither may reappear on the returning Browse route.
    func testFilesHistorySavedSearchesAcrossOriginalsHaveNoGhostSheets() {
        let app = launch()
        openFilesSheet("native-ios-files-open-operations",
                       pageID: "native-ios-files-operation-history-page", app)
        dismissFilesSheet("native-ios-files-operation-history-done",
                          pageID: "native-ios-files-operation-history-page", app)
        openFilesSheet("native-ios-files-open-saved-searches",
                       pageID: "native-ios-files-saved-searches-page", app)
        dismissFilesSheet("native-ios-files-saved-searches-done",
                          pageID: "native-ios-files-saved-searches-page", app)
        tap("native-ios-tab-gallery", app)
        tap("native-ios-gallery-source-originals", app)
        XCTAssertTrue(control("native-ios-cloud-original-layout-help", app)
            .waitForExistence(timeout: 15))
        enterFilesBrowse(app)
        XCTAssertFalse(control("native-ios-files-operation-history-page", app).exists)
        XCTAssertFalse(control("native-ios-files-saved-searches-page", app).exists)
        assertVisibleContent(app, label: "Browse after two Files sheets and Originals")
    }

    // 3: A dismissed Originals help alert must not resurrect when Files Trash
    // shows its explicit no-session error and the user returns to Originals.
    func testOriginalsHelpTrashDeniedReturnDoesNotReopenAlert() {
        let app = launch()
        tap("native-ios-gallery-source-originals", app)
        tap("native-ios-cloud-original-layout-help", app)
        let alert = app.alerts["云端备份原件说明"].firstMatch
        XCTAssertTrue(alert.waitForExistence(timeout: 15))
        alert.buttons["完成"].tap()
        enterFilesBrowse(app)
        tap("native-ios-files-open-trash", app)
        XCTAssertTrue(control("native-ios-files-trash-error-page", app)
            .waitForExistence(timeout: 15))
        XCTAssertFalse(control("native-ios-files-trash-retry", app).exists,
                       "No-session Trash must not expose privileged Retry")
        assertVisibleContent(app, label: "Trash denied after Originals alert")
        tap("native-ios-files-trash-error-return", app)
        tap("native-ios-tab-gallery", app)
        XCTAssertTrue(control("native-ios-cloud-original-layout-help", app)
            .waitForExistence(timeout: 15))
        XCTAssertFalse(alert.exists, "Old dismissed Originals alert reappeared")
        XCTAssertFalse(control("native-ios-cloud-original-tile", app).exists,
                       "Synthetic Owner must not receive private thumbnails")
        assertVisibleContent(app, label: "Originals after denied Trash")
    }

    // 4: Real local PhotoKit permission content remains mounted when its date
    // sheet and Files Saved Searches sheet close across a tab round-trip.
    func testLocalPhotoDateAndFilesSavedSheetReturnKeepsPhotoKitChild() {
        let app = launch()
        tap("native-ios-gallery-source-menu", app)
        let local = app.buttons["本机照片"].firstMatch
        XCTAssertTrue(local.waitForExistence(timeout: 15))
        local.tap()
        XCTAssertTrue(control("native-ios-local-timeline-open", app)
            .waitForExistence(timeout: 15))
        tap("native-ios-local-timeline-open", app)
        let done = control("native-ios-local-timeline-done", app)
        XCTAssertTrue(done.waitForExistence(timeout: 15))
        // Real regression: Home/foreground used to set showingDates=false.
        // The date sheet must remain reachable before explicit user dismissal.
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertEqual(app.state, .runningForeground)
        XCTAssertTrue(done.waitForExistence(timeout: 15),
                      "PhotoKit date sheet auto-dismissed when returning to foreground")
        done.tap()
        openFilesSheet("native-ios-files-open-saved-searches",
                       pageID: "native-ios-files-saved-searches-page", app)
        dismissFilesSheet("native-ios-files-saved-searches-done",
                          pageID: "native-ios-files-saved-searches-page", app)
        tap("native-ios-tab-gallery", app)
        XCTAssertTrue(control("native-ios-local-timeline-open", app)
            .waitForExistence(timeout: 15))
        let granted = control("native-ios-local-gallery-media-filter", app).exists
        let requesting = app.buttons["允许查看本机相册"].firstMatch.exists
        let denied = app.staticTexts["相册权限不可用，请在 iOS 设置中允许访问。"]
            .firstMatch.exists
        XCTAssertTrue(granted || requesting || denied,
                      "Real PhotoKit permission state was lost on child return")
        XCTAssertFalse(control("native-ios-files-saved-searches-page", app).exists)
        assertVisibleContent(app, label: "PhotoKit date then Files saved-search return")
    }

    // 5: Shared MapKit modal must dismiss before the Files cloud denial;
    // neither its page nor the denied Files child may replace the Gallery wall.
    func testMapModalFilesCloudDenialDoesNotRemountUnifiedWall() {
        let app = launch()
        let generation = unifiedGeneration(app)
        tap("native-ios-gallery-open-filters", app)
        let map = control("native-ios-unified-gallery-show-map", app)
        XCTAssertTrue(map.waitForExistence(timeout: 15))
        XCTAssertTrue(map.isEnabled)
        tap("native-ios-unified-gallery-show-map", app)
        XCTAssertTrue(control("native-ios-map-source-selector", app)
            .waitForExistence(timeout: 25), "Real native MapKit modal did not mount")
        assertVisibleContent(app, label: "unified Gallery MapKit modal")
        tap("native-ios-map-dismiss", app)
        enterFilesBrowse(app)
        tap("native-ios-files-open-root-location", app)
        XCTAssertTrue(control("native-ios-files-error-page", app)
            .waitForExistence(timeout: 15))
        tap("native-ios-files-error-return", app)
        tap("native-ios-tab-gallery", app)
        XCTAssertEqual(unifiedGeneration(app), generation,
                       "Map/Files child dismissal rebuilt unchanged unified wall")
        XCTAssertFalse(control("native-ios-map-source-selector", app).exists)
        XCTAssertFalse(control("native-ios-files-error-page", app).exists)
        assertVisibleContent(app, label: "Gallery after map and Files denial")
    }

    // 6: The real Files native search keyboard must retire on Gallery People
    // navigation; switching back must not leave a phantom keyboard or overlay.
    func testFilesSearchKeyboardGalleryPeopleReturnHasNoGhostOverlay() {
        let app = launch()
        enterFilesBrowse(app)
        let search = app.searchFields["搜索全部文件"].firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 15))
        search.tap()
        search.typeText("six-subpage")
        XCTAssertTrue((search.value as? String ?? "").contains("six-subpage"))
        tap("native-ios-tab-gallery", app)
        let keyboardGone = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"),
            object: app.keyboards.firstMatch
        )
        XCTAssertEqual(XCTWaiter.wait(for: [keyboardGone], timeout: 10), .completed,
                       "Files searchable keyboard leaked onto Gallery tab")
        tap("native-ios-gallery-people", app)
        closePeople(app)
        XCTAssertFalse(app.keyboards.firstMatch.exists,
                       "Files keyboard remained over Gallery People")
        assertVisibleContent(app, label: "Gallery People after Files search")
        enterFilesBrowse(app)
        XCTAssertFalse(control("native-ios-gallery-people-page", app).exists)
        XCTAssertFalse(control("native-ios-files-operation-history-page", app).exists)
        XCTAssertTrue(control("native-ios-files-open-root-location", app)
            .waitForExistence(timeout: 15),
            "Files Home did not recover after search keyboard and People return")
        assertVisibleContent(app, label: "Browse after Files search and People return")
    }
}
