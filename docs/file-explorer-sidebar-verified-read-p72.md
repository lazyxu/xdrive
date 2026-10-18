# P72 · Verified first-read state for the Files navigation sidebar

Date: 2026-10-18. **Stacked dependency:** P71 #2059 source HEAD
`7b6ebfe361bcba01409503ec27bac60361ec8a77` (not merged at the time this work was prepared).

## Original-state finding

P71 removes delayed decorative loading rings and reserves stable sidebar
first/empty footprints. A distinct correctness problem remains: each
sidebar controller can initially render `items=[]` with `loading=false`
before its mount effect launches the first current-account GET. If the
presentation infers 'empty' from only that Boolean, one frame of '暂无'
can appear before pending, followed by actual results or an error.
Such false-empty flashes violate iOS Files-style continuous navigation.
A failed first GET can also be mislabeled as a successful zero.

The shared Recent and Favorites controllers already return the durable
per-Owner receipt `readState: unverified|ready|error`, but the shared
NavigationPane did not consume it. QuickAccess lacked the same receipt.

## Implementation

- Add QuickAccess readState with **unverified** initial/current-owner
  transition, **ready** only on an accepted successful current request
  or mutation and **error** on current failed GET. Reuse its existing
  request-id, lifecycle and reorder-generation fences. Old-session
  read states are never exposed in the first new-owner render.
- Pass QuickAccess/Favorites/Recent readState from the one shared
  Web and Desktop workspace adapters into the one shared
  FileExplorerNavigationPane. No alternative REST call, virtualizer,
  network timer or Go API.
- For empty lists: **unverified** retains P71's silent first-read
  footprint; **error** retains same-height actionable error/retry;
  **ready** alone may display '暂无'. A background refresh of an
  accepted empty list does not collapse it or insert an intermediate
  blank slot. Accepted existing rows survive refresh/failure.
- Keep section-level `aria-busy` for both current pending reads and
  unknown-first-index state. P71's static 14px heading/tree slots,
  original directory paginated requests, thumbnails/Live Photo/video
  posters, upload/download/transfers and fullscreen App Frame remain.

## Verification and release gate

P72 updates original P71 mounted shared NavigationPane regression to
use current read receipts. An additional original mounted test covers:
first `loading=false,unverified` has NO false empty; >360ms remains
quiet; first failure shows an equal-height Retry state; accepted
empty appears only on ready; refreshing ready-zero keeps its original
empty content. Source contracts check Owner/lifecycle fencing and
all original Web/Desktop controller adapters.

Exactly one P72 work commit stacked on current P71 HEAD, independent
Draft PR into the predecessor branch. **Do not merge P72 into master**
until P71 passes its own accurate-head full CI and clean merge, then
rebase exactly one P72 work commit onto the completed master, re-run
entire NEW accurate-head 76+ job CI incl real PostgreSQL API Race,
Web/Desktop/Windows/Rootless/artifacts/Final Gate, and check current
clean mergeability. Real iOS/Android/installed PWA, weak WAN and actual
100k physical CLS/FPS still NOT RUN and must never be inferred from a
React mounted test.
