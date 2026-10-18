# P66 · Source overview quiet first-read and terminal geometry

Date: 2026-10-18. Source baseline `master@d54948143bcbe21b97a10ef3151af5654f1924ea`.
Independent of P65 #2041 and merged Source detail P64 #2040.

## Confirmed layout mismatch

The **shared** Source list page mounted a 180px first-read wrapper, then
inserted a full spinner and `正在加载来源…` after the existing 300ms
presentational delay if the owner overview REST/Agent query remained
pending. If the response was an authoritative zero, the wrapper was
replaced by the unwrapped `XDriveStatePanel`, shorter than 180px.
A first-read error used a separate unwrapped Alert, also causing the
content height to shrink. This repeats the P65 initial/empty issue
outside Files and Gallery.

## Scoped implementation

- Keep the Source list's one 180px **quiet** first-read slot from the
  first painted frame until the actual owner response. Mark it
  `aria-busy` immediately; never insert a spinner or loading caption
  after 300ms for mere navigation.
- Render an authenticated **empty** Source overview and an actual first-read
  **failure** inside distinct 180px stable terminal wrappers. Keep the
  original informative message and user-triggered retry via the
  existing Refresh button. Never claim an unverified zero is empty.
- Keep accepted rows/cards visible through refresh and display a real
  refresh error without wiping cards. The existing 300ms deferred
  refresh-button indicator stays: it is a fixed-label action and is not
  an in-flow directory-navigation intermediate state.
- No change to owner isolation, credentials, Source adapter/Agent REST,
  source scheduling/trigger/cancel, photo thumbnails, virtual FileExplorer
  or Gallery, LocalPush, performance, race, Server or app navigation.
- Add an original mounted shared Source list React regression for
  first paint, >350ms, verified zero, failure/Retry and accepted cards
  during refresh; update the original quiet-navigation source test
  without removing its accepted-state/security assertions.

## Verification gate

One scope-only commit. Entire NEW exact-HEAD 76-job CI: Web/Desktop
and Windows, Go real PostgreSQL API Race, rootless, build artifacts,
single-commit Final Gate, plus current GitHub `mergeable_state=clean`
before Ready/Rebase. Actual physical iOS Safari, Android Chrome,
installed PWA, weak WAN and 100k CLS/FPS are not measured here.

## First exact-head CI and test-harness correction

P66 first scoped one-work head `fcd5371a7b4e032d7743438c46347cb06216c895` triggered
[CI #39101482100](https://github.com/lazyxu/xdrive/actions/runs/39101482100).
Desktop tests reported **3,126 total: 3,123 pass, 2 fail, 1 expected skip**;
both failures came from the new mounted regression itself. Its helper
searched the rendered DOM for `action-button`, but the original shared
`XDriveWorkspaceSurface` receives actions as a `pageActions` ReactNode
PROP, so the mocked host shell does not render them as DOM descendants.
This does not indicate that the real Refresh button was removed.

Change only the P66 mounted oracle to read the `pageActions` element
from the real WorkspaceSurface and select its labelled Refresh action;
keep both original production UI blobs, original other Source test, all
network/empty/error/350ms/layout assertions and other tests unchanged.
Reconstruct exactly ONE corrected work commit against the SAME immutable
`master@d54948143bcbe21b97a10ef3151af5654f1924ea` parent, lease-replace only the P66 branch ref and
obtain a totally NEW complete 76-job exact-head CI including Go
PostgreSQL API Race, Web, Desktop/Windows, Rootless, single-commit/Final
Gate and fresh clean mergeability. The failed first run cannot qualify merge.
