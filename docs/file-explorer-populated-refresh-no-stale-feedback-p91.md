# P91 · Shared FileExplorer populated refresh feedback generation (2026-10-19)

## Source-confirmed residual flash
Both wide Web and Desktop use the original `ui/shared/src/mui/FileExplorer.tsx`. Ordinary directory navigation and cold GETs already retain old rows and a stable 180px silent slot. However an **already populated same-folder refresh** saved only `delayedLoadingScope: string` and cleared it in `useEffect` AFTER paint. A previous >300ms refresh could make a subsequent quickly repeated same-scope request display one stale 2px progress frame before the new timer ran.

## Scope
- Replace the string-only effect timer with an in-render `{ pending, scope, generation }` fence and the existing original `useXDriveDeferredLoading` visual-only hook from P89. Increment generation on pending or scope change, render the delayed 2px refresh feedback only for the matching current presentation cycle. Actual directory requests and verified old rows do **not** wait for the display delay.
- Preserve unchanged cold silent first read, accepted empty/error states, virtual 100k sparse collection, real thumbnails/posters, Go/Agent/AbortController cancellation and transfer progress. No refresh starts or cancels differently.
- Extend the original P60 shared Explorer source tests; P89's mounted original shared hook tests cover same-ID retry, changed request ID and delay. P78/P88 permanent no-jitter contract already applies, so do not duplicate another AGENTS policy marker or modify unrelated P90 Public Share, P83 Source/Task, P87 Gallery and performance/race branches.

## Verification boundary
A source guard + mounted original hook does **not** prove real whole FileExplorer UI geometry. Require accurate HEAD 77+ CI, Final Gate and fresh clean mergeability before merge. Record actual built Chromium 375/390/899px, wide Web/Desktop, iOS/Android/installed PWA, WAN CLS/FPS and physical 100k as **NOT RUN** unless performed.
