# xDrive 跨平台性能覆盖矩阵

> 2026-10-12 · **运行平台分开验收，测试负载可以共享。** **数据量相同**不代表平台、缓存、安装模式或真实性能相同。 本文是所有性能专项的跨端入口；原始测试结果与成功/失败状态以 [性能测试登记簿](performance-test-registry.md) 和各 [FileExplorer](file-explorer-performance.md)、[Gallery](gallery-performance.md)、[同步](sync-performance.md) 子系统规范为准。新增有界样本必须同时修订本矩阵、登记簿、子系统规范与原始 JSON。这里列出的既有 CI 仅为各次**历史来源源码**测量，不是当前 master 或用户设备的新跑分。

## 2026-10-15 · 六平台直接对照与交付状态

**原版历史CI证据，不代表本次在合入后的master新跑分。** 每列为不同客户端或OS安装形态，不能横向算加速百分比；仅真机/真实OS已安装PWA可解除Not measured。

| 真实基准负载 | Native Desktop Electron+Agent | Wide Web Chromium | Mobile Web 390px Chromium | Desktop installed PWA | Android installed PWA | iOS installed PWA |
| --- | --- | --- | --- | --- | --- | --- |
| **100k逻辑/115k物理 JPEG H264 Live Files Grid/Details** | P038 #1577 Merged；n3 30/30，P50 **943.144/734.891ms** | P050 **#1709 Merged**；n3 30/30，P50 **663.716/485.783ms**；准确HEAD [native](https://github.com/lazyxu/xdrive/actions/runs/38748158459)/[full](https://github.com/lazyxu/xdrive/actions/runs/38748158841) 成功 | P049 **#1694 Merged**；n3 30/30，P50 **466.461/310.520ms** | **Not measured** | **Not measured** | **Not measured** |
| **100k逻辑 Gallery/Files虚拟视口取消到Go Context.Done** | Gallery P017 54/54；Files P037 54/54；已验收 | Gallery P016 18/18；Files P015 36/36；已验收 | Gallery P048 #1672 Merged，12/12，最慢32.757ms；Files P040 #1604 Merged，36/36，最慢21.979ms；旧Handler0、废弃字节0B | **Not measured** | **Not measured** | **Not measured** |
| **真实非稀疏高熵4GiB CAS上传/下载，完整SHA或OPFS校验** | P045 #1637 Merged；n3 P50 **55.087s/21.969s** | P044 #1631 Merged；n3 P50 **48.509s/18.417s** | **Not measured** | **Not measured** | **Not measured** | **Not measured** |
| **100k真实物理原片Push/Pull同步、GUI永久删/Undo、慢网和任务恢复** | **Not measured**（P047仅共享Go HTTP删除） | **Not measured**（P047仅共享Go HTTP删除） | **Not measured** | **Not measured** | **Not measured** | **Not measured** |

**下一优先级：** 100k真正物理CAS Push/Pull增量同步/GUI删除和明确任务取消；Mobile Web 4GiB高熵/弱网；Desktop真实OS安装PWA 100k与4GiB；Android与iOS实体设备安装态；Live motion实际播放和RAW/HEVC/LIVP。新有效测量要在同一工作提交同步登记簿、子系统规范、平台矩阵及源准确原始JSON。页面滚动/窗口切换仅取消无人消费的AbortSignal/IPC/Go Request.Context请求，绝不隐式取消用户主动提交的耐久上传/下载/同步/删除任务。

