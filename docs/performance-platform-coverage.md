# xDrive 跨平台性能覆盖矩阵

> 2026-10-12 · **运行平台分开验收，测试负载可以共享。** **数据量相同**不代表平台、缓存、安装模式或真实性能相同。 本文是所有性能专项的跨端入口；原始测试结果与成功/失败状态以 [性能测试登记簿](performance-test-registry.md) 和各 [FileExplorer](file-explorer-performance.md)、[Gallery](gallery-performance.md)、[同步](sync-performance.md) 子系统规范为准。新增有界样本必须同时修订本矩阵、登记簿、子系统规范与原始 JSON。这里列出的既有 CI 仅为各次**历史来源源码**测量，不是当前 master 或用户设备的新跑分。

## 平台边界、状态术语与验收结论

| 必须覆盖的运行形态 | 定义与证据要求 | 既有可复用性能来源 | 真实缺口 |
| --- | --- | --- | --- |
| **Native Desktop** | 生产 Electron Renderer→Preload→Main→Go Agent IPC→Gin/PG/CAS；Windows 实机另计 | P003 Gallery首屏、P035 FileExplorer 100k不同JPEG、P037 54/54取消、P011 4GiB物理CAS、P038 100k混合JPEG/H264/Live原生Linux/Xvfb n3、最终准确头专项及完整CI均成功，**#1577已合入** | 真实 Windows 性能；RAW/HEVC/LIVP和Live动态播放；不可压缩大文件/弱网/断点续传及物理文件同步 |
| **Wide Web** | 生产 Chromium 页面，≥900 CSS px，真实共享API/虚拟Grid/Details/Timeline + Go请求/解码/字节 | P002首屏、P006物理100k JPEG Files、P032物理100k Gallery JPEG/Live-still多视口、P033真实H264海报、P010稀疏4GiB、P015/P016真实取消 | 真实多编解码器、100k原片删除同步、不可压缩传输/弱网和跨标签共享消费者取消 |
| **Mobile Web** | 生产 Web，在窄屏动态视口真实 Chromium/Touch；CSS 390px 不等于真实 iOS/Android | P036 390px真实100k/115k物理Gallery JPEG/Live-still五视口通过；共享虚拟列表结构/移动 Files 功能测试 | P039 390px共享Web Files **100k不同物理JPEG** Grid/Details五视口×n3 原版已测且预算内通过：P50 Grid/Details 256.685/209.005ms；30/30视口、最慢296.193ms、DOM≤33、HTTP并发6/错误0、Renderer与Go RSS增长≤58,810,368/286,720B（预算每视口≤20s、RSS≤256MiB）。原始准确源码专项/完整CI已绿；#1590证据修订头仍须验收。真实移动设备、完整Mobile App Frame、混合H264/Live和Go取消未测 |
| **Desktop installed PWA** | 桌面 Chrome/Edge OS **实际安装** 后的 standalone 窗口，Service Worker/更新/多窗口；单独记录安装与来源 | PWA S2B1/S2B3 属于 Web Chrome 安装壳/认证功能测试，**不是已安装100k性能基线**；PWA S4C2 真实1GiB OPFS回读是浏览器传输完整性，非独立安装态性能 | Installed PWA 100k Gallery/Files虚拟化、Go取消、4GiB真实字节任务及跨窗口恢复均未测 |
| **Android installed PWA** | 实际 Android 系统/Chrome 安装到主屏幕后的独立窗口和触控、锁屏/进程淘汰；记录型号、Android/Chrome版本 | Chrome 390px mobile *emulation* 与 S2B 功能浏览器检查不等于 Android installed PWA | 实机100k Gallery/Files、热/冷缩略图、4GiB/剩余磁盘限制、断网与恢复、服务端取消/任务不误停：**Not measured** |
| **iOS installed PWA** | 实际 iPhone/iPad Safari「添加到主屏幕」，版本/磁盘/后台/时间窗独立记录，不保证锁屏后台执行 | P036 narrow Chromium不是Safari/PWA，现有iOS27布局契约也不是性能实测 | 实机100k图/视频/Live、OPFS大文件/下载完整性、后台恢复、导航取消/Go资源释放：**Not measured** |

