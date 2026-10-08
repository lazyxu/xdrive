# Mobile Web

## Direction and scope

Use one shared business/controller layer and one shared React/MUI component layer, with an adaptive presentation for a narrow Web viewport. Keep Web routing, authentication and platform APIs in `web`; keep common navigation and workspace layout in `ui/shared/src/mui`.

The first delivery is the shared workspace shell. It does not change file selection/open gestures, Gallery gestures, upload/download capabilities or desktop preferences. Those follow after the shell provides stable space and navigation.

| Priority | Delivery | Acceptance focus |
| --- | --- | --- |
| P0 / phase 1 | Shared compact shell | Reach all permitted workspaces; stable viewport and scroll roots; no background navigation through Viewer |
| P0 / phase 2 | FileExplorer touch interaction | Explicit open/select/multi-select and row actions; compact panels; usable command bar |
| P0 / phase 3 | Gallery and Viewer touch interaction | Discoverable controls; touch browsing/zoom; retain the caller's collection and scroll |
| P1 | Upload, download and sharing | Capability detection, visible progress and recovery after interruption |
| P1 | Tasks, sync folders and storage | Narrow forms, task actions and summaries |
| P2 | Administration and install experience | Mobile admin pages, existing manifest/install experience and subsequent enhancements |

## Phase 1 contract

### Navigation

- `XDriveWorkspaceSidebar` is still the only full navigation component consumed by Web and Desktop.
- Responsive Web uses compact navigation below the shared MUI `md` breakpoint (900 CSS px). At 900 px and above, retain the sidebar. Desktop's non-responsive shell retains its existing sidebar and 960 px width adjustment.
- The compact primary destinations are `overview`, `files`, `gallery`, `transfers`, followed by a More button. Home comes from the caller's sections. The compact transfer label is “任务”; the existing workspace key remains `transfers` and the existing Web route remains `tasks`.
- More derives all remaining destinations from the same core model and extension sections. Preserve ordering, section labels, badges, optional local storage and caller-provided role filtering. More is local UI state, not a new route.
- Selection flows through the existing `onSelect(destination, event)` callback, preserving Ctrl/Cmd. Opening or dismissing More does not navigate. Choosing an entry closes More and invokes the callback once.
- New compact navigation targets are at least 44 CSS px tall. The bottom navigation is in layout flow, outside the content scroll container, with safe-area padding.
- Close More when the selected workspace changes, navigation becomes disabled, or compact navigation unmounts on a wide viewport.

### Viewport and scrolling

- The authenticated Web workspace fills the dynamic viewport, with a `100vh` fallback. Keep `minHeight: 0` through the flex/grid chain, prevent a second document scroll container, and retain safe areas without suppressing browser zoom.
- The same `WorkspaceContent` main element remains mounted across responsive breakpoints. Page workspaces, including Gallery, scroll this element at every width. Gallery virtualization discovers this scroll ancestor once, so breakpoints must not replace it.
- Files use the full remaining content area, without the old 560 px mobile height or the WebFileExplorer's 420 px minimum. The shared explorer owns its internal scrolling.
- Viewer remains a sibling overlay over the existing workspace. Its background retains layout and DOM but is inert while Viewer is active. The More portal is closed/disabled. Do not key or replace the workspace by Viewer route.
- `100dvh` is a viewport layout choice, not a claim that virtual-keyboard behavior is solved on every browser. Native iOS/Android keyboard and safe-area validation remains part of device acceptance.
- Retain the existing viewport metadata in this phase. Enabling `viewport-fit=cover` changes the coordinate space for Viewer, authentication and public-share surfaces too; enable it only with those surfaces' safe-area acceptance. Shell padding already respects any safe-area insets the browser reports.
- Viewer also closes the account menu, settings and account update-confirmation portals. These are part of Shell chrome and must not survive above the Viewer or reopen on return.

## Implementation boundaries

Shared files own the core navigation model, compact navigation, Shell and Content. `web/src/App.tsx` continues to own route mapping, role-filtered administration and the authenticated viewport/Viewer boundary. The password-change surface also consumes shared Content; its document scrolling must remain usable.

No server API, browser-history policy, directory/tab state, selection, persisted desktop pane width or column preferences change in this phase. Do not duplicate navigation rules or introduce a mobile router.

## Validation

The initial baseline is `92b7d58370542fd0597433fdc4c3969e325a113c`. Before changes, the 32 existing shell/navigation/runtime tests and workspace-surface check pass.

