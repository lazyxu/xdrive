"""Fail-closed synthetic regression tests for native iOS recorded-frame evidence."""
import json
import pathlib
import tempfile
import unittest
from unittest import mock

from navigation_video_probe import (
    MAX_CLIP_SECONDS, POST_TAP_SECONDS,
    TEST_ROUTES, VideoRecorder, assess_clip, audit, event,
    frame_timeline, timestamps_from_probe,
)


class MockProcess:
    def __init__(self):
        self.signals = []
        self.exit = None

    def poll(self):
        return self.exit

    def send_signal(self, sig):
        self.signals.append(sig)
        self.exit = 0

    def wait(self, timeout=None):
        return 0

    def kill(self):
        self.exit = -9


class VideoEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.root = pathlib.Path(self.dir.name)

    def clip(self, name='testRapidGalleryFilesTabOscillationPreservesBothShells', **overrides):
        row = {
            'test': name,
            'route_group': TEST_ROUTES[name],
            'first_tap_route': 'native-ios-tab-files',
            'first_tap_offset_s': 2.0,
            'stop_reason': 'bounded_post_tap_window',
            'duration_s': 12.0,
            'file': TEST_ROUTES[name] + '.mp4',
            'recorded': True,
        }
        row.update(overrides)
        (self.root / row['file']).write_bytes(b'mp4' * 512)
        return row

    @staticmethod
    def probe(_file):
        return {
            'frame_count': 120,
            'first_frame_s': 0,
            'last_frame_s': 10,
            'frame_interval_p50_ms': 33.3,
            'frame_interval_p95_ms': 33.3,
            'gaps_over_500ms': 0,
        }

    def test_real_xctest_start_and_exact_tap_not_fuzzy_matched(self):
        self.assertEqual(event(
            "Test Case '-[Suite.Case testRapidGalleryFilesTabOscillationPreservesBothShells]' started."),
            ('start', 'testRapidGalleryFilesTabOscillationPreservesBothShells'))
        self.assertEqual(event('IOS_NATIVE_NAV_TAP_START route=native-ios-tab-gallery'),
                         ('tap', 'native-ios-tab-gallery'))
        self.assertEqual(event(
            "Test Case '-[Suite.Case testRapidGalleryFilesTabOscillationPreservesBothShells]' passed (20s)."),
            ('finish', 'testRapidGalleryFilesTabOscillationPreservesBothShells'))
        self.assertIsNone(event('random owner-session tokens'))

    def test_delayed_simulator_h264_delivery_gets_a_bounded_real_window(self):
        # The previous CI artifact had 83/83 real XCTest passes, but H264
        # stopped before >=2s post-tap presentation for 9/16 routes. Allow
        # extra recording time, NEVER weaken the strict six-route audit.
        self.assertGreaterEqual(MAX_CLIP_SECONDS, 38)
        self.assertGreaterEqual(POST_TAP_SECONDS, 16)
        self.assertGreater(MAX_CLIP_SECONDS, POST_TAP_SECONDS + 2)

    def test_latest_six_native_child_routes_each_have_own_real_h264_group(self):
        names = ["testPeopleThreeFilesQuickRailCyclesKeepUnchangedUnifiedWall","testFilesSearchBackgroundOriginalsReturnHasNoGhostKeyboard","testOriginalsHelpTwiceAcrossFilesDenialNeverLeavesGhostAlert","testFilesTrashDeniedThenPeopleChildReturnClearsOverlay","testGalleryFilterDraftForegroundFilesReturnKeepsWallGeneration","testRapidAlbumsOriginalsFilesAlternationRetainsNativeChildShells"]
        groups = [TEST_ROUTES[name] for name in names]
        self.assertEqual(len(set(groups)), 6)
        self.assertTrue(all(group.endswith('.mp4') is False for group in groups))

    def test_six_or_more_distinct_real_route_groups(self):
        self.assertGreaterEqual(len(set(TEST_ROUTES.values())), 8)
        self.assertEqual(len(set(TEST_ROUTES)), len(TEST_ROUTES))

    def test_extended_recording_routes_are_real_native_xctest_journeys(self):
        # Candidate routes must exist as runnable real native UI methods.
        # No static placeholder, synthetic Server authentication, or fabricated
        # playback samples can satisfy the six-route video evidence gate.
        stability = (pathlib.Path(__file__).resolve().parents[1] /
                     'UITests/XDriveIOSGalleryFilesStabilityUITests.swift').read_text(
                         encoding='utf-8')
        self.assertEqual(len(TEST_ROUTES), 22)
        self.assertEqual(len(TEST_ROUTES), len(set(TEST_ROUTES.values())))
        for method in TEST_ROUTES:
            if method in (
                'testLocalPhotoTimelineDateSheetDismissThenFilesReturnKeepsContent',
                'testCloudOriginalsHelpDismissFilesReturnKeepsChild',
                'testFilesOperationHistorySheetDenialThenGalleryRetainsNativePages',
                'testFilesRecentFavoritesBrowseRapidSwitchRetainsReadableRail',
            ):
                path = (pathlib.Path(__file__).resolve().parents[1] /
                        'UITests/XDriveIOSGalleryFilesFrameContinuityUITests.swift')
                target = path.read_text(encoding='utf-8')
            elif method in (
                'testPeopleThreeFilesQuickRailCyclesKeepUnchangedUnifiedWall',
                'testFilesSearchBackgroundOriginalsReturnHasNoGhostKeyboard',
                'testOriginalsHelpTwiceAcrossFilesDenialNeverLeavesGhostAlert',
                'testFilesTrashDeniedThenPeopleChildReturnClearsOverlay',
                'testGalleryFilterDraftForegroundFilesReturnKeepsWallGeneration',
                'testRapidAlbumsOriginalsFilesAlternationRetainsNativeChildShells',
            ):
                path = (pathlib.Path(__file__).resolve().parents[1] /
                        'UITests/XDriveIOSGalleryFilesTransitionEdgeUITests.swift')
                target = path.read_text(encoding='utf-8')
            else:
                target = stability
            self.assertIn('func ' + method + '()', target)

    def test_rejection_diagnostics_do_not_weaken_required_six_video_routes(self):
        good = self.clip()
        bad = self.clip('testCloudOriginalsHelpDismissFilesReturnKeepsChild',
                        first_tap_offset_s=8.2)
        (self.root / 'trace.jsonl').write_text(
            '\n'.join(json.dumps(x) for x in [good, bad]) + '\n',
            encoding='utf-8')
        report = audit(self.root, required=6, probe=self.probe)
        self.assertFalse(report['pass'])
        self.assertEqual(report['usable_routes'], 1)
        self.assertEqual(report['required_routes'], 6)
        self.assertEqual(report['registered_routes'], 22)
        self.assertEqual(report['rejected_by_reason'], {'no_post_tap_video': 1})

    def test_video_timestamp_duplicate_negative_and_nan_fail(self):
        for raw in ['0.0\n0.0', '0.1\n0.09', '-0.1\n0.0',
                    'nan', 'inf', '0.0\nnot-time']:
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                timestamps_from_probe(raw)

    def test_real_ffprobe_frame_timeline_reports_large_interval(self):
        output = mock.Mock(stdout='0.000\n0.033\n0.067\n0.900\n0.933\n')
        runner = mock.Mock(return_value=output)
        report = frame_timeline(self.root / 'video.mp4', runner=runner)
        self.assertEqual(report['frame_count'], 5)
        self.assertEqual(report['gaps_over_500ms'], 1)
        self.assertEqual(report['frame_interval_p95_ms'], 833.0)
        self.assertIn('ffprobe', runner.call_args.args[0])

    def test_post_tap_only_decoded_frames_cannot_count_as_two_sided_video(self):
        row = self.clip(first_tap_offset_s=2.0)
        video = {**self.probe(None), 'first_frame_s': 2.2}
        result = assess_clip(row, self.root, probe=lambda _: video)
        self.assertFalse(result['usable'])
        self.assertEqual(result['reason'], 'no_pre_tap_video')

    def test_insufficient_pre_tap_recorded_window_is_rejected(self):
        row = self.clip(first_tap_offset_s=2.0)
        video = {**self.probe(None), 'first_frame_s': 1.1}
        self.assertEqual(
            assess_clip(row, self.root, probe=lambda _: video)['reason'],
            'no_pre_tap_video')

    def test_recorded_one_second_pre_tap_boundary_remains_eligible(self):
        row = self.clip(first_tap_offset_s=2.0)
        video = {**self.probe(None), 'first_frame_s': 1.0}
        self.assertTrue(assess_clip(row, self.root, probe=lambda _: video)['usable'])

    def test_missing_first_decoded_frame_cannot_be_accepted(self):
        row = self.clip(first_tap_offset_s=2.0)
        video = {**self.probe(None), 'first_frame_s': None}
        self.assertEqual(
            assess_clip(row, self.root, probe=lambda _: video)['reason'],
            'no_pre_tap_video')

    def test_pre_tap_rejection_preserves_six_route_requirement(self):
        bad = self.clip(first_tap_offset_s=2.0)
        (self.root / 'trace.jsonl').write_text(json.dumps(bad) + '\n')
        video = {**self.probe(None), 'first_frame_s': 2.5}
        report = audit(self.root, required=6, probe=lambda _: video)
        self.assertFalse(report['pass'])
        self.assertEqual(report['usable_routes'], 0)
        self.assertEqual(report['rejected_by_reason'], {'no_pre_tap_video': 1})

    def test_initial_white_launch_without_tap_is_not_false_pass(self):
        row = self.clip(first_tap_offset_s=None)
        self.assertEqual(
            assess_clip(row, self.root, probe=self.probe)['reason'],
            'missing_tap_marker')

    def test_instant_tap_without_pre_tap_video_is_not_accepted(self):
        row = self.clip(first_tap_offset_s=.15)
        self.assertEqual(
            assess_clip(row, self.root, probe=self.probe)['reason'],
            'pre_tap_coverage_not_established')

    def test_legitimate_empty_files_state_has_no_automatic_blank_verdict(self):
        row = self.clip()
        result = assess_clip(row, self.root, probe=self.probe)
        self.assertTrue(result['usable'])
        self.assertNotIn('flicker', result['reason'])

    def test_springboard_home_scenario_is_not_declared_device_fps(self):
        row = self.clip('testSyntheticOwnerFilesAndGalleryRelaunchDoesNotRetainOldScope')
        (self.root / 'trace.jsonl').write_text(json.dumps(row) + '\n')
        report = audit(self.root, required=1, probe=self.probe)
        self.assertTrue(report['pass'])
        self.assertFalse(report['proves_zero_flicker'])
        self.assertFalse(report['is_device_fps_measurement'])

    def test_cloud_owner_content_without_media_is_not_accepted(self):
        row = self.clip(recorded=False)
        self.assertEqual(
            assess_clip(row, self.root, probe=self.probe)['reason'],
            'not_recorded')

    def test_corrupt_movie_fails_closed(self):
        row = self.clip()
        (self.root / row['file']).write_bytes(b'x')
        self.assertEqual(
            assess_clip(row, self.root, probe=self.probe)['reason'],
            'missing_or_short_video')

    def test_variable_pts_gap_is_not_automatically_called_flicker(self):
        row = self.clip()
        info = {**self.probe(None), 'gaps_over_500ms': 2}
        result = assess_clip(row, self.root, probe=lambda _: info)
        self.assertTrue(result['usable'])
        self.assertTrue(result['has_large_recorded_pts_gaps'])
        self.assertNotIn('flicker', result['reason'])

    def test_insufficient_post_tap_seconds_are_not_valid(self):
        row = self.clip(first_tap_offset_s=8.2)
        self.assertEqual(
            assess_clip(row, self.root, probe=self.probe)['reason'],
            'no_post_tap_video')

    def test_five_routes_are_not_six(self):
        rows = [self.clip(name) for name in list(TEST_ROUTES)[:5]]
        (self.root / 'trace.jsonl').write_text(
            '\n'.join(json.dumps(x) for x in rows) + '\n')
        report = audit(self.root, required=6, probe=self.probe)
        self.assertFalse(report['pass'])
        self.assertEqual(report['usable_routes'], 5)

    def test_all_sixteen_routes_satisfy_six_route_coverage(self):
        rows = [self.clip(name) for name in TEST_ROUTES]
        (self.root / 'trace.jsonl').write_text(
            '\n'.join(json.dumps(x) for x in rows) + '\n')
        report = audit(self.root, required=6, probe=self.probe)
        self.assertTrue(report['pass'])
        self.assertEqual(report['usable_routes'], 22)

    def test_corrupt_manifest_line_fails_closed(self):
        (self.root / 'trace.jsonl').write_text('bad json\n')
        report = audit(self.root, required=6)
        self.assertFalse(report['pass'])
        self.assertEqual(report['reason'], 'malformed_video_trace')

    def test_recorder_uses_real_simulator_command_and_stops(self):
        clock = mock.Mock(side_effect=[0, 2, 2.1, 10])
        process = MockProcess()
        popen = mock.Mock(return_value=process)
        recorder = VideoRecorder(
            '00000000-0000-0000-0000-000000000001', self.root,
            popen=popen, clock=clock)
        name = 'testRapidGalleryFilesTabOscillationPreservesBothShells'
        recorder.process(f"Test Case '-[Suite.Case {name}]' started.")
        (self.root / (TEST_ROUTES[name] + '.mp4')).write_bytes(b'mp4' * 512)
        recorder.process('IOS_NATIVE_NAV_TAP_START route=native-ios-tab-files')
        recorder.process(f"Test Case '-[Suite.Case {name}]' passed (12s).")
        recorder.close()
        self.assertTrue(process.signals)
        self.assertIn('recordVideo', popen.call_args.args[0])
        self.assertEqual(len(recorder.records), 1)
        self.assertTrue((self.root / 'trace.jsonl').exists())

    def test_wrong_route_group_cannot_count_as_another_journey(self):
        row = self.clip(route_group='fake-route')
        self.assertFalse(assess_clip(row, self.root, probe=self.probe)['usable'])

    def test_forged_movie_filename_cannot_escape_video_directory(self):
        row = self.clip()
        row['file'] = '../private.mp4'
        self.assertFalse(assess_clip(row, self.root, probe=self.probe)['usable'])


if __name__ == '__main__':
    unittest.main()
