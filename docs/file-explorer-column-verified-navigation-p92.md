# P92 · File Explorer Column first-page navigation stability

2026-10-19 · frozen complete master `f24d090495fc6f7c9fae24b2f74c07164bd1d2f8`.

## Source-confirmed defect
The original shared `FileExplorerColumnView.tsx` called `onSelect(item)` and `onNavigate(nextCrumbs)` directly on a directory click, before the next column's `loadPage(id, '', signal)` returned. This allowed a new, blank 252px column to enter the horizontal viewport and changed selection while the next GET was still pending. P70 previously removed the >300ms decorative Column spinner, but did not move the visual commit behind the first child-page receipt.

## Behavioral contract
- Click is intent, not a destination: previous authenticated column rows, breadcrumb and selection remain visible during fast and held >350ms child reads; no new empty column, placeholder, timer or network spinner.
- A verified successful first page (including legitimate empty page) for the latest account/crumb/intent commits the next column + selection + navigation once. Cache already verified child data to avoid redundant reads. Retain the original per-column page cursor and virtual/bounded-server requests.
- Stale, superseded or aborted page resolves are rejected. Clicking/opening a file in the retained parent cancels an older pending folder intent as well. User-visible terminal failure preserves the old column and provides a fixed-position 44px Retry rather than inserting an in-flow state.
- Existing shared Web/Desktop transport, normal thumbnail/network loading, upload/download, pagination, real errors and Go context cancellation are not modified. Mobile Web keeps its independent P89 counted-Range guard, shared file list and iOS-focused quiet first read.

## Evidence
Original mounted React test: `desktop/tests/file-explorer-column-verified-navigation-p92.cjs`. Retain original P70/P78 and account-lifecycle regression fixtures. Validate first frame, held first page, accepted empty/populated, stale rapid click, true error/retry, and owner switch. Full GitHub exact-head 77+ CI and clean mergeability are required before merging. Real built Chrome 375/390/899px + wide/Desktop, native Safari/Android/PWA, weak-WAN CLS/FPS and physical 100k screenshots remain **NOT RUN** until independently recorded; no product-wide physical GO.

