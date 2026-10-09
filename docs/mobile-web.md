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

## Gallery comparison follow-up

The [Gallery experience audit](gallery-ios-kfs-audit.md) is the dated, source-backed
comparison with iOS Photos and KFS. Existing compact Shell, Gallery tap-to-open,
Viewer pinch/double-tap/pan/swipe, and shared bottom Properties Drawer are foundations;
do not list them as wholly absent or rewrite them as another mobile Gallery.

For Gallery follow-up, use the complete available Web App viewport, preserve the
existing scroll root and caller workspace, keep 44 CSS px touch targets and safe
areas, and avoid duplicate navigation/action rows consuming the photo wall. Full
available viewport does not mean removing browser chrome through an unsupported API
or hiding controls the user needs. A compact in-Viewer Properties surface must keep
the Viewer mounted and avoid a duplicate player. Trash remains Properties-only, without
original preview or Live motion. The accepted label is **属性**; the transition and
FileExplorer media-adapter status are recorded in the audit.

Any new toolbar, photo-wall pinch density, drag selection, or Drawer behavior must be
verified through the whole Gallery -> Viewer -> Properties -> return flow at narrow,
wide and short landscape sizes. Keep real iOS Safari/Android Chrome, installed mode,
keyboard/safe-area, background/foreground and native media/download results separate
from Chromium emulation and pure controller tests. Existing acceptance records below
remain valid only for the exact environments and paths they measured.

## Phase 1 contract

### Navigation

- `XDriveWorkspaceSidebar` is still the only full navigation component consumed by Web and Desktop.
- Responsive Web uses compact navigation below the shared MUI `md` breakpoint (900 CSS px). At 900 px and above, retain the sidebar. Desktop's non-responsive shell retains its existing sidebar and 960 px width adjustment.
- The compact primary destinations are `overview`, `files`, `gallery`, `transfers`, followed by a More button. Home comes from the caller's sections. “任务” contains file operations, sync runs and other background/local work; the existing internal workspace key remains `transfers` and the Web route remains `tasks?scope=mine`. Uploads and downloads are in the shared top-right transfer popup, with live upload/download rates.
- Administrators also receive “全局任务” (`global-tasks`) in More, opening `tasks?scope=global`; ordinary users do not receive this destination. The same capability gate applies to the wide sidebar and the server administrator API.
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
- Viewer also closes the transfer popup, account menu, settings and account update-confirmation portals. These are part of Shell chrome and must not survive above the Viewer or reopen on return.

## Implementation boundaries

Shared files own the core navigation model, compact navigation, Shell and Content. `web/src/App.tsx` continues to own route mapping, role-filtered administration and the authenticated viewport/Viewer boundary. The password-change surface also consumes shared Content; its document scrolling must remain usable.

The topbar transfer popup uses the same shared MUI component as Desktop. At narrow widths its paper is constrained to the viewport, its list scrolls internally, and touch controls retain 44 px targets. Opening the popup preserves the current workspace and browser history. See [Transfers and tasks](transfers-and-tasks.md) for transfer scope, rate semantics and history separation.

No server API, browser-history policy, directory/tab state, selection, persisted desktop pane width or column preferences change in this phase. Do not duplicate navigation rules or introduce a mobile router.

## Validation

The initial baseline is `92b7d58370542fd0597433fdc4c3969e325a113c`. Before changes, the 32 existing shell/navigation/runtime tests and workspace-surface check pass.

Use behavioral Node tests for model projection, actual Web role-filtered sections, selection, More lifecycle and event identity. Keep the existing shared ownership and route regression checks. Use a real renderer for viewport bounds, drawer focus/closing, scroll-root identity and preservation of mounted content; a hook mock or SSR is not evidence for layout/reconciliation.

Exercise 390×844, 899×700, 900×700 and a wide desktop viewport, including narrow → wide → narrow. Check both ordinary and administrator navigation; short/landscape heights; Files internal scrolling; Gallery's main scrolling; Viewer open/close with an unchanged background DOM. Record tested environments and any remaining device-only checks with the delivery.

### Phase 1 delivery record — 2026-10-08

**Status: Implemented and merged to `master`; native-device QA remains pending.** The table below preserves the original 2026-10-08 delivery evidence. The 2026-10-09 browser acceptance record below supersedes the original local-renderer blocker for the cases it explicitly covers.

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

