import json
import pathlib
import struct
import tempfile
import unittest
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
            self.assertTrue(score_png(p)['likely_uniform_content'])

    def test_colorful_tabs_do_not_hide_blank_content(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = pathlib.Path(tmp) / 'flat-center.png'
            colors = []
            for y in range(140):
                colors.append([((x+y) % 256, 50, 60) if y < 20 or y > 120
                               else (255, 255, 255) for x in range(120)])
            make_png(p, colors)
            self.assertTrue(score_png(p)['likely_uniform_content'])

    def test_actual_content_pixels_not_marked_flat(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = pathlib.Path(tmp) / 'content.png'
            make_png(p, [[(x*3 % 256, y*4 % 256, (x+y) % 256)
                          for x in range(120)] for y in range(140)])
            self.assertFalse(score_png(p)['likely_uniform_content'])

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
            self.assertEqual(report['counts']['uniform_content_candidate'], 1)
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
        self.assertGreaterEqual(len(cases), 66)
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
