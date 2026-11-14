import XCTest

/// Genuine iOS Simulator subpage navigation plus APP-targeted CPU/memory.
/// Offline synthetic Owner has no verified Server session. No protected
/// records, 100k dataset, media frames or real device FPS are fabricated.
final class XDriveIOSNativeSubpagePerformanceUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
    }

    private func view(_ id: String, app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func tap(_ id: String, app: XCUIApplication) {
        let control = view(id, app: app)
        XCTAssertTrue(control.waitForExistence(timeout: 15),
                      "Real native action does not exist: \(id)")
        control.tap()
        XCTAssertEqual(app.state, .runningForeground)
    }

    /// Require the one native Gallery NavigationStack toolbar Menu to be
    /// visible and hit-testable; do not dispatch actions through a hidden label.
    private func tapVisibleGalleryBackup(_ app: XCUIApplication) {
        let controls = app.buttons.matching(identifier: "native-ios-gallery-backup-settings")
        let control = controls.firstMatch
        XCTAssertTrue(control.waitForExistence(timeout: 15),
                      "Real Gallery toolbar backup button must exist")
        XCTAssertEqual(controls.count, 1, "Gallery backup toolbar must be unique")
        XCTAssertGreaterThanOrEqual(control.frame.height, 43,
                                    "Gallery toolbar backup touch height collapsed")
        XCTAssertGreaterThanOrEqual(control.frame.width, 43,
                                    "Gallery toolbar backup touch width collapsed")
        if !control.isHittable {
            print("IOS_GALLERY_BACKUP_AX_BLOCKED frame=\(control.frame) AX=\(app.debugDescription)")
            let attachment = XCTAttachment(screenshot: app.screenshot())
            attachment.name = "gallery-backup-toolbar-not-hittable"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
        XCTAssertTrue(control.isHittable,
                      "Real Gallery toolbar backup button must be visible and hittable")
        control.tap()
        XCTAssertEqual(app.state, .runningForeground)
    }

    private func reveal(_ control: XCUIElement, app: XCUIApplication) -> XCUIElement {
        let collection = app.collectionViews.firstMatch
        let table = app.tables.firstMatch
        let scroll = app.scrollViews.firstMatch
        let host = collection.exists ? collection :
            (table.exists ? table : (scroll.exists ? scroll : app))
        for _ in 0..<8 {
            if control.exists && control.isHittable { return control }
            host.swipeUp()
        }
        for _ in 0..<10 {
            if control.exists && control.isHittable { return control }
            host.swipeDown()
        }
        XCTAssertTrue(control.exists && control.isHittable,
                      "Real lazy subpage entry was not reachable")
        return control
    }

    private func filesBrowse(_ app: XCUIApplication) {
        tap("native-ios-tab-files", app: app)
        let browse = view("native-ios-files-section-browse", app: app)
        XCTAssertTrue(browse.waitForExistence(timeout: 15))
        // A visible Home section already selected cannot be tapped through
        // an active search/sheet AX overlay. Never retry an invisible tap.
        if (browse.value as? String) != "已选择" {
            XCTAssertTrue(browse.isHittable, "Files Browse rail blocked")
            browse.tap()
        }
        XCTAssertEqual(browse.value as? String, "已选择")
    }

    private func filesHomeAction(_ id: String, app: XCUIApplication) -> XCUIElement {
        reveal(view(id, app: app), app: app)
    }

    private func openLauncher(_ feature: String, app: XCUIApplication) {
        tap("native-ios-tab-launcher", app: app)
        let entry = view("native-ios-launcher-\(feature)", app: app)
        _ = reveal(entry, app: app)
        entry.tap()
        XCTAssertEqual(app.state, .runningForeground)
    }

    private func organizer(_ app: XCUIApplication) {
        let open = filesHomeAction("native-ios-files-organize-home", app: app)
        open.tap()
        XCTAssertTrue(app.navigationBars["整理浏览首页"].firstMatch
            .waitForExistence(timeout: 15), "Real Organizer sheet did not mount")
    }

    private func stage(_ route: String, app: XCUIApplication) {
        if route.hasPrefix("files.") {
            filesBrowse(app)
            switch route {
            case "files.home.recent-denied":
                _ = filesHomeAction("native-ios-files-open-recent", app: app)
            case "files.home.favorites-denied":
                _ = filesHomeAction("native-ios-files-open-favorites", app: app)
            case "files.home.saved-searches":
                _ = filesHomeAction("native-ios-files-open-saved-searches", app: app)
            case "files.home.operation-history":
                _ = filesHomeAction("native-ios-files-open-operations", app: app)
            case "files.organizer":
                _ = filesHomeAction("native-ios-files-organize-home", app: app)
            case "files.organizer.saved-searches", "files.organizer.tags":
                organizer(app)
                let label = route == "files.organizer.saved-searches"
                    ? "整理及管理智能文件夹" : "创建、重命名、颜色与删除"
                _ = reveal(app.buttons[label].firstMatch, app: app)
            case "files.tags":
                _ = filesHomeAction("native-ios-files-home-manage-tags", app: app)
            case "files.home.edit-mode":
                let edit = view("native-ios-files-home-edit-toggle", app: app)
                XCTAssertTrue(edit.waitForExistence(timeout: 15))
                XCTAssertEqual(edit.label, "编辑")
            default:
                XCTFail("Unregistered Files subpage: \(route)")
            }
        } else if route.hasPrefix("notes.") {
            openLauncher("notes", app: app)
            let source = view("native-ios-notes-source-picker", app: app)
            XCTAssertTrue(source.waitForExistence(timeout: 15), "Real Notes picker absent")
            if route == "notes.source.mine" {
                let backup = app.segmentedControls.buttons["iOS 备份"].firstMatch
                XCTAssertTrue(backup.waitForExistence(timeout: 15))
                backup.tap()
                XCTAssertEqual(source.value as? String, "iOS 备份")
            } else {
                XCTAssertEqual(route, "notes.source.ios-backup")
                XCTAssertEqual(source.value as? String, "我的备忘录")
            }
        } else if route.hasPrefix("transfers.") {
            openLauncher("transfers", app: app)
            XCTAssertTrue(view("native-ios-transfer-overview", app: app)
                .waitForExistence(timeout: 15), "Real Transfers form absent")
            let label = route == "transfers.open-files" ? "打开文件" : "打开相册备份"
            XCTAssertTrue(["transfers.open-files", "transfers.open-backup"].contains(route))
            XCTAssertTrue(app.buttons[label].firstMatch.waitForExistence(timeout: 15))
        } else if route.hasPrefix("backup.") {
            openLauncher("backup", app: app)
            XCTAssertTrue(view("native-ios-backup-overview", app: app)
                .waitForExistence(timeout: 15))
            if route == "backup.tasks" {
                _ = reveal(view("native-ios-photos-task-list", app: app), app: app)
            } else if route == "backup.setup" {
                let setup = view("native-ios-backup-open-setup", app: app)
                _ = reveal(setup, app: app)
                XCTAssertTrue(setup.isEnabled, "Native Backup Setup entry is disabled")
            } else if route == "backup.details" {
                _ = reveal(app.buttons["备份详情"].firstMatch, app: app)
            } else if route == "backup.audit" {
                _ = reveal(app.buttons["逐项核验当前云端原件"].firstMatch, app: app)
            } else {
                XCTFail("Unregistered Backup subpage: \(route)")
            }
        } else if route == "mine.signout.confirm" {
            tap("native-ios-tab-mine", app: app)
            let action = view("native-ios-mine-server-account", app: app)
            XCTAssertTrue(action.waitForExistence(timeout: 15))
            XCTAssertTrue(action.isEnabled, "Only a current native Owner may request sign-out")
        } else if route == "gallery.originals.help" {
            tap("native-ios-tab-gallery", app: app)
            tap("native-ios-gallery-source-originals", app: app)
            XCTAssertTrue(view("native-ios-cloud-original-layout-help", app: app)
                .waitForExistence(timeout: 15))
        } else if route == "gallery.local.date-sheet" {
            tap("native-ios-tab-gallery", app: app)
            tap("native-ios-gallery-source-menu", app: app)
            let local = app.buttons["本机照片"].firstMatch
            XCTAssertTrue(local.waitForExistence(timeout: 15))
            local.tap()
            XCTAssertTrue(view("native-ios-local-timeline-open", app: app)
                .waitForExistence(timeout: 15))
        } else if route == "gallery.map.from-filter" {
            tap("native-ios-tab-gallery", app: app)
            tap("native-ios-gallery-open-filters", app: app)
            let showMap = view("native-ios-unified-gallery-show-map", app: app)
            XCTAssertTrue(showMap.waitForExistence(timeout: 15))
            XCTAssertTrue(showMap.isEnabled, "Unfiltered Gallery should allow native MapKit")
        } else if route == "gallery.map.from-launcher" {
            tap("native-ios-tab-launcher", app: app)
            _ = reveal(view("native-ios-launcher-map", app: app), app: app)
        } else if route.hasPrefix("gallery.") {
            // Measure the real Gallery backup menu -> native child route,
            // not another direct-launch time of the same SwiftUI view.
            tap("native-ios-tab-gallery", app: app)
            tapVisibleGalleryBackup(app)
            let menu: String
            switch route {
            case "gallery.backup.queue": menu = "查看备份任务队列"
            case "gallery.backup.focused": menu = "集中备份（需确认）"
            case "gallery.backup.settings": menu = "备份设置"
            case "gallery.backup.audit": menu = "逐项核验当前云端原件"
            case "gallery.cache.sheet": menu = "释放本机缓存空间（不删除照片原件）"
            default:
                XCTFail("Unregistered Gallery child: \(route)")
                return
            }
            let item = app.buttons[menu].firstMatch
            XCTAssertTrue(item.waitForExistence(timeout: 15),
                          "Real Gallery backup menu action missing: \(route)")
            XCTAssertTrue(item.isHittable, "Gallery menu action obstructed: \(route)")
        } else if route == "launcher.recent-picker" {
            openLauncher("notes", app: app)
            XCTAssertTrue(app.navigationBars["笔记"].firstMatch.waitForExistence(timeout: 15))
            XCTAssertTrue(app.buttons["最近功能"].firstMatch.waitForExistence(timeout: 15))
        } else {
            XCTFail("Unregistered native subpage: \(route)")
        }
    }

    private func visit(_ route: String, app: XCUIApplication) {
        var ready: XCUIElement
        switch route {
        case "files.home.recent-denied":
            tap("native-ios-files-open-recent", app: app)
            ready = view("native-ios-files-recent-error-page", app: app)
        case "files.home.favorites-denied":
            tap("native-ios-files-open-favorites", app: app)
            ready = view("native-ios-files-favorites-error-page", app: app)
        case "files.home.saved-searches":
            tap("native-ios-files-open-saved-searches", app: app)
            ready = view("native-ios-files-saved-searches-page", app: app)
        case "files.home.operation-history":
            tap("native-ios-files-open-operations", app: app)
            ready = view("native-ios-files-operation-history-page", app: app)
        case "files.organizer":
            tap("native-ios-files-organize-home", app: app)
            ready = app.navigationBars["整理浏览首页"].firstMatch
        case "files.organizer.saved-searches":
            app.buttons["整理及管理智能文件夹"].firstMatch.tap()
            ready = view("native-ios-files-saved-searches-page", app: app)
        case "files.organizer.tags":
            app.buttons["创建、重命名、颜色与删除"].firstMatch.tap()
            ready = view("native-ios-files-tag-management", app: app)
        case "files.tags":
            tap("native-ios-files-home-manage-tags", app: app)
            ready = view("native-ios-files-tag-management", app: app)
        case "files.home.edit-mode":
            tap("native-ios-files-home-edit-toggle", app: app)
            ready = view("native-ios-files-home-edit-toggle", app: app)
        case "notes.source.ios-backup":
            let backup = app.segmentedControls.buttons["iOS 备份"].firstMatch
            XCTAssertTrue(backup.isHittable)
            backup.tap()
            ready = view("native-ios-notes-source-picker", app: app)
        case "notes.source.mine":
            let mine = app.segmentedControls.buttons["我的备忘录"].firstMatch
            XCTAssertTrue(mine.isHittable)
            mine.tap()
            ready = view("native-ios-notes-source-picker", app: app)
        case "transfers.open-files":
            app.buttons["打开文件"].firstMatch.tap()
            ready = view("native-ios-files-section-browse", app: app)
        case "transfers.open-backup":
            app.buttons["打开相册备份"].firstMatch.tap()
            ready = view("native-ios-backup-overview", app: app)
        case "backup.tasks":
            tap("native-ios-photos-task-list", app: app)
            ready = view("native-ios-photo-task-list-done", app: app)
        case "backup.setup":
            tap("native-ios-backup-open-setup", app: app)
            ready = view("native-ios-backup-setup", app: app)
        case "backup.details":
            app.buttons["备份详情"].firstMatch.tap()
            ready = view("native-ios-backup-portrait-form", app: app)
        case "backup.audit":
            app.buttons["逐项核验当前云端原件"].firstMatch.tap()
            ready = view("native-ios-backup-portrait-form", app: app)
        case "gallery.backup.queue":
            app.buttons["查看备份任务队列"].firstMatch.tap()
            ready = view("native-ios-photo-task-list-done", app: app)
        case "gallery.backup.focused":
            app.buttons["集中备份（需确认）"].firstMatch.tap()
            ready = view("native-ios-backup-portrait-form", app: app)
        case "gallery.backup.settings":
            app.buttons["备份设置"].firstMatch.tap()
            ready = view("native-ios-backup-portrait-form", app: app)
        case "gallery.backup.audit":
            app.buttons["逐项核验当前云端原件"].firstMatch.tap()
            ready = view("native-ios-backup-portrait-form", app: app)
        case "gallery.cache.sheet":
            app.buttons["释放本机缓存空间（不删除照片原件）"].firstMatch.tap()
            ready = view("native-ios-backup-cache-sheet-close", app: app)
        case "mine.signout.confirm":
            tap("native-ios-mine-server-account", app: app)
            ready = app.buttons["停止本机自动备份并退出"].firstMatch
        case "gallery.originals.help":
            tap("native-ios-cloud-original-layout-help", app: app)
            ready = app.alerts["云端备份原件说明"].firstMatch
        case "gallery.local.date-sheet":
            tap("native-ios-local-timeline-open", app: app)
            ready = app.navigationBars["按日期定位"].firstMatch
        case "gallery.map.from-filter":
            tap("native-ios-unified-gallery-show-map", app: app)
            ready = view("native-ios-map-source-selector", app: app)
        case "gallery.map.from-launcher":
            tap("native-ios-launcher-map", app: app)
            ready = view("native-ios-map-source-selector", app: app)
        case "launcher.recent-picker":
            app.buttons["最近功能"].firstMatch.tap()
            ready = app.navigationBars["最近功能"].firstMatch
        default:
            XCTFail("Unregistered measured native subpage: \(route)")
            return
        }
        let timeout: TimeInterval = route.hasPrefix("gallery.map.") ? 25 : 15
        XCTAssertTrue(ready.waitForExistence(timeout: timeout),
                      "Native child did not mount: \(route)")
        if route == "files.home.edit-mode" {
            XCTAssertEqual(ready.label, "完成", "Files Home edit state never changed")
        }
        if route == "notes.source.ios-backup" {
            XCTAssertEqual(ready.value as? String, "iOS 备份")
        } else if route == "notes.source.mine" {
            XCTAssertEqual(ready.value as? String, "我的备忘录")
        }
        XCTAssertEqual(app.state, .runningForeground)
    }

    private func finishOrganizer(_ app: XCUIApplication) {
        XCTAssertTrue(app.navigationBars["整理浏览首页"].firstMatch
            .waitForExistence(timeout: 15))
        let done = app.buttons["完成"].firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 15))
        done.tap()
        let organizer = app.navigationBars["整理浏览首页"].firstMatch
        let retired = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"), object: organizer)
        XCTAssertEqual(XCTWaiter.wait(for: [retired], timeout: 12), .completed,
                       "Organizer remained over Files after native dismiss")
        XCTAssertTrue(view("native-ios-files-section-browse", app: app)
            .waitForExistence(timeout: 15))
    }

    private func cleanup(_ route: String, app: XCUIApplication) {
        switch route {
        case "files.home.recent-denied":
            tap("native-ios-files-recent-error-return", app: app)
            XCTAssertTrue(view("native-ios-files-section-browse", app: app)
                .waitForExistence(timeout: 15))
        case "files.home.favorites-denied":
            tap("native-ios-files-favorites-error-return", app: app)
            XCTAssertTrue(view("native-ios-files-section-browse", app: app)
                .waitForExistence(timeout: 15))
        case "files.home.saved-searches", "files.home.operation-history":
            let doneID = route == "files.home.saved-searches"
                ? "native-ios-files-saved-searches-done"
                : "native-ios-files-operation-history-done"
            tap(doneID, app: app)
            XCTAssertTrue(view("native-ios-files-section-browse", app: app)
                .waitForExistence(timeout: 15))
            let pageID = route == "files.home.saved-searches"
                ? "native-ios-files-saved-searches-page"
                : "native-ios-files-operation-history-page"
            let retired = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "exists == false"),
                object: view(pageID, app: app))
            XCTAssertEqual(XCTWaiter.wait(for: [retired], timeout: 12), .completed,
                           "Native Files child remained after Done")
        case "files.organizer":
            finishOrganizer(app)
        case "files.organizer.saved-searches", "files.organizer.tags":
            let title = route == "files.organizer.saved-searches" ? "智能文件夹" : "标签"
            let back = app.navigationBars[title].buttons.element(boundBy: 0)
            XCTAssertTrue(back.waitForExistence(timeout: 15))
            back.tap()
            finishOrganizer(app)
        case "files.tags":
            let done = app.buttons["完成"].firstMatch
            XCTAssertTrue(done.waitForExistence(timeout: 15))
            done.tap()
            let tag = view("native-ios-files-tag-management", app: app)
            let closed = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "exists == false"), object: tag)
            XCTAssertEqual(XCTWaiter.wait(for: [closed], timeout: 12), .completed)
        case "files.home.edit-mode":
            tap("native-ios-files-home-edit-toggle", app: app)
            XCTAssertEqual(view("native-ios-files-home-edit-toggle", app: app).label,
                           "编辑", "Files Home edit mode did not exit")
        case "notes.source.ios-backup":
            let mine = app.segmentedControls.buttons["我的备忘录"].firstMatch
            XCTAssertTrue(mine.waitForExistence(timeout: 15))
            mine.tap()
            XCTAssertEqual(view("native-ios-notes-source-picker", app: app).value as? String,
                           "我的备忘录")
        case "notes.source.mine":
            XCTAssertEqual(view("native-ios-notes-source-picker", app: app).value as? String,
                           "我的备忘录")
        case "transfers.open-files", "transfers.open-backup":
            tap("native-ios-tab-launcher", app: app)
            XCTAssertTrue(view("native-ios-launcher-files", app: app)
                .waitForExistence(timeout: 15))
        case "backup.tasks":
            tap("native-ios-photo-task-list-done", app: app)
            let done = view("native-ios-photo-task-list-done", app: app)
            let closed = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "exists == false"), object: done)
            XCTAssertEqual(XCTWaiter.wait(for: [closed], timeout: 12), .completed)
        case "backup.setup":
            let back = app.buttons["返回相册备份"].firstMatch
            XCTAssertTrue(back.waitForExistence(timeout: 15))
            back.tap()
            XCTAssertTrue(view("native-ios-backup-overview", app: app)
                .waitForExistence(timeout: 15))
        case "backup.details", "backup.audit",
             "gallery.backup.focused", "gallery.backup.settings", "gallery.backup.audit":
            let back = app.buttons["返回相册备份"].firstMatch
            XCTAssertTrue(back.waitForExistence(timeout: 15))
            back.tap()
            XCTAssertTrue(view("native-ios-backup-overview", app: app)
                .waitForExistence(timeout: 15))
            if route.hasPrefix("gallery.") {
                tap("native-ios-tab-gallery", app: app)
                XCTAssertTrue(view("native-ios-unified-photo-gallery", app: app)
                    .waitForExistence(timeout: 15))
            }
        case "gallery.backup.queue":
            tap("native-ios-photo-task-list-done", app: app)
            tap("native-ios-tab-gallery", app: app)
            XCTAssertTrue(view("native-ios-unified-photo-gallery", app: app)
                .waitForExistence(timeout: 15))
        case "gallery.cache.sheet":
            tap("native-ios-backup-cache-sheet-close", app: app)
            XCTAssertTrue(view("native-ios-unified-photo-gallery", app: app)
                .waitForExistence(timeout: 15))
        case "mine.signout.confirm":
            let cancel = app.buttons["取消"].firstMatch
            XCTAssertTrue(cancel.waitForExistence(timeout: 15),
                          "Native sign-out consent must provide a safe cancel action")
            cancel.tap()
            XCTAssertTrue(view("native-ios-mine-server-account", app: app)
                .waitForExistence(timeout: 15))
        case "gallery.originals.help":
            let alert = app.alerts["云端备份原件说明"].firstMatch
            let done = alert.buttons["完成"].firstMatch
            XCTAssertTrue(done.waitForExistence(timeout: 15))
            done.tap()
            let closed = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "exists == false"), object: alert)
            XCTAssertEqual(XCTWaiter.wait(for: [closed], timeout: 12), .completed)
        case "gallery.local.date-sheet":
            let done = app.navigationBars["按日期定位"].buttons["完成"].firstMatch
            XCTAssertTrue(done.waitForExistence(timeout: 15))
            done.tap()
            XCTAssertTrue(view("native-ios-local-timeline-open", app: app)
                .waitForExistence(timeout: 15))
        case "gallery.map.from-filter", "gallery.map.from-launcher":
            tap("native-ios-map-dismiss", app: app)
            XCTAssertTrue(view("native-ios-unified-photo-gallery", app: app)
                .waitForExistence(timeout: 15))
        case "launcher.recent-picker":
            let done = app.buttons["完成"].firstMatch
            XCTAssertTrue(done.waitForExistence(timeout: 15))
            done.tap()
            XCTAssertTrue(app.navigationBars["笔记"].firstMatch
                .waitForExistence(timeout: 15))
        default:
            XCTFail("Unregistered cleanup for \(route)")
        }
        XCTAssertEqual(app.state, .runningForeground)
    }

    private func run(_ route: String) {
        let app = XCUIApplication()
        app.launchArguments = [
            "-xdrive-ui-navigation-smoke",
            "-xdrive-ui-navigation-synthetic-owner"
        ]
        app.launch()
        XCTAssertEqual(app.state, .runningForeground)

        let options = XCTMeasureOptions()
        options.iterationCount = 3
        options.invocationOptions = [.manuallyStart, .manuallyStop]
        var iterations = 0
        measure(metrics: [
            XCTCPUMetric(application: app),
            XCTMemoryMetric(application: app)
        ], options: options) {
            iterations += 1
            stage(route, app: app)
            print("IOS_NATIVE_SUBPAGE_ITERATION route=\(route) index=\(iterations)")
            startMeasuring()
            let started = ProcessInfo.processInfo.systemUptime
            visit(route, app: app)
            let milliseconds = Int(max(0, (ProcessInfo.processInfo.systemUptime - started) * 1000))
            stopMeasuring()
            // The first iteration is XCTest warmup, never a retained sample.
            if iterations > 1 {
                print("IOS_NATIVE_SUBPAGE_PERF_MS route=\(route) trial=\(iterations - 1) value=\(milliseconds)")
            }
            // Capture after the measured interval. This is NOT first pixel.
            if iterations == 2 {
                let frame = XCTAttachment(screenshot: app.screenshot())
                frame.name = "post-ax-" + route
                frame.lifetime = .keepAlways
                add(frame)
                print("IOS_NATIVE_SUBPAGE_POST_AX_SCREENSHOT route=\(route) trial=1")
            }
            cleanup(route, app: app)
        }
        print("IOS_NATIVE_SUBPAGE_COMPLETE route=\(route) iterations=\(iterations)")
        app.terminate()
    }

    func testSubpageNotesSourceIOSBackup() { run("notes.source.ios-backup") }
    func testSubpageNotesSourceMine() { run("notes.source.mine") }
    func testSubpageTransfersOpenFiles() { run("transfers.open-files") }
    func testSubpageTransfersOpenBackup() { run("transfers.open-backup") }
    func testSubpageFilesHomeRecentDenied() { run("files.home.recent-denied") }
    func testSubpageFilesHomeFavoritesDenied() { run("files.home.favorites-denied") }
    func testSubpageFilesHomeSavedSearches() { run("files.home.saved-searches") }
    func testSubpageFilesHomeOperationHistory() { run("files.home.operation-history") }
    func testSubpageFilesOrganizer() { run("files.organizer") }
    func testSubpageFilesOrganizerSavedSearches() { run("files.organizer.saved-searches") }
    func testSubpageFilesOrganizerTags() { run("files.organizer.tags") }
    func testSubpageFilesTags() { run("files.tags") }
    func testSubpageBackupTasks() { run("backup.tasks") }
    func testSubpageBackupSetup() { run("backup.setup") }
    func testSubpageBackupDetails() { run("backup.details") }
    func testSubpageLauncherRecentPicker() { run("launcher.recent-picker") }
    func testSubpageBackupAudit() { run("backup.audit") }
    func testSubpageGalleryBackupQueue() { run("gallery.backup.queue") }
    func testSubpageGalleryBackupFocused() { run("gallery.backup.focused") }
    func testSubpageGalleryBackupSettings() { run("gallery.backup.settings") }
    func testSubpageGalleryBackupAudit() { run("gallery.backup.audit") }
    func testSubpageGalleryCacheSheet() { run("gallery.cache.sheet") }
    func testSubpageFilesHomeEditMode() { run("files.home.edit-mode") }
    func testSubpageMineSignoutConfirm() { run("mine.signout.confirm") }
    func testSubpageGalleryOriginalsHelp() { run("gallery.originals.help") }
    func testSubpageGalleryLocalDateSheet() { run("gallery.local.date-sheet") }
    func testSubpageGalleryMapFromFilter() { run("gallery.map.from-filter") }
    func testSubpageGalleryMapFromLauncher() { run("gallery.map.from-launcher") }
}