**合并核验：** P050单工作提交 3e969074... 准确HEAD双CI成功后，PR[#1709](https://github.com/lazyxu/xdrive/pull/1709)合入 master 3dcabd3c...，远端性能分支已清理。P030[#1185](https://github.com/lazyxu/xdrive/pull/1185)仍为Blocked Draft，保留诊断，不处理Race并发专题。

## 平台边界、状态术语与验收结论

| 必须覆盖的运行形态 | 定义与证据要求 | 既有可复用性能来源 | 真实缺口 |
| --- | --- | --- | --- |
| **Native Desktop** | 生产 Electron Renderer→Preload→Main→Go Agent IPC→Gin/PG/CAS；Windows 实机另计 | P003 Gallery首屏、P035 FileExplorer 100k不同JPEG、P037 54/54取消、P011 4GiB物理CAS、P038 100k混合JPEG/H264/Live原生Linux/Xvfb n3、最终准确头专项及完整CI均成功，**#1577已合入** | 真实 Windows 性能；RAW/HEVC/LIVP和Live动态播放；P043真实Desktop Renderer/Preload/Main→Go Agent IPC高熵1GiB已测原版CURRENT n3：128PUT+1GET、上传P50 18.376s、下载P50 6.040s、源CAS完整下载SHA三组一致、Go Agent/Server/Renderer内存达标；源码准确原生#38340678659成功、**证据头CI待复验**；P045 Desktop高熵4GiB Agent IPC与完整本地文件SHA原版有效native n3通过（上传/下载P50 55087.089/21968.577ms，Go Agent/Server/Renderer资源符合原预算；CI#38347489640成功，归档后证据HEAD CI仍需复验）；WAN、真实Windows、弱网/断点续传和物理文件同步仍缺 |
| **Wide Web** | 生产 Chromium 页面，≥900 CSS px，真实共享API/虚拟Grid/Details/Timeline + Go请求/解码/字节 | P002首屏、P006物理100k JPEG Files、P032物理100k Gallery JPEG/Live-still多视口、P033真实H264海报、P010稀疏4GiB、P015/P016真实取消 | 真实多编解码器、100k原片删除同步、P042 Web真正非稀疏高熵1GiB n3已经实测并在原预算内：上传P50 17,415.7ms、下载P50 2,922.9ms、三组真实SHA/CAS SHA一致且每组全量1GiB OPFS字节正确（原始源码准确原生#38338652389及最终证据头原生#38339314956/完整#38339315279均通过，#1619已合入）；首次TS2322和完整CI文档契约Invalid harness留存；P044 Web真实4GiB高熵CAS及完整OPFS字节原始准确CI #38342769834有效n3通过：上传/下载P50=48509.400/18417.300ms，完整每组4GiB OPFS字节校验及512PUT/1GET、CPU/RSS预算通过；首次静态契约Invalid harness #38342586136保留，归档后准确头CI待复验，真实WAN、弱网、跨标签共享消费者取消仍未测 |
| **Mobile Web** | 生产 Web，在窄屏动态视口真实 Chromium/Touch；CSS 390px 不等于真实 iOS/Android | P036 390px真实100k/115k物理Gallery JPEG/Live-still五视口通过；共享虚拟列表结构/移动 Files 功能测试 | P039 390px共享Web Files **100k不同物理JPEG** Grid/Details五视口×n3 原版已测且预算内通过：P50 Grid/Details 256.685/209.005ms；30/30视口、最慢296.193ms、DOM≤33、HTTP并发6/错误0、Renderer与Go RSS增长≤58,810,368/286,720B（预算每视口≤20s、RSS≤256MiB）。原始与最终证据头专项/完整CI均绿、#1590已合入。真实移动设备、完整Mobile App Frame、Live Motion尚未测；P041 390px H264真实视频海报首轮#38334355272 Invalid harness保留（名义首屏无视频），改为有界真实滚动后原始CI #38335130028 n3 **15/15**视频可见并完成真实signed/canvas/CAS PUT/热GET，P50 **2548.649ms**，最慢2830.670ms、DOM20、Go/Renderer增量≤704,512/106,270,720B、0错误；**P041/#1612最终准确证据头原生CI #38336247173+完整CI #38336247432双绿并已合入，原版不变；不等于Live Motion/设备PWA**；独立P040 390px真实mounted Web Files Grid/Details→Go Context.Done 首轮36/36成功、最慢21.979ms、+160ms旧Handler/废弃字节0，原始准确源码专项CI #38331711972已绿；**最终准确头原生CI #38332257823 +完整CI #38332258403均绿、#1604已合入**（仅16真实JPEG、100k逻辑文件；不等于设备PWA） |
| **Desktop installed PWA** | 桌面 Chrome/Edge OS **实际安装** 后的 standalone 窗口，Service Worker/更新/多窗口；单独记录安装与来源 | PWA S2B1/S2B3 属于 Web Chrome 安装壳/认证功能测试，**不是已安装100k性能基线**；PWA S4C2 真实1GiB OPFS回读是浏览器传输完整性，非独立安装态性能 | Installed PWA 100k Gallery/Files虚拟化、Go取消、4GiB真实字节任务及跨窗口恢复均未测 |
| **Android installed PWA** | 实际 Android 系统/Chrome 安装到主屏幕后的独立窗口和触控、锁屏/进程淘汰；记录型号、Android/Chrome版本 | Chrome 390px mobile *emulation* 与 S2B 功能浏览器检查不等于 Android installed PWA | 实机100k Gallery/Files、热/冷缩略图、4GiB/剩余磁盘限制、断网与恢复、服务端取消/任务不误停：**Not measured** |
| **iOS installed PWA** | 实际 iPhone/iPad Safari「添加到主屏幕」，版本/磁盘/后台/时间窗独立记录，不保证锁屏后台执行 | P036 narrow Chromium不是Safari/PWA，现有iOS27布局契约也不是性能实测 | 实机100k图/视频/Live、OPFS大文件/下载完整性、后台恢复、导航取消/Go资源释放：**Not measured** |

**独立设备验收边界：** Desktop安装PWA、Android安装PWA和iOS安装PWA必须各自来自真实OS安装流程及独立设备／运行实例；不得以普通Chrome宽度模拟、Electron Chromium、`--app`或一次Web基准替代手机硬件或安装态性能数据。

**严禁合并状态：** `Accepted CURRENT`（原版预算内、无需优化）、`Measured RED`（真正超预算）、`Rejected`（同条件候选失败并回退）、`Invalid harness`（测量未成立）、`Blocked`、`Not measured`、`Merged`（准确头CI绿并合入）各自独立。测量平台、请求层/原片真实性与真实设备身份必须写清楚；不能以合同测试、CSS仿真、历史CI或截图作为所有端验收。

## 最小场景矩阵与证据去重

| P0 核心场景／样本形状 | Desktop | Wide Web | Mobile Web | Desktop installed PWA | Android installed PWA | iOS installed PWA |
| --- | --- | --- | --- | --- | --- | --- |
| **P049 / M002-d** 100k逻辑/115k SHA不同真实JPEG、H264、Live物理CAS的 FileExplorer Grid/Details 五视口 | **P038 Merged**：真实Desktop Agent，Grid P50 943.144ms / Details 734.891ms；不是Web对照 | **P050 原版CURRENT Accepted n3**：1440×900真实宽屏共享Web FileExplorer，100k逻辑/115k不同SHA媒体，Grid P50 **663.716ms**，Details **485.783ms**，30/30可见解码位置通过，最慢727.933ms、非取消5xx0、并发6；不可与Mobile算AB提速 | **P049 Merged #1694 / 原版CURRENT Accepted**：390px Mobile Web (document375px) 30/30真实可见解码，Grid P50 466.461ms、Details 310.520ms，最慢764.867ms；精确HEAD专项#38737142631、完整#38737143285含final-gate双绿；生产不改，AFTER=N/A | **Not measured（需实际Chrome/Edge OS安装）** | **Not measured（需Android真机PWA安装）** | **Not measured（需iOS Safari主屏幕安装）** |
| **P050 / M002-e** Wide Web 独立100k逻辑/115k SHA不同原片 JPEG/H264/Live 网格与详细信息实际五视口 | P038为不同Desktop Agent路径，不代表Wide Web当前状态 | **Accepted CURRENT / BEFORE=CURRENT、AFTER=N/A**：独立[原始专项CI #38745263789](https://github.com/lazyxu/xdrive/actions/runs/38745263789) n3三组真实1440px Web Files，30/30解码；Grid五位置跨轮P50 **663.716ms**，Details **485.783ms**，最慢**727.933ms**，DOM峰值121，576真实thumbnail HTTP/472,389B，Go并发6、非取消5xx0，Go/Renderer RSS增长各≤256MiB；准确HEAD专项 #38748158459 和完整 #38748158841（含final-gate）成功，#1709已合入。1440×900实Web共享Files、各3独立PG17/Gin/CAS；Grid/Details各0/25/50/75/95%五位置，JPEG/Live still≥6、H264/Live motion海报≥2真实可见新ID；每位置≤20,000ms，DOM<1000，Go并发≤6，非取消5xx=0，Go/Renderer RSS增长各≤256MiB；结果已归档，AFTER/speedup N/A | **P049不同390px负载已验收**，不作为P050相同环境A/B | **Not measured** | **Not measured** | **Not measured** |
| Gallery **100k 逻辑／115k 物理 CAS**；真实图片/视频/Live仍帧、Grid、5个视口、首屏与冷热解码 | P003 首屏；P038 是**Files独立项**，不能称Gallery混合验收 | P032 JPEG/Live仍帧；P033 H264海报均已测 | P036 390px JPEG/Live仍帧已测；P041 390px真实H264 VideoPoster捕帧/PUT/热缓存 **Accepted CURRENT原始 n3（15/15、P50 2548.649ms），最终证据头CI待验收**，Live Motion未测；Live动态尚未测 | Not measured | Not measured | Not measured |
| FileExplorer **100k混合原片** Grid/Details/缩略图，分页滚动与筛选 | P035 100k JPEG、P038 115k混合JPEG/H264/Live均已测且合入（P038 #1577） | P006 100k物理JPEG；P007 H264物理容器/抽样解码，不是挂载混合五视口 | P039 390px共享Web Files真实100k独立JPEG Grid/Details五视口×n3 **Accepted CURRENT**（原始准确源码和最终证据头专项CI #38329778398、完整CI #38329778477成功、#1590已合入），生产不改；混合H264/Live、完整Mobile App Frame及真机仍未测 | Not measured | Not measured | Not measured |
| **Live motion 播放/RAW/HEVC/LIVP**真实格式解码、缩略图及独立不同编码 | 未覆盖，P038只测独立Files H264海报，Live pair不在同Tile播放 | 不完整；历史 H264复用同编码流 | 不完整 | Not measured | Not measured | Not measured |
| **4GiB 上传／下载**、物理 SHA/OPFS/Agent、慢网/断线/续传/取消 | P011 4GiB稀疏零源loopback已通过；P043 Desktop真实1GiB高熵 Agent IPC及完整下载SHA原版n3已通过（上传/下载P50 18.376/6.040s，准确头专项CI #38341363095与完整CI #38341363491及final-gate双绿，#1625已合入；非4GiB），P045 Desktop真实4GiB高熵原版有效n3通过（上传/下载P50 55087.089/21968.577ms，每组512PUT/1GET及完整本地SHA；源码CI#38347489640 success；证据HEAD及完整CI未通过前暂未合入），WAN仍未测 | P010 4GiB稀疏零源loopback已通过；P042 Web真实1GiB非稀疏高熵原版n3已验收（上传/下载P50 17.416/2.923s，真实CAS SHA+全OPFS字节正确，#1619最终证据头双CI已成功并合入），**不可冒充4GiB**；P044真实Web高熵4GiB n3已测原版通过（P50上传48509.400ms、下载18417.300ms，全量OPFS字节验证成功；原始专项#38342769834与完整#38342770009均绿，证据头复测尚缺）；首次Invalid harness保留；WAN仍未测 | 不可压缩4GiB/弱网/暂停恢复未测 | 不可压缩4GiB/安装态未测 | Not measured | Not measured |
| **100k同步与物理CAS删除/回收站/Undo**，真实字节读写/释放及持久任务 | P021仅Go 100k变更元数据，P027–029主要Server元数据，P034为派生缓存95k unlink；新P046是共享Go Server层100k不同物理原始CAS及95k已无引用对象的真实终结回收首次源码gofmt Invalid harness #38355620529及格式差异诊断#38355923753、原始准确CI #38356105800 的CURRENT n3有效（95k真实原片CAS unlink P50=120.494s、5k保留；逻辑内容删除97.28MB不代表磁盘block空间）；准确HEAD专项#38358150853和完整#38358151113双绿，#1645已合入，5k幸存对象全内容及Linux实测389,120,000B分配块回收/组，不等于Desktop UI完整永久删除或同步；P047真实Go Server HTTP原版 #38362078011：100k CAS物理源真实但DELETE 500/无任何unlink（PG advisory事务锁耗尽），不把失败1460.730ms当BEFORE时延；最小行锁保留/bulk release移除多余advisory的候选在同样真实100k源修复后专项#38363280432 + 完整#38363280974（final-gate）双绿，3/3 每组真实100k CAS unlink、保护原片完整、HTTP204且404/409正确；有效 AFTER P50=166.239s、最大Go RSS增长126,337,024B、冻结预算通过，初始n3+源码准确证据HEAD第二组n3全通过（#38365803201、全量CI #38365803657含final-gate），最终P50 155.241s、峰值Go RSS增长125,628,416B，#1652线性合入并清理分支；两轮差异非产品提速；与失败版无有效延迟加速百分比，非任何Desktop/Web/Mobile/安装PWA的GUI端到端验收 | 同左；Web平台真实端到端未测 | 同左；真实端到端未测 | Not measured | Not measured | Not measured |
| **虚拟视口滚动/切App/窗口退出** → Go Context.Done、旧Handler数、废弃字节 | P037实际Files 54/54、72.082ms最慢；P017 Gallery 54/54 | P015实际Files 36/36；P016 Gallery 18/18 | P040 390px共享Web Files Grid/Details 100k元数据+16物理JPEG，经实际mounted UI滚动的36/36 Go Context.Done最慢21.979ms、旧Handler0、废弃字节0 **Accepted CURRENT原始样本**（证据头CI待跑）；iOS/Android真机及安装PWA仍 Not measured | Not measured | Not measured | Not measured |

## 各平台同一测量合同

所有平台先在已有登记簿按**唯一工作负载身份**去重，仍缺时新建 ID；每条样本保存来源 master/工作 SHA、运行环境（Chrome/Electron/Safari、Linux/Windows/Android/iOS、设备型号）、CSS视口、缓存冷/热、网络吞吐/延迟/丢包、真实逻辑数/物理CAS哈希数、编码分布、n≥3原始时间及 P50/P95、请求数、响应/上传/下载字节、精确SHA/错误数、Go/Agent/Renderer CPU/RSS、DOM最大挂载、资源释放延时/废弃字节。**先测原版 CURRENT；有真实预算 RED 才定最小生产优化；同跑道 n≥3 交替 BEFORE/AFTER，超过噪声且无关键回退才保留。** 非同平台、不同缓存、不同runner或首屏与全量转换不可算速度百分比。

图库/Files：真实运行公共 VirtualGrid/Timeline/Details、先首屏再0/25/50/75/95%五个滚动视口、统计真实 Image.decode 或视频海报/播放首帧、LIVE still/motion、相册分页/search、上/下滑/切换页面窗口；**最多挂载 DOM/缩略图并发有界**，不可错误地声称同时解码100k原片。要分别做100k纯JPEG、100k独立H264容器（明确共用编码流）、100k混合PhotoAsset配对、以及实际 RAW/HEVC/LIVP 兼容负载；没有所需codec/真实样本时写 `Not measured`。

上传/下载/同步/删除：区分小文件10k/100k、多文件并发、1GiB和4GiB可压缩vs不可压缩、WAN限速/抖动/断线重试、CAS独立真实字节、OPFS磁盘额度、进度、任务持久状态与完成后SHA；停止/取消只通过 **用户明确的任务控制**。窗口离开或滚动只取消该视口消费的非持久HTTP Range/预览/缩略图，需真实上游 `AbortSignal → (Desktop Main/Agent IPC) → Gin Request.Context.Done`、0剩余旧Handler与无多余响应字节；绝不因为应用后台/卸载视图取消Server持久任务。iOS无法保证后台JavaScript/SW上传；可验收的仅是重进后Server任务查询/必要时原文件重选和续传，而非承诺锁屏运行。

## 下一轮执行顺序（按独立未覆盖维度，避免重复）

1. **已交付：P038。** 原版6个Electron/30视口 n3完整JSON、H264共用编码流边界、证据修订准确头专项+完整CI都已成功，[#1577](https://github.com/lazyxu/xdrive/pull/1577)已线性合入；生产不优化，AFTER=N/A。仅剩自动短期分支清理核查。
2. **P0：Mobile Web Files 100k P039 已通过并随#1590合入；P040 开始实际Go取消首测。** [#1590](https://github.com/lazyxu/xdrive/pull/1590)原始准确源码原生 [#38275879504](https://github.com/lazyxu/xdrive/actions/runs/38275879504) 与完整 [#38275880243](https://github.com/lazyxu/xdrive/actions/runs/38275880243) 成功（Grid/Details P50 256.685/209.005ms）；[完整原始JSON](performance-evidence/file-explorer-mobile-physical-jpeg-100k/ci-run-38275879504.json)已保存，产品不改。390px共享组件不等于完整Mobile App Frame、真实手机或安装PWA。最终证据头专项CI #38329778398 与完整CI #38329778477 双绿并已合入；新P040单独以窄屏 mounted Files Go Context.Done 为正确性和响应时延基准（36/36 Go Context.Done、21.979ms原始/21.736ms准确证据头，最终原生CI #38332257823 +完整CI #38332258403成功、#1604已合入）；现P041通过真实有界滚动保留25s预算的首个有效n3，15/15新海报成功、P50 2548.649ms，原始专项/完整CI双绿、证据修订头待复验；不是Live Motion或安装PWA。
3. **P0：Desktop不可压缩真实字节 + 4GiB/WAN后续。** P042 Web真实1GiB高熵CAS+全OPFS字节校验已通过且#1619合入；P043原生Desktop Renderer/Preload/Main/Go Agent高熵1GiB原版n3已经有效测量通过（上传/下载P50 18.376/6.040s，全部源/CAS/完整下载SHA正确，证据头最终CI待复验）。之后仍需分开测试Web/Desktop 4GiB不可压缩和真实WAN/中断/用户明确任务取消。零源4GiB与高熵1GiB不能算可比性能AB。桌面Chrome/Edge已安装PWA、Android PWA、iOS PWA严格分列 Not measured，禁止CSS/`--app`仿真冒充。 P043 Desktop 1GiB高熵最终准确源码专项/完整CI双绿、#1625已合入；不可与不同runner结果计算产品提速。
4. **P0：Web/Desktop/Mobile/PWA大文件与100k同步/删除。** 复用P010/P011真实性能通道，优先测**不可压缩**真实CAS 4GiB、网络限速/中断/用户取消；之后测100k物理字节Push/Pull、原片CAS删除/回收站/Undo。已经验收的稀疏零源loopback不重复当新成果。 P046优先测真实原片CAS物理回收阶段，不以此替代后续100k文件完整HTTP永久删除、同步或已安装PWA操作。
5. **P1：真实RAW/HEVC/LIVP和多编码分布**、冷热缩略图/Live Motion播放器、Timeline复杂日期分组、跨应用共享消费者最后取消、极端内存/CPU与不同手机SoC。所有缺失均明确 `Not measured`，不以端功能等价推导跑分等价。

## 发布门槛

每一个标成跨端完成的性能场景必须有上述六种模式各自来源准确的实测或明确的、经批准的实际平台豁免及证据；不能把 PWA Safari/Chrome 显示模式模拟、Service Worker注册或Web UI共享当作移动安装态性能成功。CI代码合并、真实Linux Xvfb测量、真实Windows/macOS设备、Android Chrome PWA与iOS Safari PWA真机性能应分开报告。每个新的失败夹具与被否决试验保留到原始证据索引，防止重复调查与误报成功。


## P048 · 100k Gallery滚动取消六平台性能横向列表（2026-10-15）

| 指标 | Desktop Electron | Wide Web | Mobile Web 390px | Desktop Installed PWA | Android Installed PWA | iOS Installed PWA |
| --- | --- | --- | --- | --- | --- | --- |
| **100k图库虚拟列表滚动→Go Context.Done** | P017：54/54；最慢61.792ms；真实Desktop Agent滚动/切App/关窗，已验收 | P016：18/18；160ms后旧Handler0、浪费0B，已验收 | **P048原版实测 n3：12/12**，27.449/32.757/21.640ms；P50 **27.449ms**，最大**32.757ms**（≤160ms），已通过专项，PR未合入 | **Not measured**，需要系统真实安装Chrome/Edge | **Not measured**，需要Android真机已安装 | **Not measured**，需要iOS真机主屏幕安装 |
| +160ms遗留Handler / 无效字节 | P017：0 / 0B | P016：0 / 0B | P048：**0 / 0B**（每组4条物理JPEG，每条首块256B，三组共3072B） | Not measured | Not measured | Not measured |
| 取消窗口资源（原样本） | 参见P017独立原始证据 | 参见P016独立原始证据 | P048：Go RSS峰值增长 **0B**；Chromium Renderer **3,592,192B**；CPU Go 10/0/0ms、Renderer20/30/40ms，冻结各128MiB预算通过 | Not measured | Not measured | Not measured |
| 100k总量、真实可见数据范围 | P017：100k逻辑、独立Agent | P016：100k逻辑、首视口真实流 | P048：100,000逻辑PhotoAsset/115,000元数据Node，**仅4条/轮真实JPEG**；3次offset 50000签名Range各100条HTTP200 | Not measured | Not measured | Not measured |

**判定：** P048 原有生产CURRENT通过冻结门槛，不需要优化；BEFORE=CURRENT，AFTER=N/A，提速=N/A。该记录来自准确运行头 `eea3d5b3c308423f3d828872b54a9fbce24870ac` 的 [原生CI #38717945936](https://github.com/lazyxu/xdrive/actions/runs/38717945936) 和 [持久n3机器JSON](performance-evidence/gallery-mobile-web-go-cancel-100k/ci-run-38717945936.json)。当前PR仅基准及文档，最终文档提交后的专项/完整CI仍是独立合入门槛；当前full CI #38717945466 无关photo-face-image失败，不能标完成交付。

P048的100k是**逻辑项/元数据**，不等于100k不同物理CAS、全量缩略图解码或Live Motion播放；P016/P017/P040请求路径不同，不能横向计算性能提升。390px Chromium模拟并非Android/iOS真机，桌面PWA、Android PWA、iOS PWA 均保持 **Not measured**。首轮 [#38716968108](https://github.com/lazyxu/xdrive/actions/runs/38716968108) 是 Go PID采样 **Invalid harness**，并非性能产品RED；原始文件已保留。

**P049 / M002-d 新维度**：原版三独立100k逻辑/115k物理混合CAS真实渲染30/30有效视口数据已归档，当前为**Measured CURRENT／准确HEAD最终CI待收尾**，不能冒充已合入或前后优化。不得将Linux Chromium的390px窗口称为iOS/Android实机或安装态PWA，不得把视频海报JPEG解码称为Live motion视频播放。P049若达到已冻结门槛，结论是Accepted unchanged CURRENT且AFTER=N/A，不能与不同客户端P038/P039比较计算百分比。[中央去重登记簿](performance-test-registry.md)记录状态、样本与归档路径。

**P049首次专项无效样本（2026-10-15）：** CI [#38728914893](https://github.com/lazyxu/xdrive/actions/runs/38728914893) 在JS脚本语法检查时退出、真实100k/115k负载未启动，**Invalid harness n=0，不是产品RED**；六平台列仍维持 Mobile Web P049 **Not measured**，全部已安装PWA设备仍 **Not measured**。见[统一性能登记簿](performance-test-registry.md)与[FileExplorer规范](file-explorer-performance.md)。

**P049独立负载状态（2026-10-15）：** [native #38729340131](https://github.com/lazyxu/xdrive/actions/runs/38729340131)成功种入115k不同SHA的149,285,128 B真实JPEG/H264/Live物理源，但视频海报**合法冷404**未由测试适配器触发真实浏览器帧解码与生产poster PUT，首视口没有有效成绩；[full #38729340392](https://github.com/lazyxu/xdrive/actions/runs/38729340392)旧P039静态字符串断言失败。均为**Invalid harness、有效视口0**，不是性能RED。P049 Mobile Web仍**Not measured**，三个installed PWA也保持**Not measured**；修订详情与保留的原始记录在[中央登记簿](performance-test-registry.md)及[FileExplorer专项规范](file-explorer-performance.md)。

**P049第三次原生partial（2026-10-15）：** [CI #38732126413](https://github.com/lazyxu/xdrive/actions/runs/38732126413)记录15个真实390px Grid/Details可见JPEG、Live still和H264 JPEG海报视口通过（最慢369.969ms、Go并发最大6、非取消5xx=0），但第二组Details复用Grid的CAS缓存视频海报，测试夹具错误要求重复POST，三组完整n3未成立，**Invalid harness / Mobile Web该混合负载仍Not measured**。[部分机器证据](performance-evidence/file-explorer-mobile-mixed-p049/ci-run-38732126413-partial-invalid.json)。实际Android/iOS、桌面已安装PWA仍Not measured，未更改生产性能路径。

**P049三轮实测跨端判定（2026-10-15）：** 原生[CI #38733843520](https://github.com/lazyxu/xdrive/actions/runs/38733843520)已完成3个真实PG17+115k物理CAS混合媒体独立夹具×Grid/Details×5视口，30/30的自检都为passed=true；**Grid五位置P50跨轮P50=466.461ms，Details=310.520ms，单位置最慢764.867ms**，DOM≤33、Go thumbnail并发≤6、非取消5xx0、Renderer内存增长峰值74,514,432B、Go RSS增长峰值401,408B。**原版满足冻结预算，无生产性能变更，AFTER=N/A**。专用工作流最终包装字段`mixedMobileMode`未写入摘要导致CI报告failure，摘要及原始[全部n3机器JSON](performance-evidence/file-explorer-mobile-mixed-p049/ci-run-38733843520/summary.json)仍作为有效实测保留；修复包装字段后需准确HEAD CI/final-gate双绿才认定Merged。其他Wide Web同负载、真实OS安装Desktop/Android/iOS PWA均为Not measured；不得把本次390px Chromium充当手机、安装态PWA或实况运动播放的验收。

**P050独立宽屏Web原版已测量（2026-10-15）：** 原始n3完成，30/30视口通过，保留未改生产的1440×900真实共享Web FileExplorer 100k逻辑+115k不同SHA实际JPEG/H264/Live原片三组样本，以可见解码H264来源海报为终点，收集CPU/RSS/HTTP字节/请求/Go活动并发与冷/热缓存。此轮`BEFORE=CURRENT（有效原版n3）`、`AFTER=N/A`、`speedup=N/A`，只要真实n3满足冻结预算就保留原版；否则区分有效产品RED和Invalid harness，只有真实RED才允许最小优化及同条件AB。同量级已合入P038 Desktop和P049 Mobile Web与P050不是同一平台，不得跨端计算优化百分比。P049最终双绿且#1694合入，与早期“待复验”措辞应以本条和表格最新状态为准。真正已安装Desktop/Android/iOS PWA仍全部Not measured。[去重登记簿](performance-test-registry.md)和[FileExplorer规范](file-explorer-performance.md)为P050权威报告。

**P050 Wide Web 真实完整n3结果（2026-10-15）：** 三组PG17/Gin/Local CAS各115k SHA不同物理JPEG/H264/Live原片，每组六个独立Grid/Details可见视频海报和JPEG滚动位置共30/30达标，Grid五位置跨轮P50**663.716ms**、Details **485.783ms**，最慢单视口**727.933ms**；Go同时HTTP thumbnail最多6、非取消5xx为0、最大挂载DOM121、Renderer RSS增长峰值122,597,376B、Go RSS增长峰值479,232B。真实网络thumbnail GET共576次、472,389B，冷H264原片受权读取/帧解码/海报CAS PUT与热Details的缓存GET均通过。[原始n3记录](performance-evidence/file-explorer-wide-mixed-p050/ci-run-38745263789/summary.json)、[原始CI](https://github.com/lazyxu/xdrive/actions/runs/38745263789)。**Accepted原版CURRENT，AFTER=N/A**；准确HEAD专项 #38748158459 与完整 #38748158841 双绿，#1709已合入。P038 Desktop、P049 Mobile Web是不同客户端，即使布局共享也不可跨端计算提速。真实 OS安装 Desktop/Android/iOS PWA保持`Not measured`；所有平台“已测”标签仅代表该行精确定义的样本真实性与链路层。


## P051 / M004-e · 4GiB高熵CAS六平台验收状态（2026-10-16）

| 场景 | Native Desktop | Wide Web | Mobile Web | Desktop installed PWA | Android installed PWA | iOS installed PWA |
| --- | --- | --- | --- | --- | --- | --- |
| 真实非稀疏4GiB高熵文件上传/下载、源CAS SHA、完整字节校验 | P045 #1637 Merged；历史P50 **55.087/21.969s** | P044 #1631 Merged；历史P50 **48.509/18.417s** | **P051原版 CURRENT有效n3（交付待准确证据HEAD CI）**：390px真实窄屏Chromium（外框390、文档360–390CSSpx）、n3×512 PUT×4GiB源与完整OPFS校验已冻结，源码`9f2b6b56`原始native #38758949429真实3/3成功：上传/下载P50 **47.804/17.587s**、全OPFS 4GiB逐字节一致、innerWidth390/documentWidth375，Go/Renderer RSS增长达标 | **Not measured** | **Not measured**（需Android真机安装） | **Not measured**（需iOS Safari主屏幕安装） |

**准确边界：** P051 Chrome/Electron承载真实窄视口，而非Android/iOS实体机、OS安装PWA或完整Mobile Files App Frame。不可把P044/P045数字当P051新跑分或速度提升。冻结每方向≤360秒、Go/Renderer内存增长各≤256MiB、源分配≥98%、每组PUT512/GET1、3组SHA不同、全4GiB OPFS真实比对。慢网中断、Task Center取消及100k真实物理文件同步/GUI删除仍为 Not measured。来源：[登记簿](performance-test-registry.md)和[FileExplorer专项](file-explorer-performance.md)。

**P051更新结果：** 已归档原始[3组机器JSON与source压缩包](docs/performance-evidence/real-mobile-web-incompressible-cas-4gib-p051/ci-run-38758949429/raw-n3.tar.gz)及[可读指标](docs/performance-evidence/real-mobile-web-incompressible-cas-4gib-p051/ci-run-38758949429/metrics.json)，原始[专项CI #38758949429](https://github.com/lazyxu/xdrive/actions/runs/38758949429) success。`P051 Mobile Web 390px`已取得原版Linux Chromium性能，不得与P044 1280px宽屏Web、P045 Desktop Agent的历史结果横向算提速。Desktop installed PWA、Android installed PWA、iOS installed PWA仍全部**Not measured**；当前工作提交仅性能测量及归档、未改真实上传下载业务逻辑，AFTER=N/A。准确证据HEAD专项及完整CI/final-gate成功前PR仍保持Draft。

## P052 / M005-i · 100k真实物理JPEG取消跨平台对照（2026-10-16）

| 取消负载与真实物理原片数 | Native Desktop | Wide Web | Mobile Web | Desktop installed PWA | Android installed PWA | iOS installed PWA |
| --- | --- | --- | --- | --- | --- | --- |
| 100k SHA不同可解码80×64 JPEG原始CAS + Mounted FileExplorer Grid/Details真实滚动取消至Go | **Not measured**（Desktop P037只有16个真实JPEG） | **Not measured**（Web P015只有少量真实JPEG） | **P052 原版已验收 CURRENT n3（准确证据 HEAD CI 待完成）**：36/36真实 Context.Done 和 Handler退出、最慢17.909ms、160ms后旧Handler0、废弃0B、375px document；新真实375px窄屏/100k不同物理CAS×Grid/Details n3，首6条slow HTTP 256B后滚动，冻结≤160ms全部Go Context.Done/Handler完成且废弃0B。P039物理渲染和P040元数据取消都是另一个负载。 | **Not measured** | **Not measured** | **Not measured** |

**P052是独立平台＋真实物理CAS形状，当前BEFORE=CURRENT（原版有效真实n3）、AFTER=N/A。** 已合入P040取消36/36、最慢21.979ms不能冒充100k个独立JPEG原片下的性能；P039的纯物理JPEG渲染也不是取消。新工作流必须真实n3×2布局、每组六条已送256B再滚动、Go Context.Done与Handler结束、+160ms遗留0、浪费0B、128MiB Go/Renderer预算以及独立分页100k才可Accepted；错误/无效夹具原样归档。OS安装态PWA和真实设备全部Not measured。

**P052更新：** 既有Mobile Web P040物理16张取消验收保持不变。新增P052首个有效100k物理JPEG来源在#38778786252已真正构造并验证（70,893,376B），但因测试Web入口缺少100k-physical配置而**有效取消n0**；归档为[Invalid harness](performance-evidence/file-explorer-mobile-physical-go-cancel-p052/ci-run-38778786252-invalid.json)，并非生产RED。P052六平台状态仍然Mobile Web **Not measured**（尚无有效原版取消延迟），三种installed PWA及真机同样Not measured，不拿P040已验收21.979ms代替P052真实成绩。

**P052 真实有效CURRENT补充（2026-10-16）**：每独立PG17/Gin/CAS来源包含100,000个SHA不同JPEG（70,893,376B）；Mobile Web 390px外框/375px实际document，Grid/Details×n3共六组，36/36 `Request.Context.Done`与Handler退出；最慢17.909ms，+160ms旧Handler 0、废弃0B，最大Go/Renderer取消窗口RSS增长12,288/3,080,192B，P052 **原版Accepted CURRENT，不优化**。原始[专项CI #38779915915](https://github.com/lazyxu/xdrive/actions/runs/38779915915)、[完整原始六样本、summary和source压缩包](docs/performance-evidence/file-explorer-mobile-physical-go-cancel-p052/ci-run-38779915915/raw-n3.tar.gz)，机器[可读机器汇总](docs/performance-evidence/file-explorer-mobile-physical-go-cancel-p052/ci-run-38779915915/metrics.json)，证据修订HEAD的最终专项与完整CI仍需验证。其余五个平台在此相同100k实体JPEG+取消负载上均为**Not measured**；含已安装Desktop/Android/iOS PWA，不用窄屏Chromium代替真机。
