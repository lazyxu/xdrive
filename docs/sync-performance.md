# 100k Node Change Feed Performance

**Status: Accepted measured request-scoped SQL resource release (paired n=3) / final evidence-amended exact-head CI pending.** Fixed GitHub parent: `a3f2bd46f4d1f9e4c1b50115af285526db7091e7`. No production code was changed until real native n=3 confirmed the resource-retention performance problem. The subsequently measured and accepted change added only the HTTP Request.Context to the change-feed SQL queries. This is a narrow request-scoped **sync change-feed READ** performance track, not an attempt to cancel persistent Source/Device Backup runs.

## Named workload and benchmark

- PostgreSQL 17, the actual authenticated Gin `GET /api/v1/changes` handler, isolated schema, exactly 100,000 real `xd_nodes`, `xd_files`, and owner-scoped indexed `xd_node_changes` rows. File suffixes cycle JPG/MP4/LIVP/DNG as metadata only; no physical media/CAS, thumbnail decode, durable synchronization or browser/Agent IPC is measured.
- Before the cancellation probe, request real 200-change pages at `after=0`, `50000`, `99800` and record separately named latency in milliseconds, never call these different offsets independent P50 samples. Exclude initial DB seed time from API latency.
- Acquire an actual PostgreSQL `ACCESS EXCLUSIVE` lock on `xd_node_changes`, then start **six real HTTP clients** with authenticated 200-change GETs. Confirm six genuine `pg_stat_activity` SQL lock waiters and six live handlers before cancelling all six HTTP requests. At +160ms record Go HTTP context notifications, actual lock waiters, active Gin handlers and cancellation notice latency. Release the lock, verify all clients returned cancellation errors and that a fresh independent 200-change range is healthy.
- Run three fresh-schema processes per arm in alternating BEFORE→AFTER / AFTER→BEFORE / BEFORE→AFTER pairs on one native GitHub Actions PostgreSQL17 runner. Benchmark command: `XD_NODE_CHANGES_100K_CANCEL_PERF=1 XD_NODE_CHANGES_100K_EXPECT_FIXED=0 XD_TEST_DATABASE_URL=postgres://... go test -mod=readonly -run '^TestNodeChangesRequestContextCancelReal100K$' -timeout=8m -count=1 -v ./internal/api`.
- Branch-scoped workflow: `.github/workflows/node-changes-request-cancel-100k-performance.yml`; do not turn this exploratory benchmark into a required global gate.

## Native unchanged-production BEFORE: confirmed repeated performance first-red