**严禁合并状态：** `Accepted CURRENT`（原版预算内、无需优化）、`Measured RED`（真正超预算）、`Rejected`（同条件候选失败并回退）、`Invalid harness`（测量未成立）、`Blocked`、`Not measured`、`Merged`（准确头CI绿并合入）各自独立。测量平台、请求层/原片真实性与真实设备身份必须写清楚；不能以合同测试、CSS仿真、历史CI或截图作为所有端验收。

## 最小场景矩阵与证据去重

| P0 核心场景／样本形状 | Desktop | Wide Web | Mobile Web | Desktop installed PWA | Android installed PWA | iOS installed PWA |
| --- | --- | --- | --- | --- | --- | --- |
| Gallery **100k 逻辑／115k 物理 CAS**；真实图片/视频/Live仍帧、Grid、5个视口、首屏与冷热解码 | P003 首屏；P038 是**Files独立项**，不能称Gallery混合验收 | P032 JPEG/Live仍帧；P033 H264海报均已测 | P036 390px JPEG/Live仍帧已测；H264/Live动态未测 | Not measured | Not measured | Not measured |
| FileExplorer **100k混合原片** Grid/Details/缩略图，分页滚动与筛选 | P035 100k JPEG、P038 115k混合JPEG/H264/Live均已测且合入（P038 #1577） | P006 100k物理JPEG；P007 H264物理容器/抽样解码，不是挂载混合五视口 | P039 390px共享Web Files真实100k独立JPEG Grid/Details五视口×n3 **Accepted CURRENT**（原始准确源码专项CI #38275879504、完整CI #38275880243成功；#1590证据头待最终验收），生产不改；混合H264/Live、完整Mobile App Frame及真机仍未测 | Not measured | Not measured | Not measured |
| **Live motion 播放/RAW/HEVC/LIVP**真实格式解码、缩略图及独立不同编码 | 未覆盖，P038只测独立Files H264海报，Live pair不在同Tile播放 | 不完整；历史 H264复用同编码流 | 不完整 | Not measured | Not measured | Not measured |
| **4GiB 上传／下载**、物理 SHA/OPFS/Agent、慢网/断线/续传/取消 | P011 4GiB稀疏零源loopback已通过；不可压缩/WAN未测 | P010 4GiB稀疏零源loopback已通过；不可压缩/WAN未测 | 不可压缩4GiB/弱网/暂停恢复未测 | 不可压缩4GiB/安装态未测 | Not measured | Not measured |
| **100k同步与物理CAS删除/回收站/Undo**，真实字节读写/释放及持久任务 | P021仅Go 100k变更元数据，P027–029主要Server元数据，P034是派生缓存95k unlink，不是原片CAS | 同左；Web平台真实端到端未测 | 同左；真实端到端未测 | Not measured | Not measured | Not measured |
| **虚拟视口滚动/切App/窗口退出** → Go Context.Done、旧Handler数、废弃字节 | P037实际Files 54/54、72.082ms最慢；P017 Gallery 54/54 | P015实际Files 36/36；P016 Gallery 18/18 | Mobile实际 mounted UI→Go 的独立取消首测仍缺 | Not measured | Not measured | Not measured |

## 各平台同一测量合同

所有平台先在已有登记簿按**唯一工作负载身份**去重，仍缺时新建 ID；每条样本保存来源 master/工作 SHA、运行环境（Chrome/Electron/Safari、Linux/Windows/Android/iOS、设备型号）、CSS视口、缓存冷/热、网络吞吐/延迟/丢包、真实逻辑数/物理CAS哈希数、编码分布、n≥3原始时间及 P50/P95、请求数、响应/上传/下载字节、精确SHA/错误数、Go/Agent/Renderer CPU/RSS、DOM最大挂载、资源释放延时/废弃字节。**先测原版 CURRENT；有真实预算 RED 才定最小生产优化；同跑道 n≥3 交替 BEFORE/AFTER，超过噪声且无关键回退才保留。** 非同平台、不同缓存、不同runner或首屏与全量转换不可算速度百分比。

