# P114 · Built Chromium Gallery navigation stability acceptance (2026-10-20)

## Why this evidence-only PR exists

P109/P110/P111 are source-fixed and accepted on `master`. P113 uses **real Chromium** to hold Mobile Files first Server ranges and verify no interim directory loader/jitter. Gallery / album / photo folder navigation still needs a new, full breadth, **original browser** acceptance on the same accepted platform baseline, not just static JSX tests or simulated `react-test-renderer` mounts.

This PR changes **only this acceptance document**. It does not mutate the real gallery source, component layout, UI loading semantics, Server, Go, cookies, Baidu API, uploads, thumbnails or CI rules. The existing CI already uses the branch name `test/mobile-gallery-ios27-real-chrome-p38-*` to run real compiled production Web through `desktop/scripts/mobile-web-app-browser.cjs` and upload its screenshot/`results.json` artifacts.

## Existing native Chromium evidence requested

The opt-in original CI Web job must run the base `gallery-ios27-chrome` checks and P13 / P14 / P15 / P16 / P20 / P21 / Place / P23 / P24 / P25 / P27 / P28 / P30 / P31 / P32 / P33 / P34 / P35 / P36 / P37 / P38 independent scenarios:

- Mobile/Wide viewport geometry, the 52px App Header, mounted scroll-host identity and authenticated accepted rows across route transitions
- Album folder and album-to-Library navigation, Memories, Pets, People, Places and nested Sync Folder navigation
- Trash, Cleanup, Burst review, intermediate cold index reads and error/empty correctness
- Sort, media type, index, refresh, filter, duplicate fold and time-zone change; retain old accepted photo-wall/scroll until true matching Server first Range
- Real network thumbnail/poster/Live Photo progress remains independent; never hide legitimate transfer or media request progress to mask a screen transition

**Acceptance method:** retain each original browser scenario's actual assertions, screenshots and output `results.json`. Do not weaken, remove, or stub a failing assertion to manufacture passing evidence; if original built browser exposes a real jitter, isolate its source owner and ship a separate minimal production repair plus new exact-head CI. An environment limitation is a blocker, not a passed result.

## Explicit release gates

- Frozen full `master` baseline and exactly **one work commit** containing only this document; no changes to other specialized PRs (P112 Source + Places, P113 Files navigation, A3h Gallery map).
- Full source-exact 77+ CI including PostgreSQL API Go Race, Linux/Windows, Web/Desktop, Rootless, image/installer/rollback/smoke and Final Gate; fresh GitHub `mergeable_state=clean`.
- Every actual Gallery Chromium scenario selected by the P38 branch must be visible in the Web job log and `results.json` with true success, not conditional skip. Report total checks, failed checks and which subscenario failed, if any.
- **NOT RUN** unless separately observed: physical iOS Safari, Android/PWA device UI, user production WAN and real 100k media CLS/FPS. Chromium success is not proof of all browsers.

## First genuine p38 browser CI RED and scoped corrections (2026-10-20)

The original immutable [full CI #39392606997](https://github.com/lazyxu/xdrive/actions/runs/39392606997) ran native Chromium 155 using the genuine `gallery-ios27-chrome` and P13–P38 Web scenarios. Most scenario outputs were green. **Do not claim all scenarios passed:**

- P14 `gallery-ios27-memory-nav` timed out waiting for the real memory card. The authenticated `GET /api/v1/media/memories?limit=8&time_zone=UTC&anchor_date=...` DID occur, but `XDriveMediaGalleryPage` passed `memories=[]` unless a different FULL Memory index receipt was ready. The existing bounded `warmMobileCollectionsPreview` set `memories` after a successful 8-item preview without marking a distinct accepted preview. **Real product regression**, not a timing-only fixture error.
- P33 `gallery-ios27-place-index-nav` verified DOM frame geometry correctly, but the browser fixture lacked the actual optional `GET /api/v1/media/places/baidu-jsapi/status` probe; the mock answered HTTP 501, breaking both strict no-unknown-requests and no-console-error checks. Add only a strict 200 **disabled/not_authorized** capability response, never an invented enabled Browser AK or disabled test assertion.
- The first run's independent `server-validation` job failed in a Host Manager shell fixture after downloader syntax validation, unrelated to these Gallery source files. Preserve this RED; the next exact-head full CI must run afresh. Do not patch Host/Go code in a Gallery navigation PR.

Scoped production fix adds an Owner+DataSource-specific `collectionsMemoryPreviewReceipt` that authorizes **only Mobile Collections overview's preview**, never the dedicated 48-item Memory index, and clears on account/source rotation. It retains the current accepted preview through new same-owner reads. The P14 fixture's sample is completed with the real required `kind:'recent_day'` schema. The P33 mock now provides only a strict disabled/unsigned Server JSAPI4 status while original browser negative assertions remain intact. Original 8+48 item limits, full Memory index verification, all test scenario names and assertions, thumb/poster/progress/cancel semantics unchanged. New original source contract: `desktop/tests/gallery-mobile-memory-preview-owner-p114.cjs`.

This is no longer documentation-only: four scoped paths (shared Gallery page, original Chromium fixture, new source test, original acceptance document) in exactly one reconstructed work commit on the same frozen base. Fresh full CI and all original P13–P38 Chromium scenarios MUST be green before merge; native iOS Safari/Android/PWA/WAN/100k CLS NOT RUN.
