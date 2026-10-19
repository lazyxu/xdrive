#!/usr/bin/env python3
"""Validate genuine paired P062 owner HTTP Cancel at exact P061 original/candidate Go."""
import json
import os
import statistics
import sys
from pathlib import Path

TOPOLOGIES = ("local", "remote")
SAMPLES = ("sample-1", "sample-2", "sample-3")
ARMS = ("original", "candidate")
REPORT = "P062_REAL_100K_CANCEL "
FIELDS = (
    "cancel_start_to_worker_exit_ms",
    "cancel_http_ms",
    "go_rss_growth_bytes",
    "worker_until_cancel_ms",
)

def check_row(row, topo, sample):
    assert row["workload"] == "P062-authenticated-100k-physical-CAS-owner-copy-cancel"
    assert row["topology"] == topo and row["sample"] == sample
    assert row["smoke_only"] is False
    assert row["passed"] is True
    assert row["physical_sources"] == 100000
    assert row["remaining_target_nodes"] == 0
    assert row["original_one_ref_count"] == 100001
    assert row["physical_CAS_object_count"] == 100001
    assert row["physical_allocated_bytes_before"] == 409604096
    assert row["physical_allocated_bytes_after"] == 409604096
    assert 0 <= row["cancel_start_to_worker_exit_ms"] <= 1000
    assert 0 <= row["cancel_http_ms"] <= 1000
    assert 0 <= row["go_rss_growth_bytes"] <= 512 * 1024 * 1024
    return row

def main(folder):
    folder = Path(folder)
    data = {}
    for topo in TOPOLOGIES:
        for sample in SAMPLES:
            for arm in ARMS:
                key = (topo, sample, arm)
                log = (folder / f"{topo}-{sample}-{arm}.log").read_text()
                lines = [x for x in log.splitlines() if REPORT in x]
                if len(lines) != 1:
                    raise RuntimeError(f"missing genuine single Go 100k cancel record: {key}, got {len(lines)}")
                row = check_row(json.loads(lines[0].split(REPORT, 1)[1]), topo, sample)
                data[key] = row
                (folder / f"{topo}-{sample}-{arm}.json").write_text(
                    json.dumps(row, indent=2, sort_keys=True) + "\n"
                )
            original = data[topo, sample, "original"]
            candidate = data[topo, sample, "candidate"]
            assert original["source_aggregate_sha256"] == candidate["source_aggregate_sha256"], (
                "original/candidate physical CAS SHA differs", topo, sample
            )
    for sample in SAMPLES:
        assert data["local", sample, "original"]["source_aggregate_sha256"] == (
            data["remote", sample, "original"]["source_aggregate_sha256"]
        )
    table = {}
    safe = True
    for topo in TOPOLOGIES:
        table[topo] = {}
        for arm in ARMS:
            records = [data[topo, sample, arm] for sample in SAMPLES]
            table[topo][arm] = {
                "median": {m: statistics.median(r[m] for r in records) for m in FIELDS},
                "maximum": {m: max(r[m] for r in records) for m in FIELDS},
                "source_hashes": [r["source_aggregate_sha256"] for r in records],
            }
        base = table[topo]["original"]
        candidate = table[topo]["candidate"]
        p50_extra = candidate["median"]["cancel_start_to_worker_exit_ms"] - base["median"]["cancel_start_to_worker_exit_ms"]
        max_extra = candidate["maximum"]["cancel_start_to_worker_exit_ms"] - base["maximum"]["cancel_start_to_worker_exit_ms"]
        within_extra = p50_extra <= 50 and max_extra <= 50
        table[topo]["cancel_p50_added_ms"] = p50_extra
        table[topo]["cancel_max_added_ms"] = max_extra
        table[topo]["candidate_no_material_cancel_regression"] = within_extra
        safe = safe and within_extra
    result = {
        "workload": "P063-authenticated-100k-Copy-paired-original-vs-P061-candidate-user-cancel",
        "n_per_arm_per_topology": 3,
        "real_distinct_physical_sources_per_sample": 100000,
        "arm_order_each_topology": [
            "sample-1:original", "sample-1:candidate",
            "sample-2:candidate", "sample-2:original",
            "sample-3:original", "sample-3:candidate",
        ],
        "hard_worker_http_cancel_ms": 1000,
        "max_allowed_added_cancel_p50_or_max_ms": 50,
        "topologies": table,
        "candidate_cancellation_accepted": safe,
        "candidate_production_approved": False,
        "production_modified": False,
        "decision": "CANCEL_ONLY_ACCEPTED_NOT_PRODUCTION_AUTHORIZED" if safe else "REJECT_CANDIDATE_CANCEL_REGRESSION",
    }
    (folder / "summary.json").write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print("P063_PAIRED_100K_CANCEL_RESULT " + json.dumps(result, sort_keys=True))

if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: p063_copy_cancel_pair_summary.py evidence-dir")
    main(sys.argv[1])
