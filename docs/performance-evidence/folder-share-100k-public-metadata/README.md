# SH-P001 — Original CURRENT, 100k PostgreSQL17 public-folder metadata paging

**Accepted original CURRENT n=3, no product optimization or speedup claim.**

- **Source exact:** `76a75e288b2b02b927abaa540b9432d6caba4481`; dedicated [GitHub Actions run #39099608613](https://github.com/lazyxu/xdrive/actions/runs/39099608613) (completed success), 2026-10-18; Go 1.25.14/linux/amd64 and PostgreSQL 17.
- **Original complete ZIP:** [Actions artifact #12125602931](https://github.com/lazyxu/xdrive/actions/runs/39099608613/artifacts/12125602931), 87,558 bytes. Downloaded exact ZIP SHA256 `89561016ce7baac40aa6216f8aeeff486fb080adc2b5f88d01118a30c1a65565`. Artifact retention is finite, so this directory permanently includes **the source-exact original JSON and resource files**, while the full original `sample-{1,2,3}.log` remain in the Actions ZIP.
- Each of three independent seeded DB fixtures has **100,000 actual owner-owned PostgreSQL directory Node metadata rows**, not physical file blobs (physical SHA-distinct CAS originals: **0**). Page-by-page request: real Gin POST `/api/v1/public/share/children`, bearer capability, 1,000 serial 100-item keyset pages, every Node ID/cursor checked, last page terminal. Seed time is excluded from all page timings and recorded separately.
- [Original `summary.json`](ci-run-39099608613/summary.json) and `sample-1.json`–`sample-3.json` store raw values, `sample-*.time` whole-Go-test process peak RSS/CPU (includes test compile/DB seeding, **not per-request production memory**), `source.txt` exact HEAD / run / Go version. The sampled per-page P50/P95/worst are from 1,000 HTTP page calls each.

| Sample | Seed ms (excluded) | Full page walk ms | Page p50 ms | Page p95 ms | Slowest page ms | HTTP response body bytes |
|---|---:|---:|---:|---:|---:|---:|
| #1 | 1,618 | 16,894 | 16.702 | 19.264 | 29.478 | 5,733,793 |
| #2 | 1,618 | 16,699 | 16.544 | 19.025 | 30.632 | 5,733,793 |
| #3 | 1,603 | 16,630 | 16.378 | 18.824 | 31.165 | 5,733,793 |
| **n3 median / extrema** | — | **16,699** | **16.544** | **19.025** (max 19.264) | **31.165 max** | — |

**Frozen pre-run gate:** 100,000 exact entries/1,000 complete pages/positive HTTP bytes, each full walk ≤60,000ms, page p95 ≤500ms and worst ≤2,000ms. All three PASS. **Decision: retain original production paging, AFTER=N/A, speedup=N/A.**

**Request-level cancellation distinct baseline:** [real PG17 ACCESS EXCLUSIVE lock-wait regression sample](ci-run-39099609595-cancel.json) at the same exact source HEAD, [Go API CI #39099609595](https://github.com/lazyxu/xdrive/actions/runs/39099609595), subtest PASS: one observed PostgreSQL SQL waiter, HTTP Request.Context cancel → Handler exit **0.290ms**, remaining lock waiters **0**, frozen maximum 160ms. **n=1**, not a p50/p95 distribution, and not proof of the full CI gate (that run's Desktop test had an unrelated Node no-DOM React failure). Do not conflate this read cancellation with user-started downloads, backups, or delete operations.

**Not measured:** FileExplorer or Gallery 100k distinct real JPEG/H264/Live original CAS, thumbnail decode, real Desktop agent, WAN, actual Web/mobile browser UI, native iOS/Android or installed PWA, 4GiB transfers or durable sync/delete. Cancellation is a distinct single real PostgreSQL lock-wait request and does not inherit this 100k throughput sample. Existing accepted workloads and device gaps remain accurately recorded in the [single performance registry](../../performance-test-registry.md) and [six-platform matrix](../../performance-platform-coverage.md).

**Provenance / exact-head qualification:** the original benchmark source SHA is an immutable reference; adding permanent archives changes the PR HEAD, so **new full exact-HEAD CI and benchmark run** are required before Ready/Rebase. Subsequent CURRENT samples are separate runs and must not be presented as paired BEFORE/AFTER.
