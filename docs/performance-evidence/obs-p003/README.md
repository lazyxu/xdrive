# OBS-P003 — Fixed nine-class HTTP histogram overhead, source-exact Go A/B (2026-10-17)


**OBS-P003 full CI isolated historical blob fetch failure (2026-10-18):** at source-exact head `c3528f66d39ed7f5e34a53c3fa4d5da521d16e3f`, independent [dedicated six-case n3 CI #39085144071](https://github.com/lazyxu/xdrive/actions/runs/39085144071) successfully validated the permanent original ZIP and source SHA, and candidate overhead stayed below both budgets (sequential orig/candidate P50 54.96/61.45ns, 4CPU parallel 82.59/85.15ns; all 0B/0alloc). However embedded [full CI #39085143330](https://github.com/lazyxu/xdrive/actions/runs/39085143330) failed **before its A/B**: shallow checkout lacked historical Git blob `9a247e2b...`, fallback read-only GitHub API returned HTTP403 on the other CI Runner. **This is an invalid CI source-harness checkout failure, not candidate CPU RED.** Fix by adding exact immutable historical 23,355-byte original `internal/api/observability.go` Git Blob `9a247e2b086d53f0b26bf03f6d8d8a7956b21e0a` at [frozen-original-observability.go.txt](performance-evidence/obs-p003/frozen-original-observability.go.txt) in the PR HEAD tree; the workflow's unchanged `git cat-file -p` now reads the original object **locally from shallow checkout**, with SHA1 naturally verifiable and no REST/no auth token needed. The production metric collector, bin edges, source A/B, ≤1.25×/+50ns/0B budget, and 6 platform Not measured boundaries stay unchanged. Rebuild exactly one commit on the frozen parent and rerun final exact HEAD dedicated + full CI/FinalGate before Ready/Merge.


## 2026-10-18 · 首轮完整 xDrive 准确源码同 Runner A/B · 有效 n=3

**候选开销 ACCEPT，但不是已合并：** [专用CI #39084449383](https://github.com/lazyxu/xdrive/actions/runs/39084449383)，实测 Git HEAD `98537d4d5b6681952e67adce944e84cf3c381172`。历史原版 Go `observeRequest` 函数已从 GitHub 只读不可变 Git Blob `9a247e2b086d53f0b26bf03f6d8d8a7956b21e0a` 校验 Git-SHA1 并与冻结的测试函数逐字节比较；同一个 Go1.25.14 Linux Runner/二进制，顺序和4 CPU 共享锁场景各 n3。

| 精确工作项 | 三次原始 ns/op | P50 ns/op | B/op | allocs/op |
| --- | --- | ---: | ---: | ---: |
| 原版顺序HTTP计数 | 85.46 / 83.19 / 83.76 | **83.76** | 0 | 0 |
| 候选固定桶顺序HTTP计数 | 97.46 / 97.37 / 94.61 | **97.37** | 0 | 0 |
| 原版4CPU并发HTTP计数 | 125.8 / 121.1 / 120.9 | **121.1** | 0 | 0 |
| 候选固定桶4CPU并发HTTP计数 | 135.4 / 133.9 / 134.4 | **134.4** | 0 | 0 |
| 每分钟RAM Histogram快照 | 502.4 / 502.3 / 505.2 | **502.4** | 0 | 0 |
| 管理员手动近期窗口读取 | 1758 / 1777 / 2131 | **1777** | 904 | 21 |

**冻结双重CPU预算：** 顺序 97.37/83.76 = **1.1625×**（+13.61ns/op），并发134.4/121.1 = **1.1098×**（+13.3ns/op）；两者均≤1.25×且增量≤50ns/op、**0B/op、0alloc/op**。新低频两操作的每次最慢样本均≤2ms和64KiB。此候选增加每个被归类HTTP请求的CPU时间，**不是上传/下载/图库性能提速**。直方图固定9×25个uint64=1,800B/Server，计算的是**p95/p99 桶上界**，不是精确分位值、Worker时长或实际HTTP吞吐字节。

**永久原始4文件机器ZIP：** [ci-run-39084449383.zip](ci-run-39084449383.zip)，原 [GitHub Actions artifact #12119784545](https://github.com/lazyxu/xdrive/actions/runs/39084449383/artifacts/12119784545)，ZIP SHA256 `7fd8fb55c77833b1cfa5ea6e1340e83573b1fbcc40c8198677f64d0bbf0841c8`，Git Blob SHA1 `768caa675788e3b5cf0cc7504974cc5d69cd8659`。

| ZIP原始成员 | 字节数 | SHA256 |
| --- | ---: | --- |
| run.log | 3697 | `11f7a7b276cc039ecde509df1739ef0ece75724f6b190f4ed6aa11fb31c172f0` |
| source.txt | 896 | `9de288c41bfa8a92807d8022e8a90b1570de87b66b883a0b79a284f61ea17e0d` |
| resources.txt | 990 | `bba0e69371c8bd1e3f488a2da3b48e1eb2e0f91f32d3c8184e37c10b3ba98be7` |
| summary.json | 3855 | `09daf159e014d05c727f746026ab3b64f046861f90bca37a8d8af4cf2c063a94` |

`source.txt`保存准确实测HEAD、6个Go/UI真实源码SHA256、Go版本与Runner平台；`summary.json`保存全部18组指标、原版/候选比例、最终ACCEPT判断。**每次证据入Git产生新的HEAD，必须重新跑新准确HEAD原始SHA验证+3次同RunnerA/B和完整CI含Final Gate才可合并。** 实体Desktop/Web/Mobile Web/各安装态PWA客户端实际此窗口的视觉/网络性能全部**Not measured**，不把100k合成事件当真实100k物理CAS。


**OBS-P003 source-exact microbenchmark scheduling safeguard (2026-10-17):** Existing dedicated workflow [initial invalid #39037277451](https://github.com/lazyxu/xdrive/actions/runs/39037277451) was scheduled on original opened PR but has not produced a specialized new-HEAD run on subsequent commit updates despite ordinary CI being triggered. To avoid treating missing data as green, copy the **unchanged identical dedicated job** into `.github/workflows/ci.yml` as a P003-branch-only `obs-p003-quantile-overhead` job. It runs full same-GitBlob legacy baseline verification plus all **six** n3 serial/parallel/minute/admin benchmarks with frozen 1.25× / +50ns / 0B/0alloc budgets, and emits raw artifacts. It is not a replacement for actual measurement or license to bypass required full CI/final-gate; require this exact new HEAD special job **AND** complete CI success, otherwise keep Draft / candidate rejected if genuine overhead RED. Existing Race and durable task paths remain unchanged.

**OBS-P003 第二次 Invalid harness（2026-10-17）：** 修正测试四／六类不一致及第一次go fmt后，源码HEAD `a48b3065b6ee3408094206f6e6dd9c4b32de35bf` 的 [完整CI #39038252090](https://github.com/lazyxu/xdrive/actions/runs/39038252090) 在 `go-linux` → `Check formatting` 打印出 `storage_performance_window.go` 新增 `*float64` 字段后，四条原有DTO字段JSON tag空格尚未按gofmt重对齐；源码未进入真实n3同Runner A/B，**有效n=0**，不能认定候选CPU RED。本准确HEAD尚未产生独立OBS-P003专项CI（之前旧HEAD的失败不得复用）。仅按CI的四行精确格式差异修复及增强专项workflow格式诊断输出，所有固定开销门槛、直方图结构和安全/隐私约束不变。新唯一工作提交必须重新跑全部源准确门禁。

**OBS-P003 首轮 Invalid harness（2026-10-17）：** 提交 `65af655c777c06bb02dc7e0510cdc913449a66c0` 的 [专项CI #39037277451](https://github.com/lazyxu/xdrive/actions/runs/39037277451) 在源比较与微基准之前即失败：Go `gofmt -l` 静默返回非空，固定范围包括新增HTTP histogram/近期窗口及同进程A/B基准夹具，故**真实同Runner有效n=0**；该门禁也曾配置仅运行4个基准，却要求解析6类数据，属于下一必修测试夹具缺陷。未采集真实候选CPU/锁成本，不是产品性能RED，也不能放宽预算或跳过真实对照。只调整Go字段格式及CI `-bench`六类清单，保持旧生产函数逐字节对照、24个桶、预算≤1.25×/50ns、0B/op/0alloc和全部安全/平台边界不变。重建原固定基线上**唯一工作提交**，再跑准确新HEAD专项 n=3 和全仓CI。

**Status: candidate / no real n3 measured yet.** [Source frozen contract](../../global-storage-percentile-overhead-obs-p003.md) · [central registry](../../performance-test-registry.md) · [six-platform matrix](../../performance-platform-coverage.md).

This workload is **only about the incremental Go-request CPU/memory/lock cost of adding a fixed 9×25 HTTP duration histogram**, not 100k *physical files*, 4GiB CAS writes, exact quantiles, or real mobile/PWA. Avoid duplicate P001/P002, P047/P055/P056/P057 accepted physical test evidence.

- Freeze the old production source `internal/api/observability.go` Git Blob `9a247e2b086d53f0b26bf03f6d8d8a7956b21e0a`. The benchmark's `obsP003LegacyObserve` is the byte-identical old `observeRequest` method body, only the declaration is adjusted to coexist with the new candidate. The branch-scoped CI must compare both source blocks before measuring.
- Compare both **real Go methods** with identical fixed nine route templates/states/durations and **the same binary, Go version, CPU and Runner**, in 3 repeats each for sequential and 4 CPU parallel; report all 18 `ns/op`（包括PeriodicSample/AdminRecentRead两项低频操作各n3）, `B/op`, `allocs/op`, medians, candidate/old ratio and absolute overhead. Frozen admission: median candidate≤old1.25× in both modes; extra median≤50ns/op; both allocs/op=0 and B/op=0; histogram has only 1800B per Server and the existing ring has seven fixed samples.
- Code tests must show 98×10ms+2×100ms → bounded p95≤10ms/p99≤100ms, no invented overflow quantiles, no user/path leakage, real window freshness and 100k **synthetic** events constant cardinality.
- The dedicated CI must store exact HEAD/source SHAs, OS/Go/runner, unedited original log and three-run JSON summary as GitHub artifact. Then archive the original bytes and SHA256 in this directory, rebuild the one work commit on the frozen parent, and rerun **final exact evidence-HEAD dedicated and complete CI/final-gate**. No direct product performance speedup claim. If any overhead gate fails, revert product instrumentation and record **REJECTED** rather than weakening the admission budget.
- `p95_upper_ms/p99_upper_ms` are histogram **bucket upper bounds**, not exact percentiles; request durations exceeding 300s have no numeric upper bound, so display “—”. This only covers current-Server recent HTTP requests, not CPU time, Server Worker Task Center, UI frame/thumbnail actual display, network throughput, disk GC, or multi-server fleet. Six GUI/installed PWA environments remain `Not measured`.

Prior local `go1.23.2` standalone method-copy smoke indicated order-of-10ns overhead with zero allocation, but **this is not source-exact xDrive/Go1.25 CI**, does not qualify as a valid production CURRENT/AFTER and is omitted from the machine table until the real identical HEAD CI.
