# P62 · Quiet directory and Gallery Range navigation (2026-10-18)

## Verified before this change

P52/P58/P59/P60/P61 already merged: committed folder navigation preserves old rows;
Mobile and shared wide Explorer reserve 180px cold first-Range slots, Gallery owns
a 220px pending photo-wall slot, Search uses a stable first-read slot, and Album
breadcrumb navigation is one row. Despite stable geometry, a slow (>300ms)
cold Directory/Library first Range still painted a redundant loading caption
and spinner in the center of those slots. This does not match the requested
iOS Files-like *quiet navigation*. Do not confuse it with thumbnail or video
poster decoding/network progress.

## Scoped change

- Mobile Web/PWA Files: never schedule visual loading state for a cold Browse
  directory; keep the existing single 180px aria-busy range slot until the
  authenticated/count-bearing result or genuine terminal failure. Search and
  Trash still have truthful delayed feedback. Keep committed-folder rows,
  browser History and virtual scroll owner unchanged.
- Shared Web/Desktop Files: preserve the original 180px cold Range area but
  never mount the transient in-flow File loading panel inside it. Preserve the
  accepted empty, unverified/failed Trash and genuine thin refresh indicator.
- Shared Web/Mobile Web/PWA/Desktop Gallery: preserve the same 220px
  first-Range photo-wall footprint with truthful aria-busy; remove only the
  automatic cold photo-wall caption/spinner and redundant 300ms epoch timer.
  Keep media Range request, error state, sparse virtual collection, thumbnail,
  Live Photo and video-poster loading identical.
- Update U08/P59/P60/P39 test oracles and compiled Chrome held-owner-Range
  assertion: sustained waits must remain quiet without the App Frame moving.
  Add P62 source guards. No new network request, route, state store or
  request cancellation policy.

## Release gate and limits

Require a *new exact-HEAD* full 76-job CI including Web/Desktop/Windows,
real PostgreSQL API Race, Rootless, compiled browser scenarios, single-work
commit and final-gate, plus clean PR mergeability before Ready/Rebase.
No physical iOS/Android/installed PWA, real WAN, 100k-folio CLS/FPS or
literal iOS27 1:1 visual acceptance has been performed in this source work.
Do not claim those external tests passed merely from a source contract.

## Initial exact-HEAD CI and corrective test gate

The first immutable P62 work head `eadcf75ebe3015f51c1f518ab02b797b96094c7c` ran [CI #39095659072](https://github.com/lazyxu/xdrive/actions/runs/39095659072).
`desktop-tests` reported **3,103 tests: 3,101 pass, 1 fail, 1 expected skip**.
The only Desktop failure was the obsolete P54 *source-token* oracle
`desktop/tests/gallery-wide-query-feedback-quiet-p54.cjs`, which still
required `showDelayedColdPhotoLoad` even though P62 deliberately removed it.
Preserve the production changes byte-for-byte; correct that obsolete
expectation to the genuine cold-range `aria-busy` slot contract. Also opt this
P62 branch into the existing built Web 390px real Chrome P39 held-Range
scenario (without inventing a new browser fixture), which now asserts that
even a sustained cold wait is silent and geometry-stable.

Rebuild exactly ONE P62 work commit with parent `e8c9bebe382974b76d99cbbef32bc12b4015c195`, preserve all nine
initial source/test/document blobs except this documentation addendum
and the two explicit test/CI files, require entirely NEW complete accurate-HEAD
76-job CI with Go/PostgreSQL Race, Web, Desktop, Rootless and Chrome P39, clean
mergeability, then Ready/Rebase only after all gates pass. The failed first
CI does not authorize merge. Physical iOS/Android/installed PWA and actual
WAN/100k CLS/FPS remain unverified.

## Exact-head second run and Chrome setup correction

Second one-work head `1073dd38a4cc09680aab348499b11de62601bf5c` ran [CI #39095925277](https://github.com/lazyxu/xdrive/actions/runs/39095925277).
The Web job passed source/production build before the newly opt-in real Chrome
Gallery step but failed because the branch was omitted from the preceding
`Prepare opt-in native Chrome iOS 27 Web acceptance` condition: `XD_CHROME`
was unset. Include the P62 prefix in BOTH prepare and browser-run steps, and
add source assertions guarding the matched gates. The `server-validation`
job also failed its unrelated host xdrive-server manager fixture
(`host xdrive-server manager test failed (exit 1)`); do not modify the
Server, host scripts, migrate-user or privileges under this UI-scoped PR.
A fresh exact-head full CI is required and no failed run authorizes merge.

Rebuild exactly one scoped work commit against immutable parent `e8c9bebe382974b76d99cbbef32bc12b4015c195`;
preserve the P62 production blobs and all prior test changes byte-identical
except this P62 browser-gate contract and this note. Concurrent master changes
must not be force-overwritten.
