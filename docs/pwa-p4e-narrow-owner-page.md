# PWA P4E · Owner-scoped narrow Gallery range (production candidate)

Date: 2026-10-23. Evidence: [P4C #2453](https://github.com/lazyxu/xdrive/pull/2453) and [P4D #2458](https://github.com/lazyxu/xdrive/pull/2458); tracking [#2260](https://github.com/lazyxu/xdrive/issues/2260).

## Exact production change

The existing `mediaItemsBaseQuery` is unchanged, including Owner, album, place, duplicate folding, filters and all sort clauses. Only `materializeMediaItems` replaces the single wide `MediaMetadata` ORDER/LIMIT/OFFSET with:

1. the same Owner-filtered and sorted query projecting only up to 500 `xd_media_metadata.node_id` values;
2. a second, explicitly Owner-scoped rehydration of the selected full metadata rows, restoring original sort order.

Node/PhotoAsset/Live Photo presentation, Count, timeline groups, initial latest positioning, Viewer anchors and private Cache-Control remain in the existing path. Both SQL operations respect cancellation; a concurrently missing row is omitted, never substituted from another Owner. No new index, schema, cache, Service Worker behavior, private Blob persistence or historical hashed-asset GC.

## Acceptance and evidence boundaries

P4D's real PostgreSQL17 100k synthetic Owner A-B-B-A found a 58–60% reduction in page SQL cost with exactly equal native metadata and ordering at top/middle/tail; this **does not** imply whole-HTTP or whole-PWA gain.

The P4E opt-in real 100k test runs the actual optimized `queryMediaItemRange` and compares it with frozen original full-row SQL in three rotated A-B-B-A cycles at 0, 50000 and 95000. Equal complete `MediaMetadata`, 100k Count, 48 DTO records, sort/filters, real loopback authenticated HTTP, empty cross-Owner Range, no-store response and cancellation are mandatory. It separately retains P4D's live inserted-unindexed-file and other-Owner negative for future stale-probe work; the production stale probe is **not** changed. Uploaded artifacts contain numeric measurements and fixed labels only.

The specialty job demands a significant same-fixture SQL improvement without loosening security or correctness; the full cross-platform Web/Desktop/Go Linux/Windows/real PostgreSQL API Race/Final Gate must also succeed on the exact HEAD before merging. Product HTTP/Chromium BEFORE/AFTER, video/Live frame timing, CPU/RSS and cancellation resource profile still require a matched browser gate. Until then, keep Draft and do **not** claim completed 100k PWA speedup; `after=null` refers to that outstanding product-wide measurement.

Physical iOS/Android installed S5 stays NOT RUN; production-only inaccessible safety acceptance is **按用户决定跳过（未验收）** and does not block source/CI.
