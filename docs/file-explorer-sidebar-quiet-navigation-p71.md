# P71 · Quiet Files sidebar folder and collection navigation

Date: 2026-10-18. Frozen source baseline: `master@f09dab55139464d9a612942834c2abe9dd6c4124`.

## Progress and source-confirmed defect

The merged P58–P68 work stabilizes Mobile Web folder first-Range,
wide FileExplorer, Gallery photo-wall and Album folder navigation.
P69 independently owns Mobile Web Recent/Quick Access folder commit;
P70 independently owns Gallery Memories/Cleanup/Album first-index and
Wide FileExplorer Column overlays. Neither branch or source is changed
here.

The original shared `FileExplorerNavigationPane.tsx` used by Wide Web
and Desktop kept its actual folder/tree/list GETs but mounted a
**decorative spinner after 300ms** on:
- Lazy tree folder expansion.
- Cold Quick Access, Favorites and Recent index reads.
- The two reserved 14px Saved Searches and Tags heading slots.

The short-lived ring creates navigation noise despite providing no new
network data, whereas true file thumbnails/posters and durable transfer
progress have their own owners. A cold sidebar branch had a 32/44px
minimum area, while its accepted-empty description could wrap into
multiple lines and resize neighboring sections.

## Scoped correction

- Remove only the `XDriveNavigationQuietSpinner` display-only timer/ring
  and related import; keep tree chevron/icon hit area, same 14px
  noninteractive feedback footprint, and immediate `aria-busy` on tree.
- Add true `aria-busy` to Quick Access, Favorites and Recent section
  containers. While current data is unresolved, keep an empty
  noninteractive first-read slot, not a spinner or false empty label.
- Use corresponding terminal empty containers with identical geometry
  floors: Quick Access 96px compact/112px wide, Favorites 72px
  compact/80px wide, Recent 44px compact/32px wide. True results
  render normally; a larger accepted collection may naturally grow.
- Keep 14px Tags/Saved Searches heading slots invisible throughout a
  read, with existing section-level busy semantics.
- Preserve existing bounded tree pagination, cursor, error/retry,
  request generation/lifecycle guards, drop/upload handlers, selection
  and all original Web/Desktop API ownership. Intentionally preserve
  intentional sidebar disclosure animation, accessibility and real
  thumbnail/video/Live Photo loading.

## Evidence / release gate

Update the original navigation source contract and organization quiet
feedback assertions. Mount the **original shared NavigationPane**
in the Node React renderer, hold a real folder-list Promise beyond
360ms, confirm requests are immediate, all first/accepted-empty
slots retain matching minHeight, no decorative ring appears, and
current tree pending reports busy. Existing tree race tests remain.

Exactly ONE scope-only work commit, NEW complete 76+ job accurate-head
CI incl Go/Postgres API Race, Web/Desktop/Windows, Rootless,
single-commit and Final Gate, plus GitHub current mergeable_state=clean
are mandatory before Ready/Rebase. Physical iOS Safari, Android,
installed PWA, weak WAN and real 100k workload CLS/FPS are still
NOT RUN and must not be inferred from Node renderer/source tests.
