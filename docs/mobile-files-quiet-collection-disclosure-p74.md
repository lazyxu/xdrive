# P74 · Mobile Web Files quiet collection and folder disclosure

Date: 2026-10-18. Frozen master: `36fb9df4c542b079cf54f97f4b6aa0937d60dcd7`.

## Progress and observed source gap

P58–P72 are merged. P73 #2067 independently addresses Gallery People/Places
cold index spinners and verified Memories/Cleanup receipts; keep that
Gallery/Places branch untouched. Remaining original `web/src/MobileFiles.tsx`
used the shared 300ms deferred presentation hook in three MOBILE Files-only
areas despite no need for a navigation/loading intermediary:

- Browse Home Organization (saved searches and tags) reads: a 14px circle
  appeared in its already reserved absolute header after 300ms.
- Recent and Favorites cold first reads: the accepted-only/failed state had
  a fixed 180px first-read slot, but a 24px progress ring appeared after
  300ms during a sustained Owner GET.
- Inline folder disclosure: the original 44px tappable/collapsible
  chevron stayed mounted, but a 12px progress ring appeared inside its
  reserved 14px overlay after 300ms when a child Range took longer.

All three are real network queries, but none display a meaningful
known fraction, and the delayed ring is an additional interim *visual*
state, unlike genuine thumbnail, poster or upload/download/transfer work.

## Narrow P74 repair

- Keep the real Web adapter/Server/Agent requests, same shared inline
  paged Range store, original context/Abort cancellation on collapse,
  latest-request guards, fixed 44px disclosure chevron/hit target,
  14px reserved overlay and all read errors/retry.
- Mobile Browse Home's original rows/scroll host stay mounted. Use
  truthful `aria-busy` on the home while Organization refresh is
  unresolved; its fixed header feedback slot remains noninteractive
  and empty for any duration.
- Recent/Favorites pending use the existing fixed 180px container
  and `aria-busy` without a ring. Verified-zero and genuine failed
  first GET/retry use their original states; leave real collection
  thumbnails and metadata untouched.
- Never delay, simulate, duplicate or rewrite Owner APIs. Keep
  true Search/Trash network status and their separate delayed display
  rule. Do not change Gallery, 52px App Frame, scroll anchoring or
  Server/Agent/virtual-list code.

## Verification / gate

Update original P52 inline disclosure and Browse Home source-contract
tests; update the existing mounted original MobileFiles runtime checks
to hold >335ms disclosure and Organization reads with no ring. Extend
the original mounted test with >365ms Recent/Favorites current-Owner
cold GET and verified/error receipts. Tests must retain one scroll host
and identical 44px/180px reserved dimensions, real Expand→Abort
and original network thumbnails.

Exactly ONE scoped work commit on frozen latest master and entirely
NEW exact-head 76+ job CI: genuine PostgreSQL Go API Race, Web,
Desktop/Linux/Windows, Rootless, artifacts, single-commit + Final Gate
and current GitHub `mergeable_state=clean` before Ready/Rebase.
No physical iOS Safari, Android, installed PWA, real 100k WAN CLS/FPS
or accessibility screen-reader observation has been performed. Source
and React renderer checks cannot prove zero physical jitter.
