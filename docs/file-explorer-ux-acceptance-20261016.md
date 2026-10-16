# xDrive Files UX acceptance audit · 2026-10-16

## Evidence level and scope

Provider: GitHub `lazyxu/xdrive`. Fixed audited baseline:
`master@e3bdbcd9317ec82e54a7cb3bc75ae6680c2f90ea`; this follow-up
is isolated to `fix/files-batch-disabled-reasons-f03-u03-20261016`.
The checked working PRs at audit time (#1783, #1782, #1781, #1780,
#1748, #1685, #1589, #1185) concern other subjects. None is closed by this
audit. Do not delete those branches.

**The table is not a claim of completed physical-device testing.**
Code-path present means the corresponding implementation and/or test
was inspected; full functional acceptance additionally needs the named
scenario and its evidence. For test-execution and CI status use the exact
HEAD of this PR, not success from unrelated commits. Mobile Web/PWA use
the same Web business API; Desktop invokes Agent where applicable.
Keep the independent 52px global App Frame and the 900px breakpoint.

| ID | Code evidence / inspection outcome | Remaining acceptance |
| --- | --- | --- |
| F02 P1 | Shared Details ARIA full rowcount/group row index and Grid setsize/posinset; `desktop/tests/file-explorer-virtual-aria.cjs` covers 100k logical items | NVDA, VoiceOver, TalkBack and sparse live DOM |
| F03 P1 | Shared and mobile context menus use `FileExplorerMenuReasons`; **this PR patches previously missing selected-items More explanation** | Real permission responses and keyboard/long-hold screen reader |
| F04 P2 | Shared 6/8px separators retain geometry, widen invisible targets and support arrows/Home/End; `file-explorer-splitter-hitbox.cjs` | Real pointer, keyboard focus and high DPI |
| U01 P1 | Shared navigation/controller stages first counted range before committing; new mounted-hook regressions cover delayed 403/timeout and superseded 403/success without replacing prior rows | Browser Back/Forward, real permissions, aborted HTTP wire, focus and anchor |
| U02 P1 | Real compiled Chrome first-red in CI #38882962206 confirmed unsubmitted Search text and route survive 899→900→899 but focus is lost and caret [2,5] resets to end [10,10] at both responsive boundaries; Web common-owner focus handoff is proposed | Repaired exact-head browser RED→GREEN/full CI pending; actual Safari/Android, other dialog/scroll/scope cases remain |
| U03 P1 | Server-backed selection limits 200 mutation / 500 tags / 1000 download; mounted 257/1001 tests extended by this PR | Real 100k selection, disabled aggregate feedback and full action matrix |
| U04 P1 | `FileExplorerActionFeedback` and `FileOperationLifecycle` distinguish queued/running/cancel-requested/completed/failed | Correlate actual Server durable task receipt and terminal outcome |
| U05 P1 | Shared `FileNameDialog`, Web rename adapter and real Chrome intercepted 403→409→200 scenario | Real Server 403/409, stale Revision and UTF-8 boundary with retained focus |
| U06 P1 | Shared Search/Navigation and real MUI renderer fixture exist; U06-specific native Chromium Web CI gate added (outcome pending) | Verify synthetic 4096-item sparse Search → enclosing folder → Back/Forward, conditions/sort/group/selection/anchor; real authenticated Server and physical platform scenarios remain |
| U07 P2 | Existing `dir=auto` and isolated full item names; Unicode-specific source regression | RTL/CJK/emoji native rendering and accessibility |
| U08 P2 | Shared StatePanel remains the only component; Mobile zero-count now distinguishes pending Search, Search error, zero Search, true empty folder and Trash | Real offline/403/timeout and physical installed PWA need authoritative browser evidence |
| U09 P2 | Shared `FileExplorerVirtualSurface`, grouping and view snapshot/restoration | Anchor/selection across Grid/Details/Columns/Groups at 100k |
| U10 P2 | `FileExplorerThumbnailVisualState` distinguishes eligible failed loading without extra original request | Real RAW/video/Live failure and 100k viewport pressure |
| U11 P2 | `FilePropertiesDialog` plus media inspector adapter | Screen-reader ordering and hierarchy across ordinary/media files |
| U12 P2 | Shared `FileExplorerDestinationDialog` and destination-action tests | Short/landscape window, deep path and permission denial |
| U13 P2 | Shared feedback + task-view callback and dismiss-independent tests | Server retry, undo capability and durable-task continuity |
| U14 P2 | Shared keyboard resolver and real Web/Desktop/Mobile row handlers now fence composing key events and legacy 229; direct Node tests cover three profiles and pane keys | Actual Chinese/Japanese IME, Cmd/Ctrl, keyboard right-click and mixed external input on physical hardware |
| M01 P1 | iOS27 Mobile Files dedicated presentation/document contract | Side-by-side real iOS27 Files light/dark screenshots and gestures; not run |
| M02 P1 | `useMobilePanelViewport` and Mobile ResizeObserver exist | Safari/Chrome URL bar, software keyboard, focus and post-keyboard anchor |
| M03 P1 | Shared mobile gesture and pointer-drag code, touch-drag tests | Multi-pointer, OS swipe-back, long-hold then scroll, actual touch hardware |
| M04 P1 | Safe-area and 44px menu target rules exist | Short landscape and 200% text zoom, no clipped destructive actions |
| M05 P1 | Shared workspace navigation and explicit Viewer/Files paths | Real browser/PWA/OS Back semantic matrix |
| M06 P2 | Single folder title and on-demand ancestors; iOS27-10D tests | Deep CJK path and rapid ancestor navigation |
| M07 P2 | Recent/Favorites/Browse sections now preserve separate bounded virtual scroll anchors in account-scoped v1 state; existing Browse folder scroll stays independent | Per-section selection/search history, physical iPad/iOS/Android return still need verification |
| M08 P2 | Directory upload controller and picker support exist | iOS/Android relative path, empty folder, multilevel cancellation limitations |
| M09 P2 | `nativeFileShare` existing byte-sharing and 16MiB gate | System receiving apps, cancellation, fallback and device memory |
| M10 P2 | Keyboard/pointer handlers are shared where supported | iPad mouse/keyboard/drag/touch simultaneous input |
| D01 P1 | Desktop Agent capability gates and reconnect tests exist | Real legacy Agent missing capabilities, offline and upgrade-required messaging |
| D02 P1 | File availability indicator and CfAPI-related Desktop integration exist | Actual per-device CfAPI local/online/pinned/sync/error state |
| D03 P1 | Native open and Quick Look tests distinguish double click and Space | Open failure, missing shell program and focus restoration |
| D04 P2 | Native drag-out and drop tests exist | Finder/Explorer, unhydrated local file and cross-window cancel |
| D05 P2 | Shared navigation tabs and persisted session/history code exists | OS-native keyboard tab and restoration end-to-end |
| D06 P2 | Shared splitter width bounds/persistence and CSS responsive layout exist | Windows 125/150/200% DPI and short-height native Electron windows |
| D07 P2 | Agent session/reconnect and transfer tests exist | Actual Agent restart, stale progress rejection, committed bytes |
| P01 P1 | PWA install/auth/deeplink routes and Chrome test contracts exist | OS-icon launch from physical iOS27 Home Screen, not run |
| P02 P1 | Chrome tab/standalone modes are distinguished by runtime probes | Actual Android Chrome Installed vs tab behavior, not run |
| P03 P1 | `pwaUploadResume` and Server 8MiB chunk resume exist | Actual app swap/lock/kill/reselect on iOS/Android, not run |
| P04 P1 | Browser download/OPFS and real Gin/Chrome tests exist | Physical 1–4GiB final filesystem length and SHA256, not run |
| P05 P1 | `pwaUpdates` and real Chromium dual-window waiting-worker test exists | Actual iOS/Android installed uploads/Viewer/editor/multi-window |
| P06 P1 | Public SW offline asset boundary and private API exclusion are documented/tested | Installed cross-account private CacheStorage audit on actual deployments |
| P07 P2 | `pwaSafeReadRetry` bounded safe-GET retry and cancellation tests exist | Real network/401/403/429/503/certificate/timeout matrix |
| P08 P2 | `nativeFileShare` exists; no new background share pipeline | Physical system share sheet target/cancel/permission/fallback |
| P09 P2 | Foreground durable-task reconciliation and transfer entry exist | Cold installed icon launch returning to files and task state |

## Ordered handoff

1. F02/F04, U07/U10: baseline implementation found; do not duplicate. Mark **source inspected**, not physical passed.
2. F03/U03: finish this one-commit limited Mobile selected-items reason repair and mounted 257/1001 regressions. Demand exact-head CI.
3. U01/U02/U05/U06 and M02/M03/M05: execute original-browser transition and history tests using the existing shared workspace; repair only a reproducible first-red.
4. D01/D02/D03/D07: require native Electron/Agent session and file-locality fixture or physical Windows.
5. P01–P09: keep the S5 physical installation matrix **NOT RUN/NO-GO** until real signed-off device evidence. `docs/pwa-s5-acceptance.md` remains the release gate; never infer OS behavior from Android UA emulation.

Do not alter unrelated PRs, the 900px breakpoint, Server sort/group index,
permission limits, real download bytes, PWA private SW cache rules, Desktop
system-open semantics, or the shared 52px global title bar.

## U01 follow-up · committed-first-page regression (2026-10-16)

New deterministic hooked-controller tests mount the **original** `useXDriveCloudFilesController`
implementation. They intentionally hold a real first-page `port.getRange` Promise
behind a responsive Files navigation, reject with 403/timeout, and race stale 403/
success after a newer authorized folder commits. Assertions require the old
folder's *real items and crumbs* during pending/error, no stale false error,
no pending overwrite, and a settled loading indicator. No implementation,
Server contract, scroll host or navigation redesign is added. This is not
a screenshot/frame metric, end-to-end auth decision or actual HTTP cancellation:
those gates remain open. Exact-HEAD Desktop CI and full final-gate are required
before this test is credited as passed.

## U02 · Genuine selection-loss browser regression and scoped candidate

- Original source: CI [#38861059007](https://github.com/lazyxu/xdrive/actions/runs/38861059007)
  observed Mobile 899px selected Node 102 with `aria-pressed=true` and one
  bulk toolbar, then a 899px remount with no selected Node and no toolbar.
  No unknown API, console error or route change; wide Details DOM position
  originally lacked a row mount so this part of that first check alone does
  not prove selection loss.
- The original-browser script was corrected **only** to make the same real
  Node visible in existing wide Details via the real View menu before reading
  `aria-selected`. Its exact regression source Blob must remain unchanged
  through production repair; browser fixture responses stay unchanged.
- The candidate retains validated selected identities and their original
  item snapshots in the shared Web workspace through a responsive component
  remount. Mobile's first mount may consume the restored state, while a
  subsequent scope change invalidates it. Wide FileExplorer uses its existing
  controlled selectedIDs/onSelectionChange contract; Desktop stays untouched.
- No second HTTP controller or full folder materialization, permission
  escalation, PWA cache mutation, 900px breakpoint or 52px App Frame change.
  The 100k logical selection memory budget, cross-width editing dialog,
  search and focus/anchor cases remain separate acceptance gates. CI/red→green
  and PR merge must be verified on the exact submitted head.

## U02 nested Inline List selection · 899↔900 (2026-10-16)

The shared `WebFileExplorer` Mobile inline child range store must reset at
the 899/900 presentation boundary, but selected Node provenance must **not**.
The previous `selectedMobileScopeRef` compared the breakpoint-bearing
`inlineScopeKey`, clearing the selected child Node/revision/ancestor path when
Wide first mounted. A new actual-source `file-explorer-inline-store.cjs`
regression exercises a selected item in a **sparse 100k-child branch**,
tears down Mobile's inline child page at 900px, checks the original Node
Revision and containing path still resolve via the existing shared controller,
returns to 899px, and independently checks the account-B privacy reset.
The production repair changes only this bounded selection provenance scope
to existing `responsiveSelectionScope`; the inline store still resets
per presentation and never preloads the 100k directory. This is a deterministic
source-mounted test, not physical iOS or fully authenticated Server evidence.
Require the own exact-head full CI/Final Gate for the candidate.

## U06 · Shared production-renderer Chromium search return gate (2026-10-16)

The existing `desktop/scripts/file-explorer-search-return-browser.cjs` and
`file-explorer-search-return-browser.tsx` already mount the actual shared MUI
FileExplorer, Workspace, Navigation, Search filters and sparse VirtualCollection,
using a synthetic 4,096-result Server-range boundary. Previously the acceptance
ledger showed their source presence without a U06-specific exact-head browser
execution result.

This test-only change wires the existing runner into the **Web** CI job for
`test/files-search-return-chromium-u06-` branches, running native runner
Chrome/Chromium with a pinned Playwright-core module and verified PR-source
commit. It covers grouped deep Details/Grid return, Search→containing folder
→Back/Forward, query/filter/sort/group stability, selected IDs, scroll and
logical anchor restoration, responsive Grid, failed count/deep-window retry,
superseded scroll/new query, and changed result identities. Synthetic test
screenshots and the result JSON are retained as CI artifacts without private
user data. The ordinary CI final-gate still requires the Web job and other
required build/integration jobs to pass.

**At creation: NOT RUN / no passing evidence yet.** A first-red must be
classified as test harness failure or an actual original-product regression
before a production repair. This synthetic 4,096-item test does not prove real
authenticated Server 403/409/timeout, actual 100k files, hardware Web/Mobile
Web/Desktop or iOS/Android installed PWA navigation. The latter remain
explicitly unaccepted, and no file navigation, Server, REST/IPC, 900px breakpoint
or 52px App Frame production behavior changes in this test-only PR.

## U08 · Distinguish empty directory from zero Search and request failures (2026-10-16)

A `totalCount=0` in dedicated Mobile Files previously used a single
`这里还没有文件` text for an empty directory, empty Trash and a Search that
had zero results or whose first count failed. Reuse the existing exported
shared `XDriveStatePanel` with a single zero-state owner. For Search,
distinguish `resultCount=null` still pending, a genuine error (retaining
the existing Server error/Retry control), and authoritative zero results.
A root with a real empty first page uses `此文件夹为空`; Trash has its own
`最近删除为空`. Preserve the existing loading refresh overlay when older
nonempty content is committed; do not replace old rows with an empty spinner.
This is **presentation-only**: no permission inference from an unknown
state, REST, Server sort/groups, virtual range, SW CacheStorage or uploads.
Actual offline/403/network timeout and physical iOS/Android PWA remain
separate real browser/device gates. Require exact-head CI and Final Gate
before Ready/merge.

## M07 · Recent/Favorites independent virtual scroll anchors (2026-10-16)

Source inspection established a concrete bug: `changeSection` restored the
single Browse folder scroll but unconditionally set the next Recent or
Favorites scroll offset to **zero**. This discards each collection's logical
virtual row every time the user switches between rail tabs.

Reuse the EXISTING Mobile Files per-account v1 localStorage record, adding
only optional, bounded `recentScrollTop` and `favoritesScrollTop`
presentation offsets. Older records keep their exact default decode.
The single existing 200ms scroll-flush timer also writes rail offsets,
so no extra listener/interval or 240/100k item materialization appears.
Changing a section flushes the prior offset before changing the one shared
scroll host. Browse `folderID/scrollTop` and its authenticated navigation
remain independent, and the new account's storage key does not restore
another account's offsets. Mounted source tests cover 240 virtual items,
Recent→Favorites→Recent→Favorites restoration, Browse state isolation,
old state compatibility and bounded invalid offsets. No Server API,
selector limit or 900px breakpoint changes. Per-section selected-item
and Search states remain separate, unaccepted M07 subcases; real installed
PWA/iOS27/Android physical navigation remains NOT RUN.

## U14 · Shared FileExplorer IME composition keyboard isolation (2026-10-16)

Original-source inspection found the shared shortcut resolver still mapped
composing Enter/Space/F2/Backspace to File Open/Quick Look/Rename/Back.
Direct wide Web/Desktop and Mobile item rows, inline Rename, path editor and
focusable splitters did not consistently guard composing keys; type-to-select
and Mobile root native-isComposing checks were insufficient.

This bounded fix adds ONE exported shared typed composition guard for
native/synthetic isComposing and legacy keyCode=229; the original shared
shortcut/numbered-tab and MUI row/root/inline/path/splitter and compact
Mobile Files row/root handlers invoke it before file actions. Non-composing
shortcuts, native Desktop system double-click, Space Quick Look, existing
permissions, 900px responsive boundary, 52px App Frame and 100k virtual
collection are unchanged. Existing Desktop tests inspect actual handlers,
transpile the real keyboard helper and exercise Windows/macOS/Web profiles.

**Exact-HEAD CI: NOT YET RUN at PR creation.** Physical Chinese/Japanese IME,
actual assistive technology, iOS27/Android installed PWA and external keyboard
validation remain NOT RUN until independent authentic device evidence.

## U02-B · Pending Mobile Rename draft across 899↔900 (2026-10-16)

The real Web adapter renders compact <MobileFiles> or wide <XDriveFileExplorer>
mutually exclusively at the existing 900px boundary. Source audit finds compact
Rename ownership in MobileFiles local renaming state and the corresponding
FileNameDialog beneath that conditional component, while shared WebFileExplorer
owns the actual authenticated rename request and current Node/revision.

This **first-red/test-only** phase adds a bounded native Chromium regression
to the existing original **built-Web** Files iOS27 runner (no copied presenter
or added API). It opens the genuine context-menu Rename dialog for original
Server-fixture Node 101 at 899px, types a draft **without submitting**, crosses
900px, returns to 899px, and requires the exact draft/dialog to survive, while
making zero PATCH requests and retaining one FileExplorer scroll owner. It runs
only for the focused U02-rename PR branch, in addition to the current base
375/390/899/900 Files runtime, selection and navigation cases. Evidence
includes the test-only original source SHA, 3 viewport screenshots and the
synthetic-result JSON.

**At test-only PR creation:** first-red NOT RUN. Do not claim a production bug
solely from component source. If original compiled Chrome confirms RED, preserve
the test unchanged and make the narrowest parent-owned rename-state repair
in this same fixed-parent single-work-commit branch, then require entirely
new exact-head complete CI. No changes to iOS 27 visual, 52px App Frame,
900px threshold, Server permissions, Web/Desktop shared backend or 100k
virtualization. This does NOT prove real Safari/Android, physical IME, actual
403/409 after a viewport transition or Desktop/OS-specific hardware.

### Original built-Web first-red evidence and repair scope

- **Exact original test-only HEAD:** `10acd3a98694e51e0878ded0ecd73fd278e3edca`, [full CI #38877483489](https://github.com/lazyxu/xdrive/actions/runs/38877483489), Web job 116895930346, real Chrome built from original Web App. Original 899px had precisely one renamedraft `待提交-跨断点重命名.txt`, route `#/app/files?dir=1`, single scroll host and zero PATCH. At 900px original dialog count=0/name=null, and returning to 899px was still missing. Precisely **two** new U02-B assertions failed; the original selection/navigation/403/409 cases passed, with zero unknown requests/page errors. This is a genuine presentation-lifecycle bug, not a fixture or Server error.
- **Immutable original first-red browser runner blob:** `4bafb3d19af125f41c28647234ddae1b3be7ed48`; unmodified focused Node test blob `b94fdaa84714c5afe181abd428f51c3ea68cf855`. Neither assertion or runner changes in the repair.
- **Minimal repair:** one common WebFileExplorer owner holds only the pending Mobile rename item/scope and renders the EXISTING shared XDriveFileNameDialog outside the 899px/900px conditional. MobileFiles delegates the actual Web rename-dialog opening through one optional presentation callback, while retaining its existing local fallback for independent consumers/tests. The original Web renameItem, Server ACL, canonical Node/revision, dialog validation/error/focus, 200-item mutation limit and transport are unchanged. Scope fences the draft to authenticated account, directory, Search/Trash and exact virtual collection; owner/scope change closes it rather than storing private content.
- **Delivery:** Repair candidate must pass entirely new exact-head 76-job CI/Final Gate, including the frozen original U02-B browser assertion from RED→GREEN. Real iOS27/Android/installed PWA and physical 403/409 or IME across resize remain NOT RUN.

## U02-C · Unsubmitted Search focus/caret on 899↔900 (2026-10-16)

- **Related work reconciled:** #1791 original selection and #1819 pending Rename draft were exact-head CI green and Ready/Rebase-merged, with their old branches gone. #1822 P26 nonessential loading-status suppression was exact-head CI green and merged/cleaned before this new branch. Preserve one underlying Web search state/API; keep unchanged 900px breakpoint, 52px App Frame, Server sort/group indices and shared VirtualCollection.
- **Source-supported unverified hypothesis:** WebFileExplorer alternates real MobileFiles and XDriveFileExplorer components on breakpoint. Search draft value lives in the shared Web workspace, but the focused DOM input and selected caret range are presentation-local. Switching width while editing may drop focus and caret without losing the value.
- **Immutable first-red plan:** add only one new branch-gated case to the *original compiled-Web* Chromium Files iOS27 script. On authorized existing Server fixture root, focus Mobile Search input, type a non-submitted draft, select a specific UTF-16 character range, then cross 899→900→899, checking the draft, true document.activeElement, caret range, one virtual scroll owner, unchanged route and **zero new Search API requests**. Preserve all existing original 375/390/899/900, U02 selected-node/rename, P9/P10, dialog and navigation regression cases. Record real screen snapshots and source hashes.
- **At test-only PR creation:** CI NOT RUN; do not infer a defect merely from React remount. If actual first-red reproduces focus/caret loss, preserve this exact browser script + test blob unchanged, and amend one frozen-parent work commit with the narrowest shared Web focus handoff (not a second Search controller, cache or retained hidden renderer). Require fresh exact-head complete GitHub CI/Final Gate and RED→GREEN. Physical iOS27/Android Installed PWA, OS keyboard, VoiceOver/TalkBack and genuine 100k are separate NOT RUN.

### U02-C first CI was an invalid oracle, not product RED

- Test-only HEAD `984e96a66433b53be508f9aa9973bd482ace83e4`, [CI #38882211736](https://github.com/lazyxu/xdrive/actions/runs/38882211736), Web Chrome step failed **before the first focus assertion**. Its `locator.waitFor` erroneously expected literal `input[aria-label="搜索全部文件"]`; the actual MUI input has a correctly exposed accessibility-tree `textbox "搜索全部文件"` but its label is not necessarily a literal input DOM attribute. No new Search or external API requests, page errors or production exception; cannot classify this result as focus loss.
- Rebuild exactly one test-only work commit on the SAME frozen parent with only the browser test selector corrected to the real existing `data-mobile-files-search-region input` and wide `input[placeholder="搜索全部文件"]` DOM anchors. Keep all draft, selected range, true `document.activeElement`, request-count and route assertions unchanged, preserve Node source-contract Git Blob `0241129ab116b612df3e3efe6c90cf8a0d8477f2` byte-for-byte. Require a NEW exact-head Chromium run before concluding RED or modifying production. Do not use the invalid run for merge.

### U02-C exact original production Chromium First-red and minimal correction

- **Corrected test-only HEAD** `dcc1b1929583de421bacd613006eae9ee782bcc2`, [CI #38882962206](https://github.com/lazyxu/xdrive/actions/runs/38882962206), original compiled Web Chrome job 116914278902: **exactly two first-red checks**. At 899px the original Mobile Search textbox had focused value `跨断点未提交搜索草稿` and character range [2,5]. At 900px original wide Search had the same value and current route `#/app/files?dir=1` with one scroll owner, but **focus=false, selection [10,10]**; 899px return also focus=false, selection [10,10]. No new `GET /api/v1/search` (`initialSearchCount=0, actual=0`), unknown request, app page error or console error. Original selection/rename and layout/navigation cases passed. This is a measured original-source focus-lifecycle defect, not a Search/Server data error.
- **Freeze unchanged first-red tests:** original Chrome runner blob `b880a30538a410f76f5027de5c1355b12d75bbfa`, original Desktop source regression blob `0241129ab116b612df3e3efe6c90cf8a0d8477f2`. Neither assertions nor actual Server fixtures are modified during the production repair.
- **Scoped fix candidate:** only `web/src/WebFileExplorer.tsx` long-lived Web workspace tracks ephemeral `document.activeElement` and native input caret selection while the real Search field is focused; on the true 899/900 mode transition it focuses the newly mounted corresponding real input with `useLayoutEffect` before paint and restores the precise caret range. Ordinary focus moving to other controls clears pending handoff. The root-scoped native select listener is cleaned up, and the focus state is guarded by the same existing responsive account/folder/Search/virtual collection scope. No new Search controller/REST, persistent private draft, hidden renderer, extra server request, injected keyboard event, animation delay, virtual collection or 900px/52px shell change.
- **At repair commit creation:** accurate-head repaired full CI is NOT YET RUN. Need the immutable original built-Web RED→GREEN, Desktop/Go Linux/API/Windows/full final-gate and one-work-commit before Ready/Rebase Merge. Native iOS27/Android/installed PWA, actual OS keyboard, NVDA/VoiceOver and 100k physical remain NOT RUN.

### First scoped production candidate rejected; next candidate uses native focus events

- First repaired head `2c11d723313a96ae18abc2f14afdb025072525fc`, [CI #38884039840](https://github.com/lazyxu/xdrive/actions/runs/38884039840), real built-Web job 116917550221 **failed**, and is NOT valid acceptance. The candidate transferred focus across both widths but changed original Search controlled input behavior: at 899px immediately after typing the test's text snapshot was an empty draft, selection [0,0], and the same empty state followed at 900px and 899px. Existing server request count stayed zero, with one scroll owner and no page errors. Therefore it is a product regression introduced by this candidate, not a passing red→green; do not merge or reuse its CI status.
- Rebuild the same ONE work commit on original frozen base and keep the original valid first-red runner blob `b880a30538a410f76f5027de5c1355b12d75bbfa` and Node contract blob `0241129ab116b612df3e3efe6c90cf8a0d8477f2` unchanged. Remove `onFocusCapture`/`onSelectCapture`/`onBlurCapture` from the shared React Box: these were the only newly introduced event hooks on the React search-input tree. Use only root-scoped native `focusin`, `select` and `focusout` listeners to sample actual active Search input and caret without participating in React synthetic input event propagation; unbind every listener on cleanup. Retain pre-paint `useLayoutEffect` handoff, existing authenticated scope and no new Search controller/REST/cache.
- **Second candidate status at creation:** exact-head full CI/browser RED→GREEN NOT RUN. If the original Search draft is again changed or focus/caret is not retained, mark this candidate failed, diagnose the original useEffect/input lifecycle before another source revision. Keep focus test immutable, 900px breakpoint unchanged, and all physical mobile/PWA/VoiceOver tests NOT RUN.

### Second production candidate rejected; passive breakpoint observation replaces input listeners

- Second production candidate `0c3318a44441baabcdf74a71fdadb9256e030426`, [CI #38884806258](https://github.com/lazyxu/xdrive/actions/runs/38884806258), exact-head original built-Web job 116920264488, also FAILED: the native `focusin`/`select`/`focusout` input listeners retained focus through both widths but the controlled draft was empty even at initial 899px, caret [0,0], and three original Search assertions red. Real Server Search requests remained zero and prior unrelated Files checks remained intact. This is a rejected candidate, NOT release evidence. Both attempted input-focus event hooks proved intrusive; do not repeat them.
- Third bounded candidate observes **only the existing media-query breakpoint's `change` event in capture phase**, so it reads actual input focus and UTF-16 caret once while the old presenter remains visible and never attaches events to React-controlled Search input elements. After React commits the actual new 899/900 presenter, the shared Web layout effect transfers focus and caret before paint; it is scoped to current account/folder/Search/virtual-collection, has no background polling or Search submit, and removes the media-query listener on cleanup. Preserve original Chrome test runner Blob `b880a30538a410f76f5027de5c1355b12d75bbfa` and original Desktop test Blob `0241129ab116b612df3e3efe6c90cf8a0d8477f2` BYTE-FOR-BYTE, along with frozen source parent.
- **Third candidate exact-head CI has not run at this point**. Do not infer success from lint/build or earlier failed runs. Require original corrected 899px draft=true/focus=true/caret=[2,5], both new widths with same data and zero Search GET, then all full GitHub CI/final-gate before Ready/Rebase Merge. If this candidate fails, leave PR Draft and record the failure rather than weaken the immutable first-red assertion.

### Third candidate genuine browser failure and fourth bounded lifecycle handoff

- Third candidate `275f11e5bf4fb7a12ff1de5529e1db835eb00911`, [CI #38886138439](https://github.com/lazyxu/xdrive/actions/runs/38886138439), original built-Web Chrome job 116924222848: the initial accepted 899px Search draft and focus/selection [2,5] were restored compared to rejected input-event candidates, but the original two breakpoint focus/caret assertions remained RED at 900px and 899px return. The draft, route, one scroll owner and zero Search GET all stayed correct. The media-query-only capture did not produce a usable focus handoff. **Do not merge or claim pass.**
- Fourth narrowly scoped candidate keeps unchanged `WebFileExplorer` shared Web Search state and immutable original browser/Node test Blobs. It adds a `useLayoutEffect` cleanup on the outgoing old responsive view to capture `document.activeElement` and the Search UTF-16 selection before React replaces the real input. The new layout effect consumes that temporary snapshot and focuses/sets selection on the newly mounted corresponding real input, before paint. The earlier capture-phase breakpoint listener remains as a fallback only. Neither old nor new Search input has synthetic/native focus/select handlers, avoiding the proven draft reset; no additional REST, virtual list, private localStorage or document scrolling.
- **Fourth candidate acceptance still pending exact-head CI:** unchanged original 899px draft focus selected [2,5] AND both 900/899 handoffs must pass with no Search GET; complete 76-job CI, Web/Go/Windows/Desktop, single commit and final-gate required before Ready. A further failure must be recorded as blocked without weakening the original regression, with physical iOS/Android/Safari/PWA and screen-reader cases explicitly NOT RUN.

### Fourth production candidate rejected; outgoing presenter cleanup snapshot

- Fourth candidate exact-head `d04ac5f3fd5ea9cdab9272a7757ff94ff2159bc8`, [CI #38886862414](https://github.com/lazyxu/xdrive/actions/runs/38886862414), genuine Chrome job 116927110407: the 899px typed draft was preserved and focused with caret [2,5], but both 900px and returning 899px remained focus=false, caret [10,10]. This is another **genuine failed focus-handoff candidate** (not product first-red and not merge approval). The parent layout effect cleanup / matchMedia change listeners did not snapshot the old focused Search element before React unmounted it. No unknown requests, no new Search GET, no route or scroll-owner change.
- Fifth candidate keeps both first-red test files byte-for-byte unchanged. The outgoing **actual MobileFiles or shared MUI FileExplorer component** snapshots its own native Search input in its own `useLayoutEffect` unmount cleanup (before its native host node is detached); an optional callback passes only focused UTF-16 caret coordinates to the one existing Web parent. On new presenter mount the common Web `useLayoutEffect` consumes the snapshot and restores focus/caret synchronously. No react/native input event listeners, no always-on matchMedia listener, duplicate Search instance, Server API/cancellation changes, extra virtual scroll host, persistent private text, or 900px/52px shell changes. Desktop callers omit the optional callback and retain behavior.
- **Fifth candidate status at creation:** exact HEAD Chrome/76-job CI NOT RUN. Require unchanged original 899px draft/focus/selected range and accurate-head 900px and return 899px GREEN with zero unintended Search/Server requests, then complete 76-job final-gate. If still red, retain Draft and evidence rather than weakening the browser oracle. Physical iOS/Android, VoiceOver/TalkBack, actual 100k and system keyboards NOT RUN.

### Fifth candidate rejected; document selectionchange-only handoff

- Fifth candidate `83aa551263d1c164c407ed4c8fdc23f7eaa9f687`, [CI #38887987412](https://github.com/lazyxu/xdrive/actions/runs/38887987412), native original Chrome job 116930457652, **FAILED**: 899px Search draft was empty and caret [0,0] immediately after the standard fill/selection, and both 900px and returning 899px were likewise empty even though focus=true. No Search GET or route/virtual-scroll regression. Like the earlier input-event-hook candidates, adding cleanup handlers inside React-controlled input presenters is not acceptable; discard it, not production-approved.
- Sixth candidate uses only the **existing long-lived WebFileExplorer**, restoring the original child `web/src/MobileFiles.tsx` and shared `ui/shared/src/mui/FileExplorer.tsx` byte-for-byte from frozen base. It observes only the browser's `document.selectionchange` event, with a passive read of the current focused Search input/caret into an in-memory ref. This avoids new handler props or React input focus/select/change events. During a genuine compact/wide presenter swap, the common Web layout effect restores the last selected character range, unless another surviving dialog/control owns focus. No duplicate Search data model, background polling, Server calls, private persistence or scroll owner. The two original Search focus first-red browser/source test blobs remain unchanged.
- **Sixth candidate at construction: NOT RUN.** Existing untouched first-red Chrome must first show the initial 899px nonempty draft/focus/[2,5], then both 900px and 899px GREEN, no Search GET and full exact-head 76-job CI/final-gate. Do not merge merely on lint/build; if any candidate fails leave Draft and preserve evidence. Real iOS/Android/PWA, assistive technology, genuine Server 403/409 and physical 100k remain NOT RUN.

### Sixth candidate pre-CI review — nonbubbling input selectionchange

- Initial sixth candidate `6ac900dc591d90d1b041a343505842f69e009414`, CI #38888864204, remained **pending with 0 allocated jobs** during review, so it had no browser result and was **not** an accepted test. Review identified that native `selectionchange` on input elements need not bubble to `document`; `document.addEventListener('selectionchange', handler)` (default bubbling mode) may never see the input's selection event.
- Correct only this listener to capture phase (`addEventListener('selectionchange', handler, true)` and matching cleanup). The listener still executes at DOCUMENT root rather than attaching to the React-controlled input, and it only reads `document.activeElement` and the caret range. No new React props, no DOM mutation or extra Search requests. Recreate the ONE frozen-parent work commit, cancel/replace the unstarted CI through GitHub's existing concurrency policy, and require the new accurate-head unchanged genuine Chrome RED→GREEN plus complete final-gate before merge. Previous failures and true native device gaps remain documented.

## M03 · second-pointer native gesture ownership (2026-10-16)

- Source audit found `useXDrivePointerDrag` already cancels its own pending/active
  file drag on an additional pointer but also called `preventDefault()` and
  `stopPropagation()` on that *second contact's* `pointerdown`. This could
  block the browser's native multi-touch gesture before it handles the contact.
- The narrow shared-hook change retains xDrive cancellation, original-contact
  click suppression and no-drop behavior but leaves the second contact's
  browser event/default action untouched. No Web/Desktop business API, File
  selection, Server mutation, gesture threshold, navigation, 52px header or
  900px breakpoint changes.
- `desktop/tests/file-explorer-pointer-drag.cjs` adds mounted hook assertions
  for *both pending and dragging* contacts: second contact not prevented or
  propagation-stopped, exactly one own-session cancellation, no drop, original
  compatibility click suppressed, second pointer click unblocked and listeners
  cleaned. The assertions would fail on the original source's second contact.
- **Delivery level:** code+regression candidate; exact-work-HEAD GitHub full
  CI/Final Gate and merge are required before calling it delivered. Native
  iOS 27/Android, system back swipe, pinch, mixed input and real long-hold
  gesture acceptance are **NOT RUN** and remain on M03's release checklist.
