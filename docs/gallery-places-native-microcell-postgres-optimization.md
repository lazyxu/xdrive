# Native Places SQL microcell candidate — evidence-first optimization

## Frozen BEFORE and intended AFTER

PR #2396 measured the density-correct rank-bucket query on 100k logical
PhotoAssets / 115k MediaMetadata entries and found a real ~2.1–2.7×
PostgreSQL latency regression versus the pre-#2393 equal-angle approach.
The density-correct, paired-cover code is **the new performance BEFORE**:
`master@7fc7343655b2e76003bcffbbb550d4e16fa4acbb`.

This branch proposes a **reversible** implementation change, and its
dedicated PostgreSQL 17 A/B job compiles the original function from the
frozen BEFORE and this candidate AFTER with one identical, test-only
benchmark harness and database. No benefits may be claimed without
source-exact successful numbers.

## Candidate SQL, correctness boundaries

The prior query ranks each distinct latitude/longitude pair. The candidate
first groups one logical PhotoAsset per Owner primary metadata record into
small **0.0002-degree spatial working cells** (about 22 m north/south), with
PostgreSQL `COUNT(*)` justified by the unique
`(owner_id, primary_node_id)` PhotoAsset and MediaMetadata primary-key
constraints. It selects the first valid image cover Node in a working cell;
the exact WGS84 of **that very Node** becomes the SDK point. Video-only cells
retain genuine fallback GPS without a fake cover.

The existing server-side 8×8 rank distribution, nearest sparse-city
extremes, and maximum 64 output points remain. The native Baidu
`ClusterLayer` owns projection, zoom and on-screen clustering. Microcells
are **not** saved identities, new Owner filters, new `place:` IDs or
bounding boxes for Media Range. A cell's total is the sum of every
authorized logical PhotoAsset in it, regardless of repeated GPS. The current
query viewport and Owner predicates remain enforced before grouping.

## Acceptance rule

The original real PostgreSQL 100k fixture remains unchanged: 78k Jinhua,
17k Shanghai, 5k New York, 100k logical assets, 115k media metadata rows,
one foreign Owner. For BEFORE and AFTER the workflow executes six paired
runs in B1/A1/A2/B2/B3/A3 order, each containing four equal viewports, using
the same PostgreSQL schema/ANALYZE, equal warmups and the original 3-second
query deadline. Persist all 24 raw probes and per-window P50. Verify exact
PhotoAsset totals, <=64 pins, cover-to-own-GPS pairing and API Go Race/CI.

The regression includes two video assets and one image at *different*
actual WGS84 positions inside the same microcell. The image's exact Node
and GPS must be paired with a three-photo count. Other original Jinhua,
Shanghai, New York, anti-meridian, empty bounds and Owner regressions remain.

**Keep this SQL optimization only if it produces a meaningful measured
improvement without losing genuine distinct localities or breaking the
existing regression contract. Otherwise revert the production change and
retain only validated benchmark evidence.** A source-only real PostgreSQL
test is not a physical CAS, Safari/Electron, or real Baidu network test.
Inaccessible production acceptance remains **按用户决定跳过（未验收）**.

## First scoped CI rejection and revised density boundary

The first 0.00025-degree candidate passed the 100k PostgreSQL A/B job
([#39883033865](https://github.com/lazyxu/xdrive/actions/runs/39883033865))
with 39–52% lower P50, but the independent full API Race caught a real
original Jinhua mixed-video/cover assertion failure. **That candidate was
not mergeable** even though its aggregate totals and city samples were right.
The revised 0.0002-degree working cells preserve that precise existing
representative selection, without deleting/relaxing the old regression or
changing the query deadline. All previous speed figures are therefore
historical evidence only; this revision requires new source-exact A/B and
full API Race validation.

## Source-exact 22 m candidate evidence (2026-10-23)

- The corrected 0.0002-degree candidate passed [scoped PostgreSQL CI
  #39884628865](https://github.com/lazyxu/xdrive/actions/runs/39884628865).
  The original **unaltered** `TestMediaMapOverviewRealPostgresJinhuaDistribution`
  passed in 0.64 s *before* the 100k benchmark began.
- The same 100k logical Owner PhotoAssets / 115k media rows and one foreign
  Owner were used for **24 paired timed queries** (B1/A1/A2/B2/B3/A3), with
  unchanged three-second timeout, photo-count integrity and 50 output pins in
  all populated windows. 43 selected image covers per populated window were
  independently checked against their original Node GPS.

| Real PostgreSQL 17 viewport | Baseline P50 ms | 0.0002° P50 ms | Saved time |
|---|---:|---:|---:|
| World, 100k logical assets | 895.444 | 470.855 | 47.4% |
| Jinhua dense city, 78k | 688.141 | 391.874 | 43.1% |
| Jinhua and Shanghai, 95k | 991.668 | 593.046 | 40.2% |
| Empty viewport | 34.151 | 33.741 | effectively equal |

**No failed Owner counts, sample/GPS mismatches, oversized responses or
timeouts** were observed. This source-only PostgreSQL A/B result establishes a
meaningful reduction in query latency without discarding the original
mixed-media/representative assertion. It does not claim a 100k physical media,
browser or licensed Baidu network benchmark. Preserve the full source-exact
Go API Race and final-gate requirements before merging production SQL.
