# Global Storage · Read-only compression and Pack advisory

**Decision status:** No automatic compression/Pack is enabled by this report.
It is an opt-in, administrator-only, bounded sampling experiment intended to
be repeated after additional content syncs. It does not modify CAS files,
Blob identities, the backup repository, retention, compression settings or GC.

## Entry points

- Web & Desktop: **管理员 → 全局存储 → CAS 全局物理对象 → 压缩与 Pack 评估**
- Run: **运行压缩与 Pack 测试**
- Watch: existing system maintenance task `system-maintenance:storage_optimization`
- Read: `GET /api/v1/admin/storage/optimization-advice` (administrator middleware,
  explicit `Cache-Control: no-store`)
- Repeat later to compare a new real sample; most recent successful structured
  report is persisted in `xd_system_maintenance_runs.report_json`.

No user can run or read the report through the personal storage page. Web and
Desktop reuse one shared MUI section, Server endpoint and durable task contract.

## Test methodology

- Deterministic SHA-ordered READY, referenced canonical CAS candidates.
- Four size classes: below 64 KiB, 64 KiB–1 MiB, 1–16 MiB, and 16 MiB+.
- At most 16 candidates per class (64 total), at most 512 KiB pinned read
  per object, 32 MiB total sampled data, bounded allocations and read-only.
- Only a pinned CAS reader is accepted. Missing, mismatched or unsupported
  objects are skipped and counted, not interpreted as compressible zeros.
- gzip-1 (fast) and gzip-6 (default) are measured on **actual sampled bytes**;
  each compressed sample is decoded and compared with its input.
- Pack: assemble full sampled small objects (64 KiB or smaller), build an
  in-memory 48 B/object offset+digest index and verify byte/hash readback.
  Physical savings are a **4 KiB block allocation model**, not an actual
  filesystem, network, durability, production GC or P99 cold-read test.
- Results show distinct recommendations for online storage vs backup
  repository. Even a favorable candidate means **next test**, not automatic
  format migration. Partial first 512 KiB of large media does not establish
  whole-object compression; report displays sampling and confidence.
- No zstd/LZ4 comparison yet. Avoid claiming any algorithm is globally
  optimal without matched data, CPU, decompression, random-read and recovery
  tests. The existing immutable CAS bytes and `pg_dump -Fc` backup default
  remain unchanged.

## Prior physical evidence (not conflated with current sampling)

The previously validated offline [CAS-A05](cas-small-pack-performance.md)
and [CAS-A06](cas-small-pack-cold-performance.md) benchmarks found that
packing 100k real 1KiB objects saved approximately 73.8% of physical capacity
on their test filesystem, while preserving content correctness. This is
**not** a current production instance measurement and does **not** prove
online Pack is safe or worthwhile for large media and mixed workloads.

Future options to compare after the dataset grows:
1. online storage remains uncompressed/individually addressable unless random
   Range, video seek, owner isolation, GC and durability pass dedicated tests;
2. backup-only compression or small-object packing are lower-risk candidate
   experiments, but require full restore and remote-provider tests before
   enabling; and
3. consumer cloud drive APIs and optional zstd compression are postponed,
   no paid S3 integration.

## Safety

Only run by explicit administrator action. The existing durable task supports
one running instance, cancellation, cluster lease and Task Center monitoring.
The read-only analyzer samples through an active CAS shared lease and does
not use a recursive filesystem scan, write a pack file, or delete old objects.
A failed or cancelled run retains the prior successful report, distinguishable
by its completion time.
