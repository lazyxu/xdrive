# OBS-P003 · 固定桶 p95/p99 采集开销及全局存储近期分位数（2026-10-17）

## 现状与新负载的必要性

**P0性能-only；先量测新增每请求采集成本再决定是否接受。** 必须先查 [已归档总体性能登记簿](performance-test-registry.md)、[OBS-P001/P002既有运维观测](global-storage-performance-window-obs-p002.md)、[六平台矩阵](performance-platform-coverage.md)、[CAS审计](blob-cas-dedup-architecture-audit.md)。当前生产已累计固定9类Route+HTTP状态的Count/总HTTP wall seconds，并每分钟保存7个内存快照供管理员手动刷新；没有真正的延迟分布，因此旧 `average_ms` 与 `requests_per_second` **无法推算 p95/p99**。不能拿不准确的百分位数来帮助运维发现瓶颈。

原版 CURRENT 有[OBS-P002准确HEAD专用 n3](https://github.com/lazyxu/xdrive/actions/runs/39024148473)：旧HTTP observer P50 **62.34ns/op, 0B/op/0alloc**；管理员老九类累计读取P50347.5ns/464B；一次RAM采样119.5ns/0B、最近窗口手动读取570.3ns/568B。不同Runner的OBS-P001数值不能相减作提速/退化百分比；需同一准确HEAD Go test binary中**字节级保留历史原版观察函数**与新增Candidate交替量测。

## 冻结设计

- 每个 HTTP 请求仅在**现存 observeRequest 的 o.mu 同一临界区**按HTTP method+Gin Route模板匹配已经枚举的九类，计算24个固定时延界限内某一Bucket、执行一次uint64计数增量；不添加锁、定时器、worker、SQL、文件扫描、单请求分配或动态标签。没有真实请求路径、Node ID、hash、Owner、IP、Cookie、请求体及Byte counts。
- 固定时间边界：250μs、500μs、1/2/3/5/8/10/15/25/40/60/100/150/250/400/600ms、1/2/5/10/30/60/300s，另一个无限大overflow Bucket。每个Server单独的 `uint64[9][25]`，**固定1800B**；既有7槽每分钟拷贝，每槽约1800B加已有Count/Duration，常数内存，不做每请求新增日志。
- 计算的是**观测HTTP请求时延p95/p99所在Bucket的保守上界** `p95_upper_ms/p99_upper_ms`，不是精确分位数，不是 CPU、文件上传完成持续任务、浏览器帧解码、传输B/s或磁盘 IOPS；超过300秒上界的请求落overflow桶，**不造假有限数字**，用None/“—”表明没有界限。当前Server重启、缺采样/停顿、低样本数如未达到稳定窗口，继续显示原OBS-P002真实window_seconds/warming_up/unavailable。
- Web+Desktop共用同一个MUI Global Storage页面，只有Admin全局实例性能行展示“≤ p95/p99上界”，不添加客户端定时轮询。普通User `/me/storage`无新增字段。每日**物理容量/GC**历史任务不变，p95窗口**不持久化**。
- 仅请求记录路径有意增加一项固定计数，这是**新增产品功能且可能降低原性能**。不要称“无开销”。若真实基准不满足以下预算，必须回退生产热路径扩展而只保留离线研究证据。

**OBS-P003 首轮 Invalid harness（2026-10-17）：** 提交 `65af655c777c06bb02dc7e0510cdc913449a66c0` 的 [专项CI #39037277451](https://github.com/lazyxu/xdrive/actions/runs/39037277451) 在源比较与微基准之前即失败：Go `gofmt -l` 静默返回非空，固定范围包括新增HTTP histogram/近期窗口及同进程A/B基准夹具，故**真实同Runner有效n=0**；该门禁也曾配置仅运行4个基准，却要求解析6类数据，属于下一必修测试夹具缺陷。未采集真实候选CPU/锁成本，不是产品性能RED，也不能放宽预算或跳过真实对照。只调整Go字段格式及CI `-bench`六类清单，保持旧生产函数逐字节对照、24个桶、预算≤1.25×/50ns、0B/op/0alloc和全部安全/平台边界不变。重建原固定基线上**唯一工作提交**，再跑准确新HEAD专项 n=3 和全仓CI。

**OBS-P003 第二次 Invalid harness（2026-10-17）：** 修正测试四／六类不一致及第一次go fmt后，源码HEAD `a48b3065b6ee3408094206f6e6dd9c4b32de35bf` 的 [完整CI #39038252090](https://github.com/lazyxu/xdrive/actions/runs/39038252090) 在 `go-linux` → `Check formatting` 打印出 `storage_performance_window.go` 新增 `*float64` 字段后，四条原有DTO字段JSON tag空格尚未按gofmt重对齐；源码未进入真实n3同Runner A/B，**有效n=0**，不能认定候选CPU RED。本准确HEAD尚未产生独立OBS-P003专项CI（之前旧HEAD的失败不得复用）。仅按CI的四行精确格式差异修复及增强专项workflow格式诊断输出，所有固定开销门槛、直方图结构和安全/隐私约束不变。新唯一工作提交必须重新跑全部源准确门禁。

**OBS-P003 source-exact microbenchmark scheduling safeguard (2026-10-17):** Existing dedicated workflow [initial invalid #39037277451](https://github.com/lazyxu/xdrive/actions/runs/39037277451) was scheduled on original opened PR but has not produced a specialized new-HEAD run on subsequent commit updates despite ordinary CI being triggered. To avoid treating missing data as green, copy the **unchanged identical dedicated job** into `.github/workflows/ci.yml` as a P003-branch-only `obs-p003-quantile-overhead` job. It runs full same-GitBlob legacy baseline verification plus all **six** n3 serial/parallel/minute/admin benchmarks with frozen 1.25× / +50ns / 0B/0alloc budgets, and emits raw artifacts. It is not a replacement for actual measurement or license to bypass required full CI/final-gate; require this exact new HEAD special job **AND** complete CI success, otherwise keep Draft / candidate rejected if genuine overhead RED. Existing Race and durable task paths remain unchanged.

## 原版与候选：冻结的同Runner预算

**独立P003负载ID `OBS-P003/9-route-24-edge-fixed-duration-buckets`。**
源准确CI从冻结原 `observability.go` Git Blob `9a247e2b086d53f0b26bf03f6d8d8a7956b21e0a` **逐字节提取原 `observeRequest` 方法体**（仅重命名为测试用 `obsP003LegacyObserve`），要求CI校验复制体完全相等后，在同一Go1.25 runner、同一代码路径/9个匿名固定Route样本下，n=3测4个真实函数场景：

| 场景 | 原版/候选 | 冻结接受标准 |
| --- | --- | --- |
| 9类真实Go Observer方法顺序执行（固定样本） | 原版 vs 增加一个固定桶 | 同一Runner n3 中位 `ns/op` 候选≤原版**1.25×**，且额外绝对CPU成本≤**50ns/op**；双方 B/op=0、alloc/op=0 |
| 4 CPU并行（`RunParallel`，SetParallelism=2，固定Route） | 原版 vs 同现存mutex下固定桶 | n3中位≤原版**1.25×**，额外绝对延迟≤**50ns/op**；双方B/op=0、alloc/op=0 |
| 100k **合成请求**计数/桶 | 持久定长9×25桶、七槽 | 无身份字符串泄漏，所有桶总和100k，容量≤2KiB单实例hist，有限window真实扣除 |
| 每分钟一次有界Histogram RAM快照／管理员近期读取 | 新增Admin侧（无原版p95） | 每个独立n3样本≤2ms/op、≤64KiB/op，不为HTTP热路径添加任何DB或FS工作 |
| p95/99分布与overflow | 98个10ms+2个100ms、其他路由/404/500组合 | 精确桶上界10ms/100ms，不得把overflow、无请求、无时间窗口伪造数字 |

冻结真实代码的 Admin/PG17鉴权、原有StorageSample、MUI Web/Desktop编译、准确HEAD完整CI需全部通过。耗时增加不代表用户端到端上传“慢了 X%”；这是小范围Go内存仪表增量，在并发网络负载和实际生产分布上尚无测量，未来仍需真实压力证据。CI n3真实结果必须归档于[OBS-P003 原始机器证据](performance-evidence/obs-p003/README.md)、更新登记簿、矩阵、AGENTS.md；证据更新变化HEAD后还须全套复测。

## 先期本机**非权威**试验（不得作为接受）

开发机 Go1.23.2 AMD EPYC 下曾以来源正文复制的最小Standalone观察器做同Runner3次4CPU预探：顺序原P50约64.62ns/op、候选71.92ns/op；并行原P50约104.5ns/op、候选109.8ns/op，0B/0alloc。**这不是完整xDrive源码、不是Go1.25且没有Admin/Server真实路由，故只支持“值得做源准确CI”，不证明当前生产已经通过冻结预算，不纳入最终通过表格。**

## 坚持性能主线边界

已有P057真物理100k DELETE/Undo原版P50约1.610/1.459秒且物理0重写，专项CI成功；其完整CI因已有Go API PostgreSQL连接耗尽重复失败，另记[CI issue #1997](https://github.com/lazyxu/xdrive/issues/1997)，P057需保持Draft。与本项目OBS-P003无性能内容关系，不要修改该Race/鉴权/PG测试、降低FinalGate或抢合并。所有100k真物理图库/文件浏览器、4GiB Blob/版本与六客户端平台测试仍按[矩阵](performance-platform-coverage.md)分开验收；**本项目没有真实安装PWA或原片内容测试**。
