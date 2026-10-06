# FileExplorer performance roadmap

## Scope

This performance track is intentionally limited to FileExplorer across shared UI, Web, Desktop, and the server APIs it consumes. It does not include Gallery, Source synchronization, or general server tuning.

## Performance work status

This table is the durable status index for the FileExplorer performance track. A performance PR is not considered fully documented until its status and evidence are reflected here or in the measured tables below.

| Work item | Status | Measurement state | Current evidence |
| --- | --- | --- | --- |
| Sparse paged directory SQL | **Merged** | Measured | Non-empty sparse reads: **2 -> 1 SQL round-trip**. |
| Search candidate-first / sparse range | **Merged** | Measured | 100k range/cursor workloads: **2.38x to 5.67x faster** depending on access pattern. |
| Directory sort at 100k | **Measured baseline** | Measured | name/updated/size/type baselines recorded below; type is currently slowest. |
| Sparse VirtualCollection CPU at 100k | **Accepted structural baseline / no optimization (PR #708)** | Measured | Three CI CPU medians: **126.877 / 160.081 / 161.319 ms per sweep** (**50.751 / 64.032 / 64.528 us per viewport**); hosted-runner timing is diagnostic only, while structural counts are stable at **500 page loads / 800 peak / 600 final retained**. |
| Details/Grid windowing and logical-index interaction | **Merged** | Unmeasured wall-clock | Bounded mounted/retained work; no comparable end-to-end BEFORE/AFTER timing yet. |
| Thumbnail viewport scheduler + bounded cache | **Merged** | Unmeasured wall-clock | Shared viewport observer, max **6** concurrent thumbnail requests, bounded **96-entry** per-Explorer cache. |
| Unsupported video-thumbnail request suppression | **Implemented** | Structural | FileExplorer only schedules image thumbnails; video files stay on icon/preview paths until a real poster-thumbnail contract exists. |
| Desktop binary thumbnail transport | **Merged** | Unmeasured wall-clock | Agent raw bytes -> ArrayBuffer -> Blob URL; base64 thumbnail transport removed. |
| Desktop warm-thumbnail Agent cache | **Accepted / Merged** | Measured structural requests/bytes | Same 200 unique x 64 KiB x 3-pass workload: upstream requests **600 -> 200 (-66.7%)** and payload **39,321,600 -> 13,107,200 B (-66.7%, 25 MiB saved)**. Wall time remains diagnostic only. |
| Adaptive infinite-scroll prefetch | **Merged** | Unmeasured wall-clock | Prefetch threshold is viewport-adaptive and protected by in-flight request locks. |
| Indexed typed-path lookup | **Merged** | Unmeasured wall-clock | One exact child lookup per path segment instead of full child-list scans. |
| Indexed folder-upload conflict lookup | **Merged** | Unmeasured wall-clock | Existing sibling lookup is indexed instead of scanning the full parent directory. |
| Navigation-tree pagination | **Merged** | Unmeasured wall-clock | One 200-item folder page per expansion; additional siblings are explicit load-more. |
| Search server sort + sort-bound cursor | **Merged** | Unmeasured wall-clock | name/updated/size/type are globally server-paged; renderer no longer re-sorts only the loaded subset. |
| 100k image/video media-directory traces | **Planned** | **Not yet measured** | Four cold/warm thumbnail scenarios are defined below and are the next media-heavy benchmark gap. |

## Current performance contract

- Directory listing uses cursor pagination with 200 items per page.
- Non-empty paged directory reads fetch node and file metadata in one joined DB query; empty/terminal pages perform a fallback parent validation only to preserve 200-vs-404 semantics.
- Non-empty sparse range reads fetch rows and `total_count` in **1 SQL round-trip** via `COUNT(*) OVER()` (baseline: **2 SQL round-trips**, COUNT + rows); empty/out-of-range windows retain the fallback count/404 path.
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
- Search queries without `/` seed matching path components, expand descendants of matching directories, and reconstruct paths/breadcrumbs only for candidates; slash-containing queries retain full-tree path matching for exact cross-component substring semantics.
- Search result sorting is server-paged for name/updated/size/type; cursors bind query/type/sort/order, and changing sort reloads the active search from page one instead of re-sorting only the loaded subset.
- Grid marquee selection coalesces pointer-move work to one animation-frame update.
- Navigation-tree expansion loads one 200-item folder page at a time; further sibling folders require explicit load-more, while the active path child stays injected even when it lies outside the loaded page.

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
| Directory-sort 100k mixed-file fixture, name first/middle | n/a | 158.775298 ms / 193.732604 ms | Baseline |
| Directory-sort 100k mixed-file fixture, updated first/middle | n/a | 150.115920 ms / 275.943830 ms | Baseline |
| Directory-sort 100k mixed-file fixture, size first/middle | n/a | 150.348111 ms / 273.407850 ms | Baseline |
| Directory-sort 100k mixed-file fixture, type first/middle | n/a | 273.676411 ms / 422.931606 ms | Slowest current directory sort baseline |
| Desktop warm-thumbnail transport, 200 unique x 64 KiB x 3 passes | **600 upstream GETs / 39,321,600 B** | **200 upstream GETs / 13,107,200 B** | **Accepted**: **-66.7% requests**, **-66.7% payload**, **25 MiB less upstream payload**; hosted httptest wall time is diagnostic only and is not compared across layers |

### Rejected measured attempt: type expression index

A candidate type-sort expression index was evaluated on the exact same 100k mixed-file workload before adding any production index:

- index build on 100k nodes: **120.588962 ms**
- type first range: **273.676411 ms -> 274.482786 ms** (**0.3% slower**)
- type middle range: **422.931606 ms -> 420.332119 ms** (**0.6% faster**)

This is noise-level improvement with permanent write/storage maintenance cost, so the index was **rejected** and is not part of the production schema.

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

`XD_FILEEXPLORER_THUMBNAIL_TRANSPORT_PERF=1 go test -run '^TestFileExplorerDesktopThumbnailWarmTransportBaseline
## Current video-thumbnail capability gap

The Server media-thumbnail endpoint is currently image-only. FileExplorer now mirrors that capability instead of speculatively scheduling video thumbnails:

- `xDriveFileSupportsThumbnail()` is image-only by default.
- Grid, Inspector, and Quick Look no longer send ordinary video files through the image-thumbnail loader.
- Video files continue to use their normal video icon and the shared preview engine for actual video playback.
- The explicit `thumbnailEligible` override remains available for a future capability-aware adapter, but current Web/Desktop FileExplorer projections do not opt videos into it.

This removes the previous 415/fallback request path from video-heavy directories. A real derived/cached video-poster contract is still required before FileExplorer can offer warm video poster thumbnails.

Gallery's client-side video poster fallback remains Gallery-specific; it loads a video preview and captures a canvas frame, which is not a reusable FileExplorer thumbnail cache and should not be treated as the future FileExplorer poster contract.

## 100k media-directory benchmark matrix

The following four workloads are mandatory before claiming FileExplorer is validated for 100k media-heavy directories. “No thumbnails” means a **cold thumbnail cache at benchmark start**; “with thumbnails” means the same dataset with thumbnails already materialized/warm. The logical directory remains 100,000 items in all four cases.

| Scenario | Thumbnail state | Status | What must be measured |
| --- | --- | --- | --- |
| 100k images | Cold / no pre-existing thumbnails | **Planned - not measured** | first-page latency, time-to-first-grid, viewport/scroll CPU, long tasks/FPS, renderer RSS, thumbnail request count, peak in-flight, cold thumbnail latency, bytes transferred, retained metadata |
| 100k images | Warm / thumbnails pre-existing | **Planned - not measured** | same metrics plus thumbnail cache hit behavior and Blob URL memory; compare directly with cold image run |
| 100k videos | Image-thumbnail suppression / icon fallback | **Planned - not measured** | first-page/grid latency, verify **0** image-thumbnail requests for ordinary videos, long tasks/FPS, renderer RSS, and icon-fallback latency |
| 100k videos | Warm / poster thumbnails pre-existing | **Blocked - capability not implemented** | FileExplorer Server thumbnail endpoint is image-only today; measure only after a real video-poster thumbnail contract exists |

### Current assessment of the four 100k media cases

- **100k images, cold/no thumbnails:** sparse metadata and DOM work are already bounded; expected dominant costs are thumbnail generation, object-store I/O, HTTP/Agent transport, image decode, and Blob creation. Client thumbnail work must stay capped at **6 concurrent requests**, and request count must scale with viewport exposure rather than 100k logical items.
- **100k images, warm thumbnails:** generation cost is removed, isolating cached-object reads, transport, Blob URL creation, renderer commit/layout/paint, and the bounded **96-entry** FileExplorer thumbnail cache. This is the cleanest Web-vs-Desktop transport comparison.
- **100k videos, image-thumbnail suppression/icon fallback:** ordinary videos are not thumbnail-eligible while the Server thumbnail endpoint is image-only. The benchmark must verify **zero** image-thumbnail requests for video tiles, stable icon fallback, and no request growth after remount/scroll-back.
- **100k videos, warm poster thumbnails:** blocked until a real derived/cached video-poster contract exists. Do not substitute Gallery's client-side video decode/canvas capture for this workload.

### Media benchmark execution rules

- Use the same 100,000-node namespace shape, sort order, viewport, Grid size, scroll/jump script, and client build for all four runs.
- Record **cold** and **warm** states separately. Never compare a cold image/video run against a warm run and call the difference a renderer optimization.
- Keep FileExplorer structural budgets visible in the result: thumbnail requests must remain **O(viewport/scroll exposure), not O(100k)**; in-flight thumbnail work must remain at or below **6**; the per-Explorer thumbnail cache must remain bounded at **96**; sparse logical metadata must remain bounded rather than retaining 100,000 rows.
- Run both **Web** and **Desktop** for warm-thumbnail transport because Desktop uses Agent IPC/ArrayBuffer while Web uses HTTP/Blob transport.
- For the current video fallback run, assert that ordinary video tiles do not call the image-thumbnail endpoint. Once a real poster generator exists, benchmark its Server/Agent extraction time separately from renderer time.
- The pure Node VirtualCollection baseline above is a prerequisite reference, not a substitute for these browser/Electron traces.
- Until these four runs have real numbers, keep their status as **Planned - not measured** and do not claim that 100k thumbnail-heavy media directories are fully validated.

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

## Next work

1. Run and record the **four 100k media-directory traces** above: image cold/warm thumbnails and video cold/warm poster thumbnails, on both Web and Desktop where transport differs.
2. Add browser/Electron trace fixtures for directory open, continuous scroll, midpoint/end jumps, marquee selection, and thumbnail-heavy folders.
3. Use the new 100k VirtualCollection CPU baseline as the controller reference while establishing renderer CPU/long-task/RSS budgets; do not conflate the two layers.
4. Add measured render/interaction budgets to CI only after trace variance is stable enough to avoid noisy failures.
5. Revisit directory sort indexing only if a future measured workload materially exceeds the baselines above; the first type-expression-index attempt was rejected.

Every performance change should preserve FileExplorer selection, keyboard navigation, drag/drop, rename, preview, and pagination semantics.


### Sparse logical directory surface

The FileExplorer surface can separate the logical directory item count from loaded/rendered items. Details and Grid compute scrollbar geometry from the full logical count, while only the current viewport plus bounded overscan creates render slots. Missing slots are lightweight non-interactive placeholders; the surface never allocates an array sized to the full directory. The dense compatibility path retains adaptive prefetch/load-more behavior, while sparse mode bypasses legacy bottom pagination entirely. Search remains dense until its own range contract migrates.


Before sparse runtime is enabled, item interactions must also be logical-index aware. Active item, rename recovery, marquee hit-testing, and keyboard targets resolve against loaded sparse logical indexes. Shift ranges are committed only when every logical item in the requested range is loaded; otherwise FileExplorer requests that range instead of silently selecting a partial loaded subset. Full Ctrl+A / cross-unloaded-range bulk selection remains a separate selection-model problem and must not be faked by selecting only loaded items.
 -count=1 -v ./internal/client`

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

## Current video-thumbnail capability gap

The Server media-thumbnail endpoint is currently image-only. FileExplorer now mirrors that capability instead of speculatively scheduling video thumbnails:

- `xDriveFileSupportsThumbnail()` is image-only by default.
- Grid, Inspector, and Quick Look no longer send ordinary video files through the image-thumbnail loader.
- Video files continue to use their normal video icon and the shared preview engine for actual video playback.
- The explicit `thumbnailEligible` override remains available for a future capability-aware adapter, but current Web/Desktop FileExplorer projections do not opt videos into it.

This removes the previous 415/fallback request path from video-heavy directories. A real derived/cached video-poster contract is still required before FileExplorer can offer warm video poster thumbnails.

Gallery's client-side video poster fallback remains Gallery-specific; it loads a video preview and captures a canvas frame, which is not a reusable FileExplorer thumbnail cache and should not be treated as the future FileExplorer poster contract.

## 100k media-directory benchmark matrix

The following four workloads are mandatory before claiming FileExplorer is validated for 100k media-heavy directories. “No thumbnails” means a **cold thumbnail cache at benchmark start**; “with thumbnails” means the same dataset with thumbnails already materialized/warm. The logical directory remains 100,000 items in all four cases.

| Scenario | Thumbnail state | Status | What must be measured |
| --- | --- | --- | --- |
| 100k images | Cold / no pre-existing thumbnails | **Planned - not measured** | first-page latency, time-to-first-grid, viewport/scroll CPU, long tasks/FPS, renderer RSS, thumbnail request count, peak in-flight, cold thumbnail latency, bytes transferred, retained metadata |
| 100k images | Warm / thumbnails pre-existing | **Planned - not measured** | same metrics plus thumbnail cache hit behavior and Blob URL memory; compare directly with cold image run |
| 100k videos | Image-thumbnail suppression / icon fallback | **Planned - not measured** | first-page/grid latency, verify **0** image-thumbnail requests for ordinary videos, long tasks/FPS, renderer RSS, and icon-fallback latency |
| 100k videos | Warm / poster thumbnails pre-existing | **Blocked - capability not implemented** | FileExplorer Server thumbnail endpoint is image-only today; measure only after a real video-poster thumbnail contract exists |

### Current assessment of the four 100k media cases

- **100k images, cold/no thumbnails:** sparse metadata and DOM work are already bounded; expected dominant costs are thumbnail generation, object-store I/O, HTTP/Agent transport, image decode, and Blob creation. Client thumbnail work must stay capped at **6 concurrent requests**, and request count must scale with viewport exposure rather than 100k logical items.
- **100k images, warm thumbnails:** generation cost is removed, isolating cached-object reads, transport, Blob URL creation, renderer commit/layout/paint, and the bounded **96-entry** FileExplorer thumbnail cache. This is the cleanest Web-vs-Desktop transport comparison.
- **100k videos, image-thumbnail suppression/icon fallback:** ordinary videos are not thumbnail-eligible while the Server thumbnail endpoint is image-only. The benchmark must verify **zero** image-thumbnail requests for video tiles, stable icon fallback, and no request growth after remount/scroll-back.
- **100k videos, warm poster thumbnails:** blocked until a real derived/cached video-poster contract exists. Do not substitute Gallery's client-side video decode/canvas capture for this workload.

### Media benchmark execution rules

- Use the same 100,000-node namespace shape, sort order, viewport, Grid size, scroll/jump script, and client build for all four runs.
- Record **cold** and **warm** states separately. Never compare a cold image/video run against a warm run and call the difference a renderer optimization.
- Keep FileExplorer structural budgets visible in the result: thumbnail requests must remain **O(viewport/scroll exposure), not O(100k)**; in-flight thumbnail work must remain at or below **6**; the per-Explorer thumbnail cache must remain bounded at **96**; sparse logical metadata must remain bounded rather than retaining 100,000 rows.
- Run both **Web** and **Desktop** for warm-thumbnail transport because Desktop uses Agent IPC/ArrayBuffer while Web uses HTTP/Blob transport.
- For the current video fallback run, assert that ordinary video tiles do not call the image-thumbnail endpoint. Once a real poster generator exists, benchmark its Server/Agent extraction time separately from renderer time.
- The pure Node VirtualCollection baseline above is a prerequisite reference, not a substitute for these browser/Electron traces.
- Until these four runs have real numbers, keep their status as **Planned - not measured** and do not claim that 100k thumbnail-heavy media directories are fully validated.

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

## Next work

1. Run and record the **four 100k media-directory traces** above: image cold/warm thumbnails and video cold/warm poster thumbnails, on both Web and Desktop where transport differs.
2. Add browser/Electron trace fixtures for directory open, continuous scroll, midpoint/end jumps, marquee selection, and thumbnail-heavy folders.
3. Use the new 100k VirtualCollection CPU baseline as the controller reference while establishing renderer CPU/long-task/RSS budgets; do not conflate the two layers.
4. Add measured render/interaction budgets to CI only after trace variance is stable enough to avoid noisy failures.
5. Revisit directory sort indexing only if a future measured workload materially exceeds the baselines above; the first type-expression-index attempt was rejected.

Every performance change should preserve FileExplorer selection, keyboard navigation, drag/drop, rename, preview, and pagination semantics.


### Sparse logical directory surface

The FileExplorer surface can separate the logical directory item count from loaded/rendered items. Details and Grid compute scrollbar geometry from the full logical count, while only the current viewport plus bounded overscan creates render slots. Missing slots are lightweight non-interactive placeholders; the surface never allocates an array sized to the full directory. The dense compatibility path retains adaptive prefetch/load-more behavior, while sparse mode bypasses legacy bottom pagination entirely. Search remains dense until its own range contract migrates.


Before sparse runtime is enabled, item interactions must also be logical-index aware. Active item, rename recovery, marquee hit-testing, and keyboard targets resolve against loaded sparse logical indexes. Shift ranges are committed only when every logical item in the requested range is loaded; otherwise FileExplorer requests that range instead of silently selecting a partial loaded subset. Full Ctrl+A / cross-unloaded-range bulk selection remains a separate selection-model problem and must not be faked by selecting only loaded items.

- Desktop thumbnail transport baseline is measured with 200 unique thumbnails across three passes. Agent warm caching targets 200 upstream requests / 13.1 MiB payload versus the 600 requests / 39.3 MiB uncached baseline, and expired entries revalidate with ETag.
