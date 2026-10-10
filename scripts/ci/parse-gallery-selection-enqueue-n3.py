#!/usr/bin/env python3
"""Parse independently executed 10k/100k Gallery selection enqueue baseline runs."""
import json
import pathlib
import statistics
import sys

SCALES = (10000, 100000)
SAMPLE_COUNT = 3
PREFIX = "G07_SELECTION_JOB_BASELINE "


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: parse-gallery-selection-enqueue-n3.py <results-directory>")
    root = pathlib.Path(sys.argv[1])
    rows = []
    for sample in range(1, SAMPLE_COUNT + 1):
        logfile = root / f"sample-{sample}.log"
        body = logfile.read_text(encoding="utf-8")
        sample_rows = [
            json.loads(line.split(PREFIX, 1)[1])
            for line in body.splitlines()
            if PREFIX in line
        ]
        if len(sample_rows) != len(SCALES):
            raise SystemExit(f"{logfile}: want {len(SCALES)} complete benchmark rows, got {len(sample_rows)}")
        if {row["scale"] for row in sample_rows} != set(SCALES):
            raise SystemExit(f"{logfile}: incorrect scales: {sample_rows}")
        for row in sample_rows:
            scale = row["scale"]
            if row["samples"] != 1 or row["chunks"] != scale // 100:
                raise SystemExit(f"{logfile}: incorrect scale/sample/chunk counts: {row}")
            if not all(isinstance(row[k], int) and row[k] >= 0
                       for k in ("enqueue_ms", "worker_ms", "fixture_ms", "heap_before_bytes", "heap_after_bytes")):
                raise SystemExit(f"{logfile}: incomplete timers or memory metadata: {row}")
            rows.append({"independent_process_sample": sample, **row})

    budgets = {"10000_enqueue_p50_ms": 750, "100000_enqueue_p50_ms": 3000,
               "100000_worker_p50_ms": 60000}
    aggregate = {}
    for scale in SCALES:
        values = [row for row in rows if row["scale"] == scale]
        result = {}
        for key in ("enqueue_ms", "worker_ms", "fixture_ms"):
            samples = [v[key] for v in values]
            result[key] = {"samples": samples, "median": statistics.median(samples),
                           "minimum": min(samples), "maximum": max(samples)}
        aggregate[str(scale)] = result
    acceptance = {
        "10000_enqueue_p50_pass": aggregate["10000"]["enqueue_ms"]["median"] <= budgets["10000_enqueue_p50_ms"],
        "100000_enqueue_p50_pass": aggregate["100000"]["enqueue_ms"]["median"] <= budgets["100000_enqueue_p50_ms"],
        "100000_worker_p50_pass": aggregate["100000"]["worker_ms"]["median"] <= budgets["100000_worker_p50_ms"],
    }
    summary = {
        "status": "measured-current-before-only-not-a-product-optimization",
        "scope": "native PostgreSQL17/Gin/Go durable Gallery selection job, 100k Node/PhotoAsset/PhotoMetadata rows, metadata-only; no Web/Desktop/Agent or CAS bytes",
        "sampling": "three independent Go test processes and isolated PostgreSQL schemas per scale, no fixture time in operation timer",
        "sample_count_per_scale": SAMPLE_COUNT,
        "acceptance_budgets": budgets,
        "acceptance": acceptance,
        "decision": "baseline red: consider smallest enqueue batch optimization only after actual n3 results" if not all(acceptance.values()) else "current accepted; leave production code unchanged",
        "aggregates": aggregate,
        "raw_rows": rows,
    }
    output = root / "summary.json"
    output.write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("G07_SELECTION_ENQUEUE_N3_SUMMARY " + json.dumps(summary, separators=(",", ":")))


if __name__ == "__main__":
    main()
