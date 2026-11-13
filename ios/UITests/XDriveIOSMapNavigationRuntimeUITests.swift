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
        // iOS may terminate the target while Photos TCC is changed in
        // Settings. An unavailable app cannot provide an XCTest screenshot;
        // keep the diagnostic and let the real crash-audit job decide whether
        // there was a process crash instead of masking the original failure.
        if app.state == .runningForeground {
            let capture = XCTAttachment(screenshot: app.screenshot())
            capture.name = "native-map-route-failure"
            capture.lifetime = .keepAlways
            add(capture)
        } else {
            print("MAP_ROUTE_DIAGNOSTIC_TARGET_NOT_FOREGROUND state=\(app.state.rawValue)")
        }
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

    /// Apple's Photos TCC transition may *terminate* an app that was
    /// backgrounded in Settings. This is distinct from a test-driven cold
    /// restart of a still-running app. Reopen the real Dashboard/MapKit route
    /// only for the observed system-stopped target, preserving the Full-only
    /// PhotoKit admission and post-change Viewer/pin assertions.
    @discardableResult
    private func resumeMapAfterSystemPhotosChange(
        _ app: XCUIApplication, stage: String
    ) -> Bool {
        if app.state != .notRunning {
            app.activate()
            XCTAssertEqual(app.state, .runningForeground,
                           "The still-running app must resume immediately from Settings")
            return false
        }

        print("MAP_PHOTOS_TCC_TERMINATED_APP stage=\(stage) action=relaunch-real-target")
        app.launch()
        XCTAssertEqual(app.state, .runningForeground,
                       "System-stopped target must relaunch before PhotoKit is rechecked")
        handleInitialPhotoLibraryPromptIfPresent()
        let launcher = element("native-ios-tab-launcher", in: app)
        XCTAssertTrue(launcher.waitForExistence(timeout: 20),
                      "Relaunched app must expose its real native launcher")
        launcher.tap()
        let entry = element("native-ios-launcher-map", in: app)
        XCTAssertTrue(entry.waitForExistence(timeout: 20),
                      "Relaunched app must reopen MapKit through the genuine launcher")
        entry.tap()
        XCTAssertTrue(element("native-ios-map-source-selector", in: app)
            .waitForExistence(timeout: 20),
            "Relaunched app must mount the genuine source-protected MapKit route")
        return true
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
        // Return to the existing process whenever iOS keeps it alive. If
        // iOS itself ended the process as Photos TCC changed, only then
        // relaunch via the real app route; never hide a live-app refresh bug.
        var systemRelaunched = resumeMapAfterSystemPhotosChange(
            app, stage: "after-full-access-selection"
        )
        // iOS 18.5 can still display a second system-wide consent prompt.
        // Choose the real Full option, not Limited, and independently read
        // back the target app's PHAuthorizationStatus afterward.
        handleInitialPhotoLibraryPromptIfPresent()
        if app.state == .notRunning {
            systemRelaunched = resumeMapAfterSystemPhotosChange(
                app, stage: "after-full-access-system-prompt"
            ) || systemRelaunched
        }
        XCTAssertEqual(app.state, .runningForeground)
        print("MAP_PHOTOS_FULL_ACCESS_REENTRY os_relaunch=\(systemRelaunched)")
        recordActualPhotoKitReadback(app, stage: "after-settings")
        if !element("native-ios-full-library-gps-map", in: app)
            .waitForExistence(timeout: 35) {
            // Diagnose whether this is an unrefreshed SwiftUI map or a real
            // persistent TCC denial. A deliberate cold restart of a *live*
            // app remains diagnostic only and cannot pass this assertion.
            // The observed OS-terminated process was explicitly distinguished
            // and relaunched above, so we also require a fresh real MapKit.
            diagnose("MapKit absent immediately after Settings Full Access", in: app)
            let liveBlocked = element("native-ios-map-open-photo-settings", in: app).exists
            app.terminate()
            app.launch()
            // Diagnostic only. No restart may be accepted as a substitute
            // for immediate Settings-return reauthorization.
            handleInitialPhotoLibraryPromptIfPresent()
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
            XCTFail(systemRelaunched
                ? "After OS-terminated TCC process relaunch, Full Access must mount genuine MapKit"
                : "A still-running app must mount real MapKit immediately on Settings return")
        }
    }

    private func openLocalMap(performance: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-xdrive-ui-navigation-smoke"]
        if performance {
            app.launchArguments.append("-xdrive-map-100k-perf")
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
    /// A second real PHFetchResult enumeration in the *target application*
    /// must independently agree with the streaming MapKit grid count.
    /// This uses the installed Simulator's actual GPS assets, not a
    /// hard-coded "two photos globally" assumption or mock permission.
    func testP0RealPhotoKitIndependentGPSCountMatchesCurrentMap() {
        let app = openLocalMap()
        // Empty baseline PhotoKit libraries legitimately have no count row:
        // the independent audit action appears after the complete scan even
        // when the GPS count is zero. Seeded runs will have verified counts.
        let trigger = element("native-ios-map-p0-audit-trigger", in: app)
        XCTAssertTrue(trigger.waitForExistence(timeout: 120),
                      "Independent GPS audit must be available only in the real Debug test route")
        trigger.tap()
        let independentlyVerified = element("native-ios-map-p0-independent-count", in: app)
        if !independentlyVerified.waitForExistence(timeout: 150) {
            diagnose("Second real PhotoKit enumeration did not finish", in: app)
        }
        XCTAssertTrue(independentlyVerified.exists)
        let fields = independentlyVerified.label.split(separator: " ")
        XCTAssertGreaterThanOrEqual(fields.count, 7,
            "Expected independent actual PhotoKit GPS and MapKit count readbacks")
        let real = fields.count > 2 ? Int(fields[2]) : nil
        let indexed = fields.count > 5 ? Int(fields[5]) : nil
        XCTAssertNotNil(real)
        XCTAssertNotNil(indexed)
        XCTAssertEqual(real, indexed, "Real PHAsset.location enumeration disagrees with indexed MapKit count")
        XCTAssertFalse(independentlyVerified.label.contains("不一致"))
        XCTAssertTrue(independentlyVerified.label.contains("一致"))
        XCTAssertEqual(app.state, .runningForeground)
        print("MAP_P0_REAL_PHOTOKIT_INDEPENDENT_COUNT \(independentlyVerified.label)")
    }

    /// Deliberately exercises the actual MapKit annotation, medium/large
    /// native place sheet and real Viewer multiple times. This does not use
    /// a fabricated direct Viewer route; screenshot attachments are
    /// diagnostic samples, not a 60/120 Hz frame-rate certificate.
    func testP0RapidPlaceWallViewerReturnKeepsMapAndGalleryMounted() {
        let app = openLocalMap()
        let map = element("native-ios-full-library-gps-map", in: app)
        XCTAssertTrue(element("native-ios-map-verified-count", in: app)
            .waitForExistence(timeout: 90))
        for pass in 0..<3 {
            let marker = app.descendants(matching: .any)
                .matching(NSPredicate(
                    format: "label CONTAINS %@", "已扫描图库区域有2张带定位照片"))
                .firstMatch
            XCTAssertTrue(marker.waitForExistence(timeout: 25),
                          "Iteration \(pass) lost the exact seeded two-photo location")
            XCTAssertTrue(marker.isEnabled, "A fresh verified marker must be selectable")
            XCTAssertFalse(marker.frame.isEmpty)
            XCTAssertTrue(marker.frame.intersects(map.frame))
            marker.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            let tile = element("native-ios-map-photo-wall-tile", in: app)
            XCTAssertTrue(tile.waitForExistence(timeout: 45),
                          "Iteration \(pass) failed to show real place photos")
            let sheetShot = XCTAttachment(screenshot: app.screenshot())
            sheetShot.name = "p0-map-place-sheet-\(pass)"
            sheetShot.lifetime = .keepAlways
            add(sheetShot)
            tile.tap()
            let back = element("native-ios-local-viewer-back", in: app)
            XCTAssertTrue(back.waitForExistence(timeout: 30),
                          "Iteration \(pass) failed Viewer route")
            back.tap()
            XCTAssertTrue(tile.waitForExistence(timeout: 25),
                          "Iteration \(pass) did not return to the same place wall")
            let closeSheet = element("native-ios-map-place-dismiss", in: app)
            XCTAssertTrue(closeSheet.waitForExistence(timeout: 15))
            closeSheet.tap()
            XCTAssertTrue(map.waitForExistence(timeout: 25),
                          "Iteration \(pass) detached the native map canvas")
            XCTAssertFalse(element("native-ios-local-viewer-back", in: app).exists,
                           "Stale Viewer must not remain after returning to MapKit")
            let returnShot = XCTAttachment(screenshot: app.screenshot())
            returnShot.name = "p0-map-after-viewer-return-\(pass)"
            returnShot.lifetime = .keepAlways
            add(returnShot)
            XCTAssertEqual(app.state, .runningForeground)
        }
        // Rapid camera changes must revoke old-cell AX activation at the
        // gesture boundary, then either show a recheck or verified new count.
        map.pinch(withScale: 2.5, velocity: 1.0)
        map.swipeRight()
        map.pinch(withScale: 1.5, velocity: 1.0)
        XCTAssertTrue(map.waitForExistence(timeout: 25))
        XCTAssertFalse(element("native-ios-map-photo-auth-readback", in: app).exists,
                       "No denied/Limited stale authorization UI should appear")
        let done = element("native-ios-map-dismiss", in: app)
        XCTAssertTrue(done.waitForExistence(timeout: 15))
        done.tap()
        XCTAssertTrue(element("native-ios-tab-gallery", in: app)
            .waitForExistence(timeout: 15))
        XCTAssertEqual(app.state, .runningForeground)
    }

    /// Run ONLY after the dedicated workflow explicitly executes
    /// simctl privacy revoke photos com.lazyxu.xdrive.ios.
    /// The primary Full-Access MapKit shard skips this method. The test
    /// checks the target's real denied UI, then uses real Settings to
    /// restore Full Access. No fake PhotoKit authorization or Owner token.
    func testZP0ExternallyRevokedPhotosRejectOldMapAndRecover() {
        let app = XCUIApplication()
        app.launchArguments = ["-xdrive-ui-navigation-smoke"]
        app.launch()
        XCTAssertEqual(app.state, .runningForeground)
        let launcher = element("native-ios-tab-launcher", in: app)
        XCTAssertTrue(launcher.waitForExistence(timeout: 15))
        launcher.tap()
        let route = element("native-ios-launcher-map", in: app)
        XCTAssertTrue(route.waitForExistence(timeout: 15))
        route.tap()
        XCTAssertTrue(element("native-ios-map-source-selector", in: app)
            .waitForExistence(timeout: 20))
        let denied = element("native-ios-map-open-photo-settings", in: app)
        if !denied.waitForExistence(timeout: 20) {
            recordActualPhotoKitReadback(app, stage: "after-external-revoke")
            diagnose("Real simctl Photo Library denial did not reach target app", in: app)
        }
        XCTAssertTrue(denied.exists, "Denied Photos must fail closed")
        XCTAssertFalse(element("native-ios-full-library-gps-map", in: app).exists)
        XCTAssertFalse(element("native-ios-map-verified-count", in: app).exists)
        XCTAssertFalse(element("native-ios-map-p0-independent-count", in: app).exists)
        recordActualPhotoKitReadback(app, stage: "verified-denied")
        authorizeFullPhotosInSettings(app)
        XCTAssertTrue(element("native-ios-full-library-gps-map", in: app)
            .waitForExistence(timeout: 60))
        XCTAssertTrue(element("native-ios-map-verified-count", in: app)
            .waitForExistence(timeout: 90))

        // Verify the genuine iOS Selected/Limited Photos permission too.
        // This is not simulatable by a fake PHAuthorizationStatus or by the
        // legacy simctl "photos-add" grant (which is add-only).
        let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
        settings.activate()
        if !xDriveSettingsDetailVisible(settings) &&
           !settings.navigationBars["Photos"].firstMatch.exists {
            openRealXDriveSettingsPage(settings, in: app)
        }
        let selectedLabel = NSPredicate(
            format: "label CONTAINS[c] %@ OR label CONTAINS[c] %@ OR label CONTAINS %@ OR label CONTAINS %@",
            "Selected Photos", "Limited Access", "所选照片", "有限访问"
        )
        var limited = settings.cells.matching(selectedLabel).firstMatch
        if !limited.exists { limited = settings.buttons.matching(selectedLabel).firstMatch }
        if !limited.exists { limited = settings.staticTexts.matching(selectedLabel).firstMatch }
        if !limited.waitForExistence(timeout: 10) {
            print("MAP_P0_LIMITED_CHOICE_MISSING AX tree:\n\(settings.debugDescription)")
            diagnose("Real iOS Photos Selected/Limited permission option missing", in: app)
        }
        XCTAssertTrue(limited.exists, "Limited Photos must be selectable on real Settings")
        limited.tap()
        // Some iOS releases offer a follow-up photo selection sheet; finish
        // that native UI, never synthesize a PhotoKit permission in the app.
        for name in ["Done", "完成", "OK"] {
            let button = settings.buttons[name].firstMatch
            if button.exists && button.isHittable {
                button.tap()
                break
            }
        }
        _ = resumeMapAfterSystemPhotosChange(
            app, stage: "after-selected-photos-selection"
        )
        let limitedBlock = element("native-ios-map-open-photo-settings", in: app)
        if !limitedBlock.waitForExistence(timeout: 20) {
            recordActualPhotoKitReadback(app, stage: "after-limited-settings")
            diagnose("MapKit failed to revoke location pins for Limited Photos", in: app)
        }
        XCTAssertTrue(limitedBlock.exists)
        XCTAssertFalse(element("native-ios-full-library-gps-map", in: app).exists,
            "Limited Photos may not render a misleading partial location map")
        XCTAssertFalse(element("native-ios-map-verified-count", in: app).exists)
        let readback = element("native-ios-map-photo-auth-readback", in: app)
        XCTAssertTrue(readback.waitForExistence(timeout: 10))
        XCTAssertTrue(readback.label.contains("rw=4"),
            "Only real PhotoKit .limited readWrite may pass this branch: \(readback.label)")
        authorizeFullPhotosInSettings(app)
        XCTAssertTrue(element("native-ios-full-library-gps-map", in: app)
            .waitForExistence(timeout: 65))
        XCTAssertEqual(app.state, .runningForeground)
    }


    /// Runs only after CI has imported and independently counted 100,000 real
    /// EXIF-GPS JPEGs in the simulator's PhotoKit database. Never substitutes
    /// Swift synthetic spatial-index points for actual PHAssets.
    func testP1Real100KPhotoKitMapPerformance() {
        let app = openLocalMap(performance: true)
        // The native MKMapView mounts while its 100k PhotoKit scan is
        // still running. The authoritative verified-count element appears
        // only after ALL 100k PHAssets have been enumerated and admitted.
        XCTAssertTrue(element("native-ios-map-verified-count", in: app)
            .waitForExistence(timeout: 360),
            "The initial genuine 100k PhotoKit scan never finished")
        let inventory = element("native-ios-map-perf-inventory", in: app)
        XCTAssertTrue(inventory.waitForExistence(timeout: 30),
                      "Real target PhotoKit performance readback is missing")
        let total = inventory.label.split(separator: " ").first
            .flatMap { Int($0.replacingOccurrences(of: "total=", with: "")) }
        XCTAssertGreaterThanOrEqual(total ?? 0, 100_000,
            "Perf suite needs 100k actual PHAssets, not synthetic points")
        let initialCompleted = inventory.label.split(separator: " ")
            .first(where: { $0.hasPrefix("completed=") })
            .flatMap { Int($0.replacingOccurrences(of: "completed=", with: "")) } ?? 0
        XCTAssertGreaterThanOrEqual(initialCompleted, 1,
            "First genuine PhotoKit scan was not completed")

        func waitForScan(_ count: Int) {
            let exp = XCTNSPredicateExpectation(
                predicate: NSPredicate(
                    format: "label CONTAINS %@", "completed=\(count)"
                ), object: inventory)
            XCTAssertEqual(XCTWaiter.wait(for: [exp], timeout: 360), .completed,
                "Genuine 100k scan \(count) did not finish")
            XCTAssertFalse(element("native-ios-map-full-library-scan-progress", in: app).exists)
        }

        // The app probe measured the first actual map-entry scan. Capture
        // true application-targeted XCTest CPU and peak physical memory for
        // four further real 100k PhotoKit rescans, not just sampled RSS.
        let scanOptions = XCTMeasureOptions()
        scanOptions.iterationCount = 4
        var scan = 0
        measure(metrics: [
            XCTCPUMetric(application: app), XCTMemoryMetric(application: app)
        ], options: scanOptions) {
            scan += 1
            let menu = element("native-ios-local-map-actions", in: app)
            XCTAssertTrue(menu.waitForExistence(timeout: 20))
            menu.tap()
            let action = element("native-ios-map-scan-full-library", in: app)
            let fallback = app.descendants(matching: .any)
                .matching(NSPredicate(
                    format: "label == %@", "重新扫描已授权图库位置"))
                .firstMatch
            XCTAssertTrue(action.waitForExistence(timeout: 5) ||
                          fallback.waitForExistence(timeout: 5),
                "Real MapKit rescan menu item is missing")
            (action.exists ? action : fallback).tap()
            waitForScan(initialCompleted + scan)
        }

        let map = element("native-ios-full-library-gps-map", in: app)
        XCTAssertTrue(map.waitForExistence(timeout: 30))
        let marker = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", "张带定位照片"))
            .firstMatch
        XCTAssertTrue(marker.waitForExistence(timeout: 40),
            "100k genuine GPS photos produced no selectable MapKit cell")
        marker.tap()
        let scroll = element("native-ios-map-place-scroll", in: app)
        XCTAssertTrue(scroll.waitForExistence(timeout: 80),
            "Real native place-album ScrollView did not mount")
        XCTAssertTrue(element("native-ios-map-photo-wall-tile", in: app)
            .waitForExistence(timeout: 60),
            "Real PhotoKit wall loaded no authorized photo")
        // XCTHitchMetric was introduced with Xcode 26 (Swift 6.2).
        // Keep the repository's Xcode 16.4 / iOS 18.5 runner compiling.
        var appRenderMetrics: [any XCTMetric] = [
            XCTCPUMetric(application: app), XCTMemoryMetric(application: app)
        ]
#if compiler(>=6.2)
        appRenderMetrics.append(XCTHitchMetric(application: app))
#endif
        let wallOptions = XCTMeasureOptions()
        wallOptions.iterationCount = 3
        measure(metrics: appRenderMetrics, options: wallOptions) {
            for _ in 0..<5 { scroll.swipeUp() }
            for _ in 0..<3 { scroll.swipeDown() }
        }
        let close = element("native-ios-map-place-dismiss", in: app)
        XCTAssertTrue(close.waitForExistence(timeout: 15))
        close.tap()
        XCTAssertTrue(map.waitForExistence(timeout: 30))

        // Real MKMapView gestures; no fake cache flag or direct viewport API.
        // Each region settles for the normal 900ms PhotoKit refinement policy.
        let zoomOptions = XCTMeasureOptions()
        zoomOptions.iterationCount = 3
        measure(metrics: appRenderMetrics, options: zoomOptions) {
            map.pinch(withScale: 2.0, velocity: 1.0)
            Thread.sleep(forTimeInterval: 2)
            map.swipeLeft()
            Thread.sleep(forTimeInterval: 2)
            map.swipeRight()
            Thread.sleep(forTimeInterval: 2)
        }
        XCTAssertTrue(map.exists)
        XCTAssertEqual(app.state, .runningForeground)
        // Artifact JSON independently requires >=1 actual zero-page cache
        // reuse and completed frame/CPU/RSS measurements. No fake pass.
        print("IOS_MAP_REAL_100K_UI_JOURNEY_COMPLETE inventory=\(inventory.label)")
    }
}
