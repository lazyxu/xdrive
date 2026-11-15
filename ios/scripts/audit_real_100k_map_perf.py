#!/usr/bin/env python3
"""Audit real in-app iOS MapKit / PhotoKit 100k performance evidence.

This never generates a benchmark or fills missing values. CI must independently
prove that a fresh iOS Simulator's PHAsset.location count increased by exactly
100,000 after importing 100,000 genuine EXIF-GPS JPEGs. Synthetic Swift tests
and CADisplayLink callbacks are NOT the same as GPU-presented FPS.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import re
from pathlib import Path


GPS_COUNT = re.compile(
    r"MAP_P0_REAL_PHOTOKIT_INDEPENDENT_COUNT 独立 GPS (\d+) 地图 GPS (\d+) 一致"
)
SCHEMA = "xdrive.ios.map.real-photokit-perf.v1"
# Xcode 16.4 emits these actual app-targeted values from XCTCPUMetric and
# XCTMemoryMetric, unlike CADisplayLink's callback-cadence approximation.
XCTEST_METRIC = re.compile(
    r"Test Case '-\[xDriveIOSNavigationUITests\."
    r"XDriveIOSMapNavigationRuntimeUITests "
    r"testP1Real100KPhotoKitMap(Scan|Wall|Zoom)Performance\]'"
    r" measured \[(CPU Time \(ios\), s|Memory Peak Physical \(ios\), kB)\]"
    r" average: [^\n]*?values: \[([0-9., \-]+)\]"
)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def positive(value: object, label: str) -> float:
    require(type(value) in (float, int), f"{label} missing/invalid")
    value = float(value)
    require(math.isfinite(value) and value > 0, f"{label} must be finite and >0")
    return value


def nonnegative_int(value: object, label: str) -> int:
    require(type(value) is int and value >= 0, f"{label} must be a nonnegative integer")
    return value


def nearest_rank(values: list[float], fraction: float) -> float:
    require(bool(values), "cannot percentile an empty measurement series")
    sorted_values = sorted(values)
    return sorted_values[max(0, math.ceil(len(sorted_values) * fraction) - 1)]


def gps_inventory(log_path: Path) -> int:
    samples = GPS_COUNT.findall(log_path.read_text(encoding="utf-8", errors="replace"))
    require(bool(samples), f"real PhotoKit GPS count proof missing: {log_path}")
    photo, indexed = map(int, samples[-1])
    require(photo == indexed, f"actual PhotoKit != MapKit index in {log_path}")
    return photo


def parse_xctest_metrics(log: str) -> dict:
    # Each XCTest method owns exactly ONE measurement block, rather than
    # attempting multiple measure(...) calls from the same XCTest method.
    stages = {"Scan": ("scan", 4),
              "Wall": ("place_wall_scroll", 3),
              "Zoom": ("map_pan_zoom", 3)}
    records: dict[str, dict[str, list[float]]] = {}
    for suffix, metric, values in XCTEST_METRIC.findall(log):
        stage, count = stages[suffix]
        key = "cpu_s" if metric.startswith("CPU Time") else "peak_memory_kb"
        samples = [float(v.strip()) for v in values.split(",")]
        require(len(samples) == count,
                f"{stage}.{key}: incorrect real XCTest trial count")
        for sample in samples:
            positive(sample, f"XCTest {stage}.{key}")
        record = records.setdefault(stage, {})
        require(key not in record, f"duplicate real XCTest metric {stage}.{key}")
        record[key] = samples
    expected = {stage for stage, _ in stages.values()}
    require(set(records) == expected and
            all(set(row) == {"cpu_s", "peak_memory_kb"} for row in records.values()),
            "missing actual XCTest CPU and peak physical-memory metrics for "
            "independent scan / place-wall / MapKit methods")
    return records


def audit(report: dict, before: int, after: int, expected: int,
          xctest_log: str) -> dict:
    require(report.get("schema") == SCHEMA, "report schema or real-app source mismatch")
    require(report.get("run_stages") == ["scan", "wall", "zoom"],
            "missing separate real-app scan/wall/zoom performance reports")
    require(expected >= 100_000, "this suite requires >=100,000 real PhotoKit assets")
    require(after - before == expected,
            f"real Photos inventory did not grow by exactly {expected}: {before}->{after}")
    require(after >= 100_000, "PhotoKit inventory too small")

    events = report.get("events")
    require(isinstance(events, list) and bool(events), "no real application events")
    scans = [x for x in events if isinstance(x, dict) and
             x.get("kind") == "scan" and x.get("stage") == "full_library" and
             x.get("completed") is True]
    require(len(scans) >= 5,
            f"need a genuine cold scan and four real repeats, got {len(scans)}")
    elapsed: list[float] = []
    cpu: list[float] = []
    memory: list[float] = []
    for index, scan in enumerate(scans):
        total = nonnegative_int(scan.get("total_assets"), f"scan[{index}].total_assets")
        items = nonnegative_int(scan.get("metadata_items"), f"scan[{index}].metadata_items")
        pages = nonnegative_int(scan.get("metadata_pages"), f"scan[{index}].metadata_pages")
        located = nonnegative_int(scan.get("located_items"), f"scan[{index}].located_items")
        require(total >= expected and total == items,
                "a claimed full scan did not read all real PhotoKit assets")
        require(pages == math.ceil(items / 64), "metadata page count is not the real 64-slot scan")
        require(0 < located <= total, "real GPS inventory is missing or inconsistent")
        elapsed.append(positive(scan.get("elapsed_ms"), f"scan[{index}].elapsed_ms"))
        cpu.append(positive(scan.get("process_cpu_ms"), f"scan[{index}].cpu"))
        memory.append(positive(scan.get("sampled_peak_resident_bytes"),
                               f"scan[{index}].resident"))
    require(scans[0]["total_assets"] == after,
            "first measured real scan does not match independent PhotoKit inventory")

    cache = [x for x in events if isinstance(x, dict) and
             x.get("kind") == "cache" and
             x.get("stage") == "verified_viewport_reuse"]
    require(bool(cache), "no verified viewport cache reuse: this is NOT a cache benchmark")
    cache_ms: list[float] = []
    for hit in cache:
        require(hit.get("metadata_pages") == 0 and hit.get("metadata_items") == 0,
                "a cache hit enumerated PhotoKit; do not count as reuse")
        require(nonnegative_int(hit.get("total_assets"), "cache.total_assets") >= expected,
                "cache belongs to a smaller/photo-changed library")
        cache_ms.append(positive(hit.get("elapsed_ms"), "cache.elapsed_ms"))
        memory.append(positive(hit.get("sampled_peak_resident_bytes"), "cache.rss"))

    frame_aggregate = {}
    for name in ("map_pan_zoom", "place_wall_scroll", "scan_ui_full_library"):
        frames = [x for x in events if isinstance(x, dict) and
                  x.get("kind") == "frame" and x.get("stage") == name]
        valid = []
        measured_intervals: list[float] = []
        for frame in frames:
            require(frame.get("measurement") == "CADisplayLink_callback_cadence",
                    "frame metric not collected from real CADisplayLink")
            callbacks = nonnegative_int(frame.get("display_callback_intervals"),
                                        "display callback intervals")
            intervals_raw = frame.get("callback_intervals_ms")
            require(isinstance(intervals_raw, list) and
                    len(intervals_raw) == callbacks,
                    f"{name}: missing raw CADisplayLink callback intervals")
            intervals = [positive(v, f"{name}.interval_ms") for v in intervals_raw]
            if callbacks < 8:
                continue
            p50 = positive(frame.get("frame_interval_p50_ms"), f"{name}.p50")
            p95 = positive(frame.get("frame_interval_p95_ms"), f"{name}.p95")
            require(p95 >= p50, f"{name} interval p95 < p50")
            require(math.isclose(p50, nearest_rank(intervals, 0.50), rel_tol=1e-8),
                    f"{name}: per-window p50 disagrees with actual intervals")
            require(math.isclose(p95, nearest_rank(intervals, 0.95), rel_tol=1e-8),
                    f"{name}: per-window p95 disagrees with actual intervals")
            fps = positive(frame.get("observed_callback_fps"), f"{name}.fps")
            calculated_fps = callbacks * 1000 / sum(intervals)
            require(math.isclose(fps, calculated_fps, rel_tol=1e-8),
                    f"{name}: callback fps disagrees with actual intervals")
            require(fps <= 240, f"{name} impossible callback cadence")
            max_fps = positive(frame.get("screen_max_fps"), "screen refresh")
            require(max_fps <= 240, "invalid screen refresh")
            slow = nonnegative_int(frame.get("long_callback_gaps"), "slow callbacks")
            require(slow == sum(v > 1500 / max_fps for v in intervals),
                    "slow callback count mismatches actual callback intervals")
            memory.append(positive(frame.get("sampled_peak_resident_bytes"),
                                   f"{name}.rss"))
            valid.append(frame)
            measured_intervals.extend(intervals)
        require(valid, f"{name}: no real, sufficiently long CADisplayLink sample")
        frame_aggregate[name] = {
            "samples": len(valid),
            "callback_fps_p50": nearest_rank(
                [float(v["observed_callback_fps"]) for v in valid], 0.5),
            "callback_fps_p95": nearest_rank(
                [float(v["observed_callback_fps"]) for v in valid], 0.95),
            # Percentiles of ALL actual callback intervals, not a
            # percentile-of-per-gesture-percentiles approximation.
            "interval_p50_ms": nearest_rank(measured_intervals, 0.5),
            "interval_p95_ms": nearest_rank(measured_intervals, 0.95),
            "overall_callback_fps": len(measured_intervals) * 1000 /
                                    sum(measured_intervals),
            "total_callback_intervals": sum(v["display_callback_intervals"] for v in valid),
            "total_long_callback_gaps": sum(v["long_callback_gaps"] for v in valid),
        }

    app_metrics = parse_xctest_metrics(xctest_log)
    actual_peak_kb = max(
        value for stage in app_metrics.values() for value in stage["peak_memory_kb"]
    )
    return {
        "schema": "xdrive.ios.map.100k-audit.v1",
        "proven_real_photokit_delta": expected,
        "baseline_real_gps": before, "after_real_gps": after,
        "scan_samples": len(scans),
        "first_scan_ms": elapsed[0],
        "repeat_scan_p50_ms": nearest_rank(elapsed[1:], 0.5),
        "repeat_scan_p95_ms": nearest_rank(elapsed[1:], 0.95),
        "all_scan_p50_ms": nearest_rank(elapsed, 0.5),
        "all_scan_p95_ms": nearest_rank(elapsed, 0.95),
        "scan_process_cpu_p50_ms": nearest_rank(cpu, 0.5),
        "scan_process_cpu_p95_ms": nearest_rank(cpu, 0.95),
        "sampled_app_resident_peak_bytes": max(memory),
        "xctest_app_peak_physical_kb": actual_peak_kb,
        "xctest_app_peak_physical_mib": actual_peak_kb / 1024.0,
        "xctest_app_cpu_and_peak_memory_stages": app_metrics,
        "memory_proof": "XCTest target-app Peak Physical + separately sampled resident",
        "cache_hits": len(cache),
        "cache_hit_p50_ms": nearest_rank(cache_ms, 0.5),
        "cache_hit_p95_ms": nearest_rank(cache_ms, 0.95),
        "frame_proof": "CADisplayLink callback pacing, NOT GPU-presented FPS",
        "frame_stages": frame_aggregate,
        "device_claim": "Simulator only; no physical 60/120 Hz device acceptance",
    }


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("metrics", type=Path, help="real app tmp/ios-map-100k-metrics.json")
    p.add_argument("--baseline", type=Path, required=True)
    p.add_argument("--seeded", type=Path, required=True)
    p.add_argument("--xctest-log", type=Path, required=True,
                   help="native XCTest log containing real CPU + Memory Peak Physical values")
    p.add_argument("--expected", type=int, default=100000)
    p.add_argument("--json-output", type=Path, required=True)
    p.add_argument("--csv-output", type=Path, required=True)
    args = p.parse_args()
    summary = audit(
        json.loads(args.metrics.read_text(encoding="utf-8")),
        gps_inventory(args.baseline), gps_inventory(args.seeded), args.expected,
        args.xctest_log.read_text(encoding="utf-8", errors="replace"))
    args.json_output.write_text(
        json.dumps(summary, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8")
    with args.csv_output.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.writer(stream)
        writer.writerow(("metric", "value", "unit_or_evidence"))
        for key, value in summary.items():
            if not isinstance(value, (dict, list)):
                writer.writerow((key, value, "see JSON provenance"))
        for stage, data in summary["frame_stages"].items():
            for key, value in data.items():
                writer.writerow((f"{stage}.{key}", value,
                                 "CADisplayLink callback cadence; not GPU FPS"))
    print("IOS_MAP_REAL_100K_PERF_AUDIT_PASS " +
          json.dumps(summary, sort_keys=True, ensure_ascii=False))


if __name__ == "__main__":
    main()
