# FileExplorer performance roadmap

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
| Unsupported video-thumbnail request suppression | **Implemented** | Structural | FileExplorer only schedules image thumbnails; video files stay on icon/preview paths until a real poster-thumbnail contract exists. |
| Desktop binary thumbnail transport | **Merged** | Unmeasured wall-clock | Agent raw bytes -> ArrayBuffer -> Blob URL; base64 thumbnail transport removed. |
| Desktop warm-thumbnail Agent cache | **Accepted / Merged** | Measured structural requests/bytes | Same 200 unique x 64 KiB x 3-pass workload: upstream requests **600 -> 200 (-66.7%)** and payload **39,321,600 -> 13,107,200 B (-66.7%, 25 MiB saved)**. Wall time remains diagnostic only. |
| Adaptive infinite-scroll prefetch | **Merged** | Unmeasured wall-clock | Prefetch threshold is viewport-adaptive and protected by in-flight request locks. |
| Indexed typed-path lookup | **Merged** | Unmeasured wall-clock | One exact child lookup per path segment instead of full child-list scans. |
| Indexed folder-upload conflict lookup | **Merged** | Unmeasured wall-clock | Existing sibling lookup is indexed instead of scanning the full parent directory. |
| Desktop folder-download paged scan | **Accepted / structural contract** | Structural / unmeasured wall-clock | Recursive tree scan: legacy **1 unbounded 1,201-node response -> 3 cursor pages, <=500 nodes/response**. #788 also bounded root lookup before the exact lookup follow-up below. No wall-clock speedup claimed. |
| Desktop folder-download exact root lookup | **Accepted / structural contract** | Structural / unmeasured wall-clock | 1,201-sibling target: paged root lookup **3 requests / 1,201 returned nodes -> 1 exact request / 1 returned node**; recursive scan remains paged. |
| Web direct-to-disk downloads | **Accepted / structural contract** | Structural / unmeasured wall-clock | File System Access path writes each response chunk directly to the selected file; application-retained payload chunks change from **O(download bytes) -> O(current chunk)**. Blob fallback remains for unsupported browsers. |
| Windows hydration range-buffer reuse | **Accepted / structural contract** | Structural / unmeasured wall-clock | Synthetic 1 GiB single-callback hydration at 4 MiB/range: large response buffers **256 -> 1**; HTTP range requests remain **256**. Original `DownloadRange` API remains compatible. |
| Resumable upload chunk-buffer reuse | **Accepted / structural contract** | Structural / unmeasured wall-clock | 1 GiB path upload at 8 MiB/chunk: explicit large payload buffers **256 -> 2** across pre-hash + upload verification; stream upload **128 -> 1**. Integrity double-read/double-hash semantics unchanged. |
| Upload conflict preflight batching | **Accepted / structural contract** | Structural / unmeasured wall-clock | 120 unique upload targets: pre-transfer conflict discovery **120 sequential requests / ~240 handler DB queries -> 1 request / 1 SQL statement**; requests are capped at 200 targets and ordered single-preflight fallback is retained. |
| FileOperation ancestor coverage | **Accepted / structural contract** | Structural / unmeasured wall-clock | 120 selected sibling files at depth 8: ancestor/top-level coverage **1,200 SELECTs -> 1 recursive CTE** per check; Copy/Move/Delete semantics unchanged. |
| FileOperation total-byte aggregation | **Accepted / structural contract** | Structural / unmeasured wall-clock | 120 selected top-level directories: recursive size aggregation **120 CTEs -> 1 selection CTE**; per-item owner/revision validation remains unchanged. |
| FileOperation delete subtree summary | **Accepted / structural contract** | Structural / unmeasured wall-clock | Per delete root, execution reuses one recursive subtree query for node IDs + bytes: **2 recursive CTE statements -> 1**; trash/protection/revision semantics unchanged. |
| FileOperation subtree predicates | **Accepted / structural contract** | Structural / unmeasured wall-clock | 1,201-node source subtree: target-descendant validation **1,201 DB rows -> 1 scalar bool** across the DB/Go boundary; managed-target protection removes the intermediate **1,201-ID Go slice + 1,201-value `IN` list** in favor of one database CTE `EXISTS`. |
| FileOperation Move root-byte aggregation | **Accepted / structural contract** | Structural / unmeasured wall-clock | 120 selected sibling directories, one file each: execution-time root-byte recursion **120 CTEs -> 1 grouped CTE**; Move root loads no longer preload `xd_files`. Processed byte totals and conflict/replace semantics stay unchanged. |
| Navigation-tree pagination | **Merged** | Unmeasured wall-clock | One 200-item folder page per expansion; additional siblings are explicit load-more. |
| Search server sort + sort-bound cursor | **Merged** | Unmeasured wall-clock | name/updated/size/type are globally server-paged; renderer no longer re-sorts only the loaded subset. |
| 100k image/video media-directory traces | **Server/object-store matrix measured; renderer trace measured** | Measured structural + diagnostic timing | Real Server + PostgreSQL + `storage.Local`: cold **102 original opens / 102 derivative writes**, warm **0 / 0** with **102 derivative reads**, video icon fallback **0 thumbnail/object-store work**. Synthetic Web/Desktop renderer remains bounded at <=6 thumbnail in-flight, 110 max mounted, and 1200 peak retained. |

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
- Windows CfAPI hydration keeps the existing 4 MiB HTTP range granularity but fills one caller-owned buffer through `DownloadRangeInto` for the lifetime of each fetch callback, rather than allocating one response slice per range. The legacy `DownloadRange` API remains unchanged for compatibility.
- Resumable uploads reuse one bounded chunk buffer per pass instead of allocating a fresh 4-16 MiB payload slice for every chunk. Path uploads intentionally keep the pre-hash pass plus upload-time rehash so source mutation detection is unchanged; stream uploads reuse one chunk buffer from the first missing chunk onward.
- Multi-file and folder uploads batch conflict preflight for unique destination names, with at most **200 targets per request**. Shared orchestration consumes results in original file order, excludes duplicate destination names from upfront batching, and falls back to the legacy per-file preflight when the batch transport is unavailable or fails.
- FileOperation Copy/Move/Delete ancestor coverage is resolved by one owner-scoped recursive CTE per batch instead of walking every selected item's parent chain with one SQL query per level; missing selected nodes still fail before enqueue.
- FileOperation enqueue validates every selected root as before, then computes aggregate bytes for the already non-overlapping top-level selection with one owner-scoped recursive CTE instead of one recursive size query per selected directory.
- FileOperation delete execution resolves each active subtree once into both its node IDs and aggregate bytes, then reuses that summary for managed-source protection, share revocation, trash marking, and progress instead of recursively walking the same root twice.
- FileOperation Copy/Move target-descendant validation walks the target's active ancestor chain in PostgreSQL and returns one scalar `EXISTS` result instead of materializing the source subtree IDs in Go. Managed-source subtree protection likewise stays inside PostgreSQL as a recursive CTE joined directly to `xd_sources`, while Delete keeps its existing ID materialization because those IDs are required for share revocation and Trash updates.
- FileOperation Move obtains logical byte totals for all selected roots with one lazily executed grouped recursive CTE, then reuses the per-root totals for normal, skipped, and replace/merge progress. Move root nodes are loaded without the unused `File` preload; Copy keeps file preloads because recursive copy hooks need file metadata, and Delete keeps its subtree summary contract.
- Search queries without `/` seed matching path components, expand descendants of matching directories, and reconstruct paths/breadcrumbs only for candidates; slash-containing queries retain full-tree path matching for exact cross-component substring semantics.
- Search result sorting is server-paged for name/updated/size/type; cursors bind query/type/sort/order, and changing sort reloads the active search from page one instead of re-sorting only the loaded subset.
- Grid marquee selection coalesces pointer-move work to one animation-frame update.
- Navigation-tree expansion loads one 200-item folder page at a time; further sibling folders require explicit load-more, while the active path child stays injected even when it lies outside the loaded page.

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

