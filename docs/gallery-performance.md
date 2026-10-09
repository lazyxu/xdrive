# Gallery performance

This document is the canonical performance contract for the shared Web/Desktop Gallery.

Only comparable measurements should be presented as timing improvements. Structural changes without stable BEFORE/AFTER timing are recorded as complexity-only evidence.

## Status index

| Area | Status | Evidence |
| --- | --- | --- |
| Timeline viewport group lookup | **Accepted / structural contract** | 100,000 synthetic date groups; a viewport near group 90,000 uses fewer than 64 indexed group reads instead of scanning from group 0. No wall-clock speedup claimed. |
| 100k thumbnail fast-scroll retention | **Accepted / measured structural** | Image/Live Photo stays unchanged at peak queue **180**, active/in-flight **6/6**. Video poster peak queue **99,997 -> 90 (-99.91%, ~1,111x smaller)** and final queue **99,997 -> 10** while real active work remains capped at **3**. Hosted-runner CPU timings are diagnostic only. |
| 100k mixed-media first open | **Accepted / measured + structural** | 70k photos + 15k videos + 15k Live Photos (115k physical media nodes / 100k logical items). Warm first range **409.147 ms median**, zero-stale refresh **212.556 ms**, UI timeline layout **2.507 ms median**; first range now commits before secondary facets. |
| 100k renderer measurement attribution | **Accepted measurement / native baseline healthy** | PR #1067 initial CI: all 36 renderer samples pass applicable timing/CPU budgets; full activation-overlapping maximum task 60 ms. Buffered totals, preparation, decode and two-rAF proxy remain distinct. No production optimization. |

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
