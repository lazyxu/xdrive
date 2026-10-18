# P60 · Stable first Range geometry and no transient Gallery sync-folder panel

Date: 2026-10-18. Source-scoped amendment based on master `83aeb90c562d334f09e76476daff8d6635c97090`.

## Confirmed gaps

1. The shared wide `ui/shared/src/mui/FileExplorer.tsx`, used by Web and Desktop, renders **nothing** on a cold, unaccepted empty-count Range during its existing 300 ms display-only delay. On a slower authenticated GET it inserts an in-flow plain loading panel, then replaces it with actual rows. That is a redundant extra vertical layout transition. Mobile Web already fixed its analogous first-Range gap in P59 (#2018, merged).
2. Gallery's root Albums `同步文件夹` index inserted an entirely new labelled loading section after 300 ms when the accepted list was still empty; this pushed the adjacent Album organizer vertically, even though the spinner contains no verified source data.

## Scope

- Use an immediate 180px height-stable, `aria-busy` cold slot in the **existing shared FileExplorer**. Only a still-pending read after 300 ms gets the existing non-blocking status **inside** that slot. Keep verified empty and current-session errors separate; previous accepted rows remain visible on folder-to-folder navigation. No new fetch, virtualizer or request cancellation path.
- For Gallery root Albums, render the `同步文件夹` section only when the accepted `syncFolders` array actually contains folders. Never mount a transient no-data loading row. Keep the organizer's existing first-read `aria-busy`/verified-index/error contract, all original backend/Agent list actions and network cover progress. Real returned cards still arrive normally.
- Revalidate P49's original source regression and add a P60 shared FileExplorer source/first-slot regression. Existing Mobile P59 mounted React tests and P39 Gallery real Chrome cold-Range tests remain applicable; they are not a substitute for unperformed physical device validation.

## Gate and limits

One scoped PR work commit; demand **new accurate-head 76-job CI**, including Web typecheck/build, Desktop tests/Windows, Go with real PostgreSQL API Race, Rootless, artifacts, single-work-commit and final-gate, plus GitHub clean mergeability before merge. Actual iOS Safari, Android Chrome, installed PWA, live WAN/physical 100k CLS/FPS, and literal iOS27 Photos device screenshots have **not been run**. No claim of total product-wide physical acceptance.

## First exact-head CI red, scoped P50 oracle correction (2026-10-18)

- First one-work HEAD `800d18be051a8b707f2ca930bcb78b787175a1d4` ran the new [CI #39092970855](https://github.com/lazyxu/xdrive/actions/runs/39092970855). `desktop-tests` completed **3,098 tests: 3,096 pass, 1 fail, 1 expected skip**. The sole failure was an outdated *source-text* assertion in `desktop/tests/gallery-album-people-verified-index-p50.cjs` requiring the removed timer-generated `showDelayedSyncFolders` UI; it did not signal an observed People/Album runtime regression. Existing P50 mounted React runtime test passed. Do NOT reuse this red CI for merge.
- Keep the **four P60 production/test blobs from the first head byte-identical** (FileExplorer, MediaGallery, P49 test and new P60 test). Update P50 to assert the new accepted-cards-only contract and absence of intermediate spinner section. Record this failure here and in AGENTS; rebuild **one** work commit on the **same frozen master parent** and require a wholly NEW full 76-job exact-HEAD green CI plus current clean mergeability before Ready/Rebase. Preserve all other related work and physical-device NO-GO.

