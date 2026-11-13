#!/usr/bin/env python3
"""Negative and positive native resource metric coverage assertions."""
import importlib.util
from pathlib import Path
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


def log(routes=REQ):
    lines = [f"IOS_NATIVE_RESOURCE_ITERATION route={route} index={i}"
             for route in sorted(routes) for i in range(1, 5)]
    lines += [f"IOS_NATIVE_RESOURCE_COMPLETE route={route} invocations=4"
              for route in sorted(routes)]
    return "\n".join(lines)


class TestNativeResourceAudit(unittest.TestCase):
    def test_canonical_source_covers_original_all_25_routes(self):
        self.assertEqual(module.source_routes(module.SOURCE.read_text()), module.required_routes())
        self.assertEqual(len(module.required_routes()), 25)

    def test_3_retained_per_real_app_route(self):
        result = module.audit(source(), log(), {"measured": [1]}, REQ)
        self.assertEqual(result["route_count"], 3)
        self.assertEqual(result["observed_invocations"], 12)
        self.assertFalse(result["physical_60_120hz_fps"])

    def test_missing_route_rejected(self):
        with self.assertRaisesRegex(ValueError, "incomplete"):
            module.audit(source(), log({"app.gallery", "tab.files"}), {"measured": [1]}, REQ)

    def test_missing_raw_metrics_rejected(self):
        with self.assertRaisesRegex(ValueError, "No real xcresult"):
            module.audit(source(), log(), {}, REQ)

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
