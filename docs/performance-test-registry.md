# xDrive 已测性能登记簿（Performance Test Registry）

> 审核基线：`lazyxu/xdrive master@ee541cee99b0f7166f5965a3ac647d3b8765b3c0`，截至 2026-10-11。**本登记簿是所有历史已测工作负载的统一去重入口；原始数值和方案决策以对应的子系统规范、原始 JSON 与源码准确的 CI 为准。** 不能因为这里列有归档目录就假定所有测试均通过，也不能把历史CI结果称为本次最新 master 实测。

## 如何使用：每次开始性能专项前必查

1. **先在本表和下方 70 个证据目录中按工作负载身份查重**，再看当前相关开放 PR/分支。工作负载身份至少包含：系统/界面层（Web、Mobile Web、Desktop Main/Agent、Go HTTP、SQL）、操作及请求接口、逻辑条目数、**物理CAS原始数/真实字节及编码种类**、数据分布、缓存冷热、虚拟视口位置、用户操作/取消所有权、传输网络/本地介质、平台与采样方法。只有总量相同不代表测试等价。
2. **同等已验收场景不再做一遍探索性测试/盲目优化。** 除非生产热路径变化、确认回归、扩展了未测介质/平台/网络/数据形状、预算发生合理变化、或 `AGENTS.md` 要求的证据修订**准确最终 SHA**复验。因新源码回归复测应在同一 ID 下追加记录，不创建“新性能发现”；说明触发原因与旧来源。
3. 状态严格区分 **Accepted / Merged**（达到对应冻结预算）、**Measured RED**（真实性能超预算）、**Rejected**（尝试过且未通过保留标准）、**Invalid harness**（样本无效）和 **Blocked / Not measured**。遇到红项先用原始数据归因，再锁定同条件 BEFORE/AFTER 和资源/正确性门槛；不能从失败操作耗时计算“速度提升”。
4. 新测试/优化 PR **同时更新本登记簿与对应子系统规范**：冻结工作负载 ID、规模和物理数据真实性、命令/环境、样本数、预算、BEFORE/AFTER 与单位、CPU/RSS/IO/请求及字节量、决策、有效 CI/源码 SHA、原始证据链接和未覆盖项。保留失败/拒绝及无效样本，不能覆盖成“通过”。
5. 仅在命中真实未覆盖场景时创建新专项，优先收尾关联 PR/分支并保持单工作提交。浏览器视口/预览退出的 **AbortSignal→Desktop IPC→Go Context.Done** 与持续执行的 Task Center 上传/下载/同步/删除是**不同任务所有权**；窗口变化不应取消持久任务。

**完整规范**：[AGENTS.md](../AGENTS.md)；**子系统详细协议与历史实验**：[图库](gallery-performance.md) · [FileExplorer/传输/删除](file-explorer-performance.md) · [同步与取消](sync-performance.md)。补充历史本地/原生观测存于 [`docs/performance/`](performance/)；原始输出位于 [`docs/performance-evidence/`](performance-evidence/)。

## 已执行场景与决策（可检索 ID）

下列时间、速度、P50 等**属于各自原始独立 CI 样本**，不是横向可相减的 A/B，也不自动代表截至今天的用户生产环境性能。粗略“100k”尤其要核对“元数据 100k / 真实CAS 100k / 抽样可见缩略图 6/12/56”的边界。

