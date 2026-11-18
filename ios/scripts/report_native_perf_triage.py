#!/usr/bin/env python3
"""Audit-bound 75-route iOS CPU/RSS/AX triage; NOT first pixels or FPS."""
import csv
import json
import math
import re
import statistics
import sys
from pathlib import Path

FIELDS = ("source_commit", "kind", "route", "stage_p50_ms",
          "entry_ax_p50_ms", "entry_ax_p95_ms", "return_ax_p50_ms",
          "return_ax_p95_ms", "cpu_p50_s", "rss_p95_mib", "launch_p50_s",
          "first_frame", "fps", "owner", "web_parity",
          "xctest_animation_idle_timeout_count")


def samples(row, key, positive=False):
    v = row.get(key)
    if not isinstance(v, list) or len(v) != 3 or any(
        type(n) not in (int, float) or not math.isfinite(n) or
        (n <= 0 if positive else n < 0) for n in v
    ):
        raise ValueError("Invalid original three XCTest samples: " + key)
    return v


def check(row, key, values, p95=None):
    p50 = statistics.median(values)
    if abs(row.get(key, -1) - p50) > 0.001 or (
        p95 and abs(row.get(p95, -1) - max(values)) > 0.001
    ):
        raise ValueError("Metric summary disagrees with retained samples: " + key)
    return p50


# This token is emitted by the actual Xcode XCTest runner when it stops
# waiting for a native app to become animation-idle after 60 seconds.
# It is not a user-facing first pixel, rendering or FPS measurement.
IDLE_TIMEOUT = "App animations complete notification not received"
ITERATION = re.compile(r"IOS_NATIVE_SUBPAGE_ITERATION route=([a-z0-9.-]+) index=(\\d+)")
AX_TIMING = re.compile(r"IOS_NATIVE_SUBPAGE_PERF_MS route=([a-z0-9.-]+) trial=(\\d+) value=(\\d+)")


def correlate_xctest_idle(log, children):
    """Join *real* raw XCTest idle events with each of the 150 retained AX trials.

    Fail closed on missing, duplicated, out-of-order or mismatched measurements.
    Never classify a 60s test-framework wait as an application render stall.
    """
    if not isinstance(log, str) or not log:
        raise ValueError("Missing original native XCTest trace")
    expected = {row["route"]: row["ax_ready_trial_ms"] for row in children}
    if len(expected) != 50 or any(len(values) != 3 for values in expected.values()):
        raise ValueError("Missing 50 independently audited child routes")
    observed = {route: {} for route in expected}
    current = None
    for line in log.splitlines():
        start = ITERATION.search(line)
        if start:
            if current is not None and current["iteration"] > 1:
                raise ValueError("Unfinished child AX timing before next trial")
            route, index = start.group(1), int(start.group(2))
            if route not in expected or index not in (1, 2, 3, 4):
                raise ValueError("Unexpected child route or XCTest iteration")
            current = {"route": route, "iteration": index, "idle": 0}
            continue
        if current is not None and IDLE_TIMEOUT in line:
            current["idle"] += 1
        match = AX_TIMING.search(line)
        if not match:
            continue
        route, trial, value = match.group(1), int(match.group(2)), int(match.group(3))
        if (current is None or current["route"] != route
                or current["iteration"] != trial + 1
                or trial not in (1, 2, 3)
                or value != expected[route][trial - 1]
                or trial in observed[route]):
            raise ValueError("Orphan, duplicate or mismatched real child AX trial")
        observed[route][trial] = current["idle"]
        current = None
    if current is not None and current["iteration"] > 1:
        raise ValueError("Last child AX trial was not completed")
    if any(set(trials) != {1, 2, 3} for trials in observed.values()):
        raise ValueError("Missing real 150 route/trial AX metrics")
    return {route: [trials[i] for i in (1, 2, 3)]
            for route, trials in observed.items()}


