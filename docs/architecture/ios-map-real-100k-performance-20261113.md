# iOS 相册地图：真实 100,000 张 PhotoKit 性能验收（2026-11-13）

## 目标与严格数据来源

此门禁测试 **真实 iOS 18.5 Simulator PhotoKit**，不是 100,000 条 Swift 内存对象：

1. 新建隔离 iPhone 16 Simulator，擦除图库，取得基线 PHAsset.location 数量。
2. 用现有 `generate-mapkit-p0-gps-fixtures.py` 生成 **100,000 个实际 EXIF-GPS JPEG 文件**，分组经 `simctl addmedia` 真正导入 iOS Photos。
3. 先对 100k 库做第一次 xDrive 原生地图扫描、随后一轮 XCTest 预热扫描及四次保留的全库重复扫描，再测试地点墙滚动、MapKit 放大/拖拽/返回和两视窗缓存重用。
4. 在 App 内记录每次真实 PhotoKit 扫描的单调时钟毫秒数、64 项分页数、遍历元数据量、GPS 有效数、进程 CPU 时间、内存常驻量采样峰值。MapKit 手势、照片墙的**实际拖动时段**和扫描期间用 `CADisplayLink` 采样主线程显示回调周期、P50/P95 和较长回调间隔；滚动回调测量不把地点墙静止等待时间计入，但当前仍不测惯性减速到完全停止的整段呈现帧率。
5. UI Test 直接测量实际运行的 App：`XCTCPUMetric(application:)`、`XCTMemoryMetric(application:)`，滚动/缩放在 **Xcode 26 / Swift 6.2 或更新**的构建上额外启用 `XCTHitchMetric(application:)`；当前仓库的 **Xcode 16.4** 不提供此 API，不能声称已测得 Hitch。这比只打印主进程自报值更能核对 App 的物理内存峰值和动画 hitch。
6. 最后再次独立扫描 PhotoKit GPS 数量，对比导入前后必须**精确增加 100,000**，且与地图扫描 GPS 数量完全一致。
7. `audit_real_100k_map_perf.py` 独立检验 APP JSON、XCTest 原始日志、导入前/后真实 PHAsset 计数。缺任一证据视为失败，生成 JSON 和 CSV 报告。

## 如何运行

GitHub Actions → [iOS MapKit P0 real PhotoKit GPS scale audit](https://github.com/lazyxu/xdrive/actions/workflows/ios-mapkit-p0-real-gps-scale.yml) → Run workflow：

- Branch：选包含本代码的 PR 分支或合入后的 master。
- **Count = `100000`**；建议 `pattern = mixed`（含多个位置簇和多种地理分布）；也可以多次选择 `same`、`dateline`、`distinct` 分别复测。
- 完成后下载 `ios-map-p0-real-gps-*` artifact，包括 `baseline.log`、`seeded.log`、`performance.log`、`real-app-performance.json`、`100k-summary.json`、`100k-summary.csv`。
- 普通 PR 的默认真实规模仍为 65 张，避免每个源码提交都反复导入十万文件。这种默认 CI **不是** 100k 实测通过。只有选择十万并完整通过时才能称为真实规模验收。

例如：`gh workflow run ios-mapkit-p0-real-gps-scale.yml --ref <branch> -f count=100000 -f pattern=mixed`（须由有仓库 Actions 权限的调用者执行）。

## 报告指标与验证定义

| 类别 | 指标 | 证据源 |
|---|---|---|
| 首次地图扫描 | `first_scan_ms`、`total_assets`、`metadata_items/pages`、GPS 数量 | 第一次真实 app `PHAsset` 64 项分页 |
| 全库重复扫描 | 首次后的预热与四次正式重复扫描的 P50、P95，进程 CPU P50/P95 | 同一 Simulator 的真实 PhotoKit / `getrusage` |
| 实际视窗缓存重用 | 命中次数、耗时 P50/P95、必须 `metadata_pages=0` | 现有原生 MapKit 已验证缓存分支 |
| 地点墙滚动 | 帧回调间隔 P50/P95、观测回调 FPS、超长间隔和 CPU/Memory Peak | SwiftUI 48 项分页照片墙 + CADisplayLink + XCTest |
| MapKit 缩放/平移 | 帧回调间隔 P50/P95、观测回调 FPS、超长间隔和 CPU/Memory Peak | 真实 MKMapView 手势 + CADisplayLink + XCTest |
| 内存 | `sampled_app_resident_peak_bytes` 和 `xctest_app_peak_physical_mib` | iOS `task_info` 采样及目标 App 的 `XCTMemoryMetric` |
| 内容精确性 | `proven_real_photokit_delta=100000` | 导入前后独立 PHAsset.location 全库枚举 |

**注意准确口径**：`CADisplayLink` 的观测 FPS 是 App 主运行循环的显示回调频率，**不能冒充 GPU 实际提交/显示帧率**；XCTest hitch 是独立的系统动画停顿测量，不能换算成显示器帧数。实机 60/120Hz 的最终呈现 FPS 还需要连接真实 iPhone 的 Instruments/Core Animation 进行验收；模拟器报告不能声明已经达到实体设备 120fps。

**隐私**：性能探针仅 Debug 且需 `-xdrive-map-100k-perf`。报告只包含总数、时间与聚合资源数值，不写本机 PhotoKit ID、文件名、GPS 坐标、Owner 或缩略图。原件、签名及授权逻辑未放宽，权限不为 Full Access 时仍拒绝地图扫描。缓存保持最多两个验证完成的窗口，绝不缓存完整 100k 照片原件或所有 ID。

## 自动失败门槛

- 100,000 张 EXIF-GPS 导入的实际独立 GPS 增量不准确，或 app 扫描不足 100k → **FAIL**。
- 至少五次全库扫描未完成，64 条分页数对不上 → **FAIL**。
- 没有真实缓存命中、缓存命中却发生 PhotoKit 枚举 → **FAIL**。
- 缺少 scan、MapKit 手势、place wall 的 CADisplayLink 帧样本 → **FAIL**。
- 缺少真实 XCTest app CPU / Physical Peak Memory，或样本不是扫描 4 次、滚动 3 次、缩放 3 次 → **FAIL**。
- P50/P95 不合法、非有限值、帧回调间隔缺失、FPS 异常 → **FAIL**。

**当前完成范围**：探针、真实 UI Test、严格审计器及 CI 流程源码已提交在 #4305。只有完整 100k GitHub Actions run 完成后，才填写实际毫秒、FPS、CPU、MiB 数据；不存在“源码编好即测得 100k”这种状态。