| ID | 分类 | 已做测试与真实边界 | 结果与冻结门槛 / 解释 | 状态 | 溯源 |
| --- | --- | --- | --- | --- | --- |
| P001 | 图库·物理媒体 | 100k PhotoAssets／115k 不同 CAS：70k 图片+15k 视频+15k Live still/motion；Go/Gin HTTP 首屏56项，n=3 | Range 606.452ms；冷首张 47.870ms；前12张 81.515ms；热首张 3.597ms；视频首字节 2.593ms；47/9 请求，峰值6/3；四项预算通过 | **已验收 CURRENT，#1439 已合入** | [原始记录](performance-evidence/gallery-physical-mixed-100k/ci-run-38155338468.json) · [PR/CI](https://github.com/lazyxu/xdrive/actions/runs/38156004656) |
| P002 | 图库·Web 首屏 | 100k 逻辑、115k 元数据；真实 Chromium Web+Gin/PG/CAS；首屏少量真实原图，n=3 | 首图两帧呈现代理 P50 1,524.9ms；前12张 1,701.9ms；Long Task 曾超诊断线；非100k物理原图 | **已测 CURRENT；Long Task 仍有诊断信号** | [原始记录](performance-evidence/gallery-web-real-cold-100k/ci-run-37925995257.json) |
| P003 | 图库·Desktop 首屏 | 100k 逻辑、115k Node；真实 Electron Main/Preload/Renderer→Agent；可见原图解码，n=3 | 首张解码+两帧代理 P50 1,793.6ms，低于2s目标；首12张 P50 1,932.2ms；非应用进程完整冷启动 | **已验收 CURRENT，生产未优化** | [原始记录](performance-evidence/gallery-desktop-real-first-paint-100k/ci-run-37939861500.json) |
| P004 | 图库·Agent IPC | 100k 逻辑、115k Node；真实 Go Agent→Gin/PG/CAS，12 个缩略图，n=3 | 首100条 IPC P50 993.424ms；首12张 246.733ms；12张热 IPC 10.230ms；不含 Renderer 解码 | **已验收 CURRENT** | [原始记录](performance-evidence/gallery-agent-ipc-real-100k/ci-run-37932063846.json) |
| P005 | 图库·重复折叠 | 100k 逻辑、浏览器实测重复折叠开关 ON/OFF；首屏真实 JPEG、离屏主要元数据，n=3 | 暖态 ON 中位约2,949.35ms，OFF约1,623.85ms；6次 ON 中3次超过3,000ms诊断阈值 | **已测基线／局部红项，未保留生产优化** | [原始记录](performance-evidence/gallery-web-real-fold-100k/ci-run-37944712440.json) |
| P006 | 文件管理器·JPEG | 100k 不同、可解码 80×64 物理 JPEG+CAS；共享 Web Grid/Details × 5 视口 × n=3 | Grid 首6张 P50 457.736ms；Details 421.246ms；最多挂载121/40项、HTTP并发6 | **已验收 CURRENT，#1402 已合入** | [原始记录](performance-evidence/file-explorer-real-physical-jpeg-100k/ci-run-38136433428.json) · [PR/CI](https://github.com/lazyxu/xdrive/pull/1402) |
| P007 | 文件管理器·MP4 | 100k SHA 不同 MP4 物理容器，复用96×64 H264编码流；每组抽样六个，Chromium n=3 | 冷海报 P50 18.5ms；热缓存 2.8ms；每轮实际297,000,000 B；并非100k独立编码视频或挂载 Grid | **已验收 CURRENT，#1432 已合入** | [原始记录](performance-evidence/file-explorer-physical-h264-100k/ci-run-38150707819.json) · [PR/CI](https://github.com/lazyxu/xdrive/pull/1432) |
| P008 | 文件管理器·H264 预览 | 100k 视频元数据，只有6个物理 H264 原片；真实 Chromium 取帧并PUT/GET缓存，n=3 | 冷取帧 P50 17.7ms、热缩略图 3.6ms；热原片 Store.Open=0 | **已验收 CURRENT；不等于100k物理视频** | [原始记录](performance-evidence/file-explorer-real-h264-100k/ci-run-38022798765.json) |
| P009 | 文件管理器·虚拟窗口 | 100k 图片／视频／LIVP 逻辑元素，Web+Desktop Grid/Details 24次结构测试，使用合成缩略图 | Grid≤110 DOM、Details≤37、保留元数据≤1,200、缩略图 in-flight≤6；不是真实媒体解码 | **已验收结构预算／非端到端性能** | [原始记录](performance-evidence/file-explorer-100k-grid-details/) |
| P010 | 传输·Web 4GiB | 真实 Chromium XDriveApi→Gin/PG17/物理 CAS→OPFS，n=3；512×8MiB PUT+1 GET，稀疏零源 | 上传 P50 57.861s、下载 13.188s，原每方向360s和进程256MiB预算内；本地loopback非WAN | **已验收 CURRENT，#1396 已合入** | [原始记录](performance-evidence/real-web-desktop-cas-4gib/ci-run-38131060742.json) · [PR/CI](https://github.com/lazyxu/xdrive/pull/1396) |
| P011 | 传输·Desktop 4GiB | 真实 Electron→Main→Go Agent→Gin/PG17/CAS，本地下载完整SHA验收，n=3；稀疏零源 | 上传 P50 52.814s、下载 21.915s，原360s/256MiB预算通过；非不可压缩/WAN负载 | **已验收 CURRENT，#1396 已合入** | [原始记录](performance-evidence/real-web-desktop-cas-4gib/ci-run-38131060742.json) · [PR/CI](https://github.com/lazyxu/xdrive/pull/1396) |
| P012 | 传输·Web 1GiB | 真实 Web XDriveApi→Gin/PG17/CAS→OPFS，n=3 | 上传 P50 12,827.100ms、下载 4,712.300ms；不等于Mock传输 | **已验收 CURRENT** | [原始记录](performance-evidence/real-web-cas-1gib/ci-run-38109007223.json) |
| P013 | 传输·Desktop 1GiB | 真实 Electron Renderer/Main/Agent→Gin/PG/CAS，n=3 | 上传 P50 9,937.462ms、下载 3,457.113ms；包含Agent IPC | **已验收 CURRENT** | [原始记录](performance-evidence/real-desktop-cas-1gib/ci-run-38119810860.json) |
| P014 | 传输·Server 1GiB | Go Client→真实 Gin/PG/CAS；128×8MiB PUT+1 GET，各1GiB，n=3 | 原始三组上传 P50 9,530.993ms、下载 855.663ms；底层Go测试通过，早期汇总任务曾因输出路径失败 | **已测真实数据；区分测试通过与汇总 CI 失败** | [原始记录](performance-evidence/real-server-cas-1gib/ci-run-38106801137.json) |
| P015 | 取消·FileExplorer Web | 真实挂载 Grid/Details 快速滚动，100k 元数据，首屏少量原JPEG；n=3×2视图×6流 | 36/36 真正 HTTP→Gin Context.Done；最慢 Go 通知51.153ms；+160ms 旧Handler与多余字节均0 | **已验收 CURRENT，#1298 已合入** | [原始记录](performance-evidence/file-explorer-real-web-scroll-100k/ci-run-38034119067.json) · [PR/CI](https://github.com/lazyxu/xdrive/pull/1298) |
| P016 | 取消·Gallery Web | 真实 100k 虚拟 Grid DOM 滚动，首视口6个流、n=3 | 18/18 真正 Go Context.Done，+160ms 无旧Handler/废弃响应字节；非直接调用测试用Abort替代滚动 | **已验收 CURRENT** | [原始记录](performance-evidence/gallery-real-web-scroll-cancel-100k/ci-run-38031855529.json) |
| P017 | 取消·Gallery Desktop | 真实 Electron 网格滚动／切换应用／毁掉窗口，100k逻辑、每模式6流×n=3 | 54/54 正确取消；Go 最慢通知61.792ms；+160ms 遗留Handler及字节0 | **已验收 CURRENT，#1352 已合入** | [原始记录](performance-evidence/gallery-desktop-real-go-cancel-100k/ci-run-38104550922.json) · [PR/CI](https://github.com/lazyxu/xdrive/pull/1352) |
| P018 | 取消·H264预览 | 100k视频元数据、6个物理H264；实际浏览器Range+窗口关闭，n=3×2×3流 | 18/18 真正取消；+160ms 无遗留Handler、延迟PUT或后续字节；不是100k视频同时解码 | **已验收 CURRENT** | [原始记录](performance-evidence/file-explorer-h264-cancel-100k/ci-run-38025011662.json) |
| P019 | 取消·Agent IPC | 100k逻辑、115k Node；Agent/Go Server真实请求按视口/发送者销毁停止，n=3×2×6 | 36/36 HTTP Context.Done，+160ms 旧Handler和浪费字节0；某源CI最慢Go通知3.827ms；无真实Electron UI | **已验收 CURRENT** | [原始记录](performance-evidence/gallery-agent-go-context-cancel-100k/ci-run-38072457312.json) |
| P020 | 取消·变更流SQL | 100k变更，6个真实 PostgreSQL 锁等待+6个带身份HTTP客户；交替n=3对照 | BEFORE +160ms 仍有6个SQL等待/Handler；AFTER 0个，6/6 ctx取消；`WithContext`传播的资源释放修复已合入 | **已验收生产修复，#1401 已合入** | [原始记录](performance-evidence/node-changes-request-cancel-100k/paired-ci-38135907200.json) · [PR/CI](https://github.com/lazyxu/xdrive/pull/1401) |
| P021 | 同步·100k变更元数据 | 100k Node change（75k更新／25k墓碑），Go Client拉100×1000页，n=3；无实际同步文件字节 | 完整读取 P50 5,307.938ms，24,326,661B，抽样RSS增长上限11.48MiB；≤60s/256MiB预算通过 | **已验收 CURRENT，#1407 已合入** | [原始记录](performance-evidence/sync-client-changefeed-100k/ci-run-38138083618.json) · [PR/CI](https://github.com/lazyxu/xdrive/pull/1407) |
| P022 | 图库·持久100k任务 | 70k照片+15k视频+15k Live（115k元数据Node），真实收藏入队及原100项Worker，n=3 | 100k入队 P50 4,662ms **超3,000ms预算**；Worker P50 40,113ms 在60s内；不含原片传输 | **已测红项，未优化** | [原始记录](performance-evidence/gallery-selection-mixed-live-100k/ci-run-38141053653.json) · [PR/CI](https://github.com/lazyxu/xdrive/pull/1413) |
| P023 | 图库·全图片100k Worker | 全JPEG元数据的旧100k任务，非70/15/15；n=3，PG计划波动明显 | 入队 P50 3,678ms（红）；Worker P50 103,322ms（红，预算60s）；不能与混合数据集直接A/B | **已测红项／须隔离PG统计** | [原始记录](performance-evidence/gallery-enqueue-current-100k/ci-run-38126280566.json) |
| P024 | 图库·JSONB试验 | 100k混合任务，matched n=3，尝试 JSONB 行集代替1000次GORM批INSERT | 100k入队原始 P50 2,830ms→候选3,292ms，慢16.3%，且超过3s门槛；已回退 | **Rejected（证据保留），#1420 已合入文档** | [原始记录](performance-evidence/gallery-jsonb-enqueue-100k/ci-run-38144394490.json) · [PR/CI](https://github.com/lazyxu/xdrive/pull/1420) |
| P025 | 图库·COPY试验 | 100k任务，原GORM→pgx COPY，matched n=3 | P50 4,554→3,101ms，虽相对改善31.9%，但仍高于绝对3,000ms；已回退 | **Rejected（绝对预算未过）** | [原始记录](performance-evidence/gallery-pgx-copy-100k/ci-run-38127281720.json) |
| P026 | 图库·批量INSERT替代 | 历史 100k VALUES/GORM 1000、2000及 UNNEST 试验，基线/平台可能不同 | 多次达到部分相对提升但未同时满足绝对3s/Worker/资源门槛；不同实验不得合并成一种优化 | **Rejected，禁止无新假设重复试验** | [原始记录](performance-evidence/gallery-selection-enqueue-100k/ci-run-38036725965-rejected-paired.json) |
| P027 | 删除·100k队列操作 | 100k子文件的真实 FileOperation DELETE（元数据/Share/Undo），PG绑定数限制前后对照 | BEFORE 因65,535参数限制失败，AFTER 成功 P50 1,523.744ms；不是失败→成功的速度百分比 | **已修复／成功规模验收，#1213** | [原始记录](performance-evidence/file-operation-queued-delete-100k/ci-run-37982836545-paired.json) |
| P028 | 删除·100k永久回收站 | 100k File+FileVersion，真实登录HTTP DELETE+PG，matched n=3 | BEFORE HTTP500参数溢出；AFTER HTTP204成功 P50 3,831.826ms，事务/Share/audit正确；不能计算性能提速百分比 | **已修复／成功规模验收** | [原始记录](performance-evidence/trash-permanent-100k/paired-ci-38018552161.json) |
| P029 | 恢复·100k回收站 | 100k Node+File 元数据、真实授权HTTP恢复，n=3；未写100k真实CAS字节 | 100k恢复 P50 1,077.999ms，预算中位≤5s、单次≤8s，全三组通过 | **已验收 CURRENT** | [原始记录](performance-evidence/trash-restore-real-http-100k/ci-run-38013902607.json) |
| P030 | 图库·Desktop IPC加载进度 | 100k Gallery 真实 Renderer→Preload→Main→Agent JPEG进度；不是吞吐优化 | 较早提交曾记录事件；提交`b6e5b2...`末次CI收到0B初始事件、缺最终累计字节；不能称已成功 | **Blocked／Draft #1185，保留独立调查** | [原始记录](performance-evidence/gallery-media-progress-100k/) · [PR/CI](https://github.com/lazyxu/xdrive/pull/1185) |
| P031 | 传输·合成大文件 | 历史 Web 1/4GiB Mock HTTP / OPFS 控制器、传输布局/内存分配测试 | 属于合成Mock，不具备真实Gin/PG/CAS效力；不得与P010/P011实际4GiB作A/B | **历史结构／实验诊断** | [原始记录](performance-evidence/web-large-transfer/) |
| P032 | 图库·Web 100k混合物理多视口解码 | M001-a：100k逻辑/115k不同SHA真实CAS，真实Web Gallery Grid 0/25/50/75/95%滚动，n=3×5次，逐位置≥6个新可见 blob JPEG/Live still decode+两帧；H264/Live motion/RAW/HEVC/Timeline/Desktop不在本轮 | 五视口P50再取n3中位 **2,503.604ms**，首屏中位1,807.785ms，单位置最慢2,621.253ms；三轮新可见不同ID 40/60/47，挂载≤99，HTTP并发6，Go/Renderer内存增长峰值372,736B/137,146,368B；原冻结20s/256MiB等门槛全部通过 | **Accepted CURRENT / M001-a；生产不变，AFTER=N/A。首两次驱动运行无效保留，最终 #1450 原始+证据修订CI成功并已合入** | [原始n3样本](performance-evidence/gallery-web-physical-mixed-100k-viewports/ci-run-38161508404.json) · [专项CI](https://github.com/lazyxu/xdrive/actions/runs/38161508404) · [规范](gallery-performance.md) |
| P033 | 图库·真实Web H264视频海报 | M001-b：100k PhotoAssets/115k真实SHA不同CAS；生产Web Gallery Grid真实五视口×n3，每处≥2个新视频Tile的冷HTTP404→签名Preview→浏览器H264 canvas JPEG→CAS PUT HTTP204→可见Image.decode+两帧，回首屏warm HTTP200；30k容器共用单一H264编码流，不代表不同视频或实况动图 | **五视口P50再取n3中位 2227.292ms，原始测量单视口最慢 2294.841ms，最终证据头P50 2665.891ms（独立CI波动、非代码提速）；视频不同ID 13/14/15，真实POSTER PUT 20/18/20，热缓存回访 4/3/5；最大挂载99，Go/Renderer RSS最大增长 6365184B/165851136B，原≤25s／≤256MiB门槛全部通过** | **Merged / Accepted CURRENT；精确最终头专项CI #38190978656 + 完整CI #38190978855（final-gate）成功，#1462 已合入 35d717bb；生产无改动，AFTER=N/A** | [原始n3证据](performance-evidence/gallery-web-real-h264-posters-100k/ci-run-38190167889.json) · [专项CI](https://github.com/lazyxu/xdrive/actions/runs/38190167889) · [规范](gallery-performance.md) |
| P034 | 媒体缓存·10万物理 JPEG 缩略图垃圾清理 | M003-cache：真实本地 FS 100k 不同缓存键与物理文件（63.5MB），2,500 PostgreSQL 引用保护、2,500 年龄未到、95,000 个过期未引用缓存实际 unlink（60.325MB），3 个原始 CAS 哨兵保留；三个独立 Postgres17 / Linux 原生进程，真实 JPEG 6 个抽样解码，非原始 CAS 文件永久删除 | **Dry P50 560.678ms，实际95k unlink P50 80,061.510ms，第二次幂等 P50 45.169ms；Go 后种子 RSS 增长最大 107,757,568B，全部原定 30s/180s/30s、256MiB、精确保护与字节门槛通过** | **Merged #1470 / Accepted CURRENT；产品不改、AFTER=N/A；最终证据头 n3 95k unlink P50 53,008.469ms，Dry 410.559ms，幂等 33.544ms；原始 80,061.510ms 与最终独立 runner 结果不是优化 A/B；早期三次无效夹具记录保留；最终专项和完整CI通过** | [原始3轮JSON](performance-evidence/media-thumbnail-gc-physical-100k/ci-run-38195255676.json) · [专项CI](https://github.com/lazyxu/xdrive/actions/runs/38195255676) · [最终原始 n3](performance-evidence/media-thumbnail-gc-physical-100k/ci-run-38195947166.json) · [准确头专项CI](https://github.com/lazyxu/xdrive/actions/runs/38195947166) · [完整CI](https://github.com/lazyxu/xdrive/actions/runs/38195947285) · [PR #1470](https://github.com/lazyxu/xdrive/pull/1470) · [范围与限制](gallery-performance.md) |

## 下一轮真正未覆盖的 P0/P1 范围（不要重复做已有同负载）

| 编号 | 未覆盖的工作负载 | 与历史工作负载的关键区别 / 首测约束 |
| --- | --- | --- |
| M001 | 真实 Web/Mobile Web 与 Desktop Gallery 100k **混合物理** Grid/Timeline 中各5+视口缩略图解码：真实 H264、Live still+motion、RAW/HEVC/LIVP，而非只有首屏Gin/CAS或相同bitstream容器 | P032=M001-a已通过并合入；P033=M001-b正测试真实Web Grid五视口H264帧捕获+海报持久化；不同视频编码/Live motion播放、RAW/HEVC、Timeline、Desktop Agent和Mobile Web仍未覆盖，须继续分阶段测试 |
| M002 | Desktop FileExplorer 100k 原片类型混合（图片/视频/Live/RAW）真实 Main→Agent→Go + Grid/Details 真滚动 | P006仅真实Web JPEG视口，P007仅6份视频取帧；不能视为等效覆盖 |
| M003 | 100k 完整持久同步/Push/Pull/本机源实际字节与 CAS、失败恢复，及100k真实物理删除/GC/Undo | P034 已通过10万物理派生缩略图缓存清理，属于派生缓存而非原片CAS；P021仅变更流元数据，P027–P029主要PG元数据，原片CAS实际删除/GC、文件字节同步Push/Pull仍未测 |
| M004 | Web/Desktop 4GiB **不可压缩内容、WAN/限速/断线恢复/并发** 场景与真实传输任务用户主动取消 | P010/P011的loopback/稀疏零源不覆盖WAN及持久任务控制，取消不可由窗口unmount驱动 |
| M005 | 虚拟范围离开时真实全链路请求取消+共享缓存消费者持有的派生计算停止；对快速滚动/重复窗口切换测试0旧Handler/0废弃字节 | P015–P020覆盖指定路径/可见流但不是所有缩略图、预览、数据库或CPU密集共享计算；不得误取消Task Center |
| M006 | 图库100k持久任务入队新**因果明确且未尝试过**的优化策略：独立PG语句准备、往返/提交及数据索引归因 | P022仍有3s红项，P024–P026的JSONB/COPY/GORM批/UNNEST候选已被否决；不得重复相同方案放宽门槛 |
| M007 | Desktop #1185 真实最终累计字节IPC事件交付/清理链路 | 与性能主线请求级取消分开；只有最新提交的真实Electron n3和完整CI通过才可收尾 |

### 归档前置核对清单（PR 审查必核）

- 要说明本次工作对应哪个 `Pxxx` 或 `Mxxx`；如新覆盖层才分配新 ID，并对比历史数据真实差别（并非只变文件名/新样本）。
- 原始数据必须能回溯到源码 SHA、GitHub Actions run/job 与真实测试脚本；原始证据和本表结果均须在相同单工作提交中修订。无结果的内容写 `Benchmarking`，不要伪造 AFTER。
- 不因增加原始物理媒体建库/种子生成时间就声称用户首屏变慢，也不把缓存冷热、不同 runner、假HTTP、窗口销毁、人造响应延迟当可比较的生产优化 A/B。
- 覆盖 Web/Desktop/Mobile Web 时标明是否实际挂载共享虚拟列表，是否按 API 返回分页、DOM节点、图像解码、video poster/Live Motion 和 Go ctx.Done 实测；断言 stale result 被忽略不算服务器请求真的取消。
- **有效最新头 CI** 和合入清理是独立状态；若 CI 中存在测试夹具错误、Postgres磁盘/内存限制或编译失败，记录为 `Invalid harness` 后仅修正夹具并复测，不对生产性能下结论。

## 历史原始证据目录完整索引（70 个，自动按实际 GitHub 目录清点）

下面是现存全部原始记录目录，仅表示**曾有证据/实验产物**。其中包含 **Accepted、Rejected、Invalid harness、Mock、诊断样本及仍需复验项**。不在上方“已执行场景”表中给出明确状态的，必须打开其原始报告及对应子系统文档判定，**不可默认为通过**。新增任一目录时要同步修改本索引；随附的轻量测试会检查有没有漏记目录。

### 图库/图库Worker/媒体请求（40）

[`gallery-agent-go-context-cancel-100k`](performance-evidence/gallery-agent-go-context-cancel-100k/) · [`gallery-agent-ipc-real-100k`](performance-evidence/gallery-agent-ipc-real-100k/) · [`gallery-cleanup-extreme-100k`](performance-evidence/gallery-cleanup-extreme-100k/) · [`gallery-cover-http-cancel`](performance-evidence/gallery-cover-http-cancel/) · [`gallery-desktop-real-first-paint-100k`](performance-evidence/gallery-desktop-real-first-paint-100k/) · [`gallery-desktop-real-go-cancel-100k`](performance-evidence/gallery-desktop-real-go-cancel-100k/) · [`gallery-desktop-signed-video-proxy`](performance-evidence/gallery-desktop-signed-video-proxy/) · [`gallery-enqueue-current-100k`](performance-evidence/gallery-enqueue-current-100k/) · [`gallery-entry-100k`](performance-evidence/gallery-entry-100k/) · [`gallery-fold-10k-100k`](performance-evidence/gallery-fold-10k-100k/) · [`gallery-fold-member-projection-100k`](performance-evidence/gallery-fold-member-projection-100k/) · [`gallery-fold-stage-profile-100k`](performance-evidence/gallery-fold-stage-profile-100k/) · [`gallery-go-context-cancel-100k`](performance-evidence/gallery-go-context-cancel-100k/) · [`gallery-hover-original-video`](performance-evidence/gallery-hover-original-video/) · [`gallery-hover-real-codecs-4k`](performance-evidence/gallery-hover-real-codecs-4k/) · [`gallery-hover-short-preview-4k`](performance-evidence/gallery-hover-short-preview-4k/) · [`gallery-jsonb-enqueue-100k`](performance-evidence/gallery-jsonb-enqueue-100k/) · [`gallery-media-progress-100k`](performance-evidence/gallery-media-progress-100k/) · [`gallery-pgx-copy-100k`](performance-evidence/gallery-pgx-copy-100k/) · [`gallery-physical-mixed-100k`](performance-evidence/gallery-physical-mixed-100k/) · [`gallery-range-cancel-100k`](performance-evidence/gallery-range-cancel-100k/) · [`gallery-real-web-scroll-cancel-100k`](performance-evidence/gallery-real-web-scroll-cancel-100k/) · [`gallery-selection-array-insert-100k`](performance-evidence/gallery-selection-array-insert-100k/) · [`gallery-selection-enqueue-100k`](performance-evidence/gallery-selection-enqueue-100k/) · [`gallery-selection-enqueue-batch-g07`](performance-evidence/gallery-selection-enqueue-batch-g07/) · [`gallery-selection-mixed-live-100k`](performance-evidence/gallery-selection-mixed-live-100k/) · [`gallery-selection-worker-sql-100k`](performance-evidence/gallery-selection-worker-sql-100k/) · [`gallery-thumbnail-http-cancel-100k`](performance-evidence/gallery-thumbnail-http-cancel-100k/) · [`gallery-thumbnail-http-revision`](performance-evidence/gallery-thumbnail-http-revision/) · [`gallery-thumbnail-revision`](performance-evidence/gallery-thumbnail-revision/) · [`gallery-thumbnail-server-revision`](performance-evidence/gallery-thumbnail-server-revision/) · [`gallery-video-poster-cancel`](performance-evidence/gallery-video-poster-cancel/) · [`gallery-video-signed-range-server`](performance-evidence/gallery-video-signed-range-server/) · [`gallery-web-real-cold-100k`](performance-evidence/gallery-web-real-cold-100k/) · [`gallery-web-real-fold-100k`](performance-evidence/gallery-web-real-fold-100k/) · [`gallery-web-real-h264-posters-100k`](performance-evidence/gallery-web-real-h264-posters-100k/) · [`gallery-worker-fixture-analyze-100k`](performance-evidence/gallery-worker-fixture-analyze-100k/) · [`gallery-worker-query-plan-100k`](performance-evidence/gallery-worker-query-plan-100k/) · [`gallery-worker-select-100k`](performance-evidence/gallery-worker-select-100k/) · [`gallery-web-physical-mixed-100k-viewports`](performance-evidence/gallery-web-physical-mixed-100k-viewports/)

### FileExplorer / 视口 / 真实媒体（8）

[`file-explorer-100k-grid-details`](performance-evidence/file-explorer-100k-grid-details/) · [`file-explorer-go-context-cancel-100k`](performance-evidence/file-explorer-go-context-cancel-100k/) · [`file-explorer-h264-cancel-100k`](performance-evidence/file-explorer-h264-cancel-100k/) · [`file-explorer-physical-h264-100k`](performance-evidence/file-explorer-physical-h264-100k/) · [`file-explorer-real-h264-100k`](performance-evidence/file-explorer-real-h264-100k/) · [`file-explorer-real-physical-jpeg-100k`](performance-evidence/file-explorer-real-physical-jpeg-100k/) · [`file-explorer-real-web-scroll-100k`](performance-evidence/file-explorer-real-web-scroll-100k/) · [`file-explorer-video-poster-100k`](performance-evidence/file-explorer-video-poster-100k/)

### 删除、恢复及 FileOperation（5）

[`file-operation-delete-subtree-100k`](performance-evidence/file-operation-delete-subtree-100k/) · [`file-operation-queued-delete-100k`](performance-evidence/file-operation-queued-delete-100k/) · [`trash-permanent-100k`](performance-evidence/trash-permanent-100k/) · [`trash-range-go-context-cancel-100k`](performance-evidence/trash-range-go-context-cancel-100k/) · [`trash-restore-real-http-100k`](performance-evidence/trash-restore-real-http-100k/)

### 上传下载 / 大文件（5）

[`real-desktop-cas-1gib`](performance-evidence/real-desktop-cas-1gib/) · [`real-server-cas-1gib`](performance-evidence/real-server-cas-1gib/) · [`real-web-cas-1gib`](performance-evidence/real-web-cas-1gib/) · [`real-web-desktop-cas-4gib`](performance-evidence/real-web-desktop-cas-4gib/) · [`web-large-transfer`](performance-evidence/web-large-transfer/)

### 同步变更流 / 取消（4）

[`node-changes-request-cancel-100k`](performance-evidence/node-changes-request-cancel-100k/) · [`sync-client-changefeed-100k`](performance-evidence/sync-client-changefeed-100k/) · [`viewport-cancel`](performance-evidence/viewport-cancel/) · [`viewport-cancel-transport`](performance-evidence/viewport-cancel-transport/)

### 其他媒体组件与PhotoAsset诊断（8）

[`media-thumbnail-gc-physical-100k`](performance-evidence/media-thumbnail-gc-physical-100k/) · [`media-shared-progress`](performance-evidence/media-shared-progress/) · [`photoasset-owner-alloc-profile-100k`](performance-evidence/photoasset-owner-alloc-profile-100k/) · [`photoasset-owner-node-preload-100k`](performance-evidence/photoasset-owner-node-preload-100k/) · [`photoasset-owner-reconcile-100k`](performance-evidence/photoasset-owner-reconcile-100k/) · [`photoasset-owner-stale-prune-100k`](performance-evidence/photoasset-owner-stale-prune-100k/) · [`photoasset-owner-write-100k`](performance-evidence/photoasset-owner-write-100k/) · [`preview-image-thumbnail-abort`](performance-evidence/preview-image-thumbnail-abort/)
## 版本与维护

- 本次初建已清点并链接到 **70 个**实际存在的 `docs/performance-evidence/` 子目录；本表列出 **34 个**已运行或已发现失败/阻塞的命名工作负载和 **7 个**明确待补范围。没有凭空将日志出现或文件夹存在当作性能通过。
- `#1439` 100k混合物理媒体基准已合入，性能未超预算，记录为复用/不改生产代码；`#1185` 的 Desktop IPC 完整字节进度末次验收失败，仍为 Draft，不属于通过的取消/吞吐案例。
- 以后每个性能 PR 更新同一登记簿，不为每次聊天创建平行索引；完整的失败样本、被拒绝实验和准确头CI仍保留在子系统文档与原始证据目录。
