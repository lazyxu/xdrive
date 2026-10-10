#!/usr/bin/env python3
"""Compare native PostgreSQL EXPLAIN for just-seeded versus ANALYZE-refreshed fixture."""
import json
import pathlib
import statistics
import sys

PREFIX = "G07_WORKER_QUERY_EXPLAIN "
SCALES = (10000, 100000)
CATEGORIES = ("nodes", "assets")
PHASES = ("before_analyze", "after_analyze")
REPEATS = (1, 2)


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: parse-gallery-worker-query-plans-n3.py <results-dir>")
    root = pathlib.Path(sys.argv[1])
    rows = []
    for sample in (1, 2, 3):
        logfile = root / f"sample-{sample}.log"
        found = [
            json.loads(line.split(PREFIX, 1)[1])
            for line in logfile.read_text(encoding="utf-8").splitlines()
            if PREFIX in line
        ]
        expected = {
            (scale, phase, offset, repeat, category)
            for scale in SCALES
            for phase in PHASES
            for offset in (0, scale // 2, scale - 100)
            for repeat in REPEATS
            for category in CATEGORIES
        }
        keys = [(r["scale"], r["stats_phase"], r["offset"], r["repeat"], r["category"])
                for r in found]
        if len(keys) != len(expected) or set(keys) != expected:
            raise SystemExit(f"{logfile}: missing/duplicate/wrong plan rows: {keys}")
        for row in found:
            if row["source_rows"] != 100 or not row["plan_nodes"]:
                raise SystemExit(f"{logfile}: invalid rows or plan: {row}")
            if not isinstance(row["plan_json"], list) or len(row["plan_json"]) != 1:
                raise SystemExit(f"{logfile}: missing original JSON plan")
            for key in ("planning_ms", "execution_ms", "shared_hit_blocks",
                        "shared_read_blocks", "temp_read_blocks", "temp_written_blocks"):
                if not isinstance(row[key], (int, float)) or row[key] < 0:
                    raise SystemExit(f"{logfile}: invalid {key}: {row.get(key)}")
            rows.append({"independent_process_sample": sample, **row})
    aggregates = {}
    for scale in SCALES:
        phases = {}
        for phase in PHASES:
            groups = {}
            for category in CATEGORIES:
                subset = [r for r in rows if r["scale"] == scale and
                          r["category"] == category and r["stats_phase"] == phase]
                duration = [r["execution_ms"] for r in subset]
                layouts = {}
                for row in subset:
                    key = "|".join(row["plan_nodes"])
                    layouts[key] = layouts.get(key, 0) + 1
                groups[category] = {
                    "count": len(subset),
                    "execution_ms": {
                        "samples": duration,
                        "median": statistics.median(duration),
                        "min": min(duration),
                        "max": max(duration),
                    },
                    "plan_layout_counts": layouts,
                    "shared_hit_blocks_total": sum(r["shared_hit_blocks"] for r in subset),
                    "shared_read_blocks_total": sum(r["shared_read_blocks"] for r in subset),
                    "max_rows_removed_by_filter": max(
                        r["plan_json"][0]["Plan"].get("Rows Removed by Filter", 0)
                        for r in subset),
                }
            phases[phase] = groups
        aggregates[str(scale)] = phases
    report = {
        "status": "test-only-native-postgresql-before-after-analyze",
        "sample_count": 3,
        "source": "Original GORM Worker-equivalent Node FOR UPDATE and PhotoAsset SELECT, 100 ID windows at first/middle/deep offset, two replay passes per window, three independent native PostgreSQL schemas",
        "limitations": "Fixture-only PostgreSQL statistics ANALYZE is not production SQL/index optimization. EXPLAIN executes each SELECT and warms cache. No durable Worker during EXPLAIN; independent different-runner performance cannot be compared as production AFTER.",
        "raw_rows": rows,
        "aggregates": aggregates,
    }
    (root / "summary.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("G07_WORKER_EXPLAIN_N3_SUMMARY " + json.dumps({
        "status": report["status"],
        "sample_count": 3,
        "aggregates": aggregates
    }, separators=(",", ":")))


if __name__ == "__main__":
    main()
