#!/usr/bin/env python3
"""Audit real per-route native iOS root CPU/RSS and cold-launch XCTest metrics.

The original xcresult JSON and log are required. A non-empty xcresult alone,
test registration or a synthetic Owner cannot establish any measured value.
"""
import csv
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import statistics
import sys

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "ios/UITests/XDriveIOSNativeResourcePerformanceUITests.swift"
NAV = ROOT / "ios/scripts/summarize-navigation-latency.py"
METHOD = re.compile(
    r'func\s+(testResource[A-Za-z0-9]+)\(\)\s*\{\s*(?:run|runCold)\("([a-z0-9.-]+)"\)\s*\}'
)
COMPLETE = re.compile(r'IOS_NATIVE_RESOURCE_COMPLETE route=([a-z0-9.-]+) invocations=(\d+)')
ITER = re.compile(r'IOS_NATIVE_RESOURCE_ITERATION route=([a-z0-9.-]+) index=(\d+)')
ROOT_METRIC = re.compile(
    r"Test Case '-\[xDriveIOSNavigationUITests\.XDriveIOSNativeResourcePerformanceUITests "
    r"(testResource[A-Za-z0-9]+)\]' measured "
    r"\[(CPU Time \(ios\), s|Memory Peak Physical \(ios\), kB|Duration \(AppLaunch\), s)\]"
    r" average: [^\n]*?values: \[([0-9., \-]+)\]"
)
METRIC_KIND = {
    "CPU Time (ios), s": "app_cpu_s",
    "Memory Peak Physical (ios), kB": "app_peak_memory_kb",
    "Duration (AppLaunch), s": "cold_launch_s",
}
CSV_FIELDS = (
    "exact_commit", "route", "metric_type", "retained_trials",
    "cold_launch_p50_s", "app_cpu_p50_s", "app_peak_memory_p95_mib",
    "app_cpu_samples_s", "app_peak_memory_samples_kb", "cold_launch_samples_s",
    "physical_fps", "composited_first_frame", "authorized_owner_data",
)


def required_routes():
    spec = importlib.util.spec_from_file_location("native_nav", NAV)
    if spec is None or spec.loader is None:
        raise ValueError("Cannot load native route registry")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return {route for route, _ in module.PAGE_PERF_REQUIRED}


def source_routes(source):
    pairs = METHOD.findall(source)
    methods, routes = [x[0] for x in pairs], [x[1] for x in pairs]
    if len(methods) != len(set(methods)) or len(routes) != len(set(routes)):
        raise ValueError("duplicate resource route/test method")
    for token in (
        "XCTCPUMetric(application: app)", "XCTMemoryMetric(application: app)",
        "XCTHitchMetric(application: app)", "XCTApplicationLaunchMetric()",
        "#if compiler(>=6.2)", "if #available(iOS 26.0, *)",
        "XCTOSSignpostMetric.scrollingAndDecelerationMetric",
        "XCTOSSignpostMetric.navigationTransitionMetric",
        "options.iterationCount = 3",
        "options.invocationOptions = [.manuallyStart, .manuallyStop]",
        "startMeasuring()", "stopMeasuring()",
    ):
        if token not in source:
            raise ValueError("Missing actual target-app metric: " + token)
    return set(routes)


def _three_positive(raw, route, metric):
    try:
        values = [float(value.strip()) for value in raw.split(",")]
    except (ValueError, TypeError) as exc:
        raise ValueError("Invalid real resource metric samples: " + route) from exc
    if len(values) != 3 or any(not math.isfinite(v) or v <= 0 for v in values):
        raise ValueError("Missing or invalid three positive real metric samples: "
                         + route + "/" + metric)
    return values


