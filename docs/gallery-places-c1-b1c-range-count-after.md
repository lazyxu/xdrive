# C1-PG2 · B1-C first Range Count reuse (measured optimization candidate)

**Source-of-truth BEFORE:** [C1 #2398](https://github.com/lazyxu/xdrive/pull/2398) real PostgreSQL 17 10k/100k indexed metadata, 37 foreign Owner assets, same Owner and GeoNames trusted predicates; first Range country:JP 100k warm P50 ≈1,837ms. Production SQL attribution: Count ≈544ms, timeline groups ≈641ms, first 48-item page ≈612ms (per first-call trace, not sum of production p50). Source-only baseline, not real iOS27, CAS bytes, video/Live decode or Baidu network.

## Candidate and exactness proof

For **first page only** (`offset=0`) when `PlaceHierarchy != nil`, the existing `queryMediaTimelineGroupSets` already executes `COUNT(DISTINCT xd_media_metadata.node_id)` per calendar day under the **same** Owner, live Node, photo asset, index-state, current GeoNames version, WGS84 GPS/fingerprint, album, favorite, search, sort and dedup query. Each node has exactly one captured or added date group, including `unknown`. The sum of the day group counts is therefore the global distinct item count. Remove only that redundant **first-page global COUNT** SQL, not the timeline result; keep the original Count for later pages (`offset>0`) and for all other Gallery modes.

No new indexes, caching, schema changes, thumbnail alterations, third-party map providers or altered deep links. Reject corrupt/non-contiguous group starts instead of producing a false Owner count. C1-B1 tests exercise country/region/city, known/unknown dates, UTC/Asia-Tokyo, captured/added ordering, favorite, manual album, foreign-Owner zero, and first-vs-second page Count equivalence.

## Measurement/decision

Scoped workflow `.github/workflows/places-c1-range-count-ab.yml` runs **both the complete master parent and candidate** on the same PostgreSQL 17 CI runner and Go toolchain, in BEFORE1 / AFTER1 / AFTER2 / BEFORE2 order. Each version independently recreates 10k and 100k disposable indexed Owner metadata. Existing production-function C1 benchmark saves 7 repeated warm probes, exact unique counts, SQL invocation order, and all `EXPLAIN (ANALYZE, BUFFERS)` plans.

Gate: the country and region first Range at 100k must each improve median-of-two-run warm P50 by **at least 10%**, remove exactly one physical SQL statement without altering `TotalCount`, and pass all source-exact CI/security tests. If these conditions fail or there is a functional regression, **do not merge the optimization**; adjust or revert it. Do not describe a measurement as completed before its artifacts are read.

Live production instance old GeoNames reindex counts and real iOS27/Android/Electron/Baidu visual and physical-media performance are outside this SQL experiment. Inaccessible production-only safety verification is **按用户决定跳过（未验收）**, never a blocker for code-level Owner/GPS/permission/abort tests.
