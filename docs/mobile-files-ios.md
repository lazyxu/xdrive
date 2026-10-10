# Mobile Web Files · iOS 27 Files 1:1 target with shared xDrive architecture

**2026-10-10 normative update:** The [iOS 27 Files 1:1 visual and interaction benchmark](mobile-files-ios27.md) now governs the Mobile Files presentation. Existing Q1–Q6 are historical functional/product constraints where compatible; the earlier iOS 26 blue icon visual reference is insufficient to claim iOS 27 pixel parity. Preserve full App Frame, independent 52px App Header, shared REST/controllers/virtualization and the sole Mobile internal-tab exception.

Status: **Q1–Q6 implementation merged via [PR #1160](https://github.com/lazyxu/xdrive/pull/1160)** (full PR CI [#37935896054](https://github.com/lazyxu/xdrive/actions/runs/37935896054) passed). **Grouped visual labels and Q2 resume semantics are covered by the current follow-up correction; physical-device acceptance remains pending.**
Decision date: 2026-10-09. The six user-approved choices are normative.

## Product decisions (Q1–Q6)

| Choice | Immutable rule |
| --- | --- |
| Q1 A | Internal Files-only bottom rail: **最近 / 浏览 / 收藏**. No global bottom navigation, no multiple file tabs. |
| Q2 A | First open shows **浏览** home. Later opens restore the last legitimate folder and scroll offset for this signed-in account; a route with an explicit `dir` overrides persisted navigation. |
| Q3 A | A compact iOS-style search under the folder heading folds away during scrolling, remains reachable by returning to the top; Search is backed by the existing Server. |
| Q4 A | Create folder, upload file/folder, paste, selection, sort, view switching and management actions live in the **top-right ··· menu**, never per-file overlays or floating action buttons. |
| Q5 A | Blue folder icons, lightweight two-line file rows, optional icon grid. View preference is **Mobile-only** and must not overwrite Desktop Columns/Details/Grid preferences. |
| Q6 A | Search is explicitly labeled **全部文件** and uses existing `searchRange`; it does **not** claim current-folder/subfolder filtering or emulate it client-side. |

## Architecture and ownership

- `web/src/WebFileExplorer.tsx` remains the sole Web adapter for `XDriveApi`, REST auth, `useXDriveFileExplorerWorkspace`, paging, Search, recent/favorites, Quick Access, tags/Smart Folders, clipboard, file mutations, destination dialogs and Viewer launches.
- Below 900 CSS px it renders `web/src/MobileFiles.tsx` in place of the large shared Desktop `XDriveFileExplorer`. Above that breakpoint the previous Desktop-class Web surface stays intact. The UI substitution does not add a Mobile REST API or fork Server semantics.
- `web/src/mobileFilesState.ts` defines a strict, per-account state codec and bounded viewport projection. Persist only `section`, valid folder ID, scroll offset and Mobile-only list/grid preference. Do not persist mutable API data or another file tree.
- Mobile mounts a fixed-count virtual list/grid using `XDriveFileExplorerVirtualCollection.itemAt` and `onRangeChange`, an existing thumbnail provider, Server result counts, stable IDs and the same shared pointer-drag owner. It never renders/filters all 10k/100k nodes in memory.
- Existing Web dialogs and operations remain outside the Mobile/desktop presentation switch; direct selection actions and context-menu actions use those same controller callbacks. G06 authoritative `NodeLocation` remains the only source of “显示所在文件夹”.
- Media files continue to open the existing Web Viewer and consume shared media metadata/Properties; Mobile must not mount a duplicate player.
- App Frame top-left **exits the Web App**. Files-internal **返回** navigates folder ancestry only. Viewer overlay returns to mounted Files content. No hidden mobile file-tab commands.
- Mobile bottom rail is entirely inside the Files App below the single owner scroll region. It is distinct from any platform-wide navigation and must not cover the App Header, item scroll host, uploading progress or selection actions.

## Interaction states

**Browsing home:** Each fresh Files App launch selects Browse. A returning user resumes the last valid browsing directory and scroll position even if Recent/Favorites was the last temporary in-App tab. An explicit `dir` route still overrides the saved destination. Location entries are Cloud Files and Trash; optional pinned folders, saved searches and tags follow. Each represents a real already-supported destination. First open is Browse, not current directory. The bottom rail is Recent / Browse / Favorites and every section has an actual empty state. A pinned/recent folder is entered only after the existing controller confirms navigation succeeded; switching tabs must not discard the last Browse folder or scroll.

**Folder / Search:** Folder title, Files-internal back, visible search, object list/grid and item count. When group-by is enabled, use the existing Server-issued `virtualCollection.groups` indices plus the shared `xDriveCreateFileExplorerGroupLayout` and `xDriveFileExplorerVisibleGroupSegments` to render real headings; item counts and range requests remain bounded by the same viewport. A grouping menu is not sufficient when the corresponding headings are absent. Do not invent local grouping from partially loaded pages. Search results show the true global scope and clean/retry states. A directory changes the one mounted browsing context. Up from an ordinary direct child enters cloud root; Up again from cloud root enters Browse home; neither calls the App Frame exit. A search/Smart Folder from any Files tab is Server-scoped globally and clears back to the preceding home/folder state without overwriting its saved folder/scroll.

**Files:** Short tap launches existing Open Resolver; stationary 450 ms hold opens the Context Menu on release; held movement may drag to an eligible mounted folder or ancestor crumb, with same Server-side eligibility and confirmation. Ordinary scrolling, second touch, touch cancellation and invalid targets must not mutate files or activate a menu row.

**Selection:** Explicit Select, checked rows and an ephemeral operation toolbar for Copy, Move, Delete and More (Cut, Copy To, Download, Tags). Batch callbacks consume the exact selected ID/revision snapshots and are still validated by Web operation controllers, including revision/limit failures; rejected operations do not silently clear selection or fake success. The bounded explicit `全选` loads the entire authoritative range only when at most **200** items are present (the shared atomic move/copy/delete cap); for larger 10k/100k results it explains that the scope must be narrowed rather than submitting an arbitrary loaded-only subset. Multi-selecting individual already-loaded items remains supported.

**Collections:** Recent and Favorites rows support press-and-hold/right-click menus as well as ordinary Open. Authorized `NodeLocation` powers Show in Folder, Favorites can be removed, and clearing Recent requires explicit confirmation and removes **only the access-history records**, never user files.

**Formatting:** Only Mobile Files renders the two-layer cyan-blue folder (front face gradient #7dceeb → #5dbce3 → #4caddb) and a white folded-page file icon with a compact format stripe for known types. The palette has been calibrated visually against the [Apple Support Files screenshot](https://cdsassets.apple.com/live/7WUAS350/images/icloud/ios-26-iphone-16-pro-files-icloud-drive-downloads.png) in its [published documentation](https://support.apple.com/en-au/102440); this specific screenshot is labeled iOS 26, while the [current guide](https://support.apple.com/guide/iphone/modify-files-and-folders-iphc61044c11/27/ios/27) covers iOS 27. The light-blue back/front gradient, subtle blue border and near-white ridge are pinned in one shared Mobile-only palette. The source screenshot was visually inspected, **not losslessly downloaded and numerically pixel-sampled**, so identical RGB values and native pixel-for-pixel equivalence remain unverified. These are original SVG approximations, not redistributed Apple assets. Media thumbnails remain actual source-derived images loaded only for visible cells, not artificially drawn thumbnails. Error/loading behavior and square, nonrounded presentation are unchanged. Desktop and wide Web FileExplorer retain their Windows-style icons.

## 2026-10-10 Mobile Files alignment follow-up (PR #1183)

**Implementation scope: first two recommended batches plus visible arrangement status, not a new file browser.** Work remains on the existing single-commit PR until its authoritative CI passes.

- **Browse home:** The cloud root, Recently Deleted, saved Smart Folders and tags have four different semantic icons; only actual folders (including pinned folders) receive the blue iOS-inspired folder silhouette. This is Mobile-only and does not change the Server model or Desktop icons.
- **Recent / Favorites:** Project the real node revision/modified timestamp into their lightweight entries. Media rows now use the exact same `XDriveFileExplorerThumbnailProvider` and `XDriveFileExplorerThumbnail` that directory rows use, including viewport admission, six-request global concurrency, blob leasing and cancellation. Do not prefetch offscreen items or fabricate failed media thumbnails.
- **Collection file actions:** Keep Open / Show in Folder / Properties / Unfavorite as appropriate; add Copy, Download and file Share without hydrating the whole directory. The Web adapter calls `api.node(entry.id)` on demand, validates ID/kind and session ownership, then dispatches through the existing session-owned clipboard, download or share implementation. Clipboard Copy stores the freshly fetched node/revision and remains pasteable when the source directory page is not mounted. No new file API is introduced.
- **Selection:** An explicit selection state shows circular checked/unchecked indicators and a selected-item count in the heading, moves Select All / Done to the title row, and **replaces** the category rail with Copy / Move / Download / Delete / More. The existing bounded Select All and server-side action eligibility/error contracts remain unchanged; selection must survive rejected operations.
- **Arrangement feedback:** The project count line also displays authoritative sort key and direction, Mobile list/grid choice and grouping when enabled. Changing a visual preference must not invent a Server-side sort or overwrite the wide-Web preference.
- **Progress / performance:** Mark Mobile scroll activity in the shared thumbnail scheduler so offscreen/rapid-scroll requests are deferred or cancelled by the existing queue. Rendering remains bounded by `mobileFilesWindow`; Recent and Favorites remain virtualized.

**Out of this PR:** Native iPhone Safari / VoiceOver / soft-keyboard evidence, PDF first-page thumbnail generation, configurable Browse-home sections, on-device file byte sharing, inline folder expansion, per-folder colors / emoji and 10k/100k physical throughput measurement. These require their own acceptance/dependency work; a source-level contract test or Chromium simulation is not a physical-device pass.

## 2026-10-10 Browse home folding and editing follow-up

Follow-up to #1183; this phase reuses the existing Server-owned order of Quick Access folders and Saved Searches.

- The **Browse** home screen has 44px collapsible headings for pinned folders and the combined smart-search/tag section. The collapsed state is stored per signed-in account in the separate `xdrive.mobile.files.sections.v1:<session>` browser preference. Location links and the Cloud Files root remain directly reachable, regardless of that preference. This preference never reorders or deletes Server resources.
- The Files-only **··· → 整理浏览首页** edit mode exposes explicit 44px Up/Down buttons for the currently authorized Quick Access folders and Saved Searches. Both actions pass the full ID order to `quickAccess.reorder` or `organization.reorderSavedSearches`; the shared controllers own optimistic UI, rollback and Server error handling. Tags stay visible but do not falsely claim unsupported Server ordering.
- The edit mode has a top-level **完成** action; clicking editable location rows does not navigate unexpectedly during edit. Outside edit mode existing Browse/Recent/Favorites navigation and one-viewer behavior are unchanged.
- No additional backend endpoints, no extra tabs, no duplicate Web state or Desktop view-preference changes. Reordering and folding tests must preserve 100k windowing (without expanding nested folder contents) and verify per-account isolation.
- **Not claimed:** native drag-to-reorder gesture, true iOS platform icon bytes, on-device screenshots or assistive-technology pass.

## 2026-10-10 Native iOS/Android file-byte share (follow-up stage)

- **Share link remains separate.** A normal `分享/分享链接` action still uses xDrive's authenticated link-sharing flow. When the browser advertises **both** `navigator.share` and `navigator.canShare`, a separate `系统分享文件` action becomes available on a single, ordinary file in the Mobile Files directory context menu and Recent/Favorites menu.
- **Two real user gestures:** The first tap explicitly opens a modal and performs an authenticated, bounded GET of the *current* file. Only once complete does the modal enable `打开系统分享`. That second physical tap calls `navigator.share({files:[File]})` synchronously, without an `await` consuming transient user activation. Browser cancellation closes the modal quietly; genuine errors stay visible for retry. The OS share sheet is never claimed to have completed before its promise resolves.
- **Security and transport:** No new Server API: after `/api/v1/nodes/{id}` revalidation, use the existing authenticated `/api/v1/files/{id}/content` endpoint. Reject directories, invalid/unknown node sizes, any file larger than **16 MiB**, non-200/partial responses, too-large or malformed Content-Length, too many streamed bytes, and final byte-count mismatch. No network request starts just from listing a file. The fixed cap avoids loading large video/PDF assets into the browser heap; normal streaming Download and share-link options remain available for them.
- **Abort/lifecycle:** Modal dismissal, Mobile directory/tab switches, account transition and component unmount abort outstanding preparation. Prevent double share-sheet submissions. Keep the resulting `File` only until the modal closes; do not persist it in localStorage, thumbnail caches, Service Workers or logs.
- **Acceptance:** Pure reader tests prove bounded memory, partial rejection and cancellation; mounted React tests prove preparation never auto-launches OS share and the confirmation is a separate click. Real iOS Safari/Android Chrome testing of Web Share targets, cancellation and received-file bytes remains **not run** until a physical device is available.

## 2026-10-10 F-iOS-01A · native-look chrome and menu metadata

**Status: implemented on a one-work-commit GitHub PR; merge and physical-device acceptance are separately gated.** This is a Mobile-only presentation increment after merged PRs #1183, #1196 and #1198, not a claim that iOS Files has been pixel-for-pixel cloned.

- Use a scroll-owned **34px large section title** above the existing all-files search, while the small 17px title in the Files-internal navigation row is visually hidden initially and appears only once the user scrolls 48px or enters Select / Edit. Keep exactly one scroll owner and the outer **52px App Frame Header** with upload/download and app switch untouched.
- Define Mobile-only iOS-like system font stack, light/dark page backgrounds and neutral search-field surfaces. Group Browse Locations / Quick Access / Organization, Recent/Favorites and regular directory rows in inset **13px rounded section surfaces**. File list keeps its existing 68px virtual row / 150px grid-row geometry, thumbnail admission, Server grouping and 10k/100k bounded page loading. Use inset separators inside list cards instead of full-bleed row borders.
- Surface the **existing shared FileExplorer context action icons, dividers and danger flags** with native-like grouped menu paper. Render ordinary Copy To / Move / Rename / Properties above the destructive group; preserve Web Share's distinct link-share and OS-file-share controls and all existing callbacks. Do not add a new file mutation path.
- Scope style overrides to Mobile Files; do not change the canonical Web/Desktop MUI theme, iOS proprietary icon binaries, Desktop context menu, Server search behavior or full-screen outer App Header.
- Contract + mounted React tests cover expanding/compact titles, one scroll owner, location/list shells, shared icon and destructive menu metadata, native-file-share preservation and desktop preference isolation.
- **Not yet implemented:** Recent 2.0 full pagination/date groups, precise Apple-specific glyph assets, native drag reorder, PDF page-1 persistent thumbnail, content-aware file icons, native scanning, cross-account shared-to-me collection, tag sort/folder-inline expansion. No native iPhone/iPad Safari screenshots, assistive-technology pass or numeric pixel error measurement are claimed.

## Acceptance requirements

1. Web build and typecheck, Desktop full tests, required PR CI / final gate; no change to Desktop or wide-Web FileExplorer. Mobile App Header must reuse the exact same noncompact `XDriveTransferPopover` as wide Web at **all mobile widths**, including real-time upload/download rates, active/history, retry and clearing; never move or duplicate it in the sidebar. The App title can truncate before the transfer trigger.
2. 320/350/375/390/430/899/900 CSS px: App Frame full viewport, one Files top heading, one visible scroll host and one internal three-item rail; no horizontal overflow, duplicated global footer or hidden per-file action overlay.
3. Browse initial state; last folder/scroll restored across remount; explicit `#/app/files?dir=...` has priority; account/session isolation; browser App Back separate from directory Back; Viewer round trip stable.
4. List and grid at 10k/100k: bounded mounted rows, `onRangeChange`, cancellation and thumbnail requests tied to viewport. Do not claim any timing gain without repeatable 100k measurements.
5. Search all-file scope, committed query, authoritative count, filter/saved-search path and clear/retry; folder sorting and menu actions do not filter only the loaded range.
6. Rename, new folder, upload, download, clipboard, move/copy, delete, trash, favorites, recent, tags/Smart Folders and Properties retain the same Web API/error/permission behavior.
7. Contract tests run under `desktop/tests/mobile-files-ios.cjs` (state codec, bounded viewport, API ownership, interaction scope, grouped projection assertions) and `desktop/tests/mobile-files-ios-runtime.cjs` (mounted React Browse/Recent/Favorites, resumed Browse, directory Up, global Search, grouping headers backed by real shared layout functions, 100k bounded grouped viewport, selection, contextual operations). Commands: `cd desktop && npm run test:main` and `cd web && npm run lint && npm run build`. These are not physical-device or browser geometry evidence.
8. Native iOS Safari/home-screen and Android Chrome/installed-mode checks are **pending until actually run**. Compare native Files screenshots with the default folder, generic file, PDF, document and archive icons in both list/grid, light/dark; verify the 320/350/375/390/430px header shows both transfer speeds and its popover remains operable. Exact proprietary assets or pixel-matched glyphs require an approved source and the target iOS release. Do not label Chromium emulation as a real-device pass.

This document overrides older Mobile clauses in `docs/file-explorer.md` and the original iOS comparison inventory where they describe a shared Desktop-like command bar, a per-row More button, long-press-to-select or a global floating Apps control.

## 2026-10-10 F-PARITY-01A · Web/Mobile property parity

**Status: implemented on a stacked draft PR; full CI, merge and hardware acceptance remain separate.**
- Mobile Properties receives the exact Web adapter's existing `loadPropertiesStats`, which uses the authenticated Server `filePropertiesStats` endpoint and shares the abortable `useXDriveFileExplorerPropertiesController` with wide Web. No renderer-side directory recursion, second API shape or separate permissions.
- Reuse the common `XDriveFilePropertiesDialog` and `XDriveMediaDetailsInspector` with the same directory recursive bytes/file/folder counts, Source provenance, timestamps, path, SHA-256, revision and availability where backed by item metadata. Live Photo `.livp` follows the media inspector instead of silently using the generic five-field fallback.
- Closing the property inspector aborts stats work. The mounted React test covers the real shared stats hook and abort, plus count/source values. Native Safari interaction and a full server-backed end-to-end test remain outstanding.
- Recent/Favorites properties pass their recorded path and timestamp through the same property projection, rather than substituting the directory currently open in Browse.
- **Permanent product invariant:** wide Web and Mobile Web Files must have equal real end-user functionality, authorization, data state, errors/retries and cancellation. Only internal multi-tab UI and commands are exempt on Mobile; iOS-native chrome is solely a presentation difference. Maintain a paired feature matrix and tests for both layouts rather than counting menu visibility as implemented behavior.
- F-iOS27-02 adds wide-Web Undo/Redo, workspace Back/Forward and Copy Paths to reachable Mobile menus and delegates Mobile's 10k/100k virtual window to the same shared Details kernel, preserving Mobile's 300px admission floor. These are pending authoritative CI and must not be marked merged here.
- Remaining parity includes saved-search editing/deletion/replacement, keyboard shortcuts, Multi-properties, Quick Look alternatives and true folder-inline list disclosure where an authoritative nested range API is available. Internal file tabs remain the only accepted permanent omission; missing behaviors are open bugs.


## 2026-10-10 F-PARITY-03 · saved searches in Mobile Browse

**Merged:** PR #1222 after full CI #37985494553; work branch deleted. Wide Web already supports saved-search Rename, Replace and Delete. Mobile Browse's explicit Edit mode now reaches these exact Web-owned operations from a 44px Smart Folder options trigger and shared `XDriveFileNameDialog`. Update Existing Smart Folder is additionally accessible while the **committed Server all-files Search** is active; an explicit target picker prevents replacing a rule with an empty non-search Home state.

A modal confirms that deleting a saved rule does not remove matching files, guards double-clicks, and retains the draft and error after failure. Loading/failed organization reads are not mislabeled as an empty list; a Retry uses the existing `organization.refresh` controller. The subtitle derives from the same shared readable search-rule labels as wide Web. One owner-scoped `XDriveApi`, operation controller and virtual collection remain unchanged. Add mounted behavior tests plus source contract, and retain physical-device iOS 27 acceptance as not-run.

## 2026-10-10 F-PARITY-04 · shared Preview and external browser-tab actions

**Merged:** PR #1224 after full CI #37987118818; branch deleted. Mobile Files adds a keyboard Space and explicit context-menu Quick Look through the existing wide Web `openWebQuickLook` callback and Web App Runtime `preview` route; Enter and short tap remain the normal file Open. It never instantiates a second file/media viewer or new preview API. Mobile no longer suppresses the shared `open-browser-tab` action; internal `open-new-tab` and the tab strip remain the only omitted tab concepts. Tests cover the exact commands, action ownership and unchanged mounted scroll host.
 
## 2026-10-10 F-PARITY-05 · Mobile Go to Folder path

**Merged:** [PR #1229](https://github.com/lazyxu/xdrive/pull/1229), full CI successful and work branch cleaned. This phase brings the wide Web FileExplorer address entry to Mobile's More menu without adding a new backend request or a second directory walker. The mobile dialog is prefilled from Web's shared `pathValue`; it calls the same `submitPath`, and browsing stays on the single Mobile context. Search remains explicitly `全部文件`. Empty values are rejected, Trash hides the action, and all 44px touch targets and the existing 52px App Frame title bar remain unchanged.

Tests verify callback delegation and state/viewport ownership. This is a functional parity increment, **not** an iOS 27 pixel-fidelity signoff.

## 2026-10-10 F-PARITY-06 · 外部文件/文件夹拖入

**已合并：[PR #1233](https://github.com/lazyxu/xdrive/pull/1233)；完整 CI #38014316056 通过，工作分支已清理。** 将现有宽屏 Web 的外部文件、文件夹、空目录和嵌套目录拖放能力接入 Mobile Files 的列表背景、真实文件夹行与上方祖先路径，统一调用共享 `xDriveFileExplorerReadExternalDrop` 和现有 Web 上传控制器。移动端的静止长按菜单与内部拖动仍使用原来的指针拖动组件，不得把外部拖入伪装成内部移动。后台账户、导航上下文或 Search 变化后，过期的异步目录读取结果不得触发上传；Trash 不允许拖入更改。

本阶段保留动态视口、52px App Header、共享后端、虚拟列表和缩略图调度。真实 iOS 27 设备的跨应用拖放、Safari/安装模式和 10k/100k 负载验收仍未执行。

## 2026-10-10 F-PARITY-07B · iOS 27 列表内展开

**当前为 PR 待 CI/合并阶段。** 已在独立代码分支完成 44px 独立展开按钮、父/子目录单虚拟窗口、可取消的现有 Server `listRange` 子目录分页、稀疏子节点注册至共享 Web 工作区 `nodeByID`，并支持展开、收起、错误/重试、帐户/视图变化后清理。普通点击与展开分离，移动端仍不创建自己的 FileExplorer REST API。FileExplorer 内部多标签页仍仅在宽屏可用。

待验收项目：完整 PR CI、真实 iOS 27 截图和触控/VoiceOver、100k 真实浏览器资源指标，以及分组列表内嵌展开。**保持全屏 App Frame 和独立的 52px 全局应用标题栏。**


## 2026-10-10 F-PARITY-07C · 分组列表内展开文件夹

**实现已提交到单工作提交短期 PR，待完整 CI 和合并。** #1243 的共享稀疏树索引及已合并的 #1249 实际展开/子目录分页保持不变。当前继续将按类型/日期/大小分组的列表接入相同的展开控制，后代项目插在父文件夹所属的 Server 权威分组内部；显示的分组名称和顺序不由已加载的部分数据自行推算。共享虚拟窗口、Server `listRange`、真实 Node 身份、文件操作、取消/重试/错误与 Web 一致。Mobile 仍没有内部多标签页；保留全屏 App Frame 和 52px 标题栏。

此项的 10k/100k 索引验证与实际 Chromium/iOS 设备、真实网络/内存、VoiceOver 和原生截图差异验收分开记录，不能标记为像素级 1:1 完成。

## 2026-10-10 F-PARITY-07E · 已选项目与虚拟页回收

**已编写实现与回归测试，待 GitHub 完整 CI、线性合并和分支清理。** 已展开文件夹中的文件或根目录文件，在 100k 列表快速滚动时可能从虚拟页缓存释放，但选中仍应保留：共享 Web 工作区仅按已选 ID/Revision（上限 200）保留真实 Node/所属目录信息，不能为了选中状态保留全部文件页。Mobile 使用一个新增的选择通知属性，不新增独立业务 API；Copy/Cut/Move/Download/Delete、授权、冲突和报错仍由原 Web/Server 控制器判定。完成选择或切换账户必须释放该记录。

本阶段的节点映射回归及 100k 逻辑测试不是 iOS 27 真机像素级/VoiceOver 验收，也不是实测浏览器 CPU、RSS、请求或取消速度。保持全屏 App Frame、52px 顶栏、共享后端；Mobile Web 唯一允许缺失的功能仍是内部多标签页。


## 2026-10-10 F-PARITY-07F-A · Mobile 全选范围和宽屏 Web 一致

**已合入：** [PR #1285](https://github.com/lazyxu/xdrive/pull/1285)，完整 PR CI [#38031123253](https://github.com/lazyxu/xdrive/actions/runs/38031123253) 成功，线性提交 `34036439`，工作分支已清理。此前 Mobile 文件管理器的全选在当前目录／搜索结果超过 200 项时直接拒绝，宽屏 Web 则可通过共享 `VirtualCollection.collectRange` 分批选择整个逻辑集合。现把 Mobile 全选接入相同 200 项分页常量，增加加载进度、取消、请求范围/重复 ID 校验及跨账户/目录/搜索状态的意图隔离。已选项目在失败或取消时保持原样，不回写半成品。

选择数量不同于操作限额：批量复制/移动/删除仍遵守 200 项上限，下载仍遵守 1000 项上限；不要通过截断选择列表伪装操作成功。符合可执行限额的选中项元数据只做有界保留，不保留 100k 个虚拟页。取消后不会继续拉取后续分页并忽略迟到结果，但目前未证明在途 HTTP 已同步调用后端 Go `ctx.cancel`，需要单独做取消链路测试。保留全屏 App Frame、52px 全局标题栏、Web/Desktop 共享后端和 Mobile 无内部多标签页的唯一例外。


## 2026-10-10 F-PARITY-07F-B · 批量操作可用状态与宽屏 Web 对齐

**单提交 PR 实现，等待 CI/合并验收。** Mobile 现在可全选 257/100k 个逻辑节点，但超过批量操作上限时仍将复制、移动、删除和更多菜单误标为可用。现将宽屏 Web 已用的 `getSelectionActionDisabledReason` 传入 Mobile 展示层，统一按钮禁用、菜单禁用、直接调用拦截及实际提示。写操作 200 项、下载 1000 项、标签 500 项的上限分别生效；选中、下载和文件修改仍走原 Web/Server 授权、版本验证和任务链路，不复制 REST 或控制器。补充 257 项挂载交互回归测试。

真实 iOS 27 像素、触控/VoiceOver、375/390/899/900px 权限错误矩阵与 10k/100k 真实资源测量仍未验收；全选在途 HTTP→Go `ctx.cancel` 另行专项测试。保留全屏 App Frame、52px 标题栏、共用虚拟化与 Mobile 仅省略内部多标签页的规则。
