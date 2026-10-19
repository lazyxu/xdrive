# Public Share navigation / first-read visual stability (UI-Share-Q1)

## P90 · no transient public share/folder overlay (2026-10-19)

- The older Q1 change delayed a spinner to 300ms, but **ordinary share metadata and folder navigation** should never insert a visual loading frame, regardless of GET duration. The real authorized Server API request still starts immediately; the same 180px `aria-busy` first-read slot is silent before, during and after a held >350ms read. A verified folder retains its accepted path, rows, fixed content geometry and pager throughout the next directory GET; on failure it keeps those rows and a genuine actionable error. On success only the matching current Server response replaces the page.
- Remove both `PublicShareView` decorative 300ms timers and absolute pending overlays, not the real GET/AbortSignal. The first user-invoked Browse button keeps the same label and is disabled with truthful `aria-busy` on its fixed parent (the shared `XDriveActionButton` has no `aria-busy` prop); actual download progress stays visible. Existing 100-item bounded paging and 404/410, password/eligibility, native-download ticket, cancellation remain unchanged.
- Extend **original mounted React** `desktop/tests/web-public-share-form.cjs` to hold the first GET and first folder/child GET >350ms, assert silent geometry/one old page, failure+retry, then accepted new page. Keep `desktop/tests/web-public-share.cjs`, optional built Chromium public-share acceptance and the permanent P78/P88 tests. Require complete accurate-head 77+ CI/Final Gate and fresh GitHub clean before Ready/Rebase; actual iOS Safari/Android/installed PWA, WAN CLS/FPS/physical 100k still **NOT RUN**. No Server/thumbnail/performance/race contract change.


**Scope / 2026-10-18:** Public capability-link view only, separate from the in-flight P54 Gallery and P56 Mobile Files status changes. Keep current Web hash token routing, Server anonymous capability API, native short-lived download ticket and shared AuthPanel/form unchanged.

## Original source defect

`web/src/PublicShare.tsx` mounted `{loading && <XDriveStatePanel ... message="正在加载分享…" />}` immediately on every cold public-share URL GET. When the metadata response completes in a few tens of milliseconds, the interim progress panel appears and disappears inside the normal form flow, producing unnecessary vertical movement and two UI transitions before the actual share. It is not thumbnail/video or user-initiated download progress.

## Scoped correction

- The real `api.publicShare(token)` request still starts immediately. Reuse the established shared **300ms visual-only** `useXDriveDeferredPendingLoading`; short reads remain quiet while genuinely slow reads get feedback.
- Keep a first-paint **180px minimum-height** slot around real share metadata/error/download controls. A delayed progress element uses absolute, pointer-transparent positioning and cannot insert an extra in-flow row. `aria-busy` truthfully exposes the actual request from the first frame; error/404/410 states still appear immediately on response.
- Leave `App.tsx`'s `key={publicShareToken}` isolation, password entry, eligibility, native download ticket, used count and error semantics unchanged. No additional REST, cache, 100k change, Gallery thumb/poster suppression or global 52px App Frame change.

## Tests and remaining gates

- Extend the **existing mounted original React PublicShare** test harness to load the real shared deferred hook. Assert 40ms pending has no loading flash and retains the identical slot/real busy status; accepted metadata appears on completion; a genuine >350ms held request renders only one absolute overlay, then failure removes it and displays the original HTTP 404 error.
- Existing PublicShare keyboard/native-submit/download count, Web auth/brand and token-isolation contracts remain. Require NEW exact-head full 76-job CI (Web TS/lint/build, Desktop Node/Windows, Go PostgreSQL API Race, single-commit/Final Gate), clean mergeability and Ready/Rebase before release; this authored test is **not proof of CI success**.
- Native iOS Safari/Android/installed PWA, device CLS/INP/FPS and poor-WAN screenshots remain **NOT RUN**, so do not claim all cross-platform page transitions are physically certified.

## First full CI — invalid new test Promise helper, not a product failure

Original one-work HEAD `54c87b462ce4581ff93cceadb89e0d9c5edb9d0e` ran [full CI #39084587522](https://github.com/lazyxu/xdrive/actions/runs/39084587522). The genuine Desktop React suite recorded **3,062 pass, 1 fail, 1 skip**, including the NEW fast 40ms share read test passing. The one failed NEW sustained-load test called `pending.reject(...)` on the pre-existing `deferred()` test helper, which supports only `resolve`. This is an invalid test fixture setup and does **not** demonstrate a product rendering failure. Fix only that new test's rejected Promise capability, leave its original >350ms overlay/HTTP404 assertions and UI product Blob unchanged, reconstruct exactly ONE scope-only commit on the same frozen parent, and require a NEW full 76-job CI/Final Gate. The first failed run cannot authorize merge.
