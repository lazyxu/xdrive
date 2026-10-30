# iOS native navigation and Photos-first UI contract (2026-10-30)

> **Active owner-approved product decision.** This is a UI/interaction specification, not evidence of a shipped iOS IPA. iOS uses **only SwiftUI/UIKit** as its final product UI; no React, PWA or WKWebView is used for new screens. Existing WebKit runtime remains a rollback path until the native cutover is validated. Refer to [mobile-native-migration.md](./mobile-native-migration.md).

## 1. One native application, five bottom destinations

The bottom navigation order is **全部 | 动态功能 | 图库 | 文件 | 我的**. All five *positions* are stable across portrait and landscape. The second slot is the **only** dynamically changing icon/name, for the last active non-fixed feature. Use a compact icon+label horizontal layout on iPhone landscape when needed; portrait uses icon above short label. Do not add a permanent side rail or a second bottom bar.

- **全部 (Launcher):** category-based native icon grid, search, favorites and recently opened functions. Opening a fixed feature selects its fixed destination; opening any other authorized feature selects the dynamic slot. The Launcher is an ordinary L1 tab, not a new root back stack.
- **动态功能 (Dynamic):** starts as 最近 if no previous eligible feature is known. Selecting backup/sync/transfers/storage/diagnostics/admin replaces only this slot's icon/label, never reorders the bar. A single tap resumes the last dynamic feature at its verified in-module location. A long press opens the recent dynamic feature picker; the same picker must be available through 全部 for VoiceOver and discoverability. On launch, restore only a permitted server/Owner-scoped route, not stale content or credentials.
- **图库 (Gallery):** fixed tab owning cloud photos, local PhotoKit media, authorized local albums, map/places, and Viewer entry/return. **地图 is a Gallery subroute** even when opened by a Launcher shortcut and must not consume the dynamic slot.
- **文件 (Files):** fixed tab owning folders, recent/favorites/search, supported read/write actions, and file Viewer entry/return. A PDF/video/image preview opened from Files does **not** change the dynamic slot.
- **我的 (Mine):** native server URL/LAN address and HTTPS diagnostics, Owner sign-in/out, verified server/Owner state, device/PhotoKit/backup permissions, theme and personal settings. **Server admin** is a role-verified feature in 全部, not a privilege conferred by the My tab or a DSM account.

Every visible action must be backed by a real authorized native capability. Show an explicit unavailable state for unfinished routes; never silently open WKWebView, present fabricated data, claim a false upload or expose admin tools before verified Server role.

## 2. Navigation and return semantics

- **Top-left back is strictly within the active feature's navigation stack.** It never automatically traverses other tabs or returns to the previous app feature.
- Each fixed destination and each resumable dynamic feature owns its own saved navigation path, list/search/filter/sort and scroll/view anchor. Inactive pages can release disposable views and image requests; restoring a tab may reload verified data.
- Opening a Launcher item switches to the correct destination; returning to Launcher requires tapping 全部, not back. A launcher shortcut to a Gallery map/photo or Files path first selects the owner tab and then navigates its own stack.
- A Viewer is presented from its originating feature; dismissal restores its source and anchor (folder position, album/timeline position or map camera/selected cell). If the origin is no longer authorized, dismiss to that feature's safe root, not another Owner's stale frame.
- Cross-feature links explicitly select the target tab and establish **only target-local** navigation. App restart/rotation must not reinterpret source Owner, device, or in-flight task state.
- Permission, login, password-change, server-switch and logout actions verify Owner/Root from the native session. Clear inactive media/metadata and pending UI confirmation identity on Owner A→B→A; never carry selected PhotoKit IDs or Preview URLs across an Owner switch.

## 3. Three native display levels

| Level | Navigation | Intended pages | Exit |
| --- | --- | --- | --- |
| L1 **标准** | Compact top app bar + five-slot bottom bar | launcher, local/cloud gallery wall, files, backups, transfers, storage, settings, admin | top-left feature-local back |
| L2 **专注** | Hide bottom bar and minimize top chrome; give an explicit restore affordance | map, complex Files split layout, large charts and logs | visible restore-navigation action; same feature/anchor |
| L3 **沉浸** | Hide app bottom bar; Viewer owns optional overlay controls | full still/video/Live, read-only PDF, media/text focused preview | dismiss/back to source feature with preserved anchor |

Use L1 as default. L2 should be explicitly entered or entered by a clearly specified feature transition, not silently on every landscape rotation. L3 is for opening media, not for making all management forms fullscreen. On iPhone landscape, favor a low-height compact bottom bar and 1–2 content columns, never force a cramped three-column Desktop layout. Respect safe areas, Dynamic Type, VoiceOver, swipe-back, keyboard and touch target size.

## 4. Photos/Gallery is implementation priority P0

1. **Native source switch:** local authorized PhotoKit media and **separately** Owner-authenticated cloud originals. Do not merge them or use server contents to assert a local photo was backed up. The current root-only `-xios-` original reader is **not** a complete Server PhotoAsset Gallery.
2. **Native photo wall:** bounded 64-item local PhotoKit pages, on-demand thumbnails; 48-item server original read pages and only visible Owner-scoped derivative thumbnails. Support still/video/Live local viewer; cloud Live ZIP must remain explicitly *not playable* until real pair restoration exists. Avoid unbounded 100k arrays or downloading originals for grid thumbnails.
3. **Native albums:** a genuine user/smart album list with bounded paging, then a read-only **album-specific photo wall**; enforce Full/Limited PhotoKit permission and library-change invalidation. Do not label a mere album-count diagnostic as the finished album browser, or persist/transmit PhotoKit local IDs.
4. **Gallery navigation:** local/cloud/album subroutes share the Gallery fixed tab; map is Gallery's own subroute. Viewer opens L3 and returns to the exact Gallery source; live image/media loaders cancel on disappearance/background and must not leak past an Owner or permission change.
5. **Backup is preserved, not rewritten:** keep the existing encrypted V1/V2 intent ledger, original still/video/Live uploads, UploadSession/CAS/Node receipts and global writer exclusion. Separate manual consent/foreground schedule/BG grants. An uncertain ACK is not a failure to retry blindly; require bounded reconciliation. UI navigation must never cancel an acknowledged durable backup or create a second writer.
6. **No false parity claim:** server PhotoAsset gallery, native map, the complete Files CRUD, shared album organization and cloud Live playback remain separate follow-ups until actually implemented and verified. Priority: reliable native album/photo wall + viewer → source navigation → whole-cloud Gallery/Map → other non-Gallery modules.

## 5. Test and rollout contract

- Pure route-state contracts: stable five positions, dynamic replacement, feature-local back, no dynamic replacement by Files/Gallery/map/Viewer, recent order, empty/unauthorized fallback and Owner A→B→A.
- Photos: Full/Limited/Denied/Changed PhotoKit permissions; album list and album-specific bounded pages; stale read cancellation and scene transitions; thumbnails not uploading; native still/video/Live viewer return; 100k/115k bounded read and memory.
- Security: server instance/Owner/root verified on cloud photo pages and token rotation; no Web cookie/secret import; background consent, ledger/unknown ACK and server-switch safety.
- Build on *exact* PR HEAD: Xcode iPhoneOS unsigned IPA compile + scoped source/API tests + all repository-required CI/Final Gate. A green parent commit does not certify a child. Real iPhone/SideStore/iCloud/Live/lost-ACK trials may be recorded as **跳过（未验收）** but must never be reported as passed.
- Keep already running/green PR heads intact. Merge only when compatibility, GitHub branch protection and correct-HEAD checks permit. Design and documentation alone do not complete iOS native product parity.
