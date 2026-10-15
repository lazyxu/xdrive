# xDrive Mobile Web navigation / visual stability matrix

**Status (2026-10-15):** First scoped corrective implementation prepared; source-exact browser and full CI pending. This is a shared visual/state geometry investigation, not the independent Go race or 100k performance benchmark track.

## Constraints

- Preserve the full-screen mobile Web App Frame, fixed 52px xDrive global app title bar, and separate Files internal header/Recents/Favorites/Browse rail.
- Web/Mobile Web must retain identical Server API, workspace navigation/history, authorization, virtual range and mutation semantics. Desktop's independent transport is unchanged.
- Scroll ownership: the Files virtual scroll host owns folder position; the Gallery scroll host owns Gallery media position, and its Viewer retains/restores that anchor; App-level `main` scroll resets only when the actual App changes. Never reset a pending parent/child content pane merely on click.
- A request-loading badge should not insert a row or animate a height in front of a 100k-indexed list. Do not blanket-disable transitions in menus, Viewer or accessibility/reduced-motion settings.

## Audit / reproducible acceptance coverage

| Surface and action | Discovered risk / current change | Gate |
| --- | --- | --- |
| Mobile Files scrolling near 48px | Old sticky Search animated max-height/padding in normal flow and fed back into scrollTop; replace with naturally scrolling, height-stable region | Built Chromium 375/390/899: Search moves with content; no transition/max-height; title/viewport fixed |
| Mobile Files folder A → B | Old content was reset before async counted range, then reset again after promise resolution; reset once on committed crumbs in pre-paint effect | React pending/committed test; built Chromium root/child, one scroll host, child scrollTop 0 |
| Mobile Files parent Back / ancestor crumb | Old folder position/persistence changed before navigation succeeded; keep until authoritative commit | React parent/ancestor pending tests; real browser child/parent |
| Mobile Files 100k virtual ranges / loading | In-flow pending caption shifts rows; dedupe identical ResizeObserver sizes; disable native scroll anchoring on controlled list | Mounted React source + 390px real Chromium; current large-scale numeric benchmark belongs to separate performance registry |
| Browse Home / Recent / Favorites | Different collection owns section scroll; should not cause outer chrome/sidebar/header resizing | Built 390px Chromium rail transitions |
| Saved last-folder resume / Search / Trash | Must preserve persisted folderID/scrollTop and avoid resetting on failed/rescoped request | Mounted saved 688px test, existing shared workspace and search/Trash tests |
| Across app switches (Overview ↔ Files) | Shared `main` stays mounted and could carry over scrollTop; reset only when `appView` changes | Real built Web App 390px app switch |
| Gallery Viewer enter/exit | Media anchor has dedicated lifecycle/virtual-row restoration; App-level reset must NOT fire for same-gallery Viewer | Existing Viewer browser/renderer tests retained, no Gallery model/scroll change |
| Wide Web / Desktop FileExplorer | Different presentation and transport; this Mobile-specific corrective PR does not redefine them | Existing Web/Desktop full CI and shared FileExplorer contract suites |
| Mobile PWA install / Android / iOS Safari, keyboard orientation, poor WAN | Physical runtime and OS behaviors not covered by Linux Chromium emulation | **Not measured** — separate device/browser/screen recording acceptance required |
| Other admin, storage, settings, background task pages | Shared App Frame scroll fixed at app-level, but each complex page's layout/route/jank under network updates not fully measured | **Partial/Not measured** — add page-specific regression evidence before claiming broad completion |

## Measurement / acceptance

- DOM header/scroll-host rectangles should remain fixed across folder and rail transitions (tolerance 1 CSS px); no duplicate scroll-owner; scrollTop 0 only after successful folder commit.
- Record failures and source-exact final CI. A built browser using bounded API fixtures confirms rendered layout and callbacks, **not** 100k real CAS, real Android/iOS frame pacing or WAN transport.
- Performance claims require separate n>=3 baseline, same-workload after measurements and the performance registry; no fabricated FPS, CLS or speedup.
- Race/security/durable transfer ownership remains outside this presentation-only corrective PR.

## First CI diagnostic and real Chromium evidence · 2026-10-15

