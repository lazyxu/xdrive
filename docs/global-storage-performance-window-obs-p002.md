# OBS-P002 — 全局存储最近 5 分钟固定窗口读写性能（2026-10-17）

## 当前进度与设计边界

**工作状态：候选实现，尚未源准确 CI/真实 GUI 六平台验收。** 必须先读 [OBS-P001 已合入基线与原始证据](global-storage-performance-observability.md)、[全局性能登记簿](performance-test-registry.md)、[六平台矩阵](performance-platform-coverage.md) 和 [Blob/CAS 审计](blob-cas-dedup-architecture-audit.md)。不能重跑已接受的 P038/P044/P045/P047/P052 等真实 100k/4GiB 测压，也不能因为指标工作改 Race 或用户主动创建的持久上传/删除/同步任务。

### CURRENT（上一生产版 OBS-P001）

- HTTP 热路径 `serverObservability.observeRequest` 已有 **route-template/method/status → count、wall seconds** 的有界聚合；真实准确 GitHub CI #39010151064 原方法 **n3 P50 51.06ns/op、0 B/op、0 allocs/op**。
- 管理员从既有内存读取9类进程生命周期累积均值：`BenchmarkStoragePerformanceReadOnlySnapshot` n3 P50 **281.9ns/op、464B/op、2allocs/op**。其余端到端/实际部署 CPU/RSS/Mutex p95=Not measured。
- `StartStorageSampler` 已有 Server 启动后按小时检查、由 Task Center 做24小时一次容量/GC/Blob去重历史快照；该任务保留原有持久化语义。它**不记录**每一分钟的 HTTP 延迟。

### 候选 AFTER（OBS-P002，必须先跑 n3）

新增**一个独立于 HTTP 请求热路径**的每分钟内存快照：复用同一个现有 Server 后台 `StartStorageSampler(ctx)` goroutine，将已聚合的9类计数、5xx与累计wall秒数复制到严格7个固定大小的RAM槽位；在管理员手动刷新既有 `GET /api/v1/admin/storage` 时，用**当前计数 - 最近五分钟内最旧的完整快照**计算实际窗口的 `requests`、`requests_per_second`、`server_errors` 和 `average_ms`。单个Server进程内，重启即归零。采样器每60秒运行，不为每个文件/Node分配记录、不把每次操作写入SQL或日志，也不为这项功能扫描存储根目录或FileVersion。任何原有HTTP路径录入逻辑**按SHA不变**。

1. 固定路由白名单继续用 OBS-P001 的9类，绝不把完整路径、文件名、用户、Node ID、SHA256、IP、Body 或请求Header输出到统计项。新数据只随 Admin `/api/v1/admin/storage` 返回；普通用户 `/api/v1/me/storage` 无此字段。
2. 明确 `maximum_seconds=300`、`sampling_seconds=60` 和实得 `window_seconds`，并给出当前窗口起止时间。前几分钟 `warming_up=true`，没有完整采样/时间倒退/2分钟以上采样器失效时 `available=false`、显示“—”，不能把缺失的 0 数值伪装为正常运行。
3. 每次页面刷新同步既有请求读取，无浏览器自动短轮询、每次文件操作新IO/CPU计时器、目录Walk、文件Hash或额外工作Goroutine。保留有锁但低频的CPU开销；不宣称“绝对零开销”。P95/P99、传输字节、4GiB写放大、用户可见缩略图首屏、真实Cancelled→Go Context.Done以及TaskCenter后台任务耗时**均无法从累计秒数恢复**，不要以 `average_ms` 冒充。
4. 所有定时快照通过既有可取消 Server context 结束，不能因为 Web滚动、关闭窗口取消长时用户任务。8个以上分钟的样本仍最多7格，不增长内存。所有客户端浏览器上的表格由同一个 MUI `GlobalStorageStatsPage` 呈现；源码共享不等于真机实测。

### 首次验收与冻结门槛

