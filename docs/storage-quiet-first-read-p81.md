# P81 · Stable, silent first reads for storage destinations (2026-10-18)

## Audited original code
- Shared `CloudStoragePage.tsx`, `LocalStoragePage.tsx` and `GlobalStorageStatsPage.tsx` still mounted a delayed (300ms) state panel during a slow unverified first read. Cloud/Local refresh also replaced the stable refresh icon with a delayed spinner. These are page-navigation decorations, **not** thumbnail, Live Photo, transfer or index-work progress.
- Existing `workspace-storage-quiet-loading.cjs` and `global-storage-quiet-refresh.cjs` asserted the old delayed panel; both were changed rather than deleting the regression gates. The shared deferred-loading hook itself is **not removed**: other real-progress consumers, including the already accepted Global Storage refresh, still use it.
- No files, Gallery, Source, Agent, Go, upload/download/cancel, storage backend or Web/Desktop transport were modified. Independent P79 Mobile Trash and P80 Home pages have separate active PRs.

## Render state contract

| Stage | Cloud / Local | Global |
| --- | --- | --- |
| Cold/unverified before `useEffect` | 180px silent fixed slot, truthful `aria-busy`, static page title and refresh icon | Same 180px silent slot and existing global scope disclosure |
| In-flight for 20ms or 400ms or slow WAN | Same silent slot; GET still runs, refresh is disabled | Same silent slot; GET still runs |
| First request failure | Real error in 180px minimum slot, refresh available | Real error in 180px minimum slot, refresh available |
| Authenticated valid response | Real quota/cache/statistics content; no invented "暂无" | Real storage content |
| Refresh after a verified response | Retain old content; refresh icon stays the same and button is disabled while pending | Retain old content and diagnostics; original non-reflowing 2px refresh indicator may show after delay |
| User-invoked true work | Preserve actual cache operation feedback and error | Preserve real maintenance, staging, lazy diagnostics and pagination feedback |

## Evidence and gates
- Original React Cloud/Local mounted test `desktop/tests/storage-first-read-silent-mounted-p81.cjs`: hold cold GET beyond 350ms, verify stable 180px slot/no StatePanel/no false empty, real terminal failure, accepted content, and a held same-owner refresh without icon/content swap.
- Existing storage source guards updated for **silence even after 300ms**, stable chrome and true error, and Global accepted-data refresh distinction.
- Required before merge: complete **source-exact HEAD** CI (Desktop tests, Web, Linux/Windows, genuine PostgreSQL API Race, Rootless, one-work-commit, Final Gate) and fresh mergeability. Full built-Chromium storage-route layout probes at 375/390/899px and Desktop are **NOT RUN** by this scoped change; add before claiming browser-level zero jitter. Native iOS/Android/installed PWA, actual slow WAN, 100k physical data and CLS/FPS are **NOT RUN**, so do not claim physical parity or release GO.
