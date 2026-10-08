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
