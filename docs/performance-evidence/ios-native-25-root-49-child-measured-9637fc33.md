# iOS 原生逐页面性能实测：25 主路径 + 49 子路径

**原始可信来源**：[GitHub Actions run #43897451730](https://github.com/lazyxu/xdrive/actions/runs/43897451730)，精确原始代码 SHA `9637fc33c1974eda4a0fca1690fd59bd02b69f19`，iOS 18.5 / Xcode 16.4 Simulator。该历史运行 **74/74 XCTest 成功**，不是当前 HEAD 的重新验收。

25 主路径各执行 1 次热身 + n=3；其中冷启动独立计时，其余 24 个资源路径有 app CPU 和 whole-app 进程峰值内存。49 子路径各 1 次热身 + n=3，均有进入/返回 AX-ready 墙钟耗时、独立 app CPU 和峰值内存，且原始 `.xcresult` 保存每路进入/返回截图。P50 是三次样本中位数，P95 是三次中的最大值（nearest-rank）。

**限制**：XCTest AX 时间包含测试查询和动画 idle 等待，不是首个合成可见帧；CPU Time 不是墙钟延迟；内存是整进程峰值不是逐页面增量。所有真实用户 Owner、10k/100k 资产、原始媒体首帧、真机 60/120Hz FPS、1/4 GiB 传输均未由本实验验证。

## 主页面（25 路）

| 原生路径 | App CPU P50 (s) | 峰值内存 P95 (MiB) | 冷启动 P50/P95 (s) |
|---|---:|---:|---:|
| `app.gallery` | — | — | 3.386/4.681 |
| `files.browse` | 1.099 | 81.8 | — |
| `files.cloud-denied` | 1.317 | 84.3 | — |
| `files.favorites` | 0.953 | 81.3 | — |
| `files.operation-history` | 2.037 | 92.1 | — |
| `files.recent` | 0.989 | 81.3 | — |
| `files.saved-searches` | 1.830 | 91.1 | — |
| `files.search-input` | 2.177 | 99.3 | — |
| `files.trash-denied` | 1.451 | 86.7 | — |
| `gallery.albums` | 0.597 | 58.1 | — |
| `gallery.cloud` | 0.879 | 63.6 | — |
| `gallery.filters` | 1.228 | 66.5 | — |
| `gallery.local` | 0.635 | 60.1 | — |
| `gallery.originals` | 0.409 | 59.8 | — |
| `gallery.people` | 0.566 | 59.4 | — |
| `gallery.unified` | 0.627 | 59.0 | — |
| `mine.thumbnail-cache` | 0.731 | 64.3 | — |
| `tab.files` | 0.864 | 83.8 | — |
| `tab.gallery` | 0.748 | 84.5 | — |
| `tab.launcher` | 0.561 | 61.1 | — |
| `tab.mine` | 0.645 | 59.4 | — |
| `tool.backup` | 0.670 | 66.9 | — |
| `tool.clipboard` | 0.562 | 66.8 | — |
| `tool.notes` | 0.861 | 65.4 | — |
| `tool.transfers` | 0.528 | 65.6 | — |

## 子页面及交互（49 路）

| 原生路径 | 进入 AX P50/P95 (ms) | 返回 AX P50/P95 (ms) | App CPU P50 (s) | 峰值内存 P95 (MiB) |
|---|---:|---:|---:|---:|
| `backup.audit` | 2179/2435 | 2905/3096 | 0.690 | 77.7 |
| `backup.details` | 1841/2098 | 3014/3313 | 0.429 | 74.0 |
| `backup.setup` | 3443/3895 | 2712/2909 | 0.628 | 70.8 |
| `backup.tasks` | 3659/3723 | 3802/3874 | 1.079 | 77.4 |
| `clipboard.history-scroll` | 2896/2960 | 939/1404 | 0.289 | 68.0 |
| `clipboard.target-scope` | 4407/5056 | 6398/6747 | 0.796 | 68.9 |
| `files.home.edit-mode` | 3429/3931 | 2173/2251 | 0.589 | 83.9 |
| `files.home.favorites-denied` | 4408/4519 | 3603/3813 | 0.923 | 87.4 |
| `files.home.more-organizer` | 4318/5213 | 6750/12594 | 1.545 | 94.3 |
| `files.home.operation-history` | 5102/5121 | 5958/7002 | 1.642 | 91.0 |
| `files.home.recent-denied` | 4750/5604 | 3707/3708 | 1.278 | 85.4 |
| `files.home.root-denied` | 4585/4617 | 4057/4058 | 1.125 | 84.9 |
| `files.home.saved-searches` | 5413/7656 | 4755/6822 | 1.532 | 93.4 |
| `files.home.trash-denied` | 3719/4360 | 3858/4126 | 1.243 | 86.7 |
| `files.organizer` | 5818/6135 | 5589/5831 | 1.639 | 94.2 |
| `files.organizer.saved-searches` | 2317/2432 | 8160/8325 | 0.420 | 96.8 |
| `files.organizer.tags` | 2624/2637 | 8507/9536 | 0.873 | 97.9 |
| `files.quick.favorites` | 3416/3431 | 2005/2893 | 0.797 | 84.8 |
| `files.quick.recent` | 3285/3316 | 2147/2409 | 0.664 | 83.2 |
| `files.search.date` | 10190/70665 | 9986/11368 | 1.914 | 87.7 |
| `files.search.size` | 7943/10353 | 12007/12159 | 1.906 | 87.9 |
| `files.tags` | 4378/4599 | 3719/3773 | 1.720 | 96.3 |
| `gallery.backup.audit` | 2722/3435 | 6462/6948 | 1.180 | 73.7 |
| `gallery.backup.focused` | 2460/4085 | 6199/6618 | 1.206 | 76.1 |
| `gallery.backup.queue` | 2410/2824 | 5459/6339 | 1.265 | 75.0 |
| `gallery.backup.settings` | 2539/2587 | 6546/6764 | 1.095 | 75.5 |
| `gallery.cache.sheet` | 2118/2421 | 3592/3613 | 0.685 | 62.5 |
| `gallery.filters.sheet` | 5276/12073 | 4223/6148 | 1.203 | 67.1 |
| `gallery.local.date-sheet` | 3649/3868 | 3700/5031 | 0.658 | 62.6 |
| `gallery.map.from-filter` | 5199/5952 | 3410/3626 | 1.464 | 70.1 |
| `gallery.map.from-launcher` | 3307/5114 | 3223/4093 | 0.822 | 69.4 |
| `gallery.originals.help` | 3590/3862 | 3343/3475 | 0.387 | 59.1 |
| `gallery.people.page` | 3764/4588 | 3261/3383 | 0.751 | 59.7 |
| `gallery.sort-menu.filters` | 4602/5723 | 3836/4456 | 1.102 | 67.3 |
| `gallery.source.albums` | 3270/4085 | 3194/3335 | 0.402 | 58.1 |
| `gallery.source.cloud` | 1736/1822 | 3067/3174 | 0.395 | 62.9 |
| `gallery.source.local` | 1785/2097 | 3325/3370 | 0.286 | 59.9 |
| `gallery.source.originals` | 3143/3328 | 3114/3579 | 0.500 | 59.1 |
| `gallery.wall.density` | 5377/6121 | 5114/5132 | 1.001 | 59.6 |
| `gallery.wall.framing` | 5726/65367 | 6220/7881 | 0.914 | 60.5 |
| `gallery.wall.month-group` | 2118/2421 | 1874/1978 | 0.320 | 56.2 |
| `launcher.recent-picker` | 2137/2260 | 3620/3692 | 0.342 | 68.9 |
| `mine.gallery-shortcut` | 2952/4898 | 4122/5874 | 0.756 | 63.4 |
| `mine.signout.confirm` | 4216/4467 | 3797/4364 | 0.855 | 66.1 |
| `mine.thumbnail-cache` | 4743/4769 | 3349/3637 | 0.597 | 63.8 |
| `notes.source.ios-backup` | 2676/2844 | 2451/2581 | 0.361 | 66.2 |
| `notes.source.mine` | 2506/2529 | 2257/2367 | 0.352 | 66.9 |
| `transfers.open-backup` | 2185/2205 | 3581/3594 | 0.533 | 69.3 |
| `transfers.open-files` | 2065/3272 | 3238/3317 | 0.573 | 92.5 |

## 原样保留的异常样本

- `files.search.date` 进入 AX 样本：70665, 10190, 7149 ms。最高值对应原始 runner 的约 **60 秒 `App animations complete notification not received` XCTest idle wait**；不能说页面首帧用了 70 秒。
- `gallery.wall.framing` 进入 AX 样本：65367, 5073, 5726 ms。同样出现 60 秒 XCTest idle wait；不能说图片首像素耗时 65 秒。
- `files.search.size` 的 AX 进入/返回耗时相对较高，需后续分离页面挂载、实际可见帧与 XCTest 查询开销。

## Web/PWA 对等验收

`ios/performance/native-web-workflow-parity.json` 的 68 个 Web 性能工作流已登记映射，但 **68/68 仍为 `not_verified`**：工作流登记和此处的 no-session Simulator 测量均不等价于真实 Owner/PhotoKit/100k/首次合成帧/FPS/1-4 GiB 传输等效验收，不能复制 Web 的测量数字当 iOS 数据。

**合入边界**：原始 25+49 测量已真实通过，但其它导航与 MapKit shard 曾失败。#4328 仍需最新准确 HEAD 的完整 CI/Final Gate、导航、IPA、b9、实测性能通过后才可以考虑合入。
