import json
import pathlib
import sys
from unittest.mock import patch
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from files_ui_transition_video import (
    TARGETS, classify_bright_blank, parse_signalstats, audit,
)


class FilesUITransitionVideoTests(unittest.TestCase):
    def test_real_targets_are_distinct(self):
        self.assertEqual(len(TARGETS), 6)

    def test_empty_frame_samples_cannot_pass(self):
        self.assertEqual(classify_bright_blank([], 0.2),
                         "missing_post_tap_frames")

    def test_solid_white_blink_rejected(self):
        frames = [
            {"time": 0.35 + i * 0.1, "ymin": 250, "ymax": 253, "yavg": 252}
            for i in range(7)
        ]
        self.assertEqual(classify_bright_blank(frames, 0.1),
                         "suspected_solid_white_transition")

    def test_ffmpeg_limited_yuv_white_is_not_missed(self):
        # Real ffmpeg signalstats of a pure white H264/MPEG4 frame: Y=235,
        # not RGB 255. Regression for threshold mistakenly set at 242.
        frames = [
            {"time": 0.35 + i * 0.1, "ymin": 235, "ymax": 235, "yavg": 235}
            for i in range(8)
        ]
        self.assertEqual(classify_bright_blank(frames, 0.1),
                         "suspected_solid_white_transition")

    def test_textured_frames_are_not_solid_white(self):
        frames = [
            {"time": 0.35 + i * 0.1, "ymin": 14, "ymax": 251, "yavg": 220}
            for i in range(8)
        ]
        self.assertIsNone(classify_bright_blank(frames, 0.1))

    def test_single_white_frame_does_not_claim_flicker(self):
        frames = [
            {"time": 0.35 + i * 0.1,
             "ymin": 251 if i == 3 else 12, "ymax": 253,
             "yavg": 252 if i == 3 else 181}
            for i in range(8)
        ]
        self.assertIsNone(classify_bright_blank(frames, 0.1))

    def test_video_metadata_decode(self):
        sample = ("frame:0 pts:0 pts_time:0.1\n"
                  "lavfi.signalstats.YMIN=11\nlavfi.signalstats.YMAX=250\n"
                  "lavfi.signalstats.YAVG=220\n"
                  "frame:1 pts:1 pts_time:0.2\n"
                  "lavfi.signalstats.YMIN=16\nlavfi.signalstats.YMAX=251\n"
                  "lavfi.signalstats.YAVG=221\n")
        frames = parse_signalstats(sample)
        self.assertEqual(len(frames), 2)
        self.assertEqual(frames[1]["time"], 0.2)
        self.assertEqual(frames[0]["ymin"], 11)

    def _audit_sample(self, **changes):
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d)
            name = sorted(TARGETS)[0]
            (root / (name + ".mp4")).write_bytes(b"sample-video" * 400)
            entry = {
                "test": name, "file": name + ".mp4", "recorded": True,
                "tap_markers": [{"route": "native-ios-tab-files", "at": 0.6}],
                "record_exit": 0, "stop_reason": "test_finished",
                "test_outcome": "passed",
            }
            entry.update(changes)
            (root / "clips.jsonl").write_text(json.dumps(entry) + "\n")
            report = root / "audit.json"
            frames = [
                {"time": i / 10, "ymin": 12, "ymax": 246, "yavg": 175}
                for i in range(26)
            ]
            with patch("files_ui_transition_video.read_frames", return_value=frames):
                accepted = audit(root, report, 1)
            return accepted, json.loads(report.read_text())

    def test_completed_real_case_and_recording_passes(self):
        accepted, report = self._audit_sample()
        self.assertTrue(accepted, report)
        self.assertEqual(report["validated_clips"], 1)

    def test_failed_xctest_does_not_pass_with_usable_mp4(self):
        accepted, report = self._audit_sample(test_outcome="failed")
        self.assertFalse(accepted)
        self.assertIn("test_not_passed", report["clips"][0]["failures"])

    def test_bounded_timeout_does_not_pass_as_complete_case(self):
        accepted, report = self._audit_sample(stop_reason="bounded_timeout")
        self.assertFalse(accepted)
        self.assertIn("incomplete_test_recording", report["clips"][0]["failures"])

    def test_recording_process_failure_cannot_pass(self):
        accepted, report = self._audit_sample(record_exit=-2)
        self.assertFalse(accepted)
        self.assertIn("recording_process_failed", report["clips"][0]["failures"])

    def test_no_real_pre_tap_frames_cannot_prove_continuity(self):
        accepted, report = self._audit_sample(
            tap_markers=[{"route": "native-ios-tab-files", "at": 0.05}]
        )
        self.assertFalse(accepted)
        self.assertIn("missing_pre_tap_frames", report["clips"][0]["failures"])

    def test_unregistered_tap_marker_cannot_pass(self):
        accepted, report = self._audit_sample(
            tap_markers=[{"route": "fake-tap-marker", "at": 0.6}]
        )
        self.assertFalse(accepted)
        self.assertIn("invalid_native_tap_marker", report["clips"][0]["failures"])

    def test_zero_requested_clips_does_not_green_empty_audit(self):
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d)
            self.assertFalse(audit(root, root / "report.json", 0))

    def test_no_clips_fails_closed_and_writes_audit(self):
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d)
            report = root / "report.json"
            self.assertFalse(audit(root, report, 4))
            self.assertIn('"status": "fail"', report.read_text())

    def test_decoder_zero_frames_fails_closed(self):
        import json
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d)
            name = sorted(TARGETS)[0]
            (root / (name + ".mp4")).write_bytes(b"0" * 4097)
            (root / "clips.jsonl").write_text(
                json.dumps({"test": name, "file": name + ".mp4",
                            "recorded": True, "tap_markers": [{"at": 0.3}]}) + "\n"
            )
            report = root / "audit.json"
            with patch("files_ui_transition_video.read_frames", return_value=[]):
                self.assertFalse(audit(root, report, 1))
            self.assertIn("missing_decoded_video_frames", report.read_text())

    def test_fake_or_missing_video_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d)
            name = sorted(TARGETS)[0]
            (root / "clips.jsonl").write_text(
                '{"test":"' + name + '","file":"' + name +
                '.mp4","recorded":true,"tap_markers":[{"at":0.3}]}')
            report = root / "audit.json"
            self.assertFalse(audit(root, report, 1))
            self.assertIn("missing_real_recording", report.read_text())


if __name__ == "__main__":
    unittest.main()
