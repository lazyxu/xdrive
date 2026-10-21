# P120 · Shared Web/Desktop FileExplorer status bar must never resize the virtual scroll host

## Verified source hazard

`ui/shared/src/mui/FileExplorer.tsx` still rendered the real `data-xdrive-file-explorer-status-bar` as a flex container with `flexWrap: 'wrap'` and auto height; its right status group independently wrapped, and the arrangement label explicitly used `overflowWrap: 'anywhere'`. When Server Search, trash, upload/paste, selection progress, selection feedback or a long localized ordering label arrived, the status bar could gain a second line. Because it is a `flexShrink: 0` sibling of the sole virtual scroll host, that additional row can reduce the visible directory height and shift its viewport without a navigation. P110 correctly moved transient error/Retry rows outside the flex panel, but did not fence this existing footer.

## Minimal change

- Keep the existing Web/Desktop shared component, all statuses, `cancelSelectionLoad`, current search/operation callbacks, 100k virtual list, thumbnails, and original owner state intact.
- Give the footer one fixed 28px wide / 36px compact height and keep BOTH status clusters single-line, with preserved 44px touch handling elsewhere. Instead of hiding a genuine status, use horizontal overflow scrolling with visually hidden scrollbar. Text has existing tooltip and arrangement `title`; do not enlarge the one virtual scroll host's footer when a status length or selection changes.
- Do not introduce a loading page, artificial timer, network request, flicker transition, or suppress real thumbnail/transfer progress.
- Add original shared JSX structural regression `desktop/tests/file-explorer-wide-statusbar-no-reflow-p120.cjs`. Verify the actual fixed-footprint style and both Web/Desktop `statusText` bindings, navigation scroll host, real progress and cancellability.
- Permanent guidance is additive to the complete latest `AGENTS.md`.

## Validation boundary

Require new single-work source-exact CI (original Desktop tests, Web/Desktop Linux/Windows, real PostgreSQL Go API Race, packages/images/Rootless, Host, Final Gate) and fresh clean GitHub mergeability before Ready/rebase. Source-structure tests are **not** real-device geometry evidence. Actual desktop narrow windows, physical Mobile Safari/PWA/WAN, 100k CLS/FPS, scrollbar interaction and pixel deltas **NOT RUN** in connector-only work. P118 Mobile Files and P112 Gallery are separate owners; do not overwrite, cherry-pick or claim their independent fixes here.
