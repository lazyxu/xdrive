# CAS-A03-d4 · local 3×4GiB physical shifted-insertion offline A/B

**Status (2026-10-17):** genuine independent **local Linux n=3/3** passed, with source-exact script matching GitHub blob, and no production source changes. This is not GitHub Actions CI and not a live full-Blob Local.Put/Gin/PG/Owner/FileVersion/GC/client result. The branch still requires full exact-HEAD true-4GiB dedicated CI and complete 76-job final-gate before Ready/Rebase. All six actual GUI/install-platform cells for this INSERT workload are Not measured.

## Exact workload
Each of 3 sources contains 4,294,967,296 actually allocated fsynced high-entropy os.urandom bytes plus a fresh 1,048,576-byte inserted sequence at original offset 1MiB. Same source, alternating execution order: immutable offline 8MiB fixed chunks and 64KiB atom-aligned 2–16MiB content anchors. The latter is NOT a byte-granular rolling CDC and handles only aligned insertions. Both versions have full SHA256 readback, each chunk SHA, 20 true 4KiB random/cross-boundary expected-byte Ranges per version, delete B preserving A followed by final zero physical bytes; kernel write_bytes, st_blocks, per-phase CPU/wall and group RSS captured.

| Source-matched n3 P50 | Offline fixed8MiB | Offline content anchor |
| --- | ---: | ---: |
| B new physical allocated B | 4,296,015,872 | 10,682,368 |
| B Go-independent Python process write_bytes B | 4,296,429,568 | 10,682,368 |
| B wall ms | 6,051.561 | 14,766.122 |
| B process CPU ms | 4,286.420 | 14,697.758 |
| B reused old chunks | 0 | 472 |
| A+B retained physical B | 8,590,983,168 | 4,305,649,664 |

Capacity-only new B byte savings **99.7513%**, but candidate is **2.44× slower in wall and 3.43× in CPU**; do not deploy for online Blob. Shared whole-run Max RSS **172,004KiB**; all 3 independent full SHA/Range/GC pass. Existing online 4GiB *overwriting* experiment is a different workload; genuine production first-INSERT BEFORE and any production AFTER are Not measured.

## Immutable original eight-file bundle

[Local true-4GiB n3 raw tar.gz](n3-local-20261017.tar.gz): SHA256 **1c5a9ab43a10c384a6fecaec07ead52b2f0043e61ea28f8ff2a5c93d1dc63bbb**, actual Git Blob SHA-1 **88b67f0ac56ea2de4921869cf800e9da0e1f660d**. Contains SHA256SUMS, resources.txt, run.log, sample-1.json, sample-2.json, sample-3.json, source.txt and summary.json. Each original file is checkable with SHA256SUMS. No user-owned data, filenames or credentials. Source script: [benchmark](../../../scripts/bench-cas-a03-d4-shifted-insert.py), SHA256 **0bcf68395b49ed62d0e923a88772794d01d9551895766ff2087b9bad8d2f4378**, Git Blob **300dc80eb0e0b428ac4b098c69528c769a451b47**. Original command:

    python3 -u scripts/bench-cas-a03-d4-shifted-insert.py --results-dir /tmp/cas-a03-d4-n3 --samples 3 --source-bytes 4294967296

Dedicated optional [workflow](../../../.github/workflows/cas-a03-d4-shifted-insert-offline.yml) validates a small real smoke, physical free space, another 3 independent true 4GiB SHA sources and group RSS <=512MiB. A new accurate-HEAD CI run must not be falsely inferred from this local archive; keep Draft until dedicated new HEAD AND full CI/final gate pass.

## Limitations and next gap

This benchmark only compares two offline chunk layouts. It does not persist crash-safe manifests, account permissions, immutable full-file SQL identities, authenticated HTTP upload/finalize/Range, Go request cancellation, true multi-generation PostgreSQL backup or any Web/Desktop/installed PWA frontend. Next evaluate real *unaligned* byte insertion/deletion and byte-granular CDC with stable full-Blob SHA, CPU/RSS/Range/cold seek tradeoffs and true production FileVersion/Owner/GC/restore invariants before considering any release.
