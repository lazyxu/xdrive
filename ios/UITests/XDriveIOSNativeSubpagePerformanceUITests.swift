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

    private func filesSearchFilterID(_ route: String) -> String {
        switch route {
        case "files.search.date": return "native-ios-files-search-date-filter"
        case "files.search.size": return "native-ios-files-search-size-filter"
        case "files.search.kind": return "native-ios-files-search-kind-filter"
        default:
            XCTFail("Unknown Files search filter: \(route)")
            return "native-ios-files-search-kind-filter"
        }
    }

    /// Exercise the real SwiftUI kind Picker; it may expose nested Menu items.
    private func selectFilesKind(_ label: String, app: XCUIApplication) {
        let choice = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", label)).firstMatch
        if !choice.waitForExistence(timeout: 4) {
            let submenu = app.buttons["搜索类型"].firstMatch
            if submenu.exists && submenu.isHittable { submenu.tap() }
        }
        if !choice.waitForExistence(timeout: 15) || !choice.isHittable {
            print("IOS_FILES_KIND_PICKER_MISSING label=\(label) AX=\(app.debugDescription)")
            let evidence = XCTAttachment(screenshot: app.screenshot())
            evidence.name = "files-kind-picker-\(label)"
            evidence.lifetime = .keepAlways
            add(evidence)
        }
        XCTAssertTrue(choice.exists && choice.isHittable,
                      "Real Files image-kind menu item is unreachable: \(label)")
        choice.tap()
        XCTAssertEqual(app.state, .runningForeground)
    }

    private func filesHomeAction(_ id: String, app: XCUIApplication) -> XCUIElement {
        reveal(view(id, app: app), app: app)
    }

    /// Current Files Home has collapsed secondary-management sections.
    /// Expand only the genuine visible disclosure; never bypass the native UI
    /// using a synthetic shortcut or a direct state mutation.
    private func openFilesHomeDisclosure(
        _ title: String, action id: String, app: XCUIApplication
    ) {
        let entry = view(id, app: app)
        if entry.exists { return }
        let button = app.buttons[title].firstMatch
        let trigger = button.exists ? button : app.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", title)).firstMatch
        _ = reveal(trigger, app: app)
        trigger.tap()
        XCTAssertTrue(entry.waitForExistence(timeout: 15),
                      "Real Files Home disclosure did not expose \(id)")
    }

    /// A native SwiftUI toolbar Menu may expose a menu-item label but not
    /// its child Button accessibilityIdentifier on iOS 18. Require evidence
    /// of the opened More menu before the label fallback; never substitute
    /// the unrelated Files Home list shortcut for a successful toolbar tap.
    private func filesMoreOrganizer(_ app: XCUIApplication) -> XCUIElement {
        let item = view("native-ios-files-toolbar-organize-home", app: app)
        if item.exists && item.isHittable { return item }
        let nativeItem = app.menuItems["整理浏览首页"].firstMatch
        if nativeItem.exists && nativeItem.isHittable { return nativeItem }
        // This near-top-only item is rendered only after opening the
        // real toolbar Menu. A long menu may omit lower entries entirely.
        let menuOnly = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", "选择"))
            .firstMatch
        if !menuOnly.waitForExistence(timeout: 8) {
            let evidence = XCTAttachment(screenshot: app.screenshot())
            evidence.name = "files-more-menu-missing"
            evidence.lifetime = .keepAlways
            add(evidence)
            print("IOS_FILES_MORE_AX_NOT_OPEN \(app.debugDescription)")
        }
        XCTAssertTrue(menuOnly.exists, "Real Files toolbar More menu is not open")
        let choices = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", "整理浏览首页"))
            .allElementsBoundByIndex.filter { $0.exists && $0.isHittable }
        guard !choices.isEmpty else {
            XCTFail("Real Files More organizer item is not accessible")
            return item
        }
        let moreFrame = view("native-ios-files-more-options", app: app).frame
        return choices.min(by: {
            abs($0.frame.midY - moreFrame.midY) <
                abs($1.frame.midY - moreFrame.midY)
        })!
    }

    private func openLauncher(_ feature: String, app: XCUIApplication) {
        tap("native-ios-tab-launcher", app: app)
        let entry = view("native-ios-launcher-\(feature)", app: app)
        _ = reveal(entry, app: app)
        entry.tap()
        XCTAssertEqual(app.state, .runningForeground)
    }

    private func organizer(_ app: XCUIApplication) {
        openFilesHomeDisclosure("更多管理",
                                action: "native-ios-files-organize-home", app: app)
        let open = filesHomeAction("native-ios-files-organize-home", app: app)
        open.tap()
        XCTAssertTrue(app.navigationBars["整理浏览首页"].firstMatch
            .waitForExistence(timeout: 15), "Real Organizer sheet did not mount")
    }

    private func stage(_ route: String, app: XCUIApplication) {
        if route.hasPrefix("files.") {
            filesBrowse(app)
            switch route {
            case "files.home.root-denied":
                _ = filesHomeAction("native-ios-files-open-root-location", app: app)
            case "files.home.trash-denied":
                _ = filesHomeAction("native-ios-files-open-trash", app: app)
            case "files.home.recent-denied":
                _ = filesHomeAction("native-ios-files-open-recent", app: app)
            case "files.home.favorites-denied":
                _ = filesHomeAction("native-ios-files-open-favorites", app: app)
            case "files.home.saved-searches":
                _ = filesHomeAction("native-ios-files-open-saved-searches", app: app)
            case "files.home.operation-history":
                _ = filesHomeAction("native-ios-files-open-operations", app: app)
            case "files.organizer":
                openFilesHomeDisclosure("更多管理",
                                        action: "native-ios-files-organize-home", app: app)
                _ = filesHomeAction("native-ios-files-organize-home", app: app)
            case "files.organizer.saved-searches", "files.organizer.tags":
                organizer(app)
                let label = route == "files.organizer.saved-searches"
                    ? "整理及管理智能文件夹" : "创建、重命名、颜色与删除"
                _ = reveal(app.buttons[label].firstMatch, app: app)
            case "files.tags":
                openFilesHomeDisclosure("标签与分类",
                                        action: "native-ios-files-home-manage-tags", app: app)
                _ = filesHomeAction("native-ios-files-home-manage-tags", app: app)
            case "files.search.date", "files.search.size", "files.search.kind":
                let id = filesSearchFilterID(route)
                // Native horizontal filter rail: real gestures, not direct state edits.
                let strip = view("native-ios-files-filter-strip", app: app)
                _ = reveal(strip, app: app)
                let filter = view(id, app: app)
                for _ in 0..<8 {
                    if filter.exists && filter.isHittable { break }
                    strip.swipeLeft()
                }
                XCTAssertTrue(filter.exists && filter.isHittable,
                              "Real Files search filter unreachable after horizontal swipes: \(id)")
            case "files.home.more-organizer":
                let menu = view("native-ios-files-more-options", app: app)
                XCTAssertTrue(menu.waitForExistence(timeout: 15) && menu.isHittable,
                              "Real Files toolbar More menu unavailable")
                menu.tap()
                XCTAssertTrue(filesMoreOrganizer(app).isHittable,
                              "Native Files toolbar organizer unavailable")
            case "files.home.edit-mode":
                let edit = view("native-ios-files-home-edit-toggle", app: app)
                XCTAssertTrue(edit.waitForExistence(timeout: 15))
                XCTAssertEqual(edit.label, "编辑")
            case "files.quick.recent", "files.quick.favorites":
                let identifier = route == "files.quick.recent"
                    ? "native-ios-files-section-recent" : "native-ios-files-section-favorites"
                let quick = view(identifier, app: app)
                XCTAssertTrue(quick.waitForExistence(timeout: 15))
                XCTAssertTrue(quick.isHittable, "Real Files quick rail is not tappable")
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
        } else if route.hasPrefix("clipboard.") {
            openLauncher("clipboard", app: app)
            XCTAssertTrue(view("ios-clipboard-draft", app: app)
                .waitForExistence(timeout: 15), "Native Clipboard editor missing")
            if route == "clipboard.target-scope" {
                let picker = view("native-ios-clipboard-target-picker", app: app)
                XCTAssertTrue(picker.waitForExistence(timeout: 15))
                XCTAssertTrue(picker.isHittable, "Native scope menu cannot be tapped")
            } else {
                XCTAssertEqual(route, "clipboard.history-scroll")
                XCTAssertTrue(app.scrollViews.firstMatch.waitForExistence(timeout: 15))
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
        } else if route.hasPrefix("gallery.source.") {
            tap("native-ios-tab-gallery", app: app)
            switch route {
            case "gallery.source.albums":
                XCTAssertTrue(view("native-ios-gallery-source-albums", app: app)
                    .waitForExistence(timeout: 15))
            case "gallery.source.originals":
                XCTAssertTrue(view("native-ios-gallery-source-originals", app: app)
                    .waitForExistence(timeout: 15))
            case "gallery.source.cloud", "gallery.source.local":
                tap("native-ios-gallery-source-menu", app: app)
                let label = route == "gallery.source.cloud" ? "云端图库" : "本机照片"
                XCTAssertTrue(app.buttons[label].firstMatch.waitForExistence(timeout: 15))
            default:
                XCTFail("Unregistered Gallery source: \(route)")
            }
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
        } else if route == "gallery.sort-menu.filters" {
            tap("native-ios-tab-gallery", app: app)
            tap("native-ios-gallery-sort-filter-menu", app: app)
            XCTAssertTrue(view("native-ios-gallery-sort-filter-open-filters", app: app)
                .waitForExistence(timeout: 15),
                "Real Gallery sorting menu did not expose its filter editor")
        } else if route == "gallery.wall.density" ||
                    route == "gallery.wall.framing" {
            tap("native-ios-tab-gallery", app: app)
            let menu = view("native-ios-unified-wall-density", app: app)
            XCTAssertTrue(menu.waitForExistence(timeout: 15) && menu.isHittable,
                          "Actual Gallery photo wall presentation menu is missing")
        } else if route == "gallery.wall.month-group" {
            tap("native-ios-tab-gallery", app: app)
            XCTAssertTrue(view("native-ios-shared-photo-time-scale", app: app)
                .waitForExistence(timeout: 15),
                "Actual photo wall time-scale picker not mounted")
            XCTAssertTrue(app.segmentedControls.buttons["月"].firstMatch
                .waitForExistence(timeout: 15))
        } else if route == "gallery.filters.sheet" {
            tap("native-ios-tab-gallery", app: app)
            let entry = view("native-ios-gallery-open-filters", app: app)
            XCTAssertTrue(entry.waitForExistence(timeout: 15))
            XCTAssertTrue(entry.isHittable, "Native Gallery filter entry is not hittable")
        } else if route == "gallery.people.page" {
            tap("native-ios-tab-gallery", app: app)
            XCTAssertTrue(view("native-ios-gallery-people", app: app)
                .waitForExistence(timeout: 15))
        } else if route == "mine.gallery-shortcut" {
            tap("native-ios-tab-mine", app: app)
            let gallery = app.buttons["相册与照片墙"].firstMatch
            XCTAssertTrue(gallery.waitForExistence(timeout: 15))
            XCTAssertTrue(gallery.isHittable)
        } else if route == "mine.thumbnail-cache" {
            tap("native-ios-tab-mine", app: app)
            let button = app.buttons["缩略图缓存"].firstMatch
            let link = button.waitForExistence(timeout: 8)
                ? button : app.staticTexts["缩略图缓存"].firstMatch
            XCTAssertTrue(link.waitForExistence(timeout: 15))
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
        case "files.home.root-denied":
            tap("native-ios-files-open-root-location", app: app)
            ready = view("native-ios-files-error-page", app: app)
        case "files.home.trash-denied":
            tap("native-ios-files-open-trash", app: app)
            ready = view("native-ios-files-trash-error-page", app: app)
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
        case "files.search.date", "files.search.size", "files.search.kind":
            let isDate = route == "files.search.date"
            let isKind = route == "files.search.kind"
            let id = filesSearchFilterID(route)
            tap(id, app: app)
            if isKind {
                selectFilesKind("图片", app: app)
            } else {
                let option = app.buttons[isDate ? "最近 7 天" : "小于 1 MiB"].firstMatch
                XCTAssertTrue(option.waitForExistence(timeout: 15) && option.isHittable,
                              "Real Files filtering option was not opened")
                option.tap()
            }
            // Without a genuine Owner Session the Server must fail closed.
            XCTAssertTrue(view("native-ios-files-error-page", app: app)
                .waitForExistence(timeout: 15),
                "Files no-Session filter did not fail closed")
            ready = view(id, app: app)
        case "files.home.more-organizer":
            let item = filesMoreOrganizer(app)
            XCTAssertTrue(item.isHittable, "Real Files More organizer is not tappable")
            item.tap()
            XCTAssertEqual(app.state, .runningForeground)
            ready = app.navigationBars["整理浏览首页"].firstMatch
        case "files.home.edit-mode":
            tap("native-ios-files-home-edit-toggle", app: app)
            ready = view("native-ios-files-home-edit-toggle", app: app)
        case "files.quick.recent":
            tap("native-ios-files-section-recent", app: app)
            ready = view("native-ios-files-section-recent", app: app)
        case "files.quick.favorites":
            tap("native-ios-files-section-favorites", app: app)
            ready = view("native-ios-files-section-favorites", app: app)
        case "gallery.source.albums":
            tap("native-ios-gallery-source-albums", app: app)
            ready = view("native-ios-album-create", app: app)
        case "gallery.source.originals":
            tap("native-ios-gallery-source-originals", app: app)
            ready = view("native-ios-cloud-original-layout-help", app: app)
        case "gallery.source.cloud":
            app.buttons["云端图库"].firstMatch.tap()
            ready = view("native-ios-server-gallery-search", app: app)
        case "gallery.source.local":
            app.buttons["本机照片"].firstMatch.tap()
            ready = view("native-ios-local-timeline-open", app: app)
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
        case "clipboard.target-scope":
            tap("native-ios-clipboard-target-picker", app: app)
            let option = view("native-ios-clipboard-broadcast-option", app: app)
            let visibleChoice = app.buttons["当前 Owner 广播"].firstMatch
            ready = option.exists && option.isHittable ? option : visibleChoice
        case "clipboard.history-scroll":
            let scroll = app.scrollViews.firstMatch
            XCTAssertTrue(scroll.waitForExistence(timeout: 15))
            let footer = app.staticTexts[
                "最多保存 50 条有效消息，24 小时后不可见；不会自动监听系统剪贴板。"
            ].firstMatch
            for _ in 0..<5 {
                if footer.exists && footer.isHittable { break }
                scroll.swipeUp()
            }
            XCTAssertTrue(footer.isHittable,
                          "Real Clipboard scroll did not reach the existing footer")
            ready = footer
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
        case "gallery.sort-menu.filters":
            tap("native-ios-gallery-sort-filter-open-filters", app: app)
            ready = view("native-ios-unified-gallery-map-scope", app: app)
        case "gallery.wall.density", "gallery.wall.framing":
            tap("native-ios-unified-wall-density", app: app)
            let id = route == "gallery.wall.density"
                ? "native-ios-shared-density-compact"
                : "native-ios-shared-framing-complete"
            tap(id, app: app)
            ready = view("native-ios-unified-wall-density", app: app)
        case "gallery.wall.month-group":
            let month = app.segmentedControls.buttons["月"].firstMatch
            XCTAssertTrue(month.isHittable)
            month.tap()
            ready = view("native-ios-shared-photo-time-scale", app: app)
        case "gallery.filters.sheet":
            tap("native-ios-gallery-open-filters", app: app)
            ready = view("native-ios-unified-gallery-map-scope", app: app)
        case "gallery.people.page":
            tap("native-ios-gallery-people", app: app)
            ready = view("native-ios-gallery-people-page", app: app)
        case "mine.gallery-shortcut":
            let shortcut = app.buttons["相册与照片墙"].firstMatch
            XCTAssertTrue(shortcut.isHittable)
            shortcut.tap()
            ready = view("native-ios-unified-photo-gallery", app: app)
        case "mine.thumbnail-cache":
            let button = app.buttons["缩略图缓存"].firstMatch
            let link = button.waitForExistence(timeout: 8)
                ? button : app.staticTexts["缩略图缓存"].firstMatch
            XCTAssertTrue(link.waitForExistence(timeout: 15))
            link.tap()
            ready = view("native-ios-gallery-thumbnail-cache", app: app)
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
        if route == "files.search.date" {
            XCTAssertTrue(ready.label.contains("修改时间已筛选"),
                          "Files modified-date filter did not apply")
        }
        if route == "files.search.size" {
            XCTAssertTrue(ready.label.contains("文件大小已筛选"),
                          "Files size filter did not apply")
        }
        if route == "files.search.kind" {
            XCTAssertTrue(ready.label.contains("图片"),
                          "Files kind filter must show the selected image type")
        }
        if route == "gallery.wall.density" {
            XCTAssertTrue((ready.value as? String ?? "").contains("紧凑"),
                          "Actual Gallery density did not change")
        }
        if route == "gallery.wall.framing" {
            XCTAssertTrue((ready.value as? String ?? "").contains("完整图片"),
                          "Actual Gallery framing did not change")
        }
        if route == "files.home.edit-mode" {
            XCTAssertEqual(ready.label, "完成", "Files Home edit state never changed")
        }
        if route.hasPrefix("files.quick.") {
            XCTAssertEqual(ready.value as? String, "已选择",
                           "Real Files quick rail never selected requested section")
        }
        if route == "clipboard.target-scope" {
            XCTAssertTrue(ready.isHittable, "Native Clipboard menu never opened")
        }
        if route == "gallery.wall.month-group" {
            XCTAssertTrue(app.segmentedControls.buttons["月"].firstMatch.isSelected,
                          "Native Gallery did not actually select monthly grouping")
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
        case "files.home.root-denied":
            tap("native-ios-files-error-return", app: app)
            XCTAssertTrue(view("native-ios-files-section-browse", app: app)
                .waitForExistence(timeout: 15))
        case "files.home.trash-denied":
            tap("native-ios-files-trash-error-return", app: app)
            XCTAssertTrue(view("native-ios-files-section-browse", app: app)
                .waitForExistence(timeout: 15))
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
        case "files.search.date", "files.search.size", "files.search.kind":
            let isDate = route == "files.search.date"
            let isKind = route == "files.search.kind"
            let id = filesSearchFilterID(route)
            tap(id, app: app)
            if isKind {
                selectFilesKind("全部类型", app: app)
            } else {
                let clear = app.buttons[isDate ? "不限时间" : "不限大小"].firstMatch
                XCTAssertTrue(clear.waitForExistence(timeout: 15) && clear.isHittable)
                clear.tap()
            }
            let menu = view(id, app: app)
            XCTAssertTrue(menu.waitForExistence(timeout: 15))
            XCTAssertTrue(menu.label.contains(isDate ? "修改时间" :
                          (isKind ? "类型" : "文件大小")))
            if isKind {
                XCTAssertTrue(menu.label.contains("全部类型"),
                              "Files kind must reset before next measured trial")
            } else {
                XCTAssertFalse(menu.label.contains("已筛选"),
                               "Files filter must be reset before next measured trial")
            }
            XCTAssertFalse(view("native-ios-files-error-page", app: app).exists,
                           "Resetting Files filter must retire the denied search state")
            XCTAssertTrue(view("native-ios-files-section-browse", app: app)
                .waitForExistence(timeout: 15),
                "Resetting Files filter did not restore Browse")
        case "files.home.more-organizer":
            finishOrganizer(app)
        case "files.home.edit-mode":
            tap("native-ios-files-home-edit-toggle", app: app)
            XCTAssertEqual(view("native-ios-files-home-edit-toggle", app: app).label,
                           "编辑", "Files Home edit mode did not exit")
        case "files.quick.recent", "files.quick.favorites":
            tap("native-ios-files-section-browse", app: app)
            XCTAssertEqual(view("native-ios-files-section-browse", app: app).value as? String,
                           "已选择", "Native Files quick section did not restore Browse")
        case "gallery.source.albums", "gallery.source.originals",
             "gallery.source.cloud", "gallery.source.local":
            tap("native-ios-gallery-source-unified", app: app)
            XCTAssertTrue(view("native-ios-unified-photo-gallery", app: app)
                .waitForExistence(timeout: 15),
                "Gallery source did not return to unified photo wall")
        case "notes.source.ios-backup":
            let mine = app.segmentedControls.buttons["我的备忘录"].firstMatch
            XCTAssertTrue(mine.waitForExistence(timeout: 15))
            mine.tap()
            XCTAssertEqual(view("native-ios-notes-source-picker", app: app).value as? String,
                           "我的备忘录")
        case "notes.source.mine":
            // Return through a genuine reverse source switch, not a no-op.
            let backup = app.segmentedControls.buttons["iOS 备份"].firstMatch
            XCTAssertTrue(backup.waitForExistence(timeout: 15))
            backup.tap()
            XCTAssertEqual(view("native-ios-notes-source-picker", app: app).value as? String,
                           "iOS 备份", "Notes source reverse transition failed")
        case "clipboard.target-scope":
            let option = view("native-ios-clipboard-broadcast-option", app: app)
            let fallback = app.buttons["当前 Owner 广播"].firstMatch
            let choice = option.exists && option.isHittable ? option : fallback
            XCTAssertTrue(choice.waitForExistence(timeout: 15) && choice.isHittable,
                          "Clipboard menu option was not selectable")
            choice.tap()
            XCTAssertTrue(view("native-ios-clipboard-target-picker", app: app)
                .waitForExistence(timeout: 15))
            XCTAssertTrue(view("ios-clipboard-draft", app: app)
                .waitForExistence(timeout: 15),
                "Clipboard original editor must survive target-picker dismiss")
        case "clipboard.history-scroll":
            let scroll = app.scrollViews.firstMatch
            let editor = view("ios-clipboard-draft", app: app)
            for _ in 0..<5 {
                if editor.exists && editor.isHittable { break }
                scroll.swipeDown()
            }
            XCTAssertTrue(editor.exists && editor.isHittable,
                          "Clipboard reverse scroll did not restore the editor")
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
        case "gallery.sort-menu.filters":
            let cancel = app.buttons["取消"].firstMatch
            XCTAssertTrue(cancel.waitForExistence(timeout: 15))
            cancel.tap()
            XCTAssertTrue(view("native-ios-unified-photo-gallery", app: app)
                .waitForExistence(timeout: 15))
        case "gallery.wall.density", "gallery.wall.framing":
            tap("native-ios-unified-wall-density", app: app)
            let restore = route == "gallery.wall.density"
                ? "native-ios-shared-density-standard"
                : "native-ios-shared-framing-square"
            tap(restore, app: app)
            let menu = view("native-ios-unified-wall-density", app: app)
            XCTAssertTrue(menu.waitForExistence(timeout: 15))
            let value = menu.value as? String ?? ""
            XCTAssertTrue(value.contains("标准") && value.contains("方形裁切"),
                          "Gallery photo wall presentation must restore both defaults")
        case "gallery.wall.month-group":
            let all = app.segmentedControls.buttons["全部"].firstMatch
            XCTAssertTrue(all.waitForExistence(timeout: 15))
            all.tap()
            XCTAssertTrue(all.isSelected, "Gallery month-group cleanup did not reset grouping")
        case "gallery.filters.sheet":
            let cancel = app.buttons["取消"].firstMatch
            XCTAssertTrue(cancel.waitForExistence(timeout: 15))
            cancel.tap()
            XCTAssertTrue(view("native-ios-unified-photo-gallery", app: app)
                .waitForExistence(timeout: 15))
        case "gallery.people.page":
            let back = app.navigationBars.buttons.element(boundBy: 0)
            XCTAssertTrue(back.waitForExistence(timeout: 15))
            back.tap()
            XCTAssertTrue(view("native-ios-unified-photo-gallery", app: app)
                .waitForExistence(timeout: 15))
        case "mine.gallery-shortcut":
            tap("native-ios-tab-mine", app: app)
            XCTAssertTrue(view("native-ios-mine-server-account", app: app)
                .waitForExistence(timeout: 15))
        case "mine.thumbnail-cache":
            let back = app.navigationBars["缩略图缓存"].buttons.element(boundBy: 0)
            XCTAssertTrue(back.waitForExistence(timeout: 15))
            back.tap()
            XCTAssertTrue(view("native-ios-mine-server-account", app: app)
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
        // Match the existing 25-root-page XCTest resource policy without
        // pretending that signpost durations are display FPS. Real Hitch
        // Time Ratio requires Xcode 26/iOS 26 and a genuine instrumented run.
        var nativeMetrics: [any XCTMetric] = [
            XCTCPUMetric(application: app),
            XCTMemoryMetric(application: app)
        ]
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            nativeMetrics.append(XCTHitchMetric(application: app))
        } else {
            nativeMetrics.append(XCTOSSignpostMetric.scrollingAndDecelerationMetric)
            nativeMetrics.append(XCTOSSignpostMetric.navigationTransitionMetric)
        }
        #else
        nativeMetrics.append(XCTOSSignpostMetric.scrollingAndDecelerationMetric)
        nativeMetrics.append(XCTOSSignpostMetric.navigationTransitionMetric)
        #endif
        measure(metrics: nativeMetrics, options: options) {
            iterations += 1
            let stageStarted = ProcessInfo.processInfo.systemUptime
            stage(route, app: app)
            let stageMilliseconds = Int(max(0,
                (ProcessInfo.processInfo.systemUptime - stageStarted) * 1000))
            print("IOS_NATIVE_SUBPAGE_ITERATION route=\(route) index=\(iterations)")
            if iterations > 1 {
                // Parent-route preparation is distinct from the measured child tap.
                print("IOS_NATIVE_SUBPAGE_STAGE_MS route=\(route) trial=\(iterations - 1) value=\(stageMilliseconds)")
            }
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
            // Measure actual dismiss/back/restore separately from the
            // forward app CPU/memory interval. AX-ready is not first pixels.
            let returnStarted = ProcessInfo.processInfo.systemUptime
            cleanup(route, app: app)
            let returnMilliseconds = Int(max(0,
                (ProcessInfo.processInfo.systemUptime - returnStarted) * 1000))
            if iterations > 1 {
                print("IOS_NATIVE_SUBPAGE_RETURN_MS route=\(route) trial=\(iterations - 1) value=\(returnMilliseconds)")
            }
            if iterations == 2 {
                // Preserve the actual returned view, never label it a pixel/FPS trace.
                let restored = XCTAttachment(screenshot: app.screenshot())
                restored.name = "post-return-" + route
                restored.lifetime = .keepAlways
                add(restored)
                print("IOS_NATIVE_SUBPAGE_POST_RETURN_SCREENSHOT route=\(route) trial=1")
            }
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
    func testSubpageFilesHomeRootDenied() { run("files.home.root-denied") }
    func testSubpageFilesHomeTrashDenied() { run("files.home.trash-denied") }
    func testSubpageGalleryFiltersSheet() { run("gallery.filters.sheet") }
    func testSubpageGalleryPeoplePage() { run("gallery.people.page") }
    func testSubpageMineThumbnailCache() { run("mine.thumbnail-cache") }
    func testSubpageMineGalleryShortcut() { run("mine.gallery-shortcut") }
    func testSubpageClipboardTargetScope() { run("clipboard.target-scope") }
    func testSubpageClipboardHistoryScroll() { run("clipboard.history-scroll") }
    func testSubpageFilesHomeMoreOrganizer() { run("files.home.more-organizer") }
    func testSubpageFilesSearchDate() { run("files.search.date") }
    func testSubpageFilesSearchSize() { run("files.search.size") }
    func testSubpageFilesSearchKind() { run("files.search.kind") }
    func testSubpageGalleryWallDensity() { run("gallery.wall.density") }
    func testSubpageGalleryWallFraming() { run("gallery.wall.framing") }
    func testSubpageGallerySortMenuFilters() { run("gallery.sort-menu.filters") }
    func testSubpageGalleryWallMonthGroup() { run("gallery.wall.month-group") }
    func testSubpageFilesQuickRecent() { run("files.quick.recent") }
    func testSubpageFilesQuickFavorites() { run("files.quick.favorites") }
    func testSubpageGallerySourceAlbums() { run("gallery.source.albums") }
    func testSubpageGallerySourceOriginals() { run("gallery.source.originals") }
    func testSubpageGallerySourceCloud() { run("gallery.source.cloud") }
    func testSubpageGallerySourceLocal() { run("gallery.source.local") }
}
