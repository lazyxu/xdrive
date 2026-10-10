#!/usr/bin/env python3
"""Validate and aggregate native 10k/100k Worker SELECT SQL-stage diagnostics."""
import json
import pathlib
import statistics
import sys

SCALES = (10000, 100000)
STAGES = ("jobs", "items", "nodes", "assets", "metadata")
PREFIX = "G07_SELECTION_JOB_BASELINE "


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: parse-gallery-worker-select-n3.py <results-dir>")
    root = pathlib.Path(sys.argv[1])
    rows = []
    for sample in (1, 2, 3):
        path = root / f"sample-{sample}.log"
        lines = path.read_text(encoding="utf-8").splitlines()
        matches = [json.loads(line.split(PREFIX, 1)[1])
                   for line in lines if PREFIX in line]
        if {r.get("scale") for r in matches} != set(SCALES) or len(matches) != 2:
            raise SystemExit(f"{path}: expected exact 10k+100k complete result rows")
        for row in matches:
            scale = row["scale"]
            details = row.get("worker_select_detail")
            if not isinstance(details, dict) or set(details) != set(STAGES):
                raise SystemExit(f"{path}: incomplete Worker SELECT table attribution")
            for stage in STAGES:
                entry = details[stage]
                if entry.get("statements") != scale // 100:
                    raise SystemExit(f"{path}: {stage} count={entry.get('statements')}")
                if not all(isinstance(entry.get(k), (int, float)) and entry[k] >= 0
                           for k in ("total_ms", "p50_ms", "p95_ms", "max_ms")):
                    raise SystemExit(f"{path}: invalid {stage} timing data")
                if entry["p50_ms"] > entry["p95_ms"] or entry["p95_ms"] > entry["max_ms"]:
                    raise SystemExit(f"{path}: invalid {stage} latency percentiles")
            rows.append({"independent_process_sample": sample, **row})
    groups = {}
    for scale in SCALES:
        group = [r for r in rows if r["scale"] == scale]
        stage_stats = {}
        for stage in STAGES:
            stage_stats[stage] = {}
            for key in ("statements", "total_ms", "p50_ms", "p95_ms", "max_ms"):
                values = [r["worker_select_detail"][stage][key] for r in group]
                stage_stats[stage][key] = {
                    "samples": values,
                    "median": statistics.median(values),
                    "min": min(values),
                    "max": max(values),
                }
        worker_ms = [r["worker_ms"] for r in group]
        groups[str(scale)] = {
            "worker_ms": {"samples": worker_ms,
                          "median": statistics.median(worker_ms)},
            "worker_select": stage_stats,
            "worker_select_total_ms": [sum(
                r["worker_select_detail"][stage]["total_ms"] for stage in STAGES)
                for r in group],
        }
    summary = {
        "status": "test-only-real-postgresql-sql-query-stage-attribution",
        "sample_count_per_scale": 3,
        "workload": "10k/100k actual immutable selection favorites, 100-item SQL Worker checkpoints, independent Go/PostgreSQL schema each run",
        "limits": "GORM Trace SQL client/driver/observer wall time, not PostgreSQL CPU/I/O or EXPLAIN; transaction commit and fixture excluded; separate current baseline, not matched speedup",
        "raw_rows": rows,
        "aggregates": groups,
        "next": "Profile any dominant SELECT plan under real PG before considering a production optimization; retain existing Worker batches and cancellation",
    }
    (root / "worker-query-summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("G07_WORKER_SELECT_N3_SUMMARY " + json.dumps(summary, separators=(",", ":")))


if __name__ == "__main__":
    main()