Post-merge acceptance uses the real app with a bounded API fixture or a test server at the listed viewports. Include More close/Escape/backdrop/focus, narrow → wide → narrow, actual Files/Gallery scroll hosts and the browser Back → account menu/settings → Forward to Viewer path. The latter must also close update confirmation without executing an account action. Keep native iOS/Android keyboard and safe-area checks explicitly separate from desktop browser emulation.


### Phase 2 implementation record — 2026-10-08

**Status: Implemented and merged to `master`; shared FileExplorer Chromium acceptance completed on 2026-10-09; native-device QA pending.**

- Shared FileExplorer now detects the compact touch presentation only when the viewport is below the shared 900 CSS px boundary **and** the primary pointer is coarse. Item activation still inspects the actual pointer event, so mouse clicks keep desktop selection/double-click semantics even when the compact layout is active. Desktop mouse interaction keeps single-click selection, double-click open, Ctrl/Cmd/Shift selection, resize splitters and drag behavior.
- Compact touch uses single-tap Open outside selection mode. “选择” or a 450 ms long press enters explicit multi-select; subsequent taps toggle items until “完成”. Scroll motion cancels long-press selection and suppresses the corresponding click so a swipe cannot open an item on release.
- Details mode projects to a single responsive Name column with a 52 px touch row without writing back desktop column visibility, widths or density. Compact touch exposes only List/Grid view choices and uses a fixed medium grid projection, so mobile view changes do not overwrite desktop details density or grid-size preference. Navigation becomes an on-demand Drawer without mutating the persisted desktop sidebar preference. The desktop Inspector side pane is suppressed on compact touch; Properties remains available from the item action sheet.
- Every touch item exposes a 44 px More target. Item actions use a bottom sheet on compact touch while desktop keeps the pointer-position context menu. The compact command bar exposes upload, view/sort, selection and overflow actions with 44 px targets; selection mode keeps copy/download/delete primary while cut and other lower-frequency operations stay in More.
- Mobile search collapses to an icon until invoked; Forward/Refresh leave the compact address row and Refresh remains available from the overflow menu.
- Native touch drag/reorder remains out of scope for this phase. Internal/external desktop drag/drop behavior is unchanged; touch move/copy continues through explicit file actions.

The post-merge acceptance scope includes tap/long-press/scroll discrimination, selection actions, action-sheet focus and dismissal, navigation Drawer, 360/390/430 px portrait, landscape, and a mouse on a touch-capable Windows device. The browser checks below cover the shared renderer; native iOS/Android keyboard, safe areas and physical Windows input hardware remain separate device acceptance.


## 2026-10-08 merged delivery status

The adaptive Mobile Web implementation is now merged to `master`. Code completion does **not** replace native-device acceptance; the remaining QA list below is still required before claiming mobile browser certification.

| Delivery | Merged implementation |
| --- | --- |
| Shared mobile Shell + compact navigation | #993 |
| FileExplorer compact-touch interaction | #993 |
| Viewer / Quick Look touch gestures and compact chrome | #1005 |
| Gallery tile touch-open / Info affordance | #1013 |
| Ordinary file and version native browser download tickets | #1008 |
| Durable archive native browser handoff | #1010 |
| Public Share native browser download tickets | #1012 |
| Settings compact full-screen presentation | #1014 |
| Global Task Center narrow-screen cards | #1016 |
| Shared storage inventory narrow-screen cards | #1018 |
| Storage history narrow-screen cards | #1020 |
| Storage diagnostics narrow-screen cards | #1021 |
| Local storage policy narrow layout | #1022 |
| Admin Users responsive card/table projection | #1023 |
| Admin Audit virtualized mobile cards | #1024 |
| PWA install identity / start URL / scope | #1025 |
| Synchronization-folder compact-touch dialogs | #1035 |
| Shared Share dialog compact layout and system share | #1050 |
| File Properties, Version History and Tags compact-touch dialogs | #1054 |

### Native download contract

