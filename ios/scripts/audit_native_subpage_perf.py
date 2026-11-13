#!/usr/bin/env python3
"""Audit genuine xDrive Native subpage XCTest AX, CPU and memory samples.

Unlike a source-only checkbox, this requires actual XCTest runner metric lines
for each registered route. Unsupported physical FPS/Owner content is never
inferred from Simulator measurements.
"""
import json
import math
import os
from pathlib import Path
import re
import statistics
import sys

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "ios/UITests/XDriveIOSNativeSubpagePerformanceUITests.swift"
ROUTES = (
    "files.home.recent-denied",
    "files.home.favorites-denied",
    "files.organizer",
    "files.organizer.saved-searches",
    "files.organizer.tags",
    "files.tags",
    "files.home.edit-mode",
    "backup.tasks",
    "backup.details",
    "backup.audit",
    "gallery.backup.queue",
    "gallery.backup.focused",
    "gallery.backup.settings",
    "gallery.backup.audit",
    "gallery.cache.sheet",
    "gallery.originals.help",
    "gallery.local.date-sheet",
    "gallery.map.from-filter",
    "gallery.map.from-launcher",
    "launcher.recent-picker",
)
SOURCE_METHOD = re.compile(
    r'func\s+(testSubpage[A-Za-z0-9]+)\(\)\s*\{\s*run\("([a-z0-9.-]+)"\)\s*\}'
)
ITER = re.compile(r'IOS_NATIVE_SUBPAGE_ITERATION route=([a-z0-9.-]+) index=(\d+)')
READY = re.compile(
    r'IOS_NATIVE_SUBPAGE_PERF_MS route=([a-z0-9.-]+) trial=(\d+) value=(\d+)'
)
COMPLETE = re.compile(r'IOS_NATIVE_SUBPAGE_COMPLETE route=([a-z0-9.-]+) iterations=(\d+)')
METRIC = re.compile(
    r"Test Case '-\[xDriveIOSNavigationUITests\."
    r"XDriveIOSNativeSubpagePerformanceUITests (testSubpage[A-Za-z0-9]+)\]'"
    r" measured \[(CPU Time \(ios\), s|Memory Peak Physical \(ios\), kB)\]"
    r" average: [^\n]*?values: \[([0-9., \-]+)\]"
)


def source_routes(content):
    pairs = SOURCE_METHOD.findall(content)
    methods = [method for method, _ in pairs]
    routes = [route for _, route in pairs]
    if len(set(methods)) != len(methods) or len(set(routes)) != len(routes):
        raise ValueError("Duplicate native subpage method or route")
    registered = set(ROUTES)
    if set(routes) != registered or len(ROUTES) != len(pairs):
        raise ValueError(
            f"Missing/unregistered subpages: missing={sorted(registered-set(routes))} "
            f"extra={sorted(set(routes)-registered)}"
        )
    for token in (
        "XCTCPUMetric(application: app)",
        "XCTMemoryMetric(application: app)",
        "options.iterationCount = 3",
        "options.invocationOptions = [.manuallyStart, .manuallyStop]",
        "startMeasuring()", "stopMeasuring()",
        "IOS_NATIVE_SUBPAGE_PERF_MS",
    ):
        if token not in content:
            raise ValueError("Missing app-targeted performance measurement: " + token)
    return {method: route for method, route in pairs}


def _finite3(values, positive=False):
    if len(values) != 3 or any(not math.isfinite(v) or (v <= 0 if positive else v < 0)
                                for v in values):
        raise ValueError("Missing, invalid or non-finite three retained metric samples")
    return values


