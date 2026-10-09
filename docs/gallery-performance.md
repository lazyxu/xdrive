# Gallery performance

This document is the canonical performance contract for the shared Web/Desktop Gallery.

Only comparable measurements should be presented as timing improvements. Structural changes without stable BEFORE/AFTER timing are recorded as complexity-only evidence.


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

### 2026-10-09 — opt-in verified Gallery duplicate folding

The new complete-resource duplicate fold is a functionality feature, not a performance optimisation. **Default 100k asset first-paint, paging and cancellation paths are unchanged** when `fold_duplicates` is absent. In opt-in mode the Server builds a bounded-batch owner-scoped equivalence projection and folds before count/range/timeline pagination, rather than client-side hiding cards after paging (which would corrupt 100k offsets and Viewer positions). The first implementation has no measured 100k fold-mode wall-clock BEFORE/AFTER evidence; status: **unmeasured / functional validation**. Measure query latency, DB CPU and repeated page-request overhead with representative 100k data before promising performance budgets or enabling folding by default.


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
