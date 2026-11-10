import XCTest
import UIKit

/// The real Simulator app, using the same native Files/Gallery screens as a
/// signed-in user. The synthetic Owner has no access token: failed protected
/// reads may show an error, but must not kill or replace a navigation shell.
/// These are mount/return/crash checks, not proof of zero dropped frames.
final class XDriveIOSGalleryFilesStabilityUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    // XCTest has its own AX/idling overhead. These timings are comparative
    // navigation diagnostics, not device FPS or an animation-duration claim.
    private var navigationStarted: Date?
    private var navigationID: String?

    private func reportNavigationReady(_ page: String) {
        guard let start = navigationStarted, let route = navigationID else { return }
        let milliseconds = Int((Date().timeIntervalSince(start) * 1000).rounded())
        print("IOS_NATIVE_NAVIGATION_READY_MS route=\(route) page=\(page) value=\(milliseconds)")
        navigationStarted = nil
        navigationID = nil
    }

    private func launch(syntheticOwner: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-xdrive-ui-navigation-smoke"]
        if syntheticOwner {
            app.launchArguments.append("-xdrive-ui-navigation-synthetic-owner")
        }
        app.launch()
        XCTAssertEqual(app.state, .runningForeground, "Native app exited during launch")
        return app
    }

    private func target(_ id: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func select(_ id: String, in app: XCUIApplication) {
        let control = target(id, in: app)
        XCTAssertTrue(control.waitForExistence(timeout: 15),
                      "Missing native navigation control: \(id)")
        navigationStarted = Date()
        navigationID = id
        // Live CI screenshot observer can sample near the actual route switch,
        // rather than only 0.5s after the XCTest case itself started.
        print("IOS_NATIVE_NAV_TAP_START route=\(id)")
        control.tap()
        XCTAssertEqual(app.state, .runningForeground, "App exited after \(id)")
    }

    private func checkFilesHome(_ app: XCUIApplication) {
        XCTAssertTrue(target("native-ios-files-section-browse", in: app)
            .waitForExistence(timeout: 15), "Files quick rail disappeared")
        XCTAssertEqual(app.state, .runningForeground)
        reportNavigationReady("files")
    }

    private func checkGallery(_ app: XCUIApplication) {
        XCTAssertTrue(target("native-ios-gallery-source-unified", in: app)
            .waitForExistence(timeout: 15), "Gallery source rail disappeared")
        XCTAssertEqual(app.state, .runningForeground)
        reportNavigationReady("gallery")
    }


    /// The real native Gallery exposes only its DEBUG page-generation UUID,
    /// never the Owner, PhotoKit identifiers or pixels.
    private func verifiedUnifiedGeneration(_ app: XCUIApplication) -> String {
        let shell = target("native-ios-unified-photo-gallery", in: app)
        XCTAssertTrue(shell.waitForExistence(timeout: 15),
                      "Unified Gallery did not mount for a return-lifetime check")
        guard let value = shell.value as? String,
              UUID(uuidString: value) != nil else {
            XCTFail("The live native Gallery did not expose a valid DEBUG generation")
            return ""
        }
        return value
    }

    private func assertUnchangedUnifiedWall(_ app: XCUIApplication,
                                            before: String, label: String) {
        checkGallery(app)
        XCTAssertEqual(verifiedUnifiedGeneration(app), before,
                       "The verified Gallery wall was needlessly rebuilt: " + label)
        assertNotSolidScreen(app, label)
    }

    func testRapidGalleryFilesTabOscillationPreservesBothShells() {
        let app = launch()
        for _ in 0..<8 {
            select("native-ios-tab-files", in: app)
            checkFilesHome(app)
            select("native-ios-tab-gallery", in: app)
            checkGallery(app)
        }
    }

    func testFilesQuickRailAlternatingSectionsReturnsToBrowse() {
        let app = launch(syntheticOwner: true)
        select("native-ios-tab-files", in: app)
        for _ in 0..<3 {
            for section in ["recent", "favorites", "browse"] {
                select("native-ios-files-section-\(section)", in: app)
                checkFilesHome(app)
            }
        }
    }

    func testGallerySourcesAlternateWithoutLosingSourceRail() {
        let app = launch()
        for _ in 0..<2 {
            for source in ["albums", "unified", "originals", "unified"] {
                select("native-ios-gallery-source-\(source)", in: app)
                checkGallery(app)
            }
        }
    }

    func testRepeatedFilterDismissalRestoresSameGallery() {
        let app = launch()
        for _ in 0..<3 {
            select("native-ios-gallery-open-filters", in: app)
            let cancel = app.buttons["取消"].firstMatch
            XCTAssertTrue(cancel.waitForExistence(timeout: 15),
                          "Gallery filter editor did not mount")
            cancel.tap()
            checkGallery(app)
            XCTAssertTrue(target("native-ios-gallery-open-filters", in: app)
                .waitForExistence(timeout: 10))
        }
    }

    func testUnifiedGalleryFilterMapOpensRealSharedMapAndReturnsWithoutBlank() {
        let app = launch()
        checkGallery(app)
        select("native-ios-gallery-open-filters", in: app)
        let open = target("native-ios-unified-gallery-show-map", in: app)
        XCTAssertTrue(open.waitForExistence(timeout: 15),
                      "Unified Gallery filter editor must offer native Show Map")
        XCTAssertTrue(open.isEnabled, "Unfiltered Gallery may enter scoped MapKit")
        open.tap()
        // The filter sheet fully dismisses before presenting the existing
        // MapKit route. The local permission screen may still be denied:
        // never pretend this UI-navigation smoke proves PhotoKit Full Access.
        XCTAssertTrue(target("native-ios-map-source-selector", in: app)
            .waitForExistence(timeout: 25),
            "Unified Gallery did not present the real local/cloud map")
        XCTAssertTrue(target("native-ios-map-dismiss", in: app)
            .waitForExistence(timeout: 15),
            "Modal MapKit must have a real return action")
        select("native-ios-map-dismiss", in: app)
        checkGallery(app)
        XCTAssertTrue(target("native-ios-unified-photo-gallery", in: app)
            .waitForExistence(timeout: 15),
            "Map return replaced rather than retained the unified Gallery")
        assertNotSolidScreen(app, "Unified Gallery after modal MapKit return")
    }

    func testUnifiedSourceFilterCannotClaimUnrepresentableMapMembership() {
        let app = launch()
        checkGallery(app)
        let paired = app.buttons["两端都有"].firstMatch
        XCTAssertTrue(paired.waitForExistence(timeout: 15),
                      "Unified Gallery source filter is unavailable")
        if !paired.isHittable {
            target("native-ios-unified-gallery-filters", in: app).swipeLeft()
        }
        paired.tap()
        select("native-ios-gallery-open-filters", in: app)
        let open = target("native-ios-unified-gallery-show-map", in: app)
        XCTAssertTrue(open.waitForExistence(timeout: 15))
        XCTAssertFalse(open.isEnabled,
                       "A both-sources identity filter cannot silently display an unfiltered local map")
        XCTAssertTrue(target("native-ios-unified-gallery-map-scope", in: app).exists)
        app.buttons["取消"].firstMatch.tap()
        checkGallery(app)
    }

    func testOfflineOwnerCloudFilesBackKeepsHomeAndDoesNotExit() {
        let app = launch(syntheticOwner: true)
        select("native-ios-tab-files", in: app)
        checkFilesHome(app)
        select("native-ios-files-open-root-location", in: app)
        // Capture the child *before* an AX request. Previously AX snapshot
        // enumeration hung for 128 seconds in a nested unreadable Files List.
        let evidence = XCTAttachment(screenshot: app.screenshot())
        evidence.name = "cloud-child-after-push"
        evidence.lifetime = .keepAlways
        add(evidence)
        XCTAssertTrue(target("native-ios-files-error-page", in: app)
            .waitForExistence(timeout: 12),
                      "Unreadable cloud folder must render a bounded error page")
        select("native-ios-files-error-return", in: app)
        checkFilesHome(app)
        XCTAssertTrue(target("native-ios-files-open-root-location", in: app)
            .waitForExistence(timeout: 15))
    }

    func testOfflineOwnerGalleryPeopleChildBackRestoresSource() {
        let app = launch(syntheticOwner: true)
        select("native-ios-gallery-people", in: app)
        XCTAssertTrue(target("native-ios-gallery-people-page", in: app)
            .waitForExistence(timeout: 15), "People child did not mount")
        let back = app.navigationBars.buttons.element(boundBy: 0)
        XCTAssertTrue(back.waitForExistence(timeout: 15),
                      "People child back button not available")
        back.tap()
        checkGallery(app)
    }
    /// Retained after returning to the native tab, rather than accepting a
    /// screen-sized solid flash as successful merely because the app is alive.
    /// This is a sampled, *settled* frame guard; it is not a 60/120fps claim.
    private func assertNotSolidScreen(_ app: XCUIApplication, _ reason: String) {
        let screenshot = app.screenshot()
        guard let image = screenshot.image.cgImage else {
            XCTFail("No screenshot CGImage after " + reason)
            return
        }
        let width = 24, height = 32
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let rendered = pixels.withUnsafeMutableBytes { buffer -> Bool in
            guard let base = buffer.baseAddress,
                  let context = CGContext(
                      data: base, width: width, height: height,
                      bitsPerComponent: 8, bytesPerRow: width * 4,
                      space: CGColorSpaceCreateDeviceRGB(),
                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                  ) else { return false }
            context.interpolationQuality = .low
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        XCTAssertTrue(rendered, "Screenshot could not be sampled after " + reason)
        guard rendered else { return }
        let unique = Set(stride(from: 0, to: pixels.count, by: 4).map { offset in
            (Int(pixels[offset]) << 16) |
            (Int(pixels[offset + 1]) << 8) |
            Int(pixels[offset + 2])
        })
        XCTAssertGreaterThan(unique.count, 8,
                             "Native page became visually uniform after " + reason)
    }

    func testGalleryFilesAlternationRetainsNonBlankSettledFrames() {
        let app = launch()
        let started = Date()
        for _ in 0..<3 {
            select("native-ios-tab-files", in: app)
            checkFilesHome(app)
            assertNotSolidScreen(app, "Files tab mount")
            select("native-ios-tab-gallery", in: app)
            checkGallery(app)
            assertNotSolidScreen(app, "Gallery tab mount")
        }
        // A diagnostic for future comparative profiling. XCUITest event
        // dispatch/screenshot overhead is not equivalent to user-perceived FPS.
        print("IOS_GALLERY_FILES_SCREEN_AUDIT elapsed=\(Date().timeIntervalSince(started))")
    }

    func testGalleryFilterCancelAfterTabAndSourceRoundTrips() {
        let app = launch()
        for _ in 0..<3 {
            select("native-ios-gallery-source-albums", in: app)
            select("native-ios-gallery-source-unified", in: app)
            select("native-ios-gallery-open-filters", in: app)
            let cancel = app.buttons["取消"].firstMatch
            XCTAssertTrue(cancel.waitForExistence(timeout: 15),
                          "Filter cancel action missing after source switch")
            cancel.tap()
            select("native-ios-tab-files", in: app)
            checkFilesHome(app)
            select("native-ios-tab-gallery", in: app)
            checkGallery(app)
            XCTAssertTrue(target("native-ios-gallery-open-filters", in: app)
                .waitForExistence(timeout: 10))
        }
    }

    func testGalleryPeopleChildReturnRepeatsWithoutLosingGallerySource() {
        let app = launch(syntheticOwner: true)
        for _ in 0..<3 {
            select("native-ios-gallery-people", in: app)
            XCTAssertTrue(target("native-ios-gallery-people-page", in: app)
                .waitForExistence(timeout: 15))
            let back = app.navigationBars.buttons.element(boundBy: 0)
            XCTAssertTrue(back.waitForExistence(timeout: 15),
                          "Native People back was unavailable")
            back.tap()
            checkGallery(app)
        }
    }

    func testGalleryUnchangedForegroundRetainsVerifiedWallGeneration() {
        let app = launch()
        let gallery = target("native-ios-unified-photo-gallery", in: app)
        XCTAssertTrue(gallery.waitForExistence(timeout: 15),
                      "Unified Gallery did not mount before foreground transition")
        guard let before = gallery.value as? String,
              UUID(uuidString: before) != nil else {
            XCTFail("Native Gallery debug generation is missing")
            return
        }
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertEqual(app.state, .runningForeground)
        XCTAssertTrue(gallery.waitForExistence(timeout: 15))
        XCTAssertEqual(gallery.value as? String, before,
                       "Unchanged PhotoKit/Owner foreground return rebuilt the Gallery wall")
        checkGallery(app)
        assertNotSolidScreen(app, "Gallery after unchanged PhotoKit foreground return")
    }

    // Native XCTest: settled screenshot/AX checks are not device FPS evidence.
    private func readGalleryGeneration(_ app: XCUIApplication, stage: String) -> String? {
        let gallery = target("native-ios-unified-photo-gallery", in: app)
        guard gallery.waitForExistence(timeout: 15),
              let value = gallery.value as? String,
              UUID(uuidString: value) != nil else {
            XCTFail("Missing native Gallery generation at " + stage)
            return nil
        }
        return value
    }

    private func assertGalleryGeneration(_ app: XCUIApplication,
                                         remains expected: String, stage: String) {
        guard let value = readGalleryGeneration(app, stage: stage) else { return }
        XCTAssertEqual(value, expected, "Gallery wall was rebuilt at " + stage)
        checkGallery(app)
        XCTAssertEqual(app.state, .runningForeground)
    }

    func testGalleryFourUnchangedForegroundCyclesPreserveWallAndPixels() {
        let app = launch()
        guard let generation = readGalleryGeneration(app, stage: "initial") else { return }
        for cycle in 0..<4 {
            XCUIDevice.shared.press(.home)
            app.activate()
            assertGalleryGeneration(app, remains: generation, stage: "cycle \(cycle)")
            assertNotSolidScreen(app, "Gallery foreground cycle \(cycle)")
        }
    }

    func testGalleryDismissedFilterThenForegroundDoesNotRebuildWall() {
        let app = launch()
        select("native-ios-gallery-open-filters", in: app)
        let cancel = app.buttons["取消"].firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 15))
        cancel.tap()
        let retired = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"), object: cancel)
        XCTAssertEqual(XCTWaiter.wait(for: [retired], timeout: 8), .completed,
                       "Filter sheet failed to close")
        checkGallery(app)
        guard let generation = readGalleryGeneration(app, stage: "filter closed") else { return }
        XCUIDevice.shared.press(.home)
        app.activate()
        assertGalleryGeneration(app, remains: generation, stage: "filter and foreground")
        assertNotSolidScreen(app, "Gallery after filter and foreground")
    }

    func testGalleryPeopleBackThenForegroundKeepsVerifiedWall() {
        let app = launch(syntheticOwner: true)
        select("native-ios-gallery-people", in: app)
        XCTAssertTrue(target("native-ios-gallery-people-page", in: app)
            .waitForExistence(timeout: 15))
        let back = app.navigationBars.buttons.element(boundBy: 0)
        XCTAssertTrue(back.waitForExistence(timeout: 15))
        back.tap()
        checkGallery(app)
        guard let generation = readGalleryGeneration(app, stage: "People return") else { return }
        XCUIDevice.shared.press(.home)
        app.activate()
        assertGalleryGeneration(app, remains: generation, stage: "People foreground")
        assertNotSolidScreen(app, "Gallery after People return and foreground")
    }

    func testGallerySourceChangeThenUnchangedForegroundKeepsLatestGeneration() {
        let app = launch()
        select("native-ios-gallery-source-albums", in: app)
        checkGallery(app)
        select("native-ios-gallery-source-unified", in: app)
        checkGallery(app)
        guard let generation = readGalleryGeneration(app, stage: "source changed") else { return }
        XCUIDevice.shared.press(.home)
        app.activate()
        assertGalleryGeneration(app, remains: generation, stage: "source then foreground")
        assertNotSolidScreen(app, "Gallery after source and foreground")
    }

    func testGalleryFilesRoundTripThenForegroundKeepsWallGeneration() {
        let app = launch()
        guard let generation = readGalleryGeneration(app, stage: "before Files") else { return }
        select("native-ios-tab-files", in: app)
        checkFilesHome(app)
        select("native-ios-tab-gallery", in: app)
        assertGalleryGeneration(app, remains: generation, stage: "Files return")
        XCUIDevice.shared.press(.home)
        app.activate()
        assertGalleryGeneration(app, remains: generation, stage: "Files foreground")
        assertNotSolidScreen(app, "Gallery after Files return and foreground")
    }

    func testGalleryForegroundAfterDeniedCloudFilesDoesNotLeakOrRebuild() {
        let app = launch(syntheticOwner: true)
        select("native-ios-tab-files", in: app)
        select("native-ios-files-open-root-location", in: app)
        XCTAssertTrue(target("native-ios-files-error-page", in: app)
            .waitForExistence(timeout: 15))
        XCTAssertFalse(target("native-ios-files-retry", in: app).exists,
                       "No Session must not expose protected Cloud Retry")
        select("native-ios-files-error-return", in: app)
        checkFilesHome(app)
        select("native-ios-tab-gallery", in: app)
        checkGallery(app)
        guard let generation = readGalleryGeneration(app, stage: "denied Cloud return") else { return }
        XCUIDevice.shared.press(.home)
        app.activate()
        assertGalleryGeneration(app, remains: generation, stage: "denied Cloud foreground")
        assertNotSolidScreen(app, "Gallery after denied Cloud and foreground")
    }

    func testGalleryBackgroundResumeKeepsNativeSourceAndPixels() {
        let app = launch()
        select("native-ios-tab-gallery", in: app)
        checkGallery(app)
        XCUIDevice.shared.press(.home)
        app.activate()
        checkGallery(app)
        assertNotSolidScreen(app, "Gallery foreground reentry")
    }

    func testFilesBackgroundResumeKeepsQuickRailAndPixels() {
        let app = launch(syntheticOwner: true)
        select("native-ios-tab-files", in: app)
        checkFilesHome(app)
        XCUIDevice.shared.press(.home)
        app.activate()
        checkFilesHome(app)
        assertNotSolidScreen(app, "Files foreground reentry")
    }

    func testGalleryFilesRotateLandscapeAndReturnPortrait() {
        let device = XCUIDevice.shared
        let app = launch()
        defer { device.orientation = .portrait }
        select("native-ios-tab-files", in: app)
        checkFilesHome(app)
        device.orientation = .landscapeLeft
        checkFilesHome(app)
        assertNotSolidScreen(app, "Files landscape")
        select("native-ios-tab-gallery", in: app)
        checkGallery(app)
        assertNotSolidScreen(app, "Gallery landscape")
        device.orientation = .portrait
        checkGallery(app)
    }

    func testGalleryAlbumsSurviveBackgroundAndSourceRoundTrip() {
        let app = launch()
        select("native-ios-gallery-source-albums", in: app)
        checkGallery(app)
        XCUIDevice.shared.press(.home)
        app.activate()
        checkGallery(app)
        select("native-ios-gallery-source-unified", in: app)
        checkGallery(app)
        select("native-ios-gallery-source-albums", in: app)
        checkGallery(app)
        assertNotSolidScreen(app, "Albums after foreground/source transition")
    }

    func testFilesHomeDeepScrollTabReturnKeepsQuickNavigation() {
        let app = launch(syntheticOwner: true)
        select("native-ios-tab-files", in: app)
        let list = app.collectionViews.firstMatch
        XCTAssertTrue(list.waitForExistence(timeout: 12),
                      "Files Home native collection missing")
        list.swipeUp()
        list.swipeUp()
        select("native-ios-tab-gallery", in: app)
        checkGallery(app)
        select("native-ios-tab-files", in: app)
        checkFilesHome(app)
        assertNotSolidScreen(app, "Files home after deep scroll/return")
    }

    func testNativeMineGalleryFilesSwitchAfterSourceChanges() {
        let app = launch()
        for _ in 0..<3 {
            select("native-ios-gallery-source-albums", in: app)
            select("native-ios-tab-mine", in: app)
            XCTAssertEqual(app.state, .runningForeground)
            select("native-ios-tab-files", in: app)
            checkFilesHome(app)
            select("native-ios-tab-gallery", in: app)
            checkGallery(app)
            select("native-ios-gallery-source-unified", in: app)
        }
        assertNotSolidScreen(app, "Gallery after Mine/Files roundtrip")
    }

    func testFilesSearchFocusThenGalleryReturnPreservesShell() {
        let app = launch()
        select("native-ios-tab-files", in: app)
        let search = app.searchFields["搜索全部文件"].firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 15))
        search.tap()
        search.typeText("ab")
        XCTAssertEqual(app.state, .runningForeground)
        // Keyboard dismissal is a real interaction; no coordinate guessing.
        if app.keyboards.buttons["Search"].exists {
            app.keyboards.buttons["Search"].tap()
        } else if app.keyboards.buttons["完成"].exists {
            app.keyboards.buttons["完成"].tap()
        } else {
            search.typeText("\n")
        }
        checkFilesHome(app)
        assertNotSolidScreen(app, "Files after Search submit and rail restoration")
        select("native-ios-tab-gallery", in: app)
        checkGallery(app)
        select("native-ios-tab-files", in: app)
        checkFilesHome(app)
    }

    func testFilesGalleryNativeRelaunchDoesNotLoseInitialPages() {
        let app = launch()
        select("native-ios-tab-files", in: app)
        checkFilesHome(app)
        app.terminate()
        app.launch()
        XCTAssertEqual(app.state, .runningForeground)
        select("native-ios-tab-gallery", in: app)
        checkGallery(app)
        select("native-ios-tab-files", in: app)
        checkFilesHome(app)
        assertNotSolidScreen(app, "Files after native app relaunch")
    }

    func testAlternatingGalleryFilesSettledFramesAcrossThreeTabs() {
        let app = launch()
        for _ in 0..<2 {
            select("native-ios-tab-files", in: app)
            checkFilesHome(app)
            assertNotSolidScreen(app, "Files")
            select("native-ios-tab-mine", in: app)
            assertNotSolidScreen(app, "Mine")
            select("native-ios-tab-gallery", in: app)
            checkGallery(app)
            assertNotSolidScreen(app, "Gallery")
        }
    }


    func testAlbumSourceReturnThroughFilesAndMineKeepsGalleryMounted() {
        let app = launch()
        for _ in 0..<3 {
            select("native-ios-gallery-source-albums", in: app)
            checkGallery(app)
            select("native-ios-tab-files", in: app)
            checkFilesHome(app)
            select("native-ios-tab-mine", in: app)
            XCTAssertEqual(app.state, .runningForeground)
            select("native-ios-tab-gallery", in: app)
            checkGallery(app)
            assertNotSolidScreen(app, "Albums after Files and Mine")
        }
    }

    func testFilesRecentAndFavoritesRemainAvailableAfterForegroundReturn() {
        let app = launch(syntheticOwner: true)
        select("native-ios-tab-files", in: app)
        select("native-ios-files-section-recent", in: app)
        select("native-ios-files-section-favorites", in: app)
        XCUIDevice.shared.press(.home)
        app.activate()
        checkFilesHome(app)
        select("native-ios-files-section-browse", in: app)
        select("native-ios-files-section-recent", in: app)
        checkFilesHome(app)
        assertNotSolidScreen(app, "Files quick rail after background")
    }

    func testGalleryPeopleAfterFilesQuickRailReturnKeepsUnifiedWall() {
        let app = launch(syntheticOwner: true)
        select("native-ios-tab-files", in: app)
        for part in ["recent", "favorites", "browse"] {
            select("native-ios-files-section-\(part)", in: app)
        }
        select("native-ios-tab-gallery", in: app)
        checkGallery(app)
        select("native-ios-gallery-people", in: app)
        XCTAssertTrue(target("native-ios-gallery-people-page", in: app)
            .waitForExistence(timeout: 15), "People child missing after Files rail")
        let back = app.navigationBars.buttons.element(boundBy: 0)
        XCTAssertTrue(back.waitForExistence(timeout: 15))
        back.tap()
        checkGallery(app)
        assertNotSolidScreen(app, "Unified wall after People and Files")
    }

    func testGalleryFilterCancelAfterRecentFavoritesToggle() {
        let app = launch(syntheticOwner: true)
        for _ in 0..<2 {
            select("native-ios-tab-files", in: app)
            select("native-ios-files-section-recent", in: app)
            select("native-ios-files-section-favorites", in: app)
            select("native-ios-files-section-browse", in: app)
            select("native-ios-tab-gallery", in: app)
            select("native-ios-gallery-open-filters", in: app)
            let cancel = app.buttons["取消"].firstMatch
            XCTAssertTrue(cancel.waitForExistence(timeout: 15))
            cancel.tap()
            checkGallery(app)
        }
    }

    func testNativeLocalGalleryMenuRouteReturnsToUnifiedSource() {
        let app = launch()
        select("native-ios-gallery-source-menu", in: app)
        let local = app.buttons["本机照片"].firstMatch
        XCTAssertTrue(local.waitForExistence(timeout: 15),
                      "Native local Photos source is missing from source Menu")
        local.tap()
        XCTAssertTrue(target("native-ios-gallery-source-local", in: app)
            .waitForExistence(timeout: 15),
                      "Native local PhotoKit source did not become selected")
        assertNotSolidScreen(app, "Local PhotoKit source")
        select("native-ios-tab-files", in: app)
        checkFilesHome(app)
        select("native-ios-tab-gallery", in: app)
        XCTAssertTrue(target("native-ios-gallery-source-local", in: app)
            .waitForExistence(timeout: 15))
        select("native-ios-gallery-source-unified", in: app)
        checkGallery(app)
    }

    func testGalleryAlbumSourceWithLandscapeAndTabReturn() {
        let app = launch()
        let device = XCUIDevice.shared
        defer { device.orientation = .portrait }
        select("native-ios-gallery-source-albums", in: app)
        device.orientation = .landscapeLeft
        checkGallery(app)
        select("native-ios-tab-files", in: app)
        checkFilesHome(app)
        device.orientation = .portrait
        select("native-ios-tab-gallery", in: app)
        checkGallery(app)
        assertNotSolidScreen(app, "Albums after orientation and Files")
    }

    func testFilesHomeAfterRepeatedNativeGallerySourceChanges() {
        let app = launch()
        for source in ["albums", "unified", "originals", "unified"] {
            select("native-ios-gallery-source-\(source)", in: app)
            checkGallery(app)
        }
        for _ in 0..<3 {
            select("native-ios-tab-files", in: app)
            checkFilesHome(app)
            assertNotSolidScreen(app, "Files Home after source changes")
            select("native-ios-tab-gallery", in: app)
            checkGallery(app)
        }
    }

    func testCloudFilesRepeatedOfflineRetryRetainsRecoverableChildPage() {
        let app = launch(syntheticOwner: true)
        select("native-ios-tab-files", in: app)
        select("native-ios-files-open-root-location", in: app)
        XCTAssertTrue(target("native-ios-files-error-page", in: app)
            .waitForExistence(timeout: 15), "Offline cloud child did not fail closed")
        let first = XCTAttachment(screenshot: app.screenshot())
        first.name = "cloud-failed-first-read"
        first.lifetime = .keepAlways
        add(first)
        XCTAssertFalse(target("native-ios-files-retry", in: app).exists,
                           "A missing Session cannot retry a protected Cloud read")
        XCTAssertTrue(target("native-ios-files-error-page", in: app)
            .waitForExistence(timeout: 15), "Missing Session must preserve the fail-closed cloud page")
        select("native-ios-files-error-return", in: app)
        checkFilesHome(app)
        XCTAssertEqual(app.state, .runningForeground)
    }

    func testRecentlyDeletedRepeatedOfflineRetryRetainsRecoverableChildPage() {
        let app = launch(syntheticOwner: true)
        select("native-ios-tab-files", in: app)
        select("native-ios-files-open-trash", in: app)
        XCTAssertTrue(target("native-ios-files-trash-error-page", in: app)
            .waitForExistence(timeout: 15), "Offline Trash did not fail closed")
        let first = XCTAttachment(screenshot: app.screenshot())
        first.name = "trash-failed-first-read"
        first.lifetime = .keepAlways
        add(first)
        XCTAssertFalse(target("native-ios-files-trash-retry", in: app).exists,
                           "A missing Session cannot retry or mutate Trash")
        XCTAssertTrue(target("native-ios-files-trash-error-page", in: app)
            .waitForExistence(timeout: 15), "Missing Session must preserve the fail-closed Trash page")
        select("native-ios-files-trash-error-return", in: app)
        checkFilesHome(app)
        XCTAssertEqual(app.state, .runningForeground)
    }

    func testGalleryPeopleAfterOfflineFilesErrorReturnHasNoSettledBlank() {
        let app = launch(syntheticOwner: true)
        select("native-ios-tab-files", in: app)
        select("native-ios-files-open-root-location", in: app)
        XCTAssertTrue(target("native-ios-files-error-page", in: app)
            .waitForExistence(timeout: 15))
        select("native-ios-files-error-return", in: app)
        checkFilesHome(app)
        select("native-ios-tab-gallery", in: app)
        select("native-ios-gallery-people", in: app)
        XCTAssertTrue(target("native-ios-gallery-people-page", in: app)
            .waitForExistence(timeout: 15))
        let back = app.navigationBars.buttons.element(boundBy: 0)
        XCTAssertTrue(back.waitForExistence(timeout: 15))
        back.tap()
        checkGallery(app)
        assertNotSolidScreen(app, "Gallery after offline Files and People")
    }

    func testGalleryAlbumsAndOriginalsAfterForegroundResumeKeepSourceRail() {
        let app = launch()
        select("native-ios-gallery-source-albums", in: app)
        checkGallery(app)
        XCUIDevice.shared.press(.home)
        app.activate()
        checkGallery(app)
        select("native-ios-gallery-source-originals", in: app)
        checkGallery(app)
        select("native-ios-tab-files", in: app)
        checkFilesHome(app)
        select("native-ios-tab-gallery", in: app)
        checkGallery(app)
        select("native-ios-gallery-source-unified", in: app)
        assertNotSolidScreen(app, "Gallery after Albums/Originals foreground")
    }

    func testNativeFilesQuickRailAfterLandscapeGalleryReturnNoBlank() {
        let app = launch(syntheticOwner: true)
        let device = XCUIDevice.shared
        defer { device.orientation = .portrait }
        select("native-ios-tab-files", in: app)
        for section in ["recent", "favorites", "browse"] {
            select("native-ios-files-section-\(section)", in: app)
        }
        device.orientation = .landscapeLeft
        checkFilesHome(app)
        select("native-ios-tab-gallery", in: app)
        checkGallery(app)
        device.orientation = .portrait
        select("native-ios-tab-files", in: app)
        checkFilesHome(app)
        assertNotSolidScreen(app, "Files quick rail after rotation")
    }

    func testLocalPhotoSourceRetainsGalleryAfterFilesForegroundRoundtrip() {
        let app = launch()
        select("native-ios-gallery-source-menu", in: app)
        let local = app.buttons["本机照片"].firstMatch
        XCTAssertTrue(local.waitForExistence(timeout: 15))
        local.tap()
        XCTAssertTrue(target("native-ios-gallery-source-local", in: app)
            .waitForExistence(timeout: 15))
        select("native-ios-tab-files", in: app)
        checkFilesHome(app)
        XCUIDevice.shared.press(.home)
        app.activate()
        checkFilesHome(app)
        select("native-ios-tab-gallery", in: app)
        XCTAssertTrue(target("native-ios-gallery-source-local", in: app)
            .waitForExistence(timeout: 15))
        assertNotSolidScreen(app, "Local PhotoKit source on resume")
    }

    func testSyntheticOwnerFilesAndGalleryRelaunchDoesNotRetainOldScope() {
        let app = launch(syntheticOwner: true)
        select("native-ios-tab-files", in: app)
        XCTAssertTrue(target("native-ios-files-open-root-location", in: app)
            .waitForExistence(timeout: 15))
        app.terminate()
        app.launchArguments = ["-xdrive-ui-navigation-smoke"]
        app.launch()
        XCTAssertEqual(app.state, .runningForeground)
        select("native-ios-tab-files", in: app)
        checkFilesHome(app)
        XCTAssertFalse(target("native-ios-files-open-root-location", in: app).exists,
                       "A synthetic Owner root survived a signed-out launch")
        select("native-ios-tab-gallery", in: app)
        checkGallery(app)
    }


    // Cross-route regressions intentionally combine two or more native child
    // journeys. Passing an individual isolated tab/sheet test cannot prove
    // that the NEXT return still mounts a usable Gallery/Files surface.
    func testCloudDeniedThenAlbumFilterFilesRoundTripKeepsRealShells() {
        let app = launch(syntheticOwner: true)
        select("native-ios-tab-files", in: app)
        select("native-ios-files-open-root-location", in: app)
        XCTAssertTrue(target("native-ios-files-error-page", in: app)
            .waitForExistence(timeout: 15))
        select("native-ios-files-error-return", in: app)
        checkFilesHome(app)
        select("native-ios-tab-gallery", in: app)
        select("native-ios-gallery-source-albums", in: app)
        select("native-ios-gallery-source-unified", in: app)
        select("native-ios-gallery-open-filters", in: app)
        let cancel = app.buttons["取消"].firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 15))
        cancel.tap()
        select("native-ios-tab-files", in: app)
        checkFilesHome(app)
        select("native-ios-tab-gallery", in: app)
        checkGallery(app)
        assertNotSolidScreen(app, "Gallery after cloud denial and album filter")
    }

    func testTrashDeniedRetryThenFilesRailAndGalleryReturnKeepsPixels() {
        let app = launch(syntheticOwner: true)
        select("native-ios-tab-files", in: app)
        select("native-ios-files-open-trash", in: app)
        XCTAssertTrue(target("native-ios-files-trash-error-page", in: app)
            .waitForExistence(timeout: 15))
        // Synthetic Owner deliberately has no local Session. The fail-closed
        // recovery page must ask for a real login, not offer a Retry that can
        // never produce a token. A valid but denied real Session has the
        // separate explicit retry path in NativeFilesTrash.
        XCTAssertTrue(target("native-ios-files-trash-no-session", in: app)
            .waitForExistence(timeout: 15))
        XCTAssertFalse(target("native-ios-files-trash-retry", in: app).exists)
        select("native-ios-files-trash-error-return", in: app)
        for section in ["recent", "favorites", "browse"] {
            select("native-ios-files-section-\(section)", in: app)
            checkFilesHome(app)
        }
        select("native-ios-tab-gallery", in: app)
        checkGallery(app)
        assertNotSolidScreen(app, "Gallery after Trash retry and Files rail")
    }

    func testGalleryPeopleThenCloudDeniedAndGalleryReturnNoSettledBlank() {
        let app = launch(syntheticOwner: true)
        select("native-ios-gallery-people", in: app)
        XCTAssertTrue(target("native-ios-gallery-people-page", in: app)
            .waitForExistence(timeout: 15))
        let back = app.navigationBars.buttons.element(boundBy: 0)
        XCTAssertTrue(back.waitForExistence(timeout: 15))
        back.tap()
        checkGallery(app)
        select("native-ios-tab-files", in: app)
        select("native-ios-files-open-root-location", in: app)
        XCTAssertTrue(target("native-ios-files-error-page", in: app)
            .waitForExistence(timeout: 15))
        select("native-ios-files-error-return", in: app)
        select("native-ios-tab-gallery", in: app)
        checkGallery(app)
        assertNotSolidScreen(app, "Gallery after People and denied Cloud Files")
    }

    func testRepeatedForegroundResumesAlternatingGalleryAndFilesNoBlank() {
        let app = launch()
        for _ in 0..<3 {
            select("native-ios-tab-files", in: app)
            checkFilesHome(app)
            XCUIDevice.shared.press(.home)
            app.activate()
            checkFilesHome(app)
            assertNotSolidScreen(app, "Files after foreground activation")
            select("native-ios-tab-gallery", in: app)
            checkGallery(app)
            XCUIDevice.shared.press(.home)
            app.activate()
            checkGallery(app)
            assertNotSolidScreen(app, "Gallery after foreground activation")
        }
    }

    func testLocalPhotosSourceSurvivesFilesMineAndGalleryRoundTrip() {
        let app = launch()
        select("native-ios-gallery-source-menu", in: app)
        let local = app.buttons["本机照片"].firstMatch
        XCTAssertTrue(local.waitForExistence(timeout: 15))
        local.tap()
        XCTAssertTrue(target("native-ios-gallery-source-local", in: app)
            .waitForExistence(timeout: 15))
        select("native-ios-tab-files", in: app)
        checkFilesHome(app)
        select("native-ios-tab-mine", in: app)
        select("native-ios-tab-gallery", in: app)
        XCTAssertTrue(target("native-ios-gallery-source-local", in: app)
            .waitForExistence(timeout: 15))
        assertNotSolidScreen(app, "Local PhotoKit route after Files and Mine")
        select("native-ios-gallery-source-unified", in: app)
        checkGallery(app)
    }

    func testFilesSearchThenGalleryFilterAndBackKeepsBothRoutes() {
        let app = launch()
        select("native-ios-tab-files", in: app)
        let search = app.searchFields["搜索全部文件"].firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 15))
        search.tap()
        search.typeText("ab")
        XCTAssertEqual(app.state, .runningForeground)
        // Dismiss the actual search keyboard before tapping the native tab bar.
        if app.keyboards.buttons["Search"].exists {
            app.keyboards.buttons["Search"].tap()
        } else if app.keyboards.buttons["完成"].exists {
            app.keyboards.buttons["完成"].tap()
        } else {
            search.typeText("\n")
        }
        checkFilesHome(app)
        assertNotSolidScreen(app, "Files after Search before Gallery filter")
        select("native-ios-tab-gallery", in: app)
        checkGallery(app)
        select("native-ios-gallery-open-filters", in: app)
        let cancel = app.buttons["取消"].firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 15))
        cancel.tap()
        select("native-ios-tab-files", in: app)
        checkFilesHome(app)
        assertNotSolidScreen(app, "Files after search and Gallery filter")
    }
    // Independent real Simulator routes on the *same unchanged* Gallery
    // source. No fake cloud token, seeded private photos, or FPS claims.
    func testUnifiedWallGenerationPersistsThroughSixFilesTabRoundTrips() {
        let app = launch()
        let before = verifiedUnifiedGeneration(app)
        for cycle in 0..<6 {
            select("native-ios-tab-files", in: app)
            checkFilesHome(app)
            select("native-ios-tab-gallery", in: app)
            assertUnchangedUnifiedWall(app, before: before, label: "Files return \(cycle)")
        }
    }

    func testUnifiedWallGenerationPersistsAfterRecentFavoritesBrowseNavigation() {
        let app = launch(syntheticOwner: true)
        let before = verifiedUnifiedGeneration(app)
        select("native-ios-tab-files", in: app)
        for section in ["recent", "favorites", "browse", "recent", "browse"] {
            select("native-ios-files-section-\(section)", in: app)
            checkFilesHome(app)
        }
        select("native-ios-tab-gallery", in: app)
        assertUnchangedUnifiedWall(app, before: before, label: "Files quick rail")
    }

    func testUnifiedWallGenerationPersistsAfterFilterCancelAndFilesReturn() {
        let app = launch()
        let before = verifiedUnifiedGeneration(app)
        select("native-ios-gallery-open-filters", in: app)
        let cancel = app.buttons["取消"].firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 15))
        cancel.tap()
        select("native-ios-tab-files", in: app)
        checkFilesHome(app)
        select("native-ios-tab-gallery", in: app)
        assertUnchangedUnifiedWall(app, before: before, label: "Filter cancel then Files")
    }

    func testUnifiedWallGenerationPersistsAfterPeopleChildAndFilesReturn() {
        let app = launch(syntheticOwner: true)
        let before = verifiedUnifiedGeneration(app)
        select("native-ios-gallery-people", in: app)
        XCTAssertTrue(target("native-ios-gallery-people-page", in: app)
            .waitForExistence(timeout: 15))
        let back = app.navigationBars.buttons.element(boundBy: 0)
        XCTAssertTrue(back.waitForExistence(timeout: 15))
        back.tap()
        checkGallery(app)
        select("native-ios-tab-files", in: app)
        checkFilesHome(app)
        select("native-ios-tab-gallery", in: app)
        assertUnchangedUnifiedWall(app, before: before, label: "People then Files")
    }

    func testUnifiedWallGenerationPersistsAfterBackgroundAndFilesReturn() {
        let app = launch()
        let before = verifiedUnifiedGeneration(app)
        for cycle in 0..<3 {
            XCUIDevice.shared.press(.home)
            app.activate()
            XCTAssertEqual(app.state, .runningForeground)
            select("native-ios-tab-files", in: app)
            checkFilesHome(app)
            select("native-ios-tab-gallery", in: app)
            assertUnchangedUnifiedWall(app, before: before,
                                       label: "Foreground and Files \(cycle)")
        }
    }

    func testUnifiedWallGenerationPersistsAfterFilesSearchSubmitAndReturn() {
        let app = launch()
        let before = verifiedUnifiedGeneration(app)
        select("native-ios-tab-files", in: app)
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
        checkFilesHome(app)
        select("native-ios-tab-gallery", in: app)
        assertUnchangedUnifiedWall(app, before: before, label: "Files Search return")
    }

    func testUnifiedWallGenerationPersistsAfterDeniedCloudChildAndReturn() {
        let app = launch(syntheticOwner: true)
        let before = verifiedUnifiedGeneration(app)
        select("native-ios-tab-files", in: app)
        select("native-ios-files-open-root-location", in: app)
        XCTAssertTrue(target("native-ios-files-error-page", in: app)
            .waitForExistence(timeout: 15),
            "Denied cloud child must render native error instead of a private list")
        select("native-ios-files-error-return", in: app)
        checkFilesHome(app)
        select("native-ios-tab-gallery", in: app)
        assertUnchangedUnifiedWall(app, before: before, label: "Denied Cloud return")
    }

}
