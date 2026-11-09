import XCTest

/// Exercises the real native Dashboard → PhotoKit MapKit → place sheet →
/// Viewer route in the same simulator as the existing Files/Gallery smoke.
/// CI pre-imports two tiny, synthetic EXIF-GPS JPEGs (no Owner token and
/// no production photo library). This is NOT a mocked MapKit screen.
final class XDriveIOSMapNavigationRuntimeUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
    }
    override func tearDownWithError() throws {
        XCUIDevice.shared.orientation = .portrait
    }

    private func element(_ id: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
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

    private func openLocalMap() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-xdrive-ui-navigation-smoke"]
        app.launch()
        XCTAssertEqual(app.state, .runningForeground)

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
        let request = app.buttons["允许查看本机照片"].firstMatch
        if request.waitForExistence(timeout: 4) {
            request.tap()
            let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
            let springboardAlert = springboard.alerts.firstMatch
            let appAlert = app.alerts.firstMatch
            let alert = springboardAlert.waitForExistence(timeout: 8)
                ? springboardAlert : appAlert
            if alert.exists {
                let labels = [
                    "Allow Full Access", "Allow Access to All Photos",
                    "允许完全访问", "允许访问所有照片", "允许访问全部照片"
                ]
                let allowed = labels.map { alert.buttons[$0].firstMatch }
                    .first { $0.exists }
                if allowed == nil { diagnose("Unrecognized Photos Full Access dialog", in: app) }
                XCTAssertNotNil(allowed, "Photos must authorize Full Access")
                allowed?.tap()
            }
        }
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
        let chooseDate = app.buttons["按指定日期"].firstMatch
        XCTAssertTrue(chooseDate.waitForExistence(timeout: 10))
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

    func testTwoRealGPSPhotosOpenPlaceWallViewerAndReturnToSameMap() {
        let app = openLocalMap()
        let verified = element("native-ios-map-verified-count", in: app)
        if !verified.waitForExistence(timeout: 90) {
            diagnose("Two imported GPS assets not verified by PhotoKit", in: app)
        }
        XCTAssertTrue(verified.exists,
                      "Synthetic GPS images were not indexed by real PhotoKit")
        XCTAssertTrue(verified.label.contains("2 张"), verified.label)

        // The two real assets share one signed-in-memory spatial cell.
        // Tapping the annotation must open the existing medium/large native
        // place wall (not an invented single-photo or date-only Viewer).
        let marker = app.descendants(matching: .any)
            .matching(NSPredicate(
                format: "label CONTAINS %@", "已扫描图库区域有2张带定位照片"))
            .firstMatch
        XCTAssertTrue(marker.waitForExistence(timeout: 30),
                      "Real GPS MapKit 2-photo cover is missing")
        marker.tap()
        let firstTile = element("native-ios-map-photo-wall-tile", in: app)
        XCTAssertTrue(firstTile.waitForExistence(timeout: 60),
                      "Map place sheet did not load the real 48-item PhotoKit wall")
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
}