- Browsers with File System Access continue to use direct-to-disk streaming.
- Browsers without that API hand ordinary files/versions to the browser through short-lived authenticated download tickets.
- Folder/multi-select ZIP downloads use the durable archive-prepare run as the authority, then hand a short-lived archive URL to the browser while Server progress remains authoritative.
- Public Share validates the share token/password by POST, atomically consumes one `download_count` slot when issuing the short-lived ticket, and allows that ticket to service GET/HEAD/Range retries without incrementing the count again. The ticket remains fenced by share revocation/expiry, owner availability and exact file revision.
- Browser-owned native downloads do not expose byte progress to the page. UI must say that the transfer was handed to the browser rather than fabricating a page-owned 100% completion.

### Remaining acceptance

Still run the real application on iOS Safari and Android Chrome, both normal-tab and installed/standalone where applicable:

- 360/390/430 CSS px portrait plus landscape and the 899/900 px breakpoint;
- safe areas, virtual keyboard, Settings and Public Share;
- FileExplorer tap/open/select/long-press/action-sheet/navigation drawer;
- Gallery tap-to-open and return-scroll preservation;
- Viewer pinch, double-tap, pan, 1× swipe, video controls and Live Photo hold/release;
- native file/archive/Public Share download, Range/resume and background/foreground return;
- large-list Gallery, Admin Audit and Task Center scroll behavior;
- touch-capable Windows device with an attached mouse to confirm actual-pointer semantics.

Offline file pinning, Service Worker caching, incoming Web Share Target and touch drag/reorder remain subsequent enhancements rather than requirements of the merged adaptive-layout milestone.

## Source settings scope and session follow-up — 2026-10-09

**Status: Shared implementation updated; full real-browser/physical-device integration remains open.** This work starts from the merged Mobile Web baseline `a1f04f46` and follows the same Web REST/Desktop IPC adapter contract. It does not change Source APIs, server-side permissions, target-path semantics, or synchronization scheduling.

The compact-touch form and File Station picker were previously checked as individual MUI components, but a complete "open settings → edit → browse/choose scope → save → reopen" flow had not been exercised. Reviewing the shared SourceManager revealed two concrete correctness gaps in that flow: the form initially projected default DSM scopes before the persisted connector configuration loaded, and an old configuration response could overwrite the form after the user closed or switched synchronization folders. A Cancel action also remained clickable while a save request was in flight, even though the dialog close affordance was blocked.

### Behavioral contract

- The settings session owns the pending connector-scope read. Opening a different synchronization folder, closing the dialog, or successfully saving invalidates prior reads. Late success/error/loading callbacks cannot hydrate a different form or restore stale credentials.
- DSM Photo spaces and File Station roots appear only after the exact current connector configuration is loaded. Until then, **Save is disabled and native form submit is guarded in the shared controller**, so default `personal/shared` or empty roots are never silently written as a change to a persisted scope.
- A failed scope read leaves the remaining unsaved form draft visible, reports the failure, and provides **重试加载配置** without closing the dialog. The retry reads the persisted scope again rather than filling the form with speculative defaults.
- A settings save disables Cancel and dismiss/backdrop handling until the request settles. Explicitly changing File Station roots still uses the existing pause → update connector scope → reactivate sequence; changing only the name/schedule/ignore rules must not write a new connector scope or move the read-only xDrive target.
- The compact-touch settings title no longer automatically focuses the name field on entry, avoiding an unnecessary initial software-keyboard request. Fine-pointer/desktop input continues to autofocus.

### Deterministic controller coverage

`desktop/tests/shared-source-manager-settings-session.cjs` extracts and executes the **actual TypeScript controller callbacks** with a fake Source port and state setters, rather than reproducing their logic in a separate mock. Its cases cover old Source A request arriving after Source B; closing mid-load; failure and retry with the edited name retained; forbidden submit while scope is pending or failed; name-only save without scope mutation; explicit roots change with paused → scope → active order and reopened persisted values; a blocked Cancel during save; and late credential-reveal suppression.

Run as part of `npm --prefix desktop run test:main`; the normal Desktop typecheck and Web lint/build gates continue to validate shared renderer and Web source compatibility. The controller test is **not** a claim of mobile WebKit UI, real HTTP Server/CAS semantics, or a physical-phone keyboard test.

### Remaining acceptance

1. Complete the same full Source settings workflow in the actual rendered Web App with a populated API fixture or a test Server, including the nested picker, overlapping/invalid roots, save failure/retry, refresh, and short-height layout; then repeat on iOS Safari and Android Chrome.
2. Continue the earlier native file/version/ZIP download, directory upload, populated Task Center/storage/Admin Audit, Viewer integration, background/foreground, standalone-mode and Range/resume checks.
3. Validate real Synology authentication/credential replacement separately; this change deliberately does not echo stored secrets or supply test credentials.

