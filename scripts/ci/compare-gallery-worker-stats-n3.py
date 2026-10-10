#!/usr/bin/env python3
"""Compare native 100k durable Worker before/after test-fixture PostgreSQL ANALYZE."""
import json
import pathlib
import statistics
import sys


def med(values):
    return statistics.median(values)


def timefile(path):
    output = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            output[key] = float(value)
    for key in ("maxrss_kib", "user_cpu_seconds", "system_cpu_seconds"):
        if key not in output:
            raise ValueError(f"{path}: missing {key}")
    return output


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: compare-gallery-worker-stats-n3.py <paired-root>")
    root = pathlib.Path(sys.argv[1])
    summaries = {}
    for arm in ("before", "after"):
        source = root / arm / "summary.json"
        data = json.loads(source.read_text(encoding="utf-8"))
        if data["sample_count_per_scale"] != 3 or len(data["raw_rows"]) != 6:
            raise SystemExit(f"{source}: need three independent processes per scale")
        expected_mode = "original" if arm == "before" else "analyzed"
        for row in data["raw_rows"]:
            if row.get("stats_mode") != expected_mode or row["chunks"] != row["scale"] // 100:
                raise SystemExit(f"{source}: wrong fixture stats mode/chunks: {row}")
            if arm == "before" and row.get("stats_refresh_ms") != 0:
                raise SystemExit(f"{source}: before arm unexpectedly refreshed stats")
            if arm == "after" and row.get("stats_refresh_ms", -1) < 0:
                raise SystemExit(f"{source}: after arm missing analyzed stat timing")
        summaries[arm] = data
    before, after = summaries["before"], summaries["after"]
    b = before["aggregates"]
    a = after["aggregates"]
    work_pre = b["100000"]["worker_ms"]["median"]
    work_post = a["100000"]["worker_ms"]["median"]
    improvement = (work_pre - work_post) / work_pre * 100
    resources = []
    for sample in (1, 2, 3):
        old = timefile(root / "before" / f"sample-{sample}.time")
        new = timefile(root / "after" / f"sample-{sample}.time")
        upper = old["maxrss_kib"] + max(32768, old["maxrss_kib"] * .25)
        resources.append({
            "sample": sample, "before": old, "after": new,
            "rss_limit_kib": upper, "rss_nonregression": new["maxrss_kib"] <= upper
        })
    gates = {
        "100k_worker_after_p50_at_most_60s": work_post <= 60000,
        "100k_worker_relative_improvement_at_least_25pct": improvement >= 25,
        "10k_worker_nonregression_10pct": a["10000"]["worker_ms"]["median"] <= b["10000"]["worker_ms"]["median"] * 1.10,
        "100k_enqueue_nonregression_10pct": a["100000"]["enqueue_ms"]["median"] <= b["100000"]["enqueue_ms"]["median"] * 1.10,
        "process_rss_no_material_regression": all(r["rss_nonregression"] for r in resources)
    }
    stats_elapsed_ms = [
        row["stats_refresh_ms"] for row in after["raw_rows"]
        if row["scale"] == 100000
    ]
    result = {
        "status": "native-postgresql-test-fixture-statistics-worker-n3-paired",
        "purpose": "diagnose missing fixture ANALYZE; not product code or shipped runtime speedup",
        "before": before, "after": after,
        "improvement_percent": improvement,
        "100k_worker_p50_before_ms": work_pre, "100k_worker_p50_after_ms": work_post,
        "100k_analyze_fixture_ms": stats_elapsed_ms,
        "full_process_resources": resources,
        "frozen_diagnostic_gates": gates,
        "diagnostic_positive": all(gates.values()),
        "limitations": "Postgres ANALYZE applied only to isolated tests after enqueue, outside Worker timer; process RSS includes Go start, fixture and Worker. This does not change deployed runtime/index/autoanalyze, real 100k CAS media or end-to-end Web/Desktop transfer."
    }
    (root / "comparison.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print("G07_WORKER_STATS_N3_PAIRED_SUMMARY " + json.dumps({
        "before_worker_p50_ms": work_pre,
        "after_worker_p50_ms": work_post,
        "improvement_percent": improvement,
        "gates": gates,
        "diagnostic_positive": result["diagnostic_positive"],
        "100k_stats_refresh_ms": stats_elapsed_ms
    }, separators=(",", ":")))


if __name__ == "__main__":
    main()
