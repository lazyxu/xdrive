#!/usr/bin/env python3
"""Guard true native source, n=3, 75 routes and no manufactured fps."""
import importlib.util
from pathlib import Path
import unittest

src = Path(__file__).with_name("report_native_perf_triage.py")
spec = importlib.util.spec_from_file_location("perf_triage", src)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def fixtures():
    roots = [dict(route="app.gallery", metric_type="cold_app_launch",
                  cold_launch_samples_s=[.1, .2, .3], cold_launch_p50_s=.2)]
    roots += [dict(route=f"root.{i}", metric_type="app_cpu_and_peak_memory",
                   app_cpu_samples_s=[.1, .2, .3], app_cpu_p50_s=.2,
                   app_peak_memory_samples_kb=[1024, 2048, 3072],
                   app_peak_memory_p95_mib=3) for i in range(24)]
    child = [dict(route=f"child.{i}", parent_stage_trial_ms=[1, 2, 3],
                  parent_stage_p50_ms=2, parent_stage_p95_ms=3,
                  ax_ready_trial_ms=[10, 20, 30], ax_ready_p50_ms=20,
                  ax_ready_p95_ms=30, return_ax_ready_trial_ms=[4, 5, 6],
                  return_ax_ready_p50_ms=5, return_ax_ready_p95_ms=6,
                  app_cpu_time_trial_s=[.1, .2, .3], app_cpu_time_p50_s=.2,
                  app_peak_memory_trial_kb=[1024, 2048, 3072],
                  app_peak_memory_p95_mib=3) for i in range(50)]
    sha = "a" * 40
    return (dict(exact_commit=sha, route_count=25, observed_invocations=100,
                 retained_trials_per_route=3, xcresult_metric_payload_present=True,
                 rows=roots),
            dict(source_commit=sha, route_count=50,
                 recorded_test_invocations=200, total_ax_samples=150,
                 total_return_samples=150, retained_trials_per_route=3,
                 raw_xcresult_metrics_present=True, rows=child))


class NativePerfTriageTests(unittest.TestCase):
    def test_complete_75_routes_and_unmeasured_fields(self):
        root, child = fixtures()
        report = mod.summarize(root, child)
        self.assertEqual(len(report["rows"]), 75)
        self.assertEqual(len(report["slowest_child"]["entry_ax"]), 10)
        self.assertEqual(report["rows"][0]["fps"], "not_measured")
        self.assertEqual(report["rows"][-1]["web_parity"], "not_verified")
        self.assertFalse(report["first_composited_frame_measured"])

    def test_diagnostic_never_claims_ui_stall(self):
        root, child = fixtures()
        row = child["rows"][0]
        row["ax_ready_trial_ms"] = [100, 150, 67000]
        row["ax_ready_p50_ms"], row["ax_ready_p95_ms"] = 150, 67000
        review = mod.summarize(root, child)["diagnostics"]
        self.assertEqual(len(review), 1)
        self.assertEqual(review[0]["p95_ms"], 67000)
        self.assertIn("not_proven_stall", review[0]["evidence"])

    def test_rejects_missing_or_fake_metrics(self):
        root, child = fixtures()
        child["source_commit"] = "b" * 40
        with self.assertRaisesRegex(ValueError, "exact-source"):
            mod.summarize(root, child)
        child["source_commit"] = "a" * 40
        child["rows"][0]["ax_ready_trial_ms"] = [1]
        with self.assertRaisesRegex(ValueError, "three XCTest"):
            mod.summarize(root, child)
        child["rows"][0]["ax_ready_trial_ms"] = [10, 20, 30]
        child["rows"][0]["ax_ready_p95_ms"] = 5
        with self.assertRaisesRegex(ValueError, "disagrees"):
            mod.summarize(root, child)

    def test_rejects_incomplete_and_duplicates(self):
        root, child = fixtures()
        child["rows"][1]["route"] = "child.0"
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            mod.summarize(root, child)
        child["rows"][1]["route"] = "child.1"
        root["xcresult_metric_payload_present"] = False
        with self.assertRaisesRegex(ValueError, "Incomplete"):
            mod.summarize(root, child)


if __name__ == "__main__":
    unittest.main()
