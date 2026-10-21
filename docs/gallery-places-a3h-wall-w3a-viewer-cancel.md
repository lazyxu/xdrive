# A3h-Wall W3a · Viewer Owner Cell GET cancellation

**2026-10-20 · Source-scoped stacked Draft on #2232 (W2b2), itself stacked on #2228 → #2220. No production environment requested or accessed.**

The current W2b2 Viewer loads real authorised cell pages through the existing Web Viewer Range reader but passes an independent `new AbortController().signal` for every cell GET without ever aborting it. That loses request cancellation on Viewer close, index change and account changes.

W3a keeps **one abort scope per memoized Viewer reader**, propagates its `AbortSignal` unchanged through `loadRange` → `loadGalleryRange` → `listBaiduNativeCellItems` → existing Web fetch → Go `Request.Context`; the hook disposes that reader on route/index/Owner change and unmount. Lazy page scheduling captures the exact old signal so an old microtask cannot borrow a new Owner's signal. React StrictMode cleanup/remount reactivates with a new signal and invalidates old page cache.

Focused original-source Node regression checks aborted HTTP adapter signal, fresh reactivation, independent new Viewer reader and no generic Gallery fallback. This does **not** claim measured Go `ctx.Done()` latency: it requires a separate controlled integration run. It does not yet provide native map camera selection highlight, full Desktop Agent parity, 100k physical tests or source-level third-party JS isolation. These remain W3b/C1 engineering tasks. Production-only security acceptance stays permanently skipped (unverified) under merged AGENTS rule #2227.

Do not merge until W2a/W2b1/W2b2 are merged in order; then reconstruct the W3a scoped change on complete master as one work commit and require its own exact-head CI/Final Gate and clean GitHub mergeability.

### Parent W2b2 signed Cell pagination agreement (2026-10-20)
The rewritten parent #2232 fixes the actual signed `/cell-items` limit to 100. This W3a retains that conditional Viewer pageSize=100 (other targets remain 128) and adjusts its original Owner-Abort runtime test to expect 100. Its cancellation signal is bound to the same scoped 100-item fetch and is aborted on Viewer close/route/index/Owner change; no broad `/media/items` fallback.

## 2026-10-20 · Original PostgreSQL minute-boundary CI failure

W3a HEAD `b4fb0b2` [CI #39452439834](https://github.com/lazyxu/xdrive/actions/runs/39452439834) was RED in the unrelated-but-map-specific `go-linux-api` `TestBaiduGeoconvQuotaAcrossIndependentPostgresPools`: test admitted 9 requests because its 24 concurrent requests crossed the database minute rollover at 15:56:00 UTC. Actual quota window is per PostgreSQL minute; old test incorrectly assumed it was one minute. The scoped source regression now reruns all 24 calls with fresh rows if the database minute changes, and still strictly fails any true within-one-minute over-admission (6 cap, owner 2 cap) or unexpected errors. There is no Server quota configuration/code relaxation. Full latest HEAD CI/Final Gate green is still required.
