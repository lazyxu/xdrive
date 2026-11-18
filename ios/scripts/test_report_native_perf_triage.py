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

    def test_same_route_name_in_root_and_child_is_valid(self):
        root, child = fixtures()
        # Genuine native entry points can share a name with a root route,
        # while their CPU/RSS and AX measurements remain separate records.
        child["rows"][0]["route"] = "root.0"
        result = mod.summarize(root, child)
        matched = [r for r in result["rows"] if r["route"] == "root.0"]
        self.assertEqual(len(matched), 2)
        self.assertEqual({r["kind"] for r in matched}, {"root", "child"})
        self.assertEqual(len({(r["kind"], r["route"]) for r in result["rows"]}), 75)

    def test_duplicate_within_root_is_rejected(self):
        root, child = fixtures()
        root["rows"][1]["route"] = root["rows"][2]["route"]
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            mod.summarize(root, child)

    def test_diagnostic_never_claims_ui_stall(self):
        root, child = fixtures()
        row = child["rows"][0]
        row["ax_ready_trial_ms"] = [100, 150, 67000]
        row["ax_ready_p50_ms"], row["ax_ready_p95_ms"] = 150, 67000
        review = mod.summarize(root, child)["diagnostics"]
        self.assertEqual(len(review), 1)
        self.assertEqual(review[0]["p95_ms"], 67000)
        self.assertIn("not_proven_stall", review[0]["evidence"])

    def test_actual_xctest_animation_idle_wait_is_attributed_to_exact_ax_trial(self):
        root, child = fixtures()
        recorded = []
        for item in child["rows"]:
            route = item["route"]
            recorded.append(f"IOS_NATIVE_SUBPAGE_ITERATION route={route} index=1")
            for trial, value in enumerate(item["ax_ready_trial_ms"], start=1):
                recorded.append(f"IOS_NATIVE_SUBPAGE_ITERATION route={route} index={trial+1}")
                if route == "child.0" and trial == 2:
                    recorded.append("App animations complete notification not received, will attempt to continue.")
                recorded.append(f"IOS_NATIVE_SUBPAGE_PERF_MS route={route} trial={trial} value={value}")
        report = mod.summarize(root, child, "\n".join(recorded))
        self.assertEqual(report["idle_timeout_samples"], 1)
        self.assertEqual(report["idle_timeout_affected_routes"], ["child.0"])
        flagged = [row for row in report["rows"] if row["kind"] == "child" and row["route"] == "child.0"]
        self.assertEqual(flagged[0]["xctest_animation_idle_timeout_count"], 1)
        self.assertFalse(report["first_composited_frame_measured"])
        self.assertEqual(report["rows"][-1]["fps"], "not_measured")

        # No measured entry may be inferred from an unaudited Xcode idle wait.
        recorded[-1] = recorded[-1].replace("value=30", "value=31")
        with self.assertRaisesRegex(ValueError, "mismatched"):
            mod.summarize(root, child, "\n".join(recorded))

    def test_missing_original_xcodebuild_log_cannot_certify_idle_attribution(self):
        root, child = fixtures()
        with self.assertRaisesRegex(ValueError, "Missing original"):
            mod.summarize(root, child, "")
        self.assertEqual(mod.summarize(root, child)["idle_timeout_samples"], "not_measured")

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
