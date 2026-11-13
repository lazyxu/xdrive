import XCTest

/// App-targeted CPU, memory and frame-hitch resource measurements on the
/// *real* native iOS Simulator app; not XCTest-runner metrics, physical FPS,
/// genuine signed Owner media or a 100k fixture.
final class XDriveIOSNativeResourcePerformanceUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    private func item(_ id: String, _ app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }
    private func tap(_ id: String, _ app: XCUIApplication) {
        let e = item(id, app)
        XCTAssertTrue(e.waitForExistence(timeout: 15), "Unreachable native action: \(id)")
        e.tap()
        XCTAssertEqual(app.state, .runningForeground)
    }
    /// The Files rail is Owner-scoped and persists the last selected page.
    /// When Browse is *already* selected, tapping it again is neither a route
    /// transition nor required staging. XCUITest's AXScrollToVisible can fail
    /// on a selected, covered SwiftUI rail control; do not mistake that for
    /// an application frame hitch or invent a successful navigation sample.
    private func ensureFilesSection(_ key: String, _ app: XCUIApplication) {
        let id = "native-ios-files-section-" + key
        let control = item(id, app)
        XCTAssertTrue(control.waitForExistence(timeout: 15),
                      "Files staging rail is missing: \(key)")
        if (control.value as? String) != "已选择" {
            tap(id, app)
        }
        XCTAssertEqual(control.value as? String, "已选择",
                       "Files staging must have the real selected route: \(key)")
        XCTAssertEqual(app.state, .runningForeground)
    }
    private func homeEntry(_ id: String, _ app: XCUIApplication) -> XCUIElement {
        let e = app.buttons.matching(identifier: id).firstMatch
        let list = app.collectionViews.firstMatch
        XCTAssertTrue(list.waitForExistence(timeout: 15))
        for _ in 0..<6 {
            if e.exists && e.isHittable { return e }
            list.swipeUp()
        }
        for _ in 0..<8 {
            if e.exists && e.isHittable { return e }
            list.swipeDown()
        }
        XCTAssertTrue(e.exists && e.isHittable, "Missing real Files child: \(id)")
        return e
    }
    private func launcherEntry(_ id: String, _ app: XCUIApplication) {
        tap("native-ios-tab-launcher", app)
        let e = item(id, app)
        let list = app.scrollViews.firstMatch
        XCTAssertTrue(list.waitForExistence(timeout: 15))
        for _ in 0..<7 {
            if e.exists && e.isHittable { return }
            list.swipeUp()
        }
        for _ in 0..<7 {
            if e.exists && e.isHittable { return }
            list.swipeDown()
        }
        XCTAssertTrue(e.exists && e.isHittable, "Missing real launcher item: \(id)")
    }
    private func offlineOwner(_ route: String) -> Bool {
        route.hasPrefix("gallery.") ||
        ["files.cloud-denied", "files.trash-denied", "files.saved-searches",
         "files.operation-history", "mine.thumbnail-cache"].contains(route)
    }
    // All navigation and off-fold lazy-list discovery precedes startMeasuring.
    private func stage(_ route: String, _ app: XCUIApplication) {
        switch route {
        case "tab.files", "tab.mine", "tab.launcher":
            tap("native-ios-tab-gallery", app)
        case "tab.gallery":
            tap("native-ios-tab-files", app)
        case "files.recent", "files.favorites", "files.browse",
             "files.cloud-denied", "files.trash-denied",
             "files.saved-searches", "files.operation-history", "files.search-input":
            tap("native-ios-tab-files", app)
            ensureFilesSection(route == "files.browse" ? "favorites" : "browse", app)
            if route == "files.saved-searches" {
                _ = homeEntry("native-ios-files-open-saved-searches", app)
            }
            if route == "files.operation-history" {
                _ = homeEntry("native-ios-files-open-operations", app)
            }
        case "gallery.unified":
            tap("native-ios-tab-gallery", app)
            tap("native-ios-gallery-source-originals", app)
        case "gallery.originals", "gallery.local", "gallery.albums",
             "gallery.cloud", "gallery.filters", "gallery.people":
            tap("native-ios-tab-gallery", app)
            tap("native-ios-gallery-source-unified", app)
        case "mine.thumbnail-cache":
            tap("native-ios-tab-mine", app)
        case "tool.notes":
            launcherEntry("native-ios-launcher-notes", app)
        case "tool.clipboard":
            launcherEntry("native-ios-launcher-clipboard", app)
        case "tool.backup":
            launcherEntry("native-ios-launcher-backup", app)
        case "tool.transfers":
            launcherEntry("native-ios-launcher-transfers", app)
        default:
            XCTFail("Unregistered resource stage \(route)")
        }
    }
    private func perform(_ route: String, _ app: XCUIApplication) {
        var ready = ""
        switch route {
        case "tab.files":
            tap("native-ios-tab-files", app); ready = "native-ios-files-section-browse"
        case "tab.gallery":
            tap("native-ios-tab-gallery", app); ready = "native-ios-unified-photo-gallery"
        case "tab.mine":
            tap("native-ios-tab-mine", app); ready = "native-ios-mine-server-account"
        case "tab.launcher":
            tap("native-ios-tab-launcher", app); ready = "native-ios-launcher-files"
        case "files.recent", "files.favorites", "files.browse":
            let key = String(route.split(separator: ".").last ?? "")
            ready = "native-ios-files-section-\(key)"
            tap(ready, app)
        case "files.cloud-denied":
            tap("native-ios-files-open-root-location", app); ready = "native-ios-files-error-page"
        case "files.trash-denied":
            tap("native-ios-files-open-trash", app); ready = "native-ios-files-trash-error-page"
        case "files.saved-searches":
            homeEntry("native-ios-files-open-saved-searches", app).tap()
            ready = "native-ios-files-saved-searches-page"
        case "files.operation-history":
            homeEntry("native-ios-files-open-operations", app).tap()
            ready = "native-ios-files-operation-history-page"
        case "files.search-input":
            let field = app.searchFields["搜索全部文件"].firstMatch
            XCTAssertTrue(field.waitForExistence(timeout: 15))
            field.tap()
            field.typeText("x")
            XCTAssertTrue((field.value as? String ?? "").contains("x"))
            ready = "native-ios-files-section-browse"
        case "gallery.unified":
            tap("native-ios-gallery-source-unified", app); ready = "native-ios-unified-photo-gallery"
        case "gallery.originals":
            tap("native-ios-gallery-source-originals", app); ready = "native-ios-cloud-original-layout-help"
        case "gallery.albums":
            tap("native-ios-gallery-source-albums", app); ready = "native-ios-album-create"
        case "gallery.local", "gallery.cloud":
            tap("native-ios-gallery-source-menu", app)
            let button = app.buttons[route == "gallery.local" ? "本机照片" : "云端图库"].firstMatch
            XCTAssertTrue(button.waitForExistence(timeout: 15))
            button.tap()
            ready = route == "gallery.local" ?
                "native-ios-local-timeline-open" : "native-ios-server-gallery-search"
        case "gallery.filters":
            tap("native-ios-gallery-open-filters", app)
            ready = "native-ios-unified-gallery-map-scope"
        case "gallery.people":
            tap("native-ios-gallery-people", app); ready = "native-ios-gallery-people-page"
        case "mine.thumbnail-cache":
            let primary = app.buttons["缩略图缓存"].firstMatch
            let e = primary.waitForExistence(timeout: 8) ?
                primary : app.staticTexts["缩略图缓存"].firstMatch
            XCTAssertTrue(e.waitForExistence(timeout: 15))
            e.tap()
            ready = "native-ios-gallery-thumbnail-cache"
        case "tool.notes":
            tap("native-ios-launcher-notes", app); ready = "native-ios-notes-page"
        case "tool.clipboard":
            tap("native-ios-launcher-clipboard", app); ready = "ios-clipboard-draft"
        case "tool.backup":
            tap("native-ios-launcher-backup", app); ready = "native-ios-backup-overview"
        case "tool.transfers":
            tap("native-ios-launcher-transfers", app); ready = "native-ios-transfer-overview"
        default:
            XCTFail("Unregistered measured route \(route)")
        }
        let target = item(ready, app)
        XCTAssertTrue(target.waitForExistence(timeout: 15), "Page never AX-ready: \(route)")
        if ["files.recent", "files.favorites", "files.browse"].contains(route) {
            XCTAssertEqual(target.value as? String, "已选择")
        }
        XCTAssertEqual(app.state, .runningForeground)
    }
    private func clean(_ route: String, _ app: XCUIApplication) {
        switch route {
        case "files.cloud-denied":
            tap("native-ios-files-error-return", app)
        case "files.trash-denied":
            tap("native-ios-files-trash-error-return", app)
        case "files.saved-searches", "files.operation-history":
            let done = app.buttons["完成"].firstMatch
            XCTAssertTrue(done.waitForExistence(timeout: 15))
            done.tap()
            XCTAssertTrue(item("native-ios-files-section-browse", app)
                .waitForExistence(timeout: 15))
        case "gallery.filters":
            let cancel = app.buttons["取消"].firstMatch
            XCTAssertTrue(cancel.waitForExistence(timeout: 15)); cancel.tap()
        case "gallery.people":
            let back = app.navigationBars.buttons.element(boundBy: 0)
            XCTAssertTrue(back.waitForExistence(timeout: 15)); back.tap()
        case "mine.thumbnail-cache":
            let back = app.navigationBars["缩略图缓存"].buttons.element(boundBy: 0)
            XCTAssertTrue(back.waitForExistence(timeout: 15)); back.tap()
        default: break
        }
    }
    private func run(_ route: String) {
        let app = XCUIApplication()
        app.launchArguments = ["-xdrive-ui-navigation-smoke"]
        if offlineOwner(route) {
            // No real authenticated Owner Session; privileged Server reads fail closed.
            app.launchArguments.append("-xdrive-ui-navigation-synthetic-owner")
        }
        app.launch()
        XCTAssertEqual(app.state, .runningForeground)
        let options = XCTMeasureOptions()
        options.iterationCount = 3
        options.invocationOptions = [.manuallyStart, .manuallyStop]
        var iterations = 0
        // Xcode 16.4 / iOS 18.5 does not define XCTHitchMetric (added in
        // Xcode 26). Keep genuine app CPU/RSS measurements, and use older
        // XCTest navigation/scroll signposts as duration evidence. They do
        // NOT measure Hitch Time Ratio or a physical 60/120-Hz display.
        var resourceMetrics: [any XCTMetric] = [
            XCTCPUMetric(application: app),
            XCTMemoryMetric(application: app)
        ]
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            resourceMetrics.append(XCTHitchMetric(application: app))
        } else {
            resourceMetrics.append(XCTOSSignpostMetric.scrollingAndDecelerationMetric)
            resourceMetrics.append(XCTOSSignpostMetric.navigationTransitionMetric)
        }
        #else
        resourceMetrics.append(XCTOSSignpostMetric.scrollingAndDecelerationMetric)
        resourceMetrics.append(XCTOSSignpostMetric.navigationTransitionMetric)
        #endif
        measure(metrics: resourceMetrics, options: options) {
            iterations += 1
            stage(route, app)
            print("IOS_NATIVE_RESOURCE_ITERATION route=\(route) index=\(iterations)")
            startMeasuring()
            perform(route, app)
            stopMeasuring()
            clean(route, app)
        }
        print("IOS_NATIVE_RESOURCE_COMPLETE route=\(route) invocations=\(iterations)")
        app.terminate()
    }
    private func runCold(_ route: String) {
        let app = XCUIApplication()
        app.launchArguments = ["-xdrive-ui-navigation-smoke"]
        let options = XCTMeasureOptions()
        options.iterationCount = 3
        var iterations = 0
        // Cold launch is a real app-launch metric, NOT invented CPU/RSS/FPS.
        measure(metrics: [XCTApplicationLaunchMetric()], options: options) {
            iterations += 1
            app.launch()
            XCTAssertTrue(item("native-ios-unified-photo-gallery", app)
                .waitForExistence(timeout: 15))
            print("IOS_NATIVE_RESOURCE_ITERATION route=\(route) index=\(iterations)")
            app.terminate()
        }
        print("IOS_NATIVE_RESOURCE_COMPLETE route=\(route) invocations=\(iterations)")
    }
    func testResourceColdGalleryLaunch() { runCold("app.gallery") }
    func testResourceTabFiles() { run("tab.files") }
    func testResourceTabGallery() { run("tab.gallery") }
    func testResourceTabMine() { run("tab.mine") }
    func testResourceTabLauncher() { run("tab.launcher") }
    func testResourceFilesRecent() { run("files.recent") }
    func testResourceFilesFavorites() { run("files.favorites") }
    func testResourceFilesBrowse() { run("files.browse") }
    func testResourceFilesCloudDenied() { run("files.cloud-denied") }
    func testResourceFilesTrashDenied() { run("files.trash-denied") }
    func testResourceFilesSavedSearches() { run("files.saved-searches") }
    func testResourceFilesOperationHistory() { run("files.operation-history") }
    func testResourceFilesSearchInput() { run("files.search-input") }
    func testResourceGalleryUnified() { run("gallery.unified") }
    func testResourceGalleryOriginals() { run("gallery.originals") }
    func testResourceGalleryLocal() { run("gallery.local") }
    func testResourceGalleryAlbums() { run("gallery.albums") }
    func testResourceGalleryCloud() { run("gallery.cloud") }
    func testResourceGalleryFilters() { run("gallery.filters") }
    func testResourceGalleryPeople() { run("gallery.people") }
    func testResourceMineThumbnailCache() { run("mine.thumbnail-cache") }
    func testResourceToolNotes() { run("tool.notes") }
    func testResourceToolClipboard() { run("tool.clipboard") }
    func testResourceToolBackup() { run("tool.backup") }
    func testResourceToolTransfers() { run("tool.transfers") }
}
