import json
import pathlib
import shutil
import subprocess
import sys
from unittest.mock import patch
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from files_ui_transition_video import (
    TARGETS, MAX_CLIP_SECONDS, classify_bright_blank, parse_signalstats, audit,
    read_frames,
)


class FilesUITransitionVideoTests(unittest.TestCase):
    def test_real_targets_are_distinct(self):
        self.assertEqual(len(TARGETS), 18)
        self.assertTrue({
            "testFilesSavedSearchesRepeatedDismissalAndGalleryRoundTrips",
            "testFilesOperationHistoryThenSavedSearchesKeepsBothSheetsIndependent",
            "testFilesCloudDenialThenQuickSectionsKeepNativeContent",
            "testLocalPhotoTimelineSheetRepeatedAfterFilesReturns",
            "testGalleryPeopleRepeatedBackAndFilesReentryKeepsContent",
            "testGallerySourceFilterAndOriginalsRepeatedFilesReturn",
            "testFilesSizeFilterHorizontalGalleryReturn",
            "testFilesDateThenSizeFiltersKeepNoSessionGuard",
            "testFilesSizeFilterAfterQuickRailReentry",
            "testFilesSizeFilterAfterSavedSearchesDismiss",
            "testFilesSizeFilterAfterCloudDenialReturn",
            "testFilesSizeFilterAfterForegroundResume",
        }.issubset(TARGETS))

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

    def test_immediate_post_tap_white_blink_is_not_skipped(self):
        # The old +0.12s cutoff lost the 0.2s frame after a 0.1s tap.
        frames = [
            {"time": i / 10,
             "ymin": 235 if i in (2, 3) else 14,
             "ymax": 235 if i in (2, 3) else 244,
             "yavg": 235 if i in (2, 3) else 165}
            for i in range(20)
        ]
        self.assertEqual(classify_bright_blank(frames, 0.1),
                         "suspected_solid_white_transition")

    def test_two_solid_black_video_frames_are_rejected(self):
        frames = [
            {"time": i / 10,
             "ymin": 16 if i in (4, 5) else 12,
             "ymax": 16 if i in (4, 5) else 250,
             "yavg": 16 if i in (4, 5) else 180}
            for i in range(20)
        ]
        self.assertEqual(classify_bright_blank(frames, 0.2),
                         "suspected_solid_black_transition")

    def test_single_solid_black_frame_is_not_called_a_blackout(self):
        frames = [
            {"time": i / 10,
             "ymin": 16 if i == 4 else 12,
             "ymax": 16 if i == 4 else 250,
             "yavg": 16 if i == 4 else 180}
            for i in range(20)
        ]
        self.assertIsNone(classify_bright_blank(frames, 0.2))

    def test_real_dark_textured_ui_is_not_mistaken_for_solid_black(self):
        frames = [
            {"time": i / 10, "ymin": 16, "ymax": 61, "yavg": 23}
            for i in range(20)
        ]
        self.assertIsNone(classify_bright_blank(frames, 0.2))

    def test_limited_range_black_synthetic_video_is_rejected(self):
        frames = [
            {"time": i / 10, "ymin": 17, "ymax": 19, "yavg": 18}
            for i in range(20)
        ]
        self.assertEqual(classify_bright_blank(frames, 0.2),
                         "suspected_solid_black_transition")

    def test_out_of_range_decoded_signalstats_fails_closed(self):
        frames = [
            {"time": i / 10, "ymin": 12, "ymax": 246, "yavg": 175}
            for i in range(26)
        ]
        frames[10] = {"time": 1.0, "ymin": 12, "ymax": 300, "yavg": 175}
        accepted, report = self._audit_sample(frames=frames)
        self.assertFalse(accepted)
        self.assertIn("invalid_frame_signalstats", report["clips"][0]["failures"])

    def test_nonfinite_decoded_luminance_fails_closed(self):
        frames = [
            {"time": i / 10, "ymin": 12, "ymax": 246, "yavg": 175}
            for i in range(26)
        ]
        frames[10] = {"time": 1.0, "ymin": 12,
                      "ymax": 246, "yavg": float("nan")}
        accepted, report = self._audit_sample(frames=frames)
        self.assertFalse(accepted)
        self.assertIn("invalid_frame_signalstats", report["clips"][0]["failures"])

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

    def _audit_sample(self, frames=None, **changes):
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d)
            name = sorted(TARGETS)[0]
            (root / (name + ".mp4")).write_bytes(b"sample-video" * 400)
            entry = {
                "test": name, "file": name + ".mp4", "recorded": True,
                "tap_markers": [{"route": "native-ios-tab-files", "at": 0.6}],
                "record_exit": 0, "stop_reason": "test_finished",
                "test_outcome": "passed", "elapsed": 2.8,
            }
            entry.update(changes)
            (root / "clips.jsonl").write_text(json.dumps(entry) + "\n")
            report = root / "audit.json"
            if frames is None:
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
                            "recorded": True,
                            "tap_markers": [{"route": "native-ios-tab-files", "at": 0.3}],
                            "record_exit": 0, "stop_reason": "test_finished",
                            "test_outcome": "passed"}) + "\n"
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


    def test_long_running_sixty_second_xctest_is_not_cut_at_26_seconds(self):
        self.assertGreaterEqual(MAX_CLIP_SECONDS, 70)
        self.assertLessEqual(MAX_CLIP_SECONDS, 120)

    def test_recorder_prelude_plus_longest_xctest_fits_real_recording_cap(self):
        # Prior real recordings first emitted frames as much as ~17s after
        # recordVideo was spawned; six XCTest targets now allow a 24s prelude.
        # A 60s navigation case must not be cut off by the recording cap.
        self.assertGreaterEqual(MAX_CLIP_SECONDS, 24 + 60 + 20)

    def test_real_recorder_startup_is_aligned_before_white_frame_audit(self):
        # The MP4 PTS clock begins after recordVideo startup; using wall-clock
        # tap seconds without alignment silently misses the recorded white flash.
        frames = [
            {"time": i / 10, "ymin": 235 if i in (15, 16) else 12,
             "ymax": 235 if i in (15, 16) else 246,
             "yavg": 235 if i in (15, 16) else 175}
            for i in range(60)
        ]
        accepted, report = self._audit_sample(
            frames=frames, elapsed=9.3,
            tap_markers=[{"route": "native-ios-tab-files", "at": 4.8}],
        )
        self.assertFalse(accepted)
        self.assertIn("suspected_solid_white_transition",
                      report["clips"][0]["failures"])

    def test_real_recorder_startup_alignment_can_preserve_good_frames(self):
        accepted, report = self._audit_sample(
            elapsed=5.3,
            tap_markers=[{"route": "native-ios-tab-files", "at": 3.4}],
        )
        self.assertTrue(accepted, report)
        self.assertGreater(report["clips"][0]["estimated_recording_startup_seconds"], 2)

    def test_negative_recorder_clock_offset_fails_closed(self):
        accepted, report = self._audit_sample(elapsed=1.0)
        self.assertFalse(accepted)
        self.assertIn("unreliable_recording_clock_alignment",
                      report["clips"][0]["failures"])

    def test_excessive_recorder_clock_offset_fails_closed(self):
        accepted, report = self._audit_sample(elapsed=40.0)
        self.assertFalse(accepted)
        self.assertIn("unreliable_recording_clock_alignment",
                      report["clips"][0]["failures"])

    def test_missing_or_non_numeric_wall_clock_fails_closed(self):
        accepted, report = self._audit_sample(elapsed="unknown")
        self.assertFalse(accepted)
        self.assertIn("invalid_recording_elapsed", report["clips"][0]["failures"])

    def test_tap_before_recorded_old_page_fails_closed(self):
        accepted, report = self._audit_sample(
            tap_markers=[{"route": "native-ios-tab-files", "at": 0.15}],
        )
        self.assertFalse(accepted)
        self.assertIn("missing_pre_tap_frames", report["clips"][0]["failures"])

    def test_tap_beyond_last_decoded_frame_fails_closed(self):
        accepted, report = self._audit_sample(
            tap_markers=[{"route": "native-ios-tab-files", "at": 5.0}],
        )
        self.assertFalse(accepted)
        self.assertIn("invalid_tap_timeline", report["clips"][0]["failures"])