Use behavioral Node tests for model projection, actual Web role-filtered sections, selection, More lifecycle and event identity. Keep the existing shared ownership and route regression checks. Use a real renderer for viewport bounds, drawer focus/closing, scroll-root identity and preservation of mounted content; a hook mock or SSR is not evidence for layout/reconciliation.

Exercise 390×844, 899×700, 900×700 and a wide desktop viewport, including narrow → wide → narrow. Check both ordinary and administrator navigation; short/landscape heights; Files internal scrolling; Gallery's main scrolling; Viewer open/close with an unchanged background DOM. Record tested environments and any remaining device-only checks with the delivery.

### Phase 1 delivery record — 2026-10-08

**Status: Implemented; Draft PR, blocked on browser QA.** The implementation and automated checks are ready for review. Do not mark the change merge-ready until the real-renderer acceptance above has passed.

| Check | Result |
| --- | --- |
| New compact navigation and account-portal behavior | 15 passed; initial missing navigation and account-portal regressions were observed failing before implementation/fix |
| Desktop `npm run typecheck` | Passed |
| Desktop `npm run test:main` | 918 tests: 917 passed, 0 failed, 1 existing opt-in 100k scroll CPU benchmark skipped |
| Web `npm run lint` | Passed: TypeScript, Chinese GUI, workspace ownership/layout guards and icon assets |
| Web `npm run build` | Passed; existing Vite large-chunk warning remains |
| Independent code review | The global viewport-meta and account-portal issues were fixed; no remaining Critical/Important code findings in the reviewed scope |
| Real-renderer acceptance | **Blocked, not executed** |

Local validation used Node 24.19.0 with the repository's Web lockfile and Desktop package dependencies. The official Playwright Chromium and headless-shell downloads returned a 195-byte HTML “Site Unavailable” response rather than an archive. The local Vite preview started successfully, but the available remote browser could not connect to that loopback service (`ERR_CONNECTION_REFUSED`). No browser layout, touch, focus, DOM-preservation or physical-device pass is claimed.

Before leaving Draft, run the real app with a bounded API fixture or a test server at the listed viewports. Include More close/Escape/backdrop/focus, narrow → wide → narrow, actual Files/Gallery scroll hosts and the browser Back → account menu/settings → Forward to Viewer path. The latter must also close update confirmation without executing an account action. Keep native iOS/Android keyboard and safe-area checks explicitly separate from desktop browser emulation.


### Phase 2 implementation record — 2026-10-08

**Status: Implemented on the dependent mobile FileExplorer branch; browser/device QA pending.**

- Shared FileExplorer now detects the compact touch presentation only when the viewport is below the shared 900 CSS px boundary **and** the primary pointer is coarse. Item activation still inspects the actual pointer event, so mouse clicks keep desktop selection/double-click semantics even when the compact layout is active. Desktop mouse interaction keeps single-click selection, double-click open, Ctrl/Cmd/Shift selection, resize splitters and drag behavior.
- Compact touch uses single-tap Open outside selection mode. “选择” or a 450 ms long press enters explicit multi-select; subsequent taps toggle items until “完成”. Scroll motion cancels long-press selection and suppresses the corresponding click so a swipe cannot open an item on release.
- Details mode projects to a single responsive Name column with a 52 px touch row without writing back desktop column visibility, widths or density. Compact touch exposes only List/Grid view choices and uses a fixed medium grid projection, so mobile view changes do not overwrite desktop details density or grid-size preference. Navigation becomes an on-demand Drawer without mutating the persisted desktop sidebar preference. The desktop Inspector side pane is suppressed on compact touch; Properties remains available from the item action sheet.
- Every touch item exposes a 44 px More target. Item actions use a bottom sheet on compact touch while desktop keeps the pointer-position context menu. The compact command bar exposes upload, view/sort, selection and overflow actions with 44 px targets; selection mode keeps copy/download/delete primary while cut and other lower-frequency operations stay in More.
- Mobile search collapses to an icon until invoked; Forward/Refresh leave the compact address row and Refresh remains available from the overflow menu.
- Native touch drag/reorder remains out of scope for this phase. Internal/external desktop drag/drop behavior is unchanged; touch move/copy continues through explicit file actions.

Before this phase is merge-ready, validate tap/long-press/scroll discrimination, selection actions, action-sheet focus and dismissal, navigation Drawer, 360/390/430 px portrait, landscape, and a mouse on a touch-capable Windows device. Native iOS/Android keyboard and safe-area checks remain device acceptance rather than desktop-browser emulation.