def audit(content, log, raw_metrics):
    methods = source_routes(content)
    required = set(ROUTES)
    if not isinstance(raw_metrics, (list, dict)) or not raw_metrics:
        raise ValueError("Missing original xcresult metrics JSON")
    if raw_metrics == {"error": "missing"}:
        raise ValueError("Missing original xcresult metrics JSON")

    completed = COMPLETE.findall(log)
    if len(completed) != len(required) or set(r for r, _ in completed) != required:
        raise ValueError("Missing/duplicate real subpage XCTest completion")
    if any(int(count) != 4 for _, count in completed):
        raise ValueError("Subpage XCTest did not run one warmup plus three trials")
    observed = {}
    for route, iteration in ITER.findall(log):
        observed.setdefault(route, []).append(int(iteration))
    if set(observed) != required or any(sorted(v) != [1, 2, 3, 4]
                                        for v in observed.values()):
        raise ValueError("Missing/duplicate real subpage iterations")

    elapsed = {}
    for route, trial, value in READY.findall(log):
        elapsed.setdefault(route, []).append((int(trial), int(value)))
    if set(elapsed) != required or any(
        sorted(trial for trial, _ in values) != [1, 2, 3]
        or any(ms < 0 or ms > 300_000 for _, ms in values)
        for values in elapsed.values()
    ):
        raise ValueError("Missing/duplicate real AX-ready subpage timing trials")

    raw = {}
    for method, name, values in METRIC.findall(log):
        if method not in methods:
            raise ValueError("Unregistered XCTest app metric method")
        route = methods[method]
        parsed = [float(x.strip()) for x in values.split(",")]
        _finite3(parsed, positive=True)
        key = "cpu_s" if name.startswith("CPU Time") else "peak_memory_kb"
        record = raw.setdefault(route, {})
        if key in record:
            raise ValueError("Duplicate real CPU/memory metric for route " + route)
        record[key] = parsed
    if set(raw) != required or any(set(values) != {"cpu_s", "peak_memory_kb"}
                                  for values in raw.values()):
        raise ValueError("Missing actual app CPU time or peak memory measurements")

    rows = []
    for route in ROUTES:
        ms = sorted(elapsed[route])
        values = [v for _, v in ms]
        peak = raw[route]["peak_memory_kb"]
        cpu = raw[route]["cpu_s"]
        rows.append({
            "route": route,
            "ax_ready_trial_ms": values,
            "ax_ready_p50_ms": statistics.median(values),
            "ax_ready_p95_ms": max(values),
            "app_cpu_time_trial_s": cpu,
            "app_cpu_time_p50_s": statistics.median(cpu),
            "app_peak_memory_trial_kb": peak,
            "app_peak_memory_p95_mib": max(peak) / 1024.0,
        })
    return {
        "metric": "genuine native subpage AX-ready + app-targeted CPU/RSS, Simulator",
        "source_commit": os.environ.get("XD_PERF_SOURCE_SHA", "unknown"),
        "route_count": len(ROUTES),
        "recorded_test_invocations": sum(map(len, observed.values())),
        "retained_trials_per_route": 3,
        "total_ax_samples": sum(map(len, elapsed.values())),
        "raw_xcresult_metrics_present": True,
        "includes_xctest_and_ax_idling": True,
        "real_signed_owner_data": False,
        "physical_60_120hz_or_hitch_ratio": False,
        "browser_native_numeric_parity": False,
        "rows": rows,
    }


def main():
    if len(sys.argv) != 4:
        raise SystemExit("usage: audit_native_subpage_perf.py XCODEBUILD_LOG RAW_METRICS_JSON SUMMARY_JSON")
    outcome = audit(
        SOURCE.read_text(encoding="utf-8"),
        Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace"),
        json.loads(Path(sys.argv[2]).read_text(encoding="utf-8")),
    )
    destination = Path(sys.argv[3])
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(outcome, ensure_ascii=False, indent=2) + "\n",
                           encoding="utf-8")
    print(f"IOS_NATIVE_SUBPAGE_COMPLETE_ALL routes={outcome['route_count']} "
          f"samples={outcome['total_ax_samples']}")


if __name__ == "__main__":
    main()
