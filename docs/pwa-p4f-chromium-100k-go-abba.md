# PWA P4F · Genuine 390px Chromium Owner 100k BEFORE/AFTER (A-B-B-A)

Date: 2026-10-23. Follow-up to production narrow metadata-page PR [#2461](https://github.com/lazyxu/xdrive/pull/2461) and earlier real SQL [P4C #2453](https://github.com/lazyxu/xdrive/pull/2453), [P4D #2458](https://github.com/lazyxu/xdrive/pull/2458). Tracking [#2260](https://github.com/lazyxu/xdrive/issues/2260).

## Reproducible immutable comparison

The two genuinely compiled Go API releases are pinned to the **direct parent/child** production P4E pair:

- Original Go A: 81ef48612bb8140016b9b1690249588ac8a27688.
- Narrow-page Go B: dba1a9d25d1c13f5e986bce4f29cbb76d3ed9fd4.

The test verifies exactly five changed source paths, confirms their parent-child relation, and verifies byte-identical Web/UI and existing P4A/P4B harness source. One frozen **production Vite Web** bundle from A is used for both compiled Go variants. Other production differences are not allowed.

The existing authentic P4A driver launches real Chromium at **390×844, touch**, real Gin/PostgreSQL17/LocalCAS Owner 100k logical/115k metadata fixture, and two separate real Chrome OS PIDs sharing one persistent browser profile. It visits the top, 50% and 95% virtual-grid viewport, and waits for four visible Blob-backed image decodes plus two actual requestAnimationFrame calls. P4B ResourceTiming categorizes browser-visible same-origin API timing without persisting URLs or media identity.

The workflow runs **A1 → B1 → B2 → A2** on the same GitHub runner. Each run has three separate synthetic Go/PG/CAS fixtures and uses an independent clean PostgreSQL database to avoid accumulating Owner rows across variants. There are 12 total seeded Go fixtures, 24 Chromium OS processes, and 36 viewport pairs across all four runs (each pair = first process + restart process). This does not mean all 115k physical media bytes have been decoded; the accepted visible fixtures and verified CAS resources are a bounded, production-shaped sample.

## Acceptance contract

The test preserves existing P4A constraints: complete 100k/115k synthetic Owner fixture, only bounded mounted grid tiles, four visibly decoded true Blob images, same-origin ResourceTiming, Go handler maximum six concurrent requests, maximum 256 MiB Go RSS growth, public CacheStorage free of private media, no private persistent Blob cache, distinct browser OS PIDs, and identical per-run Web source.

The anonymized summary measures deep first-visible P50/P95, deep restarted P50/P95, aggregate 0/50/95% P50/P95, browser CPU TaskDuration, source-observed API TTFB, last-thumbnail dispatch, Go requests/response body bytes, and peak Go RSS. It compares original versus optimized Go versions on one runner and fails on substantial deep P95/CPU/RSS regression. It also demands at least a **5% deep visible P50 improvement** in first-process or post-restart real browser time before calling the candidate materially beneficial in this fixture. If it does not improve, the specialty CI must be RED; do not report the earlier 60% SQL gain as an end-to-end PWA benefit. No budget adjustments are allowed merely to turn a negative result green.

All persisted artifacts are **fixed numeric labels and release SHAs only**; never archive Go raw logs, HTTP URLs, JWTs, Owner/media IDs, files, images, EXIF, GPS, profile paths or raw browser traces.

## Scope and limitations

This is a new test-only PR: no production Go, Web, Service Worker, database schema or cache policy changes. A native Chromium/Linux CI PASS is **not** an installed iOS27 Home Screen or Android PWA PASS. ResourceTiming TTFB mixes queue/server/network, and the two rAF points are not a direct raster/GPU paint measurement. The sampled original physical CAS bytes are not all 100k independently decoded originals, and genuine native process suspension/Android/iOS installed S5 remains NOT RUN.

The P4F PR requires this exact-head genuine A-B-B-A specialty and full Web/Desktop/Go Linux/Windows/API Race/Final Gate. If master moves, preserve other Owner code and rerun exact-head CI before merge. The product P4E PR remains separately governed and must not be called complete solely because P4F was created. Inaccessible production-only safety acceptance is **按用户决定跳过（未验收）** and never blocks code-level tests/merge; source Owner/ACL/Cancelled-Request tests must remain mandatory.
