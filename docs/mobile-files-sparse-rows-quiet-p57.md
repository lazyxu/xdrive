# P57 · Mobile Files 100k sparse virtual cells: quiet first frames

**2026-10-18: Implementation submitted; exact-head CI and real device acceptance not yet completed.**

## Original-source defect

The compact Mobile Web `renderLogicalCell` displayed an unconditional visible `加载中…` caption in each missing sparse virtual cell. During any authorized 100k directory range read or scroll into a newly requested range, these captions briefly changed into actual filenames. Their transient wording is needless visual noise even when network delivery is quick. The wide Web/Desktop shared FileExplorer already uses visually subdued `aria-hidden` fixed-size virtual placeholders, not loading text.

## Scoped minimum correction

- Preserve existing Server/Agent Range, one shared Web controller, 100k sparse `itemAt`, grouped+inline virtual layout, scroll owner and row heights. This is *not* a second virtualizer, fake item, or network request.
- While a cell is unverified, render a **height-stable, pointer-transparent, `aria-hidden` neutral 10px guide**, never an in-flow loading caption. The authorized item replaces exactly that reserved cell; only the REAL thumbnail/poster/video component owns its network progress.
- Retain existing delayed 300ms network feedback for genuinely cold folder, Search and Trash, real error/Retry, authenticated list count, accessibility for verified items, file mutations and 52px global App Frame. Do not globally disable transitions.
- Actual mounted original `MobileFiles` regression holds a 100,000 logical-row VirtualCollection, verifies a bounded (<30) placeholder window, minHeight, lack of text and tap targets, real visible item rendering and same single scroll host when another sparse item is accepted.

## Gates

One scope-only work commit from a fixed `master`; require NEW exact-head **76-job** CI including Desktop mounted/Windows, Web TypeScript/lint/build, Go PostgreSQL Race, Rootless, single-commit and Final Gate, and clean GitHub mergeability. Physical iOS Safari, Android, installed PWA, poor WAN, 100k genuine CAS FPS/CLS/INP remain NOT RUN; the mounted fixture does not imply those passed. Parallel Gallery #1998 and Public Share #2006 stay untouched. See [mobile navigation evidence](mobile-navigation-stability.md).
