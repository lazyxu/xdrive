# Mobile Web Files · independent iOS-style presentation

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
