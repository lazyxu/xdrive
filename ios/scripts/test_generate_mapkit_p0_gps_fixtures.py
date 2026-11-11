"""Offline structural tests for generated real JPEG/EXIF GPS PhotoKit media.

These tests validate the fixture bytes; only Xcode/Simulator import+PhotoKit
independent-delta checks can verify real iOS behavior.
"""
import importlib.util
import math
import struct
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "mapkit_p0_fixture_generator", ROOT / "generate-mapkit-p0-gps-fixtures.py"
)
GEN = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GEN)


def parse_gps(jpeg: bytes):
    if jpeg[:4] != b"\xff\xd8\xff\xe1":
        raise AssertionError("JPEG must begin with EXIF APP1")
    length = struct.unpack(">H", jpeg[4:6])[0]
    assert jpeg[6:12] == b"Exif\x00\x00"
    tiff = jpeg[12:4 + length]
    assert tiff[:4] == b"II*\x00"
    ifd0 = struct.unpack("<I", tiff[4:8])[0]
    assert struct.unpack("<H", tiff[ifd0:ifd0 + 2])[0] == 1
    tag, kind, count, gps_offset = struct.unpack(
        "<HHII", tiff[ifd0 + 2:ifd0 + 14])
    assert (tag, kind, count) == (0x8825, 4, 1)
    n = struct.unpack("<H", tiff[gps_offset:gps_offset + 2])[0]
    assert n == 4
    values = {}
    for i in range(n):
        off = gps_offset + 2 + 12 * i
        tag, kind, count, value = struct.unpack("<HHII", tiff[off:off + 12])
        if kind == 2:
            values[tag] = chr(value & 255)
        else:
            rationals = [struct.unpack("<II", tiff[value + k * 8:value + k * 8 + 8])
                         for k in range(count)]
            values[tag] = [a / b for a, b in rationals]
    lat = sum(values[2][j] / (60 ** j) for j in range(3))
    lon = sum(values[4][j] / (60 ** j) for j in range(3))
    return (-lat if values[1] == "S" else lat,
            -lon if values[3] == "W" else lon)


class MapKitP0GPSFixtureTests(unittest.TestCase):
    def test_real_coordinates_roundtrip_through_exif_ifds(self):
        for lat, lon in ((35.001, 139.001), (10, 180), (-10, -180),
                         (-89.99, -179.99), (89.99, 0), (0, 0)):
            with self.subTest(lat=lat, lon=lon):
                jpeg = b"\xff\xd8" + GEN.exif_gps_segment(lat, lon) + b"\xff\xd9"
                actual = parse_gps(jpeg)
                self.assertAlmostEqual(actual[0], lat, places=4)
                self.assertAlmostEqual(actual[1], lon, places=4)

    def test_source_exif_removed_and_unique_real_files_remain_valid_jpeg(self):
        base = ROOT.parent / "UITests/Fixtures/synthetic-gps-map.jpg"
        self.assertTrue(base.is_file())
        core = GEN.remove_original_exif(base.read_bytes())
        self.assertTrue(core.startswith(b"\xff\xd8"))
        self.assertNotIn(b"Exif\x00\x00", core)
        for i in (0, 1, 64, 999, 99999):
            lat, lon = GEN.gps_for(i, "mixed")
            nonce = b"xDrive-map-P0:" + f"{i:06d}".encode("ascii")
            app2 = b"\xff\xe2" + struct.pack(">H", len(nonce) + 2) + nonce
            image = core[:2] + GEN.exif_gps_segment(lat, lon) + app2 + core[2:]
            self.assertEqual(image[-2:], b"\xff\xd9")
            self.assertIn(nonce, image)
            decoded = parse_gps(image)
            self.assertAlmostEqual(decoded[0], lat, places=4)
            self.assertAlmostEqual(decoded[1], lon, places=4)

    def test_65_distinct_places_and_antimeridian_same_physical_meridian(self):
        positions = [GEN.gps_for(i, "distinct") for i in range(65)]
        self.assertEqual(len(set(positions)), 65)
        east, west = GEN.gps_for(0, "dateline"), GEN.gps_for(1, "dateline")
        self.assertEqual(east, (10, 180))
        self.assertEqual(west, (10, -180))
        for pattern in ("same", "dateline", "distinct", "mixed"):
            for i in (0, 64, 999, 9999, 99999):
                lat, lon = GEN.gps_for(i, pattern)
                self.assertTrue(math.isfinite(lat) and math.isfinite(lon))
                self.assertLessEqual(abs(lat), 90)
                self.assertLessEqual(abs(lon), 180)


if __name__ == "__main__":
    unittest.main()
