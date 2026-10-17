# OBS-P001 · 管理员全局存储只读 HTTP 性能聚合：真实 CI 证据

## 身份与结果

**2026-10-17；首次准确源码 CI 成功，证据更新后的最终 PR HEAD 专项+全仓 CI 仍须重新运行。** 独立 [OBS-P001 GitHub Actions #39009569013](https://github.com/lazyxu/xdrive/actions/runs/39009569013) 在实际被测 Git HEAD `88c00d428a2ae6832a9d3c73870a338a7172dfc2` 运行；Go 1.25.14 / Linux amd64。脚本使用真实生产 `serverObservability.observeRequest` 和新 `snapshotStoragePerformance`，分别执行 **n=3 个 Go Benchmark 重复样本**；不是 100k 真实 CAS 文件、完整 4GiB 客户端上传或任何真实手机/PWA 运行。所有纯单元测试和 [共享UI源契约](../../../desktop/tests/global-storage-performance-obs-p001.cjs) 同一专用 CI 均通过。

| 同一 runner 三次每次基准 | n=3 原始 ns/op | P50 ns/op | B/op | allocs/op |
| --- | --- | ---: | ---: | ---: |
| 已存在的 `observeRequest` HTTP热路径原样（非新仪表） | 43.28 / 43.61 / 42.67 | **43.28** | **0** | **0** |
| 新管理员按原有map读取固定9分类快照 | 211.0 / 216.8 / 213.7 | **213.7** | **464** | **2** |

冻结新只读快照预算：每次 ≤2,000,000 ns/op、≤65,536 B/op；3/3通过。高频HTTP热路径原函数代码保持**原封不动**，此 PR 添加的快照只在认证管理员请求 `/api/v1/admin/storage` 时调用；不能将两行不同基准当作 CURRENT→AFTER 的延迟加速或新增请求成本。新功能的上线前同负载 BEFORE=N/A，**实测快照候选 AFTER=213.7 ns/op P50**；HTTP请求用户可感知耗时变化与长传输端到端影响尚未配对A/B。总进程资源 `resources.txt` 包含**Go编译+测试全程**，其 Max RSS/CPU 并非快照自身，不能据此声称单次聚合内存峰值。

## 4项原始机器文件（逐字节未改）

[原始归档 ZIP](ci-run-39009569013.zip) 是 [GitHub Actions Artifact #12092306378](https://github.com/lazyxu/xdrive/actions/runs/39009569013/artifacts/12092306378) 的完整未修改 ZIP 字节，在Git仓库里长期保存。

- ZIP SHA256 **`401f8016a634a7a7914ee8d13f5bea7c0779f77736f78df3973a2c25d235c9c4`**；Git Blob SHA1 `b736339664de55f293201d0699281125b73b3e87`，共 2337 字节。
- 原始 `summary.json` SHA256 `fb7eb7cba6173ec1baea40daa9f4c1a3d83c8dc2255cbcced689a6d37e8ad036`，包含六个原始样本、P50、预算、Source HEAD。
- 原始 `source.txt` SHA256 `2ad434d5dd24a871feff21383fba755f5013c74c87a868845e4706e9ee4c1574`，包含 Go版本、Linux来源与实际被测四个源码SHA256。
- 原始 `run.log` SHA256 `b784e60104b06e71394f0d7715690f7af815d026426f28ee80c104c8099f30e3`；原始 `resources.txt` SHA256 `cd303065059412b2eaf585ff8adfa097b5bd4a2107fd10d52bf82ce853c61910`。

可通过 `sha256sum ci-run-39009569013.zip` 与 `unzip -p ... summary.json` 独立校验归档数值。后续修订文档会改变提交 HEAD，必须在同一固定父提交的**一个工作提交**中更新文档，再跑准确新 HEAD 的专用三轮 benchmark、完整 76-job CI 与 Final Gate；不可把旧 `88c00d4` 成功直接用作新证据 HEAD 的放行依据。

## 限制与下一步

- 目前只显示**当前Server进程生命周期累计**的九类请求次数、HTTP5xx及平均HTTP wall耗时；不是p95/p99、真实Bytes/s、GPU解码/浏览器首图时间、Go Worker耗时或跨Server汇总。
- 重启重置累加器；24h存储/GC容量趋势仍由现存 `StorageSample` 持久任务单独采样，不是新增的每日性能耗时历史。
- 后续若要5分钟窗口Histogram、平均传输字节、每日耗时汇总或分端真机观测，先建立同 runner 高并发HTTP压测前后CPU/RSS/Mutex等待/端到端p99基线，再决定是否增加 **O(1) 固定桶**与有预算的周期汇总。不得每HTTP请求写数据库，也不得在面板刷新时扫描100k CAS。
