# P84 — silent routed Web Viewer first reads (2026-10-19)

## Scope and source-verified defect

The original `web/src/WebFileViewerApps.tsx` inserted five loading StatePanels during ordinary Web and Mobile Web app entry: Quick Look / file preview, photo/video Viewer, secondary media metadata, text/code viewer, and PDF/audio viewer. These intermediate visual states occurred before the first authenticated metadata reply and could appear briefly even on a fast request. The overall viewer frame was already full-screen, so a new spinner or caption was not required.

## Implemented invariant

- The same full-height `WebViewerFrame` and one silent `data-xdrive-web-viewer-quiet-first-read` canvas remain while current metadata is unverified, including requests held longer than 300ms. The canvas has `role="region"` and truthful `aria-busy`, but no decorative spinner, invented empty state, or extra scroll host.
- Only an authorized, current API/route result reveals a Node and preview. Text Nodes and their text previews commit as one tuple; PDF/audio Nodes are tied to the target route and API instance. An old response cannot become a new-route view; on failure show the real existing `XDriveStatusAlert` and allow Return.
- Once metadata is verified, the real shared `XDriveFilePreviewSurface` / `XDriveMediaViewerContent` owns thumbnail decode, Live Photo, video poster, text/PDF/audio network work and any meaningful in-content feedback. No request, Abort, caching, transfer, Go ctx, Viewer context, or 100k virtual list semantics are changed.

| Entry state | Required visible frame | Gate |
| --- | --- | --- |
| First paint / metadata pending (including >300ms) | One stable full-screen viewer + silent busy canvas | Mounted original React for all five routes, held pending |
| Accepted preview / text / PDF / audio | Same frame, canonical renderer, no loading transition panel | Mounted authentic viewer tests |
| Route 101 -> 102 with slow response | Do not show prior file bytes/title/actions as target 102; keep quiet slot | Mounted original React, slow route supersession |
| Failed authorized read | Real error, Return, no stale success or fake empty | Existing original five-route error tests |
| Actual media bytes, thumbnail or Live Photo fetch | Keep independent real media feedback; never turn off network loading | Existing shared preview/transport tests |

## Evidence and release status

Modified original `desktop/tests/web-viewer-shell.cjs` to hold actual `WebFileViewerApps` mounted React renderers for >365ms, check all five silent first-entry routes, same shell identity, failure and route supersession for text/PDF/audio. Web/Desktop build/typecheck and full accurate-HEAD CI with original mounted tests remain merge gates. Physical iOS Safari, Android, installed PWA, weak WAN and real CLS/FPS were **NOT RUN**; do not report physical zero-jitter or whole-product completion. P83 Source/Task Center, live Media/Gallery, FileExplorer and independent performance/race branches are out of this change's scope.

## First CI diagnostic / corrected test oracle

[P84 original exact-head CI #39185606923](https://github.com/lazyxu/xdrive/actions/runs/39185606923) failed only its eight newly authored `web-viewer-shell.cjs` assertions: the React test renderer traversal returns both a function component and its rendered host, so matching only `data-xdrive-web-viewer-quiet-first-read` counted two nodes although only one DOM `div` exists. Narrow the two test traversal predicates to `element.type === 'div'` instead of deleting a real component, weakening the expected count, or changing production renderer. The original Web lint/build, Desktop Linux, server validation and one-commit gates passed; the whole original CI was still RED and is not merge evidence. Re-test ALL five routes on a new complete exact-head run, and retain the native/browser NOT RUN limitations.
