# PWA P0-C2b1 — Real mounted Gallery page-leave → Go Context.Done BEFORE

2026-10-21. This is a test-only opt-in extension of the existing 390px Mobile Web Gallery P048 native Chromium/Gin/PostgreSQL17/CAS cancellation suite. It does not change production App Frame, SW, public CacheStorage, FileExplorer, Gallery, Go handlers, or transfer semantics.

## Baseline and reproducibility

P0-A App Shell and P0-B immutable historical lazy JS compatibility/rollback have merged. P0-C0 Chromium first/warm/offline and P0-C1 genuine 100k Files/Gallery benchmark are merged. P0-C2a Files ↔ Gallery *UI navigation* fixture is in PR #2286. Its bounded stub API counts do not measure Go cancellation. P0-C2b1 below measures only another real navigation mechanism.

Set XD_PWA_P0C2_PAGELEAVE_BEFORE=1 on the original P048 actual Electron Chromium Gallery runner. Default invocation is unchanged and still runs viewport-scroll cancellation. Use the new GitHub workflow pwa-p0c2b1-gallery-pageleave-go-before.yml to run source-accurate 390×844 browser, real Go executable, PostgreSQL17, and on-disk CAS fixtures.

Each of three independent runs:
1. Seed 100,000 logical media and 115,000 metadata nodes, mount the actual compiled Mobile Web Gallery virtual grid, and prove 4–6 in-flight real JPEG HTTP requests have emitted their first 256-byte chunk. Do not call these 100,000 physical JPEG decodes.
2. Sample actual Linux Go and Electron renderer CPU/RSS, mark start time on Go's test-only probe, initiate a true cross-document same-origin BrowserWindow.loadURL to leave the Gallery. Sample the real Go HTTP context before awaiting the destination page.
3. At +160ms require for each watched GET: HTTP Request.Context().Done, context.Canceled, zero active requests, zero additional body bytes, mark-to-cancel ≤160ms; Go and renderer peak RSS growth each ≤128MiB, monotonic CPU deltas.
4. Require Gallery DOM no longer present at the destination. Probe a *different* authenticated native Gallery Range query at 50k after cancellation and check total=100k, page size=100. Archive numeric n3 JSON, exact commit/run, and explicit limitations. No user JWT, path, HAR, production file, or screenshot is stored.

The deadline and resource budgets reuse P048, not a freshly loosened gate. This PR is **CURRENT/BEFORE only** and provides no optimized AFTER result or speedup claim.

## Non-goals and remaining acceptance

This physically navigates the real Chromium document; **it is NOT the React same-document Files↔Gallery route switch**, which must be tested separately against real Go and representative 100k media in P0-C2b2. It is not a real installed iOS Safari/Home Screen PWA, not H264/Live playback, not 100k unique physical JPEG originals, not WAN, and not a durable upload/sync/ZIP cancel. Leaving thumbnails must never cancel durable server tasks.

P1 opt-in IndexedDB private read-only snapshots and P2 bounded thumbnail cache remain deferred; no user-private caching is introduced. Production-only security acceptance remains “按用户决定跳过（未验收）”; source auth/Owner negative tests and cross-platform CI still mandatory.

The single new work commit must pass its own native n3 workflow, full CI and Final Gate, then be rebased to the full latest master if necessary and pass fresh clean GitHub mergeability before merge. Do not treat a queued run or a prior source revision as accepted evidence.
