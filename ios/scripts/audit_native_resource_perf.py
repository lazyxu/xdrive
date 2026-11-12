#!/usr/bin/env python3
"""Source+runtime completeness for actual native-app XCTest resource metrics."""
import importlib.util
import json
import os
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "ios/UITests/XDriveIOSNativeResourcePerformanceUITests.swift"
NAV = ROOT / "ios/scripts/summarize-navigation-latency.py"
METHOD = re.compile(
    r'func\s+(testResource[A-Za-z0-9]+)\(\)\s*\{\s*(?:run|runCold)\("([a-z0-9.-]+)"\)\s*\}'
)
COMPLETE = re.compile(r'IOS_NATIVE_RESOURCE_COMPLETE route=([a-z0-9.-]+) invocations=(\d+)')
ITER = re.compile(r'IOS_NATIVE_RESOURCE_ITERATION route=([a-z0-9.-]+) index=(\d+)')


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
    return {
        "exact_commit": os.environ.get("GITHUB_SHA", "unknown"),
        "registered_routes": sorted(required),
        "route_count": len(required),
        "observed_invocations": sum(map(len, observed.values())),
        "retained_trials_per_route": 3,
        "original_metric_data": "Xcode xcresulttool metrics JSON and CSV, no replacements",
        "xcresult_metric_payload_present": True,
        "simulator_only": True,
        "signed_100k_owner_validation": False,
        "physical_60_120hz_fps": False,
        "hitch_metric_requires_xcode26_ios26": True,
        "ios18_signpost_durations_are_not_hitch_ratio": True,
        "not_comparable_with_web_ms": True,
    }


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
    destination.write_text(json.dumps(report, ensure_ascii=False, indent=2)+"\n")
    print("IOS_NATIVE_RESOURCE_COMPLETE_ALL routes=" + str(report["route_count"]) +
          " invocations=" + str(report["observed_invocations"]))


if __name__ == "__main__":
    main()
