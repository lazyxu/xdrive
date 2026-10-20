# P107 · Mobile Web saved-folder resume: no transient bootstrap root

## Original source defect · 2026-10-20

Original `web/src/MobileFiles.tsx` treated fulfillment of `onRestoreFolder(id)` as navigation success and immediately called `setBrowseHome(false); setReady(true)`, independently of a current counted first CloudFiles Range. `WebFileExplorer.restoreMobileDirectory` discarded the existing `navigateTo(..., onAccepted)` receipt and returned `Promise<void>`, so a failed/superseded navigation could appear to succeed. While resuming a saved folder, any already populated **bootstrap root** could also be briefly displayed under the old folder's title or group headings. Correct final screenshots would not capture these intermediate frames.

## Exact product changes

- The existing Web `restoreMobileDirectory` now returns an authenticated current navigation acceptance Boolean from the existing `navigateTo(..., onAccepted)`. It does not add another API, request, virtualizer, timer, route, or Server action.
- The saved-folder restore is scoped by account/storageKey + folder + navigation intent. Finishing the Promise is NEVER a visual commit. The original pre-paint Mobile Files layout effect accepts only matching current target crumbs, first counted sparse Range, and actual directory-Owner GET completion. Never reset the saved folder's original scroll offset as if it were a new navigation.
- During cold restore, the original one virtual scroll host projects **zero bootstrap root rows and zero bootstrap group headers** in its silent reserved 180px region. Suppress the wrong provisional directory title, a fake empty/error and the 300ms decorative loading chip. The real requests, thumbnails, sparse 100k Range, search/trash, durable operations and cancellation remain intact.
- A genuine failed **current** restore may return to Browse Home. Old failures/successes cannot erase a saved folder, steal Recent/Favorites or replace a newer navigation. Deliberate navigation away abandons the cold restore presentation; returning to Browse shows usable Home rather than an eternal silent slot. Reusing a StrictMode task requires the same account, folder and intent.

## Original mounted regression

Four new tests are appended to the pre-existing `desktop/tests/mobile-files-ios-runtime.cjs` actual Mobile Files React harness:
1. A populated initial bootstrap root is silent during a saved-directory pending request, including a held >350ms GET and even after a success Promise without a corresponding first Range; single scroll host, no wrong title, no fabricated loading/error or root rows.
2. A verified counted zero for the actual saved folder reveals the correct content without corrupting its saved 688px anchor or inserting an intermediate spinner.
3. Both stale accepted and stale rejected receipts remain on the user's newly selected Recent rail, and returning to Browse does not strand the app; a genuinely current rejected restore falls back once.
4. The actual Web accepted callback, P107 `AGENTS.md` permanent contract, shared original virtualizer and independent media-thumbnail handling remain.

## Acceptance and limits

Run the unchanged original mounted/Browser suites and full exact-head 77+ CI, including real PostgreSQL API Go Race, Linux/Windows, Web/Desktop, Rootless/images/installers, one-work-commit and Final Gate; fresh clean PR mergeability before Ready/Rebase. Real iOS Safari/Android/PWA, WAN/physical 100k CLS/FPS, and browser 375/390/899px geometry for this P107 commit are **NOT RUN** unless separately executed. Source/React and CI success cannot establish zero layout jitter universally. Do not modify independent Gallery A4, LocalPush, Performance or Race work.
