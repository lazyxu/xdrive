#!/usr/bin/env python3
"""P061 branch-only experimental progress trial; do not commit modified Go source."""
import hashlib
import json
import statistics
import subprocess
import sys
from pathlib import Path

TARGET = Path("internal/api/file_operations.go")
EXPECTED_BLOB = "338abf54deede6a86b8b41f97494f3e7fedbd908"
OLD_FIELDS = "\tpendingItems int64\n\tpendingBytes int64\n}"
NEW_FIELDS = "\tpendingItems int64\n\tpendingBytes int64\n\tnodeVisits   int\n\tlastReport   time.Time\n}"
BEGIN_START = "func (progress *fileOperationProgressCoalescer) begin(name string) error {"
NEXT_FUNCTION = "\nfunc (progress *fileOperationProgressCoalescer) add("
NEW_BEGIN = """func (progress *fileOperationProgressCoalescer) begin(name string) error {
\tif err := progress.ctx.Err(); err != nil {
\t\treturn err
\t}
\tprogress.nodeVisits++
\tnow := time.Now()
\tif progress.nodeVisits < 64 && !progress.lastReport.IsZero() &&
\t\tnow.Sub(progress.lastReport) < 250*time.Millisecond {
\t\treturn nil
\t}
\tif err := progress.server.beginFileOperationItemWithProgress(
\t\tprogress.ctx,
\t\tprogress.operationID,
\t\tname,
\t\tprogress.pendingItems,
\t\tprogress.pendingBytes,
\t); err != nil {
\t\treturn err
\t}
\tprogress.pendingItems = 0
\tprogress.pendingBytes = 0
\tprogress.nodeVisits = 0
\tprogress.lastReport = now
\treturn nil
}
"""


def switch_arm(arm):
    original = subprocess.check_output(["git", "show", "HEAD:internal/api/file_operations.go"])
    sha = hashlib.sha1(b"blob " + str(len(original)).encode() + b"\0" + original).hexdigest()
    if sha != EXPECTED_BLOB:
        raise SystemExit("INVALID Go original blob identity " + sha)
    original = original.decode("utf-8")
    if arm == "original":
        TARGET.write_text(original)
        return
    if arm != "candidate":
        raise SystemExit("unknown P061 arm: " + arm)
    if original.count(OLD_FIELDS) != 1 or original.count(BEGIN_START) != 1:
        raise SystemExit("INVALID original coalescer change requires review")
    start = original.index(BEGIN_START)
    end = original.index(NEXT_FUNCTION, start)
    candidate = original[:start] + NEW_BEGIN + original[end:]
    candidate = candidate.replace(OLD_FIELDS, NEW_FIELDS, 1)
    assert candidate.count("if err := progress.ctx.Err(); err != nil {") >= 1
    assert candidate.count(BEGIN_START) == 1
    TARGET.write_text(candidate)


METRICS = (
    "copy_actual_durable_worker_ms",
    "undo_actual_durable_worker_ms",
    "authenticated_purge_100k_copy_trash_ms",
    "copy_http_enqueue_ms",
    "go_process_25ms_peak_rss_growth_bytes",
    "go_process_cpu_ticks_for_copy_and_undo",
    "go_process_kernel_write_bytes_for_all_stages",
)


def summarize(directory_name):
    folder = Path(directory_name)
    paired = {}
    for sample in ("sample-1", "sample-2", "sample-3"):
        for arm in ("original", "candidate"):
            log = (folder / (sample + "-" + arm + ".log")).read_text()
            matches = [line for line in log.splitlines() if "P056_REAL_PHYSICAL_COPY_UNDO " in line]
            if len(matches) != 1:
                raise SystemExit("INVALID 100k sample missing: " + sample + ":" + arm)
            row = json.loads(matches[0].split("P056_REAL_PHYSICAL_COPY_UNDO ", 1)[1])
            assert row["workload"] == "P056-authenticated-100k-unique-physical-CAS-folder-copy-undo"
            assert row["passed"] is True and row["smoke_only"] is False
            assert "copy_sql_profile" not in row
            assert row["physical_sources"] == 100000
            assert row["verified_copied_file_metadata_count"] == 100000
            assert row["source_copy_content_blob_ref_count_2"] == 100000
            assert row["trash_retained_content_blob_ref_count_2_after_undo"] == 100000
            assert row["sentinel_content_blob_ref_count_1_after_undo"] == 1
            assert row["trashed_copied_file_count_after_undo"] == 100000
            assert row["original_content_blob_ref_count_after_purge"] == 100001
            assert row["original_physical_CAS_inodes"] == 100001
            for stage in ("copy", "undo", "purge"):
                assert row["physical_allocated_bytes_after_" + stage] == row["physical_allocated_bytes_before"]
            paired[(sample, arm)] = row
            (folder / (sample + "-" + arm + ".json")).write_text(
                json.dumps(row, sort_keys=True, indent=2) + "\n"
            )
        if paired[(sample, "original")]["source_aggregate_sha256"] != paired[(sample, "candidate")]["source_aggregate_sha256"]:
            raise SystemExit("INVALID pair source SHA difference " + sample)
    arms = {}
    for arm in ("original", "candidate"):
        rows = [paired[(sample, arm)] for sample in ("sample-1", "sample-2", "sample-3")]
        arms[arm] = {
            "median": {metric: statistics.median(row[metric] for row in rows) for metric in METRICS},
            "maximum": {metric: max(row[metric] for row in rows) for metric in METRICS},
        }
    before = arms["original"]["median"]["copy_actual_durable_worker_ms"]
    after = arms["candidate"]["median"]["copy_actual_durable_worker_ms"]
    improvement = 1 - after / before
    tail = arms["candidate"]["maximum"]["copy_actual_durable_worker_ms"] / arms["original"]["maximum"]["copy_actual_durable_worker_ms"]
    cpu = arms["candidate"]["median"]["go_process_cpu_ticks_for_copy_and_undo"] / max(1, arms["original"]["median"]["go_process_cpu_ticks_for_copy_and_undo"])
    rss = arms["candidate"]["maximum"]["go_process_25ms_peak_rss_growth_bytes"] / max(1, arms["original"]["maximum"]["go_process_25ms_peak_rss_growth_bytes"])
    material = improvement >= .20 and tail <= 1.10 and cpu <= 1.25 and rss <= 1.25
    data = {
        "workload": "P061-same-runner-true-100k-CAS-Copy-paired",
        "original_go_blob": EXPECTED_BLOB,
        "per_arm_n": 3,
        "physical_originals_per_sample": 100000,
        "run_order": ["sample-1:original", "sample-1:candidate", "sample-2:candidate", "sample-2:original", "sample-3:original", "sample-3:candidate"],
        "arms": arms,
        "candidate_p50_improvement_fraction": improvement,
        "candidate_max_worker_elapsed_ratio": tail,
        "candidate_material_performance": material,
        "decision": "PERFORMANCE_TRIAL_MATERIAL_NOT_PRODUCTION_APPROVAL" if material else "REJECT_UNMATERIAL_TRIAL",
        "production_change": False,
        "real_user_cancel_trial": "NOT MEASURED; separate mandatory test before production consideration",
    }
    (folder / "summary.json").write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
    print("P061_PAIRED_PHYSICAL_RESULT " + json.dumps(data, sort_keys=True))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("use original|candidate|summary dir")
    if sys.argv[1] == "summary":
        summarize(sys.argv[2])
    else:
        switch_arm(sys.argv[1])
