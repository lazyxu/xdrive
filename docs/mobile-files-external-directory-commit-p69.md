# P69 · Mobile Files external folder navigation commits once

Date: 2026-10-18. Frozen repository baseline: `master@ec88b3e65ffaffe2a8cb4f4670a4ec71c174a639`.

## Progress and reproducible source finding

Earlier merged P58–P65 fixes already preserve committed folder content while a new
counted first Range is pending, remove the cold directory/gallery 300ms status,
reserve 180px Files and 220px Gallery empty/pending slots, stabilize the 52px
App Frame, and keep true thumbnails/Live Photo/video poster network progress.
P68 #2048 separately owns Gallery album-folder's >300ms decorative spinner.
Do not duplicate/overwrite P68 or active A3, host, device, security and
performance work.

The remaining Mobile Files `Recent` and `Quick Access` folder-row click
handlers each attached `beginBrowse(entry.id)` to asynchronous activation
Promise completion. Promise acknowledgment can precede React's authorized
`crumbs` and first counted Range, exposing the previous directory under a
new Browse view and persisting a destination that is not yet accepted.
Conversely, if the authorized receipt commits first, the late callback can
reset the new directory scrollTop **again**, causing a visible bounce.

## Scoped fix

- Track the last external directory gesture with its unique navigation
  intent and target folder ID; do not change Browse Home/Recent/Favorites
  visibility or scroll when the Promise merely resolves.
- In the original Mobile Files pre-paint directory-commit effect, reveal
  Browse and reset its virtual scroll **once**, only on the matching,
  accepted `crumbs` and counted `virtualCollection` with `!loading`.
  Reject stale intent, Search and Trash. Ordinary Browse child/parent,
  typing, URL deep links and Browse-root already have independent owners.
- A repeat open of the **same already-counted** directory can enter Browse
  after its real activation succeeds; denied activation stays on old rail.
  No new REST/Agent call, timer, extra virtualizer, spinner, remount or cache.
  Thumbnail/poster decoding remains unchanged.
- Existing original mounted React `MobileFiles` regression now verifies:
  (1) Recent promise-before-receipt; (2) late promise after scroll;
  (3) Quick Access denial and accepted receipt; (4) superseded Recent
  navigation; (5) existing same-folder accepted/rejected action. All assert
  one file scroll host and no early page switch. Source-only and mounted
  regressions do **not** imply actual device frames were measured.

## Release and audit ledger

One work commit on frozen master, exact-head 76-job CI, clean GitHub
mergeability, then Ready/Rebase only if gates pass. Native iOS Safari,
Android Chrome, installed PWA, physical weak WAN, 100k-real-content CLS/FPS,
and whole-app screen recording are still unverified. Follow-up audits should
cover Gallery People/Places first-index progress, transfer panels and
actual hardware layout stability without deleting real errors/retry or
genuine media loading feedback.

## P69 guard after retained-range audit

A destination identical to the already mounted authorized directory is NOT a
new first-Range commit. If its activation is still unresolved, an unrelated
background refresh can toggle `loading` without granting navigation. The
`alreadyCommitted` flag keeps that case out of the pre-paint commit path;
only a successful activation may explicitly reveal Browse. A superseded
rejected Promise also cannot emit an obsolete navigation error toast. The
original mounted suite adds both negative cases, for seven P69 cases total.
 
## Context menu parity / first exact-head RED (2026-10-18)
- Original P69 head `6c5d33257b5278f9e06ecb02fe36a53c19781d16` [CI #39105179427](https://github.com/lazyxu/xdrive/actions/runs/39105179427) was **RED**: old `desktop/tests/mobile-files-ios.cjs` expected Promise→beginBrowse, which is precisely the premature navigation P69 removes. Existing mounted P69 tests passed that stage, but the static oracle was obsolete.
- A further production gap remained at Recent/Favorites **long-press/keyboard collection menu → Open**: it still committed `beginBrowse` directly after Promise. The corrected handler reuses the same `openExternalDirectory` intent/counted-first-Range gate for folders, preserving direct File open semantics.
- Add original mounted MobileFiles tests for keyboard menu and held authorized first Range, plus long-press Favorites denial; update the old source contract rather than deleting it. Keep AGENTS, shared Server API and every unrelated blob unchanged.
- Reconstruct **exactly one** corrected P69 work commit on frozen merged `master@2bba05040b7989b8e99a16896f07ed9d00de2740`; demand NEW complete 76-job exact-head CI and clean GitHub mergeability, never reuse RED CI. Physical iOS/Android/PWA/FPS/CLS remains NOT RUN.
 
## Show in Folder must share the same verified navigation owner (2026-10-18)
- Audit also found `Recent/Favorites → long-press/keyboard menu → 显示所在文件夹` called `beginBrowse` on a location/open Promise. This could repeat a committed scroll reset or expose unaccepted directory rows, despite corrected direct folder Open.
- Gate asynchronous location lookup by the current navigation intent; ignore old lookups superseded by new rail/Owner activity. For a current parent, `openExternalDirectory` normalizes boolean/void/Promise from `onShowInFolder` and commits only on the existing authorized counted parent Range. No new HTTP request or cache.
- Add mounted tests for pending parent navigation + genuine Range commit and for stale location lookup defeated by another rail tap. The original U06 Search/Server route and original shared API remain unchanged.
- Reconstruct one scoped work commit on the SAME frozen parent after this P69 addendum; the prior head's CI cannot authorize the corrected new head. Seven-platform S5 stays NOT RUN / NO-GO.
