import pathlib
import sys
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

    def test_no_clips_fails_closed_and_writes_audit(self):
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d)
            report = root / "report.json"
            self.assertFalse(audit(root, report, 4))
            self.assertIn('"status": "fail"', report.read_text())

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
