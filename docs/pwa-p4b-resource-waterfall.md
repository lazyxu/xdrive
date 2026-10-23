# PWA P4-B · Real Owner 100k first-visible API request timing, BEFORE only

Date: 2026-10-23. Parent: [P4-A #2368](https://github.com/lazyxu/xdrive/pull/2368); issue [#2260](https://github.com/lazyxu/xdrive/issues/2260).

## Why this is needed

The unchanged P4-A physical Go/Gin/PG17/CAS fixture has 100k logical media assets and 115k distinct physical resources. Its source-exact [native #39756116252](https://github.com/lazyxu/xdrive/actions/runs/39756116252) measured nine real Chrome A→B process-restart viewport pairs. First/restart four decoded-visible thumbnails with two rAF gave P50 2849.398/2622.974 ms. Mid/deep virtual-grid jumps caused most of the delay; Chrome Script/Layout/RecalcStyle, *late* decode await, and rAF observations are not enough to attribute root cause. P4-A resource timing also aggregates overlapping requests rather than isolating individual browser-observed phases.

## Minimal implementation

Reuse the exact existing `desktop/scripts/pwa-p4a-100k-phase-attribution.cjs` and true `TestGalleryRealWebColdFixture100K`, same real Chrome separate OS PIDs and persisted profile. Add an explicitly opt-in `XD_PWA_P4B_RESOURCE_WATERFALL=1` measurement; original P4-A remains unaltered when not opted in.

For each 0/50/95% scroll, collect a `performance.now()` **same-page** scroll marker and two-rAF visible marker. For only same-origin `/api/` `PerformanceResourceTiming` entries, the browser emits **numeric timing fields and generic categories only**. An in-process, size-bounded Node summarizer reports:

- Scroll to earliest observed API resource initiation; scroll to latest *completed before visible* API response end
- Browser-observed `responseStart − requestStart` (TTFB proxy), and `responseEnd − responseStart` (transfer proxy)
- Time from last observed API completion to confirmed visible four Blob stills/two rAF
- Pre-scroll, post-visible, incomplete and missing timing counts. Missing timing remains `null`; never assign fake zero
- Per deep viewport: **last API resource start**, last network dispatch, initiation time spread, browser TTFB P95/max, and separate thumbnail / media-range latest-start and TTFB tail statistics. Report the median of viewport-level P95 values honestly, not a pooled request-level P95. This distinguishes late UI scheduling from a small number of slow in-flight requests without persisting any media identity.

**Limitations:** A ResourceTiming entry's TTFB mixes browser queueing/network/server work. Requests overlap, some entries are missing, request phases may not be the critical visible dependency, and two rAF is not raster/GPU paint. Never add the phases into a claimed end-to-end partition or treat the old P4-A run as a matched performance AFTER. This patch is a pure BEFORE instrumentation stage with `optimizationImplemented=false`, `after=null`.

## Hard boundaries and acceptance

No runtime Web/Go/Agent/Service Worker/Caddy/DB/ACL changes. No persistent private Blob cache, prefetch, new worker, SW autoactivation or resource deletion. No URL, query, media ID, token, GPS, original media bytes, private Response or browser Profile in persisted test metrics. `ResourceTiming` is filtered in Chrome itself and reduced to `thumbnail` / `media-range` / `api-other`, each row numeric only and bounded to 256. Fail closed on malformed telemetry.

New opt-in workflow `.github/workflows/pwa-p4b-resource-waterfall.yml` on this branch must execute actual independent three Go physical 100k fixtures and Chrome A/B process pairs, 3×3 decoded-visible images, real API timing and original Go constraints. All 12 deep viewport measurements must include ≥1 observed API request and ≥1 completed response before visible; original P4-A real sample, 6 concurrent Go handler and 256MiB RSS gates remain unchanged. Require exact HEAD specialty success and complete Web/Desktop/Go Linux/Windows/PostgreSQL Race/Final Gate, single work commit and GitHub clean before merge.

No claims of physical iOS 27 Home Screen, Android Installed, real WAN RTT, complete 100k distinct originals video/Live motion first frames, or product speedup. These remain `NOT RUN/NOT TESTED`. Inaccessible production-only safety acceptance: 按用户决定跳过（未验收）. Code Owner/ACL and privacy CI remains mandatory.
