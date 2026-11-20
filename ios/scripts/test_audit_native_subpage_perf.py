#!/usr/bin/env python3
"""Pure tests for the strict real iOS child-page CPU/RSS/AX audit."""
import csv
import importlib.util
import tempfile
from pathlib import Path
import unittest

SCRIPT = Path(__file__).with_name("audit_native_subpage_perf.py")
SPEC = importlib.util.spec_from_file_location("ios_subpage_audit", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)

PREFIX = """
XCTCPUMetric(application: app)
XCTMemoryMetric(application: app)
XCTHitchMetric(application: app)
XCTOSSignpostMetric.navigationTransitionMetric
options.iterationCount = 3
options.invocationOptions = [.manuallyStart, .manuallyStop]
startMeasuring()
stopMeasuring()
IOS_NATIVE_SUBPAGE_STAGE_MS
IOS_NATIVE_SUBPAGE_PERF_MS
IOS_NATIVE_SUBPAGE_RETURN_MS
IOS_NATIVE_SUBPAGE_POST_RETURN_SCREENSHOT
"""
METHODS = {
    "files.organizer": "testSubpageFilesOrganizer",
    "backup.tasks": "testSubpageBackupTasks",
}


def fake_source():
    return PREFIX + "\n".join(
        f'func {method}() {{ run("{route}") }}'
        for route, method in METHODS.items()
    )


def fake_log(routes=tuple(METHODS)):
    rows = []
    for route in routes:
        method = METHODS[route]
        rows += [f"IOS_NATIVE_SUBPAGE_ITERATION route={route} index={n}"
                 for n in range(1, 5)]
        rows += [f"IOS_NATIVE_SUBPAGE_STAGE_MS route={route} trial={n} value={n*5}"
                 for n in range(1, 4)]
        rows += [f"IOS_NATIVE_SUBPAGE_PERF_MS route={route} trial={n} value={n*10}"
                 for n in range(1, 4)]
        rows += [f"IOS_NATIVE_SUBPAGE_RETURN_MS route={route} trial={n} value={n*7}"
                 for n in range(1, 4)]
        for metric, unit in (("CPU Time (ios), s", "0.1, 0.2, 0.3"),
                             ("Memory Peak Physical (ios), kB", "1024.0, 2048.0, 3072.0")):
            rows.append(
                f"Test Case '-[xDriveIOSNavigationUITests."
                f"XDriveIOSNativeSubpagePerformanceUITests {method}]' measured "
                f"[{metric}] average: 1, relative standard deviation: 1%, "
                f"values: [{unit}], performanceMetricID:app"
            )
        rows.append(f"IOS_NATIVE_SUBPAGE_POST_AX_SCREENSHOT route={route} trial=1")
        rows.append(f"IOS_NATIVE_SUBPAGE_POST_RETURN_SCREENSHOT route={route} trial=1")
        rows.append(f"IOS_NATIVE_SUBPAGE_COMPLETE route={route} iterations=4")
    return "\n".join(rows)


