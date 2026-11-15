# iOS Native subpage performance coverage (2026-11-14)

## Scope, existing evidence, and merge boundary

Primary [#4307](https://github.com/lazyxu/xdrive/pull/4307) **merged into master**
on 2026-11-12 (merge SHA \`f2fe7ed\`): 25 root/native routes × 3
real XCUITest AX-ready trials, plus independent app CPU/memory suite.
The original 25-route AX-ready baseline passed 75/75 on \`a32cac1\`.
This follow-up is now directly targeted at master, not stacked onto an
unmerged development parent.

This additive PR currently registers **49 native interaction/entry paths**
(the previous 39 plus six native Gallery source and Files quick-section paths),
without inventing Owner authentication or media fixtures. It retains separate
route IDs and test cases even where multiple navigation paths render the same
SwiftUI component. Repetition is deliberate: user-perceived entry costs and
resource lifetimes differ.

| Route ID | Actual native child/sheet | Ready evidence | Test data |
| --- | --- | --- | --- |
| files.home.root-denied | Files Home → 云端文件入口（无有效 Session） | native-ios-files-error-page | Real fail-closed screen, no Server data |
| files.home.trash-denied | Files Home → 回收站（无有效 Session） | native-ios-files-trash-error-page | Real fail-closed screen, no Server data |
| files.home.recent-denied | Files Home → 最近使用 | native-ios-files-recent-error-page | Synthetic Owner, no Session |
| files.home.favorites-denied | Files Home → 收藏夹 | native-ios-files-favorites-error-page | Synthetic Owner, no Session |
| files.home.saved-searches | Files Home → 智能文件夹 Sheet | native-ios-files-saved-searches-page | Native direct Home entry, Owner no Session; no mutations |
| files.home.operation-history | Files Home → 操作历史及撤销 Sheet | native-ios-files-operation-history-page | Native direct Home entry, Owner no Session; no replay/cancel |
| files.organizer | Files Home → 整理浏览首页 Sheet | Organizer navigation bar | Synthetic Owner, no Session |
| files.organizer.saved-searches | Organizer → 智能文件夹 | native-ios-files-saved-searches-page | Synthetic Owner, no Session |
| files.organizer.tags | Organizer → 标签管理 | native-ios-files-tag-management | Synthetic Owner, no Session |
| files.tags | Files Home → 管理标签 Sheet | native-ios-files-tag-management | Synthetic Owner, no Session |
| backup.tasks | 相册备份 → 逐项任务 Sheet | native-ios-photo-task-list-done | Genuine empty/unauthorized queue |
| backup.setup | 相册备份 → 真实设置向导 | native-ios-backup-setup | Explicit safe overview entry, no registration or uploads |
| backup.details | 相册备份 → 备份详情 | native-ios-backup-portrait-form | Genuine disabled/no-Session controls |
| backup.audit | 相册备份 → 逐项核验当前云端原件（详情定位） | native-ios-backup-portrait-form | No-Session Owner; no actual receipt mutation |
| gallery.backup.queue | 图库备份菜单 → 备份任务队列 | native-ios-photo-task-list-done | Real native menu-to-sheet navigation; no upload |
| gallery.backup.focused | 图库备份菜单 → 集中备份进度详情 | native-ios-backup-portrait-form | Navigation only; no consent/backup starts |
| gallery.backup.settings | 图库备份菜单 → 备份设置详情 | native-ios-backup-portrait-form | Navigation only; no settings write |
| gallery.backup.audit | 图库备份菜单 → 云端原件核验详情 | native-ios-backup-portrait-form | Navigation only; no receipt mutation |
| gallery.cache.sheet | 图库备份菜单 → 缩略图缓存 Sheet | native-ios-backup-cache-sheet-close | Real cache-management sheet; no deletion |
| files.home.more-organizer | 文件→更多→整理浏览首页 | Organizer navigation bar | Actual toolbar Menu, no authenticated files |
| files.home.edit-mode | 文件 → 浏览首页 → 编辑 → 完成模式 | Native Files edit toolbar changes to 完成 | No authenticated files; UI mode only |
| files.quick.recent | 文件 → 最近使用快捷页 → 浏览 | native-ios-files-section-recent selected | Real native quick rail; no authenticated content |
| files.quick.favorites | 文件 → 收藏夹快捷页 → 浏览 | native-ios-files-section-favorites selected | Real native quick rail; no authenticated content |
| files.search.date | 文件 → 修改时间筛选（最近7天）→ 恢复不限时间 | native-ios-files-search-date-filter label | Real native menu choice/reset; no authenticated search results |
| files.search.size | 文件 → 文件大小筛选（小于1MiB）→ 恢复不限大小 | native-ios-files-search-size-filter label | Real native menu choice/reset; no authenticated search results |
| gallery.sort-menu.filters | 统一图库→排序和筛选菜单→筛选编辑页 | native-ios-unified-gallery-map-scope | Genuine native Menu→Sheet, no Owner fixture |
| gallery.wall.month-group | 统一图库→照片时间分组→月→全部 | native-ios-shared-photo-time-scale selected state | Native presentation change, no real large-data scroll |
| gallery.wall.density | 统一图库 → 缩略图大小 → 紧凑 → 标准 | native-ios-unified-wall-density AX value | Real SwiftUI density binding; no full 100k wall redraw |
| gallery.wall.framing | 统一图库 → 显示比例 → 完整图片 → 方形裁切 | native-ios-unified-wall-density AX value | Real photo framing binding; no media decode |
| gallery.source.albums | 统一图库 → 相册 → 统一 | native-ios-album-create | Actual native album shell, not a populated photo benchmark |
| gallery.source.originals | 统一图库 → 云端原件 → 统一 | native-ios-cloud-original-layout-help | Owner without Server session, no media |
| gallery.source.cloud | 图库来源菜单 → 云端图库 → 统一 | native-ios-server-gallery-search | No authenticated cloud search latency |
| gallery.source.local | 图库来源菜单 → 本机照片 → 统一 | native-ios-local-timeline-open | Actual local PhotoKit page; no 100k assets |
| gallery.filters.sheet | 统一图库 → 搜索与筛选 Sheet | native-ios-unified-gallery-map-scope | Genuine filter sheet, no authorized search results |
| gallery.people.page | 统一图库 → 人物页 | native-ios-gallery-people-page | Genuine screen, not face-content benchmark |
| clipboard.target-scope | 剪贴板→接收范围选择 | native-ios-clipboard-target-picker | No-Session native menu |
| clipboard.history-scroll | 剪贴板编辑器→历史说明→恢复编辑器 | Actual ScrollView footer/editor | No populated real Owner history |
| mine.gallery-shortcut | 我的→相册与照片墙→我的 | native-ios-unified-photo-gallery | Genuine shortcut and return |
| mine.thumbnail-cache | 我的 → 缩略图缓存 | native-ios-gallery-thumbnail-cache | Genuine cache screen, no deletion |
| gallery.originals.help | 云端原件 → 说明弹窗 | 云端备份原件说明 alert | Genuine alert; no cloud media access |
| gallery.local.date-sheet | 本机照片 → 按日期定位 Sheet | 按日期定位 navigation bar | Real PhotoKit UI; not 100k populated library |
| gallery.map.from-filter | 统一图库 → 搜索与筛选 → 显示地图 | Native MapKit source selector | Real map shell; no Full Access/100k timing assertion |
| gallery.map.from-launcher | 全部功能 → 地图 | Native MapKit source selector | Real independent launcher path; no GPS dataset claim |
| launcher.recent-picker | 笔记 → 最近功能 Sheet | Recent picker navigation bar | Genuine native launcher/session-free |
| mine.signout.confirm | 我的 → 退出当前账户确认层 → 安全取消 | 停止本机自动备份并退出 | Synthetic Owner, no Session; never confirms destructive sign-out |
| notes.source.ios-backup | 笔记 → iOS 备份来源 | native-ios-notes-source-picker | Native segmented source transition; no Server notes |
| notes.source.mine | iOS 备份 → 我的备忘录 | native-ios-notes-source-picker | Native reverse transition; no Server notes |
| transfers.open-files | 传输 → 打开文件 | native-ios-files-section-browse | Native 5-slot navigation |
| transfers.open-backup | 传输 → 相册备份 | native-ios-backup-overview | Native route; no upload |

All forty-nine routes use real product-owned SwiftUI views or native UI modes, but some are
**distinct entry paths into the same underlying screen**, not 15 unique
screens. The original nine-path Simulator run [#43249473366](https://github.com/lazyxu/xdrive/actions/runs/43249473366)
passed on `a39441a`. An actual 20-route Simulator run
[#43367128606](https://github.com/lazyxu/xdrive/actions/runs/43367128606)
executed all **20 tests but failed 5 Gallery backup paths** because the
Menu had no valid AX hit point despite a 44pt height. The retained set is
incomplete and **not** a 20-route performance pass. The single Gallery
backup Menu is now moved to the NavigationStack toolbar. This 22-path extension
includes two extra unverified routes; the next exact-HEAD run must genuinely prove
all 22 and its hit-testability, not
infer success from source checks. A different MapKit job in
[#43367128814](https://github.com/lazyxu/xdrive/actions/runs/43367128814)
failed to index real PhotoKit GPS fixture photos; no part of that
failure is silently skipped or counted as a performance pass. Nonexistent private
contents, disabled operations and missing network grants are **not** bypassed.

### Actual 22-test failure and repair (2026-11-13)

The genuine iOS 18.5/Xcode Simulator [run #43410173204](https://github.com/lazyxu/xdrive/actions/runs/43410173204) executed **22 methods: 20 passed, 2 failed**, so the previous SHA is **red**, not a completed 66-sample result. `backup.setup` could not reach a conditional setup button when Owner destination verification was unavailable; `mine.signout.confirm` could open its dialog but lacked a native explicit Cancel. The repair preserves 22 routes and adds a safe Setup view link in the existing overview plus an explicit cancellation action. Separately, full CI/IPA failed a stale compact Gallery Node source assertion still demanding backup actions inside the content row even after the real hit-tested toolbar repair. That assertion now verifies the actual toolbar and non-remounting short-row layout. No skips, Owner bypass, simulated data or automatic sign-out are introduced. **Fresh exact-HEAD 22-route metrics and full CI/IPA are still required.**

### Confirmed 22-path Simulator success and two more Files Home entries (2026-11-14)

At the prior exact HEAD `03e08f4`, the native 22-path performance run
[#43465802892](https://github.com/lazyxu/xdrive/actions/runs/43465802892)
finished **SUCCESS** (real iOS Simulator route transitions and app CPU/RSS).
However the same SHA's full CI [#43465802996](https://github.com/lazyxu/xdrive/actions/runs/43465802996)
and unsigned IPA [#43465802798](https://github.com/lazyxu/xdrive/actions/runs/43465802798)
failed because the Desktop source contract still required the removed
`native-ios-gallery-backup-settings-compact` ID. This was repaired on this
performance branch to require the current unique actual toolbar
`native-ios-gallery-backup-settings` ID, while retaining the hit-area checks.
The candidate-mapkit navigation shard [#43465802787](https://github.com/lazyxu/xdrive/actions/runs/43465802787)
also failed on an absent real AX `native-ios-local-map-basemap` control; it
remains an **unresolved independent navigation failure**, not a performance pass.

Two further genuine tap paths now measure **Files Home → Saved Searches** and
**Files Home → Operation History** separately from Organizer/other route entries.
Both require their actual page IDs and a real Done dismissal; no fake owner
session, Server data, queued operation action, or cancellation is injected.
The **24-path exact-new-HEAD run is pending**. Preserve historical 22/22
success only for `03e08f4`, not for the amended 24-path source.

## Metrics and gates

For each route, use the existing iOS18.5/Xcode16.4 simulator and genuine
UITest tap → actual mounted destination measurement. XCTest preserves one
unmeasured warmup and **3 retained iterations** for each test method. Report
AX-ready wall milliseconds and separately app-targeted
\`XCTCPUMetric(application: app)\` CPU Time in seconds and
\`XCTMemoryMetric(application: app)\` Memory Peak Physical in KiB.
The raw .xcresult is exported as JSON and CSV.

The strict audit requires 33 registered methods, 4 observed UI invocations
per route, 3 unique AX trial IDs per route, 3 **genuine XCTest CPU Time** and
**Memory Peak Physical** numbers per route and nonempty original xcresult
metrics export. Missing, duplicates, or invalid numerical results cause an
actual CI failure, not a zero-filled or skipped pass. Nearest-rank n3 P95
is the sample maximum; these are diagnostics, not comparison to Web timings.

iOS 18.5 CPU/RSS and AX transition do **not** prove rendered first pixel,
true Hitch Time Ratio or physical 60/120 Hz frame pacing. User-visible
screens requiring an Owner will fail closed rather than load fabricated
Server files. This suite does not modify backup/session/Server code.

The 33-path contract requires **132 UI invocations, 99 retained AX trials,
99 genuine app CPU and 99 app peak-memory values**, all from the same
exact-head Xcode Simulator run. Existing 25 root/selected-child routes are
measured separately; these matrices are not 45 unique pages. Alert, map
source selector and edit mode readiness are explicitly not pixel/FPS timing.

## Web baseline families → iOS equivalent, still required

The following original Web/Chromium workloads define *what* native must
measure, not numerical baselines that can be copied:

| Existing Web family / example workflow | Native iOS outstanding measurement |
| --- | --- |
| \`.github/workflows/pwa-p0c2-navigation-current.yml\` | Route+child ready time, composed first pixel, foreground return |
| \`.github/workflows/file-explorer-mobile-mixed-p049.yml\` | Authenticated Files 10k/100k/115k, first+next cursor, Grid/List, scroll/window, reanchor |
| \`.github/workflows/gallery-web-physical-mobile-100k-viewports.yml\` | Actual PhotoKit and verified cloud 10k/100k, JPEG/H264/Live thumbnail, long scroll and cache bounds |
| \`.github/workflows/pwa-p1-owner-100k-viewer-back.yml\` | Native verified Viewer + filmstrip next/previous/return context and first visible image |
| \`.github/workflows/pwa-p1-h264-presented-motion.yml\` | Actual authorized video/Live presented first frame; video decode/buffering |
| \`.github/workflows/pwa-p1-viewer-video-range-abort.yml\` | URLSession cancel after Viewer/tab/Owner/navigation and Go Context.Done; stale byte/time |
| \`.github/workflows/pwa-p4f-chromium-100k-abba.yml\` | Native same-runner/same-populated-dataset paired before/after CPU, RSS, frame pace |
| \`.github/workflows/real-web-desktop-cas-4gib-performance.yml\` | Real original 1/4GiB upload+download, SHA, resume, memory and cancellation |
| Existing Places/Map 95k/100k server workflows | Real PhotoKit MapKit GPS 1/10/1000/10000/100000, place wall, camera+Viewer |
| Web navigation/search performance | Native Files authorized folder, full search, tags, trash, versions; Notes editor, Clipboard media, Transfers detail |

**Not measured here:** actual real Owner A/B, 401/403/revoke, populated
Node/photo collections, iCloud originals, real PDF/audio/video Viewer,
system permission changes, foreground/background rescue or physical
signed iPhone. These require genuine authorization, actual media/fixtures
and separate dedicated functional/performance validation. Keep them
explicitly incomplete, rather than reporting “all iOS pages measured.”

The four launcher entries that explicitly display **未接入**
(Sync, Storage, Devices, Diagnostics) are product placeholders, not
implemented pages or valid performance equivalents.

## Completion rules

- #4307 is already merged. This one performance follow-up PR targets master,
  and it must not absorb independent security/functional PRs simply to
  reduce CI count.
- Execute all exact-HEAD Xcode UI tests, resource metrics export and
  the full CI/Final Gate; any new failure must be fixed without
  weakening missing-route or negative Owner checks.
- Check latest master semantic compatibility, wait for exact-HEAD native
  performance and full CI/Final Gate, and only then merge this PR.
- Real signed hardware / genuine Owner population: **跳过（未验收）**.

### 2026-11-14 — 28-route candidate and raw screenshot provenance

Four genuine Notes/Transfers entry transitions extend the earlier 24-route baseline. The test now retains one post-AX screenshot attachment per route in the original uploaded xcresult; the independent audit fails closed if its log marker is missing or duplicated. Capture takes place **after** the measured CPU/AX interval, never counts as a first composed frame. New HEAD Simulator/CI/IPA evidence is required; signed Owner, true FPS/hitches, 100k assets and real transfer throughput remain unverified.


### 2026-11-14 — native reverse-path performance gate

All 28 actual child interactions now retain three additional measured
dismiss/back/restore timings, independent of the forward AX-ready and
app-targeted CPU/physical-memory intervals. The test emits
IOS_NATIVE_SUBPAGE_RETURN_MS only after real native cleanup has
completed; the audit rejects missing/duplicated return trials and
reports return P50/P95 (n=3 nearest-rank P95). For the Notes mine
source switch, cleanup executes a real reverse switch to iOS backup
rather than a no-op. A successful exact-HEAD Simulator run must provide
84 forward + 84 reverse AX timings, along with 84 app CPU and
84 peak-memory values and 28 post-AX screenshots.
The reverse metric remains AX-ready wall time including XCTest idling,
not a composited frame, 60/120-Hz FPS measurement, signed Owner
or populated Web benchmark parity. No such run is claimed green
until original xcresult/log artifacts on this SHA pass.

### 2026-11-14 — 33-route additive candidate (new SHA requires new CI)

Five genuine existing subpages extend the earlier 28-route suite: Files
cloud-root and Trash fail-closed screens, Gallery filters and People, and Mine
thumbnail cache. Every route must produce real forward and reverse AX-ready
intervals, app-targeted CPU and peak physical memory, plus one post-AX
screenshot in the original xcresult. **33 XCTest methods × (warmup + n3)**
means 132 invocations, 99 retained values for each metric, and 33 screenshots.
This code registration is not evidence of a passed 33-route Simulator or CI.
Authenticated 10k/100k, first composed media frame, MapKit #4344's #4305
dependency, 60/120Hz and 1/4 GiB native transfers remain unverified.


### 2026-11-15 — additive 39-route native child coverage (candidate, not verified)

Added three previously unmeasured genuine interaction paths in existing #4328:
Files Home toolbar More → Organizer; unified Gallery sorting Menu → filter editor;
and unified Gallery time grouping All → Month → All. Each path uses the
original native views, tap-to-AX timing, app-targeted CPU and peak physical
memory, separate return timing and original post-AX and post-return screenshots.
Source-only registration is not test success: current exact-HEAD Simulator must
prove **39 routes × (warmup + n=3) = 156 invocations**, **117 retained stage,
forward, return, CPU and memory samples each**, and **39 pairs of screenshots**.
These no-Session presentation flows do not establish authenticated Files, actual
thumbnails, frame pacing, media decoding, 10k/100k or native 1/4GiB transfers.
Keep Draft until all required latest-head gates pass.

## Per-route metrics export (2026-11-15)

The native #4328 Simulator workflow now emits `subpage-summary.csv` alongside
`subpage-summary.json` and the original `.xcresult`. The CSV contains
the exact HEAD SHA, each of the 45 measured route IDs, n=3 retained samples,
parent preparation P50/P95, child AX-ready P50/P95, reverse AX-ready
P50/P95, app CPU Time P50 and app physical-memory P95. It is created **only
after the strict original XCTest log and `.xcresult` audit succeeds**;
missing/invalid per-route samples stop export and fail CI.

Every row explicitly labels `first_composited_frame`, `physical_fps`
and `authorized_owner_data` as `not_measured`, and
`web_native_parity` as `not_verified`. This is a reviewable native
per-page report, **not** evidence that the 68 selected Web performance
workflows are completed on iOS. Only results from the new exact HEAD
Actions run can be treated as actual measurements; no invented speedup,
signed iPhone, 100k PhotoKit or server-backed Owner results.
