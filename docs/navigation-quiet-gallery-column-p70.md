# P70 · Quiet Gallery first indexes and Files Column navigation

Date: 2026-10-18. Frozen source master `39bb59c93b03c7d344afee19861f71ce009209ac`.

## Current progress and confirmed gaps

The merged P58–P68 stability series already removed Mobile Files
directory-loading captions, stabilized first counted Range slots and
Gallery folder breadcrumbs, and prevented Source/storage panel
geometry shifts. Independent P69 fixes Recent/Quick Access
async folder-commit ordering. This follow-up does not touch P69.

Four distinct original shared components still mounted **decorative**
navigation rings after an otherwise quiet initial render:
- Memories first Owner read: 180px fixed slot; ring appears after 300ms.
- Cleanup first burst-index read: 180px fixed slot; ring appears after 300ms.
- Album Organizer first verified-index read: 160px fixed slot; text
  `正在读取相册…` and progress ring appear after 300ms.
- Wide Web/Desktop FileExplorer Column: a floating bottom-corner folder
  ring appears after 300ms, even though the width/scroll host was stable.

These are not actual thumbnail, poster or transfer progress indicators;
they add an extra intermediate visual state during navigation.

## Scoped implementation

- Keep each existing stable content slot, no newly inserted rows, and
  immediate truthful `aria-busy` while its real Server/Agent request runs.
- Remove only decorative first-index navigation ring/caption and its
  display-only delayed hook where unused.
- Keep accepted results, verified-only empty states and true failure/retry
  actions unchanged. In particular, Cleanup's unknown first index must not
  claim there is no cleanup advice; its real "加载更多连拍组" remains
  enabled with a fixed-width progress slot.
- File Column preserves per-folder AbortController, request generation,
  paginated AutoLoadSentinel, fixed scroll ownership and real error retry.
- Keep the single Web/Mobile Web/Desktop Gallery transport and virtualized
  photo wall untouched. No Go handler, extra fetch, global transition
  disable, thumbnail, video poster or Live Photo loading change.

## Reproducible testing and limits

Update existing P49/P50/P68/Column/Cleanup source and mounted tests rather
than retaining obsolete source-token expectations. A new Node test mounts
the **actual original** Memories, Cleanup and Column components and holds a
real Promise longer than 360ms, asserting stable height/width and no ring;
it verifies accepted empty results and real retry/error behavior.

Require a single scoped work commit, entirely new accurate-head 76-job CI,
real PostgreSQL API Race, Web/Desktop/Windows, Rootless, image/artifact,
single-commit/Final Gate and fresh GitHub clean mergeability before
Ready/Rebase. A source-exact renderer test is not a physical iOS Safari,
Android Chrome, installed PWA, weak WAN, real 100k or CLS/FPS measurement.
Residual Gallery People/Places first-index UI, transfer surfaces and real
device layout remain separate audit items, not falsely marked complete.