def summarize(root, child, original_xctest_log=None):
    sha = root.get("exact_commit")
    if (not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{40}", sha)
            or child.get("source_commit") != sha):
        raise ValueError("Different or missing exact-source SHA")
    if (root.get("route_count") != 25 or child.get("route_count") != 50
            or root.get("observed_invocations") != 100
            or child.get("recorded_test_invocations") != 200
            or child.get("total_ax_samples") != 150
            or child.get("total_return_samples") != 150
            or root.get("retained_trials_per_route") != 3
            or child.get("retained_trials_per_route") != 3
            or not root.get("xcresult_metric_payload_present")
            or not child.get("raw_xcresult_metrics_present")):
        raise ValueError("Incomplete real 25+50 XCTest evidence")
    rr, cr = root.get("rows"), child.get("rows")
    if not isinstance(rr, list) or len(rr) != 25 or not isinstance(cr, list) or len(cr) != 50:
        raise ValueError("Missing audited per-route observations")
    # Root page names can legitimately equal child entry names, because a
    # different navigation journey into the same view has separate metrics.
    # Disallow duplicate routes *within* either measured family, not across it.
    named_routes = [
        (kind, row.get("route"))
        for kind, rows in (("root", rr), ("child", cr))
        for row in rows
    ]
    if (any(not isinstance(route, str) or not route for _, route in named_routes)
            or len(set(named_routes)) != 75):
        raise ValueError("Duplicate or missing root/child routes")
    idle_by_route = (correlate_xctest_idle(original_xctest_log, cr)
                     if original_xctest_log is not None else {})
    result, review = [], []
    for kind, source_rows in (("root", rr), ("child", cr)):
        for r in source_rows:
            v = dict.fromkeys(FIELDS, "not_measured")
            v.update(source_commit=sha, kind=kind, route=r["route"],
                     web_parity="not_verified")
            if kind == "root":
                if r.get("metric_type") == "cold_app_launch":
                    s = samples(r, "cold_launch_samples_s", positive=True)
                    v["launch_p50_s"] = check(r, "cold_launch_p50_s", s)
                elif r.get("metric_type") == "app_cpu_and_peak_memory":
                    s = samples(r, "app_cpu_samples_s", positive=True)
                    mem = samples(r, "app_peak_memory_samples_kb", positive=True)
                    v["cpu_p50_s"] = check(r, "app_cpu_p50_s", s)
                    v["rss_p95_mib"] = max(mem) / 1024
                    if abs(r.get("app_peak_memory_p95_mib", -1) - v["rss_p95_mib"]) > 0.001:
                        raise ValueError("Invalid root peak RSS")
                else:
                    raise ValueError("Unknown root metric")
            else:
                stage = samples(r, "parent_stage_trial_ms")
                enter = samples(r, "ax_ready_trial_ms")
                back = samples(r, "return_ax_ready_trial_ms")
                cpu = samples(r, "app_cpu_time_trial_s", positive=True)
                mem = samples(r, "app_peak_memory_trial_kb", positive=True)
                v["stage_p50_ms"] = check(r, "parent_stage_p50_ms", stage, "parent_stage_p95_ms")
                v["entry_ax_p50_ms"] = check(r, "ax_ready_p50_ms", enter, "ax_ready_p95_ms")
                v["entry_ax_p95_ms"] = max(enter)
                v["return_ax_p50_ms"] = check(r, "return_ax_ready_p50_ms", back, "return_ax_ready_p95_ms")
                v["return_ax_p95_ms"] = max(back)
                if idle_by_route:
                    v["xctest_animation_idle_timeout_count"] = sum(idle_by_route[r["route"]])
                v["cpu_p50_s"] = check(r, "app_cpu_time_p50_s", cpu)
                v["rss_p95_mib"] = max(mem) / 1024
                if abs(r.get("app_peak_memory_p95_mib", -1) - v["rss_p95_mib"]) > 0.001:
                    raise ValueError("Invalid child peak RSS")
                for phase, trial in (("entry_ax", enter), ("return_ax", back)):
                    p50, p95 = statistics.median(trial), max(trial)
                    if p50 >= 30000 or (p95 >= 30000 and p95 / max(p50, 1) >= 3):
                        review.append(dict(route=r["route"], phase=phase,
                            original_ms=trial, p50_ms=p50, p95_ms=p95,
                            evidence=("xctest_animation_idle_timeout_observed_not_ui_stall"
                                      if phase == "entry_ax" and
                                      sum(idle_by_route.get(r["route"], [])) > 0
                                      else "investigate_xctest_idling_vs_ui_not_proven_stall"),
                            xctest_idle_timeout_trials=idle_by_route.get(r["route"],
                                                                        "not_measured")))
            result.append(v)
    ranked = {}
    for metric in ("entry_ax", "return_ax"):
        k = metric + "_p50_ms"
        ranked[metric] = [dict(route=r["route"], p50_ms=r[k],
             p95_ms=r[metric + "_p95_ms"]) for r in sorted(
             [r for r in result if r["kind"] == "child"],
             key=lambda r: (-r[k], r["route"]))[:10]]
    return dict(source_commit=sha, root_routes=25, child_routes=50,
        runtime="ios_simulator_no_session", metrics_include_xctest_idling=True,
        first_composited_frame_measured=False, physical_fps_measured=False,
        web_equivalence_verified=False, slowest_child=ranked,
        idle_timeout_samples=(sum(map(sum, idle_by_route.values()))
                              if idle_by_route else "not_measured"),
        idle_timeout_affected_routes=(sorted(r for r, values in idle_by_route.items()
                                              if any(values)) if idle_by_route
                                      else "not_measured"),
        diagnostics=sorted(review, key=lambda x: (-x["p95_ms"], x["route"])),
        rows=result)


def main():
    if len(sys.argv) != 5:
        raise SystemExit("usage: report_native_perf_triage.py ROOT_JSON CHILD_JSON OUTPUT_JSON XCODEBUILD_LOG")
    report = summarize(json.loads(Path(sys.argv[1]).read_text()),
                       json.loads(Path(sys.argv[2]).read_text()),
                       Path(sys.argv[4]).read_text(encoding="utf-8", errors="replace"))
    destination = Path(sys.argv[3])
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    with destination.with_suffix(".csv").open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(report["rows"])
    print("IOS_NATIVE_PERF_TRIAGE roots=25 children=50 source_sha=" + report["source_commit"])
    print("IOS_NATIVE_XCTEST_IDLE_TIMEOUT retained_trials=150 wait_events=" +
          str(report["idle_timeout_samples"]) + " affected_routes=" +
          str(report["idle_timeout_affected_routes"]))
    for row in report["diagnostics"]:
        print("IOS_NATIVE_PERF_REVIEW route={route} phase={phase} p50_ms={p50_ms}"
              " p95_ms={p95_ms} actual_visible_stall=not_verified".format(**row))


if __name__ == "__main__":
    main()