## Compact forms and public-share follow-up — 2026-10-09

**Status: Implemented and verified in Chromium; physical-device acceptance remains open.** The related Mobile Web branches and PRs were reconciled first; none remained open for this work. The fixed baseline is `24dac1f00214169c640d792299e24a2fa886bea2`. Viewer-specific work continues separately; this change preserves its media and gesture contracts.

The earlier browser acceptance concentrated on Shell, Files, Gallery and navigation. This follow-up found additional implementation gaps in populated synchronization-folder controls, the nested File Station directory picker, authentication controls and Public Share keyboard submission.

### Reproduced gaps and resulting behavior

| Same browser case | Before | After |
| --- | --- | --- |
| 390 px coarse shared compact action | 41.59×28 px | 44×44 px |
| 390 px coarse shared ordinary action | 64×36 px | 64×44 px |
| Login password visibility / submit | 30×30 px / 42 px high | 44×44 px / 44 px high |
| File Station directory content at 390 px | Client width 326 px; scroll width 1083 px | Client and scroll width both 390 px |
| File Station directory content at 360×390 | Client width 296 px; scroll width 1083 px | Client and scroll width both 360 px; footer remains reachable |
| Selected long-root removal | 16×16 px icon | Explicit 44×44 px remove button |
| Shared dialog title with a 118-character Source name | Paper width 390 px; scroll width 1599 px | Paper and scroll width both 390 px |
| Required password empty, then Enter | One invalid ticket POST despite disabled button | No ticket POST |
| Share exhausted, then Enter | One extra ticket POST despite disabled button | No ticket POST |
| Ticket request pending, then Enter again | Two ticket POSTs | One ticket POST |

The existing compact-touch boundary remains below 900 CSS px with a coarse primary pointer. Shared action controls and dialog close controls now provide 44 px touch targets in that presentation. Wide/coarse and narrow/fine-pointer retain the original compact 28 px and ordinary 36 px action heights; authentication retains its original 30 px visibility control and 42 px submit height outside compact touch. Long shared titles wrap within their available width.

The File Station root picker consumes the existing shared full-screen compact Dialog, title, content and actions. Long directory names and selected paths wrap; the mobile selected-root list provides labelled remove buttons, while desktop retains Chips. Enter-directory actions remain separate from row selection. Draft selection, exact path normalization, overlap validation, pagination, loading/disabled conditions, cancellation and the existing request fence are unchanged. Confirm applies the exact normalized roots once; dismissing the picker does not save its draft.

Public Share reuses the shared AuthPanel's native form. Its submit button and Enter action use the same eligibility guard, including loading, exhaustion and a required password. The password has an associated label and its value is passed unchanged. A failed ticket does not consume the local download count; a corrected password can retry. Successful handoff still reports “已交给浏览器下载。” rather than page-owned byte progress. Server authorization and ticket/count semantics are unchanged.

### Verification and reproducible commands

- `desktop/scripts/mobile-web-forms-browser.cjs` with its TSX fixture: **82/82 passed**, from **40 passed / 42 failed** on the baseline. Both runs had zero browser runtime errors. It renders the real shared controls, Source summary card, directory picker, title, FileName modal and Upload Conflict modal, with only directory data and platform callbacks supplied by fixtures. The same cases verify geometry, enabled/disabled/loading actions, selection → enter → parent → remove → reselect, responsive state preservation, exact confirmation, cancellation and Enter submission.
- `desktop/scripts/mobile-web-public-share-browser.cjs`: **43/43 passed**, from **37 passed / 6 failed** against the earlier `index-GjpNsJVx.js` build. Its Public Share, AuthForm and ActionButton sources match the fixed baseline. The final build is `index-Dxdqrd5M.js`. The script serves the actual Web App and explicit API fixtures over local HTTP; attachment bytes are served by HTTP rather than a download interception substitute. It verifies the real Enter/button paths and login visibility controls at compact touch, 900 px touch and narrow fine-pointer widths.
- Both successful Public Share cases produced a native Chromium download named `移动验收报告.txt`, saved **38 exact bytes**, with no browser download failure. The byte SHA-256 is `c0c023955c7ca35bd5c0150543384683369fb35dc3e8a87030e2c4fd7877ec74`. The page did not fetch the attachment body. Unknown requests, page errors and unexpected console errors were zero; one deliberate wrong-password HTTP 401 remained an expected negative-test response.
- `desktop/tests/web-public-share-form.cjs`: **7/7 passed**, from **3 passed / 4 failed**. It runs real React state/effects and the actual PublicShare/AuthPanel/ActionButton implementations with API and MUI visual boundaries substituted. It certifies handler eligibility and business state, not native browser keyboard or geometry.
- Existing shared FileExplorer browser regression: **54/54 passed**. Actual built Web App regression: **300/300 passed**, with no unknown API requests, page errors or console errors.
- Desktop typecheck and complete `test:main`: **1121 passed, 0 failed, 1 existing opt-in 100k CPU baseline skipped** (1122 total). Web forced TypeScript rebuild, lint and production build passed. Independent review found no unresolved production or browser-test issues.

