# PWA P4C · Owner 100k Range Server SQL Phase Attribution (BEFORE only)

Date: 2026-10-23. Parent: [P4B #2446](https://github.com/lazyxu/xdrive/pull/2446), merged to master as ba4dc217. Tracking [#2260](https://github.com/lazyxu/xdrive/issues/2260).

## Source evidence and question

The genuine Chromium/Go/PostgreSQL17/LocalCAS P4B comparison observed a median ~13.25 ms scroll-to-last-media-range request start, media-range TTFB P95 frequently ~1.45–2.03 s, and median ~1597.6 ms scroll-to-last-thumbnail start; last-API completion to four thumbnails decoded plus two rAF measured ~28.55 ms (P50). These are browser-observed timings that **do not** identify SQL, queueing, a single Server phase, or browser scheduling as the cause. No causal speedup claim is supported.

## Test-only implementation

The opt-in TestPwaP4CServerRangeSQLPhases100K uses the existing real PostgreSQL17 synthetic 100k logical /115k metadata fixture (70% photos, 15% videos, 15% Live still+motion pairs) and Owner-authenticated Gin HTTP. It measures the unchanged queryMediaItemRange on three depths (0/50k/95k), repeated in three rotated-order rounds. After ANALYZE it independently times:

- media index projection probe and verified duplicate folding
- mediaItemsBaseQuery construction and the real Owner-scoped COUNT(DISTINCT node_id)
- a separate execution of production ORDER/LIMIT/OFFSET metadata page SQL for 48 rows
- first-page anchor/day timeline calculation (zero on deep pages where not executed)
- materializeMediaItems, including its **own repeated** page SELECT plus PhotoAsset/Live DTO
- JSON marshaling, the full original Range and actual authenticated HTTP response/bytes

The raw SQL, materialized rows, original Range and authenticated HTTP must agree on item order and exact total. Response Cache-Control must be no-store. A different Owner must see no items. Persisted artifacts include **only** numeric phase measurements and fixed top/middle/tail labels; no private media ID, token, URL, response contents, GPS, raw SQL or SQL bind parameters.

IMPORTANT: these phase measurements are separate executions and **overlap**. Do not add/subtract them to claim a wall-clock decomposition. The three rounds reuse **one** seeded database with rotated order, not three independent datasets. There is no real image/video/Live decoding, network RTT isolation or production/physical iPhone evidence in this Go test.

## Acceptance and dependencies

This PR changes **only** the test, its branch-specific GitHub Actions workflow and this documentation. Workflow is triggered by PR synchronization and explicitly scoped branch pushes, always checking out the immutable triggering **head SHA**, performing gofmt and compile checks and validating nine strict JSON sample rows. Require exact HEAD specialty CI **and** complete Web/Desktop/Go Linux/Windows/API Race/Final Gate success before Ready/Rebase Merge. Old green runs from #2446 or an earlier P4C SHA do not transfer.

After real measurements select the smallest Server query/DTO/index optimization and test paired n>=3 BEFORE/AFTER (same Go/PG17/CAS fixture plus browser first-visible P50/P95 and memory). Preserve Owner/ACL, response no-store, exact COUNT, anchors, cancellation and group semantics. Private persistent Blob caching and hashed-asset GC remain outside scope.

Real iOS27/Android Installed S5 is NOT RUN; inaccessible production-only safety acceptance is **按用户决定跳过（未验收）**, not a source or CI blocker. Maintain code-level Owner/ACL negatives.
