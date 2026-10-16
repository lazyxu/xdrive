# CAS-A02 S001-a · original 4GiB physical storage + Go kernel IO CURRENT n3

Source exact e9eaddc6844ca5f35752556d229f8e790cc9425a. Original native [CI 38846688152](https://github.com/lazyxu/xdrive/actions/runs/38846688152) and full [CI 38846687994](https://github.com/lazyxu/xdrive/actions/runs/38846687994) including Final Gate successful.

Exact raw original 5 files: `source.txt`, `summary.json`, `sample-1.json`, `sample-2.json`, `sample-3.json`; their Git blob SHA-1 was verified **identical to original ZIP file Git blob hash**, not rounded nor copied from different HEAD. Original GitHub Actions [artifact 12023618125](https://github.com/lazyxu/xdrive/actions/runs/38846688152/artifacts/12023618125) also includes 6 exact web-direction JSONs and original Gin+Chromium log files. Original artifact ZIP sha256: `e9c14e2e5b2fae273218ad9a9df3e1babcd0ffa3bec84373510a929d90d4c8b9`. Original evidence committed to docs, so no test-data retention dependency on expiring Actions artifact for the five key authoritative files.

| 样本 | 上传/下载（秒） | 分片占用 B | 同时组装占用 B | 物理峰值 B | Go进程写盘 B | Finalize剩余分片 B |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 90.9393 / 14.7187 | 4294967296 | 4294971392 | 8589938688 | 8589934592 | 0 |
| 2 | 83.1656 / 14.3847 | 4294967296 | 4294971392 | 8589938688 | 8589934592 | 0 |
| 3 | 70.3989 / 13.9866 | 4294967296 | 4294971392 | 8589938688 | 8589934592 | 0 |

The three authentic independent 4GiB (4294967296 bytes each) high-entropy inputs used real signed 512x8MiB PUT, first CAS commit, complete 4GiB OPFS readback/full source SHA equality. Physical disk `st_blocks*512` peak 8589938688 bytes (=2.0000009536743164x), native Gin Server /proc/PID/io kernel writes 8589934592 bytes (=2.000000x), staging after finalized 0, one canonical 4294971392B file. Means original architecture writes both staging and assembled complete temp. All original predeclared <=2.35x peak and <=2.50x kernel write budgets met, no product optimization (BEFORE=CURRENT, AFTER=N/A, speedup=N/A). Not tested OS-installed PWA, 100k dedup refs, 4GiB small edits CDC or backup repeat. **After adding evidence source HEAD changes: run both exact-new-HEAD native and complete CI Final Gate before merge.**
