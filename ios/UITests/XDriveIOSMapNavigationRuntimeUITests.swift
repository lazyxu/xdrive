import XCTest

/// Exercises the real native Dashboard → PhotoKit MapKit → place sheet →
/// Viewer route in the same simulator as the existing Files/Gallery smoke.
/// CI pre-imports two tiny, synthetic EXIF-GPS JPEGs (no Owner token and
/// no production photo library). This is NOT a mocked MapKit screen.
final class XDriveIOSMapNavigationRuntimeUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        // Real iOS 18.5 XCTest default interruption handling automatically
        // taps "Don’t Allow" on this application's first Photo Library prompt.
        // Install a narrowly scoped Full Access monitor BEFORE app.launch.
        // A Limited, Add-Only or unknown choice must never be accepted.
        addUIInterruptionMonitor(withDescription: "xDrive genuine Photos Full Access") {
            [weak self] alert in
            self?.acceptPhotoLibraryFullAccess(in: alert, stage: "interruption") ?? false
        }
    }
    override func tearDownWithError() throws {
        XCUIDevice.shared.orientation = .portrait
    }

    private func element(_ id: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    /// Only Apple's genuine system Photo Library permission alert may be
    /// handled here. This is not a TCC grant, fake readWrite value or shortcut
    /// to mounting MapKit: the target app must still report .authorized.
    private func acceptPhotoLibraryFullAccess(
        in alert: XCUIElement, stage: String
    ) -> Bool {
        let title = alert.label
        guard title.localizedCaseInsensitiveContains("Photo Library") ||
              title.contains("照片") || title.contains("相簿") else {
            return false
        }
        let accepted = [
            "Allow Full Access", "Full Access",
            "Allow Access to All Photos", "Allow Access to All Photos and Videos",
            "允许完全访问", "允许访问所有照片", "允许访问全部照片",
            "完全访问", "完整访问", "所有照片"
        ]
        for label in accepted {
            let option = alert.buttons[label].firstMatch
            if option.exists && option.isHittable {
                print("MAP_PHOTOS_INITIAL_FULL_ACCESS_PROMPT stage=\(stage) option=\(label)")
                option.tap()
                return true
            }
        }
        print("MAP_PHOTOS_UNKNOWN_FIRST_PERMISSION_PROMPT stage=\(stage) AX tree:\n\(alert.debugDescription)")
        return false
    }

    private func handleInitialPhotoLibraryPromptIfPresent() {
        // Do this immediately after launch, before the first Dashboard tap:
        // otherwise XCTest's fallback interruption handler can deny Photos
        // while merely opening the launcher. This path clicks real UI only.
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let prompt = springboard.alerts.firstMatch
        if prompt.waitForExistence(timeout: 5) {
            let title = prompt.label
            if title.localizedCaseInsensitiveContains("Photo Library") ||
               title.contains("照片") || title.contains("相簿") {
                XCTAssertTrue(
                    acceptPhotoLibraryFullAccess(in: prompt, stage: "pre-launcher"),
                    "Real initial Photos prompt must permit explicit Full Access"
                )
            }
        }
    }

    /// Keep the exact real AX tree and a screenshot on navigation failure.
    /// Never pass a test merely because a custom smoke shortcut is available.
    private func diagnose(_ message: String, in app: XCUIApplication) {
        print("MAP_ROUTE_DIAGNOSTIC: \(message), app state=\(app.state.rawValue)")
        print("MAP_ROUTE_DIAGNOSTIC AX tree:\n\(app.debugDescription)")
        let capture = XCTAttachment(screenshot: app.screenshot())
        capture.name = "native-map-route-failure"
        capture.lifetime = .keepAlways
        add(capture)
    }

    /// Do not mistake an app in Settings > Apps search results for its
    /// per-app settings detail. The previous test tapped the selected search
    /// result, stayed under "Apps", and then opened a *different* Photos
    /// permission row. Only this exact xDrive detail page can authorize us.
    private func xDriveSettingsDetailVisible(_ settings: XCUIApplication) -> Bool {
        let detail = settings.navigationBars.matching(
            NSPredicate(
                format: "identifier ==[c] %@ OR label ==[c] %@",
                "xDrive", "xDrive"
            )
        ).firstMatch
        return detail.exists && !settings.searchFields.firstMatch.exists
    }

    private func openRealXDriveSettingsPage(
        _ settings: XCUIApplication, in app: XCUIApplication
    ) {
        if xDriveSettingsDetailVisible(settings) { return }

        // Use the exact installed bundle, never a generic xDrive label or
        // similarly named UITest runner. The 18.5 accessibility tree exposes
        // a separate navigation-uitests.xctrunner alongside the real app.
        let appEntry = settings.buttons
            .matching(identifier: "com.lazyxu.xdrive.ios").firstMatch
        let appSearch = settings.searchFields.firstMatch
        if appSearch.exists {
            appSearch.tap()
            let oldQuery = appSearch.value as? String ?? ""
            if !oldQuery.localizedCaseInsensitiveContains("xdrive") {
                appSearch.typeText("xDrive")
            }
            if !appEntry.waitForExistence(timeout: 12) {
                print("MAP_PHOTOS_APPS_SEARCH AX tree:\n\(settings.debugDescription)")
                diagnose("xDrive exact bundle missing from Settings Apps search", in: app)
            }
            XCTAssertTrue(appEntry.exists,
                          "Must navigate to real xDrive app Settings")
            appEntry.tap()
            // The observed search-result AX item remained Selected on the
            // Apps page after one tap. A second tap is safe only on the same
            // exact bundle row, never a fuzzy-matched app or system Photos.
            if !xDriveSettingsDetailVisible(settings),
               appEntry.exists, appEntry.isHittable {
                appEntry.tap()
            }
        }

        if !xDriveSettingsDetailVisible(settings) {
            // If the search was only selecting/filtering the Apps list,
            // cancel it and follow the real installed-app list. The list is
            // virtualized: scroll until the exact bundle row is hittable.
            let cancel = settings.buttons["Cancel"].firstMatch
            if cancel.exists { cancel.tap() }
            let list = settings.collectionViews.firstMatch
            for _ in 0..<16 {
                if xDriveSettingsDetailVisible(settings) { break }
                if appEntry.exists && appEntry.isHittable {
                    appEntry.tap()
                    if xDriveSettingsDetailVisible(settings) { break }
                }
                if !list.exists { break }
                list.swipeUp()
            }
        }

        if !xDriveSettingsDetailVisible(settings) {
            print("MAP_PHOTOS_APP_DETAIL AX tree:\n\(settings.debugDescription)")
            let capture = XCTAttachment(screenshot: settings.screenshot())
            capture.name = "native-ios-app-settings-page-missing"
            capture.lifetime = .keepAlways
            add(capture)
            diagnose("Settings is not inside xDrive's own app page", in: app)
        }
        XCTAssertTrue(xDriveSettingsDetailVisible(settings),
                      "Never select Photos outside the real xDrive app Settings")
    }

    private func recordActualPhotoKitReadback(
        _ app: XCUIApplication, stage: String
    ) {
        // The app, not the separate XCTest Runner, must report its effective
        // .readWrite status. Only present in an actual denied/limited MapKit
        // screen of the CI-only Debug smoke target.
        let readback = element("native-ios-map-photo-auth-readback", in: app)
        if readback.exists {
            print("MAP_PHOTOS_TARGET_AUTH_STAGE \(stage) \(readback.label)")
        } else {
            print("MAP_PHOTOS_TARGET_AUTH_STAGE \(stage) readback-not-mounted")
        }
    }

    /// Exercise an actual user-level Settings decision if the simulator
    /// reports Photos denied despite simctl/XCTest authorization resets.
    /// The production map remains fail closed for denied or Limited access.
    private func authorizeFullPhotosInSettings(_ app: XCUIApplication) {
        let openSettings = element("native-ios-map-open-photo-settings", in: app)
        XCTAssertTrue(openSettings.waitForExistence(timeout: 12),
                      "Denied PhotoKit state must offer real Settings recovery")
        openSettings.tap()
        let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
        if !settings.wait(for: .runningForeground, timeout: 20) {
            diagnose("App Photos settings did not open", in: app)
        }
        XCTAssertEqual(settings.state, .runningForeground,
                       "Expected Apple's native Settings app")

        // In iOS 18.5 UIApplication.openSettingsURLString sometimes opens
        // Settings > Apps rather than this app's detail. Prove the actual
        // xDrive settings page *before* querying for a Photos permission row.
        openRealXDriveSettingsPage(settings, in: app)

        let photosLabel = NSPredicate(
            format: "label BEGINSWITH[c] %@ OR label BEGINSWITH %@",
            "Photos", "照片"
        )
        var photos = settings.cells.matching(photosLabel).firstMatch
        if !photos.waitForExistence(timeout: 12) {
            photos = settings.buttons.matching(photosLabel).firstMatch
        }
        if !photos.exists {
            photos = settings.staticTexts.matching(photosLabel).firstMatch
        }
        if !photos.exists {
            print("MAP_PHOTOS_SETTINGS AX tree:\n\(settings.debugDescription)")
            diagnose("App-specific Photos setting missing", in: app)
        }
        XCTAssertTrue(photos.exists, "Cannot reach real Photos permissions")
        photos.tap()

        // A standalone Photos application page can also display "Full Access".
        // It must be the Photos child of the verified xDrive settings detail,
        // not a matching accessibility string elsewhere in the Apps list.
        let photosPage = settings.navigationBars.matching(
            NSPredicate(
                format: "identifier ==[c] %@ OR label ==[c] %@ OR label ==[c] %@",
                "Photos", "Photos", "照片"
            )
        ).firstMatch
        if !photosPage.waitForExistence(timeout: 8) {
            print("MAP_PHOTOS_CHILD_PAGE AX tree:\n\(settings.debugDescription)")
            diagnose("xDrive Photos child permission page did not open", in: app)
        }
        XCTAssertTrue(photosPage.exists,
                      "Do not choose a Full Access option on an unrelated page")

        let fullLabel = NSPredicate(
            format: "label CONTAINS[c] %@ OR label CONTAINS %@ OR label CONTAINS %@ OR label CONTAINS %@",
            "Full Access", "完全访问", "完整访问", "所有照片"
        )
        var full = settings.cells.matching(fullLabel).firstMatch
        if !full.waitForExistence(timeout: 12) {
            full = settings.buttons.matching(fullLabel).firstMatch
        }
        if !full.exists {
            full = settings.staticTexts.matching(fullLabel).firstMatch
        }
        if !full.exists {
            print("MAP_PHOTOS_SETTINGS AX tree:\n\(settings.debugDescription)")
            diagnose("Full Access not available in system Photos Settings", in: app)
        }
        XCTAssertTrue(full.exists, "Must select real Full Access, not Limited")
        full.tap()
        // The previous candidates could tap a "Full Access" cell while the
        // real xDrive still reported denial. Record the system selection
        // state instead of interpreting a successful tap as authorization.
        print("MAP_PHOTOS_FULL_ACCESS_ROW_SELECTED \(full.isSelected)")
        print("MAP_PHOTOS_FULL_ACCESS_POST_TAP AX tree:\n\(settings.debugDescription)")
        let settingsProof = XCTAttachment(screenshot: settings.screenshot())
        settingsProof.name = "native-ios-real-photos-full-access-after-tap"
        settingsProof.lifetime = .keepAlways
        add(settingsProof)

        // iOS may require a further consent acknowledgement; do not tap
        // an arbitrary alert choice or accidentally grant Limited access.
        let confirm = settings.alerts.firstMatch
        if confirm.waitForExistence(timeout: 2) {
            let labels = [
                "Allow Full Access", "Allow Access to All Photos",
                "允许完全访问", "允许访问所有照片", "允许访问全部照片"
            ]
            let allow = labels.map { confirm.buttons[$0].firstMatch }
                .first { $0.exists }
            if allow == nil {
                print("MAP_PHOTOS_SETTINGS_CONFIRM AX tree:\n\(settings.debugDescription)")
                diagnose("Full Access settings confirmation was not recognized", in: app)
            }
            XCTAssertNotNil(allow, "Only explicit Full Access consent is allowed")
            allow?.tap()
        }
        app.activate()
        XCTAssertEqual(app.state, .runningForeground)
        recordActualPhotoKitReadback(app, stage: "after-settings")
        if !element("native-ios-full-library-gps-map", in: app)
            .waitForExistence(timeout: 35) {
            // Diagnose whether this is an unrefreshed SwiftUI map or a real
            // persistent TCC denial. A cold restart is diagnostic only:
            // *never* pass an immediate Settings-return test on its basis.
            diagnose("MapKit absent immediately after Settings Full Access", in: app)
            let liveBlocked = element("native-ios-map-open-photo-settings", in: app).exists
            app.terminate()
            app.launch()
            recordActualPhotoKitReadback(app, stage: "after-restart-before-map")
            let launcher = element("native-ios-tab-launcher", in: app)
            let launcherAvailable = launcher.waitForExistence(timeout: 15)
            if launcherAvailable { launcher.tap() }
            let mapEntry = element("native-ios-launcher-map", in: app)
            let entryAvailable = mapEntry.waitForExistence(timeout: 15)
            if entryAvailable { mapEntry.tap() }
            let afterRestart = element("native-ios-full-library-gps-map", in: app)
                .waitForExistence(timeout: 35)
            let restartBlocked = element("native-ios-map-open-photo-settings", in: app).exists
            recordActualPhotoKitReadback(app, stage: "after-restart-map")
            print("MAP_PHOTOS_COLD_START_PROBE before_blocked=\(liveBlocked) map=\(afterRestart) after_blocked=\(restartBlocked)")
            diagnose(afterRestart
                ? "PhotoKit Full Access worked only after cold restart: fix immediate foreground refresh"
                : "PhotoKit Full Access still not admitted after cold restart: inspect real TCC/readWrite decision",
                in: app)
            XCTFail("Full Access must mount real MapKit immediately after Settings return, without restart")
        }
    }

    private func openLocalMap() -> XCUIApplication {
        openLocalMap(appearance: nil)
    }

    private func openLocalMap(appearance: String?) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-xdrive-ui-navigation-smoke"]
        if let appearance {
            app.launchArguments += ["-uiuserinterfacestyle", appearance]
        }
        // The candidate Simulator job resets Photos once for the installed
        // target app before UI tests. Do NOT reset again for every testcase:
        // a later reset can invalidate the system Full Access selected by a
        // previous test. Only the target's live PhotoKit readback is authority.
        app.launch()
        XCTAssertEqual(app.state, .runningForeground)
        handleInitialPhotoLibraryPromptIfPresent()

        // The native Dashboard's "全部" launcher has a stable, explicit
        // "地图" route and does not depend on the Dynamic slot's conditional
        // redirect, nor on an earlier authenticated Server Owner.
        let launcher = element("native-ios-tab-launcher", in: app)
        if !launcher.waitForExistence(timeout: 15) {
            diagnose("Native launcher tab missing", in: app)
        }
        XCTAssertTrue(launcher.exists, "Native launcher tab must be visible")
        launcher.tap()
        let mapEntry = element("native-ios-launcher-map", in: app)
        if !mapEntry.waitForExistence(timeout: 15) {
            diagnose("Real launcher map route missing", in: app)
        }
        XCTAssertTrue(mapEntry.exists, "Real launcher must expose native map")
        if !mapEntry.isHittable { app.swipeUp() }
        XCTAssertTrue(mapEntry.isHittable, "Native map launcher was not hittable")
        mapEntry.tap()

        // This toolbar exists before PhotoKit authorization and makes the
        // actual Map screen distinguishable from a Gallery/Dynamic fallback.
        let source = element("native-ios-map-source-selector", in: app)
        if !source.waitForExistence(timeout: 20) {
            diagnose("Native map source toolbar absent after launcher tap", in: app)
        }
        XCTAssertTrue(source.exists, "Launcher did not navigate to native MapKit")

        let map = element("native-ios-full-library-gps-map", in: app)
        let accessBlocked = element("native-ios-map-open-photo-settings", in: app)
        let request = app.buttons["允许查看本机照片"].firstMatch
        if !map.waitForExistence(timeout: 2) {
            if accessBlocked.exists {
                // This is the *actual* iOS denial observed on three candidate
                // runs. Recover through Settings UI, not a fake permission
                // grant or a special debug-only PhotoKit reader.
                authorizeFullPhotosInSettings(app)
            } else {
                if !request.waitForExistence(timeout: 15) {
                    diagnose("Map neither authorized nor requesting real Photos access", in: app)
                }
                XCTAssertTrue(request.exists, "Native map must request .readWrite access")
                request.tap()
                let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
                let springboardAlert = springboard.alerts.firstMatch
                let appAlert = app.alerts.firstMatch
                let alert = springboardAlert.waitForExistence(timeout: 15)
                    ? springboardAlert : appAlert
                if alert.exists {
                    let labels = [
                        "Allow Full Access", "Allow Access to All Photos",
                        "Allow Access to All Photos and Videos",
                        "允许完全访问", "允许访问所有照片", "允许访问全部照片"
                    ]
                    let full = labels.map { alert.buttons[$0].firstMatch }
                        .first { $0.exists }
                    if full == nil {
                        print("MAP_PHOTOS_PROMPT AX tree:\n\(springboard.debugDescription)")
                        diagnose("No Full Access button in real system prompt", in: app)
                    }
                    XCTAssertNotNil(full, "Never choose Limited or Add-Only Photos")
                    full?.tap()
                } else if !map.waitForExistence(timeout: 8) && !accessBlocked.exists {
                    diagnose("No system Photos prompt or authorized MapKit", in: app)
                    XCTFail("Photos .readWrite request did not obtain an access decision")
                }
                if accessBlocked.exists {
                    // A system prompt may explicitly deny Photos, or the
                    // Simulator may retain a previous denial. The Settings
                    // path exercises the same UI a user must actually use.
                    authorizeFullPhotosInSettings(app)
                }
            }
        }
        if accessBlocked.exists {
            diagnose("User-level Photos authorization is denied or Limited", in: app)
        }
        XCTAssertFalse(accessBlocked.exists,
                       "Expected actual user-granted Full Access; still denied or Limited")
        if !map.waitForExistence(timeout: 65) {
            diagnose("MapKit absent after real PhotoKit Full Access route", in: app)
        }
        XCTAssertTrue(map.exists, "Real native MKMapView did not mount")
        return app
    }

    func testMapCameraLayoutAndUnverifiedGestureNeverClosesTheApp() {
        let app = openLocalMap()
        let map = element("native-ios-full-library-gps-map", in: app)
        XCTAssertTrue(map.exists)
        XCTAssertTrue(element("native-ios-local-map-basemap", in: app).exists)
        XCTAssertTrue(element("native-ios-local-map-capture-menu", in: app).exists)
        // UI date → month selection exists on the real MapKit route, and
        // cancelling it does not destroy the previously verified photo scope.
        element("native-ios-local-map-capture-menu", in: app).tap()
        // SwiftUI Menu children are menuItems on some iOS 18.5 builds,
        // not XCUIElementTypeButton. Query the real app's stable item ID,
        // then its label across AX types; never pretend a missing menu passed.
        let byID = element("native-ios-local-map-select-date", in: app)
        let byLabel = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", "按指定日期")).firstMatch
        if !byID.waitForExistence(timeout: 6) &&
            !byLabel.waitForExistence(timeout: 6) {
            print("MAP_DATE_MENU_MISSING AX tree:\n\(app.debugDescription)")
            diagnose("MapKit actual capture-date menu item is not accessible", in: app)
        }
        let chooseDate = byID.exists ? byID : byLabel
        XCTAssertTrue(chooseDate.exists, "Real native map date selection is absent")
        chooseDate.tap()
        XCTAssertTrue(element("native-ios-map-selected-month", in: app)
            .waitForExistence(timeout: 10))
        app.buttons["取消"].firstMatch.tap()
        XCTAssertTrue(map.exists)

        // Actual MapKit pan and pinch; pin authority is re-evaluated on every
        // camera movement. Changing orientation must not recreate the route.
        map.swipeLeft()
        map.pinch(withScale: 1.4, velocity: 1.0)
        XCTAssertEqual(app.state, .runningForeground)
        XCTAssertTrue(map.exists)
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(map.waitForExistence(timeout: 15))
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "native-mapkit-pan-landscape"
        shot.lifetime = .keepAlways
        add(shot)
        XCUIDevice.shared.orientation = .portrait

        // Regression: the local map's Done action must work without any
        // authenticated Server Owner and preserve the Photos Gallery tab.
        let close = element("native-ios-map-dismiss", in: app)
        XCTAssertTrue(close.waitForExistence(timeout: 15))
        close.tap()
        XCTAssertTrue(element("native-ios-tab-gallery", in: app)
            .waitForExistence(timeout: 15))
        XCTAssertEqual(app.state, .runningForeground)
    }

    // The fixture pair must produce an EXACT two-member location Cell
    // regardless of extra stock GPS assets in iOS 18.5's real Photos library.
    // Real global GPS count and exact fixture membership are separate proofs.
    func testAFirstTwoRealGPSPhotosOpenPlaceWallViewerAndReturnToSameMap() {
        let app = openLocalMap()
        let verified = element("native-ios-map-verified-count", in: app)
        if !verified.waitForExistence(timeout: 90) {
            diagnose("Two imported GPS assets not verified by PhotoKit", in: app)
        }
        XCTAssertTrue(verified.exists,
                      "Synthetic GPS images were not indexed by real PhotoKit")
        // Newly erased iOS 18.5 may still contain OS-supplied GPS photos.
        // The overall count must report the REAL library, not pretend the
        // two fixture assets are the only photos. Their exact same-location
        // membership is separately verified by the two-member marker below.
        print("MAP_REAL_PHOTOKIT_GLOBAL_GPS_COUNT \(verified.label)")
        let countText = verified.label.split(separator: " ").first.map(String.init)
        let count = countText.flatMap(Int.init)
        XCTAssertNotNil(count, "Real PhotoKit GPS count must be numeric")
        XCTAssertGreaterThanOrEqual(count ?? 0, 2,
            "The two imported real EXIF GPS photos must be present")

        // The two real assets share one signed-in-memory spatial cell.
        // Tapping the annotation must open the existing medium/large native
        // place wall (not an invented single-photo or date-only Viewer).
        let marker = app.descendants(matching: .any)
            .matching(NSPredicate(
                format: "label CONTAINS %@", "已扫描图库区域有2张带定位照片"))
            .firstMatch
        XCTAssertTrue(marker.waitForExistence(timeout: 30),
                      "Real GPS MapKit 2-photo cover is missing")
        print("MAP_FIXTURE_CELL_EXACT_TWO \(marker.label)")
        let coverShot = XCTAttachment(screenshot: app.screenshot())
        coverShot.name = "native-mapkit-exact-two-photo-marker"
        coverShot.lifetime = .keepAlways
        add(coverShot)
        // MapKit's real MKAnnotation accessibility button may reject the
        // generic AX scroll-to-visible action although its 68pt frame is
        // already within the visible map. Tap its actual physical center
        // through XCTest coordinates, never a synthetic route or fake Cell.
        let canvas = element("native-ios-full-library-gps-map", in: app)
        let frame = marker.frame
        XCTAssertFalse(frame.isEmpty, "Exact-two MapKit marker must have a real frame")
        XCTAssertTrue(frame.intersects(canvas.frame),
                      "Real GPS marker must be inside the visible map canvas")
        marker.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let firstTile = element("native-ios-map-photo-wall-tile", in: app)
        XCTAssertTrue(firstTile.waitForExistence(timeout: 60),
                      "Map place sheet did not load the real 48-item PhotoKit wall")
        let sheetShot = XCTAttachment(screenshot: app.screenshot())
        sheetShot.name = "native-mapkit-place-sheet-frame-baseline"
        sheetShot.lifetime = .keepAlways
        add(sheetShot)
        firstTile.tap()
        let back = element("native-ios-local-viewer-back", in: app)
        XCTAssertTrue(back.waitForExistence(timeout: 30),
                      "Native original photo Viewer did not open")
        back.tap()
        XCTAssertTrue(firstTile.waitForExistence(timeout: 30),
                      "Viewer returned without the original place photo wall")
        let dismiss = element("native-ios-map-place-dismiss", in: app)
        XCTAssertTrue(dismiss.waitForExistence(timeout: 15))
        dismiss.tap()
        XCTAssertTrue(element("native-ios-full-library-gps-map", in: app)
            .waitForExistence(timeout: 20))
        XCTAssertEqual(app.state, .runningForeground)
    }

    /// Real Simulator screenshot evidence for the shared presentation, using
    /// the SAME imported GPS fixture as the existing Owner-free MapKit journey.
    /// Attachments are evidence to compare, not fabricated pixel-perfect pass.
    func testGalleryAndPlaceWallShareDateControlsAndCaptureBothOrientations() {
        let app = openLocalMap()
        let marker = app.descendants(matching: .any)
            .matching(NSPredicate(
                format: "label CONTAINS %@", "已扫描图库区域有2张带定位照片"))
            .firstMatch
        XCTAssertTrue(marker.waitForExistence(timeout: 30),
                      "Real two-photo PhotoKit fixture required for visual parity")
        marker.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()

        let tile = element("native-ios-map-photo-wall-tile", in: app)
        let scale = element("native-ios-shared-photo-time-scale", in: app)
        XCTAssertTrue(tile.waitForExistence(timeout: 45))
        XCTAssertTrue(scale.waitForExistence(timeout: 15))
        let placeScaleHeight = scale.frame.height
        XCTAssertGreaterThan(placeScaleHeight, 0)

        func attach(_ stage: String) {
            let capture = XCTAttachment(screenshot: app.screenshot())
            capture.name = "gallery-places-parity-" + stage
            capture.lifetime = .keepAlways
            add(capture)
        }

        attach("place-portrait")
        for option in ["年", "月", "日", "全部"] {
            let segment = app.buttons[option].firstMatch
            XCTAssertTrue(segment.waitForExistence(timeout: 10),
                          "Shared date-scale segment absent: " + option)
            segment.tap()
            XCTAssertTrue(tile.waitForExistence(timeout: 15))
            attach("place-" + option)
        }
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        XCTAssertTrue(tile.waitForExistence(timeout: 15))
        XCTAssertGreaterThan(tile.frame.width, 0)
        attach("place-landscape")

        let done = element("native-ios-map-place-dismiss", in: app)
        XCTAssertTrue(done.waitForExistence(timeout: 15))
        done.tap()
        let mapClose = element("native-ios-map-dismiss", in: app)
        XCTAssertTrue(mapClose.waitForExistence(timeout: 15))
        mapClose.tap()
        let gallery = element("native-ios-tab-gallery", in: app)
        XCTAssertTrue(gallery.waitForExistence(timeout: 15))
        gallery.tap()
        // Compare the actual same PhotoKit library, not a cloud placeholder.
        let sourceMenu = element("native-ios-gallery-source-menu", in: app)
        XCTAssertTrue(sourceMenu.waitForExistence(timeout: 15))
        sourceMenu.tap()
        let localSource = app.buttons["本机照片"].firstMatch
        XCTAssertTrue(localSource.waitForExistence(timeout: 10))
        localSource.tap()
        XCTAssertTrue(app.navigationBars["本机照片"].firstMatch
            .waitForExistence(timeout: 20))
        let galleryScale = element("native-ios-shared-photo-time-scale", in: app)
        if galleryScale.waitForExistence(timeout: 20) {
            XCTAssertLessThan(abs(galleryScale.frame.height - placeScaleHeight), 3,
                              "Shared segmented date control height diverged")
        }
        attach("gallery-landscape")
        XCUIDevice.shared.orientation = .portrait
        attach("gallery-portrait")
        XCTAssertEqual(app.state, .runningForeground)
    }

    // Dark appearance on real PhotoKit GPS fixture; this attachment alone
    // does not claim a physical iPhone or pixel-level parity check has passed.
    func testPhotoKitPlaceWallDarkAppearanceSnapshotEvidence() {
        let app = openLocalMap(appearance: "dark")
        let marker = app.descendants(matching: .any)
            .matching(NSPredicate(
                format: "label CONTAINS %@", "已扫描图库区域有2张带定位照片"))
            .firstMatch
        XCTAssertTrue(marker.waitForExistence(timeout: 30))
        marker.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(element("native-ios-map-photo-wall-tile", in: app)
            .waitForExistence(timeout: 45))
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "gallery-places-parity-place-dark"
        shot.lifetime = .keepAlways
        add(shot)
        XCTAssertEqual(app.state, .runningForeground)
    }
}