图库/Files：真实运行公共 VirtualGrid/Timeline/Details、先首屏再0/25/50/75/95%五个滚动视口、统计真实 Image.decode 或视频海报/播放首帧、LIVE still/motion、相册分页/search、上/下滑/切换页面窗口；**最多挂载 DOM/缩略图并发有界**，不可错误地声称同时解码100k原片。要分别做100k纯JPEG、100k独立H264容器（明确共用编码流）、100k混合PhotoAsset配对、以及实际 RAW/HEVC/LIVP 兼容负载；没有所需codec/真实样本时写 `Not measured`。

上传/下载/同步/删除：区分小文件10k/100k、多文件并发、1GiB和4GiB可压缩vs不可压缩、WAN限速/抖动/断线重试、CAS独立真实字节、OPFS磁盘额度、进度、任务持久状态与完成后SHA；停止/取消只通过 **用户明确的任务控制**。窗口离开或滚动只取消该视口消费的非持久HTTP Range/预览/缩略图，需真实上游 `AbortSignal → (Desktop Main/Agent IPC) → Gin Request.Context.Done`、0剩余旧Handler与无多余响应字节；绝不因为应用后台/卸载视图取消Server持久任务。iOS无法保证后台JavaScript/SW上传；可验收的仅是重进后Server任务查询/必要时原文件重选和续传，而非承诺锁屏运行。

## 下一轮执行顺序（按独立未覆盖维度，避免重复）

1. **已交付：P038。** 原版6个Electron/30视口 n3完整JSON、H264共用编码流边界、证据修订准确头专项+完整CI都已成功，[#1577](https://github.com/lazyxu/xdrive/pull/1577)已线性合入；生产不优化，AFTER=N/A。仅剩自动短期分支清理核查。
2. **P0：Mobile Web Files 100k P039 原版n3预算内已通过。** [#1590](https://github.com/lazyxu/xdrive/pull/1590)原始准确源码原生 [#38275879504](https://github.com/lazyxu/xdrive/actions/runs/38275879504) 与完整 [#38275880243](https://github.com/lazyxu/xdrive/actions/runs/38275880243) 成功（Grid/Details P50 256.685/209.005ms）；[完整原始JSON](performance-evidence/file-explorer-mobile-physical-jpeg-100k/ci-run-38275879504.json)已保存，产品不改。390px共享组件不等于完整Mobile App Frame、真实手机或安装PWA。此PR证据修订的准确源码CI待最终验收；之后补测移动浏览器Go Context.Done及混合真实H264/Live物理媒体。
3. **P0：PWA独立安装态。** 先做真实Service Worker可控的桌面Chrome/Android Chrome安装流程及100k场景（若仅 `--app` 仿真必须标 Browser-emulated，不能标已安装）；然后实际Android/iOS独立设备采集同负载的 Gallery/Files/PWA任务生命周期与后台切换证据。保留iOS Safari平台硬限制。
4. **P0：Web/Desktop/Mobile/PWA大文件与100k同步/删除。** 复用P010/P011真实性能通道，优先测**不可压缩**真实CAS 4GiB、网络限速/中断/用户取消；之后测100k物理字节Push/Pull、原片CAS删除/回收站/Undo。已经验收的稀疏零源loopback不重复当新成果。
5. **P1：真实RAW/HEVC/LIVP和多编码分布**、冷热缩略图/Live Motion播放器、Timeline复杂日期分组、跨应用共享消费者最后取消、极端内存/CPU与不同手机SoC。所有缺失均明确 `Not measured`，不以端功能等价推导跑分等价。

## 发布门槛

每一个标成跨端完成的性能场景必须有上述六种模式各自来源准确的实测或明确的、经批准的实际平台豁免及证据；不能把 PWA Safari/Chrome 显示模式模拟、Service Worker注册或Web UI共享当作移动安装态性能成功。CI代码合并、真实Linux Xvfb测量、真实Windows/macOS设备、Android Chrome PWA与iOS Safari PWA真机性能应分开报告。每个新的失败夹具与被否决试验保留到原始证据索引，防止重复调查与误报成功。
