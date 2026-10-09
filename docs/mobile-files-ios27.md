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
| Folder disclosure | In native List, separate forward/disclosure expands children in place; row open enters folder | **Missing** nested disclosure in xDrive Mobile. Do not infer children by filtering an already-loaded 100k parent range: implement real nested Server ranges with bounded virtualization before enabling |
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
