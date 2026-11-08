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

    private func openLocalMap() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-xdrive-ui-navigation-smoke"]
        app.launch()
        XCTAssertEqual(app.state, .runningForeground)
        var tab = element("native-ios-tab-dynamic", in: app)
        if !tab.waitForExistence(timeout: 5) {
            // Same real SwiftUI control on the old five-tab AX hierarchy.
            tab = app.buttons.matching(identifier: "native-ios-five-slot-bar")
                .matching(NSPredicate(format: "label == %@", "地图")).firstMatch
        }
        XCTAssertTrue(tab.waitForExistence(timeout: 15), "Map tab unavailable")
        tab.tap()
        let open = app.buttons["打开地图"].firstMatch
        XCTAssertTrue(open.waitForExistence(timeout: 15), "Default map shortcut missing")
        open.tap()

        // Fresh Simulator PhotoKit permissions may start undetermined. Never
        // quietly skip a real map run because the permission dialog appeared.
        let request = app.buttons["允许查看本机照片"].firstMatch
        if request.waitForExistence(timeout: 3) {
            request.tap()
            let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
            let alert = springboard.alerts.firstMatch
            if alert.waitForExistence(timeout: 10) {
                let labels = [
                    "Allow Full Access", "Allow Access to All Photos",
                    "允许完全访问", "允许访问所有照片", "允许访问全部照片"
                ]
                let allowed = labels.map { alert.buttons[$0].firstMatch }
                    .first { $0.exists }
                XCTAssertNotNil(allowed, "Photos Full Access dialog not understood")
                allowed?.tap()
            }
        }
        let map = element("native-ios-full-library-gps-map", in: app)
        XCTAssertTrue(map.waitForExistence(timeout: 65),
                      "Real MKMapView must mount after Photos Full Access")
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
        XCTAssertTrue(verified.waitForExistence(timeout: 90),
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
