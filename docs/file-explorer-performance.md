# FileExplorer performance roadmap

## P0 · 100k mounted Web FileExplorer Grid/Details real thumbnail HTTP scroll cancellation (2026-10-10)

**Status: Accepted CURRENT/BEFORE native n=3 for both mounted Web Grid and Details; no production optimization; evidence-amended full source-exact CI pending.** Fixed GitHub parent `6af6bca49523c774961fd697fb6561960f2a2cfd`; existing FileExplorer 100k synthetic Grid/Details and native PostgreSQL request/SQL tests are already measured and merged. Blocked open #1185 tests **Desktop Gallery IPC progress callbacks**, a separate scope; keep it Draft, do not introduce race changes or duplicate its work. The general benchmark-first/AFTER-if-red rule is already present in AGENTS.md, no policy update needed.

**Known separate BEFORE baselines:** 24/24 actual shared Web/Desktop 100k Grid/Details image/video/LIVP *renderer* scenarios satisfied max mounted 110, peak retained 1200 and six-thumbnail-in-flight structural limits with synthetic SVG thumbnails; these do NOT include authentic JPEG/MP4/LIVP HTTP. The authentic native PostgreSQL image cache benchmark sampled 102 physical requests in a 100k image namespace: cold P50 39.121ms; warm P50 1.866ms, Server-only (no browser). #1203 already demonstrated 100k children SQL cancellations releasing 6/6 native SQL waiters and handlers by +160ms, but no mounted Grid/Details scroll. The merged Gallery Web #1284 measured *its own* production Gallery scroll-to-Go network request cancellation (18/18 across n=3, all +160ms); it does not prove FileExplorer view ownership.

**Frozen current-source test:** Actual shared `XDriveFileExplorer` Grid and Details Web UI in Chromium, actual virtual scroll host and `XDriveFileExplorerThumbnailProvider`, real `AbortSignal` from the existing six-concurrency scheduler, real signed `/api/v1/nodes/:id/children` and `/api/v1/media/items/:id/thumbnail` backed by native PostgreSQL17, Gin, Local CAS, actual JPEG. Seed exactly **100,000 Nodes + 100,000 File rows + 100,000 MediaMetadata rows**, but only **16 distinct real JPEG CAS originals** reused by those logical entries; do NOT call this 100k physical JPEG decoding. First six real JPEGs are warmed outside the cancellation window. A *test-only* 1500ms response writer flushes the first real 256-byte JPEG chunk per watched first-viewport GET and delays the remainder. Once all six are already active, execute actual DOM scroll of the mounted Grid or Details scroll host to ~50% of its 100k height. Inspect Go `Request.Context().Done()`, Gin Handler return, response bytes and scroll geometry at +160ms; independently issue a new real signed 200-item children range at offset 50,000 and verify 100k total. Three fresh native schemas and Chromium partitions **per view** = six sessions; seed/build excluded from cancellation timing.

**Predeclared acceptance before running:** In **each** of the three Grid and three Details independent sessions: six genuine HTTP JPEG bodies must be active after exactly 256 bytes each; mounted UI items between 1 and 999, actual DOM scrollTop delta >10,000px, six Go Context notifications and six canceled HTTP handlers, **zero old active handlers and zero additional stale response bytes at +160ms**, worst notification **≤160ms**, new authenticated counted range **HTTP 200 / total_count=100000 / 200 items**; six image requests observed by the native probe and 6-request scheduled thumbnail concurrency unchanged. No synthetic direct `AbortController.abort()` as the triggering action. Real request cancellation is a resource reduction, not a successful-render wall-clock speedup. Original code must be preserved if within budget.

**Decision gate:** `BEFORE` = measured current product; `AFTER` = N/A unless repeated native real-red. If the six-session workload fails, first distinguish invalid harness/SQL memory/fixture from actual request ownership; only fix production when a repeatable real load-release defect is established, then measure the **identical six-session** BEFORE/AFTER with full HTTP/CPU/RSS/correctness counters before retaining a meaningful optimization. No Race/concurrency feature work. **Durable work:** publish sample JSON and source-exact job/log provenance under `docs/performance-evidence/file-explorer-real-web-scroll-100k/` and these exact numbers here **within the same single work commit**, followed by full exact-head CI and linear PR merge. Preserve prior rejected/inapplicable attempts. Scoped opt-in GitHub/GitLab CI job `file-explorer-real-web-scroll-100k-performance`, driver `desktop/scripts/file-explorer-real-web-scroll-cancel-100k-main.cjs` and Go fixture `TestFileExplorerRealWebScrollCancelFixture100K`. GitLab job is config parity only; no GitLab execution is claimed.

**Limitations / next P0:** not authentic 100k MP4/HEVC/RAW/LIVP decode or CAS of 100k distinct originals, not mobile physical hardware, Electron Desktop Renderer → Main → Agent signed-media proxy, real 1/4GiB Server/CAS uploads/downloads, 100k actual sync/physical-delete throughput or durable Task Center cancellation. Continue those as distinct named baselines after this real Web FileExplorer viewport test. Closing/switching a window must cancel abandoned media/range requests, **not durable transfers, sync or delete jobs**.



### Source-exact native CURRENT/BEFORE — six real mounted Grid/Details samples (2026-10-10)

**Status: Accepted unchanged production on the measured source, pending final evidence-amended CI.** [GitHub CI 38034119067 / scoped job 114160904557](https://github.com/lazyxu/xdrive/actions/runs/38034119067/job/114160904557) successfully ran the **single-work-commit original measured head `617353f3219d60c21567f5b771d34fa03e9560c0`** with six independently seeded PostgreSQL17 schemas, genuine Web shared FileExplorer DOM, six actual signed first-visible JPEG body GETs per session, and test-only 1500ms slow-writer pause after **256 genuine bytes/request**. Original metadata and native CAS fixture were identical across both views: **100,000** Nodes + File + MediaMetadata and **16 physically distinct 800×600 JPEG originals** (not 100k different binaries). All original frozen budgets passed.

| Real view | Independent run | scrollTop delta | Mounted items before | Canceled HTTP & Context Done | Old handlers @+160ms | Extra old bytes | Worst Go Context notification | Fresh counted children range | Fixture seed excluded |
| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | --- | ---: |
| Grid | 1 | 672,385px | 88 | 6/6; 6/6 | **0** | **0 B** | **41.875ms** | HTTP 200, 200 of 100k | 9,096.764ms |
| Grid | 2 | 672,385px | 88 | 6/6; 6/6 | **0** | **0 B** | **41.679ms** | HTTP 200, 200 of 100k | 9,086.833ms |
| Grid | 3 | 672,385px | 88 | 6/6; 6/6 | **0** | **0 B** | **39.953ms** | HTTP 200, 200 of 100k | 8,948.047ms |
| Details | 1 | 1,799,661px | 30 | 6/6; 6/6 | **0** | **0 B** | **19.452ms** | HTTP 200, 200 of 100k | 9,008.977ms |
| Details | 2 | 1,799,661px | 30 | 6/6; 6/6 | **0** | **0 B** | **22.986ms** | HTTP 200, 200 of 100k | 8,963.565ms |
| Details | 3 | 1,799,661px | 30 | 6/6; 6/6 | **0** | **0 B** | **36.488ms** | HTTP 200, 200 of 100k | 8,834.484ms |

**Frozen gate verdict:** actual mounted virtual scrolling (not manual AbortController) led to 36/36 old thumbnail Request Context cancellation notifications and genuinely exited handlers. Max of each session's Go notification times: Grid median **41.679ms**, Details median **22.986ms**, overall worst **41.875ms**, all ≤160ms; 0 stale HTTP body emissions after scroll, 0 old active handlers at +160ms. **BEFORE/current accepted; AFTER: N/A** because production already met budget. **Product delta/elapsed speedup: N/A** — the controlled 1500ms delayed response is only a cancellation-stress fixture and not a WAN speed comparison. Every fresh range after scrolling returned 200/100,000, confirming no global operation cancel was triggered.

**Source boundaries:** real Web Grid/Details with same production virtual surfaces/thumbnail scheduler/REST APIs; 100k metadata rows, limited physically stored CAS originals, warm first six JPEG derivatives, no full 100k decode, genuine 4K/HEVC/LIVP/RAW, mobile physical browser, Desktop Main→Agent IPC, network bandwidth, process CPU/RSS peak, task durability or 100k full sync/delete throughput. Preserve production behavior, including Task Center upload/download/sync/delete independence.

**Raw evidence:** [six source-exact JSON samples, six pre-range cancel diagnostics, native summary, frozen acceptance and provenance](performance-evidence/file-explorer-real-web-scroll-100k/ci-run-38034119067.json). The initial all-branch CI run also flagged **one gofmt alignment line in this opt-in Go test fixture** in the normal `go-linux` format check; the actual measured benchmark job itself passed. That is a test-format-only failure, not a product performance first red. Fix the one gofmt line in this same work commit and require a new **full exact-head PR CI success including final-gate** before any merge. No mixed-head success attribution. The GitLab job is configuration parity; GitLab execution is not claimed.

## P0 · Native 100k real H264 signed video preview HTTP cancellation — Browser viewport ownership and window teardown (2026-10-10)

**Status: Accepted / real Chromium signed H264-to-native Gin Context cancellation meets frozen +160ms n=3×2-mode gate; no production optimization; evidence-amended final full CI pending.** Frozen GitHub master baseline `af3c1e822b44046dc1ece4f1fa4eb5f9004d2601`. Existing related transport work is merged: Gallery virtual-range #1138 real HTTP abort, #1144 native PostgreSQL request cancel, and #1271 genuine H264 100k poster lifecycle. The only open performance PR #1185 concerns blocked Desktop media progress IPC event delivery, not this Web preview streaming cancellation; it remains Draft and untouched.

**Current evidence (distinct scopes, not comparable speedups):** #1271 verified six authentic 2,970-byte H264 samples in a 100,000-video metadata directory: first signed preview → Chromium first-frame JPEG → persisted PUT → warm cache; n=3 median of cold per-video P50 **17.7 ms**, warm-cache P50 **3.6 ms**, zero original-video Store.Open on warm. Independently, Gallery video poster scheduler #1088 achieved **3/3 old Node HTTP request disconnects before +160ms**, zero obsolete bytes, but used mock nondecodable body and no signed Gin/Chromium video. The signed Go/desktop Range benchmark qualified actual transport/Agent proxy cancellation with *nondecodable* MP4-sized payloads; it did not exercise real HTMLVideoElement teardown. **Those historical benchmarks did not provide a comparable actual Chromium video-element cancellation measurement; the new independent result is recorded below.**

**Frozen new native workload:** existing real 100,000 distinct video Node/File/MediaMetadata fixture and six physically stored SHA-distinct, decodable 96×64 H264/MP4 sources (2,970 bytes each), two from each of first/middle/end. Three independent native PostgreSQL17 schema/Go Server + Chromium sessions. Within each session run **three real authenticated signed Preview Engine video streams** in each of two request-owner lifecycles: (a) simulated virtual-viewport eviction calling the actual AbortSignal passed into the *production source-extracted* `xDriveCaptureVideoPosterBlob` Chromium helper, and (b) closing the actual Electron BrowserWindow with three in-flight video requests. Tickets are issued by the real Gin authentication and actual Store.Open/ServeContent. An explicitly test-only HTTP ResponseWriter sends the first **256 genuine original bytes per streaming request**, then pauses 1,500ms; after all three requests are observed active and have a Range header, signal abort/close and inspect native `Request.Context()`, active handler count, emissions and poster PUTs **at +160ms**. Measure Server context notification delay from an explicit test-only cancel marker; seed time separately. After each independent fixture, a new signed real HTTP Range GET must still return **206 / 1024 exact bytes**. Do not mistake artificial writer pacing for real WAN throughput.

**Predeclared acceptance, each mode per run (6 mode runs, 18 actual signed stream requests):** all three authenticated video Range requests must already be active and have emitted an initial genuine 256-byte body before abort; 3/3 `Context.Done()` and 3/3 genuinely canceled Gin handlers, **0 stale active handlers at +160ms**, **0 additional bytes emitted after the observed abort point**, **0 cache backfill PUTs**, worst Go context-notification ≤160ms. The Chromium source-extracted capture promises for the viewport-eviction mode must settle with three null JPEGs, not late posters. BrowserWindow destruction is actual in the second mode. Require six independently issued SHA identities and a healthy new preview after cancellation. Record raw started/active/cancelled contexts, signed Range headers, first/emitted/stale bytes, saved bytes vs the complete 3×2,970B payload, Context latency, fixture seed time, and success/failure per mode in native CI JSON. Don't claim 100k physical video streaming, real screen-scroll UI, Desktop Agent IPC, active decoder CPU cost, or distributed derivative/Task Center job cancellation.

**Source-exact measured CURRENT / BEFORE (unchanged runtime) — [GitHub CI 38025011662 / job 114133897053](https://github.com/lazyxu/xdrive/actions/runs/38025011662/job/114133897053), SHA `9e1a3d45df11514b39097ed845b38d9d892a4625`: ACCEPTED.** Three independent native PostgreSQL17/Gin/local CAS 100k metadata schemas and real Electron Chromium sessions. Six groups total, each with three separately authenticated, *already-active* Range streams of decodable 2,970-byte H264 MP4 file contents; all six groups emitted exactly **3×256=768 genuine bytes before cancellation**, and **0 additional bytes** thereafter. Every group observed 3/3 Go `Request.Context().Done()` notifications, 3/3 genuinely canceled signed Handler completions, **0** active at +160ms, **0** stale poster PUT; the viewport-owner group produced three null capture results. All three independent healthy post-abort signed Range requests returned **206 / 1,024 exact bytes**. Fixture seeding excluded from cancellation delays.

| Native run (100k logical video records, 6 physically seeded H264 videos) | Simulated viewport eviction — worst Go Context notification | Real Window destruction — worst Go Context notification | Old signed streams aborted per run | Handler active at +160ms | Late response bytes per run | Late poster PUTs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | **3.257 ms** | **6.523 ms** | **6/6** | **0** | **0 B** | **0** |
| 2 | **2.446 ms** | **6.361 ms** | **6/6** | **0** | **0 B** | **0** |
| 3 | **2.283 ms** | **7.128 ms** | **6/6** | **0** | **0 B** | **0** |

The maximum observed **7.128 ms** is a Go Context **notification** measured from a deliberately preceding test-only cancel marker, not absolute packet propagation time, actual codec decode latency, high-bandwidth Server transfer throughput or OS resource-usage peak. Within the artificial 1.5s delayed-body fixture, each discarded three-stream group avoids completing **8,142 bytes** of possible remaining payload versus an un-aborted 8,910-byte full response; this is a workload-specific structural byte bound and is **not a production WAN savings ratio**. All 18 signed Range requests were confirmed started and canceled. Source-exact full raw per-stream-group events, seed durations and acceptance: [ci-run-38025011662.json](performance-evidence/file-explorer-h264-cancel-100k/ci-run-38025011662.json).

**BEFORE/current accepted:** actual n=3 source-exact measured, no product changes. **AFTER:** N/A because current is below 160ms. **Delta:** no wall-clock code optimization speedup. **Decision:** preserve production Go HTTP, browser video capture, cache, dedup and independent durable Task Center lifetimes. The initial ordinary `go-linux` job failed only due to **test fixture Go formatting** (one blank line and three JSON field alignment corrections); it is not a production performance failure. The exact formatting correction and raw evidence are folded into the *same one-work-commit PR*, and the entire amended-source CI must pass before merge. Next P0: real mounted 100k FileExplorer Grid/Details scroll-triggered cancellation, Desktop Renderer→Main→Agent signed video decoders, true 4K/HEVC and full Server/CAS large-file transfers.

**Decision rule:** if all six benchmark mode runs meet the resource budgets, mark **Accepted unchanged production**; no new explicit cancellation endpoint, lock, controller or arbitrary `ctx.CancelFunc` injection. If a real upstream continuation persists after browser ownership expires, preserve first-red and consider the smallest proven transport/Go fix, with three identical BEFORE/AFTER repeated native samples and no Task Center upload/download/sync/delete change. This is performance/load shedding, not Race work.

**CI/command:** `XD_TEST_DATABASE_URL=postgres://... xvfb-run -a ./node_modules/.bin/electron --no-sandbox scripts/file-explorer-real-h264-cancel-100k-main.cjs` from `desktop/`, runner sets the already opt-in Go fixture `XD_FILEEXPLORER_REAL_H264_100K_PERF=1` and new `XD_FILEEXPLORER_H264_CANCEL_100K_PERF=1`. The benchmark job `file-explorer-real-h264-cancel-100k-performance` is scoped only to branch `perf/file-explorer-real-h264-cancel-100k` in GitHub and GitLab. The three valid native samples and accepted unchanged-code decision are archived in the canonical document and raw evidence path on this same single-commit PR. Rerun the entire final source-exact GitHub PR CI after this amendment; only then mark Ready, rebase-merge and verify safe redundant branch deletion.

## P0 · Native 100k video metadata + genuine H264 browser poster lifecycle (2026-10-10)

**Status: Accepted / n=3 native real H264 signed Preview Engine → Chromium decode → Server revisioned JPEG cache, unchanged production; exact evidence-amended full PR CI pending.** Earlier 100k FileExplorer video-poster cache HTTP (102 misses/PUT/hits), synthetic Grid/Details traces and independent H264 codec microbenchmark measured different components. The current test connects them through signed Preview Engine source and persistent Server poster, without rewriting FileExplorer UI or changing runtime code. Open Desktop Gallery progress PR #1185 is separately blocked and untouched.

**Fixed workload:** native PostgreSQL 17, authenticated production Gin routes and Local CAS, **100,000 distinct .mp4 Nodes with File and MediaMetadata** for one owner. Exactly **six** at offsets 0/50,000/99,998 contain *genuinely decodable* H264/MP4 bytes from the already accepted 96×64 Chromium fixture; remaining **99,994 items are metadata-only**. Three independent fresh native schema/Go-Server processes and isolated visible Electron/Chromium BrowserWindow renderers. Each browser confirms a counted 200-item FileExplorer Server range with total_count=100000, then invokes the actual shared xDriveResolveMediaVideoPoster / xDriveCaptureVideoPosterBlob through: cold authenticated thumbnail 404 → authenticated signed Preview Engine ticket/Range HTTP → real HTMLVideoElement H264 decode and JPEG canvas → revisioned poster PUT → JPEG image decode. Warm same six: persisted JPEG GET with ETag, no video decoding/PUT, verify **0 original Store.Open, 6 cached-poster Store.Open**. No mock Preview GET, fake codec data, artificial delays or new production endpoint.

**Acceptance frozen before first data:** three complete source-exact independent fixtures, correct 100k/200 page, 6/6 cold misses, six actual video decodes to nonempty JPEG, six accepted revisioned PUT, six warm JPEG/ETag hits, no additional original opens and six poster opens during warm pass, **each cold per-video resolution below existing 15,000 ms codec-capture timeout**, browser does not crash. Capture each cold/warm duration (ms), first decoder cost and P50, output JPEG bytes, underlying original/poster open counters, fixture seed time excluded, and renderer working-set snapshot (not peak). Cold-versus-warm timings are distinct cache states, **not** a code-change speedup. If current budgets pass, accept unchanged production. If a failure originates in fixture/measurement, correct the harness and revalidate before considering a production performance change.

**Invalid initial test-fixture run (not production first-red):** [GitHub CI 38022441586 / scoped job 114126136063](https://github.com/lazyxu/xdrive/actions/runs/38022441586/job/114126136063), first work head bd11d604a1167d252cf2f076d52e48624620e9d6. The measured browser ran 6 actual H264 captures, 6 successful poster PUTs and 6 warm JPEG reads with **0 new original reads**. Only **1 cold GET returned 404** because the six different Node IDs initially had byte-identical MP4 content and correctly shared the SHA256-derived Server VideoPosterStorageKey; five subsequent GETs were warm. This was an invalid independent-cold fixture, not a production performance fault. The test now appends one valid node-specific 12-byte ISO BMFF free box to each real H264/MP4, verifies all six hashes are distinct, and keeps the H264 media stream and production dedup rules unchanged. A local FFprobe smoke check confirmed that a valid trailing free box remains decodable and the corrected Go snippet passed gofmt. Preserve the original six-cold/six-warm gate for source-exact CI; no product speedup is claimed from the invalid run.

**Source-exact native CURRENT / BEFORE (three fresh host runs, no product change):** [GitHub Actions 38022798765 / job 114127268467](https://github.com/lazyxu/xdrive/actions/runs/38022798765/job/114127268467), benchmark work SHA `3450e343537c6c8246e5ab88485dc7b99a5931df`, PostgreSQL 17/Gin/local CAS + actual Electron Chromium on Xvfb. **All three runs passed** the frozen 100k count + first 200-item range, six unique 2,970-byte real H264 originals (two samples from each of offsets 0/50,000/99,998), 6/6 real video HTMLVideoElement-to-JPEG captures, 6/6 original Store.Open, 6/6 cold 404, 6/6 revision-fenced poster PUT, 6/6 warm 200 JPEG+ETag, exactly six warm poster Store.Open and zero warm original Store.Open. Every JPEG was 2,338 bytes; all cold per-video calls were below the existing 15,000 ms timer.

| Independent real PostgreSQL+Chromium run | Per-run cold video P50 (ms) | Per-run cached JPEG P50 (ms) | Cold 404 / real JPEG capture / poster PUT | Warm cache hit / original re-open / poster open | Fixture seed excluded (ms) | Renderer working-set snapshot (KiB) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | **17.700** | **3.800** | 6 / 6 / 6 | 6 / **0** / 6 | 6,368.031 | 155,208 |
| 2 | **19.800** | **3.200** | 6 / 6 / 6 | 6 / **0** / 6 | 7,548.288 | 155,624 |
| 3 | **17.000** | **3.600** | 6 / 6 / 6 | 6 / **0** / 6 | 6,120.150 | 153,604 |

**Current source measured aggregate:** median of per-run cold P50 **17.700 ms**, median of per-run warm P50 **3.600 ms** (independent cache-state results; **not a code-change speedup**). The longer cold path includes authenticated signed-ticket/MP4 read, video decode, canvas JPEG, Server PUT and image decode; warm includes persisted read and JPEG decode. Renderer working-set values are **post-result snapshots, not peaks or growth deltas**. Browser workload time/each individual cold/warm duration and seed time remain in [raw three-sample JSON](performance-evidence/file-explorer-real-h264-100k/ci-run-38022798765.json). No CPU/RSS/I/O reduction or throughput gain is claimed.

**Decision: Accepted existing implementation / no production optimization. AFTER product code N/A.** The frozen correctness and existing 15-second capture deadline all passed on three independent source-exact runs, so do not adjust poster cache, concurrency, video decoder, SHA dedup or production request cancellation. Document/JSON evidence amendment changes this PR's work SHA and therefore **must pass a new complete exact-head PR CI before merge**. Next P0: genuine browser mounted 100k FileExplorer video Grid/Details (including viewport scroll-to-upstream cancellation and shared derivative load ownership), then 4GiB real Server/CAS Web/Desktop transfers and 100k synchronization/deletion with actual physical bytes.

**Unmeasured here:** mounted FileExplorer Grid/Details UI and virtualization, real 4K/H.265/long-video bytes, Live Photo motion, Desktop Agent IPC, mobile/physical hardware, WAN, full-disk transfer, CPU/peak RSS, fast-scroll cancellation of genuine video decode, and durable Task Center upload/download/sync/delete. Do not infer those from this small 96×64 H264 fixture even though the logical directory contains 100k videos.

**Benchmark command:** from desktop/ with XD_TEST_DATABASE_URL configured, xvfb-run -a ./node_modules/.bin/electron --no-sandbox scripts/file-explorer-real-h264-100k-main.cjs. The runner invokes the opt-in Go test TestFileExplorerRealH264PosterBrowser100K three times with XD_FILEEXPLORER_REAL_H264_100K_PERF=1. Dedicated GitHub/GitLab job file-explorer-real-h264-100k-performance runs only on perf/file-explorer-h264-poster-web-100k. Raw per-sample browser and Gin metrics, source/runtime info, BEFORE/current/AFTER=N/A, and accept/reject decision must be amended into this canonical document plus docs/performance-evidence/file-explorer-real-h264-100k/ on the *same one-work-commit branch*, then pass final source-exact CI before merge.

## P0 10k/100k authenticated HTTP permanent Trash deletion — measurement-first (2026-10-10)

**Status: Accepted / matched native PostgreSQL17 full HTTP metadata deletion A/B passed (n=3 per scale); final evidence-amended exact-head CI pending; not yet merged.** Related 100k queued soft-delete fixes #1210/#1213, restore measurement #1231, and viewport SQL cancellation #1237 already merged. The open Desktop Gallery IPC progress benchmark #1185 is blocked on source-exact event delivery and is deliberately not modified by this FileExplorer track. No active permanent-delete performance branch/PR existed at selection time.

**Source audit / first-red hypothesis:** production `internal/api/history_trash.go::trashDeletePermanently` computes a complete deleted-subtree ID slice, then passes it as a GORM `IN ?` slice to FileVersion/File/Share deletion and final Node deletion. With 100,001 subtree IDs, PostgreSQL extended-protocol parameter count may exceed 65,535 and atomically fail. That remains a hypothesis until the real HTTP+PG17 baseline below finishes. Already accepted source helper `fileOperationDeleteIDArrayLiteral` supports a bounded single `bigint[]` SQL parameter in the separate queued soft-delete worker, but must not be applied speculatively before first red.

**Frozen workload:** three independent fresh PostgreSQL17 schema/Go processes at **10,000 and 100,000 file-type child Nodes**, one trashed selected directory, matching `xd_files` and `xd_file_versions` metadata rows per file, one in-subtree Share, one out-of-subtree Share and live sibling, owner and foreign signed users. Drive the **actual authenticated Gin DELETE /api/v1/trash/:id** with `If-Match: "2"`, and foreign-user 404 and stale-revision 409 controls. Measure HTTP response status/bytes, wall time in milliseconds, Go `TotalAlloc` delta bytes, exact subtree/metadata/Share row counts and matching audit event count after the request; report whether a native SQL error includes a 65,535-parameter overflow. Seed/ANALYZE excluded from elapsed. Empty storage keys deliberately exclude physical CAS/legacy bytes, actual media thumbnails, browser/Agent transport, and disk GC.

**Confirmed native HTTP baseline (n=3 per scale, original production unchanged):** [CI run 38018185939 / job 114113078678](https://github.com/lazyxu/xdrive/actions/runs/38018185939/job/114113078678); source-exact branch head `11a894f79a105d7f0c16b0a6f6c2bf03a62d257a`, fixed production parent `9ab6fac1e5dcef97dff2d30149d3e8ddd17245ee`. All 6 full-run harness cases passed their original BEFORE contract. [Six complete unrounded rows](performance-evidence/trash-permanent-100k/first-red-ci-38018185939.json).

| Unchanged production | HTTP times for 3 fresh native PG17 schemas (ms) | Median (ms) | Go TotalAlloc delta bytes | Outcome |
| --- | --- | ---: | --- | --- |
| 10,000 selected files + 10,000 File + 10,000 FileVersion rows | 372.623 / 442.903 / 378.705 | **378.705** | 42,222,712 / 42,252,912 / 42,258,736 | HTTP 204, correctly deleted; 3/3 within 5s |
| 100,000 selected files + 100,000 File + 100,000 FileVersion rows | 102.117 / 112.926 / 109.906 | **109.906** | 54,767,048 / 54,800,976 / 54,769,152 | **HTTP 500 and PostgreSQL 65,535-bind error, 3/3** |

**First-red correctness:** The 100k failure returned no partial commit: **100,001/100,001 Nodes, 100,000/100,000 File rows, 100,000/100,000 FileVersion rows and the in-scope Share remained; out-of-scope Share and sibling unchanged; zero success audit.** Foreign-account 404 and stale-revision 409 tests passed. A failed-request 109.906ms median must **never** be reported as successful 100k delete throughput or compared as a wall-clock speedup. The 10k successful median is valid but should not change the existing small-subtree query plan.

**Minimal AFTER experiment (no race change):** for more than 32,000 validated subtree IDs in `trashDeletePermanently`, pass one array literal from the already-tested `fileOperationDeleteIDArrayLiteral` helper into `node_id = ANY(CAST(? AS bigint[]))` for FileVersion/File/Share predicates and `id = ANY(CAST(? AS bigint[]))` for the final Node predicate. Under that threshold preserve the original `IN ?`. Scope remains the current ownership/revision/transaction/audit boundary; no changes to actual CAS references, Task Center, client cancellation or UI. A matched same-runner alternating n=3 per scale BEFORE/AFTER CI must pass the original failure predicate and AFTER success budgets before claiming Accepted. Timing from failing BEFORE 100k is not valid throughput evidence. **After actual paired verification, archive six-arm raw results per scale and amend this document before merge, then rerun full exact-head CI.**

**Matched same-runner BEFORE/AFTER verified (n=3 each arm at each scale):** [CI run 38018552161 / job 114114280127](https://github.com/lazyxu/xdrive/actions/runs/38018552161/job/114114280127), candidate source `ce97d3f36c4d6ad2a2d36ec5b0e0962ed6fc710a`, original fixed master parent `9ab6fac1e5dcef97dff2d30149d3e8ddd17245ee`; alternating arm order (BEFORE/AFTER, AFTER/BEFORE, BEFORE/AFTER). Every test used the same benchmark source and independent native PostgreSQL17 schema. [All 12 unrounded source-exact arms and acceptance gates](performance-evidence/trash-permanent-100k/paired-ci-38018552161.json).

| Workload / wall-clock | BEFORE n=3 (ms) | AFTER n=3 (ms) | P50 BEFORE | P50 AFTER | Assessment |
| --- | --- | --- | ---: | ---: | --- |
| 10k file+history permanent deletion | 445.183 / 444.296 / 470.133 | 447.963 / 470.396 / 444.633 | 445.183ms, HTTP 204 | **447.963ms**, HTTP 204 | **+0.624% elapsed**, small path unchanged; no material regression |
| 100k file+history permanent deletion | 138.698 / 131.736 / 145.644 | 3,831.826 / 3,829.607 / 3,986.548 | **138.698ms failed HTTP 500**, not throughput | **3,831.826ms**, HTTP 204 | 3/3 correctly completed, max **3,986.548ms** |

| 100k per-arm resource/correctness | BEFORE original | AFTER candidate |
| --- | --- | --- |
| Go `TotalAlloc` delta (bytes) | 54,769,328 / 54,802,648 / 54,765,024 (**failed requests**) | **176,800,176 / 176,801,040 / 176,802,864**, median 176,801,040 B ≈168.6 MiB |
| Native PG bind-limit overflow | 3/3 | **0/3** |
| HTTP status | 500/500/500 | **204/204/204** |
| Target Nodes left | 100,001 | **0** |
| Target File/FileVersion rows left | 100,000/100,000 | **0/0** |
| In-scope Share left | 1 | **0** |
| Out-of-scope Share left | 1 | **1** |
| Success audit | 0 | **1** |

**Decision: Accepted minimal large-subtree SQL parameter fix.** The 100k AFTER result stays below the frozen per-sample 40,000ms/512 MiB Go `TotalAlloc` gates and all source/Share/audit/revision/ownership guards pass; 10k measured latency differs by just +0.624% median on the same run and remains well within 5s. This is a **functional scale restoration with measured successful completion**. No 100k speedup percentage can be claimed, as the 100k BEFORE never successfully deleted data. Peak RSS/real disk CAS/legacy cleanup, full browser/Electron IPC and cross-network 4GiB transfer remain separate unmeasured P0 workloads. The evidence-amended final work commit must pass the entire exact-head CI before marking Merged. No Race code or durable Task Center cancellation was changed.

**Before/after decision thresholds fixed before measurement:** 10k unchanged production must finish authenticated HTTP 204 with every selected File/FileVersion, Node and Share deleted, audit written, foreign/sibling unchanged; each response ≤5,000ms. 100k must also produce HTTP 204, with **each successful AFTER sample ≤40,000ms and Go `TotalAlloc` delta ≤512MiB**. If 100k BEFORE reproduces 65,535-bind error, it must return HTTP 500 with no partial subtree/metadata/Share deletion and no success audit; **failure latency must not be compared as successful deletion throughput**. Only after three valid native first-red samples, use the smallest bounded-parameter SQL fix, compare three alternating BEFORE/AFTER pairs using the same harness/machine, and keep the fix only if all correctness/resource gates pass without important regression. Otherwise preserve unchanged production and document Accepted current/Rejected candidate. Do not claim throughput speedup against failed original requests.

**Benchmark command:** `XD_TEST_DATABASE_URL=postgres://... XD_TRASH_PERMANENT_HTTP_PERF=1 XD_TRASH_PERMANENT_HTTP_COUNT=<10000|100000> XD_TRASH_PERMANENT_HTTP_EXPECT_FIXED=<0|1> go test -run '^TestTrashPermanentDeleteRealHTTPPerformance10K100K$' -count=1 -timeout=8m -v ./internal/api`. GitHub/GitLab branch-scoped job `file-explorer-trash-permanent-100k-performance`. If native first-red holds, archive all source-exact rows under `docs/performance-evidence/trash-permanent-100k/`, then rerun full exact-head CI after evidence documentation before merge.

**Unmeasured here:** physical CAS refcount/GC, network or local 4GiB upload/download, Task Center cancellation, actual Web/Desktop 100k UI, photo/video/Live decoding. This test cannot establish those separate P0 performance goals.


## P0 10k/100k authenticated HTTP Trash restore baseline (2026-10-10)

**Status: Accepted / n=3 per size real authenticated HTTP baseline passed; production unchanged; full evidence-amended PR CI pending.** The relevant 100k DELETE fixes #1210/#1213 merged; #1185 remains an unrelated real Desktop IPC progress benchmark. No open/active dedicated Trash restore performance PR or branch existed at the start.

**Frozen workload:** 10,000 and 100,000 file-type `xd_nodes` with matching `xd_files` metadata (1,024 bytes each) under one deleted directory with a shared real `trash_root_id`, plus one unselected live sibling. Each sample uses a new isolated PostgreSQL17 schema and a real authenticated Gin HTTP server, signed access token, `POST /api/v1/trash/:id/restore`, `If-Match: "2"`, actual HTTP status + JSON body. A different valid signed user's request must receive HTTP 404. No physical CAS contents are stored: **metadata/SQL + real HTTP route only**, not real disk bytes. Seed and ANALYZE time are recorded separately and excluded from the HTTP measurement.

**Acceptance frozen before measurement:** 3 fresh-process independent native-PG trials per scale (6 total). Every successful response must restore N/N children and root, preserve all child revisions and original N `xd_files` metadata rows, set root revision 2→3 and clear all deleted/Trash fields, leave the sibling unchanged. **100k: median HTTP ≤5,000ms and every sample ≤8,000ms. 10k: median HTTP ≤1,500ms and every sample ≤3,000ms.** Each Go `TotalAlloc` delta ≤128 MiB. Report median [min,max] and each sample's response bytes/HTTP status/latency/allocated bytes, plus seed duration. TotalAlloc is cumulative allocations (not RSS). If all budgets pass, accept the existing production implementation without speculative optimization; otherwise preserve failed baseline and only then make a narrow production change and same-workload alternating BEFORE/AFTER. No percentage speedup from a benchmark-only branch.

**Measured unchanged production (n=3 fresh PostgreSQL17 schemas/size):** [CI run 38013902607 / job 114099858517](https://github.com/lazyxu/xdrive/actions/runs/38013902607/job/114099858517), test-only work commit `6795888d5856255b82e597883086fe58f1ddefda` on exact master `2d00ffca46496c5d9be6998f56b500d387493211`. Real HTTP 200, correct response JSON and owner/revision protections; all 10k/100k children restored with preserved File rows/child revisions, no residual Trash fields, and unchanged sibling. Foreign owner gets HTTP 404. Six source-exact raw measurements are archived in [ci-run-38013902607.json](performance-evidence/trash-restore-real-http-100k/ci-run-38013902607.json).

| Real HTTP restore | Three independent wall times (ms) | P50 (ms) | Go `TotalAlloc` delta per sample (bytes) | Decision |
| --- | --- | ---: | --- | --- |
| 10,000 children + 10,000 File metadata rows | 109.792 / 109.156 / 107.631 | **109.156** | 86,104 / 84,312 / 83,432 | Pass, no optimization |
| 100,000 children + 100,000 File metadata rows | 1,077.999 / 1,070.399 / 1,142.614 | **1,077.999** | 86,104 / 85,000 / 86,080 | Pass, no optimization |

**Decision: Accepted current production, no SQL/backend change.** 10k and 100k P50 and worst samples satisfy the predeclared thresholds, every sample stays under 128MiB cumulative allocation. Seed times are **excluded**: 10k seeds 989.225 / 403.723 / 378.208ms; 100k seeds 3783.602 / 3743.774 / 3771.174ms. The measured delta is in-process allocations over the HTTP call, **not** backend RSS, PostgreSQL buffer/cache footprint or physical CAS bytes. Scaling is approximate, but **not a before/after product speedup**. The original benchmark source was a valid real performance probe; an unrelated Go format-only failure in initial normal CI is fixed in the evidence-amended work commit, requiring exact-head full CI rerun.

**Unmeasured separately:** 100k FileOperation Undo/Redo/Trash restore lineage, permanent delete/CAS GC, sync replays, actual JPEG/MP4/LIVP browser decode, Web/Desktop 4GiB remote networking, viewport abort and sender-scoped HTTP/IPC context cancellation. Those cannot be claimed from this handler benchmark.

**Command:** `XD_TRASH_RESTORE_HTTP_PERF=1 XD_TRASH_RESTORE_HTTP_COUNT=<10000|100000> XD_TEST_DATABASE_URL=postgres://... go test -run '^TestTrashRestoreRealHTTPPerformance10K100K$' -count=1 -timeout=5m -v ./internal/api`. GitHub/GitLab branch-scoped job `file-explorer-trash-restore-100k-performance`. Raw CI measurements must be amended into this canonical document and verified on the exact evidence-amended head before any merge.


## P0 full queued FileOperation DELETE executor 100k — first-red confirmed (2026-10-10)

**Status: Merged / Accepted (#1213; final exact-head full GitHub PR CI success 37983497139, rebase merge 0766a60ec0ac49f5f068a4d3fd7161c0fbf60c6d).** The earlier [#1210](https://github.com/lazyxu/xdrive/pull/1210) fixed the *Node soft-delete SQL primitive* and merged after full CI. Its successful 100k Node UPDATE does not make the whole DELETE transaction work: `executeQueuedBatchDelete` still expands the 100,001 selected IDs for `xd_shares.node_id IN ?`, before invoking the now-bounded Node UPDATE.

**Frozen workload:** native PostgreSQL 17, 100,000 owner-scoped `xd_nodes` and 100,000 `xd_files` metadata rows of 1024 bytes under one selected root, one running durable `xd_file_operations` DELETE, an in-scope and out-of-scope `xd_shares` row. Call the real Go `executeQueuedBatchDelete` transaction (root load, subtree aggregation, managed-target protection, progress, Share revocation, soft-delete, UndoPlan, status completion). Exclude Web/Desktop UI, physical CAS bytes/GC, live sync, Share token HTTP fetching and full undo/restore run. Seed time is excluded from executor duration. Record Go TotalAlloc, operation state and Share scope. Three independent native-PG schemas per arm, alternate BEFORE/AFTER order.

**Measured initial BEFORE source** `ce8e042e56d825771929e57a2d50bb7b27ffcbba`: [CI run 37981553163 / job 113993673559](https://github.com/lazyxu/xdrive/actions/runs/37981553163/job/113993673559). All three attempts failed with `extended protocol limited to 65535 parameters` in **422.936 / 437.898 / 420.315 ms**, median **422.936 ms**. Go allocation deltas **75,877,424 / 75,910,368 / 75,911,472 bytes**, median **75,910,368 bytes**. **0 trashed Nodes, no Share revoked, FileOperation still running** after each rollback. **These are failure latencies, not successful deletion throughput.** Raw [n=3 first-red JSON](performance-evidence/file-operation-queued-delete-100k/ci-run-37981553163.json).

**Matched AFTER verified:** [run 37982836545 / job 113997583486](https://github.com/lazyxu/xdrive/actions/runs/37982836545/job/113997583486), actual parent `601131aee5602fb21d0af2a49605e7b4be92cf9e` vs bounded-Share candidate `963c4b01b5a372faceead930d9b5681a1ba1a5d2`, identical harness, three alternated fresh PostgreSQL 17 schemas. Original Share `IN ?` fails in every BEFORE arm with `extended protocol limited to 65535 parameters` and 0 changed Nodes/Shares. The AFTER arm successfully completes the real FileOperation executor with exactly **100,001** trashed Nodes, **1** in-scope Share revoked, **0** outside Shares revoked, an UndoPlan, correct root/100k-child Trash metadata and revisions, retained 100k File metadata rows, and `completed` task state with **1 processed item and 102,400,000 processed bytes** in every sample.

| 100k executor stage | Trial 1 | Trial 2 | Trial 3 | P50 |
| --- | ---: | ---: | ---: | ---: |
| BEFORE failed SQL elapsed (ms, **not completed throughput**) | 409.491 | 422.046 | 414.413 | **414.413** |
| AFTER successful executor elapsed (ms) | 1,528.597 | 1,520.216 | 1,523.744 | **1,523.744** |
| BEFORE failed Go `TotalAlloc` delta (bytes) | 75,874,632 | 75,911,280 | 75,918,512 | **75,911,280** |
| AFTER successful Go `TotalAlloc` delta (bytes) | 41,090,888 | 41,088,584 | 41,128,048 | **41,090,888** |

All AFTER samples satisfy the previously frozen **≤30,000 ms and ≤128 MiB Go TotalAlloc delta** gates. **Decision: Accepted for full executor SQL-stage functionality with bounded parameters, not a claimed wall-clock speedup over an unsuccessful operation.** The observed allocation samples differ by execution outcome (original abort vs candidate completion), not isolated allocator microbenchmarks; they do not establish peak RSS. Full evidence including original unrounded per-arm sample rows and provenance: [ci-run-37982836545-paired.json](performance-evidence/file-operation-queued-delete-100k/ci-run-37982836545-paired.json). A fresh full PR CI on the evidence-amended exact head is required before merging. Actual remote GitLab pipeline, 100k user-facing Trash restore/CAS GC, Web/Desktop HTTP/Agent, genuine MP4/Live decode, sync and cancellation of durable tasks are not covered by this benchmark.

**Minimal AFTER candidate:** preserve ordinary Share `node_id IN ?` under 32,001 subtree nodes; for larger subtrees pass the previously validated `fileOperationDeleteIDArrayLiteral` as **one `bigint[]` SQL parameter**, constrained by owner ID and `revoked_at IS NULL`. Same transaction, per-root operation checkpoint, protected-source validation and undo plan. This is not a new task cancellation architecture and does not touch Race code. Test the parent `master` with the same injected test file as original BEFORE, and the candidate as AFTER, three alternated pairs on the same CI runner.

**Predeclared acceptance:** all three BEFORE arms reproduce 65,535-bind error without partial delete; all three AFTER arms delete exactly 100,001 selected Nodes, revoke only the selected Share, preserve out-of-scope Share and sibling, maintain every child's `trash_root_id` and revision, leave `xd_files` metadata intact, write UndoPlan, and complete the FileOperation with **1 processed item / 102,400,000 processed bytes**. Each successful AFTER executor must complete in **≤30,000 ms** and emit **≤128 MiB Go TotalAlloc delta**. No causal wall-time % speedup is claimed since BEFORE fails. Correctness, bounded parameters and resource reduction are the decision gate; peak RSS, user-facing restore and actual CAS remain separate. Publish raw matched data and rerun source-exact full GitHub CI before merge.

**Command:** `XD_FILEOP_QUEUED_DELETE_100K_PERF=1 XD_TEST_DATABASE_URL=postgres://... XD_FILEOP_QUEUED_DELETE_100K_EXPECT_FIXED=<0|1> go test -run '^TestFileOperationQueuedDeleteExecutor100K$' -count=1 -timeout=6m -v ./internal/api`; scoped GitHub and GitLab performance jobs.


## P0 100k subtree soft-delete SQL — successful bounded mutation (2026-10-10)

**Status: Accepted in native PostgreSQL 17 soft-delete SQL stage / final source-exact full CI pending.** The production `markFileOperationDeleteSubtreeTx` uses `WHERE n.id IN ?` against a list of all selected subtree IDs. The original unbounded 100k query reproducibly exceeded PostgreSQL's 65,535-parameter limit, and the bounded one-array query now succeeds in 3/3 matched trials.

**Named workload:** actual PostgreSQL 17 and production subtree-delete SQL, 100,000 file-type child Nodes under one directory plus the root (100,001 IDs). Metadata-only SQL test: no 100k physical CAS files and not yet a full Task Center operation. Seed and SQL mutation are timed separately, along with Go TotalAlloc delta, root revision, exact soft-deletion count and transaction rollback. Three independent fresh-schema PostgreSQL trials.

**BEFORE:** expect PostgreSQL's bind-limit error and zero modified Nodes in the original code. If a different failure or successful delete occurs, correct the benchmark before changing production. Failed query elapsed is **not** successful delete throughput. The initial PR adds test, provider-parity CI jobs and this documentation only.

**Source-exact BEFORE evidence:** [GitHub run 37978549397](https://github.com/lazyxu/xdrive/actions/runs/37978549397), [scoped job 113982910988](https://github.com/lazyxu/xdrive/actions/runs/37978549397/job/113982910988), original benchmark-only PR head `22a60debb2851f42f148db60fe29b9b7d3d98f44`. Three fresh native PG17 schemas returned `extended protocol limited to 65535 parameters`, with **100,001 subtree IDs and 0 trashed rows** each; failed mutation elapsed **188.611 / 203.266 / 203.391 ms**, Go `TotalAlloc` delta **58,312,568 / 58,313,216 / 58,319,136 bytes**. These timings are **failure latencies**, never successful delete throughput. [All three raw rows](performance-evidence/file-operation-delete-subtree-100k/ci-run-37978549397.json).

**Minimal AFTER experiment:** for the existing helper only, use a bounded single PostgreSQL `bigint[]` bind with `= ANY(CAST(? AS bigint[]))` when the selected subtree exceeds 32,000 IDs; keep the original `IN` query below that threshold. This is a resource-bounded fix for confirmed SQL parameter overflow; preserve root ownership/revision and Trash semantics. The AFTER acceptance remains the previously declared 100,001 correctly trashed rows within 10 seconds and no meaningful memory regression. The three alternating same-runner BEFORE/AFTER pairs completed successfully; the final evidence-amended head still requires full CI.

**Measured A/B (3 alternating native PostgreSQL 17 pairs):** [run 37979441733 / job 113986460189](https://github.com/lazyxu/xdrive/actions/runs/37979441733/job/113986460189). Exact parent production BEFORE `163376baaf9b330863c84c67351378c79ffcf232` vs candidate source `c38591a9d6661c738b4cd04ba354e9daaa489e7c`, identical test harness, fresh schema per arm. BEFORE error `extended protocol limited to 65535 parameters` and 0 soft-deleted rows in all three. AFTER `bigint[]` query succeeded, **100,001 correctly soft-deleted rows in all three**, with the selected root revised once. Successful AFTER mutation durations **1196.839 / 1137.638 / 1068.664 ms**, median **1137.638 ms**, all well under the 10s gate. BEFORE failure durations **107.880 / 105.837 / 106.766 ms** (median **106.766 ms**) are *not* successful delete throughput. Per-arm Go `TotalAlloc` deltas BEFORE **58,312,640 / 58,318,672 / 58,318,736 bytes**, AFTER **4,804,056 / 4,804,264 / 4,804,120 bytes**; the allocation reduction refers only to these different SQL execution outcomes and does not establish full worker peak RSS. Source-exact [all six unrounded rows](performance-evidence/file-operation-delete-subtree-100k/ci-run-37979441733-paired.json). **Acceptance: fixed the blocking SQL-limit failure, not a claimed elapsed percentage speedup.** The final benchmark harness also verifies every child's revision and Trash root, plus a nonselected sibling, and will be rerun with final CI.

**AFTER gate (only after real BEFORE red):** a bounded parameter or set-based SQL strategy must update exactly 100,001 intended Nodes, including root revision +1 and correct Trash metadata, while keeping other owners and previously deleted state protected. Require three same-runner alternating BEFORE/AFTER trials with original failure reproduced and AFTER success; provisional <=10 seconds mutation elapsed and no material Go memory regressions. Preserve small-subtree regression tests. This is a correctness/resource-boundedness gate; do not claim a percentage speedup from the failing original. Full 100k Task Center delete/Trash/restore, actual File/CAS refs and cancellation remain distinct follow-ups.

**Command:** `XD_FILEOP_DELETE_100K_PERF=1 XD_TEST_DATABASE_URL=postgres://... go test -run '^TestFileOperationSoftDeleteSubtree100K$' -count=1 -timeout=7m -v ./internal/api`. Exact CI run and raw samples must be committed here before merge.


## P0 FileExplorer 100k native Go request cancellation — baseline contract (2026-10-10)

**Status: Merged / accepted (#1203, commit 163376baaf9b330863c84c67351378c79ffcf232); exact-head GitHub CI run 37975897712 and final-gate passed.** Source audit: `internal/api/children_pagination.go` builds range SQL with `s.DB.Table("xd_nodes")` without `WithContext(c.Request.Context())`. This is an unmeasured cancellation gap, not a claim of proven PostgreSQL retention until native CI reports it.

**Frozen initial workload:** 100,000 owner-scoped mixed-extension FileExplorer Nodes (25k each .jpg/.mp4/.livp/.txt; names only, not actual codec or Live pairing). Run actual authenticated Gin `GET /api/v1/nodes/:id/children?offset=N&limit=200&sort=name&order=asc` with six distinct 200-item ranges. In native PostgreSQL 17, intentionally hold a real `xd_nodes` ACCESS EXCLUSIVE lock and verify **6 real waiting SQL queries + 6 active HTTP handlers** before aborting all clients. At 160ms record `pg_stat_activity` lock waiters, Handler count, `Request.Context().Done` observations, HTTP stale response bytes and context propagation latency. Release the diagnostic lock; verify an independent new request succeeds with exact 100k authoritative total and 200 items. Three new-schema measurements with original source, no race flags.

**Predeclared acceptance if gap confirmed:** after adding request-scoped GORM context to *only* the FileExplorer paginated children query, six client-aborted requests cause **0 PostgreSQL lock waiters, 0 active handlers, 0 stale client bytes, 6/6 context-done callbacks within 160ms**; a new healthy pagination request remains correct. BEFORE must show all six SQL waits retained at +160ms in a same-runner three-pair A/B. No cancellation of durable upload, download, sync or delete Task Center jobs from viewport/navigation changes; do not cancel shared persistent poster worker when one HTTP waiter leaves.

**Measured BEFORE / confirmed resource waste:** [GitHub run 37974982928](https://github.com/lazyxu/xdrive/actions/runs/37974982928), [dedicated job 113970884456](https://github.com/lazyxu/xdrive/actions/runs/37974982928/job/113970884456), exact source `f3b3237d4bddd2498c9b470a46960c2583dc309f`. All three 100k/6-request native PostgreSQL17 trials started six real SQL waits, received all six request contexts in **0.142/0.121/0.107ms max**, and still retained **6 active Gin handlers and 6 PostgreSQL lock-waiting SQL** at +160ms; client stale response bytes were zero. Fresh uncancelled 200-item/100k-count page passed after diagnostic lock release. The dedicated benchmark succeeded; initial full CI rejected unformatted new test source, not the results. Full per-sample provenance: [raw BEFORE JSON](performance-evidence/file-explorer-go-context-cancel-100k/ci-run-37974982928.json).

**Minimal candidate:** attach `c.Request.Context()` via GORM `WithContext` to the common children query builder (count-once, count-free, grouped and cursor paths). Run three **alternating paired** BEFORE=exact parent production and AFTER=one-line candidate using the identical formatted test source on the same CI runner. No *percentage speedup* claim: this is an abort/resource-release gate measured in actual SQL waiter/handler counts and milliseconds. Keep the candidate only if 3/3 post-cancel samples meet every frozen goal; full CI and correct fresh query must also pass.

**Measured AFTER / source-exact paired verification:** [same-runner CI run 37975410352 / job 113972652556](https://github.com/lazyxu/xdrive/actions/runs/37975410352/job/113972652556), three alternating pairs (`before → after`, `after → before`, `before → after`). All 3 BEFORE arms retained **6 SQL lock waiters + 6 Gin Handlers** at +160ms, while all 3 AFTER arms retained **0 SQL waiters + 0 Handlers**. All arms got 6/6 Context notifications, 0 discarded-response bytes and a correct fresh paginated 100k/200-item request. BEFORE maximum context notification 0.120/0.251/0.126ms; AFTER 0.159/0.409/0.162ms. SQL retention at +160ms reduced **6/6 to 0/6 for each of three paired samples**; this is a resource-cancellation improvement, not a claim of faster successful query execution. [Complete paired raw JSON](performance-evidence/file-explorer-go-context-cancel-100k/ci-run-37975410352-paired.json). GitHub's initial paired full CI found unrelated CI parity drift because only GitHub had the new opt-in job; adding the identical branch-scoped GitLab job in this work commit is necessary before merge. **No claim of final CI green yet.**

**Measurement and gate:** `XD_FILEEXPLORER_GO_CONTEXT_CANCEL_PERF=1 XD_TEST_DATABASE_URL=... go test -run '^TestFileExplorerRequestContextCancellation100K$' -count=1 -timeout=8m -v ./internal/api`. The first PR runs a baseline-only scoped CI job with `XD_FILEEXPLORER_GO_CONTEXT_CANCEL_EXPECT_FIXED` absent. *No AFTER data is claimed until that baseline completes.* Test covers real Server/PG context and cancellation but excludes browser/Renderer→Main→Agent, remote-network latencies, actual 100k image/video/Live thumbnails and durable transfers.

## Scope

This performance track is intentionally limited to FileExplorer across shared UI, Web, Desktop, and the server APIs it consumes. It does not include Gallery, Source synchronization, or general server tuning.

## Performance work status

This table is the durable status index for the FileExplorer performance track. A performance PR is not considered fully documented until its status and evidence are reflected here or in the measured tables below.

| Work item | Status | Measurement state | Current evidence |
| --- | --- | --- | --- |
| Sparse paged directory SQL | **Merged** | Measured | Non-empty sparse reads: **2 -> 1 SQL round-trip**. |
| Sparse range count reuse at 100k | **Accepted / production validated (#750)** | Paired SQL A/B + production contract CI | #739 established the direction; #750 production validation preserved the same result: broad-offset **3885.236 -> 2136.375 ms (-45.01%)** and sequential **3480.204 -> 1695.987 ms (-51.27%)**. First range remains authoritative-counted; later ranges reuse that generation's count. |
| Search candidate-first / sparse range | **Merged** | Measured | 100k range/cursor workloads: **2.38x to 5.67x faster** depending on access pattern. |
| Directory sort at 100k | **Accepted / production validated (#759)** | #756 paired A/B + #759 production migration/benchmark CI | #759 reproduced the accepted exact expression-index result: first-counted **212.644 -> 210.804 ms (-0.87%)** and middle count-free **299.467 -> 127.996 ms (-57.26%)**. The index is installed idempotently through Server migration; persisted-key remains rejected. |
| Sparse VirtualCollection CPU at 100k | **Accepted structural baseline / no optimization (PR #708)** | Measured | Three CI CPU medians: **126.877 / 160.081 / 161.319 ms per sweep** (**50.751 / 64.032 / 64.528 us per viewport**); hosted-runner timing is diagnostic only, while structural counts are stable at **500 page loads / 800 peak / 600 final retained**. |
| Details/Grid windowing and logical-index interaction | **Merged** | Unmeasured wall-clock | Bounded mounted/retained work; no comparable end-to-end BEFORE/AFTER timing yet. |
| Thumbnail viewport scheduler + bounded cache | **Merged** | Unmeasured wall-clock | Shared viewport observer, max **6** concurrent thumbnail requests, bounded **96-entry** per-Explorer cache. |
| FileExplorer video poster cache | **Implemented / CI validated** | Structural; end-to-end cold codec timing pending | Video tiles share the bounded thumbnail scheduler. Warm reads hit the persistent 512px Server poster cache; cold Web/Desktop reads use the existing authenticated preview stream, capture one bounded frame, and revision-fenced backfill the Server cache without adding ffmpeg to the Server runtime. |
| 100k video-poster Server HTTP cache + native Chromium decode | **Measured baseline / no production optimization (#1074)** | 100k video metadata; 102 nodes × 3 cycles; 7 native Chromium H.264 samples | Batch median cold 404 **62.670 ms**, PUT 204 **102.922 ms**, warm GET **62.194 ms**; ≤6 concurrent, exact JPEG replies. Chromium steady cold **3.600 ms** vs first-process **329.200 ms** on a tiny test video. Separate layers, no production changes. |
| Desktop binary thumbnail transport | **Merged** | Unmeasured wall-clock | Agent raw bytes -> ArrayBuffer -> Blob URL; base64 thumbnail transport removed. |
| Desktop warm-thumbnail Agent cache | **Accepted / Merged** | Measured structural requests/bytes | Same 200 unique x 64 KiB x 3-pass workload: upstream requests **600 -> 200 (-66.7%)** and payload **39,321,600 -> 13,107,200 B (-66.7%, 25 MiB saved)**. Wall time remains diagnostic only. |
| Adaptive infinite-scroll prefetch | **Merged** | Unmeasured wall-clock | Prefetch threshold is viewport-adaptive and protected by in-flight request locks. |
| Indexed typed-path lookup | **Merged** | Unmeasured wall-clock | One exact child lookup per path segment instead of full child-list scans. |
| Indexed folder-upload conflict lookup | **Merged** | Unmeasured wall-clock | Existing sibling lookup is indexed instead of scanning the full parent directory. |
| Desktop folder-download paged scan | **Accepted / structural contract** | Structural / unmeasured wall-clock | Recursive tree scan: legacy **1 unbounded 1,201-node response -> 3 cursor pages, <=500 nodes/response**. #788 also bounded root lookup before the exact lookup follow-up below. No wall-clock speedup claimed. |
| Desktop folder-download exact root lookup | **Accepted / structural contract** | Structural / unmeasured wall-clock | 1,201-sibling target: paged root lookup **3 requests / 1,201 returned nodes -> 1 exact request / 1 returned node**; recursive scan remains paged. |
| Desktop folder-download progress aggregation | **Accepted / structural contract** | Structural / unmeasured wall-clock | For F manifest files, each group-progress publication no longer scans F child byte slots. Aggregate bytes are maintained by current-file deltas: **O(F) -> O(1) per progress publication**, and the two F-length `int64` progress arrays are removed. |
| Hierarchical Transfer history trim fast path | **Accepted / structural contract** | Structural / unmeasured wall-clock | One group + 1,000 completed child tasks below the 200-root history limit: `trimLocked` history-entry inspections during start/finish **1,003,001 -> 0**. Root-tree retention/eviction semantics are unchanged. |
| Folder-upload group progress aggregation | **Accepted / structural contract** | Structural / unmeasured wall-clock | For N folder-upload targets, every group-progress publication changes from scanning N child byte slots to an incremental byte total: **O(N) -> O(1)** per publication; `fileSize` probes during target setup **2N -> N** and the N-length `childDone` array is removed. |
| Web folder-upload child registration | **Accepted / structural contract** | Structural / unmeasured wall-clock | For N queued child tasks under one Web folder-upload group, upfront parent lookup/history trim/full-history persistence/listener publication **N -> 1** via the optional batch lifecycle; all child IDs still exist before group transfer begins. |
| Agent transfer child registration | **Accepted / structural contract** | Structural / unmeasured wall-clock | 1,000 queued folder children: Desktop folder-upload lifecycle setup **1,000 Agent IPC requests -> 1**; Agent Manager child-registration revision publications for both Desktop upload and folder download **1,000 -> 1**. Old Agents retain the single-child fallback. |
| Agent folder-download progress publication | **Accepted / structural contract** | Structural / unmeasured wall-clock | One throttled leaf-file progress callback updates child bytes/rate plus group aggregate under one Manager lock: revision publications **2 -> 1 per callback**; download bytes, 100 ms progress throttle, lifecycle states and Transfer Center fields are unchanged. |
| Web archive-download child registration | **Accepted / structural contract** | Structural / unmeasured wall-clock | For N prepared archive leaf files, Transfer Center child registration reuses the Web batch primitive: parent lookup/history trim/full-history persistence/listener publication **N -> 1**; archive prepare, progress polling and payload streaming are unchanged. |
| Web archive progress persistence batching | **Accepted / structural contract** | Structural / unmeasured wall-clock | For one progress snapshot over N prepared leaf files, TransferStore history trim/full-history persistence/listener publication changes from **up to N+1 -> 1** in steady progress; lifecycle states and 200 ms Server polling are unchanged. |
| Web direct-to-disk downloads | **Accepted / structural contract** | Structural / unmeasured wall-clock | File System Access path writes each response chunk directly to the selected file; application-retained payload chunks change from **O(download bytes) -> O(current chunk)**. Blob fallback remains for unsupported browsers. |
| Web single-download progress coalescing | **Accepted / structural contract** | Structural / unmeasured wall-clock | Fast 1 GiB stream at 64 KiB/read: TransferStore progress persistence/listener publications **16,384 -> 128** via 8 MiB byte coalescing; slow streams still publish at <=100 ms cadence and terminal complete/fail remains immediate. |
| File download metadata joins | **Accepted / structural contract** | Structural / unmeasured wall-clock | Current-file download metadata **2 SQL -> 1 exact JOIN**; historical-version download metadata **2 SQL -> 1 exact JOIN**. Store.Open, Range/ServeContent, ETag/SHA256 headers and payload streaming are unchanged. |
| Windows hydration range-buffer reuse | **Accepted / structural contract** | Structural / unmeasured wall-clock | Synthetic 1 GiB single-callback hydration at 4 MiB/range: large response buffers **256 -> 1**; HTTP range requests remain **256**. Original `DownloadRange` API remains compatible. |
| Linux FUSE read destination-buffer reuse | **Accepted / structural contract** | Structural / unmeasured wall-clock | 1 GiB sequential read at 128 KiB/FUSE callback: explicit payload buffers **8,192 -> 0**; reads now fill go-fuse's provided `dest` buffer directly. File backing, offsets, EOF and returned bytes are unchanged. |
| FileExplorer Trash sparse ranges | **Accepted / structural contract** | Structural / unmeasured wall-clock | 1,201 trash roots: initial response/materialization **1,201 items -> first 200 items + authoritative total**; later viewport ranges are <=200 items and omit repeated count work. Legacy unpaged Trash API remains compatible. |
| Windows change-journal baseline index | **Accepted / structural contract** | Structural / unmeasured wall-clock | 100k baseline + one 500-change page of missing deletes: node-path resolution **1,000 full baseline scans / ~100M entry checks -> 1 index build + 1,000 map lookups**; incremental file delete/rename no longer run full-map prefix scans. |
| Windows change-journal same-path upsert index fast path | **Accepted / structural contract** | Structural / unmeasured wall-clock | 100k-entry baseline, ordinary same-path upsert page: full `nodeID -> path` index builds **1 -> 0**; rename/move/new-path ambiguity and delete retain lazy full-index fallback. |
| Windows same-path file journal baseline-clone bypass | **Accepted / structural contract** | Structural / unmeasured wall-clock | 100k-entry baseline + one ordinary same-path existing-file upsert: full baseline copies **1 -> 0** and full hydrated-map copies **1 -> 0**; only the touched file state/hydration timestamp is snapshotted. Rename/delete/directory/conflict/policy cases retain the full-baseline path. |
| Windows exact file-delete journal baseline-clone bypass | **Accepted / structural contract** | Structural / unmeasured wall-clock | 100k-entry baseline + one ordinary soft-deleted file: Windows full baseline copies **1 -> 0**, full hydrated-map copies **1 -> 0**, and nodeID full-map index build **1 -> 0**. Deleted-path resolution is opt-in for Windows only; default Web change polling keeps the old query cost. Hard delete / empty path / directory / conflict / policy cases retain the full-baseline path. |
| Windows directory journal fast path | **Accepted / structural contract** | Structural / unmeasured wall-clock | Brand-new (revision-1) remote directory create and known-directory delete journal events no longer trigger `Client.Walk()`: **full-tree Walk fallback -> 0 full-walk requests**. Directory move/rename, restored/moved-in unknown directories, and an existing baseline directory missing locally retain full reconciliation. |
| Windows local moved-placeholder baseline index | **Accepted / structural contract** | Structural / unmeasured wall-clock | 100k baseline + 500 moved-placeholder node lookups from the existing baseline: node-path resolution **500 independent linear baseline lookups -> 1 lazy index-build pass + 500 map lookups**. Batches with no moved placeholder build no index; post-index additions retain one-scan fallback + cache. |
| Windows conflict source refresh | **Accepted / structural contract** | Structural / unmeasured wall-clock | Both live local-sync and full-reconcile overwrite-conflict recovery now restore the server winner via **1 exact `GET /nodes/:id` / 1 returned node** instead of `Client.Walk()` (**root + every directory page + whole-tree path map**). Conflict-copy upload and winner placeholder semantics are unchanged. |
| Windows full-reconcile remote-deletion pruning | **Accepted / structural contract** | Structural / unmeasured wall-clock | 1,200 flat baseline files absent remotely: remote-deletion cleanup **1,200 baseline-wide `deletePrefix` scans / up to 721,800 key inspections -> 1 baseline missing-set scan + 1,200 exact map deletes**. Missing directory subtrees collapse to one physical `RemoveAll` root. |
| Windows local-delete baseline pruning | **Accepted / structural contract** | Structural / unmeasured wall-clock | 1,200 flat local deletions: successful-delete baseline pruning **1,200 baseline-wide prefix scans / up to 721,800 key inspections -> 1 final baseline scan**; processed/deleted subtree coverage uses ancestor-set lookup instead of a growing linear prefix slice. Server DELETE cardinality/order are unchanged. |
| Windows local-change existence probe reuse | **Accepted / structural contract** | Structural / unmeasured wall-clock | 1,200 independent local-change paths: filesystem existence probes in `reconcileLocalChanges` **2,400 `Lstat` calls -> 1,200** by recording missing deletion candidates during the first pass; Server DELETE cardinality/order and 404/409 handling are unchanged. |
| Windows local file-rename baseline fast path | **Accepted / structural contract** | Structural / unmeasured wall-clock | 1,200 independent file renames in a 100k-entry baseline: prefix-wide baseline scans **2,400 -> 0**; directory rename and directory-target fallback retain subtree semantics. |
| Windows full-reconcile local-file delete baseline fast path | **Accepted / structural contract** | Structural / unmeasured wall-clock | 1,200 locally missing flat files with unchanged remote revisions: successful-delete baseline prefix scans **1,200 -> 0**; directory/type-mismatch cleanup retains subtree semantics. |
| Windows empty always-local policy fast path | **Accepted / structural contract** | Structural / unmeasured wall-clock | Default policy with a 100,000-entry baseline: `applyAlwaysLocal` baseline inspections **100,000 -> 0** when no normalized `AlwaysLocalPaths` exist; configured always-local pin/hydrate behavior is unchanged. |
| Web/Desktop 1 GiB transfer throughput + RSS | **Measured / Web optimization approved** | Measured wall-clock + memory | Desktop/Agent stays bounded (upload **2.373 s / +19.3 MiB RSS**, download **6.175 s / +3.2 MiB RSS**, medians). Web is red: upload **7.914 s / +471.8 MiB JS heap / +927.1 MiB renderer WS**; download **3.814 s / +313.8 MiB heap / +369.1 MiB WS**. A no-storage download sink still exceeds memory budgets, so a Web streaming/allocation follow-up is approved. |
| Resumable upload chunk-buffer reuse | **Accepted / structural contract** | Structural / unmeasured wall-clock | 1 GiB path upload at 8 MiB/chunk: explicit large payload buffers **256 -> 2** across pre-hash + upload verification; stream upload **128 -> 1**. Integrity double-read/double-hash semantics unchanged. |
| Upload finalize reused-source handle reuse | **Accepted / structural contract** | Structural / unmeasured wall-clock | 128-chunk overwrite with 1 changed chunk and 127 reused chunks from one prior CAS object: reused source-object opens **127 -> 1**; the changed staging-object open remains **1**. |
| Upload conflict preflight batching | **Accepted / structural contract** | Structural / unmeasured wall-clock | 120 unique upload targets: pre-transfer conflict discovery **120 sequential requests / ~240 handler DB queries -> 1 request / 1 SQL statement**; requests are capped at 200 targets and ordered single-preflight fallback is retained. |
| Upload-start expired-session cleanup | **Accepted / structural contract** | Structural / unmeasured wall-clock | One interactive upload-init request no longer drains up to **16 x 128 = 2,048 expired sessions** plus their part/object deletes. Expired resume rows are ignored by `expires_at > now`; startup/hourly Janitor retains full cleanup. |
| Instant-upload ownership existence probe | **Accepted / structural contract** | Structural / unmeasured wall-clock | 120 same-key current-file refs or 120 same-key historical-version refs: ownership changes from aggregate `COUNT(*)` over all matches to one indexed `EXISTS` union that needs only a boolean result. The outer fast check and in-transaction ownership recheck both remain. |
| Upload CAS metadata stat | **Accepted / structural contract** | Structural / unmeasured wall-clock | Local/ObjectStatProvider CAS health checks in finalize and instant-upload retain use metadata `Stat` without opening payload handles: healthy-object validation **1 Open + 1 fstat + 1 Close -> 1 metadata Stat** per check. Generic Store fallback remains unchanged. |
| Upload finalize existing-CAS write elision | **Accepted / structural contract** | Structural / unmeasured wall-clock | A completed upload whose declared SHA256 already has a ready same-size CAS object: finalize full-file assembled Store writes **1 -> 0**; every uploaded byte is still read and SHA256/MD5-verified. |
| Archive prepare subtree loading | **Accepted / structural contract** | Structural / unmeasured wall-clock | One selected folder with 120 direct child folders and one file in each: recursive child enumeration **121 per-directory child-list queries (+ GORM file preload queries) -> 1 recursive CTE with file metadata join** for that root. ZIP payload streaming is unchanged. |
| Archive prepare local metadata stat | **Accepted / structural contract** | Structural / unmeasured wall-clock | 1,000-file archive on `storage.Local`: prepare payload-handle opens/closes **1,000/1,000 -> 0/0**; metadata validation remains **1,000 Stat operations**, and ZIP streaming still opens each payload once. |
| Archive download progress coalescing | **Accepted / structural contract** | Structural / unmeasured wall-clock | Fast 8 MiB transfer at 64 KiB/read: progress-state callbacks **128 -> 1** inside one <100ms interval; production rate is capped to about **10 Hz per active file** plus terminal flush. ZIP/object reads are unchanged. |
| Archive selected-root ancestor coverage | **Accepted / structural contract** | Structural / unmeasured wall-clock | 120 selected files under independent 8-level branches: ancestor filtering **961 parent SELECTs -> 1 owner-scoped recursive CTE**. Nested-root suppression, missing-parent failure and cycle rejection remain unchanged. |
| FileOperation ancestor coverage | **Accepted / structural contract** | Structural / unmeasured wall-clock | 120 selected sibling files at depth 8: ancestor/top-level coverage **1,200 SELECTs -> 1 recursive CTE** per check; Copy/Move/Delete semantics unchanged. |
| FileOperation total-byte aggregation | **Accepted / structural contract** | Structural / unmeasured wall-clock | 120 selected top-level directories: recursive size aggregation **120 CTEs -> 1 selection CTE**; per-item owner/revision validation remains unchanged. |
| FileOperation enqueue root validation | **Accepted / structural contract** | Structural / unmeasured wall-clock | 120 selected file roots: owner/revision/root validation with file metadata **240 SELECTs -> 2 SELECTs** (one ordered locked node batch + one File preload); validation still reports the first failing requested item. |
| FileOperation execution root validation | **Accepted / structural contract** | Structural / unmeasured wall-clock | 120 selected roots: Copy/Delete locked root validation with File metadata **240 SELECTs -> 2 SELECTs**; Move root validation **120 SELECTs -> 1 SELECT** with no File preload. Recursive mutation/conflict/progress semantics are unchanged. |
| FileOperation delete subtree summary | **Accepted / structural contract** | Structural / unmeasured wall-clock | Per delete root, execution reuses one recursive subtree query for node IDs + bytes: **2 recursive CTE statements -> 1**; trash/protection/revision semantics unchanged. |
| FileOperation delete multi-root subtree aggregation | **Accepted / structural contract** | Structural / unmeasured wall-clock | 120 selected sibling directory roots, one file each: execution-time subtree summary recursion **120 CTEs -> 1 grouped CTE**; per-root managed-source/share/Trash/revision/undo semantics remain unchanged. |
| FileOperation delete managed-target preload | **Accepted / structural contract** | Structural / unmeasured wall-clock | 120 delete roots: Yike managed-target protection DB work **240 statements -> 2 statements** (one optional-schema probe + one owner target load); first protected root is still rejected in original request order. |
| FileOperation progress write coalescing | **Accepted / structural contract** | Structural / unmeasured wall-clock | 120 top-level Move/Delete roots: operation current-item + completion progress writes **240 UPDATEs -> 121 UPDATEs**. Every root still performs one `status=running` cancel checkpoint; the previous root's item/byte delta is folded into the next checkpoint and the final delta is flushed. Copy file-byte deltas use the same coalescer. |
| Permanent-delete CAS reference release | **Accepted / structural contract** | Structural / unmeasured wall-clock | 120 unique CAS references: reference-release DB statements **360 -> 3** (one ordered advisory-lock statement, one row-lock load, one batch update). Physical object deletes remain per-object and unchanged. |
| Legacy delete reference batching | **Accepted / structural contract** | Structural / unmeasured wall-clock | 120 legacy non-CAS keys: post-commit File/FileVersion reference checks **120 SQL statements -> 1 UNION query**; referenced keys remain protected and physical Store.Delete remains one call per unreferenced key. |
| CAS physical-delete reused-source guard | **Accepted / structural contract** | Structural / unmeasured wall-clock | Reused-source protection changes from `COUNT(*)` over all matches with no source-key index to an exact-key partial-indexed `EXISTS`; a blob referenced by 128 reused chunks no longer requires consuming all 128 matches just to answer a boolean guard. |
| FileOperation subtree predicates | **Accepted / structural contract** | Structural / unmeasured wall-clock | 1,201-node source subtree: target-descendant validation **1,201 DB rows -> 1 scalar bool** across the DB/Go boundary; managed-target protection removes the intermediate **1,201-ID Go slice + 1,201-value `IN` list** in favor of one database CTE `EXISTS`. |
| FileOperation target-descendant batching | **Accepted / structural contract** | Structural / unmeasured wall-clock | 120 selected source directories with one shared target outside the selection: repeated target-ancestor validation **120 recursive CTEs -> 1 recursive CTE**; request-order failure reporting remains in the existing Copy/Move loops. |
| FileOperation Move root-byte aggregation | **Accepted / structural contract** | Structural / unmeasured wall-clock | 120 selected sibling directories, one file each: execution-time root-byte recursion **120 CTEs -> 1 grouped CTE**; Move root loads no longer preload `xd_files`. Processed byte totals and conflict/replace semantics stay unchanged. |
| FileOperation Move replace/merge File preload elimination | **Accepted / structural contract** | Structural / unmeasured wall-clock | Merge root + 120 matching child directories, one source file per child: unused `xd_files` preload SELECTs **242 -> 0** (121 conflict-target preloads + 121 source-child preloads). Node traversal/mutation order is unchanged. |
| FileOperation Copy source-subtree loading | **Accepted / structural contract** | Structural / unmeasured wall-clock | One copied root with 120 child directories and one file each: source-tree reads **242 SELECTs -> 1 recursive CTE with file metadata join**. Destination creates, content-reference retain, hooks/progress and undo remain per node. |
| FileOperation Copy replace/merge source snapshot | **Accepted / structural contract** | Structural / unmeasured wall-clock | Replace/merge root + 120 matching target directories, one source file per child: recursive source enumeration **242 SELECTs -> 1 source-subtree CTE** while target conflict/protection checks remain dynamic per destination level. |
| Navigation-tree pagination | **Merged** | Unmeasured wall-clock | One 200-item folder page per expansion; additional siblings are explicit load-more. |
| Search server sort + sort-bound cursor | **Merged** | Unmeasured wall-clock | name/updated/size/type are globally server-paged; renderer no longer re-sorts only the loaded subset. |
| 100k image/video media-directory traces | **Server/object-store matrix measured; renderer trace measured** | Measured structural + diagnostic timing | Real Server + PostgreSQL + `storage.Local`: cold **102 original opens / 102 derivative writes**, warm **0 / 0** with **102 derivative reads**, video icon fallback **0 thumbnail/object-store work**. Synthetic Web/Desktop renderer remains bounded at <=6 thumbnail in-flight, 110 max mounted, and 1200 peak retained. |
| Viewport HTTP abort propagation (Gallery/FileExplorer/100k ranges) | **Candidate accepted by HTTP A/B / full regression pending (#1083)** | Same-host 500 ms HTTP, 3× paired samples per path, 160 ms observation | BEFORE **6/6 stale requests alive, 0/6 aborted**; AFTER **0/6 alive, 6/6 aborted, 0 stale bytes** in all nine samples. Abort latency 1.36–3.86 ms, no change to durable tasks. Five legacy Desktop test assertions pending correction before merge. |
| Viewport cancellation of stale requests (Gallery/FileExplorer/ranges, Web/Desktop) | **Measured baseline / structural breach (#1077)** | Same-host Node HTTP response abort trace, n=3 per surface | **All 6 stale requests still active at +160 ms, 0/6 aborted, 6/6 full responses delivered** for Gallery thumbnails, FileExplorer thumbnails and virtual ranges; current and parent identical. Product optimization justified; current PR measurement-only. |
| 100k Grid/Details image-video-LIVP renderer matrix | **Measured baseline / no production optimization (#1072)** | 24 actual Web/Desktop Chromium renders; synthetic thumbnail payloads | All structural budgets passed: Grid **110** DOM max, Details **37**, sparse metadata **1200**, thumbnail in-flight **≤6**, first viewport **189–250 ms** diagnostic. Live glyph **16–50** once a thumbnail source is available; decode completion is not asserted. Real codec/HTTP/backfill remain pending. |
| Current 100k local baseline (2026-10-09) | **Measured baseline / no production change** | Fresh controller, real image HTTP/store, PGlite metadata and 24 synthetic renderer samples | Bounded work: 800 controller peak retained, 110 renderer max mounted, 1200 renderer retained, <=6 thumbnail in-flight. Real video cold decode/backfill and LIVP HTTP coverage remain the next measurement-only gap. |
| Current 4 GiB Agent transfer baseline | **Measured baseline / memory budget passed** | Three fresh Linux processes per direction; exact payload/chunk validation | Upload **11.466 s / +22.48 MiB RSS**, download **2.638 s / +2.469 MiB RSS**; local zero-filled overlayfs/loopback only. No Agent production change. |
| Current native image/store + 4 GiB Agent qualification | **Measured baseline / budgets passed** | PR #1067 initial native CI, actual merge checkout `86cf14e1` | Image cold/warm batches **737.958 / 36.167 ms**, expected store bounds; Agent upload/download **10.987 / 11.414 s**, RSS deltas **23.523 / 3.414 MiB**. No production change or cross-environment speedup. |

## Request-scoped viewport cancellation benchmark (2026-10-09)

Status: **Benchmarking / baseline only** on `perf/viewport-cancel-request-baseline`, current production unchanged. This is a separate performance/cancellation track, not race-condition investigation.

- Named workload: six *already-started* pending requests for Gallery thumbnail retention, FileExplorer thumbnail scheduling and CloudFiles virtual-range loader. The last path models the real 100k virtual viewport, but the HTTP fixture itself is only six 8 KiB requests, **not** 100k network requests.
- Measurement uses the production scheduler/controller code extracted and TypeScript-transpiled in the Node CI environment. All operations use real Node `fetch` to a local slow HTTP endpoint (fixed 500 ms response delay), then simulate scroll eviction and a component/window unmount. Record `httpStillActive`, server-observed early disconnect count, client logical completion, admitted `AbortSignal` count, remaining scheduler slots, and server response bytes at **160 ms** after cancelling. Three samples each; original/current source is tested on the **same CI host** by reading exact `HEAD^` and work tree.
- This benchmark measures TCP/HTTP client abandonment at a local Node server. It **does not** directly exercise real Go Gin handlers, Agent IPC, media derivation scheduler cancellation, external-network throughput, or Web/Desktop integration; those require separate tests before declaring cancellation end-to-end.
- Predeclared next-stage budget if the baseline reveals stale work: no more than 6 started in-flight thumbnail/range requests, **6/6** abandoned requests must trigger actual transport abort before the 160-ms observation for each session, all stale requests must be off the server by the observation point, and no full 8 KiB stale HTTP payload should be transmitted. Cancelling the UI promise without aborting HTTP is **not** success. Use same three samples and same 500-ms simulated service cost for BEFORE/AFTER; do not accept throughput or correctness regression.
- Benchmark command: `cd desktop && node scripts/thumbnail-request-cancel-performance.cjs paired`; scoped job `file-explorer-viewport-cancel-performance` on GitHub/GitLab, raw JSON under `desktop/perf-results/`. The base source revision, per-sample timings and exact structural counts must be committed here before any production change is tested.
- **BEFORE/current verified:** [CI run 37877779088](https://github.com/lazyxu/xdrive/actions/runs/37877779088), job 113650209853; exactly 18 samples (3 scenarios × 3 samples × parent/current). Each of the **nine current production-source samples** started six real HTTP requests; **at +160 ms, all six remained active, zero received AbortSignals, zero HTTP responses were cancelled, and all six eventually transferred the full 8 KiB each (48 KiB unnecessary work per sample).** Parent sampled identically, and the paired baseline has no production delta.
- Gallery resolves its six logical promises promptly while the server retains six active requests; FileExplorer retains six active queue slots; the CloudFiles virtual-range callback accepts a signal from the collection controller but fails to pass it through the port, so its six underlying HTTP requests continue.
- **Decision:** confirmed structural performance breach; a later minimal production optimization is warranted. **AFTER:** not applicable in this benchmark-only PR; no product code is changed. The next optimization must pass the originally frozen **6/6 abort, zero remaining requests, zero stale payload by 160 ms** target, with equivalent cancellation and correctness evidence on Web and Desktop.
- Raw records including every parent/current row, event mode, logical-settlement count and transport counters: [ci-run-37877779088.json](performance-evidence/viewport-cancel/ci-run-37877779088.json). These Node-local HTTP counters are **not** proof of actual Gin or Agent context cancellation.
### Request-scoped transport abort optimization — follow-up

Status: **Measured improvement / full regression pending**, branch `perf/viewport-request-cancel-transport`. Initial 18-sample CI A/B [run 37880698868](https://github.com/lazyxu/xdrive/actions/runs/37880698868), job 113659481881 passed cancellation budgets. Five ordinary Desktop tests needed assertion/mocking updates and require a fresh full CI before merging; this is not yet a production acceptance.

- BEFORE: PR #1077, [run 37877779088](https://github.com/lazyxu/xdrive/actions/runs/37877779088), 3 samples per path; **6/6 server requests remain active at +160 ms, 0/6 transport aborts, 6/6 late responses** for Gallery thumbnails, FileExplorer thumbnails and 100k virtual-range page requests.
- Candidate contract: one abortable controller per request-lifetime, signal passed from shared viewport scheduler or VirtualCollection → Web REST/Native Desktop IPC → Agent HTTP → Go request `Context()`. Desktop request IDs are scoped to their sending window; Main supports cancel-before-admission and window-destroy cleanup. Agent/Server interface and durable task definitions are unchanged.
- Predeclared acceptance: same 500 ms delay, 8 KiB payload, six already-started requests, +160 ms observation, **three paired iterations per path with alternating BEFORE/AFTER order**. Each current sample must have 6/6 early server-observed disconnects, 0 remaining old requests and 0 stale payload bytes; the 6 logical transfers must release their slots. Also require Web/Desktop build, API/Agent regression suites and matching named CI jobs. Do not use a synthetic timing difference across machines to claim faster product UI.
- The primary benchmark executes real HTTP in Node with production TypeScript scheduler/controller code. Separate compiled Desktop Main/Agent IPC tests cover request-ID cancellation and Agent context propagation. **Neither result alone proves a complete browser-to-real Server media-derivative cancellation**. Specifically, the background derivative scheduler currently owns a detached work lifetime; cancelling one HTTP waiter must not indiscriminately kill a shared/durable derivative. That needs its own measured consumer-aware contract before change.
- A window, tab or view switch here refers to the view's request ownership ending (unmount/reload/navigation); a still-mounted hidden OS/background tab is not yet separately qualified. Persistent upload/download/sync/delete Task Center operations stay independent.
- AFTER initial candidate (**source `595e147a2f55a8396deeed17df30ebc824187586`**, same CI runner as BEFORE): each of the **nine paired current samples** observed HTTP **6/6 cancelled, 0/6 still active at +160 ms, 0/6 full responses, zero stale payload bytes**. Every paired parent sample had 0/6 cancelled and all 6 requests alive at +160 ms.
- Machine-readable exact sample rows and provenance: [ci-run-37880698868.json](performance-evidence/viewport-cancel-transport/ci-run-37880698868.json). Each old completed 6×8 KiB of unwanted response; candidate saves **48 KiB per six-request discarded viewport** in this synthetic fixture. It is not a measured global upload/download throughput improvement.

| Request owner | BEFORE aborted at +160 ms | AFTER aborted at +160 ms | AFTER maximum measured abort latency (ms) | AFTER finished stale HTTP bytes |
| --- | ---: | ---: | ---: | ---: |
| gallery | 0/6 (three samples) | **6/6 (three samples)** | 3.863 | **0** |
| file-explorer | 0/6 (three samples) | **6/6 (three samples)** | 2.052 | **0** |
| virtual-range | 0/6 (three samples) | **6/6 (three samples)** | 2.271 | **0** |

- Desktop actual Agent-HTTP regression successfully demonstrated a terminated thumbnail GET, terminated 100k-range GET, sender-ID isolation, cancel-before-admission and WebContents teardown. Normal Go/Server API tests passed in the initial run. The five Desktop failures were old structural string assertions and a callback unit-test missing its newly injected helper; corrected tests require rerun and must not be ignored.
- **Decision:** provisional candidate retained because the stable structural objective improved in 9/9 samples. **Acceptance conditional on corrected full CI and unchanged business semantics**, and on the 9/9 repeated HTTP gate remaining green. Actual background derivative worker cancellation remains intentionally outside this scope.
## Current performance contract

- Directory listing uses cursor pagination with 200 items per page.
- Non-empty paged directory reads fetch node and file metadata in one joined DB query; empty/terminal pages perform a fallback parent validation only to preserve 200-vs-404 semantics.
- The first sparse range of each FileExplorer directory generation fetches rows and authoritative `total_count` in **1 SQL round-trip** via `COUNT(*) OVER()`. After that count is primed, subsequent viewport ranges send `include_count=false` and execute the same ordered row query without the window count; count-free empty windows still validate the parent to preserve 200-vs-404 semantics.
- Details view windows large directories once 240 items are loaded.
- Details scroll-window state is updated at most once per animation frame and only when the effective row boundary changes.
- Grid view windows large directories once 400 items are loaded, with deterministic row geometry and three overscan rows.
- Grid keyboard navigation and marquee selection use computed virtual geometry instead of scanning every mounted item.
- Selection, active-item, Shift-anchor, keyboard-current-item, and Quick Look position lookup use memoized ID indexes instead of repeated whole-directory scans.
- Server-sorted directory arrays are reused without cloning, and the visible-item ID index, type-select names, Quick Look file list, and Quick Look index are built in one traversal.
- Selected-size aggregation scales with the selected set rather than the complete loaded directory.
- Paged node projection builds the node index and Explorer item view models in one pass, while breadcrumb path prefixes are computed once per directory instead of once per item.
- Grid thumbnails are viewport-proximate through one shared IntersectionObserver, share a global concurrency budget of 6 requests, cancel queued work when tiles unmount, and reuse a bounded 96-entry per-Explorer thumbnail cache.
- Desktop thumbnail transport stays binary from xdrive-agent to Electron: Agent IPC returns raw bytes, Desktop carries them as ArrayBuffer, and renderer surfaces create Blob URLs instead of base64 JSON/data URLs.
- Directory and search pagination reject duplicate in-flight load-more requests synchronously.
- Infinite-scroll page prefetch starts at least 500 px before the end and expands to 1.5 viewport heights on larger windows, while the existing in-flight locks prevent duplicate page requests.
- Normal directory page appends check only the incoming page against a retained ID set and append directly; the whole-directory Map merge remains only as a duplicate-ID correctness fallback.
- Search page appends use the same retained-ID fast path per workspace/query, with full Map reconciliation only when a duplicate ID is actually observed.
- Directory responses from superseded navigation requests are ignored rather than replacing the newer location.
- Address-bar path traversal resolves each segment with one exact-name paged child lookup (limit 1) instead of loading every child in each traversed directory.
- Folder-upload create conflicts reuse an existing sibling through a case-insensitive indexed name lookup (limit 1) instead of listing and scanning the entire parent directory.
- Desktop folder-tree download resolves the selected root through an owner-scoped exact node-id lookup and validates its expected parent/type/name; recursive directory enumeration uses cursor-paged children reads capped at **500 nodes per response** and must not use the legacy unpaginated children contract.
- Web authenticated file, version, and archive downloads open the File System Access sink before network work when supported, then await one writable chunk at a time while retaining Transfer Center byte progress; unsupported browsers keep the legacy Blob fallback.
- Current-file and historical-version download metadata are each resolved with one owner-scoped active-file JOIN. Current download no longer uses GORM `Preload("File")`, and version download no longer performs a separate owner-node lookup before loading the version row.
- Windows CfAPI hydration keeps the existing 4 MiB HTTP range granularity but fills one caller-owned buffer through `DownloadRangeInto` for the lifetime of each fetch callback, rather than allocating one response slice per range. The legacy `DownloadRange` API remains unchanged for compatibility.
- Windows remote change-journal pages build one `nodeID -> baseline path` index per page. File upsert/delete lookup is O(1) after that build; incremental file delete removes the exact baseline entry directly and file rename moves the exact entry directly. Brand-new revision-1 directory create and known-directory delete are also incremental; directory move/rename, restored or moved-in unknown directories, and an existing baseline directory missing locally retain the full-reconcile safety path.
- Resumable uploads reuse one bounded chunk buffer per pass instead of allocating a fresh 4-16 MiB payload slice for every chunk. Path uploads intentionally keep the pre-hash pass plus upload-time rehash so source mutation detection is unchanged; stream uploads reuse one chunk buffer from the first missing chunk onward.
- Upload finalize keeps a reused source object open across fixed-block overwrite parts with the same source storage key. Interleaved newly uploaded staging chunks do not force that source handle to reopen; staging parts keep their existing per-object open/close behavior.
- If an upload declares SHA256 and a matching ready CAS blob exists on an `ObjectStatProvider`, finalize still reads every uploaded part and recomputes SHA256/MD5 but hashes directly without writing a duplicate assembled temp object. Stores without metadata stat, missing/stale CAS metadata, or missing/wrong-size CAS objects retain the original assemble-and-promote path.
- Multi-file and folder uploads batch conflict preflight for unique destination names, with at most **200 targets per request**. Shared orchestration consumes results in original file order, excludes duplicate destination names from upfront batching, and falls back to the legacy per-file preflight when the batch transport is unavailable or fails.
- Archive prepare loads every descendant of a selected top-level directory with one owner-scoped recursive CTE per root, joining `xd_files` metadata in the same statement. Manifest DFS order, duplicate-root naming, stored-object validation, entry caps, and ZIP streaming remain unchanged.
- Archive prepare stored-object validation uses `storage.ObjectStatProvider` when available. Production `storage.Local` validates existence and size with metadata-only `os.Stat` instead of opening/closing each payload before download; backends without metadata stat retain the existing `Open -> Stat -> Close` fallback.
- FileOperation Copy/Move/Delete ancestor coverage is resolved by one owner-scoped recursive CTE per batch instead of walking every selected item's parent chain with one SQL query per level; missing selected nodes still fail before enqueue.
- FileOperation enqueue validates every selected root as before, then computes aggregate bytes for the already non-overlapping top-level selection with one owner-scoped recursive CTE instead of one recursive size query per selected directory.
- FileOperation enqueue locks selected roots in one deterministic ID-ordered query and batch-preloads their file metadata, then replays missing/root/revision validation in original request order. This replaces one node query plus one File preload per selected file without changing the first reported failing item.
- FileOperation delete execution resolves each active subtree once into both its node IDs and aggregate bytes, then reuses that summary for managed-source protection, share revocation, trash marking, and progress instead of recursively walking the same root twice.
- Multi-root FileOperation Delete resolves all already top-level delete roots through one grouped recursive subtree query, returning an independent ID list and byte total per root. The worker still applies managed-source protection, share revocation, Trash marking, revision validation, undo capture, and progress in original request order.
- FileOperation Delete loads the owner's Yike managed `target_node_id` values once per execution after a single optional-Sources schema probe, then checks each already-materialized subtree ID list in memory. The first protected root still fails with `managed_source_target` before that root is mutated.
- Permanent-delete CAS reference release groups unique content keys into batches of at most **200**. Each batch acquires content advisory locks in hash order with one statement, locks all matching `xd_content_blobs` rows with one `FOR UPDATE` query, then applies all validated refcount/state changes in one update statement. Two-phase `deleting` state and per-object physical cleanup are unchanged.
- CAS physical deletion checks temporary reused upload ranges with `SELECT EXISTS` against the partial index `idx_xd_upload_parts_reused_source_storage(source_storage_key) WHERE reused = TRUE`. The guard remains inside the existing per-blob transaction before `Store.Delete`, so active resumable overwrite ranges still keep the old content alive.
- FileOperation Copy/Move target-descendant validation walks the target's active ancestor chain in PostgreSQL and returns one scalar `EXISTS` result instead of materializing the source subtree IDs in Go. Managed-source subtree protection likewise stays inside PostgreSQL as a recursive CTE joined directly to `xd_sources`, while Delete keeps its existing ID materialization because those IDs are required for share revocation and Trash updates.
- FileOperation Move obtains logical byte totals for all selected roots with one lazily executed grouped recursive CTE, then reuses the per-root totals for normal, skipped, and replace/merge progress. Move root nodes are loaded without the unused `File` preload; Delete keeps its subtree summary contract.
- Ordinary FileOperation Copy preloads the active source descendants and current file metadata with one recursive CTE per copied root, then reuses that in-memory parent/child map during recursive creation. Destination writes, content-reference retain, hooks/progress, undo capture, and replace/merge conflict traversal remain unchanged.
- Search queries without `/` seed matching path components, expand descendants of matching directories, and reconstruct paths/breadcrumbs only for candidates; slash-containing queries retain full-tree path matching for exact cross-component substring semantics.
- Search result sorting is server-paged for name/updated/size/type; cursors bind query/type/sort/order, and changing sort reloads the active search from page one instead of re-sorting only the loaded subset.
- Grid marquee selection coalesces pointer-move work to one animation-frame update.
- Navigation-tree expansion loads one 200-item folder page at a time; further sibling folders require explicit load-more, while the active path child stays injected even when it lies outside the loaded page.

### FileExplorer Trash sparse-range contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- FileExplorer recycle bin with **1,201 trash-root nodes**;
- Web/Desktop both use the shared Trash controller and shared VirtualCollection;
- structural evidence is bounded response/item projection count; no wall-clock speedup is claimed.

BEFORE:

- opening the recycle bin calls legacy `GET /api/v1/trash`;
- Server materializes all **1,201** trash roots and their file metadata;
- Web/Desktop retain/project the whole result before FileExplorer can render;
- changing sort is local-only over that full array.

AFTER / current:

- FileExplorer uses `range=true&offset=&limit=&sort=&order=` with page size **200**;
- first range returns at most **200 items + total_count**;
- later viewport ranges return at most **200 items** and use `include_count=false` after the authoritative count is known;
- sorting is Server-global for name / deletion time / size / type, with directories kept ahead of files;
- default name ordering is supported by the partial `idx_xd_nodes_trash_name` index;
- legacy unpaged `listTrash()` remains unchanged for compatibility outside FileExplorer.

Decision: **Accepted.** This removes total-trash-size response/render amplification from the FileExplorer open path without changing restore or permanent-delete semantics.

Regression budget: FileExplorer Trash must never require an unpaged full-list request for initial display; ordinary viewport range payloads stay <= **200 items**.

Next action: continue the basic-path audit at ordinary download / sync reconciliation / delete mutation paths and only change another deterministic request, SQL, allocation, or I/O multiplier. Windows overwrite-conflict winner refresh is now an exact node lookup rather than a whole-tree walk.

### Windows full-reconcile remote-deletion pruning contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Windows full reconciliation after the remote snapshot is already loaded;
- baseline contains the root plus **1,200 flat files** that are all absent from the remote snapshot;
- evidence method: production control-flow cardinality plus deterministic helper tests; wall-clock timing is intentionally not quoted.

BEFORE:

- both Windows full-reconcile implementations iterated missing baseline entries and called `deletePrefix(baseline, rel)` for each one;
- `deletePrefix` scans the complete current baseline map to find descendants;
- because the flat workload has no descendant relationships, every one of the 1,200 files triggers another full-map prefix scan;
- the stable fixture therefore performs **1,200 baseline-wide prefix scans**, with up to **721,800 baseline-key inspections** across those scans.

AFTER / current:

- one pass collects every baseline path absent from the remote snapshot into a missing set;
- ancestor membership is resolved against that set so missing directory subtrees collapse to their top-level removal roots;
- physical filesystem cleanup runs once per top-level missing root;
- baseline cleanup then deletes each missing key directly, with no repeated whole-baseline prefix scan;
- the flat 1,200-file workload changes remote-deletion baseline scanning from **1,200 whole-map scans -> 1 whole-map collection pass + 1,200 exact deletes**;
- root preservation, `os.RemoveAll` behavior, remote-path retention, full-walk semantics and change-journal fallback behavior are unchanged.

Decision: **Accepted.** The remote snapshot already identifies the complete surviving path set, so repeated prefix discovery adds no correctness value during full-reconcile cleanup.

Regression budget: full-reconcile remote-deletion cleanup must not call `deletePrefix` once per missing remote path. Missing nested subtrees must collapse to top-level physical removal roots, while baseline keys are removed exactly.

Regression commands:

- `go test ./internal/mount -run '^TestPruneRemoteDeletedBaseline' -count=1`.

Next action: continue ordinary sync/download/delete performance and only change another deterministic request, SQL, allocation, filesystem, lock, or object-store multiplier.

### Windows remote-directory journal fast-path contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Windows CfAPI remote change-journal polling with the journal already enabled;
- deterministic directory-create fixture: one known root plus one new direct child directory;
- deterministic directory-delete fixture: one known directory root with a nested directory and file beneath it;
- the test HTTP server counts and rejects any `/nodes/root` or `/children` request, so a hidden fallback to `Client.Walk()` fails deterministically;
- no wall-clock speedup is claimed.

BEFORE:

- any directory upsert whose node was not already present at the same baseline path returned `needFull=true`;
- any delete of a baseline directory also returned `needFull=true`;
- `reconcileRemote` therefore followed one ordinary journal page with `Client.Walk()`, loading the owner root and every paged remote directory needed for a complete namespace snapshot;
- the extra work scaled with the whole remote namespace even when the mutation was only one plain directory create or delete.

AFTER / current:

- a brand-new revision-1 directory whose parent is already known is created/adopted locally with `MkdirAll`, statted once, and inserted into the baseline/index directly;
- a remote directory delete resolves the old path from the page-local node-ID index, executes one `RemoveAll`, and prunes that baseline prefix with one local baseline scan; descendant delete events in the same page are suppressed even when they appear before the directory-root event;
- both fixtures execute **0 full-walk requests** after the journal page;
- directory move/rename still returns `needFull=true` because descendants may not receive their own path mutations;
- a directory upsert absent from the baseline with `revision > 1` also keeps full reconciliation because it may be a restore or a subtree moved in from an excluded path;
- an existing baseline directory that is missing locally still falls back to full reconciliation, preserving the existing local-delete/remote-change conflict semantics;
- excluded-path behavior, file dirty checks, journal cursor handling, cache policy, baseline persistence, and full-reconcile fallback semantics are unchanged.

Decision: **Accepted.** Brand-new directory create and known-directory delete have enough information in the journal payload plus baseline index to update the local tree without a namespace-wide remote snapshot.

Regression budget: brand-new revision-1 directory create and known-directory delete journal pages must perform **0 `Client.Walk()` root/children requests**. Directory move/rename and unknown `revision>1` directory upserts must keep the existing full-reconcile fallback.

Regression commands:

- `go test ./internal/mount -run '^TestWindowsRemoteJournalDirectory(Create|Delete)AvoidsFullWalk$' -count=1`;
- existing `TestWindowsRemoteJournalDirectoryMoveRequestsFullReconcile` remains the move/rename safety gate;
- `TestWindowsRemoteJournalUnknownDirectoryUpsertKeepsFullReconcile` locks the restore/moved-in fallback.

Next action: continue basic FileExplorer sync/delete/download performance audits and only change another deterministic request, SQL, allocation, filesystem, lock, or object-store multiplier.

### Resumable upload chunk-buffer allocation contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- shared Go resumable-upload client used by FileExplorer/Desktop sync paths;
- stable structural workload: **1 GiB file**, **8 MiB chunks**, exactly **128 chunks**;
- evidence method: source-level explicit payload-buffer allocation count plus `go test ./internal/client`; wall-clock benchmark intentionally not quoted;
- samples: n/a for the structural count.

BEFORE:

- file-path pre-hash pass: **128** explicit large chunk-buffer instances;
- file-path upload verification pass with all chunks missing: **128** more;
- total for the 1 GiB path workload: **256** explicit 8 MiB payload-buffer instances;
- stream upload with 128 missing chunks: **128** explicit large payload-buffer instances.

AFTER / current:

- file-path pre-hash pass: **1** reusable chunk buffer;
- file-path upload verification pass: **1** lazily allocated reusable chunk buffer;
- total for the same 1 GiB path workload: **2** explicit 8 MiB payload-buffer instances;
- stream upload: **1** reusable chunk buffer from the first missing chunk onward;
- chunk-hash manifest strings remain **O(chunk count)** and are intentionally unchanged.

Decision: **Accepted.** The change removes chunk-count-scaled large payload allocations without weakening resumable-state validation, retry behavior, source-change detection, or the intentional second hash during upload.

Regression budget: payload-buffer instances must remain **O(1) per upload pass**, each bounded to one negotiated chunk (Server maximum **16 MiB**); no full-file buffering.

Next action: Server upload-finalize staging/object-store I/O is audited by the dedicated reused-source contract below; keep the client buffer contract unchanged.

### Upload-start expired-session cleanup contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- interactive `POST /api/v1/uploads` used by FileExplorer/Web/Desktop upload start;
- cleanup implementation is bounded at **128 sessions x 16 batches = 2,048 expired sessions** per invocation;
- every expired session may load its UploadParts, delete part/session rows, and delete each non-reused staging object;
- evidence is the production call graph plus the PostgreSQL upload integration; no wall-clock speedup is claimed.

BEFORE:

- every new upload-init synchronously called `cleanupExpiredUploads(ctx, ownerID)` before resume lookup;
- one unrelated backlog could therefore add cleanup DB/object-store work for up to **2,048 expired sessions** to a single interactive request.

AFTER / current:

- upload-init performs **0 expired-session cleanup passes**;
- resume lookup explicitly requires `expires_at > now()`, preserving the old effective behavior where expired sessions were removed before lookup;
- quota reservation and physical-capacity reservation already count only active, unexpired sessions;
- `StartUploadJanitor` runs a storage-Janitor pass immediately on startup and hourly thereafter; its staging-cleanup phase still performs the full expired-session drain;
- explicit abort/finalize expiry handling remains unchanged.

Decision: **Accepted.** Expired-session reclamation is maintenance work and is not required for upload-init quota/capacity correctness.

Regression budget: starting one upload must not delete unrelated expired upload-session rows or staging parts. Expired rows must never be resumed, and Janitor must retain the existing multi-batch drain test.

Next action: continue ordinary download/sync/delete performance audits and only change another deterministic request, SQL, allocation, filesystem, lock, or object-store multiplier.

### FileOperation enqueue root-validation batch-load contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- 120 selected sibling file roots, each with valid file metadata;
- deterministic SQL counting using the existing FileOperation GORM trace counter;
- comparison runs the legacy single-root loader for the same refs and the new batch loader;
- transaction begin/commit statements are outside the counted window.

BEFORE:

- each selected file root uses one locked `xd_nodes` SELECT plus one `xd_files` preload SELECT;
- **120 roots -> 240 SELECTs** before aggregate byte calculation.

AFTER / current:

- all selected roots are locked by one owner-scoped, ID-ordered `xd_nodes` SELECT;
- file metadata is loaded by one batched `xd_files ... IN (...)` preload SELECT;
- **120 roots -> 2 SELECTs**;
- returned nodes are reconstructed in request order;
- `node_not_found`, `root_mutation`, and `revision_conflict` validation still reports the first failing requested item and current revision where applicable;
- FileOperation execution itself remains unchanged and still performs its existing per-item mutation checks.

Decision: **Accepted.** This removes an enqueue-time N×2 SQL multiplier without broadening the execution-stage lock/mutation change.

Regression budget: selected-root enqueue validation remains **2 SELECTs** for a non-empty file batch regardless of batch size up to the existing 200-item cap; first-failure request-order semantics must remain covered.

Next action: execution-stage selected-root loading is covered by the dedicated contract below; continue recursive mutation/progress audits separately.

### FileOperation execution root-validation batch-load contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- 120 selected sibling file roots in one durable FileOperation;
- deterministic SQL counting uses the existing FileOperation GORM trace counter;
- Copy/Delete require File metadata; Move intentionally does not preload File metadata;
- the existing ordered locked batch loader is reused by the production execution paths.

BEFORE:

- Copy/Delete execute `batchLoadNodeTx(..., preload=true)` once per selected root;
- each root load issues one locked `xd_nodes` SELECT plus one `xd_files` preload SELECT;
- **120 Copy/Delete roots -> 240 SELECTs** before recursive mutation work;
- Move executes `batchLoadNodeTx(..., preload=false)` once per root;
- **120 Move roots -> 120 SELECTs** before recursive mutation work.

AFTER / current:

- Copy/Delete lock and validate all selected roots with one ordered `xd_nodes ... IN (...)` SELECT plus one batched File preload;
- **120 Copy/Delete roots -> 2 SELECTs**;
- Move locks and validates the same 120 roots with one ordered `xd_nodes ... IN (...)` SELECT and no File preload;
- **120 Move roots -> 1 SELECT**;
- nodes are reconstructed in request order, so first failing request index/id/revision validation semantics remain unchanged;
- Copy/Move/Delete recursive subtree work, target/conflict checks, managed-source protection, undo plans, mutation SQL and progress updates are unchanged.

Decision: **Accepted.** Execution already holds selected-root `FOR UPDATE` locks for the transaction lifetime; batching those existing root loads removes an N-scaled SQL round-trip multiplier without changing the recursive mutation algorithms.

Regression budget: Copy/Delete selected-root execution validation remains **2 SELECTs** and Move remains **1 SELECT** for any non-empty batch up to the existing 200-item limit. Production execution functions must not return to per-root `batchLoadNodeTx` calls.

Regression commands:

- `go test ./internal/api -run '^TestFileOperation(BatchRootLoadUsesConstantSQL|ExecutionUsesBatchRootLoads)$' -count=1`.

Next action: continue ordinary delete/sync/download execution audits and only change another deterministic SQL, request, allocation, filesystem, lock, or object-store multiplier.

### Upload finalize existing-CAS write-elision contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- a completed resumable upload whose declared SHA256 already has a ready CAS blob of the same size;
- the uploading user does **not** need to own that blob, so the cross-user instant-upload prohibition is unchanged;
- evidence is deterministic Store write counting around the real finalize handler;
- final SHA256/MD5 verification still consumes every uploaded byte.

BEFORE:

- finalize reads all uploaded parts and hashes them;
- finalize also writes one full assembled temporary object of **N bytes**;
- CAS preparation then discovers that the **N-byte CAS object already exists**, so the assembled temporary object is deleted;
- full-file assembled writes for this workload: **1**.

AFTER / current:

- ready CAS metadata plus metadata `Stat` establishes that a same-size target object already exists;
- finalize reads all uploaded parts and recomputes SHA256/MD5 exactly as before;
- bytes flow directly into the hash writers, not a duplicate Store object;
- full-file assembled writes: **0**;
- a hash mismatch still returns `file_hash_mismatch`; an existing CAS object is not proof that the uploaded bytes matched;
- stores without `ObjectStatProvider`, missing/stale CAS metadata, or missing/wrong-size CAS objects keep the original path.

Decision: **Accepted.** This removes one whole-file write and its temporary storage footprint from duplicate-content finalization without enabling cross-user instant upload or weakening payload verification.

Regression budget: existing-CAS finalize must perform **0 full-file assembled Store.Put calls** while still reading/hash-validating the complete upload. Unique-content finalize must retain the existing assemble-and-promote behavior.

Next action: continue the basic download/sync/delete audit and only change another deterministic request, SQL, allocation, filesystem, lock, or object-store multiplier.

### Upload finalize reused-source open contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Server resumable-overwrite finalize path using fixed-size chunk reuse from the previous file revision;
- stable structural shape: **128 chunks**, **1 changed staging chunk** in the middle, **127 reused chunks** pointing at the same prior CAS object; this mirrors a 1 GiB file at 8 MiB/chunk without allocating a 1 GiB test fixture;
- evidence method: deterministic `uploadPartSequence` test with a counting Store wrapper; wall-clock timing is intentionally not quoted;
- samples: n/a for the structural open count.

BEFORE:

- every reused part calls `Store.Open(source_storage_key)` independently;
- the 127 reused chunks therefore cause **127 opens** of the same prior CAS object;
- the one changed staging chunk causes **1** staging-object open.

AFTER / current:

- `uploadPartSequence` keeps one cached source file handle for the current reused source storage key;
- reused chunks before and after the interleaved changed staging chunk share that handle;
- reused source-object opens are **127 -> 1** for the stable workload;
- the changed staging-object open remains **1**;
- section offsets/sizes, assembled SHA-256/MD5 verification, CAS promotion, version history, resume state, and staging cleanup are unchanged.

Decision: **Accepted.** This removes reused-chunk-count-scaled object opens from delta overwrite finalize without changing file bytes or integrity checks.

Regression budget: reused source opens must remain **O(distinct reused source storage keys)**, not O(reused chunk count). The normal same-file overwrite path has one source key, so it must open that source at most once per finalize sequence.

Next action: continue sync/delete basic-path performance. LocalStore assembled-content promotion is already a same-filesystem rename, so no speculative CAS-copy rewrite is planned.

### Windows CfAPI hydration range-buffer allocation contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Windows CfAPI `fetchData` hydration path;
- stable synthetic structural workload: one callback requests **1 GiB**, fetched as **256 x 4 MiB** HTTP ranges;
- evidence method: source-level explicit large response-buffer allocation count, `DownloadRangeInto` caller-buffer unit coverage, and Windows build/tests;
- this workload describes allocation scaling and is **not** a claim that Windows normally requests 1 GiB in one callback;
- samples: n/a for the structural count.

BEFORE:

- each `DownloadRange` call used `io.ReadAll` and returned a newly allocated payload slice;
- 256 range requests therefore produced **256** large response buffers in the callback.

AFTER / current:

- `fetchData` allocates one buffer capped at **4 MiB** for the callback;
- every range request fills a slice of that same buffer through `DownloadRangeInto`;
- the same 1 GiB workload therefore uses **1** large response buffer;
- HTTP range requests remain **256**, CfAPI transfer granularity remains 4 MiB, and transfer-progress semantics are unchanged.

Decision: **Accepted.** This removes range-count-scaled large response allocations from the Windows hydration hot path without changing the network contract or public compatibility path.

Regression budget: explicit hydration payload buffers must remain **O(1) per fetch callback**, capped at **4 MiB**; do not replace this with full-file buffering.

Next action: continue the basic-path performance audit at FileOperation Copy/Move execution and FileExplorer thumbnail/cache transport; only optimize when a deterministic structural or measured hotspot is found.

### Linux FUSE read destination-buffer reuse

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Linux FUSE file-handle read callback backed by the existing local temp file;
- stable structural workload: **1 GiB sequential read** at **128 KiB per FUSE callback** = **8,192 callbacks**;
- evidence method: source-level payload-buffer allocation count plus a regression that verifies the returned `ReadResult` aliases the incoming go-fuse `dest` buffer;
- no wall-clock benchmark is quoted.

BEFORE:

- every `linuxHandle.Read` allocates `make([]byte, len(dest))`;
- the callback reads into that new slice and returns it through `fuse.ReadResultData`;
- the named workload therefore creates **8,192 explicit payload buffers**, with **1 GiB cumulative requested payload allocation volume** across the sequence.

AFTER / current:

- `ReadAt` fills the go-fuse-provided `dest` slice directly;
- `fuse.ReadResultData(dest[:n])` returns the same backing array;
- explicit xDrive payload-buffer allocations in the callback are **8,192 -> 0** for the named workload;
- this is cumulative allocation traffic, not 1 GiB of simultaneously retained memory;
- the file handle mutex, offset semantics, partial EOF reads, backing temp file and returned payload bytes are unchanged.

Decision: **Accepted.** go-fuse v2.5.1 explicitly permits constructing the read result from the incoming `dest` buffer, so the old copy buffer is unnecessary work on every Linux FUSE read.

Regression budget: `linuxHandle.Read` must not allocate a second payload-sized read buffer. Returned non-empty data must alias the incoming `dest` backing array.

Regression command:

- `go test ./internal/mount -run '^TestLinuxHandleReadReusesFuseDestinationBuffer$' -count=1`.

Next action: continue the basic sync/delete/download audit and only change paths with another deterministic SQL, request, allocation, or I/O multiplier.

### Windows change-journal baseline index contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Windows incremental remote journal fast path;
- stable baseline: **100,000 non-root entries**;
- one maximum-sized journal page: **500 missing file-delete events**;
- each missing delete exercises both the directory-safety precheck and the apply pass without filesystem mutation;
- evidence method: source-level lookup cardinality plus a Windows unit test that builds the 100k index and performs both lookup passes; wall-clock timing is intentionally not quoted;
- samples: n/a for the structural count.

BEFORE:

- each precheck delete calls `findBaselinePathByNodeID`, which linearly scans the whole baseline when the node is absent;
- each apply delete repeats the same linear lookup;
- **500 changes x 2 passes = 1,000 full baseline scans**, or roughly **100 million baseline-entry checks** at 100k entries;
- existing file deletes then call `deletePrefix`, another full baseline scan;
- existing file renames call `moveBaselinePrefix`, another full baseline scan plus path sorting even though directory moves already fall back to full reconciliation.

AFTER / current:

- the page builds one `winBaselineNodeIndex` in **1 baseline traversal**;
- the two 500-change passes use **1,000 O(1) map lookups**;
- incremental file delete removes the known exact baseline path and index entry directly;
- incremental file rename moves the known exact baseline entry directly and updates the node index;
- rare excluded-directory prefix cleanup updates the baseline and index together;
- directory move/delete safety fallback, journal cursors, placeholder updates, local-conflict checks, and full reconciliation remain unchanged.

Decision: **Accepted.** This removes change-count x baseline-size CPU amplification from the normal incremental journal page without weakening directory subtree safety.

Regression budget: `applyRemoteChangePage` must build at most **1 baseline node index per journal page** and must not call the linear `findBaselinePathByNodeID` for each change. Incremental file delete/rename must not call `deletePrefix` / `moveBaselinePrefix`.

Next action: continue delete-path performance at content-reference release / physical blob cleanup, and only change it if deterministic SQL or object-store amplification is found.

### Windows change-journal same-path upsert index fast-path contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Windows CfAPI remote change-journal page;
- stable structural workload: **100,000 baseline entries** and an ordinary file upsert whose journal `Path` still matches the same baseline entry/node ID;
- evidence method: deterministic helper behavior plus production source-shape guard; no wall-clock benchmark is quoted.

BEFORE:

- every non-empty remote change page eagerly built `indexBaselinePathsByNodeID(baseline)`;
- even one same-path file metadata/content update allocated and populated a full **100,000-entry** node index before applying the change.

AFTER / current:

- the page starts with no node index;
- an upsert first resolves `baseline[change.Path]` and verifies the node ID;
- ordinary same-path file/directory upserts therefore build **0 full baseline indexes**;
- if the supplied path is absent/mismatched, the existing lazy node-ID index is built and reused for the rest of the page;
- delete changes still build the lazy index because the Server delete journal intentionally has no path payload;
- rename/move detection and directory safety fallbacks are unchanged.

Decision: **Accepted.** Exact-path lookup already proves identity for the common same-path upsert case, so a namespace-sized reverse index adds no correctness there.

Regression budget: a same-path upsert must not build the full baseline node index. Rename/move/new-path ambiguity and delete must retain the existing lazy indexed fallback.

Regression commands:

- `go test ./internal/mount -run '^TestWindowsRemoteJournal(SamePath|RenameStillBuildsLazy)' -count=1`.

Next action: continue small-batch Windows baseline clone/persistence-diff auditing separately; do not mix those changes into this path-resolution fast path.


### Windows local moved-placeholder baseline index contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Windows local-change reconciliation / full-reconcile local-addition phase with a **100,000-entry baseline**;
- **500 moved-placeholder node IDs** that already exist in that baseline;
- deterministic helper test verifies lazy index reuse and indexed prefix-move maintenance;
- no wall-clock speedup is claimed.

BEFORE:

- every moved placeholder resolves its Cloud node ID through `findBaselinePathByNodeID`;
- that helper performs a full Go map traversal until the ID is found;
- the 500-item workload performs **500 separate linear baseline lookups** in the moved-placeholder path;
- ordinary non-placeholder local changes do not use this lookup.

AFTER / current:

- each local reconciliation loop starts with no node index;
- the index is built **only after the first actual placeholder is detected**;
- the 500-item workload becomes **1 baseline index-build pass + 500 O(1) map lookups**;
- successful prefix moves update every moved node's indexed path;
- if a node was added after the lazy index was built, one legacy scan resolves it and caches that result;
- local reconciliation loops with no moved placeholder build **0** baseline node indexes;
- rename/move requests, revision checks, placeholder identity, parent creation and baseline persistence semantics are unchanged.

Decision: **Accepted.** This removes moved-item-count × baseline-size CPU amplification from bulk local placeholder moves without taxing ordinary local-change batches.

Regression budget: one local reconciliation loop may build at most **1** baseline node index, and only after placeholder identity is confirmed. Existing indexed entries must not fall back to full-map scans; post-index additions may use at most one fallback scan per newly observed node before caching.

Next action: continue basic delete/download/sync performance and only change another deterministic SQL, request, allocation, filesystem, or object-store multiplier.

### Permanent-delete CAS reference release contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- permanent deletion of a trash subtree whose files/versions reference **120 unique CAS blobs**;
- every unique CAS key requires one refcount decrement; some rows remain referenced and some transition to `deleting`;
- evidence method: deterministic PostgreSQL statement counting around `releaseContentReferencesTx`; physical object-store deletion is outside this measured phase;
- samples: n/a for the structural count.

BEFORE:

- each unique CAS blob acquires one advisory xact lock with its own SQL statement;
- each blob is loaded with its own `SELECT ... FOR UPDATE`;
- each blob is updated with its own `UPDATE`;
- **120 unique blobs = 360 SQL statements** in the reference-release phase.

AFTER / current:

- unique CAS releases are sorted and processed in batches capped at **200**;
- one PostgreSQL statement per batch acquires advisory locks in hash order;
- one `SELECT ... FOR UPDATE` loads all matching content rows, then Go validates storage keys and refcount underflow exactly as before;
- one batch `UPDATE ... FROM VALUES` applies the resulting refcount/state transitions;
- **120 unique blobs = 3 SQL statements** in the reference-release phase;
- zero-ref rows still enter `deleting` and are physically removed only by the existing finalize path;
- legacy non-CAS key cleanup uses the separate batched reference-check contract below; physical object deletion remains per key.

Decision: **Accepted.** This removes unique-content-count-scaled DB round trips from permanent delete without changing the two-phase CAS deletion protocol or physical object deletion.

Regression budget: reference release must use at most **3 × ceil(unique CAS blobs / 200) SQL statements**, with exactly three statements for each non-empty batch; advisory locks must remain deterministically ordered and batches must stay parameter-bounded.

Next action: physical object deletion itself remains per-object by storage backend contract; continue download/basic-path performance audit after the reused-source guard is indexed.

### Legacy storage-key delete reference-check contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- permanent delete has already committed removal of the selected subtree's File/FileVersion rows;
- the release phase returns **120 unique sorted legacy non-CAS storage keys**;
- 40 keys remain referenced by current File rows, 40 by FileVersion rows, and 40 are unreferenced;
- deterministic GORM SQL tracing counts only the post-commit legacy reference lookup; physical object deletes are tracked separately.

BEFORE:

- `deleteLegacyStorageKeys` executes one SQL statement per key;
- each statement contains two scalar `COUNT(*)` subqueries, one against `xd_files` and one against `xd_file_versions`;
- **120 legacy keys -> 120 SQL statements** before physical deletion.

AFTER / current:

- candidate keys are processed in parameter-bounded batches of at most **500**;
- one `UNION` query per batch loads the subset still referenced by either File or FileVersion;
- **120 legacy keys -> 1 SQL statement**;
- referenced keys are kept exactly as before;
- unreferenced keys are still passed to `Store.Delete` individually and in input order;
- CAS content-reference batching and the permanent-delete transaction are unchanged.

Decision: **Accepted.** Reference existence is a set operation over the already unique candidate key list, so per-key SQL round trips add no safety.

Regression budget: legacy reference checks remain **ceil(candidate keys / 500) SQL statements**, with **1 statement** for the 120-key fixture; query failure must fail closed by deleting no keys; physical `Store.Delete` cardinality remains one call per unreferenced legacy object.

Next action: continue sync/download/delete audits and only change another deterministic request, SQL, allocation, filesystem, lock, or object-store multiplier.

### CAS physical-delete reused-source guard contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- one `xd_content_blobs` row in `deleting` state with `ref_count=0`;
- **128 reused upload parts** temporarily reference the blob through the same `source_storage_key`;
- evidence method: query-shape and schema-index contract plus the existing dedup integration lifecycle that verifies reused ranges keep the blob alive;
- samples: n/a for the structural result.

BEFORE:

- the finalizer issues `COUNT(*)` with `reused = TRUE AND source_storage_key = ?`;
- `xd_upload_parts` has the primary `(session_id, part_index)` key and an index on `reused`, but **no index on `source_storage_key`**;
- boolean safety only needs to know whether one matching reused range exists, but `COUNT(*)` must consume all **128 matching rows** in this workload before returning the count.

AFTER / current:

- migration installs `idx_xd_upload_parts_reused_source_storage(source_storage_key) WHERE reused = TRUE`;
- the finalizer issues `SELECT EXISTS (...)` with the partial-index predicate written as the SQL literal `reused = TRUE`;
- the exact source-storage-key probe can use the dedicated partial index and may stop after the first matching entry;
- the existing transaction order remains advisory lock -> content row `FOR UPDATE` -> reused-source guard -> physical `Store.Delete` -> content-row delete;
- no change to physical object deletion cardinality or upload-session semantics.

Decision: **Accepted.** The guard now matches its boolean intent and has an index aligned with its exact lookup key, without weakening the temporary-reference keepalive rule.

Regression budget: the finalizer guard must remain a single exact-key `EXISTS` probe backed by a partial index on reused upload parts; do not regress to counting all matches or scanning reused rows by boolean flag alone.

Next action: continue the basic download path audit; physical `Store.Delete` remains intentionally one call per object until storage backends expose a safe bulk-delete contract.


### Upload conflict preflight batching contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- FileExplorer multi-file/folder upload with **120 unique destination names** under one valid parent;
- existing single preflight performs one authenticated HTTP/IPC request per file and, inside the handler, one parent lookup plus one exact-name conflict lookup;
- batch preflight uses a VALUES-backed Server query that validates parents and resolves exact-name conflicts in one SQL statement;
- evidence is deterministic request/query cardinality; no wall-clock speedup is claimed.

BEFORE:

- **120 sequential preflight requests** before/during the ordered upload loop;
- approximately **240 handler-level DB queries** for those 120 targets (120 parent lookups + 120 conflict lookups), excluding auth middleware queries.

AFTER / current:

- **1 batch preflight request** for the 120-target workload;
- **1 Server SQL statement** returns the ordered 120-item result set;
- batch size is capped at **200 targets**, and larger selections are chunked by the shared controller;
- duplicate case-insensitive destination keys are intentionally excluded from upfront batching so their later preflight observes effects from earlier uploads;
- a batch transport/capability failure falls back to the existing single-target preflight path;
- per-item validation errors remain attached to their original index and are surfaced only when that target is reached, preserving ordered partial-success behavior;
- upload-session creation and finalize still revalidate target state, so batching does not weaken the authoritative conflict checks.

Decision: **Accepted.** This removes request-count-scaled preflight round trips and handler queries for normal unique-name batches without changing conflict-dialog order or upload execution order.

Regression budget: a normal <=200 unique-target batch must use at most **1 batch request / 1 batch SQL statement**; no batch failure may disable the single-target fallback, and duplicate destinations must remain sequentially preflighted.

Next action: upload finalize reused-source open amplification is handled by the dedicated contract above; continue sync/delete basic-path performance without speculative CAS-copy rewrites.

### Instant-upload ownership existence-probe contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- instant-upload dedup ownership lookup against a CAS storage key;
- deterministic fixture with **120 current-file references** to one key and **120 historical-version references** to another key for the same owner;
- production Server migration already provides `idx_xd_files_storage_key` and `idx_xd_file_versions_storage_key`;
- the regression captures the SQL emitted by the real `userOwnsStorageKey` helper and verifies current-file ownership, version-only ownership, foreign-user rejection, and a missing key;
- no wall-clock speedup is claimed.

BEFORE:

- each ownership check executes `COUNT(*)` over a `UNION ALL` of matching current-file and historical-version references;
- because the caller only needs a boolean, the aggregate nevertheless requires determining the full matching cardinality;
- instant upload intentionally performs this check once before entering the transaction and again inside the content-hash lock before retaining the blob.

AFTER / current:

- the same ownership predicate is expressed as one `SELECT EXISTS (... UNION ALL ...)` statement;
- the storage-key probes remain index-supported and the existence query may stop once ownership is proven instead of aggregating every matching reference;
- both ownership checks remain in place: the outer check is a fast rejection and the in-transaction check remains the authoritative safety revalidation;
- current-file, historical-version, trash/history ownership semantics are unchanged because the joins and owner predicate are unchanged.

Decision: **Accepted.** This removes unnecessary full-cardinality aggregation from a hot dedup-upload boolean check without weakening ownership validation or transaction safety.

Regression budget: `userOwnsStorageKey` must remain **1 SQL statement using EXISTS and no COUNT aggregation**, probe both current files and historical versions, and preserve the in-transaction recheck.

Next action: continue the sync/delete/download basic-path audit and only change another deterministic request, SQL, allocation, or I/O multiplier.

### Upload CAS metadata-stat contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- healthy CAS object validation during upload finalize and instant-upload retain;
- Local storage implements `storage.ObjectStatProvider`;
- deterministic unit fixture wraps Local and counts metadata `Stat` versus payload `Open`;
- no wall-clock speedup is claimed.

BEFORE:

- `ensureContentBlobObject` opened the target CAS object, called `f.Stat()`, then closed it;
- `retainOwnedContentBlobTx` used the same payload-handle pattern;
- each healthy-object validation therefore incurred **1 payload Open + 1 fstat + 1 Close** even though only object size metadata was required.

AFTER / current:

- both paths call one shared metadata-size helper;
- `ObjectStatProvider` backends perform **1 metadata Stat and 0 payload Opens**;
- stores without metadata support retain the existing `Open + Stat + Close` fallback;
- expected-size validation, CAS locking, blob state/refcount checks, quota and transaction semantics are unchanged.

Decision: **Accepted.** This removes payload-handle churn from two hot upload dedup/finalize checks without weakening content validation.

Regression budget: ObjectStatProvider paths must remain **0 payload Opens** for metadata-only healthy-object size checks; fallback Store behavior must remain supported.

Next action: continue download/sync/delete basic-path performance and only change another deterministic request, SQL, allocation, or I/O multiplier.

### Archive prepare subtree SQL contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- one selected top-level folder directly under the user root;
- **120 direct child folders**, each containing **1 file**;
- total manifest entries: **241** including the selected root;
- evidence is deterministic SQL cardinality for subtree enumeration; no wall-clock speedup is claimed.

BEFORE:

- archive manifest DFS calls one `Find(children)` for the selected root and one for each of its 120 child folders;
- that is **121 child-list SQL queries**, with additional `Preload("File")` queries emitted by GORM;
- file bytes are not read during this phase, but request latency and DB work scale with directory count.

AFTER / current:

- **1 recursive CTE** returns all descendants for the selected root and LEFT JOINs current file metadata in the same statement;
- children remain ordered by `lower(name), id` within each parent before the existing DFS builds archive paths;
- cycle detection and the 200,000-entry cap remain enforced;
- each file still goes through the existing stored-object open/stat validation;
- ZIP creation still streams each stored object with `io.Copy`; the data plane is intentionally unchanged.

Decision: **Accepted.** This removes directory-count-scaled manifest SQL without changing archive contents or download streaming semantics.

Regression budget: each selected top-level directory root may use at most **1 recursive subtree SQL statement** regardless of descendant directory count; no reintroduction of per-directory child queries.

Next action: archive prepare payload-handle amplification is handled by the metadata-stat contract below; continue basic download/sync/delete audits after that.

### Archive prepare local metadata-stat contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- production `storage.Local` backend;
- archive manifest containing **1,000 files** whose metadata sizes already exist in `xd_files`;
- prepare still verifies every stored object exists and has the expected size before the ZIP data plane starts;
- evidence method: deterministic provider fast-path test plus Local storage metadata test; wall-clock timing is intentionally not quoted.

BEFORE:

- each file validation calls `Store.Open`, then `File.Stat`, then `File.Close`;
- 1,000-file prepare therefore performs **1,000 payload-handle opens + 1,000 stats + 1,000 closes**;
- ZIP streaming later opens each of the same 1,000 payload objects again to copy bytes.

AFTER / current:

- `storage.ObjectStatProvider` exposes metadata-only object inspection without changing the base `Store` interface;
- production `storage.Local` implements it with one resolved-path `os.Stat`;
- 1,000-file prepare performs **0 payload-handle opens + 1,000 stats + 0 payload-handle closes**;
- actual ZIP streaming remains **1,000 payload opens** and still verifies the bytes written equal the prepared size;
- backends that do not implement metadata stat keep the old `Open -> Stat -> Close` validation fallback.

Decision: **Accepted.** This removes file-count-scaled payload-handle churn from archive preparation while preserving pre-stream existence/size validation and the existing ZIP data plane.

Regression budget: on `storage.Local`, archive prepare must perform **zero payload opens for stored-object metadata validation**. Do not remove the existence/size check, and do not change the fallback contract for backends without `ObjectStatProvider`.

Next action: archive ZIP progress bookkeeping is handled by the coalescing contract below; then continue sync/delete, prioritizing deterministic repeated I/O or unbounded response work.

### Archive download progress coalescing contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Archive ZIP data plane with progress tracking enabled;
- deterministic fast-transfer workload: **8 MiB** payload read in **64 KiB** chunks = **128 data reads**;
- test freezes the progress clock so all 128 reads occur inside one reporting interval;
- a second deterministic test advances the clock by exactly **100 ms** to lock periodic reporting and explicit terminal flush behavior;
- no wall-clock speedup is claimed.

BEFORE:

- `archiveProgressReader` invokes `onRead` for every successful underlying read;
- each callback reaches `updateArchiveDownloadProgress`, locks the Server-wide `archiveProgressMu`, updates the file state and calls `time.Now()`;
- the 8 MiB / 64 KiB workload therefore performs **128 progress-state callbacks / mutex updates**.

AFTER / current:

- read bytes accumulate locally in the per-file progress reader;
- progress state is published at most once every **100 ms** while the file is transferring;
- EOF/read errors flush pending bytes inside the reader, and the ZIP data plane explicitly flushes again after `io.Copy` returns so writer-side termination cannot strand pending progress;
- the frozen-clock 128-read workload performs **1 progress-state callback**, with the reported delta exactly equal to **8 MiB**;
- slow transfers still emit periodic progress at roughly **10 Hz**;
- ZIP entry creation, Store.Open, io.Copy, byte validation and final completed-size assignment are unchanged.

Decision: **Accepted.** This removes read-count-scaled global progress-lock traffic from fast archive downloads without changing payload streaming or final byte accounting.

Regression budget: archive byte progress must not call the global progress updater once per fast payload read. Periodic updates remain <= about 10 Hz per active file, and pending bytes must flush on EOF/read error or the explicit post-`io.Copy` terminal flush before the terminal file state is recorded.

Next action: selected-root ancestor filtering is handled by the constant-query contract below; then continue the basic delete/sync audit.

### Archive selected-root ancestor coverage contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- **120 selected files**;
- every file lives under its own **8-directory-deep** branch beneath one shared owner root;
- no selected file is nested under another selected item in the baseline workload;
- evidence is deterministic SQL cardinality from the real selected-root coverage helper;
- no wall-clock speedup is claimed.

BEFORE:

- `archiveNodeHasSelectedAncestor` walks each selected item's parent chain in Go;
- a request-local parent cache avoids reloading the shared root, but the 8 branch directories are unique per selected item;
- first selected file performs **9 parent SELECTs** (8 branch directories + root);
- the remaining 119 files perform **8 unique parent SELECTs** each;
- total ancestor-filter SQL on the fixture is **9 + 119×8 = 961 SELECT statements**.

AFTER / current:

- one owner-scoped recursive CTE seeds all selected IDs and walks their active parent chains together;
- one grouped result reports whether each origin encounters another selected ancestor;
- the same statement detects cycles and a missing/deleted/foreign parent chain;
- the 120-item fixture performs **1 SQL statement**;
- nested selections still suppress the descendant archive root;
- cycles still return `errArchiveInvalidStoredEntry`;
- missing/inactive parent chains still return `gorm.ErrRecordNotFound`.

Decision: **Accepted.** This removes selected-items × depth database round trips from multi-root archive preparation without changing root de-duplication or consistency validation.

Regression budget: archive selected-root ancestor filtering must remain **1 SQL statement per prepare request**, independent of selected-root count/depth up to the existing 1,000-root limit. Do not weaken cycle or missing-parent validation.

Next action: continue the basic delete/sync performance audit and only change another deterministic request, SQL, allocation, filesystem, lock, or object-store multiplier.

## Measured baselines and accepted/rejected changes

Only measurements produced from a stable, repeatable workload belong in this table. Complexity-only improvements without an equivalent BEFORE/AFTER timing are documented separately and must not be presented as measured speedups.

| Workload | BEFORE | AFTER / Current | Result |
| --- | ---: | ---: | --- |
| VirtualCollection CPU, 100k logical items / 2,500 viewport updates | n/a | CI CPU medians **126.877 / 160.081 / 161.319 ms/sweep**; **50.751 / 64.032 / 64.528 us/viewport**; peak retained 800; final retained 600 | **No production optimization**: timing varies ~27% across hosted runners, but worst observed controller CPU remains <0.1 ms/viewport and structural bounds are stable |
| Non-empty sparse range SQL | 2 SQL round-trips | 1 SQL round-trip | **-50% DB round-trips** |
| Search VirtualCollection metadata, 10k logical results | 10,000 retained items | 1,000 retained items | **-90% retained metadata** |
| Search 100k, range offset 0 | 1.586692183 s | 451.180732 ms | **-71.6% / 3.52x faster** |
| Search 100k, range offset 50k | 1.647826274 s | 674.156893 ms | **-59.1% / 2.44x faster** |
| Search 100k, cursor first page | 977.251868 ms | 411.109089 ms | **-57.9% / 2.38x faster** |
| Search 100k, cursor around item 50k | 2.168573513 s | 382.454648 ms | **-82.4% / 5.67x faster** |
| Directory 100k simple name-only fixture, first/middle | n/a | 73.981118 ms / 92.281482 ms | Healthy baseline; no production optimization |
| Directory-sort 100k current contract, name first-counted / middle-count-free | n/a | **118.088387 ms / 161.423072 ms** | #756 current-contract baseline |
| Directory-sort 100k current contract, updated first-counted / middle-count-free | n/a | **112.731281 ms / 88.349891 ms** | #756 current-contract baseline |
| Directory-sort 100k current contract, size first-counted / middle-count-free | n/a | **113.027136 ms / 130.228185 ms** | #756 current-contract baseline |
| Directory-sort 100k current contract, type first-counted / middle-count-free | n/a | **209.882056 ms / 294.770849 ms** | Slowest current directory sort baseline |
| Desktop warm-thumbnail transport, 200 unique x 64 KiB x 3 passes | **600 upstream GETs / 39,321,600 B** | **200 upstream GETs / 13,107,200 B** | **Accepted**: **-66.7% requests**, **-66.7% payload**, **25 MiB less upstream payload**; hosted httptest wall time is diagnostic only and is not compared across layers |

### Historical rejected measured attempt: type expression index (pre-#750)

A candidate type-sort expression index was evaluated on the exact same 100k mixed-file workload before adding any production index:

- index build on 100k nodes: **120.588962 ms**
- type first range: **273.676411 ms -> 274.482786 ms** (**0.3% slower**)
- type middle range: **422.931606 ms -> 420.332119 ms** (**0.6% faster**)

This is noise-level improvement with permanent write/storage maintenance cost, so the index was **rejected** and is not part of the production schema.

That result predates the #750 count-once contract: the old middle-range workload still recomputed `COUNT(*) OVER()`. The current benchmark-only follow-up does **not** erase this rejection. It explicitly retests the same expression index only because later viewport ranges now run with `include_count=false`, which can materially change the PostgreSQL plan. It also measures a persisted extension sort-key + matching index candidate. Until the paired data is written here, both candidates remain **Benchmarking**, not production recommendations.

### Directory type-sort count-free A/B

Status: **Measured / expression-index production candidate accepted; persisted-key rejected**.

Workload:

- PostgreSQL 17, isolated schema;
- **100,000** mixed file nodes with four extensions (`.txt/.jpg/.pdf/.zip`);
- page size **200**;
- first range at offset 0 remains authoritative-counted;
- middle range at offset 50,000 uses the production `include_count=false` path;
- **3 measured samples** after warm-up;
- exact ordered node IDs matched across every candidate;
- benchmark test duration: **18.29 s**.

Current #750-contract HTTP baselines:

| Sort | First range, counted | Middle range, count-free |
| --- | ---: | ---: |
| name | **118.088387 ms** | **161.423072 ms** |
| updated | **112.731281 ms** | **88.349891 ms** |
| size | **113.027136 ms** | **130.228185 ms** |
| type | **209.882056 ms** | **294.770849 ms** |

The paired DB-level type-sort A/B kept the query shape and ordered node IDs fixed:

| Variant | First counted | Delta vs current | Middle count-free | Delta vs current |
| --- | ---: | ---: | ---: | ---: |
| Current dynamic expression | **211.511509 ms** | baseline | **300.789263 ms** | baseline |
| Exact expression index | **208.566369 ms** | **-1.39%** | **126.173709 ms** | **-58.05%** |
| Persisted extension key + index | **122.501282 ms** | **-42.08%** | **192.687067 ms** | **-35.94%** |

Candidate setup cost on the same 100k fixture:

- expression-index build: **335.346016 ms**;
- persisted-key backfill: **2.831021167 s**;
- persisted-key index build: **147.718034 ms**.

Decision:

- **Accept the exact expression index as the production candidate.** The old pre-#750 rejection no longer applies to the dominant later-range path: once `COUNT(*) OVER()` is removed from subsequent viewport ranges, the same index produces a paired **58.05%** middle-range reduction while leaving the once-per-generation counted first range effectively unchanged.
- **Reject the persisted-key candidate for now.** Although it improves the counted first range more, it is slower than the expression index on the repeated count-free middle-range path, requires a multi-second 100k-row backfill in this fixture, adds persistent column/storage cost, and must be maintained on every name-changing create/rename/keep-both path.
- #756 remains benchmark-only: it does **not** add a production schema/index or change the Server query.

Production follow-up status: **Accepted / production validated (#759)**.

The production change installs only the accepted exact expression index as `idx_xd_nodes_children_type` through the normal Server `migrate()` path. It does not add a persisted sort-key column, alter the `sort=type` wire contract, or change the SQL sort expression. Migration coverage verifies that the partial expression index exists and that repeated Server migrations remain idempotent.

The unchanged #756 100k workload rerun on the #759 production branch measured:

| Production validation | Dynamic expression | Exact expression index | Paired reduction |
| --- | ---: | ---: | ---: |
| First range, counted | **212.643712 ms** | **210.804146 ms** | **-0.87%** |
| Middle range, count-free | **299.467459 ms** | **127.996139 ms** | **-57.26%** |

The same run measured expression-index build at **223.486145 ms**. The rejected persisted-key candidate measured **197.439026 ms** on the middle count-free range (**-34.07%**) and required **2.897457423 s** of backfill plus **148.027849 ms** index build, so it remains inferior for the repeated viewport path and materially more invasive.

Decision: **ship the expression index and keep the persisted-key design rejected.** #759 is the production realization of #756's measured candidate, not a new query contract.

### VirtualCollection 100k CPU baseline (PR #708)

Deterministic workload shape:

- logical items: **100,000**
- viewport size: **40**
- virtual page size: **200**
- viewport updates per full sweep: **2,500**
- page loads per full sweep: **500**
- peak retained logical items: **800**
- final retained logical items: **600**

#### Rejected short wall-clock timing method

The first implementation timed one ~100-150 ms sweep with `process.hrtime.bigint()`. Three hosted-runner CI executions produced medians of **122.270 ms**, **112.468 ms**, and **156.711 ms**. The min-to-max spread is about **39%**, even though all structural counts were identical.

That method is therefore **rejected as a regression baseline**. These values remain documented as evidence of runner noise and must not be quoted as a stable FileExplorer speed.

#### Revised CPU methodology

The benchmark now:

- measures `process.cpuUsage()` as the primary metric instead of scheduler-sensitive wall time;
- runs **10 complete 100k sweeps per sample**;
- records **5 samples** after warm-up;
- reports CPU milliseconds per sweep and CPU microseconds per viewport update;
- still reports wall time per sweep as diagnostic-only data;
- runs Node with `--expose-gc` and performs a GC opportunity before each sample.

Three GitHub CI runs of the revised method measured:

- run A: **160.081 ms CPU / sweep**, **64.032 us CPU / viewport**, **159.759 ms** diagnostic wall / sweep;
- run B: **161.319 ms CPU / sweep**, **64.528 us CPU / viewport**, **160.951 ms** diagnostic wall / sweep;
- validation run C: **126.877 ms CPU / sweep**, **50.751 us CPU / viewport**, **126.569 ms** diagnostic wall / sweep.

The CPU medians still vary by about **27%** across hosted runners, so timing remains **diagnostic rather than a narrow CI regression gate**. Structural counts, however, stayed exactly **500 page loads / 800 peak retained / 600 final retained** in every run.

Decision for PR #708: **accept the structural baseline and do not optimize VirtualCollection further now**. Even the slowest observed run is only **64.528 us CPU per viewport update**; the current 100k media-directory gap is renderer/thumbnail/transport behavior, not this state engine.

This is a controller/VirtualCollection CPU and retained-metadata baseline only. It does **not** include React commit/layout/paint, thumbnail HTTP/Agent IPC, image/video decode, Blob creation, or thumbnail generation. Do not use this benchmark as the result for media-heavy directories.

### Existing optimizations without comparable wall-clock BEFORE/AFTER

Thumbnail queue/cache changes, Desktop binary thumbnail transport, adaptive prefetch, indexed typed-path lookup, indexed folder-upload conflict lookup, navigation-tree pagination, and several controller/projection refactors have correctness/complexity/resource regression coverage but do **not** have an equivalent wall-clock BEFORE/AFTER workload. Do not quote a timing speedup for these changes until a stable benchmark exists.

### Desktop folder-download paged scan

Status: **Accepted / structural; wall-clock unmeasured**.

Workload and method:

- deterministic Agent fixture with **1,201 sibling nodes** under one directory;
- cursor page limit: **500**;
- recursive tree enumeration is the current paged path; #788 also applied the same paging to selected-root lookup before the exact lookup follow-up below;
- sample count: not applicable to timing because this is a deterministic structural contract, not a wall-clock benchmark;
- command: `go test ./cmd/xdrive-agent -run '^TestScanAgentCloudDownloadFolderPagesWideDirectories$' -count=1`.

BEFORE #788:

- Desktop folder download used `Client.List` for each recursively visited directory;
- the legacy children endpoint materialized and serialized the full sibling set in one response;
- on the 1,201-sibling fixture this meant **1 request carrying 1,201 nodes**.

AT #788 / current recursive-scan contract:

- recursive enumeration uses `Client.ListPage` with a **500-node** cursor page and a repeated/missing-cursor guard;
- the 1,201-sibling fixture uses **3 requests**, with at most **500 nodes in any one response**;
- maximum per-response node cardinality in that fixture is **1,201 -> 500 (-58.4%)**;
- total manifest metadata remains **O(total files)**, so this change does **not** claim bounded total Agent memory or a wall-clock speedup;
- #788's paged selected-root lookup is superseded by the exact lookup below.

Decision: **keep** bounded paging for recursive enumeration. It removes unbounded Server query/JSON/transport response size at the cost of additional bounded requests.

Regression budget: recursive folder-download scans may not fall back to legacy unpaginated `Client.List`; each children page stays at **<=500 nodes**.

### Desktop folder-download exact root lookup

Status: **Accepted / structural; wall-clock unmeasured**.

Workload and method:

- same logical **1,201-sibling** selected-folder scenario used to validate #788 root lookup;
- the requested folder ID is already known by FileExplorer;
- sample count: not applicable to timing because request/node counts are deterministic;
- command: `go test ./cmd/xdrive-agent -run '^TestResolveAgentCloudDownloadFolderRootUsesExactNodeLookup$' -count=1`.

BEFORE:

- #788 located the known folder ID by paging its parent with `Client.ListPage(limit=500)`;
- a target positioned after 1,200 siblings required **3 requests** and returned **1,201 node records** before the match was found.

AFTER / current:

- Server exposes authenticated `GET /api/v1/nodes/:id` backed by the owner-scoped active-node lookup;
- Go client exposes `Node(ctx, id)`;
- Agent performs **1 exact request** returning **1 node**, then validates the expected parent, directory type, and safe name before scanning descendants;
- on the deterministic workload, request count is **3 -> 1 (-66.7%)** and returned node metadata is **1,201 -> 1 (-99.9%)**;
- the basic lifecycle integration locks owner isolation, active-only visibility through Trash, and visibility again after Restore.

No wall-clock speedup is claimed; the accepted evidence is the deterministic removal of sibling-page work.

Decision: **accept** exact root lookup and keep 500-node pagination only for recursive children enumeration.

Regression budget: selected-root resolution must not call `List` or `ListPage`; the exact route remains authenticated, owner-scoped, and active-node-only.

Next action: group-progress CPU amplification is handled by the incremental contract below. If very large folder downloads still show Agent memory pressure after that, benchmark manifest retention and child-transfer creation separately before considering a streaming manifest design.

### Desktop folder-download incremental group-progress contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Desktop Agent folder download with a fully scanned manifest of **10,000 files**;
- synthetic progress shape: **4 progress publications per file** while transfers remain sequential, matching the existing one-file-at-a-time download contract;
- evidence method: deterministic source-level aggregation cardinality plus `TestAgentCloudFolderDownloadByteProgressIsIncremental`;
- no wall-clock speedup is claimed.

BEFORE:

- group byte progress is derived by scanning `childDone[]` and `childTotals[]` on every publication;
- each publication performs **10,000 done-slot reads + 10,000 total-slot reads** for the 10,000-file workload;
- 40,000 progress publications therefore imply **400,000,000 done-slot + 400,000,000 total-slot inspections** in the aggregation layer;
- the Agent also retains two additional `int64` arrays sized to the full file manifest.

AFTER / current:

- the Agent initializes aggregate `bytesTotal` once from the manifest and updates aggregate done/total by the current file's delta;
- each progress publication performs **O(1)** byte-accounting work independent of manifest file count;
- content-length corrections adjust the aggregate total by delta, matching the previous per-child-array semantics;
- successful completion fills any final current-file byte delta; failed files retain their already-transferred byte contribution;
- the two manifest-sized byte-progress arrays are removed; child transfer handles and the manifest itself remain unchanged.

Decision: **Accepted.** This removes file-count-scaled CPU from Transfer Center group progress without changing download order, HTTP streaming, fsync/rename behavior, per-file child tasks, cancellation, partial-success accounting, or failure handling.

Regression budget: folder-download group byte aggregation must remain **O(1) per progress publication** and must not reintroduce a scan over all manifest files or manifest-sized done/total byte arrays.

Next action: continue basic sync/delete/download auditing and only change another deterministic request, SQL, allocation, filesystem, lock, or object-store multiplier.

### File download metadata SQL contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- one authenticated current-file download metadata lookup;
- one authenticated historical-version download metadata lookup;
- both target one active file owned by the requesting user;
- evidence method: deterministic GORM SQL trace around each metadata helper; payload streaming is outside the counted region;
- sample count: n/a for the deterministic SQL-round-trip contract.

BEFORE:

- current-file download calls `ownedNode(..., preload=true)`: one `xd_nodes` query plus one GORM `Preload("File")` query = **2 SQL statements**;
- historical-version download first owner-validates the active node, then loads `xd_file_versions` separately = **2 SQL statements**.

AFTER / current:

- current-file download selects name, revision, storage key, SHA-256 and file modtime with **1 owner-scoped `xd_nodes JOIN xd_files` statement**;
- historical-version download selects the active owner file name and requested version metadata with **1 `xd_nodes JOIN xd_file_versions` statement**;
- owner isolation, active-only visibility and file-type validation remain in SQL;
- `Store.Open`, `Content-Disposition`, current-file ETag, SHA-256 response header, `http.ServeContent`, Range/seek behavior and payload bytes are unchanged.

Decision: **Accepted.** This removes one metadata DB round trip from every ordinary file download and every historical-version download without changing the data plane.

Regression budget: each current-file or historical-version download metadata lookup must remain **1 SQL statement**, owner-scoped, active-node-only, and file-type constrained. Do not reintroduce GORM Preload or a separate ownership query on these hot paths.

Next action: continue basic sync/delete/download audits and only change paths with another deterministic SQL, request, allocation or I/O multiplier.

### Web single-download progress coalescing contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- ordinary authenticated Web file/version download using either File System Access direct-to-disk or legacy Blob streaming;
- stable structural workload: **1 GiB response**, **64 KiB readable chunks**, all chunks arriving inside one 100 ms window;
- TransferStore `progress()` persists the complete transfer history and publishes listeners, so progress-call cardinality is the deterministic multiplier;
- no network/read/write operations are removed and no wall-clock speedup is claimed.

BEFORE:

- every readable chunk called TransferStore `progress()`;
- the 1 GiB / 64 KiB workload therefore caused **16,384** progress persistence/listener publications before terminal completion.

AFTER / current:

- one per-download reporter publishes after either **8 MiB** of additional bytes or **100 ms**, whichever comes first;
- the same fast workload causes **128** progress persistence/listener publications;
- slow transfers still surface progress at about 10 Hz even below the byte threshold;
- successful completion remains an immediate exact terminal `complete()`;
- failure flushes the latest successfully transferred byte count before the immediate `fail()`;
- File System Access writes, Blob fallback buffering, response reads and transfer cancellation/error behavior are unchanged.

Regression budget: ordinary Web download progress must not call TransferStore once per readable chunk. Fast streams remain bounded by one publication per 8 MiB, slow streams by the 100 ms cadence, and terminal success/failure must retain exact final state.

Regression command:

- `node --test desktop/tests/web-download-stream.cjs`.

Next action: continue the basic sync/delete audit and only change another deterministic request, SQL, allocation, filesystem, lock, or object-store multiplier.

### Web direct-to-disk download sink

Status: **Accepted / structural; wall-clock unmeasured**.

Problem:

- the legacy authenticated Web download path read every response chunk into a `BlobPart[]`;
- only after the complete response arrived did it create one Blob and trigger the browser download;
- application-retained payload therefore grew linearly with file/ZIP size, which is especially harmful for large FileExplorer downloads.

Current contract:

- when `showSaveFilePicker` is available, the save target is requested synchronously from the user's download action before archive preparation, auth refresh, or network I/O can consume transient user activation;
- the response reader waits for each file-system write before reading the next chunk, so xDrive itself does not retain an ever-growing chunk array;
- Transfer Center byte progress advances after every successful chunk write;
- a writer failure cancels the response reader and aborts the uncommitted destination file;
- cancelling the save picker returns a non-saved outcome before creating a transfer/task and produces neither success nor failure feedback;
- ordinary file downloads, historical-version downloads, and archive payloads reuse the same sink;
- browsers without File System Access support retain the existing Blob/object-URL fallback rather than losing download compatibility.

Deterministic behavior test:

- a pull-driven **128 x 64 KiB = 8 MiB** logical response is written in 128 ordered writes;
- maximum in-flight application writes is **1**;
- final byte progress is exactly **8 MiB**;
- no aggregate payload array exists in the direct-to-disk helper;
- cancellation, unsupported-browser fallback, close, and abort are covered separately.

This is structural memory-pressure evidence only. Browser/network internal buffering is outside xDrive's control, and no wall-clock or RSS speedup is claimed.

Regression budget: the File System Access branch must not reintroduce an application-level response chunk accumulator; it must preserve chunk progress and sequential backpressure.

### FileOperation batch ancestor coverage

Status: **Accepted / structural; wall-clock unmeasured**.

Workload and method:

- **120** selected sibling files;
- every file is under an **8-directory-deep** parent chain beneath the owner root;
- no selected item contains another selected item in the baseline case;
- the same helper also verifies the nested-selection case where a selected directory contains a selected file;
- SQL statements are counted with a GORM trace logger only around the ancestor/top-level helper call;
- sample count: not applicable to wall-clock because this is a deterministic SQL-round-trip contract;
- command: `go test ./internal/api -run '^TestBatchAncestorCoverageUsesConstantSQL$' -count=1`.

BEFORE:

- `batchSelectionHasAncestor` and `topLevelBatchDeleteRefs` walked upward independently for every selected item;
- each selected file required **10 SELECTs** on this fixture (file, 8 directories, root);
- **120 files x 10 levels = 1,200 SELECTs** per ancestor/top-level check before the FileOperation itself was queued.

AFTER / current:

- one recursive PostgreSQL CTE expands the parent chains for all selected IDs together;
- the grouped result reports whether each selected origin has another selected ancestor;
- each helper performs **1 SQL statement** on the same workload;
- selected-node ownership/active-state validation remains owner-scoped, and a selected ID absent from the active namespace still returns the existing `node_not_found` mutation failure;
- the nested-selection result and top-level delete filtering remain unchanged.

Structural delta: **1,200 -> 1 SQL statement (-99.9%)** per ancestor/top-level check on the deterministic fixture. No wall-clock speedup is claimed.

Decision: **accept** the set-based recursive CTE. It removes an items x depth SQL multiplier from FileExplorer Copy/Move/Delete enqueue without changing operation durability, cancellation, conflict, or transaction semantics.

Regression budget: ancestor/top-level coverage must remain constant-query for the selected batch; do not reintroduce renderer traversal or per-item parent SQL walks.

### FileOperation selection total-byte aggregation

Status: **Accepted / structural; wall-clock unmeasured**.

Workload and method:

- **120** selected sibling directories under one owner root;
- each selected directory contains exactly one file;
- Copy/Move already reject ancestor+descendant selections, and Delete reduces its selection to top-level roots before byte aggregation, so the roots passed into this calculation are non-overlapping;
- SQL statements are counted only around the aggregate byte helper; per-item owner/revision validation remains intentionally unchanged;
- sample count: not applicable to wall-clock because this is a deterministic SQL-round-trip contract;
- command: `go test ./internal/api -run '^TestFileOperationSelectionBytesUsesSingleRecursiveQuery$' -count=1`.

BEFORE:

- enqueue loaded and revision-validated each selected node;
- every selected directory then called `fileOperationNodeBytesTx` independently;
- the 120-directory fixture therefore issued **120 recursive size CTEs** before the durable FileOperation was queued.

AFTER / current:

- enqueue still owner/revision-validates every selected root exactly as before;
- the validated roots are passed together to one owner-scoped recursive CTE;
- the fixture issues **1 recursive selection-size CTE** and produces the same aggregate byte count;
- selected files with missing `xd_files` metadata still fail rather than being silently counted as zero;
- this does **not** claim total enqueue SQL is constant-query: per-item validation remains separate and is outside this optimization.

Structural delta: **120 -> 1 recursive size query (-99.2%)** on the deterministic fixture. No wall-clock speedup is claimed.

Decision: **accept** set-based total-byte aggregation for FileOperation enqueue. It removes the remaining selected-directories multiplier from Copy/Move/Delete task creation while leaving durable execution, progress, cancellation, retry, conflict, and revision semantics unchanged.

Regression budget: aggregate byte precomputation must not reintroduce one recursive size query per selected top-level directory.

### FileOperation delete subtree summary

Status: **Accepted / structural; wall-clock unmeasured**.

Problem and workload:

- FileOperation delete already receives non-overlapping top-level roots after enqueue validation;
- execution previously called `fileOperationNodeBytesTx` for a recursive byte sum and then `activeSubtreeIDsDB` for the exact same root;
- both helpers independently expanded the active subtree with a recursive CTE before the delete transaction could revoke shares, apply managed-source protection, and move nodes to Trash;
- the deterministic regression uses one selected directory containing **120 child directories + 120 files** (241 active nodes including the selected root).

BEFORE:

- **1 recursive CTE** for aggregate bytes;
- **1 recursive CTE** for active subtree IDs;
- total: **2 recursive subtree statements per delete root**.

AFTER / current:

- `activeSubtreeSummaryDB` expands the active subtree once;
- the same SQL statement returns ordered node IDs plus the aggregate file bytes;
- execution reuses those IDs for managed-source protection, share revocation, and Trash updates, and reuses the byte total for FileOperation progress;
- a directly selected file with missing `xd_files` metadata still fails instead of silently reporting zero bytes;
- owner/revision locking, Trash root assignment, undo metadata, cancellation and transaction boundaries are unchanged.

Structural delta: **2 -> 1 recursive subtree SQL statements (-50%) per delete root**. The transaction still performs its ordinary lock/update/audit/progress SQL, so this is not a claim that total delete SQL or wall-clock time is halved.

Regression command:

- `go test ./internal/api -run '^TestActiveSubtreeSummaryUsesSingleRecursiveQuery$' -count=1`.

Decision: **accept** the combined subtree summary. It removes a redundant full-tree traversal from a core FileExplorer delete path without changing delete semantics.

Regression budget: FileOperation delete must not separately call both recursive byte aggregation and recursive subtree-ID enumeration for the same selected root.

### FileOperation delete multi-root subtree aggregation

Status: **Accepted / structural; wall-clock unmeasured**.

Problem and workload:

- Delete enqueue already reduces the selection to non-overlapping top-level roots;
- execution still called the single-root subtree summary independently for every selected root;
- stable fixture: **120 selected sibling directories**, each containing **1 file**;
- evidence is deterministic SQL statement count around subtree-summary loading only; per-root mutation SQL is intentionally outside this optimization.

BEFORE:

- each delete root executes one recursive subtree CTE for IDs + bytes;
- the 120-root fixture therefore performs **120 recursive subtree SQL statements** before the worker can run per-root protection and Trash updates.

AFTER / current:

- `activeSubtreeSummariesDB` seeds all selected root IDs together and carries `root_id` through one recursive CTE;
- one grouped stats stage returns the byte total for each root while the same result set returns that root's ordered active node IDs;
- the 120-root fixture performs **1 recursive subtree SQL statement** and returns 120 independent summaries;
- `activeSubtreeSummaryDB` delegates to the grouped helper, so the existing single-root **2 -> 1** contract remains intact;
- the Delete worker still processes roots in original request order and keeps managed-source protection, share revocation, Trash root assignment, root revision validation, undo capture, cancellation checkpoints, and progress semantics unchanged.

Structural delta: **120 -> 1 recursive subtree CTE (-99.2%)** on the deterministic multi-root fixture. No wall-clock speedup is claimed.

Regression command:

- `go test ./internal/api -run '^TestActiveSubtreeSummaryUsesSingleRecursiveQuery$' -count=1`.

Decision: **accept** grouped multi-root subtree loading. It removes the remaining selected-root multiplier from Delete's recursive read phase without batching or weakening the mutation semantics.

Regression budget: one FileOperation Delete execution may use at most **1 grouped recursive subtree summary query** for its already top-level selected roots.

### FileOperation delete managed-target preload

Status: **Accepted / structural; wall-clock unmeasured**.

Problem and workload:

- Delete already has each selected root's active subtree IDs in memory;
- managed Yike target protection still called `yikeManagedTargetInIDsDB` once per root;
- each call probes whether the optional `xd_sources` table exists and then queries Sources for that root's subtree IDs;
- stable workload: **120 top-level delete roots**.

BEFORE:

- 120 optional-schema probes;
- 120 managed-target Source queries;
- total protection-read work: **240 SQL statements** before considering the normal per-root mutation statements.

AFTER / current:

- `loadYikeManagedTargetIDsDB` performs one optional-Sources schema probe;
- when Sources exists, one owner/kind query loads all non-null Yike `target_node_id` values into a set;
- each root checks its already-materialized subtree IDs against that set in memory;
- the 120-root protection-read workload performs **2 SQL statements** total;
- core-only schemas without `xd_sources` still return an empty protected set after the single schema probe;
- the Delete loop remains in original request order, so the first protected root still returns `managed_source_target` before that root's share/Trash/revision mutations;
- share revocation, Trash assignment, root revision validation, undo capture, cancellation checkpoints and progress are unchanged.

Structural delta: **240 -> 2 managed-target protection SQL statements (-99.2%)** for the 120-root workload. No wall-clock speedup is claimed.

Regression commands:

- `go test ./internal/api -run '^TestDelete(ManagedTargetProtectionLoadsOwnerTargetsOnce|ExecutorUsesSelectionWideManagedTargetLoad)$' -count=1`.

Decision: **accept** selection-wide managed-target preload for Delete. It removes the remaining root-count query multiplier from the protection read without batching delete mutations.

Regression budget: Delete managed-target protection may perform at most **one optional-schema probe + one owner target load per execution**, independent of selected-root count.

### FileOperation Move root-byte aggregation

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- **120 selected sibling directories**, each containing one file;
- FileOperation Move executes all 120 roots into another directory;
- evidence method: PostgreSQL SQL capture during real `processNextFileOperation()` plus final Move state assertions;
- no wall-clock benchmark is quoted.

BEFORE:

- each Move root was loaded with `batchLoadNodeTx(..., preload=true)`, preloading `xd_files` even though root file metadata is not needed to move a node;
- each selected directory later called `fileOperationNodeBytesTx` independently for progress accounting;
- on the 120-directory fixture, execution therefore issued **120 recursive root-byte CTEs**.

AFTER / current:

- Move root nodes use `batchLoadNodeTx(..., preload=false)`;
- logical bytes for all selected roots are computed lazily by one grouped recursive CTE and cached by root ID for the transaction;
- the 120-directory fixture changes execution-time root-byte recursion from **120 CTEs -> 1 grouped CTE**;
- selected file roots preserve the previous missing-`xd_files` failure behavior through an explicit `missing_file` result flag;
- normal Move, skip, keep-both, and replace/merge paths reuse the same root-byte value;
- Copy and Delete execution are intentionally unchanged.

Decision: **Accepted.** Move is metadata-only at the root level, so removing root File preloads and N recursive byte scans reduces DB work without changing content I/O, revision checks, conflict policies, undo behavior, or progress totals.

Regression budget: one Move operation may execute at most **one** grouped root-byte recursive CTE regardless of selected-root count, and root loading must not restore per-root File preloads.

Next action: continue the FileExplorer upload preflight batching audit; preserve ordered conflict/partial-success semantics while reducing request and DB-query count.


### FileOperation Move replace/merge File-preload contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- one Move replace/merge root directory;
- **120 matching source/target child directories** below that root;
- every source child directory contains **1 file** with valid `xd_files` metadata;
- evidence method: PostgreSQL SQL capture around the real `moveNodeReplaceOrMergeTx` traversal plus final merged-tree assertions;
- wall-clock timing is intentionally not quoted.

BEFORE:

- every successful destination-name conflict lookup used `Preload("File")`, although replace/merge only consumes target node identity/type/revision; for the merge root plus 120 matching child directories this produces **121 `xd_files` SELECTs**;
- every source-directory child enumeration in Move also used `Preload("File")`, although Move changes node metadata and does not consume child file metadata; the same root + 120 child directories produces another **121 `xd_files` SELECTs**;
- total unused File preload statements for the stable workload: **242**.

AFTER / current:

- destination conflict lookup is node-only;
- Move replace/merge source-child enumeration is node-only;
- the stable workload performs **0 `xd_files` SELECTs** during the Move merge traversal;
- conflict lookup, source child-list queries, target managed-source protection, per-node revision checks, move updates, merge cleanup and operation ordering are unchanged;
- Copy's recursive source-child preload remains intact because Copy hooks/content-reference creation consume source `File` metadata.

Decision: **Accepted.** This removes directory-count-scaled File metadata reads from Move replace/merge without changing the mutation side of the operation.

Regression budget: Move replace/merge must perform **0 `xd_files` SELECTs** for traversal metadata. Do not remove Copy source File loading unless a separate Copy contract proves that metadata is unnecessary.

Regression command:

- `go test ./internal/api -run '^TestFileOperationMoveMergeAvoidsFilePreloads$' -count=1`.

Next action: continue ordinary download / sync / delete audits and only change another deterministic SQL, request, allocation, filesystem, lock, or object-store multiplier.

### FileOperation Copy source-subtree loading

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- one copied source directory with **120 direct child directories**;
- each child directory contains **1 file**;
- active source subtree size: **241 nodes** including the copied root;
- evidence method: PostgreSQL SQL trace around the real `copyNodeTxWithHooks` execution plus copied-subtree assertions;
- no wall-clock benchmark is quoted.

BEFORE:

- the copied root calls `Find(children)` plus GORM `Preload("File")`;
- each of the 120 child directories repeats the same pair of source reads;
- source-tree enumeration therefore emits **121 node-list SELECTs + 121 file-preload SELECTs = 242 SELECT statements** before considering destination writes/content-reference bookkeeping.

AFTER / current:

- the first directory in a normal copy loads all active descendants with **1 owner-scoped recursive CTE**;
- the same statement LEFT JOINs current `xd_files` metadata needed by file-copy hooks and content-reference retain;
- recursive creation consumes an in-memory `parent_id -> children` map in the same `type ASC, name ASC` sibling order;
- healthy file descendants no longer issue fallback metadata SELECTs;
- destination node/file INSERTs, CAS retain/advisory locking, hooks/progress, undo capture, revision behavior and transaction boundaries are unchanged;
- replace/merge conflict traversal remains dynamic per directory because it must observe target-side state at each level.

Decision: **Accepted.** This removes directory-count-scaled source reads from ordinary recursive Copy without batching or reordering the mutation/data-integrity side of the operation.

Regression budget: one ordinary copied directory root may issue at most **1 source-subtree recursive CTE**, regardless of descendant directory count. Do not reintroduce per-directory `Preload("File")` source enumeration.

Regression command:

- `go test ./internal/api -run '^TestFileOperationCopyLoadsSourceSubtreeOnce$' -count=1`.

Next action: continue the basic sync/delete performance audit; only change paths with another deterministic request, SQL, allocation, or I/O multiplier.

### FileOperation Copy replace/merge source-snapshot contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- one Copy operation using the replace policy;
- source root directory with **120 direct child directories**, each containing **1 file** with valid File metadata;
- destination already contains the matching root directory and all **120 matching child directories**, so Copy follows the recursive merge path;
- evidence method: PostgreSQL SQL capture around the real `copyNodeReplaceOrMergeTx` traversal plus copied-file assertions;
- wall-clock timing is intentionally not quoted.

BEFORE:

- every source directory in the merge path independently loaded active children with one node-list query plus one `Preload("File")` query;
- the merge root plus 120 matching child directories therefore emitted **121 node-list SELECTs + 121 File preload SELECTs = 242 source-enumeration SELECTs**;
- target-side exact-name conflict checks were dynamic per level and remain necessary because the destination tree is mutated during merge.

AFTER / current:

- the first source-directory enumeration lazily loads the complete source subtree with the already accepted `loadFileOperationCopySubtree` recursive CTE and File metadata join;
- recursive merge levels reuse the resulting `parent_id -> children` map;
- when a destination conflict disappears or a non-directory target is replaced, `copyNodeTxWithHooksLoaded` consumes the same source snapshot instead of issuing another source-tree load;
- the stable workload changes recursive source enumeration from **242 SELECTs -> 1 recursive source-subtree CTE**;
- destination conflict lookup, managed-source protection, target replacement/trash, copy hooks/progress, content-reference retain, destination inserts and recursion order remain unchanged;
- the source snapshot is loaded lazily only after the same target conflict/protection/hook gates that previously preceded source child enumeration.

Decision: **Accepted.** Source traversal is read-only and already has a one-CTE representation used by ordinary Copy; reusing it in replace/merge removes directory-count-scaled source reads without precomputing the mutable target side.

Regression budget: one Copy replace/merge root may issue at most **1 source-subtree recursive CTE**, regardless of descendant directory count. Target conflict/protection queries must remain live and must not be replaced by a stale target snapshot.

Regression command:

- `go test ./internal/api -run '^TestFileOperationCopyMergeLoadsSourceSubtreeOnce$' -count=1`.

Next action: continue ordinary download / sync / delete audits and only change another deterministic SQL, request, allocation, filesystem, lock, or object-store multiplier.

### FileOperation subtree predicate materialization

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- one selected source directory containing **1,200 active child directories** (**1,201 active nodes including the source root**);
- Copy/Move target-descendant validation tests one direct descendant and one directory outside the source subtree;
- managed-source protection binds one Yike Source target to the last descendant;
- evidence method: SQL-shape regression plus deterministic behavior coverage; no timing comparison is quoted;
- regression command: `go test ./internal/api -run '^TestFileOperationSubtreePredicatesAvoidIDMaterialization$' -count=1`.

BEFORE:

- `batchTargetInsideNode` expanded the entire active source subtree with `activeSubtreeIDsDB`, returned all **1,201 IDs** through the PostgreSQL driver into a Go slice, then linearly searched for one target ID;
- `yikeManagedTargetInSubtreeDB` performed the same **1,201-ID** materialization and then issued a second Source query with those IDs as an `IN (...)` list;
- work scaled with source-subtree size even when the target directory was only one level below the source or completely outside it.

AFTER / current:

- target-descendant validation starts from the already validated target directory, recursively walks only its active ancestor chain, and returns one scalar PostgreSQL `EXISTS` value;
- on the 1,201-node fixture the DB/Go result shape changes from **1,201 node IDs -> 1 boolean**;
- managed-source protection performs one recursive subtree CTE joined directly to `xd_sources` and returns one scalar `EXISTS`; there is no intermediate Go ID slice and no subtree-sized `IN` parameter list;
- the optional-Sources-table behavior remains unchanged: core-only schemas still return “not protected” without requiring Source tables;
- Delete intentionally keeps its subtree ID summary because those IDs are consumed by share-revocation and Trash updates.

Decision: **Accepted.** This removes avoidable subtree-sized DB/Go materialization from Copy/Move validation without changing mutation, revision, conflict, Source-protection, or cancellation semantics.

Regression budget: Copy/Move target-descendant checks must not return the full source subtree to Go; managed-source subtree checks must not construct a Go subtree-ID slice or subtree-sized SQL `IN` list.

Next action: selection-wide target-descendant validation is covered by the dedicated contract below; continue managed-target/progress mutation audits separately.

### FileOperation target-descendant selection batching

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- one durable Copy/Move operation with **120 selected sibling source directories**;
- all selected sources share one target directory outside their subtrees;
- deterministic SQL capture compares the legacy per-root `batchTargetInsideNode` loop with the selection-wide helper;
- positive behavior also places the target under selected root #74 and verifies only that root is matched.

BEFORE:

- every selected directory independently executes the same recursive CTE starting from the same target directory;
- each CTE walks the target's active ancestor chain and tests one source ID;
- **120 selected directories -> 120 recursive target-ancestor CTEs**.

AFTER / current:

- Copy/Move compute the target ancestor chain once after selected-root validation;
- one query returns only selected directory IDs that occur in that ancestor chain;
- **120 selected directories -> 1 recursive target-ancestor CTE**;
- files are excluded from the candidate set;
- the existing per-item Copy/Move loops still raise `invalid_target` at the original request index, so user-visible error ordering is unchanged;
- Move keeps its explicit `node.ID == parentID` self-target error before the descendant membership check;
- recursive Copy/Move work, managed-source protection, conflict handling, progress, undo, revision and cancellation behavior are unchanged.

Decision: **Accepted.** The target directory is common to the whole operation, so rebuilding its ancestor chain once per selected source adds no correctness value.

Regression budget: durable Copy/Move may execute at most **1 recursive target-ancestor CTE** per non-empty operation regardless of selected directory count up to the existing 200-item limit. Production execution must not call `batchTargetInsideNode` per selected root.

Regression commands:

- `go test ./internal/api -run '^TestFileOperation(SubtreePredicatesAvoidIDMaterialization|ExecutionBatchesTargetDescendantChecks)$' -count=1`.

Next action: continue ordinary sync/delete/download performance; keep managed-target batching and progress-write coalescing as separate changes because they have different correctness/cancellation constraints.

### Desktop warm-thumbnail transport and Agent cache

Status: **Accepted / measured**.

This benchmark isolates the Server -> Go client transport that xdrive-agent uses for Desktop thumbnails; it does not measure Electron IPC, Blob creation, React commit/layout/paint, or browser decode.

Stable workload:

- unique thumbnails: **200**
- thumbnail payload: **64 KiB** each
- sequential passes: **3**
- total logical thumbnail views: **600**
- this deliberately exceeds the renderer's **96-entry** FileExplorer thumbnail LRU so a sequential revisit cannot remain entirely renderer-resident
- Server responses include a stable ETag and `Cache-Control: private, max-age=3600`

Command:

`XD_FILEEXPLORER_THUMBNAIL_TRANSPORT_PERF=1 go test -run '^TestFileExplorerDesktopThumbnailWarmTransportBaseline$' -count=1 -v ./internal/client`


Measured evidence:

- BEFORE baseline, branch-scoped GitHub CI:
  - upstream/full GET requests: **600**
  - conditional `If-None-Match` requests: **0**
  - response payload: **39,321,600 bytes (37.5 MiB)**
  - diagnostic wall time: **162.373 ms** in the original baseline run; a later paired CI run measured **82.651 ms**
- AFTER Agent-cache run from PR #720 authoritative CI:
  - upstream requests: **200**
  - upstream payload: **13,107,200 bytes (12.5 MiB)**
  - unique thumbnails: **200**
  - passes: **3**
  - thumbnail payload: **64 KiB**
  - diagnostic cache-layer wall time: **0.158 ms**
- structural delta:
  - upstream requests: **600 -> 200**, **-66.7% / 3x fewer**
  - upstream payload: **39,321,600 -> 13,107,200 bytes**, **-66.7%**
  - bytes avoided on the stable workload: **26,214,400 bytes (25 MiB)**

The wall-time values are **not comparable** and remain diagnostic only: the baseline measures the Go client/httptest transport path while the AFTER cache benchmark measures the in-process Agent cache layer. No wall-clock speedup or regression budget is claimed from those values.

Decision: **accept the bounded Desktop Agent thumbnail cache**. The deterministic request/byte counters materially improve on the exact baseline while the implementation keeps resident entries/bytes bounded, singleflights concurrent misses, and revalidates expired entries with ETag.

Next action: use this accepted warm-cache transport as an input to the planned **100k image cold/warm media-directory traces**, where renderer CPU, long tasks/FPS, RSS, Blob URL memory, request counts, and Web-vs-Desktop transport can be measured end to end.



## Current video-poster capability

FileExplorer now has a real persistent video-poster contract rather than an icon-only fallback:

- `xDriveFileSupportsThumbnail()` admits supported image and video file kinds into the same viewport-aware thumbnail scheduler.
- A video tile first requests the ordinary authenticated media-thumbnail endpoint. A warm 512px poster is served from `.xdrive-media/posters/` with a deterministic SHA/revision/version identity.
- On a poster-cache miss, Web/Desktop reuse the existing authenticated video preview stream, decode one displayable frame in the renderer, render a bounded 512px JPEG, display it immediately, and best-effort backfill the Server.
- Backfill requires `If-Match`, revalidates the current file revision/SHA/storage key, accepts only bounded JPEG data, and remains regenerable cache data.
- Server deployment stays distroless; no ffmpeg/ffprobe runtime or second Server-side decoder is introduced.
- Unsupported or browser-undecodable videos fall back to the normal shared video icon.
- Gallery and FileExplorer share the same capture/rotation helper so poster geometry cannot drift between the two surfaces.

The cold path is therefore intentionally client-assisted, while the warm path is a normal persistent Server-cache thumbnail read. Synthetic renderer traces measure scheduler/DOM/Blob behavior only; real codec decode plus Server backfill still requires a separate end-to-end dataset measurement.

## 100k media-directory benchmark matrix

### Synthetic renderer trace harness

A dedicated opt-in CI job on `perf/file-explorer-media-*` branches drives the actual Web and Desktop Chromium renderers with a deterministic **100,000-item sparse namespace**. It executes the same script on both surfaces: initial Grid mount, continuous scroll, midpoint jump, end jump, return to top, and a native Chromium mouse-driven marquee selection across the Grid viewport.

The harness records time-to-first-grid, scripted trace duration, Long Task count/duration, maximum mounted FileExplorer item nodes, maximum retained sparse metadata, thumbnail request count and peak in-flight requests, marquee duration/selection commits/selected-item peak, JS heap when Chromium exposes it, Electron renderer working-set memory, and a Chrome trace artifact.

Structural CI guards are intentionally strict while timing remains diagnostic: mounted items must stay **< 1,000**, retained sparse metadata must stay **<= 1,200**, thumbnail in-flight work must stay **<= 6**, every image/video-poster scenario must exercise thumbnail admission, and both warm synthetic scenarios must stay at **<= 600 thumbnail requests**.

Thumbnail admission is scroll-settled: every FileExplorer scroll records activity on the real scroll host, and newly visible/near-visible thumbnail tiles wait until **80 ms after the latest scroll event** before entering the thumbnail queue. Initial/static viewport thumbnails remain immediate; continuous scrolling keeps pushing admission back, and unmounted tiles cancel their pending admission timer before any loader/Blob work begins.

This is a **synthetic renderer/thumbnail-scheduler workload**, not a replacement for the real Server/object-store matrix below. It does not claim cold thumbnail generation latency, object-store throughput, HTTP/Agent transport throughput, or real codec decode cost. Those remain pending on a real 100k dataset.

#### First successful CI renderer trace sample

The following #728/#731/#734 tables are retained as the **historical pre-video-poster baseline**. They intentionally show the old `video icons` behavior and its zero-request contract; those rows are evidence for the previous implementation, not the current production contract.

The first complete hosted-runner trace after enabling a visible Chromium window under Xvfb produced the following six scenarios. Timing and RSS values are **diagnostic single-run samples**, not stable regression gates yet.

| Surface | Scenario | First grid | Script duration | Long tasks | Long-task time | Thumbnail requests | Peak in-flight | Max mounted | Peak retained | Renderer RSS |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Desktop | image cold | 1919.9 ms | 4105.9 ms | 1 | 69 ms | 364 | 6 | 110 | 1200 | 272,732 KiB |
| Desktop | image warm | 216.2 ms | 3100.8 ms | 1 | 75 ms | 1430 | 1 | 110 | 1200 | 278,108 KiB |
| Desktop | video icons | 214.0 ms | 2165.7 ms | 1 | 70 ms | 0 | 0 | 110 | 1200 | 259,180 KiB |
| Web | image cold | 217.9 ms | 2610.0 ms | 1 | 74 ms | 354 | 6 | 110 | 1200 | 288,876 KiB |
| Web | image warm | 290.1 ms | 8774.4 ms | 5 | 302 ms | 1400 | 1 | 110 | 1200 | 540,680 KiB |
| Web | video icons | 200.6 ms | 2151.8 ms | 1 | 71 ms | 0 | 0 | 110 | 1200 | 260,540 KiB |

Structural observations from this run:

- The 100,000-item logical directory remained bounded to **80 items on the initial mount** and **110 items maximum mounted**.
- Sparse retained metadata peaked at the configured **1200-item** budget.
- Cold image loading saturated but did not exceed the **6-request** thumbnail concurrency budget.
- Ordinary video tiles issued **0 thumbnail requests**, confirming image-thumbnail suppression.
- Warm image runs issue many more completed thumbnail loads than cold runs because zero-latency synthetic thumbnails finish before fast scrolling can cancel queued work. This is expected scheduler behavior, but it makes the warm renderer path the next trace target.
- The **Web image-warm** sample is the clear outlier in this first run: **8.77 s script duration**, **5 long tasks / 302 ms**, and **~528 MiB RSS** versus Desktop warm **3.10 s / 1 long task / ~272 MiB RSS**. Because this is one hosted-runner sample, do not treat the ratio as a stable regression result yet; repeat it before changing production behavior solely from timing.

#### Scroll-settle follow-up trace

The first authoritative trace from PR #731 applies the **80 ms scroll-settle admission gate** while keeping thumbnail transport concurrency at 6 and the FileExplorer cache at 96 entries.

| Surface | Scenario | First grid | Script duration | Long tasks | Long-task time | Thumbnail requests | Peak in-flight | Max mounted | Peak retained | Renderer RSS |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Desktop | image cold | 229.6 ms | 2480.3 ms | 1 | 71 ms | 106 | 6 | 110 | 1200 | 277,788 KiB |
| Desktop | image warm | 250.7 ms | 2591.6 ms | 2 | 135 ms | 184 | 1 | 110 | 1200 | 278,172 KiB |
| Desktop | video icons | 235.3 ms | 2519.7 ms | 1 | 91 ms | 0 | 0 | 110 | 1200 | 260,656 KiB |
| Web | image cold | 237.3 ms | 2503.9 ms | 2 | 128 ms | 102 | 6 | 110 | 1200 | 284,824 KiB |
| Web | image warm | 282.2 ms | 2542.4 ms | 1 | 77 ms | 184 | 1 | 110 | 1200 | 292,820 KiB |
| Web | video icons | 234.5 ms | 2302.2 ms | 1 | 77 ms | 0 | 0 | 110 | 1200 | 254,552 KiB |

Compared with the immediately preceding #728 renderer trace using the same harness:

- Desktop warm thumbnail loads fell **1430 -> 184 (-87.1%)**.
- Web warm thumbnail loads fell **1430 -> 184 (-87.1%)**.
- Web warm scripted duration fell **8.71 s -> 2.54 s (-70.8%)**.
- Web warm Long Task time fell **539 ms / 9 tasks -> 77 ms / 1 task**.
- Web warm renderer RSS fell **535,324 KiB -> 292,820 KiB (-45.3%)**.
- Cold image loads also fell materially without a scripted-duration regression: Desktop **366 -> 106**, Web **361 -> 102**.
- Video icon fallback remained at **0 thumbnail requests** on both surfaces.
- DOM and sparse-metadata bounds remained unchanged at **110 mounted items** and **1200 retained items**.

Decision: **accept scroll-settled thumbnail admission**. The first trace isolates request/Blob churn as the dominant cause of the prior warm Web outlier. Keep the existing **6-request concurrency** and **96-entry cache** unchanged; use the warm **<= 600 request** guard as a conservative structural regression budget. Continue treating timing and RSS as diagnostic until repeated hosted-runner samples establish variance.


#### Second scroll-settle sample (#731 final CI)

The final authoritative CI run for PR #731 repeated the same six scenarios after the amend, with no production-setting changes between samples.

| Surface | Scenario | First grid | Script duration | Long tasks | Long-task time | Thumbnail requests | Peak in-flight | Max mounted | Peak retained | Renderer RSS |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Desktop | image cold | 217.8 ms | 2400.4 ms | 1 | 72 ms | 102 | 6 | 110 | 1200 | 277,248 KiB |
| Desktop | image warm | 249.2 ms | 2419.0 ms | 2 | 138 ms | 184 | 1 | 110 | 1200 | 278,132 KiB |
| Desktop | video icons | 218.7 ms | 2237.0 ms | 1 | 77 ms | 0 | 0 | 110 | 1200 | 257,812 KiB |
| Web | image cold | 239.5 ms | 2472.2 ms | 2 | 134 ms | 102 | 6 | 110 | 1200 | 284,164 KiB |
| Web | image warm | 334.1 ms | 2798.1 ms | 3 | 229 ms | 184 | 1 | 110 | 1200 | 298,372 KiB |
| Web | video icons | 224.4 ms | 2392.4 ms | 1 | 79 ms | 0 | 0 | 110 | 1200 | 256,448 KiB |

Across the two post-settle samples, the structural signals are stable:

- warm thumbnail admission is exactly **184 requests** for both Desktop and Web in both runs;
- Web cold is exactly **102 requests** in both runs; Desktop cold is **106 -> 102**;
- video icon fallback remains exactly **0 thumbnail requests** on both surfaces;
- peak thumbnail concurrency remains **6** for cold images and **1** for the zero-latency warm fixture;
- mounted DOM and sparse metadata remain exactly **110** and **1200** at their peaks.

Hosted-runner timing still varies enough to remain diagnostic. The second Web warm run moved from **2.54 s -> 2.80 s (+10.1%)**, while renderer RSS moved only **292,820 -> 298,372 KiB (+1.9%)** and admission stayed fixed at **184**. Long-task observations also moved from **1 / 77 ms** to **3 / 229 ms** without any structural request growth.

Decision after the second sample: keep the current **80 ms scroll-settle**, **6-request concurrency**, **96-entry cache**, and **<=600 warm-request** structural guard unchanged. Do not add another production thumbnail optimization from synthetic timing alone. The next evidence must come from the real Server/object-store 100k image cold/warm and video icon-fallback matrix.

#### Real Server/object-store 100k sample (#734)

PR #734 adds a real production-path Server benchmark instead of another synthetic thumbnail transport. The fixture uses a real PostgreSQL **100,000-file** namespace per media case, the production Gin handlers, the production media-derivative scheduler, and `storage.Local`. The image namespace maps onto **128 physical 800x600 JPEG CAS objects** so the logical directory remains 100k while the measured top/middle/end sample contains **102 distinct source objects**. Cold and warm runs use the exact same 102 node IDs.

| Scenario | First range median | Middle range median | End range median | 102-thumbnail batch | p50 thumbnail | p95 thumbnail | Response bytes | Object-store behavior |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Image cold | 234.558 ms | 222.277 ms | 235.727 ms | 1248.984 ms | 70.311 ms | 102.139 ms | 2,610,039 | 102 original opens, 204 derived opens, 102 derived puts |
| Image warm | 234.558 ms | 222.277 ms | 235.727 ms | 70.345 ms | 3.722 ms | 6.227 ms | 2,610,039 | **0 original opens**, 102 derived opens, **0 derived puts** |
| Video icons | 219.400 ms | 197.063 ms | 206.675 ms | n/a | n/a | n/a | n/a | **0 thumbnail requests, 0 object-store opens, 0 derived puts** |

Structural conclusions:

- cold generation proves the sampled 102 requests are not accidentally deduplicated into a warm workload: there are exactly **102 distinct originals**, **102 original object opens**, and **102 derived writes**;
- warm serving proves the derivative cache is actually hit: source-object opens fall **102 -> 0** and derivative writes fall **102 -> 0**, while response bytes stay identical;
- diagnostic batch time falls **1248.984 -> 70.345 ms (17.8x)**; p50 falls **70.311 -> 3.722 ms (18.9x)** and p95 falls **102.139 -> 6.227 ms (16.4x)**;
- the current ordinary-video icon path performs no speculative media fetch at all: **0 thumbnail requests and 0 object-store I/O**;
- the cold path's two successful derived opens per newly generated thumbnail are visible in the counter (**204 opens for 102 thumbnails**), but current local-object-store timing does not justify changing production behavior from that count alone.

A second authoritative CI sample reproduced the structural result exactly: cold remained **102 original opens / 102 derivative writes**, warm remained **0 / 0** with **102 derivative reads**, and video fallback remained **0 thumbnail requests / 0 object-store opens**. The repeated range medians stayed in the same band: image **212.699-236.452 ms** and video **199.079-219.704 ms**.

Historical #734 decision: keep thumbnail concurrency, the 96-entry FileExplorer cache, and scroll-settle timing unchanged. The old video icon fallback conclusion is superseded by the persistent video-poster contract; the image-cache measurements remain valid historical evidence. Hosted-runner timing remains diagnostic.

#### Marquee-selection Chromium trace (#734)

The same Web/Desktop 100k renderer harness now performs a native Chromium mouse-driven marquee after the scroll/jump sequence. Electron sends a real mouse-down, 12 paced mouse moves, and mouse-up; FileExplorer handles them through the production pointer/rAF/virtual-geometry selection path.

| Surface | Scenario | Marquee duration | Selection commits | Final / peak selected | Long tasks | Long-task time | Thumbnail requests | Max mounted | Peak retained |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Desktop | image cold | 398.7 ms | 12 | 18 / 18 | 1 | 54 ms | 101 | 110 | 1200 |
| Desktop | image warm | 416.1 ms | 12 | 18 / 18 | 1 | 56 ms | 184 | 110 | 1200 |
| Desktop | video icons | 349.7 ms | 11 | 18 / 18 | 1 | 51 ms | 0 | 110 | 1200 |
| Web | image cold | 300.2 ms | 12 | 18 / 18 | 1 | 75 ms | 94 | 110 | 1200 |
| Web | image warm | 373.5 ms | 12 | 18 / 18 | 1 | 60 ms | 184 | 110 | 1200 |
| Web | video icons | 332.8 ms | 12 | 18 / 18 | 1 | 57 ms | 0 | 110 | 1200 |

The marquee duration is **not** a CPU-only latency metric: the driver intentionally includes 12 x 16 ms mouse pacing, a 50 ms input settle, polling, and post-input animation frames. The structural signal is what matters: all six runs completed a non-empty selection, selection work stayed frame-coalesced, DOM/metadata bounds did not grow, and marquee interaction did not create a new thumbnail-request class.

**Production decision after #734:** stop optimizing FileExplorer thumbnail/marquee behavior here. The backend cache path, renderer admission, sparse metadata, DOM bounds, and marquee interaction are healthy enough that another thumbnail or selection change would be speculative. The only repeatable cost now worth a separate investigation is the **100k file-heavy sparse range query (~200-236 ms per range)**. Because first/middle/end are all similar and the current range SQL uses `COUNT(*) OVER()`, the next performance PR should first A/B a **count-once / count-free subsequent-range** contract on the exact same fixture; only change production SQL/API if that paired measurement shows a material win without weakening count correctness.


The following four workloads are mandatory before claiming FileExplorer is validated for 100k media-heavy directories. “No thumbnails” means a **cold thumbnail cache at benchmark start**; “with thumbnails” means the same dataset with thumbnails already materialized/warm. The logical directory remains 100,000 items in all four cases.

| Scenario | Thumbnail state | Status | What must be measured |
| --- | --- | --- | --- |
| 100k images | Cold / no pre-existing thumbnails | **Server/object-store measured; Chromium renderer + marquee measured** | Backend generation/cache and renderer interaction are measured separately; a combined browser-to-real-Server trace is optional future evidence, not a blocker for the current decision. |
| 100k images | Warm / thumbnails pre-existing | **Server/object-store measured; Chromium renderer + marquee measured** | Warm derivative hits and renderer Blob/commit behavior are covered at their respective layers. |
| 100k videos | Cold / poster cache missing | **Capability implemented; end-to-end measurement pending** | Measure preview-stream bytes, renderer decode/canvas cost, 512px JPEG backfill, request cancellation, Server PUT validation, and subsequent cache visibility. |
| 100k videos | Warm / poster thumbnails pre-existing | **Capability implemented; synthetic renderer trace enabled; real cache measurement pending** | Measure persistent Server poster reads plus Web HTTP/Blob vs Desktop Agent/ArrayBuffer transport; request work must remain viewport-bounded. |

### Current assessment of the four 100k media cases

- **100k images, cold/no thumbnails:** sparse metadata and DOM work are already bounded; expected dominant costs are thumbnail generation, object-store I/O, HTTP/Agent transport, image decode, and Blob creation. Client thumbnail work must stay capped at **6 concurrent requests**, and request count must scale with viewport exposure rather than 100k logical items.
- **100k images, warm thumbnails:** generation cost is removed, isolating cached-object reads, transport, Blob URL creation, renderer commit/layout/paint, and the bounded **96-entry** FileExplorer thumbnail cache. This is the cleanest Web-vs-Desktop transport comparison.
- **100k videos, cold poster cache:** supported videos enter the same bounded thumbnail scheduler. The missing-cache GET is followed by one renderer decode/capture and a revision-fenced Server backfill; the benchmark must separate preview transport, codec/canvas time, PUT time, and the immediate local poster display.
- **100k videos, warm poster cache:** no preview decode/backfill should be needed. Measure persistent poster reads, Blob/ArrayBuffer transport, renderer commit/layout/paint, and the bounded **96-entry** FileExplorer thumbnail cache.

### Media benchmark execution rules

- Use the same 100,000-node namespace shape, sort order, viewport, Grid size, scroll/jump script, and client build for all four runs.
- Record **cold** and **warm** states separately. Never compare a cold image/video run against a warm run and call the difference a renderer optimization.
- Keep FileExplorer structural budgets visible in the result: thumbnail requests must remain **O(viewport/scroll exposure), not O(100k)**; in-flight thumbnail work must remain at or below **6**; the per-Explorer thumbnail cache must remain bounded at **96**; sparse logical metadata must remain bounded rather than retaining 100,000 rows.
- Run both **Web** and **Desktop** for warm-thumbnail transport because Desktop uses Agent IPC/ArrayBuffer while Web uses HTTP/Blob transport.
- For video runs, keep cold and warm poster states distinct. The synthetic `video-poster-cold` / `video-poster-warm` traces validate renderer admission only; a real cold run must additionally measure preview-stream decode/capture and revision-fenced backfill, while a real warm run must prove no preview decode or poster PUT occurs.
- The pure Node VirtualCollection baseline above is a prerequisite reference, not a substitute for these browser/Electron traces.
- Do not claim the image cases are fully end-to-end validated until the real Server/object-store fixture is connected to the Web/Desktop renderer transport. The current Server/object-store sample and synthetic Chromium trace measure complementary layers rather than one combined pipeline.

### 100k video poster: production Server HTTP/cache and Chromium decode (2026-10-09)

Status: **Measured baseline / no production optimization**, source commit `e329e683b51564cbf12187b04f539447fe55cca4`, [CI run 37876509402](https://github.com/lazyxu/xdrive/actions/runs/37876509402) and [performance job 113646340328](https://github.com/lazyxu/xdrive/actions/runs/37876509402/job/113646340328). Current implementation remains unchanged.

- Named workload `file-explorer-video-poster-server-100k`: one real PostgreSQL namespace with exactly **100,000 .mp4 nodes**, matching 100k `xd_files` and preindexed `xd_media_metadata` rows. Sample **102 distinct nodes** at offsets 0, 50k, and 99,746, exactly 34 per viewport. A real Gin HTTP server and `storage.Local` serve the production authentication, revision checks, poster cache PUT and warm GET paths.
- Three sequential paired cache cycles. Each cycle: **102 cold GET misses (expected 404)**, **102 valid 320×240 JPEG PUTs (expected 204, revision 1)**, **102 warm cached JPEG GETs (expected 200, full body equality, image/jpeg and ETag)**. All phases use **at most six in-flight requests**. Physical poster keys are deleted between cycles. Record phase batch wall-clock, individual p50/p95, byte counts, exact statuses, HTTP/store boundaries.
- The video originals in this **Server cache** fixture are intentionally fake, while media metadata is already indexed: it does **not** measure preview-ticket/Range bytes, MPEG/H.264 decoding or canvas capture. A separate **real Chromium MP4-to-JPEG poster** microbenchmark uses the existing seven-sample `desktop/scripts/gallery-video-poster-performance-main.cjs` with an embedded valid H.264 MP4. This isolates video decode/canvas from the HTTP cache contract, and may not be added to Server timing as though it were a single end-to-end run.
- Predeclared correctness acceptance: all 100k video metadata rows exist; all three sampled batches cover the same 102 IDs; 102/102 expected HTTP codes on each of nine phases, valid JPEG byte-for-byte warm equality, maximum **6** concurrent HTTP operations, no duplicate poster/response bytes. Performance times are diagnostic until a repeatable budget breach appears. The before/current code is unmodified; AFTER is **N/A**.
- Commands: `XD_FILEEXPLORER_VIDEO_POSTER_PERF=1 XD_TEST_DATABASE_URL=... go test -run '^TestFileExplorerVideoPosterCachePerformance100K$' -count=1 -v ./internal/api` and, on a Linux Xvfb Chromium host, `xvfb-run -a desktop/node_modules/.bin/electron --no-sandbox desktop/scripts/gallery-video-poster-performance-main.cjs` (working directory `desktop`). CI job `file-explorer-video-poster-server-performance` is branch-scoped.
- **BEFORE/current:** the authoritative run completed all three 102-item phases × three cycles, plus seven Chromium samples. **AFTER:** N/A — no product performance optimization was attempted.
- Full machine-readable raw measurements, original unrounded values, and source attribution: [ci-run-37876509402.json](performance-evidence/file-explorer-video-poster-100k/ci-run-37876509402.json). GitHub runs both layers; GitLab CI parity runs the Go Server benchmark only. No cross-host comparison is implied.

| Cache phase (102 requests, 6 workers) | Batch duration samples (ms) | Median batch (ms) | Per-request p50 median (ms) | Per-request p95 median (ms) | Response bytes / batch |
| --- | --- | ---: | ---: | ---: | ---: |
| cold-miss | 93.841 / 52.897 / 62.670 | **62.670** | 3.275 | 6.691 | 3,876 |
| poster-put | 102.922 / 102.501 / 110.996 | **102.922** | 5.907 | 8.449 | 0 |
| warm-hit | 62.328 / 62.194 / 59.557 | **62.194** | 3.192 | 5.925 | 929,118 |

- All nine phases passed their expected HTTP status, ETag/JPEG equality where applicable, exactly 102 requests and peak concurrency **6**. The **9,109-byte JPEG** was served **929,118 bytes** per warm batch.
- Native Chromium H.264 source was **2958 bytes** (micro-fixture), seven samples; first cold process **329.200 ms**, steady-cold median **3.600 ms**, warm median **3.400 ms**, median output JPEG **2338 bytes**. These values are *not* a realistic 4K/HEVC/large-file codec throughput test.
- **Decision: keep existing implementation.** This measurement is an isolated healthy Server cache/Chromium codec baseline, and does not reveal a repeatable breached latency/memory threshold. Do not optimize production from these synthetic fixture timings. The next run must use real preview stream bytes and real Web/Desktop transport if it makes end-to-end claims.
- Next: if these bounded paths pass, design a browser-to-real-Server end-to-end cold preview-stream/decode/backfill trace with real MP4 files and authenticated signed tickets, then resume 100k sync/delete batch and large-file transfer real disk/network measurements. Do not call a Server-only cache or isolated codec measurement end to end.

### 100k FileExplorer Grid/Details image, video and Live Photo renderer qualification (2026-10-09)

Status: **Measured baseline / no production optimization**. First run [CI 37874175164](https://github.com/lazyxu/xdrive/actions/runs/37874175164) on source `0622ae5dc6b1ce92c3e20e0f37be5ce40b4627ea`. This extends the earlier Grid-only 100k synthetic image/video traces without altering production FileExplorer/Thumbnail controllers.

- Logical directory size **100,000** for every run, 200-item pages and 2 retained pages either side of the viewport. Run the actual shared FileExplorer on **Web and Desktop**, in **Grid and Details**, with **image/video/LIVP**, each cold/warm: **24 named traces** per CI run.
- Every trace drives 36 consecutive scroll positions and jumps to 50% / 100% / 0%, observes long tasks, mounted DOM rows, sparse retained metadata, renderer working set, thumbnail requests/in-flight work and viewport geometry. Grid additionally uses real Chromium mouse-driven marquee. Details deliberately excludes marquee because its sticky header and row selection differ from Grid; zero marquee events in Details is not a performance failure.
- The `live-*` entries are real `.livp` file names classified by the production FileExplorer thumbnail/glyph UI; the trace asserts at least one displayed **实况照片** glyph after its thumbnail appears. Existing image/video poster scenarios continue to use SVG Blob thumbnails with synthetic 12 ms cold delay. Thus these results measure **real Chromium renderer + shared scheduler/virtual surface**, **not real Live Photo ZIP unpacking, codec decode, network/Agent IPC, Server poster GET/PUT, PostgreSQL or object-store I/O**.
- Predeclared structural acceptance: exactly 100k logical items and the named view/media combination; peak retained metadata **≤1200**, thumbnail in-flight **≤6**, mounted items **<1000**, at least one thumbnail request, warm thumbnail requests **≤600**, one glyph for `.livp`, and nonempty marquee in Grid. Time-to-first-grid/Details and script duration are diagnostic only unless a stable, comparable baseline identifies a repeatable breach. Prior healthy Grid image/video traces are the historical reference; new Details/LIVP have **no prior BEFORE timing**.
- Benchmark: `VITE_XDRIVE_FILE_EXPLORER_PERF=1` build both renderers, then `xvfb-run ... desktop/scripts/file-explorer-media-trace-main.cjs <web|desktop> <image-cold|image-warm|video-poster-cold|video-poster-warm|live-cold|live-warm> <grid|details>`; CI job `file-explorer-media-renderer-trace`, scoped to the performance branch. Samples per new combination: one initially; any suspected performance bottleneck requires at least three paired runs before optimization.
- Current decision: **Accept the measured structural baseline; no production optimization**. All **24/24** combinations met their frozen structural budgets. There is no comparable BEFORE/AFTER production change. Host/CI timing and final renderer working-set snapshots are diagnostic, not a performance speedup claim.
- Complete machine-readable raw metrics (all 24 rows, exact unrounded values): [ci-run-37874175164.json](performance-evidence/file-explorer-100k-grid-details/ci-run-37874175164.json). CI job [113638803698](https://github.com/lazyxu/xdrive/actions/runs/37874175164/job/113638803698).

| Surface | View | Media/state | First viewport (ms) | Script (ms) | Max DOM | Peak metadata | Thumb requests | Peak in-flight | Live glyphs | End WS (MiB) |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| desktop | grid | image-cold | 213.9 | 2714.4 | 110 | 1200 | 104 | 6 | 0 | 290.1 |
| desktop | grid | image-warm | 237.1 | 2855.3 | 110 | 1200 | 164 | 1 | 0 | 296.1 |
| desktop | grid | video-poster-cold | 229.9 | 2814.3 | 110 | 1200 | 104 | 6 | 0 | 285.3 |
| desktop | grid | video-poster-warm | 249.8 | 2673.2 | 110 | 1200 | 164 | 1 | 0 | 289.3 |
| desktop | grid | live-cold | 220.6 | 2787.5 | 110 | 1200 | 107 | 6 | 50 | 282.6 |
| desktop | grid | live-warm | 247.8 | 2762.0 | 110 | 1200 | 164 | 1 | 50 | 305.0 |
| desktop | details | image-cold | 203.5 | 2054.7 | 37 | 1200 | 50 | 6 | 0 | 236.7 |
| desktop | details | image-warm | 199.6 | 2050.7 | 37 | 1200 | 50 | 1 | 0 | 245.1 |
| desktop | details | video-poster-cold | 199.1 | 2049.5 | 37 | 1200 | 50 | 6 | 0 | 240.1 |
| desktop | details | video-poster-warm | 202.2 | 2053.5 | 37 | 1200 | 50 | 1 | 0 | 247.4 |
| desktop | details | live-cold | 203.5 | 2054.0 | 37 | 1200 | 50 | 6 | 16 | 244.6 |
| desktop | details | live-warm | 188.9 | 2040.9 | 37 | 1200 | 50 | 1 | 16 | 248.6 |
| web | grid | image-cold | 196.0 | 2695.8 | 110 | 1200 | 104 | 6 | 0 | 279.7 |
| web | grid | image-warm | 236.1 | 2678.8 | 110 | 1200 | 164 | 1 | 0 | 302.1 |
| web | grid | video-poster-cold | 197.5 | 2564.9 | 110 | 1200 | 101 | 6 | 0 | 291.7 |
| web | grid | video-poster-warm | 242.5 | 2675.4 | 110 | 1200 | 164 | 1 | 0 | 293.5 |
| web | grid | live-cold | 224.4 | 2706.1 | 110 | 1200 | 99 | 6 | 50 | 300.2 |
| web | grid | live-warm | 243.9 | 2717.5 | 110 | 1200 | 164 | 1 | 50 | 302.9 |
| web | details | image-cold | 206.7 | 2057.4 | 37 | 1200 | 50 | 6 | 0 | 255.1 |
| web | details | image-warm | 199.6 | 2051.5 | 37 | 1200 | 50 | 1 | 0 | 247.1 |
| web | details | video-poster-cold | 204.9 | 2055.1 | 37 | 1200 | 50 | 6 | 0 | 239.3 |
| web | details | video-poster-warm | 201.5 | 2052.5 | 37 | 1200 | 50 | 1 | 0 | 243.6 |
| web | details | live-cold | 210.5 | 2060.7 | 37 | 1200 | 50 | 6 | 16 | 246.5 |
| web | details | live-warm | 214.5 | 2066.1 | 37 | 1200 | 50 | 1 | 16 | 260.6 |

- Each run observed one startup long task; no runner-stable comparative CPU claim is made. All six `.livp` traces displayed the real shared Live Photo glyph (**50** Grid / **16** Details visible badges at final sampled viewport). Grid marquee remained non-empty; Details is a scroll/layout benchmark without marquee.
- Existing image/video cold/warm labels in this renderer harness are **synthetic 12 ms-delay vs no-delay**; they do not imply a real cache-hit benchmark. Warm scenario admissions (up to **164** in Grid) reflect the faster synthetic loader and are not a cache-efficiency comparison.
- **AFTER:** not applicable. No production code change was made; optimization was intentionally not attempted because all structural budgets passed. Later requests must not reuse the current single CI wall-clock numbers as a speed baseline across different hardware.
- Next: a separate real-video cold decode/canvas/PUT-backfill and warm-cache Server/HTTP/Agent test with a 100k metadata namespace, then 100k sync/delete operational performance. Do not equate the synthetic renderer timing with end-to-end throughput.

## Performance scenarios

The FileExplorer performance suite should keep these workloads stable:

| Scenario | Scale | Primary budget |
| --- | ---: | --- |
| Open directory | 200 / 10k / 100k children | first-page latency and time-to-interactive |
| Details scroll | 10k loaded items | frame stability and bounded mounted rows |
| Grid scroll | 10k loaded items | DOM count, thumbnail request concurrency, frame stability |
| Marquee select | 10k loaded items | pointer-frame CPU and selection latency |
| Pagination | 50 consecutive pages | no duplicate requests, no stale-page overwrite |
| Search | 100k namespace | first-page latency and next-page latency |

### Sparse range count cost A/B

Status: **Measured / production follow-up approved**.

The #734 media benchmark left one repeatable Server-side cost worth isolating: 100k file-heavy sparse directory ranges stayed around **200-236 ms** at first, middle, and end offsets even though thumbnail/object-store behavior was healthy. The current range query computes `COUNT(*) OVER()` on every viewport page, while the VirtualCollection contract only needs one stable `totalCount` to size the scrollbar for the active generation.

This PR is **benchmark-only**. It does not change the production children API, Go client, Agent/Web transport, or shared VirtualCollection contract.

Named workload: `file-explorer-range-count-100k`.

- namespace: **100,000 files** in one directory;
- range width: **200 items**;
- initial range: current counted query at offset 0, because a new generation still needs an authoritative total;
- broad-offset workload: **20 ranges** spread deterministically across the complete directory at offsets **200, 5,200, 10,200, ... 95,200**, preserving visibility into deep OFFSET cost;
- sequential-viewport workload: one authoritative counted range at offset 0 followed by **20 consecutive 200-item ranges** at offsets **200, 400, ... 4,000**;
- A path: the current production SQL shape with `COUNT(*) OVER() AS total_count` on every subsequent range;
- B path: the identical parent authorization join, File join, ordering, offset, limit, and projected row columns with only the window count removed after the initial counted range;
- correctness prerequisite: every broad-offset A/B range must return the exact same ordered node IDs, and every counted path must report `total_count=100000`;
- samples: **3 paired broad-offset batches** plus **3 paired sequential sessions**, alternating A/B execution order to reduce simple run-order bias;
- timing: report first-counted median, broad-offset batch/per-range medians, sequential session medians, raw sample batches, and paired reductions. Hosted-runner wall time remains diagnostic until repeated samples establish variance.

Command:

`XD_FILEEXPLORER_RANGE_COUNT_PERF=1 go test -run '^TestFileExplorerRangeCountPerformanceBaseline100K$' -count=1 -v ./internal/api`

Measured first authoritative CI sample (#739):

| Workload | Current counted path | Count-once / rows-only path | Delta |
| --- | ---: | ---: | ---: |
| Initial authoritative range | **82.252 ms median** | n/a | The first range still counts by design |
| 20 broad-offset subsequent ranges | **2040.550 ms** batch median (**102.028 ms/range**) | **1259.486 ms** batch median (**62.974 ms/range**) | **-38.28%**, about **39.1 ms/range** avoided |
| Sequential session: counted first range + 20 subsequent ranges | **1782.320 ms** median | **1077.919 ms** median | **-39.52%**, about **704.4 ms/session** avoided |

Raw paired samples:

- broad counted batches: **[2017.723, 2097.399, 2040.550] ms**;
- broad rows-only batches: **[1258.320, 1353.622, 1259.486] ms**;
- sequential count-every-page sessions: **[1782.320, 1793.888, 1782.060] ms**;
- sequential count-once sessions: **[1092.544, 1077.919, 1069.505] ms**.

The test completed in **29.39 s** and verified exact ordered node-ID equality for every broad A/B range plus `total_count=100000` on counted reads.

Decision: **accept the count-once direction for a separate production PR.** The roughly **38-40%** paired reduction is large and internally stable enough to justify implementation work. #739 remains benchmark-only so measurement and production-contract risk stay separated.

The production follow-up must preserve these semantics:

- offset 0 / a new navigation-or-sort generation obtains an authoritative total count;
- subsequent ranges may omit recomputing the count only when the client already owns that same generation's stable count;
- a missing count is never interpreted as zero;
- navigation, sort, refresh, or another generation reset reacquires an authoritative count;
- empty/out-of-range and 404 distinction must remain correct;
- Web and Desktop must consume one shared contract rather than inventing platform-specific count reuse.

Two later #739 validation samples confirmed the same direction despite hosted-runner wall-clock variation:

- validation sample 2: broad **3223.987 -> 1748.068 ms (-45.78%)**; sequential **2900.027 -> 1382.164 ms (-52.34%)**;
- validation sample 3: broad **3853.494 -> 2088.390 ms (-45.81%)**; sequential **3444.787 -> 1636.225 ms (-52.50%)**.

The absolute times moved with runner load, while the paired reduction stayed large across all three samples. That is sufficient evidence to proceed with the production contract without promoting raw wall time into a merge gate.

### Production count-once contract

Status: **Accepted / validated on #750**.

The production implementation keeps the optimization policy in the shared Cloud Files / VirtualCollection layer so Web and Desktop cannot drift:

- a new navigation, sort, explicit refresh, or other VirtualCollection generation requests its first range with an authoritative count;
- later viewport ranges request `include_count=false`;
- Server responses carry `total_count_included` so `total_count=0` is never ambiguous with “not computed”;
- the Go client treats an absent `total_count_included` field as counted, preserving compatibility with older Servers;
- Web and Desktop only serialize the shared controller's `includeCount` decision;
- a count-free page reuses the current generation's already-known total and cannot establish a fresh collection by itself;
- empty count-free ranges still validate the parent directory so 404 behavior is unchanged.

This is a production realization of the measured #739 candidate, not a separate speedup claim. The production-branch validation reran the same 100k paired workload and reproduced the benefit despite different hosted-runner absolute timing:

| Validation workload | Count every range | Count once / later ranges count-free | Paired reduction |
| --- | ---: | ---: | ---: |
| 20 broad-offset ranges | **3885.236 ms** | **2136.375 ms** | **-45.01%** |
| Counted first range + 20 sequential ranges | **3480.204 ms** | **1695.987 ms** | **-51.27%** |

The same production tree passed the shared Desktop controller/VirtualCollection tests, Web lint/build, Server deployment validation, API race suite, and the branch-scoped 100k benchmark before the final documentation-only rerun. Ordinary Go race also passed before that rerun. Absolute hosted-runner wall time remains diagnostic; the stable paired direction from #739 and #750 is the evidence.

Decision: **accept the production count-once contract.** Keep `total_count_included` as the explicit wire signal, keep old-Server compatibility by treating a missing flag as counted, and keep generation ownership in shared Cloud Files / VirtualCollection rather than duplicating policy in Web/Desktop adapters.



## Next work

1. **Keep the accepted FileExplorer scheduler budgets while validating video posters.** Preserve the current **80 ms scroll-settle**, **6-request thumbnail concurrency**, **96-entry FileExplorer cache**, and virtual-geometry marquee implementation; use the new cold/warm poster traces before making any further thumbnail tuning.
2. **Measured / accepted direction:** #739 shows a **38.28% broad-offset** and **39.52% sequential-session** reduction when later ranges stop recomputing `COUNT(*) OVER()`. Keep #739 benchmark-only.
3. **Accepted / implemented:** the production **count-once / count-free subsequent-range** contract is complete across Server -> Go client -> xdrive-agent/Electron/Web -> shared Cloud Files/VirtualCollection. Keep #739 as the decision benchmark and #750 as the production validation.
4. **Accepted / implemented:** #759 installs the #756-selected exact type expression index through Server migration. Production-branch validation reproduced a **57.26%** reduction on the repeated count-free middle range while leaving the counted first range effectively unchanged (**-0.87%**). Keep the persisted-key candidate rejected. No further FileExplorer directory-sort optimization is selected from current evidence.
5. **Video poster capability is implemented.** The remaining performance work is measurement: synthetic cold/warm poster traces plus a real browser/Electron-to-Server dataset that separates cold preview/decode/backfill from warm persistent-cache reads.

Every performance change should preserve FileExplorer selection, keyboard navigation, drag/drop, rename, preview, and pagination semantics.


### Sparse logical directory surface

The FileExplorer surface can separate the logical directory item count from loaded/rendered items. Details and Grid compute scrollbar geometry from the full logical count, while only the current viewport plus bounded overscan creates render slots. Missing slots are lightweight non-interactive placeholders; the surface never allocates an array sized to the full directory. The dense compatibility path retains adaptive prefetch/load-more behavior, while sparse mode bypasses legacy bottom pagination entirely. Search remains dense until its own range contract migrates.


Before sparse runtime is enabled, item interactions must also be logical-index aware. Active item, rename recovery, marquee hit-testing, and keyboard targets resolve against loaded sparse logical indexes. Shift ranges are committed only when every logical item in the requested range is loaded; otherwise FileExplorer requests that range instead of silently selecting a partial loaded subset. Full Ctrl+A / cross-unloaded-range bulk selection remains a separate selection-model problem and must not be faked by selecting only loaded items.

### Windows local-delete prefix-set and baseline pruning contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Windows CfAPI full/local-change reconcile push path;
- stable structural workload: **1,200 flat baseline files** deleted locally;
- every file remains an independent Server DELETE root, so network mutation cardinality is intentionally unchanged;
- evidence method: deterministic prefix-set/baseline helper behavior plus source-shape regression for both reconcile paths; no wall-clock benchmark is quoted.

BEFORE:

- every successful delete immediately called `deletePrefix(baseline, rel)`;
- for 1,200 flat files plus the root entry, repeated shrinking-map scans inspect up to **721,800 baseline keys**;
- subtree suppression used `underAny(rel, deletedPrefix)`, linearly scanning every previously successful prefix; 1,200 independent roots perform **719,400 prefix comparisons**;
- local-change new-directory suppression used the same growing-prefix-list shape.

AFTER / current:

- successful delete roots are recorded in `winPathPrefixSet`;
- ancestor coverage walks only the candidate path's ancestors and performs map lookups, independent of the number of previously processed sibling roots;
- baseline cleanup runs once after the delete loop and removes entries covered by any successful root;
- 1,200 flat successful deletions therefore require **1 final baseline scan** instead of 1,200 baseline scans;
- full reconcile keeps HTTP 404 as successful local cleanup and keeps 409 as non-cleanup; local-change reconcile keeps both 404/409 as non-cleanup exactly as before;
- if a later DELETE fails fatally, baseline entries for earlier successful DELETEs are still pruned before returning, matching the old partial-progress behavior;
- Server DELETE request order/cardinality, revision checks, subtree suppression, rename ordering, CfAPI behavior and baseline persistence are unchanged.

Decision: **Accepted.** The old repeated local map scans and linear prefix-list coverage added CPU work proportional to the product of deletion count and baseline/prefix count without contributing to server-side correctness.

Regression budget: successful local-delete baseline cleanup must perform at most **one full baseline traversal per reconcile delete phase**. Prefix coverage must be ancestor-set based and must not reintroduce a growing linear prefix scan.

Regression commands:

- `go test ./internal/mount -run '^TestWindows(PathPrefixSet|DeleteBaselinePrefixes|LocalDeletePruningSourceShape)$' -count=1`.

Next action: continue ordinary sync/delete/download performance audits and only change another deterministic request, SQL, allocation, filesystem, lock, or object-store multiplier.

### Windows local-change existence-probe reuse contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Windows CfAPI local-change reconciliation;
- stable structural workload: **1,200 independent changed paths** with no subtree suppression;
- evidence method: deterministic source-shape regression plus existing Windows reconcile behavior tests;
- no wall-clock speedup is claimed.

BEFORE:

- the main changed-path pass calls `os.Lstat` once per independent path to classify existing vs missing work;
- a second deletion-discovery pass iterates the complete `pathSet` and calls `os.Lstat` again for every path;
- 1,200 independent paths therefore require **2,400 filesystem existence probes** before Server DELETE work.

AFTER / current:

- the first pass records a path as a deletion candidate immediately when its single `Lstat` returns `os.ErrNotExist` and that path still exists in the baseline;
- the second whole-`pathSet` filesystem pass is removed;
- the same 1,200-path workload therefore requires **1,200 filesystem existence probes**;
- deletion candidates are still depth-sorted and filtered by the existing prefix set;
- the delete loop still re-checks the current baseline entry before issuing the Server DELETE;
- Server DELETE request order/cardinality, revision use, 404/409 behavior, successful-prefix pruning, always-local handling, cache enforcement and baseline persistence are unchanged.

Decision: **Accepted.** The second filesystem pass repeated information already obtained by the first pass and added one local metadata syscall per changed path without contributing new mutation semantics.

Regression budget: `reconcileLocalChanges` must perform at most one direct `os.Lstat` existence probe per processed changed path; deletion discovery must not reintroduce a second full `pathSet` filesystem scan.

Regression command:

- `go test ./internal/mount -run '^TestWindowsLocalChangeExistenceProbeSourceShape$' -count=1`.

Next action: continue basic FileExplorer download/sync/delete performance audits and only change another deterministic request, SQL, allocation, filesystem, lock, or object-store multiplier.

### Hierarchical Transfer history trim fast-path contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- shared Go Transfer Manager used by Desktop/Agent FileExplorer upload/download task trees;
- stable structural workload: **1 active group + 1,000 child tasks**, history limit **200 roots**;
- every child is created and then completed, while all tasks remain under the same root;
- evidence is deterministic source-shape/runtime regression; no wall-clock speedup is claimed.

BEFORE:

- every `Start` and terminal `Complete/Fail` calls `trimLocked`;
- `trimLocked` first scans the complete task order just to discover that root cardinality is still 1;
- one group plus 1,000 create+complete child cycles therefore performs **1,003,001 history-entry inspections** before doing no eviction.

AFTER / current:

- Manager maintains the distinct root IDs incrementally;
- when `len(roots) <= history limit`, `trimLocked` returns before allocating root-order maps or scanning task history;
- the same workload performs **0 history-entry inspections** in trim;
- once root cardinality really exceeds the limit, the existing oldest-terminal-root selection still scans and evicts whole root trees exactly as before.

Decision: **Accepted.** Child cardinality must not determine history-retention cost because the configured limit is defined in root transfers, not child tasks.

Regression budget: child create/finish under an in-limit root set must return from `trimLocked` before the history loop. Clear, clear-history, and trim eviction must keep the root set synchronized with retained trees.

Regression commands:

- `go test ./internal/transfer -run '^TestManagerHistoryTrimFastPathUsesRootCardinality$|^TestManagerHistoryLimitCountsRootTransfersNotChildren$|^TestManagerClearHistoryKeepsCompletedChildrenOfActiveGroup$' -count=1`.

Next action: completed by the Web child registration/persistence contract below; continue basic FileExplorer download/sync/delete audits.

### Folder-upload group progress aggregation contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- shared FileExplorer upload controller used by Web and Desktop;
- a folder upload with **N targets** keeps the existing sequential upload order and creates all queued child transfer tasks before the group starts;
- evidence is deterministic controller execution plus source-shape regression; no wall-clock speedup is claimed.

BEFORE:

- target setup evaluates `fileSize(target.file)` once while reducing total bytes and again while building child sizes: **2N probes**;
- an N-length `childDone` array stores every child byte position;
- each `groupProgress()` publication recomputes `bytesDone` with `childDone.reduce(...)`: **N slot inspections per publication**;
- frequent upload progress callbacks therefore multiply progress bookkeeping by folder cardinality.

AFTER / current:

- child sizes are computed once and their total is reduced from that cached list: **N file-size probes**;
- one scalar `groupBytesDone` tracks aggregate progress;
- the currently executing child keeps one local `childBytesDone`; each callback applies only `next - previous` to the aggregate;
- each group-progress publication reads the aggregate in **O(1)**;
- the N-length `childDone` array is removed;
- skipped/preflight-failed/cancelled children retain their prior zero-or-partial transferred-byte semantics; successful children advance the aggregate to their full size.

Decision: **Accepted.** Progress accounting must not become more expensive merely because a folder contains more queued siblings.

Regression budget: group progress aggregation must not scan per-child byte slots. `fileSize` is evaluated once per target during group setup. All children must still be registered before the group begins transfer.

Regression command:

- `node --test desktop/tests/shared-folder-upload-transfer-groups.cjs`.

### Web folder-upload child registration/persistence contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Web FileExplorer folder upload with **N queued child tasks** under one transfer group;
- all children must remain visible in Transfer Center before the group begins transferring;
- evidence is deterministic shared-controller execution plus Web store source-shape regression; no wall-clock speedup is claimed.

BEFORE:

- shared upload orchestration calls the Web `startChild` adapter N times;
- each call performs a parent-task lookup, prepends a new task array, trims root history, serializes the full transfer history into `localStorage`, copies a snapshot, and notifies listeners;
- child registration therefore performs **N parent lookups, N history trims, N full-history persistence writes, and N listener publications**;
- because every persistence write serializes the growing child list, cumulative registration serialization grows with both child count and retained history size.

AFTER / current:

- the shared lifecycle exposes optional `startChildren` while retaining `startChild` as the compatibility path;
- Web opts into `startChildren`; Desktop/Agent keeps the existing per-child lifecycle unchanged;
- Web resolves the parent once, constructs all queued child tasks in target order, prepends them in the same legacy newest-first display order, then runs one history trim and one emit/persistence step;
- the same N-child registration performs **1 parent lookup, 1 history trim, 1 full-history persistence write, and 1 listener publication**;
- returned child IDs stay in target order, so subsequent upload/progress/finish calls retain their existing file-to-transfer mapping;
- all queued children still exist before `begin(groupID)`, so upfront Transfer Center visibility is preserved.

Decision: **Accepted.** Upfront child visibility is part of the transfer contract, but persisting and publishing the entire growing transfer history after every child has no semantic value.

Regression budget: Web folder-upload batches with more than one child must use one `startChildren` call and one store emit for registration. The single-child `startChild` API remains compatible. Desktop transfer lifecycle behavior is unchanged.

Regression command:

- `node --test desktop/tests/shared-folder-upload-transfer-groups.cjs`.

Next action: completed for archive child creation by the Web archive-download registration contract below.

### Agent transfer child batch-registration contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Desktop FileExplorer folder upload and Agent-native folder download;
- stable structural workload: **1,000 leaf files** under one hierarchical Transfer Center group;
- evidence method: deterministic Manager revision test + Agent IPC batch test + Desktop/Agent source-contract test;
- samples: n/a for structural request/revision counts.

BEFORE:

- Desktop folder upload registered queued children with **1,000 renderer -> Electron -> Agent lifecycle requests**;
- each Agent child registration published one transfer revision, so upfront registration published **1,000 revisions**;
- Agent-native folder download also registered 1,000 children individually before payload transfer, publishing **1,000 revisions**.

AFTER / current:

- capability-gated `start_children` registers the same 1,000 Desktop upload children in **1 IPC request**; each request is bounded to **1,000 children** and the route has a dedicated **1 MiB** JSON ceiling while all ordinary Desktop IPC JSON remains capped at **64 KiB**;
- larger folders are chunked by the Desktop adapter (for example, 10,000 children -> **10** bounded IPC requests instead of 10,000 single-child requests), preserving target order without allowing one unbounded JSON body;
- `Manager.StartChildrenByID` inserts the complete child batch under one lock and publishes **1 revision** after the batch;
- Agent-native folder download reuses the same Manager batch primitive, so its upfront child-registration revisions are **1,000 -> 1**;
- all child IDs/tasks still exist before the group enters transfer execution, and upload/download payload order, per-file progress, completion, retry and cancellation semantics are unchanged;
- an older Agent without `transfer-lifecycle-child-batch` keeps the existing shared-controller `startChild` fallback.

Decision: **Accepted.** This removes child-count-scaled control-plane setup without adding transfer concurrency or changing the data plane.

Regression budget: each supported batch of up to **1,000 children** must issue **one Agent lifecycle request and one Manager revision publication**; larger Desktop child sets must be chunked into bounded batches, and no partial child set may be returned for a valid batch.

Next action: completed by the Agent folder-download progress publication contract below.

### Agent folder-download progress publication contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Agent-native Desktop FileExplorer folder download;
- one active leaf file whose `DownloadToProgress` callback already reports bytes at the shared client cadence;
- evidence method: deterministic Manager revision test plus source-contract coverage of the production folder-download callback;
- samples: n/a for structural revision counts.

BEFORE:

- every progress callback updates the leaf child with `Baseline` / `Progress`, publishing **1 Manager revision**;
- the same callback immediately updates the folder group aggregate with `UpdateGroup`, publishing **1 more revision**;
- total control-plane publication cost: **2 Manager revisions per download progress callback**.

AFTER / current:

- `BaselineAndUpdateGroup` / `ProgressAndUpdateGroup` mutate child and group state under one Manager lock and publish once after both are coherent;
- total control-plane publication cost: **1 Manager revision per download progress callback**;
- the child's byte/rate calculations and the group's bytes/items/percent calculations retain their existing semantics;
- the shared download client's existing **100 ms** progress-report throttling is unchanged;
- file start, completion, failure and cancellation transitions remain separate lifecycle publications; no transfer concurrency or data-plane behavior changes.

Decision: **Accepted.** Child and group progress are one coherent Transfer Center snapshot, so publishing the intermediate child-only state has no correctness or user-visible value.

Regression budget: each Agent folder-download progress callback must advance Manager revision by at most **1** while updating both the active child and its group aggregate. Standalone child/group APIs must continue to publish immediately.

Regression commands:

- `go test ./internal/transfer`;
- `node --test desktop/tests/shared-folder-download-transfer-groups.cjs`.

Next action: return to basic FileExplorer **sync/delete** performance auditing and only change another deterministic request, SQL, allocation, or publication hotspot.

### Web archive-download child registration/persistence contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Web FileExplorer archive/folder download after durable archive prepare returns **N leaf files**;
- stable structural example: **1,000 prepared leaf files**;
- Transfer Center child tasks must all exist before archive progress polling/transport begins;
- evidence is source-shape regression over the production Web download path; no wall-clock speedup is claimed.

BEFORE:

- archive prepare iterates every prepared leaf and calls `startTransferChild` separately;
- each child call resolves the parent, prepends transfer history, trims history, serializes the full transfer list to `localStorage`, snapshots it, and notifies listeners;
- N prepared files therefore perform **N parent lookups, N history trims, N full-history persistence writes, and N listener publications** before archive bytes start streaming.

AFTER / current:

- archive download maps the prepared manifest to one `startTransferChildren` call;
- Web TransferStore resolves the parent once, creates all children, trims once, persists once, and notifies once;
- returned IDs are consumed by manifest index and then stored in the existing path-indexed maps, preserving later server-progress routing;
- all child tasks still exist before the first group progress publication/poll;
- archive prepare/status polling, server-side per-entry progress, direct-to-disk/Blob transport, final completion and error/cancel handling are unchanged.

Decision: **Accepted.** Prepared archive entries are already known as one immutable manifest for this transfer, so publishing the same growing child list N times has no user-visible or correctness value.

Regression budget: one prepared archive manifest must use one batch child-registration call and must not call `startTransferChild` inside `downloadArchive`. Returned child count must match the prepared manifest before transport begins.

Regression command:

- `node --test desktop/tests/shared-web-archive-download-transfer-groups.cjs`.

### Web archive-download progress persistence batching contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Web FileExplorer archive/folder download with **N prepared leaf files** and the existing 200 ms Server progress polling;
- stable structural example: **1,000 child transfers + 1 group transfer**;
- evidence combines an executable Web TransferStore batching regression with source-shape coverage of archive progress/success/failure wiring;
- no wall-clock speedup is claimed.

BEFORE:

- every child `begin`, `progress`, or terminal `finish` calls TransferStore `patch`;
- each successful `patch` trims root history, serializes the complete transfer list to `localStorage`, snapshots it, and publishes every listener;
- a steady 1,000-file progress snapshot therefore performs **1,001 history trims, 1,001 full-history persistence writes, and 1,001 listener publications** (1,000 child progress updates + 1 group update);
- state-transition snapshots can perform more because begin/finish mutations are additional child patches;
- success fallback completion and failure/cancel cleanup also repeat persistence once per unfinished child.

AFTER / current:

- TransferStore exposes a nest-safe `batchUpdates` scope for lifecycle patches;
- archive `applyProgress` batches every child mutation and its group aggregate update;
- successful terminal catch-up batches child progress/completion plus group completion;
- failure cleanup batches unfinished-child cancellation plus group failure;
- the outer batch performs **one history trim, one full-history persistence write, one snapshot, and one listener publication** when any lifecycle item changed;
- ordinary single-file upload/download mutations outside a batch keep their existing immediate persistence/publication behavior;
- Server progress polling remains 200 ms and archive payload streaming is unchanged.

Decision: **Accepted.** A single Server progress snapshot is one coherent UI state transition; serializing and publishing the same transfer tree after each child mutation has no correctness or user-visible value.

Regression budget: one archive progress snapshot must cause at most **1** TransferStore trim/persistence/listener publication regardless of child count. Nested batch scopes must flush only at the outer boundary, and unbatched single-transfer progress must still publish immediately.

Regression commands:

- `node --test desktop/tests/web-transfer-store-batch.cjs`;
- `node --test desktop/tests/shared-web-archive-download-transfer-groups.cjs`.

Next action: continue basic FileExplorer sync/delete performance audits and only change another deterministic request, SQL, allocation, filesystem, lock, or object-store multiplier.



### Windows empty always-local policy fast-path contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Windows CfAPI reconciliation with the default normalized storage policy;
- stable structural workload: **100,000 baseline entries**, `AlwaysLocalPaths` empty after normalization;
- evidence method: policy unit regression plus source-shape regression that requires the empty-policy guard before the baseline loop;
- no wall-clock speedup is claimed.

BEFORE:

- every local-change and full-reconcile completion calls `applyAlwaysLocal(baseline)`;
- even when no always-local rule exists, `applyAlwaysLocal` allocates its path slice and inspects every baseline entry;
- the 100,000-entry default-policy workload therefore performs **100,000 baseline inspections** for work that cannot match any entry.

AFTER / current:

- normalized policy exposes `hasAlwaysLocal()`;
- `applyAlwaysLocal` returns before allocation or baseline iteration when that predicate is false;
- the same default-policy workload performs **0 baseline inspections** in this policy phase;
- when at least one normalized always-local rule exists, path matching, sort order, availability checks, pinning and hydration are byte-for-byte on the existing path.

Decision: **Accepted.** The empty policy mathematically cannot produce an always-local match, so scanning the baseline has no correctness value.

Regression budget: an empty normalized `AlwaysLocalPaths` policy must return before the `for rel, state := range baseline` loop; configured-policy behavior must continue through the existing loop.

Regression commands:

- `go test ./internal/mount -run '^TestSyncPolicyHasAlwaysLocal$|^TestWindowsApplyAlwaysLocalEmptyPolicyFastPathSourceShape$' -count=1`.

Next action: audit hierarchical Transfer Manager child creation so large folder uploads/downloads do not repeatedly rescan full task history while preserving upfront child visibility.

### FileOperation progress-write coalescing contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- durable FileOperation Copy/Move/Delete execution used by FileExplorer;
- stable structural workload: **120 top-level Move/Delete roots**;
- evidence method: PostgreSQL statement counter against the progress helper plus source-shape regression for Copy/Move/Delete executor wiring; no wall-clock benchmark is quoted.

BEFORE:

- each root wrote `current_item` with one `status=running` UPDATE;
- successful root completion then issued a second UPDATE for `processed_items/processed_bytes`;
- 120 roots therefore produced **240 FileOperation UPDATEs** before terminal completion;
- Copy additionally wrote `processed_bytes` once per copied file from its traversal hook.

AFTER / current:

- completed item/byte deltas remain pending only until the next item begins;
- the next `current_item` UPDATE atomically folds in the previous completed delta;
- the last pending delta is explicitly flushed before undo-plan/terminal completion;
- 120 roots therefore produce **121 FileOperation UPDATEs** for item/progress bookkeeping;
- Copy's per-file byte deltas are folded into subsequent node/root checkpoints instead of requiring one extra UPDATE per file.

Cancellation contract:

- **every item/node still executes the existing `status=running` UPDATE checkpoint**;
- a DB-visible `cancel_requested` state still makes that checkpoint affect zero rows and resolves to `errFileOperationCancelled`;
- the in-process cancellation context remains unchanged;
- coalescing does not reduce cross-Server cancellation checkpoint frequency.

Decision: **Accepted.** This removes redundant progress-only writes without weakening FileOperation cancellation, item ordering, mutation transactions, conflict handling, or final progress accuracy.

Regression budget: a 120-item begin+complete workload must remain at **<=121 FileOperation UPDATEs**, and the final stored processed item/byte totals must be exact.

Regression commands:

- `go test ./internal/api -run '^TestFileOperationProgress(CoalescesCompletedDeltas|PreservesDatabaseCancellationCheckpoint|ExecutorsUseCoalescer)$' -count=1`.

Next action: continue basic FileExplorer download/sync/delete performance audits and only change another deterministic request, SQL, allocation, filesystem, lock, or object-store multiplier.

### Windows local file-rename baseline fast-path contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Windows CfAPI event-driven local rename handling;
- stable structural workload: **1,200 independent file renames** against a **100,000-entry baseline**;
- every rename still performs the existing Server `RenameMove` mutation and `cfMarkPathInSync`;
- evidence method: production source-shape regression plus behavior tests over a 100k-entry baseline; no wall-clock benchmark is quoted.

BEFORE:

- every successful local rename called `deletePrefix(baseline, newPath)`;
- it then called `moveBaselinePrefix(baseline, oldPath, newPath)`;
- both helpers scan the whole baseline to discover subtree members;
- independent file renames have no descendants, so 1,200 file renames performed **2,400 whole-baseline prefix scans** without gaining file-level correctness.

AFTER / current:

- when the source is a file and the exact target is absent or is also a file, baseline bookkeeping uses exact map operations: delete the target key, delete the old key, and write the source state at the new key;
- the same 1,200-file workload performs **0 prefix-wide baseline scans** in rename bookkeeping;
- an exact target that is a baseline directory falls back to the old subtree delete/move path;
- directory source renames also keep the old subtree path because descendants must move with the directory;
- Server request cardinality, revision/conflict behavior, target parent resolution, path-in-sync marking, and later changed-path processing remain unchanged.

Decision: **Accepted.** A file node cannot own baseline descendants, so scanning the entire baseline twice per ordinary file rename adds work proportional to namespace size without contributing information.

Regression budget: ordinary file rename bookkeeping must not call `deletePrefix` or `moveBaselinePrefix`. Directory renames and directory-target fallback must retain subtree cleanup/move semantics.

Regression commands:

- `go test ./internal/mount -run '^TestWindowsLocalFileRename' -count=1`.

Next action: continue basic FileExplorer sync/delete performance auditing and only change another deterministic request, SQL, allocation, filesystem, lock, or object-store multiplier.

### Windows full-reconcile local-file delete baseline fast-path contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Windows CfAPI full remote reconciliation fallback;
- stable structural workload: **1,200 flat file nodes** present in the baseline and remote snapshot, locally missing, with unchanged revisions;
- every item still performs the existing revision-fenced Server `DELETE`; this contract changes only post-success in-memory baseline bookkeeping;
- evidence method: behavior tests over a 100k-entry baseline plus a production source-shape regression; no wall-clock benchmark is quoted.

BEFORE:

- every successful local-missing delete called `deletePrefix(baseline, rel)`;
- for files, that helper scans the entire baseline even though a file cannot own descendants;
- 1,200 successful flat-file deletes therefore performed **1,200 prefix-wide baseline scans**.

AFTER / current:

- when both baseline and current remote node types are `file`, successful Server DELETE removes the exact baseline key with `delete(baseline, rel)`;
- the same 1,200-file workload performs **0 prefix-wide baseline scans** in post-delete bookkeeping;
- directory nodes retain `deletePrefix` because descendant baseline entries must be removed;
- a baseline/remote type mismatch also retains the subtree fallback rather than assuming file semantics;
- Server DELETE cardinality, revision checks, error handling, remote walk, path ordering, placeholder behavior, and final baseline persistence are unchanged.

Decision: **Accepted.** File deletion has exact-key baseline semantics; namespace-wide descendant discovery contributes no information for a file node.

Regression budget: successful full-reconcile deletion of a file must not call `deletePrefix`. Directory or type-mismatch cleanup must retain subtree deletion.

Regression commands:

- `go test ./internal/mount -run '^TestWindowsRemoteFullLocal' -count=1`.

Next action: continue the basic sync/delete performance audit. The next larger candidate is reducing full-baseline clone/diff work for small Windows incremental batches, but that should be handled separately because it changes persistence-delta plumbing rather than simple map bookkeeping.

### Windows remote journal file-page path-delta persistence contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- ordinary Windows CfAPI **remote change-journal** processing after the baseline is already loaded; this is **not first-open/full reconciliation**;
- stable structural workload: **10,000 baseline entries** and one journal page containing three independent file mutations: one in-place update, one delete, and one rename/move;
- evidence method: deterministic path-delta equivalence test plus production source-shape regression; no wall-clock speedup is quoted.

BEFORE:

- every successful journal page finished through `storeBaseline -> persistBaselineDelta -> diffBaseline`;
- `diffBaseline` iterated the complete previous map and then the complete current map even when only a few file paths changed;
- the 10,000-entry / three-file workload therefore performs roughly **20,000 baseline map visits in the persistence-diff phase**;
- the existing `cloneBaseline` at the beginning of the incremental page is separate and remains unchanged by this PR.

AFTER / current:

- pure file journal pages track only exact old/new paths touched by file create/update/move/delete;
- the same update + delete + move workload compares **4 candidate paths** in the persistence-diff phase;
- directory upserts/deletes, excluded-path prefix cleanup, unsupported node types, and local unsynchronized file handling that can create a conflict copy all keep the existing full `diffBaseline` fallback;
- overflow/full reconciliation, state-log framing, CRC, fsync, compaction thresholds, cache enforcement, always-local behavior, journal cursor semantics, and sync conflict handling are unchanged.

Decision: **Accepted.** File nodes have exact-key persistence semantics when the page does not enter a subtree-sensitive or conflict-copy path, so rescanning unrelated baseline entries adds no persistence information.

Regression budget: eligible pure-file journal persistence must remain **O(touched file paths)** for the diff phase; directory/subtree/conflict-sensitive pages must continue using the full-diff fallback. This does **not** claim total incremental reconciliation is O(changes), because baseline cloning remains O(baseline entries).

Regression commands:

- `go test ./internal/mount -run '^TestWindowsBaselinePathDeltaMatchesFullDeltaForSmallFileBatch$|^TestWindowsRemoteJournalFilePageUsesPathScopedBaselinePersistence$' -count=1`.

Next action: continue basic FileExplorer sync/delete performance auditing. The remaining larger Windows incremental cost is the full baseline clone at page start; handle that separately only if a safe copy-on-write/delta mutation design can preserve reconciliation semantics.

### Windows same-path file journal baseline-clone bypass contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- ordinary Windows CfAPI remote change-journal page after the baseline is loaded;
- stable structural workload: **100,001 baseline entries** (root + 100,000 files) and one same-path upsert for an already-known file node;
- the file has no unsynchronized local edit, Always Local is disabled, and cache-limit enforcement is disabled;
- evidence method: deterministic bounded-snapshot helper test plus production source-shape regression; no wall-clock speedup is quoted.

BEFORE:

- `applyRemoteChangePage` cloned the complete `p.baseline` before it knew whether the page only touched one ordinary file;
- it also cloned the complete hydrated timestamp map;
- one same-path file revision update in a 100k baseline therefore copied **100,001 baseline entries** before any path-specific work.

AFTER / current:

- a conservative fast path runs before `cloneBaseline`;
- it accepts only unique, same-path, already-known file upserts whose node ID, parent ID and filename still match the exact baseline path entry;
- it snapshots only the touched file state plus that file's hydration timestamp, preflights local-modification conflict state before any mutation, then applies the existing placeholder replacement semantics;
- memory baseline persistence merges only changed file paths and appends the already-supported path delta without constructing a full current-map copy;
- the same workload performs **0 full baseline clones** and **0 full hydrated-map clones** on the journal page;
- when persistence is disabled (`statePath == ""`), the delta path returns without snapshotting global state;
- if the baseline state file is missing or compaction is due, persistence deliberately snapshots the full current baseline at that exceptional boundary;
- file rename/move, delete, directory changes, excluded paths, duplicate page entries, local unsynchronized conflicts, Always Local, cache-limit enforcement, reset/full reconciliation, and unsupported node types all retain the existing full-baseline implementation.

Decision: **Accepted.** Same-path existing-file upserts have exact-key baseline semantics and do not need namespace-wide copy-on-write state. Restricting the fast path keeps every subtree/conflict/policy-sensitive case on the established code path.

Regression budget: one eligible same-path file-only journal page must not call `cloneBaseline` or `cloneHydrated` before applying the update. The fast-path snapshot size must remain **O(changes)**, not O(baseline entries).

Regression commands:

- `go test ./internal/mount -run '^TestWindowsRemoteJournal(SamePathFileUpsertSnapshotIsBounded|FastPathPrecedesBaselineClone|PathUpdatePersistsWithoutFullCurrentMap)$' -count=1`.

Next action: continue ordinary FileExplorer download/sync/delete performance auditing; do not broaden this fast path into rename/delete/directory/conflict handling without separate evidence.

### Windows exact file-delete journal baseline-clone bypass contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- ordinary Windows CfAPI remote change-journal page after the baseline is loaded;
- stable structural workload: **100,001 baseline entries** (root + 100,000 files) and one remote delete for an already-known file;
- the delete is an ordinary xDrive soft delete whose deleted Node row still retains its name/parent chain;
- evidence method: changes API opt-in integration contract + deterministic 100k bounded-snapshot/source-shape tests; no wall-clock speedup is quoted.

BEFORE:

- the default changes API emitted delete events without a path;
- Windows therefore could not do an exact baseline-key lookup for delete and entered the generic journal path;
- that path cloned the full baseline and hydrated map before processing the page and lazily built a full nodeID -> path index for the delete;
- one known-file delete in a 100k baseline therefore performed **1 full baseline clone + 1 full hydrated-map clone + 1 full baseline index-build scan**.

AFTER / current:

- the existing changes API keeps its default response/query cost unchanged for Web/FileExplorer polling;
- Windows explicitly requests `include_deleted_paths=true`; only that request resolves retained soft-deleted node paths with one owner-scoped recursive CTE for the page;
- hard-deleted/unresolvable nodes continue to return an empty path;
- Windows accepts the fast path only when every change is a unique file delete whose supplied path exactly maps to the same baseline node ID/type/name and whose parent path is still known;
- eligible pages snapshot only the touched file state and hydration timestamp, preserve the existing unsynchronized-local-change conflict check, remove the exact local files, and append a path-delete baseline delta;
- the same 100k workload performs **0 full baseline clones**, **0 full hydrated-map clones**, and **0 nodeID full-map index builds**;
- empty path, node/path mismatch, directory delete, excluded/Always Local/cache-limit policy, and local modification conflicts retain the established path.

Decision: **Accepted.** The Server metadata work is opt-in and batched, while exact known-file deletion has path-local baseline semantics. Hard deletes and subtree-sensitive cases remain conservative.

Regression budget: one eligible exact file-delete page must not call `cloneBaseline`, `cloneHydrated`, or scan `p.baseline` before applying the delete. The fast-path snapshot must remain **O(changes)**. Default `/changes` requests must not resolve deleted paths. Local unsynchronized modifications must still block the remote delete without removing the file or baseline entry.

Regression commands:

- `go test ./internal/api -run '^TestNodeChangeJournalLifecycleAndOwnerScope
- `go test ./internal/client -run '^TestNodeChanges' -count=1`;
- `go test ./internal/mount -run '^TestWindowsRemoteJournal(SamePathFileDeleteSnapshotIsBounded|FileDeleteFastPathPrecedesBaselineClone|FileDeleteFastPathPreservesLocalConflict|FileDeletePathDeltaPersistsWithoutFullCurrentMap)$' -count=1`.

Next action: continue ordinary FileExplorer download/sync/delete performance auditing and only change another deterministic request, SQL, allocation, filesystem, lock, or object-store multiplier.


### FileOperation Delete root-update coalescing contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- durable FileOperation Delete execution used by FileExplorer;
- stable workload: **120 top-level sibling files**, each with current File metadata;
- PostgreSQL integration invokes the real `executeQueuedBatchDelete` path and counts only `UPDATE xd_nodes` statements during execution;
- roots are loaded by `batchLoadNodesTx(..., preload=true)`, which takes `FOR UPDATE` locks and validates every requested revision before mutation;
- the BEFORE baseline was validated by the phase-1 authoritative API race run before production code changed;
- wall-clock timing is intentionally not quoted.

BEFORE:

- each root subtree is marked deleted/trash-root with one `xd_nodes` UPDATE;
- each already locked/revision-validated root then receives a second `xd_nodes` UPDATE only to increment root revision/update time;
- **120 roots -> 240 `xd_nodes` UPDATE statements**.

AFTER / current:

- one root-scoped SQL statement marks active subtree rows deleted, assigns `trash_root_id`, increments only the selected root revision, and updates timestamps;
- the same statement carries a root revision precondition and returns whether that exact root was updated, preserving the old defensive revision-conflict outcome even though roots are already locked;
- a selected root already soft-deleted earlier in the same transaction keeps its existing `deleted_at` / `trash_root_id` while still receiving the same revision +1 / `updated_at` mutation as before;
- **120 roots -> 120 `xd_nodes` UPDATE statements**;
- Share revocation remains one statement per root and different roots are intentionally not batched, preserving per-root progress/cancellation checkpoints and trash-root identity.

Decision: **Accepted.** The second root-only statement repeated mutation work already guarded by the selected-root lock/revision validation. Folding it into the subtree statement removes one SQL round trip per root without changing Delete ordering, undo-plan revisions, cancellation checkpoints, or Trash semantics.

Regression budget: Delete execution must perform at most **1 `xd_nodes` UPDATE per selected top-level root**. Root revision mismatch must mutate zero subtree rows and surface the existing `revision_conflict`; an already-deleted selected root must preserve its prior Trash identity while still receiving the revision bump.

Regression commands:

- `go test ./internal/api -run '^TestFileOperationDelete(NodeUpdatesCoalesced|RootsAreRevisionLockedBeforeMutation)$|^TestMarkFileOperationDeleteSubtreePreservesSemantics$' -count=1`.

Next action: continue ordinary FileExplorer **upload-finalize / download / sync / delete** performance auditing; the remaining larger Windows incremental cost is the full baseline clone at journal-page start.

### Resumable upload incremental reservation bookkeeping contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- ordinary resumable FileExplorer upload after a session is created; this is **not a first-open or 100k listing workload**;
- stable structural workload: **128 newly uploaded chunks** in one active session, matching a 1 GiB file at the default 8 MiB chunk size;
- evidence method: PostgreSQL statement capture around the reservation bookkeeping path plus the existing resumable-upload integration assertions; no wall-clock speedup is quoted.

BEFORE:

- every successful chunk insert called `refreshUploadReservation`;
- that helper selected **all UploadPart rows already recorded for the session** and summed them in Go before one `reserved_bytes` UPDATE;
- 128 sequential new chunks therefore executed **128 full-session UploadPart SELECTs** and materialized **1 + 2 + ... + 128 = 8,256 UploadPart rows** only to maintain the reservation counter;
- idempotent same-hash chunk retries still return before this path, and are unchanged.

AFTER / current:

- the upload transaction already holds the UploadSession row lock and knows the previous part size and the newly committed part size;
- normal chunk inserts update `reserved_bytes` from that byte delta with **0 full-session UploadPart SELECTs**;
- same-size part replacement requires **0 reservation UPDATEs** because received-byte coverage is unchanged;
- invalid or legacy-inconsistent reservation state falls back to the existing full recomputation, preserving capacity safety rather than trusting a bad counter;
- resume-time repair/recalculation, chunk hashing, object writes, quota reservation, session expiry, and finalize semantics are unchanged.

Decision: **Accepted.** Reservation state is a deterministic function of the already locked session counter plus the committed part-size delta, so rescanning every previously received chunk on each new chunk adds no information on the normal path.

Regression budget: a valid active upload must perform **0 full-session UploadPart scans per newly committed chunk** for reservation maintenance. The fallback full scan remains required only for inconsistent reservation state.

Regression command:

- `go test ./internal/api -run '^TestUploadChunkReservationUsesIncrementalBookkeeping$' -count=1`.

Next action: continue ordinary FileExplorer **upload-finalize / download / sync / delete** performance auditing; do not optimize 100k first-open behavior.

 -count=1`;
- `go test ./internal/client -run '^TestNodeChanges' -count=1`;
- `go test ./internal/mount -run '^TestWindowsRemoteJournal(SamePathFileDeleteSnapshotIsBounded|FileDeleteFastPathPrecedesBaselineClone|FileDeleteFastPathPreservesLocalConflict|FileDeletePathDeltaPersistsWithoutFullCurrentMap)$' -count=1`.

Next action: continue ordinary FileExplorer download/sync/delete performance auditing and only change another deterministic request, SQL, allocation, filesystem, lock, or object-store multiplier.


### FileOperation Delete root-update coalescing contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- durable FileOperation Delete execution used by FileExplorer;
- stable workload: **120 top-level sibling files**, each with current File metadata;
- PostgreSQL integration invokes the real `executeQueuedBatchDelete` path and counts only `UPDATE xd_nodes` statements during execution;
- roots are loaded by `batchLoadNodesTx(..., preload=true)`, which takes `FOR UPDATE` locks and validates every requested revision before mutation;
- the BEFORE baseline was validated by the phase-1 authoritative API race run before production code changed;
- wall-clock timing is intentionally not quoted.

BEFORE:

- each root subtree is marked deleted/trash-root with one `xd_nodes` UPDATE;
- each already locked/revision-validated root then receives a second `xd_nodes` UPDATE only to increment root revision/update time;
- **120 roots -> 240 `xd_nodes` UPDATE statements**.

AFTER / current:

- one root-scoped SQL statement marks active subtree rows deleted, assigns `trash_root_id`, increments only the selected root revision, and updates timestamps;
- the same statement carries a root revision precondition and returns whether that exact root was updated, preserving the old defensive revision-conflict outcome even though roots are already locked;
- a selected root already soft-deleted earlier in the same transaction keeps its existing `deleted_at` / `trash_root_id` while still receiving the same revision +1 / `updated_at` mutation as before;
- **120 roots -> 120 `xd_nodes` UPDATE statements**;
- Share revocation remains one statement per root and different roots are intentionally not batched, preserving per-root progress/cancellation checkpoints and trash-root identity.

Decision: **Accepted.** The second root-only statement repeated mutation work already guarded by the selected-root lock/revision validation. Folding it into the subtree statement removes one SQL round trip per root without changing Delete ordering, undo-plan revisions, cancellation checkpoints, or Trash semantics.

Regression budget: Delete execution must perform at most **1 `xd_nodes` UPDATE per selected top-level root**. Root revision mismatch must mutate zero subtree rows and surface the existing `revision_conflict`; an already-deleted selected root must preserve its prior Trash identity while still receiving the revision bump.

Regression commands:

- `go test ./internal/api -run '^TestFileOperationDelete(NodeUpdatesCoalesced|RootsAreRevisionLockedBeforeMutation)$|^TestMarkFileOperationDeleteSubtreePreservesSemantics$' -count=1`.

Next action: continue ordinary FileExplorer **upload-finalize / download / sync / delete** performance auditing; the remaining larger Windows incremental cost is the full baseline clone at journal-page start.

### Resumable upload incremental reservation bookkeeping contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- ordinary resumable FileExplorer upload after a session is created; this is **not a first-open or 100k listing workload**;
- stable structural workload: **128 newly uploaded chunks** in one active session, matching a 1 GiB file at the default 8 MiB chunk size;
- evidence method: PostgreSQL statement capture around the reservation bookkeeping path plus the existing resumable-upload integration assertions; no wall-clock speedup is quoted.

BEFORE:

- every successful chunk insert called `refreshUploadReservation`;
- that helper selected **all UploadPart rows already recorded for the session** and summed them in Go before one `reserved_bytes` UPDATE;
- 128 sequential new chunks therefore executed **128 full-session UploadPart SELECTs** and materialized **1 + 2 + ... + 128 = 8,256 UploadPart rows** only to maintain the reservation counter;
- idempotent same-hash chunk retries still return before this path, and are unchanged.

AFTER / current:

- the upload transaction already holds the UploadSession row lock and knows the previous part size and the newly committed part size;
- normal chunk inserts update `reserved_bytes` from that byte delta with **0 full-session UploadPart SELECTs**;
- same-size part replacement requires **0 reservation UPDATEs** because received-byte coverage is unchanged;
- invalid or legacy-inconsistent reservation state falls back to the existing full recomputation, preserving capacity safety rather than trusting a bad counter;
- resume-time repair/recalculation, chunk hashing, object writes, quota reservation, session expiry, and finalize semantics are unchanged.

Decision: **Accepted.** Reservation state is a deterministic function of the already locked session counter plus the committed part-size delta, so rescanning every previously received chunk on each new chunk adds no information on the normal path.

Regression budget: a valid active upload must perform **0 full-session UploadPart scans per newly committed chunk** for reservation maintenance. The fallback full scan remains required only for inconsistent reservation state.

Regression command:

- `go test ./internal/api -run '^TestUploadChunkReservationUsesIncrementalBookkeeping$' -count=1`.

Next action: continue ordinary FileExplorer **upload-finalize / download / sync / delete** performance auditing; do not optimize 100k first-open behavior.



### Web/Desktop 1 GiB large-transfer baseline

Status: **Measured / Web optimization follow-up approved**.

This benchmark is measurement-only. It follows the performance policy: establish the current production-path baseline first, then change production code only if the same stable workload exposes a material bottleneck.

Stable workload:

- payload: **1 GiB**, one file, loopback HTTP to remove Internet variance;
- Web upload: real production `XDriveApi.uploadWithConflictPolicy`, a real OS sparse 1 GiB file injected into a Chromium file input, 8 MiB resumable chunks, production pre-hash plus upload-time rehash retained;
- Web download: real production `XDriveApi.download` and `xDriveWriteWebDownloadToSink`, writing the 1 GiB response into a real OPFS `FileSystemWritableFileStream`;
- additional Web `download-discard`: identical production fetch/progress/sink call chain with a no-storage writable, used only to separate renderer/fetch allocation from OPFS storage cost;
- Desktop/Agent upload: real shared Go resumable-upload client plus Transfer Manager progress and the production `agentUploadTransferContext` network observer on a sparse 1 GiB filesystem file;
- Desktop/Agent download: real Agent `downloadAgentCloudFileIntoPath` staging path, including temporary-file write, `fsync`, close and final replace;
- fixture creation is outside the timed interval;
- **3 fresh processes per primary surface/direction**, plus 3 Web discard diagnostics.

Predeclared red signals, set before results:

- Web renderer peak working set **>512 MiB**;
- Web renderer working-set increase **>256 MiB**;
- Web JS heap increase **>128 MiB**;
- Desktop/Agent RSS increase **>128 MiB**;
- any 1 GiB loopback sample **>=60 s**;
- upload must transfer exactly **128 x 8 MiB** chunks with no retries; download must stream exactly **1 GiB**.

Measured BEFORE medians [min, max]:

| Surface / scenario | Elapsed | Throughput | Process / renderer memory delta | JS heap delta | Dominant phase |
| --- | ---: | ---: | ---: | ---: | ---: |
| Desktop/Agent upload | **2.373 s** [2.347, 2.390] | **431.6 MiB/s** [428.5, 436.3] | **+19.3 MiB RSS** [19.3, 19.4] | n/a | pre-hash **1.301 s** [1.298, 1.311] |
| Desktop/Agent download | **6.175 s** [5.875, 6.411] | **165.8 MiB/s** [159.7, 174.3] | **+3.2 MiB RSS** [3.1, 3.2] | n/a | streamed file write/fsync path |
| Web upload | **7.914 s** [7.558, 7.974] | **129.4 MiB/s** [128.4, 135.5] | **+927.1 MiB renderer WS** [747.9, 934.3] | **+471.8 MiB** [384.4, 472.5] | chunks **5.841 s** [5.496, 5.968]; pre-hash **2.056 s** [2.000, 2.067] |
| Web download / OPFS | **3.814 s** [3.757, 3.816] | **268.5 MiB/s** [268.3, 272.6] | **+369.1 MiB renderer WS** [361.4, 373.8] | **+313.8 MiB** [290.4, 314.4] | response-stream/write **3.810 s** [3.754, 3.812] |
| Web download / discard diagnostic | **1.142 s** [1.126, 1.193] | **896.4 MiB/s** [858.7, 909.2] | **+975.9 MiB renderer WS** [715.6, 1407.9] | **+227.9 MiB** [208.0, 476.1] | response-stream/write **1.139 s** [1.123, 1.189] |

Payload correctness held in every sample:

- Web/Agent upload transferred exactly **1,073,741,824 bytes**;
- upload emitted exactly **128 x 8 MiB chunks** with no retry/extra payload;
- every download streamed exactly **1,073,741,824 bytes**.

Decision:

- **Desktop/Agent: Accepted / no production change.** RSS is comfortably bounded and runtime is far below the 60 s diagnostic red signal. The upload pre-hash is the largest single Agent phase but there is no memory/runtime red signal that justifies weakening the intentional pre-hash + upload-time rehash integrity contract.
- **Web: red / production follow-up approved.** Upload exceeds both Web memory-delta budgets by a wide margin. Normal download also exceeds both memory-delta budgets.
- The discard diagnostic still exceeds the Web memory budgets even without OPFS writes. Therefore the Web issue cannot be attributed solely to the File System Access storage backend; the next experiment should isolate renderer fetch/chunk allocation and backpressure/GC behavior.
- The next production PR must preserve direct-to-disk behavior, byte progress, resumable upload semantics, full pre-hash plus upload-time integrity verification, and exact payload counts. It must rerun this **same 1 GiB workload** and only be kept if the memory reduction is material and repeatable without a meaningful throughput regression.
- **Do not run 4 GiB yet.** The 1 GiB Web renderer is not memory-bounded enough to justify scaling the workload.

Branch-scoped commands are implemented by the GitHub/GitLab `large-transfer-web-performance` and `large-transfer-agent-performance` jobs on `perf/large-transfer-1gib-baseline`.


## Current 100k local baseline — 2026-10-09

Status: **Measured baseline / no production experiment selected**. Exact measured source: `3a35c385ecc953d31a9ca2b81b75e9be4f569ea2`; the relevant measured FileExplorer sources are unchanged at this follow-up's selected base `d45a894ef19e03b3cdc90dcfde2cd91fef002bbf`. Measurements ran in an isolated detached worktree with unchanged production source, no race flags/suites, and a shared `flock` to serialize benchmark/build loads. This section is freshly measured local evidence, separate from historical CI tables above. No comparable production BEFORE/AFTER speedup is claimed.

### Controller and SQL

| Named workload | Exact scale / sampling | Fresh result | Included layers / budget |
| --- | --- | --- | --- |
| VirtualCollection sweep | 100,000 logical items, viewport 40, pages 200, 2,500 viewport updates; warmup then 5 samples x 10 sweeps | CPU median **110.692 ms/sweep / 44.277 us per viewport**; wall 109.526 ms; **500 page loads / 800 peak / 600 final retained** | Node/V8 controller only; stable structural budget passed, no React/browser/transport/decode. |
| Directory simple-name fixture | 100,000 child Nodes, first/middle 200-row page; warmup + 3 samples | **160.203 / 196.046 ms** medians | Real Gin handler via in-process request helper + PGlite SQL. Existing 500/750 ms gates passed; no browser. |
| Search counted range | 100,000 matching file Nodes, 200 rows; warmup + 3 samples | First/middle **716.662 / 944.693 ms** | Direct production Go helpers + PGlite SQL, no HTTP/browser. Both harness ranges request `includeCount=true`; this is not later count-free viewport coverage. No timing gate in this test. |
| Search cursor | Same 100k namespace / 3 samples | First/middle **629.640 / 559.398 ms** | Direct production Go helpers + PGlite SQL; diagnostic timing. |

The available database was **PGlite 0.5.8**, socket adapter **0.2.11**, PostgreSQL compiled to WASM on isolated loopback port 55439. It is not native PostgreSQL: do not compare these absolute timings to native-PG CI or infer an index/SQL regression. Native-PG count-once and expression-sort A/B histories remain the qualification evidence for those optimizations.

### Synthetic production-bundle Grid replay

Chromium **153.0.8010.0 headless**, original full Web/Desktop renderer bundles, 1280 x 800, 100,000 logical items, 200-row sparse pages. Three fresh browser-context samples per case; 36 paced scroll steps plus midpoint/end/top jumps, native mouse marquee, thumbnail settle. React/ReactDOM 18.3.1 and MUI 7.3.11; reused available dependency installs with own-worktree `@xdrive/ui`, Web Vite 6.4.3 / Desktop Vite 6.1.0.

| Scenario | Web first-grid median [min,max], ms | Desktop renderer first-grid median [min,max], ms | Web / Desktop scripted duration medians, ms |
| --- | ---: | ---: | ---: |
| Image cold | 216.8 [187.6,526.9] | 227.9 [194.0,257.5] | 3271.1 / 3824.4 |
| Image warm | 201.7 [188.2,245.9] | 258.9 [198.8,269.6] | 3203.2 / 3356.1 |
| Video poster cold | 233.1 [189.7,285.9] | 185.0 [181.6,261.9] | 3945.1 / 3148.9 |
| Video poster warm | 246.1 [226.6,258.6] | 242.3 [215.0,444.5] | 3717.5 / 3029.7 |

All **24 samples passed** original structural guards: max mounted **110 (<1000)**, peak retained **1200 (<=1200)**, thumbnail in-flight **6 cold / 1 warm (<=6)**, warm requests **<=230 (<=600)**. Every sample had 14 range changes, 80 initial mounted items, 13 selection commits, and 18 selected. These measurements include real React layout/scroll/selection, scheduler admission, Blob URLs and SVG decode; callbacks replay **12 ms cold / zero warm**. They exclude real JPEG/MP4 generation, Server/DB, Electron IPC and Agent. First-grid clock begins inside the mounted harness and excludes route/bundle startup. Script duration includes intentional pacing and is not a complete 100k traversal/decode time. No fresh Electron RSS/FPS trace was collected. Timing is diagnostic and not comparable with historical Electron/Xvfb samples; no repeatable threshold breach justifies a product change.

### Real image HTTP/store cold and warm

Original `TestFileExplorerMediaServerObjectStorePerformance100K`: **100k image Nodes + 100k metadata-only video Nodes**, **128 physical 800 x 600 JPEG CAS originals**, **102 distinct originals** sampled across three ranges, concurrency **6**. Range offsets 0/50,000/99,800 each use three samples. Includes real Gin/loopback HTTP, production Go JPEG decode/generation and derivative scheduler, `storage.Local`, and PGlite DB; excludes renderer/Agent.

| Scenario | Counted range top/middle/end medians, ms | Thumbnail batch / p50 / p95, ms | Response bytes | Store work |
| --- | ---: | ---: | ---: | --- |
| Image cold | 299.749 / 374.172 / 376.343 | **765.719 / 43.350 / 68.519** | 2,610,039 | 102 original opens / 204 derivative opens / 102 puts |
| Image warm | Same previously measured ranges | **100.413 / 5.200 / 9.185** | 2,610,039 | 0 original opens / 102 derivative opens / 0 puts |
| Legacy video metadata fixture | 279.463 / 362.078 / 370.245 | No media GET | None | 0 opens / 0 puts |

The image cache assertions passed; cold/warm difference describes cache state, not an optimization. The existing `video-icons` case uses fake storage key `perf-video-icon-fallback` and metadata listing only. It does **not** validate current cold preview/codec/poster-backfill or warm persistent-poster behavior.

### Commands, evidence and next action

The scratch root was `/workspace/scratch/4fa175e5d1c9`; commands ran under `flock <scratch-root>/perf-bench.lock`:

- Controller: `XD_FILEEXPLORER_VIRTUAL_COLLECTION_PERF=1 node --expose-gc --test desktop/tests/file-explorer-virtual-collection-performance.cjs`.
- Renderer build per app: `VITE_XDRIVE_FILE_EXPLORER_PERF=1 node node_modules/vite/bin/vite.js build --config vite.config.ts`; explicit Web TS config avoids stale generated `vite.config.js`. Driver: `node <scratch-root>/100k-renderer.cjs`.
- API binary: `go test -p 1 -c -o <scratch-root>/api-100k.test ./internal/api`; isolated adapter: `node <scratch-root>/100k-pglite.mjs <test>` for `TestFileExplorerDirectoryPerformanceBaseline100K`, `TestFileExplorerSearchPerformanceBaseline100K`, `TestFileExplorerMediaServerObjectStorePerformance100K`. Adapter supplies test DB simple protocol and opt-in variables.
- FileExplorer source guards: `node --test desktop/tests/file-explorer-performance.cjs`, **22/22 passed**.

Raw evidence: `100k-renderer-all.json` (24 rows), `100k-renderer-results/*.json`, `100k-controller.log`, `100k-directory-pglite.log`, `100k-search-pglite.log`, `100k-media-server-pglite.log`, `100k-renderer.log`, `100k-structural.log`, with `file-explorer-100k-baseline.md` and reproducible scratch drivers. Optional count-once repeat was interrupted at the parent's request and produced no accepted metric.

Decision: keep controller, Grid, scheduler/cache and image Server production code unchanged. Fresh Windows/CfAPI 100k runtime, Details 100k browser, real browser-to-Server video/LIVP, and end-to-end 100k sync/delete remain unmeasured here; existing smaller structural contracts are not relabeled as fresh 100k wall-time coverage.

The next **measurement-only** extension should reuse `FileExplorerPerformanceHarness.tsx` and `file_explorer_media_performance_integration_test.go` with actual children/media HTTP adapters, not introduce another production optimization. Seed 100k file metadata per dataset with **128 distinct physical CAS fixtures** and sample a bounded working set; do not download 100k originals. Reuse real H.264 MP4 `galleryFirstVisibleVideoMP4Base64` (96 x 64, not a high-resolution codec claim), `fileExplorerMediaPerfJPEG` (800 x 600), existing LIVP archive builders and production `InspectLIVP` validation. Distinct legal MP4 `free`-box variants must be decode-validated to prevent cold requests collapsing into one SHA/cache key.

Cold video must measure actual missing-poster GET -> authenticated preview ticket/stream -> production poster capture -> revision-fenced PUT -> decoded image. Warm uses persisted Server poster with fresh renderer cache and proves zero preview/PUT. LIVP measures real still extraction/derivative-cache -> decoded still and `.livp` glyph, with zero HTTP motion requests during ordinary Grid (not a claim of zero container storage reads). Record first/first12 decode, preview/poster bytes, request/store counters, long tasks, cache state and existing <=6 in-flight / 96 cache / <=1200 retained / <1000 mounted bounds. Web real HTTP first; only actual Electron/preload/Agent ArrayBuffer/poster plumbing can qualify Desktop end-to-end. Declare timing gates before experiments, after runtime variance is understood.

## Current 4 GiB Agent baseline — 2026-10-09

Full local sample values, environment, source revisions and qualification notes are retained in [the baseline evidence record](performance/2026-10-09-local-baselines.json). Current native CI results are recorded separately below.

Status: **Measured baseline / memory budget passed / no production change**. Exact Agent source `62e399f4fd257a49f318e6c223cd697339ca2a27`; only the performance harness was parameterized for size/throughput, fresh sample label and 10 ms RSS sampler. Each direction ran **three fresh test-binary processes**, serialized by the same lock, Go 1.25.0/linux-amd64, Linux 6.18.44, 8 GiB cgroup limit, local overlayfs and loopback HTTP. Source is sparse zero-filled **4,294,967,296 B**. Downloads use the production temporary-file write/fsync/close/final replace. These are not physical-disk, Internet, Server/CAS, Electron IPC or Windows CfAPI results and are not paired with the historical 1 GiB CI environment.

| Direction | Elapsed median [min,max] | Throughput median | Process RSS delta median [min,max] | Additional validation |
| --- | ---: | ---: | ---: | --- |
| Upload | **11.466 s [10.898,11.606]** | **357.2 MiB/s** | **22.48 MiB [21.95,22.49]** | 512 x 8 MiB chunks; pre-hash median 5.908 s; exact payload each sample |
| Download | **2.638 s [2.504,3.098]** | **1552.9 MiB/s** | **2.469 MiB [2.281,3.070]** | Exact payload each sample; one temporary download at a time |

RSS comes from `/proc/self/status` `VmRSS` every 10 ms with ready/join synchronization, initial forced GC, no forced GC during measurement, and final RSS included. Existing **<=128 MiB RSS delta** acceptance passes in all six samples; keep Agent production unchanged. This Agent-only scale-up does not authorize scaling the still-red Web renderer to 4 GiB.

Command per direction/sample: `XD_LARGE_TRANSFER_PERF=1 XD_LARGE_TRANSFER_SIZE_GIB=4 XD_LARGE_TRANSFER_SCENARIO=<upload|download> XD_LARGE_TRANSFER_SAMPLE=sample-<1|2|3> XD_LARGE_TRANSFER_PERF_OUTPUT=<results> <agent-perf.test> -test.run '^TestLargeTransferPerformanceBaselineLargeFile$' -test.count=1 -test.v`, under the shared `flock`. The committed baseline evidence record includes all six rows, source/binary/harness hashes and the benchmark-only harness delta; original scratch artifacts were `agent-4gib/results/summary-provenance.json` and `agent-4gib/harness.patch`. The completed branch-scoped native CI rerun uses the same 4 GiB parameter; its separate authoritative result is recorded below, without substituting it for or claiming a speedup against the local baseline.


## Native CI baselines — PR #1067 (2026-10-09)

Status: **Measured native baseline / structural and memory budgets passed / no production change**. Initial [run 37869011944](https://github.com/lazyxu/xdrive/actions/runs/37869011944) succeeded for both workloads below. The fixed branch base is `d45a894ef19e03b3cdc90dcfde2cd91fef002bbf`, PR head **`95258eb5cc71214536b7a3b491ffaa5174abfa1d`**. Both job checkout logs prove actual tested SHA **`86cf14e1724c1f2bdced4d34be04ec60cea75ed8`**, GitHub's synthetic merge into then-current master **`23b3f216b7e9b37222cbfeb7ff9be2812cad2f87`**. These are integration-tree results, not measurements of the fixed branch head alone. [The committed native evidence record](performance/2026-10-09-native-baselines.json) retains exact sample rows, commands, job/runtime/artifact provenance and checkout evidence. No headless-to-native, PGlite-to-PostgreSQL, 1-to-4-GiB or historical speedup is claimed.

### Real FileExplorer image HTTP/object-store: native PostgreSQL

Job **113622479830**, Ubuntu **24.04.5** runner image **20261004.327.1**, Go **1.25.14 linux/amd64**, native PostgreSQL **17.11** (`postgres:17-alpine`). Original `TestFileExplorerMediaServerObjectStorePerformance100K`, real Gin/loopback HTTP, production derivative scheduling/JPEG decode, `storage.Local`. **100k image Nodes + 100k legacy metadata-only video Nodes**, **128 physical 800 x 600 JPEG CAS originals**, **102 distinct originals** requested across offsets 0/50,000/99,800. One test process; three samples per counted metadata range, one cold and one warm batch; observed peak HTTP concurrency **6** in each batch.

| Scenario | Counted first/middle/end range medians, ms | Thumbnail batch / p50 / p95, ms | Response bytes | Store counters |
| --- | ---: | ---: | ---: | --- |
| Image cold | 137.973 / 125.127 / 207.005 | **737.958 / 39.121 / 65.610** | 2,610,039 | 102 original opens / 204 derivative opens / 102 puts |
| Image warm | Same already-measured image ranges | **36.167 / 1.866 / 4.374** | 2,610,039 | 0 original opens / 102 derivative opens / 0 puts |
| Legacy video metadata | 136.871 / 185.323 / 192.700 | No thumbnail/media requests | None | 0 object-store opens / 0 puts |

Decision: **keep Server image generation/cache production unchanged**. Exact request/response counts, **<=6** concurrency, and cold generation/warm-cache assertions pass. This fixture has no hard numeric latency gate; wall times remain measured diagnostics. Cold/warm differences are cache-state measurements, not a production optimization. The `video-icons` dataset still uses fake storage key `perf-video-icon-fallback` and does not validate the current video preview/decode/backfill path. No browser render or Agent IPC is included. The documented real FileExplorer video/LIVP HTTP benchmark remains the next measurement-only extension.

Command: `XD_FILEEXPLORER_MEDIA_SERVER_PERF=1 go test -run '^TestFileExplorerMediaServerObjectStorePerformance100K$' -count=1 -v ./internal/api`, with the native CI PostgreSQL service. This job's separate Gallery first-56 mixed-media qualification is recorded in [Gallery performance](gallery-performance.md#native-ci-baseline--pr-1067-2026-10-09).

### Agent 4 GiB: six fresh native processes

Job **113622480003**, same Ubuntu runner image, Go **1.25.14 linux/amd64**; **three fresh processes per direction**, no test cache. Payload **4,294,967,296 bytes** in every sample; upload exactly **512 x 8 MiB chunks**. Native Go Agent core and loopback mock HTTP, sparse zero-filled source file, production download temporary-file write/fsync/close/final replace. No real Server/CAS, Electron IPC, Windows CfAPI or external network; underlying runner filesystem characteristics were not collected and these are not dedicated physical-disk bandwidth measurements.

| Direction | Elapsed median [min,max] | Throughput median | Process RSS peak median | RSS delta median [min,max] | Integrity/phase evidence |
| --- | ---: | ---: | ---: | ---: | --- |
| Upload | **10.987 s [10.897,11.073]** | **372.8 MiB/s** | 37.699 MiB | **23.523 MiB [23.469,23.563]** | Exact 4 GiB / 512 chunks; pre-hash **6.054 s [6.041,6.088]** |
| Download | **11.414 s [11.411,11.437]** | **358.9 MiB/s** | 17.648 MiB | **3.414 MiB [3.406,3.504]** | Exact 4 GiB each; one temporary download at a time |

RSS is a **10 ms `/proc/self/status` process sampler**, synchronized at start/end, including final RSS. Initial GC occurs before timing; no forced GC occurs during timing. The existing **<=128 MiB process RSS delta** budget passes in **all six samples**. Byte/chunk correctness is enforced by the test; the memory budget is independently evaluated from emitted rows rather than inferred from a green job. **Decision: keep Agent production unchanged.** Different runtime/filesystem conditions prevent a paired timing comparison against the local 4 GiB or historical 1 GiB results. This does not qualify the separately red Web baseline or authorize a Web 4 GiB run.

Command per scenario/sample: `XD_LARGE_TRANSFER_PERF=1 XD_LARGE_TRANSFER_SIZE_GIB=4 XD_LARGE_TRANSFER_SCENARIO=<upload|download> XD_LARGE_TRANSFER_SAMPLE=sample-<1|2|3> XD_LARGE_TRANSFER_PERF_OUTPUT=<results> go test -run '^TestLargeTransferPerformanceBaselineLargeFile$' -count=1 -v ./cmd/xdrive-agent`. Artifact **11589288631**, SHA-256 `07a42da57edf57d080ba4b5ec14bb4ff4947f31e8f3b48663c8672140fbc918c`, expires 2026-10-16; all six raw rows and provenance remain committed after artifact expiry. The updated evidence must be amended into the same measurement commit and pass the resulting full PR CI before merge.

## Web 1 GiB renderer-memory A/B gate

Status: **Rejected / original Blob-body and native-pipeTo experiment**. The following proposal and 10% timing rule are preserved as historical declarations for `ac4571d5`; the final continuation below uses the stricter fixed 5% median nonregression gate.

The accepted 1 GiB baseline is repeatably red only on Web. Before this production experiment, the acceptance rule is fixed:

- rerun the exact same 1 GiB Web upload / OPFS download / discard workload with **3 fresh renderer processes per scenario**;
- Web median **JS-heap delta must improve by at least 50%** for the scenario whose production path changed;
- Web median **renderer working-set delta must improve by at least 50%** for that scenario;
- preferred steady-state budget remains **<=128 MiB JS heap delta** and **<=256 MiB renderer working-set delta**;
- throughput must not regress materially; a median regression above **10%** rejects the candidate unless paired repeat samples demonstrate hosted-runner noise;
- upload must remain exactly **128 x 8 MiB / 1 GiB** with full pre-hash and upload-time rehash;
- download must remain exactly **1 GiB**, direct-to-disk, cancellable, and progress-visible;
- each candidate is judged separately. A successful upload change cannot justify retaining an ineffective download change, or vice versa.

Candidate A / upload: keep the temporary ArrayBuffer only inside SHA-256 calculation and send the original 8 MiB File-slice Blob through XHR. This preserves the two-pass integrity contract while avoiding deliberate retention of the hash ArrayBuffer as the request body.

Candidate B / download: when the destination is a native WritableStream (the File System Access path), let the browser's Streams pipeline own pull/backpressure via `pipeTo`; a progress TransformStream was intended to preserve byte reporting. The failed-write probe below demonstrated premature progress publication in that candidate. The manual one-write-at-a-time loop remains as the compatibility/test fallback.

If either candidate misses the declared improvement gate, revert that candidate and record it as rejected rather than keeping a speculative production change.


## PR #1063 continuation: reusable Web BYOB buffers

Status: **Accepted / initial paired CI and current 4 GiB passed**. Continue the existing [PR #1063](https://github.com/lazyxu/xdrive/pull/1063), replacing its rejected production candidates; no new parallel implementation is implied. Original baseline PR #1053 merged as `62e399f4fd257a49f318e6c223cd697339ca2a27`. Its measured heads were `e1faa4881417cf5bbdf95ccc346e01f1fbcd3642` and `2ca7f021be433f08db428b87a0d4dbb4c21c8887`; their production and harness trees are identical, with only the recorded performance documentation changed. Final experiments reconstruct original production from immutable `2ca7f021`, then use the corrected ready/start measurement harness identified by `8cfdcd71`.

### Frozen final acceptance before final CI

For each changed upload/OPFS-download scenario, three fresh BEFORE/AFTER renderer samples must satisfy **all** of these requirements: median JS+external heap delta and renderer RSS/working-set delta each decrease **at least 50%**; median peak RSS/working set decreases **at least 25%**; **every** sample-index pair has lower RSS peak and delta; median elapsed does not increase by more than **5%**; heap-delta nonregression remains required (the 50% reduction gate is stricter than the 5% allowance); every 1 GiB sample remains **<60 s**; and **every** candidate sample stays within **512 MiB peak RSS/WS, 256 MiB RSS/WS delta, and 128 MiB heap delta**. Exact payload/chunk counts, upload integrity, awaited-write-before-progress/reuse, cancellation and primary-error preservation remain required. A passing upload cannot justify a failed download. These fixed gates supersede the historical 10% timing declaration above without changing old results. Do not relax a gate after seeing final CI.

No forced GC or artificial `ArrayBuffer.transfer(0)` is used by the final candidate or during measured windows. `performance.memory.usedJSHeapSize` includes V8-accounted external backing storage in this Chromium runtime (the [Chromium memory-info implementation](https://chromium.googlesource.com/chromium/src/+/abe0507666c40/third_party/blink/renderer/core/timing/memory_info.cc) sums used heap and external memory); it is not only object memory and is not identical to process RSS. Older optional **post-result** GC diagnostics are retained in raw records but excluded from every acceptance calculation. Heap and RSS must both improve; reducing one while inflating the other is a rejection.

### Historical hosted runs, including the rejected remote candidate

The table below preserves three samples per scenario from each exact head, including all failed memory values. These are **different workflow runs**, not a same-machine alternating A/B experiment. No speedup is attributed from comparing their timings. The original `ac4571d5e101d943f341afe83655dcdd4625c1ec` Blob upload/native-pipeTo download candidate is **Rejected**, even though the workflow executed successfully.

| Case | n | Elapsed ms median [min,max] | RSS/WS peak MiB | RSS/WS delta MiB | JS + external delta MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| Original e1faa488 / run37865189440 / upload | 3 | 7914.300 [7557.600, 7973.600] | 1056.844 [879.406, 1057.207] | 927.090 [747.906, 934.328] | 471.837 [384.412, 472.494] |
| Original e1faa488 / run37865189440 / download | 3 | 3814.000 [3757.000, 3816.100] | 487.770 [471.336, 489.305] | 368.887 [361.387, 373.785] | 313.765 [290.358, 314.422] |
| Original e1faa488 / run37865189440 / download-discard | 3 | 1142.400 [1126.300, 1192.500] | 1090.891 [827.941, 1534.000] | 975.879 [715.637, 1407.949] | 227.929 [207.948, 476.118] |
| Baseline 2ca7f021 / run37865523278 / upload | 3 | 6185.800 [6178.900, 6542.300] | 1199.781 [1182.863, 1329.910] | 1068.422 [1055.316, 1196.277] | 536.620 [528.608, 600.427] |
| Baseline 2ca7f021 / run37865523278 / download | 3 | 3094.900 [3076.000, 3225.800] | 528.910 [387.871, 608.527] | 412.621 [273.523, 494.375] | 348.462 [210.206, 430.620] |
| Baseline 2ca7f021 / run37865523278 / download-discard | 3 | 870.400 [862.700, 934.300] | 1416.660 [813.180, 1674.551] | 1294.430 [694.316, 1555.133] | 468.169 [308.685, 520.165] |
| Rejected ac4571d5 / run37866968455 / upload | 3 | 5392.600 [5294.800, 6195.100] | 566.742 [505.445, 648.684] | 437.172 [374.047, 533.066] | 456.487 [384.374, 528.623] |
| Rejected ac4571d5 / run37866968455 / download | 3 | 3319.000 [3216.200, 3660.600] | 582.711 [487.207, 703.465] | 470.516 [377.270, 582.387] | 396.515 [316.753, 524.730] |
| Rejected ac4571d5 / run37866968455 / download-discard | 3 | 1139.500 [1038.800, 1139.800] | 931.008 [895.309, 1244.699] | 812.898 [773.766, 1123.367] | 268.198 [215.801, 380.057] |

On ac4571d5 OPFS download, heap delta was **396.515 MiB** versus the original e1faa488 **313.765 MiB** (approximately +26.4%), and renderer delta **470.516 MiB** versus **368.887 MiB** (approximately +27.6%). Neither meets the declared dual-50% reduction gate. Hosted upload heap remained **456.487 MiB**, also below the required improvement. These cross-run numbers establish rejection signals, not causal throughput estimates. Exact source: [run37866968455/job113615882517](https://github.com/lazyxu/xdrive/actions/runs/37866968455/job/113615882517). Complete original launcher JSON and the original job log are archived below.

### Local diagnosis and rejected experiments

The comparable local baseline uses original production plus the ready/start handshake correction, Chromium **153.0.8010.0** headless, Node **24.19.0**, Linux overlayfs, loopback sparse-zero 1 GiB payloads, reused dependencies, and one renderer process. OPFS uses fresh persistent browser contexts to avoid off-record quota limits; discard uses off-record no-storage sinks. RSS is sampled every 25 ms after the initial RSS snapshot and before transfer activation. Existing harness heap sampling and payload counters are retained. Builds and benchmarks are serialized under `perf-bench.lock`. Local numbers do not replace hosted Electron/Xvfb results. Baseline runner/source hashes reconstructed after the runs are labeled as reconstructed, not contemporaneous captures; newer size-parameterized samples carry source/dist hashes.

| Case | n | Elapsed ms median [min,max] | RSS/WS peak MiB | RSS/WS delta MiB | JS + external delta MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| XHR handler cleanup | 1 | 33998.200 [33998.200, 33998.200] | 1626.723 [1626.723, 1626.723] | 1508.160 [1508.160, 1508.160] | 616.216 [616.216, 616.216] |
| ArrayBuffer transfer(0) after hash/request | 1 | 40904.500 [40904.500, 40904.500] | 2930.137 [2930.137, 2930.137] | 2812.035 [2812.035, 2812.035] | 9.222 [9.222, 9.222] |
| Blob body + hash-buffer transfer(0) | 1 | 8613.800 [8613.800, 8613.800] | 2176.355 [2176.355, 2176.355] | 2057.445 [2057.445, 2057.445] | 1.280 [1.280, 1.280] |
| Native pipeTo OPFS, verified local | 1 | 4409.000 [4409.000, 4409.000] | 772.750 [772.750, 772.750] | 655.430 [655.430, 655.430] | 640.311 [640.311, 640.311] |

- **XHR terminal/upload-handler cleanup: Rejected**, n=1. Clearing handlers and capturing primitive body length/signal reduced memory only about 2%, below the 25% minimum. Reverted without expanding a low-value sample.
- **Owned ArrayBuffer transfer(0) after hash or completed XHR/retry: Rejected**, n=1. Heap accounting decreased but RSS and elapsed increased substantially. Reverted; not retained as a final memory mechanism.
- **Blob request body plus hash-buffer transfer(0) in finally: Rejected**, n=1. Low reported heap did not compensate for worse RSS/time. Reverted.
- **Verified native pipeTo OPFS: Rejected**, local n=1. Elapsed 4409 ms was 29.3% above the local original 3409 ms median, with essentially unchanged RSS/heap. This local observation is separate from hosted CI; the 29.3% value must not be attributed to the hosted run. A first-write-failure probe also produced premature progress `[3]` before a failed sink write. The final manual awaited-write loop restores the original contract.
- **Blob-body only upload: Rejected**, verified local n=3. Measured source was the remote `0004927a` candidate. RSS delta improved about 40.8%, while heap delta increased about 43.1%, failing the dual-50% gate. The earlier `transfer-remote-candidate/` directory used an incorrect bundle path and is **invalid** candidate evidence; it is intentionally excluded from this archive.

### Final local 1 GiB BEFORE/AFTER qualification

Upload uses a per-upload **at most 8 MiB reusable BYOB scratch** for hashing while retaining immutable File-slice Blob request bodies. Full pre-hash and upload-time digest checks remain; independent varied-content tests compare native and forced-partial BYOB digests and XHR payloads with Node crypto. Download uses a **1 MiB reusable BYOB backing buffer with default minimum read size (1 byte)**. Each returned view is fully consumed by an awaited destination write before progress or reuse; unsupported byte readers preserve the default-reader path. Partial tails, EOF, abort, lock release, close failure and primary-error preservation are covered. There is no aggregate chunk array.

| Case | n | Elapsed ms median [min,max] | RSS/WS peak MiB | RSS/WS delta MiB | JS + external delta MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| Original local upload | 3 | 36114.100 [35509.300, 40743.100] | 1661.855 [1405.137, 1663.863] | 1542.520 [1286.090, 1545.109] | 632.186 [511.823, 632.241] |
| Blob-body only, rejected | 3 | 6610.800 [6490.600, 8106.100] | 1032.930 [815.270, 1040.168] | 913.820 [696.668, 920.906] | 904.623 [688.320, 904.627] |
| Final reusable BYOB upload | 3 | 6082.300 [5831.000, 6347.000] | 172.434 [171.617, 172.645] | 53.871 [52.961, 55.023] | 19.240 [18.939, 19.313] |
| Original local OPFS | 3 | 3409.000 [3312.100, 3818.200] | 773.938 [757.230, 778.117] | 656.336 [640.062, 660.742] | 638.639 [572.465, 642.702] |
| Full-min BYOB, replaced for latency | 3 | 3240.700 [2953.800, 3632.100] | 186.770 [186.613, 187.164] | 69.574 [69.035, 69.602] | 3.073 [2.990, 3.075] |
| Final default-min BYOB OPFS | 3 | 3305.500 [3114.200, 3828.700] | 189.004 [187.270, 189.395] | 71.910 [70.621, 72.145] | 3.175 [3.173, 3.368] |

Final upload median RSS peak/delta decrease approximately **89.6% / 96.5%**, and heap delta decreases **97.0%**. Final default-min OPFS download median peak/delta decrease **75.58% / 89.04%**, and heap delta decreases **99.50%**. Every sample-index RSS peak/delta pair decreases; all three final samples in each direction satisfy the absolute budgets and exact 1 GiB / 128-chunk upload counts. Upload elapsed is 6082.3 ms and download 3305.5 ms; their median timing gates pass. This is original-then-candidate local measurement, not alternating execution order. Timing is diagnostic; no Internet, physical-disk, Windows or native Electron throughput claim is made.

The initial 1 MiB **minimum-fill** download variant passed memory/timing gates but was **Replaced for measured publication latency**, not kept as a product optimization. On controlled delivery of **32 KiB every 50 ms** (about 5.24 Mbit/s), original first write/progress publication were **52.079 / 102.662 ms**, while full-min first write/publication were **1612.100 / 1612.148 ms**. Removing only the minimum-read option restored **51.502 / 101.906 ms**, matching a fresh original control **51.590 / 102.162 ms**. No adaptive batching policy was introduced. The latency regression first failed at 1619.7 ms and then passed; 14 new/existing download tests pass. Keep the replaced full-min raw samples to explain the choice.

Validation: upload's initial related suite **49/49** passed; independent native/partial varied-fixture integrity suite **45/45** passed. Download's final related suite **14/14** passed, and Web full TypeScript/Vite build passed. A full Desktop suite ran on the full-min predecessor: **1101 passed, 2 failed, 1 skipped**; both failed test files (`shared-image-preview-decode.cjs`, `shared-media-preview-lifecycle.cjs`) could not load absent `react-test-renderer` in the reused install and never reached assertions. This is not a green full-suite claim for final delivery; root's full validation/CI remains required.

Final local delivery validation resolved the already-declared `react-test-renderer` 18.3.1 test dependency and reran the complete normal Desktop suite against the final default-min/download and reusable-upload sources: **1131 passed, 0 failed, 1 skipped** (`node --test --test-concurrency=4 tests/*.cjs`, after the main build). Web TypeScript/performance build, both Desktop TypeScript checks, the CI parity suite, and shell/diff checks passed. Eleven comparator tests cover rejected memory/timing gates, runtime mismatch, exact payloads, nonzero CI exit with retained evidence, and the current 4 GiB budgets. Independent review verified the production source hashes against the measured candidates and found no remaining blocker. Hosted same-run paired CI is still the authoritative acceptance gate.

### Current bounded Web 4 GiB coverage

After bounded 1 GiB qualification, current Web upload and default-min OPFS download each ran **three fresh processes at exactly 4,294,967,296 bytes**. Upload emitted **512 x 8 MiB chunks**, retaining full pre-hash/integrity. Each direction passes all absolute memory budgets and the fixed **<=240 s per-sample 4 GiB elapsed cap**. OPFS quota was preflighted, temporary fixtures cleaned, and about 23 GiB free disk remained. The upload and download bundles have separate hashes because the download-only minimum changed between builds; upload API/transport hashes stayed fixed. Raw records distinguish executed bundle hashes from concurrently observed source hashes.

| Case | n | Elapsed ms median [min,max] | RSS/WS peak MiB | RSS/WS delta MiB | JS + external delta MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| Final Web 4 GiB upload | 3 | 25946.000 [25738.700, 25970.200] | 199.852 [199.137, 200.348] | 80.398 [79.605, 81.758] | 29.977 [22.155, 30.670] |
| Final Web 4 GiB OPFS download | 3 | 13487.800 [13071.200, 14365.100] | 201.656 [201.234, 203.910] | 84.238 [83.914, 85.895] | 5.904 [5.182, 5.905] |

Upload pre-hash median is **8394.5 ms**; download includes production OPFS writing. These are current bounded-workload baselines only: **original Web 4 GiB was not run**, so there is no 4 GiB before/after reduction or extrapolated speedup claim. This is local zero-filled loopback/overlayfs, not native Server/CAS, physical disk, Internet, Desktop IPC or Windows CfAPI. Earlier Linux Agent 4 GiB results are separately documented by the Gallery/Agent measurement follow-up and are not relabeled as Web evidence.

### Authoritative paired CI and durable evidence

**Initial same-run comparison passed on 4ec/deab; reconstructed-head revalidation is required before merge:** same-run Electron/Xvfb original-vs-candidate comparison, using exact immutable baseline/candidate provenance, shared corrected harness, three fresh samples for each upload/OPFS-download/discard scenario (**nine BEFORE + nine AFTER**) and alternating order. Upload and OPFS-download must pass the strict final gates; discard remains a separately reported diagnostic. Only after these gates pass does the same CI job run current-candidate **4 GiB upload/download, three samples each**, with the fixed absolute memory caps and **<=240 s per sample**. Record all original and candidate results plus failed gates here before this performance PR merges. The final size-parameterized 1/4 GiB harness must preserve the 1 GiB comparison workload; larger coverage is additional qualification, not substituted BEFORE data.

All complete local sample JSON, original e1/2ca CI records, nine full ac4571d5 launcher records and original job log, rejection/progress logs, slow-stream probes, full-min replacement evidence, final source/dist hashes, and current 4 GiB samples are archived under [performance-evidence/web-large-transfer](performance-evidence/web-large-transfer/README.md). [manifest.json](performance-evidence/web-large-transfer/manifest.json) records SHA-256 for every evidence file. Copied summaries retain original scratch paths as provenance; the archive's relative paths are the durable locations. Numeric sample values remain unrounded in JSON. Do not use optional post-result GC fields as acceptance evidence or silently omit rejected samples.

### Authoritative paired CI on 4ec31f39 — 2026-10-09

Status: **Accepted / paired performance gate passed**. The [large-transfer-web-performance job](https://github.com/lazyxu/xdrive/actions/runs/37870615110/job/113627600871) completed **successfully at 01:41:28 UTC**, after starting at 01:37:15 UTC. Actual checkout was **AFTER `4ec31f39ec151cd45642ba2c9603d2f78cf82899`**. Immutable `HEAD^` was **BEFORE `deab56e2f7b3489bcc88dea3ed94b5f93fdbcb8e`**; do not relabel this run with the later reconstruction base.

The exact immutable paired script archives that BEFORE tree and overlays **only** the AFTER measurement harness TSX and Electron launcher. It does not overlay the production API, sink or transport. Both builds reuse the same installed dependencies, with the baseline shared-UI package resolving to the archived baseline source. Samples alternate BEFORE/AFTER on odd indices and AFTER/BEFORE on even indices. There were **nine BEFORE + nine AFTER 1 GiB samples**, then **six current 4 GiB samples** only after the strict primary gate passed. Every complete sample reports identical timed runtime versions: **Electron 44.4.5 / Chromium 152.0.7977.130 / Node 24.21.0**. This hosted Electron/Xvfb runtime is separate from the local Chromium153 headless evidence.

All **24** complete launcher records were extracted from the original job log. Scenario/index order was independently matched to the immutable script. Exact payload validation held: each 1 GiB transfer was **1,073,741,824 bytes**, each 4 GiB transfer **4,294,967,296 bytes**, with **128 / 512 upload chunks** respectively. Runtime, byte/chunk checks and both comparison objects were independently recomputed using the **4ec31f39 comparison implementation**; the recomputed JSON exactly equals the original logged comparisons, and both top-level `accepted` values are **true**.

#### Complete same-run 1 GiB comparison

Every distribution below is median [minimum,maximum], n=3; units are stated per row. Values remain unrounded in the archived original sample JSON.

**upload, n=3 per side**

| Metric | BEFORE median [min,max] | AFTER median [min,max] | Change |
| --- | ---: | ---: | ---: |
| Elapsed ms | 7150.900 [7116.000, 7312.700] | 5582.600 [5353.300, 6055.900] | 21.932% decrease |
| Throughput MiB/s | 143.199 [140.030, 143.901] | 183.427 [169.091, 191.284] | 28.093% increase |
| JS + external delta MiB | 464.174 [423.592, 464.185] | 20.320 [20.270, 20.483] | 95.622% decrease |
| Renderer WS peak MiB | 1040.875 [960.973, 1041.871] | 158.961 [157.594, 160.656] | 84.728% decrease |
| Renderer WS delta MiB | 928.008 [847.613, 928.070] | 46.410 [46.027, 46.938] | 94.999% decrease |

**download, n=3 per side**

| Metric | BEFORE median [min,max] | AFTER median [min,max] | Change |
| --- | ---: | ---: | ---: |
| Elapsed ms | 3682.100 [3636.800, 3745.800] | 3450.100 [3449.300, 3509.700] | 6.301% decrease |
| Throughput MiB/s | 278.102 [273.373, 281.566] | 296.803 [291.763, 296.872] | 6.724% increase |
| JS + external delta MiB | 344.146 [330.143, 366.185] | 2.699 [2.670, 2.745] | 99.216% decrease |
| Renderer WS peak MiB | 519.887 [513.840, 541.668] | 183.699 [180.609, 184.160] | 64.666% decrease |
| Renderer WS delta MiB | 412.941 [404.508, 434.957] | 76.012 [71.969, 77.590] | 81.593% decrease |

**download-discard, n=3 per side**

| Metric | BEFORE median [min,max] | AFTER median [min,max] | Change |
| --- | ---: | ---: | ---: |
| Elapsed ms | 1106.100 [1088.500, 1123.800] | 764.700 [758.100, 775.600] | 30.865% decrease |
| Throughput MiB/s | 925.775 [911.194, 940.744] | 1339.087 [1320.268, 1350.745] | 44.645% increase |
| JS + external delta MiB | 429.750 [284.800, 461.761] | 3.310 [3.184, 3.903] | 99.230% decrease |
| Renderer WS peak MiB | 1621.492 [1529.719, 1629.523] | 120.367 [118.988, 120.699] | 92.577% decrease |
| Renderer WS delta MiB | 1514.469 [1422.348, 1522.238] | 13.039 [12.863, 13.266] | 99.139% decrease |

The fixed gates were not relaxed. Upload and OPFS download exceed the required **50% heap/delta and 25% peak reductions**, every individual paired peak/delta is lower, the **5% median elapsed** gate passes, and every AFTER sample meets the **512/256/128 MiB** memory caps and 60 s elapsed cap. The discard path also passes every check, while retaining its diagnostic-only role.

| Scenario | Memory reductions + all paired RSS lower | Heap nonregression | Median elapsed gate | Every sample memory caps | Every sample elapsed cap | Assessment |
| --- | --- | --- | --- | --- | --- | --- |
| upload | true | true | true | true | true | Accepted |
| download | true | true | true | true | true | Accepted |
| download-discard | true | true | true | true | true | Diagnostic, passed |

#### Current-candidate 4 GiB hosted coverage

No original 4 GiB path was measured. These distributions qualify the current bounded implementation and do not claim a 4 GiB before/after percentage improvement.

| Scenario | Elapsed ms median [min,max] | Throughput MiB/s | JS + external delta MiB | WS peak MiB | WS delta MiB | Every sample memory caps / <=240 s |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| upload | 22019.500 [21691.700, 22337.700] | 186.017 [183.367, 188.828] | 32.654 [24.471, 32.669] | 189.070 [187.305, 191.027] | 76.312 [76.027, 79.414] | true / true |
| download | 13507.800 [13498.600, 14300.500] | 303.232 [286.424, 303.439] | 4.582 [4.564, 4.590] | 187.484 [186.887, 188.090] | 80.844 [79.277, 82.301] | true / true |

All six samples pass the unchanged absolute memory budgets and fixed **<=240 s** elapsed cap. Exact bytes, chunk counts and runtime were independently checked above.

#### Provenance and materialization limits

The original artifact is **11590172527**, `web-large-transfer-1gib-4gib`, 15,451 bytes, digest **`sha256:410171ed8de680fbac1290ccf93f63acb59b8ba4ffddb404e017bcff660aaee4`**, associated with this exact head/run. The connector returned a ZIP reference, but its temporary download URL returned **HTTP 403**; the original ZIP and its `provenance.json` were not read. No authentication workaround was attempted.

The durable archive therefore preserves the **complete original job log**, all **24 complete original RESULT records**, both original/recomputed comparison JSON objects, and an explicitly named **`provenance-reconstructed.json`**. That provenance derives from the checkout log, immutable parent/AFTER Git objects, exact paired script and production/harness source hashes. It is **not** represented as the artifact's original provenance file; original artifact host/CPU fields remain unavailable. In particular, baseline API/sink/transport hashes match the original 2ca production, and AFTER API/sink/transport hashes match the locally measured final candidate. Source hashes and limits are retained in JSON.

Archive: [ci-4ec31f39](performance-evidence/web-large-transfer/ci-4ec31f39/provenance-reconstructed.json), [comparison.json](performance-evidence/web-large-transfer/ci-4ec31f39/comparison.json), [current-4gib.json](performance-evidence/web-large-transfer/ci-4ec31f39/current-4gib.json), and [audit-verification.json](performance-evidence/web-large-transfer/ci-4ec31f39/audit-verification.json). Original runtime/error/metric logs and per-side sample directories are alongside them; the global manifest verifies every file.

#### Post-conflict delivery verification remains separate

After Gallery #1067 merged, GitHub reported a genuine canonical-document conflict. The same single work commit was reconstructed on fixed parent **`a1f04f4681dba8e1d55307e09d292ecb880039dc`**, preserving both performance chapters and the final upload/download changes. Parent API additions are MediaSyncFolder methods/types; the transfer changes remain intact. These **4ec/deab** results do not validate that newer commit by attribution alone.

Fresh normal local checks after reconstruction passed Web performance TypeScript/build, both Desktop TypeScript checks/main build, Go CI parity and shell/diff checks. The complete normal Desktop suite is now **1212 passed, 0 failed, 1 skipped** (new parent adds ordinary tests); its log is archived separately from the earlier 1131-pass validation. **Final reconstructed-head full PR CI is mandatory before merge.** Keep this initial successful pair as its own exact-head measurement record; the final run must identify its own BEFORE/AFTER source provenance and strict gates before merge.

Next named performance workloads after this delivery: real 100k subtree delete/trash/restore and Client change-feed consumption; real FileExplorer video/LIVP HTTP+decode in Details/Grid; and the 4 GiB Agent controller/IPC boundary. Existing 100k metadata, replay renderer, and Agent-core results remain labeled by their actual measured layer. Start each extension with a measured baseline before considering a production optimization.


## Home recent/favorite video-poster parity (2026-10-09)

Status: **Implementation candidate / structural correctness, CI pending**. The shared Home page already uses the FileExplorer thumbnail Provider (maximum six active requests, 96-entry revision/updated-at keyed cache and URL leases), but previously the Web and Desktop Home adapters performed only a single persisted thumbnail GET. A cold ordinary video without a cached Server poster therefore had no video-frame fallback and displayed the standard failure surface. The existing FileExplorer and Gallery adapters have a revision-checked cold-frame backfill.

This change reuses the existing `xDriveResolveMediaVideoPoster` resolver on both Home adapters, without adding a new renderer, poster storage class or global work queue. Warm video: **1 cached GET, 0 original-video preview requests/captures, 0 PUT** (unchanged). Cold video: **BEFORE 1 failed thumbnail GET, 0 frame capture, 0 PUT, missing cover; AFTER 1 GET miss, 1 preview ticket and bounded frame capture, up to 1 revision-fenced poster PUT and a usable cover if source decoding succeeds**. Non-video: unchanged one-thumbnail request. These are deterministic source/request-contract counts, **not** wall-clock or network-byte performance measurements. Shared Provider passes an AbortSignal; Web HTTP and Desktop request-scoped IPC abort abandoned warm GETs, and the cold capture receives that signal. Revision-checked backfill remains best effort. Preserve the existing failure UI when even fallback capture is unavailable.

Regression contract: `desktop/tests/shared-home.cjs` asserts both real platform adapter paths use the same resolver, preserve the non-video fast path, pass signals, and use the same persisted-poster and revision-checked source. Native Web/Desktop CI is required before calling this implemented. Follow-up: real H.264/HEVC Home cover latency/bytes and browser/Agent early-abort measurements on the same named workload, not inferred from these code-level counts.

## P0-C — FileExplorer and shared media transfer progress (2026-10-09)

Status: **In progress / cross-platform implementation candidate / native CI evidence pending**. FileExplorer uses the same `XDriveMediaLoadingProgress` and bytes/stage semantics as Gallery/Viewer. Visible thumbnail loads alone subscribe to progress; still/video/Live noninteractive badges remain separate. Existing Web revision-safe thumbnail GET and Desktop sender-scoped viewport requests own cancellation and cache leases; no new transfer-center job, thumbnail radius, source scan or CfAPI/FUSE change.

The only observed BEFORE/stream-prototype benchmark currently available is the **16 MiB synthetic Node 22 same-host microbench** described in `docs/gallery-performance.md`; browser decoded image speed, 100k grid/Details RSS, real Go/Agent transfer bytes and Native Range playback **are unmeasured**. Reuse the native 100k FileExplorer Grid/Details and thumbnail test baselines, add same-fixture BEFORE/AFTER real visible media progress/abort tests, require no extra original-video poster read on warm cache and no non-visible resource subscriptions. No wall-clock or memory improvement is claimed at this stage.

### P0-C updated measurement boundary

The opt-in Web progress collector's original extra TransformStream had high synthetic overhead and was replaced by a direct reader after a measured diagnostic regression. [CI 37934247525](https://github.com/lazyxu/xdrive/actions/runs/37934247525) measured 16MiB Node n3 native 10.562ms vs observed-reader 8.761ms, but Web TypeScript required a DOM BlobPart type narrowing (TS2345) and thus did not pass the full source-exact gate. The new branch-scoped native Chromium HTTP A/B also records request bytes, sampled renderer RSS and CPU ticks; it is **not** a 100k FileExplorer Grid/Details, Agent IPC or physical-device benchmark. Correctness is a must: retain FileExplorer/Viewer thumbnail abort and revision fencing, with no durable task created per thumbnail.

### P0-C browser sampled-memory rejection (2026-10-09)

The [native Chromium HTTP A/B CI 37934997271](https://github.com/lazyxu/xdrive/actions/runs/37934997271) measured a 16MiB `response.blob()` baseline against the progress-observed direct-chunk reader (n=5): sampled renderer RSS growth **28 KiB vs 33,996 KiB** and coarse CPU **1 vs 3 ticks**, despite shorter wall time for the observed variant. This is **real Chromium process/loopback HTTP**, not an actual 100k FileExplorer UI or Desktop Agent comparison. The current reader is **not accepted** under the frozen 32MiB additional-memory budget for that workload. Evaluate native Blob-backed stream forwarding before merge; do not enable full-collection progress subscriptions or change cache quotas to hide the overhead. See [raw sample evidence](performance-evidence/media-shared-progress/ci-run-37934997271-chromium-before.json).

### P0-C selected bounded-observer reader and unmount semantics

The [four-arm native Chromium HTTP trial](performance-evidence/media-shared-progress/ci-run-37936088859-chromium-four-arm.json) showed the direct observed Blob(chunks) branch using 34,216 KiB of sampled renderer RSS growth, while a TransformStream observer required 17,008 KiB in the same 16MiB/64KiB n=5 experiment. Select the latter **only after source-exact CI revalidation**, keeping cached/unobserved requests on the native Blob path. This is not a measured 100k FileExplorer Renderer or Agent IPC speedup.

A FileExplorer/Gallery thumbnail leaving the viewport detaches its own progress callback and aborts abandoned request-scoped transports, but must preserve shared task consumers and persistent transfer/sync/delete tasks. Maintain bounded 6-way Gallery/Explorer concurrency and their existing LRU/URL-lease ownership. Reject any new per-thumbnail durable task, duplicated media request, unbounded retained progress listener or misreported original-file percent.

## P0 100k authenticated Trash virtual-range Go context cancellation (2026-10-10)

**Status: Accepted / 100k native PostgreSQL request-cancellation resource release, n=3 paired; final evidence-amended exact-head CI pending, not yet merged.** Existing #1203 only established FileExplorer children paging cancellation; it did not cover Trash page SQL. The unrelated Desktop Gallery progress probe #1185 remains blocked and is not merged or altered here. The first invalid n=1 diagnostic is retained at [invalid-ci-38014772267.json](performance-evidence/trash-range-go-context-cancel-100k/invalid-ci-38014772267.json): its independent health probe accidentally called the unpaged legacy Trash API, which exceeded PostgreSQL's 65,535 bind limit. That run is explicitly **not** counted as a valid benchmark. The health probe was corrected to request `?range=true` before the valid n=3 baseline below.

**Named measurement boundary:** Real authenticated Gin HTTP `GET /api/v1/trash?range=true&offset=...&limit=200&sort=name&order=asc`, native PostgreSQL 17, 100,000 deleted root file-type Nodes for one owner (25,000 each of `.jpg`, `.mp4`, `.livp`, `.txt` **metadata labels**, not actual photo/video decoding), all with `trash_root_id=id`. Six distinct counted 200-item ranges block on a real ACCESS EXCLUSIVE lock on `xd_nodes`; confirm six PostgreSQL `pg_stat_activity` lock waiters and six live Gin handlers **before** canceling all six HTTP clients. Sample at **+160ms**: HTTP `Request.Context().Done()` callbacks and their timing, active SQL waits, active Handlers, stale response bytes. Unlock and require an independent healthy counted 200-item/100k-range HTTP request. Three independent isolated-schema PostgreSQL17 processes per arm, matched BEFORE/AFTER runs alternating order on the same CI runner. Seed time is excluded from cancellation observation.

**Confirmed unchanged-production BEFORE / first red, n=3:** [CI run 38015359424 / job 114104358503](https://github.com/lazyxu/xdrive/actions/runs/38015359424/job/114104358503), work head `b3d13fb1c74023ee82cd254368d22ad310462b14` and original production parent `a63fe51e2f16c132c1be76b690a72165a44de5c0`, Go integration test `TestTrashRangeRequestContextCancellation100K`. All three full runs **passed the first-red predicate** and their independent recovery check. Raw parsed sample values are permanently archived at [first-red-ci-38015359424.json](performance-evidence/trash-range-go-context-cancel-100k/first-red-ci-38015359424.json).

| BEFORE sample | Six HTTP contexts done by 160ms | Still waiting in native PostgreSQL at 160ms | Active handlers at 160ms | Stale client bytes | Max server context notification (ms) | Seed (ms; excluded) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 6/6 | **6/6** | **6/6** | 0 | 0.189 | 2,748.073 |
| 2 | 6/6 | **6/6** | **6/6** | 0 | 0.139 | 1,987.590 |
| 3 | 6/6 | **6/6** | **6/6** | 0 | 0.136 | 1,964.017 |

**Observed root cause:** `history_trash.go::trashListRange` creates a shared GORM range/count query via `s.DB.Table("xd_nodes")` without binding the current HTTP request context. The HTTP context becomes canceled in ~0.1–0.2ms, but the six native SQL lock waits do not stop and the six Gin handlers continue to retain work. This is confirmed resource retention, not a theoretical race or a page rendering measurement.

**Smallest production experiment:** use `s.DB.WithContext(c.Request.Context())` in the **shared Trash counted/count-free range query builder**, so both primary `Scan` and optional empty-page `Count` inherit cancellation. No new global task cancellation and no changes to uploads, downloads, sync, persistent deletion, shared image derivatives, Gallery viewer/player lifecycle, or the legacy unpaged Trash API.

**Acceptance/rejection gate declared before AFTER:** all three paired BEFORE arms must retain the exact 6/6 waiter + Handler first-red and 6/6 notified HTTP contexts; all three paired AFTER arms must show **0 SQL lock waiters and 0 active Gin handlers at +160ms**, 6/6 contexts notified, 0 stale payload bytes, and still serve the fresh 200-item/100k-count range after releasing the lock. Preserve ordinary API and authorization tests. Because this measures abandoned-request resource release rather than successful throughput, **do not invent latency or percentage speedup**. Retain the production change only after same-runner alternating 3×(BEFORE+AFTER) evidence and full source-exact CI pass; otherwise reject/revert the experiment and record why.

**Measured alternating same-runner paired result (AFTER candidate source `b566306f9ed548423ae7d4be547d8f6f89dfd184`):** [CI run 38016336548 / job 114107316414](https://github.com/lazyxu/xdrive/actions/runs/38016336548/job/114107316414), 3 matched pairs, each using the same copied test harness and separate fresh PostgreSQL schemas. The benchmark job **passed**. Raw six-arm source-exact evidence: [paired-ci-38016336548.json](performance-evidence/trash-range-go-context-cancel-100k/paired-ci-38016336548.json).

| Paired sample (execution order) | BEFORE native SQL waits / live handlers @+160ms | AFTER native SQL waits / live handlers @+160ms | BEFORE/AFTER HTTP contexts Done | BEFORE/AFTER stale bytes | BEFORE/AFTER max context notice (ms) |
| --- | --- | --- | --- | --- | --- |
| 1 (BEFORE → AFTER) | **6 / 6** | **0 / 0** | 6/6 · 6/6 | 0 · 0 | 0.140 / 0.165 |
| 2 (AFTER → BEFORE) | **6 / 6** | **0 / 0** | 6/6 · 6/6 | 0 · 0 | 0.280 / 0.155 |
| 3 (BEFORE → AFTER) | **6 / 6** | **0 / 0** | 6/6 · 6/6 | 0 · 0 | 0.177 / 0.125 |

**Decision: Accepted minimal production context propagation, no throughput speedup claimed.** Every fixed gate passed in 3/3 pairs, with 6/6 SQL+HTTP handlers released instead of retained at +160ms; canceled-HTTP bytes remain zero, and every independent fresh counted range returned 200 items with the 100,000 total. PostgreSQL emitted real `canceling statement due to user request` diagnostics in AFTER runs. No measured renderer FPS, Server peak RSS or download/sync throughput is implied. A subsequent **evidence-amended head must pass complete PR CI before merge**. Go/DB cancellation remains request-scoped; durable Task Center work is unaffected.

**Benchmark command:** `XD_TRASH_RANGE_GO_CONTEXT_CANCEL_PERF=1 XD_TRASH_RANGE_GO_CONTEXT_CANCEL_EXPECT_FIXED=<0|1> XD_TEST_DATABASE_URL=postgres://... go test -run '^TestTrashRangeRequestContextCancellation100K$' -count=1 -timeout=8m -v ./internal/api`. Branch-scoped GitHub/GitLab `trash-range-go-context-cancel-100k-performance` job uses `git worktree` against the frozen parent with the *same copied benchmark harness* for BEFORE, current candidate for AFTER, alternating order to avoid before/after cache ordering bias. Each individual test seeds a fresh schema.

**Next action:** rerun the full source-exact CI on the final evidence-amended single work commit; if green and the PR remains mergeable, linear merge and perform merged-branch cleanup. Web/Desktop real rapid-scroll cancellation, large 4GiB transfers and genuine Live/RAW/media decoding remain unmeasured by this SQL-only experiment.

