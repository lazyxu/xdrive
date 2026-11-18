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
          "first_frame", "fps", "owner", "web_parity")


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


def summarize(root, child):
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
                v["cpu_p50_s"] = check(r, "app_cpu_time_p50_s", cpu)
                v["rss_p95_mib"] = max(mem) / 1024
                if abs(r.get("app_peak_memory_p95_mib", -1) - v["rss_p95_mib"]) > 0.001:
                    raise ValueError("Invalid child peak RSS")
                for phase, trial in (("entry_ax", enter), ("return_ax", back)):
                    p50, p95 = statistics.median(trial), max(trial)
                    if p50 >= 30000 or (p95 >= 30000 and p95 / max(p50, 1) >= 3):
                        review.append(dict(route=r["route"], phase=phase,
                            original_ms=trial, p50_ms=p50, p95_ms=p95,
                            evidence="investigate_xctest_idling_vs_ui_not_proven_stall"))
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
        diagnostics=sorted(review, key=lambda x: (-x["p95_ms"], x["route"])),
        rows=result)


def main():
    if len(sys.argv) != 4:
        raise SystemExit("usage: report_native_perf_triage.py ROOT_JSON CHILD_JSON OUTPUT_JSON")
    report = summarize(json.loads(Path(sys.argv[1]).read_text()),
                       json.loads(Path(sys.argv[2]).read_text()))
    destination = Path(sys.argv[3])
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    with destination.with_suffix(".csv").open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(report["rows"])
    print("IOS_NATIVE_PERF_TRIAGE roots=25 children=50 source_sha=" + report["source_commit"])
    for row in report["diagnostics"]:
        print("IOS_NATIVE_PERF_REVIEW route={route} phase={phase} p50_ms={p50_ms}"
              " p95_ms={p95_ms} actual_visible_stall=not_verified".format(**row))


if __name__ == "__main__":
    main()
