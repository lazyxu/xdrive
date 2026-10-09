# Mobile Web Files · independent iOS-style presentation

Status: **implementation in PR, final integration/device acceptance pending**.
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

**Browsing home:** Location entries are Cloud Files and Trash; optional pinned folders, saved searches and tags follow. Each represents a real already-supported destination. First open is Browse, not current directory. The bottom rail is Recent / Browse / Favorites and every section has an actual empty state. A pinned/recent folder is entered only after the existing controller confirms navigation succeeded; switching tabs must not discard the last Browse folder or scroll.

**Folder / Search:** Folder title, Files-internal back, visible search, object list/grid and item count. Search results show the true global scope and clean/retry states. A directory changes the one mounted browsing context. Up from an ordinary direct child enters cloud root; Up again from cloud root enters Browse home; neither calls the App Frame exit. A search/Smart Folder from any Files tab is Server-scoped globally and clears back to the preceding home/folder state without overwriting its saved folder/scroll.

**Files:** Short tap launches existing Open Resolver; stationary 450 ms hold opens the Context Menu on release; held movement may drag to an eligible mounted folder or ancestor crumb, with same Server-side eligibility and confirmation. Ordinary scrolling, second touch, touch cancellation and invalid targets must not mutate files or activate a menu row.

**Selection:** Explicit Select, checked rows and an ephemeral operation toolbar for Copy, Move, Delete and More (Cut, Copy To, Download, Tags). Batch callbacks consume the exact selected ID/revision snapshots and are still validated by Web operation controllers, including revision/limit failures; rejected operations do not silently clear selection or fake success. The bounded explicit `全选` loads the entire authoritative range only when at most **200** items are present (the shared atomic move/copy/delete cap); for larger 10k/100k results it explains that the scope must be narrowed rather than submitting an arbitrary loaded-only subset. Multi-selecting individual already-loaded items remains supported.

**Collections:** Recent and Favorites rows support press-and-hold/right-click menus as well as ordinary Open. Authorized `NodeLocation` powers Show in Folder, Favorites can be removed, and clearing Recent requires explicit confirmation and removes **only the access-history records**, never user files.

**Formatting:** Folder blue #2677e8 on Mobile only. File primary icons/thumbnails reuse shared type projection, lazily decode only visible media and keep square thumbnail presentation without rounded overlays. Status/availability badges may be informative but not actionable overlays.

## Acceptance requirements

1. Web build and typecheck, Desktop full tests, required PR CI / final gate; no change to Desktop or wide-Web FileExplorer.
2. 320/350/375/390/430/899/900 CSS px: App Frame full viewport, one Files top heading, one visible scroll host and one internal three-item rail; no horizontal overflow, duplicated global footer or hidden per-file action overlay.
3. Browse initial state; last folder/scroll restored across remount; explicit `#/app/files?dir=...` has priority; account/session isolation; browser App Back separate from directory Back; Viewer round trip stable.
4. List and grid at 10k/100k: bounded mounted rows, `onRangeChange`, cancellation and thumbnail requests tied to viewport. Do not claim any timing gain without repeatable 100k measurements.
5. Search all-file scope, committed query, authoritative count, filter/saved-search path and clear/retry; folder sorting and menu actions do not filter only the loaded range.
6. Rename, new folder, upload, download, clipboard, move/copy, delete, trash, favorites, recent, tags/Smart Folders and Properties retain the same Web API/error/permission behavior.
7. Contract tests run under `desktop/tests/mobile-files-ios.cjs` (state codec, bounded viewport, API ownership, interaction scope) and `desktop/tests/mobile-files-ios-runtime.cjs` (mounted React Browse/Recent/Favorites, directory Up, global Search, saved restoration, selection, contextual operations). Commands: `cd desktop && npm run test:main` and `cd web && npm run lint && npm run build`. These are not physical-device or browser geometry evidence.
8. Native iOS Safari/home-screen and Android Chrome/installed-mode checks are **pending until actually run**. Do not label Chromium emulation as a real-device pass.

This document overrides older Mobile clauses in `docs/file-explorer.md` and the original iOS comparison inventory where they describe a shared Desktop-like command bar, a per-row More button, long-press-to-select or a global floating Apps control.