class FilesUIContentVideoCodecRegressionTests(unittest.TestCase):
    """Real encoded fixtures: visible app chrome must not hide child flicker.

    Synthetic codec fixtures are not physical 60/120 Hz measurements.
    Required Gallery/Files CI installs FFmpeg before running these tests.
    """

    @classmethod
    def setUpClass(cls):
        if shutil.which("ffmpeg") is None:
            raise unittest.SkipTest("FFmpeg unavailable outside required Gallery/Files shard")

    def _decoded_chrome_page(self, *pulses):
        # Dark top/bottom navigation chrome persists through a transient
        # white/black Files or Gallery child. Full-screen signalstats misses it.
        with tempfile.TemporaryDirectory() as tmp:
            recording = pathlib.Path(tmp) / "native-with-stable-chrome.mp4"
            layers = [
                "drawbox=x=0:y=0:w=iw:h=100:color=0x1f1f33:t=fill",
                "drawbox=x=0:y=555:w=iw:h=85:color=0x222244:t=fill",
                "drawbox=x=28:y=172:w=304:h=280:color=0x6699bb:t=fill",
            ]
            for color, start, end in pulses:
                layers.append(
                    f"drawbox=x=0:y=95:w=iw:h=465:color={color}:t=fill:"
                    f"enable=between(t\\,{start}\\,{end})"
                )
            subprocess.run(
                ["ffmpeg", "-y", "-nostdin", "-hide_banner", "-loglevel", "error",
                 "-f", "lavfi", "-i", "color=c=0xd9deed:s=360x640:r=10:d=3",
                 "-vf", ",".join(layers), "-c:v", "libx264",
                 "-pix_fmt", "yuv420p", str(recording)],
                check=True, capture_output=True, text=True, timeout=30,
            )
            return read_frames(recording)

    def test_content_only_white_flash_with_stable_chrome_is_detected(self):
        frames = self._decoded_chrome_page(("white", 1.05, 1.35))
        self.assertEqual(classify_bright_blank(frames, 1.0),
                         "suspected_solid_white_transition")

    def test_content_only_black_flash_with_stable_chrome_is_detected(self):
        frames = self._decoded_chrome_page(("black", 1.05, 1.35))
        self.assertEqual(classify_bright_blank(frames, 1.0),
                         "suspected_solid_black_transition")

    def test_alternating_white_black_flash_does_not_escape_two_frame_gate(self):
        # Neither same-color streak alone reaches two frames.
        frames = self._decoded_chrome_page(
            ("white", 1.05, 1.15), ("black", 1.15, 1.25)
        )
        self.assertEqual(classify_bright_blank(frames, 1.0),
                         "suspected_alternating_blank_transition")

    def test_one_white_frame_is_diagnostic_not_a_false_flicker_verdict(self):
        frames = self._decoded_chrome_page(("white", 1.05, 1.15))
        self.assertIsNone(classify_bright_blank(frames, 1.0))

    def test_later_content_only_flash_in_transition_window_is_detected(self):
        frames = self._decoded_chrome_page(("white", 1.85, 2.05))
        self.assertEqual(classify_bright_blank(frames, 1.0),
                         "suspected_solid_white_transition")

    def test_stable_native_chrome_and_textured_content_are_not_blank(self):
        frames = self._decoded_chrome_page()
        self.assertGreaterEqual(len(frames), 20)
        self.assertIsNone(classify_bright_blank(frames, 1.0))

    def test_old_page_flash_before_tap_is_not_misattributed(self):
        frames = self._decoded_chrome_page(("white", 0.25, 0.45))
        self.assertIsNone(classify_bright_blank(frames, 1.0))

    def test_two_disconnected_white_samples_are_not_called_continuous(self):
        frames = self._decoded_chrome_page(
            ("white", 1.05, 1.15), ("white", 1.45, 1.55)
        )
        self.assertIsNone(classify_bright_blank(frames, 1.0))


if __name__ == "__main__":
    unittest.main()
