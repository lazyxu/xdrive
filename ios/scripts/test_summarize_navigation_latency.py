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

    def test_unbounded_and_unrelated_events_are_rejected(self):
        payload = module.summarize(
            "IOS_NATIVE_FILES_VIDEO_FIRST_FRAME_MS stage=readyToPlay value=0\n"
            "IOS_NATIVE_FILES_VIDEO_FIRST_FRAME_MS stage=layer-ready value=9999999\n"
            "IOS_NATIVE_FILES_VIDEO_FIRST_FRAME_MS stage=layer-ready value=28\n"
        )
        self.assertEqual(payload["video_first_displayed_frame"]["samples"], 1)
        self.assertEqual(payload["video_first_displayed_frame"]["p50_ms"], 28)


if __name__ == "__main__":
    unittest.main()
