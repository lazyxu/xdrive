#!/usr/bin/env python3
"""Unit tests for strict frame-by-frame analysis; real video comes from simctl."""
import importlib.util
import pathlib
import unittest


script = pathlib.Path(__file__).with_name("audit_native_map_video.py")
spec = importlib.util.spec_from_file_location("audit_native_map_video", script)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class NativeMapVideoAuditTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.blank = bytes((255, 255, 255)) * (audit.WIDTH * audit.HEIGHT)
        cls.black = bytes((0, 0, 0)) * (audit.WIDTH * audit.HEIGHT)
        sample = bytearray()
        for y in range(audit.HEIGHT):
            for x in range(audit.WIDTH):
                sample.extend(((x * 7 + y * 3) % 256,
                               (x * 11 + y * 5) % 256,
                               (x * 13 + y * 9) % 256))
        cls.content = bytes(sample)

    def test_real_nonflat_content_is_accepted(self):
        result = audit.audit_frames(
            [self.content] * 6, skip_frames=0, min_observed=6)
        self.assertTrue(result["pass"])
        self.assertEqual(result["nearly_white_or_black_frames"], 0)

    def test_three_consecutive_white_frames_fail(self):
        result = audit.audit_frames(
            [self.content, self.blank, self.blank, self.blank, self.content],
            skip_frames=0, min_observed=5)
        self.assertFalse(result["pass"])
        self.assertEqual(result["longest_consecutive_flat_content_frames"], 3)

    def test_three_consecutive_black_frames_fail(self):
        result = audit.audit_frames(
            [self.content, self.black, self.black, self.black, self.content],
            skip_frames=0, min_observed=5)
        self.assertFalse(result["pass"])
        self.assertEqual(result["longest_consecutive_flat_content_frames"], 3)

    def test_one_frame_transient_is_reported_not_silently_dropped(self):
        result = audit.audit_frames(
            [self.content, self.blank, self.content, self.content],
            skip_frames=0, min_observed=4)
        self.assertTrue(result["pass"])
        self.assertEqual(result["nearly_white_or_black_frames"], 1)
        self.assertFalse(result["proves_zero_unobserved_flicker"])

    def test_report_exact_95_frame_flat_interval_and_keep_failure(self):
        # Reproduces the actual 95-frame flat period detected by MapKit CI.
        result = audit.audit_frames(
            [self.content] * 4 + [self.blank] * 95 +
            [self.content] * 4, skip_frames=4, min_observed=120)
        self.assertFalse(result["pass"])
        self.assertEqual(result["longest_consecutive_flat_content_frames"], 95)
        segment = result["longest_flat_content_segment"]
        self.assertEqual(segment["first_movie_frame_zero_based"], 4)
        self.assertEqual(segment["last_movie_frame_zero_based"], 98)
        self.assertEqual(segment["duration_frames"], 95)
        self.assertEqual(segment["kind"], "white")
        self.assertEqual(segment["seconds_after_audit_scope_start"], 0)
        self.assertEqual(result["flat_content_segment_count"], 1)

    def test_real_map_movie_offsets_do_not_hide_post_skip_blank_frames(self):
        result = audit.audit_frames(
            [self.black] * 4 + [self.content] * 4 +
            [self.black] * 3 + [self.content] * 4,
            skip_frames=4, min_observed=11)
        self.assertFalse(result["pass"])
        self.assertEqual(result["pre_journey_nearly_white_or_black_frames"], 4)
        segment = result["flat_content_segments_at_least_3_frames"][0]
        self.assertEqual(segment["first_movie_frame_zero_based"], 8)
        self.assertEqual(segment["last_movie_frame_zero_based"], 10)
        self.assertEqual(segment["kind"], "black")

    def test_all_flat_to_movie_end_is_not_silently_discarded(self):
        result = audit.audit_frames(
            [self.content] * 3 + [self.black] * 3,
            skip_frames=0, min_observed=6)
        self.assertFalse(result["pass"])
        self.assertEqual(result["longest_flat_content_segment"]["duration_frames"], 3)

    def test_minimum_evidence_never_passes_on_empty_or_short_movie(self):
        result = audit.audit_frames(
            [self.content] * 5, skip_frames=4, min_observed=3)
        self.assertFalse(result["pass"])
        self.assertEqual(result["observed_frames"], 1)


if __name__ == "__main__":
    unittest.main()
