#!/usr/bin/env python3
"""Fail-closed positive/negative native 25-root per-page CPU/RSS metric tests."""
import csv
import importlib.util
from pathlib import Path
import tempfile
import unittest

path = Path(__file__).with_name("audit_native_resource_perf.py")
spec = importlib.util.spec_from_file_location("resource_audit", path)
assert spec is not None and spec.loader is not None
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
REQ = {"app.gallery", "tab.files", "gallery.unified"}
PREFIX = """XCTCPUMetric(application: app)
XCTMemoryMetric(application: app)
XCTHitchMetric(application: app)
XCTOSSignpostMetric.scrollingAndDecelerationMetric
XCTOSSignpostMetric.navigationTransitionMetric
#if compiler(>=6.2)
if #available(iOS 26.0, *)
XCTApplicationLaunchMetric()
options.iterationCount = 3
options.invocationOptions = [.manuallyStart, .manuallyStop]
startMeasuring()
stopMeasuring()
"""


def source():
    return PREFIX + "\n".join(
        f'func testResource{i}() {{ run("{route}") }}'
        for i, route in enumerate(sorted(REQ))
    )


def metric(method, name, values="0.1, 0.2, 0.3"):
    return (f"Test Case '-[xDriveIOSNavigationUITests."
            f"XDriveIOSNativeResourcePerformanceUITests {method}]' measured "
            f"[{name}] average: 0.2, relative standard deviation: 0%, "
            f"values: [{values}], performanceMetricID:app")


def log(routes=REQ):
    lines = [f"IOS_NATIVE_RESOURCE_ITERATION route={route} index={i}"
             for route in sorted(routes) for i in range(1, 5)]
    lines += [f"IOS_NATIVE_RESOURCE_COMPLETE route={route} invocations=4"
              for route in sorted(routes)]
    for index, route in enumerate(sorted(routes)):
        method = f"testResource{index}"
        if route == "app.gallery":
            lines.append(metric(method, "Duration (AppLaunch), s"))
        else:
            lines += [metric(method, "CPU Time (ios), s"),
                      metric(method, "Memory Peak Physical (ios), kB",
                             "1024.0, 2048.0, 3072.0")]
    return "\n".join(lines)


class TestNativeResourceAudit(unittest.TestCase):
    def test_canonical_source_covers_original_all_25_routes(self):
        self.assertEqual(module.source_routes(module.SOURCE.read_text()), module.required_routes())
        self.assertEqual(len(module.required_routes()), 25)

    def test_3_retained_per_real_app_route(self):
        result = module.audit(source(), log(), {"measured": [1]}, REQ)
        self.assertEqual(result["route_count"], 3)
        self.assertEqual(result["observed_invocations"], 12)
        self.assertEqual(result["resource_routes_with_3_cpu_and_rss_samples"], 2)
        self.assertEqual(result["cold_launch_routes_with_3_duration_samples"], 1)
        self.assertEqual(result["rows"][0]["metric_type"], "cold_app_launch")
        self.assertEqual(result["rows"][0]["cold_launch_p50_s"], 0.2)
        self.assertIsNone(result["rows"][0]["app_cpu_p50_s"])
        self.assertFalse(result["physical_60_120hz_fps"])

    def test_export_has_genuine_samples_and_not_measured_cells(self):
        report = module.audit(source(), log(), {"measured": [1]}, REQ)
        with tempfile.TemporaryDirectory() as temporary:
            file = Path(temporary) / "root.csv"
            module.write_root_csv(report, file)
            with file.open(encoding="utf-8", newline="") as stream:
                rows = list(csv.DictReader(stream))
        self.assertEqual(len(rows), 3)
        self.assertEqual({row["route"] for row in rows}, REQ)
        cold = next(x for x in rows if x["route"] == "app.gallery")
        self.assertEqual(cold["app_cpu_p50_s"], "not_measured")
        self.assertEqual(cold["cold_launch_p50_s"], "0.2")
        self.assertEqual(cold["physical_fps"], "not_measured")
        warm = next(x for x in rows if x["route"] == "tab.files")
        self.assertEqual(warm["app_peak_memory_p95_mib"], "3.0")

    def test_missing_route_rejected(self):
        with self.assertRaisesRegex(ValueError, "incomplete"):
            module.audit(source(), log({"app.gallery", "tab.files"}), {"measured": [1]}, REQ)

    def test_missing_raw_metrics_rejected(self):
        with self.assertRaisesRegex(ValueError, "No real xcresult"):
            module.audit(source(), log(), {}, REQ)

    def test_missing_cpu_trial_evidence_rejected(self):
        bad = log().replace(metric("testResource2", "CPU Time (ios), s"), "")
        with self.assertRaisesRegex(ValueError, "mismatched|Missing"):
            module.audit(source(), bad, {"measured": [1]}, REQ)

    def test_missing_peak_memory_rejected(self):
        bad = log().replace(metric("testResource2", "Memory Peak Physical (ios), kB",
                                   "1024.0, 2048.0, 3072.0"), "")
        with self.assertRaisesRegex(ValueError, "mismatched|Missing"):
            module.audit(source(), bad, {"measured": [1]}, REQ)

    def test_duplicate_per_route_metric_rejected(self):
        bad = log() + "\n" + metric("testResource2", "CPU Time (ios), s")
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            module.audit(source(), bad, {"measured": [1]}, REQ)

    def test_nonfinite_or_zero_or_short_sample_rejected(self):
        for replacement in ("0.0, 0.0, 0.0", "0.2, 0.3", "nan, 0.1, 0.2"):
            bad = log().replace(metric("testResource1", "CPU Time (ios), s"),
                                metric("testResource1", "CPU Time (ios), s", replacement))
            with self.assertRaisesRegex(ValueError, "samples|mismatched"):
                module.audit(source(), bad, {"measured": [1]}, REQ)

    def test_app_launch_cannot_substitute_fake_cpu_or_vice_versa(self):
        bad = log().replace(metric("testResource0", "Duration (AppLaunch), s"),
                            metric("testResource0", "CPU Time (ios), s"))
        with self.assertRaisesRegex(ValueError, "mismatched"):
            module.audit(source(), bad, {"measured": [1]}, REQ)

    def test_duplicate_iteration_rejected(self):
        with self.assertRaisesRegex(ValueError, "iterations"):
            module.audit(source(), log()+"\nIOS_NATIVE_RESOURCE_ITERATION route=tab.files index=2",
                         {"measured": [1]}, REQ)

    def test_short_warmup_rejected(self):
        with self.assertRaisesRegex(ValueError, "warmup"):
            module.audit(source(), log().replace("route=tab.files invocations=4",
                                                  "route=tab.files invocations=3"),
                         {"measured": [1]}, REQ)

    def test_old_xcode_requires_real_navigation_and_scrolling_metrics(self):
        with self.assertRaisesRegex(ValueError, "target-app metric"):
            module.source_routes(source().replace(
                "XCTOSSignpostMetric.navigationTransitionMetric", "NO_SIGNPOST"))
        with self.assertRaisesRegex(ValueError, "target-app metric"):
            module.source_routes(source().replace(
                "#if compiler(>=6.2)", "#if compiler(>=5.1)"))

    def test_target_must_be_app_not_test_runner(self):
        with self.assertRaisesRegex(ValueError, "target-app metric"):
            module.source_routes(source().replace("XCTMemoryMetric(application: app)",
                                                   "XCTMemoryMetric()"))


if __name__ == "__main__":
    unittest.main()