| 指标 / 工作负载 | BEFORE（已经合入的准确HEAD） | OBS-P002 待测/目标 |
| --- | --- | --- |
| **HTTP observeRequest 热路径** | P001 CI #39010151064 n3 P50 **51.06ns/op、0B、0alloc** | 源文件 Git Blob `9a247e2b086d53f0b26bf03f6d8d8a7956b21e0a` **逐字节不修改**，在新专用CI同Runner再测 n3，不能拿不同Runner做%提速推论 |
| **原有 Admin 累积9行读取** | P001 n3 P50 **281.9ns/op、464B、2alloc** | 源文件 Git Blob `a461da393c7971c3f0794bd100a8ace1c6900e06` **逐字节不修改** |
| **新增每60秒只读快照** | N/A，此运维操作不存在 | n3 P50 + 最慢 ≤2ms/op、≤64KiB/op，不增加每HTTP事件成本 |
| **新增管理员最近窗口读取** | N/A，旧版只有累积数据 | n3 P50 + 最慢 ≤2ms/op、≤64KiB/op，无 SQL/Walk/Hash |
| **合成100k请求有界计数** | P001已接受，仅1个Route/Status key | 100k *合成*事件+环形窗口全程保持**≤7×9类别**，明示不是真实100k物理媒体 |
| **真实六端混合媒体、4GiB传输** | 见平台矩阵中历史已验收独立样本 | OBS-P002本轮均 **Not measured**，既有场景不可反复跑伪造提升 |

必须 n≥3 完全相同源码、同一CI runner 记录 `ns/op`、`B/op`、`allocs/op`、Go/OS、精确SHA、原始 JSON 和机器日志；同一准确HEAD专用CI和全量CI（包括single-commit/final-gate、Go PostgreSQL Race、Web/Desktop/Windows/Rootless）均绿后才考虑合并。任何超预算实现需要回退或缩小范围，实际用户操作无可比 BEFORE/AFTER 不得宣称性能提升。

## 初轮专用准确源码微基准（2026-10-17）

首轮 [专用CI #39023778259](https://github.com/lazyxu/xdrive/actions/runs/39023778259) 以精确 HEAD `86bb58f2563136204bf4d7bc443d0d8abae35000` n3 在同一 Linux runner 依次测量旧HTTP观察 P50 67.25 ns/op, 0B/op, 0allocs；原管理员累积读取 P50 351.8 ns/op, 464B, 2allocs；**新每分钟后台记录 P50 118.4 ns/op, 0B, 0alloc**；**新管理员近期增量读取 P50 468.3 ns/op, 568B, 3allocs**。三轮均通过冻结最高2ms/64KiB预算，数值是测量函数本身，不是端到端截图、100k真物理文件或4GiB传输测试。完整逐字节原始证据 [ZIP+SHA和样本](performance-evidence/obs-p002/README.md)，提交证据后的源HEAD需要专用n3+全仓CI重新验证，未通过前保持Draft、不合并。

## 更进一步，明确不在本PR内

- 未来的请求p95/p99：需要新增**固定桶、可证明常数内存**的延迟分布，必须先同Runner做真实高并发HTTP竞争与锁等待 A/B，超过预算不接入热路径。平均值**不能**推导分位数。
- 每日自动记录操作时延、失败率/吞吐：宜把 **既有 60s RAM 聚合快照** 按固定类别压缩后异步低频持久化，采用Server实例+epoch避免多副本/重启重复、带保留期、权限和频率上限；不能每请求写DB。相比之下现有**每日物理容量/GC**快照已经自动运行。
- 完整文件大小/4GiB版本块复用、物理下载吞吐、缩略图真实解码、取消到Go `Request.Context().Done` 测试和混合媒体 Grid/Details 性能仍按已有专项的原始内容推进。参考 [Prometheus metrics types](https://prometheus.io/docs/concepts/metric_types/) 的 counter/histogram 和 [Kopia](https://kopia.io/docs/advanced/architecture/) 的内容与快照分层，但需经过xDrive原版n3实测，不能直接迁移。
