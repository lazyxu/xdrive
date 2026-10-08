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
| FileExplorer video poster cache | **Implemented / CI validated** | Structural; end-to-end cold codec timing pending | Video tiles share the bounded thumbnail scheduler. Warm reads hit the persistent 512px Server poster cache; cold Web/Desktop reads use the existing authenticated preview stream, capture one bounded frame, and revision-fenced backfill the Server cache without adding ffmpeg to the Server runtime. |
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
| Windows directory journal fast path | **Accepted / structural contract** | Structural / unmeasured wall-clock | Brand-new (revision-1) remote directory create and known-directory delete journal events no longer trigger `Client.Walk()`: **full-tree Walk fallback -> 0 full-walk requests**. Directory move/rename, restored/moved-in unknown directories, and an existing baseline directory missing locally retain full reconciliation. |
| Windows local moved-placeholder baseline index | **Accepted / structural contract** | Structural / unmeasured wall-clock | 100k baseline + 500 moved-placeholder node lookups from the existing baseline: node-path resolution **500 independent linear baseline lookups -> 1 lazy index-build pass + 500 map lookups**. Batches with no moved placeholder build no index; post-index additions retain one-scan fallback + cache. |
| Windows conflict source refresh | **Accepted / structural contract** | Structural / unmeasured wall-clock | Both live local-sync and full-reconcile overwrite-conflict recovery now restore the server winner via **1 exact `GET /nodes/:id` / 1 returned node** instead of `Client.Walk()` (**root + every directory page + whole-tree path map**). Conflict-copy upload and winner placeholder semantics are unchanged. |
| Windows full-reconcile remote-deletion pruning | **Accepted / structural contract** | Structural / unmeasured wall-clock | 1,200 flat baseline files absent remotely: remote-deletion cleanup **1,200 baseline-wide `deletePrefix` scans / up to 721,800 key inspections -> 1 baseline missing-set scan + 1,200 exact map deletes**. Missing directory subtrees collapse to one physical `RemoveAll` root. |
| Windows local-delete baseline pruning | **Accepted / structural contract** | Structural / unmeasured wall-clock | 1,200 flat local deletions: successful-delete baseline pruning **1,200 baseline-wide prefix scans / up to 721,800 key inspections -> 1 final baseline scan**; processed/deleted subtree coverage uses ancestor-set lookup instead of a growing linear prefix slice. Server DELETE cardinality/order are unchanged. |
| Windows local-change existence probe reuse | **Accepted / structural contract** | Structural / unmeasured wall-clock | 1,200 independent local-change paths: filesystem existence probes in `reconcileLocalChanges` **2,400 `Lstat` calls -> 1,200** by recording missing deletion candidates during the first pass; Server DELETE cardinality/order and 404/409 handling are unchanged. |
| Windows local file-rename baseline fast path | **Accepted / structural contract** | Structural / unmeasured wall-clock | 1,200 independent file renames in a 100k-entry baseline: prefix-wide baseline scans **2,400 -> 0**; directory rename and directory-target fallback retain subtree semantics. |
| Windows full-reconcile local-file delete baseline fast path | **Accepted / structural contract** | Structural / unmeasured wall-clock | 1,200 locally missing flat files with unchanged remote revisions: successful-delete baseline prefix scans **1,200 -> 0**; directory/type-mismatch cleanup retains subtree semantics. |
| Windows empty always-local policy fast path | **Accepted / structural contract** | Structural / unmeasured wall-clock | Default policy with a 100,000-entry baseline: `applyAlwaysLocal` baseline inspections **100,000 -> 0** when no normalized `AlwaysLocalPaths` exist; configured always-local pin/hydrate behavior is unchanged. |
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
