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
| U02 P1 | Actual built-Web Chromium first-red #38877483489 confirmed Mobile Rename draft disappears at 900px, still missing at 899px return, zero PATCH and stable route/scroll host; common Web-owned Rename repair in one-commit PR | New exact-head red→green/full CI pending; other Search/focus/dialog/anchor and physical Safari/Android acceptance remain |
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
