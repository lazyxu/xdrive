#!/usr/bin/env python3
"""Isolated CAS file-data tar-stage benchmark; NOT a complete Server backup."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import resource
import subprocess
import tempfile
import time
from statistics import median

MIB = 1024 * 1024
SCENARIOS = {"unchanged": 0, "one-percent-new-versions": 1, "all-new-versions": 100}

def sha256(path):
    result = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(MIB):
            result.update(chunk)
    return result.hexdigest()

def allocate(root, originals, count, size):
    for _ in range(count):
        content = os.urandom(size)
        digest = hashlib.sha256(content).hexdigest()
        rel = ".xdrive-blobs/sha256/" + digest[:2] + "/" + digest
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            raise AssertionError("unexpected duplicate physical CAS SHA")
        with path.open("xb") as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
        originals[rel] = digest

def snapshot(root, archive):
    begin = time.perf_counter()
    cpu = resource.getrusage(resource.RUSAGE_CHILDREN)
    with archive.open("xb") as f:
        subprocess.run(["tar", "-cf", "-", "."], cwd=root, stdout=f,
                       stderr=subprocess.PIPE, check=True)
        f.flush()
        os.fsync(f.fileno())
    new_cpu = resource.getrusage(resource.RUSAGE_CHILDREN)
    elapsed = (time.perf_counter() - begin) * 1000
    begin = time.perf_counter()
    digest = sha256(archive)
    sha_ms = (time.perf_counter() - begin) * 1000
    return {
        "tar_wall_ms": elapsed, "checksum_wall_ms": sha_ms,
        "tar_cpu_ms": 1000 * (new_cpu.ru_utime + new_cpu.ru_stime - cpu.ru_utime - cpu.ru_stime),
        "child_rss_high_water_kib": new_cpu.ru_maxrss,
        "archive_bytes": archive.stat().st_size,
        "archive_allocated_bytes": archive.stat().st_blocks * 512,
        "archive_sha256": digest
    }

def restore_and_verify(archive, expected, destination):
    destination.mkdir()
    begin = time.perf_counter()
    subprocess.run(["tar", "-xf", str(archive), "-C", str(destination)],
                   stderr=subprocess.PIPE, check=True)
    extract_ms = (time.perf_counter() - begin) * 1000
    begin = time.perf_counter()
    actual = {str(p.relative_to(destination)): p for p in destination.rglob("*") if p.is_file()}
    if set(actual) != set(expected):
        raise AssertionError("wrong physical CAS set after restore")
    for key, digest in expected.items():
        if sha256(actual[key]) != digest:
            raise AssertionError("CAS SHA mismatch after restore")
    return {"restore_wall_ms": extract_ms,
            "verified_sha_wall_ms": (time.perf_counter() - begin) * 1000,
            "physical_cas_files": len(actual),
            "restored_logical_bytes": sum(p.stat().st_size for p in actual.values())}

def run(root, scenario, sample, size, budget):
    root.mkdir()
    originals = {}
    cas = root / "data"
    cas.mkdir()
    allocate(cas, originals, 100, size)
    original_gen = dict(originals)
    first = snapshot(cas, root / "generation-1.tar")
    first_restored = restore_and_verify(root / "generation-1.tar", original_gen, root / "restored-1")
    increment = SCENARIOS[scenario]
    allocate(cas, originals, increment, size)
    second = snapshot(cas, root / "generation-2.tar")
    second_restored = restore_and_verify(root / "generation-2.tar", originals, root / "restored-2")
    if first_restored["physical_cas_files"] != 100 or second_restored["physical_cas_files"] != 100 + increment:
        raise AssertionError("physical restored file-count mismatch")
    if max(first["tar_wall_ms"], second["tar_wall_ms"]) > budget * 1000:
        raise AssertionError("frozen original tar-wall budget exceeded")
    disk = sum(p.stat().st_blocks * 512 for p in cas.rglob("*") if p.is_file())
    return {"scenario": scenario, "sample": sample, "passed": True,
            "original_physical_cas": 100, "original_bytes": size * 100,
            "added_physical_versions": increment, "added_version_bytes": increment * size,
            "final_physical_cas": len(originals), "final_cas_allocated_bytes": disk,
            "generation1": first, "generation2": second,
            "restore1": first_restored, "restore2": second_restored,
            "two_archive_allocated_bytes": first["archive_allocated_bytes"] + second["archive_allocated_bytes"],
            "two_archive_bytes": first["archive_bytes"] + second["archive_bytes"]}

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--results-dir", type=Path, required=True)
    p.add_argument("--object-bytes", type=int, default=4 * MIB)
    p.add_argument("--samples", type=int, default=3)
    p.add_argument("--tar-budget-seconds", type=int, default=180)
    a = p.parse_args()
    if a.object_bytes < 4096 or a.object_bytes % 512 or not 1 <= a.samples <= 3:
        p.error("object-bytes must be >=4096 and a multiple of 512; samples 1..3")
    a.results_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    for scenario in SCENARIOS:
        for sample in range(1, a.samples + 1):
            with tempfile.TemporaryDirectory(prefix="xdrive-cas-a04a-") as tmp:
                row = run(Path(tmp) / "fixture", scenario, sample, a.object_bytes,
                          a.tar_budget_seconds)
            (a.results_dir / f"{scenario}-{sample}.json").write_text(json.dumps(row, indent=2) + "\n")
            print("CAS_A04A_SAMPLE " + json.dumps({
                "scenario": scenario, "sample": sample,
                "two_archive_bytes": row["two_archive_bytes"],
                "gen2_ms": row["generation2"]["tar_wall_ms"]}), flush=True)
            rows.append(row)
    metrics = {}
    for scenario in SCENARIOS:
        matched = [r for r in rows if r["scenario"] == scenario]
        metrics[scenario] = {
            "n": len(matched),
            "first_tar_p50_ms": median(r["generation1"]["tar_wall_ms"] for r in matched),
            "second_tar_p50_ms": median(r["generation2"]["tar_wall_ms"] for r in matched),
            "second_restore_p50_ms": median(r["restore2"]["restore_wall_ms"] for r in matched),
            "two_archives_bytes_p50": median(r["two_archive_bytes"] for r in matched),
            "final_cas_allocated_bytes_p50": median(r["final_cas_allocated_bytes"] for r in matched)}
    summary = {"workload_id": "CAS-A04a-file-data-tar-two-generations",
               "source_count": 100, "object_bytes": a.object_bytes,
               "n_per_scenario": a.samples, "total_runs": len(rows),
               "budget_tar_seconds": a.tar_budget_seconds,
               "scope": "Real tar/sha256/restore of physical CAS file-data stage only; NO Postgres, Docker, consistent Server backup or installed client",
               "before": "original full tar", "after": None,
               "metrics": metrics, "passed": len(rows) == a.samples * 3}
    (a.results_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print("CAS_A04A_SUMMARY " + json.dumps(summary), flush=True)

if __name__ == "__main__":
    main()
