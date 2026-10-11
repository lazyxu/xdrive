#!/usr/bin/env python3
"""Summarize three independent authentic Go Server/Postgres/CAS 1 GiB runs.

This script only compares CURRENT samples against predeclared absolute budgets;
it MUST NOT describe the mock HTTP Agent/Web benchmarks as a same-run BEFORE.
"""
import json
import os
from pathlib import Path
from statistics import median

directory = Path(os.environ.get("XD_REAL_SERVER_CAS_RESULTS", "real-server-cas-results"))
source_sha = os.environ.get("XD_REAL_SERVER_CAS_SOURCE_SHA", "").strip()
assert len(source_sha) == 40, "exact original checkout SHA required"
paths = [directory / f"sample-{i}.json" for i in (1, 2, 3)]
assert all(p.is_file() for p in paths), "missing n=3 fresh real Server/CAS benchmark samples"
rows = [json.loads(p.read_text()) for p in paths]
size = 1 << 30
rss_limit = 256 << 20
upload_limit = 180000
download_limit = 120000
for i, row in enumerate(rows, 1):
    assert row["sample"] == f"sample-{i}", (i, row["sample"])
    assert row["size_bytes"] == size and row["size_gib"] == 1
    assert row["correct"] is True, "invalid physical CAS checksum/result"
    assert row["upload_bytes"] == size and row["download_bytes"] == size
    assert row["upload_chunk_size"] == 8 << 20
    assert row["upload_expected_chunks"] == 128
    assert row["upload_http_put_count"] == 128
    assert row["download_http_get_count"] == 1
    assert row["cas_ref_count"] >= 1
    assert row["download_header_hash_matches"] is True
    assert row["download_content_length"] in [-1, size]
    assert row["upload_elapsed_ms"] > 0 and row["download_elapsed_ms"] > 0
    assert row["upload_elapsed_ms"] <= upload_limit
    assert row["download_elapsed_ms"] <= download_limit
    assert 0 <= row["rss_peak_delta_bytes"] <= rss_limit
    assert row["cpu_upload_ms"] > 0 and row["cpu_download_ms"] >= 0
assert all(row["cas_key"] == rows[0]["cas_key"] for row in rows)
summary = {
    "name": "real-server-postgresql17-local-cas-1gib-physical-upload-download",
    "status": "CURRENT accepted unchanged production" ,
    "source_sha": source_sha,
    "n": 3,
    "size_bytes": size,
    "native_test": "TestRealServerCASLargeTransferBaseline",
    "production_layers": "Client.UploadFileResumableResult -> authenticated Gin upload sessions/parts/finalize -> actual Postgres17 and Local CAS; real Gin /files/id/content download streamed, SHA256 checked",
    "upload_elapsed_ms_p50": median(row["upload_elapsed_ms"] for row in rows),
    "upload_mib_s_p50": median(row["upload_mib_s"] for row in rows),
    "download_elapsed_ms_p50": median(row["download_elapsed_ms"] for row in rows),
    "download_mib_s_p50": median(row["download_mib_s"] for row in rows),
    "upload_cpu_ms_p50": median(row["cpu_upload_ms"] for row in rows),
    "download_cpu_ms_p50": median(row["cpu_download_ms"] for row in rows),
    "max_peak_process_rss_delta_bytes": max(row["rss_peak_delta_bytes"] for row in rows),
    "upload_chunk_http_put_count_each": 128,
    "real_download_get_count_each": 1,
    "integrity_passed": True,
    "budget_passed": True,
    "frozen_budgets": {
        "upload_elapsed_ms_max_each": upload_limit,
        "download_elapsed_ms_max_each": download_limit,
        "rss_peak_growth_bytes_max_each": rss_limit,
    },
    "samples": rows,
    "limitations": "Separate one-process PG17 localhost HTTP 1GiB physical bytes; zeros sparse as source input and physical in CAS; not real Web Chromium, Electron Renderer/Agent IPC, WAN, varied random data, or 4GiB baseline; source file pre-generation and schema/database bootstrap excluded",
    "product_after": None,
    "product_speedup": None,
}
path = directory / "summary.json"
path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
print("REAL_SERVER_CAS_LARGE_N3_SUMMARY " + json.dumps(summary, ensure_ascii=False))
