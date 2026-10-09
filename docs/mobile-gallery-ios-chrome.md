# Mobile Gallery — iOS-inspired internal chrome (P0-A)

## Shell boundary
- Keep **XDriveMobileAppHeader** unchanged: 52px, global app Back, current app title, transfer, and exactly one app switcher. No duplicate global switch in Gallery.
- **XDriveMobileGalleryChrome** belongs inside Gallery and only handles collection navigation, selection, sorting, filters, and view preferences.
- The Gallery's internal Back returns to album/place/person/memory parent. The app Back exits Gallery; the Viewer Back returns to its previous media and virtual collection anchor. These contracts remain separate.
- Tap and 450ms hold behavior remain in the existing shared Gallery/Viewer implementations.

## Mobile layout
- Gallery inner sticky action row: selection, sort menu (4 choices), filter drawer and More; a contextual collection Back only where the Gallery actually has a parent.
- Bottom fixed navigation (safe-area aware): category Drawer / Year Month Day All / Search Drawer. Categories reuse the canonical `XDriveMediaGalleryNavigation` data. The default photo wall has no permanent search input, duplicate title, 9-tab strip or density slider.
- Search and filters share the **existing Gallery draft and Server query**, rendered in the mobile filter sheet. There is no new search backend. The desktop FilterToolbar remains unchanged.
- More retains Date/Time Zone, Year/Month jump, Day jump, return anchor, crop/contain, density, duplicate folding, refresh, and existing album/person management actions.
- Selection mode hides the normal bottom tabs and docks the existing shared selection toolbar near the bottom; cancel/exit, review and batch actions remain reachable.
- Compacts at 899.95px; desktop wider view retains full shared Gallery toolbar and full sorting/filtering UI.

## Verification
- React contract tests cover top/bottom controls, categories, selection handoff, independent Back, and no duplicate app navigation.
- CI is required; real iOS Safari/Android Chrome portrait/landscape, safe area, keyboard and scroll-return QA must be recorded separately from emulation.
- No change to initial API paging/sort default belongs in this P0-A PR. P0-B introduces opt-in server-side tail positioning and a separate sort preference without traversing 100k client rows.

## P0-B — latest photos at the bottom (opt-in Mobile Web sort)

- **Independent sort preference:** Mobile Web uses `xdrive.gallery.mobile.sort.v1`, default `captured + asc`. Wide Web/Desktop continue `xdrive.gallery.sort.v1` and their original sort/default. A resize switches preference profiles without altering either stored value.
- **Sparse tail:** Only a first ranged request adds `initial_position=latest`. Server counts its owner/album/filter/fold scope, computes date groups, reverse-queries no more than the tail's page-aligned remainder (≤ page limit), reverses that small result, and returns `offset`, `total_count`, `anchor_index = total-1` and groups. No client loop from 0 to 100k. Subsequent `VirtualCollection`/Viewer requests do **not** carry `initial_position`.
- **Unknown captured date:** Mobile `captured + asc` opts into `unknown_first=true`. Unknown group appears before all valid capture dates in both SQL sort and timeline group indices. Wide/desktop behavior is unchanged. Added-date groups ignore unrelated missing capture EXIF.
- **Navigation:** Viewer return remembers the active Node for the same account/scope and uses the existing SQL `anchor_node_id` rank to restore its logical index. Sort changes keep the existing anchor behavior. New photos appended to the tail never implicitly reset a user viewing older dates.
- **Acceptance:** Go validation + Postgres mixed-date paging tests, shared timeline nearest-date/transport contract tests, and an optional step in the parity-preserving `go-linux-api` CI job using a real PostgreSQL 100k/115k logical/physical Gallery fixture. The 100k job logs baseline and tail first-range timings separately. Real iOS/Android device layout, keyboard, back navigation and safe-area QA remain separate and must not be reported as completed from emulation.

- **Old-photo position across Mobile app re-entry/refresh:** the Gallery records only the current visible Node ID, collection/section, and normalized query signature (no media data) for the active preference scope. The next matching entry supplies `anchor_node_id` and uses the existing SQL anchor rank instead of jumping to the new tail. A different filter, album, account or sort does not reuse that anchor. PostgreSQL tests append a later photo and verify the previously visible historical anchor remains stable.

## P0-C — iOS 27 Library / Collections / Search primary navigation (2026-10-10)

**Status: code candidate on a dependent short-lived GitHub branch; authoritative CI/native iOS acceptance pending.** The Gallery-local bottom chrome now uses two explicit primary tabs (图库/精选集) plus a separate Search action; year/month/all move inside the Library section and Day remains in More. The former category Drawer is retired as a final navigation pattern, and Collections becomes a bounded grouped page of actual albums, memories, people/pets, places, synchronized folders and utilities. All cards dispatch existing Gallery callbacks; covers use existing cancellable thumbnail loaders **only while their card is near the viewport**, so offscreen Collections strips do not start unnecessary Blob loads; no mobile-only API or data model is introduced.

Keep the single App Frame's 52px App header, transfer/app switch, 100k sparse virtualization, section/Viewer context, 450ms hold and Desktop Gallery unchanged. PR #1200 remains the dependency for correct latest-at-bottom initialization; do not duplicate its initial-position query or claim it is merged before the exact-head CI gate. Native iOS 27 photo-grid density, glass geometry, Collections layout customization, gesture/video/Live compatibility and device screenshot parity remain later stages. Canonical approved UI acceptance criteria: [iOS 27 Mobile Gallery](mobile-gallery-ios27.md) (PR #1205 until merged).

**Tests:** `desktop/tests/mobile-gallery-ios-chrome.cjs` (updated primary tab/date/control behavior) and `desktop/tests/mobile-gallery-ios27-primary.cjs` (real-data bounded Collections, callback ownership, architectural constraints). No physical iOS device check or wall-clock speedup is asserted by this code-only update.

### P0-1 共享后端与功能等价补充（2026-10-10）

Web 宽屏与 Mobile Web 继续只挂载同一 `XDriveMediaGalleryPage`、同一 Web REST adapter 和同一 VirtualCollection / VirtualGrid / VirtualTimeline；Mobile 的 iOS 27 Chrome、Collections 只呈现不同导航，不新增 API/Controller/Viewer。移动搜索从具体相册/人物/收藏入口发起时，保持既有集合的服务器查询范围，只有点击「精选集首页」上的独立搜索才切换全库。仅进入精选集时通过**现有** `listMemories`（最多 8 条）及 `listSyncFolders` 加载卡片元数据；不扫描 100k 媒体。新增同源、同操作、跨断点的静态回归合同，并保留业务流与真实 iOS 27 Safari 验收为待完成。正式规范见 `docs/mobile-gallery-ios27.md`；不是本阶段宣称像素级或跨端完整验收已通过。

### P0-1 分组「查看全部」入口（2026-10-10）

当真实回忆/相册/人物预览超过 8 张卡片时，手机精选集仍须能打开 Web 共用的完整集合索引。现为「回忆 / 相册 / 人物与宠物 / 地点 / 同步文件夹」分组显式提供`查看全部`，调用现有 onSectionChange 路由；不能把截断的 8 条误当成全部资产，也不能新建移动专用列表接口。新增 React 回归验证 12 条预览被有界裁剪后仍可进入完整集合；本地/CI/真机结果按实际执行状态分别记录。
