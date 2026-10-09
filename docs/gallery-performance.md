# Gallery performance

This document is the canonical performance contract for the shared Web/Desktop Gallery.

Only comparable measurements should be presented as timing improvements. Structural changes without stable BEFORE/AFTER timing are recorded as complexity-only evidence.

## Status index

| Area | Status | Evidence |
| --- | --- | --- |
| Timeline viewport group lookup | **Accepted / structural contract** | 100,000 synthetic date groups; a viewport near group 90,000 uses fewer than 64 indexed group reads instead of scanning from group 0. No wall-clock speedup claimed. |
| 100k thumbnail fast-scroll retention | **Accepted / measured structural** | Image/Live Photo stays unchanged at peak queue **180**, active/in-flight **6/6**. Video poster peak queue **99,997 -> 90 (-99.91%, ~1,111x smaller)** and final queue **99,997 -> 10** while real active work remains capped at **3**. Hosted-runner CPU timings are diagnostic only. |
| 100k mixed-media first open | **Accepted / measured + structural** | 70k photos + 15k videos + 15k Live Photos (115k physical media nodes / 100k logical items). Warm first range **409.147 ms median**, zero-stale refresh **212.556 ms**, UI timeline layout **2.507 ms median**; first range now commits before secondary facets. |

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

Status: **Benchmarking / latest-master rerun pending**.

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
