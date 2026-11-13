import XCTest
import UIKit

/// Genuine touch-driven navigation using the production native Gallery/Files
/// screens. No fake PhotoKit authorization, Server login or thumbnail payload.
/// These checks verify mounted child views and settled pixels; Simulator still
/// frames are not evidence of physical 60/120 Hz frame pacing.
final class XDriveIOSGalleryFilesTransitionEdgeUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    private func launch(syntheticOwner: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-xdrive-ui-navigation-smoke"]
        if syntheticOwner {
            app.launchArguments.append("-xdrive-ui-navigation-synthetic-owner")
        }
        app.launch()
        XCTAssertEqual(app.state, .runningForeground, "Native app exited on launch")
        return app
    }

    private func target(_ id: String, _ app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func tap(_ id: String, _ app: XCUIApplication) {
        let button = target(id, app)
        XCTAssertTrue(button.waitForExistence(timeout: 15), "Missing real native control: \(id)")
        print("IOS_NATIVE_NAV_TAP_START route=\(id)")
        button.tap()
        XCTAssertEqual(app.state, .runningForeground, "Native app exited after \(id)")
    }

    private func enterBrowseHome(_ app: XCUIApplication) {
        let browse = target("native-ios-files-section-browse", app)
        XCTAssertTrue(browse.waitForExistence(timeout: 15),
                      "Real Files Browse selector missing")
        if browse.value as? String != "已选择" {
            tap("native-ios-files-section-browse", app)
            let chosen = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "value == %@", "已选择"),
                object: browse
            )
            XCTAssertEqual(XCTWaiter.wait(for: [chosen], timeout: 10),
                           .completed, "Failed to enter actual Files Browse Home")
        }
    }

    private func assertGallery(_ app: XCUIApplication) {
        XCTAssertTrue(target("native-ios-gallery-source-unified", app)
            .waitForExistence(timeout: 15), "Gallery source hierarchy disappeared")
    }

    private func assertFiles(_ app: XCUIApplication) {
        XCTAssertTrue(target("native-ios-files-section-browse", app)
            .waitForExistence(timeout: 15), "Files section navigation disappeared")
    }

    private func assertPixels(_ app: XCUIApplication, _ route: String) {
        guard let cgImage = app.screenshot().image.cgImage else {
            XCTFail("Missing real native screenshot at \(route)")
            return
        }
        let width = 24, height = 32
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let rendered = pixels.withUnsafeMutableBytes { bytes -> Bool in
            guard let base = bytes.baseAddress,
                  let context = CGContext(
                    data: base, width: width, height: height,
                    bitsPerComponent: 8, bytesPerRow: width * 4,
                    space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                  ) else { return false }
            context.interpolationQuality = .low
            context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        XCTAssertTrue(rendered, "Could not sample screenshot at \(route)")
        guard rendered else { return }
        let unique = Set(stride(from: 0, to: pixels.count, by: 4).map { i in
            (Int(pixels[i]) << 16) | (Int(pixels[i + 1]) << 8) | Int(pixels[i + 2])
        })
        XCTAssertGreaterThan(unique.count, 8, "Blank or solid native frame at \(route)")
    }

    private func closePeople(_ app: XCUIApplication) {
        XCTAssertTrue(target("native-ios-gallery-people-page", app)
            .waitForExistence(timeout: 15), "People child page did not mount")
        let back = app.navigationBars.buttons.element(boundBy: 0)
        XCTAssertTrue(back.waitForExistence(timeout: 15), "People child missing Back")
        back.tap()
        assertGallery(app)
    }

    func testPeopleChildDeniedFilesReturnKeepsGalleryTree() {
        let app = launch(syntheticOwner: true)
        tap("native-ios-gallery-people", app)
        closePeople(app)
        tap("native-ios-tab-files", app)
        enterBrowseHome(app)
        assertFiles(app)
        tap("native-ios-files-open-root-location", app)
        XCTAssertTrue(target("native-ios-files-error-page", app)
            .waitForExistence(timeout: 15), "Denied folder must show native recovery")
        assertPixels(app, "Denied Files child")
        tap("native-ios-files-error-return", app)
        assertFiles(app)
        tap("native-ios-tab-gallery", app)
        tap("native-ios-gallery-people", app)
        closePeople(app)
        assertPixels(app, "People after Files denial")
    }

    func testCloudOriginalsHelpFilesSearchReturnRetainsChild() {
        let app = launch()
        tap("native-ios-gallery-source-originals", app)
        let help = "native-ios-cloud-original-layout-help"
        XCTAssertTrue(target(help, app).waitForExistence(timeout: 15))
        tap(help, app)
        let alert = app.alerts["云端备份原件说明"].firstMatch
        XCTAssertTrue(alert.waitForExistence(timeout: 15))
        alert.buttons["完成"].tap()
        tap("native-ios-tab-files", app)
        enterBrowseHome(app)
        let search = app.searchFields["搜索全部文件"].firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 15))
        search.tap()
        search.typeText("ab")
        if app.keyboards.buttons["Search"].exists {
            app.keyboards.buttons["Search"].tap()
        } else if app.keyboards.buttons["完成"].exists {
            app.keyboards.buttons["完成"].tap()
        } else {
            search.typeText("\n")
        }
        assertFiles(app)
        tap("native-ios-tab-gallery", app)
        XCTAssertTrue(target(help, app).waitForExistence(timeout: 15))
        XCTAssertFalse(target("native-ios-cloud-original-tile", app).exists,
                       "Signed-out route must not manufacture a cloud thumbnail")
        assertPixels(app, "Originals after Files search")
    }

    func testGalleryFilterCancelFilesSectionsKeepsUnifiedWall() {
        let app = launch(syntheticOwner: true)
        let wall = target("native-ios-unified-photo-gallery", app)
        XCTAssertTrue(wall.waitForExistence(timeout: 15))
        let before = wall.value as? String
        XCTAssertNotNil(before.flatMap(UUID.init(uuidString:)),
                        "Actual Gallery generation must be available in native DEBUG test")
        tap("native-ios-gallery-open-filters", app)
        let cancel = app.buttons["取消"].firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 15))
        cancel.tap()
        assertGallery(app)
        tap("native-ios-tab-files", app)
        for name in ["recent", "favorites", "browse", "recent", "browse"] {
            tap("native-ios-files-section-\(name)", app)
            assertFiles(app)
        }
        tap("native-ios-tab-gallery", app)
        assertGallery(app)
        XCTAssertEqual(wall.value as? String, before,
                       "Same-Owner Gallery filter cancellation rebuilt the wall")
        assertPixels(app, "Gallery after Files rail")
    }

    func testLocalPhotoPermissionFilesForegroundReturnKeepsChild() {
        let app = launch()
        tap("native-ios-gallery-source-menu", app)
        let local = app.buttons["本机照片"].firstMatch
        XCTAssertTrue(local.waitForExistence(timeout: 15))
        local.tap()
        XCTAssertTrue(target("native-ios-local-timeline-open", app)
            .waitForExistence(timeout: 15), "Real PhotoKit child did not mount")
        tap("native-ios-tab-files", app)
        assertFiles(app)
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertEqual(app.state, .runningForeground)
        tap("native-ios-tab-gallery", app)
        XCTAssertTrue(target("native-ios-local-timeline-open", app)
            .waitForExistence(timeout: 15), "Local Photos child lost its route")
        let available = target("native-ios-local-gallery-media-filter", app).exists
        let asking = app.buttons["允许查看本机相册"].firstMatch.exists
        let denied = app.staticTexts["相册权限不可用，请在 iOS 设置中允许访问。"].firstMatch.exists
        XCTAssertTrue(available || asking || denied, "PhotoKit must show genuine permission state")
        assertPixels(app, "Local PhotoKit after foreground")
    }

    func testFilesRootDenialLandscapeGalleryAlbumsReturn() {
        let app = launch(syntheticOwner: true)
        defer { XCUIDevice.shared.orientation = .portrait }
        tap("native-ios-tab-files", app)
        enterBrowseHome(app)
        tap("native-ios-files-open-root-location", app)
        XCTAssertTrue(target("native-ios-files-error-page", app)
            .waitForExistence(timeout: 15))
        tap("native-ios-files-error-return", app)
        XCUIDevice.shared.orientation = .landscapeLeft
        tap("native-ios-tab-gallery", app)
        tap("native-ios-gallery-source-albums", app)
        XCTAssertTrue(target("native-ios-gallery-source-unified", app)
            .waitForExistence(timeout: 15), "Albums did not preserve Gallery rail")
        assertPixels(app, "Landscape albums")
        XCUIDevice.shared.orientation = .portrait
        tap("native-ios-tab-files", app)
        assertFiles(app)
        assertPixels(app, "Files portrait after denied child")
    }

    func testOriginalsAlbumsFilesQuickRailThreeCyclesKeepsPages() {
        let app = launch(syntheticOwner: true)
        for i in 0..<3 {
            tap("native-ios-gallery-source-originals", app)
            XCTAssertTrue(target("native-ios-cloud-original-layout-help", app)
                .waitForExistence(timeout: 15))
            tap("native-ios-gallery-source-albums", app)
            assertGallery(app)
            tap("native-ios-tab-files", app)
            for section in ["recent", "favorites", "browse"] {
                tap("native-ios-files-section-\(section)", app)
                assertFiles(app)
            }
            tap("native-ios-tab-gallery", app)
            assertGallery(app)
            assertPixels(app, "Gallery after mixed source/Files cycle \(i)")
        }
    }
    // Five *real* native cross-page regression journeys. A signed-out launch
    // must not synthesize Owner media or claim physical iPhone frame pacing.
    func testMapShortcutThenExplicitUnifiedFilesReturn() {
        let app = launch()
        tap("native-ios-tab-dynamic", app)
        XCTAssertTrue(target("native-ios-map-source-selector", app)
            .waitForExistence(timeout: 15), "Dynamic fallback did not mount real Map")
        tap("native-ios-gallery-source-unified", app)
        XCTAssertTrue(target("native-ios-unified-photo-gallery", app)
            .waitForExistence(timeout: 15), "Unified Gallery failed to open from Map")
        tap("native-ios-tab-files", app)
        enterBrowseHome(app)
        tap("native-ios-files-section-recent", app)
        tap("native-ios-files-section-browse", app)
        tap("native-ios-tab-gallery", app)
        assertGallery(app)
        assertPixels(app, "Map shortcut Unified Files return")
    }

    func testMapShortcutFilesRailThenMapReentryKeepsRoute() {
        let app = launch()
        tap("native-ios-tab-dynamic", app)
        XCTAssertTrue(target("native-ios-map-source-selector", app)
            .waitForExistence(timeout: 15), "Map shortcut was missing")
        tap("native-ios-tab-files", app)
        enterBrowseHome(app)
        for section in ["favorites", "recent", "browse", "favorites", "browse"] {
            tap("native-ios-files-section-\(section)", app)
            assertFiles(app)
        }
        tap("native-ios-tab-gallery", app)
        XCTAssertTrue(target("native-ios-map-source-selector", app)
            .waitForExistence(timeout: 15), "Map was replaced by a stale Gallery wall")
        assertPixels(app, "Map after five Files quick rail changes")
    }

    func testOriginalsHelpFilesDeniedChildThenUnifiedRecovery() {
        let app = launch(syntheticOwner: true)
        tap("native-ios-gallery-source-originals", app)
        tap("native-ios-cloud-original-layout-help", app)
        let help = app.alerts["云端备份原件说明"].firstMatch
        XCTAssertTrue(help.waitForExistence(timeout: 15))
        help.buttons["完成"].tap()
        tap("native-ios-tab-files", app)
        enterBrowseHome(app)
        tap("native-ios-files-open-root-location", app)
        XCTAssertTrue(target("native-ios-files-error-page", app)
            .waitForExistence(timeout: 15), "Denied Owner must show recovery, not a cached file")
        tap("native-ios-files-error-return", app)
        tap("native-ios-tab-gallery", app)
        XCTAssertTrue(target("native-ios-cloud-original-layout-help", app)
            .waitForExistence(timeout: 15), "Originals source lost after Files denial")
        tap("native-ios-gallery-source-unified", app)
        assertGallery(app)
        assertPixels(app, "Originals Files denial Unified return")
    }

    func testPeopleFilesSectionsBackgroundAndPeopleReentry() {
        let app = launch(syntheticOwner: true)
        tap("native-ios-gallery-people", app)
        closePeople(app)
        tap("native-ios-tab-files", app)
        enterBrowseHome(app)
        for section in ["recent", "favorites", "browse"] {
            tap("native-ios-files-section-\(section)", app)
            assertFiles(app)
        }
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertEqual(app.state, .runningForeground)
        tap("native-ios-tab-gallery", app)
        tap("native-ios-gallery-people", app)
        closePeople(app)
        assertPixels(app, "People after Files foreground return")
    }

    func testLocalPhotosFilesRecentOriginalsThenLocalReturn() {
        let app = launch()
        tap("native-ios-gallery-source-menu", app)
        let local = app.buttons["本机照片"].firstMatch
        XCTAssertTrue(local.waitForExistence(timeout: 15))
        local.tap()
        XCTAssertTrue(target("native-ios-local-timeline-open", app)
            .waitForExistence(timeout: 15), "Real PhotoKit timeline did not mount")
        tap("native-ios-tab-files", app)
        enterBrowseHome(app)
        tap("native-ios-files-section-recent", app)
        tap("native-ios-files-section-browse", app)
        tap("native-ios-tab-gallery", app)
        XCTAssertTrue(target("native-ios-local-timeline-open", app)
            .waitForExistence(timeout: 15), "Local PhotoKit route disappeared on Files return")
        tap("native-ios-gallery-source-originals", app)
        XCTAssertTrue(target("native-ios-cloud-original-layout-help", app)
            .waitForExistence(timeout: 15))
        // Only the active Local source has a direct gallery chip.
        // Originals -> Local must go through the actual single-source menu.
        tap("native-ios-gallery-source-menu", app)
        let localReturn = app.buttons["本机照片"].firstMatch
        XCTAssertTrue(localReturn.waitForExistence(timeout: 15),
                      "Local Photos action missing from the real source chooser")
        print("IOS_NATIVE_NAV_TAP_START route=native-ios-gallery-source-menu-local")
        localReturn.tap()
        XCTAssertEqual(app.state, .runningForeground,
                       "Process exited after Originals to Local Photos return")
        XCTAssertTrue(target("native-ios-local-timeline-open", app)
            .waitForExistence(timeout: 15))
        assertPixels(app, "Local Photos after Originals and Files")
    }

    // Additional real, cross-page XCUITest transitions. These use the native
    // keyboard/sheets/Photos sources, not fabricated Owner media.
    func testFilesSearchKeyboardGalleryAlbumsThenBrowseNoBlank() {
        let app = launch()
        tap("native-ios-tab-files", app)
        enterBrowseHome(app)
        let search = app.searchFields["搜索全部文件"].firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 15))
        search.tap()
        search.typeText("ab")
        if app.keyboards.buttons["Search"].exists {
            app.keyboards.buttons["Search"].tap()
        } else if app.keyboards.buttons["完成"].exists {
            app.keyboards.buttons["完成"].tap()
        } else {
            search.typeText("\n")
        }
        tap("native-ios-tab-gallery", app)
        tap("native-ios-gallery-source-albums", app)
        assertGallery(app)
        tap("native-ios-tab-files", app)
        enterBrowseHome(app)
        assertFiles(app)
        assertPixels(app, "Files search to Albums and Browse")
    }

    func testFilterCancelFilesQuickRailPeopleKeepsWallGeneration() {
        let app = launch(syntheticOwner: true)
        let wall = target("native-ios-unified-photo-gallery", app)
        XCTAssertTrue(wall.waitForExistence(timeout: 15))
        let oldGeneration = wall.value as? String
        XCTAssertNotNil(oldGeneration.flatMap(UUID.init(uuidString:)))
        tap("native-ios-gallery-open-filters", app)
        let cancel = app.buttons["取消"].firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 15))
        cancel.tap()
        tap("native-ios-tab-files", app)
        enterBrowseHome(app)
        for section in ["recent", "favorites", "browse", "recent", "browse"] {
            tap("native-ios-files-section-\(section)", app)
            assertFiles(app)
        }
        tap("native-ios-tab-gallery", app)
        XCTAssertTrue(wall.waitForExistence(timeout: 15))
        XCTAssertEqual(wall.value as? String, oldGeneration,
                       "Unchanged Owner/filter rebuilt the verified Gallery wall")
        tap("native-ios-gallery-people", app)
        closePeople(app)
        XCTAssertEqual(wall.value as? String, oldGeneration,
                       "People child return unnecessarily rebuilt the wall")
        assertPixels(app, "Gallery filter Files rail People return")
    }

    func testFilesDeniedForegroundOriginalsAndBrowseRecovery() {
        let app = launch(syntheticOwner: true)
        tap("native-ios-tab-files", app)
        enterBrowseHome(app)
        tap("native-ios-files-open-root-location", app)
        XCTAssertTrue(target("native-ios-files-error-page", app)
            .waitForExistence(timeout: 15))
        tap("native-ios-files-error-return", app)
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertEqual(app.state, .runningForeground)
        tap("native-ios-tab-gallery", app)
        tap("native-ios-gallery-source-originals", app)
        XCTAssertTrue(target("native-ios-cloud-original-layout-help", app)
            .waitForExistence(timeout: 15))
        tap("native-ios-tab-files", app)
        enterBrowseHome(app)
        XCTAssertFalse(target("native-ios-files-error-page", app).exists,
                       "Old denied child remained on top after real return")
        assertPixels(app, "Denied Files foreground Originals Browse recovery")
    }

    func testAlbumsOriginalsUnifiedFilesThreeCyclesKeepVisibleShells() {
        let app = launch(syntheticOwner: true)
        for cycle in 0..<3 {
            tap("native-ios-gallery-source-albums", app)
            assertGallery(app)
            tap("native-ios-gallery-source-originals", app)
            XCTAssertTrue(target("native-ios-cloud-original-layout-help", app)
                .waitForExistence(timeout: 15))
            tap("native-ios-gallery-source-unified", app)
            XCTAssertTrue(target("native-ios-unified-photo-gallery", app)
                .waitForExistence(timeout: 15))
            tap("native-ios-tab-files", app)
            enterBrowseHome(app)
            for section in ["favorites", "recent", "browse"] {
                tap("native-ios-files-section-\(section)", app)
            }
            tap("native-ios-tab-gallery", app)
            assertGallery(app)
            assertPixels(app, "Albums Originals Unified Files cycle \(cycle)")
        }
    }


    // Independent native regressions after the exact-HEAD 92/92 Simulator pass.
    // UI is real SwiftUI/PhotoKit. These are mounted-child + settled-frame
    // assertions, not proof of signed-device 60/120 Hz zero flicker.

    func testUnifiedPhotoDensityThreeModesKeepsVerifiedWallAcrossFiles() {
        let app = launch(syntheticOwner: true)
        let wall = target("native-ios-unified-photo-gallery", app)
        XCTAssertTrue(wall.waitForExistence(timeout: 15))
        let generation = wall.value as? String
        XCTAssertNotNil(generation.flatMap(UUID.init(uuidString:)),
                        "Real unified Gallery generation was unavailable")
        for (density, section) in [("紧凑", "recent"), ("大图", "favorites"), ("标准", "browse")] {
            tap("native-ios-unified-wall-density", app)
            let option = app.buttons[density].firstMatch
            XCTAssertTrue(option.waitForExistence(timeout: 15),
                          "Real density option was not presented: \(density)")
            print("IOS_NATIVE_NAV_TAP_START route=native-ios-unified-wall-density-\(density)")
            option.tap()
            XCTAssertEqual(wall.value as? String, generation,
                           "A presentation-only density change rebuilt verified Gallery pages")
            tap("native-ios-tab-files", app)
            enterBrowseHome(app)
            tap("native-ios-files-section-\(section)", app)
            assertFiles(app)
            tap("native-ios-tab-gallery", app)
            XCTAssertTrue(wall.waitForExistence(timeout: 15))
            XCTAssertEqual(wall.value as? String, generation,
                           "Files tab/rail roundtrip unnecessarily rebuilt the Gallery wall")
            assertPixels(app, "Gallery density \(density) after Files \(section)")
        }
    }

    func testGalleryDateDraftCanceledBeforeFilesPeopleReturnKeepsWall() {
        let app = launch(syntheticOwner: true)
        let wall = target("native-ios-unified-photo-gallery", app)
        XCTAssertTrue(wall.waitForExistence(timeout: 15))
        let generation = wall.value as? String
        XCTAssertNotNil(generation.flatMap(UUID.init(uuidString:)))
        tap("native-ios-gallery-open-filters", app)
        let dateToggle = app.switches["限定日期范围"].firstMatch
        XCTAssertTrue(dateToggle.waitForExistence(timeout: 15),
                      "Actual Gallery date filter toggle missing")
        dateToggle.tap()
        XCTAssertTrue(app.datePickers["开始"].firstMatch.waitForExistence(timeout: 15),
                      "Date filter draft did not show its real date controls")
        let cancel = app.navigationBars.buttons["取消"].firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 15))
        cancel.tap()
        XCTAssertEqual(wall.value as? String, generation,
                       "Canceling a filter draft must not reset the published wall")
        tap("native-ios-gallery-people", app)
        closePeople(app)
        tap("native-ios-tab-files", app)
        enterBrowseHome(app)
        tap("native-ios-files-section-favorites", app)
        tap("native-ios-files-section-browse", app)
        tap("native-ios-tab-gallery", app)
        XCTAssertEqual(wall.value as? String, generation,
                       "Canceled Gallery draft/People/Files return rebuilt same Owner wall")
        assertPixels(app, "Canceled date draft People Files return")
    }

    func testGalleryFilenameFilterAppliedFilesSectionsAndCleared() {
        let app = launch(syntheticOwner: true)
        let wall = target("native-ios-unified-photo-gallery", app)
        XCTAssertTrue(wall.waitForExistence(timeout: 15))
        tap("native-ios-gallery-open-filters", app)
        let search = app.textFields["文件名"].firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 15),
                      "Real unified Gallery filename editor missing")
        search.tap()
        search.typeText("navigation-regression")
        let apply = app.navigationBars.buttons["应用"].firstMatch
        XCTAssertTrue(apply.waitForExistence(timeout: 15))
        print("IOS_NATIVE_NAV_TAP_START route=native-ios-gallery-filter-apply")
        apply.tap()
        assertGallery(app)
        let filterButton = target("native-ios-gallery-open-filters", app)
        XCTAssertTrue(filterButton.label.contains("已筛选"),
                      "Applied filename filter must be visible to the user")
        let filteredGeneration = wall.value as? String
        XCTAssertNotNil(filteredGeneration.flatMap(UUID.init(uuidString:)))
        tap("native-ios-tab-files", app)
        enterBrowseHome(app)
        for section in ["recent", "favorites", "browse"] {
            tap("native-ios-files-section-\(section)", app)
            assertFiles(app)
        }
        tap("native-ios-tab-gallery", app)
        XCTAssertTrue(filterButton.label.contains("已筛选"),
                      "Returning from Files dropped the active Gallery search")
        XCTAssertEqual(wall.value as? String, filteredGeneration,
                       "An unchanged Gallery query should retain its current wall generation")
        let clear = app.buttons["清除"].firstMatch
        XCTAssertTrue(clear.waitForExistence(timeout: 15))
        print("IOS_NATIVE_NAV_TAP_START route=native-ios-gallery-filter-clear")
        clear.tap()
        assertGallery(app)
        assertPixels(app, "Gallery filename filter applied Files return then cleared")
    }

    func testFilesSizeFilterOriginalsReturnAndResetWithoutBlank() {
        let app = launch(syntheticOwner: true)
        tap("native-ios-tab-files", app)
        enterBrowseHome(app)
        tap("native-ios-files-search-size-filter", app)
        let small = app.buttons["小于 1 MiB"].firstMatch
        XCTAssertTrue(small.waitForExistence(timeout: 15),
                      "Real Files size-filter Menu choice was not presented")
        print("IOS_NATIVE_NAV_TAP_START route=native-ios-files-size-under-1mib")
        small.tap()
        let sizeControl = target("native-ios-files-search-size-filter", app)
        XCTAssertTrue(sizeControl.waitForExistence(timeout: 15))
        XCTAssertTrue(sizeControl.label.contains("文件大小已筛选"),
                      "Applied Files size filter must remain visibly active")
        tap("native-ios-tab-gallery", app)
        tap("native-ios-gallery-source-originals", app)
        XCTAssertTrue(target("native-ios-cloud-original-layout-help", app)
            .waitForExistence(timeout: 15),
            "Originals child did not mount after Files global filter")
        tap("native-ios-tab-files", app)
        enterBrowseHome(app)
        XCTAssertTrue(sizeControl.waitForExistence(timeout: 15))
        XCTAssertTrue(sizeControl.label.contains("文件大小已筛选"),
                      "Files silently lost its active size filter on Gallery tab return")
        tap("native-ios-files-search-size-filter", app)
        let reset = app.buttons["不限大小"].firstMatch
        XCTAssertTrue(reset.waitForExistence(timeout: 15))
        reset.tap()
        assertFiles(app)
        assertPixels(app, "Files size filter Originals and reset")
    }

    func testFilesOrganizeHomeSheetBackgroundRotationGalleryReturn() {
        let app = launch(syntheticOwner: true)
        defer { XCUIDevice.shared.orientation = .portrait }
        tap("native-ios-tab-files", app)
        enterBrowseHome(app)
        let list = app.collectionViews.firstMatch
        XCTAssertTrue(list.waitForExistence(timeout: 15),
                      "Actual Files Browse home collection was not mounted")
        let organize = target("native-ios-files-organize-home", app)
        for _ in 0..<7 {
            if organize.exists && organize.isHittable { break }
            list.swipeUp()
        }
        XCTAssertTrue(organize.exists && organize.isHittable,
                      "Files Home Organizer entry not reachable by real scrolling")
        print("IOS_NATIVE_NAV_TAP_START route=native-ios-files-organize-home")
        organize.tap()
        XCTAssertTrue(target("native-ios-files-organize-home-sheet", app)
            .waitForExistence(timeout: 15),
            "Native Files Organizer Sheet did not mount")
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertEqual(app.state, .runningForeground)
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(target("native-ios-files-organize-home-sheet", app)
            .waitForExistence(timeout: 15),
            "Foreground/rotation lost Organizer Sheet without a dismissal")
        let done = app.navigationBars.buttons["完成"].firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 15))
        let enabled = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "enabled == true"), object: done)
        XCTAssertEqual(XCTWaiter.wait(for: [enabled], timeout: 15), .completed,
                       "Organizer completion stayed disabled after loading settled")
        print("IOS_NATIVE_NAV_TAP_START route=native-ios-files-organize-done")
        done.tap()
        XCUIDevice.shared.orientation = .portrait
        assertFiles(app)
        tap("native-ios-tab-gallery", app)
        tap("native-ios-gallery-source-albums", app)
        assertGallery(app)
        tap("native-ios-tab-files", app)
        enterBrowseHome(app)
        XCTAssertFalse(target("native-ios-files-organize-home-sheet", app).exists,
                       "Stale Files Organizer Sheet remained after real dismissal")
        assertPixels(app, "Files organizer background rotation and Gallery return")
    }

    func testFilesTrashRetryLandscapeOriginalsReturnHasNoGhostChild() {
        let app = launch(syntheticOwner: true)
        defer { XCUIDevice.shared.orientation = .portrait }
        tap("native-ios-tab-files", app)
        enterBrowseHome(app)
        tap("native-ios-files-open-trash", app)
        XCTAssertTrue(target("native-ios-files-trash-error-page", app)
            .waitForExistence(timeout: 15),
            "Synthetic unauthenticated Owner must show real Trash denial")
        XCUIDevice.shared.orientation = .landscapeLeft
        tap("native-ios-files-trash-retry", app)
        XCTAssertTrue(target("native-ios-files-trash-error-page", app)
            .waitForExistence(timeout: 15),
            "Trash retry must fail closed, not show fabricated private rows")
        tap("native-ios-files-trash-error-return", app)
        assertFiles(app)
        XCUIDevice.shared.orientation = .portrait
        tap("native-ios-tab-gallery", app)
        tap("native-ios-gallery-source-originals", app)
        XCTAssertTrue(target("native-ios-cloud-original-layout-help", app)
            .waitForExistence(timeout: 15))
        tap("native-ios-tab-files", app)
        enterBrowseHome(app)
        XCTAssertFalse(target("native-ios-files-trash-error-page", app).exists,
                       "Recovered Trash child reappeared over Files after tab return")
        assertPixels(app, "Trash denial retry rotation Originals and Files return")
    }
}