[Exact-source run 38135508673, job 114458430595](https://github.com/lazyxu/xdrive/actions/runs/38135508673/job/114458430595) was **successful as an opt-in benchmark of the failed performance contract**, not a green product resource-release result. Three independent native PostgreSQL 17 fixtures each contained exactly 100,000 node/file/journal rows; an exclusive database lock held six genuine SQL waits before all six authenticated HTTP clients were cancelled.

| BEFORE sample | Live SQL waiters before cancel | SQL waiters / active handlers after 160ms | HTTP Context.Done / cancelled clients | Max Go context notice | First / middle / last page time (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 6 | **6 / 6** | 6/6 · 6/6 | 0.131678ms | 10.996 / 7.171 / 7.109 |
| 2 | 6 | **6 / 6** | 6/6 · 6/6 | 0.135807ms | 11.139 / 7.326 / 7.494 |
| 3 | 6 | **6 / 6** | 6/6 · 6/6 | 0.151355ms | 10.751 / 6.870 / 6.758 |

Each independent healthy post-lock range returned 200 changes and the authoritative 100,000 cursor; 27.218 / 28.372 / 28.025ms. Initial fixture seeds took 4,724.467 / 4,649.890 / 4,656.409ms, excluded from API timing. These distinct page offsets **are not** samples of one shared-latency distribution and must not be misused as a p50 claim. Original exact-result JSON: [before-ci-38135508673.json](performance-evidence/node-changes-request-cancel-100k/before-ci-38135508673.json).

**Root-cause evidence:** the HTTP server promptly signals cancelled Request.Context (≤0.152ms) but the existing GORM queries were created using `s.DB` rather than `s.DB.WithContext(c.Request.Context())`; under a locked `xd_node_changes` relation, that SQL remained waiting with all six HTTP handlers still active 160ms later. A **minimal production candidate** now propagates the HTTP Context into count/max, page query, active-node preload, recursive active paths and optional deleted paths. No SQL/index/batching changes and no changes to durable sync/upload/download/deletion cancellation.

**Next measurement:** run **three native paired alternating BEFORE/AFTER comparisons** with the same source-exact benchmark harness and isolated PostgreSQL17 schemas. Predeclared pass: 6/6 HTTP notices + client cancellations; 0/6 stale waiters and handlers at +160ms, all AFTER arms, healthy 200/100k recovery, no correctness regression. BEFORE will be reconstructed from frozen `master@a3f2bd4` with the same copied test. Measure/capture CPU/maxRSS per process and range latencies, but do **not** present resource release as a throughput speedup. Until paired native results and final-head CI pass, production candidate is **not accepted or merged**.

## Native matched AFTER: accepted 3×(BEFORE/AFTER) same-runner cancellation experiment

[Native PostgreSQL17 CI run 38135907200 / job 114459600479](https://github.com/lazyxu/xdrive/actions/runs/38135907200/job/114459600479), on exactly checked-out candidate source `34707d0dd2ebe3940bbee2151bdace19e318db45`, ran all six **independent real authenticated Gin HTTP + PostgreSQL** schema/process cohorts in alternating order B→A / A→B / B→A. The frozen original `master@a3f2bd4` was checked out as a separate worktree and copied the identical benchmark test, so both sides ran the same fixture and assertions. The native benchmark job concluded **success** after all six actual `go test` runs passed.

| Pair | BEFORE SQL waits / live Gin handlers at +160ms | AFTER SQL waits / live Gin handlers at +160ms | BEFORE/AFTER HTTP contexts and real cancelled clients | BEFORE first-page / AFTER first-page (ms) | Before/after max context notice (ms) |
| --- | ---: | ---: | --- | ---: | ---: |
| 1 (B→A) | 6 / 6 | **0 / 0** | 6/6 / 6/6 each | 11.206 / 12.107 | 0.141856 / 0.786254 |
| 2 (A→B) | 6 / 6 | **0 / 0** | 6/6 / 6/6 each | 11.920 / 11.886 | 0.225862 / 0.217037 |
| 3 (B→A) | 6 / 6 | **0 / 0** | 6/6 / 6/6 each | 11.376 / 11.428 | 0.246887 / 0.217870 |

Every BEFORE and AFTER arm had six actual PostgreSQL lock waiters **prior** to cancelling six clients. Every AFTER arm confirmed all six real HTTP Context.Done notifications and 0 database waiters / 0 live Gin Handlers at +160ms; each subsequent healthy authenticated 200-change page reported 100,000 authoritative latest cursor. SQL logs reported genuine PostgreSQL `canceling statement due to user request`. These are **resource release counts**, not a purported throughput or SQL query latency speedup; unmodified normal first/middle/last page times varied slightly and no latency optimization is claimed.

`/usr/bin/time` process **maxRSS KiB** BEFORE→AFTER for the three paired trials: 923240→917228, 383652→381124, 375600→383692. User CPU seconds: 116.09→30.56, 3.28→3.23, 3.40→3.25; system CPU seconds: 8.89→1.23, 0.63→0.44, 0.46→0.51. The first pair has a large **Go compilation/cache asymmetry** and full-process times include fixture setup/driver overhead, so those figures do not prove improved production CPU or RSS. Remaining warm pairs show no persuasive memory regression. The 100k mixed suffixes are labels, not 100k physically stored JPEG/MP4/LIVP/DNG bytes; actual Web/Desktop rendering, physical codec decode, WAN, and persistent sync run completion remain **unmeasured in this benchmark**.

Complete six original JSON rows and measured `/usr/bin/time` resources are archived under [paired-ci-38135907200.json](performance-evidence/node-changes-request-cancel-100k/paired-ci-38135907200.json). [Original raw CI artifact #11701155301](https://github.com/lazyxu/xdrive/actions/runs/38135907200/artifacts/11701155301) contains all six actual logs and time files. **Provenance correction:** the original workflow wrote pull-request event `GITHUB_SHA=c0fd4ae...` as `HEAD` in its source.txt; that was the GitHub synthetic event merge SHA, **not** the tested source. The same authoritative checkout log confirms it checked out real branch source `34707d0d...`, and the benchmark used the exact detached parent `a3f2bd4...`. The final evidence-amended workflow now records both the actual `git rev-parse HEAD` and event merge SHA separately.

**Decision: ACCEPT** the small production `WithContext` propagation under the predeclared **0 SQL waits and 0 active handlers at +160ms, 6/6 contexts, 6/6 true client cancellations** budget, with 3/3 independent paired successes. Preserve the existing Source/task cancellation contracts; no persistent synchronization job is canceled on viewport/window teardown. No timing percentage speedup claim. Only after the evidence-amended single work commit passes both a **fresh native paired n=3** and full GitHub PR CI `final-gate=success` may the PR be merged and its branch cleaned through Actions. No GitLab run is claimed.

## Frozen cancellation resource-release budget and decision

**BEFORE measured Red (n=3)** and matched **AFTER Accepted (n=3)** as recorded above. The final evidence-amended commit remains under source-exact CI validation.

The candidate must attain **6/6** HTTP contexts notified, **0** PostgreSQL lock waiters, **0** active handlers by +160ms, and all six cancelled HTTP clients, in **3/3** fresh native runs. Context notification must be ≤160ms. Healthy post-cancel 200-row page and 100k authoritative latest cursor must remain intact. Compare the same fixture and SQL-blocking method BEFORE/AFTER. No "speedup" percentage may be claimed for an abandoned request; report exact released waiter and Handler counts instead. If baseline is already within budget, make no production change. If it reproducibly fails, consider only request-context propagation through the change-feed SQL path; preserve durable Task Center/sync tasks and ownership semantics.

**Next action:** verify the native alternating 3× paired remeasurement and full CI on the final evidence-amended exactly-one-work-commit head. When both pass and the PR remains mergeable, mark Ready, rebase-linear merge into master and verify workflow branch cleanup. Do not mark Accepted or merge without exact-head full PR CI. The separate blocked Desktop Gallery 100k progress IPC PR #1185 must remain independent; no GitLab run or remote branch cleanup is claimed.
