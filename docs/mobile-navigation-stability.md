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