def audit(source, log, metrics, required):
    registered = source_routes(source)
    if registered != required:
        raise ValueError(f"resource route set mismatch missing={sorted(required-registered)} "
                         f"extra={sorted(registered-required)}")
    if not isinstance(metrics, (dict, list)) or not metrics:
        raise ValueError("No real xcresult performance metrics")
    finished = COMPLETE.findall(log)
    if len(finished) != len(required) or {r for r, _ in finished} != required:
        raise ValueError("incomplete or duplicate real resource methods")
    if any(int(n) != 4 for _, n in finished):
        raise ValueError("missing XCTest warmup + three retained trials")
    observed = {}
    for route, iteration in ITER.findall(log):
        observed.setdefault(route, []).append(int(iteration))
    if set(observed) != required or any(
        sorted(vals) != [1, 2, 3, 4] for vals in observed.values()
    ):
        raise ValueError("missing/duplicate real resource iterations")

    method_routes = dict(METHOD.findall(source))
    per_route = {}
    for method, metric_name, metric_values in ROOT_METRIC.findall(log):
        if method not in method_routes:
            raise ValueError("Unregistered real resource XCTest metric method: " + method)
        route = method_routes[method]
        metric = METRIC_KIND[metric_name]
        record = per_route.setdefault(route, {})
        if metric in record:
            raise ValueError("Duplicate real resource metric: " + route + "/" + metric)
        record[metric] = _three_positive(metric_values, route, metric)

    if set(per_route) != required:
        raise ValueError("Missing real per-route CPU/RSS or cold-launch metrics: "
                         + str(sorted(required - set(per_route))))
    rows = []
    for route in sorted(required):
        values = per_route[route]
        cold = route == "app.gallery"
        expected = {"cold_launch_s"} if cold else {"app_cpu_s", "app_peak_memory_kb"}
        if set(values) != expected:
            raise ValueError("Missing or mismatched real per-route CPU/RSS/launch "
                             "metric: " + route)
        rows.append({
            "route": route,
            "metric_type": "cold_app_launch" if cold else "app_cpu_and_peak_memory",
            "retained_trials": 3,
            "app_cpu_samples_s": values.get("app_cpu_s"),
            "app_cpu_p50_s": statistics.median(values["app_cpu_s"])
                if not cold else None,
            "app_peak_memory_samples_kb": values.get("app_peak_memory_kb"),
            "app_peak_memory_p95_mib": max(values["app_peak_memory_kb"]) / 1024.0
                if not cold else None,
            "cold_launch_samples_s": values.get("cold_launch_s"),
            "cold_launch_p50_s": statistics.median(values["cold_launch_s"])
                if cold else None,
        })
    return {
        "exact_commit": os.environ.get("GITHUB_SHA", "unknown"),
        "registered_routes": sorted(required),
        "route_count": len(required),
        "observed_invocations": sum(map(len, observed.values())),
        "retained_trials_per_route": 3,
        "resource_routes_with_3_cpu_and_rss_samples": len(required) - 1,
        "cold_launch_routes_with_3_duration_samples": 1,
        "rows": rows,
        "original_metric_data": "Xcode xcresulttool metrics JSON and CSV, no replacements",
        "xcresult_metric_payload_present": True,
        "simulator_only": True,
        "signed_100k_owner_validation": False,
        "physical_60_120hz_fps": False,
        "first_composited_pixel_measured": False,
        "hitch_metric_requires_xcode26_ios26": True,
        "ios18_signpost_durations_are_not_hitch_ratio": True,
        "not_comparable_with_web_ms": True,
    }


def write_root_csv(report, path):
    """Write only fully audited real page samples, with absent metrics explicit."""
    rows = report.get("rows")
    if (not isinstance(rows, list) or len(rows) != report.get("route_count")
            or len({row["route"] for row in rows}) != len(rows)):
        raise ValueError("Cannot export incomplete real per-route resource metrics")
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=CSV_FIELDS)
        writer.writeheader()
        for row in rows:
            writer.writerow({
                "exact_commit": report["exact_commit"],
                "route": row["route"],
                "metric_type": row["metric_type"],
                "retained_trials": row["retained_trials"],
                "cold_launch_p50_s": row["cold_launch_p50_s"]
                    if row["cold_launch_p50_s"] is not None else "not_measured",
                "app_cpu_p50_s": row["app_cpu_p50_s"]
                    if row["app_cpu_p50_s"] is not None else "not_measured",
                "app_peak_memory_p95_mib": row["app_peak_memory_p95_mib"]
                    if row["app_peak_memory_p95_mib"] is not None else "not_measured",
                "app_cpu_samples_s": json.dumps(row["app_cpu_samples_s"]),
                "app_peak_memory_samples_kb": json.dumps(
                    row["app_peak_memory_samples_kb"]),
                "cold_launch_samples_s": json.dumps(row["cold_launch_samples_s"]),
                "physical_fps": "not_measured",
                "composited_first_frame": "not_measured",
                "authorized_owner_data": "not_measured",
            })


def main():
    if len(sys.argv) != 4:
        raise SystemExit("usage: audit_native_resource_perf.py LOG METRICS_JSON REPORT")
    report = audit(
        SOURCE.read_text(encoding="utf-8"),
        Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace"),
        json.loads(Path(sys.argv[2]).read_text(encoding="utf-8")),
        required_routes(),
    )
    destination = Path(sys.argv[3])
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    write_root_csv(report, destination.with_suffix(".csv"))
    print("IOS_NATIVE_RESOURCE_COMPLETE_ALL routes=" + str(report["route_count"]) +
          " invocations=" + str(report["observed_invocations"]) +
          " measured_cpu_rss=" + str(report["resource_routes_with_3_cpu_and_rss_samples"]) +
          " measured_cold_launch=" +
          str(report["cold_launch_routes_with_3_duration_samples"]))


if __name__ == "__main__":
    main()
