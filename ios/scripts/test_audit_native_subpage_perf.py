#!/usr/bin/env python3
"""Pure tests for the strict real iOS child-page CPU/RSS/AX audit."""
import importlib.util
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
options.iterationCount = 3
options.invocationOptions = [.manuallyStart, .manuallyStop]
startMeasuring()
stopMeasuring()
IOS_NATIVE_SUBPAGE_PERF_MS
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
        rows += [f"IOS_NATIVE_SUBPAGE_PERF_MS route={route} trial={n} value={n*10}"
                 for n in range(1, 4)]
        for metric, unit in (("CPU Time (ios), s", "0.1, 0.2, 0.3"),
                             ("Memory Peak Physical (ios), kB", "1024.0, 2048.0, 3072.0")):
            rows.append(
                f"Test Case '-[xDriveIOSNavigationUITests."
                f"XDriveIOSNativeSubpagePerformanceUITests {method}]' measured "
                f"[{metric}] average: 1, relative standard deviation: 1%, "
                f"values: [{unit}], performanceMetricID:app"
            )
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
        self.assertEqual(report["total_ax_samples"], 6)
        self.assertEqual(report["rows"][0]["ax_ready_p50_ms"], 20)
        self.assertEqual(report["rows"][0]["app_cpu_time_p50_s"], 0.2)
        self.assertEqual(report["rows"][0]["app_peak_memory_p95_mib"], 3)
        self.assertFalse(report["real_signed_owner_data"])

    def test_actual_repository_registration_has_all_twenty_two_routes(self):
        module.ROUTES = self.old
        registered = module.source_routes(module.SOURCE.read_text(encoding="utf-8"))
        self.assertEqual(set(registered.values()), set(module.ROUTES))
        self.assertEqual(len(module.ROUTES), 22)

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
        self.assertIn('native-ios-mine-server-account', dashboard)
        self.assertIn('确认退出当前服务器和账户？', dashboard)
        self.assertIn('Button("停止本机自动备份并退出"', dashboard)
        for route in ("backup.setup", "mine.signout.confirm"):
            self.assertIn(f'run("{route}")', native_test)
        self.assertIn('XCTCPUMetric(application: app)', native_test)
        self.assertIn('XCTMemoryMetric(application: app)', native_test)

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


if __name__ == "__main__":
    unittest.main()
