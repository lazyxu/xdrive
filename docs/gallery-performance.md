# Gallery performance

This document is the canonical performance contract for the shared Web/Desktop Gallery.

Only comparable measurements should be presented as timing improvements. Structural changes without stable BEFORE/AFTER timing are recorded as complexity-only evidence.

## P0 Desktop 100k production Electron cold Gallery activation (2026-10-09)

Status: **Measured native Desktop baseline / no production optimization**.
Continue merged #1165 real Agent IPC baseline and #1156 Web cold first paint.
Three *independent* fresh native PostgreSQL 17/Gin/CAS fixtures, each with
exactly **100,000 logical PhotoAssets / 115,000 physical media nodes /
15,000 genuine Live Photos**. Start a production Go Agent authenticated to
that fixture in an isolated XDG session, then load **production Electron
Main, preload and Desktop Renderer**, including the real shared Gallery
and its actual Agent adapter. Activate Gallery through its existing
sidebar navigation; no mock Main handlers or synthetic transport delay.

Measure from the actual sidebar click to first visible tile, first
\`HTMLImageElement.decode()\`, first image after two animation frames,
and first **12 distinct decoded visible image URLs** after two frames.
Capture Long Task start/duration/attribution (a task >100ms is a red
diagnostic, not a speculative optimization), mounted virtual tiles
(<1000 integrity guard), JavaScript heap snapshot, renderer working set,
Go Agent start/end RSS snapshots, and CAS object-read/derivative counters
both **before Gallery activation and after**. Fixture seeding, Go build,
initial Electron App boot and earlier Overview prewarm are excluded from
the Gallery-activation timer, explicitly not a whole-application cold
launch. Two-rAF is a presentation proxy, **not** actual GPU presentation.

Run three fresh processes/schema samples, not repeated warm navigations
in one session. Test must fail if the 100k/115k dataset or mixed photo/
video/Live sample is missing, production renderer fails, 12 distinct
image decodes never finish, or the virtual grid mounts ≥1000 tiles.
This first CI run is a **baseline** even if provisional 2-second paint
target is missed. Do not measure a timing gain from the separately
recorded Web baseline or the independent Agent-only cohort. Same-fixture
BEFORE/AFTER with n≥3 and CPU/RSS/I/O/request correctness non-regression
are mandatory before accepting a production optimization.

Command after building Web fixture dist, real Desktop bundles and Agent:
\`XD_TEST_DATABASE_URL=postgres://... XD_GALLERY_AGENT_BINARY=/path/to/xdrive-agent xvfb-run -a node desktop/scripts/gallery-desktop-real-cold-runner.cjs\`.
Branch-scoped GitHub/GitLab CI job
\`gallery-desktop-real-first-paint-100k-performance\`. Raw three-sample
record, environment, source SHA and any failures must be amended into
\`docs/performance-evidence/gallery-desktop-real-first-paint-100k/\`
and this canonical document **within the same single work commit**
before its final full PR CI. No new hot-path changes in this PR.

Scope limits: Linux Xvfb/Electron only, no physical Windows/macOS,
external WAN, physical 4K HEVC video decode, true app process cold boot,
all-viewport decode, or peak memory. Durable uploads/downloads/sync/
deletes must not be cancelled by Gallery view/window teardown.


### Source-exact actual Desktop n=3 CI result (2026-10-09)

Status: **Measured baseline / accepted without production optimization**. Valid [GitHub CI 37939861500](https://github.com/lazyxu/xdrive/actions/runs/37939861500), [100k production Desktop job 113851224465](https://github.com/lazyxu/xdrive/actions/runs/37939861500/job/113851224465), executed one-commit source head `6b40e99822dc52fbee5c99fef6553a64e043e3e9`. Prior first-red runs #37936826627/#37938008602/#37938968995 were **invalid harness startup** due to Electron app-root/tray icon path, not performance regressions. Runner entry was restored to the real Desktop app root; this exact run completed **3/3 true production Desktop samples**.

| Measurement | Samples 1 / 2 / 3 | p50 |
| --- | --- | ---: |
| Click → first visible tile | 1547.100 / 1464.700 / 1575.800 | **1547.100 ms** |
| Click → first image DOM | 1738.400 / 1697.200 / 1814.900 | **1738.400 ms** |
| Click → first JPEG decode | 1763.200 / 1736.400 / 1850.700 | **1763.200 ms** |
| Click → first image decoded + two-rAF paint proxy | 1793.600 / 1748.000 / 1869.400 | **1793.600 ms** |
| Click → first 12 decoded + two-rAF | 1932.200 / 1896.800 / 2053.200 | **1932.200 ms** |
| Longest activation Long Task | 50.000 / 83.000 / 55.000 | **55.000 ms** |
| Mounted tiles | 42.000 / 42.000 / 35.000 | **42.000 items** |
| Decoded images | 14.000 / 14.000 / 16.000 | **14.000 images** |
| JS heap post-result snapshot | 19.550 / 22.030 / 18.406 | **19.550 MiB** |
| Renderer working set post-result snapshot | 198.453 / 197.730 / 199.563 | **198.453 MiB** |
| Agent VmRSS start/end delta | 5.453 / 5.047 / 4.367 | **5.047 MiB** |

Every fresh PostgreSQL 17/Gin/CAS sample contains exactly **100,000 logical PhotoAssets, 115,000 physical media nodes, 15,000 genuine Live Photo pairs**. Initial CAS counters at Gallery activation were zero (no hidden thumbnail prewarming). Each sample decoded **14 / 14 / 16** images with **0 errors** and mounted **42 / 42 / 35** virtual Gallery tiles — never all 100k DOM nodes. Thumbnail generation and derivative reads were real, and the underlying actual Main/preload/Agent route was used. Counts from actual CAS:
- CAS OriginalOpenSuccess: **21 / 20 / 20** per sample.
- CAS DerivativeOpenSuccess: **32 / 24 / 24** per sample.
- CAS DerivativePutSuccess: **16 / 13 / 12** per sample.

Fixture seeds **40172.197 / 39016.399 / 38648.229 ms** were excluded. Post-result JS heap, Renderer WS, and Agent start/end VmRSS are snapshots, **not peaks**; CPU profile and step-by-step Main-IPC timings were not captured. The two animation frames proxy visual presentation but are not measured actual hardware GPU swaps.

**Acceptance decision:** all 3 first decoded-image/two-rAF paint proxies were below the provisional **2,000 ms** threshold (1,793.6 / 1,748.0 / 1,869.4 ms); longest Long Task across all three samples was **83 ms**, below the **100 ms** diagnostic budget. First-12 proxy was **1,932.2 / 1,896.8 / 2,053.2 ms**; one sample exceeded 2s for 12 images, but the 2s predeclared budget applies to the **first image**, not 12 images. There is no demonstrated baseline breach sufficient to change production code; retain current Renderer/Agent/CAS implementation unchanged.

**Raw unrounded n=3 evidence:** [ci-run-37939861500.json](performance-evidence/gallery-desktop-real-first-paint-100k/ci-run-37939861500.json). The historical 100k Web first paint p50 ~1,524.9 ms is a separate cohort and must **not** be subtracted as an IPC cost or described as a speedup/slowdown between platforms without a true paired same-host workload. Next P0: actual browser duplicate-fold ON/OFF and Web Long Task stack attribution; later Desktop literal cold process boot and physical device.

## Native 100k Gallery: production Agent IPC to Gin/PostgreSQL/CAS baseline (2026-10-09)

Status: **Measured baseline / no production optimization (source-exact GitHub Actions n=3)**.
PR branch: `perf/gallery-agent-ipc-cold-100k`. Reuse the merged real 100k
fixture from #1156 instead of inventing replayed HTTP delays. Three independent
PostgreSQL 17 schemas hold exactly **100,000 logical assets / 115,000 physical
nodes / 15,000 genuine Live Photo pairs**. Seed and Go build are excluded
from request measurements. The actual production `xdrive-agent` binary
is launched with isolated `XDG_CONFIG_HOME` and
`XDG_CACHE_HOME`, authenticates against the fixture Gin
server, and the real compiled `AgentIPCClient` requests a
100-item Gallery range and 12 image/Live still thumbnails (max 6 parallel),
then a warm pass. Collect IPC read time, first thumbnail, first-12 completion,
bytes, real CAS operation counters, and Agent RSS *snapshots* (not peaks).
Run three fresh Agent + Gin + PostgreSQL fixture processes; every returned
count and nonempty image response is a hard integrity assertion.

**Command:** `XD_GALLERY_AGENT_BINARY=/path/to/xdrive-agent XD_TEST_DATABASE_URL=postgres://... node desktop/scripts/gallery-agent-ipc-real-100k.cjs`
after building Web dist, compiled desktop main client, and the production
Agent binary. GitHub/GitLab branch-scoped CI:
`gallery-agent-real-ipc-100k-performance`. The report lands in
`desktop/gallery-agent-ipc-100k-results/summary.json`.
The first measured CI n=3 values, environment and raw evidence must be
amended into **this same one work commit** before authoritative full CI and
merge. **No timing speedup is claimed** until a repeatable same-fixture
BEFORE/AFTER change is demonstrated. Keep production code unchanged while
baseline budgets are established.

**Boundary:** this closes a real Agent IPC → Go client → authenticated
Gin → PostgreSQL/CAS measurement gap, **not** the whole Desktop cold-start
gate: Electron Renderer → Main IPC, React commit, actual
`HTMLImageElement.decode()`, compositor paint, physical
Windows/Desktop and cross-network time still require separate measurement.
The native fixture's short encoded test media do not establish 4K codec or
full-LIVP dynamic-preview performance. Do not quote renderer first paint,
mean cancellation latency or peak RSS from this benchmark.




### Native first baseline from GitHub Actions — source-exact 2026-10-09