```bash
npm --prefix web run build
node desktop/scripts/mobile-web-forms-browser.cjs --output-dir=/tmp/xdrive-mobile-forms
node desktop/scripts/mobile-web-public-share-browser.cjs --output-dir=/tmp/xdrive-mobile-entry
```

Both optional browser runners accept `--source-root`, `XDRIVE_PLAYWRIGHT_MODULE`, `XDRIVE_BROWSER_EXECUTABLE` and `XDRIVE_BROWSER_ARGS`. The forms runner records source hashes as well as before/after geometry. This run used Linux, Node 24.19.0 and Chromium 153.0.8010.0. No package dependency or CI workflow was added. The existing Vite large-chunk warning remains.

### Remaining work after this follow-up

1. Continue real-browser integration acceptance for ordinary file/version and ZIP downloads, directory upload selection, interruption/error recovery, and populated Task Center, storage and Admin Audit interactions. The small Public Share fixture does not certify these paths or a real Server's ticket authorization/expiry.
2. Exercise iOS Safari, Android Chrome, installed/standalone mode, actual software keyboards and safe areas, physical touch/mouse hardware, real download Range/resume and background/foreground return. Chromium viewport resizing is not a substitute for those device checks.
3. Combine the separately maintained Viewer mobile/gesture work with whole-App acceptance after it lands. Preserve the same workspace and navigation contracts.

The additional read-only capability probe found no horizontal overflow in login/forced-password-change layouts at the inspected portrait and short/landscape sizes. Chromium parsed the manifest with no errors and reported no installability errors, but no installation was performed. Offline pinning, Service Worker caching, incoming Share Target and touch drag/reorder remain optional later enhancements.

## Browser acceptance follow-up — 2026-10-09

**Status: Chromium renderer acceptance implemented; native-device acceptance remains open.** This follow-up reconciled the existing Mobile Web PRs first: the relevant implementations were merged, their PR CI had succeeded, and their remote branches were already removed. The superseded phase-2 draft #1000 remains closed; its implementation was delivered through #993.

### Reproduced and fixed: inherited Column View

Baseline: `3a35c385ecc953d31a9ca2b81b75e9be4f569ea2`. A saved `columns` view remained active at 390×844 with a coarse primary pointer. Although the toolbar offered mobile selection, the body still rendered desktop Column View: 30 px rows, no per-item More, no single-tap file open, and only the last tapped item selected.

The shared FileExplorer now projects that preference into its existing compact Details list. The preferred mode remains unchanged, so widening the viewport restores columns without a preference write. The same effective view is used by rendering, range loading, keyboard navigation and scrolling; Web/Desktop adapters remain unchanged.

| Same real-renderer case | Before | After |
| --- | --- | --- |
| 390 px inherited view | Desktop Column View | Compact Details list |
| First rendered row heights | 30 px | 52 px |
| Per-item More | Missing | 44×44 px targets |
| One touch tap on file 1 | No open callback | Exactly one open of file 1 |
| Selection-mode taps on files 1 and 2 | Only file 2 selected | Both files selected |
| Narrow → 900 px → narrow | Columns at every width | List → columns → list |
| Persisted preferred mode / change callback | `columns` / no change callback | `columns` / no change callback |

