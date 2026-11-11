#!/usr/bin/env python3
"""Summarize observed Gallery/Files XCTest navigation-to-visible-shell times.

The value includes XCTest's UI automation, AX idling and wait overhead. It is
NOT a device-frame-time/FPS or proof that no intermediate blank frame occurred.
Produce evidence even when the test suite only partially completed.
"""
import json
import math
import pathlib
import re
import statistics
import sys

PATTERN = re.compile(
    r"IOS_NATIVE_NAVIGATION_READY_MS route=(\S+) page=(\S+) value=(\d+)"
)
PHOTO_PAGE_PATTERN = re.compile(
    r"IOS_NATIVE_LOCAL_PHOTO_PAGE_READY_MS mode=(mounted|tab-return|photokit) value=(\d+)"
)
# The native Files Viewer sends this only after AVPlayerLayer itself reports
# a displayed video frame. Signed in real-media playback must be tested
# separately: synthetic Owner UI journeys normally have zero such samples.
VIDEO_FIRST_FRAME_PATTERN = re.compile(
    r"IOS_NATIVE_FILES_VIDEO_FIRST_FRAME_MS stage=layer-ready value=(\d+)"
)
JUMP_VERIFIED_PATTERN = re.compile(
    r"IOS_NATIVE_FILES_JUMP_VERIFIED_MS value=(\d+)"
)


# AX-ready UI samples include XCTest tap/idling time; not true FPS or
# physical first frames. Empty, duplicate or unregistered trials fail.
PAGE_PERF_PATTERN = re.compile(
    r"IOS_NATIVE_PAGE_PERF_MS route=([a-z0-9][a-z0-9.-]*) "
    r"phase=(cold|warm) trial=([1-9][0-9]*) value=([0-9]+)(?![0-9])",
    re.MULTILINE,
)
PAGE_PERF_REQUIRED = (
    ("app.launcher", "cold"),
    ("tab.files", "warm"),
    ("tab.gallery", "warm"),
    ("tab.mine", "warm"),
    ("tab.launcher", "warm"),
    ("files.recent", "warm"),
    ("files.favorites", "warm"),
    ("files.browse", "warm"),
    ("gallery.originals", "warm"),
    ("gallery.unified", "warm"),
    ("gallery.filters", "warm"),
    ("gallery.people", "warm"),
    ("gallery.local", "warm"),
    ("files.cloud-denied", "warm"),
    ("files.trash-denied", "warm"),
    ("tool.notes", "warm"),
    ("tool.clipboard", "warm"),
    ("tool.backup", "warm"),
    ("tool.transfers", "warm"),
)


def summarize_page_performance(log: str) -> dict:
    grouped = {}
    invalid = 0
    for route, phase, trial, value in PAGE_PERF_PATTERN.findall(log):
        ms = int(value)
        if ms > 300_000:
            invalid += 1
            continue
        grouped.setdefault((route, phase), []).append((int(trial), ms))
    rows = []
    for (route, phase), samples in sorted(grouped.items()):
        values = sorted(ms for _, ms in samples)
        trials = [trial for trial, _ in samples]
        distinct = len(set(trials))
        rows.append({
            "route": route, "phase": phase, "samples": len(values),
            "distinct_trials": distinct,
            "p50_ms": round(statistics.median(values), 1),
            "p95_ms": values[math.ceil(0.95 * len(values)) - 1],
            "max_ms": values[-1],
            "complete_n3": len(values) >= 3 and distinct >= 3
                           and distinct == len(values),
        })
    by_route = {(r["route"], r["phase"]): r for r in rows}
    missing = [
        {"route": route, "phase": phase}
        for route, phase in PAGE_PERF_REQUIRED
        if not by_route.get((route, phase), {}).get("complete_n3", False)
    ]
    required = set(PAGE_PERF_REQUIRED)
    unexpected = [
        {"route": row["route"], "phase": row["phase"]}
        for row in rows if (row["route"], row["phase"]) not in required
    ]
    return {
        "metric": "XCUITest tap / launch to native AX-ready (includes idling)",
        "runner": "iOS Simulator, no authenticated Server Owner",
        "is_physical_device_measurement": False,
        "is_frame_time_or_fps": False,
        "is_real_100k_or_signed_media_benchmark": False,
        "samples": rows,
        "required_route_count": len(PAGE_PERF_REQUIRED),
        "missing_or_incomplete": missing,
        "unexpected_routes": unexpected,
        "rejected_timing_count": invalid,
        "complete": not missing and not unexpected and invalid == 0,
        "zero_samples_means_not_measured": True,
    }


