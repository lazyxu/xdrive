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
        self.assertEqual(len(TARGETS), 56)
        self.assertTrue({
            "testFilesSavedSearchesRepeatedDismissalAndGalleryRoundTrips",
            "testFilesOperationHistoryThenSavedSearchesKeepsBothSheetsIndependent",
            "testFilesCloudDenialThenQuickSectionsKeepNativeContent",
            "testLocalPhotoTimelineSheetRepeatedAfterFilesReturns",
            "testGalleryPeopleRepeatedBackAndFilesReentryKeepsContent",
            "testGallerySourceFilterAndOriginalsRepeatedFilesReturn",
        }.issubset(TARGETS))

    def test_eight_existing_navigation_cases_now_require_real_video(self):
        self.assertTrue({
            "testLocalPhotoGalleryFilesRoundTripsKeepRealNativePixels",
            "testCloudOriginalsFilesRapidReturnKeepsNativeChild",
            "testCloudOriginalsHelpDismissFilesReturnKeepsChild",
            "testFilesOperationHistoryBackgroundThenFilesGalleryReturn",
            "testGalleryPeopleChildBackThenFilesReturnRetainsVisualHierarchy",
            "testNoSessionCloudDenialReturnsToFilesAndGalleryWithoutBlankPage",
            "testGalleryAlbumsOriginalsAndUnifiedRoundTripsKeepPixels",
            "testLocalPhotoTimelineDateSheetDismissThenFilesReturnKeepsContent",
        }.issubset(TARGETS))

    def test_six_cross_subpage_journeys_have_real_video_targets(self):
        self.assertTrue({
            "testFilterPeopleDeniedCloudReturnKeepsVerifiedGalleryGeneration",
            "testFilesHistorySavedSearchesAcrossOriginalsHaveNoGhostSheets",
            "testOriginalsHelpTrashDeniedReturnDoesNotReopenAlert",
            "testLocalPhotoDateAndFilesSavedSheetReturnKeepsPhotoKitChild",
            "testMapModalFilesCloudDenialDoesNotRemountUnifiedWall",
            "testFilesSearchKeyboardGalleryPeopleReturnHasNoGhostOverlay",
        }.issubset(TARGETS))

    def test_six_extra_return_and_rotation_journeys_have_real_video_targets(self):
        self.assertTrue({
            "testFilesHomeDeepScrollTabReturnKeepsQuickNavigation",
            "testFilesSearchFocusThenGalleryReturnPreservesShell",
            "testGalleryFilesRotateLandscapeAndReturnPortrait",
            "testGalleryPeopleAfterOfflineFilesErrorReturnHasNoSettledBlank",
            "testFilesSearchThenGalleryFilterAndBackKeepsBothRoutes",
            "testFilesHomeAfterRepeatedNativeGallerySourceChanges",
        }.issubset(TARGETS))

    def test_six_extra_native_gallery_files_video_routes_are_required(self):
        self.assertTrue({
            "testGallerySourcesAlternateWithoutLosingSourceRail",
            "testRepeatedFilterDismissalRestoresSameGallery",
            "testGalleryFilterCancelAfterTabAndSourceRoundTrips",
            "testGalleryPeopleChildReturnRepeatsWithoutLosingGallerySource",
            "testFilesBackgroundResumeKeepsQuickRailAndPixels",
            "testLocalPhotoGalleryForegroundAndFilesReturnRemainNonBlank",
        }.issubset(TARGETS))

    def test_six_new_real_child_transitions_are_recorded(self):
        self.assertTrue({
            "testFilesMoreOrganizerGalleryReturnPreservesBrowseHome",
            "testFilesQuickRailRotationPeopleReturnKeepsNativeShell",
            "testGalleryFilterFilesHistoryForegroundKeepsWallGeneration",
            "testLocalPhotoDateSheetFilesQuickSectionsThenReopen",
            "testGalleryMapFilesSavedSearchesReturnKeepsGeneration",
            "testGalleryPeopleFiltersFilesTrashDenialReturnWithoutGhost",
        }.issubset(TARGETS))

    def test_six_additional_native_journeys_have_required_video_evidence(self):
        self.assertTrue({
            "testFilesTrashDenialQuickRailBounceDoesNotReviveError",
            "testFilesSavedSearchesForegroundGalleryReturnTwoCycles",
            "testFilesHistoryForegroundGalleryPeopleBackRetiresSheet",
            "testGalleryMapRotateFilesReturnPreservesWallGeneration",
            "testGalleryOriginalsFilesCloudErrorSourceReturnKeepsSurface",
            "testLocalPhotoDateRotateFilesHistoryReturnsRealPhotoKit",
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

    def test_single_white_frame_must_fail_flash_audit(self):
        frames = [
            {"time": 0.35 + i * 0.1,
             "ymin": 251 if i == 3 else 12, "ymax": 253,
             "yavg": 252 if i == 3 else 181}
            for i in range(8)
        ]
        self.assertEqual(classify_bright_blank(frames, 0.1),
                         "suspected_solid_white_transition")

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

    def test_single_black_frame_must_fail_flash_audit(self):
        frames = [
            {"time": i / 10,
             "ymin": 16 if i == 4 else 12,
             "ymax": 16 if i == 4 else 250,
             "yavg": 16 if i == 4 else 180}
            for i in range(20)
        ]
        self.assertEqual(classify_bright_blank(frames, 0.2),
                         "suspected_solid_black_transition")

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

    def test_single_30_hz_white_video_sample_is_not_silently_accepted(self):
        frames = [
            {"time": i / 30, "ymin": 235 if i == 13 else 12,
             "ymax": 235 if i == 13 else 250,
             "yavg": 235 if i == 13 else 175}
            for i in range(60)
        ]
        self.assertEqual(classify_bright_blank(frames, 0.3),
                         "suspected_solid_white_transition")

    def test_single_30_hz_black_video_sample_is_not_silently_accepted(self):
        frames = [
            {"time": i / 30, "ymin": 16 if i == 14 else 12,
             "ymax": 16 if i == 14 else 250,
             "yavg": 16 if i == 14 else 175}
            for i in range(60)
        ]
        self.assertEqual(classify_bright_blank(frames, 0.3),
                         "suspected_solid_black_transition")

    def test_textured_dark_30_hz_frames_remain_valid(self):
        frames = [
            {"time": i / 30, "ymin": 15, "ymax": 58, "yavg": 24}
            for i in range(60)
        ]
        self.assertIsNone(classify_bright_blank(frames, 0.3))

    # A valid, textured native page can briefly repaint its *content* to a
    # flat neutral colour while the Photos/Files chrome remains unchanged.
    # White/black-only classification missed this kind of real visible blink.
    def _neutral_transition_frames(self, indices, y):
        return [
            {"time": i / 10,
             "ymin": y if i in indices else 12,
             "ymax": y + 2 if i in indices else 246,
             "yavg": y + 1 if i in indices else 175}
            for i in range(26)
        ]

    def test_one_mid_gray_content_frame_is_not_considered_smooth(self):
        frames = self._neutral_transition_frames({10}, 125)
        self.assertEqual(classify_bright_blank(frames, 0.6),
                         "suspected_solid_neutral_transition")

    def test_two_light_gray_content_frames_are_not_hidden_by_chrome(self):
        frames = self._neutral_transition_frames({10, 11}, 218)
        self.assertEqual(classify_bright_blank(frames, 0.6),
                         "suspected_solid_neutral_transition")

    def test_near_black_gray_content_pulse_is_not_a_valid_dark_page(self):
        frames = self._neutral_transition_frames({11}, 36)
        self.assertEqual(classify_bright_blank(frames, 0.6),
                         "suspected_solid_neutral_transition")

    def test_full_neutral_content_replacement_must_not_pass_transition(self):
        frames = self._neutral_transition_frames(set(range(7, 26)), 119)
        self.assertEqual(classify_bright_blank(frames, 0.6),
                         "suspected_solid_neutral_transition")

    def test_no_immediate_decoded_post_tap_frames_must_not_pass(self):
        frames = [
            {"time": i / 10, "ymin": 12, "ymax": 246, "yavg": 175}
            for i in range(26) if i not in {7, 8, 9, 10}
        ]
        self.assertEqual(classify_bright_blank(frames, 0.6),
                         "missing_immediate_post_tap_frames")

    def test_missing_early_transition_frames_must_not_pass(self):
        frames = [
            {"time": i / 10, "ymin": 12, "ymax": 246, "yavg": 175}
            for i in range(26) if i not in {9, 10, 11}
        ]
        self.assertEqual(classify_bright_blank(frames, 0.6),
                         "sparse_early_transition_frames")

    def test_single_early_frame_followed_by_late_gap_cannot_pass(self):
        # A single +0.1s decoded frame, followed by 1.1s without any
        # H264 samples, was falsely accepted by an early-only pair scan.
        frames = [
            {"time": i / 10, "ymin": 12, "ymax": 246, "yavg": 175}
            for i in range(26) if i not in set(range(8, 18))
        ]
        self.assertEqual(classify_bright_blank(frames, 0.6),
                         "sparse_early_transition_frames")

    def test_neutral_frame_rejection_reaches_real_video_gate(self):
        frames = self._neutral_transition_frames({10}, 131)
        accepted, report = self._audit_sample(frames=frames)
        self.assertFalse(accepted, report)
        self.assertIn("suspected_solid_neutral_transition",
                      report["clips"][0]["failures"])

    def test_textured_30hz_content_remains_a_valid_navigation_surface(self):
        frames = [
            {"time": i / 30, "ymin": 15, "ymax": 58, "yavg": 25}
            for i in range(70)
        ]
        self.assertIsNone(classify_bright_blank(frames, 0.6))

    def test_white_frame_in_first_20ms_is_not_skipped(self):
        frames = self._boundary_transition_frames(235, {31})
        self.assertEqual(classify_bright_blank(frames, 1.02),
                         "suspected_solid_white_transition")

    def test_black_frame_in_first_20ms_is_not_skipped(self):
        frames = self._boundary_transition_frames(16, {31})
        self.assertEqual(classify_bright_blank(frames, 1.02),
                         "suspected_solid_black_transition")

    def test_neutral_frame_in_first_20ms_is_not_skipped(self):
        frames = self._boundary_transition_frames(125, {31})
        self.assertEqual(classify_bright_blank(frames, 1.02),
                         "suspected_solid_neutral_transition")

    def test_half_second_neutral_repaint_is_not_a_smooth_transition(self):
        frames = self._boundary_transition_frames(125, set(range(37, 54)))
        self.assertEqual(classify_bright_blank(frames, 1.02),
                         "suspected_solid_neutral_transition")

    def test_missing_tail_inside_transition_window_is_not_accepted(self):
        # The video resumes only after the audit window, so the original
        # adjacent-frame scan saw no gap between in-window samples.
        frames = self._boundary_transition_frames(125, set())
        frames = [f for f in frames if not 1.8 < f["time"] < 2.5]
        self.assertEqual(classify_bright_blank(frames, 1.02),
                         "missing_transition_window_tail")

    def test_short_post_tap_clip_cannot_prove_transition_continuity(self):
        frames = self._boundary_transition_frames(125, set())
        frames = [f for f in frames if f["time"] <= 1.4]
        self.assertEqual(classify_bright_blank(frames, 1.02),
                         "missing_transition_window_tail")

    def test_frame_strictly_before_tap_is_not_misattributed(self):
        for y in (16, 125, 235):
            with self.subTest(y=y):
                self.assertIsNone(classify_bright_blank(
                    self._boundary_transition_frames(y, {30}), 1.02))

    def test_valid_bounded_transition_can_end_before_full_window(self):
        frames = self._boundary_transition_frames(125, set())
        self.assertIsNone(classify_bright_blank(
            [f for f in frames if f["time"] <= 1.9], 1.02))

    def _boundary_transition_frames(self, y, indices):
        return [
            {"time": i / 30, "ymin": y if i in indices else 12,
             "ymax": y if i in indices else 246,
             "yavg": y if i in indices else 175}
            for i in range(100)
        ]

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


    def test_real_139_second_xctest_is_not_truncated_at_old_120s_cap(self):
        # Original macOS test PASSED after 138.545s, while its MP4 stopped
        # at 120.067s. Timeouts remain fatal to the audit; the cap is sized
        # to actual complete-test evidence, not a synthetic "pass" flag.
        self.assertGreaterEqual(MAX_CLIP_SECONDS, 24 + 139 + 20)
        self.assertLessEqual(MAX_CLIP_SECONDS, 240)

    def test_recorder_prelude_plus_real_gallery_files_roundtrip_has_margin(self):
        # Some real clips began after ~17s; tests intentionally pre-roll
        # before native taps, and one confirmed XCTest lasted 138.545s.
        self.assertGreaterEqual(MAX_CLIP_SECONDS, 24 + 139 + 20)

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

    def test_recorded_22_second_macos_startup_requires_all_ten_real_tap_windows(self):
        # Actual 2026-11-18 Gallery/Files CI log, run 44214388579:
        # elapsed=73.006, 1532 decoded 30Hz frames (last PTS 51.033333),
        # first tap 36.765s; all ten pre-/post-tap windows were present.
        # These generated frames are a time-alignment regression fixture,
        # NOT a substitute for the required live H.264 frame audit.
        frames = [
            {"time": i / 30, "ymin": 12, "ymax": 246, "yavg": 175}
            for i in range(1532)
        ]
        routes = [
            ("native-ios-gallery-source-albums", 36.7645645),
            ("native-ios-tab-files", 43.866912417),
            ("native-ios-files-section-recent", 48.037306792),
            ("native-ios-files-section-favorites", 51.651266417),
            ("native-ios-files-section-browse", 54.9138765),
            ("native-ios-tab-gallery", 57.991403167),
            ("native-ios-gallery-source-originals", 60.893339625),
            ("native-ios-tab-files", 64.556443708),
            ("native-ios-tab-gallery", 67.531463292),
            ("native-ios-gallery-source-unified", 70.711240375),
        ]
        accepted, report = self._audit_sample(
            frames=frames, elapsed=73.006,
            tap_markers=[{"route": route, "at": at} for route, at in routes],
        )
        self.assertTrue(accepted, report)
        self.assertEqual(report["clips"][0]["taps"], 10)
        self.assertGreater(report["clips"][0]["estimated_recording_startup_seconds"], 21.9)
        self.assertLess(report["clips"][0]["estimated_recording_startup_seconds"], 24)

    def test_recorded_22_second_startup_cannot_hide_real_white_pulse(self):
        frames = [
            {"time": i / 30, "ymin": 235 if i in (448, 449) else 12,
             "ymax": 235 if i in (448, 449) else 246,
             "yavg": 235 if i in (448, 449) else 175}
            for i in range(1532)
        ]
        accepted, report = self._audit_sample(
            frames=frames, elapsed=73.006,
            tap_markers=[{"route": "native-ios-gallery-source-albums",
                          "at": 36.7645645}],
        )
        self.assertFalse(accepted)
        self.assertIn("suspected_solid_white_transition",
                      report["clips"][0]["failures"])

    def test_recorded_22_second_startup_rejects_unfilmed_early_tap(self):
        frames = [
            {"time": i / 30, "ymin": 12, "ymax": 246, "yavg": 175}
            for i in range(1532)
        ]
        accepted, report = self._audit_sample(
            frames=frames, elapsed=73.006,
            tap_markers=[{"route": "native-ios-gallery-source-albums",
                          "at": 22.0}],
        )
        self.assertFalse(accepted)
        self.assertIn("missing_pre_tap_frames", report["clips"][0]["failures"])

    def test_still_rejects_unexplained_over_24_second_video_clock_drift(self):
        frames = [
            {"time": i / 30, "ymin": 12, "ymax": 246, "yavg": 175}
            for i in range(1532)
        ]
        accepted, report = self._audit_sample(
            frames=frames, elapsed=77.0,
            tap_markers=[{"route": "native-ios-gallery-source-albums",
                          "at": 36.7645645}],
        )
        self.assertFalse(accepted)
        self.assertIn("unreliable_recording_clock_alignment",
                      report["clips"][0]["failures"])

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

    def test_alternating_white_black_flash_reports_first_blank_frame(self):
        # The first white frame is sufficient: no consecutive streak is required.
        frames = self._decoded_chrome_page(
            ("white", 1.05, 1.15), ("black", 1.15, 1.25)
        )
        self.assertEqual(classify_bright_blank(frames, 1.0),
                         "suspected_solid_white_transition")

    def test_one_brief_white_flash_with_stable_chrome_fails_gate(self):
        frames = self._decoded_chrome_page(("white", 1.05, 1.15))
        self.assertEqual(classify_bright_blank(frames, 1.0),
                         "suspected_solid_white_transition")

    def test_later_content_only_flash_in_transition_window_is_detected(self):
        frames = self._decoded_chrome_page(("white", 1.85, 2.05))
        self.assertEqual(classify_bright_blank(frames, 1.0),
                         "suspected_solid_white_transition")

    def test_h264_neutral_gray_child_flash_with_stable_chrome_is_detected(self):
        # Run the actual ffmpeg/libx264 decoder, not only hand-built YUV values.
        # The child has a gray repaint while native top/bottom chrome remains.
        frames = self._decoded_chrome_page(("gray", 1.05, 1.35))
        self.assertEqual(classify_bright_blank(frames, 1.0),
                         "suspected_solid_neutral_transition")

    def test_h264_single_gray_source_frame_is_not_mistaken_for_smooth(self):
        # The H264->30Hz decoder can duplicate one 10Hz frame; the gate must
        # still notice the real short child-only gray blink.
        frames = self._decoded_chrome_page(("gray", 1.05, 1.15))
        self.assertEqual(classify_bright_blank(frames, 1.0),
                         "suspected_solid_neutral_transition")

    def test_h264_gray_child_only_before_tap_is_not_misattributed(self):
        frames = self._decoded_chrome_page(("gray", 0.25, 0.45))
        self.assertIsNone(classify_bright_blank(frames, 1.0))

    def test_stable_native_chrome_and_textured_content_are_not_blank(self):
        frames = self._decoded_chrome_page()
        self.assertGreaterEqual(len(frames), 20)
        self.assertIsNone(classify_bright_blank(frames, 1.0))

    def test_old_page_flash_before_tap_is_not_misattributed(self):
        frames = self._decoded_chrome_page(("white", 0.25, 0.45))
        self.assertIsNone(classify_bright_blank(frames, 1.0))

    def test_two_separate_white_flashes_each_trigger_strict_gate(self):
        frames = self._decoded_chrome_page(
            ("white", 1.05, 1.15), ("white", 1.45, 1.55)
        )
        self.assertEqual(classify_bright_blank(frames, 1.0),
                         "suspected_solid_white_transition")


if __name__ == "__main__":
    unittest.main()
