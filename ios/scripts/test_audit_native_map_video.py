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

    def test_minimum_evidence_never_passes_on_empty_or_short_movie(self):
        result = audit.audit_frames(
            [self.content] * 5, skip_frames=4, min_observed=3)
        self.assertFalse(result["pass"])
        self.assertEqual(result["observed_frames"], 1)


if __name__ == "__main__":
    unittest.main()