The built Web App independently reproduced the same missing touch-list projection from the real `xdrive.files.view_mode=columns` preference. Its API fixture produced no unknown requests or page errors in that failing case; the failure came from the rendered application contract.

### Reusable validation

`desktop/scripts/file-explorer-mobile-browser.cjs` and its TSX fixture render the production shared FileExplorer and theme. **54/54 checks pass** on the fixed source, including 360/390/430/899/900 px, List/Grid activation and selection, Copy receiving both selected items, More/Drawer focus and dismissal, long press, scrolling and attached-mouse semantics. The scroll gesture remains held beyond the 450 ms long-press deadline before checking that it cannot open or select an item. JSON evidence records the source revision, dirty-tree flag, FileExplorer source SHA-256, browser version, measured geometry and screenshots.

`desktop/scripts/mobile-web-app-browser.cjs` serves the actual production `web/dist` and supplies bounded API fixtures. Components, routing, navigation/session persistence, Gallery and Viewer run unchanged. Unknown API requests, unexpected network access, console errors and page errors fail the run. This is UI and routing acceptance with fixture data, not a Server authorization, native download, media-performance or physical-device test.

The final production build passed **300/300 App checks**: ordinary user 133, administrator 136, the real inherited-columns entry point 28, and three global error gates. Unknown requests, page errors, console errors and scenario failures were all zero. The matrix includes 390×844, 360×780, 430×932, 899×700, 900×700, 1280×800 and 844×390, then returns to the original narrow viewport. It verifies the actual main/Files scroll elements and directory survive breakpoints, the document has no overflow, short/landscape Files fill the available space, More closes by button/Escape/backdrop and restores focus, and navigation exposes only the caller's permitted destinations.

Gallery acceptance uses 240 images and verifies its real scroll ancestor, unchanged DOM on resize, decoded Viewer content, background inert state, and restoration of the same collection and scroll position after closing Viewer. Browser Forward closes More, the account menu, Settings, the transfer popup and the administrator update confirmation; returning does not reopen those portals or execute their actions. The real saved-columns scenario verifies touch selection and More, directory activation, wide-mode restoration and unchanged `xdrive.files.view_mode` through the Web navigation controller. The final run used `web/dist/assets/index-GjpNsJVx.js`, built from the fixed source, and completed at `2026-10-09T00:50:51Z`.

The scripts are optional local renderer checks; the standard Desktop suite also runs `tests/shared-file-explorer-mobile-view.cjs`, which renders the real component with MUI SSR media inputs and covers projection without claiming browser gesture coverage. That regression was observed failing on the baseline before the production change.

Run with installed Web/Desktop dependencies, Playwright and an available Chromium executable:

```bash
npm --prefix web run build
node desktop/scripts/file-explorer-mobile-browser.cjs --output-dir=/tmp/xdrive-mobile-files
node desktop/scripts/mobile-web-app-browser.cjs --scenario=all --output-dir=/tmp/xdrive-mobile-app
```

Both runners accept `XDRIVE_PLAYWRIGHT_MODULE`, `XDRIVE_BROWSER_EXECUTABLE` and a JSON array in `XDRIVE_BROWSER_ARGS` for an externally supplied browser runtime. The shared FileExplorer runner also accepts `--source-root=/path/to/checkout` for before/after comparison and `--case=columns` for the narrow regression. The App runner requires a fresh build in the selected checkout; `--scenario=inherited-columns` isolates the real saved-preference entry point.

This run used Linux, Node 24.19.0 and Chromium 153.0.8010.0 supplied by `@sparticuz/chromium` 153.0.0. The standard Playwright browser download still returned an invalid archive; the separately installed portable runtime made local renderer execution possible without adding a production dependency. Web lint and production build passed; the existing Vite large-chunk warning remains. Desktop typecheck passed; `test:main` finished with **1103 passed, 0 failed, 1 existing opt-in 100k scroll CPU benchmark skipped**.

Native iOS Safari/Android Chrome, WebKit, installed/standalone mode, software keyboards and safe areas, real downloads/Range/resume and background return remain unverified here. The shared FileExplorer fixture contains 73 items; the App fixture contains 97 root entries, 64 child files and 240 images. These do not constitute 100k performance acceptance.

## Viewer refinement implementation — 2026-10-09

