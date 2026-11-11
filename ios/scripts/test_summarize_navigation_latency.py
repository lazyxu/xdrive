#!/usr/bin/env python3
"""Pure regression tests: no iPhone, real file, or URL is required."""
import importlib.util
import pathlib
import unittest

SCRIPT = pathlib.Path(__file__).with_name("summarize-navigation-latency.py")
SPEC = importlib.util.spec_from_file_location("native_navigation_summary", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class NavigationSummaryTests(unittest.TestCase):
    def test_no_video_sample_is_not_a_fake_first_frame_pass(self):
        payload = module.summarize(
            "IOS_NATIVE_NAVIGATION_READY_MS route=files-to-gallery page=Gallery value=72\n"
        )
        self.assertEqual(payload["total_samples"], 1)
        self.assertEqual(payload["video_first_displayed_frame"]["samples"], 0)
        self.assertIsNone(payload["video_first_displayed_frame"]["p95_ms"])
        self.assertTrue(payload["video_first_displayed_frame"]["zero_samples_means_not_measured"])
        self.assertFalse(payload["proves_zero_transient_flicker"])

    def test_actual_first_frame_logs_have_distinct_statistics(self):
        payload = module.summarize(
            "IOS_NATIVE_NAVIGATION_READY_MS route=gallery-to-files page=Files value=15\n"
            "IOS_NATIVE_LOCAL_PHOTO_PAGE_READY_MS mode=tab-return value=30\n"
            "IOS_NATIVE_FILES_VIDEO_FIRST_FRAME_MS stage=layer-ready value=500\n"
            "IOS_NATIVE_FILES_VIDEO_FIRST_FRAME_MS stage=layer-ready value=1000\n"
            "IOS_NATIVE_FILES_VIDEO_FIRST_FRAME_MS stage=layer-ready value=1500\n"
            "IOS_NATIVE_FILES_VIDEO_FIRST_FRAME_MS stage=layer-ready value=1800\n"
        )
        video = payload["video_first_displayed_frame"]
        self.assertEqual(video["samples"], 4)
        self.assertEqual(video["p50_ms"], 1250)
        self.assertEqual(video["p95_ms"], 1800)
        self.assertEqual(payload["local_photo_page_modes"][0]["mode"], "tab-return")
        self.assertFalse(video["is_physical_device_measurement"])

    def test_verified_100k_jump_has_separate_metric_from_actual_frames(self):
        payload = module.summarize(
            "IOS_NATIVE_FILES_JUMP_VERIFIED_MS value=44\n"
            "IOS_NATIVE_FILES_JUMP_VERIFIED_MS value=97\n"
        )
        jump = payload["file_jump_verified"]
        self.assertEqual(jump["samples"], 2)
        self.assertEqual(jump["p50_ms"], 70.5)
        self.assertEqual(jump["p95_ms"], 97)
        self.assertIn("NOT rendered FPS", jump["metric"])
        self.assertEqual(payload["video_first_displayed_frame"]["samples"], 0)

    def test_unbounded_and_unrelated_events_are_rejected(self):
        payload = module.summarize(
            "IOS_NATIVE_FILES_VIDEO_FIRST_FRAME_MS stage=readyToPlay value=0\n"
            "IOS_NATIVE_FILES_VIDEO_FIRST_FRAME_MS stage=layer-ready value=9999999\n"
            "IOS_NATIVE_FILES_VIDEO_FIRST_FRAME_MS stage=layer-ready value=28\n"
        )
        self.assertEqual(payload["video_first_displayed_frame"]["samples"], 1)
        self.assertEqual(payload["video_first_displayed_frame"]["p50_ms"], 28)


    def test_native_page_n3_complete_percentiles(self):
        logs = "\n".join(
            "IOS_NATIVE_PAGE_PERF_MS route=%s phase=%s trial=%d value=%d"
            % (route, phase, trial, 20 + trial * 10)
            for route, phase in module.PAGE_PERF_REQUIRED
            for trial in (1, 2, 3)
        )
        report = module.summarize(logs)["page_performance"]
        self.assertTrue(report["complete"])
        self.assertEqual(report["required_route_count"], 19)
        self.assertEqual(len(report["samples"]), 19)
        self.assertEqual(report["missing_or_incomplete"], [])
        for row in report["samples"]:
            self.assertEqual(row["samples"], 3)
            self.assertEqual(row["p50_ms"], 40)
            self.assertEqual(row["p95_ms"], 50)
            self.assertTrue(row["complete_n3"])
        self.assertFalse(report["is_frame_time_or_fps"])

    def test_native_page_duplicate_and_missing_samples_are_not_success(self):
        route, phase = module.PAGE_PERF_REQUIRED[0]
        logs = "\n".join(
            f"IOS_NATIVE_PAGE_PERF_MS route={route} phase={phase} trial={n} value=12"
            for n in (1, 1, 2)
        )
        report = module.summarize(logs)["page_performance"]
        self.assertFalse(report["complete"])
        self.assertEqual(report["samples"][0]["distinct_trials"], 2)
        self.assertFalse(report["samples"][0]["complete_n3"])
        self.assertEqual(len(module.summarize("")["page_performance"]["missing_or_incomplete"]), 19)

    def test_native_page_unregistered_or_invalid_sample_is_rejected(self):
        route, phase = module.PAGE_PERF_REQUIRED[0]
        logs = (
            f"IOS_NATIVE_PAGE_PERF_MS route={route} phase={phase} trial=1 value=999999\n"
            "IOS_NATIVE_PAGE_PERF_MS route=unknown phase=warm trial=1 value=20\n"
        )
        report = module.summarize(logs)["page_performance"]
        self.assertFalse(report["complete"])
        self.assertEqual(report["rejected_timing_count"], 1)
        self.assertEqual(report["unexpected_routes"], [{"route": "unknown", "phase": "warm"}])


if __name__ == "__main__":
    unittest.main()
