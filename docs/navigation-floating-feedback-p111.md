# P111 · Files/Gallery asynchronous feedback without visual reflow (2026-10-20)

## Evidence and scope

- Source: `web/src/MobileFiles.tsx`. An asynchronous Browse Home `organizationError` previously inserted a **new ordinary-flow row** between pinned folders and the Organization section, changing the visible rows' Y coordinates and scroll position without an accepted folder navigation. The dedicated Mobile Files P109 floating owner already exists; reuse it.
- Source: `ui/shared/src/mui/MediaGallery.tsx`. A global error, Sync Folder index error and day-jump feedback were ordinary-flow siblings before the image wall or in the toolbar. Their asynchronous appearance can move the photo wall despite an unchanged authorized Gallery collection. The index status/error entered the filter bar flow, and Places pagination errors could change pagination flex wrapping.
- These are source-confirmed **layout hazards**, not measured real-device CLS/FPS defects. Do not claim that every iOS/Android/PWA device or every route is now physically stable.

## Change

1. Mobile Browse Home organization failure and the existing Retry remain **visible and interactive** in P109's absolute safe-area-aware overlay, never inside the scroll host. On navigation to a real folder the Home-specific error no longer appears.
2. Shared Web/Desktop/Mobile Gallery global and Sync Folder errors and wide-day jump feedback use one fixed, pointer-transparent, safe-area-aware owner (not a new modal or a new scroll host). Index status/error use a zero-flow absolute owner relative to the existing results toolbar. The real Places page error is positioned absolutely relative to its existing pagination row.
3. Preserve truthful `role=alert`/`role=status`, original error text, Retry, search, media thumbnails, real transfer progress, 100k sparse virtualization, current authenticated Range, scroll anchors and controllers. Do not add a decorative directory spinner, timer, or request.

## Regression and completion gate

- `desktop/tests/mobile-files-ios-runtime.cjs` mounts the original Mobile Files, toggles a real prop error, verifies one stable scroll-host TestInstance across on/off and original retry dispatch.
- `desktop/tests/navigation-feedback-no-reflow-p111.cjs` parses the original TSX and verifies actual JSX ancestry, out-of-flow positioning, safe-area, accessibility, original progress, and the canonical AGENTS contract.
- Retain P49, P54, P78–P110, album/folder/Viewer and photo thumbnail regressions; require a **new exact-head** complete CI (Web/Desktop/Go Linux/Windows, real PostgreSQL API Go Race, Rootless/images/installers, Final Gate) plus fresh clean mergeability before merging.
- Actual built-browser device sizes (375/390/899px), iOS Safari, Android/PWA, WAN, user deployment, live 100k CLS/FPS and layout measurements: **NOT RUN** in source inspection. The release acceptance threshold remains scroll-host/header bounds <=1 CSS px across pending/failure/success and exactly one verified destination commit. Do not mark these physical scenarios as passed without running them.