Next action: after this client-side allocation fix is merged, continue the basic-path performance audit at Server upload-finalize staging/object-store I/O before considering broader concurrency changes.

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

Next action: audit Server upload-finalize staging/object-store I/O for avoidable full-file copies or duplicate reads, then continue download/sync/delete basic-path performance.

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

Next action: if very large folder downloads still show Agent memory pressure, benchmark manifest retention and child-transfer creation separately before considering a streaming manifest design.

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

Next action: continue the basic-path audit at Copy/Move recursive execution and FileExplorer upload preflight batching; only change production behavior when another deterministic hotspot is established.

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



## Current video-thumbnail capability gap

The Server media-thumbnail endpoint is currently image-only. FileExplorer now mirrors that capability instead of speculatively scheduling video thumbnails:

- `xDriveFileSupportsThumbnail()` is image-only by default.
- Grid, Inspector, and Quick Look no longer send ordinary video files through the image-thumbnail loader.
- Video files continue to use their normal video icon and the shared preview engine for actual video playback.
- The explicit `thumbnailEligible` override remains available for a future capability-aware adapter, but current Web/Desktop FileExplorer projections do not opt videos into it.

This removes the previous 415/fallback request path from video-heavy directories. A real derived/cached video-poster contract is still required before FileExplorer can offer warm video poster thumbnails.

Gallery's client-side video poster fallback remains Gallery-specific; it loads a video preview and captures a canvas frame, which is not a reusable FileExplorer thumbnail cache and should not be treated as the future FileExplorer poster contract.