class NativeSubpageAuditTests(unittest.TestCase):
    def setUp(self):
        self.old = module.ROUTES
        module.ROUTES = tuple(METHODS)

    def tearDown(self):
        module.ROUTES = self.old

    def test_completed_real_cpu_memory_and_ax(self):
        report = module.audit(fake_source(), fake_log(), {"metrics": [1]})
        self.assertEqual(report["route_count"], 2)
        self.assertEqual(report["recorded_test_invocations"], 8)
        self.assertEqual(report["total_parent_stage_samples"], 6)
        self.assertEqual(report["total_ax_samples"], 6)
        self.assertEqual(report["total_return_samples"], 6)
        self.assertEqual(report["post_ax_screenshot_routes"], 2)
        self.assertEqual(report["post_return_screenshot_routes"], 2)
        self.assertFalse(report["true_composited_first_frame_measured"])
        self.assertEqual(report["rows"][0]["parent_stage_p50_ms"], 10)
        self.assertEqual(report["rows"][0]["parent_stage_p95_ms"], 15)
        self.assertEqual(report["rows"][0]["ax_ready_p50_ms"], 20)
        self.assertEqual(report["rows"][0]["return_ax_ready_p50_ms"], 14)
        self.assertEqual(report["rows"][0]["return_ax_ready_p95_ms"], 21)
        self.assertEqual(report["rows"][0]["app_cpu_time_p50_s"], 0.2)
        self.assertEqual(report["rows"][0]["app_peak_memory_p95_mib"], 3)
        self.assertFalse(report["real_signed_owner_data"])

    def test_csv_has_real_per_route_metrics_without_fake_fps_or_owner(self):
        report = module.audit(fake_source(), fake_log(), {"metrics": [1]})
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "subpage-summary.csv"
            module.write_route_csv(report, target)
            with target.open(encoding="utf-8", newline="") as handle:
                rows = list(csv.DictReader(handle))
        self.assertEqual(len(rows), 2)
        self.assertEqual({row["route"] for row in rows}, set(METHODS))
        self.assertEqual({row["retained_trials"] for row in rows}, {"3"})
        self.assertEqual({row["ax_ready_p50_ms"] for row in rows}, {"20"})
        self.assertEqual({row["app_peak_memory_p95_mib"] for row in rows}, {"3.0"})
        self.assertEqual({row["first_composited_frame"] for row in rows}, {"not_measured"})
        self.assertEqual({row["physical_fps"] for row in rows}, {"not_measured"})
        self.assertEqual({row["authorized_owner_data"] for row in rows}, {"not_measured"})
        self.assertEqual({row["web_native_parity"] for row in rows}, {"not_verified"})

    def test_csv_rejects_incomplete_or_fabricated_resource_samples(self):
        report = module.audit(fake_source(), fake_log(), {"metrics": [1]})
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "subpage-summary.csv"
            incomplete = dict(report, raw_xcresult_metrics_present=False)
            with self.assertRaisesRegex(ValueError, "incomplete"):
                module.write_route_csv(incomplete, target)
            wrong_samples = dict(report, rows=[dict(row) for row in report["rows"]])
            wrong_samples["rows"][0]["app_cpu_time_trial_s"] = [0.1]
            with self.assertRaisesRegex(ValueError, "missing"):
                module.write_route_csv(wrong_samples, target)
            self.assertFalse(target.exists())

    def test_actual_repository_registration_has_all_fifty_routes(self):
        module.ROUTES = self.old
        registered = module.source_routes(module.SOURCE.read_text(encoding="utf-8"))
        self.assertEqual(set(registered.values()), set(module.ROUTES))
        self.assertEqual(len(module.ROUTES), 50)

    def test_gallery_backup_routes_use_existing_product_navigation(self):
        gallery = (module.ROOT / "ios/XDriveIOS/NativePhotosDashboard.swift").read_text(
            encoding="utf-8"
        )
        backup = (module.ROOT / "ios/XDriveIOS/NativePhotoBackupScreen.swift").read_text(
            encoding="utf-8"
        )
        for entry, action in (
            ("查看备份任务队列", ".queue"),
            ("集中备份（需确认）", ".focused"),
            ("备份设置", ".settings"),
            ("逐项核验当前云端原件", ".audit"),
        ):
            self.assertIn(f'Button("{entry}") {{ openBackup({action}) }}', gallery)
        self.assertIn("native-ios-backup-cache-sheet-close", gallery)
        self.assertIn('Button("逐项核验当前云端原件") { openDetails(.audit) }', backup)
        self.assertIn("case .queue: showTaskList = true", backup)
        self.assertIn("case .audit: openDetails(.audit)", backup)

    def test_new_gallery_and_files_entry_paths_are_real(self):
        gallery = (module.ROOT / "ios/XDriveIOS/NativePhotosDashboard.swift").read_text(encoding="utf-8")
        files = (module.ROOT / "ios/XDriveIOS/NativeCloudFilesBrowser.swift").read_text(encoding="utf-8")
        originals = (module.ROOT / "ios/XDriveIOS/NativeCloudOriginalGallery.swift").read_text(encoding="utf-8")
        timeline = (module.ROOT / "ios/XDriveIOS/NativePhotoTimelineBrowser.swift").read_text(encoding="utf-8")
        filter_screen = (module.ROOT / "ios/XDriveIOS/NativeUnifiedPhotoGallery.swift").read_text(encoding="utf-8")
        self.assertIn('native-ios-launcher-\\(route.rawValue)', gallery)
        for token, source in (
            ("native-ios-files-home-edit-toggle", files),
            ("native-ios-cloud-original-layout-help", originals),
            ("native-ios-local-timeline-open", timeline),
            ("native-ios-unified-gallery-show-map", filter_screen),
        ):
            self.assertIn(token, source)
        native_test = module.SOURCE.read_text(encoding="utf-8")
        for route in ("files.home.edit-mode", "gallery.originals.help",
                      "gallery.local.date-sheet", "gallery.map.from-filter",
                      "gallery.map.from-launcher"):
            self.assertIn(f'run("{route}")', native_test)

    def test_files_home_saved_searches_and_operation_history_are_real(self):
        files = (module.ROOT / "ios/XDriveIOS/NativeCloudFilesBrowser.swift").read_text(
            encoding="utf-8"
        )
        saved = (module.ROOT / "ios/XDriveIOS/NativeFilesSavedSearches.swift").read_text(
            encoding="utf-8"
        )
        operations = (module.ROOT / "ios/XDriveIOS/NativeFilesOperationHistory.swift").read_text(
            encoding="utf-8"
        )
        native_test = module.SOURCE.read_text(encoding="utf-8")
        for route, entry, ready, done, component in (
            ("files.home.saved-searches", "native-ios-files-open-saved-searches",
             "native-ios-files-saved-searches-page", "native-ios-files-saved-searches-done", saved),
            ("files.home.operation-history", "native-ios-files-open-operations",
             "native-ios-files-operation-history-page", "native-ios-files-operation-history-done",
             operations),
        ):
            self.assertIn(entry, files)
            self.assertIn(ready, component)
            self.assertIn(done, component)
            self.assertIn(f'run("{route}")', native_test)
            self.assertIn(f'case "{route}":', native_test)
        self.assertIn("Native Files child remained after Done", native_test)

    def test_new_backup_setup_and_mine_consent_are_real(self):
        backup = (module.ROOT / "ios/XDriveIOS/NativePhotoBackupScreen.swift").read_text(
            encoding="utf-8"
        )
        dashboard = (module.ROOT / "ios/XDriveIOS/NativePhotosDashboard.swift").read_text(
            encoding="utf-8"
        )
        native_test = module.SOURCE.read_text(encoding="utf-8")
        self.assertIn('native-ios-backup-setup', backup)
        self.assertIn('Button(destination.confirmed == nil ? "开始设置" : "继续设置")', backup)
        self.assertIn('Button("查看备份设置向导") { page = .setup }', backup)
        self.assertIn('native-ios-backup-open-setup', backup)
        self.assertIn('view("native-ios-backup-open-setup", app: app)', native_test)
        self.assertIn('native-ios-mine-server-account', dashboard)
        self.assertIn('确认退出当前服务器和账户？', dashboard)
        self.assertIn('Button("停止本机自动备份并退出"', dashboard)
        self.assertIn('Button("取消", role: .cancel)', dashboard)
        self.assertIn('signOutConsentOwner = nil', dashboard)
        for route in ("backup.setup", "mine.signout.confirm"):
            self.assertIn(f'run("{route}")', native_test)
        self.assertIn('XCTCPUMetric(application: app)', native_test)
        self.assertIn('XCTMemoryMetric(application: app)', native_test)

    def test_real_notes_and_transfers_subpages(self):
        notes = (module.ROOT / "ios/XDriveIOS/NativeNotesScreen.swift").read_text(encoding="utf-8")
        transfers = (module.ROOT / "ios/XDriveIOS/NativeTransfers.swift").read_text(encoding="utf-8")
        suite = module.SOURCE.read_text(encoding="utf-8")
        self.assertIn('accessibilityIdentifier("native-ios-notes-source-picker")', notes)
        self.assertIn('accessibilityValue(source.title)', notes)
        self.assertIn('Button("打开文件", action: openFiles)', transfers)
        self.assertIn('Button("打开相册备份", action: openBackup)', transfers)
        for route in ("notes.source.mine", "notes.source.ios-backup",
                      "transfers.open-files", "transfers.open-backup"):
            self.assertIn(f'run("{route}")', suite)

    def test_native_clipboard_and_mine_shortcut_subpages(self):
        clipboard = (module.ROOT / "ios/XDriveIOS/NativeClipboardScreen.swift").read_text(
            encoding="utf-8"
        )
        dashboard = (module.ROOT / "ios/XDriveIOS/NativePhotosDashboard.swift").read_text(
            encoding="utf-8"
        )
        suite = module.SOURCE.read_text(encoding="utf-8")
        for token in ("native-ios-clipboard-target-picker",
                      "native-ios-clipboard-broadcast-option", "ios-clipboard-draft"):
            self.assertIn(token, clipboard)
            self.assertIn(token, suite)
        self.assertIn('Button("相册与照片墙")', dashboard)
        for route in ("clipboard.target-scope", "clipboard.history-scroll",
                      "mine.gallery-shortcut"):
            self.assertIn(f'run("{route}")', suite)
        self.assertIn("Clipboard reverse scroll did not restore the editor", suite)

    def test_additional_real_files_gallery_mine_child_routes(self):
        suite = module.SOURCE.read_text(encoding="utf-8")
        files = (module.ROOT / "ios/XDriveIOS/NativeCloudFilesBrowser.swift").read_text(encoding="utf-8")
        gallery = (module.ROOT / "ios/XDriveIOS/NativeUnifiedPhotoGallery.swift").read_text(encoding="utf-8")
        dashboard = (module.ROOT / "ios/XDriveIOS/NativePhotosDashboard.swift").read_text(encoding="utf-8")
        for route in ("files.home.root-denied", "files.home.trash-denied",
                      "gallery.filters.sheet", "gallery.people.page", "mine.thumbnail-cache"):
            self.assertIn(f'run("{route}")', suite)
            self.assertEqual(suite.count(f'case "{route}":') +
                             suite.count(f'else if route == "{route}"'), 3)
        for token in ("native-ios-files-open-root-location", "native-ios-files-open-trash",
                      "native-ios-files-error-return", "native-ios-files-trash-error-return"):
            self.assertIn(token, files)
            self.assertIn(token, suite)
        # The people-page AX marker belongs to the actual destination view,
        # not the Gallery navigation entry that links to that destination.
        for token in ("native-ios-gallery-open-filters", "native-ios-gallery-people",
                      "native-ios-unified-gallery-map-scope"):
            self.assertIn(token, gallery)
            self.assertIn(token, suite)
        people = (module.ROOT / "ios/XDriveIOS/NativeGalleryPeople.swift").read_text(
            encoding="utf-8"
        )
        self.assertIn('accessibilityIdentifier("native-ios-gallery-people-page")', people)
        self.assertIn("native-ios-gallery-people-page", suite)
        self.assertIn('NavigationLink("缩略图缓存")', dashboard)
        self.assertIn('native-ios-gallery-thumbnail-cache', suite)
        self.assertIn('app.navigationBars["缩略图缓存"]', suite)

    def test_more_files_and_gallery_presentation_paths_are_real(self):
        suite = module.SOURCE.read_text(encoding="utf-8")
        for route in ("files.home.more-organizer",
                      "gallery.sort-menu.filters", "gallery.wall.month-group"):
            self.assertIn(f'run("{route}")', suite)
            self.assertEqual(suite.count(f'case "{route}":') +
                             suite.count(f'else if route == "{route}"'), 3)
        files = (module.ROOT / "ios/XDriveIOS/NativeCloudFilesBrowser.swift").read_text(
            encoding="utf-8")
        gallery = (module.ROOT / "ios/XDriveIOS/NativeUnifiedPhotoGallery.swift").read_text(
            encoding="utf-8")
        shared = (module.ROOT / "ios/XDriveIOS/NativePhotoWallComponents.swift").read_text(
            encoding="utf-8")
        self.assertIn('accessibilityIdentifier("native-ios-files-toolbar-organize-home")', files)
        self.assertIn('accessibilityIdentifier("native-ios-gallery-sort-filter-open-filters")', gallery)
        self.assertIn('accessibilityIdentifier("native-ios-shared-photo-time-scale")', shared)

    def test_files_filter_error_recovery_and_real_toolbar_menu_fallback(self):
        files = (module.ROOT / "ios/XDriveIOS/NativeCloudFilesBrowser.swift").read_text(
            encoding="utf-8"
        )
        suite = module.SOURCE.read_text(encoding="utf-8")
        # An unavailable Server Session must never drop all filter controls,
        # leaving a filtered request stranded on a non-recoverable error page.
        denied_source = files.split('accessibilityIdentifier("native-ios-files-error-page")')[0][-1200:]
        self.assertIn("if isGlobalSearch {", denied_source)
        self.assertIn("filesHeader", denied_source)
        self.assertIn('accessibilityIdentifier("native-ios-files-error-page")', files)
        for marker in ("native-ios-files-search-date-filter",
                       "native-ios-files-search-size-filter"):
            self.assertIn(marker, files)
            self.assertIn(marker, suite)
        self.assertIn('view("native-ios-files-error-page", app: app)', suite)
        self.assertIn("Files no-Session filter did not fail closed", suite)
        self.assertIn("Resetting Files filter must retire the denied search state", suite)
        self.assertIn("Files filter must be reset before next measured trial", suite)
        # The toolbar More route must exercise the opened menu, not silently
        # fall back to a different Home-list action sharing the same title.
        self.assertIn('app.menuItems["整理浏览首页"]', suite)
        self.assertIn('matching(NSPredicate(format: "label == %@", "选择"))', suite)
        self.assertIn('let item = filesMoreOrganizer(app)', suite)
        more_visit = suite.split('case "files.home.more-organizer":')[2].split(
            'case "files.home.edit-mode":')[0]
        self.assertIn("filesMoreOrganizer(app)", more_visit)
        self.assertNotIn("native-ios-files-organize-home", more_visit)
        # Distinguish the first real Menu entry from the collapsed Home row.
        first_menu = files.split("// Keep Home Organizer visible in the first native", 1)[1]
        self.assertLess(first_menu.index("native-ios-files-toolbar-organize-home"),
                        first_menu.index('Picker("显示方式"'))
        self.assertIn('openFilesHomeDisclosure("更多管理"', suite)
        self.assertIn('openFilesHomeDisclosure("标签与分类"', suite)

    def test_files_search_and_photo_wall_presentation_are_measured(self):
        files = (module.ROOT / "ios/XDriveIOS/NativeCloudFilesBrowser.swift").read_text(encoding="utf-8")
        gallery = (module.ROOT / "ios/XDriveIOS/NativeUnifiedPhotoGallery.swift").read_text(encoding="utf-8")
        components = (module.ROOT / "ios/XDriveIOS/NativePhotoWallComponents.swift").read_text(encoding="utf-8")
        suite = module.SOURCE.read_text(encoding="utf-8")
        for route, token, content in (
            ("files.search.date", "native-ios-files-search-date-filter", files),
            ("files.search.size", "native-ios-files-search-size-filter", files),
            ("files.search.kind", "native-ios-files-search-kind-filter", files),
            ("gallery.wall.density", "native-ios-shared-density-", components),
            ("gallery.wall.framing", "native-ios-shared-framing-", components),
        ):
            self.assertIn(f'run("{route}")', suite)
            self.assertTrue(any(f'case "{route}"' in line or
                                f', "{route}"' in line for line in suite.splitlines()))
            self.assertIn(token, content)
        self.assertIn('accessibilityValue(wallDensity.title + " · " + wallFraming.title)', gallery)
        self.assertIn('Picker("搜索类型", selection: $searchFilters.kind)', files)
        self.assertIn('selectFilesKind("图片", app: app)', suite)
        self.assertIn('selectFilesKind("全部类型", app: app)', suite)
        self.assertIn("Files kind must reset before next measured trial", suite)
        self.assertIn("Files filter must be reset before next measured trial", suite)
        self.assertIn("Gallery photo wall presentation must restore both defaults", suite)

    def test_files_quick_and_gallery_source_metrics_use_existing_native_controls(self):
        suite = module.SOURCE.read_text(encoding="utf-8")
        root_suite = (module.ROOT / "ios/UITests/XDriveIOSPagePerformanceUITests.swift").read_text(
            encoding="utf-8"
        )
        for route, identifier in (
            ("files.quick.recent", "native-ios-files-section-recent"),
            ("files.quick.favorites", "native-ios-files-section-favorites"),
            ("gallery.source.albums", "native-ios-gallery-source-albums"),
            ("gallery.source.originals", "native-ios-gallery-source-originals"),
            ("gallery.source.cloud", "native-ios-server-gallery-search"),
            ("gallery.source.local", "native-ios-local-timeline-open"),
        ):
            self.assertIn(f'run("{route}")', suite)
            self.assertIn(f'case "{route}":', suite)
            self.assertIn(identifier, suite)
            self.assertIn(identifier, root_suite)
        self.assertIn("Gallery source did not return to unified photo wall", suite)
        self.assertIn("Native Files quick section did not restore Browse", suite)

    def test_missing_actual_screenshot_fails(self):
        bad = "\n".join(x for x in fake_log().splitlines()
                        if "POST_AX_SCREENSHOT" not in x)
        with self.assertRaisesRegex(ValueError, "screenshot"):
            module.audit(fake_source(), bad, {"metrics": [1]})

    def test_missing_return_screenshot_fails(self):
        bad = "\n".join(x for x in fake_log().splitlines()
                        if "POST_RETURN_SCREENSHOT" not in x)
        with self.assertRaisesRegex(ValueError, "post-return screenshot"):
            module.audit(fake_source(), bad, {"metrics": [1]})

    def test_duplicate_return_screenshot_fails(self):
        bad = fake_log() + "\nIOS_NATIVE_SUBPAGE_POST_RETURN_SCREENSHOT route=backup.tasks trial=1"
        with self.assertRaisesRegex(ValueError, "post-return screenshot"):
            module.audit(fake_source(), bad, {"metrics": [1]})

    def test_missing_parent_stage_sample_fails(self):
        bad = "\n".join(x for x in fake_log().splitlines()
                        if "STAGE_MS route=backup.tasks trial=2" not in x)
        with self.assertRaisesRegex(ValueError, "parent-stage"):
            module.audit(fake_source(), bad, {"metrics": [1]})

    def test_duplicate_parent_stage_sample_fails(self):
        bad = fake_log() + "\nIOS_NATIVE_SUBPAGE_STAGE_MS route=backup.tasks trial=1 value=5"
        with self.assertRaisesRegex(ValueError, "parent-stage"):
            module.audit(fake_source(), bad, {"metrics": [1]})

    def test_missing_actual_metric_fails(self):
        stripped = "\n".join(
            x for x in fake_log().splitlines() if "CPU Time (ios)" not in x
        )
        with self.assertRaisesRegex(ValueError, "Missing actual app CPU"):
            module.audit(fake_source(), stripped, {"metrics": [1]})

    def test_duplicate_ax_sample_fails(self):
        bad = fake_log() + "\nIOS_NATIVE_SUBPAGE_PERF_MS route=backup.tasks trial=1 value=10"
        with self.assertRaisesRegex(ValueError, "AX-ready"):
            module.audit(fake_source(), bad, {"metrics": [1]})

    def test_missing_return_sample_fails(self):
        bad = "\n".join(x for x in fake_log().splitlines()
                        if "RETURN_MS route=backup.tasks trial=2" not in x)
        with self.assertRaisesRegex(ValueError, "return-ready"):
            module.audit(fake_source(), bad, {"metrics": [1]})

    def test_duplicate_return_sample_fails(self):
        bad = fake_log() + "\nIOS_NATIVE_SUBPAGE_RETURN_MS route=backup.tasks trial=1 value=7"
        with self.assertRaisesRegex(ValueError, "return-ready"):
            module.audit(fake_source(), bad, {"metrics": [1]})

    def test_reverse_native_notes_source_is_real(self):
        native_test = module.SOURCE.read_text(encoding="utf-8")
        self.assertIn('"iOS 备份", "Notes source reverse transition failed"', native_test)

    def test_missing_warmup_fails(self):
        bad = fake_log().replace("route=backup.tasks iterations=4",
                                 "route=backup.tasks iterations=3")
        with self.assertRaisesRegex(ValueError, "warmup"):
            module.audit(fake_source(), bad, {"metrics": [1]})

    def test_missing_original_xcresult_export_fails(self):
        with self.assertRaisesRegex(ValueError, "Missing original xcresult"):
            module.audit(fake_source(), fake_log(), {})

    def test_zero_cpu_counter_is_not_accepted_as_real_cpu_time(self):
        bad = fake_log().replace("0.1, 0.2, 0.3", "0.0, 0.0, 0.0", 1)
        with self.assertRaisesRegex(ValueError, "non-finite"):
            module.audit(fake_source(), bad, {"metrics": [1]})

    def test_duplicate_method_and_unregistered_route_fails(self):
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            module.source_routes(fake_source() + '\nfunc testSubpageBackupTasks() { run("backup.tasks") }')
        with self.assertRaisesRegex(ValueError, "Missing/unregistered"):
            module.source_routes(PREFIX + 'func testSubpageUnknown() { run("foo") }')

    def test_cpu_or_memory_must_target_app_process(self):
        with self.assertRaisesRegex(ValueError, "app-targeted"):
            module.source_routes(fake_source().replace(
                "XCTMemoryMetric(application: app)", "XCTMemoryMetric()"
            ))

    def test_one_real_simulator_run_requires_both_root_and_subpage_metrics(self):
        workflow = (module.ROOT / ".github/workflows/ios-native-subpage-performance.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn(
            "-only-testing:xDriveIOSNavigationUITests/XDriveIOSNativeResourcePerformanceUITests",
            workflow
        )
        self.assertIn(
            "-only-testing:xDriveIOSNavigationUITests/XDriveIOSNativeSubpagePerformanceUITests",
            workflow
        )
        self.assertEqual(workflow.count("xcodebuild test"), 1)
        self.assertIn("test_audit_native_resource_perf.py", workflow)
        self.assertIn("GITHUB_SHA=\"$XD_PERF_SOURCE_SHA\" python3 ios/scripts/audit_native_resource_perf.py",
                      workflow)
        self.assertIn("root-summary.json", workflow)
        self.assertIn("IOS_NATIVE_PAGE_AND_SUBPAGE_COMPLETE roots=25 children=50", workflow)
        self.assertIn("child[\"total_ax_samples\"] == 150", workflow)
        self.assertIn("root[\"observed_invocations\"] == 100", workflow)


if __name__ == "__main__":
    unittest.main()
