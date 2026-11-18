#!/usr/bin/env python3
"""Evidence tests for timestamp-aligned map journey (no guessed warmup)."""
from datetime import datetime, timezone
import unittest

from audit_native_map_journey import navigation_start_seconds
from audit_native_map_video import audit_frames, WIDTH, HEIGHT


def genuine_log(*, events=True, passed=True):
    rows = [
        "Test Suite 'XDriveIOSMapNavigationRuntimeUITests' started at "
        "2026-11-16 08:11:19.492.",
        '    t = 13.93s Tap "native-ios-launcher-map" Button',
    ]
    if events:
        for _ in range(3):
            for name in ("native-ios-map-place-marker",
                         "native-ios-map-place-viewer",
                         "native-ios-map-viewer-back",
                         "native-ios-map-place-dismiss"):
                rows.append("IOS_NATIVE_NAV_TAP_START route=" + name)
    if passed:
        rows.append(
            "Test Case '-[xDriveIOSNavigationUITests."
            "XDriveIOSMapNavigationRuntimeUITests "
            "testP0RapidPlaceWallViewerReturnKeepsMapAndGalleryMounted]' passed "
            "(84.354 seconds)."
        )
    return "\n".join(rows)


class MapKitJourneyEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.created = datetime(2026, 11, 16, 8, 11, 3,
                                tzinfo=timezone.utc)

    def test_actual_movie_and_xctest_taps_bound_all_navigation(self):
        seconds, details = navigation_start_seconds(genuine_log(), self.created)
        self.assertAlmostEqual(seconds, 28.422, places=3)
        self.assertEqual(len(details["verified_route_taps"]), 12)

    def test_missing_taps_cannot_pass_as_empty_navigation(self):
        with self.assertRaises(ValueError):
            navigation_start_seconds(genuine_log(events=False), self.created)

    def test_failing_native_test_cannot_pass_movie_audit(self):
        with self.assertRaises(ValueError):
            navigation_start_seconds(genuine_log(passed=False), self.created)

    def test_annotated_flat_segment_is_not_accepted_as_navigation_success(self):
        white = bytes((255, 255, 255)) * (WIDTH * HEIGHT)
        black = bytes((0, 0, 0)) * (WIDTH * HEIGHT)
        result = audit_frames([white] * 4 + [black] * 5,
                              skip_frames=4, min_observed=5)
        self.assertFalse(result["pass"])
        self.assertEqual(result["longest_flat_content_segment"]["duration_frames"], 5)
        self.assertEqual(
            result["flat_content_segments_at_least_3_frames"][0]["first_movie_frame_zero_based"], 4)

    def test_pretest_startup_is_reported_and_later_navigational_flash_fails(self):
        white = bytes((255, 255, 255)) * (WIDTH * HEIGHT)
        black = bytes((0, 0, 0)) * (WIDTH * HEIGHT)
        result = audit_frames([white] * 4 + [black] * 4,
                              skip_frames=4, min_observed=4)
        self.assertEqual(result["pre_journey_nearly_white_or_black_frames"], 4)
        self.assertFalse(result["pass"])
        self.assertEqual(result["longest_consecutive_flat_content_frames"], 4)


if __name__ == "__main__":
    unittest.main()
