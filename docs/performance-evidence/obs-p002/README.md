# OBS-P002: 5分钟 RAM 聚合与原有HTTP热路径 — 准确源码首次机器证据

**首次真实n3：** [专用 Actions #39023778259](https://github.com/lazyxu/xdrive/actions/runs/39023778259)，测量源码准确 HEAD `86bb58f2563136204bf4d7bc443d0d8abae35000`。其后因归档和文档更新而重建Git工作提交，必须让新的准确HEAD重新运行完整专用CI和全仓CI；第一次已通过的专用CI本身不授予最终上线/合并权限。

真实Go函数在同一 runner 上以 `-benchtime=400ms -count=3 -benchmem` 测三次（Linux amd64 Go 1.25.x；实际详细源码、Go版本、CPU与内存全程资源由 `source.txt`、`resources.txt` 保留）。冻结新增操作预算**每一个样本** ≤2,000,000ns/op 且 ≤65,536B/op，均通过。

| 测量函数 | 三次原始 ns/op | P50 ns/op | B/op | allocs/op | 解读 |
| --- | --- | ---: | ---: | ---: | --- |
| `BenchmarkStoragePerformanceExistingHotPath` | 67.25 / 67.03 / 67.59 | **67.25** | **0** | **0** | 旧热路径源码 SHA **未改变**，同runner对照 |
| `BenchmarkStoragePerformanceReadOnlySnapshot` | 350.7 / 355.3 / 351.8 | **351.8** | **464** | **2** | 原 OBS-P001 管理员生命周期累积值 |
| **`BenchmarkStoragePerformanceRecentSample`** | 118.8 / 117.7 / 118.4 | **118.4** | **0** | **0** | 新每60秒一次 RAM/Mutex 只读快照；非每请求添加 |
| **`BenchmarkStoragePerformanceRecentRead`** | 480.0 / 468.3 / 462.3 | **468.3** | **568** | **3** | 新管理员请求时按7个固定槽位差分出最多9行 |

**不能相减声称网络、100k、4GiB 或 Web/Desktop 加速。** 旧 OBS-P001 不同 CI 运行的热路径P50 51.06ns/op、管理员旧读取281.9ns/op，仅作为不同运行器上的归档历史，不可推算“性能退化31%”；OBS-P002 HTTP热计数函数 GitBlob `9a247e2b086d53f0b26bf03f6d8d8a7956b21e0a` 全程未修改。本轮仅有新功能微基准而没有端到端前后对照提速，原版新增近期窗口 `BEFORE=N/A`，候选 `AFTER=118.4ns/sample 与 468.3ns/read P50`。测量进程包含整个Go编译测试，`resources.txt` 中CPU/RSS不是每次取样的资源峰值。

## 原始机器材料（4个文件，按字节未改）

永久存档 [GitHub Actions 原始 ZIP](ci-run-39023778259.zip)，与 [原始 GitHub Artifact #12097836739](https://github.com/lazyxu/xdrive/actions/runs/39023778259/artifacts/12097836739) 同一ZIP：

- ZIP 精确大小 **2847B**；SHA256 **`5e6c55d388bc632acc9ac4f5c50b80f85852dd299b52d44cd18cc395739dd369`**；GitBlob SHA1 `dd9fe519c168009097f9e9874c09a9920eb62d6b`。
- `source.txt` 861B，SHA256 `470f3857cc5166d472820808b8f0328be0ffbc253d06605d07ed7da5357c5da5`，包含精确源码 HEAD 和 SHA。
- `run.log` 4155B，SHA256 `51ede5874461b0e9e1d86b4a635e06af7fa30aced0fb84a813dc9813c71b3952`，Go单元测试和完整12组bench原文。
- `summary.json` 2526B，SHA256 `cefd23bf5f5c6dff5279adf1bb9f127f9722c2b34a1bf8ed1ba0423d249ebea2`。
- `resources.txt` 982B，SHA256 `06e4560bc39e0d6c5d566f207003f1958e46ef4cf08e18e2892bfd04a1342e16`。

下一准确 HEAD 专用 workflow 必须校验ZIP的上述五个摘要，验证里面 `EXACT_SOURCE_HEAD=86bb...` 与当前最终HEAD的 **实际代码（未改的6个Go文件）SHA256逐个一致**，再新跑三轮基准。后续只有文档变更的证据 HEAD 同样必须源准确专用+完整CI成功后才可Ready/Rebase Merge。禁止将旧 HEAD 的成功冒充新 HEAD 绿灯。

其余真物理100k图库/Explorer视口、四GiB SHA版本/GC与六客户端（已安装PWA）没有本轮新测，仍查看[统一登记簿](../../performance-test-registry.md)与[六平台矩阵](../../performance-platform-coverage.md)。长期每日归档延迟、真实p95/99、用户任务执行时间和CPU/网络争用均不是此阶段交付。
