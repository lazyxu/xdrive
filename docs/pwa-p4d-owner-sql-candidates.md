# PWA P4D · Owner 100k PostgreSQL Read-only Candidate ABBA

2026-10-23. Parent: [P4C #2453](https://github.com/lazyxu/xdrive/pull/2453). Tracking [#2260](https://github.com/lazyxu/xdrive/issues/2260).

## Problem and benchmark evidence

P4C real PostgreSQL17 100k Owner range identified median stale projection probes ~352–360 ms, COUNT(DISTINCT) ~127–131 ms, and deep page ORDER/LIMIT/OFFSET ~366–393 ms. First-page timeline aggregation ~304 ms. The phases were separately re-executed and overlap; they cannot be summed to reconstruct browser TTFB, nor do they establish a unique root cause.

## Experimental design; production unchanged

Opt-in TestPwaP4DOwner100kReadOnlyQueryCandidates uses a real PostgreSQL17 100k logical/115k-media synthetic Owner fixture, the same production-shaped joins and sort, and three rotated viewport depths (offset=0/50000/95000), each with one balanced A-B-B-A comparison repeated three rounds:

- A: the unchanged Owner-filtered sorted SELECT of 48 full MediaMetadata rows, including EXIF, video, timestamps and revisions.
- B: the identical Owner-filtered sorted SQL selecting only the 48 Node IDs, followed by a second explicitly Owner-filtered query to load precisely those 48 rows; restore original page order. Compare entire native Go structs with A and with the repeated A/B outputs. **Any mismatch is a test failure.**

Additionally compare ordered staleMediaNodes(limit=1) vs read-only unordered SELECT 1/LIMIT 1 under the same Owner stale predicate. Both must return no stale items on the 100k indexed fixture and must immediately detect a newly inserted Owner file missing metadata. The second Owner must never see that file. No caching, local revision authority or unsafe invalidation.

Measurements are descriptive for one synthetic fixture, not independent cross-host samples. The candidate performs two SQL requests versus one and may be slower; it is not enabled in product code. All output is bounded anonymous timing/count data and fixed viewport labels, with after=null, optimization_implemented=false and causal_conclusion=NOT_ESTABLISHED. Never persist media identifiers, tokens, GPS, SQL binds, private HTTP bodies or paths.

## Delivery boundaries

Only test source, branch-scoped CI, and documentation change. Do not alter production Go, Web/Mobile, Service Worker, auth, local source, or hashed asset retention. Test requires exact-head real PostgreSQL17 specialty plus current full Web/Desktop/Windows/Linux/Go API Race/Final Gate before merge. A newer master requires a new exact-head pass; do not inherit a previous commit's CI success.

After actual A-B-B-A numbers, reject unhelpful candidates, or implement the smallest source patch behind tests and run real same-fixture n>=3 BEFORE/AFTER including current count, anchor/Viewer returns, Go cancellation, Owner ACL and memory, plus genuine native Chromium PWA first-visible. Inaccessible production-only acceptance remains 按用户决定跳过（未验收）; physical installed iOS/Android remains NOT RUN.