- First actual PR source head `da6832b555c334ee2761157d3a219539a5827154`, [full CI #38722321549](https://github.com/lazyxu/xdrive/actions/runs/38722321549): **Web typecheck/lint/build passed; opt-in built production Chrome `files-ios27-chrome` browser passed** at 375/390/899 px with root → child → root, Search naturally scrolling, fixed 52px frame/Files chrome, Browse/Recent/Favorites switching, and Overview ↔ Files scroll ownership. The browser runner emitted `passed: true`, `unknownRequests: []`; see [real browser/screenshots artifact](https://github.com/lazyxu/xdrive/actions/runs/38722321549/artifacts/11966657884). This is Linux desktop Chromium touch emulation with bounded HTTP fixtures, **not physical iOS/Android** or proof of no jitter under all WAN conditions.
- First full CI is **RED** because a **legacy source assertion** in `desktop/tests/mobile-files-ios.cjs` still explicitly required `/maxHeight: scrollTop > 48/`, the layout mutation identified as the jitter source. Desktop test job had 2,633 passing and **one failing** test; it did not show an application/browser failure. That obsolete assertion must be changed to require the stable Search region and disable the scrolling max-height animation. Retain this diagnostic to avoid reintroducing it, and do not mark that first CI green.
- The next submitted **single work commit** must include the corrected test and pass its *own* complete CI/final gate. Until source-exact revalidation succeeds the PR remains Draft. No independent CPU/FPS/CLS or native iOS/Android results have been collected.


## P2 · URL deep-link during pending directory navigation (2026-10-15)

**Work baseline:** `master@d743a954ff7adff99b0bbc1fb9f1115ba4caab95`, after merged [#1683](https://github.com/lazyxu/xdrive/pull/1683), complete PR CI [#38723302971](https://github.com/lazyxu/xdrive/actions/runs/38723302971) and automatic branch cleanup. This P2 is a separate incremental Mobile-Web presentation fix, not a rewrite of the shared FileExplorer REST/navigation/range model.

**Additional source-identified edge:** `requestedDirectoryID` previously ran a pre-paint effect on a *new URL intent* and immediately persisted the unverified destination, called `scrollTo({top:0})` on the still-visible parent, and revealed Browse. That happens even while `WebFileExplorer` awaits the owner-authorized first counted page. It differs from the ordinary folder-row click fixed by P1, because the browser hash changes before the new directory is committed.

**Repaired boundary:** a different-folder route intent only advances its intent fence. Until the authoritative `crumbs` and first range commit, do not change the existing folder's scroll, persisted last accessible location, or Recent/Favorites rail. On successful commit, perform the Browse reveal and top-anchor reset in one pre-paint effect. A same-directory explicit URL may reveal Browse Home without a redundant Server lookup. Preserve previously restored scroll anchors for ordinary resume and do not conflate a failed deep link with an accepted folder.

**New tests:** three mounted `desktop/tests/mobile-files-ios-runtime.cjs` cases (pending/success/failure; Recent rail; same-folder URL), plus native production Chromium `--scenario=files-ios27-chrome`: real 390×844 Files root at scrollTop ≥420, actual browser URL switch to child, delayed first `GET /api/v1/nodes/2/children?offset=0`, verify the *old scroll host, old row, old persisted folder* remain unchanged while held; then release, verify only the committed child appears at scrollTop 0 and the same scroll host remains mounted. The script records source hashes, screenshots, network probes and JSON checks. This is bounded fixture-backed Chromium, not genuine WAN/Go latency nor native iOS/Android/PWA hardware verification.

**Delivery state:** Implementation and regression added; CI is required on the exact work commit before merging. Do not claim P2 is shipped or the delayed-request visual test passed merely because the contract was authored. Other App Frame/Admin/Gallery physical acceptance remains governed by the matrix above.


### P2 first CI invalid-harness diagnosis · 2026-10-15

- [Original full PR CI #38726189771](https://github.com/lazyxu/xdrive/actions/runs/38726189771) correctly failed (source `bb6ffdb0cbc9b5fb0e52ed4bc0e6bd6101ab437f`). The [Desktop job](https://github.com/lazyxu/xdrive/actions/runs/38726189771/job/116392524346) had one newly introduced test failure at `mobile-files-ios-runtime.cjs:2690` because the synthetic folder fixture mounts **two** `data-mobile-files-folder-id` nodes, not the hard-coded expected one. Prior 2,645 Desktop checks passed, including other P2 tests. This is an **invalid cardinality assumption**, not evidence the old folder was removed during pending navigation.
- The [real built Chromium Web job](https://github.com/lazyxu/xdrive/actions/runs/38726189771/job/116392525474) failed on a 10-second `document-001.txt` locator in the new deferred-route stage, **before the held route request was exercised**. An earlier acceptance stage had deliberately renamed `document-001.txt` to a Chinese fixture name; the failure DOM showed `document-002.txt` onward. This is a **fixture ordering/selector error**, not a true product navigation/geometry assertion failure.
- Corrective revision keeps production `web/src/MobileFiles.tsx` unchanged, compares the old folder-marker count **before and after** the held route (instead of assuming a number), and targets an unchanged root fixture item in Chromium. Both original invalid failures remain recorded here. The amended exactly-one-work-commit source must complete Desktop, authentic Chromium, full 76-job CI and Final Gate before merge; do not call the earlier run green or claim original P2 runtime effect proved by it.


### P2 second CI diagnosis · actual Chromium stalled-range evidence (2026-10-15)

- [CI #38727314027](https://github.com/lazyxu/xdrive/actions/runs/38727314027) ran amended head `b07dfc9819243b61e8f2bd63ffadc7cabfd072da`. **All Desktop tests passed**, and the genuine built Chromium runner held the destination first GET. The [Web job](https://github.com/lazyxu/xdrive/actions/runs/38727314027/job/116396619165) recorded: initial root `scrollTop=450`, pending root `scrollTop=450`; same one DOM scroll host, same saved folder ID 1, same visible title "我的文件"; after release committed child ID 2 at `scrollTop=0` with `nested-001.txt`.
- A newly authored assertion nevertheless marked the pending phase failed because `firstRow` (first **mounted overscan DOM item**) changed from "验收目录" to "验收重命名通过.txt" when the virtual window reconciled. The first mounted overscan item is **not** a fixed visible anchor and can change without any scroll or layout shift. This is an invalid test oracle, not proof of a product jitter regression.
- The same source-only one-work-commit is amended to compare actual scroll-host bounding rectangles (≤1 CSS px on y/width/height), stable `scrollTop`, one host identity, old folder title and persisted ID while the GET remains blocked. Keep `firstRow` in raw evidence but never treat overscan identity as the user's visual scroll position. P2 production `web/src/MobileFiles.tsx` remains byte-identical. Require exact amended-head built Chromium + full 76-job CI and Final Gate before merge.
