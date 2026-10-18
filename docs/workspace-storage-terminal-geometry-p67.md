# P67 · Stable first-read and failure geometry in Storage workspaces

**Date:** 2026-10-18. Frozen parent
`master@4256c79cfda68439b870e517b48f24983c8d25e5`.
Independent of Source Overview P66 #2042, and follows merged Files/Gallery
geometry P65 #2041.

## Source-confirmed issue

Shared Cloud Storage and Local Storage already reserve a **180px**
initial waiting area and defer genuine Server/Agent/browser cache
loading feedback by 300ms. But when a first read actually fails, both
unmount the full-height pending area and insert an unwrapped
`XDriveStatusAlert`. Admin Global Storage does the same, while displaying
a separate persistent scope alert. The visual result can be a 180px
pending region collapsing to one short error row, which needlessly
moves adjacent content on Mobile Web and Desktop.

This is different from a genuine network thumbnail or a manual cache
cleanup action; deleting all spinners is not the objective.

## Scoped shared-UI fix

- Cloud Storage, Local Storage: keep `data-xdrive-*-loading-slot` as
  a minimum **180px** frame, add immediate `aria-busy`, and when the
  FIRST snapshot fails render a `data-xdrive-*-first-read-error`
  wrapper with the same **180px** minimum height. A successful
  first snapshot still directly renders real storage content.
- Global Storage: match its existing 180px cold summary slot to a
  180px first-read error slot and preserve its separate scoped
  disclosure. Do not claim unavailable admin metrics are an empty
  successful snapshot.
- For a failure during *refresh with an accepted snapshot*, keep
  previously rendered metrics/tree/cards and display the existing
  truthful error alert. Do not hide user errors or shrink accepted
  content back into a blank slot.
- Preserve the existing deferred 300ms visual-only feedback for
  genuinely long storage reads, disabled fixed-label Refresh actions,
  Server/Agent APIs, Web/Desktop shared components and all
  storage cleanup/retention/repair permissions.

## Tests and release

Update **original** `desktop/tests/workspace-storage-quiet-loading.cjs`
and `desktop/tests/global-storage-quiet-refresh.cjs` to enforce a
matching cold/error min-height, immediate `aria-busy`, actual error
disclosure, stable refresh and existing network timing. No mock Server
or new provider transport.

Exactly one scoped commit; require NEW accurate-head full 76-job CI
(Web TS/lint/build, Desktop/Windows, Go with real PostgreSQL API Race,
Rootless, artifacts, single-commit/Final Gate) and clean Github
mergeability before Ready/Rebase. Real physical iOS Safari, Android,
installed PWA, WAN and 100k CLS/FPS remain unverified.
