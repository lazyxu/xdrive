# Mobile Web Files · iOS 27「文件」1:1 visual and interaction benchmark

**Decision 2026-10-10 · binding target, not a claim of completed pixel replication.** Mobile Files targets the **specific iOS 27 Files app** at matched device width, locale, contrast, theme, scale and interaction state. Earlier iOS 26 screenshots and a generic "iOS-inspired" style are insufficient acceptance evidence. Preserve prior xDrive App architecture.

## Primary versioned Apple references

- [iOS 27 · Modify files and folders in Files](https://support.apple.com/guide/iphone/modify-files-and-folders-iphc61044c11/27/ios/27): explicit More menu options, grid/list switching, disclosure to expand folders in List, editing Browse home and file customizations.
- [iOS 27 · Organize files and folders in Files](https://support.apple.com/guide/iphone/organize-files-and-folders-iphab82e0798/27/ios/27): folder creation, press-and-hold file actions, rename, tags, favorite, multi-selection and compress/uncompress.
- [iOS 27 · Find and view files and folders](https://support.apple.com/guide/iphone/find-and-view-files-and-folders-iphe4bff8827/27/ios/27): Search, open, Quick Look, recent and folder browsing.
- [iOS 27 · Files basics](https://support.apple.com/guide/iphone/files-basics-iphe9d46e90f/27/ios/27): native bottom navigation contains Recents / Shared / Browse; this does not imply xDrive already has Shared-to-me backend functionality.
- Screenshots linked by these current Apple pages are the visual references. Apple artwork is not copied into this repository; use original xDrive implementation and compare against legitimately obtained reference images. The previous `ios-26-iphone-16-pro-files-icloud-drive-downloads.png` informs historical colors only, **not** the iOS 27 target.

## Architecture invariants: no exceptions

1. Every Mobile Web App Frame fills the entire browser-available dynamic viewport. The separate **52px xDrive global application header** continues to provide App exit, transfer popover and App switching. Native Files does not have that xDrive header: 1:1 applies to **Files-internal presentation below it**, not by sacrificing the App architecture.
2. `web/src/WebFileExplorer.tsx` continues to own **one** `XDriveApi`, `useXDriveFileExplorerWorkspace`, upload/download, mutations, search, organization and browsing/Viewer lifecycle for both wide and compact Web. No new mobile-specific business API or copy of Server permissions.
3. Mobile and wide Web use the same `XDriveFileExplorerVirtualCollection`, Server count/group/range contracts, shared MUI virtualization-window kernel, group layout, thumbnail provider/cancellation, operation/Properties controllers and shared dialogs. Screen-specific height/row style may be an option to that shared primitive.
4. **Only internal multiple file tabs are omitted** below 900 CSS px. All other real wide-Web capabilities must be available via native-like menu, toolbar, location, selection or gesture alternatives. No background hidden tab commands. Desktop and wide Web retain their controls and view preferences.
5. Viewer is one existing Web App/Preview path and returns to the mounted Files scroll/history. App Header Back exits an App; Files own Back enters its parent folder; workspace historical Back/Forward remains separately reachable.
6. No false Search scoping. xDrive's current Server Search covers `全部文件`; iOS scoped Search UI may not claim local folder/Recent/Tag scoping until an authoritative Server query supports it.

## Reference-state matrix

| Surface/interaction | iOS 27 reference target | Implementation status / acceptance gap |
| --- | --- | --- |
| Full-height Files | Native content edge-to-edge within its app | xDrive full App Frame and fixed independent 52px app title retained; verify inner geometry, not remove header |
| Browse home | Large title → collapsed small title, search, grouped Locations/Favorites/Tags, 44px targets | F-iOS-01A merged; 1:1 screenshot-diff and hardware pending |
| Bottom navigation | Native Recents / Shared / Browse with blur/translucency, selected state and safe-area handling | xDrive's earlier approved Recents / Browse / Favorites is *not* identical. Favorites is a real xDrive collection; do not mislabel it Shared before a real shared-to-me Server source exists. F-iOS27-02 improves visual treatment only |
| List/Grid | Native two-line rows, blue folders/document thumbnails, separators, content-aware icons | Current 68px List and 150px Grid are approximations; iOS 27 actual baseline measurement and reduced-motion/dark-mode screenshots pending |
| More and context | Native grouped More menu, selected view, sort, long-hold rename/copy/move/tags/Quick Look | Real xDrive actions available; check every gesture and selected/disabled state against iOS 27 and Server permissions |
| Folder disclosure | In native List, separate forward/disclosure expands children in place; row open enters folder | F-PARITY-07A and 07B are merged; F-PARITY-07C extends the same shared bounded List disclosure to Server-authoritative grouped sections. Real iOS 27 pixel/interaction acceptance remains pending. |
| Search/sort | Native search scope choices, Name/Kind/Date/Size/Tags, view options | xDrive authorized all-file Search and backed sort/group only. Missing scoped Search/Tag sort must not become decorative controls |
| Organize | Tags, Favorites, editable/home ordering, custom colors/icons | Real tags, Favorites and persisted quick-access/saved-search order exist; Apple-native per-folder color/emoji and drag rearrangement still require independent backing and device tests |
| Selection and operations | Long hold context, explicit Select, batch share/move/copy/delete, cancel/error | Shared xDrive selection/action controllers; Web/Mobile parity needs paired tests for actions/limits/permission/error outcomes |
| Extended Apple-native actions | Document scanner, Connect to Server, system Shared | Not automatically supported by existing xDrive Server; no fake menu entries or nonfunctional shell |
| Properties and media | Info preview, filename, location, technical data, link back to browsing | #1211 adds shared Server recursive stats and provenance, pending its full CI and merge |
| 10k/100k | Stable 100k indexed collection, no full DOM/list materialization | Bound rendered viewport; measure cold/warm real browser requests/RSS/scroll as separate benchmarks. No unmeasured performance claims |

## Native parity test plan and signoff

- Reference devices: real iPhone Safari and iOS-installed web app on **iOS 27**, portrait 320/375/390/430 CSS px and short landscape; test xDrive inner Files below 52px App Header. Record exact iPhone model, iOS 27 minor build, Safari version, light/dark appearance, dynamic type and safe-area screenshot/capture. Use 899 and 900 CSS px separately for responsive ownership.
- For every screenshot pair, record Files screen, title/More, Browse home expanded/collapsed, folder list/grid, Recent, Favorites, Search, menu open, selected N items, Rename, Properties, empty/loading/error. Screenshot crop and coordinate normalization must explicitly exclude Apple-only system status bars and xDrive's preserved global App Header; measure icon color/shape, font scale, text bounds, rounded regions, shadows, spacing and touch-target geometry. Store actual source bitmap names, dimensions and diff metrics; do not claim "pixel-perfect" from source code or an iOS 26 photo.
- Real interactive acceptance: stationary hold opens context menu only on release; scrolling cancels long-hold; valid long-hold move starts drag; separate folder disclosure vs open, Search keyboard hide/show, back/history distinction, native Share with actual bytes, VoiceOver focus/roles, pointer+keyboard, 200% text, safe areas and network cancellation.
- Paired wide Web / 375 / 390 / 899 / 900 behavior matrix for **each** capability: identical API, node ID/revision, permission error, retry/cancel semantics, selection, operations and Viewer return. Only multi-file-tab is an accepted functional mismatch.
- 10k and 100k measured workloads: List/Grid at top/middle/end, grouping, cold/visible thumbnails, rapid scroll/close and Search; record mounted item count, actual requests, aborted requests, CPU/RSS and median/P95 before and after optimization. CI DOM/source tests do not certify physical device or 100k throughput.

**Acceptance labels:** `Target locked` → `Implemented` → `Component tested` → `CI green` → `Merged` → `Browser visual verified` → `Physical iOS verified` → `Measured 1:1`. Do not skip levels.

## 2026-10-10 F-PARITY-03 · Mobile Smart Folder management parity

**Merged:** [PR #1222](https://github.com/lazyxu/xdrive/pull/1222), full CI [#37985494553](https://github.com/lazyxu/xdrive/actions/runs/37985494553), linear merge `dd8c7aab`. Mobile Browse edit mode now exposes 44 CSS px action targets for a saved Smart Folder's Rename / Replace-with-current-Search / Delete through the same Web organization controller and shared `XDriveFileNameDialog`. The mounted rules remain a bounded owner-scoped list rather than independently scanning a 100k directory. The current applied global Search, not a draft text string or stale folder path, is the only source for replacement. The replacement action is available from Search's More menu with an explicit target picker and confirmation. Delete prompts before permanently removing **only the saved query definition**, never matching Nodes or physical bytes; a rejected mutation preserves the rule and dialog for retry. Source/rule labels, loading/error and retry feedback use the same Web controller.

No extra Mobile REST endpoint, no separate Server Search engine, no second virtual collection or tab state is introduced. Physical iOS 27 screenshot, genuine native Share/Browser state, inline-folder disclosure and native Browse drag-reorder remain not verified. This phase is merged; physical iOS 27 visual and interaction verification remain outstanding.

## 2026-10-10 F-PARITY-04 · existing Web Quick Look and browser tabs

**Merged:** [PR #1224](https://github.com/lazyxu/xdrive/pull/1224), full CI [#37987118818](https://github.com/lazyxu/xdrive/actions/runs/37987118818), merged and branch deleted. Real iOS 27 interactions remain pending.
- Files rows retain normal short tap and Enter to the canonical Web Open resolver. Space on an unselected/ordinary browsing row and the explicit **快速预览** item in its context menu launch the already registered Web `preview` app, using the same `openWebQuickLook` browse context, adjacent range and Viewer return, with no duplicate player/request API. Selection mode keeps Space for selection; Trash remains non-previewable.
- The existing wide Web `在新浏览器标签页打开` action is visible on Mobile, distinct from **internal FileExplorer tabs**, whose new-tab command remains absent below 900px. Browser popup behavior retains the original Web owner and its security/session rules.
- Web and Mobile continue sharing the same Server APIs, operation controller, virtual collection and thumbnail provider; changing the preview action must not fetch originals on long-hold hover or unmount the caller's scroll host.
- Static and mounted tests cover Space vs Enter, mouse/long-press context, single renderer scroll host, routed preview callbacks and preservation of external browser tabs.
 
## 2026-10-10 F-PARITY-05 · Go to folder path

**Implementation submitted for PR validation, not yet merged or verified on physical iOS 27.**

Wide Web supports a typed FileExplorer address/path through `useXDriveFileExplorerWorkspace.submitPath`, backed by the existing owner-authorized `xDriveFileExplorerSubmitPath` resolver. Mobile Files now exposes the *same operation* as `··· → 前往文件夹路径…`, with a 44 CSS px touch-ready input form prefilled from the same Web workspace `pathValue`. A requested path transitions to Mobile's single Browse context; the shared workspace resolves and validates directories, owns navigation intent/history and publishes errors. No Mobile directory enumeration, path-specific REST or separate tab navigation was added.

The typed path is explicitly **not** a folder-scoped Search. Blank paths cannot submit, Trash cannot start the operation, and normal Open/Viewer and global Search remain separate. Preserve full-height App Frame, 52px app header, shared Server/API, virtual collection and thumbnail ownership.

**Acceptance:** React mounted tests for Browse Home and Recent, current path prefill, trimmed submission, empty path rejection, Trash suppression and preserved scroll owner; source tests for shared resolver reuse. Full PR CI is the merge gate; real iOS 27 screenshots, software keyboard, installed mode and 100k end-to-end measurements remain not-run.

## 2026-10-10 F-PARITY-06 · external files and folder drop parity

**Implemented on a short-lived dependent PR; final CI/merge and physical iOS 27 device validation remain pending.**

Mobile's Files-internal browsing list/grid, real folder rows and ancestor breadcrumbs now dispatch genuine dragged **external files or folder entries** through the exact same `xDriveFileExplorerReadExternalDrop` parser and `useXDriveFileExplorerExternalDropController` adapter already used by wide Web. A source folder goes to the owning folder as the Server resolves it; a crumb drop goes to that ancestor; a background drop goes to the existing current directory. The parser preserves folder-relative paths and empty-directory entries, and the shared upload controller enforces authorized parent, current account, lifecycle, transfer retry and refresh semantics. A folder drop must never additionally upload a flattened copy at the background location.

This is different from Mobile's existing long-hold *internal move* gesture, which remains intact. HTML5 external `DataTransfer` recognition requires real browser file handles; no fabricated mobile filesystem access, auto-hydration, offline folder scan or second upload endpoint is introduced. A stale async directory read is discarded after session, directory, Search generation, or Trash changes **before** invoking the upload controller; the browser's legacy entry enumeration itself does not support upstream `AbortSignal` cancellation, so do not claim the bytes of an in-flight read were cancelled. In Trash, file drops are prevented from navigating away in the browser and never cause a mutation.

React behavior/source tests must cover background, folder and ancestor targets, prevention of bubbled duplicate drops, same-account gating, rejected Trash, shared reader usage and unmount/stale read. Real iPhone/iPad Files → Safari split-view drag, iOS-installed Web App, permission errors and large-folder handling remain **not run** until device and workload evidence exists.

## 2026-10-10 F-PARITY-07A · shared bounded inline tree index (foundation only)

**Merged:** [PR #1243](https://github.com/lazyxu/xdrive/pull/1243) passed full exact-head [CI #38016476708](https://github.com/lazyxu/xdrive/actions/runs/38016476708), linear merge `cfa30709`, branch deleted. The foundation is not the Mobile disclosure UI. FileExplorer now has an index-based shared inline projection that interleaves root and nested directory ranges without scanning or materializing a full directory. It maps a visible flat window back to one or more owner-directory logical intervals and preserves unloaded placeholders, source sorting and directory identity. The immutable segments only scale with the number of explicitly expanded branches; the 100k parent + 100k child fixture produces three spans and zero item reads during layout. The same shared range/virtual-window controller remains the intended data source for the Mobile presentation.

**Not yet delivered by this foundation:** separately tappable disclosure in Mobile Files, actual authenticated child-range fetches and AbortSignal propagation, grouped tree UI, or native 1:1 iOS 27 visual/device acceptance. Do not interpret a 100k logical index test as a 100k browser rendering, SQL, RSS, or network measurement. Next step F-PARITY-07B implements mounted disclosure via one Web-owned `api.listRange` adapter and this shared projection, tests stale child requests and 375/390/899/900px parity, and runs exact-head CI.

## 2026-10-10 F-PARITY-07B · actionable List folder disclosure and Server child ranges

**Merged:** [PR #1249](https://github.com/lazyxu/xdrive/pull/1249), full exact-head [CI #38018768047](https://github.com/lazyxu/xdrive/actions/runs/38018768047) success including final-gate, linear merge `19e81621`, work branch deleted. Mobile List rows have a separate >=44px expand/collapse button with accessible expanded/loading/error/retry states. Tapping the row itself still navigates through the original Web workspace. A Web-owned `XDriveFileExplorerInlineRangeStore` reads existing `api.listRange` with the workspace's authoritative sort/group parameters, bounded 100-item pages, one shared sparse-window calculation, and the browser request's `AbortSignal`. Cancelling/collapsing an ancestor drops descendants; leaving account, scope, Search, Trash or Mobile presentation invalidates the store. No second Mobile API, request context or Viewer is introduced.

Sparse child Node pages register into the **same** Web `nodeByID` projection that wide Web uses for Open, Properties, Copy/Move/Delete/Share and operation permission checks. Their per-owner authoritative crumb path is passed to the existing navigation dispatcher; a child file's Viewer/Quick Look uses a single-item selection context instead of incorrectly claiming neighboring files from the root directory. The indexed flattening does not request 100k child entries to show the first screen. The existing dynamic-viewport App Frame, independent **52px** global app header, one Mobile browsing context and virtual scroll host are unchanged.

**Current limits:** This initial disclosure is available in an **ungrouped List**; group headings and Grid remain their normal existing presentations and do not expose fictional inline children. Native iOS 27 screenshots, VoiceOver, Safari/installed app, keyboard/safe-area, exact visual diffs, physical 10k/100k CPU/RSS/network, and paired real Server permission/error matrices are **not yet measured**. The shared in-memory 100k fixture and Node test prove bounded logical projection, not end-to-end speed. Do not mark full iOS 27 1:1 or total Web/Mobile parity complete from these tests.


## 2026-10-10 F-PARITY-07C · grouped Mobile List inline disclosure

**Implementation prepared on a single-commit GitHub PR; final exact-head CI/merge and native iOS 27 device acceptance must be tracked separately.** Previously F-PARITY-07B limited inline child expansion to ungrouped List. In F-PARITY-07C, the same shared `xDriveFileExplorerInlineLayout` run-length root/child spans are projected into the Server-authoritative `type`, `modified` and `size` group-index intervals. Each expanded descendant remains physically nested immediately after its parent **within that parent's root Server group**, instead of being incorrectly regrouped using the sparse fetched child subset. Group headings, order and field/direction are preserved as Server returned them.

Grouped viewport calculation uses the authoritative positioned `xDriveFileExplorerVisibleGroupSegments` and translates only the visible flattened span back to owning parent/child Range requests; one existing scroll/thumbnail host is retained. Empty or inconsistent Server group-index metadata cannot be faked by the client: the shared group-index validation rejects it. Grouped List and ungrouped List share the same Web `api.listRange`, AbortSignal cancellation, node identity, permissions and file-operation controllers. Grid, Search and Trash retain their existing behavior. Internal multi-file tabs remain omitted from Mobile Web only.

**Validation tiers:** isolated 100k parent+child/group-index tests demonstrate bounded index calculations, *not* wall-clock 100k browser rendering; mounted React type/date/size group headings, child owner and collapse tests plus Web/Desktop/Go PR CI are delivery gates. Paired wide Web vs 375/390/899/900px live Server operations, iOS 27 Safari/installed app screenshots, actual icon/font/pixel diffs, VoiceOver, short landscape, dynamic type, GPU/CPU/RSS/network-request/abort measurements and physical cross-app drag must be recorded separately before claiming a verified iOS 27 1:1 experience. Keep full App Frame, **52px** global title bar and shared Web/Desktop backend intact.

## 2026-10-10 F-PARITY-07D · expanded child Copy Paths use true ancestors

**Implementation staged for one-commit PR validation; do not claim CI/merge/native signoff before evidence.** In F-PARITY-07B/C an expanded child row retains its real Node/revision and Server parent, but the Web Copy Paths adapter was still passing current browsing-root crumbs to the shared `xDriveFileExplorerCopyPath` helper. A nested file `我的文件/Work/2026/inside.txt` was therefore copied as `/inside.txt` rather than `/Work/2026/inside.txt`.

The Web adapter now passes the **already-existing** `inlineCrumbsForItem(item)` to that shared helper; its ancestor chain originates in owner-scoped expanded child Node identities. This fixes single and multi-item copy-path operations from Mobile List/selection without changing the shared helper, Desktop copy paths, Search's authoritative `secondaryLabel`, the FileExplorer Open/Viewer, authentication, Server/API, or the xDrive full-height App Frame and **52px** app title bar. Nested path tests must use the real shared helper and verify both normal and global Search precedence.

Real iOS 27 screenshot/gesture/VoiceOver and live 10k/100k browser CPU/RSS/network measurements are still not run. The absence of internal multi-tabs remains the only approved Mobile Web functional exception.

## 2026-10-10 F-PARITY-07E · selection survives sparse Range eviction

**Code and test implementation; PR full CI, merge, and physical iOS 27 parity are separate gates.** The mounted Mobile Files `selected` map can retain an item after its root/child range scrolls off the viewport. Before this change, `WebFileExplorer` removed the evicted inline Node from its shared `nodeByID`, so Copy/Cut/Move/Copy To/Download/Delete no longer had the full original Server ID/revision even though the item remained selected. An isolated 100k child + real Node-map/selection-contract reproducer first failed with `所选项目信息尚未完整加载，请稍后重试。`; the existing behavior was not just a cosmetic selected-state issue.

The existing Web workspace now retains **only up to 200 selected Node identity/revision records**, with the owning parent breadcrumbs for nested Copy Paths. Mobile reports its actual selection to that same workspace; all actions still use the existing Web authorization and operation controllers. The shared root/Search `retainInteractionIDs` contract is reused; ordinary root and expanded child virtual ranges still evict pages and cancel out-of-viewport requests. Selection completion or scope/account change releases pinned IDs; no Mobile-specific REST, copy/move implementation, new endpoint, whole-directory pinning or second viewer is introduced.

**Acceptance:** tests should execute the genuine shared Server Range store, actual `WebFileExplorer` inline projection block, shared operation validator and mounted `MobileFiles` Select/Complete lifecycle. Cover root+child selection, revision, scroll-to-100k eviction, clipboard/mutation action guards, nested path, selected-cache bound and account switch. A browser screenshot or static source test alone is not sufficient. Real iOS 27 Safari/installed app, VoiceOver, short landscape, light/dark, 375/390/899/900px and actual 10k/100k network/CPU/RSS measurements remain **not run** until separately captured. Preserve full App Frame and separate **52px** global application header.


## 2026-10-10 F-PARITY-07F-A · Mobile / wide-Web virtual Select All parity

**Merged:** [PR #1285](https://github.com/lazyxu/xdrive/pull/1285), exact-head [CI #38031123253](https://github.com/lazyxu/xdrive/actions/runs/38031123253) successful, linear merge `34036439`, temporary branch removed. Physical-device screenshot evidence remains separate. Wide Web's existing FileExplorer selects all logical items with bounded `XDRIVE_VIRTUAL_COLLECTION_DEFAULT_PAGE_SIZE` ranges, visible progress and cancel. Mobile previously refused **any directory/search result containing more than 200 items** even though the existing shared Server/API and VirtualCollection could collect those ranges. This violates the only-multi-tab exception. Mobile now uses the same `XDriveFileExplorerVirtualCollection.collectRange` and the same 200-item page constant for staged, bounded logical ID collection. It validates each page and unique IDs, commits the complete selection atomically, reports `正在选择 x / y 项` and can abandon a pending selection without applying stale results. It also fences account, directory, search and virtual collection interaction changes; all original selected items survive partial failure or cancellation.

Selection count is deliberately distinct from action size: the shared operation controller still caps writes at **200 items** and downloads at **1000**. Web retains up to 1000 selected Node/revision records when the selection is within an actionable download range; for a 10k/100k selection it retains at most 200 Node records without pinning entire collection pages. Shared selection validation checks the established operation limit before declaring sparse Node metadata unavailable. Do not claim an oversized mutation succeeds, or that 100k files are downloaded in a single task.

**Cancellation qualification:** Cancel interrupts selection *scheduling and commit*, but the currently running `collectRange` promise does not yet expose an external `AbortSignal`. The existing virtual collection cancels obsolete viewport requests on lifecycle/query changes. Immediate explicit HTTP→Go `ctx.cancel` propagation during an in-flight Select All request remains a separate test/fix item; do not claim this PR proves that cancellation latency. Actual cross-platform 10k/100k browser CPU, memory, network timing and abort count remain unmeasured.

Keep the version-locked iOS 27 Files presentation contract, xDrive full dynamic App Frame, independent **52px** global title bar, Web/Desktop shared backend and shared virtual/operation components. Mobile alone omits internal file multi-tabs. Native iOS 27 device screenshot diff, VoiceOver, touch/keyboard/safe-area and paired 375/390/899/900px Server permission/error acceptance remain **not run**.


## 2026-10-10 F-PARITY-07F-B · shared selection-action eligibility in Mobile

**Merged:** [PR #1292](https://github.com/lazyxu/xdrive/pull/1292), successful exact-head [CI #38032617100](https://github.com/lazyxu/xdrive/actions/runs/38032617100) including Final Gate; linear merge `38e2b5e4`, temporary branch verified removed. Physical native acceptance is separate. After F-PARITY-07F-A, Mobile can logically select 257/100k files but its Copy/Move/Delete toolbar and Cut/Copy To menu controls were still visually enabled for an operation that Wide Web's shared `xDriveFileExplorerSelectionActionDisabledReason` rejects. This is a functional presentation discrepancy, not permission to bypass the Server.

The single Web workspace now passes its already-used `getSelectionActionDisabledReason` into the Mobile presentation. Mobile uses exactly this validator for toolbar and selection-menu enabled states and protects direct callbacks against disabled-action invocation. Separate limits are preserved: 200 for mutations, 1000 for downloads, 500 for tags, with Server ID/revision and permissions still evaluated by Web/Server; the UI presents the real reason rather than claiming an oversized action will run. Native iOS Files affordances are still a presentation target only. No extra REST endpoint, business controller, virtual list, or mobile-only permission logic.

**Verification:** mounted 257/1001-item shared virtual Select All fixtures with correct action limits and callback guards **passed** in exact-head [CI #38032617100](https://github.com/lazyxu/xdrive/actions/runs/38032617100), together with Web, Desktop, Go and Final Gate. Actual 375/390/899/900px paired Server acceptance, iOS 27 Safari/installed-mode screenshots/pixel diffs, VoiceOver and real 10k/100k CPU/RSS/request abort measurements remain pending. In-flight HTTP cancel for Select All remains an independent item.


## 2026-10-10 F-PARITY-07F-C · multi-selection Properties parity

**Merged:** [PR #1297](https://github.com/lazyxu/xdrive/pull/1297), exact-head [CI #38034184362](https://github.com/lazyxu/xdrive/actions/runs/38034184362) success (Desktop **2006 passed, zero failed, one skipped**, Web, Go/API, artifact verification and Final Gate); one-work-commit `4f149281`, linear merge `dccebda0`, temporary branch verified cleaned. Native device acceptance remains unverified. Wide Web's existing context menu can open **multi-selected** FileExplorer Properties; Mobile's selection toolbar previously exposed Copy/Move/Download/Delete/Tags, but only item-level Properties. Mobile now opens the existing **shared `XDriveFilePropertiesDialog`** from `More → 所选项目属性`, using the already-shared **`useXDriveFileExplorerPropertiesController`** and Web's owner-authorized `filePropertiesStats` loader. One `propertiesItems` snapshot retains original Node IDs/revisions, selecting a single item still uses the existing media Inspector; mixed folder/files use authoritative recursive bytes/counts, while file-only selections calculate known bytes locally without a new request. Closing/owner, directory, Search, Trash or collection scope changes abort in-flight stats and close old dialogs. Selection remains intact after inspection. No separate Mobile API, Server traversal, item renderer, Viewer or second properties model.

**Acceptance:** mounted React mixed-folder recursive stats, file-only no-extra-request, abort on close/account change, stale-result immunity and sparse 257-file metadata **passed** in the exact-head CI, alongside the original single-item media/file Properties tests. A component fixture does **not** establish iOS 27 1:1 pixel/VoiceOver/Safari installed-mode acceptance or 10k/100k physical browser perf and immediate Go HTTP cancellation. Preserve full App Frame, **52px** global App Header, shared Web/Desktop business and virtual owner, and Mobile-only internal multi-tabs exception.


## 2026-10-10 F-iOS27-08A · explicit Icons/List in Files More

**Merged:** [PR #1305](https://github.com/lazyxu/xdrive/pull/1305), exact-head [CI #38036163945](https://github.com/lazyxu/xdrive/actions/runs/38036163945) including Final Gate, linear merge `eed0ed80`; its temporary branch has been removed. Native-device screenshot validation remains outstanding. The [official iOS 27 Files Modify guide](https://support.apple.com/guide/iphone/modify-files-and-folders-iphc61044c11/27/ios/27) places explicit **Icons / List** actions in the folder **More** menu. Mobile previously exposed only one context-sensitive `切换到图标/列表` item and placed sorting in another control. Below 900 CSS px, Mobile now exposes **both** 44×44-min touch-ready view actions in a grouped More section with icons, selected checkmark and accessible `menuitemradio` / `aria-checked`. A selected choice does not reset the directory scroll. Switching calls only the existing Mobile view-preference state/persistence and resets scroll **when the view really changes**; it does not change the shared Server sorting, wide Web Columns preference, virtual range owner, internal tab state or backend. The current authenticated Server-backed Sort & Group submenu remains available with 44px hit targets and the original `onSortChange`/`onGroupingChange` handlers. Ordinary file mutations, Search, uploading, undo/redo, history and other More commands remain reachable.

**Verification:** mounted React tests cover radio visibility, selected states, action labels, 44px targets, list↔icons persistence, single scroll host, wide-Web preference separation, existing sort/group callbacks, and Browse-home omission; static contract assertions guard against restoring the old single toggle. Source/component tests do **not** provide actual iOS 27 1:1 typography, geometry, VoiceOver, Safari/installed-mode or touch/keyboard/safe-area evidence. Photo-real/pixel acceptance requires recorded iOS 27 build and legitimately captured matched reference images. No unsupported Apple features (Shared, scanner, arbitrary folder colors or scoped Search) are fabricated. Preserve full xDrive dynamic App Frame, **52px global App Header**, shared Web/Desktop/Mobile Server/API/virtualization and Mobile's sole internal multi-file tab exception.


## 2026-10-10 F-iOS27-08B · consistent Mobile Files row geometry and collection keyboard context

**Merged:** [PR #1331](https://github.com/lazyxu/xdrive/pull/1331), exact-head [CI #38066135499](https://github.com/lazyxu/xdrive/actions/runs/38066135499) successful including Final Gate; Desktop 2056 passed / 0 failed / 1 skipped, linear merge `593033e3` and temporary branch verified cleaned. Native iOS 27 device comparison remains outstanding. The Recent/Favorites virtual window already used the shared `mobileFilesWindow(..., MOBILE_FILES_ROW_HEIGHT=68)` but each collection row had only a `minHeight: 64` rendered box. Consequently the virtual before/after spacers were calculated at a different row pitch from the items, accumulating a 4px drift per off-screen row. This phase sets the collection row to the **same 68 CSS px** as the existing shared virtual List kernel (without adding a new virtualizer) and adds a deterministic 10k/100k row-height consistency contract. Browse-home rows inherit the unified minimum but are not part of the Recent/Favorites virtual slice.

The earlier separator `left: 60px` fell short of the actual title start: 16px row padding + 44px glyph cell + 12px gap = **72px**. Selected directory rows add a 24px selection circle + 12px gap (**108px**); inline nested rows add 16px per level capped at four. A pure Mobile presentation helper controls the left inset for directory and Recent/Favorites List surfaces, while Grid still shows no separators. The layout keeps real data labels, distinct native-like folder/document graphics, and a single shared scrolling/thumbnail/Server Range owner. These numbers establish *internal text/separator alignment only*: iOS 27 physical screenshot/pixel sampling is still required for final exact row dimensions, colors and icon position.

Recent/Favorites already exposed their genuine Web-controller actions via mouse secondary click and held touch. Now `ContextMenu` and `Shift+F10` on an item row launch that **same owner-scoped menu** without opening the file; nested Browse-edit buttons/other modified keystrokes retain their own behavior. All eight collection-menu actions receive >=44px touch targets and the same bounded rounded popup treatment as ordinary file menus. No new Web API, copy/download/share implementation, Server authorization, collection index, internal tabs, external PWA chrome, or fake Apple-only features. Keep the full dynamic xDrive App Frame and independent **52px global App Header**.

**Acceptance:** mounted React tests cover virtual pitch (68px), inset values (regular/selection/nested), real row view, Recent/Favorites keyboard actions, 44px menus, nested key isolation, and preservation of backed open/operation callbacks. Static tests check shared virtualization and absence of Mobile-only API. Browser widths 375/390/899/900, actual 10k/100k CPU/RSS/network, screenshot geometry, iOS 27 Safari PWA touch/VoiceOver/landscape and HTTP→Go `ctx.cancel` still **not physically validated**.


## 2026-10-11 F-iOS27-08C · shared rename validation, rejection and retry parity

**Implemented in an exactly-one-work-commit PR; GitHub exact-head CI, merge and physical iOS 27 acceptance are separate gates.** Source comparison found a genuine functional discrepancy: Wide Web's shared `XDriveFileExplorer` uses `XDriveFileNameDialogView` and `xDriveFileNameValidationError` for rename; Mobile Files had its own `<Dialog><TextField>` without the common 255-byte UTF-8 validation and silently swallowed Web `onRename` rejection while keeping the modal open without an inline error. Neither variant may reinterpret the Server's owner authorization, Node ID or optimistic revision.

Mobile now uses the existing **`XDriveFileNameDialog`** from `@xdrive/ui/mui` for the same 255-byte validation, label/form keyboard behavior, 44px responsive touch controls, busy/duplicate-submission guard, inline `role=alert` rejection and retry with the original `id + revision`. No Mobile-specific REST call, mutation handler, permission test or second virtual list. The same `WebFileExplorer.onRename` routes to `api.rename(id, revision, name)`; Server conflicts, permission failures and current-session feedback are still owned by Web/Server. User/account/directory/Search/Trash/interaction scope changes close the old rename dialog; the shared dialog's lifecycle fence ignores stale completion. No second global `onError` call is added from Mobile because the Web adapter already reports failures; the shared dialog itself now gives localized inline feedback.

**Regression tests:** mount the *actual* shared name dialog under Mobile and exercise synthetic Server-backed 403 error, preserved edit, unchanged canonical id/revision on retry, successful close, 258-byte Chinese UTF-8 rejection with zero Web write, reset on edit, and old-account rejection after scope switch. Source parity verifies the same shared validation component as Wide Web and no Mobile-only API. Full built-Web 375/390/899/900 CSS px authorization/error matrix, browser request traces, iOS 27 device screenshots/pixel diffs, VoiceOver and 10k/100k measured performance remain outstanding; this PR must not claim full native 1:1 acceptance. Preserve the full-dynamic-viewport xDrive App Frame, independent **52px global App Header**, and a shared Web/Desktop/Mobile REST/virtualization/business implementation with only Mobile's internal multi-tab exception.


## 2026-10-11 F-iOS27-08D · real shared Select All HTTP cancellation

**Merged:** [PR #1341](https://github.com/lazyxu/xdrive/pull/1341) passed exact-head [CI #38070529849](https://github.com/lazyxu/xdrive/actions/runs/38070529849) including required Go API gates, linear rebase merge `d0960742`, short-lived remote branch verified deleted. The immediately preceding F-iOS27-08C rename parity was merged as [#1336](https://github.com/lazyxu/xdrive/pull/1336) at `master@0c69a554`; F-iOS27-08B [#1331](https://github.com/lazyxu/xdrive/pull/1331) was also merged. The task's first remaining correctness gap is the explicitly documented F-PARITY-07F-A Select All cancellation: rejecting late results while leaving the current directory/search HTTP range request alive is insufficient.

Wide Web and Mobile now pass a dedicated `AbortController.signal` through the same shared `collectRange` contract, workspace projection and directory/Server Search transports. The shared VirtualCollection uses bounded page-size `loadRange(range, signal)` requests for an explicitly cancellable interaction, reusing already-complete cached page values but never borrowing a viewport request controller. Cancelling selection, finishing selection, changing account/directory/Search/generation, or unmounting aborts its owned request. Existing viewport fetches, virtual retention/scroll positions, and previously committed selections remain unaffected. Web Search range now threads the signal into `XDriveApi.searchRange → request → fetch`; directory was already signal-aware. Abort is a normal non-error and old Node/revision data never commits after cancellation.

**Regression gates:** real shared hook tests for selection versus viewport controller independence, HTTP-abort signal and late-result/abort-rejection suppression; mounted Mobile 100k-selection cancel must observe `signal.aborted`; source contracts verify wide-Web and Mobile API parity and searchable transport. Do not claim measured Go cancellation latency, physical 10k/100k browser timings, native iOS 27 1:1 pixel/VoiceOver, or on-device Safari/PWA acceptance from these tests. Initial one-shot Search query fetches remain separately lifecycle-fenced and are outside this bounded cancellation change. Preserve xDrive's dynamic full-screen App Frame, **52px** global title bar, one Web/Desktop shared Server, one virtual collection and the Mobile-only omission of internal multi-tabs.


## 2026-10-11 F-iOS27-08E · cancel the first counted Search HTTP page

**Merged:** [PR #1345](https://github.com/lazyxu/xdrive/pull/1345), exact-head [CI #38072257423](https://github.com/lazyxu/xdrive/actions/runs/38072257423) green including Final Gate, rebase merge `9e1589b7`, temporary branch deleted. Post-#1341 audit confirmed that explicit Select All and subsequent virtual Search range requests now pass `AbortSignal`, but the initial authoritative counted Search request in `useXDriveFileExplorerSearch.executeSearch` still called the same loader *without* a signal. Old queries could continue consuming Go/PostgreSQL time after a new committed query, explicit Clear, active tab/owner switch, or Files unmount even though generation fences discarded their late results.

The existing **shared Search controller** now owns one first-page `AbortController`: a new request/clear/filter replacement aborts the previous controller; workspace history-entry change/account replacement/unmount runs cleanup. The first page passes its signal through the already shared `WebFileExplorer → XDriveApi.searchRange → fetch` transport; aborted first-page completions never publish errors, counts or group indexes. This adds no new endpoint or Mobile business controller, and does not modify the app-wide 52px global bar, App Frame, row virtualizer, tab rules, thumbnails or current Server permission semantics. The Go Server Search handler already derives an 8s-scoped query context from `c.Request.Context()`; no fake per-request Server cancel endpoint is introduced.

**Verification plan:** mount the real shared Workspace/Search hooks for superseding Search, Clear, account/session switch and unmount with an in-flight first-page promise; assert immediately aborted `signal`, no stale results or error toasts, and the new query's correct ready state; statically assert the actual single Web REST transport is used by both Wide and Mobile presentations. Full CI, real HTTP→Go cancel latency, iOS 27 Safari/PWA screenshots/VoiceOver, paired 375/390/899/900 authorization and 10k/100k physical browser measurements are separate acceptance tiers. Desktop Search's initial renderer→Agent IPC cancellation is explicitly not claimed by this Web/Mobile change.


## 2026-10-11 F-iOS27-09A · direct context menu Cut/Copy and shared eligibility

**Merged:** [PR #1353](https://github.com/lazyxu/xdrive/pull/1353) passed exact-head [CI #38104145868](https://github.com/lazyxu/xdrive/actions/runs/38104145868) and Final Gate with 2,088 Desktop tests passing (0 failed, 1 skipped); rebase merge `0110ff8b`; remote short branch verified removed. Physical-device acceptance is separate. Audit of the actual Wide Web `XDriveFileExplorer.openItemContextMenuAt` found four direct clipboard/destination actions (`cut`, `copy`, `move-to`, `copy-to`) using the shared `selectionActionDisabledReason(action, [item], 1)`. Mobile Files' long-hold and keyboard context showed only Move To / Copy To, not Cut/Copy, and those two were visually enabled even when the same Wide Web eligibility returned a denial. Mobile's separate selection toolbar could work around some actions, but the iOS 27 native-style long-hold contract and Web/Mobile parity were incomplete.

Mobile adds the missing direct **剪切 / 复制** alongside **移动到… / 复制到…** using the *existing* `WebFileExplorer` callbacks and `getSelectionActionDisabledReason(action, [item], 1)`. The item context is the exact clicked Node ID, revision and kind, not a stale virtual page or an unrelated multi-selection; disabled reasons are visible via native menu title and are rechecked on direct callback invocation. Already-supplied shared action IDs are not rendered twice. All four menu targets are >=44 CSS px; ordinary writes remain hidden in Trash. The same shared Server authorization/clipboard/destination logic controls the result. No new REST endpoint, Mobile file-operation engine, virtual collection, App Frame/footer, titlebar or internal multi-tab support.

**Regression tiers:** mounted actual `MobileFiles` tests for file/folder Cut/Copy/Move/CopyTo, exact ID/revision, 44px targets, validator feedback/forced-denial guard, Trash exclusion and duplicate shared menu IDs, plus a source contract proving the single Wide Web operation controller. Full Web/Desktop/Go PR CI and Final Gate are required before merge; separate physical Safari/PWA iOS 27 screenshot, VoiceOver and 375/390/899/900px live Server error/parity verification remain **unmeasured**.

**F-iOS27-09 parity matrix (incremental, not physical signoff)**

| Capability / state | Wide Web | Mobile Web 375/390/899 | 900px | Evidence/remaining |
| --- | --- | --- | --- | --- |
| Per-item Copy/Cut | existing shared context | staged 09A direct context | wide context | mounted 09A tests; real Safari/network not run |
| Per-item Move To/Copy To denial | shared eligibility | staged 09A shared eligibility | wide context | mounted 403/revision-like validator tests; live ACL not run |
| Trash ordinary item writes | suppressed by operation mode | staged suppressed | wide context | mounted guard, live Trash not run |
| 10k/100k virtual selection and cancellation | merged 08D | merged 08D | wide behavior | unit/mounted only; real latency and RSS outstanding |
| Search initial/count/ranges | merged 08E / 08D | shared merged 08E / 08D | wide behavior | mounted + CI; real browser Network timing outstanding |
| Internal file multi-tab | supported | intentionally omitted | supported | sole approved feature exception |
| Native iOS 27 visual pixel/gesture | not the native layout | target 1:1 below 52px bar | wide design | reference screenshot diff, Safari/PWA/VoiceOver unverified |


## 2026-10-11 F-iOS27-09B · shared hardware keyboard command parity

**Merged:** [PR #1357](https://github.com/lazyxu/xdrive/pull/1357) passed exact-head [CI #38105725999](https://github.com/lazyxu/xdrive/actions/runs/38105725999) including Final Gate, Desktop 2,097 passed / 0 failed / 1 skipped, rebase merge `b0c5eff1`, and verified branch removal. Physical iOS 27 acceptance remains unmeasured. A direct source audit found the normal wide FileExplorer already uses `xDriveFileExplorerKeyboardCommand` and a platform-aware keyboard profile. The iOS-style `MobileFiles` surface had per-row Enter/Space/ContextMenu only, even though its existing one Web adapter already supported real copy/cut/paste/delete, undo/redo, full logical Select All and selection cancellation. Narrow desktop windows and iPad external keyboards therefore had a genuine behavioral mismatch.

Mobile now invokes **the exact same exported keyboard command interpreter** for Ctrl/Cmd+A, selected and single focused-node Ctrl/Cmd+C/X, Delete, real Web Paste and Undo/Redo. On iPad, Cmd+Option+V forwards `'move'` through `WebFileExplorer -> useXDriveFileExplorerOperationController.pasteClipboard`, preserving Server-operation semantics. Escape first aborts an active full logical Select All via the existing per-selection `AbortController` and retains previous selection; otherwise it ends selection mode with the existing Done cleanup. Search focus still uses the actual shared global all-files Search, not a pretend folder-scoped implementation. Editable inputs, dialogs, popups, IME composition, repeats, unrelated Browse-home/Trash states retain native key ownership. Scoped operation callbacks still check current Node ID/revision via the same wide-Web validator and Server; no Mobile-only REST client, clipboard or virtualizer. Internal multiple file tabs remain the single allowed Mobile exception.

**Proposed tests:** mounted React `MobileFiles` harness loads the **actual shared keyboard parser** (not a handwritten shortcut replica) and checks whole-directory selection and stable clipboard identity, focused row exact ID/revision, Undo/Redo and canPaste gate, simulated iPad Cmd+Option+V operation override, native input/IME/dialog isolation, denied Server-backed operations and Escape-induced 100k in-flight selection abort. Web adapter source contract asserts `onPaste` forwards the real override. Only exact-head Web + Desktop mounted tests + Go/API/Server/platform/artifact + Final Gate success can establish CI acceptance. Real 375/390/899/900px browser, iOS 27 Safari/PWA, VoiceOver and measured 10k/100k server cancellation/CPU/RSS remain **not verified**.

This phase deliberately does not claim every native Files keyboard capability or iOS 27 pixel-perfect geometry: shortcuts for additional supported actions, 1:1 screenshots and physical device behavior need separate evidence.


## 2026-10-11 F-iOS27-09C1 · real built-Web/Chromium FileExplorer width and operation parity

**Merged and tested:** [#1365](https://github.com/lazyxu/xdrive/pull/1365), exact-head [CI #38109103574](https://github.com/lazyxu/xdrive/actions/runs/38109103574) green including Final Gate, 375/390/899/900px real Chromium operation identity and 44px settled context targets passed; linear merge `1d085701`, merged short branch removed by [cleanup #38112560250](https://github.com/lazyxu/xdrive/actions/runs/38112560250). Physical iOS 27 remains unverified. The first real Chrome run [#38108538342](https://github.com/lazyxu/xdrive/actions/runs/38108538342) executed 375/390/899/900, proved identical four genuine Copy→Paste Server request payloads, correct breakpoint/App Frame/52px header/virtual scroll owner, zero browser/unknown API errors, but flagged 375/390/899 menu items' *entering* bounding boxes of 20–26 CSS px despite styled min-height 44. MUI Menu uses a Grow transform; tests now record both **opening transform** and **settled physical box + CSS min-height**, rejecting targets that remain below 44px after transition. CI rerun is required before attributing the small opening bbox to a true persistent UI defect or declaring browser passed. Following green and merged #1357, the next acceptance gap is *actual built Web* at the 899/900 CSS px ownership boundary, not another source-only assertion. Reuse the existing `desktop/scripts/mobile-web-app-browser.cjs` test fixture and GitHub Web CI's opt-in installed host Chrome/Playwright: the branch named `test/mobile-files-ios27-real-chrome-*` enables a dedicated `--scenario=files-ios27-chrome` pass. It records **375, 390, 899 and 900 CSS px** root-folder state, real App/scroll geometry, full-dynamic-viewport App Frame, retained **52px global xDrive title bar**, viewport item window count, native-like file context menu entries and 44px click targets, and the actual request emitted by a file Copy→Paste. The wide 900px owner uses the existing shared Web file row's keyboard Copy/Paste; all narrower owners use actual Mobile Files context Copy and the same Web Paste. Every submission must carry the **same exact** `{type:'copy',parent_id:1,items:[{id:100,revision:1}]}` to the same `/api/v1/file-operations` route, with no extra Mobile HTTP API or second virtual list.

The test runs the **built real React app in native Chromium** and intercepts real browser HTTP calls with a **strict bounded local fixture**: no physical iPhone/Safari, no live Go/Postgres Server, no real authorization/403 enforcement, and no 10k/100k physical CPU/RSS measurement is established by these 97-node fixture views. Every unknown API/external request, browser console error, runtime exception or structural mismatch fails acceptance. Its result artifact includes 375/390/899/900 screenshots of Files and opened context states, JSON per-width geometry/requests, the exact PR and tested-checkout SHAs, SHA-256 hashes of built Web assets and relevant controller sources, and the version of Chrome used. Separate actual Apple iOS **27** reference screenshots and pixel-difference metrics are still required for **measured 1:1**, and real authenticated Server/10k/100k acceptance stays outstanding.

Keep one `WebFileExplorer` business Workspace/Server API, shared range/virtual collection and property/operation controllers, full App Frame + 52px global title, independent Desktop transport, and Mobile's only internal multi-tab exception. Do not mistake Chrome evidence for a native iOS 27 reference or ship fake Shared/Scanner controls.


### True iOS 27 Mobile context hitbox gap verified in native Chrome (2026-10-11)

The **second** actual Chrome run [#38108924989](https://github.com/lazyxu/xdrive/actions/runs/38108924989) measured the menu **after** 400ms settling. At **375/390px** the computed `min-height` was 44px and Popover transform `matrix(1,0,0,1,0,0)`: the early 20–26px boxes were only Grow animation. At **899px** the transform was also identity, **but computed `min-height` remained 0px**, proving an actual style regression at the MUI `sm` breakpoint, not a source/test assertion artifact. Four real Copy→Paste requests remained canonical; zero unknown/JS errors.

**Scoped implementation:** The existing Mobile item-context Menu's `slotProps.paper.sx` sets a more specific descendant rule `'& .MuiMenuItem-root': { minHeight: MIN_TOUCH }` (MIN_TOUCH=44), overriding MUI's `sm+` MenuItem default for **shared and Mobile-only context actions** without altering wide Web, all App Frames, Server transport, virtual collection or any other menu. Added a contract regression and require the exact-head real Chrome 375/390/899/900 check to confirm all settled hitboxes before merging. This establishes browser touch geometry under the fixture, **not iOS 27 native screenshot/VoiceOver acceptance**.


## 2026-10-11 F-iOS27-09C2 · native Chrome 403/409 rename equivalence

**Merged:** [PR #1371](https://github.com/lazyxu/xdrive/pull/1371), exact-head [CI #38113964643](https://github.com/lazyxu/xdrive/actions/runs/38113964643) green including four-width native Chrome, linear merge `f888da8f`; temporary branch verified removed. ** The prior 09C1 pass established the responsive layouts' same real Copy→Paste HTTP operation, but did **not** exercise actual Server rejection and optimistic revision on both FileExplorer presentation modes. Extend the *existing* `files-ios27-chrome` 375/390/899/900 real Chrome workflow to call the **same `XDriveApi.rename`** from both Mobile Web's shared `XDriveFileNameDialog` and 900px Wide Web's inline `TextField` — their presentation differs, but the account-scoped back-end `PATCH /api/v1/nodes/100` ID and `If-Match:"1"` must be equivalent.

The bounded fixture refuses the first request with **403**, the explicit retry with **409**, and accepts the third write only after the user changes the draft. The strict browser checker must ensure refused writes never mutate the Node/revision, never discard the user's typed text or silently dismiss the editor, display the actual returned error, never perform an implicit duplicate PATCH, and then close/refresh exactly once after the successful write to revision 2. Test each 375/390/899/900 width; capture 403/409/success screenshots, per-attempt HTTP status/body/revision, actual rendered UI, app-frame/52px and source hashes; reject all unrecognized API/external requests. Use the already verified exact-branch Chrome CI opt-in. No production API, business controller, virtualization or xDrive App architecture duplication. Mobile's internal multiple-file tab remains the sole exception.

**Evidence tiers:** This is genuine built-Web/Chromium and real intercepted browser requests, but its response source is a deliberately strict **mock server fixture**. It is **not** an actual Go/PostgreSQL permission refusal or conflict, native iOS 27 screenshot pixel pass, Safari/PWA VoiceOver, or physical 10k/100k resource/cancellation measurement. Those remain open and must be reported separately.
 
## 2026-10-11 F-iOS27-09D · shared busy-rename eligibility across layouts

**Merged:** [PR #1377](https://github.com/lazyxu/xdrive/pull/1377), exact-head [CI #38117937525](https://github.com/lazyxu/xdrive/actions/runs/38117937525) green including four-width Chrome and Final Gate, linear merge `d6f8773b`; temporary branch verified removed. Physical Apple iOS acceptance remains outstanding. ** The already-merged 09C2 live Chrome fixture validates normal Rename 403→409→200 on four responsive widths. A direct source audit found that wide Web's `XDriveFileExplorer` receives `renameDisabled={trashActive || fileOperationBusy}`, but compact Mobile previously enabled the held Rename command without that same in-flight mutation gate. The fix forwards **exactly that existing** boolean into the Mobile presentation, disables the MenuItem, guards direct action calls and prevents a dialog opened just before an operation becomes busy from issuing a competing HTTP write. The existing shared `XDriveFileNameDialog` retains the user's draft and shows a retryable error; once idle it submits the original Node ID/revision via the same `WebFileExplorer.renameItem → XDriveApi.rename`. No new Mobile API, authorization, cancellation owner, virtualizer, server endpoint or internal multi-tabs.

**Required verification:** mounted React held-context disabled/callback guard and active-dialog busy→idle retry, same wide-Web gate source contract, TypeScript/build, and full exact-head PR CI, followed separately by real Server ACL, native iOS 27 Safari/PWA/VoiceOver, and matched-reference pixel comparison. Preserve full App Frame and separate 52px title.

## 2026-10-11 F-iOS27-09E · Mobile Files six-menu 44px MUI breakpoint consistency

**Merged:** [PR #1379](https://github.com/lazyxu/xdrive/pull/1379), exact-head [CI #38119214561](https://github.com/lazyxu/xdrive/actions/runs/38119214561) successful including real Chromium 375/390/899/900, Desktop/Go/API and Final Gate; linear merge `a8e1a895`, short-lived branch independently verified absent. Actual iOS device pixel acceptance remains pending. F09C1 measured a persistent computed \`min-height:0px\` at 899 CSS px on individual MUI \`MenuItem\` controls despite \`sx.minHeight:44\`, proving an \`sm+\` breakpoint rule overrode them. The previously merged fix applied a higher-specificity \`& .MuiMenuItem-root\` paper rule only to the held-item context; Mobile Files' other five Menu papers still lacked that shared override.

F09E keeps a single **Mobile-only 44px paper touch rule** across all six existing MUI menus: held-item context, batch selection, More, Sort/Group, saved-search and Recent/Favorites context. Retain each menu's existing logic, permission/disabled state, grouping, max height, Server APIs and shared virtualization; do not touch wide Web/Desktop, full App Frame, independent **52px App Header**, or Mobile's sole internal multi-tab exception.

Added mounted React six-menu paper contract and extended the existing opt-in real Chromium Files 375/390/899/900 gate to measure settled bounding rectangles and computed CSS min-height on every visible More/Sort/batch MenuItem after MUI Grow, with screenshot/per-width artifact recording. Mobile saved-search and Recent/Favorites are mounted-contract verified; native Safari/PWA/VoiceOver and pixel references are still unmeasured. This is not a live Go ACL or 10k/100k throughput benchmark.

## 2026-10-11 F-iOS27-09F · real Recent/Favorites/Smart Folder menus and rejection/retry

**Merged:** [PR #1384](https://github.com/lazyxu/xdrive/pull/1384), exact-head [CI #38125682995](https://github.com/lazyxu/xdrive/actions/runs/38125682995) successful including Chrome, Go/API, Desktop and Final Gate, linear merge `4d6b94cc`; related temporary branch verified absent. Native iOS 27 visual acceptance remains unverified. Follow-on to merged F09E [#1379](https://github.com/lazyxu/xdrive/pull/1379). The previous Chrome pass measured More, Sort/Group and selection actions, but the **Recent/Favorites collection context** and **Browse Edit saved-search menu** only had mounted MUI source-level geometry assertions.

This phase extends the **existing** opt-in built-Web Chromium `files-ios27-chrome` gate at 375/390/899 CSS px (900px stays wide-Web). A strict mock response uses the real Go API DTO shapes for Recent, Favorites and Saved Searches with immutable Node ID/revision, not mobile-specific endpoints. Real keyboard Shift+F10 opens Recent and copies through `WebFileExplorer.collectionAction → XDriveApi.node`; actual Favorites `DELETE /api/v1/file-favorites/104` and Saved Search `DELETE /api/v1/file-saved-searches/17` intentionally fail 403 before one explicit 200 retry. Verify refusal retains original entries and saved-search confirmation with inline alert; success changes only the selected record, never underlying Nodes. The existing six MUI menu papers must each yield settled >=44px real bounding rectangles at all three mobile widths. Screenshot, CSS metrics, exact code checksums, emitted requests, app geometry and one shared virtual scroll owner are retained in the same CI artifact.

No new production business logic, Mobile-only transport/virtual list, Server ACL bypass, App Frame change, global **52px** titlebar change or second Viewer. **Not yet verified:** actual PostgreSQL/Go 403/204 responses, iOS 27 Safari/PWA/VoiceOver and pixel reference comparisons, and 10k/100k physical benchmarks.

## 2026-10-11 F-iOS27-09G · live Go/PostgreSQL collection owner scope and 204 success parity

**Merged:** [PR #1389](https://github.com/lazyxu/xdrive/pull/1389), exact-head [GitHub CI #38126915890](https://github.com/lazyxu/xdrive/actions/runs/38126915890) successful, linear merge `8f3c913b`, temporary work branch verified absent. F09F's genuine built-Web Chrome UI used strict *intercepted HTTP mocks*, including synthetic 403 refusals and a provisional **200 JSON null** response for successful Favorite and Saved Search DELETE. The real Go handlers intentionally return empty-body **204** on successful owner DELETE, and their cross-owner semantics differ: an unrelated account's favorite DELETE is **idempotent 204, with zero other-owner rows affected**, whereas update/delete of another account's saved-search ID returns **404**, with the target owner's rule untouched. Do not mislabel the synthetic 403 as an observed PostgreSQL authorization response or change production auth semantics to force the mocked code.

F09G extends existing isolated-schema **real PostgreSQL/Gin** integration tests to prove both accounts' token-scoped access, foreign favorite DELETE nonmutation, foreign saved-search PATCH/DELETE 404, independently owned saved rules, genuine owner 204 deletion, accurate repeat-DELETE idempotence/difference, and preservation of underlying Node IDs and contents. The existing real-Chromium `files-ios27-chrome` gate still checks 375/390/899/900px and synthetic 403 feedback/retry, but successful collection DELETE is now precisely **204 with no response body**, proving the same shared Web `XDriveApi` handles the actual Go success response. No new Mobile API, business model/virtualizer, Server route, permission bypass, App Frame or 52px global titlebar alteration; the Mobile internal multi-tabs omission remains the only exception.

**Proof tiers:** Go/API PR CI with `XD_TEST_DATABASE_URL` establishes database-backed owner security; Chrome CI validates the actual UI and Web HTTP behavior against deliberately intercepted responses. These are complementary, not a single browser-to-live-PostgreSQL E2E. iOS 27 Safari/PWA/VoiceOver, legitimate Apple screenshot pixel diffs and measured 10k/100k browser CPU/RSS remain outstanding.


## 2026-10-11 F-iOS27-09H · Mobile Files breadcrumb 44px touch acceptance

**Scope: one bounded presentation fix and real-browser regression, not physical iOS 27 certification.** After F09G merged, a source audit found that Mobile Files' ancestor breadcrumb buttons still hard-coded a 36px minimum height, smaller than the 44 CSS px mobile touch target already required for folder disclosure and menu actions. The compact path is an independently horizontally scrollable Files control, not the 52px xDrive App Header. This is a confirmed touch-target gap; it is not a measured iOS 27 reference-image pixel discrepancy.

Existing Mobile Files breadcrumb MUI Buttons now use MIN_TOUCH for minimum width and height and prevent flex shrink, preserving horizontal scroll rather than shrinking controls below the touch budget. No change to the global App Frame/header, wide Web/Desktop business controllers, Server REST APIs, shared virtual collection, sparse pagination, thumbnail provider, directory history or internal tabs.

The opt-in built-Web Chromium files-ios27-chrome gate uses 375/390/899 mobile widths alongside its existing 900px wide Web checks. It opens a nested folder using the established Server-fixtured Web route, measures both actual ancestor buttons' computed min-width/min-height and settled bounding boxes (at least 43.5 CSS px actual box and 44px computed minimum), screenshots the nested path and returned root, then clicks the parent breadcrumb. It checks the canonical files?dir=1 route, no new FileOperation write, and exactly one virtual scroll owner. A Node source-contract regression requires these real-browser checks to remain present.

**Evidence boundary:** Chrome uses bounded strict intercepted HTTP fixtures, not iOS 27 physical Safari/PWA or a browser-to-live-Go/PostgreSQL integration. Real Apple iOS 27 screenshot-diff, VoiceOver, hardware/software keyboard, safe areas and measured 10k/100k CPU/RSS/cancellation remain gaps. Exact-head GitHub PR CI and Final Gate are required before merging; no unverified CI, GitLab push or full native 1:1 acceptance is claimed.


### F09H first real CI failure and correction

Initial exact-head [CI #38135566591](https://github.com/lazyxu/xdrive/actions/runs/38135566591) **failed**, with Desktop tests 2,146 passed / 1 failed and real Chromium failing at the first 375px nested-folder breadcrumb wait. Existing Copy/Paste, Rename 403→409→200 and six-menu touch checks passed. The browser requested Node 2 on a direct `files?dir=2` link but displayed root directory; no `/nodes/2/children` range request was observed. The legacy Desktop source-only test separately expected a hard-coded one-line `if (narrow) await ...` despite the necessary grouped mobile checks.

The existing `WebFileExplorer` deep-link effect reserves `routedDirectoryRef` before its asynchronous ancestor resolution. React.StrictMode cleans up the first mount effect, invalidating that request while leaving its reservation in place; the replay then skips the same target. The correction releases **only the matching request identity** during cleanup and retains all existing navigation intent checks. The browser test still requires a genuine nested-folder deep link at 375/390/899px and now checks the authentic shared Server-fixtured `/nodes/2/children` HTTP range before the MUI 44px geometry, ancestor click and single-scroll-owner assertions. The prior Desktop menu check accepts the same gated block rather than requiring a one-line textual shape. Complete exact-head CI remains mandatory; no physical iOS 27 or live Go/PostgreSQL certification is inferred.


### F09H startup route ownership clarification

The first failed Chromium DOM also showed the loaded root, not merely an absent breadcrumb. A second audit identified the separate contributing mechanism in the same shared Web adapter: `onDirectoryChange` reported root as soon as background root bootstrap finished, while the direct `files?dir=2` navigation had not yet resolved. Its parent App synchronously rewrote the browser route to `files?dir=1`, superseding the pending target. Releasing the StrictMode request reservation alone is not sufficient.

The same `WebFileExplorer` now attaches the owning navigation-intent ID to the pending route request and suppresses **only the temporary root directory's route notification** while that exact requested target's navigation intent remains current. Successful authorization/range navigation still reports the target normally. When the user initiates another valid navigation, the shared intent changes and the normal callback is not suppressed. This does not create separate Mobile state, change the Web/Server permission rules, or mask an actual rejected deep link. Strict Chrome acceptance additionally asserts that the original requested nested URL remains canonical after loading.


### F09H continued 2026-10-11 · ancestor navigation first-red and bounded fix

[Exact-head CI #38137671826](https://github.com/lazyxu/xdrive/actions/runs/38137671826) failed only its real built-Web Chromium Files acceptance, while Desktop, Web build, Go/API, Go Windows, Server, client-core and artifact jobs succeeded. Its 375px run proved the canonical direct `files?dir=2` link and `GET /api/v1/nodes/2/children` range for 64 entries, and measured both real MUI ancestor buttons at >=44 CSS px. Clicking the root ancestor did not persist `files?dir=1`; the browser reread parent/child directories and remained on the old nested route. This is a reproduced interaction defect, not a native Apple pixel-diff failure.

Cause: the Web deep-link effect discarded `routedDirectoryRef` upon every `current?.id` dependency cleanup, even after successfully dispatching the deep-link navigation. On ancestor click, the workspace moved to the root before App URL synchronization, and the stale nested URL was incorrectly re-dispatched. The fix retains the **dispatched** deep-link ticket across transient workspace updates and resets it only when the requested route ID or session genuinely changes; a cancelled **never-dispatched** lookup still releases its ticket for React StrictMode replay. The same authenticated Server API, shared Web workspace, sparse virtual list and full-screen App Frame with independent 52px title remain intact.

The strict 375/390/899px Chrome acceptance now verifies that ancestor click yields root content and `files?dir=1`, remains there after settling (no old child range reentry), then revisits `files?dir=2` through an external hash change in the same mounted Web App and retains exactly one virtual scroll owner. Existing 900px wide Web operation checks, rename 403→409→200, real menu touch measurements, and collection semantics remain mandatory. This work still requires successful CI and is not physical iOS 27, live Go/PostgreSQL browser E2E, or 100k performance signoff.


### F09H cross-viewport persisted-session first-red and explicit-route correction

The next [CI #38139257328](https://github.com/lazyxu/xdrive/actions/runs/38139257328) real built-Web Chromium Files check passed the whole 375px nested-crumb sequence, including `dir=2 → dir=1` without bouncing, and same-mounted-App `dir=2` re-entry. At 390px, after intentionally reusing the same browser account and reloading the explicit root route `files?dir=1`, the saved prior-folder session restored `dir=2` and the expected root file was no longer available. The recorded 390px fixture hash was `#/app/files?dir=2`. This is a real deep-link versus persisted-navigation precedence gap; it was not waived as test flakiness.

The existing Web-owned route effect incorrectly skipped an **explicit** route when `current?.id === initialDirectoryID` during the initial root bootstrap, leaving the later asynchronous persisted-session restoration free to replace the requested route. It now always processes an explicit URL route once per requested ID/session (fenced by its existing dispatched ticket), even if the transient current directory happens to match. The route intent must supersede stale persisted work, while normal app opening without `?dir` continues to reuse the saved folder. The existing 375/390/899/900px Chromium scenario adds a settled check that explicit `dir=1` survives previous-folder restoration before attempting actions. All original shared Web REST, Server authorization, one sparse virtual collection, full-screen App Frame, 52px header and mobile-only internal multi-tab omission remain unchanged.

This is a proposed correction pending new exact-head CI, not a verified iOS 27 reference-image 1:1, live-Go browser E2E or physical 10k/100k benchmark.


### F09H explicit URL and persisted session ordering (further proven red)

[CI #38139625096](https://github.com/lazyxu/xdrive/actions/runs/38139625096) still reproduced an explicit `files?dir=1` root route being overwritten with persisted `dir=2` on the next 390px reload, even after the Web deep-link effect started eagerly. Source inspection identified the conflicting owner: the **shared** `useXDriveFileExplorerNavigation` hook independently restores the previously saved active directory on mount, and its request can compete with the Web deep-link resolver. This is a real cross-layout navigation precedence bug; another Web-only early-return change cannot guarantee the requested directory remains authoritative.

A narrowly scoped boolean `skipInitialSessionRestore` (default **false**) is now forwarded through the shared Web Workspace to the shared Navigation hook. Web opts in **only when a positive explicit `files?dir=ID` route is provided**. The saved tab/history DTO remains present, but the older active directory is not automatically fetched on initial mount; the existing Web Node-authorized route resolver alone activates the explicit target. Without a directory route, the existing per-account saved-directory restore behavior is unchanged. Desktop callers default to false, retaining their established IPC/storage contracts. Account lifecycle transitions honor the same flag. The real Chrome four-width fixture continues to require 250ms root-route stability and full operation parity.

The same 375px run also recorded one extra child-range request after a correct root ancestor navigation, **while the root URL and content remained correct**. Its reason and actual upstream HTTP cancellation latency are not established by this fixture; keep `childReadsBefore/After` as diagnostic evidence, but do not mislabel any nonzero request count as a visible navigation bounce. That performance/cancellation investigation belongs in separately measured 10k/100k workloads. The no-bounce acceptance still insists on the canonical root route, root content, no extra write and exactly one virtual scroll owner after settling.

Exact-work-head full CI is still required before merge. No physical iOS 27 screenshot/pixel, Safari/PWA/VoiceOver, browser-to-live-PostgreSQL or 10k/100k signoff is claimed.


### F09H exact-head Chromium green; Desktop contract correction

[PR CI #38139949550](https://github.com/lazyxu/xdrive/actions/runs/38139949550) ran the authentic built-Web Chromium Files matrix at 375/390/899/900px and the Web job **passed**, confirming the real 44px breadcrumb geometry, deep-link versus saved-folder precedence, nested return and re-entry, shared Copy/Paste/Node revision and Rename 403→409→200, and collection menu response semantics under strict intercepted HTTP. This remains browser-to-fixture evidence, not physical iOS 27 or browser-to-live-PostgreSQL signoff.

The only Desktop unit-suite failure was in the older **source contract assertion** for the F09H route-ticket object: it expected exactly three properties, but the proven navigation fix deliberately includes `dispatched: false` to distinguish an aborted StrictMode lookup from an already-issued route. The existing tests already assert `routedRequest.dispatched = true` and guarded cleanup. Update the object-shape assertion to require the fourth field rather than weakening/removing the regression. No product logic, Server API, shared virtualization, App Frame or visual UI is changed by this follow-up. Amend this correction into the same single work commit and require a new exact-head complete PR CI with Desktop suite and Final Gate green before merge.


## 2026-10-11 F-iOS27-09I-A · actual built Web → Go Gin → PostgreSQL17 first cross-layout parity

**Scope:** a bounded test-only first live-Server acceptance, not a claim that every iOS 27 Files interaction or a physical Apple device is certified. F09H [PR #1403](https://github.com/lazyxu/xdrive/pull/1403) has merged, passed exact-head [CI #38140462078](https://github.com/lazyxu/xdrive/actions/runs/38140462078), and its short-lived remote branch was verified deleted. Existing F09A–H Chrome screenshots and 403/409 fixtures are **strict intercepted responses**; the corresponding UI did not directly exercise owner authorization and revision updates against Go/PostgreSQL.

**New isolated real-Server acceptance:** a Linux-only opt-in Go test `TestIOS27FilesLiveGoFixture` creates a private PostgreSQL schema, real production `Server.Router`, two authenticated accounts, a Local CAS store and two genuine file Nodes (target and duplicate-name collision). It hosts the **actual built Web** bundle from the same local origin. The only test-specific URL is a bounded fixture-completion signal; `/api/v1` always passes into real Gin handlers. It validates foreign-account GET/PATCH as **404** (do not invent synthetic 403 where product authorization uses 404), records genuine 409 name conflicts and successful 200 guarded by original `If-Match`, and after the browser exits independently verifies the same persisted Node ID/owner, two revision increments and unchanged collision sentinel. Ready-file JWTs are mode 0600, outside uploaded artifacts, and never included in screenshots, logs or result JSON.

**Authentic Chromium matrix:** `desktop/scripts/files-ios27-real-go-browser.cjs` boots Chrome at **375, 390, 899, 900 CSS px** against this Server, measures one FileExplorer scroll owner and the independent **52px** xDrive App Header, verifies all widths read the same real Postgres Node ID/revision through real directory GET, then uses Mobile Files' shared rename dialog at 375px and Wide Web's existing inline editor at 900px. Each performs a deliberate live 409 name collision followed by an explicit successful retry; request bodies, immutable Node IDs and quoted `If-Match` values must match the real Server contract. A foreign-token GET/PATCH in the same browser network stack must produce actual 404 without mutating the owner's record. No `page.route.fulfill`, duplicated REST client, second virtualizer, fabricated permission status or new production handler is permitted.

**CI isolation:** only PR branches with `test/mobile-files-ios27-live-go-` enable the additional test in the **existing `go-linux-api` PostgreSQL17 job**, preserving the default full PR Final Gate. The task records the submitted PR head and actual checkout SHA, screenshots, source SHA-256 and nonsecret results. It must run **exact-head** before merging. The existing synthetic four-width Chrome scenario stays independent.

**Remaining after this first bounded proof:** real Server-facing bulk Copy/Move/Trash/Delete and Favorites/Saved Search UI owner-scope comparisons on every width, Safari/PWA/VoiceOver on physical iOS 27, legitimate iOS screenshot pixel diffs and systematic 10k/100k browser/Go CPU, RSS, throughput and `ctx.cancel` timing. None are inferred from successful fixture/unit tests. Retain the full-screen App Frame, separate 52px header, shared Server/Web/Desktop business APIs and sparse virtualized collection. Mobile Web omits only internal multi-file tabs.


### F09I-A first actual Gin/PG first-red and scoped corrections (2026-10-11)

The exact-head [CI #38143765290](https://github.com/lazyxu/xdrive/actions/runs/38143765290) executed the newly added **real Chromium → production Go Gin → isolated PostgreSQL17** chain (no fake REST response). The first three mobile CSS widths 375/390/899 completed valid directory GETs for the same real Node ID/revision. At **900px** the new test made a false assumption that the Mobile `[data-xdrive-mobile-app-header]` exists even when xDrive renders the established wide Web `.MuiAppBar-root`; the test timed out looking for a component that must not be mounted at this width. The browser now measures the real 52px Mobile header below 900px and the existing wide AppBar at/above 900px while retaining exactly one virtual scroll host. No production App Frame, global header, business controller or virtualized list changes were made.

More importantly, the actual Go handler `GET /api/v1/background-tasks/active-summary` repeatedly returned **HTTP 500** because the isolated test schema lacked `xd_photo_intelligence_reanalyze_intents`; Gin's real background task summarizer queried that persisted intent table. The fixture now migrates `meta.PhotoIntelligenceReanalyzeIntent` with its existing `meta.User` foreign key; it does not add a fixture-specific API bypass and the Chromium runner **continues failing on any HTTP >=500**. Logged transient `context canceled` requests due to document reload are not silently treated as successful responses; the test still requires no final genuine 5xx and exact persisted Node reconciliation.

The first-red did **not reach Mobile or Wide rename**, so 409→200 and foreign-token browser assertions remain unverified until the amended exact-head CI runs. Keep all app-level 375/390/899/900, 52px Mobile/unchanged Wide header, real Server auth, same virtualizer and total four guarded renames as mandatory gates. This is still not iOS 27 physical pixel/VoiceOver/PWA or measured 10k/100k performance proof.


### F09I-A next exact-head CI: full real summary dependency closure

[CI #38145047151](https://github.com/lazyxu/xdrive/actions/runs/38145047151) demonstrated the genuine, mocked-by-nothing path **four viewport widths, all four actual PATCH attempts [409, 200, 409, 200], foreign GET/PATCH 404, and independently verified PostgreSQL final Node ID/revision/name**. It still correctly failed due to six real HTTP 500s from `GET /api/v1/background-tasks/active-summary`. The PostgreSQL first-red explicitly identifies the **next missing isolated-fixture table** `xd_background_owner_cancellations` (queried by `backgroundOwnerCancellationTasks`). Source analysis of the product's `backgroundTaskActiveSummaryForOwner` then confirms it always queries **`xd_archive_prepare_runs`** after cancellations, operations and Sources. That table was also omitted by the narrow test schema and would be another 500 if only the first table were added.

The isolated real-Gin test schema now migrates the actual product `meta.BackgroundOwnerCancellation` and `meta.ArchivePrepareRun` models alongside the already-added `meta.PhotoIntelligenceReanalyzeIntent`, existing `meta.FileOperation`, `meta.Source` and `meta.SyncRun`. No production routing, cancellation, UI or SQL semantics are changed; the original HTTP >=500 browser failure gate remains mandatory. Desktop source-contract coverage names all three important background-query tables to prevent this fixture from drifting again. A new exact-head full PR CI must prove every live request returns without unexpected 5xx and complete the original final gate. Physical iOS 27 pixel/VoiceOver/PWA and 10k/100k performance remain separate.

## 2026-10-11 F-iOS27-09I-B · genuine Mobile/Wide Copy-to queued-contract parity

**Implementation submitted for exact-head CI; not yet merged or physically iOS verified.** Extend F09I-A’s built-Web Chromium → genuine Gin → isolated PostgreSQL 17 fixture using the real Mobile 375px item-context Copy-to and Wide 900px item-context Copy-to actions. Both invoke the existing shared `XDriveFileExplorerDestinationDialog`, choose distinct Server-created target folders and submit exactly one real `POST /api/v1/file-operations` each. The fixture verifies HTTP 202, the same source Node identity/current revision, two different authorized destination IDs and exactly two persisted owner-scoped `FileOperation` rows. A foreign owner with their own real root receives 404 when referencing the other account’s file. No mock or intercepted `/api/v1` reply, duplicate Mobile API or independent virtual list.

**Evidence boundary:** accepted operation queue submission and PostgreSQL persistence only. The fixture does not start/measure the background executor or verify completed Copy bytes/CAS, Move/Delete/Undo, conflict resolution, 100k throughput or iOS 27 native screenshots/gesture/VoiceOver/PWA. Those remain separate parity gates. The xDrive full-screen App Frame, 52px Mobile global app header, Wide Web AppBar, shared Server, operation controller and sparse virtualizer remain untouched. Require all exact-head PR CI jobs and Final Gate before linear merge; no GitLab push.


## 2026-10-11 F-iOS27-09I-C · genuine Move-to / Delete Web-Mobile queue parity

**Implementation submitted to exact-head GitHub CI; not yet merged or device-verified.** Continue the merged F09I-A/B production Chromium → Gin → PostgreSQL 17 browser harness. Create four distinct real owner-scoped CAS file Nodes and two Server-created Move targets. Use the actual Mobile 375px and Wide Web 900px context-menu **移动到…** actions, the one shared destination picker, and their respective **删除 → 移到回收站** confirmation flow. Assert each genuinely submits `POST /api/v1/file-operations` and gets 202 with exact Node ID/revision; Move has the selected target while Delete has no target. Go independently verifies two persisted Move and two Delete rows, correct target and source references, no duplicates, and no foreign-account operation. The real browser also asserts foreign account 404 on both methods. Virtualized rows are located through the existing single scroll host; no full collection scan, second API or Mobile-only controller.

**Scope boundary:** both layouts demonstrably **enqueue** Move/Delete through one shared backend, but this fixture does not run background workers or assert completed moved/deleted bytes, Trash restore, Undo/Redo, batch selection, move/delete conflict retry, 10k/100k request/CPU/RSS, iOS 27 Safari/PWA/VoiceOver, or reference screenshot pixel parity. These remain P0/P1 acceptance phases. Preserve full-screen App Frame, separate 52px global Mobile app header, wide Web AppBar, shared FileExplorer virtual collection, Web/Desktop Server and only one Mobile internal-tab exception. Exact work-head full CI and Final Gate are mandatory before linear merge. No GitLab delivery performed.

### F09I-C exact-head first browser failure and revised selector (2026-10-11)

[CI #38149802743](https://github.com/lazyxu/xdrive/actions/runs/38149802743) passed Web, Desktop, Go Linux, Windows and the pre-browser API race suite; real built Chromium reached all four widths, passed Rename and both Copy-to, and successfully queued both Mobile/Wide Move-to operations against actual Gin/PostgreSQL. It then failed at the **Mobile Delete confirmation locator**: `getByRole('dialog', {name: '确认操作'})` timed out. Existing `XDriveConfirmDialog` sets a generic `aria-label`, but shared MUI `DialogTitle` sets `aria-labelledby` with the dynamic delete title, which takes precedence for the accessible name. The single-work-commit correction targets the existing `[role="dialog"][aria-label="确认操作"]` DOM contract, and strictly asserts the real item-specific `DialogTitle` and actual `移到回收站` button. A new failure captures the visible dialog/title diagnosis and screenshot rather than relaxing the mutation proof. No production behavior/API/architecture changed. Require new exact-head CI including both real Delete writes and DB/owner checks before merging. Previous failed run does **not** prove Delete parity.

**MUI v7 root/Paper source recheck before acceptance:** upstream `@mui/material@7.3.11` `Dialog.js` spreads generic `aria-label` onto the **RootSlot/Modal** but applies `role="dialog"` and `aria-labelledby` to the inner **PaperSlot**. Accordingly, neither `getByRole('dialog',{name:'确认操作'})` nor `[role="dialog"][aria-label="确认操作"]` is the correct selector. The final correction uses the real dialog role filtered by exact source-specific confirmation text, checks its actual `DialogTitle`, clicks the genuine action, and retains failure screenshots/diagnostics. The full exact-head browser and final-gate result, not source inspection, determines whether this resolves F09I-C.

### F09I-C actual Wide Delete menu context after successful Mobile Delete

[CI #38151429127](https://github.com/lazyxu/xdrive/actions/runs/38151429127) passed Go race, Web, Desktop, Linux/Windows and verified the real Mobile Delete queued with HTTP 202 after both Move operations. The subsequent **Wide Delete** failed before submission because the test looked for the *single-item* `删除` menu entry but none was present. The existing wide `XDriveFileExplorer` code deliberately renders `删除所选项目` instead of that entry when `contextSelectionCount > 1`; persisted same-browser selection must not be mistaken for a production Delete failure. The scoped test now explicitly **left-clicks the precise Wide source file using the real wide selection handler** (which replaces previous selection), verifies its selected ARIA state, then right-clicks and requires `删除`, exact confirmation, HTTP 202 and PostgreSQL source/owner checks. Unexpected menus capture actual visible items, selection DOM IDs and a screenshot; the test does *not* blindly click `删除所选项目` or waive counts. Require all fresh exact-head gates before merge. No production changes.

### F09I-C Wide menu item keyboard-shortcut accessibility contract

A final source inspection confirms the exact-name locator failure more precisely: shared `FileExplorer.tsx` renders the Wide context `MenuItem` with a child box holding `删除` and a **second child holding the real keyboard shortcut** computed by `fileExplorerMenuShortcut('delete', keyboardProfile)`. The accessible name therefore includes more than the bare action label. The exact `getByRole('menuitem',{name:'删除',exact:true})` query is not valid even if the menu is functioning correctly. The revised browser test keeps its real single-item left-click (to exclude retained bulk selection), then locates the actual menu-item role by its child with visible exact text `删除`. This excludes `删除所选项目`, retains the real confirmation/POST/database checks and adds a regression against the incorrect exact accessible-name query. No production markup, keyboard behavior, business controller or backend is changed.

## 2026-10-11 F-iOS27-09I-D1 · real two-file batch Delete Web/Mobile parity

**GitHub implementation submitted for exact-head CI, not yet merged or native-iOS certified.** Extends the already merged and exact-head green F09I-C [PR #1428](https://github.com/lazyxu/xdrive/pull/1428) browser→Gin→PostgreSQL17 fixture: four additional real CAS file Nodes are allocated into **two separate two-file batches**. At 375 CSS px, Mobile Files uses its real `文件操作菜单 → 选择`, taps both real rendered rows, checks `aria-pressed`, and uses `删除已选`. At 900 CSS px, Wide Web uses a true first click plus Ctrl-click, checks both `aria-selected`, and invokes the shared multi-selection context action `删除所选项目`. Both use the original shared `XDriveConfirmDialog`, confirm the exact `将所选 2 个项目移到回收站？` title, and send a **single** actual `POST /api/v1/file-operations` containing exactly the two owned source IDs and current revisions, with HTTP 202, `total_items=2`, no target and distinct durable queue IDs.

Native Go independently inspects exactly two genuine PostgreSQL `FileOperation` rows with `type=delete`, `total_items=2`, status queued, exact independent two-ref groups, zero duplicate/mixed source, and a foreign-owner cross-account batch request that must return 404 with no persistent operation. Existing F09I-C single-item tests are retained separately; no UI adapter, mobile REST fork, new Server route, serialization of 10k/100k Nodes, or hidden multi-file tabs added.

**Boundary:** This phase certifies real two-item selection and **queued/persisted batch intent**, not the background worker's completed mutation, CAS contents, Trash restore, Undo/Redo, cancellation latency, 100k workload or iOS 27 native Safari/PWA/VoiceOver/pixel-level 1:1. Those require independent tests. Keep full-screen xDrive App Frame, separate 52px global Mobile title, desktop/wide Web header behavior, shared operations and virtual collection unchanged. Require full exact-head PR CI including genuine Chromium, Go API, Desktop and Final Gate before linear merge. Do not report GitLab delivery without an actual GitLab push.

### F09I-D1 first-red Chromium response-body ownership correction

The original exact-head [CI #38153602675](https://github.com/lazyxu/xdrive/actions/runs/38153602675) passed single-commit, Web/Desktop, Go Linux/Windows and the Go API race suite but **failed before any new batch-delete UI**: in the pre-existing first 375px real Gin root-range gate, `response.json()` reported Chromium `Network.getResponseBody: No resource with given identifier found`. The test had installed its real HTTP listener, navigated, **reloaded to a new document, then attempted to read the prior document's response body**. The amended same one-work-commit test now awaits the real 200 response and fully parses its real JSON **before** the deliberate reload; all Node IDs/revisions, 4-width viewport, original real-API, operations, owner security and new batch acceptance gates remain strict. A Desktop source regression guards the response-read-before-navigation order. This is fixture scheduling, not a production Web or Server defect; prior CI cannot validate the new work SHA. Require a fresh full exact-head CI and Final Gate before merge.


### F09I-D1 second authentic Chromium red · same-hash viewport request proof

The amended exact-head [CI #38154364048](https://github.com/lazyxu/xdrive/actions/runs/38154364048) confirmed **375px Mobile** served the real PostgreSQL Node, 52px global header and single virtual scroll owner, then failed the following 390px width *before batch operations* at the strict `page.waitForResponse(GET /api/v1/nodes/:id/children, 200)` with a 12-second timeout. The real Gin log recorded valid HTTP 200 child-range requests during initial loading but no guaranteed fresh request after the same-hash `page.goto()` of the second iteration: preserving the prior document means a mounted SPA workspace can reuse an already-loaded list. The prior change (read response bytes before next reload) addressed Chromium eviction but not this missing-request race.

**Source-exact correction:** each viewport first navigates to the canonical Files route, **then** arms the real GET response listener **before one explicit reload** that guarantees an actual new Server fetch. It consumes that reload's authentic Gin JSON before any subsequent navigation. A Desktop source contract enforces exact order and exactly one reload in the viewport loop. No intercepted API response, fabricated Node, skipped width, timeout increase, Server mutation or business-layer fork. Both independent real Mobile/Wide 2-file Delete submissions and database/foreign-owner verifications remain mandatory. Supersedes prior-head red results only after a new current-commit full CI and Final Gate pass; native iOS 27 and 100k performance remain unverified.


## 2026-10-12 F09I-D2 · actual two-file Copy-to and Move-to Web/Mobile parity

**One-commit GitHub PR submitted for exact-head CI; not yet merged or physical iOS 27 certified.** Predecessor #1436 passed authentic Chromium/Gin/PostgreSQL17, full CI and Final Gate, and linearly merged; its branch was automatically removed. Extend the identical built-Web real-server test with eight physically uploaded Local CAS Nodes grouped into four independent two-file sets under one owner-scoped nested directory. 375px Mobile uses its real More → Select and visible Move or More → Copy-to actions; 900px Wide uses first-click/Ctrl-click and the native selected-item context actions. Both use the shared destination dialog and exactly one real POST /api/v1/file-operations per two-source Copy-to/Move-to action. Require exact Node IDs/current revisions, owned target folder, HTTP 202, queued total_items=2, four distinct durable IDs and zero browser errors. Independent PostgreSQL assertions distinguish earlier single-item Copy/Move rows with total_items=1, verify exactly two separate Copy and two separate Move batch records, exact unmixed 2-ID groups and target IDs, and deny cross-owner two-item Copy/Move requests (404, no foreign persisted operation). All earlier 375/390/899/900, rename, single Copy/Move/Delete and batch Delete assertions remain enabled. These tests establish queued intent only, not Worker execution, Trash restore, CAS effects, cancellation, 100k throughput or iOS 27 Safari/PWA/VoiceOver/pixel 1:1. The full-screen App Frame, independent 52px global title, Web/Desktop shared Server/API/virtualizer and only Mobile internal-tab exception are unchanged.


### F09I-D2 nested picker path preflight

Existing production `XDriveFileExplorerDestinationDialog` starts with the current nested source directory in `initialCrumbs`, while D2's four real target folders are siblings under the parent root. The real-browser test now uses the **existing** root breadcrumb inside the shared destination picker before selecting the target (and asserts root is actionable/current nested crumb is disabled). It does not substitute a synthetic API response or bypass the physical source, actual queued operation, revision or cross-owner 404 checks. Only the test, its source contract and this handoff changed. The new exact-head full CI and Final Gate must pass before merging.


## 2026-10-12 F09I-D3 · real Worker completion of Chromium Web/Mobile queues

**Status: code submitted for exact-head CI, not yet green or merged.** Predecessor F09I-D2 #1443 is merged after full exact-head Chromium→Gin/PostgreSQL17 CI and Final Gate. This phase preserves those genuine 375/390/899/900px rename, single and two-item Copy/Move/Delete, destination breadcrumb, Node revision and owner-404 gates. After the browser completes and the real PostgreSQL queue assertions pass, the *same Server instance* executes precisely 12 real queued `FileOperation` records through `processNextFileOperation`, with zero new test-created mutation intents.

The Linux-only opt-in fixture checks all operations reached completed (exact count/processed bytes/items/no failures), six source-to-target Copy results with distinct Node IDs, matching physical SHA256/CAS storage key and real authenticated Gin downloads of original and copied bytes; six Moves retaining original Node ID, incremented revision, parent and real content; six Delete operations becoming owner-scoped Trash roots while preserving their original CAS references. It restores all six through the **actual** authenticated Trash HTTP endpoint, checks original Node ID/parent/bytes, empty Trash and unchanged physical CAS blob count. Foreign-owner denied request persistence remains a hard zero. No production Server, Web/Mobile, Desktop IPC, REST or virtualizer changes; this proves worker effects for the isolated fixture, not iOS 27 physical Safari/PWA/VoiceOver 1:1, 10k/100k runtime, background scheduler responsiveness, Undo/Redo, cancellation latency or every failure/rollback path. Only Mobile internal multi-tabs remain exempt. Keep full-height App Frame and distinct 52px global header.


## 2026-10-12 F09I-D4 · authenticated Undo/Redo of genuine Web/Mobile batch operations

**Implementation submitted for exact-head CI; not yet merged or iOS27 native signoff.** F09I-D3 [PR #1448](https://github.com/lazyxu/xdrive/pull/1448) passed [full exact-head CI #38160321011](https://github.com/lazyxu/xdrive/actions/runs/38160321011), including real Chromium→Go/PostgreSQL17, twelve completed Worker actions, physical CAS/downloads, six Move identities and six Delete→Trash→real HTTP restore cycles, and Final Gate. Merged linearly at `ef026aa5`; temporary branch verified removed.

D4 does **not** create new fake source operations: after that exact D3 fixture completes, it identifies one real two-item **375px Mobile Copy-to** and one real two-item **900px Wide Move-to** from PostgreSQL, validates the original two immutable Node IDs/revisions, and uses owner-authenticated **production HTTP Undo then Redo** for each. The actual Go Worker executes these four new Undo/Redo tasks. Exact original/Undo/Redo lineage, the operation capability flags, the two copied Node IDs and CAS download bytes, the two moved original Node IDs/parent/revisions, zero foreign-owner authorization (404 on Undo/Redo), unchanged physical CAS blob count, and empty Trash afterward are hard assertions. Existing Mobile More→Undo/Redo and Wide command/keyboard callbacks are verified by source contract to route through the Web-owned action controller; **the D4 Undo/Redo button clicks themselves are not yet a genuine Mobile/Wide browser interaction test**. No production UI, Server, IPC, shared virtualizer, or FileExplorer business adapter changed.

Remaining: paired native iOS 27 Safari/PWA and real Apple reference screenshots with pixel diffs, VoiceOver/dynamic type/safe-area gestures, real Chrome tap-led Undo/Redo, failure/conflict rollback, in-flight cancellation/worker latency and 10k/100k physical performance. Preserve the full-screen App Frame and distinct 52px global header; internal multi-file tabs are the sole Mobile exception. Require all **current work-head** Go Linux/API, Windows, Web, Desktop, authentic Chromium/PostgreSQL, artifacts and Final Gate successful before Ready/linear merge. Do not treat this source-only and queue/HTTP evidence as full iOS 27 1:1 signoff.


## 2026-10-12 F09I-D5 · genuine Mobile/Wide UI Undo/Redo DOM clicks

**Status: submitted to exact-head GitHub PR CI; not yet merged or native iOS 27 certified.** The predecessor D4 [PR #1455](https://github.com/lazyxu/xdrive/pull/1455) passed complete exact-head [CI #38188078622](https://github.com/lazyxu/xdrive/actions/runs/38188078622) including PostgreSQL17, Go API, the genuine four HTTP Undo/Redo Worker outcomes, and Final Gate. It merged linearly as `03dfdf47` and its temporary branch was verified deleted.

D5 continues the **same** built-Web Chromium 375/390/899/900 → real Gin/PostgreSQL17/Local CAS fixture. After all genuine Mobile/Wide queued operations, cross-owner 404 and browser HTTP checks, a test-only `/__test/files/execute` barrier lets the original Go test perform all D3 and D4 Worker, CAS, Trash and authenticated Undo/Redo assertions **while the Chrome document stays alive**. It then reloads the real Files page: **375px Mobile** clicks `文件操作菜单 → 撤销 → 重做`, while **1600px Wide Web** clicks the real command-bar `撤销 → 重做` buttons. These are real rendered component clicks, not synthetic body generation or test-only REST mutation. Every click must produce exactly one original-app authenticated POST to `/api/v1/file-operations/:id/undo|redo`, status HTTP 202, a distinct persistent task and correct Undo/Redo lineage.

The private `/__test/files/process-next` endpoint only calls **real production Go `processNextFileOperation`** on one queued task and returns its observed database completion, never intercepts or mocks an application `/api/v1` response. A Go assertion after browser closure requires four completed persisted operations, expected lineage and two-item count, unchanged original moved Node IDs with exact parent/revision, byte-perfect Gin downloads, no new physical CAS blobs, empty Trash and zero cross-owner operations. Existing App Frame, the 52px global xDrive header, Desktop/Web shared Server/API/virtual list, and Mobile internal-tab-only exception remain untouched.

**Excluded from this gate:** physical iOS 27 Safari/PWA/VoiceOver real touch and pixel-matched Apple Files screenshots, long-running worker scheduling/cancellation, failure/rollback combinations and measured 10k/100k runtime. This is genuine cross-layout Chromium interaction evidence, not a declaration of full visual 1:1 parity. The exact submitted work-head must pass all complete Go Linux/API race, Windows, Web, Desktop, authentic Chromium, artifact tests and Final Gate before linear merge.


## 2026-10-12 F09I-D6 · live Mobile/Wide create-folder conflict and owner parity

**Status: candidate for exact-head GitHub CI; not yet merged or native-iOS certified.**
Frozen baseline: GitHub master at `f701ce7ebf3e422dc78046002b22d51144f5700d`,
after [F09I-D5 #1459](https://github.com/lazyxu/xdrive/pull/1459) passed
the authentic Go/Chromium Worker tap acceptance, merged and had its short-lived
branch removed. No viable outstanding Files PR or branch. Other Gallery,
performance and device-backup work is independent and untouched.

Extend the *existing* built-Web authenticated Chromium → Gin/PostgreSQL17/Local
CAS acceptance, preserving all D1–D5 375/390/899/900px, queued/completed
Copy/Move/Delete, Trash, Undo/Redo and cross-owner security assertions.
At **375px Mobile Web**, click the actual `文件操作菜单 → 新建文件夹`; at
**1600px Wide Web**, click its original `新建文件夹` toolbar button. Both
must open the **same** App-owned `XDriveFileNameDialog`, call the same
`XDriveApi.createDirectory` and POST to `/api/v1/nodes/:parentID/directories`.
Submit an existing folder name: require actual Server **409** and a visible
error with the still-editable draft. Retry with a unique name: require
actual **201**, the original owner parent, a real Node ID and a visible
refreshed virtualized row. The Mobile submit target must measure at least
44 CSS px on both axes. Save the two layouts' actual request/response
details, screenshot both rejection and success, and retain original
source hashes; no test HTTP response masquerades as `/api/v1`.

The Go fixture **independently** checks exact PostgreSQL child counts,
distinct owner Node IDs, unmodified original collision-sentinel directories,
foreign-owner GET **404** for both new Nodes, and foreign-owner POST
**404** with zero unauthorized child writes. The genuine Go Worker phase
then continues as before. This tests genuine Web/Mobile behavior, but
does not assert physical iOS 27 Safari/PWA/VoiceOver pixel-level
1:1, 10k/100k native virtual-scroll timings, or every failure/cancel race.

No production Server/REST, Web/Desktop business controller, MUI FileExplorer,
virtual-list implementation, permissions or transfer semantics change. The
shared file-name dialog's MUI Paper receives an explicit accessible name
because only the Paper owns the real `role=dialog`; this is a narrowly
scoped accessibility correction shared by Web, Mobile and Desktop.
Keep the existing full-screen App Frame, 52px global title bar, shared
Web/Desktop backend, and Mobile-only internal multi-tab exception. Merge
only after the **current one-work-commit head** passes the full Go Linux,
Windows, Web, Desktop, native Chromium/PostgreSQL, artifact and `final-gate`
suite; otherwise keep Draft and amend corrections into that one work commit.
GitLab not written.


### F09I-D6 first-red Go/API compilation correction (2026-10-12)

The first one-commit [CI #38191546928](https://github.com/lazyxu/xdrive/actions/runs/38191546928)
passed Desktop tests, one-commit, Web and other early build gates, but failed
the pre-existing `go-linux-api` `Race test internal/api` step **before**
the new live-Chromium test could run. Source audit identified a test-only
compile-time type mismatch: `requestNode` returns the public `nodeDTO`,
whereas the new unchanged-collision-sentinel loop incorrectly formed a
`[]meta.Node` from those DTOs. The correction uses `[]nodeDTO` for the
input list and still queries the actual full `meta.Node` from PostgreSQL.
The Desktop source contract now enforces that distinction. No production
Go handler, Web code or database model is changed. Treat previous red as
unverified browser work; require **new exact-head** full CI, including a
successfully reached actual Chromium→Gin/PostgreSQL17 step, before Ready
or merging.


### F09I-D6 second first-red · MUI Paper role-dialog name (2026-10-12)

On amended one-commit HEAD `9178fba18ceb68f0c675bcaf8957b67617d2f4f5`,
[CI #38191876701](https://github.com/lazyxu/xdrive/actions/runs/38191876701)
passed Go/API Race, all four real Chromium viewport baselines, four real
rename responses, genuine Mobile/Wide Copy/Move/Delete, multi-node batch
tasks, and Desktop/Web/Go Linux/Windows checks. The new first Mobile
create-folder acceptance timed out waiting for an *accessibly named*
`role=dialog` (12s), before any folder-creation POST occurred. GitHub's
native log records `folderCreates: 0`, `widths: 4`, `copyQueues: 2`,
`mutationQueues: 4`, `batchDeletes: 2`, `batchDestinations: 4`.

The shared `XDriveFileNameDialogView` had `aria-label={title}` on MUI's
outer `Dialog` root, but MUI places the actual `role=dialog` on its
Paper slot. Add the same accessible name to `slotProps.paper` and retain
the exact named-role browser assertion: this fixes a **real screen-reader
accessible-name defect**, rather than changing the test to match an
unnamed dialog. Add a source regression and pre-submit dialog screenshot
for the next genuine CI first-red. No Server API or shared virtualization
changes; require the new single-commit **exact head** to pass full CI
before merging.


### F09I-D6 third first-red · preserve established rename root label (2026-10-12)

On single-commit head `ed78d0293c5debdfdc96f300d02b00c050b308ab`,
[CI #38192630130](https://github.com/lazyxu/xdrive/actions/runs/38192630130)
exposed four existing Mobile rename DOM-runtime contract failures in the
`desktop-tests` job: each expected one legacy wrapper
`aria-label=重命名`. The Paper accessible-name correction had removed
the wrapper attribute, changing an established testing/accessibility
contract unnecessarily. Keep **both** the existing outer
`aria-label={title}` and the new `slotProps.paper['aria-label']=title`
for the genuine `role=dialog`. Existing rename behavior and tests
must stay unchanged; the new native Chromium test still requires the
accessible name on the real Paper. Re-run exact-head full CI; do not
waive either check.

### F09I-D6 fourth native Chromium first-red · Files-owned create destination (2026-10-12)

[Exact-head CI #38192832687](https://github.com/lazyxu/xdrive/actions/runs/38192832687) passed
`desktop-tests`, Web, Go/Linux+Windows and its prior D1–D5 live Chromium/Gin
routes (four viewports, real Rename/Copy/Move/Delete queues, owner fences), but
failed at the first Mobile `新建文件夹`: a real 375px artifact showed the
More menu without a visible named create dialog; the existing DOM test awaited
`role=dialog` for 12s and found none. Keeping its strict accessible-name
assertion is mandatory; the earlier MUI Paper label fix alone did not fix this.

Source-level root-cause candidate: Web `MobileFiles` already shows the
Server-authorized *inner* `WebFileExplorer` workspace, while the outer App's
separately initialized `useXDriveCloudFilesController.current` can be absent
at the instant the user activates the menu. Its existing onCreateFolder action
silently returned in that case, even though the file browser was interactive.
The bounded fix makes **one** Files-owned callback resolve its current directory
ID and pass that to the outer App dialog's stable parent-ID reservation. Mobile,
Wide and context menu callers share that callback; the existing API and all
Server permissions remain unchanged. The outer Overview caller retains its
own established current-directory behavior. An on-failure browser diagnostic
now stores the *actual* role=dialog and More menu DOM plus a post-timeout
screenshot without fabricating or accepting any business response. This
is a candidate fix pending **new exact-head full CI**; not a certified iOS 27
Safari/PWA/VoiceOver pixel or native touch validation. Do not merge on source
contracts alone.

### F09I-D6 fifth candidate correction · preserve existing Web create scope contract

[First CI for Files-owned callback #38194410469](https://github.com/lazyxu/xdrive/actions/runs/38194410469)
reported two Desktop source-contract failures before full completion of the
native Chromium gate. The pre-existing create-scope unit test compiled the
old App `onCreateFolder()` handler with an outer `current` and did not
supply the new Files-owned directory argument. The corrected **stronger**
regression composes the actual shared Workspace `createFolderInCurrentDirectory`
callback (directory A) with App's exact `onCreateFolder(directoryID)` while
`App.current` is **null**, then switches App's `current` to directory B
before submitting, still requiring that only directory **A** is posted. A
legacy source-only text assertion requiring the old forwarding prop is replaced
with the new shared callback assertion, which remains covered by actual
execution. No additional production code change; no gates waived. Require
fresh exact-head Desktop, Go, Web, real Chromium/PostgreSQL and final gate.


### Sixth real Chrome first-red: duplicate DialogTitle title ID (F09I-D6)

On exact-head CI #38198542744, actual Chromium still saw the focused,
visible, correctly layered create-folder Paper but exact
`getByRole('dialog', { name: '新建文件夹' })` did not match. MUI's
`DialogTitle` automatically inherits the Paper's `aria-labelledby`
through context. The previously added text-only `Typography` reused
that same ID, so the DOM had **two elements with one label ID**; the
earlier outer title included its separate Close action. The shared
`XDriveDialogTitle` now gives that outer container its own
`<titleID>-container` when a text-only title ID is specified, preserving
unchanged defaults for all other dialogs. Real browser acceptance must
still resolve exact `role=dialog` by name, then assert one referenced
node whose complete text is `新建文件夹`, while preserving the genuine
Go/PostgreSQL 409→201 and cross-owner 404 gates. No broad text-match
fallback, bypassed API or false pass. Implementation amended into the
existing **single work commit**; this new exact-head CI must be green
before Ready/merge.
