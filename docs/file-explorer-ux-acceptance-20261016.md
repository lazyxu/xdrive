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
| U02 P1 | 899.95px breakpoint and one shared Web workspace; Chrome 375/390/899/900 acceptance exists | Cross-boundary live state matrix (scroll, search, dialogs, selection) without reload |
| U03 P1 | Server-backed selection limits 200 mutation / 500 tags / 1000 download; mounted 257/1001 tests extended by this PR | Real 100k selection, disabled aggregate feedback and full action matrix |
| U04 P1 | `FileExplorerActionFeedback` and `FileOperationLifecycle` distinguish queued/running/cancel-requested/completed/failed | Correlate actual Server durable task receipt and terminal outcome |
| U05 P1 | Shared `FileNameDialog`, Web rename adapter and real Chrome intercepted 403→409→200 scenario | Real Server 403/409, stale Revision and UTF-8 boundary with retained focus |
| U06 P1 | `file-explorer-search-return-browser` and shared navigation/query code | Real Search → enclosing folder → Back, conditions/sort/focus/anchor |
| U07 P2 | Existing `dir=auto` and isolated full item names; Unicode-specific source regression | RTL/CJK/emoji native rendering and accessibility |
| U08 P2 | `StatePanel` handles loading/empty; Controller status and error code paths exist | Distinguish offline, first-page pending, 403, timeout, zero-search in a real browser |
| U09 P2 | Shared `FileExplorerVirtualSurface`, grouping and view snapshot/restoration | Anchor/selection across Grid/Details/Columns/Groups at 100k |
| U10 P2 | `FileExplorerThumbnailVisualState` distinguishes eligible failed loading without extra original request | Real RAW/video/Live failure and 100k viewport pressure |
| U11 P2 | `FilePropertiesDialog` plus media inspector adapter | Screen-reader ordering and hierarchy across ordinary/media files |
| U12 P2 | Shared `FileExplorerDestinationDialog` and destination-action tests | Short/landscape window, deep path and permission denial |
| U13 P2 | Shared feedback + task-view callback and dismiss-independent tests | Server retry, undo capability and durable-task continuity |
| U14 P2 | Shared keyboard module and Desktop native-open tests | Actual Cmd/Ctrl/IME, F2/Delete/Space, right-click and mixed input |
| M01 P1 | iOS27 Mobile Files dedicated presentation/document contract | Side-by-side real iOS27 Files light/dark screenshots and gestures; not run |
| M02 P1 | `useMobilePanelViewport` and Mobile ResizeObserver exist | Safari/Chrome URL bar, software keyboard, focus and post-keyboard anchor |
| M03 P1 | Shared mobile gesture and pointer-drag code, touch-drag tests | Multi-pointer, OS swipe-back, long-hold then scroll, actual touch hardware |
| M04 P1 | Safe-area and 44px menu target rules exist | Short landscape and 200% text zoom, no clipped destructive actions |
| M05 P1 | Shared workspace navigation and explicit Viewer/Files paths | Real browser/PWA/OS Back semantic matrix |
| M06 P2 | Single folder title and on-demand ancestors; iOS27-10D tests | Deep CJK path and rapid ancestor navigation |
| M07 P2 | Recent/Favorites/Browse are distinct Mobile sections | Preserve distinct scroll/selection/search per section across cold/soft return |
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