**Status: implementation, local tests and Chromium mobile-emulation layout checks
passed; authoritative PR validation remains the merge gate.** Physical iOS/Android
acceptance is not implied by the Chromium checks below.

This slice extends the existing Viewer/Quick Look/Gallery mobile baseline rather than
creating a mobile router or altering the earlier Shell/FileExplorer plans:

- Text, PDF and Audio show their available actions in the shared bottom rail with
  **44 CSS px** targets and safe-area padding. They have no previous/next arrows or
  directory/Gallery neighbor reads. Compact-touch text is read-only at **16 CSS px**;
  the existing 1 MiB truncation and line/column-jump contract remain explicit.
- Compact Viewer frames use the dynamic viewport and retain caller Files/Gallery
  mounting and return state. Navigation arrows exist only when at least one browsing
  direction is available; an action rail must not introduce a disabled arrow pair
  into a standalone program.
- Gallery content fits the available dialog height, including landscape. Its bounded
  filmstrip keeps the active thumbnail visible in its own horizontal scroller; both
  ends remain reachable when the strip exceeds the viewport width.
- Shared image wheel/double-tap zoom anchors at the interaction point; pinch anchors
  follow the two-finger midpoint. Scale remains 1×–6×. Pan bounds use decoded visible
  image/crop/rotation dimensions, center any fitting axis, and re-clamp after viewport
  resize/orientation changes. Approximately 1× horizontal swipe remains optional
  media navigation; Live Photo hold/release stays separate.
- Shared presentation state distinguishes loading, usable ready content and failure.
  Quick Look/Web Preview slideshow counts five seconds only while ready and visible,
  preserves remaining dwell during buffering/hidden time, and stops on failure or a
  confirmed end. An unresolved neighbor scan is not treated as end-of-context.
- Web Media Viewer shares bounded Gallery range metadata within each active-item
  step instead of separately re-reading the current Node/MediaItem. Navigation keeps
  its selected candidate visible while refreshing that step's range; API/account/
  source/context changes isolate candidates, and mutation patches preserve latest
  matching-source fields.
  Web/shared Gallery display canonical capture time; missing/invalid time says
  **拍摄时间：未记录**, without substituting file modification/import time.

The normative rendering/navigation/cache/gesture contracts are in
[Preview Engine](preview-engine.md). Exact controlled request-replay measurements
and their limits are in [Gallery performance](gallery-performance.md#viewer-context-metadata-reuse--2026-10-09).
This slice adds neither persistent slideshow queue/resume nor offline/Web Share Target
support.

Local browser evidence used **Chromium 153.0.8010.0**, real shared/Web React components,
and PNG/WAV/PDF fixtures at **360×780, 390×844, 430×932 and 844×390 CSS px**. All six
surfaces (Text, PDF, Audio, Web Media, Web Preview and shared Gallery) passed the
24-case layout matrix with no document overflow or page errors. Active touch buttons
were at least 44×44; standalone content cleared the bottom rail, text wrapping worked,
and the overflowing action rail remained scrollable. At 390px, the filmstrip's first
and last thumbnails were reachable and selected with actual touchscreen events.
At 844×390, the Gallery image and its clipping container both measured 844×215,
removing the reproduced 105px crop.

Browser events also verified anchored wheel/double-tap/pinch zoom, 1× reset,
portrait/panorama pan bounds and orientation reclamping without swipe navigation.
The headless build reported `navigator.pdfViewerEnabled === false`: PDF chrome and
bounds were checked, but native PDF document display/readiness was not certified.
Renderer readiness/failure and Live Photo lifecycle remain covered by behavioral
component tests. The isolated fixture harness did not certify returning to the full
Files/Gallery workspace through browser history.

After integrating the per-active-item reader from #1058, a focused browser check
exercised **initial → next → previous** in both actual Web Media and Web Preview.
The selected candidate remained visible and the same Viewer frame DOM stayed mounted
while fresh range promises were held pending. Return navigation accepted changed
filename/capture/favorite metadata. Each viewer issued exactly **three range reads**
for the three steps and **zero Node/MediaItem point reads**, with no page errors.

Real **iOS Safari and Android Chrome**, normal and installed modes, physical safe
areas/virtual keyboard, native media/PDF behavior, Live Photo hold/release, and
background/foreground restoration still require device acceptance. Earlier mobile
acceptance and enhancement lists above remain applicable.
