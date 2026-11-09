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
    r"IOS_NATIVE_NAVIGATION_READY_MS route=(\\S+) page=(\\S+) value=(\\d+)"
)


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
    return {
        "metric": "XCUITest navigation tap to visible native shell (includes AX/idling)",
        "is_physical_device_fps": False,
        "proves_zero_transient_flicker": False,
        "routes": result,
        "total_samples": sum(len(v) for v in journeys.values()),
    }


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: summarize-navigation-latency.py XCODEBUILD_LOG OUTPUT_JSON")
    log_name, output_name = map(pathlib.Path, sys.argv[1:])
    payload = summarize(log_name.read_text(encoding="utf-8", errors="replace"))
    output_name.parent.mkdir(parents=True, exist_ok=True)
    output_name.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\\n",
        encoding="utf-8",
    )
    print("IOS_NAV_LATENCY_SUMMARY samples=" + str(payload["total_samples"]))
