#!/usr/bin/env python3
"""Contract tests for evidence rejection, not 100k benchmark results."""
import copy
import tempfile
import unittest
from pathlib import Path

from audit_real_100k_map_perf import audit as actual_audit, gps_inventory, SCHEMA


def mocked_xctest_measurement_log():
    # Contract fixture only, never acceptable as actual 100k proof.
    prefix = ("Test Case '-[xDriveIOSNavigationUITests."
              "XDriveIOSMapNavigationRuntimeUITests ")
    rows = []
    for stage, n in (("Scan", 4), ("Wall", 3), ("Zoom", 3)):
        label = prefix + "testP1Real100KPhotoKitMap" + stage + "Performance]' measured "
        rows.append(label + "[CPU Time (ios), s] average: 1.2 values: [" +
                    ", ".join(["1.2"] * n) + "]")
        rows.append(label + "[Memory Peak Physical (ios), kB] average: 180000 values: [" +
                    ", ".join(["180000"] * n) + "]")
    return "\n".join(rows)


def audit(report, before, after, expected):
    return actual_audit(report, before, after, expected,
                        mocked_xctest_measurement_log())



def fixture():
    events = [
        {
            "kind": "scan", "stage": "full_library", "completed": True,
            "elapsed_ms": 1500.0 + i * 10,
            "total_assets": 100000, "metadata_items": 100000,
            "metadata_pages": 1563, "located_items": 100000,
            "process_cpu_ms": 820.0 + i,
            "sampled_peak_resident_bytes": 120000000 + i * 1000,
        } for i in range(5)
    ]
    events.append({
        "kind": "cache", "stage": "verified_viewport_reuse",
        "elapsed_ms": 2.0, "total_assets": 100000,
        "metadata_items": 0, "metadata_pages": 0,
        "sampled_peak_resident_bytes": 128000000,
    })
    for stage in ("scan_ui_full_library", "map_pan_zoom", "place_wall_scroll"):
        events.append({
            "kind": "frame", "stage": stage,
            "measurement": "CADisplayLink_callback_cadence",
            "duration_ms": 1500.0, "display_callback_intervals": 90,
            "observed_callback_fps": 60.0,
            "frame_interval_p50_ms": 16.0, "frame_interval_p95_ms": 18.0,
            "long_callback_gaps": 2, "screen_max_fps": 60,
            "sampled_peak_resident_bytes": 130000000,
        })
    return {"schema": SCHEMA,
            "run_stages": ["scan", "wall", "zoom"], "events": events}


class Real100KAuditContracts(unittest.TestCase):
    def test_expected_genuine_inventory_and_metrics(self):
        value = audit(fixture(), before=0, after=100000, expected=100000)
        self.assertEqual(value["scan_samples"], 5)
        self.assertEqual(value["cache_hits"], 1)
        self.assertEqual(value["proven_real_photokit_delta"], 100000)
        self.assertEqual(set(value["frame_stages"]), {
            "scan_ui_full_library", "map_pan_zoom", "place_wall_scroll"})

    def test_reject_synthetic_or_short_photo_library(self):
        with self.assertRaisesRegex(ValueError, "exactly 100000"):
            audit(fixture(), before=10, after=99999, expected=100000)
        bad = fixture()
        bad["events"][0]["total_assets"] = 99999
        with self.assertRaisesRegex(ValueError, "full scan"):
            audit(bad, before=0, after=100000, expected=100000)

    def test_reject_fake_cache_or_missing_cache(self):
        bad = fixture()
        bad["events"] = [x for x in bad["events"] if x["kind"] != "cache"]
        with self.assertRaisesRegex(ValueError, "cache reuse"):
            audit(bad, before=0, after=100000, expected=100000)
        bad = fixture()
        hit = next(x for x in bad["events"] if x["kind"] == "cache")
        hit["metadata_pages"] = 1
        with self.assertRaisesRegex(ValueError, "enumerated PhotoKit"):
            audit(bad, before=0, after=100000, expected=100000)

    def test_reject_missing_real_cpu_rss_and_frame_measurements(self):
        for key in ("process_cpu_ms", "sampled_peak_resident_bytes"):
            bad = fixture()
            bad["events"][0][key] = None
            with self.assertRaises(ValueError):
                audit(bad, before=0, after=100000, expected=100000)
        bad = fixture()
        bad["events"] = [x for x in bad["events"]
                         if x.get("stage") != "place_wall_scroll"]
        with self.assertRaisesRegex(ValueError, "place_wall_scroll"):
            audit(bad, before=0, after=100000, expected=100000)

    def test_reject_p95_smaller_than_p50(self):
        bad = fixture()
        frame = next(x for x in bad["events"] if x.get("kind") == "frame")
        frame["frame_interval_p95_ms"] = 2.0
        with self.assertRaisesRegex(ValueError, "p95 < p50"):
            audit(bad, before=0, after=100000, expected=100000)

    def test_xctest_peak_memory_must_be_real_and_complete(self):
        with self.assertRaisesRegex(ValueError, "missing actual XCTest"):
            actual_audit(fixture(), 0, 100000, 100000, "")
        good = audit(fixture(), before=0, after=100000, expected=100000)
        self.assertEqual(good["xctest_app_peak_physical_kb"], 180000)
        self.assertEqual(set(good["xctest_app_cpu_and_peak_memory_stages"]),
                         {"scan", "place_wall_scroll", "map_pan_zoom"})

    def test_gps_proof_requires_agreement(self):
        with tempfile.TemporaryDirectory() as d:
            file = Path(d) / "proof.log"
            file.write_text(
                "MAP_P0_REAL_PHOTOKIT_INDEPENDENT_COUNT 独立 GPS 100000 地图 GPS 100000 一致\n",
                encoding="utf-8")
            self.assertEqual(gps_inventory(file), 100000)
            file.write_text(
                "MAP_P0_REAL_PHOTOKIT_INDEPENDENT_COUNT 独立 GPS 100000 地图 GPS 99999 一致\n",
                encoding="utf-8")
            with self.assertRaises(ValueError):
                gps_inventory(file)


if __name__ == "__main__":
    unittest.main()