Status: **Measured baseline / no production optimization**. Initial scoped [CI run 37932063846](https://github.com/lazyxu/xdrive/actions/runs/37932063846), [job 113824956936](https://github.com/lazyxu/xdrive/actions/runs/37932063846/job/113824956936), head `ce21f12df56a7bc7a44009ee96a17eac7c2b8ba0`, successfully executed **3/3** fresh PostgreSQL/Go Agent fixture samples with real authenticated IPC and CAS thumbnail bodies. All count, thumbnail-byte, first-page video/Live and fixture-shutdown integrity guards passed. This result is native Linux and **not** a real Electron Desktop full page cold-start.

| Metric | Samples 1 / 2 / 3 | p50 |
| --- | --- | ---: |
| First Agent IPC 100-item range | 995.843 / 978.543 / 993.424 | **993.424 ms** |
| First actual thumbnail IPC complete | 110.222 / 120.188 / 122.608 | **120.188 ms** |
| First 12 actual thumbnails IPC complete | 246.733 / 235.028 / 252.636 | **246.733 ms** |
| Repeat 12 warm thumbnail IPC | 10.230 / 8.437 / 11.238 | **10.230 ms** |
| Go Agent RSS start/end delta, MiB | 5.160 / 2.145 / 5.059 | **5.059 MiB** |

Every sample returned **100,000 logical items / 115,000 physical media nodes**, 100 items in its first IPC range (**19 videos, 19 Live Photos** in that range), and 12 nonempty real image thumbnails totalling **306,031 B**. All three identical actual CAS counter snapshots have **12 OriginalOpenSuccess, 12 DerivativePutSuccess and 24 DerivativeOpenSuccess** across 12 cold + 12 warm reads. This supports an effective derivative cache without an extra dozen original reads but is not a decoded-paint measurement. Fixture seed **40591.114 / 39602.458 / 40079.083 ms** was excluded. Agent RSS is **only start/end snapshot delta, not peak**; CPU, renderer memory and persistent network socket telemetry were not sampled.

Raw sample and exact provenance: [`ci-run-37932063846.json`](performance-evidence/gallery-agent-ipc-real-100k/ci-run-37932063846.json). All timings are from **one CI environment and one measured source commit**; do not compare against the earlier Web browser run as a paired speedup. **Decision: retain all production code unchanged**; next build an actual Electron Renderer → Main → Agent 100k end-to-end profile with React/decode/paint. Only after paired measurement and a predeclared regression threshold may a smallest targeted optimization be retained.

## Cleanup extreme group coverage at 100k — native PostgreSQL baseline (2026-10-09)

Status: **Measured native PostgreSQL 17 baseline / evidence-amended full CI pending** ([run 37914755065](https://github.com/lazyxu/xdrive/actions/runs/37914755065), benchmark job 113768126932, 3 samples per stage). Measurement-only
`perf/gallery-cleanup-extreme-100k-*` branch; no product query, pagination,
CAS, metadata, allocation or concurrency policy change in this PR.

- **Named fixture:** PostgreSQL 17, one owner; **100,000 logical PhotoAssets
  and 115,000 physical media nodes** (70k JPEG, 15k videos, 15k genuine
  still+motion Live Photo relations), derived from
  `mediaGallerySeedFirstOpen100K`. Same baseline enrichments as #1100:
  **2,000 SHA duplicate groups** over 10k identical-principal photos and
  **2,000 three-frame Burst groups**.
- **Four separately identified query stages:** original 2k duplicate
  groups; original 2k Burst groups; one 10k-copy SHA group (with the
  MediaMetadata and PhotoResource SHA mirrors updated consistently); and
  **10k total Burst groups** (8k additional three-frame groups, each using
  different already-existing nodes). Preserve exactly 100k logical assets and
  115k media nodes across phases. Full owner and folder permissions remain
  unchanged; the fixture does not touch real user albums or bytes.
- **Measurement:** each stage directly invokes existing production
  `queryDuplicateGroups` or `queryBurstReviews` with `limit=48, offset=0`
  three times. Record each elapsed milliseconds, rows, full group/member
  totals and Go TotalAlloc delta; compute p50 per stage. Database schema
  seed and ANALYZE are excluded from measured query time. HTTP/browser
  paint and thumbnail decode are *not* included; record DB/Go query latency,
  not UI first paint.
- **Correctness gates:** ordinary groups must yield exact 2k/48 results,
  the 10k-copy group must yield exactly 1 group with 10,000 members
  and remain **unverified**, and the 10k Burst groups must yield
  exactly 10k total / 48 visible. A query error, missing group, unsafe
  duplicate recommendation, or dimension mismatch is a failed benchmark,
  not a speedup. Keep return values and owner scope unchanged.
- **Command:** `XD_GALLERY_CLEANUP_EXTREME_PERF=1 XD_TEST_DATABASE_URL=postgres://... go test -run '^TestGalleryCleanupExtremeGroupsPerformance100K$' -count=1 -timeout=30m -v ./internal/api`.
  Dedicated, branch-scoped GitHub/GitLab CI job; the 100k seed must
  **not** run on unrelated PRs.
- **Measured current/BEFORE baseline (PostgreSQL 17, n=3, p50):**
  - 2,000 duplicate groups, first 48 returned: **601.912 ms**;
    allocated bytes per run **1,793,192 / 1,719,080 / 1,765,224**.
  - One 10,000-copy duplicate group, one returned: **720.792 ms**;
    allocated bytes **16,654,336 / 16,683,992 / 16,723,064**.
    This group remained explicitly `unverified` as required.
  - 2,000 3-frame Burst groups, first 48 returned: **61.206 ms**;
    allocated bytes **6,758,160 / 6,769,928 / 6,736,560**.
    The first cold sample was **310.773 ms**, so do not treat its
    p50 as an uncached first-request bound.
  - 10,000 3-frame Burst groups, first 48 returned: **197.763 ms**;
    allocated bytes **36,761,608 / 36,803,776 / 36,799,672**.
  - Fixture seed took **40,446.134 ms**, excluded. All **12/12**
    production query samples passed exact total/visible/member validation
    (duplicate 2,000/48 and 1/1, Burst 2,000/48 and 10,000/48).
    No physical bytes were read.
  - Exact source evidence:
    [ci-run-37914755065.json](performance-evidence/gallery-cleanup-extreme-100k/ci-run-37914755065.json).
- **AFTER result:** N/A (measurement-only PR, **zero production
  optimization changes**). No success-latency percentage, memory
  improvement, or user-visible first-paint speedup is claimed.
  **Acceptance:** preserve this benchmark as reproducible baseline; future
  candidate must record same-host BEFORE/AFTER with n>=3,
  group/member correctness, Go allocations and CPU/SQL statistics where
  available. Large-group member loading and all-Burst aggregation remain
  candidates for cost reduction, not accepted optimizations.
  The evidence-amended commit must rerun authoritative CI before merge.
- **Next decision:** if the 10k-copy group demonstrates unacceptable
  all-member preload cost, investigate bounded per-group assessment without
  changing strict whole-asset equality or personal metadata. If 10k Burst
  groups prove costly, measure a SQL-side group pagination aggregate against
  this same fixture before retaining any optimization. Do not conflate
  `#1131` opt-in Gallery folding and #1124 CAS storage savings with
  cleanup page timing.


## 100k PhotoAsset full-owner memory allocation and CPU profile (2026-10-09)

Status: **Measured baseline / pprof attribution complete; evidence-amended full CI pending (#1152)**. All related PhotoAsset performance PRs through [#1133](https://github.com/lazyxu/xdrive/pull/1133) are merged. The accepted 100k logical / 115k physical / 15k correctly paired Live Photo fixture now completes the **whole production `ReconcileOwner`** successfully, with stable three-sample elapsed **5,156.323 / 5,138.600 / 5,186.514 ms**, p50 **5,156.323 ms** and **zero unnecessary PhotoAsset, PhotoResource or PhotoMetadata write callbacks**.

- **Measured current memory concern (#1133, native PostgreSQL 17, n=3):** Go per-call `runtime.MemStats.TotalAlloc` deltas **3,768,190,712 / 3,766,910,584 / 3,766,977,312 B**. This is ~3.77 GB *cumulative allocation per successful 100k reconcile*, **not simultaneous live memory or peak RSS**. End-of-call Linux VmRSS snapshots were **740,466,688 / 708,726,784 / 767,270,912 B**. Root cause is not yet attributed; do not introduce caching, object retention or narrower projection rows without profile evidence.
- **New fixed attribution workload:** the same production `TestPhotoAssetOwnerReconcilePerformance100K` and native PostgreSQL 17 fixture: **100k logical PhotoAsset / 115k Node+File / 15k complete Live Photo groups / 115k resources / 100k collection memberships**, three successful unchanged-state reconciliations in one test process. Seed excluded from its per-call elapsed; record three elapsed/TotalAlloc/VmRSS start/end measurements. Additionally enable Go `-memprofile` with 16 KiB sampling and `-cpuprofile`; emit **alloc_space**, **inuse_space** and CPU `go tool pprof -top -nodecount=30` tables with exact named functions and cumulative shares. Profiling adds overhead, so its elapsed must **not** be compared to the old unprofiled 5.156 s as a speedup/regression ratio.
- **AFTER / measured profiling (native PostgreSQL 17):** [CI run 37922007955](https://github.com/lazyxu/xdrive/actions/runs/37922007955), [scoped job 113791918307](https://github.com/lazyxu/xdrive/actions/runs/37922007955/job/113791918307), 100k/115k/15k fixture, all **3/3 full `ReconcileOwner` successful** and 100k/115k/100k cardinality exact, with **zero redundant asset/resource/metadata write callbacks**. Per-call instrumented wall times **4,497.009 / 3,980.129 / 4,087.210 ms**, median **4,087.210 ms**. Per-call `TotalAlloc` deltas **3,769,975,720 / 3,766,787,616 / 3,766,848,560 B**; end-of-call VmRSS snapshots **653,058,048 / 772,513,792 / 733,442,048 B**, which are **not peak RSS**. Seed **33,517.841ms**, excluded from individual `ReconcileOwner` times. These times were collected under pprof and are **not comparable timing speedups** versus unprofiled #1133 5,156.323ms.
- **Profile hotspot attribution (whole test including seed plus all 3 reconciles; `alloc_space` total 10,793.17 MB):** `reflect.growslice` **5,990.51 MB (55.50%)** flat; `reflect.New` **1,720.23 MB (15.94%)**; `photoasset.reconcileAssetsDB` **1,058.95 MB (9.81%)** flat / **7,654.05 MB cumulative (70.92%)**; `reconcileCollectionsDB` **294.73 MB (2.73%)** flat / **3,130.91 MB cumulative (29.01%)**. CPU profile records **16.23 s of CPU samples over 46.59 s of test wall time**, with cumulative GORM struct scan **5.32 s (32.78%)**, Go GC scanobject **4.12 s (25.39%)**. **Interpretation:** GORM/reflection projection materialization is a strong candidate for a later narrower/typed read experiment, but the allocation profile covers fixture seeding and all three runs; do **not** attribute these percentages exclusively to `ReconcileOwner` or mistake sampled pprof `inuse_space` (**305.39 kB sampled**) for process retained memory.
- **Decision:** accept the **measurement-only profile**; preserve unchanged production code. Next separate A/B PR should isolate recurring projection reads from fixture seed and compare typed/lean columns or bounded allocations on exactly the same 100k dataset. Require **≥20% per-call TotalAlloc improvement**, ≤5% elapsed regression, ≤10% comparable RSS regression and exact Live/RAW/album/user metadata with no increased SQL round trips. If benefits do not exceed noise, reject and record. Exact machine-readable [ci-run-37922007955.json](performance-evidence/photoasset-owner-alloc-profile-100k/ci-run-37922007955.json) and profile top [pprof-top-37922007955.txt](performance-evidence/photoasset-owner-alloc-profile-100k/pprof-top-37922007955.txt). The full profiling binary artifacts remain in CI temporarily.
- **Acceptance:** all three production calls still succeed and preserve authoritative 100k/115k/15k/100k counts; profile files must be nonempty and top attribution readable, CPU/alloc/inuse tables captured as CI logs/artifacts. **No production code is changed in this experiment.** If a dominant attributable Go/GORM stack is revealed, predeclare an optimization with a stable A/B on the same fixture: aim for at least **20% reduction in TotalAlloc** with no more than **5% wall-time regression, 10% process-RSS regression**, and no data or memory-lifetime correctness regressions; otherwise mark the candidate rejected and keep original code.
- **Command:** `XD_PHOTOASSET_OWNER_WRITE_DIAGNOSTIC=1 XD_TEST_DATABASE_URL=postgres://... go test -run '^TestPhotoAssetOwnerReconcilePerformance100K$' -count=1 -timeout=17m -v -cpuprofile=photoasset-profile/cpu.pprof -memprofile=photoasset-profile/alloc.pprof -memprofilerate=16384 ./internal/api`, then `go tool pprof -sample_index=alloc_space -top` and matching CPU/in-use. GitHub/GitLab branch-scoped job `photoasset-owner-alloc-profile-100k-performance`. Profile results and a text/JSON attribution summary must be amended into this canonical document and `docs/performance-evidence/photoasset-owner-alloc-profile-100k/` **in the same one-work-commit PR**, then the exact evidence-amended head must pass full CI.
- **Explicit exclusions:** no real Browser/Electron renderer, FileExplorer, HTTP thumbnails, transfer, physical disk, Store/CAS or native device workload is measured by this SQL/Go benchmark. Those already have separate named 100k and 4 GiB baselines in their canonical performance documents; do not conflate CPU samples with browser decode or 4 GiB throughput.

## PhotoAsset unchanged projection write elision — bounded P0 candidate (2026-10-09)

Status: **Measured / accepted native 100k production candidate; reconstructed-head full CI pending (#1133)**; dependent on merged measurement-only [#1129](https://github.com/lazyxu/xdrive/pull/1129), which measured 100k/115k owner-wide reconcile timing out at 60,000.172 ms with **46,743 PhotoAsset UPDATE + 46,743 PhotoResource DELETE + 46,743 PhotoResource CREATE + 46,742 PhotoMetadata UPSERT** callback observations (186,971 total, partial 46.7k assets). No successful 100k BEFORE elapsed exists; benchmark callbacks are not driver SQL statement counters.

- **Production change:** retain old write logic for assets with changed Kind/Evidence, technical media metadata, missing/mismatching resources or missing metadata. For unchanged items, compare existing PhotoResource and PhotoMetadata rows loaded in **≤4,096 asset-ID bounded batches**, skip four unnecessary per-asset SQL write calls, and always populate logical Node→Asset membership mapping. Resource comparison covers kind, role, ordinal, node, name, MIME, size, SHA and byte offsets, independent of row order. Metadata comparison covers media/EXIF/video/capture/GPS technical fields but **ignores user-owned Favorite/Description/Tags/People/Vendor fields**; those values are not overwritten by the old upsert either. A changed File size or MediaMetadata dimensions remains an actual write and is tested in the native integration suite.
- **Acceptance before experiment:** native 100k/115k same-fixture diagnostic must observe zero (or at most 5% of previously observed 186,971) unnecessary write callbacks if the fixture is entirely unchanged; no cleanup/integrity regression. If full coordination encounters the next independent collection `IN` parameter limit, keep its error visible and label this phase as partial, not complete success. The changed-resource/metadata, Live, embedded LIVP, owner isolation, soft-deleted snapshots and user annotations tests must remain green. A complete 100k pass must preserve all 115k resources and 100k album memberships; if it does not, collect the next first-red before changing collection logic.
- **First AFTER run exposed next independent bottleneck:** [GitHub CI 37913058228](https://github.com/lazyxu/xdrive/actions/runs/37913058228), [scoped job 113762565068](https://github.com/lazyxu/xdrive/actions/runs/37913058228/job/113762565068), native PostgreSQL 17, 100k PhotoAsset / 115k Node / 15k Live groups. The clean repeated asset update step issued **0 PhotoAsset UPDATE / PhotoResource DELETE / PhotoResource CREATE / PhotoMetadata UPSERT callbacks**, versus **186,971 write callbacks** observed during the former 60s timed-out run (not a paired timing comparison). The full reconcile then failed at `internal/photoasset/collections.go:43` with `extended protocol limited to 65535 parameters` after **2,509.778 ms**. Transaction rollback preserved all 100k assets, 115k resources, 15k groups, 100k memberships. **This is not an end-to-end success.** Reproduced collection `primaryIDs` and repeated parent-ID query bottlenecks are now bounded to **4,096 IDs/query** and parent IDs deduplicated in the smallest following production patch; next first-red remains subject to actual CI, including potential 100k membership write pressure.
- **Second AFTER run, next first-red:** [GitHub CI 37913978479](https://github.com/lazyxu/xdrive/actions/runs/37913978479), [scoped job 113765878137](https://github.com/lazyxu/xdrive/actions/runs/37913978479/job/113765878137), native PostgreSQL 17 with the same 100k/115k/15k fixture. Clean assets still required **0 asset/resource/metadata write callbacks** and bounded 4,096-ID primary-node reads succeeded. Full reconciliation reached `internal/photoasset/collections.go:269`, then **failed after 5,920.841 ms** when GORM attempted a single INSERT of **100,000 `PhotoCollectionAsset` rows**, causing PostgreSQL's 65,535 bind limit. All 100k assets / 115k resources / 15k Live groups / 100k membership records stayed intact after rollback. **This is failed elapsed, not successful throughput.** The next smallest measured correction leaves matching memberships unchanged and creates changed derived memberships in ≤1,024-row batches; changed source-album membership and stable `CreatedAt` contracts are now part of integration coverage. This was the second observed failure; the subsequent correction and successful results are recorded below.
- **First complete successful 100k/115k AFTER (n=1):** [CI 37914576442](https://github.com/lazyxu/xdrive/actions/runs/37914576442), [native PostgreSQL performance job 113768039680](https://github.com/lazyxu/xdrive/actions/runs/37914576442/job/113768039680). Real production `ReconcileOwner` completed in **5,221.491 ms** (seed **37,921.423 ms**, excluded), with **100,000 PhotoAsset**, **115,000 PhotoResource**, **15,000 Live Photo groups**, **1 derived folder collection** and **100,000 member rows**, committed successfully; **0** PhotoAsset/resource/metadata write callbacks on the unchanged fixture, no PostgreSQL parameter overflow. This is a verified **failure-to-success** outcome, not a comparable speedup ratio against a prior timed-out operation. A new same-environment three-successful-run diagnostic now captures median/range, Go managed-heap allocation deltas and Linux `VmRSS` start/end **snapshots (not process peaks)** to qualify repeatability before merge; CPU remains uninstrumented. The three-sample measurements are recorded chronologically below; they are not a cross-environment timing comparison.
- **Successful repeated 100k full-owner AFTER (n=3, final source pre-evidence amendment):** native PostgreSQL 17 [CI 37916019316](https://github.com/lazyxu/xdrive/actions/runs/37916019316), [performance job 113772840099](https://github.com/lazyxu/xdrive/actions/runs/37916019316/job/113772840099), measured one fixed 100k logical/115k physical/15k Live Photo fixture. Production `ReconcileOwner` completed **5,156.323 / 5,138.600 / 5,186.514 ms**, median **5,156.323 ms**. Every run returned **100k PhotoAsset, 115k PhotoResource, one derived collection, 100k memberships**, with **0** PhotoAsset/resource/metadata rewrite callbacks, **no 65,535-bind overflow**, and valid committed state. Data seeding **37,825.757 ms** was excluded. Linux process `VmRSS` start/end snapshots (not peaks) by sample: **37,789,696 → 740,466,688 B; 740,466,688 → 708,726,784 B; 708,726,784 → 767,270,912 B**. Per-run Go `runtime.MemStats.TotalAlloc` delta **3,768,190,712 / 3,766,910,584 / 3,766,977,312 B**, indicating potential future allocation pressure but **not** simultaneous live memory or an accepted new optimization. These memory values are diagnostics; CPU time, peak RSS, remote Server/cache and Web/Desktop renderer remain unmeasured. **Decision:** accept the targeted SQL failure-to-success and no-op write-elision improvement; **do not claim a comparable wall-clock percent speedup** from the prior 60s failed BEFORE. [Raw JSON ci-run-37916019316.json](performance-evidence/photoasset-owner-write-100k/ci-run-37916019316.json). Evidence-amended full PR CI must pass before merge.
- **Decision gate:** no percent wall-clock speedup is claimed from the previously timed-out BEFORE. Retain only a material decrease in observed write operations and a clean correctness result without unacceptable RSS/CPU overhead. The 4,096-size reads must remain bounded. Record AFTER native CI job/source, first-red and raw JSON before final merge. Keep this as one new work commit atop the active #1129 measurement branch; after dependency merge, reconstruct the same one work commit on current master and rerun authoritative CI only if necessary.

## 100k PhotoAsset full-owner post-prune write pressure — diagnostic (2026-10-09)

Status: **Measured baseline / confirmed high write-pressure at 100k / evidence-amended CI pending (#1129)**. Baseline from merged [#1123](https://github.com/lazyxu/xdrive/pull/1123): 100k stale pruning now succeeds in a native PostgreSQL stage benchmark (n=3, p50 **377.987 ms**). This does **not** establish that a full `ReconcileOwner` succeeds at 100k after that fix.

- **Named workload:** isolated native PostgreSQL 17; 70k JPEG photos, 15k video assets, 15k correctly paired Live Photos (30k physical Live Node records): **100k logical PhotoAsset, 115k physical Node/File/MediaMetadata**, 15k groups, 115k resources and 100k album memberships. The existing `TestPhotoAssetOwnerReconcilePerformance100K` fixture remains unchanged. Seed is excluded from the timed diagnostic.
- **BEFORE/current target:** invoke the production `photoasset.ReconcileOwner` with a **60-second diagnostic deadline**. Record wall-clock elapsed, exact error, timeout, total successful/attempted asset UPDATE, resource DELETE/CREATE and metadata upsert callback counts, report counts if successful, and SQL work when canceled. These GORM callback counters add test-only overhead; their timed results must not be compared as a production speedup against earlier uninstrumented CI runs. Do not assume completion or a specific first bottleneck before measurement.
- **Reproduction gate:** if it fails at deadline, require at least 1,000 observed individual asset/resource/metadata write callbacks before classifying it as high-write-pressure; otherwise fail the benchmark and diagnose the actual earlier stage. Any unexpected non-timeout error fails. Regardless of error, aborted transactions must preserve all 100k assets, 115k resources, 15k Live groups and 100k memberships. A clean successful run must reproduce the exact 100k/115k report and persisted cardinality; **CI passing after an expected timeout is a confirmed red baseline, not production success**.
- **Measured full-owner current baseline (n=1):** [GitHub native PostgreSQL 17 CI run 37910746349](https://github.com/lazyxu/xdrive/actions/runs/37910746349), [scoped job 113755021716](https://github.com/lazyxu/xdrive/actions/runs/37910746349/job/113755021716), immutable head `49723011`. Full production `ReconcileOwner` returned **`context deadline exceeded` after 60,000.172 ms** with **no PostgreSQL bind overflow** (fixture seed **37,766.182 ms**, excluded). At deadline, test GORM callbacks observed **46,743 PhotoAsset UPDATE, 46,743 PhotoResource DELETE, 46,743 PhotoResource CREATE and 46,742 PhotoMetadata UPSERT = 186,971 individual write callbacks** before finishing 100k assets. These are callback counts, **not actual driver SQL statement counts**, and instrumentation adds some work, so they are structural evidence of excessive per-asset writes and diagnostic elapsed, not uninstrumented throughput. The transaction rolled back, keeping **100k PhotoAsset, 115k resources, 15k Live groups and 100k memberships**; no soft-deleted or user metadata was destroyed. **Decision:** red performance baseline, production unchanged; targeted no-op write reduction is warranted after unchanged/changed resource and metadata correctness gates. Exact raw data [ci-run-37910746349.json](performance-evidence/photoasset-owner-write-100k/ci-run-37910746349.json). No successful end-to-end elapsed or speedup claim; don't confuse passing measurement job with a successful `ReconcileOwner`.
- **Optimization decision:** only after measured evidence, isolate the high-cost stage (bulk writes, no-op update avoidance, or collection unbounded IN). Predeclare CPU/RSS/query-count and wall-clock acceptance, use the exact same fixture and three successful BEFORE/AFTER samples whenever comparable successful baselines exist; otherwise label a failure-to-success correctness fix without a speedup percentage. Preserve stable Asset IDs, complete Live/RAW resource relations, manual collections, Favorites/Tags/People/Descriptions/EditRecipe, soft-deleted frozen snapshots and cross-owner isolation. Do not optimize Source synchronization on speculation.
- **Command:** `XD_PHOTOASSET_OWNER_WRITE_DIAGNOSTIC=1 XD_TEST_DATABASE_URL=postgres://... go test -run '^TestPhotoAssetOwnerReconcilePerformance100K$' -count=1 -timeout=17m -v ./internal/api`. Branch-scoped GitHub/GitLab `photoasset-owner-write-100k-performance` jobs. Exact resulting CI evidence to be amended into this performance document and `docs/performance-evidence/photoasset-owner-write-100k/`, followed by full CI before merge.

## PhotoAsset owner stale active-asset prune — bounded P0 candidate (2026-10-09)

Status: **Measured / candidate accepted for SQL boundedness; evidence-amended full CI pending (#1123)**. Depends on merged full-owner 100k measurement PR #1121. The stage-1 Node/File preload change was merged in #1114.

- **Confirmed original full-owner failure (#1121):** 100k logical assets, 115k physical nodes, 15k real Live Photo groups; PostgreSQL 17 native full `ReconcileOwner` fails at `assets.go:214` with `extended protocol limited to 65535 parameters` after **2,483.600 ms**. The rolled-back error latency is not successful end-to-end throughput.
- **Named isolated stale-prune A/B:** 100,000 active PhotoAsset + Node rows in PostgreSQL 17, with actual owner-scoped primary-key association. BEFORE evaluates the same `primary_node_id NOT IN ?` 100k-bind delete shape and expects failure. AFTER calls **production** `loadAndPruneStalePhotoAssets` three times on unchanged clean fixture; report per-sample successful elapsed and p50, exact 100k retention and no parameter overflow. No percentage speedup may be computed against failed BEFORE.
- **Correctness workload:** exclude 4,300 primaries from desired and soft-delete 50 of them. The other **4,250** remain active and must be pruned through **two ≤4,096-ID DELETE batches**; 50 soft-deleted snapshots, their Favorite/Tags/People/Description/Resource/Album membership, plus an unrelated owner's asset, must remain. Stale active PhotoAsset relations must cascade away. No SQL expands a 100k `NOT IN` list.
- **AFTER native CI measured:** [run 37908272387](https://github.com/lazyxu/xdrive/actions/runs/37908272387), [job 113746939701](https://github.com/lazyxu/xdrive/actions/runs/37908272387/job/113746939701), PostgreSQL 17, opt-in `TestPhotoAssetStalePrunePerformance100K`. Old same-schema 100k expanded `NOT IN` failed with `extended protocol limited to 65535 parameters` in **78.136 ms** (**failure** latency). New production helper returned exactly **100,000 PhotoAsset per run** in **377.987 / 380.604 / 364.554 ms** (n=3, median **377.987 ms**), well below the predeclared 10s diagnostic budget. Separate stale-data case pruned **4,250 active assets in 2 ≤4,096-ID batches**, retained **50 soft-deleted frozen assets** with unchanged Favorite/Tags/People/Description, preserved relevant resources and album memberships, cascaded stale relationships, and kept **1 unrelated-owner asset** unchanged; remaining owner assets **95,750**. Fixture seed **6,794.987 ms**, excluded from prune elapsed. Raw [ci-run-37908272387.json](performance-evidence/photoasset-owner-stale-prune-100k/ci-run-37908272387.json). **Decision: keep bounded correctness fix; no successful baseline speedup is claimed.** This is a focused 100k owner+Node prune fixture, **not** the full 115k-media/15k-Live reconciliation or an actual Web/Desktop test. Process RSS and CPU were not recorded; those aspects remain unmeasured.
- **Production method:** reuse the existing owner-wide PhotoAsset lookup, read active primary IDs with one owner-scoped indexed JOIN, classify stale IDs in Go, then delete stale IDs in bounded batches. No changes to image grouping, Live/RAW matching, metadata upserts, per-asset write logic or collection reconciliation. Context cancellation is handled by the enclosing GORM WithContext transaction.
- **Acceptance:** all three successful AFTER samples contain exactly 100k retained rows, all stale/frozen/owner/cascade assertions hold, original oversize SQL fails, latency and allocation observations recorded; full PR Go/Web/Desktop CI green. This is a reliability/SQL-boundedness fix, not a demonstrated full 100k `ReconcileOwner` acceleration. The full owner run and later `loadGroups`, collection lookup, resource/metadata N+1 write costs remain separately red/unmeasured.
- **Command:** `XD_PHOTOASSET_STALE_PRUNE_PERF=1 XD_TEST_DATABASE_URL=postgres://... go test -run '^TestPhotoAssetStalePrunePerformance100K$' -count=1 -timeout=17m -v ./internal/photoasset`. GitHub/GitLab scoped job `photoasset-owner-stale-prune-100k-performance`. AFTER and exact raw JSON to be committed in this canonical document after first CI, amended into one work commit, then full CI rerun.

## Complete PhotoAsset owner reconciliation 100k/115k — failure baseline (2026-10-09)

Status: **Merged / full-owner first-red baseline (#1121; final [CI 37906874701](https://github.com/lazyxu/xdrive/actions/runs/37906874701) passed)**. Depends on merged [#1114](https://github.com/lazyxu/xdrive/pull/1114); stage-1 production Node/File preload batching is already in `master`. This fixture explicitly calls the **whole production `photoasset.ReconcileOwner`** (not the isolated 115k helper), with one cold owner-wide pass and a bounded 120-second context.

- **Named actual projection:** 70,000 standalone JPEG assets, 15,000 standalone video assets, 15,000 Live Photo assets with **15,000 still + 15,000 motion nodes**, total **100,000 logical PhotoAsset / 115,000 physical Node+File+MediaMetadata**; 15,000 real MediaGroup associations, 115,000 PhotoResource records and 100,000 folder-album memberships in isolated native PostgreSQL 17. The fixture is reused from `mediaGallerySeedFirstOpen100K` with existing users/media/album schema and ANALYZE. No fabricated Live pairing by filenames at reconciliation time.
- **BEFORE measurement (new scope):** seed outside timed region; run `ReconcileOwner` through both asset and collection phases and log complete `error`, elapsed failure/success latency, counts before/after, report counts if successful, timeout status and rollback integrity. Predeclared reproduction target is the already-observed **oversized 100k `primary_node_id NOT IN ?`** after stage-1 preload; a different first failure must be reported, not disguised.
- **Acceptance:** baseline job is allowed to pass only when it reproduces the known PostgreSQL 65,535-parameter error **and the failed transaction preserves pre-existing 100k assets, 115k resources, 15k Live groups and 100k memberships**, or when the complete reconciliation unexpectedly succeeds with all expected report counts. Any other error or deadline is a failed benchmark. The failure time is *not* a successful 100k reconcile elapsed and cannot be used as an acceleration denominator.
- **BEFORE measured / confirmed first failure:** native PostgreSQL 17 on [GitHub Actions run 37906318064](https://github.com/lazyxu/xdrive/actions/runs/37906318064), [scoped job 113740534952](https://github.com/lazyxu/xdrive/actions/runs/37906318064/job/113740534952), single `ReconcileOwner` invocation. After stage-1 bounded Node/File preload, SQL at `internal/photoasset/assets.go:214` (active stale-asset prune with `primary_node_id NOT IN ?`) fails with `extended protocol limited to 65535 parameters`. **Failure latency 2,483.600 ms (n=1)**; seed **37,352.931 ms**, separately excluded. 100,000 PhotoAsset, 115,000 PhotoResource, 15,000 Live groups and 100,000 collection memberships remain unchanged after transaction rollback. No 120s timeout or unrelated assertion failure. Raw CI measurements archived at [ci-run-37906318064.json](performance-evidence/photoasset-owner-reconcile-100k/ci-run-37906318064.json). **This is failed-request latency, not successful end-to-end performance or speedup.**
- **No production optimization yet:** first record raw native PostgreSQL evidence; then independently fix stale active-asset deletion, oversize collection node/member IDs, derived resource N+1, and per-asset write amplification. Any changes require same-fixture BEFORE/AFTER n≥3 successful comparisons and Live/RAW, soft-deleted, Favorite/Tags/People/EditRecipe/album correctness coverage.
- **Native benchmark command:** `XD_PHOTOASSET_OWNER_RECONCILE_PERF=1 XD_TEST_DATABASE_URL=postgres://... go test -run TestPhotoAssetOwnerReconcilePerformance100K -count=1 -timeout=17m -v ./internal/api`. Evidence/result location: `docs/performance-evidence/photoasset-owner-reconcile-100k/` (to be recorded after CI). No browser, file bytes, remote Store, preview decoding or Web/Desktop painting in this test.

## Production PhotoAsset Node/File bounded read — stage 1 (2026-10-09)

Status: **Merged / accepted (#1114; final evidence-amended [CI 37904671868](https://github.com/lazyxu/xdrive/actions/runs/37904671868) passed)**. Follow-up to merged [#1106](https://github.com/lazyxu/xdrive/pull/1106). The production change is limited to both owner-scoped Node/File preload call sites in `reconcileAssetsDB`; it is not complete 100k owner reconciliation.

- **BEFORE (#1106, native PostgreSQL 17):** 115,000 MediaMetadata / Node / File rows (100k JPEG-named + 15k MOV-named). One unbounded `Preload("File")` query failed after **204.380 ms** on the PostgreSQL 65,535-parameter limit. Failure latency is **not** successful throughput.
- **Earlier test-only bounded candidate (#1106):** 4,096 IDs/batch, 29 Node and 29 File preload queries, no more than 4,099 bind parameters, 115k Node/File identities; n=3 elapsed **1262.892 / 1028.234 / 1044.908 ms**, p50 **1044.908 ms**.
- **Production AFTER / measured on original stage 1 head `0bf4001c`:** [GitHub CI 37904228707](https://github.com/lazyxu/xdrive/actions/runs/37904228707), [photoasset performance job 113734085950](https://github.com/lazyxu/xdrive/actions/runs/37904228707/job/113734085950). Native PostgreSQL 17, **n=3: 917.961 / 790.676 / 788.586 ms**, median **790.676 ms**; all **115,000 exact unique owner-scoped Node/File associations** verified each sample. **29 Node + 29 File queries** per sample with maximum **4,099** Node bind parameters; no SQL bind-limit error on the candidate. MediaMetadata fetch **831.318 ms**, seed **9,479.711 ms**, baseline unbounded query failed after **175.755 ms**, separately excluded from candidate elapsed.
- **Decision: accepted and merged into production (#1114)**. Before and successful comparator are different CI runner runs, and the original comparator consumed each batch without retaining the full resulting Node slice, whereas production aggregates all nodes. **No wall-clock percentage speedup is asserted.** This change removes a proven failure mode while keeping the same owner, node type, deleted-state predicates and File relations.
- **Validation:** production helper called by the native benchmark, owner/uniqueness/File cardinality checked; scoped PostgreSQL test PASSED. Final full PR CI must pass on the evidence-amended single commit before merging. Workload command: `XD_PHOTOASSET_NODE_PRELOAD_PERF=1 XD_TEST_DATABASE_URL=postgres://... go test -run TestPhotoAssetOwnerNodePreload100K -count=1 -timeout=12m -v ./internal/photoasset`. Exact samples: [ci-run-37904228707.json](performance-evidence/photoasset-owner-node-preload-100k/ci-run-37904228707.json).
- **Remaining P0:** full `ReconcileOwner` needs set-based stale asset pruning instead of oversized `NOT IN`, bounded MediaGroup/Collection reads, and per-asset resource/metadata write optimizations. This query fixture does not pair MOV nodes into Live Photos. No full 100k logical/115k physical end-to-end success claim; CPU/RSS end-to-end and Go context cancellation are not tested by this stage.

## 100k PhotoAsset owner Node/File loading: parameter-limit baseline (2026-10-09)

Status: **Measured query-stage feasibility / no production code change** ([CI 37900391031](https://github.com/lazyxu/xdrive/actions/runs/37900391031), job [113721314344](https://github.com/lazyxu/xdrive/actions/runs/37900391031/job/113721314344)). The same native PostgreSQL 17 schema reproduces the 65,535-bind failure and verifies all 115k Node/File associations using a bounded 4,096-ID fetch.

- Named fixture: **100,000 JPEG-named nodes + 15,000 MOV-named nodes**, each with File and ready MediaMetadata, owner-scoped PostgreSQL 17 native schema. The 15k MOVs are separate physical nodes and **not** artificially paired into Live Photo groups in this fixture. It reproduces the exact 115k-ID query-size boundary but is not the entire 100k logical-asset domain projection.
- BEFORE in this identical native schema: one GORM `Preload("File").Where("id IN ?")` with 115,000 IDs; expected PostgreSQL extended-protocol parameter overflow. Previous Gallery PR #1100 already measured full owner reconcile failing around **1.6–1.7 seconds** on a separate CI runner; those are diagnostic failure timings, not same-host successful throughput.
- Candidate (measurement only): preserve owner, file type, deleted-state predicates, and file association; split preloaded Node and File queries into **4,096-ID** batches (**29 Node SELECT + 29 File SELECT**), with no SQL statement exceeding **4,099** bind parameters. Verify **115,000 exact Node+File identities** and no silent omissions for each of **three samples**; report per-sample elapsed, median, metadata query and fixture setup separately.
- Accept the query-stage feasibility only on complete exact result cardinality, zero SQL parameter-limit errors, three samples, bounded binds, and no cross-owner data. Do **not** claim `ReconcileOwner` 100k-safe or improved end-to-end latency; asset stale deletion, group source loading, collection membership and per-asset writes remain separate risks requiring their own measurements and batched implementations.
- Command: `XD_PHOTOASSET_NODE_PRELOAD_PERF=1 XD_TEST_DATABASE_URL=postgres://... go test -run '^TestPhotoAssetOwnerNodePreload100K$' -count=1 -timeout=12m -v ./internal/photoasset`. Scoped GitHub/GitLab job `photoasset-owner-node-preload-performance`. No concurrent browser/thumbnail task in this test.
- **BEFORE/current (n=1):** the unchanged 115,000-ID GORM `Preload("File")` Node query fails after **204.380 ms** with `extended protocol limited to 65535 parameters`; expected failure, not successful throughput.
- **Candidate query-only strategy (n=3):** 4,096 IDs per batch, **29 Node SELECT + 29 File association SELECT**, all **115,000 Node** objects and their **115,000 associated File** rows verified every sample. Measured **1,262.892 / 1,028.234 / 1,044.908 ms**, median **1,044.908 ms**. No statement expands more than 4,099 bind parameters. Metadata scan **927.893 ms**; fixture seed **9,177.700 ms** (setup, not query).
- **Decision:** the batched query shape is **accepted as a candidate for the Node/File stage**, but this PR retains **no production modification**. It repairs the oversized-query *failure*, not a demonstrated successful-query speedup. This benchmark alone does not validate soft-deleted assets, group/derived resources, collections or the 100k write path.
- **Next performance PR:** replace the first failing production preload with bounded reads, then independently measure and fix the remaining `NOT IN`, collection-node and per-asset write bottlenecks. A full `ReconcileOwner` must succeed on a real 100k logical/115k physical fixture before status can be advanced to fully scalable.
- Full unrounded fixture and per-sample evidence: [ci-run-37900391031.json](performance-evidence/photoasset-owner-node-preload-100k/ci-run-37900391031.json). Post-document-formatting full CI remains the merge gate.
## Gallery cleanup group pagination — G11 phase 2a (2026-10-09)

Status: **Unmeasured / complexity-only, validation pending**. The duplicate
and Burst group list endpoints now accept bounded `offset` windows with a
48-card initial shared Web/Desktop view. The first-window query, whole-library
group counts and derived recommendation correctness are unchanged. Burst
groups still enumerate eligible source rows before sorting and slicing;
this PR does **not** claim a 100k latency reduction or an alternative SQL
plan. Group-page correctness is validated by PostgreSQL and 53-group
pure/page-contract tests; any future performance-specific optimization must
use the canonical named 100k workload and same-host BEFORE/AFTER as required
by `AGENTS.md`.

## Gallery entry performance — Memories, 同步文件夹, 清理建议 (2026-10-09)

Status: **Merged / accepted (#1100)**. Initial source commit `c55044b6e4c79cbf94da0acb75ced5e9bb588c48` failed all three affected HTTP endpoints. The measured minimal handler-only change uses the pre-existing Gallery stale-node probe before any owner-wide reconciliation; the unchanged stale-data path still runs original reconciliation. Three-pair same-host native PostgreSQL/Gin validation [run 37897331199](https://github.com/lazyxu/xdrive/actions/runs/37897331199) **passed**; final evidence-amended CI [run 37898368646](https://github.com/lazyxu/xdrive/actions/runs/37898368646) passed and PR #1100 merged.

### Fixed named workload

- **100,000 logical Gallery assets**, **115,000 physical media nodes** (70k photos, 15k videos, 15k Live Photos paired with 15k motion resources), from the existing native Gallery first-open fixture; add 256 child directories and one owned synchronization folder rooted at the 100k media directory. This is a synthetic owner-scoped PostgreSQL schema, not a real production account.
- Add 8,000 geotagged still items spread over 180 captured days and two 5° geographic cells to exercise trip classification; add 10,000 photo file references sharing 2,000 SHA-256 hashes for duplicate cleanup, and 2,000 three-frame burst groups for cleanup. Media provenance and logical-photo identity continue to come from local canonical tables.
- Execute each **three times** in one native PostgreSQL 17 environment: steady Gallery stale-node probe, trip-day enumeration, Memories aggregate, synchronization-folder list, one folder-open aggregate, duplicate groups, burst reviews; then measure five authenticated real Gin/loopback GET endpoints individually with full response-body reads. Owner-wide indexing refresh is probed **once at the end**, after read-only fixture validation, to avoid its destructive side effects on synthetic Burst grouping. The CI job runs BEFORE and AFTER in isolated PostgreSQL schemas on the same runner; record timings (ms), result counts, response bytes, and seed time.
- This measures live Go code and real PostgreSQL/loopback HTTP including handler-side projection refresh. It does **not** measure remote HTTP throughput, Viewer/media decoding, thumbnail requests, actual browser painting or simultaneous user clicks. Cleanup UI fires duplicate/burst calls concurrently; these tests isolate them to distinguish their costs without attributing concurrent DB contention to one endpoint.

### Decision gates

- First CI creates the frozen **BEFORE/current** baseline. Treat an endpoint median over **1,000 ms** or one isolated query stage over **500 ms** as a performance investigation trigger (not as proof that production hardware is slow). Any proposed change must preserve owner isolation, exact grouping/counters, source-folder scope, output ordering, non-destructive cleanup recommendations and existing direct-asset rules.
- Optimize only a reproduced high-cost stage, using at least three paired same-run BEFORE/AFTER samples of the **identical workload**. Retain only if the attempted endpoint elapsed time decreases at least **30% and 100 ms absolute**, the previous HTTP 500 becomes **HTTP 200** with correct counts, and neither Sync Folder latency nor the direct query stages materially regress. The BEFORE times ended in HTTP 500, so these percentages are diagnostic elapsed-time reductions, not a successful-request speedup claim. Failed experiments must be documented.
- Benchmark: `XD_GALLERY_ENTRY_PERF=1 XD_TEST_DATABASE_URL=postgres://... go test -run '^TestGalleryEntryEndpointsPerformance100K$' -count=1 -timeout=25m -v ./internal/api`. GitHub/GitLab scoped job: `gallery-entry-100k-performance`. The GitHub job checks out the exact one-work-commit PR head with parent `c55044b6e4c79cbf94da0acb75ced5e9bb588c48`, runs both using the **identical fixture source** on one runner, and enforces the frozen acceptance in `scripts/ci/validate-gallery-entry-paired.mjs`. Paired A/B acceptance passed in run 37897331199; the amended performance evidence and formatting passed the final full PR CI and PR #1100 was merged.

### Measured causes and remaining hypotheses

- Memories currently computes yearly-date, 14-day and all-history geotagged trip grouping; each derived trip segment invokes an additional date-range summary. The requested 48-item limit is applied **after** trip enumeration/summary, so more total history can cost more even with few visible cards.
- Cleanup loads exact-duplicate and burst-review endpoints in parallel. BEFORE, both handlers invoke the owner refresh path before their own aggregation; the refresh executes media-group and photo-asset reconciliation even without stale media, reproducing a PostgreSQL parameter overflow at 100k. After change, the three affected handlers share the existing conditional Gallery-read refresh. The duplicate aggregate still runs separately for visible groups and totals; no speculative SQL rewrite is included.
- Synchronization-folder root/view reads aggregate media counts and covers over folder contents and directory children. Root paths may also require multiple parent lookups. Measure query stage before considering caching, pagination or data model changes.

**BEFORE measured / source d28018a8393e4456c9fb73cdc1b1895f97c163fc:** [CI 37896354525](https://github.com/lazyxu/xdrive/actions/runs/37896354525), [job 113708859022](https://github.com/lazyxu/xdrive/actions/runs/37896354525/job/113708859022), n=3 for direct/HTTP stages, except owner refresh probed once after the read-only samples. The fixture supplied stable 2,000 burst groups and 2,000 duplicate groups. The original benchmark was rejected because refresh side effects changed synthetic Burst groups mid-run; it was moved after the read-only phases. Corrected data: [raw JSON](performance-evidence/gallery-entry-100k/ci-run-37896354525-before.json).

| Current BEFORE phase | Median ms | Outcome |
| --- | ---: | --- |
| cleanup-bursts | 61.625 | OK |
| cleanup-duplicates | 584.275 | OK |
| gallery-index-probe | 355.095 | OK |
| http-cleanup-bursts | 1608.976 | ERROR / HTTP 500 |
| http-cleanup-duplicates | 1633.575 | ERROR / HTTP 500 |
| http-memories | 1578.887 | ERROR / HTTP 500 |
| http-sync-folder-open | 517.828 | OK |
| http-sync-folders | 530.116 | OK |
| memories-index | 180.869 | OK |
| memories-trip-days | 46.733 | OK |
| sync-folder-open | 160.772 | OK |
| sync-folders-index | 146.653 | OK |
| owner-index-refresh | 1603.581 (n=1) | ERROR: PostgreSQL bind parameters >65535 |

- Root cause confirmed in BEFORE: three read-only route handlers call `refreshMediaIndexForOwner`; even on zero stale media, that function runs owner-wide media-group/PhotoAsset reconciliation. 100k logical assets / 115k media nodes trigger `extended protocol limited to 65535 parameters` in existing `internal/photoasset/assets.go` reconciliation. This is distinct from normal Gallery `refreshMediaIndexForGalleryRead` that probes for stale media and avoids reconciliation on clean reads. **The underlying full-owner background reconcile bug is not addressed by this read-handler-only performance fix.**
- **Current decision: optimize the three read-only handlers only.** Swap to the existing `refreshMediaIndexForGalleryRead` helper for Memories, duplicate groups, burst reviews; keep owner refresh if stale rows are found and retain original background owner reconciliation semantics. Sync folders remain unchanged (their GET endpoints return 200 and the time-to-load is below the predeclared 1000 ms warning budget).
- The same-host paired AFTER values are recorded below and accepted; the final evidence-amended CI passed and PR #1100 was merged. The BEFORE requests failed with HTTP 500, so the reductions describe failed-request versus successful-request elapsed time, not an apples-to-apples successful-loading speedup. The full-owner projection refresh failure is explicitly retained.
### Same-host paired native CI acceptance — PR #1100 (2026-10-09)

**Scope and provenance:** [CI run 37897331199](https://github.com/lazyxu/xdrive/actions/runs/37897331199), job `113711565521`, PostgreSQL 17 + production Gin localhost HTTP, 100k logical assets / 115k physical media nodes. Original owner refresh code is parent `c55044b6e4c79cbf94da0acb75ced5e9bb588c48`; optimized one-work-commit source was `84b1296cfb46e2ef35242c81d3a4144204f54854`. The identical frozen Go fixture was run in isolated schemas on the **same CI host**; n=3 for HTTP and direct-query phases. The initial `go-linux` check failed only because of three `gofmt` alignments in the new benchmark test. These have been corrected before the final CI. The browser/mobile/IPC path has not been measured here.

| Stage | BEFORE p50 (ms) | AFTER p50 (ms) | Response / assessment |
| --- | ---: | ---: | --- |
| Memories HTTP | 1588.505 | **531.442** | **500 → 200**; failed-request elapsed -66.5% |
| Cleanup duplicates HTTP | 1572.987 | **971.078** | **500 → 200**; failed-request elapsed -38.3% |
| Cleanup burst suggestions HTTP | 1552.006 | **418.468** | **500 → 200**; failed-request elapsed -73.0% |
| Sync Folder list HTTP (unchanged code) | 504.703 | 514.896 | **200 → 200**, +2.0%, within 25%/150 ms non-regression gate |
| Sync Folder open HTTP (unchanged code) | 510.959 | 524.370 | **200 → 200**, +2.6%, within gate |
| Memories direct aggregate | 180.973 | 173.034 | 20 rows; no meaningful regression |
| Duplicate direct aggregate | 604.042 | 599.261 | 2000 groups; no meaningful regression |
| Burst direct aggregate | 55.955 | 59.250 | 2000 groups; no meaningful regression |
| Gallery clean index probe | 356.083 | 353.911 | No stale media, no owner-wide reconcile from three affected read routes |
| Sync Folder list direct SQL | 148.777 | 145.477 | 1 folder |
| Sync Folder directory direct SQL | 168.310 | 164.241 | 256 child folders |
| Full-owner media asset reconciliation (diagnostic only, n=1) | 1599.453 | 1701.099 | **Still fails**: PostgreSQL extended protocol limited to 65,535 parameters |

Each affected AFTER HTTP call returned three **HTTP 200** responses of identical response length: Memories **4661 bytes**, duplicates **17727 bytes**, bursts **13800 bytes**. Unchanged Sync Folder list/open returned **267/35610 bytes** respectively in both conditions. The benchmark validator reported `passed=true`, all error arrays empty; no direct result count drift. No successful-response speedup percentage is asserted because the BEFORE routes failed. **Decision: accept the narrow read-handler fast path** and preserve the separate full-owner reconciliation issue for a measurement-first follow-up.

**Durable raw evidence:** [BEFORE per-sample JSON](performance-evidence/gallery-entry-100k/ci-run-37897331199-before.json), [AFTER per-sample JSON](performance-evidence/gallery-entry-100k/ci-run-37897331199-after.json), and [acceptance report](performance-evidence/gallery-entry-100k/ci-run-37897331199-acceptance.json), as returned by the linked Actions artifact. AFTER values were obtained without altering the original direct aggregation SQL or the Sync Folder handlers. The remaining photoasset owner-wide reconciliation bug should be addressed separately with a 100k clean/stale fixture and batch-bound DB parameter regression before considering additional endpoint caching or schema changes.

## Status index

| Area | Status | Evidence |
| --- | --- | --- |
| PhotoAsset owner-wide Node/File preload (115k) | **Measured query-stage / no production change (#1106)** | Real PostgreSQL 17; 115k media nodes | Baseline GORM `IN` fails after 204.380 ms; **29 bounded Node + 29 File SELECTs, 115k exact associations, 1,044.908 ms median (n=3)**. Candidate shape works; full owner reconcile remains unmeasured/broken. |
| Gallery entry tabs: Memories, 同步文件夹 and 清理建议 | **Merged / accepted (#1100)** | PostgreSQL 17 / Gin loopback / 100k logical, 115k physical; 3 matched samples. Memories/duplicates/bursts HTTP **500 → 200**, elapsed **1588.5 → 531.4 / 1573.0 → 971.1 / 1552.0 → 418.5 ms**. Sync-folder list/open **504.7 → 514.9 / 511.0 → 524.4 ms** (no meaningful regression). No browser first-paint claim; full-owner 65,535-parameter path remains broken. |
| Video poster viewport cancellation (100k logical videos) | **A/B accepted / complete regression pending (#1088)** | Persisted-first helper + 3-active/3-queued real Node HTTP workload; three paired samples each for warm GET and cold preview | BEFORE **3/3 stale HTTP active, 24,576 B late data**; AFTER **3/3 early abort, 0 old active/bytes**. Warm last-abort 1.73–2.88 ms; cold 0.97–1.28 ms. Cold stale backfill **3 → 0 per sample**. No codec/Go end-to-end claim. |
| Gallery viewport HTTP abort optimization | **Paired HTTP A/B passed / full regression pending (#1083)** | BEFORE: 0/6 abort; AFTER: 6/6 abort and zero stale payload at +160 ms, n=3; abort latency 1.638–3.863 ms. Real Gin/derivative and Gallery video poster require independent coverage. |
| Gallery stale thumbnail transport cancellation | **Measured baseline / structural breach (#1077)** | Three 6-request parent/current HTTP tests: **6/6 still active at +160 ms, 0/6 transport aborted, 6/6 late responses** after viewport eviction or view unmount. Logical Promise cancel is not transport cancel; production fix warranted separately. |
| Timeline viewport group lookup | **Accepted / structural contract** | 100,000 synthetic date groups; a viewport near group 90,000 uses fewer than 64 indexed group reads instead of scanning from group 0. No wall-clock speedup claimed. |
| 100k thumbnail fast-scroll retention | **Accepted / measured structural** | Image/Live Photo stays unchanged at peak queue **180**, active/in-flight **6/6**. Video poster peak queue **99,997 -> 90 (-99.91%, ~1,111x smaller)** and final queue **99,997 -> 10** while real active work remains capped at **3**. Hosted-runner CPU timings are diagnostic only. |
| 100k mixed-media first open | **Accepted / measured + structural** | 70k photos + 15k videos + 15k Live Photos (115k physical media nodes / 100k logical items). Warm first range **409.147 ms median**, zero-stale refresh **212.556 ms**, UI timeline layout **2.507 ms median**; first range now commits before secondary facets. |
| 100k renderer measurement attribution | **Accepted measurement / native baseline healthy** | PR #1067 initial CI: all 36 renderer samples pass applicable timing/CPU budgets; full activation-overlapping maximum task 60 ms. Buffered totals, preparation, decode and two-rAF proxy remain distinct. No production optimization. |

## Gallery native Go HTTP / PostgreSQL request-context cancellation at 100k (2026-10-09)

Status: **Measured / native PostgreSQL 17 real request cancellation accepted; evidence-amended final CI pending (#1144)**. Related merged [#1138](https://github.com/lazyxu/xdrive/pull/1138) already verified the shared Gallery Web/Desktop request lifecycle: the source-extracted Gallery loader delivered **6/6 AbortSignals** and caused **6/6 real Node localhost HTTP disconnects within 160ms**, with **zero** late payload (three alternating BEFORE/AFTER pairs). That test did **not** measure native Gin/Go `Request.Context()` or PostgreSQL cancellation. This test targets that next layer without changing production code.

- **Fixed named workload:** native PostgreSQL 17, isolated owner/schema and an existing real fixture of **100,000 PhotoAssets / 115,000 physical MediaMetadata+Node+File / 15,000 paired Live Photos**. Start six authenticated actual `GET /api/v1/media/items?range=true` requests against `httptest.NewServer(app.Router())`. A separate database session holds an `ACCESS EXCLUSIVE` lock on `xd_media_metadata`. The production `staleMediaNodes` JOIN must reach the table and produce **six observed PostgreSQL lock-waiting active SQL queries**, verified from `pg_stat_activity`, before cancel is sent. This is not a fake Go sleep or an HTTP-only mock.
- **Predeclared cancellation gate (160ms):** after canceling all six *already executing* client requests, require **six server-side `Request.Context().Done()` signals, no active authenticated HTTP handlers, zero PostgreSQL lock waiters, zero canceled-client payload bytes**. Record actual maximum server-context cancellation latency and all observed counters. Roll back the held PG lock and confirm a fresh authenticated 100-item Gallery range succeeds with the correct total count. Absent the six blocked PG queries, the test must fail rather than report false success.
- **Measured native Go/PostgreSQL CURRENT (n=1 six-request batch):** [GitHub CI run 37918374711](https://github.com/lazyxu/xdrive/actions/runs/37918374711), [job 113780024040](https://github.com/lazyxu/xdrive/actions/runs/37918374711/job/113780024040) using the exact production Gin media range handler and native PostgreSQL 17. All **6/6** authenticated HTTP GETs reached actual PostgreSQL **Lock** waiters before cancellation; after 160ms **6/6 Go Request.Context.Done()**, **0** active Gin handlers, **0** PG lock waiters and **0 B** canceled-client payload. Six server context-notification latencies (ms): **0.109 / 0.115 / 0.120 / 0.126 / 0.131 / 0.329**, worst **0.329 ms**, below the predeclared 160ms bound. A fresh post-lock-release authenticated 100-item range succeeded with 100k authoritative total. Synthetic fixture seed **32,947.392 ms** is excluded. **Decision: the current native HTTP→GORM/PG request cancellation meets this gate; retain production as-is; no new server cancellation endpoint or speculative optimization is justified.** Raw [ci-run-37918374711.json](performance-evidence/gallery-go-context-cancel-100k/ci-run-37918374711.json). This is not a paired wall-clock speedup measurement; separately scoped Node HTTP BEFORE/AFTER remains under #1138. A real execution-plan/CPU decoder abort and physical hardware remain unmeasured.
- **Coverage limits:** this measures genuine transport→Gin→GORM/native PostgreSQL lock-wait interruption for an existing 100k namespace, **not** 100k concurrent HTTP requests, an actively decoding codec, a CPU-bound Go transformation, a remote Store.Open, actual Electron/Agent IPC, physical mobile hardware, throughput or background Task Center cancellation. The lock wait probes DB context propagation but not every long-running SQL execution plan. Seed time is reported separately. This is a reliability/load-shedding gate, not a speedup ratio; CPU/RSS are outside this test.
- **Decision:** if all six Go contexts and PG queries actually stop by 160ms and normal browse works, accept the existing cancellation plumbing with no server production changes. If not, preserve red evidence and make the smallest justified server/driver change, followed by same-workload AFTER. Benchmark opt-in: `XD_GALLERY_GO_CONTEXT_CANCEL_PERF=1 XD_TEST_DATABASE_URL=postgres://... go test -run '^TestGalleryRequestContextCancellation100K$' -count=1 -timeout=12m -v ./internal/api`. Dedicated GitHub/GitLab job `gallery-go-context-cancel-100k-performance`; commit native evidence in `docs/performance-evidence/gallery-go-context-cancel-100k/` and this canonical document before merge.

## Gallery 100k virtual-range request cancellation — scoped transport optimization (2026-10-09)

Status: **Measured / accepted paired Node HTTP transport optimization, evidence-amended full CI pending (#1138)**. The parent [#1134](https://github.com/lazyxu/xdrive/pull/1134) measured the real production Gallery `loadVirtualRange` source with **six real Node localhost 500ms HTTP requests** (a 100k logical collection, not 100k simultaneous network requests), three samples: **0/6 early HTTP aborts, six stale requests active at +160ms, 49,152 B wasted per six requests, zero forwarded AbortSignals**. This is an actual transport baseline, not merely stale-result fencing.

- **Minimal production route:** `useXDriveVirtualCollection` already creates request-scoped AbortControllers for viewport pages. Forward each signal through shared `MediaGallery.loadVirtualRange → loadTargetRange → listItemRange` and typed Gallery port. Web passes it to its authenticated `fetch`; Desktop creates a sender-scoped request ID, calls existing `DesktopViewportRequests.run`, forwards the signal through Agent HTTP, and relies on Gin `c.Request.Context()`. Closed WebContents and cancel-before-admission retain their existing cancellation handling; no Task Center durable cancellation, upload, download, sync or delete semantics change.
- **Frozen paired acceptance (three alternate BEFORE/AFTER samples, same CI host):** the unchanged parent loader must stay red (zero forwarded signal; six active at +160ms; 49,152 B eventual payload), and the new loader must forward **all six** signals and abort **all six real started HTTP requests within +160ms**, with **zero active server sockets and zero stale response bytes**, including view-unmount. Capture exact disconnect latency, server request count/bytes and all raw rows. The paired benchmark imports the production loader from each exact `HEAD^`/`HEAD` revision, rather than hand-writing an alternative. Any red candidate must be kept Draft/rejected; do not call it a speedup based only on a failed-request baseline.
- **Same-run paired AFTER measured (n=3 per side):** [CI run 37915231253](https://github.com/lazyxu/xdrive/actions/runs/37915231253), [scoped job 113769665367](https://github.com/lazyxu/xdrive/actions/runs/37915231253/job/113769665367), exact parent `4d5d1ba2` versus candidate `d8306844`. Every BEFORE (two viewport evictions, one view-unmount) left **6/6 stale HTTP requests still open after 160 ms**, forwarded **0 signals**, aborted **0** and ultimately sent **49,152 B** of late payload. Every AFTER forwarded **6/6 signals**, disconnected **6/6 HTTP sockets**, left **zero active at +160 ms** and sent **zero stale bytes**. Worst actual last-server-disconnect delay per sample **5.776 / 1.437 / 1.405 ms**, all below the predeclared 160ms gate. **Paired gate passed; keep the small production change.** The result is source-extracted production hook + real Node loopback HTTP, **not** independent Gin `ctx.Done()`, real authenticated Web fetch, Electron Main IPC, physical mobile or 100k simultaneous requests. An Agent HTTP integration regression is included separately. Exact raw [ci-run-37915231253.json](performance-evidence/gallery-range-cancel-100k/ci-run-37915231253.json).
- **Additional path correctness:** native Desktop request-scoped Agent HTTP regression verifies GET `/v1/media/items?range=true` cancellation; Web/Desktop build and source parity remain mandatory. The first patch covers the **default Gallery All / timeline / filtered** virtual range. Album, person, Memories and other specialized virtual collection queries, direct first-page loads, real Electron rendering and separately instrumented Server `ctx.Done()` are not yet qualified by this scoped benchmark. They remain follow-ups, not silent claims of completion.
- **Command:** `cd desktop && node scripts/gallery-range-request-cancel-performance.cjs paired`. The GitHub/GitLab branch-scoped `gallery-range-cancel-100k-performance` jobs use the exact parent/current pair; retain raw benchmark JSON and its build/transport correctness context in `docs/performance-evidence/gallery-range-cancel-100k/`, update this canonical page and rerun complete PR CI before merging.

## Gallery 100k virtual-range request cancellation: transport baseline (2026-10-09)

Status: **Measured first-red / benchmark-only (#1134), evidence-amended final CI pending**. The shared `VirtualCollectionController` already constructs a request-scoped `AbortController` and aborts superseded ranges on scroll/unmount. But the production Gallery `MediaGallery.loadVirtualRange` does not accept or pass the supplied `AbortSignal` to `loadTargetRange`; the Web/Desktop `listItemRange` ports likewise do not currently propagate it. This is separate from accepted [#1083](https://github.com/lazyxu/xdrive/pull/1083) FileExplorer range/thumbnail transport abort and [#1088](https://github.com/lazyxu/xdrive/pull/1088) Gallery video-poster abort.

- **Fixed BEFORE workload:** extract and TypeScript-transpile the *actual* Gallery virtual-range loader from `ui/shared/src/mui/MediaGallery.tsx`, with a 100k-item logical namespace and **six already-started real Node localhost HTTP GETs** (not 100k HTTP requests). Delay 500ms, return 8192 bytes each. Three samples: two virtual-viewport evictions, one unmount, abort all owning signals, observe at +160ms, then wait for original response completion. Log actual server-observed early disconnects, active requests, wasted response bytes and how many signals reach the loader. No production code is modified in this PR.
- **Expected first red to verify, not assume:** signals dropped before the request layer, 6/6 stale HTTP connections still alive at +160ms, 0/6 actual disconnects, and 49,152 bytes eventually sent per abandoned six-request viewport. If the current implementation does not exhibit this, the baseline test must fail as invalid rather than invent a cancellation regression.
- **Measured BEFORE / native Node localhost first-red:** [GitHub CI 37912355992](https://github.com/lazyxu/xdrive/actions/runs/37912355992), [job 113760273012](https://github.com/lazyxu/xdrive/actions/runs/37912355992/job/113760273012), n=3. All samples started exactly **6** HTTP GETs; **0/6 request signals** reached the extracted production Gallery range loader, **0/6 early server disconnects**, and **6/6 stale connections** remained active after +160ms. After each 500ms delayed response, the server delivered **49,152 B** of unnecessary completed payload across the six requests, and all connections eventually closed normally. Samples #1 and #2 were scroll evictions; #3 was window/view unmount. The precise result is `reproduced-red-baseline`, not a successfully canceled Gallery or a 100k concurrent-request test. Raw [ci-run-37912355992.json](performance-evidence/gallery-range-cancel-100k/ci-run-37912355992.json). `AFTER` not yet measured; no reduction percentage claimed.
- **Next production gate (separate PR):** route the owner-provided signal to all relevant Web Gallery range fetch calls and Desktop Renderer → sender-scoped Main → Agent HTTP requests; cancellation is request-scoped, not durable Task Center cancellation. Three same-host BEFORE/AFTER rounds should show **6/6 actual early HTTP aborts by 160ms, 0 stale server-active requests and 0 response bytes**; then independently exercise authenticated Go handler `Request.Context()` cancellation and Desktop Agent IPC path. A Node localhost test alone must never be mislabeled as proven Server `ctx.Done()` or real Electron performance.
- **Command:** `cd desktop && node scripts/gallery-range-request-cancel-performance.cjs`. Scoped GitHub/GitLab `gallery-range-cancel-100k-performance` jobs; raw per-sample output will be amended here and committed under `docs/performance-evidence/gallery-range-cancel-100k/` before final full PR CI. No Web/Desktop UI, synchronization, transfers, races or production media behavior change in the measurement-only PR.

## Gallery viewport cancellation optimization (2026-10-09)

Status: **In progress**, paired measurement pending. Shared `XDriveMediaThumbnailScheduler` now accepts a request-level AbortSignal; removing a tile from the current viewport or unmounting its Gallery instance must abort in-flight thumbnail HTTP instead of only resolving a stale UI Promise. Web REST and Desktop request-bound IPC/Agent must propagate the same cancellation. The reference workload is documented in [FileExplorer performance](file-explorer-performance.md#request-scoped-transport-abort-optimization--follow-up); source code changes are not accepted until 6/6 actual server disconnects and zero leftover bytes are demonstrated within 160 ms on all three repeated samples. Durable media indexing/generation, file operations, sync and transfer tasks are not view-owned.

**BEFORE:** 6/6 active and 0/6 aborted at +160 ms in PR #1077. **AFTER initial paired CI 37880698868:** 6/6 HTTP requests aborted, 0 still active and 0 late 8 KiB responses at +160 ms in all 3 Gallery samples; observed last-abort latency **3.863 / 1.638 / 2.060 ms**. Raw data in [transport evidence](performance-evidence/viewport-cancel-transport/ci-run-37880698868.json). Structural A/B accepted, but the production PR must still pass full Desktop/Web/Go tests after updating the five old assertions. Gallery's separate video poster preview queue remains a distinct follow-up requiring its own initial transport cancellation baseline; do not report first-frame cancellation from thumbnail results.

## Gallery stale-request cancellation workload (2026-10-09)

Status: **Benchmarking / baseline only**. The canonical combined cancelled-view-request workload, exact environment/acceptance and raw data will be recorded alongside [FileExplorer's performance benchmark](file-explorer-performance.md#request-scoped-viewport-cancellation-benchmark-2026-10-09).

Test the real `XDriveMediaThumbnailScheduler` at six active requests with a controlled 500 ms local HTTP response, then invoke `setRetention([])` (viewport scroll) or `dispose()` (window unmount). Record server-observed disconnect within 160 ms, how many started HTTP requests remain and whether any 8 KiB response bytes were needlessly transmitted. **Three samples**, paired same-host original/head measurements. This is transport instrumentation, not an actual Web/Agent/Go end-to-end cancellation claim. No production changes are authorized without an observed breach, and durable background jobs must remain independent of view lifetime.

**BEFORE/current: measured** in [CI 37877779088](https://github.com/lazyxu/xdrive/actions/runs/37877779088), three parent/current pairs. Gallery logical settlement was **6/6** after invalidation, but at +160 ms its **HTTP cancellation was 0/6, stale Server requests still active 6/6**, and all six 8 KiB responses eventually completed. No AbortSignal reached the loader. **AFTER:** N/A in this benchmark-only PR. The next production change must show 6/6 actual aborts, zero stale request bodies, and maintain scheduler correctness; raw rows are in [the shared evidence](performance-evidence/viewport-cancel/ci-run-37877779088.json).

## Persistent video poster first in Gallery (2026-10-09)

Status: **In progress / structural acceptance pending**. Gallery's old ordinary-video tile invoked `loadPreviewURL(video)` and browser frame capture on every first visible mount, including when a revision-matched 512px Server poster already existed. FileExplorer, the Home thumbnail provider and several secondary covers already consulted the persisted `mediaThumbnail` API; Gallery's ordinary tile did not.

The candidate shares a Web/Desktop Gallery rule: viewport admission → authenticated persisted poster GET → on cache miss only, one client capture from the existing video preview URL → revision-bound Server poster PUT (best effort). Warm poster resources bypass original-video retrieval and client decoding. The existing video-poster queue remains bounded at three active tasks and still cancels queued work and revokes late Blob results; **this PR does not assert started-request transport cancellation**. That work belongs to the predeclared, test-first Gallery poster cancellation PR #1088. Node revisions prevent overwriting a different file revision. Filmstrip may consult a stored video poster even when the item's `has_thumbnail` metadata flag is false. Live Photo motion and original downloads are unchanged.

**BEFORE/AFTER structural acceptance cases** (not comparable wall-clock benchmarks): warm video: old **0 poster GET / 1 original preview and frame decode per visible mount**, candidate **1 cached GET / 0 original preview / 0 frame decode**; cold video: candidate **1 GET miss / 1 original preview / 1 bounded frame capture / up to 1 revision-checked PUT**; invalid revision: **0 cache writes**; helper-level explicitly aborted capture: **0 cache writes**. An already-started Gallery task disposed without a signal may still complete and backfill the same revision; its actual transport cancellation is reserved for #1088. The regression suite executes the real exported resolver with counters and covers warm, cold, cancelled, invalid revision, failed cache write and both platform adapters. Those are per-item logical request counts; no unmeasured speedup percentage is claimed. FileExplorer remains on its existing revision-bound fallback path. Server storage inventory is unchanged: the same 512px persisted poster class is reused.

**Acceptance gate:** corresponding Node tests, Web build, Desktop test/build, and authoritative dependent PR CI must pass. Real Web/Desktop warm/cold 10k–100k video HTTP bytes, codec compatibility, first-poster latency and hover-video costs still require separately named end-to-end before/after measurements. The Gallery poster queue's actual transport abort must be measured independently from the thumbnail cancellation benchmark in PR #1083.

## 100k Gallery video-poster request cancellation after persisted-cache integration (2026-10-09)

Status: **Benchmarking / acceptance pending**. This is a narrow performance follow-up on the already tested persisted-first Gallery video-poster implementation of PR #1089. It adds one AbortController per 3-active-worker request and forwards that same signal to `xDriveResolveMediaVideoPoster({ signal, capture:(signal)=>... })`; the resolver already supports abortable persisted JPEG GET, fallback first-frame capture and best-effort revision-fenced PUT. No new poster storage class, transcode worker or background Task Center mutation.

- Frozen workload: the production `scheduleMediaPoster` queue **and persisted-first `xDriveResolveMediaVideoPoster` helper**, 100k **logical** videos with six sampled tile IDs (3 active and 3 queued); real Node HTTP TCP with 500 ms delayed 8,192-byte responses. Test **both** warm persisted poster GET and cold preview capture/optional revision-fenced backfill as separate cache states, each with two scroll evictions and one view-unmount, **three alternating BEFORE/AFTER repetitions per state (six paired samples total)** on the same runner. Observe at +160 ms. Benchmark script: `cd desktop && node scripts/gallery-video-poster-viewport-cancel.cjs paired`; GitHub/GitLab branch-scoped job `gallery-video-poster-viewport-cancel-performance`.
- Predeclared acceptance: before must show 3/3 active stale HTTP requests still alive, zero early disconnect, three late 8 KiB bodies; after must show 3/3 early abort within 160 ms, 0 Server active requests, 0 old worker slots, 0 queued requests admitted after viewport changes and **zero 8 KiB late response bytes**; the original six scheduler Promises must settle. Keep caching/backfill, HTMLVideoElement, Web/Desktop builds and other regressions green.
- Prior evidence (before persisted-first integration): [CI 37885537844](https://github.com/lazyxu/xdrive/actions/runs/37885537844), measured historical 3/3 500ms HTTP continuation versus abort of 3/3 in 3.562/1.635/1.613ms. These numbers are **not transferable** to the #1089 cache-first implementation. It is invalid to claim a final speedup or publish as accepted before new A/B.
- Added cache-path correctness threshold: warm-state work must call the persisted GET once per started tile and **never** open original preview/capture or PUT; cold-state work must attempt one preview capture per started tile, with BEFORE allowing the existing late backfill and AFTER performing **zero** late backfills after cancellation. This is controller/HTTP fixture instrumentation and does not claim real Server poster persistence.
- Layer limits: Node-transpiled production queue with actual loopback HTTP; the 100k logical namespace has only six requests. Real Chromium video frame teardown, signed preview, Desktop Agent IPC, Go Handler `Context()`, distributed derivative scheduling and 10k/100k real codec loads still require separate qualification. Persistent uploads, downloads, sync and delete are not cancelled by a window/view close.
- **BEFORE/AFTER on actual persisted-first implementation:** [CI run 37893324643](https://github.com/lazyxu/xdrive/actions/runs/37893324643), [job 113698923063](https://github.com/lazyxu/xdrive/actions/runs/37893324643/job/113698923063), exact checkout AFTER `815a164c1c0a82645a0df48b75693a8188cf53fd` / BEFORE `5dad2d567482d6fe7a7044e185a60d1ca0c2f815`. **Six paired runs, 12 source rows** across two cache states. All BEFORE and AFTER samples met their predeclared red/green expectations. The performance job passed; final whole-PR CI after this documentation amendment is still mandatory.
- Server still-active HTTP at +160 ms: **3/3 BEFORE → 0/3 AFTER** for **both** warm cached-poster GET and cold capture-preview GET. Early server disconnects: **0/3 → 3/3**. Delivered unnecessary response bytes per cancelled viewport: **24,576 B → 0 B (100% avoided)**. Cancelled worker slots at +160 ms: **3 → 0**. Queued requests never started; six scheduler Promises settled.
- Warm state: last-of-three server-observed disconnect latencies **2.884 / 1.734 / 1.840 ms**; **zero** preview/capture and backfill before and after.
- Cold state: last-of-three disconnect latencies **0.984 / 1.280 / 0.965 ms**; original preview was invoked for each started tile in both versions, but late cache PUT callback calls decreased **3 → 0 per sample**.
- Raw exact, unrounded rows and workload/provenance: [ci-run-37893324643.json](performance-evidence/gallery-video-poster-cancel/ci-run-37893324643.json). This is a significant repeatable **resource waste reduction**, not an end-to-end page-load latency improvement or a physical H.264/HEVC decoder benchmark. No new memory/throughput regression was observed by this fixture; independent full CI/codec regressions remain gating.
- **Decision:** accept the narrow request-owned video-poster queue AbortController candidate on the measured HTTP/cache-first workload; do not merge unless the final one-commit PR CI after the evidence update passes. Keep persistent cache semantics and durable tasks unchanged.

## 100k renderer measurement attribution

Full local sample values, environment, source revisions and qualification notes are retained in [the baseline evidence record](performance/2026-10-09-local-baselines.json). Current native CI results are recorded separately below.

Status: **Accepted measurement / no production change; documentation validation pending**.

The existing `perf/gallery-renderer-first-paint-100k` work is already contained in `master`. This follow-up reuses that branch for a measured harness correction and the current 100k coverage record. The selected delivery base is `d45a894ef19e03b3cdc90dcfde2cd91fef002bbf`; at that base the Gallery harness and measured renderer sources matched the initial `3a35c385ecc953d31a9ca2b81b75e9be4f569ea2` measurement snapshot. This follow-up changes measurement attribution only; the native CI integration tree is identified separately below.

BEFORE workload: 100,000 logical items, 1440 x 900 viewport, first 100-item range, Web and Desktop production renderer bundles, mixed first-image or homogeneous video/Live Photo scenarios, cold/warm transport replay, three fresh headless Chromium 153 processes for each of the twelve cases. This is renderer/decode measurement with synthetic transport, not a native Desktop IPC or real Server throughput result.

The initial local trace is unsuitable as evidence of a new production bottleneck: `buffered: true` long-task observation includes fixture work before Gallery activation; some replay timers and two-frame presentation waits are substantially delayed by the local software rendering environment. No production speedup is claimed and no production change is justified by those samples.

### Fresh local diagnosis (2026-10-09)

The unmodified 36-sample replay measured range request **50.8 ms median [42.3,109.2]**, followed by range resolution at approximately 400 ms including the intentional **350 ms** delay. Most range-to-grid commits were **40–76 ms**; three samples were **116–152 ms**. Warm image/Live media resolution-to-DOM/decode was typically **2–5 ms**. Web warm image decode-to-two-frame waits reached **591–655 ms** and warm Live reached **1184 ms**. These are delayed presentation-proxy values, not measured compositor first-pixel timestamps.

Three scratch-instrumented cases used the unchanged built bundles, Chromium **153.0.8010.0** headless, real Open Sans fontconfig, SwiftShader/ANGLE software graphics, and the same delays. A single-variable `--disable-gpu` control changed only the runtime, not xDrive source:

| Probe | Default software graphics | With `--disable-gpu` | Attribution |
| --- | ---: | ---: | --- |
| Web image cold range-to-paint proxy | 737.8 ms | 213.6 ms | The requested 112 ms replay timer took 641–643 ms by default and 112.1 ms in the control, without a post-activation JavaScript Long Task spanning the gap. |
| Web image warm range-to-paint proxy | 120.8 ms | 81.8 ms | Default actual image decode was 0.7 ms; decode-to-two-rAF fell from 58.5 to 6.2 ms. |
| Desktop renderer video warm range-to-paint proxy | 481.7 ms | 334.2 ms | Full post-activation maximum task fell from 296 to 199 ms; the remaining capture/render boundary is a real local diagnostic red signal, without a proven production cause. |

The default warm-image reported 126 ms maximum task started **346.7 ms before activation** and no task overlapped activation. Standalone controls reused the exact JPEG/WebM fixtures and production poster helper without Gallery: steady captures **5.1/10.4 ms**, three concurrent captures **11.5–12.6 ms**, idle 112 ms timers **112.1–112.3 ms**, and two-rAF **4.3–17 ms**. An earlier capture retry was 85.4 ms, showing initialization variance. In the video runtime control the 199 ms task preceded the recorded `toBlob` calls; do not attribute it specifically to JPEG encoding. No shader/runtime flag is proposed for shipping.

Commands were serialized with `flock /workspace/scratch/4fa175e5d1c9/perf-bench.lock node <runner>`. Scratch drivers: `gallery-current-baseline.cjs`, `gallery-runtime-probe.cjs`, `gallery-runtime-probe-no-gpu.cjs`, and `gallery-standalone-control.cjs`; raw JSON and the analysis are retained under `/workspace/scratch/4fa175e5d1c9/`. No full 36-case diagnostic repeat was needed. These headless measurements are not comparable with the historical Electron/Xvfb tables below.

### Additional current backend qualification

An unchanged-production `TestMediaGalleryFirstVisiblePerformance100K` PGlite run on 2026-10-09 passed (**n=1**, diagnostic, not a paired optimization). Dataset: **100k logical / 115k physical nodes**; first viewport **56 items = 38 photos + 9 videos + 9 Live Photos**. Real image/Live still HTTP cold first thumbnail **48.922 ms**, warm **3.839 ms**. Each phase requested 47 still thumbnails: cold **47 original opens / 47 puts**, warm **0 original opens / 0 puts**. First range **826.226 ms** is PGlite/WASM timing and must not be compared to native PostgreSQL. This is backend still-thumbnail qualification; the nine video entries do not prove browser poster decode. Raw command/provenance and results: `/workspace/scratch/4fa175e5d1c9/gallery-server-100k/results/summary.md`. The current branch also re-enables the existing native-PostgreSQL first-visible Server and FileExplorer media Server benchmarks; their completed results are recorded in the native CI section below.

### Measurement-only correction and acceptance

The harness keeps every existing marker and both animation-frame waits. It flushes pending observer records before reporting. The result adds the following attribution without replacing legacy data:

| Result fields | Meaning / assessment |
| --- | --- |
| `longTaskCount`, `longTaskDurationMs`, `longestLongTaskMs` | Legacy totals over all buffered records, including startup/fixture work; their definitions are preserved. |
| `activationLongTaskCount`, `activationLongTaskDurationMs`, `activationLongestLongTaskMs` | Tasks with positive overlap between Gallery activation and the existing paint proxy; durations remain **full task durations**. Compare `activationLongestLongTaskMs` to the existing **>100 ms** critical-path CPU red signal. A task beginning before activation is included if it overlaps activation. |
| `activationLongTaskOverlapDurationMs`, `activationLongestLongTaskOverlapMs` | Elapsed overlap clipped at both activation and proxy boundaries, for attribution only. These values must not silently replace the full-duration CPU budget. |
| `preActivationLongTaskCount`, `preActivationLongTaskDurationMs`, `preActivationLongestLongTaskMs` | Buffered work before activation, with duration clipped to that earlier interval. This can include page startup as well as fixture preparation. |
| `longTaskObservationSupported` | Whether Long Task observation was successfully enabled; unsupported observation cannot be interpreted as proof of zero tasks. |
| `fixturePreparationMs`, `jpegFixtureMs`, `videoFixtureMs`, `warmMediaPreparationMs`, `preparationToActivationMs` | Separate wrapper preparation and ready-to-activation clocks. JPEG/video creation runs concurrently, so their durations are not additive. Cold warm-media preparation is zero. |
| `rangeToFirstImageDecodeMs`, `routeToFirstImageDecodeMs` | Useful first mounted grid-image decode timing, computed from existing markers. The route clock starts at `GalleryRendererTrace` mount and excludes page/bundle/fixture startup. Visibility bounds remain validated at the existing later proxy boundary. Decode is not a compositor presentation timestamp. |
| `presentationProxy: 'two-rAF'` | Explicitly identifies the unchanged presentation proxy. Existing `decodedToPaintMs`, `rangeToFirstPaintMs`, and `routeToFirstPaintMs` and their budgets remain intact. |

Meaningful regression command: `node --test desktop/tests/gallery-performance-metrics.cjs`. The test first failed when attribution was absent, then passed for a wholly pre-activation 140 ms task, tasks overlapping either window edge, and exact non-overlapping boundary timestamps; legacy totals remain unchanged. The existing `desktop/tests/media-gallery-100k-performance.cjs` contract now checks all six image/video/Live cold/warm scenarios and **36 metrics plus 36 traces** in both provider jobs.

Decision: **measurement correction accepted locally; no production optimization selected**. The local renderer proxy is runtime-sensitive; retain failed raw values and mark presentation-based production assessment inconclusive rather than moving budgets. The video capture/render boundary remains a candidate for a native-runtime microtrace if it repeats; no list, scheduler, cache, codec, or Gallery production change is warranted yet. The authoritative initial Electron/Xvfb six-scenario matrix is recorded below; the amended documentation must pass the resulting full PR CI before merge. The runner's RSS field is a single post-result renderer snapshot, not a peak or delta; null is unavailable evidence, not a memory pass.

## Native CI baseline — PR #1067 (2026-10-09)

Status: **Measured native baseline / budgets passed / no production change**. Initial [run 37869011944](https://github.com/lazyxu/xdrive/actions/runs/37869011944) completed the renderer and native PostgreSQL jobs successfully. The selected branch base is `d45a894ef19e03b3cdc90dcfde2cd91fef002bbf` and PR head is `95258eb5cc71214536b7a3b491ffaa5174abfa1d`. All three performance job checkout logs report **`86cf14e1724c1f2bdced4d34be04ec60cea75ed8`**, the synthetic merge of that head into then-current master **`23b3f216b7e9b37222cbfeb7ff9be2812cad2f87`**. This is the actual tested integration tree, including later master Gallery features; it is not reported as a measurement of the fixed branch head alone. Exact rows, runtime, commands, job/artifact IDs and checkout evidence are committed in [the native evidence record](performance/2026-10-09-native-baselines.json).

### Electron renderer: 36 samples

Runtime: Ubuntu **24.04.5**, runner image **20261004.327.1**, Electron **44.4.5**, Chromium **152.0.7977.130**, Node **24.21.0**; visible BrowserWindow under Xvfb, **1440 x 900**, no `--disable-gpu`, reported software canvas/compositing/video decode. Each of twelve Web/Desktop scenario cases uses **three fresh Electron processes**, **100,000 logical items** and a **100-item first range**. Image scenarios retain the 70k-photo/15k-video/15k-Live mix with an image first; video and Live scenarios are homogeneous 100k collections. The real shared Gallery renderer, JPEG decode and WebM poster helper execute, but transport is synthetic: unchanged **350 ms** range replay, **112/6 ms** cold/warm image or Live thumbnail replay, **5/3 ms** video preview replay. This is not actual Web browser networking or Desktop Agent IPC. The job produced **36 metric files and 36 traces**.

All timings below are milliseconds; medians are from n=3. Only range-to-proxy carries [min,max]. The task column is the **maximum full overlapping task**, and working set is the median **single post-result snapshot**, MiB.

| Surface | Scenario | Range -> grid | Range -> decode | Decode -> two-rAF | Range -> two-rAF [min,max] | Activation -> two-rAF | Max task | WS snapshot, MiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Desktop | image-cold | 50.1 | 195.1 | 19.7 | **214.8 [213.8,217.6]** | 619.0 | 59 | 212.8 |
| Desktop | image-warm | 51.0 | 70.0 | 22.1 | **92.1 [87.8,98.2]** | 495.3 | 57 | 178.7 |
| Desktop | video-cold | 62.1 | 101.5 | 29.3 | **128.6 [125.4,130.9]** | 531.0 | 60 | 175.0 |
| Desktop | video-warm | 65.8 | 98.7 | 22.1 | **119.4 [119.2,125.7]** | 519.9 | 54 | 174.4 |
| Desktop | live-cold | 58.4 | 210.3 | 18.3 | **229.2 [225.9,232.9]** | 632.6 | 58 | 216.3 |
| Desktop | live-warm | 59.7 | 80.6 | 21.1 | **102.5 [101.2,104.1]** | 504.1 | 57 | 181.7 |
| Web | image-cold | 51.3 | 199.3 | 18.7 | **218.3 [214.0,221.4]** | 624.2 | 59 | 216.6 |
| Web | image-warm | 49.2 | 67.8 | 25.9 | **93.7 [90.9,95.6]** | 496.4 | 55 | 177.9 |
| Web | video-cold | 60.8 | 98.2 | 24.5 | **122.7 [119.8,125.4]** | 526.1 | 56 | 175.0 |
| Web | video-warm | 61.6 | 95.8 | 26.5 | **118.8 [115.7,134.0]** | 518.4 | 51 | 174.3 |
| Web | live-cold | 56.0 | 208.0 | 18.2 | **226.2 [219.1,230.2]** | 626.4 | 53 | 216.5 |
| Web | live-warm | 55.3 | 76.4 | 19.7 | **96.1 [94.8,103.8]** | 495.2 | 54 | 181.3 |

Budget decisions are evaluated from every raw sample, not inferred from the job's green status: the launcher checks valid output/viewport but does **not** enforce these numeric thresholds.

| Existing budget | Largest applicable sample | Decision |
| --- | ---: | --- |
| Range -> virtual grid <=100 ms | 68.9 ms | Pass, 36/36 |
| Grid -> first media request <=50 ms | 19.0 ms | Pass, 36/36 |
| Image/Live media resolved -> DOM <=50 ms / decode <=100 ms | 3.5 / 32.2 ms | Pass, all applicable samples |
| Image decode -> two-rAF <=50 ms | 30.0 ms | Pass, all image samples |
| Image/Live range -> two-rAF <=400 ms cold / <=250 ms warm | 232.9 / 104.1 ms | Pass, all applicable samples |
| Warm video range -> poster proxy <=300 ms / resolved -> decode <=200 ms | 134.0 / 16.8 ms | Pass, all warm-video samples |
| Full activation-overlapping task >100 ms red signal | 60 ms | No CPU red signal, 36/36 observations supported |
| Renderer working-set snapshot >300 MiB red signal | 217.918 MiB maximum | Snapshot below red signal; no peak/delta memory claim |

Legacy buffered maximum tasks also peak at **60 ms**. Preparation remains separately measured (**231.8–250.7 ms**); it is excluded from the existing activation clock. Two-rAF waits range **16.2–30.0 ms** in this native run, without the hundreds-of-ms delays in the earlier headless diagnostics. This is runtime-qualified evidence, **not a headless-to-native speedup claim**. The two-rAF boundary remains a presentation proxy. Cold-video one-time initialization remains diagnostic, and this tiny 96 x 64 WebM fixture does not establish H.264/4K or real preview throughput.

Decision: **keep Gallery production renderer, scheduler, cache and poster helper unchanged**. The native workload is within the existing budgets; the local capture/render diagnostic does not justify another optimization. Original timing fields and budgets are preserved. Amend this same measurement commit with the evidence, then pass full PR CI before merging. Trace artifact ID **11589043537**, SHA-256 `60342354c7679dbcfa98780eaa4cd4c301b83daa2d348119ece9a5454e487333`, expires 2026-10-16; metric rows and provenance remain in the repository after artifact expiry.

Command: `cd desktop && xvfb-run -a --server-args="-screen 0 1920x1200x24" ./node_modules/.bin/electron --no-sandbox scripts/gallery-renderer-first-paint-trace-main.cjs <desktop|web> <image-cold|image-warm|video-cold|video-warm|live-cold|live-warm> sample-<1|2|3>`, after the opt-in full Web/Desktop builds shown in the historical workload sections.

### Native PostgreSQL Server: first 56 mixed items

Job **113622479830**, Go **1.25.14 linux/amd64**, native PostgreSQL **17.11** (`postgres:17-alpine`), loopback Gin HTTP and real `storage.Local`. One unchanged test invocation seeds **100k logical assets / 115k physical nodes**; only the first **56 = 38 photos + 9 videos + 9 Live Photos** have payload fixtures. The first counted range took **336.404 ms**. HTTP clocks start after range lookup and visible-fixture setup, so these are not route-to-visible-image or client decode times.

| Complete HTTP response metric | Cold thumbnails, ms | Warm thumbnails, ms |
| --- | ---: | ---: |
| First | **60.892** | **2.334** |
| First 12 | **133.731** | **5.837** |
| All 47 image/Live stills | 365.219 | 17.992 |
| Request p50 / p95 | 40.144 / 64.405 | 2.015 / 3.603 |

Video ticket/preview response first/all nine: cold **2.423 / 6.100 ms**, warm **1.247 / 3.817 ms**. This measures small H.264 preview response bytes, not browser decode/poster generation or full video bandwidth. Passing production store assertions establish **47 cold original opens and derivative puts**, warm **zero originals/puts and >=47 derivative opens**, and **nine original video opens per phase**. No observed concurrency peak is emitted by this Gallery test; configured limits are six thumbnails/three previews.

All four existing gates pass: cold first thumbnail **<=750 ms**, cold first 12 **<=1500 ms**, warm first **<=250 ms**, cold first preview **<=500 ms**. **Decision: no Server image/Live thumbnail or preview production change.** n=1 is current qualification, not a paired optimization or a timing comparison with historical CI/PGlite. Command: `XD_GALLERY_FIRST_VISIBLE_PERF=1 go test -run '^TestMediaGalleryFirstVisiblePerformance100K$' -count=1 -v ./internal/api` with the CI PostgreSQL service. The same job's FileExplorer 100k JPEG/store results are recorded in [FileExplorer performance](file-explorer-performance.md#native-ci-baselines--pr-1067-2026-10-09).

## Timeline viewport group lookup

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- shared `Year / Month / Day` Gallery timeline viewport calculation;
- stable synthetic workload: **100,000 ordered timeline groups**;
- target viewport begins near group **90,000**;
- evidence method: executable regression wraps the group array with a `Proxy` and counts numeric index reads;
- samples: n/a for this structural count.

BEFORE:

- `xDriveMediaGalleryTimelineWindow` starts at group 0 for every viewport calculation;
- a deep viewport therefore inspects essentially every earlier date group before reaching the retained window;
- the named 100,000-group workload is **O(G)** per window calculation and requires roughly 90,000+ group inspections before useful work.

AFTER / current:

- binary search finds the first group whose bottom intersects the retained viewport;
- the forward pass stops as soon as a group's top is beyond the retained viewport;
- the same workload is **O(log G + V)** where `V` is the small number of retained visible/overscan groups;
- regression budget: the named 100,000-group / group-90,000 workload must remain below **64 numeric group-array reads**.

Decision: **Accepted.** Timeline group positions are monotonic by construction, so searching the ordered layout does not change item ranges, group headers, overscan, or VirtualCollection fetch semantics.

Regression command:

- `node --test desktop/tests/media-gallery-virtual.cjs`.

Next action: audit Gallery thumbnail retention/queue work during fast scrolling, then return to FileExplorer sync/delete basic-path performance.

## 100k thumbnail fast-scroll retention

Status: **Accepted / paired structural BEFORE/AFTER; hosted-runner CPU diagnostic only**.

Stable workload and acceptance gate:

- logical collection: **100,000 media items**;
- synthetic fast-scroll traversal: **90 retained tiles / 54 visible tiles per window**, ${Math.ceil(100000 / 90)} windows across the full logical collection;
- image and Live Photo tiles share `XDriveMediaThumbnailScheduler`; their tile path does not load Live Photo motion bytes during ordinary grid rendering;
- video tiles are measured against the current global poster scheduler with decode/preview tasks intentionally held unresolved to model a slow codec/network while the user scrolls away;
- image/live sample count: **5**; each synthetic scroll frame yields once so the scheduler microtask pump actually starts/retains bounded work; video queue counters are deterministic and measured once because poster scheduler state is app-global;
- structural acceptance budget, declared before optimization: peak queued work must remain **<=180 entries** (two retained windows), image/live active + in-flight work must remain **<=6**, and video active work must remain **<=3**;
- CPU elapsed time is printed as diagnostic data only on hosted CI and is not an acceptance threshold until paired on the same runner/method.

Baseline command:

- `node --test desktop/tests/media-gallery-100k-performance.cjs`.

Decision rule:

- if the current implementation stays inside the structural budgets, keep it unchanged;
- if a path exceeds budget, optimize only that path and rerun this exact workload;
- retain production changes only when the structural reduction is material and the ordinary Gallery tests remain green.


Measured BEFORE baseline (GitHub CI, corrected pump-aware harness):

- image / Live Photo scheduler, 5 samples:
  - total traversal CPU: **median 586.676 ms**, min **536.128 ms**, max **784.501 ms**;
  - equivalent diagnostic median: about **0.528 ms per 90-item synthetic scroll window**;
  - peak queued: **180**;
  - peak active / in-flight: **6 / 6**;
  - final queued: **10** (the final partial retained window);
  - decision: **keep unchanged** because all declared structural budgets pass.
- video poster scheduler:
  - diagnostic traversal CPU: **149.368 ms**;
  - peak active: **3**;
  - peak queued: **99,997**;
  - final queued: **99,997**;
  - cancellation support: **false**;
  - decision: **optimize** because stale not-yet-started poster work scales with traversed video count and exceeds the **<=180** queue budget by more than 555x.

AFTER / current (same 100k workload):

- image / Live Photo scheduler, unchanged production path:
  - total traversal CPU: **median 446.415 ms**, min **335.352 ms**, max **469.634 ms**;
  - peak queued: **180**;
  - peak active / in-flight: **6 / 6**;
  - final queued: **10**;
  - structural result is unchanged and still inside budget. The lower hosted-runner CPU number versus the BEFORE run is treated as noise/diagnostic only because no image/live production code changed.
- video poster scheduler:
  - diagnostic traversal CPU: **68.999 ms**;
  - peak active: **3**;
  - peak queued: **90**;
  - final queued: **10**;
  - cancellation support: **true**;
  - structural delta: peak queue **99,997 -> 90**, a reduction of **99,907 entries / 99.91%**, about **1,111x smaller**;
  - final queued work **99,997 -> 10**.
- actual decode/network concurrency remains **3**. Cancelled in-flight tasks are not treated as free capacity; they release their slot only when the underlying task settles. Their eventual Blob result is revoked instead of retained/displayed.

Decision: **Accepted.** The change materially removes traversed-item-scaled stale video work while preserving the real poster concurrency cap. Image/Live Photo code remains unchanged because its baseline already met the predeclared budget.

Regression budget:

- video poster peak queued work in this workload must remain **<=180**;
- video poster active work must remain **<=3**;
- virtual-tile cleanup must call the returned poster schedule cancel handle;
- image/live scheduler remains bounded to the existing **6** active loads and **<=180** peak queue under this workload.

Next action: measure **warm video revisit behavior** end to end, because Gallery video tiles currently enter the preview/decode poster path independently of the image thumbnail scheduler. Do not optimize that path until a cold/warm request/decode baseline proves repeated work.



## 100k mixed-media first open

Status: **Accepted / measured AFTER + structural first-screen improvement**.

Stable workload:

- **100,000 Gallery-visible logical items**:
  - **70,000 ordinary photos**;
  - **15,000 ordinary videos**;
  - **15,000 Live Photos**;
- each Live Photo has one still and one motion original, so the Server dataset contains **115,000 physical media nodes** while Gallery exposes exactly **100,000 logical items**;
- capture dates span **3,650 days** so first-range work exercises Year / Month / Day timeline grouping rather than one artificial date bucket;
- initial range size: **100 items**;
- shared UI viewport: **1440 px** width and **900 px** visible height;
- UI timeline samples: **10**;
- Server first-range samples: one cold run plus **3 warm runs**;
- warm media refresh is measured separately with **0 stale media nodes**.

Measurement commands:

- shared UI + thumbnail scheduler:
  - `node --test desktop/tests/media-gallery-100k-performance.cjs`;
- real PostgreSQL Server:
  - `XD_GALLERY_FIRST_OPEN_PERF=1 XD_TEST_DATABASE_URL=... go test -run '^TestMediaGalleryFirstOpenPerformance100K$' -count=1 -v ./internal/api`.

The Server benchmark is branch-scoped for `perf/gallery-100k-thumbnail-baseline` on GitHub/GitLab CI and remains opt-in elsewhere.

### BEFORE / first reproduction

The first Server 100k reproduction ran inside the ordinary API race job before the dedicated performance job existed. Its wall-clock values are therefore **diagnostic, not a comparable successful baseline**.

It reproduced a real scale failure:

- stale-media probe over the 115k physical rows: **356.633 ms**;
- Day timeline aggregation over 100k logical items: **332.935–353.820 ms** across observed requests;
- with **0 stale media nodes**, request-time `refreshMediaIndexForOwner` still entered full MediaGroup/PhotoAsset reconciliation;
- `photoasset.ReconcileOwner` loaded all **115,000 MediaMetadata rows** in **11,301.737 ms**;
- its next Node query expanded the 115k IDs into one `IN (...)` and failed with `extended protocol limited to 65535 parameters`;
- the warm refresh reached that failure after roughly **14.5 s**.

The same first reproduction also exposed a benchmark-only fixture problem: pairing 15k synthetic Live Photos by generated filename without an owner/name index cost **484,064.595 ms**. That setup overhead was removed with a fixture-only `xd_nodes(owner_id, name)` index and is not treated as Gallery product latency.

Shared UI BEFORE, from the corrected 100k harness:

- timeline layout CPU, 10 samples:
  - median **3.850 ms**;
  - min **2.208 ms**;
  - max **12.488 ms**;
  - **3,650** day groups;
  - **56** retained first-screen items;
- structural bootstrap state: the first media range was started concurrently, but `setItems([...range.items])` occurred only after Albums, Places, Pets, suggested people and all durable-person pages completed.

Decision from BEFORE: **optimize request-time warm refresh and first-screen orchestration; do not optimize VirtualCollection/timeline layout.**

### AFTER / current

Server, dedicated non-race PostgreSQL performance job (authoritative final measurement run on the unchanged production code):

- fixture seed: **27,784.329 ms** for 115k physical rows. This is benchmark setup time and is not part of first-open latency;
- stale probe: **249.233 ms**, **0 stale nodes**;
- first 100-item range:
  - cold: **466.677 ms**;
  - warm median: **409.147 ms**;
  - warm min: **396.396 ms**;
  - warm max: **428.766 ms**;
- timeline result shape:
  - **11** year groups;
  - **121** month groups;
  - **3,650** day groups;
- zero-stale request-time refresh: **212.556 ms**, success, no timeout;
- the two measured synchronous Server components for a warm library request are therefore about **622 ms combined** before HTTP/JSON/client overhead. This is a component sum, not an end-to-end browser timing.

Shared Web/Desktop UI AFTER, same 100k logical workload:

- timeline layout CPU, 10 samples:
  - median **2.507 ms**;
  - min **1.915 ms**;
  - max **6.363 ms**;
  - **56** retained first-screen items;
- the CPU difference versus BEFORE is treated as hosted-runner noise because timeline production code did not change;
- structural bootstrap state changed from **wait-all** to **range-first**:
  - Albums, Places, Pets, suggested people and durable people still start concurrently;
  - the first `listItemRange` result commits items/timeline/VirtualCollection immediately;
  - secondary facets update afterward with the existing request-generation stale-result guard;
  - a slow facet can no longer delay the first visible media range.

Thumbnail scheduling remains inside the existing 100k budgets:

- image / Live Photo: peak queued **180**, active / in-flight **6 / 6**;
- video poster: peak queued **90**, active **3**, final queued **10**.

### Production changes

1. `refreshMediaIndexOwnerBatch` now returns immediately when the bounded stale-node probe finds **zero** nodes. This avoids an unnecessary full owner MediaGroup/PhotoAsset reconciliation on an already-current library.
2. The nonzero-stale path keeps its existing reconciliation timing and semantics; this PR does **not** change how actual media updates are projected.
3. Shared Web/Desktop Gallery commits the first range before secondary facets finish.

Decision: **Accepted.** The measured 100k bottleneck was not timeline/VirtualCollection CPU. The fix removes the synchronous zero-stale full-owner projection rebuild and removes secondary facets from the first-screen critical path. At 100k, the warm refresh now succeeds in **212.556 ms** instead of entering an ~14.5-second path that ultimately failed at the PostgreSQL bind-parameter ceiling.

Regression budgets for this named workload:

- 100k zero-stale refresh: **<= 2,000 ms** and must succeed;
- first 100-item warm range: **<= 2,000 ms**;
- shared UI timeline layout median: **<= 25 ms**;
- first-screen bootstrap must commit the first range before secondary facet completion;
- existing thumbnail scheduler budgets remain unchanged.

### Remaining 100k risk / next action

A separate scale issue remains when the library actually contains stale media: full `photoasset.ReconcileOwner` still contains large owner-wide materialization / `IN ?` patterns and the first-red run proved that one such Node lookup crosses PostgreSQL's **65,535 bind-parameter** limit at 115k physical media nodes.

That is **not** hidden by this first-open optimization. It should be handled as the next dedicated Gallery/PhotoAsset performance task: make full PhotoAsset reconciliation 100k-safe (bounded/subquery-based loading and bounded writes), measure its real cost, and then decide whether the request path should stay synchronous for stale media or hand the projection work to the existing background MediaIndexer.



### Correctness-preserving first-open refresh boundary

The first attempt to return early from the shared `refreshMediaIndexOwnerBatch` when there were zero stale media rows was rejected by the ordinary API suite: a deliberately corrupted three-member Live Photo group relies on the existing album-item read path to rebuild PhotoAsset projection even though its MediaMetadata rows are already current.

The final design therefore keeps the original full refresh/reconcile contract intact and adds a separate `refreshMediaIndexForGalleryRead` fast path only for first-open index surfaces:

- main Gallery item range;
- Albums index;
- Places index.

That helper performs a one-row stale-media probe. If the projection inputs are current, it reads the existing PhotoAsset projection without rebuilding the owner. If stale media exists, it delegates to the original full refresh. Specific album-item reads keep the original full reconciliation path, preserving read-time repair behavior covered by the corrupt Live Photo integration test.


### Accepted 100k first-open result

Final authoritative GitHub CI on the correctness-preserving implementation used the same **100,000 logical / 115,000 physical media** workload.

Server AFTER:

- fixture seed: **26,931.534 ms** (setup only; excluded from user-visible first-open latency);
- stale-media probe: **209.126 ms**, with **0 stale rows**;
- first range:
  - cold: **348.952 ms**;
  - warm median: **357.427 ms**;
  - warm min/max: **345.760 / 384.288 ms**;
- timeline index returned **11 year / 121 month / 3,650 day groups**;
- first-open lightweight refresh: **203.145 ms**, successful, no timeout and no PostgreSQL parameter-limit failure.

The first-red request-time full projection path had already spent **11,301.737 ms** loading 115k MediaMetadata rows and then failed after roughly **14.5 s** when a 115k-node `IN (...)` exceeded PostgreSQL/pgx's 65,535-parameter limit. The final first-open refresh completes in **203.145 ms** on the same workload: more than **70x shorter than the failed path to that failure point**, while the original full reconciliation path remains available for strong read-time repair.

Shared UI AFTER:

- 3,650-group timeline layout, 10 samples: **median 5.465 ms**, min **2.009 ms**, max **10.083 ms**;
- retained first viewport: **56 items** out of 100,000;
- library bootstrap now commits the first range before Albums / Places / Pets / suggested people / durable people finish;
- image/Live Photo thumbnail scheduler remains bounded at **6 active / 6 in-flight / <=180 queued**;
- video poster scheduler remains bounded at **3 active / 90 peak queued**, with viewport cancellation enabled.

The earlier UI BEFORE sample was already CPU-cheap (**3.850 ms median** timeline layout), so no CPU speedup is claimed there. The material UI change is removal of the synchronous facet wait from the critical path.

Correctness gate:

- the ordinary API race suite is green;
- `TestMediaGalleryIndexesOrdinaryFilesWithoutSourceMembership` passes again, including the deliberately corrupted three-member Live Photo repair case;
- the full `refreshMediaIndexForOwner` behavior is unchanged for strong-repair reads;
- only the main Gallery range, Albums index, and Places index use the one-row stale probe fast path.

Decision: **Accepted.** The 100k first-open bottleneck was request-time projection reconciliation plus UI wait-all, not VirtualCollection or timeline layout. The next performance question is end-to-end **range response -> first real thumbnail/video poster visible** for the retained first viewport; measure that separately instead of continuing to optimize already-millisecond timeline CPU.


## 100k first visible media

Status: **Accepted / measured; no production change**.

This workload starts where the accepted first-open benchmark ends: the first media range is already available, and the measurement asks how long the retained first viewport takes to show real media rather than placeholders.

Stable workload:

- **100,000 Gallery-visible logical items / 115,000 physical media nodes**;
- mix remains **70,000 photos + 15,000 videos + 15,000 Live Photos**;
- first viewport is fixed at **56 items**, matching the measured retained window from the accepted 1440 x 900 first-open layout;
- the benchmark asserts that this viewport contains ordinary photos, videos and Live Photos;
- image and Live Photo tiles use real JPEG originals, the real Server thumbnail derivative path, the real object store and HTTP transport;
- cold image/Live Photo requests use concurrency **6**, matching the shared thumbnail scheduler;
- warm image/Live Photo requests reuse the generated derivative and must not reopen originals or regenerate thumbnails;
- video tiles use a valid H.264 MP4 original and the real preview-ticket plus Range transport with concurrency **3**, matching the poster scheduler;
- renderer decode uses the production `xDriveCaptureVideoPosterBlob` function inside Electron/Chromium against a real MP4 Blob;
- video decode uses **7 cold/warm pairs**. Within each pair the warm revisit reuses the same source Blob URL, so Chromium may reuse source bytes but the current Gallery code still creates a fresh video element and captures a fresh JPEG frame.

Commands:

- Server/object-store first-visible transport:
  - `XD_GALLERY_FIRST_VISIBLE_PERF=1 XD_TEST_DATABASE_URL=... go test -run '^TestMediaGalleryFirstVisiblePerformance100K$' -count=1 -v ./internal/api`;
- real Chromium video poster decode:
  - `cd desktop && xvfb-run -a ./node_modules/.bin/electron --no-sandbox scripts/gallery-video-poster-performance-main.cjs`.

Predeclared acceptance / decision thresholds:

- cold image/Live Photo **first visible <= 750 ms** after the range is available;
- cold image/Live Photo **first 12 visible <= 1.5 s**;
- warm image/Live Photo **first visible <= 250 ms**;
- cold video preview source **first bytes <= 500 ms**;
- if the real Chromium warm video-poster decode median remains above **50% of the cold median**, treat warm revisit as repeated decode rather than useful reuse and continue with the already-existing Server/Agent video-poster cache instead of inventing another cache;
- if the image/Live Photo thresholds already pass, keep that production path unchanged.

The performance jobs are scoped only to `perf/gallery-first-visible-100k` until the workload variance and budgets are established.


### 100k first-visible measured result

Authoritative final GitHub CI workload:

- **100,000 logical / 115,000 physical media**;
- retained viewport: **56 items** = **38 ordinary photos + 9 videos + 9 Live Photos**;
- Server first-range query: **586.345 ms**.

Image / Live Photo thumbnail transport:

- cold first visible: **112.041 ms**;
- cold first 12 visible: **223.689 ms**;
- cold all 47 image-like tiles: **630.259 ms**;
- cold per-request p50 / p95: **68.402 / 118.871 ms**;
- warm first visible: **6.479 ms**;
- warm first 12 visible: **13.301 ms**;
- warm all 47 image-like tiles: **35.783 ms**;
- warm per-request p50 / p95: **4.102 / 8.161 ms**;
- cold derivative generation opens originals; warm requests reuse derivative storage and do not regenerate thumbnails.

A previous successful run of the identical workload measured cold first visible **117.203 ms**, cold first 12 **235.926 ms**, cold all **668.572 ms**, warm first visible **3.775 ms**, and warm all **34.138 ms**. The two runs are the same order of magnitude and both are comfortably inside the predeclared budgets.

All predeclared image/Live budgets pass by a wide margin. **Decision: keep the production image/Live thumbnail path unchanged.**

Video preview transport:

- cold first preview bytes: **4.711 ms**;
- cold all 9 viewport videos: **12.681 ms**;
- warm first preview bytes: **2.825 ms**;
- warm all 9 viewport videos: **10.776 ms**.

The previous successful run measured **3.403 / 12.629 ms** cold and **3.066 / 9.744 ms** warm, so preview-ticket and first-byte transport is stable at only a few milliseconds and is not a remaining multi-second Gallery-open bottleneck in this synthetic 100k workload.

Real Chromium H.264 poster decode, 7 cold/warm pairs using production `xDriveCaptureVideoPosterBlob`:

- final run first process-level cold decode: **304.900 ms**;
- final run cold median / steady-cold median: **3.200 / 3.200 ms**;
- final run warm median: **3.000 ms**;
- final run warm / steady-cold ratio: **0.938**;
- generated poster median size: **2,338 bytes**.

A previous successful hosted run measured the same steady state at **2.400 ms** cold and **2.300 ms** warm, but its first process-level cold decode was **5,719.900 ms**. That one-time initialization therefore varied by about **18.8x** across otherwise equivalent hosted runs. Treat the first-process cold value as **diagnostic-only hosted-runner initialization noise**, not an acceptance budget or a generalizable user-visible video cost.

The relative warm-decode trigger is technically met: Gallery currently repeats the decode path on revisit. However, the repeatable work after process initialization is only about **2–3 ms**, while Server preview transport is also only a few milliseconds. Wiring the existing Server/Agent poster cache solely to save this steady-state work would not be a material, repeatable performance improvement on this workload. **Decision: reject that production change for now.**

Benchmark harness correction:

- the first Server attempt reused only 8 JPEG source objects and therefore could not require one original-object open per image node; CAS/derivative reuse made that assertion invalid;
- the corrected workload uses unique source variants across the 56 viewport positions;
- timings from that invalid attempt are not used as baseline evidence.

Decision: **Accepted / no production code change.** After the #981 first-open scheduling fix, the synthetic 100k Gallery does not reproduce a multi-second delay before the first real image appears. The next useful investigation, if real installations still report a long blank/placeholder phase, is an integrated Web/Desktop renderer navigation trace from Gallery route activation through first decoded image paint on a real-sized media fixture. That trace should measure actual React commit / image decode / paint timing and treat one-time Chromium video-decoder initialization separately from ordinary Gallery first-media visibility.

## Viewer first-image decode handoff (2026-10-08)

Status: **Accepted / measured presentation contract; wall-clock speedup unmeasured.**

This is a per-Viewer first-frame boundary, separate from the 100k Gallery range/thumbnail
workloads above. Baseline: `c27731ec05cafe6ac8fc55aeed807154fe4e689a`, including the
already-merged #1028 equivalent-parent-rerender source-lifecycle fix.

Named workload: **viewer-image-decode-handoff-v1**. The real shared React/MUI
`FilePreviewSurface` runs in Chromium **153.0.8010.0**, with a 500 × 500 CSS-pixel
media surface inside a 600 × 600 browser viewport, a real red 80 × 80 PNG thumbnail
and a blue 400 × 400 PNG original served
over localhost with `Cache-Control: no-store`. Original-ticket resolution is controlled;
the actual mounted image's native `decode()` completes before a controlled promise gate
is released. Cases cover ordinary images, a 90-degree edited canvas, single-file LIVP
still composition, replacement during decode, closing during decode and late ticket
completion. This is not a full application/Electron navigation trace or a slow-device
latency benchmark.

Acceptance criteria, established before the fix: show an available thumbnail while the
original is pending; never expose the original before its decode gate resolves; preserve
the visible thumbnail element through handoff; fetch each original at most once; retain
stale-result/close cleanup and true failure behavior. The deliberate resource cost is
at most one thumbnail load in addition to the one original load, and at most two image
source layers for the active target. There is no neighboring-original prefetch.

Sample count: **5 paired baseline/current browser runs**, with **21 checks per run**.
All baseline runs reproduced the same failures; all current runs passed. A final run of
the committed portable harness also passed after the stable canvas-error-callback fix.
The five pairs were repeated against the final source after the late-loader availability
fix; the browser results below reflect that final run set.

| Metric | BEFORE | AFTER | Delta / decision |
| --- | --- | --- | --- |
| Presentation/lifecycle checks passed, each of 5 runs | 10 / 21 | 21 / 21 | +11 checks; accepted |
| Thumbnail displayed before original ticket resolves | No | Yes | No serialized wait for the original |
| Thumbnail retained until mounted original decode resolves | No | Yes | Same thumbnail DOM element remains mounted |
| Ordinary / edited / LIVP original HTTP requests per case | 1 / 1 / 1 | 1 / 1 / 1 | No duplicate original request |
| Thumbnail HTTP requests per successful preview case | 0 | 1 | Explicit bounded cost for the first-frame underlay |
| Browser exceptions, all 5 runs | 0 | 0 | No new runtime errors |
| Canvas draws: initial / viewport change / equivalent rerender, unchanged recipe reference | 1 / 2 / 3 in the rejected first implementation | 1 / 1 / 1 | Regression fixed before delivery; actual recipe change still redraws |

The canvas row records a separately reproduced implementation regression, not a speed
comparison with the original baseline. The Node behavior suite also covers original
decode failure with a valid thumbnail, both sources failing, late thumbnail completion
after the original, equivalent parent callbacks, revision replacement, and blob cleanup.
A separate first-red/green case covers Web metadata supplying the thumbnail loader after
the Viewer mounts: the thumbnail must then become visible while the same original remains
pending, with exactly one original loader call.

Reproduction commands:

```bash
node --test desktop/tests/shared-image-preview-decode.cjs
node desktop/scripts/image-preview-decode-browser.cjs --source-root=/path/to/baseline-export --output-dir=/tmp/xdrive-preview-before
node desktop/scripts/image-preview-decode-browser.cjs --output-dir=/tmp/xdrive-preview-after
```

The optional browser harness requires Playwright and a Chromium runtime. It accepts
`XDRIVE_PLAYWRIGHT_MODULE`, `XDRIVE_BROWSER_EXECUTABLE`, `XDRIVE_BROWSER_ARGS` (JSON array),
and `XDRIVE_BROWSER_FONTCONFIG` overrides; otherwise it uses ordinary Playwright defaults.
It writes JSON checks/request counts and screenshots to the requested output directory,
and exits nonzero on failure. Baseline exports only need the `ui/shared` source tree;
the current checkout supplies installed Desktop dependencies.

Decision: **Accepted.** Retain the two-layer shared renderer and the existing signed
preview/thumbnail transports. No timing percentage or download-speed improvement is
claimed. Next action: if real installations still show a slow initial image, measure
route activation → first decoded thumbnail → decoded original on representative originals
and real Web/Desktop devices, separating ticket, network, decode and paint time. Viewer
metadata range reuse and Gallery-specific Live Photo composition are separate follow-ups.

## 100k real Web cold Gallery first visible + CAS thumbnail paint (2026-10-09)

Status: **Measured real Web 100k baseline / evidence-amended final CI pending (#1156); production unchanged**. [#1026](https://github.com/lazyxu/xdrive/pull/1026), [#1042](https://github.com/lazyxu/xdrive/pull/1042), and [#1067](https://github.com/lazyxu/xdrive/pull/1067) already validated the shared Web/Desktop renderer under **replayed** 100k range/thumbnail timings. Those remain accepted and must not be rerun or mislabeled as actual API→browser end-to-end measurements. [#1140](https://github.com/lazyxu/xdrive/pull/1140) accepted 100k fold SQL improvement separately; no fold code changes here.

- **P0 new named workload (Web first):** build the real Web production Gallery bundle with a test-only entry. For **each of three fresh samples**, seed a separate isolated native PostgreSQL 17 schema with **100,000 logical PhotoAssets / 115,000 physical Node+File+MediaMetadata / 15,000 paired Live Photos**, and actual mixed first-visible media objects backed by local CAS (**real 800×600 JPEG originals, H.264 preview fixture**). Serve the genuine authenticated Gin `/api/v1/media/items?range=true` and `/api/v1/media/items/:id/thumbnail` alongside exactly that bundle **on the same localhost origin**. Launch a fresh Electron Chromium Web BrowserWindow partition with caches isolated per sample. Do **not** replace the API with synthetic data or hardcoded 350ms delays.
- **Measured boundaries:** navigation start→first visible Gallery item committed, first thumbnail HTTP request/response, first decoded and two-rAF-painted JPEG, first **12 actually decoded visible image elements**, first 100k range HTTP wall time, thumbnail byte count/request count, React mounted item count, long tasks, JS heap and renderer working set, and actual CAS Store opens/derivative writes. Collect fixture seed time separately. The first-12 metric is **not** claimed as full viewport completion if videos or unready thumbnails remain. Desktop Agent/IPC and pure 100k 4K video/LIVP decode are not yet part of this Web test.
- **Frozen diagnostic budgets:** navigation→first decoded paint target **≤2,000ms**, first thumbnail cold request **≤750ms**, first 12 cold decodes **≤1,500ms after range response** (stage-specific), mounted UI nodes **<1,000**, long task **≤100ms**, no data errors. First P0 CI **records the baseline even if the provisional 2-second timing misses**, provided the real Server/HTTP/decoded-image/100k correctness contracts pass; an under-budget claim requires recorded successful actual samples. A first-red budget miss triggers the smallest targeted optimization on the same fixture and fresh matched A/B; no speculative caching.
- **Commands:** `VITE_XDRIVE_GALLERY_REAL_COLD_PERF=1 npm --prefix web run build -- --config vite.config.ts`, then `XD_TEST_DATABASE_URL=postgres://... xvfb-run -a ./node_modules/.bin/electron --no-sandbox scripts/gallery-web-real-cold-firstpaint-main.cjs` from `desktop`. Driver launches three opt-in Go integration-fixture processes via `TestGalleryRealWebColdFixture100K`, seeds actual native PostgreSQL and local Store, uses the real server, and records each sample's decoded image DOM and cost. Dedicated branch-scoped GitHub/GitLab job.
- **Actual native PostgreSQL + Gin + CAS + Chromium FIRST measurement (n=3):** [GitHub Actions run 37925995257](https://github.com/lazyxu/xdrive/actions/runs/37925995257), [scoped job 113805384208](https://github.com/lazyxu/xdrive/actions/runs/37925995257/job/113805384208), original candidate `4229417f`. Each sample used a **fresh 100k logical / 115k physical / 15k Live** SQL schema, actual authenticated media list and CAS-backed 800×600 JPEG thumbnail bytes, with a fresh Electron Chromium Web renderer partition; seed times **40,336 / 40,058 / 40,638 ms** excluded. Navigation→first visible item **1,185.1 / 1,333.8 / 1,290.5 ms**, median **1,290.5 ms**. Navigation→first image painted after decode+two rAF **1,402.8 / 1,527.9 / 1,524.9 ms**, median **1,524.9 ms (all three under 2,000ms provisional gate)**. Navigation→first **12 decoded visible images** **1,570.8 / 1,701.9 / 1,707.8 ms**, median **1,701.9 ms**. Real first-range HTTP **864.5 / 1,014.1 / 984.4 ms**, median **984.4 ms**; first thumbnail HTTP request→response **144.3 / 142.6 / 156.5 ms**, median **144.3 ms** (<750ms). Content visible→first 12 decoded image elements **385.7 / 368.1 / 417.3 ms**; this is a *proxy*, not precisely range-response→12, because the latter navigation timestamp was not separately emitted. Mounted tiles **63 / 63 / 63 (all <1,000)**, decoded visible images 12/13/14, thumbnail response bytes 358,923/333,141/358,923 B. Initial JS heap ~16 MB; Electron renderer working-set reported 212,520/208,444/215,884 KiB (snapshots, **not peaks**). CAS originals opened 22/18/24 and derived objects put 22/16/19; derivative cache was cold. No semantic Live Photo motion request or real 4K codec was exercised. **Actual Long Tasks max 157/147/142 ms — all 3 exceed the tentative 100ms budget**, with no stack/critical-path attribution yet. **Decision: accept the benchmark-only successful real first-paint baseline and keep production unchanged; investigate >100ms Long Task in a separate trace before considering a product optimization.** Do not claim the entire viewport decoded (only the first 12) or an end-to-end Desktop Agent/WAN/mobile result. Raw [ci-run-37925995257.json](performance-evidence/gallery-web-real-cold-100k/ci-run-37925995257.json); final evidence-amended CI required before merge.
- **Decision / next action:** this PR has **zero product Gallery/FileExplorer behavior changes** and must archive real native CI metrics to `docs/performance-evidence/gallery-web-real-cold-100k/` and this document in the same one work commit before final merge. Next staged P0: true Desktop Electron Main→Agent IPC first paint, then fold ON/OFF with actual verified duplicates. Later P1: real 4K H.264/HEVC persistent poster, Live photo still decode/motion suppression and longer memory/Blob URL lifetime traces. Synthetic and actual results must stay separate.

## 100k renderer route-to-first-paint trace

Status: **Accepted / native rerun measured; no production change**. The current PR #1067 native rerun is recorded above; the historical table below remains unchanged.

This follows the accepted 100k first-open and first-visible-media work. Those measurements already show that Server first-range, thumbnail transport, preview transport, timeline CPU, and steady video-poster decode are not multi-second bottlenecks. This trace isolates the remaining Web/Desktop renderer integration path.

Stable workload:

- shared production `XDriveMediaGalleryPage`, mounted in the real Web and Desktop renderer bundles;
- **100,000 logical items**, sparse range loading with a 100-item first page;
- 70/15/15 image/video/Live Photo mix, with the first visible item always an ordinary image;
- viewport **1440 x 900**;
- real 1600 x 1200 JPEG Blob and Chromium `HTMLImageElement.decode()`;
- cold trace replays the authoritative first-visible transport result with **350 ms first-range delay + 112 ms thumbnail delay**;
- warm trace replays **350 ms first-range delay + 6 ms thumbnail delay** and pre-decodes the JPEG before Gallery activation;
- Albums intentionally resolves after **700 ms** to verify that secondary facets remain outside the first-paint critical path;
- both Web and Desktop use exactly the same shared Gallery harness and media fixture.

Measured markers:

- Gallery activation -> first range request;
- first range resolution;
- virtual-grid React commit;
- first thumbnail request / resolution;
- first image DOM mount;
- first image decode completion;
- two animation frames after decode as the paint boundary;
- Long Task count / duration and renderer working set.

Commands:

- build:
  - `VITE_XDRIVE_GALLERY_PERF=1 npm --prefix desktop run build:renderer`;
  - `VITE_XDRIVE_GALLERY_PERF=1 npm --prefix web run build`;
- trace:
  - `cd desktop && xvfb-run -a --server-args="-screen 0 1920x1200x24" ./node_modules/.bin/electron --no-sandbox scripts/gallery-renderer-first-paint-trace-main.cjs <desktop|web> <image-cold|image-warm> sample-N`;
- hosted confirmation: **3 samples per surface/scenario** (12 renderer runs total), same build, viewport, transport delays and fixture.

Predeclared decision thresholds:

- **range -> virtual-grid commit <= 100 ms**;
- **grid commit -> first thumbnail request <= 50 ms**;
- **thumbnail resolved -> first image DOM mount <= 50 ms**;
- **thumbnail resolved -> image decode <= 100 ms**;
- **decode -> paint <= 50 ms**;
- **range -> first paint <= 400 ms cold / <= 250 ms warm** after the range result is available;
- any renderer Long Task **>100 ms** on the first-paint critical path is a red signal;
- total route -> first paint is diagnostic because it intentionally includes the replayed Server/transport delay, but should remain **<=850 ms cold / <=700 ms warm**.

Decision rule:

- measure first without changing Gallery production code;
- if both Web and Desktop are inside the renderer budgets, record **Accepted / no production change**;
- if one surface materially exceeds a budget, inspect its Chromium trace and optimize only the measured renderer stage; do not revisit Server range, thumbnail generation, or video transport without new evidence.

First hosted trace attempt — **invalid / not baseline evidence**:

- Desktop produced diagnostic samples at an actual **1280 x 873** viewport because the default Xvfb screen constrained the requested window; cold route -> paint was **619.3 ms** and warm **498.6 ms**, but these numbers are not accepted as the 1440 x 900 baseline.
- The Web trace did not boot: its Vite build still used absolute `/` asset URLs because only the FileExplorer performance flag selected relative file-build paths. Loading the production bundle through `file://` therefore left `boot=null` and no Gallery grid.
- The harness now gives both FileExplorer and Gallery performance builds relative assets, runs Xvfb at **1920 x 1200 x 24**, requests Electron content size **1440 x 900**, and rejects any trace whose measured viewport is not exactly **1440 x 900**.
- No Gallery production code was changed from this invalid attempt.

Latest-master authoritative trace — **master `bdbf804eb360` / n=3 per surface/scenario**:

Values are **median [min, max]** across three fresh Electron renderer processes for each surface/scenario. The trace stage completed all 12 samples; the first CI attempt failed only in the post-trace artifact-count assertion because `*.json` also matched trace JSON files. That assertion is corrected to count metric JSON separately from trace JSON.

| Surface | Scenario | route -> paint | range -> grid | grid -> thumb request | thumb resolved -> image mount | thumb resolved -> decode | decode -> paint | range -> paint | Long Task max | renderer working set |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Desktop | cold | **608.8 [607.2, 614.8] ms** | 43.8 [43.3, 47.1] ms | 9.5 [9.4, 9.7] ms | 2.9 [2.7, 3.5] ms | 25.3 [20.8, 30.4] ms | 20.1 [19.3, 20.2] ms | 210.8 [206.2, 218.4] ms | 52 ms | 211,572 [210,748, 211,688] KiB |
| Desktop | warm | **483.8 [478.8, 488.3] ms** | 44.5 [43.8, 46.7] ms | 9.2 [8.8, 9.4] ms | 1.4 [1.3, 1.4] ms | 2.4 [1.9, 2.6] ms | 17.4 [16.0, 31.4] ms | 81.7 [78.5, 92.4] ms | 54 ms | 177,928 [174,564, 180,636] KiB |
| Web | cold | **612.8 [604.5, 614.1] ms** | 44.2 [42.3, 44.2] ms | 9.5 [9.2, 9.5] ms | 2.8 [2.7, 2.9] ms | 25.5 [20.9, 29.3] ms | 19.2 [18.9, 20.0] ms | 210.3 [204.9, 214.0] ms | 54 ms | 211,936 [204,084, 212,520] KiB |
| Web | warm | **480.8 [480.0, 498.1] ms** | 47.4 [47.2, 51.5] ms | 9.2 [9.1, 9.2] ms | 1.5 [1.3, 1.7] ms | 2.7 [2.4, 2.8] ms | 17.9 [17.7, 29.7] ms | 83.2 [83.2, 99.0] ms | 50 ms | 177,520 [177,344, 181,020] KiB |

Budget evaluation:

- range -> grid: **pass** on all 12 samples (budget <=100 ms);
- grid -> thumbnail request: **pass** (<=50 ms);
- thumbnail resolved -> DOM mount: **pass** (<=50 ms);
- thumbnail resolved -> decode: **pass** (<=100 ms);
- decode -> paint: **pass** (<=50 ms);
- range -> first paint: **pass** (cold <=400 ms / warm <=250 ms);
- route -> first paint diagnostic: **pass** (cold <=850 ms / warm <=700 ms);
- Long Task red signal: **pass**; the observed maximum is **54 ms**, below the >100 ms red threshold.

Decision: **Accepted / measured / no Gallery image-path production change.** The latest production Gallery still does not show a 100k image first-paint renderer bottleneck under this workload. Per the performance policy, no speculative optimization is retained; the next measurement target is pure-video poster and pure-Live-Photo grids, followed by large-file Web/Desktop transfer throughput/RSS.

## 100k pure-video and pure-Live-Photo renderer first paint

Status: **Accepted / measured / no production change**.

This is the measurement-only follow-up to the accepted mixed 100k image first-paint trace. No Gallery production behavior changed.

Stable workload:

- production shared `XDriveMediaGalleryPage` in the real Web/Desktop renderer bundles;
- **100,000 logical items** with a 100-item sparse first page;
- **100,000 video tiles** through the production `XDriveMediaAsyncVideoPoster` path;
- **100,000 Live Photo tiles** through the production image-thumbnail grid path; ordinary grid rendering does not load Live Photo motion bytes;
- viewport **1440 x 900**;
- first-range transport replay **350 ms**;
- Live Photo thumbnail replay **112 ms cold / 6 ms warm**;
- video preview replay **5 ms cold / 3 ms warm**, rounded from the accepted **4.711 / 2.825 ms** preview first-byte measurements;
- the video fixture is generated before timing with Canvas + MediaRecorder and decoded by production `xDriveCaptureVideoPosterBlob`;
- `video-warm` prewarms that production poster decoder before Gallery activation;
- **3 fresh renderer processes per Web/Desktop surface and scenario**: 24 samples total.

The existing H.264 poster benchmark remains the codec-specific reference: steady poster capture is about **2–3 ms**, while first-process decoder initialization has varied from **304.9 ms to 5.72 s** on hosted runners. For that reason cold-video first-process initialization remains diagnostic rather than a production optimization trigger.

Predeclared acceptance / decision thresholds:

- range -> virtual-grid commit **<=100 ms**;
- grid commit -> first media request **<=50 ms**;
- Live Photo media resolved -> DOM mount **<=50 ms** and -> decode **<=100 ms**;
- Live Photo range -> first paint **<=400 ms cold / <=250 ms warm**;
- warm video range -> first poster paint **<=300 ms**;
- warm video media resolved -> first poster image decode **<=200 ms**;
- any renderer Long Task **>100 ms** is a red signal;
- renderer working set above **300 MiB (307,200 KiB)** is a red signal.

Authoritative GitHub renderer baseline — **n=3 per surface/scenario**. Values are median [min, max] except Long Task, which is the maximum observed sample.

| Surface | Scenario | route -> paint | range -> grid | grid -> media request | media resolved -> mount | media resolved -> decode | decode -> paint | range -> paint | Long Task max | renderer working set |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Desktop | video cold | **537.3 [533.3, 538.5] ms** | 67.7 [66.2, 68.9] ms | 16.3 [16.1, 16.4] ms | 12.1 [12.1, 15.7] ms | 14.3 [14.2, 16.9] ms | 29.4 [27.9, 30.2] ms | 132.5 [131.3, 136.1] ms | 56 ms | 178,152 [177,860, 180,392] KiB |
| Desktop | video warm | **535.3 [525.6, 537.5] ms** | 64.4 [61.5, 68.5] ms | 16.1 [16.0, 16.8] ms | 16.7 [13.6, 18.0] ms | 19.1 [15.8, 20.2] ms | 29.0 [27.8, 29.3] ms | **132.4 [125.8, 135.8] ms** | 57 ms | 178,108 [177,940, 179,680] KiB |
| Web | video cold | **528.2 [526.2, 534.3] ms** | 65.7 [64.5, 67.0] ms | 16.7 [15.8, 17.0] ms | 12.6 [11.1, 15.2] ms | 13.8 [12.4, 17.6] ms | 26.5 [24.0, 29.3] ms | 126.6 [125.5, 133.6] ms | 55 ms | 178,520 [177,672, 180,596] KiB |
| Web | video warm | **521.7 [517.8, 523.2] ms** | 62.1 [61.8, 63.4] ms | 16.0 [15.8, 16.8] ms | 10.1 [10.0, 10.5] ms | **11.7 [11.3, 11.9] ms** | 27.9 [24.8, 29.9] ms | **120.8 [117.5, 124.5] ms** | 52 ms | 179,372 [179,160, 180,036] KiB |
| Desktop | Live cold | **625.3 [621.7, 633.9] ms** | 56.1 [53.6, 58.4] ms | 11.9 [11.9, 12.2] ms | 2.3 [2.2, 2.9] ms | 26.1 [22.5, 29.4] ms | 18.1 [17.9, 19.3] ms | **225.4 [220.5, 227.9] ms** | 58 ms | 220,220 [219,188, 220,932] KiB |
| Desktop | Live warm | **505.6 [499.9, 511.2] ms** | 57.7 [56.6, 57.8] ms | 11.7 [11.5, 11.9] ms | 2.1 [2.0, 2.6] ms | 3.3 [3.1, 4.8] ms | 24.7 [16.8, 31.6] ms | **104.5 [94.4, 112.1] ms** | 57 ms | 184,088 [183,188, 184,888] KiB |
| Web | Live cold | **632.4 [629.1, 632.6] ms** | 61.4 [56.2, 63.9] ms | 12.3 [11.8, 12.4] ms | 3.1 [2.6, 3.4] ms | 28.9 [26.5, 32.6] ms | 17.3 [17.1, 17.4] ms | **232.2 [229.9, 232.2] ms** | 52 ms | 219,868 [219,596, 220,980] KiB |
| Web | Live warm | **514.7 [511.5, 516.9] ms** | 60.2 [57.1, 65.1] ms | 11.9 [11.9, 12.1] ms | 2.2 [1.9, 2.4] ms | 3.1 [2.8, 3.1] ms | 25.3 [21.3, 29.6] ms | **109.3 [102.6, 114.4] ms** | **60 ms** | 183,840 [183,336, 184,280] KiB |

Budget evaluation:

- range -> grid: **pass**, worst sample 68.9 ms;
- grid -> first media request: **pass**, worst sample 17.0 ms;
- Live Photo media resolved -> DOM mount: **pass**, worst sample 3.4 ms;
- Live Photo media resolved -> decode: **pass**, worst sample 32.6 ms;
- Live Photo range -> first paint: **pass**, cold worst 232.2 ms and warm worst 114.4 ms;
- warm video range -> first poster paint: **pass**, worst sample 135.8 ms;
- warm video media resolved -> poster decode: **pass**, worst sample 20.2 ms;
- Long Task red signal: **pass**, observed maximum 60 ms;
- working-set red signal: **pass**, observed maximum 220,980 KiB (about 216 MiB);
- placeholders at first measured paint: **0 in all 24 samples**.

Decision: **Accepted / measured / no production change.** Neither the homogeneous video grid nor the homogeneous Live Photo grid exposes a repeatable 100k renderer bottleneck under the declared workload. Per the performance policy, there is no justification for a Gallery cache/scheduler/rendering optimization here.

The cold-video WebM fixture also stayed inside all renderer budgets, but that does not revise the existing rule that codec/process initialization is diagnostic-only; the separate H.264 benchmark remains the authority for that one-time initialization behavior.

Next action: move to **large-file Web/Desktop upload/download throughput and RSS**, beginning with a stable 1 GiB workload before considering 4 GiB.



## Web Viewer browse-context range reuse (2026-10-09)

Status: **Accepted / measured structural request reduction; no material wall-clock claim.**

Named workload: **web-viewer-context-reuse-v1**.

Scope: Web route-level Preview / Media Viewer browsing only. Text Viewer, PDF Viewer and
Audio Player remain standalone and do not acquire neighboring range reads.

Stable workload:

- logical collection size: **10,000 items**;
- Viewer active index: **64**;
- range page size: **128**;
- current item, previous item and next item are all on offset **0**;
- Gallery range rows include the same `MediaItem` metadata the media viewer otherwise
  requests again through `mediaItem(node)`;
- Node 22.16.0 controller harness;
- zero-latency controller sample: **n=1,000**;
- equal-latency diagnostic sample: **n=30**, each mock transport call delayed by **5 ms**.

Acceptance criteria declared before the production change:

- same-page current / previous / next resolution performs **one** range request, not two
  independent neighbor range requests;
- Gallery Viewer reuses the current range row's `MediaItem` and therefore performs no
  extra current-node or current-media metadata point request when the context row matches;
- ordinary Preview reuses the current range row's `Node`;
- resolved range reuse is bounded to one active Viewer step; the resolver keeps at most
  four 128-item pages and a new active index creates a fresh resolver scope;
- a rejected range promise is evicted so retry remains possible;
- direct/no-context and mismatched-context fallback behavior remains available.

Measured BEFORE on master `3a35c385ecc953d31a9ca2b81b75e9be4f569ea2`:

| Metric | BEFORE |
| --- | ---: |
| same-page range requests | **2** |
| current `node` point requests | **1** |
| current Gallery `mediaItem` point requests | **1** |
| total Viewer bootstrap data requests | **4** |
| zero-latency controller median / p95 | **0.004 / 0.007 ms** |
| 5 ms equal-latency mock median / p95 | **5.159 / 5.422 ms** |

Measured AFTER with the same workload and sample counts:

| Metric | AFTER | Delta |
| --- | ---: | ---: |
| same-page range requests | **1** | **-50%** |
| current `node` point requests | **0** | **-100%** |
| current Gallery `mediaItem` point requests | **0** | **-100%** |
| total Viewer bootstrap data requests | **1** | **-75%** |
| zero-latency controller median / p95 | **0.003 / 0.004 ms** | diagnostic |
| 5 ms equal-latency mock median / p95 | **5.131 / 5.273 ms** | no material wall-clock change |

The equal-latency result is expected: the old point/range requests were largely concurrent,
so deleting redundant calls does not automatically shorten a synthetic critical path when
every endpoint has identical latency. The accepted benefit is the repeatable **4 -> 1**
request/DB-round-trip reduction for Gallery context and **3 -> 1** for ordinary range-backed
Preview, plus reuse of metadata already returned by the Gallery range.

Decision: **Accepted.** Keep the bounded per-active-item resolver and range metadata reuse.
Do not claim a user-visible latency percentage from this microbenchmark. If Viewer opening
is still slow on a real installation, measure the actual Server endpoints and browser
navigation trace; only then optimize a measured wall-clock stage.

## Viewer context metadata reuse — 2026-10-09

Status: **Accepted / integrated with #1058 freshness; structural measurements only;
authoritative PR CI required before merge**.

The preceding #1058 record remains the accepted baseline. This integration preserves
its fresh **per-active-item** resolver contract: current/previous/next share in-flight
and resolved pages within one step; changing active index/node or explicit refresh
creates a new reader. No previous range pages or mutation overlays carry into that
new step. A separately fenced API/source/context owner may hand off the selected
candidate immediately while its fresh neighborhood loads. Reuse is bounded to
**three 128-item pages (384 rows)**, tighter than #1058's four-page ceiling. Node,
MediaItem, and same-source acknowledged-field-patch maps each hold at most **32
entries** per reader. No global/sessionStorage media cache is introduced.

Current Gallery metadata still needs no separate Node/MediaItem point request.
Direct media links now derive their authoritative Node from `api.mediaItem` and do
not make a redundant Node request. Ordinary direct Preview retains Node fallback.
Source identity/revision fences, failed-read eviction, selection reuse, known total
counts, explicit invalidation, and mutation patches remain behavior requirements.
Acknowledged patches merge only changed fields into late same-source results, keeping
independently refreshed metadata. Acknowledged same-source neighbor fields also
survive the immediate candidate handoff; a newer revision does not inherit old patches.

### Rejected unmerged prototype

The earlier unmerged `24e247f` prototype retained pages across successive Viewer
steps. Its controlled `viewer-gallery-100k-20-same-page-steps` replay reported **80
metadata requests -> 1**, with an 8 ms artificial per-call delay and five samples:
BEFORE **167.806 [165.556,169.114] ms**, prototype **8.389 [8.284,10.616] ms**.
That experiment is **Rejected / superseded**, not the integrated result: it does not
preserve the per-step freshness contract accepted in #1058. A real return-step regression reproduced a
server revision change that the long-lived page cache hid (**revision 1 != 2**).
The integrated reader refreshes on that return while preserving the selected candidate
until the fresh range resolves. No cross-step 80->1 or corresponding latency benefit
is claimed for delivery.

### Integrated workload and acceptance

Named workloads and method:

- **`viewer-gallery-100k-20-same-page-steps`**: 100,000 logical Gallery items,
  128-item pages, active indexes 64–83, and current/previous/next resolution at every
  step; a fresh reader for every active item.
- **`viewer-direct-media-20-distinct-links`**: 20 distinct media nodes without browse
  context, each opened as a new step.
- Node **24.19.0**, **five samples per implementation/scenario**, same fixture,
  environment, units and explicitly artificial **8 ms transport delay**.
- Original `3a35c385` replays independent parallel Node/MediaItem/neighbor requests;
  upstream `30e9eb7` executes #1058's resolver per step; integrated runs execute the
  current production reader with the same per-step lifetime.

Acceptance: Gallery requires **20 range reads, zero Node reads, zero MediaItem reads**,
matching #1058; direct links require **20 MediaItem reads and zero Node reads**, with
no serial extra request. A single current/previous/next triplet still uses exactly
one same-page read and only necessary boundary pages. The 5% timing noise threshold
remains diagnostic. These are **controller request replays**, not real Server,
network, browser/Electron rendering, decode, RSS, or end-to-end measurements.

Commands from repository root:

```bash
node desktop/scripts/web-viewer-context-benchmark.cjs --baseline
node desktop/scripts/web-viewer-context-benchmark.cjs --upstream
node desktop/scripts/web-viewer-context-benchmark.cjs
node desktop/scripts/web-viewer-context-benchmark.cjs --baseline --direct
node desktop/scripts/web-viewer-context-benchmark.cjs --upstream --direct
node desktop/scripts/web-viewer-context-benchmark.cjs --direct
node --test desktop/tests/web-viewer-context.cjs desktop/tests/web-viewer-context-reuse.cjs
```

Request counts are identical across the five samples of each case.

| Workload | Implementation | Range | Node | MediaItem | Five samples (ms) | Median [min,max] (ms) |
| --- | --- | ---: | ---: | ---: | --- | --- |
| Gallery 100k / 20 steps | Original `3a35c385` | 40 | 20 | 20 | 166.718, 166.127, 166.816, 165.318, 165.150 | **166.127 [165.150,166.816]** |
| Gallery 100k / 20 steps | Upstream #1058 `30e9eb7` | 20 | 0 | 0 | 167.541, 165.016, 166.353, 165.151, 164.560 | **165.151 [164.560,167.541]** |
| Gallery 100k / 20 steps | Integrated fresh active step | 20 | 0 | 0 | 167.831, 166.940, 164.499, 162.657, 165.476 | **165.476 [162.657,167.831]** |
| Direct / 20 links | Original `3a35c385` | 0 | 20 | 20 | 165.965, 162.240, 163.651, 164.817, 165.014 | **164.817 [162.240,165.965]** |
| Direct / 20 links | Upstream #1058 `30e9eb7` | 0 | 20 | 20 | 165.072, 163.476, 172.403, 170.426, 163.989 | **165.072 [163.476,172.403]** |
| Direct / 20 links | Integrated authoritative MediaItem Node | 0 | 0 | 20 | 163.353, 163.066, 163.188, 167.928, 168.447 | **163.353 [163.066,168.447]** |

Relative to #1058, Gallery request counts are unchanged; the **+0.325 ms** median
movement is noise. Direct requests decrease **40 -> 20**; the **-1.719 ms** median
movement is also below 5% and is not a latency improvement claim. The accepted benefit
of this follow-up is the structural direct-link read reduction plus the verified
ownership, mutation and presentation integration, while retaining upstream freshness.

Decision: **Accepted**, with no additional Gallery timing/RSS optimization claim.
Behavior tests cover fresh metadata on return, immediate selected-candidate presentation
during delayed ranges, API/source-owner isolation, same-source patch reconciliation,
explicit invalidation, and acknowledged neighbor handoff. The public
`xDriveCreateWebViewerContextResolver` delegates to the same bounded reader; its upstream
behavior tests remain, and the obsolete inline-hook source-token assertion is replaced
by actual React hook Gallery/direct Media/direct Preview behavior checks.

Use authoritative PR CI as the merge gate for the reconstructed single commit. The
next measurement is real Server/browser navigation request and latency evidence where needed. Keep this replay
and the preserved #1058 measurements separate from real mobile/browser acceptance.

## RAW embedded-JPEG compatibility preview delivery (2026-10-09)

Status: **In progress / structural validation pending**. Fixed baseline: the Server already
persists 1280px analysis JPEGs and can safely extract embedded JPEGs for DNG,
NEF, ARW and CR3, but FileExplorer/Viewer requests signed original-file preview
tickets, which do not allow RAW. BEFORE: at most a 512px thumbnail; full-view
high-resolution request fails or is not available. Candidate AFTER: reuse the
existing authenticated 1280px analysis preview endpoint, separately from the
canonical original download. The corresponding Web/Agent path uses a bounded
binary response, the shared decoded-image source and request-scoped cancellation.
No new image worker, persistent cache category, original RAW transcoding or
parallel React viewer is introduced. Paired runtime timings (TTFI, 1280px
final decode, loaded bytes, CPU, RSS, abort/disconnects) for JPEG/HEIC/DNG/
NEF/ARW/CR3 and missing embedded JPEG are **not yet measured**. This is
a correctness/transport delivery only; no speedup claim or 2048px Viewer support.

## P3 native original-video hover feasibility probe (2026-10-09)

Status: **Accepted limited native feasibility probe / no product change**. The user requested optional,
bounded normal-video hover only after persistent poster reuse and real request
cancellation were delivered. Before introducing an automatic hover player,
the current implementation has **0 original media preview requests caused by
hover** (still poster only); the proposed original-file video element adds new
decoding/network work. This test-only PR deliberately leaves all Gallery
UI, ordinary thumbnails, Live Photo first-hold, Web/Desktop adapter and
cache behavior unchanged.

A native Electron/Chromium experiment uses the **existing 96×64 H.264 MP4
fixture from `gallery-video-poster-performance-main.cjs`**, served by a
real local HTTP Range-capable Node server. A simulated 100k logical video
namespace is declared but **only one video per trial actually enters the
native renderer**: not a 100k DOM stress claim. Three identical iterations
per mode execute:
- *Quick pointer pass*: 150ms (<400ms hover threshold), no source assignment.
- *Deliberate hover*: wait 400ms; create one muted, inline native
  HTMLVideoElement, load original MP4, record first-frame and actual video
  frames, play briefly, then remove the source and release the element.
- *Abandoned hover*: assign original MP4 after threshold, hold only 125ms
  while the HTTP server withholds the body for 900ms, then pause/remove
  source and observe Server connections/late bytes after 160ms.

**Predeclared resource thresholds:** all three quick passes yield **0**
HTTP video requests; there is **at most one** active video element per
simulation; all three supported-codec trials load a frame, and all three
deliberately abandoned requests disconnect by 160ms with **0** late
response bytes. Report every loopback Range/request/byte/abort counter,
time-to-first-frame, `getVideoPlaybackQuality` frame count and elapsed
wall time. Native process/codec warmup times are diagnostic.

The experiment is **not a production hover**, does not prove real
Web/Desktop Gallery handler wiring or actual signed ticket/Agent IPC,
does not validate 4K, HEVC, long GOP, real bitrate or mobile touch.
A trial passing on a 96×64 compressed clip **does not authorize default-on
hover**: actual source-bitrate traffic, memory, and failure behavior
must be compared against the same higher-bitrate clips before promotion.
**Measured on the fixed native H.264 loopback fixture:** [CI run 37901388380](https://github.com/lazyxu/xdrive/actions/runs/37901388380), [native job 113724527946](https://github.com/lazyxu/xdrive/actions/runs/37901388380/job/113724527946); **three samples per mode**; the unchanged original-file trial source was exercised. All four narrow resource checks passed. The 100k number is the *logical namespace* only, not mounted video elements.

| Mode | n | Video HTTP GETs per sample | Response bytes per sample | Decode/abort result |
| --- | ---: | ---: | ---: | --- |
| 150ms quick pass | 3 | **0** | **0 B** | No video source assigned |
| 400ms threshold, original MP4 play | 3 | **1** | **2,958 B** | 3/3 loaded, **12 decoded frames** per sample; at most one element |
| 400ms threshold, leave 125ms after load begins | 3 | **1** pending | **0 B** | 3/3 server-observed early disconnects; **0 active HTTP** by +160ms |

Native first-frame latency (after assigning the original source): **2,693.7 ms first process cold**, then **5.0 / 4.8 ms** in the two warmed samples. Those are hosted-runner process/codec initialization observations, not a guaranteed user first-frame SLA. The 2,958 B sample is a tiny 96×64 test clip; the cost of a real high-bitrate 4K/HEVC hover cannot be inferred from it. The existing Gallery had **0 original-video GETs from hover**; this opt-in simulation adds **1 GET / 2,958 B** for each deliberate hover and is not a production performance speedup.

The actual server-side trial observed the request disconnections and full-body suppression; it does **not** prove that a real Viewer/Gallery autoplay has correct signed-ticket lifetimes, mobile pointer behavior, browser energy consumption or decoder/RSS peak. [Raw per-sample evidence](performance-evidence/gallery-hover-original-video/ci-run-37901388380.json) records unrounded first-frame times, HTTP Range headers, bytes and status.

**Decision: accept only the small native feasibility result, with NO production hover change.** Keep default Gallery poster/static behavior unchanged. Next step is to repeat the test using representative 4K H.264, HEVC, long-GOP and high-bitrate footage through both Web and Desktop proxies; then add a limited, user-switchable hover only if measured memory/bandwidth/abort budgets support it. The final whole-PR CI must rerun after the evidence is committed.

### 2026-10-09 — 10k/100k native verified duplicate-fold performance

Status: **Accepted / measured BEFORE–AFTER, full evidence-amended CI pending (#1140)**. Real paired CI [run 37917773635](https://github.com/lazyxu/xdrive/actions/runs/37917773635), [PostgreSQL 17 benchmark job 113778629575](https://github.com/lazyxu/xdrive/actions/runs/37917773635/job/113778629575) ran the unchanged pre-optimization code (parent `4d5d1ba23`) and the candidate `932960d86` on the same host, with the identical test harness and **n=3 per stage**. The scoped performance job passed its complete correctness+performance validator with **status `accepted` and no errors**. Full PR CI must pass again after this evidence is committed.

- **Frozen `gallery-fold-mixed-v1` workload:** exactly **10,000** and **100,000 PhotoAssets** with 70% ordinary JPEG, 15% video, 15% Live Photo and **11,500 / 115,000** physical media Nodes. Among ordinary JPEGs, 10% form fully resource/recipe-identical 5-copy groups: **200 groups / 1,000 members** and **2,000 groups / 10,000 members** respectively. Favorite is independently set for only one copy of each group; the folder collection retains all original members. Expected folded visible counts are **9,200 / 92,000**. Every phase passed real GORM/PostgreSQL count and first/middle/album/favorite membership checks; original Node relationships were not merged.
- **Predeclared trigger:** 10k first folded range >1,500 ms, 100k >3,000 ms, >4× the OFF first range, incorrect counts, or timeout. First-red on 100k: **2,772.366 / 562.610 = 4.93×** the OFF first range, plus **3,936.129 ms** for the 100k album range. The baseline failed the *ratio* trigger rather than the 3-second first-page ceiling; there was no timeout or incorrect count.
- **Fix kept:** `applyVerifiedMediaFolding` now ranks only verified duplicate candidates with a scoped inner join, finds excess in-scope copies and excludes those from the regular owner-filtered query, instead of applying `ROW_NUMBER` over every otherwise-unique PhotoAsset. No cache, schema migration, duplicate deletion, favorite/album rewrite or default-mode path change.
- **Accepted performance rule:** initial 100k folded range must improve **≥30% and ≥100 ms** on the same host without a material regression (>25% *and* >150ms) on other stages. **Actual 100k: 2,772.366 → 1,480.912 ms; −46.58%, 1,291.454 ms saved**. 10k first folded range: **293.885 → 187.012 ms; −36.37%, 106.873 ms saved**. The 100k album range fell **3,936.129 → 1,780.661 ms (−54.76%)**. The smaller 10k mid-window stage improves only 69.238ms/29.91%, and is not independently claimed to satisfy the acceptance threshold.
- **Detailed n=3 medians (ms):**

| Logical assets | Stage | BEFORE p50 (ms) | AFTER p50 (ms) | Time difference | Relative change |
|---:|---|---:|---:|---:|---:|
| 10,000 | fold\_off\_first | 84.868 | 93.666 | +8.798 | +10.37% |
| 10,000 | fold\_index | 76.435 | 76.461 | +0.026 | +0.03% |
| 10,000 | fold\_on\_first | 293.885 | 187.012 | −106.873 | −36.37% |
| 10,000 | fold\_on\_mid | 231.503 | 162.265 | −69.238 | −29.91% |
| 10,000 | fold\_album | 423.362 | 216.446 | −206.916 | −48.87% |
| 10,000 | fold\_favorite | 100.392 | 107.571 | +7.179 | +7.15% |
| 100,000 | fold\_off\_first | 562.610 | 588.758 | +26.148 | +4.65% |
| 100,000 | fold\_index | 574.307 | 583.718 | +9.411 | +1.64% |
| 100,000 | fold\_on\_first | 2772.366 | 1480.912 | −1291.454 | −46.58% |
| 100,000 | fold\_on\_mid | 2370.952 | 1430.838 | −940.114 | −39.65% |
| 100,000 | fold\_album | 3936.129 | 1780.661 | −2155.468 | −54.76% |
| 100,000 | fold\_favorite | 821.164 | 846.817 | +25.653 | +3.12% |

- **Potential regressions and scale overhead:** Fold-index building is essentially unchanged (**76.435 → 76.461 ms at 10k**, **574.307 → 583.718 ms at 100k**). OFF first-range p50 moves **84.868 → 93.666 ms** at 10k and **562.610 → 588.758 ms** at 100k, while Favorite-only moves **100.392 → 107.571 ms** and **821.164 → 846.817 ms**; all changes are below the predeclared material regression threshold. The expensive owner-wide identity scan remains for every opt-in request, so repeated sparse page changes still incur this work. This is not claimed to eliminate all large-gallery folding overhead.
- **Evidence:** Exact unrounded phase samples, seed elapsed, row counts, visible counts and source commits are committed in [raw paired samples](performance-evidence/gallery-fold-10k-100k/ci-run-37917773635.json). The Actions artifact independently includes `before.jsonl`, `after.jsonl`, `acceptance.json` and logs. Go command: `XD_GALLERY_FOLD_PERF=1 XD_TEST_DATABASE_URL=postgres://... go test -run '^TestGalleryVerifiedFoldPerformance10K100K$' -count=1 -timeout=12m -v ./internal/api`; GitHub and GitLab feature-branch-scoped jobs use PostgreSQL 17.
- **Boundary:** timings are native Go + real PostgreSQL query p50, **not** Web/Desktop route-to-paint, Agent IPC, thumbnail decode, image/video rendering, CPU utilization, per-query allocations, peak RSS, real network bandwidth or energy usage. Those dimensions are **unmeasured** and must not be represented as improved. Re-test before enabling this opt-in feature by default. The production default remains uncollapsed, with no new opt-in index work in the default path.

### 2026-10-09 — opt-in verified Gallery duplicate folding

The new complete-resource duplicate fold is a functionality feature, not a performance optimisation. **Default 100k asset first-paint, paging and cancellation paths are unchanged** when `fold_duplicates` is absent. In opt-in mode the Server builds a bounded-batch owner-scoped equivalence projection and folds before count/range/timeline pagination, rather than client-side hiding cards after paging (which would corrupt 100k offsets and Viewer positions). The 10k/100k **native Go + PostgreSQL** opt-in fold-mode first-page and album query wall clocks are now measured in the preceding section, with the accepted scoped SQL optimisation. Browser route-to-first-paint, CPU/RSS, repeated page-request cancellation and thumbnail/rendering costs remain **unmeasured**; do not promise an end-to-end latency budget or enable folding by default.


## P3 real-coded 4K/HEVC original-video hover baseline (2026-10-09)

Status: **Benchmarking / product hover remains disabled**. The accepted 96×64 H.264
feasibility probe does not extrapolate to real source bitrate or decode. The
follow-up branch `perf/gallery-hover-real-codecs-4k` measures **real 3840×2160
encoded video bytes**, generated deterministically on a native Electron/Chromium
runner with FFmpeg, without changing Gallery UI or enabled settings. Production
Gallery hover continues to cause **0 extra video original requests**.

**Frozen workload:** 100,000 **logical** video assets (one mounted player maximum,
not 100k DOM elements), FFmpeg `testsrc2` 3840×2160 **8 fps** actual H.264
(`libx264`) and HEVC (`libx265` tagged `hvc1`) 6-second video segments, target
12 Mbps with recorded **actual** file size/bitrate, GOP of **48 frames / 6 seconds**,
and **60-second synthetic long videos** by stream-copying each segment 10 times.
The repeated 6-second GOPs are not a single continuous 60-second GOP or real camera
footage. Check exact generated metadata with FFprobe; neither 4K nor HEVC is
faked by CSS resizing or by substituting a small original fixture.

For **each** of four codec/duration assets, run **3 samples per mode** on the
same generated file and native Electron session: quick pointer pass **150 ms**
(before planned 400 ms threshold), deliberate 400 ms hover + up to 9-second
first-frame acquisition + **350 ms** playback, and 400 ms hover abandoned
**125 ms** after source assignment while the HTTP server delays body for
**900 ms**. Observe server disconnect, residual active requests and emitted
bytes **160 ms** after leaving; record HTTP Range headers, requested/emitted
bytes, actual video dimensions, `canPlayType`, first-frame time, decoded
frames and total app working set (diagnostic only, not video-only memory).
Each source is an authenticated-stream *proxy approximation* over local HTTP
Range; real server tickets, Desktop IPC/proxy, browsers on physical mobile
and hardware decoders remain separate tests.

**Predeclared resource gate for enabling any future production hover:**
quick passes must issue **0** original video requests; never more than
**one** active player; all started deliberately abandoned requests must
end with 0 active connections and **0** further emitted bytes by +160 ms.
On H.264-capable samples, expect loaded real 3840×2160 frames; record any
HEVC codec unsupported error, rather than claiming successful playback.
For the deliberate dwell, a proposed promotion ceiling is **8 MiB original
bytes per hover** and a **2-second warm first-frame** target. The current
hover-only baseline is **0 bytes/0 requests**. **Every budget violation
prevents default-on or opt-in product hover until reassessed**; it does not
mean this test-only PR should silently change the product. Whole-process
128 MiB memory variation is diagnostic because Electron heap/decoder/cache
and runner processes are not individually attributed.

**Measured current / evidence-amended:** [native GitHub CI 37904531303](https://github.com/lazyxu/xdrive/actions/runs/37904531303), [trial job 113734686556](https://github.com/lazyxu/xdrive/actions/runs/37904531303/job/113734686556), Ubuntu 24.04 hosted runner, Electron/Chromium with FFmpeg 6.1.1 and FFprobe. The branch-only scoped job and the complete first PR CI passed, but passing benchmark execution does **not** mean the video-hover product resource budget passed. This raw-data amendment must receive **a fresh complete PR CI run** before merge.

**BEFORE/current Gallery behavior:** 0 hover-initiated original video GETs, no automatic original-video decoder. No before/after wall-clock speedup can be computed for a feature that has not been shipped. **Trial only:** four real encoded original files, 3 samples per file × 3 scenarios = 36 native experiments. 100k counts **logical IDs**, not mounted media elements or real 100k browser painting. No production UI/cancellation changes in this PR.

**Exact FFprobe-verified fixture metadata** (target encoder rate 12 Mbps; measured outputs differ):

| Encoded source | Resolution | Duration | Actual bytes | Observed bitrate (bps) | GOP |
| --- | --- | ---: | ---: | ---: | --- |
| `h264-4k-6s` | 3840×2160, 8/1 fps | 6s | 10228185 | 13637580 | 48 frames = 6s |
| `hevc-4k-6s` | 3840×2160, 8/1 fps | 6s | 11290579 | 15054105 | 48 frames = 6s |
| `h264-4k-60s` | 3840×2160, 8/1 fps | 60s | 102274353 | 13636580 | 48 frames = 6s |
| `hevc-4k-60s` | 3840×2160, 8/1 fps | 60s | 112875577 | 15050076 | 48 frames = 6s |

**Predeclared budgets versus measured result:**
- Quick pass before 400 ms: **12/12 0 original GET / 0 B**, PASS. Maximum simultaneously mounted HTMLVideoElements: **1**, PASS.
- Deliberately abandoned started requests: **12/12 Server-observed early disconnects** with **0 emitted response bytes and 0 active responses** after the 160 ms observation point, PASS. This is native loopback HTTP behavior, not proof of every Web/Desktop/Go cancellation path.
- H.264 decoded at 3840×2160 in **6/6 playback trials**, 6–7 decoded frames; native loaded first-frame observations were **43.5–66.6 ms**, under the proposed **2,000 ms warm** budget. This is hosted native warm behavior rather than app-wide first paint, authenticated proxy performance or a user SLA, PASS for this limited test.
- Original data byte budget: **FAIL** against **8,388,608 B / hover**. Every 6-second H.264 playback transferred **10,228,185 B**; 60-second H.264 streamed **31,850,496 / 31,916,032 / 34,013,184 B** respectively, despite a brief preview. H.264 network reads do not become cheap merely because one player is used.
- HEVC playback in the tested Electron/Chromium environment: **0/6 supported**; all six attempted original loads produced `media-error-4`, 0 decoded frames, and nevertheless emitted **1,638,400–4,390,912 B** before termination. Codec capability is platform-dependent; this does not mean HEVC is unsupported on all user devices.
- Memory numbers in exact JSON are **whole-process working-set deltas** (not renderer-only, decoder-only, controlled A/B or user RSS evidence). They are diagnostics and cannot justify global memory thresholds.

**All 36 measured trial rows** (bytes are Server-emitted HTTP response bytes; first frame is measured *after original source assignment*, not inclusive of the hover threshold):

| Asset | Scenario | Sample | GET | Server bytes | First frame (ms) | Frames | Early closes | Active end | Outcome |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `h264-4k-6s` | 150 ms pass | 1 | 0 | 0 | — | 0 | 0 | 0 | No source |
| `h264-4k-6s` | 150 ms pass | 2 | 0 | 0 | — | 0 | 0 | 0 | No source |
| `h264-4k-6s` | 150 ms pass | 3 | 0 | 0 | — | 0 | 0 | 0 | No source |
| `h264-4k-6s` | 400 ms + play | 1 | 1 | 10228185 | 66.2 | 6 | 0 | 0 | 4K frame decoded |
| `h264-4k-6s` | 400 ms + play | 2 | 1 | 10228185 | 59.9 | 7 | 0 | 0 | 4K frame decoded |
| `h264-4k-6s` | 400 ms + play | 3 | 1 | 10228185 | 43.5 | 6 | 0 | 0 | 4K frame decoded |
| `h264-4k-6s` | 125 ms abandon | 1 | 1 | 0 | — | 0 | 1 | 0 | Cancelled/no body |
| `h264-4k-6s` | 125 ms abandon | 2 | 1 | 0 | — | 0 | 1 | 0 | Cancelled/no body |
| `h264-4k-6s` | 125 ms abandon | 3 | 1 | 0 | — | 0 | 1 | 0 | Cancelled/no body |
| `hevc-4k-6s` | 150 ms pass | 1 | 0 | 0 | — | 0 | 0 | 0 | No source |
| `hevc-4k-6s` | 150 ms pass | 2 | 0 | 0 | — | 0 | 0 | 0 | No source |
| `hevc-4k-6s` | 150 ms pass | 3 | 0 | 0 | — | 0 | 0 | 0 | No source |
| `hevc-4k-6s` | 400 ms + play | 1 | 1 | 2097152 | — | 0 | 1 | 0 | Unsupported codec (`error:media-error-4`) |
| `hevc-4k-6s` | 400 ms + play | 2 | 1 | 2228224 | — | 0 | 1 | 0 | Unsupported codec (`error:media-error-4`) |
| `hevc-4k-6s` | 400 ms + play | 3 | 1 | 1966080 | — | 0 | 1 | 0 | Unsupported codec (`error:media-error-4`) |
| `hevc-4k-6s` | 125 ms abandon | 1 | 1 | 0 | — | 0 | 1 | 0 | Cancelled/no body |
| `hevc-4k-6s` | 125 ms abandon | 2 | 1 | 0 | — | 0 | 1 | 0 | Cancelled/no body |
| `hevc-4k-6s` | 125 ms abandon | 3 | 1 | 0 | — | 0 | 1 | 0 | Cancelled/no body |
| `h264-4k-60s` | 150 ms pass | 1 | 0 | 0 | — | 0 | 0 | 0 | No source |
| `h264-4k-60s` | 150 ms pass | 2 | 0 | 0 | — | 0 | 0 | 0 | No source |
| `h264-4k-60s` | 150 ms pass | 3 | 0 | 0 | — | 0 | 0 | 0 | No source |
| `h264-4k-60s` | 400 ms + play | 1 | 1 | 31850496 | 44.3 | 6 | 1 | 0 | 4K frame decoded |
| `h264-4k-60s` | 400 ms + play | 2 | 1 | 31916032 | 61.7 | 6 | 1 | 0 | 4K frame decoded |
| `h264-4k-60s` | 400 ms + play | 3 | 1 | 34013184 | 66.6 | 7 | 1 | 0 | 4K frame decoded |
| `h264-4k-60s` | 125 ms abandon | 1 | 1 | 0 | — | 0 | 1 | 0 | Cancelled/no body |
| `h264-4k-60s` | 125 ms abandon | 2 | 1 | 0 | — | 0 | 1 | 0 | Cancelled/no body |
| `h264-4k-60s` | 125 ms abandon | 3 | 1 | 0 | — | 0 | 1 | 0 | Cancelled/no body |
| `hevc-4k-60s` | 150 ms pass | 1 | 0 | 0 | — | 0 | 0 | 0 | No source |
| `hevc-4k-60s` | 150 ms pass | 2 | 0 | 0 | — | 0 | 0 | 0 | No source |
| `hevc-4k-60s` | 150 ms pass | 3 | 0 | 0 | — | 0 | 0 | 0 | No source |
| `hevc-4k-60s` | 400 ms + play | 1 | 1 | 4390912 | — | 0 | 1 | 0 | Unsupported codec (`error:media-error-4`) |
| `hevc-4k-60s` | 400 ms + play | 2 | 1 | 1638400 | — | 0 | 1 | 0 | Unsupported codec (`error:media-error-4`) |
| `hevc-4k-60s` | 400 ms + play | 3 | 1 | 1769472 | — | 0 | 1 | 0 | Unsupported codec (`error:media-error-4`) |
| `hevc-4k-60s` | 125 ms abandon | 1 | 1 | 0 | — | 0 | 1 | 0 | Cancelled/no body |
| `hevc-4k-60s` | 125 ms abandon | 2 | 1 | 0 | — | 0 | 1 | 0 | Cancelled/no body |
| `hevc-4k-60s` | 125 ms abandon | 3 | 1 | 0 | — | 0 | 1 | 0 | Cancelled/no body |

**Decision: REJECT production original-video hover on this evidence.** The benchmark itself is an **Accepted measured baseline**, but the 8 MiB resource promotion budget failed and HEVC has no successful sample. Keep Gallery/Web/Desktop default **persisted static poster** and Live Photo **explicit first press** unchanged. Do **not** enable a default or optional original-video hover, raise the resource cap after seeing the result, or represent successful benchmark execution as successful codec/bandwidth acceptance.

**Next action (P4, separate measurement-gated work):** measure a strictly bounded, off-by-default short-derived-preview candidate (duration, resolution, codec, bitrate and source revision defined before implementation), and compare against the same 4K H.264/HEVC cases with real signed-ticket Server and Desktop Agent proxy, plus browser/physical-device verification. Record preview-generation cost, storage inventory, cache invalidation, original/derived bytes, first frame, CPU/RSS and cancellation. Build only if paired data shows material benefit and preserves correctness. The current benchmark does **not** create a derivative, second media transport or cache path.

Exact machine-readable source: [36 native trial samples](performance-evidence/gallery-hover-real-codecs-4k/ci-run-37904531303.json). Generated by the PR benchmark; data values preserved without rounding in JSON. The result is a **native synthetic-codec probe**, not real camera footage, complete Gallery integration, HDR/VFR playback, hardware decoding, 100k mounted DOM, real Go request context or measured end-to-end app latency. Status: **Measured baseline / product original-hover rejected / evidence-amended full CI pending**.

## P4 same-run original-versus-short-preview feasibility (2026-10-09)

Status: **Accepted synthetic measured baseline; production hover remains OFF; P4 Server/Agent integration remains Planned**.

First complete benchmark CI: [run 37909017887](https://github.com/lazyxu/xdrive/actions/runs/37909017887), native job [113749376367](https://github.com/lazyxu/xdrive/actions/runs/37909017887/job/113749376367), Ubuntu hosted Electron/Chromium runner with FFmpeg and FFprobe, 2026-10-09. The CI native job executed **24 independent short-preview generations** and **84 actual native playback operations**. All nine predeclared **synthetic** resource/coverage gates passed. Benchmark execution is distinct from authorization to enable a production hover feature. The evidence-amended branch MUST complete a fresh full PR CI before merge.

**Named dataset:** source 4K 3840×2160, 8 fps, H.264 and HEVC, 6s source GOP/48 frames; 6s and repeated 60s long variants. Ten 6s GOPs are not one continuous 60-second GOP. Exact H.264 original files were 10,204,316 B (6s) and 102,035,663 B (60s). HEVC original failed to decode in all six corresponding native trials; a supported-original-vs-preview ratio must therefore be computed only for H.264. This is synthetic moving imagery, not camera footage, HEVC hardware decoding, HDR/VFR or physical mobile. The **existing production Gallery has no hover video GETs**; its persisted poster remains the default.

**Derived candidate setup:** H.264 video-only yuv420p, 8 fps, faststart MP4, 3-second clip extracted beginning 0.75s into source, 16-frame intra-keyframe interval. Profiles: 480p nominal 450 kbps / peak 600 kbps; 720p nominal 850 kbps / peak 1100 kbps. Three repeat FFmpeg runs per source/profile, 24 generation samples. Generation elapsed time includes FFmpeg startup, source seek, decode, scale and encode; it excludes real Server queue, HTTP, Store.Put, and cache inventory.

| Source (4K) | Candidate | Median generation ms | Output bytes (min–max) | HTTP play bytes | Warm first frame ms | SHA equal across 3 builds |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| h264-4k-6s | 480p-450k | 355.8 | 155308–156188 | 155308 / 155308 / 155308 | 9.8 / 9.4 | **NO** |
| h264-4k-6s | 720p-850k | 426.0 | 312014–313057 | 312647 / 312647 / 312647 | 13.9 / 14.8 | **NO** |
| hevc-4k-6s | 480p-450k | 628.0 | 153390–153430 | 153430 / 153430 / 153430 | 9.0 / 9.3 | **NO** |
| hevc-4k-6s | 720p-850k | 726.0 | 307554–308349 | 307554 / 307554 / 307554 | 15.4 / 13.5 | **NO** |
| h264-4k-60s | 480p-450k | 361.7 | 155308–155432 | 155308 / 155308 / 155308 | 9.7 / 9.3 | **NO** |
| h264-4k-60s | 720p-850k | 429.7 | 312485–313688 | 312485 / 312485 / 312485 | 14.7 / 14.2 | **NO** |
| hevc-4k-60s | 480p-450k | 622.3 | 153390–153390 | 153390 / 153390 / 153390 | 9.9 / 10.3 | yes |
| hevc-4k-60s | 720p-850k | 685.4 | 307435–307759 | 307759 / 307759 / 307759 | 15.2 / 16.0 | **NO** |

**Native test:** 12 original source plays, 24 candidate quick passes at 150ms, 24 candidate plays after 400ms dwell, 24 candidate abandons after 125ms while the HTTP Range body is delayed 900ms. No more than one active video element at a time; 100k logical video IDs do not equal 100k rendered media. **All 24 quick passes:** 0 original/preview GET, 0 response bytes. **All 24 candidate abandons:** server observed early connection closure, zero emitted response-body bytes, zero active HTTP after +160ms. **All 24 candidate deliberate plays:** valid H.264 decoded frame with correct preview dimensions. Max generated bytes and max per-dwell stream bytes < 1 MiB. Warm first frame from source assignment < 2000ms in every sample; all 8 median offline generation times < 3000ms. Frame latency excludes 400ms dwell and does not imply Web/Desktop Gallery end-to-end first-visible speedup.

**Paired, same CI-host HTTP original vs candidate byte cost:**

| H.264 original | Candidate | Median original bytes | Median preview bytes | Byte ratio |
| --- | --- | ---: | ---: | ---: | ---: |
| h264-4k-6s | 480p-450k | 10204316 | 155308 | 65.70× |
| h264-4k-6s | 720p-850k | 10204316 | 312647 | 32.64× |
| h264-4k-60s | 480p-450k | 31850496 | 155308 | 205.08× |
| h264-4k-60s | 720p-850k | 31850496 | 312485 | 101.93× |

**Budget decision:** ACCEPT the small source/transport feasibility evidence. Do NOT ship default or optional Gallery hover from this benchmark alone; original hover remains rejected. Further Gate P4 requires actual authenticated Server preview ticket/stream, Desktop Agent IPC and Go request ctx cancellation, source revision/SHA/recipe key, bounded generation workers, storage class accounting, safe GC, real camera codecs and mobile browser tests. There is no production transcoding directory, new streaming API or UI player in this PR.

**Repeatability and compute cost finding:** Only 1/8 source/profile groups yielded an identical output SHA-256 across repeated FFmpeg generations. The other 7 groups were not byte-identical. Do not build a cache identity that assumes deterministic transcoder output bytes; bind the canonical cache identity to original SHA, revision, generation recipe, profile and algorithm version, and publish atomically. FFmpeg per-process max RSS diagnostics in 24 runs: **251836–422020 kB**, not an isolated Server production resource profile. These are substantial enough to require measuring worker concurrency, queue delay, real memory ceiling and generation amortization before retention.

**Evidence source:** [full unrounded 4 original-asset descriptors, 24 generation runs, 84 native runs and four same-run ratios](performance-evidence/gallery-hover-short-preview-4k/ci-run-37909017887.json). CI logs also contain the 108 emitted individual record lines. Browser-side decoded video and HTTP Range are Node loopback, not authenticated xDrive Go Server/Agent. No real end-to-end Web/Desktop or device measurement is claimed.

**Next action:** after merging this test-only branch, separately instrument signed-preview Server/Agent, prove real context cancellation and bounded background generation under mixed 10k/100k media. Measure true poster hits, 480p vs 720p hover reentry, CPU/RSS, disk retention, cache invalidation and selection quality before implementing production media derivatives. Every new persistent file class must update docs/storage-inventory.md and the storage inventory implementation in the same PR.

## P1 Gallery cover transport cancellation — test-first (2026-10-09)

Status: **Accepted measured transport cancellation / exact BEFORE and AFTER recorded / evidence-amended final CI pending**. This targets
\`XDriveMediaAsyncThumbnail\`, consumed by Gallery album covers, Memories, filmstrip,
person/place/pet covers and other non-virtual thumbnail displays. Gallery virtual
item scheduler and the separate persisted-first video-poster scheduler already own
independent AbortSignals; their in-flight ownership must not be interrupted by the
cover component. Do not modify durable upload/download/sync/delete tasks.

**Current implementation:** per-cover lifecycle sets \`active=false\` on cleanup,
but invokes \`loadThumbnail(nodeID)\` without its available optional AbortSignal.
The Web adapter supports \`fetch({ signal })\`; Desktop uses sender-scoped Agent
viewport cancellation and HTTP request context. It is possible for the request
owner to discard stale results without aborting the actual server request. This
is a source-observed hypothesis, **not** a claimed measured first-red.

**Frozen real transport reproducer:** \`cd desktop &&
node --test tests/gallery-cover-transport-abort.cjs\`. React's actual shared
thumbnail component is transpiled and mounted by react-test-renderer; a local
HTTP server holds its 8192-byte body for 500ms. Exactly 3 independent
mount → started GET → unmount samples observe 160ms after close; one
node-201 → node-202 replacement verifies the obsolete GET ends while the
new consumer remains alive. Log \`GALLERY_COVER_ABORT_SAMPLE\` and
\`GALLERY_COVER_REPLACE_SAMPLE\` with started, server-observed early
disconnect, active request count and emitted payload bytes.

**Acceptance (set before changing production):** all three unmount samples
and the superseded target must have \`started=1, earlyClosed=1, active=0,
payloadBytes=0\` by +160ms. Replacing a cover must not prematurely abort
the newer one. Intentional abort is not a user-visible failure; late
returned blob URLs remain released exactly once by their current owner.
Tests use the same node/response/delay/count semantics before and after,
and fail on any breach. **BEFORE / first-red verified:** [CI run 37912654910](https://github.com/lazyxu/xdrive/actions/runs/37912654910), Desktop job [113761246790](https://github.com/lazyxu/xdrive/actions/runs/37912654910/job/113761246790), unchanged production implementation, real React source and local 500ms Node HTTP. Three independent unmount samples all produced `started=1, earlyClosed=0, active=1, payloadBytes=0` at +160ms: **3/3 failures** of the required real transport abort invariant. The node-201→202 replacement had **old started=1, old earlyClosed=0, old active=1**, while the new request independently remained active (`started=1, active=1`), proving an obsolete request survives target replacement. Both new tests failed on their exact server-close assertions; total Desktop runner report: 1,584 tests passed, two expected product-condition failures, one skipped. This is **real first-red evidence**, not test-harness or unrelated CI error. Original responses had 500ms delay, so 0 emitted bytes at 160ms is not evidence of cancellation when stale requests are still active.

**AFTER / confirmed identical reproducer:** [CI run 37913303677](https://github.com/lazyxu/xdrive/actions/runs/37913303677), Desktop job [113763916122](https://github.com/lazyxu/xdrive/actions/runs/37913303677/job/113763916122), same source component, three unmount samples with 500ms HTTP delay and +160ms observation: **3/3** `started=1, earlyClosed=1, active=0, payloadBytes=0`. Target replacement: old request **`started=1, earlyClosed=1, active=0`** while new request remains **`started=1, earlyClosed=0, active=1`**, and neither emits bytes during that observation. The exact two original failing tests now pass. Desktop test summary: **1,586 passed, 0 failed** (one skipped). No separate UI failure fallback or redundant request is introduced.

**Structural BEFORE→AFTER on this frozen fixture:** three obsolete unmount requests still active → zero, zero early disconnects → three, and old identity-switch request active → cancelled. Do **not** call this a wall-clock speedup, because first red and fixed versions ran on distinct CI runner instances. Full Web/Desktop/Go and exact evidence-amended PR CI still guard merge. Actual xDrive Server Go request context, real physical iOS and 100k simultaneous DOM are outside this fixture.

**Exact machine evidence:** [four original-branch observations and four fixed-branch observations, including sample identity and no-body metrics](performance-evidence/gallery-cover-http-cancel/paired-ci-first-red-after-2026-10-09.json). Do not assert ms/% speedups
from a CI source/HTTP test or pretend Node HTTP alone proves the full
physical Web/Desktop/Go request context; those remain further evidence.

**Next action:** rerun the exact original red reproducer, preserve all three unmount and one replacement sample outputs, and confirm unchanged supported Web/Desktop adapters. The Gallery thumbnail scheduler remains the owner of shared viewport requests; per-cover AbortSignals are only forwarded to direct per-cover loaders, and any scheduler wrapper that ignores a local signal retains its existing independent setRetention/dispose semantics. Measured AFTER is now recorded with the original first-red; require complete full PR CI on the evidence-amended **one-commit head** before a linear-history merge. No cancellation change is permitted to affect durable background tasks.

## P1 Gallery revision-scoped thumbnail cache (2026-10-09)

Status: **Accepted scoped structural revision correction / exact AFTER reproducer green / full evidence-amended CI pending**.
The shared XDriveMediaThumbnailScheduler currently keys its cache, queued map
and in-flight map only by Node ID. The Gallery Grid/Timeline passes the Node
ID without its current revision, unlike the revision-aware FileExplorer
thumbnail cache. Consequently, after the same Node is overwritten, Gallery
may return a previous cached Blob without a new Server GET. This is a
source-observed hypothesis, not yet a measured failure.

**Frozen reproducible contract:** cd desktop && node --test
tests/media-gallery-thumbnail-revision.cjs. With Node 417, load revision
3, then 3 again (one request and cache hit), then revision 4 (a second
request and different preview URL). With Node 418, keep revision 8
source pending, request revision 9, verify independent HTTP request
ownership and old signal aborted, resolve revision 9 and then
revision 8 late; old result must never reenter cache and its Blob
must be revoked. Gallery MediaTile must pass item.node.revision and
update its loader callback dependencies when revision changes.
These are repeatable source/Promise/cancellation tests, not full
browser or real network measurements.

**BEFORE / verified first-red:** [GitHub CI 37916151616](https://github.com/lazyxu/xdrive/actions/runs/37916151616), [Desktop job 113772701469](https://github.com/lazyxu/xdrive/actions/runs/37916151616/job/113772701469), the actual original scheduler implementation, not production-modified test mocks. Node 417 rev3→rev4 returned `blob:version-1` twice with just **1** loader call instead of the required 2; Node 418 rev8→rev9 had **1** upstream pending request, the same Promise reused, and `oldAborted=false`; the MediaTile forwarded no revision and had no revision callback dependency. All three new assertions failed; other Desktop tests were 1606 passed, 1 skipped, 0 unrelated failures.

**AFTER / confirmed exact original 3 reproducers:** [GitHub CI 37916615118](https://github.com/lazyxu/xdrive/actions/runs/37916615118), [Desktop test job 113774788258](https://github.com/lazyxu/xdrive/actions/runs/37916615118/job/113774788258): Node 417 unchanged rev3 warm cache is still one load, rev3→rev4 now starts **2** total source loads and returns `blob:version-2` instead of `blob:version-1`. Node 418 rev8→rev9 issues **2** separate loads, `oldAborted=true`, rejects/revokes late obsolete Blob and preserves the rev9 cache. The new MediaTile revision propagation test is also green. These are exact structural request-count and lifecycle changes, not elapsed-time performance gains.

**One unrelated test-harness assertion was stale after this accepted API change:** existing `desktop/tests/media-gallery.cjs` searched for a literal `thumbnailScheduler.load(nodeID, thumbnailPriority)` and numeric Node-ID cache map types, whereas the valid new contract adds the Node revision and string identity keys. All three first-red tests passed, but the initial candidate Desktop suite reported **1608 passes, 1 failure in this obsolete source assertion, 1 skip**. Its assertions have now been updated to require the new revision-aware expression/maps while continuing to guard 6-request, 512-entry, viewport-retention and Blob-ownership invariants. This is a test-contract correction, not a new product behavior change.

**Evidence:** [exact before and after sample rows](performance-evidence/gallery-thumbnail-revision/ci-first-red-versus-candidate-2026-10-09.json) include the obsolete warm and in-flight request counts and their replacement versions. The original reference tests were not rewritten to avoid the previously failing interleaving. The same test suite and final full PR CI must pass on the updated **single work commit** before merge. The current Web/Agent transport-level revision freshness is still unmeasured and separate. No end-to-end user page latency or percent improvement is asserted. Maintain
same-revision hit, the 6 active / 512 cached limits, version-consistent
tile rendering, stale result fencing, existing Blob ownership and
view-scope cancellation. Avoid accidental original-video reads,
especially for persisted posters and idle Live Photos.

**Separate end-to-end follow-up:** Web thumbnail fetch URL uses a static
version parameter, and album/memory covers may expose only a Node ID.
Even after the in-memory cache is fixed, browser HTTP cache freshness
and cover identity need real same-Node-overwrite tests. Do not
represent this scoped test as proving full cross-surface cache freshness.
The current wall-clock page speed is unmeasured; this is a correctness
and request-count baseline, not a percent speedup claim.

## P1 Web + Desktop Agent revision-fresh thumbnail HTTP cache (2026-10-09)

Status: **Measured HTTP source freshness before/after accepted / full evidence-amended CI pending**. After
merged #1141, Gallery virtual memory thumbnail URLs, queued work, and
in-flight requests are isolated by Node revision. This is not sufficient
to prove cross-entry freshness because Web ApiClient.mediaThumbnail
currently calls a static URL ending in ?v=3, while the Server permits
private max-age=3600 and Desktop Agent caches by user/session/Node ID
until that expiry (with ETag-based revalidation only after expiry).
A Server thumbnail's ETag changes on revision; a cached client response
never sees the new ETag until it revalidates or changes the URL.

**Frozen Web native first-red:** desktop/scripts/gallery-web-thumbnail-revision-main.cjs
runs the exact TypeScript-transpiled production Web thumbnail method
(not a hand-written implementation) in an actual Electron/Chromium
BrowserWindow. An on-host HTTP server serves revision-3 JPEG response
bytes with private max-age=3600, keeps that URL fresh, then accepts a
control-path update to revision 4 with a new ETag. Three independent
known-revision Node IDs are loaded twice at revision 3 then at revision
4, expecting the first two fetches to reuse **one upstream GET**, the
revision-4 fetch to issue a second GET and return correct new bytes.
Three independent Node IDs lacking a known revision are loaded once
before and once after the same overwrite, and must not return stale
bytes from Chromium's HTTP cache. Each sample logs exact source bytes,
number of HTTP GETs, URLs, and diagnostics. Cache expiry is NOT
manually advanced; this specifically exercises a still-fresh hour-long
response. **6 sample series (3 + 3)**. The native test writes
desktop/perf-results/gallery-web-thumbnail-revision.json even if a
freshness gate fails.

**Frozen Desktop Agent real HTTP first-red:** Go test
TestAgentCloudMediaThumbnailOverwriteRevalidatesUnknownRevision uses
actual agentController.CloudMediaThumbnail and its 256-entry/32MiB
production cache, userconfig credential-backed Client, and a real
httptest.Server that returns revision-dependent JPEG and ETag with
max-age=3600. Three distinct Node IDs are requested at rev3; the mock
source changes to rev4 while the cache has not expired; immediately
requesting the same Node must now return revision-4 bytes and observe
a second real HTTP request (unknown revision callers cannot claim
a version-specific immutable cache hit). Log three individual cases.
If the Agent lacks source revision information, correctness requires
revalidation; a later revision-aware key may preserve current-version
warm response hits for callers with explicit revisions.

**Predeclared acceptance:** 3/3 known Web tests 1 GET for warm rev3 and
2 GETs after revision 4; 3/3 Web unknown-version tests must not return
old bytes; 3/3 Agent unknown-version tests must do a new conditional
GET after overwrite and return new bytes. Retain authenticated owner
scope, cancellation, ETag, warm persisted Server poster read, Video
first-hold-only Live motion, and all existing cache entry/byte limits.
Never turn on original/short hover or create a transcode path here.

**BEFORE / genuine same-source HTTP first-red:** [GitHub CI 37919835052](https://github.com/lazyxu/xdrive/actions/runs/37919835052), native Web [job 113784831355](https://github.com/lazyxu/xdrive/actions/runs/37919835052/job/113784831355) and Go Agent [job 113784831233](https://github.com/lazyxu/xdrive/actions/runs/37919835052/job/113784831233) were run with unchanged production clients. Actual Chromium/production Web method: **3/3 known-revision** and **3/3 unknown-revision** cases served revision-3 bytes after the Server source advanced to revision 4. Each node had only **1 upstream thumbnail GET**, because the URL's fixed `?v=3` stayed fresh for 3600s. Actual `CloudMediaThumbnail` with userconfig session, Agent production cache and httptest.Server: **3/3** nodes also returned old revision-3 bytes and performed only **1 GET** despite the Server source changing and its ETag being different. This is **9/9 stale-after-overwrite observations**, all rooted in the missing source revision/freshness revalidation, not harness bugs. Raw source/response bytes, URLs, statuses and counters are in [first-red evidence](performance-evidence/gallery-thumbnail-http-revision/ci-run-37919835052-before.json).

**AFTER / exactly the same nine first-red tests are green:** [GitHub CI 37920931039](https://github.com/lazyxu/xdrive/actions/runs/37920931039), native Chromium Web [job 113788406287](https://github.com/lazyxu/xdrive/actions/runs/37920931039/job/113788406287) and Go Agent [job 113788406104](https://github.com/lazyxu/xdrive/actions/runs/37920931039/job/113788406104). Known-revision Web source calls at rev3 twice still issue **1 GET**, and at rev4 cause a new GET for the updated bytes. Unknown-revision Web cover fetches now make a conditional server round trip at every call, returning rev4 bytes after overwrite; Agent unknown-revision cache revalidates and returns rev4 bytes too.

| Fixed workload | BEFORE result | AFTER result | GETs per Node before → after |
| --- | --- | --- | ---: |
| Web Chromium, known revision (n=3) | 3/3 old revision 3 | 3/3 new revision 4 | 1 → 2 (same-version warm still cached) |
| Web Chromium, unknown revision (n=3) | 3/3 old revision 3 | 3/3 new revision 4 | 1 → 3 conditional |
| Desktop Agent real HTTP (n=3) | 3/3 old revision 3 | 3/3 new revision 4 | 1 → 2 conditional |

**Raw evidence:** [BEFORE source and request rows](performance-evidence/gallery-thumbnail-http-revision/ci-run-37919835052-before.json), [AFTER identical Chromium/Agent source and request rows](performance-evidence/gallery-thumbnail-http-revision/ci-run-37920931039-after.json). The existing native method and Go controller have been tested with the same 3600s Cache-Control and source overwrite sequence. The additional conditional GETs for unknown-revision covers are an intentional cost to eliminate stale content, not a measured speed improvement. No claimed first paint, remote throughput, 100k DOM, RSS, or mobile gain.

**CI formatting follow-up:** that first candidate CI reported only `go-linux`'s gofmt check failure for four Go test files: `desktop_ipc_test.go`, `media_thumbnail_revision_http_test.go`, `media_thumbnail_revision_ipc_test.go`, `media_thumbnail_cache_test.go`. The exact `gofmt -d` hunks emitted by the CI run were applied without modifying the production algorithm or rewriting the 9 original failing tests. The next full CI must pass all Go formatting and release-artifact checks before merge.

**Residual production acceptance:** The isolated native test verifies Chromium's actual HTTP cache and Agent's request cache, not a real database-backed file replacement. The Server thumbnail handler presently ignores a client-provided `revision` query; an out-of-order known-revision request could cache older Server bytes under a new revision URL. That separate Server-side revision guard requires a real first-red and positive tests, and is not claimed solved by this PR.

**Final gate:** the exact six native Chromium and three Go Agent original first-red tests must become green on the amended single work commit; end-to-end revision wiring contract, IPC query validation, existing Go/Node tests and full PR CI must pass. No real 100k DOM, authentic xDrive DB source-write or physical-mobile measurement is claimed; first-visible/RSS/wall-clock improvement not measured. The scoped GH/GitLab jobs are
gallery-thumbnail-web-overwrite and gallery-thumbnail-agent-overwrite.
Only a genuine source/actual HTTP stale-byte failure authorizes a
production change in the same single work commit; runner/setup/test
fixture errors do not. Store exact before/after sample evidence here.
This is a correctness and transport-byte request-count comparison,
not a claim of improved first paint, 100k DOM behavior or RSS.

## P1 Server thumbnail query revision guard after Web/Agent overwrite fix (2026-10-09)

Status: **Accepted HTTP version-fence A/B: original 8 failures → 8 passes; final evidence-amended CI pending**.
Merged #1148 fixed client-side stale thumbnail HTTP caching in Chromium Web and
Desktop Agent, but production `mediaThumbnail` still handles
`GET /api/v1/media/items/:id/thumbnail?revision=<r>` without testing `r`
against the owner-scoped current `Node.Revision`. A client that has an
out-of-order new revision may receive old bytes under a new immutable
browser URL, or an old-version request may fetch new bytes under its old URL.
This work is independent of binary Preview Engine streaming and does not
introduce a new derivative/cached media class.

**Test-first real Server workload:** extend
`TestMediaGalleryIndexesOrdinaryFilesWithoutSourceMembership` in
`internal/api/media_integration_test.go`, with an authenticated Gin Router,
real PostgreSQL 17 test DB, real derivative scheduler, local media storage
and two uploaded PNG sources (3x2 original, 5x4 overwrite). Frozen order:
(1) original thumbnail 200, revision-matched GET 200 with identical bytes,
(2) future revision URL must be **409 Conflict** plus
`Cache-Control: private, no-store`, with invalid/missing-effective
revision 400, (3) overwrite original Node with If-Match and verify
incremented revision, (4) old revision URL now **409 and uncacheable**,
(5) updated revision URL **200**, decoded thumbnail dimensions 5x4
and changed ETag. This covers two mismatched versions, two matching
versions, and invalid revision inputs; unknown-revision callers still use
the original route unaffected and retain ETag revalidation behavior.

**BEFORE:** not yet measured; CI will run the unchanged Server implementation
with these same tests, expecting real HTTP 200 for a future revision (wrong).
Only a true integration first-red allows the narrow production guard.
**AFTER:** not yet available. The original tests must turn green without
weakening the status assertions. This is an identity/caching correctness
gate; it is not a claimed 100k throughput/latency improvement, video hover,
Live Photo motion change or new physical storage. Preserve owner authorization
before leaking Node revision and ensure wrong-revision responses cannot be
long-lived cache entries. Keep the existing thumbnail/poster persistence,
Go request context, user/session-scoped access and cancellation unchanged.

**Expanded same-root-cause endpoint:** the 1280px RAW/JPEG analysis derivative is also served by `mediaAnalysisPreview` and its Web client uses `?revision=N`, while the Server endpoint does not compare that query to the owner-scoped Node revision. The original first-red test is extended to exercise both endpoints with independent nonfatal subtests: future revision **409 + private,no-store**, old revision after overwrite **409**, matching old/new **200 + matching JPEG bytes**, invalid version **400**. The same authenticated PostgreSQL 3x2 → 5x4 workflow and the same file/node identity are reused; this adds no new fixture or Server API. Distinguish first-red measurements for each endpoint, and do not change production before both actual failures are verified.

**BEFORE — two real test-first runs:** [initial Go API CI #37923364331](https://github.com/lazyxu/xdrive/actions/runs/37923364331) first observed GET /media/items/3/thumbnail?revision=2 returning 200 instead of 409 (actual revision 1). Expanded [Go API CI #37923974647](https://github.com/lazyxu/xdrive/actions/runs/37923974647), test [job 113798447885](https://github.com/lazyxu/xdrive/actions/runs/37923974647/job/113798447885), used the same authenticated Gin/PostgreSQL/local Store/media derivative scheduler, with original 3x2 PNG and a 5x4 overwriting upload. Eight independent subtest failures: thumbnail future/stale revision wrongly returned 200 instead of 409 (2), invalid revisions wrongly returned 200 instead of 400 (2), and the corresponding 1280px analysis-preview future/stale and invalid cases wrongly returned 200 (4). Matching old/current and legacy unknown revision requests continued to succeed, with JPEG geometry/ETag checks. This is real HTTP status/bytes correctness evidence, not a timing benchmark. [Raw 8 status/URL/test-location rows](performance-evidence/gallery-thumbnail-server-revision/ci-run-37923974647-before.json).

**AFTER / candidate, not yet measured:** add a shared owner-scoped `requireMediaSourceRevision(c, currentNodeRevision)` guard to existing `mediaThumbnail` (still/video poster) and `mediaAnalysisPreview` (RAW 1280px). Validate only after owner-scoped Node lookup and before metadata/derivative reads; absent revision retains existing legacy semantics; invalid/zero responds 400 + private,no-store; future or superseded revision responds 409 revision_conflict + private,no-store. Exact matches still use existing persisted derivative, ETag and positive max-age. Add eight lightweight Gin helper unit cases, and keep the original failing PostgreSQL integration tests byte-identical. No new cached data class, storage path, worker, player or motion request. Subsequent CI must show all original 8 red subtests green. An additional query-parameter parse is not a measured first-paint improvement.

**AFTER (original 8 integration subtests all green):** [GitHub CI 37925088310](https://github.com/lazyxu/xdrive/actions/runs/37925088310), [Go API job 113801986362](https://github.com/lazyxu/xdrive/actions/runs/37925088310/job/113801986362), exact original 3x2→5x4 database overwrite/Gin/auth/media-derivative test unchanged. All **8/8** subtests now pass; the common helper also passes **8/8** pure Gin query edge cases. Error responses become uncacheable JSON instead of streaming JPEG; correct-version and legacy no-version requests continue to serve original persistence-fenced JPEG/ETag.

| Request (one Node, old and new source) | BEFORE actual HTTP | AFTER actual HTTP | AFTER response bytes |
| --- | ---: | ---: | ---: |
| 512px thumbnail future source revision | 200 | 409 | 72 |
| 512px thumbnail old source revision after overwrite | 200 | 409 | 72 |
| 512px thumbnail malformed / zero revision | 200 / 200 | 400 / 400 | 41 / 41 |
| 1280px analysis-preview future source revision | 200 | 409 | 72 |
| 1280px analysis-preview old source revision after overwrite | 200 | 409 | 72 |
| 1280px analysis-preview malformed / zero revision | 200 / 200 | 400 / 400 | 41 / 41 |

**Machine evidence:** [original eight incorrect route/status rows](performance-evidence/gallery-thumbnail-server-revision/ci-run-37923974647-before.json), [exact paired eight corrected route/status/HTTP bytes rows and eight unit test names](performance-evidence/gallery-thumbnail-server-revision/ci-run-37925088310-after.json). The actual Go API test saw 409/400 for every invalid or mismatched request with Cache-Control private,no-store (checked in test). This is a structural version/HTTP correctness acceptance, **not** an apples-to-apples latency or memory improvement; distinct CI runners were used and the 1280px endpoint's fixture is PNG not a physical RAW photo.

**Final merge gate:** same source and test functionality but evidence-amended **one-work-commit HEAD** must complete its entire new GitHub CI, including Go Race, Web/Desktop, Windows packages and final gate. Do not merge on the earlier candidate CI alone. No extra viewer, generated media class, source-workload change or video hover was enabled.

## P4 actual signed Preview Engine and persisted poster HTTP transport baseline (2026-10-09)

Status: **Accepted measured existing signed transport / evidence-amended full CI pending**.
The preceding 24-FFmpeg plus 84-Chromium 4K codec/short-preview comparison
proves synthetic candidate feasibility, not deployed Server/Agent cost.
This follow-up measures the real authenticated Gin/Postgres 17/Store
signed Range path with deterministic MP4-sized pseudo-content.
The stand-in files are NOT codec-decodable: do not claim decode,
first frame, image quality, real HEVC, CPU encoding or video seek times.

| Original source and duration | Encoded original bytes | 3s 480p/450kbps bytes | 3s 720p/850kbps bytes |
| --- | ---: | ---: | ---: |
| 4K H.264 6s | 10,204,316 | 155,308 | 312,647 |
| 4K HEVC 6s | 11,290,579 | 153,430 | 307,554 |
| 4K H.264 60s | 102,035,663 | 155,308 | 312,485 |
| 4K HEVC 60s | 112,875,577 | 153,390 | 307,759 |

These sizes are copied exactly from the prior 4K encoded native sample evidence.
The benchmark seeds 12 owner-scoped Node/File/SHA identities in an isolated
PostgreSQL schema and temporary local Store; only four original Nodes have
pre-existing valid 512px JPEG poster derivatives. No production transcode
storage path or new API is enabled.

Frozen test: 3 real signed GET HTTP Range=bytes=0-1048575 per 12 objects
(**36** Range 206 requests), plus 3 poster hits per four originals (**12**
poster GETs). Require real owner-scoped POST ticket, signature/Range,
correct response byte count and Content-Range, video/mp4 and private,
no-store. Repeated warm poster reads must have zero original Store.Open
(12/12) while poster Store.Open is measured separately.

Cancellation fixture: the source-sized H.264 60s object and its 480p-size
3s candidate, 3 abandoned paced-body Range sessions each (**6**). Read
first 1KiB, cancel request, verify server Context done and zero remaining
active sessions at +160ms, with strictly less than the full Range
sent. Artificial writer pacing is for transport stress only.

CI job: gallery-video-signed-range-server, on this branch only.
Run with XD_GALLERY_REAL_SIGNED_VIDEO_RANGE_PERF=1 and
XD_TEST_DATABASE_URL for PostgreSQL 17; command:
go test -run '^TestGalleryVideoSignedPreviewRangeRealServerBaseline$'
-count=1 -timeout=12m -v ./internal/api.

**Measured current implementation:** [scoped CI run 37928037275](https://github.com/lazyxu/xdrive/actions/runs/37928037275), [real Go signed transport job 113811627049](https://github.com/lazyxu/xdrive/actions/runs/37928037275/job/113811627049). All predeclared *transport* acceptance checks passed:

| Existing real signed Preview Engine workload | Frozen target | Observed |
| --- | ---: | ---: |
| Signed HTTP 206 Range reads | 36 / 36 correct | **36 / 36** exact Range/body/content type/no-store |
| Owner-scoped cached-poster GETs | 12 / 12 without original Store.Open | **12 / 12** persisted 512px-class JPEG poster hits, **0 original Store.Open** |
| Canceled signed Range requests | 6 / 6 server Context aborted by +160ms | **6 / 6**, zero active at +160ms |
| Emitted payload per abandoned 1 MiB Range | less than 1 MiB | **32,768 B** each, n=6, paced streaming fixture |

The 4 original-size objects each returned exactly 1,048,576 bytes of the frozen signed 0–1MiB Range per pass; the 8 smaller preview-sized objects each returned their complete 153,390–312,647 B content. On this **specific capped 1MiB signed-Range transport pattern**, per-object original-to-candidate byte reductions are **6.75–6.84×** for 480p and **3.35–3.41×** for 720p. These are NOT the earlier Chromium original-hover/full encoded-file byte ratios, and are NOT a predicted browser total-GET cost. Time per signed read was also recorded as a diagnostic, not an A/B page speedup. The test uses pseudo-byte file payloads sized exactly like prior actual encoded 4K fixtures; no video decode or HEVC seek is exercised.

**Permanent 36 signed Range + 6 actual cancellation rows:** [CI raw machine evidence](performance-evidence/gallery-video-signed-range-server/ci-run-37928037275.json). The signed ticket/stream and storage attribution operated through current Gin, PostgreSQL 17, real local object Store and net/http with no product edits.

**Decision: ACCEPT the existing signed Preview Engine, revisioned warm poster and request-Context path unchanged** for this isolated Server transport workload. The native browser/FFmpeg evidence remains a separate cohort. Do **not** turn on video hover, permanent short previews or background worker generation based on this alone: real Desktop Renderer/Main/Agent streaming proxy, decodable 4K codecs/frames, peak FFmpeg worker CPU/RSS, queue delay, storage inventory and GC remain unmeasured. No performance code optimization is proposed because current transport met frozen resource and cancellation gates.

**CI formatting correction:** The first scoped benchmark job passed, but full CI Go formatting initially found only the new Go benchmark file needed gofmt; exact CI gofmt -d hunks were applied without changing the workload or passing conditions. Full authoritative CI must be rerun on the evidence-amended one-work-commit head before merge.

**AFTER:** not applicable (this is a benchmark-only PR, no production edits).
Accept current signed Preview Engine unchanged if all 36 Range,
12 poster and 6 cancellation gates pass. No ordinary-video hover,
transcode worker or permanent preview cache is authorized by this test.


## P4 Desktop Renderer/Main signed video Range transport baseline (2026-10-09)

Status: **Accepted native Desktop signed Range and actual cancellation / safe CORS metadata fix / evidence-amended final CI pending**.

P4's previous 24 FFmpeg generation and 84 native Chromium source trials,
and 36 signed Gin/PostgreSQL 17 Range reads + 12 persisted poster GETs + 6
Go HTTP cancellation samples, are independently accepted. They do **not**
exercise a signed Preview Engine request through the actual Desktop
Renderer → Electron Main loopback proxy → actual Agent IPC ticket
→ authenticated Gin/Store Range transport. This benchmark fills exactly
that missing path, using one shared signed Preview Engine. It does not
create or enable another playback, poster or transcode service.

**Fixed 12 assets:** 4 original-size files:
H.264/HEVC 6s and 60s (10,204,316 / 11,290,579 /
102,035,663 / 112,875,577 B); 8 bounded 3s candidate-size files:
480p (153,390–155,308 B) and 720p (307,554–312,647 B), using exact
byte lengths from the accepted real-encoded 4K P4 comparison. This new
fixture writes pseudo-byte payloads into the genuine local Go Store.
**They are not decodable MP4 video** despite using names with the
previously measured codec labels. No 4K decode, actual first-frame,
HEVC compatibility, seek, image quality or FFmpeg CPU may be inferred.

**Named complete transport workload:**

- Real PostgreSQL 17 isolated schema, Gin authenticated Server, 12
  owner-scoped Node/File/SHA records and current signed Preview Engine
  POST tickets, including four persistently cached JPEG posters.
- Start an actual compiled `xdrive-agent`, log in with the fixture
  account through current Agent IPC protocol, pause sync for isolation,
  and use the production `AgentIPCClient` and
  `DesktopFilePreviewProxy` in an Electron Main process with the
  actual `net.fetch` transport. Chromium Renderer issues the Range GET.
- **3 × 12 = 36** authenticated, byte-exact 206 Range reads with
  `Range: bytes=0-1048575`; status, response length, Content-Range,
  video/mp4, no-store, nosniff and masked upstream ticket must match
  the existing Preview Engine contract.
- **4 × 3 = 12** warm poster Agent IPC thumbnail reads.
  Expected **zero original Store.Open**, exactly four first cached-poster
  Server Store.Open followed by Agent warm memory hits.
- **2 × 3 = 6** abandoned HTTP Range reads through the real
  Renderer/Main/net.fetch proxy: long H.264 original and 480p
  candidate, first renderer chunk read then abort and release.
  By **+160ms**, six Server Context cancellations, zero active
  delayed streams and under 1 MiB emitted for each abandoned Range.
- Record requested/uploaded bytes, per-read wall-time diagnostic,
  separate Server Store.Open attribution, and Agent process RSS before
  and after. Three repeats are paired on the same fixture and current
  implementation; this is a transport structural baseline rather
  than a BEFORE/AFTER latency optimization.

**Command and environment:**
`XD_TEST_DATABASE_URL=postgres://... XD_GALLERY_AGENT_BINARY=<go build binary>
xvfb-run -a ./desktop/node_modules/.bin/electron --no-sandbox
desktop/scripts/gallery-desktop-signed-video-proxy-main.cjs`,
after `cd desktop && npm install && npm run build:main`.
The Electron benchmark starts
`go test -run '^TestGalleryDesktopSignedVideoProxyFixture$'
-count=1 -timeout=10m -v ./internal/api` using the existing
Server signed-Range helper and one ephemeral HTTP fixture. GitHub
scoped job `gallery-desktop-signed-video-proxy`; GitLab job is
defined for the same branch but no connected GitLab push/CI is claimed.

**Frozen predeclared acceptance:** 36/36 exact 206 Range,
12/12 poster reads with 0 original opens,
6/6 actual upstream cancellation by +160 ms, no stale 1 MiB body,
and successful secret-bearing upstream ticket masking and cleanup.
Do not enable ordinary-video hover, create a cache/transcode worker,
alter signed ticket semantics or increase producer concurrency.
If the original implementation satisfies all gates, the measured
decision is **ACCEPT existing path unchanged**. If not, differentiate
test environment/fixture error from a genuine application
transport/resource defect before any scoped optimization.
**BEFORE:** signed 206 / 1,048,576 B Range succeeded in the real Renderer/Agent path, but Chromium could not access the Content-Range header because Main proxy did not expose safe CORS metadata (actual first-red run 37937206834).
**AFTER:** original Range/metadata assertion now passes after the smallest Main proxy response-header visibility correction, with no changed signed ticket, stream API, codec, poster storage or hover UI.
Persistent raw JSON must be committed into `docs/performance-evidence/`
and this section updated with exact sample values before merge,
followed by fresh full PR CI for the evidence-amended one-work-commit head.

**Next after measurement:** combine this real signed proxy path with
decodable FFmpeg-generated 4K H.264/HEVC, real first-frame/seek,
worker peak CPU/RSS/queue latency and eventual preview retention/GC.
The latter experiments require their own named BEFORE/AFTER workloads;
no current plan authorizes enabling hover on the basis of synthetic
video-size HTTP tests.

**First scoped CI harness result (2026-10-09):** [run 37936409503](https://github.com/lazyxu/xdrive/actions/runs/37936409503), native job [113839460732](https://github.com/lazyxu/xdrive/actions/runs/37936409503/job/113839460732) exercised the actual Go PostgreSQL/Gin fixture, production xdrive-agent IPC authentication, and **all 12/12** existing persisted poster calls (4 original-size media assets × 3 warm repeats) returning 609-byte JPEG each. First calls were **30–37ms**, subsequent warm calls **~0.74–2.73ms** within the same fixture; these are individual diagnostic IPC times, not a product BEFORE/AFTER gain. The Electron process exited **before the first signed Range sample** and did not create its mandatory JSON result. Therefore **36 Range and 6 cancellation remain UNMEASURED**, and this run cannot be Accepted. The failure was not evidence of incorrect media transport: the native benchmark runner did not surface a Range failure assertion. Added Renderer/window auto-quit lifecycle diagnostics and an explicit 30s timeout around each renderer read; kept all workload targets intact. Full CI also found gofmt-only differences in this new Go fixture; replayed all four exact gofmt hunks from the CI log. Run the same real 36/12/6 fixture again on the amended one-work-commit head. No media production changes.

**Second scoped CI source-backed first red (2026-10-09):** [run 37937206834](https://github.com/lazyxu/xdrive/actions/runs/37937206834), actual native [job 113842582696](https://github.com/lazyxu/xdrive/actions/runs/37937206834/job/113842582696): actual Agent/Gin persisted poster warm requests **12/12** worked, the first Chromium Renderer signed Range request returned valid status **206** and **1,048,576 bytes**, but `response.headers.get('content-range')` returned **null**, contradicting the existing signed Preview Engine `bytes 0-1048575/10204316` source response. The Main `DesktopFilePreviewProxy` was already forwarding Content-Range but lacked a CORS `Access-Control-Expose-Headers` list, so Chromium deliberately hid this metadata from Renderer JavaScript. This is a confirmed **transport metadata visibility defect**, not slow video decoding or a race. The current patch exposes only bounded response metadata headers (`Content-Range`, `Content-Length`, `Accept-Ranges`, `ETag`, `Last-Modified`, `Cache-Control`, `X-Content-Type-Options`); no signed ticket or authorization secret is exposed and no streaming/proxy route or player behavior changes. Run the original unaltered Chromium status, body and Range assertion again, plus an explicit existing proxy test guarding the safe exposed header list. The first red stopped on sample 1, so 36 signed Range and 6 server cancellation acceptance are still **UNMEASURED**. `desktop/tests/gallery-desktop-signed-proxy-contract.cjs` also had a whitespace-only Go source token assertion which failed after correct gofmt alignment; updated that assertion to match the intended `decodable_video:false` meaning with arbitrary whitespace, without weakening any runtime measurement. The branch now contains the smallest scoped production fix justified by a real first red, rather than only an observational benchmark.

**Third full native CI — valid measured first-red-to-green:** [run 37938095695](https://github.com/lazyxu/xdrive/actions/runs/37938095695), [job 113845675365](https://github.com/lazyxu/xdrive/actions/runs/37938095695/job/113845675365), original first-success candidate e3b2d43f53ff5e60f886c2f77e24649eb5317db7. Real Electron Chromium Renderer → Main DesktopFilePreviewProxy/net.fetch → authenticated Agent IPC + signed tickets → Gin/PostgreSQL 17/Store completed **36/36 byte-exact signed HTTP 206 Range**, **12/12 persistent poster Agent thumbnail IPC GET**, **6/6 upstream Go Context cancellations**. All poster bodies were **609 B** JPEG-shaped data and had **zero canonical original Store.Open**. All six cancel rows recorded **32,768 B initially read**, **65,536 B emitted upstream**, canceled=1, and **zero active Server connections after +160ms**.

**Capped Range bytes, not a decodable codec benchmark:** 1,048,576 B median for the 1MiB-capped original, 155,308 B median for 3-second 480p candidate-size file (~6.75x lower), 312,485 B median for 720p candidate-size (~3.36x lower). All 12 media payloads are pseudo-bytes sized like actual earlier encoded 4K files, **not decodable H.264/HEVC footage**. Do not infer full-file hover savings, first-frame timing, HEVC compatibility, video seek, real FFmpeg worker CPU/RSS or network WAN user latency. Production hover, short-preview persisted transcode, storage GC and mobile/GPU acceptance remain disabled/unmeasured.

**Durable evidence:** [all 36 Range, 12 poster, six cancellation raw rows and runtime diagnostics](performance-evidence/gallery-desktop-signed-video-proxy/ci-run-37938095695.json). Exposed CORS headers are limited to Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified, Cache-Control and X-Content-Type-Options; no signed ticket, token or user credentials are exposed. Because merged #1163 and #1171 changed the shared media/CI/doc tree, rebuild exactly one P4 work commit on the current master preserving every unrelated change, and require a **new complete exact-head PR CI** before linear merge. A good source-head CI is not sufficient to validate the evidence and reconstruction.

## P0-C — shared media loading progress (2026-10-09)

**Status: In progress / first Web+Desktop implementation candidate / authoritative CI and real browser+Agent benchmark pending.** Dependency #1153 (Server 512px poster/thumbnail and 1280px RAW derivative revision guards) has passed full CI and merged at `9149a0b7dccfae26d7ea9e274aab5767d670838c`. This stage keeps known-revision GET URLs/409 conflicts and unknown-revision ETag revalidation; it introduces no new media endpoint or cache class.

**Named before measurement:** Node.js 22.16.0, fixed 16 MiB mock `Response` streamed as 64 KiB deterministic blocks, 2 warmups + 5 measured runs per method on the same local host. Existing `response.blob()` median **15.307 ms**, transform-to-Blob prototype median **11.857 ms**; manual chunk-Blob diagnostic median **4.666 ms**. Source-level work was **not yet changed** for this exploratory comparison; the candidate's production helper has a separate `desktop/tests/media-shared-progress.cjs` same-fixture n=3 baseline vs opt-in-stream diagnostic. The exploratory timings show high variance and are **not an accepted Web/Chromium speedup**. Original per-sample data, RSS changes (point snapshots, not peaks) and provenance are retained at [the exploratory JSON](performance-evidence/media-shared-progress/initial-node22-synthetic.json).

**P0-C functionality acceptance:** bounded opt-in Web media response byte observer, no-observer native Blob fast path, conditional observed Agent binary stream, sender/request-ID-only Desktop IPC events removed on completion, shared Gallery/Viewer/FileExplorer progress formatting, persisted video-poster lookup before source video, distinct video-read/capture phases, Live Photo first-hold behavior unchanged, buffering measured in media time (never fabricated complete-file bytes). Unknown or compressed Content-Length must have no percent denominator. Cache hits must not force requests/animated waiting. Wrong/stale revision must still be 409/no-store.

**Resource budgets frozen before the candidate:** per-observed-request progress ≤10 UI reports/s plus final notification; no extra HEAD requests, new durable tasks or unbounded per-image subscriptions. In a paired real-browser/Agent same-fixture test, reject a repeatable **>10% and >100 ms** regression in first visible decoded media or **>25% and >32 MiB** live RSS growth; also reject any additional original-video GET on a persisted poster hit, loss of revision safety, stale-update display or failure to abort stale HTTP/IPC. The 10%/100 ms conjunction deliberately excludes noise on tiny thumbnails; the real runner must record median, sample count and memory peaks before either acceptance or budget relaxation.

**Acceptance pending:** actual Web (Gin/PostgreSQL/CAS) 100k #1156 source benchmark, real signed-video/Live buffering, Desktop Main→Agent IPC, narrow 10k/100k scrolling, image decode and iOS/Android devices. Prior #1026/#1042 replay timings and Node synthetic data are not these end-to-end results. Update this status and append exact raw AFTER/CI evidence on the same work commit before merge; revert measured resource regressions rather than shipping a slower animation.

### P0-C initial exact-commit CI first-red and same-commit correction

[Initial GitHub PR #1162 workflow 37929242959](https://github.com/lazyxu/xdrive/actions/runs/37929242959) tested work commit `9393d18377b30d2e669ec00eb585ceeb56dbe3a7`. The single-commit, Go Windows, build-source-agent, build-client-core and server-image jobs succeeded, while Web and Desktop Linux/Windows typecheck reported the same real TS2741: a native **time-buffering-only** progress view passed no `loadedBytes` even though the shared progress type required it. The correct contract permits absent `loadedBytes` in buffering/decode states and never fabricates a byte total. This was a type-shape error, **not a proven media network failure or a performance gain**.

Desktop tests on that first commit: **1646 pass / 10 fail / 1 skip**. Eight failures were obsolete literal-source assertions or test harnesses that did not resolve the new progress component; two suites failed to load for the same missing harness dependency. Corrections preserve the original revision, 100k viewport, request-abort, LRU ownership and player contracts, and explicitly assert progress forwarding and subscriber cleanup. Source/test fixes were reconstructed into the **single** PR work commit. The newly amended head must pass its own complete GitHub CI; do not treat other jobs' old successes as validation of new content. A real paired browser/Agent CPU/RSS timing result is still missing.

**Conflict and original regression correction (2026-10-09):** candidate [CI 37931288545](https://github.com/lazyxu/xdrive/actions/runs/37931288545) passed the major Web and Desktop builds but had exactly one obsolete string assertion in `desktop/tests/file-explorer-performance.cjs`: it required the two-argument thumbnail method despite the active revision- and progress-aware Web/Desktop loaders using `(nodeID, signal/requestID, revision, onProgress)`. The assertion now requires those actual arguments in **both** transports, retaining AbortSignal, Blob ownership, no-base64 and bounded scheduling checks. Meanwhile #1161 (Viewer/Inspector real HTTP cancellation) merged to master; actual GitHub PR mergeability reported a conflict. The work branch was reconstructed as **one** commit atop the merged master, replaying progress changes while preserving the independent FilePreviewImage abort signal, FilePreviewSurface loader signal contract, and the normative cancellation documentation. Fresh exact-head full CI and actual decoded 100k/Agent/device performance budgets remain necessary; no runtime speedup is inferred from this source-contract correction.

### P0-C third exact-head synthetic first-red and observed collector redesign (2026-10-09)

[CI 37933504811](https://github.com/lazyxu/xdrive/actions/runs/37933504811), work commit `7645c610d8036605c3f825df1b5cd2aeda16859e`, verified shared Web/Desktop TypeScript and native desktop packaging; Desktop test result was **1,667 pass / 1 fail / 1 skip**. The failing test is the newly added explicit collector-structure assertion: current Web observed-only path still used `TransformStream` instead of the previously proposed `getReader() → Blob(chunks)`; no browser source revision failure, crash or network-cancellation failure was reported. The same CI n=3 synthetic 16 MiB/64 KiB comparison measured **native `response.blob()` 5.338 ms median**, observed TransformStream **10.992 ms median**, with individual native [5.338, 5.583, 2.659] ms and observed [21.857, 7.132, 10.992] ms. This is another high-variance in-process Node workload (not a real browser, decoding or Agent) and cannot establish a precise 2× production slowdown or speedup. [Exact machine record](performance-evidence/media-shared-progress/ci-run-37933504811-transform-before.json).

**Candidate replacement:** only on observed requests, use a request-owned `ReadableStream.getReader()`, ≤10 UI progress notifications per second and final, and `Blob(chunks)` instead of an extra `TransformStream` and `Response` pipeline. Without a subscriber, keep existing native `response.blob()`. Retain original authenticated fetch, signal, revision fence and HTTP cache behavior. Update source and source-contract test in the same one-work-commit branch, then measure new helper with the identical n=3 fixture and full CI. **Do not declare a speedup** until actual Chromium/Gin and Desktop Agent same-fixture timings, CPU and peak memory are measured and meet frozen budgets; no automatic cache/index or durable Task Center changes are authorized.

### P0-C observed-only reader first native compatibility gate and pending browser A/B (2026-10-09)

[PR CI 37934247525](https://github.com/lazyxu/xdrive/actions/runs/37934247525) on `20e652709767dffa415e953d64786d0456aea578` replaced the extra `TransformStream→Response.blob()` pipeline with a request-owned `getReader()→Blob(chunks)` while preserving the no-observer native `response.blob()` fast path. **Desktop tests 1668 passed / 0 failed**. The identical Node 22 synthetic 16MiB/64KiB n=3 workload reported native **10.562ms** median [10.148,20.967,10.562] and observed direct collector **8.761ms** [17.724,8.761,7.703]. [Raw exact samples](performance-evidence/media-shared-progress/ci-run-37934247525-reader-first-red.json). These short, variable samples do **not** establish real Web/Agent CPU, peak RSS, decoded-paint or 100k speedup.

**First source-exact Web build failed TS2345**: `Uint8Array<ArrayBufferLike>[]` is wider than DOM `BlobPart[]`. The response reader emits ordinary `ArrayBuffer` byte chunks, so the candidate narrows the chunk-array type to `Uint8Array<ArrayBuffer>[]` and explicitly narrows each pushed fetch chunk without allocating a second payload copy. This is a TypeScript DOM declaration fix, not a measured production performance optimization.

**New named native browser gate:** branch-scoped `media-shared-progress-chromium` runs the actual checked-in Web helper in Electron Chromium against 16MiB loopback HTTP, native Blob vs observed reader alternated for 5 independent measured runs per mode after 2 warmups. It records response integrity, emitted progress bytes/count, transport request count, renderer CPU ticks and 5ms-sampled VmRSS, plus Blob conversion and total HTTP wall time. Both source and artifacts reside in `desktop/scripts/media-shared-progress-chromium-main.cjs` and `desktop/media-progress-results/chromium-http-media-progress.json`. This is still **transport only, not real Gin/PostgreSQL/Agent, thumbnail decoding, 100k Gallery or physical mobile**. Sampled RSS is not guaranteed peak. Keep this job branch-scoped. Append its exact CI result and any paired native budget decision before merge; do not infer a first-paint improvement from it.

Maintain all original binary constraints: authenticated revision-suffixed thumbnail/RAW URLs, stale revision 409/no-store, no HEAD request, abort propagation and request scoped IPC events, poster-first resolution, Live first-hold, no persistent Transfer Center jobs. Full source-exact Web/Desktop CI remains a mandatory gate before Ready.

### P0-C native Chromium HTTP BEFORE: current direct reader exceeds sampled memory budget (2026-10-09)

**Measured source:** [CI 37934997271](https://github.com/lazyxu/xdrive/actions/runs/37934997271), work commit `90425540b370d718b2c214b3be211ba4869d59c5`, actual Electron 44 / Chromium 152 loopback HTTP, source-exact `web/src/mediaBinaryProgress.ts` transpiled without altered logic. Fixed 16MiB object emitted in 64KiB chunks; five measured samples/mode, two warmups/mode, alternating native `response.blob()` and opt-in `getReader()→Blob(chunks)`. All **14/14** requests fully completed; 234,881,024 source bytes, no premature close, reported bytes equal true Content-Length.

| Metric (median, n=5) | Native Blob (BEFORE) | Direct observed reader (current candidate) |
| --- | ---: | ---: |
| Collector wall time | **57.9 ms** | **23.4 ms** |
| HTTP headers through complete Blob | 60.0 ms | 25.5 ms |
| Renderer CPU ticks (coarse 10ms ticks) | **1** | **3** |
| 5ms-sampled renderer RSS growth | **28 KiB** | **33,996 KiB** |

[Permanent raw browser/HTTP/renderer sample evidence](performance-evidence/media-shared-progress/ci-run-37934997271-chromium-before.json). **Decision: REJECT direct-chunk retention at this 16MiB observed-response workload pending a lower-memory alternative.** Although the candidate finished faster in this local measurement, its sampled RSS grew by ~33.2MiB, exceeding the previously frozen additional-memory 32MiB allowance and requiring approximately three CPU scheduler ticks instead of one. The faster observed wall time does not prove a product speedup: Chromium Blob internal buffering, scheduling and GC differ. Peak RSS is approximated at 5ms, not an exact high-water peak. This benchmark is not the signed Gin/PostgreSQL/CAS or Agent/IPC 100k pipeline and is not image decode/paint evidence.

**Next experiment (no production reader change yet):** run a branch-scoped **four-arm, same fixture** native Chromium comparison: `native`, current direct reader, a single `ReadableStream` bridge that feeds native `Response.blob()` while counting bytes, and the original `TransformStream` observer. The latter two are measurement-only reference implementations, not shipping code. Keep the current production candidate Draft and do not merge with the 16MiB memory regression; select only a candidate with materially better browser RSS/CPU and truthful progress without new HTTP requests or losing abort/revision behavior. Revalidate selected source with full PR CI, Viewer/Inspector HTTP abort and actual Web/Desktop adoption before updating acceptance.

### P0-C four-arm native browser decision (2026-10-09)

[GitHub CI 37936088859](https://github.com/lazyxu/xdrive/actions/runs/37936088859) ran a branch-scoped **four-arm actual Chromium 152/Electron 44 HTTP benchmark** with the same 16MiB object, 64KiB chunks, 2 warmups + 5 measured trials per mode, rotated ordering, per-request byte-integrity checks and 5ms-sampled renderer VmRSS. All **28/28** HTTP responses completed; 469,762,048 source bytes and zero premature closes. [Permanent complete sample JSON](performance-evidence/media-shared-progress/ci-run-37936088859-chromium-four-arm.json).

| Collector (n=5 P50) | Wall ms | CPU ticks | Sampled RSS growth KiB | Decision |
| --- | ---: | ---: | ---: | --- |
| Native `response.blob()` | 13.5 | 0 | 28 | No-observer fast-path baseline |
| Existing observed direct `getReader()→Blob(chunks)` | 22.4 | 3 | 34,216 | **REJECT**: exceeds +32MiB memory cap |
| `ReadableStream` bridge prototype | 39.6 | 3 | 16,520 | Not chosen: more CPU at similar wall/RSS |
| `TransformStream` prototype | 39.4 | 2 | 17,008 | **SELECT for production revalidation**: less CPU than bridge and below memory cap |

**Engineering decision:** switch only the observed streaming branch to the measured `TransformStream→Response.blob()` collector, retain no-subscriber native Blob, and retain current authenticated revision/409/ETag behavior. This is a functional visibility feature with a measured transport cost, **not a net first-paint speedup**: the TransformStream measured roughly +26ms and +17MiB sampled renderer RSS versus native for this 16MiB loopback fixture. Native image thumbnails are ordinarily smaller, but no representative real decoded-image A/B is established yet. Do not invent improved throughput numbers from Node prototypes or claim Desktop Agent parity from Chromium HTTP.

**Bounded subscription correction:** shared Gallery thumbnail prefetch with zero visible progress consumers must call its underlying fetch with *no observer* and keep the native Blob fast path. Real visible Tile subscribers carry their own AbortSignals and are released promptly on unmount; one Tile's abort does not abort a shared task still owned by another Tile. The existing six active task, 512 cached URL, revision-fence and viewport retention policies remain unchanged. Dedicated regression tests check shared progress fanout, per-consumer unsubscribe and zero-observer transport selection.

**Final release gates:** rerun the selected source-exact native Chromium benchmark with its 32MiB *additional sampled renderer RSS* rejection threshold, full Web/Desktop/Go CI and existing Viewer/Inspector server-observed real HTTP abort tests. Separately, obtain a paired actual Gallery/FileExplorer 10k/100k first-image-decode/paint + Desktop Main/Agent IPC test before declaring the full P0-C end-to-end performance objective met. Browser n=5 CPU ticks and 5ms RSS are diagnostics with unavoidable variance; they are not equivalent to exact peak RSS or a physical-device test.

## P0-C follow-up — 100k real Web Gallery progress ON/OFF paired first-paint test (2026-10-09)

**Status: Benchmarking — measurement-only PR; no new production transport, media cache, Player or index changes.** Dependency [PR #1163](https://github.com/lazyxu/xdrive/pull/1163) has merged the shared Web/Desktop loading/progress feature after source-exact full green CI. Its production collector retains the no-observer native `Response.blob()` path, revision-safe thumbnail/RAW fetches and bounded optional byte observers. The branch-scoped 16MiB Chromium HTTP comparison showed observer-only TransformStream receives genuine bytes but consumes measurable latency, CPU and resident memory; those numbers alone are not a 100k Gallery first decoded paint or Desktop Agent result.

**BEFORE (historical non-paired, benchmark #1156):** 100,000 logical PhotoAssets / 115,000 physical nodes / 15,000 Live Photo groups, 3 fresh Electron Chromium Web runs against actual PostgreSQL 17, authenticated Gin, local CAS JPEG derivatives and Gallery `VirtualCollection`. [Raw #1156 CI 37925995257](performance-evidence/gallery-web-real-cold-100k/ci-run-37925995257.json): navigation→first visible decoded image paint **1,524.9ms P50**, navigation→first twelve decoded images **1,701.9ms P50**, first range GET **984.4ms P50**; first 12 means 12 elements, **not the full viewport**. This old harness used `response.blob()` directly, so it **never exercised the new P0-C progress reader**. Its original Long Tasks already exceeded 100ms in each recorded sample. Do not attribute these existing Long Tasks to progress.

**New same-runner paired BEFORE/AFTER:** the existing `GalleryRealColdPerformanceHarness` will now use *the checked-in* `xDriveMediaResponseBlob(response, signal, observer)`, not a separate fake collector. Run **three matched ON/OFF pairs (6 independent cold-start 100k fixtures)** on the same GitHub Linux runner in alternated order `OFF→ON / ON→OFF / OFF→ON`; each mode reseeds PostgreSQL/CAS in a new Gin test process and opens a fresh isolated Chromium partition. **OFF** intentionally passes no byte observer, invoking the production native Blob fast path; **ON** passes visible thumbnail subscribers, counts actual progress callbacks and checks that the last observed byte count equals each received Blob size. ON requires >0 observed requests, events, completed transfers and actual reported bytes; OFF requires zero for all four. Absent/invalid byte progress, a missing twelfth decode or >=1000 mounted tiles fails the benchmark.

Each run captures first content, first HTTP range, first byte/thumbnail response, decoded/presented first image, twelve decoded frames, thumbnail GET count/bytes, renderer working-set KiB, Long Tasks and CAS accounting. Persist the six raw samples and per-pair deltas to `desktop/gallery-real-cold-results/summary.json`; CI artifact retained seven days. This is a real renderer + Go HTTP/DB/CAS media workload, but does not include Desktop Main/Agent, WAN, actual phones, original large video codecs, or folded duplicates.

**Frozen acceptance (no relaxation after seeing data):** ON P50 navigation→first decoded paint <=2000ms; reject a repeated matched P50 regression exceeding **both 100ms and 10%** of OFF P50, an extra median renderer working-set cost exceeding **both 32MiB and 25%** of OFF, >25% plus two thumbnail GETs, or >30% plus 64KiB of thumbnail payload. No extra thumbnail HEAD or original-video fetch may be introduced. Long Task samples remain diagnostic because the historical baseline already violated a 100ms provisional gate. Missing memory measurements fail rather than silently passing. These are structural performance and resource budgets, **not evidence that ON should be faster**.

**CI:** reuse the existing `gallery-web-real-cold-100k-performance` job on both GitHub and GitLab, triggered by dedicated branch `perf/gallery-web-real-cold-100k-media-progress` using its already-supported branch prefix. No new global CI job or duplicate 100k harness. CI must finish and its exact raw AFTER / paired samples be committed to this document and `docs/performance-evidence/gallery-media-progress-100k/` before the final source-exact CI and merge. If ON fails a frozen budget, preserve failure evidence and mark this benchmark **Rejected / regression identified**, requiring a separate minimal production optimization with another same-fixture test; never claim complete P0-C 100k acceptance prematurely.

### P0-C paired real 100k Web first decode AFTER — Accepted in the measured scope

**Measured work commit:** `79453a4f237091003487978761bf600bc7a69976`, [GitHub CI 37943916427](https://github.com/lazyxu/xdrive/actions/runs/37943916427), real PostgreSQL 17 + authenticated Gin + local CAS + built Web Gallery/Chromium, **three ON and three OFF** independent 100k/115k/15k-Live cold samples, same CI host, ON/OFF order alternated by pair. The [six full machine rows, all store accounting, per-pair deltas and frozen gate results](performance-evidence/gallery-media-progress-100k/ci-run-37943916427-paired.json) are durable evidence. The original #1156 1,524.9ms first-paint P50 came from **another CI runner, before P0-C**; do not treat the difference against it as an A/B regression.

| Same-runner median (n=3/mode) | BEFORE: native Blob, observer OFF | AFTER: real progress ON | Delta (ON minus OFF) |
| --- | ---: | ---: | ---: |
| Route → first decoded image + paint | **1,701.1 ms** | **1,693.3 ms** | **−7.8 ms (−0.5%)** |
| Route → first 12 decoded image elements | 1,914.6 ms | 1,958.7 ms | +44.1 ms (+2.3%) |
| First item-range Gin HTTP | 1,007.8 ms | 1,021.0 ms | +13.2 ms (+1.3%) |
| Thumbnail requests | 19 | 21 | +2 (+10.5%) |
| Thumbnail response bytes | 333,141 B | 382,703 B | +49,562 B (+14.9%) |
| Renderer working-set snapshot | 235,848 KiB | 237,848 KiB | +2,000 KiB (~0.85%) |
| Longest Long Task | 142 ms | 147 ms | +5 ms |

**Matched pair first-painted-image deltas:** sample 1 **−7.8ms**, sample 2 **−14.2ms**, sample 3 **+27.3ms**; paired median **−7.8ms**, no repeatable >10% AND >100ms loss. ON samples reported respectively **30, 31 and 31** actual byte events, each with **15 fully reported media Blobs**, sum **382,703 B**, zero progress errors; OFF had zero observer events and used the original Blob fast path. Every run decoded >=12 real JPEG image elements, all mounted Tile counts =63 (bounded vs 100k), and returned real authenticated database/CAS resources; the two modes used identical fixture shape and no additional HEAD request. The variation from 19–20 OFF versus 21 ON thumbnail GETs and 333,141–358,923 B OFF versus 382,703 B ON remains within the predeclared I/O guard; do **not** interpret those counts as a causal speedup or extra-payload guarantee at other scroll positions.

**Frozen gate decision: ACCEPT the deployed optional byte observer for this real 100k Web cold first-visible workload.** ON first visible 1,693.3ms P50 <=2,000ms provisional budget; paired performance gate, >25% AND >32MiB snapshot budget, request and byte ceilings all pass. There is no material first-paint improvement to claim, only **no detected material regression** on this workload. Long Tasks of both modes exceed 100ms, already present in the earlier unobserved baseline and not fixed or excused by P0-C. RSS is a renderer working-set point measurement, **not process peak RSS**. The CPU cost still comes from the separate 16MiB Chromium collector comparison, not this UI fixture.

**Remaining out of scope:** genuine Desktop Main→Preload→Agent IPC progress-event A/B (the distinct merged Desktop #1171 n=3 cold first decoded paint P50 ~1,793.6ms is a baseline, not paired P0-C), real 4K/HEVC video Range, Live Photo motion first-press network/hold sequence, 10k/100k rapid scrolling cancellations with real upstream context, duplicate folding ON and physical iOS/Android acceptance. No new production cache/index/player is justified by these Web numbers.

**Delivery workflow:** preserve the matched first-acceptance sample raw JSON and this canonical table in the same single work commit, rerun full GitHub PR CI on the evidence-amended exact head, then linear-merge and branch-clean per AGENTS.md. No time/throughput or memory claim beyond the named source, scale and measurement boundary.
