# P112 · Non-reflow Source refresh and Gallery map viewport errors

2026-10-20 — complete shared UI source audit follow-up after P110/P111.

## Confirmed defects

1. Shared Sync Folder/Source list: a failed background refresh with already accepted cards added a new `XDriveStatusAlert` ahead of the original `Stack` list. This shifts every card's Y-position without navigation.
2. Shared Gallery Places static-map viewport: a failed Server viewport GET added an in-flow `Typography role=alert` above already accepted place tiles. During a cold request, failure additionally removed the `minHeight:96` pending slot, collapsing the page even though no authoritative index response arrived.

## Correction

- Source refresh failure is a true, visible and accessible status, now fixed at the bottom with a bounded safe-area-aware position and no pointer interception; original Refresh button and old Source cards remain.
- Places viewport error is a true `role=alert` in an **absolutely positioned**, bounded slot within the already-relative map viewport section. It is a **DOM sibling of the results Stack**, not its child: MUI `Stack spacing` selectors can assign margins to regular results based on even absolutely positioned siblings, moving the first real row. Keep the error outside that selector and preserve the existing result Stack identity. Keep the same 96px quiet slot through pending/error until a verified result. Do not invent a successful zero or break cancellation/server request generation.
- Web, Mobile Web and Desktop share these same MUI files. No Go, map Provider, thumbnails, uploads, downloads, transforms, authentication or IPC edits.

## Tests / acceptance

Extend **original mounted** `desktop/tests/source-overview-quiet-terminal-geometry-p66.cjs` and `desktop/tests/gallery-places-viewport-quiet-navigation.cjs`, verifying exact card/result TestInstance identity, original retry/error, and persistent 96px geometry across the actual failed async request. Complete exact-head CI and GitHub clean mergeability before merging. Physical browser measurements at 375px, 390px and 899px, iOS/Android/PWA and 100k CLS/FPS: NOT RUN unless separately executed. A source-level fix is not proof of universal physical no-jitter.

## Permanent CSS-layout failure mode

MUI `Stack spacing` may create adjacent-sibling margins even when a child is positioned absolutely. Do not rely on `position:absolute` by itself: **the real error element must be a sibling outside the results Stack**, and the authenticated results Stack must remain mounted in its original place. The original JSX source assertion checks this exact relationship in addition to the existing mounted React owner identity tests. Genuine 375/390/899px browser geometry is still NOT RUN for P112.
