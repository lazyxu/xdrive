import XCTest

/// Actual native SwiftUI page timings on the CI iOS Simulator. Each sample
/// includes XCTest tap synthesis, Accessibility polling and UI idling.
/// These are NOT device FPS, first composed frames, app CPU/RSS or 100k data.
final class XDriveIOSPagePerformanceUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    private func launch(syntheticOwner: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-xdrive-ui-navigation-smoke"]
        if syntheticOwner {
            // No signed Session or grant: protected Server reads must fail closed.
            app.launchArguments.append("-xdrive-ui-navigation-synthetic-owner")
        }
        app.launch()
        XCTAssertEqual(app.state, .runningForeground)
        return app
    }

    private func view(_ id: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func tap(_ id: String, in app: XCUIApplication) {
        let control = view(id, in: app)
        guard control.waitForExistence(timeout: 15) else {
            XCTFail("Missing real native action: \(id)")
            return
        }
        control.tap()
        XCTAssertEqual(app.state, .runningForeground)
    }


    // The real Launcher is a lazy vertical list. Prepare each actual button
    // before starting the navigation stopwatch: otherwise offscreen grid
    // discovery/swipes would be silently counted as page render latency.
    // No coordinates, fake routes or synthetic response bodies.
    private func revealLauncherEntry(_ identifier: String, in app: XCUIApplication) {
        tap("native-ios-tab-launcher", in: app)
        let target = view(identifier, in: app)
        let host = app.scrollViews.firstMatch
        guard host.waitForExistence(timeout: 15) else {
            XCTFail("Real launcher scroll host did not mount")
            return
        }
        for _ in 0..<7 {
            if target.exists && target.isHittable { return }
            host.swipeUp()
        }
        for _ in 0..<7 {
            if target.exists && target.isHittable { return }
            host.swipeDown()
        }
        XCTAssertTrue(target.exists && target.isHittable,
                      "Real Launcher entry cannot be reached by scrolling: \(identifier)")
    }

    private func measure(
        _ route: String, phase: String = "warm", trial: Int,
        app: XCUIApplication, ready id: String,
        selected: Bool = false, action: () -> Void
    ) {
        let started = ProcessInfo.processInfo.systemUptime
        action()
        let target = view(id, in: app)
        guard target.waitForExistence(timeout: 15) else {
            XCTFail("No native AX-ready view for \(route): \(id)")
            return
        }
        if selected {
            XCTAssertEqual(target.value as? String, "已选择",
                           "Files subpage was not selected: \(route)")
        }
        XCTAssertEqual(app.state, .runningForeground)
        let elapsed = Int(((ProcessInfo.processInfo.systemUptime - started) * 1000).rounded())
        print("IOS_NATIVE_PAGE_PERF_MS route=\(route) phase=\(phase) trial=\(trial) value=\(elapsed)")
    }

    func testColdLaunchGalleryN3() {
        for trial in 1...3 {
            let app = XCUIApplication()
            app.launchArguments = ["-xdrive-ui-navigation-smoke"]
            measure("app.gallery", phase: "cold", trial: trial, app: app,
                    ready: "native-ios-unified-photo-gallery" { app.launch() }
            app.terminate()
        }
    }

    func testPrimaryTabNavigationN3() {
        let app = launch()
        for trial in 1...3 {
            measure("tab.files", trial: trial, app: app,
                    ready: "native-ios-files-section-browse") {
                tap("native-ios-tab-files", in: app)
            }
            measure("tab.gallery", trial: trial, app: app,
                    ready: "native-ios-unified-photo-gallery") {
                tap("native-ios-tab-gallery", in: app)
            }
            measure("tab.mine", trial: trial, app: app,
                    ready: "native-ios-mine-server-account") {
                tap("native-ios-tab-mine", in: app)
            }
            measure("tab.launcher", trial: trial, app: app,
                    ready: "native-ios-launcher-files") {
                tap("native-ios-tab-launcher", in: app)
            }
        }
    }

    func testFilesQuickSectionsN3() {
        let app = launch()
        tap("native-ios-tab-files", in: app)
        for trial in 1...3 {
            measure("files.recent", trial: trial, app: app,
                    ready: "native-ios-files-section-recent", selected: true) {
                tap("native-ios-files-section-recent", in: app)
            }
            measure("files.favorites", trial: trial, app: app,
                    ready: "native-ios-files-section-favorites", selected: true) {
                tap("native-ios-files-section-favorites", in: app)
            }
            measure("files.browse", trial: trial, app: app,
                    ready: "native-ios-files-section-browse", selected: true) {
                tap("native-ios-files-section-browse", in: app)
            }
        }
    }

    func testGallerySourcesAndChildrenN3() {
        let app = launch(syntheticOwner: true)
        tap("native-ios-tab-gallery", in: app)
        for trial in 1...3 {
            measure("gallery.originals", trial: trial, app: app,
                    ready: "native-ios-cloud-original-layout-help") {
                tap("native-ios-gallery-source-originals", in: app)
            }
            measure("gallery.unified", trial: trial, app: app,
                    ready: "native-ios-unified-photo-gallery") {
                tap("native-ios-gallery-source-unified", in: app)
            }
            // This AX marker only exists within the actual modal filter editor.
            measure("gallery.filters", trial: trial, app: app,
                    ready: "native-ios-unified-gallery-map-scope") {
                tap("native-ios-gallery-open-filters", in: app)
            }
            let cancel = app.buttons["取消"].firstMatch
            XCTAssertTrue(cancel.waitForExistence(timeout: 15))
            cancel.tap()
            XCTAssertTrue(view("native-ios-unified-photo-gallery", in: app)
                .waitForExistence(timeout: 15))
            measure("gallery.people", trial: trial, app: app,
                    ready: "native-ios-gallery-people-page") {
                tap("native-ios-gallery-people", in: app)
            }
            let back = app.navigationBars.buttons.element(boundBy: 0)
            XCTAssertTrue(back.waitForExistence(timeout: 15))
            back.tap()
            XCTAssertTrue(view("native-ios-unified-photo-gallery", in: app)
                .waitForExistence(timeout: 15))
            measure("gallery.local", trial: trial, app: app,
                    ready: "native-ios-local-timeline-open") {
                tap("native-ios-gallery-source-menu", in: app)
                let local = app.buttons["本机照片"].firstMatch
                XCTAssertTrue(local.waitForExistence(timeout: 15))
                local.tap()
            }
            tap("native-ios-gallery-source-unified", in: app)
            XCTAssertTrue(view("native-ios-unified-photo-gallery", in: app)
                .waitForExistence(timeout: 15))
        }
    }

    func testFilesFailClosedOwnerSubpagesN3() {
        let app = launch(syntheticOwner: true)
        tap("native-ios-tab-files", in: app)
        for trial in 1...3 {
            measure("files.cloud-denied", trial: trial, app: app,
                    ready: "native-ios-files-error-page") {
                tap("native-ios-files-open-root-location", in: app)
            }
            tap("native-ios-files-error-return", in: app)
            XCTAssertTrue(view("native-ios-files-section-browse", in: app)
                .waitForExistence(timeout: 15))
            measure("files.trash-denied", trial: trial, app: app,
                    ready: "native-ios-files-trash-error-page") {
                tap("native-ios-files-open-trash", in: app)
            }
            tap("native-ios-files-trash-error-return", in: app)
        }
    }

    func testNativeToolPagesN3() {
        let app = launch()
        for trial in 1...3 {
            revealLauncherEntry("native-ios-launcher-notes", in: app)
            measure("tool.notes", trial: trial, app: app,
                    ready: "native-ios-notes-page") {
                tap("native-ios-launcher-notes", in: app)
            }
            revealLauncherEntry("native-ios-launcher-clipboard", in: app)
            measure("tool.clipboard", trial: trial, app: app,
                    ready: "ios-clipboard-draft") {
                tap("native-ios-launcher-clipboard", in: app)
            }
            revealLauncherEntry("native-ios-launcher-backup", in: app)
            measure("tool.backup", trial: trial, app: app,
                    ready: "native-ios-backup-overview") {
                tap("native-ios-launcher-backup", in: app)
            }
            revealLauncherEntry("native-ios-launcher-transfers", in: app)
            measure("tool.transfers", trial: trial, app: app,
                    ready: "native-ios-transfer-overview") {
                tap("native-ios-launcher-transfers", in: app)
            }
        }
    }
}
