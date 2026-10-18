# SH-P002 — 首次公共分享元数据 GET 取消性能（2026-10-18）

**同一候选 HEAD 的完整 CI 静态契约 FIRST RED（2026-10-18）：** [CI #39108356287](https://github.com/lazyxu/xdrive/actions/runs/39108356287) 的 Desktop 3145 项检查仅 `Web public share keeps native download, password and eligibility feedback` 未通过：旧源码断言仍要求不携带信号的 `api.publicShare(token)`，而实测可取消的生产调用已变更为 `api.publicShare(token, controller.signal)`。两个真实 n3 专项在 [#39108356394](https://github.com/lazyxu/xdrive/actions/runs/39108356394) 均通过；此处仅更新**单个过时静态来源断言**，不修改生产性能代码或阈值。修正后必须运行**新准确 HEAD** 完整 CI/Final Gate，原失败保持记录且不能用于合入。

## 候选 AFTER · 两条来源准确 n3 均通过（2026-10-18）

单工作提交候选源码 `9c976a6a38acbb3e0ca4e3582ec5b448fb7cb265` 在 [专项CI #39108356394](https://github.com/lazyxu/xdrive/actions/runs/39108356394) 完整执行并通过两条**不同测试链路**。真实 React 源码 Effect（但请求 Promise 为测试适配器 held）的卸载取消 **3/3**，AbortSignal 时间 **0.158245 / 0.066174 / 0.073157ms**，P50 **0.073157ms**、最慢 0.158245ms，满足冻结 16ms；原版准确 CURRENT 是 **0/3**，没有可用的原版成功取消毫秒数，因此 **BEFORE 时延不存在、speedup=N/A**，不能宣称“提速 x 倍”。

独立**真实 Go Gin / PostgreSQL17 的受锁阻塞首 GET**，Handler 取消退出 **0.128 / 0.114 / 0.067ms**（P50 **0.114ms**）；SQL 实际锁等待解除 **6.781 / 6.439 / 6.222ms**（P50 **6.439ms**）。均 **3/3** 小于原冻结 160ms 且 PostgreSQL 残留等待者为 0。该服务端试验与 React 异步持有试验分别进行，**仍没有同一浏览器发起的完整 Web→Go 端到端或真实 100k 物理媒体性能证据**；六客户端安装态均继续标 Not measured。

机器原始证据按历史准确 SHA 永久归档，不用不同时机/Runner 混合构造 A/B：本次 [React 四文件 ZIP](performance-evidence/sh-p002-public-share-first-get/ci-run-39108356394-react.zip) 1812B, SHA256 `dc78663094785ae47eb38188b9fe14993ddb07dd776aae9cbc0c2ba29edb6f63`，原 [Artifact #12129372144](https://github.com/lazyxu/xdrive/actions/runs/39108356394/artifacts/12129372144)；[Go 四文件 ZIP](performance-evidence/sh-p002-public-share-first-get/ci-run-39108356394-go.zip) 1819B, SHA256 `c5766b210eb5d5560917f86e5ebccbe77a8277e1e941946b20f31365ef2e170f`，原 [Artifact #12129770993](https://github.com/lazyxu/xdrive/actions/runs/39108356394/artifacts/12129770993)。各自包含完整 `source.txt` / `summary.json` / `resources.txt` / `run.log`，实际物理 CAS 原件=0。Go 的 maxRSS 1488508 KiB 和 CPU 88.06s user +6.87s sys 是**整个 Go 编译+测试进程**，不能冒充被取消的单 GET CPU。React maxRSS 139640 KiB / userCPU 1.00s / sysCPU 0.10s 同样是完整测试 Node 进程。

更新这些证据改变最终 HEAD；以上 #39108356394 只能视为**历史成功候选**，必须在最终源准确 HEAD 全量重新执行专项 n3、Go/PostgreSQL API、Web/Desktop/Windows、Rootless/artifacts/Final Gate，并由 GitHub 确认合并状态 clean，才可取消 Draft 和 rebase 合入。

## 已有 CURRENT 与新缺口

[SH-P001 文件夹分享](folder-share-performance.md)的真实 PostgreSQL17 100k 元数据分页原版 n3 P50 为 **16,699ms**，另一条文件夹 POST 被锁 SQL 的 Go 取消 n1 **0.290ms**（160ms 内、0 残留等待）。这不覆盖首次 GET。已合入的 Web/Mobile 公共分享组件在 `api.publicShare(token)` 开始的首次 `GET /api/v1/public/share` 上缺少请求拥有者的 `AbortSignal`；其卸载仅阻止旧状态更新。Server 已通过 `c.Request.Context()` 和 DB `WithContext` 支持取消。此处是取消能力缺口，尚无首 GET 成功取消延迟 BEFORE。


**首轮 INVALID harness（2026-10-18）：** 原始单工作HEAD `a4cbc9d3f659cd8060d3c66eda59cf4154f6a690` 的 [专项 #39107214716](https://github.com/lazyxu/xdrive/actions/runs/39107214716) 在 `actions/setup-node@v4` 因仓库不存在的 `desktop/package-lock.json` 缓存路径失败，真实 React n3 **没有运行、有效数据 n=0**；不是产品性能 RED，也不能填入 0/3 为实测。仅删除无效 npm 缓存参数，不修改 Web/API/测试阈值。新准确HEAD专项日志和永久 JSON 仍是首次基线必需条件。

## 已测原版 CURRENT，未修改 Go/生产（2026-10-18）

准确原版分支 HEAD `f944b5877e291d84a6cf3628b9432a603677a047` 的 [真实 React 源码专项 CI #39107293759](https://github.com/lazyxu/xdrive/actions/runs/39107293759) n=3 **成功执行并证实 FIRST RED**：请求信号传入 **0/3**、卸载 abort **0/3**、三次 `abort_ms=null`，无原版可比较成功取消耗时。React 是真实组件和 Effect，但网络 Promise 被测试适配器 held；**HTTP/Go/100k物理CAS 未测**。原始进程 `maxrss_kib=133268`、`user_cpu_seconds=0.68`、`system_cpu_seconds=0.06` 是完整 Node 测试进程包括安装测试开销，不是独立 GET CPU。不可计算加速百分比。

原始 GitHub [artifact #12128119068](https://github.com/lazyxu/xdrive/actions/runs/39107293759/artifacts/12128119068) 的未改动四文件 ZIP **1773B、SHA-256 `bf42a58879f7a45853df76283ca4ece2b2b47874d2c47391109e19661e581051`** 已永久纳入 [二进制原证据](performance-evidence/sh-p002-public-share-first-get/ci-run-39107293759.zip)。先前 #39107214716 因不存在的 npm lock 缓存路径 invalid n=0，保留历史，不将其算成性能红。

**最小候选**：仅为 XDriveApi.publicShare 增加可选 `signal`、PublicShare 首 GET Effect 拥有并在卸载 abort；原 GET 的鉴权和 UI 错误状态、目录翻页、用户主动下载保持不变。真实 Go/PostgreSQL 独立 GET 锁等待三次，要求 Handler/SQL <=160ms 且零残留，实际 n3 待来源准确 CI。不把这两个独立测试冒充完整浏览器到 Go 或真机、100k媒体负载。

**首轮候选 Go 专项 INVALID（2026-10-18）：** `eeb951fbfe3b0f3a61402c229cb6acc65575c13a` 的 [专项 #39107997171](https://github.com/lazyxu/xdrive/actions/runs/39107997171) 中，源执行 React n3 通过（3/3 同步取消；0.109726 / 0.054452 / 0.054462ms），真实 PostgreSQL 测试 **尚未进入**，Go 编译因本次新测试文件中 `sqlEleased` 两处拼写错误失败。真实 Go n3 有效数据 = 0；不是产品性能或取消 RED。仅改正此编译名并记录历史，真实测试必须新 HEAD 运行，原封不动保留 <=160ms 预算和已合入产品安全范围。

## 冻结测试和取舍

工作负载 `SH-P002/mounted-React-public-share-initial-metadata-unmount`：实际执行共享 `PublicShare` TSX（真实 React effects），3 个独立挂载、各一条被测试适配器持有的元数据请求、卸载、记录 signal 是否收到和 abort 事件相对卸载开始的单调时间。**测试中的异步 HTTP 被 mock；不是实际浏览器→Go 请求，不是100k原片，不给六端通过标签。** 原版 SOURCE CURRENT 预期 0/3 可取消，必须以原始准确 HEAD CI 证据为准。候选要求 **3/3** 发送并中止，`abort_ms <=16ms`。原版未发生取消，不计算伪造的 ms 或优化百分比。

后续独立真实 PostgreSQL17/Gin `GET /api/v1/public/share` 锁 SQL 取消验证须原始 ctx 到 Handler/SQL waiter 均 **<=160ms**、零残留，n>=3；它只是 Server 单层，不能冒充完整浏览器链路。只有明确原版缺口才为原 GET 增加可选 AbortSignal 并在首次 useEffect cleanup 取消，不修改目录分页、下载的用户持久任务、权限、Race 或其它模块。保留原证据，现有全部 100k/4GiB 验收不重跑。

每次更新 [总登记簿](performance-test-registry.md)、[跨端矩阵](performance-platform-coverage.md)，保存真实 source SHA、n3 JSON/资源及 CI 链接；最新准确提交须重新执行专项和全量 CI + Final Gate，Github clean 才合入。真实 Web、Mobile、Desktop、已安装 PWA、真正 WAN+Go 仍为 Not measured。
