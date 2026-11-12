import json
import pathlib
import struct
import tempfile
import unittest
import subprocess
from unittest import mock
import zlib
from audit_navigation_frames import analyze, score_png


def make_png(where, pixels):
    h = len(pixels)
    w = len(pixels[0])
    raw = bytearray()
    for row in pixels:
        raw += b'\x00' + bytes(channel for color in row for channel in (*color, 255))

    def chunk(kind, body):
        return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body) & 0xffffffff)

    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    data += chunk(b'IDAT', zlib.compress(bytes(raw))) + chunk(b'IEND', b'')
    where.write_bytes(data)


class AuditTests(unittest.TestCase):
    def test_all_white_content_is_flagged(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = pathlib.Path(tmp) / 'flat.png'
            make_png(p, [[(255, 255, 255)] * 120 for _ in range(140)])
            scores = score_png(p)
            self.assertTrue(scores['likely_uniform_content'])
            self.assertTrue(scores['likely_blank_shell'])
            self.assertFalse(scores['app_chrome_present'])

    def test_colorful_tabs_do_not_hide_blank_content(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = pathlib.Path(tmp) / 'flat-center.png'
            colors = []
            for y in range(140):
                colors.append([((x+y) % 256, 50, 60) if y < 20 or y > 120
                               else (255, 255, 255) for x in range(120)])
            make_png(p, colors)
            scores = score_png(p)
            self.assertTrue(scores['likely_uniform_content'])
            self.assertFalse(scores['likely_blank_shell'])
            self.assertTrue(scores['app_chrome_present'])

    def test_actual_content_pixels_not_marked_flat(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = pathlib.Path(tmp) / 'content.png'
            make_png(p, [[(x*3 % 256, y*4 % 256, (x+y) % 256)
                          for x in range(120)] for y in range(140)])
            self.assertFalse(score_png(p)['likely_uniform_content'])

    def test_dark_blank_shell_is_not_assumed_to_be_rendered_content(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = pathlib.Path(tmp) / 'dark.png'
            make_png(p, [[(12, 12, 12)] * 120 for _ in range(140)])
            scores = score_png(p)
            self.assertTrue(scores['likely_blank_shell'])
            self.assertFalse(scores['app_chrome_present'])

    def test_sparse_files_list_with_native_header_and_tabs_is_not_a_blank_shell(self):
        # Real no-token Recent/Favorites pages have large white content areas
        # but genuine native navigation chrome, search and retry affordances.
        with tempfile.TemporaryDirectory() as tmp:
            p = pathlib.Path(tmp) / 'files-sparse.png'
            pixels = [[(255, 255, 255) for _ in range(120)] for _ in range(140)]
            for y in list(range(14, 28)) + list(range(110, 132)):
                for x in range(18, 102):
                    if (y % 7 < 3 and x % 17 < 11):
                        pixels[y][x] = (49, 122, 218)
            make_png(p, pixels)
            scores = score_png(p)
            self.assertTrue(scores['likely_uniform_content'])
            self.assertTrue(scores['app_chrome_present'])
            self.assertFalse(scores['likely_blank_shell'])

    def test_uniform_content_with_native_chrome_has_distinct_report_class(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = pathlib.Path(tmp)
            pixels = [[(255, 255, 255)] * 120 for _ in range(140)]
            for row in list(range(12, 29)) + list(range(112, 129)):
                for x in range(20, 100):
                    if (x + row) % 9 < 4:
                        pixels[row][x] = (18, 91, 201)
            make_png(p / 'sparse.png', pixels)
            (p / 'frame-trace.jsonl').write_text(
                json.dumps({'test': 'Recent', 'file': 'sparse.png', 'captured': True}) + '\n')
            report = analyze(p)
            self.assertEqual(report['counts']['sparse_or_empty_content'], 1)
            self.assertNotIn('blank_shell_candidate', report['counts'])

    def test_startup_full_shell_blank_keeps_diagnostic_not_a_crash_verdict(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = pathlib.Path(tmp)
            make_png(p / 'launch.png', [[(255, 255, 255)] * 120 for _ in range(140)])
            (p / 'frame-trace.jsonl').write_text(
                json.dumps({'test': 'launch', 'file': 'launch.png', 'captured': True,
                            'scheduled_after_start_seconds': 0.5}) + '\n')
            report = analyze(p)
            self.assertEqual(report['counts']['blank_shell_candidate'], 1)
            self.assertFalse(report['proves_zero_transient_flicker'])
            self.assertFalse(report['is_fps_measurement'])

    def test_missing_capture_is_reported_not_passed(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = pathlib.Path(tmp)
            (p / 'frame-trace.jsonl').write_text(
                json.dumps({'test': 'example', 'captured': False, 'file': None}) + '\n')
            report = analyze(p)
            self.assertEqual(report['counts']['capture_missing'], 1)
            self.assertFalse(report['proves_zero_transient_flicker'])

    def test_real_png_report_is_diagnostic_not_fps(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = pathlib.Path(tmp)
            make_png(p / 'a.png', [[(255, 255, 255)] * 40 for _ in range(60)])
            (p / 'frame-trace.jsonl').write_text(
                json.dumps({'test': 'native', 'captured': True, 'file': 'a.png'}) + '\n')
            report = analyze(p)
            self.assertEqual(report['total_frames'], 1)
            self.assertEqual(report['counts']['blank_shell_candidate'], 1)
            self.assertFalse(report['frames'][0]['metrics']['app_chrome_present'])
            self.assertFalse(report['is_fps_measurement'])

    def test_every_native_gallery_files_journey_has_frame_diagnostics(self):
        import re
        repo = pathlib.Path(__file__).resolve().parents[2]
        cases = set()
        for path in ('XDriveIOSGalleryFilesStabilityUITests.swift',
                     'XDriveIOSGalleryFilesFrameContinuityUITests.swift'):
            source = (repo / 'ios' / 'UITests' / path).read_text(encoding='utf-8')
            cases.update(re.findall(r'\bfunc (test\w+)\(\)', source))
        watcher = (repo / 'ios' / 'scripts' /
                   'capture-navigation-smoke-frames.py').read_text(encoding='utf-8')
        registered = set(re.findall(r'"(test\w+)"', watcher))
        self.assertGreaterEqual(len(cases), 77)
        self.assertFalse(cases - registered,
                         'untested native routes: ' + ', '.join(sorted(cases - registered)))
        self.assertIn('FRAME_OFFSETS_SECONDS[-1:] if name in MINIMAL_TARGETS', watcher)
        self.assertIn('minimal and count == 1', watcher)
        self.assertIn('delays = (0.55,) if minimal else TAP_FRAME_OFFSETS_SECONDS', watcher)

    def test_missing_trace_is_explicit_even_without_any_frame(self):
        with tempfile.TemporaryDirectory() as tmp:
            report = analyze(pathlib.Path(tmp))
            self.assertEqual(report['total_frames'], 0)
            self.assertTrue(report['missing_capture_trace'])
            self.assertFalse(report['proves_zero_transient_flicker'])

    def test_finished_short_xctest_is_reported_as_missing_capture(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = pathlib.Path(tmp)
            (p / 'frame-trace.jsonl').write_text(json.dumps({
                'test': 'testShortChildReturn', 'captured': False,
                'file': None, 'reason': 'test_finished_before_capture',
                'capture_mode': 'test-start',
            }) + '\n')
            report = analyze(p)
            self.assertFalse(report['missing_capture_trace'])
            self.assertEqual(report['counts']['capture_missing'], 1)
            self.assertEqual(report['finished_before_capture'], 1)
            self.assertFalse(report['proves_zero_transient_flicker'])

    def test_capture_lag_is_measured_not_claimed_as_render_fps(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = pathlib.Path(tmp)
            make_png(p / 'lag.png', [[(16, 80, 124)] * 40 for _ in range(60)])
            (p / 'frame-trace.jsonl').write_text(json.dumps({
                'test': 'testTab', 'captured': True,
                'file': 'lag.png', 'capture_request_lag_seconds': .381,
                'capture_duration_seconds': .11,
                'scheduled_after_tap_seconds': .15,
            }) + '\n')
            report = analyze(p)
            self.assertEqual(report['capture_request_lag']['samples'], 1)
            self.assertEqual(report['capture_request_lag']['p50_ms'], 381)
            self.assertEqual(report['capture_request_lag']['over_150ms'], 1)
            self.assertFalse(report['is_fps_measurement'])

    def test_live_observer_reports_lost_scheduled_frames_and_true_lag(self):
        repo = pathlib.Path(__file__).resolve().parents[2]
        watcher = (repo / 'ios' / 'scripts' /
                   'capture-navigation-smoke-frames.py').read_text(encoding='utf-8')
        self.assertIn('def report_missed(key, starts, taps):', watcher)
        self.assertIn('report_missed(key, missed_starts, missed_taps)', watcher)
        self.assertIn('"reason": "test_finished_before_capture"', watcher)
        self.assertEqual(watcher.count('"capture_request_lag_seconds":'), 4)
        self.assertEqual(watcher.count('"reason": "capture_deadline_missed"'), 2)
        self.assertEqual(watcher.count('if capture_started - due_at > MAX_CAPTURE_LAG_SECONDS'), 2)
        self.assertIn('MAX_CAPTURE_LAG_SECONDS = 0.75', watcher)
        self.assertEqual(watcher.count('"capture_duration_seconds":'), 2)
        self.assertEqual(watcher.count('"capture_reliable": ok and'), 2)
        self.assertIn('MAX_CAPTURE_DURATION_SECONDS = 2.5', watcher)
        self.assertIn('capture_started = time.monotonic()', watcher)
        self.assertIn('capture_completed = time.monotonic()', watcher)

    def test_expired_simulator_capture_is_missing_not_fake_after_tap_frame(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = pathlib.Path(tmp)
            (p / 'frame-trace.jsonl').write_text(json.dumps({
                'test': 'recent-favorites',
                'capture_mode': 'tap-adjacent',
                'route': 'native-ios-files-section-recent',
                'scheduled_after_tap_seconds': .15,
                'capture_request_lag_seconds': 8.6645,
                'reason': 'capture_deadline_missed',
                'captured': False, 'file': None,
            }) + '\n')
            report = analyze(p)
            self.assertEqual(report['counts']['capture_missing'], 1)
            self.assertEqual(report['capture_request_lag']['over_150ms'], 1)
            self.assertFalse(report['proves_zero_transient_flicker'])

    def test_slow_simctl_png_is_saved_but_not_counted_as_tap_frame(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = pathlib.Path(tmp)
            make_png(p / 'late.png', [[(255, 255, 255)] * 120 for _ in range(140)])
            (p / 'frame-trace.jsonl').write_text(json.dumps({
                'test': 'rapid-gallery-files', 'file': 'late.png', 'captured': True,
                'capture_reliable': False,
                'capture_unreliable_reason': 'capture_too_slow',
                'capture_duration_seconds': 6.9143,
                'scheduled_after_tap_seconds': .15,
            }) + '\n')
            report = analyze(p)
            self.assertEqual(report['counts']['capture_unreliable'], 1)
            self.assertEqual(report['frames'][0]['reason'], 'capture_too_slow')
            self.assertNotIn('blank_shell_candidate', report['counts'])
            self.assertTrue((p / 'late.png').exists())

    def test_tiny_screenshot_skips_unsafe_mac_png_reencoding(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = pathlib.Path(tmp)
            make_png(p / 'tiny.png', [[(255, 255, 255)] * 120 for _ in range(140)])
            (p / 'frame-trace.jsonl').write_text(json.dumps({
                'test': 'tiny', 'file': 'tiny.png', 'captured': True,
                'capture_reliable': True,
            }) + '\n')
            with mock.patch('audit_navigation_frames.shutil.which', return_value='sips'), \
                 mock.patch('audit_navigation_frames.subprocess.run',
                            side_effect=AssertionError('should not re-encode tiny PNG')):
                report = analyze(p)
            self.assertEqual(report['counts']['blank_shell_candidate'], 1)
            self.assertNotIn('analysis_unavailable', report['counts'])

    def test_mac_resized_png_with_unsupported_encoding_falls_back_to_original(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = pathlib.Path(tmp)
            make_png(p / 'large.png', [[(255, 255, 255)] * 240 for _ in range(220)])
            (p / 'frame-trace.jsonl').write_text(json.dumps({
                'test': 'large', 'file': 'large.png', 'captured': True,
                'capture_reliable': True,
            }) + '\n')

            def unusable_reencode(command, **kwargs):
                pathlib.Path(command[-1]).write_bytes(b'not a supported PNG')
                return subprocess.CompletedProcess(command, 0)

            with mock.patch('audit_navigation_frames.shutil.which', return_value='sips'), \
                 mock.patch('audit_navigation_frames.subprocess.run',
                            side_effect=unusable_reencode):
                report = analyze(p)
            self.assertEqual(report['counts']['blank_shell_candidate'], 1)
            self.assertEqual(report['frames'][0]['downscale_issue'], 'ValueError')
            self.assertNotIn('analysis_unavailable', report['counts'])

    def test_mac_sips_timeout_preserves_a_classifiable_original(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = pathlib.Path(tmp)
            make_png(p / 'slow.png', [[(25, 26, 27)] * 240 for _ in range(220)])
            (p / 'frame-trace.jsonl').write_text(json.dumps({
                'test': 'slow', 'file': 'slow.png', 'captured': True,
            }) + '\n')
            with mock.patch('audit_navigation_frames.shutil.which', return_value='sips'), \
                 mock.patch('audit_navigation_frames.subprocess.run',
                            side_effect=subprocess.TimeoutExpired('sips', 15)):
                report = analyze(p)
            self.assertEqual(report['counts']['blank_shell_candidate'], 1)
            self.assertEqual(report['frames'][0]['downscale_issue'], 'TimeoutExpired')

    def test_corrupted_original_remains_unavailable_not_a_blank_shell(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = pathlib.Path(tmp)
            (p / 'broken.png').write_bytes(b'not a PNG')
            (p / 'frame-trace.jsonl').write_text(json.dumps({
                'test': 'broken', 'file': 'broken.png', 'captured': True,
            }) + '\n')
            with mock.patch('audit_navigation_frames.shutil.which', return_value='sips'):
                report = analyze(p)
            self.assertEqual(report['counts']['analysis_unavailable'], 1)
            self.assertNotIn('blank_shell_candidate', report['counts'])
            self.assertEqual(report['frames'][0]['reason'], 'ValueError')

    def test_on_time_finished_screenshot_remains_classifiable(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = pathlib.Path(tmp)
            make_png(p / 'white.png', [[(255, 255, 255)] * 120 for _ in range(140)])
            (p / 'frame-trace.jsonl').write_text(json.dumps({
                'test': 'launch', 'file': 'white.png', 'captured': True,
                'capture_reliable': True,
                'capture_duration_seconds': .72,
                'capture_request_lag_seconds': .02,
            }) + '\n')
            report = analyze(p)
            self.assertEqual(report['counts']['blank_shell_candidate'], 1)
            self.assertNotIn('capture_unreliable', report['counts'])

    def test_rejects_corrupt_crc(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = pathlib.Path(tmp) / 'a.png'
            make_png(p, [[(1, 2, 3)] * 20 for _ in range(30)])
            buf = bytearray(p.read_bytes())
            buf[-7] ^= 0x12
            p.write_bytes(buf)
            with self.assertRaises(ValueError):
                score_png(p)


if __name__ == '__main__':
    unittest.main()