def summarize(log: str) -> dict:
    journeys = {}
    for route, page, elapsed in PATTERN.findall(log):
        millis = int(elapsed)
        if millis < 0 or millis > 300_000:
            continue
        key = (route, page)
        journeys.setdefault(key, []).append(millis)
    result = []
    for (route, page), values in sorted(journeys.items()):
        values.sort()
        result.append({
            "route": route,
            "page": page,
            "samples": len(values),
            "p50_ms": round(statistics.median(values), 1),
            "p95_ms": values[math.ceil(0.95 * len(values)) - 1],
            "max_ms": values[-1],
        })
    page_times = {}
    for mode, elapsed in PHOTO_PAGE_PATTERN.findall(log):
        millis = int(elapsed)
        if 0 <= millis <= 300_000:
            page_times.setdefault(mode, []).append(millis)
    page_modes = []
    for mode, values in sorted(page_times.items()):
        values.sort()
        page_modes.append({
            "mode": mode, "samples": len(values),
            "p50_ms": round(statistics.median(values), 1),
            "p95_ms": values[math.ceil(0.95 * len(values)) - 1],
            "max_ms": values[-1],
        })
    video_frames = sorted(
        int(value) for value in VIDEO_FIRST_FRAME_PATTERN.findall(log)
        if 0 <= int(value) <= 300_000
    )
    video_metrics = {
        "metric": "Viewer entry to AVPlayerLayer.isReadyForDisplay (displayed first video frame)",
        "samples": len(video_frames),
        "p50_ms": round(statistics.median(video_frames), 1) if video_frames else None,
        "p95_ms": video_frames[math.ceil(0.95 * len(video_frames)) - 1]
        if video_frames else None,
        "max_ms": video_frames[-1] if video_frames else None,
        "zero_samples_means_not_measured": True,
        "is_physical_device_measurement": False,
    }
    jump_values = sorted(
        int(value) for value in JUMP_VERIFIED_PATTERN.findall(log)
        if 0 <= int(value) <= 300_000
    )
    jump_metrics = {
        "metric": "verified Server Range to authorized scroll command (NOT rendered FPS)",
        "samples": len(jump_values),
        "p50_ms": round(statistics.median(jump_values), 1) if jump_values else None,
        "p95_ms": jump_values[math.ceil(0.95 * len(jump_values)) - 1]
        if jump_values else None,
        "max_ms": jump_values[-1] if jump_values else None,
        "zero_samples_means_not_measured": True,
    }
    return {
        "metric": "XCUITest navigation tap to visible native shell (includes AX/idling)",
        "is_physical_device_fps": False,
        "proves_zero_transient_flicker": False,
        "routes": result,
        "total_samples": sum(len(v) for v in journeys.values()),
        "local_photo_page_modes": page_modes,
        "local_photo_page_samples": sum(len(v) for v in page_times.values()),
        "video_first_displayed_frame": video_metrics,
        "file_jump_verified": jump_metrics,
        "page_performance": summarize_page_performance(log),
    }


if __name__ == "__main__":
    if len(sys.argv) not in (3, 4) or (len(sys.argv) == 4 and sys.argv[3] != "--require-page-performance"):
        raise SystemExit("usage: summarize-navigation-latency.py XCODEBUILD_LOG OUTPUT_JSON [--require-page-performance]")
    log_name, output_name = map(pathlib.Path, sys.argv[1:3])
    payload = summarize(log_name.read_text(encoding="utf-8", errors="replace"))
    output_name.parent.mkdir(parents=True, exist_ok=True)
    output_name.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print("IOS_NAV_LATENCY_SUMMARY samples=" + str(payload["total_samples"]))
    if len(sys.argv) == 4 and not payload["page_performance"]["complete"]:
        print("IOS_PAGE_PERF_INCOMPLETE " + json.dumps(payload["page_performance"]["missing_or_incomplete"], ensure_ascii=False))
        raise SystemExit(2)
    if len(sys.argv) == 4:
        print("IOS_PAGE_PERF_COMPLETE routes=" + str(payload["page_performance"]["required_route_count"]))