## 100k media-directory benchmark matrix

### Synthetic renderer trace harness

A dedicated opt-in CI job on `perf/file-explorer-media-*` branches drives the actual Web and Desktop Chromium renderers with a deterministic **100,000-item sparse namespace**. It executes the same script on both surfaces: initial Grid mount, continuous scroll, midpoint jump, end jump, return to top, and a native Chromium mouse-driven marquee selection across the Grid viewport.

The harness records time-to-first-grid, scripted trace duration, Long Task count/duration, maximum mounted FileExplorer item nodes, maximum retained sparse metadata, thumbnail request count and peak in-flight requests, marquee duration/selection commits/selected-item peak, JS heap when Chromium exposes it, Electron renderer working-set memory, and a Chrome trace artifact.

Structural CI guards are intentionally strict while timing remains diagnostic: mounted items must stay **< 1,000**, retained sparse metadata must stay **<= 1,200**, image thumbnail in-flight work must stay **<= 6**, the warm synthetic image scenario must stay at **<= 600 thumbnail requests**, and the video icon-fallback scenario must issue **0 thumbnail requests**.

Thumbnail admission is scroll-settled: every FileExplorer scroll records activity on the real scroll host, and newly visible/near-visible thumbnail tiles wait until **80 ms after the latest scroll event** before entering the thumbnail queue. Initial/static viewport thumbnails remain immediate; continuous scrolling keeps pushing admission back, and unmounted tiles cancel their pending admission timer before any loader/Blob work begins.

This is a **synthetic renderer/thumbnail-scheduler workload**, not a replacement for the real Server/object-store matrix below. It does not claim cold thumbnail generation latency, object-store throughput, HTTP/Agent transport throughput, or real codec decode cost. Those remain pending on a real 100k dataset.

#### First successful CI renderer trace sample

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

Decision from the real Server/object-store samples: **do not change thumbnail concurrency, the 96-entry FileExplorer cache, scroll-settle timing, or video fallback.** The warm cache path removes source reads and derivative writes exactly as designed. Hosted-runner timing remains diagnostic.

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
| 100k videos | Image-thumbnail suppression / icon fallback | **Server/object-store measured; Chromium renderer + marquee measured** | Real namespace and renderer both preserve **0** thumbnail requests for ordinary videos. |
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
- Do not claim the image cases are fully end-to-end validated until the real Server/object-store fixture is connected to the Web/Desktop renderer transport. The current Server/object-store sample and synthetic Chromium trace measure complementary layers rather than one combined pipeline.

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

1. **No further thumbnail or marquee production tuning from #734.** Keep the current **80 ms scroll-settle**, **6-request thumbnail concurrency**, **96-entry FileExplorer cache**, video icon fallback, and virtual-geometry marquee implementation.
2. **Measured / accepted direction:** #739 shows a **38.28% broad-offset** and **39.52% sequential-session** reduction when later ranges stop recomputing `COUNT(*) OVER()`. Keep #739 benchmark-only.
3. **Accepted / implemented:** the production **count-once / count-free subsequent-range** contract is complete across Server -> Go client -> xdrive-agent/Electron/Web -> shared Cloud Files/VirtualCollection. Keep #739 as the decision benchmark and #750 as the production validation.
4. **Accepted / implemented:** #759 installs the #756-selected exact type expression index through Server migration. Production-branch validation reproduced a **57.26%** reduction on the repeated count-free middle range while leaving the counted first range effectively unchanged (**-0.87%**). Keep the persisted-key candidate rejected. No further FileExplorer directory-sort optimization is selected from current evidence.
5. Warm FileExplorer video posters remain blocked until the product has a real derived/cached poster contract.

Every performance change should preserve FileExplorer selection, keyboard navigation, drag/drop, rename, preview, and pagination semantics.


### Sparse logical directory surface

The FileExplorer surface can separate the logical directory item count from loaded/rendered items. Details and Grid compute scrollbar geometry from the full logical count, while only the current viewport plus bounded overscan creates render slots. Missing slots are lightweight non-interactive placeholders; the surface never allocates an array sized to the full directory. The dense compatibility path retains adaptive prefetch/load-more behavior, while sparse mode bypasses legacy bottom pagination entirely. Search remains dense until its own range contract migrates.


Before sparse runtime is enabled, item interactions must also be logical-index aware. Active item, rename recovery, marquee hit-testing, and keyboard targets resolve against loaded sparse logical indexes. Shift ranges are committed only when every logical item in the requested range is loaded; otherwise FileExplorer requests that range instead of silently selecting a partial loaded subset. Full Ctrl+A / cross-unloaded-range bulk selection remains a separate selection-model problem and must not be faked by selecting only loaded items.
