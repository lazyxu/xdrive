# iOS Native subpage performance coverage (2026-11-13)

## Scope, existing evidence, and merge boundary

Primary [#4307](https://github.com/lazyxu/xdrive/pull/4307) **merged into master**
on 2026-11-12 (merge SHA \`f2fe7ed\`): 25 root/native routes × 3
real XCUITest AX-ready trials, plus independent app CPU/memory suite.
The original 25-route AX-ready baseline passed 75/75 on \`a32cac1\`.
This follow-up is now directly targeted at master, not stacked onto an
unmerged development parent.

This additive PR registers **20 measured native interaction/entry paths** (the original 9,
6 added Backup/Gallery entries, and 5 further Files/Gallery/MapKit child paths),
without inventing Owner authentication or media fixtures. It retains separate
route IDs and test cases even where multiple navigation paths render the same
SwiftUI component. Repetition is deliberate: user-perceived entry costs and
resource lifetimes differ.

| Route ID | Actual native child/sheet | Ready evidence | Test data |
| --- | --- | --- | --- |
| files.home.recent-denied | Files Home → 最近使用 | native-ios-files-recent-error-page | Synthetic Owner, no Session |
| files.home.favorites-denied | Files Home → 收藏夹 | native-ios-files-favorites-error-page | Synthetic Owner, no Session |
| files.organizer | Files Home → 整理浏览首页 Sheet | Organizer navigation bar | Synthetic Owner, no Session |
| files.organizer.saved-searches | Organizer → 智能文件夹 | native-ios-files-saved-searches-page | Synthetic Owner, no Session |
| files.organizer.tags | Organizer → 标签管理 | native-ios-files-tag-management | Synthetic Owner, no Session |
| files.tags | Files Home → 管理标签 Sheet | native-ios-files-tag-management | Synthetic Owner, no Session |
| backup.tasks | 相册备份 → 逐项任务 Sheet | native-ios-photo-task-list-done | Genuine empty/unauthorized queue |
| backup.details | 相册备份 → 备份详情 | native-ios-backup-portrait-form | Genuine disabled/no-Session controls |
| backup.audit | 相册备份 → 逐项核验当前云端原件（详情定位） | native-ios-backup-portrait-form | No-Session Owner; no actual receipt mutation |
| gallery.backup.queue | 图库备份菜单 → 备份任务队列 | native-ios-photo-task-list-done | Real native menu-to-sheet navigation; no upload |
| gallery.backup.focused | 图库备份菜单 → 集中备份进度详情 | native-ios-backup-portrait-form | Navigation only; no consent/backup starts |
| gallery.backup.settings | 图库备份菜单 → 备份设置详情 | native-ios-backup-portrait-form | Navigation only; no settings write |
| gallery.backup.audit | 图库备份菜单 → 云端原件核验详情 | native-ios-backup-portrait-form | Navigation only; no receipt mutation |
| gallery.cache.sheet | 图库备份菜单 → 缩略图缓存 Sheet | native-ios-backup-cache-sheet-close | Real cache-management sheet; no deletion |
| files.home.edit-mode | 文件 → 浏览首页 → 编辑 → 完成模式 | Native Files edit toolbar changes to 完成 | No authenticated files; UI mode only |
| gallery.originals.help | 云端原件 → 说明弹窗 | 云端备份原件说明 alert | Genuine alert; no cloud media access |
| gallery.local.date-sheet | 本机照片 → 按日期定位 Sheet | 按日期定位 navigation bar | Real PhotoKit UI; not 100k populated library |
| gallery.map.from-filter | 统一图库 → 搜索与筛选 → 显示地图 | Native MapKit source selector | Real map shell; no Full Access/100k timing assertion |
| gallery.map.from-launcher | 全部功能 → 地图 | Native MapKit source selector | Real independent launcher path; no GPS dataset claim |
| launcher.recent-picker | 笔记 → 最近功能 Sheet | Recent picker navigation bar | Genuine native launcher/session-free |

All twenty routes use real product-owned SwiftUI views or native UI modes, but some are
**distinct entry paths into the same underlying screen**, not 15 unique
screens. The original nine-path Simulator run [#43249473366](https://github.com/lazyxu/xdrive/actions/runs/43249473366)
passed on `a39441a`; the newly expanded twenty-path matrix has no
valid execution evidence until its own exact-HEAD CI finishes. Nonexistent private
contents, disabled operations and missing network grants are **not** bypassed.

## Metrics and gates

For each route, use the existing iOS18.5/Xcode16.4 simulator and genuine
UITest tap → actual mounted destination measurement. XCTest preserves one
unmeasured warmup and **3 retained iterations** for each test method. Report
AX-ready wall milliseconds and separately app-targeted
\`XCTCPUMetric(application: app)\` CPU Time in seconds and
\`XCTMemoryMetric(application: app)\` Memory Peak Physical in KiB.
The raw .xcresult is exported as JSON and CSV.

The strict audit requires 20 registered methods, 4 observed UI invocations
per route, 3 unique AX trial IDs per route, 3 **genuine XCTest CPU Time** and
**Memory Peak Physical** numbers per route and nonempty original xcresult
metrics export. Missing, duplicates, or invalid numerical results cause an
actual CI failure, not a zero-filled or skipped pass. Nearest-rank n3 P95
is the sample maximum; these are diagnostics, not comparison to Web timings.

iOS 18.5 CPU/RSS and AX transition do **not** prove rendered first pixel,
true Hitch Time Ratio or physical 60/120 Hz frame pacing. User-visible
screens requiring an Owner will fail closed rather than load fabricated
Server files. This suite does not modify backup/session/Server code.

The 20-path contract requires **80 UI invocations, 60 retained AX trials,
60 genuine app CPU and 60 app peak-memory values**, all from the same
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
