# P068 exact-source physical Web/Desktop and Sync — 2026-10-22 JST

These three committed full machine JSON summaries were parsed directly from GitHub Actions logs for the accurate measured source `20ee9c596515d985e3918d5f93b8151435921afa`. Benchmarks use genuine PG17/Gin/CAS; no production hot-path changes or matched optimized AFTER.

| Workload | Native success | Permanent machine summary |
| --- | --- | --- |
| Wide Web Chromium/OPFS high-entropy physical 4 GiB, n3 | [#39625778550](https://github.com/lazyxu/xdrive/actions/runs/39625778550) | [Web JSON](web-current-run-39625778550.json) |
| Desktop Electron Renderer/Main/Go Agent high-entropy physical 4 GiB, n3 | [#39625778369](https://github.com/lazyxu/xdrive/actions/runs/39625778369) | [Desktop JSON](desktop-current-run-39625778369.json) |
| Signed Go Client 100k PostgreSQL NodeChanges, n3 | [#39625781574](https://github.com/lazyxu/xdrive/actions/runs/39625781574) | [Sync JSON](sync-current-run-39625781574.json) |

The original workflow ZIP artifacts also exist at [Web](https://github.com/lazyxu/xdrive/actions/runs/39625778550/artifacts/12357067020), [Desktop](https://github.com/lazyxu/xdrive/actions/runs/39625778369/artifacts/12356564027), [Sync](https://github.com/lazyxu/xdrive/actions/runs/39625781574/artifacts/12356717390) (subject to Actions retention). The JSON keeps the complete original test summary records, not stdout or the 4 GiB payloads.

**Known inherited description inconsistency:** Desktop JSON `actualRealUIBoundary` was copied from an earlier 1 GiB fixture and mentions 1 GiB. Ignore that static narrative for payload size: the verified `physicalSource.sourceBytes`, `server.cas_bytes`, `upload.bytes`, and `download.bytes` each report **4294967296** on all three samples, with exact matching original/cas/download SHA-256.

The latest archive documentation changes the PR work commit SHA. Its new exact-head 4 GiB Web/Desktop and 100k Sync native suites plus entire CI/Final Gate and GitHub clean mergeability are still required before merging; previously green measured SHA is not enough.

Canonical: [P068](../../p068-platform-100k-4gib-current-baseline.md), [registry](../../performance-test-registry.md), [six-platform matrix](../../performance-platform-coverage.md).
