#!/usr/bin/env python3
"""Compare matched 10k/100k before/after Gallery selection performance trials."""
import json
import pathlib
import sys


def median(doc, scale, field):
    return doc["aggregates"][str(scale)][field]["median"]


def timing(path):
    result = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if "=" in line:
            key, number = line.split("=", 1)
            result[key] = float(number)
    for name in ("maxrss_kib", "user_cpu_seconds", "system_cpu_seconds"):
        if name not in result:
            raise ValueError(f"missing {name} in {path}")
    return result


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: compare-gallery-selection-enqueue-n3.py <paired-root>")
    root = pathlib.Path(sys.argv[1])
    before = json.loads((root / "before" / "summary.json").read_text(encoding="utf-8"))
    after = json.loads((root / "after" / "summary.json").read_text(encoding="utf-8"))
    for arm in (before, after):
        if arm["sample_count_per_scale"] != 3 or len(arm["raw_rows"]) != 6:
            raise SystemExit("three complete independent processes per scale required")
    prior = median(before, 100000, "enqueue_ms")
    candidate = median(after, 100000, "enqueue_ms")
    improvement = 100.0 * (prior - candidate) / prior
    resource_rows = []
    for sample in (1, 2, 3):
        old = timing(root / "before" / f"sample-{sample}.time")
        new = timing(root / "after" / f"sample-{sample}.time")
        limit = old["maxrss_kib"] + max(32768, 0.25 * old["maxrss_kib"])
        resource_rows.append({
            "sample": sample, "before": old, "after": new, "rss_limit_kib": limit,
            "rss_nonregression": new["maxrss_kib"] <= limit,
        })
    gates = {
        "100k_after_enqueue_p50_at_most_3000ms": candidate <= 3000,
        "100k_enqueue_relative_improvement_at_least_30pct": improvement >= 30,
        "10k_enqueue_nonregression_10pct": median(after, 10000, "enqueue_ms") <= median(before, 10000, "enqueue_ms") * 1.10,
        "100k_worker_nonregression_15pct": median(after, 100000, "worker_ms") <= median(before, 100000, "worker_ms") * 1.15,
        "process_rss_no_material_regression": all(r["rss_nonregression"] for r in resource_rows),
    }
    result = {
        "status": "real-native-postgresql-3-paired-before-after-samples",
        "original": before, "candidate": after,
        "n3_100k_enqueue_before_ms": prior, "n3_100k_enqueue_after_ms": candidate,
        "improvement_percent": improvement, "process_cpu_and_rss": resource_rows,
        "frozen_gates": gates, "accepted": all(gates.values()),
        "boundary": "100k Node/PhotoAsset/Metadata SQL metadata; whole-process peak RSS includes fixture and worker, not isolated enqueue; worker 60s budget reported independently.",
    }
    (root / "comparison.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print("G07_SELECTION_PAIRED_N3_SUMMARY " + json.dumps(result, separators=(",", ":")))
    if not result["accepted"]:
        raise SystemExit("paired performance experiment fails frozen budget; reject production candidate")


if __name__ == "__main__":
    main()
