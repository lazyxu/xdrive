# FileExplorer performance roadmap

> **2026-10-16 P052最终核查**：原生100k物理JPEG真实取消性能PR [#1728](https://github.com/lazyxu/xdrive/pull/1728)已经以单提交线性合入 `master@6229ac6a922ed12da47e618d2ab4f56ab95cde56`，已验证临时分支清理。其证据HEAD `90e816c3421d44e624ba687ed4541117c11a8e84` 的[专项CI #38829321827](https://github.com/lazyxu/xdrive/actions/runs/38829321827)、[完整CI #38829321902](https://github.com/lazyxu/xdrive/actions/runs/38829321902)含Final Gate成功。真实六组Grid/Details，每组10万不同JPEG CAS，36/36 HTTP `Request.Context.Done`和Handler终止，复测最慢 **16.305ms**，160ms旧Handler **0**，废弃响应 **0B**；全部预算内，原版不优化，AFTER=N/A。前面试验时间线中“待复验”已经过时，P052真实有效原始样本仍在[物理证据目录](performance-evidence/file-explorer-mobile-physical-go-cancel-p052/ci-run-38779915915/)归档。Desktop真实物理CAS场景还未测，下一阶段P053如下。六平台持续对照[详见矩阵](performance-platform-coverage.md)。

> **2026-10-15 最终交付状态（优先于以下历史时间线）：P050 / M002-e 已 Accepted CURRENT / Merged [#1709](https://github.com/lazyxu/xdrive/pull/1709)。** 在固定master `a7654570` 上唯一工作提交 `3e969074`，原版Web文件管理器100k逻辑/115k不同物理JPEG/H264/Live的3独立PG17/Gin/CAS数据集、30/30 Grid+Details真实可见滚动视口全部预算内；Grid/Details P50 **663.716/485.783ms**，最慢727.933ms，Go并发峰值6、DOM121、非取消5xx0、Go/Renderer RSS增长均小于256MiB。归档后准确HEAD [专项 #38748158459](https://github.com/lazyxu/xdrive/actions/runs/38748158459) 和 [完整 #38748158841](https://github.com/lazyxu/xdrive/actions/runs/38748158841)（含final-gate）双绿，线性合入master `3dcabd3c12d0da72ec40b56c7c8eb21958977a22`，远端分支已清理。**保留生产原版，BEFORE=CURRENT、AFTER=N/A、speedup=N/A**；[完整原始n3机器证据](performance-evidence/file-explorer-wide-mixed-p050/ci-run-38745263789/summary.json)。P049 #1694亦已准确HEAD双绿合入；以下“尚未测出/待复验”属于原始阶段历史，不代表最终状态。P030 Desktop IPC进度 #1185仍为Blocked Draft，不属于Race专题。真正安装Desktop/Android/iOS PWA、物理100k Push/Pull、实机及Live motion播放仍Not measured，见[六平台矩阵](performance-platform-coverage.md)。

## P0 — P050 / M002-e · 宽屏 Wide Web FileExplorer 100k逻辑／115k真实混合JPEG H264 Live原片（2026-10-15）

**Status: Accepted original CURRENT n3 (30/30 1440px真实宽屏可见解码视口达到全部冻结预算)；生产代码原版未修改，BEFORE=CURRENT，AFTER=N/A，speedup=N/A；准确证据HEAD专用原生与完整CI/Final Gate为合入前独立验收。** 冻结单工作提交基线 GitHub `master@a765457042f48c46852e581e34d458468188fdda`；原版产品代码不修改，首测 n3数据尚未取得。上一轮P049是390px共享Web Files混合媒体，准确HEAD专项CI #38737142631、完整CI #38737143285含final-gate双绿后随#1694线性合入，分支已经删除；P038真实Desktop Agent是不同客户端。当前仍开放的Desktop 100k图像IPC进度 #1185 在其最终源版本只收到初始0B，没有最终字节回调，为独立Blocked Draft，不能降低断言/抢占Race范围。P050由此承担**未测宽屏Web Files**的真实100k逻辑／115k原片新维度，不能与P049的390px或Desktop P038算成before/after百分比。

**真实数据/客户端边界：** 每个样本启动独立Go `TestGalleryRealWebColdFixture100K`，经过真实PostgreSQL17/Gin和Local CAS持久生成**100,000逻辑PhotoAsset、115,000不同SHA物理原片**（70k独立JPEG、15k H264 MP4和15k成对Live still JPEG及motion MOV），独立验12原片CAS读回，物理原始字节要求大于100,000,000 B，实际种子耗时一律排除视口计时。H264 MP4/MOV容器复用一条96×64编码流，不能冒充15k独立视频编码或真正Live Motion动态播放。实际 Web共享`XDriveFileExplorer`在真实1440×900 Linux Chromium窗口（由Electron Xvfb承载，仅当作宽屏**Web组件**，不经过Desktop Go Agent/IPC）使用生产共享VirtualCollection和签名所有者的115k `children`分页。合法冷视频海报404通过原P049真实测试适配器**受权File preview-ticket → 原始H264 bytes → Chromium frame decode → JPEG canvas → 生产revision-fenced video-poster PUT204 → CAS GET readback**，后续Details可复用同Server当前身份下热缓存。仅检查JPEG图片/海报的实际可见解码，不代表所有115k同时完成媒体解码，也不是安装态PWA或任何手机真机。

**首测前冻结的CURRENT预算：** 3组独立物理CAS fixture × Grid/Details × 0/25/50/75/95%虚拟滚动 = 30实际位置。每个位置必须在20,000ms内至少解码位于`getBoundingClientRect`裁剪范围内、且按下一窗口是真新Node ID的可见像素：起点Live motion JPEG poster≥2张，25% Live still JPEG≥6张，50%和75% JPG≥6张，95% H264 poster≥2张；每项需 `img.complete` 与`naturalWidth>0`，不能只数占位/overscan。真实document宽1400–1440px、不使用Mobile断点；DOM当前挂载1–999，真实Go同时thumb Handler≤6，非取消HTTP 5xx=0，Go和Chromium Renderer从CAS种子完成后RSS增长各≤268,435,456B (256MiB)；记录每次真实请求、传送JPEG/MP4字节、冷404/海报PUT/GET、CPU/RSS、原始物理CAS数和先后顺序，权限与revision不可绕过。三次后取每组五位置P50，再取三组中位，另记最慢单位置，严禁跨runner/端进行A/B假提速。

**决策与取消边界：** 先在生产原版测出真正有来源的 n3 CURRENT。若所有预算均内，**保留原版、AFTER=N/A、speedup=N/A**。仅真实产品RED（且不是测试脚本/夹具、历史缓存、HTTP 404冷海报契约、CI环境或浏览器视频codec失效）才设计最小性能优化并同环境 n≥3 alternating BEFORE/AFTER，显著快且资源/字节/正确性不回退才保留，否则Rejected。此次不变更前端请求取消或durable uploads/sync/delete任务所有权：已接受的滚动`AbortSignal→Go Request.Context().Done`另列P015/P016/P037/P040/P048，不能用新性能视口加载把Go取消验收算完成。真实WAN、PWA桌面安装态、Android/iOS真机、独立编码的H264/HEVC、RAW/LIVP完整解码、Live运动播放以及100k物理Push/Pull/Undo仍`Not measured`。

**完整测试与归档约束：** [仅P050分支专用工作流](../.github/workflows/file-explorer-wide-mixed-p050.yml)、[真实1440px Chromium/PG/CAS driver](../desktop/scripts/file-explorer-wide-mixed-100k-main.cjs)、[静态真实性契约](../desktop/tests/file-explorer-wide-mixed-p050-source.cjs)，重用[生产共享Web测试适配器](../web/src/FileExplorerRealScrollPerformanceHarness.tsx)而**不修改**生产FileExplorer、Agent、Server或原P049 driver。原生成功后必须按每轮实际记录将`sample-1/2/3-grid/details.json`、真实Go/Renderer CPU/RSS及请求字节、`summary.json`、`source.txt`、source准确SHA和CI链接永久归档`docs/performance-evidence/file-explorer-wide-mixed-p050/`；保留Invalid harness/RED历史证据；补齐去重登记簿与六平台矩阵，仍在**同一个工作提交**重建，重新执行精确证据头原生n3和仓库完整CI/final-gate均成功后才可Ready→线性合入并清理分支。真实设备安装态不会在Linux CI中凭空获得证据。


### P050 原版CURRENT首轮完整物理n3 — Authentic wide shared Web FileExplorer

**Source exact:** `5687ff0c1c665b5b0b5a13c5b2e58cf31dc07a3f`，独立[原始native CI #38745263789](https://github.com/lazyxu/xdrive/actions/runs/38745263789) **success**、[原始 ZIP artifact #11978427625](https://github.com/lazyxu/xdrive/actions/runs/38745263789/artifacts/11978427625)。三次独立PG17/Gin/Local CAS种子，每次严格写入**100,000逻辑PhotoAsset、115,000 SHA不同原始CAS文件、149,285,128B物理源**、15,000 LiveStill/Motion可信配对；H264 MP4/MOV是不同SHA不同原始容器，但复用同一个96×64已编码流；这不代表独立编码类型或真实Live Motion连续播放。每次Width1440px、Web共享真实FileExplorer虚拟列表（非Desktop Agent IPC，非安装PWA），Grid及Details均走相同受权`children`分页与真实`media/items/:id/thumbnail`生产接口，冷视频合法404后真实源签名ticket+Chromium解码首帧+JPEG CAS海报PUT204/GET。

| 真实PG17/CAS独立样本 | Grid 5可见位置P50 | Grid最慢 | Details 5可见位置P50 | Details最慢 | Go postseed RSS增长 | Go CPU |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | **664.090ms** | 669.063ms | **485.783ms** | 498.907ms | 180,224 B | 810ms |
| 2 | **663.716ms** | 692.665ms | **492.495ms** | 551.812ms | 479,232 B | 870ms |
| 3 | **634.013ms** | 727.933ms | **433.242ms** | 507.563ms | 393,216 B | 810ms |
| **n3中位/P050峰值** | **663.716ms** | **727.933ms** | **485.783ms** | **551.812ms** | **479,232 B** | — |

**预算判定:** 30/30真实virtual viewport`passed=true`（每组Grid及Details五位置0/25/50/75/95%）；最慢727.933ms/冻结20,000ms；Linux真实可见DOM最大**121**（门槛<1000），源Go并发峰值**6**（冻结≤6），非取消HTTP5xx=**0**，三组/双布局共**576次**真实缩略图请求、**472,389B**响应负载；Renderer RSS增长最大**122,597,376 B =116.92 MiB**、Go postseed最大**479,232B**，两者原256MiB预算内。三组实际PG/CAS媒体种子耗时**135,478.224 / 127,315.761 / 132,191.734 ms**记录为构造成本，绝不混入真实可见视口毫秒。真正签名MP4读取、H264帧解码、JPEG海报真实CAS写入、热Details缓存读回有机器记录；没有测量真实视频播放、跨应用窗口取消或已安装PWA。

**结论:** Accepted `CURRENT` 原版，**无需优化**；`BEFORE=CURRENT`、`AFTER=N/A`、`speedup=N/A`。P049 Mobile 390px的P50 Grid466.461ms/Details310.520ms与本测试不是匹配A/B；不能推算Mobile→Wide性能退化或产品优化比例。历史Desktop P038亦是不同Agent链路。内存/HTTP/CPU等指标全部保留可重复实际来源。

**原始可再审查证据:** [完整原始summary.json](performance-evidence/file-explorer-wide-mixed-p050/ci-run-38745263789/summary.json)（六个真实视图含逐位置绝对毫秒与POSTER计数）、[per-fixture Go RSS/CPU/seed及物理源SHA边界](performance-evidence/file-explorer-wide-mixed-p050/ci-run-38745263789/provenance.json)、`sample-1/2/3.json`、每组`sample-N-grid/details.json`、`source.txt`，以及[原始 ZIP artifact](https://github.com/lazyxu/xdrive/actions/runs/38745263789/artifacts/11978427625)。测试原始`summary.passed=true`且P050分支专项CI success。归档在同一固定基线的**一个工作提交**后必须重跑准确HEAD专项原生n3及完整CI+final-gate；通过前不可声称已合入。用户主动持久上传/下载/同步/删除的任务取消不受浏览器虚拟列表影响；真OS安装Desktop/Android/iOS PWA、真实WAN、真实iOS/Android手机、HEVC/RAW/LIVP/独立H264位流仍为Not measured。


---

## P0 — P049 / M002-d · 390px Mobile Web FileExplorer 100k mixed physical JPEG H264 Live (2026-10-15)

**Status: Measured original CURRENT n3=30/30 real mixed viewports within frozen budgets; exact evidence-amended native + complete CI/final-gate pending, not yet merged. Production unchanged, BEFORE=CURRENT, AFTER=N/A, speedup=N/A.** Fixed GitHub baseline `master@5f2fde05bb9327bb1188760b56fe3c396534a12d`; pre-existing #1185 Desktop binary progress callback remains independent Blocked/Draft. P038 authentic Desktop Agent measured mixed JPEG/H264/Live, while P039 measured Mobile Web shared FileExplorer **only** distinct JPEG originals. P049 is the previously uncovered *Mobile Web Files + mixed real original CAS* workload, not an equivalent rerun. AGENTS.md already mandates initial CURRENT, retaining only material matched gains and direct links to this canonical document, the single registry and six-platform matrix; no redundant rule change.

**Physical data and code boundaries:** Reuse existing opt-in `TestGalleryRealWebColdFixture100K` and `gallerySeedRealPhysicalMixed100K`: 100,000 logical PhotoAssets, 115,000 SHA-distinct physically stored CAS sources: 70k JPEG, 15k H264 MP4 and 15k Live still JPEG paired with motion MP4; physical report verifies 12 original reads and >100MB of real persisted source bytes. Motion/video MP4 containers reuse one 96×64 H264 encoded stream. A test-only `folder_id` field in the existing `/__perf/config` supports real owner-authenticated 115,000-file `nodes/:folder_id/children` ranges via **the actual shared Web `XDriveFileExplorer`** plus real signed thumbnail GETs and Go native request/byte counters. No new production API, no Desktop Agent change, no FileExplorer/Task Center business behavior.

**Frozen acceptance BEFORE the first native run:** n=3 fresh PostgreSQL17/Gin/CAS fixture×Grid/Details×0/25/50/75/95% positions = **30 measured virtual windows** in real 390px browser. Require image pixels decoded in actual viewport-clipped tile rect, not placeholder/overscan counts; 0% Live motion poster≥2 new visible Node IDs, 25% Live still≥4, 50%/75% photos≥4, 95% H264 video poster≥2. Only a visible JPEG thumbnail/poster decode is proven, NOT original video/Live Motion playback. Each viewport to this decoded condition ≤20,000ms. DOM mounted between 1 and 999, max Go HTTP in-flight≤6, noncanceled HTTP 5xx exactly 0, Go and Renderer postseed RSS growth each≤268,435,456B (256MiB). Archive all per-viewport raw timings, physical original counts/bytes, CPU, Go HTTP byte/request and canceled/error counters, client width and peak DOM. Authentication must produce 115k true folder children on all pages. No forged installed OS or true phone performance claim.

**Decision gate:** unchanged CURRENT first. If every original n3 gate passes, retain product code unchanged, AFTER=N/A. If real product RED occurs, preserve first red and actual provenance; distinguish bad Go fixture/timeout/invalid browser geometry (**Invalid harness**) from a genuine production budget failure. Optimize only a verified performance hotspot, perform alternating matched ≥3 BEFORE/AFTER with identical media/codec/window/environment and no resource/correctness regression; revert speculative or marginal changes. Keep Race, durable cancellation and Go task ownership out of scope.

**CI/data contract:** existing guarded driver `desktop/scripts/file-explorer-real-physical-100k-main.cjs` now accepts separate **P049 opt-in** mode without changing P039 default; the Web `FileExplorerRealScrollPerformanceHarness` switches test-only query into correct fileKind and 115k total. The [new P049 branch-only native CI](../.github/workflows/file-explorer-mobile-mixed-p049.yml) and [source contract](../desktop/tests/file-explorer-mobile-mixed-p049-source.cjs) build the real web bundle, three independent real Pg/CAS sources and six Grid/Details sessions. After valid CI, save machine raw sample rows, `summary.json`, `source.txt`, exact SHA and original job link in `docs/performance-evidence/file-explorer-mobile-mixed-p049/`; amend the same exactly-one-work-commit PR then rerun evidence-accurate scoped CI and full CI/final-gate before Ready/linear merge. OS-installed desktop/Android/iOS PWA and H264/Live original motion playback remain Not measured.


### P049 ORIGINAL / CURRENT — 完整三轮真实混合物理媒体结果（2026-10-15）

数据准确源码 `97edbc955835eb552f24a004977da53d9cf6b86a`；[实际原生 CI #38733843520](https://github.com/lazyxu/xdrive/actions/runs/38733843520)、[原始 artifact](https://github.com/lazyxu/xdrive/actions/runs/38733843520/artifacts/11974340572)。真实Linux Chromium 390px窗口（document 375px）、共享生产FileExplorer Grid与Details各五个真实0/25/50/75/95%滚动，三组独立PostgreSQL17/Gin/Local CAS，每组**100,000逻辑PhotoAsset / 115,000个独立SHA原片 / 149,285,128B原始CAS / 15,000成对Live Photo**；H264 MP4原片容器内容复用96×64编码流。由受权签名预览下载真实MP4、Chromium解码H264源帧、canvas产出JPEG海报、Server原有revisions校验后CAS PUT204、signed缩略图GET及浏览器已解码可见像素完成。其结果不代表原始视频/实况动态播放、RAW/HEVC/LIVP、115k并行解码、慢WAN或者OS安装PWA。

| 独立 fixture | Grid五位置 P50 | Grid最慢 | Details五位置 P50 | Details最慢 | Go RSS增长峰值 | Go CPU |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 362.061 ms | 484.153 ms | 314.328 ms | 384.817 ms | 81,920 B | 370 ms |
| 2 | 466.461 ms | 764.867 ms | 310.520 ms | 465.806 ms | 401,408 B | 330 ms |
| 3 | 470.383 ms | 507.213 ms | 310.181 ms | 368.996 ms | 110,592 B | 350 ms |
| **n3中位 / 峰值** | **466.461 ms** | **764.867 ms（最慢）** | **310.520 ms** | **465.806 ms** | **401,408 B** | — |

**真实性 + Frozen gates核查：** 30/30视口自身 `passed=true`，每视口实际新可见JPEG/H264海报/Live still/motion poster满足冻结2/4张要求，最长0.765s≤20s；最大挂载DOM **33<1000**，真实HTTP缩略图请求共**376**、真实响应字节**357,194 B**、最大Go thumbnail同时6，**非取消HTTP5xx=0**。所有6个真实Grid/Details视图的Renderer峰值RSS增长最大**74,514,432B（71.06 MiB）**，Go最大增量401,408B，均≤256MiB。各物理数据源构造耗时**233,912.786 / 242,059.450 / 203,283.331 ms**记录但严格排除出每窗口计时。HTTP cold video poster合法404随后由实际源解码/海报PUT回读满足，不冒充成功视频播放；窗口滚动请求很快完成、没有独立的Go `ctx.cancel`新负载认证，取消仍引用P015/P017/P040/P048独立已验收样本。

**原版性能决定：** 所有固定时延、DOM、并发、RSS、非取消HTTP错误及可见源真实性预算均满足。因此 **保留原版Web/Go/Agent生产代码不动；BEFORE=CURRENT，AFTER=N/A，优化提升百分比=N/A**。不同GitHub Runner/平台的P038、P039数字不能参与性能加速百分比。

**CI状态必须与原版n3真实性能区分：** 原生 `summary.json`已经输出`passed=true`和完整6视图×5滚动位置；但工作流其后的`node -e`要求`s.mixedMobileMode`为true，JSON摘要构造遗漏了这个仅供测试的布尔标识，使CI `failure` 而不是`success`。这不是产品RED，亦非测试真实性/性能门槛下调。已在同一单工作提交增加`mixedMobileMode`元数据及静态契约，并把[完整原始30窗口summary](performance-evidence/file-explorer-mobile-mixed-p049/ci-run-38733843520/summary.json)、[三组Go/RSS/CPU+原始HTTP来源](performance-evidence/file-explorer-mobile-mixed-p049/ci-run-38733843520/provenance.json)、独立`sample-{1,2,3}.json`、六个原始Grid/Details窗口、`source.txt`永久归档，保留原始Artifact。只有**修订后准确HEAD原生真实n3与完整PR CI/final-gate成功**，才可把#1694从Draft标Ready并线性合入master与清理分支。

---

## P0 — P047 / M003-b · authentic owner-authenticated HTTP permanent delete of 100k distinct original CAS files (2026-10-13)

**Status: MERGED #1652, accepted true 100k physical HTTP DELETE AFTER n3; unoptimized genuine 100k HTTP500 → corrected 3/3 full HTTP204 and physical CAS unlink. Exact-evidence-head native #38365803201 and full CI #38365803657 incl. final-gate SUCCESS; source HEAD `35f52e640a83971c61dcdd94ccc098ed2afd3a73` merged linearly as `c7d751d36aaeb18d55a2aedd4020e7fb048e6705`. Final valid AFTER P50 155,240.932ms, max Go postseed RSS-growth 125,628,416B. Successful BEFORE=N/A, speedup=N/A (baseline returned HTTP500). Full final n3 JSON below; OS-installed PWA and frontend GUI Not measured.** This is a materially NEW complete production signed Gin HTTP `DELETE /api/v1/trash/:id`→PG17 authorization/revision checked transaction→ContentBlob reference release→real Local CAS physical delete workload. P028 was 100k real HTTP **metadata-only** with deliberately empty storage keys; P046 covered *only* 95k physical original CAS finalization **after** reference release. P047 includes those separate SQL/HTTP/physical layers together with 100k true source objects; do not add P028/P046 timings to predict or claim an A/B speedup. This candidate changes only the ContentBlob reference-release lock/SQL hot path, not the race specialization.

**2026-10-13 first source-exact attempt — Invalid harness, not production performance RED.** [Native CI #38359837015](https://github.com/lazyxu/xdrive/actions/runs/38359837015) on `f8dea528d870931a41b1780d9bacf9e9f66252a7` exited during `gofmt -l` preflight, BEFORE Go compilation, 100k physical CAS seeding, or owner HTTP DELETE. No wall/CPU/RSS n3 or baseline was measured. [Immutable invalid record](performance-evidence/real-http-original-cas-permanent-100k-p047/ci-run-38359837015-invalid.json) retains the original source and failure. The next one-work-commit repairs only gofmt and whitespace-insensitive source contracts while retaining 100k/1KiB/1200s/512MiB and 404/409/204 frozen gates. Re-execute native CURRENT before considering any production optimization.

**2026-10-13 second accurate-source native #38362078011 — real Measured RED, not an invalid benchmark.** [Native failure](https://github.com/lazyxu/xdrive/actions/runs/38362078011) at source `514e0080f9ead0a25a4716c5c934827ce966c65d` successfully compiled the real Go/Gin/Postgres17 code and generated exactly **100,000 distinct physical 1KiB CAS objects** plus protected outside sentinel (100,001 total). Foreign-owner DELETE HTTP404 and stale-revision HTTP409 were correct. The first signed owner DELETE resulted **HTTP500 in 1,460.730ms**, Go postseed RSS-growth **120,856,576B**, CPU ticks 109; **no physical CAS files were removed** and 100,001 File/Blob rows remained. The PostgreSQL service log gives **`ERROR: out of shared memory` / `max_locks_per_transaction`**, while `releaseContentReferencesTx` acquired one transaction-scoped advisory lock per distinct hash over 500 SQL batches of 200, retaining all until commit. This is a genuine reproducible-on-first-attempt 100k capacity/functional RED; the 1.460s unsuccessful response is **not** a BEFORE successful latency, and n3 cannot complete once cohort 1 returns 500. [Permanent exact JSON](performance-evidence/real-http-original-cas-permanent-100k-p047/ci-run-38362078011-measured-red.json) includes raw CPU, RSS, request/bytes and rolled-back state; CI artifact #11795615792 includes raw logs.

**Minimal performance-only candidate to validate:** `loadContentReferenceBatchTx` already takes an ordered `SELECT ... FOR UPDATE` row lock on **existing** `ContentBlob` rows, serializing refcount/ready/deleting changes with existing create/retain/finalize row locks. Remove only redundant **per-hash advisory locks in the bulk *release* transaction**; keep `lockContentHash` for CAS creation, retention, cleanup and physical finalization. This bounds PostgreSQL transaction advisory-lock memory instead of increasing server settings, and changes 120-blob batched release from **three SQL statements to two** (structural statement-count target, not asserted 33% latency gain). Preserve row lock order and audit/refcount/physical byte invariants. No race专项 changes or task cancellation changes. Once candidate source-exact n3 achieves real HTTP204 and deletes 100k physical originals per cohort with unchanged 1,200s/512MiB budgets, it is a material **failure→completion** improvement; otherwise reject/revert and preserve the RED. **No successful BEFORE duration or speedup percentage may be reported.**

**2026-10-13 corrected P047 real native CURRENT n3 — Accepted benchmark and production capacity fix, NOT a latency speedup.** Source exact `caf3e34461aecc9ace9462e860a14d1c6f0048d6` [native CI #38363280432](https://github.com/lazyxu/xdrive/actions/runs/38363280432) and [full PR CI #38363280974](https://github.com/lazyxu/xdrive/actions/runs/38363280974), including Final Gate, succeeded. Three completely independent genuine 100k SHA-distinct Local CAS/PG17 fixtures successfully owner-authenticated HTTP DELETE204 and physically unlinked all **100,000** selected original 1KiB CAS files per sample, retained exactly one protected sibling CAS with matching complete contents, and verified 404/409, 0 selected remaining Node/File/FileVersion/ContentBlob/Share, 1 outside File/Blob/Share and one audit record. Native HTTP DELETE wall ms (seed and post-audit excluded): **168,098.109 / 166,238.598 / 159,943.881**, P50 **166,238.598ms**; postseed Go sampled RSS-growth **124,264,448 / 124,026,880 / 126,337,024B** (max 126,337,024B); Go CPU ticks **8,824 / 8,755 / 8,538**, original SHA sets remain distinct. Every sample passed frozen HTTP≤1,200,000ms, RSS-growth≤536,870,912B, 100k CAS unlink and protection gates; production result is **Accepted material 100k scalability/functionality fix**. Prior unmodified baseline failed with HTTP500 and deleted 0 actual originals (1,460.730ms is *failed-request time*, not usable BEFORE success latency); **no before/after percentage wall-clock speedup is mathematically defined**. The removed bulk-release advisory-lock round trip changes bounded 120-blob SQL counter from 3 to 2 while preserving existing ordered ContentBlob FOR UPDATE locks and the single-hash CAS finalization advisory locks. [Complete n3 machine JSON](performance-evidence/real-http-original-cas-permanent-100k-p047/ci-run-38363280432.json) and [raw job artifact](https://github.com/lazyxu/xdrive/actions/runs/38363280432/artifacts/11796153105) are retained. Evidence-amended exact source HEAD native #38365803201 (3/3) plus full CI #38365803657 (final-gate) both succeeded; #1652 merged and its branch was removed by cleanup. Final second independent same-production SOURCE exact n3 HTTP DELETE milliseconds **155,240.932 / 154,625.039 / 155,725.598**, P50 **155,240.932ms**, peak sampled Go postseed RSS-growth **125,628,416B**, still all frozen 100k/204/404/409/external-protected/1200s/512MiB contracts passed. Historical prior valid P50 166,238.598ms is a different CI rerun, not evidence of any product speedup. [Final exact-head full machine n3 JSON](performance-evidence/real-http-original-cas-permanent-100k-p047/ci-run-38365803201.json). This is real **Server HTTP**, not native Desktop/Web/Mobile/installed-PWA GUI and not a benchmark of actual encoded JPEG/H264/Live files.

**Physical data truthfulness:** Three independently seeded PostgreSQL17 schemas and Local CAS roots. Per cohort call real `Local.Put` to store **100,000 SHA-256-distinct physically written 1KiB binary original files** (102,400,000B *logical source payload*) generated with bounded, sample-specific deterministic SHA-256 blocks; PostgreSQL holds one real `Node`, one `File`, and one `FileVersion` per original, with `ContentBlob.RefCount=2`. A second sibling Node/File and independently hashed Local CAS original remain outside the selected subtree and must survive. Input source generation, CAS writing, Node/File/Version seeding and pre-delete validations are **excluded** from measured DELETE wall time and recorded separately. These are real CAS payloads but are not actual encoded JPEG/H264/Live photos, a WAN bandwidth test or a GUI test.

**Real HTTP and correctness gate:** Instantiate the actual Server.Router/Gin bearer-authenticated HTTP API and real PG17/Local CAS. Before the timed owner delete, a foreign owner returns **HTTP404** and a stale If-Match revision returns **HTTP409** without changing originals; time the successful authenticated user `DELETE /api/v1/trash/<folder-id>` and require **HTTP204** empty body. Verify after returned 204 that exactly **100,000 original physical CAS files** have truly disappeared (before 100,001 including outside sentinel; after **only the 1 original outside**), all selected subtree Node+File+FileVersion+ContentBlob rows are absent, selected Share revoked, untouched outside File/Share remains, one audit entry persisted. The outside original's entire 1KiB payload must match expected bytes. Physical source unique SHA and logical bytes are explicit; **the sum of logical deleted bytes is not an actual disk-block allocation number**. The outside sentinel and physical count verification occur after the elapsed DELETE clock.

**Frozen original budgets before any native run:** **n=3** fresh independent true source/owner/PG17/CAS cohorts; all explicit SQL/refcount/hash/physical/original+sentinel and permission/etag/audit checks pass; authenticated 100k real original DELETE HTTP duration **each <=1,200,000ms (20m)**, postseed native Go RSS growth **<=536,870,912B (512MiB)**; positive measured wall and CPU tick delta, actual response/seed/posttimer audit separately recorded; 0 uncanceled HTTP errors. The whole original n3 local runner may need up to 125 minutes CI to allow 3 independent 100k real CAS cohorts, so test-only workflow is strictly head-branch scoped. If fixture instrumentation/Go source formatting/PG/Local CAS setup fails before real HTTP, preserve **Invalid harness** evidence; do not weaken fixed acceptance or label a failed upload/delete a speed gain.

**Performance decision: ACCEPT measured functional capacity fix (100k real HTTP500 → 3/3 genuine HTTP204 and 100k physical CAS unlink) with unchanged frozen correctness/CPU/RSS/budget gates.** Original CURRENT successful latency is unavailable, so AFTER is the new 166,238.598ms P50 baseline and numerical latency speedup is N/A. Preserve the previous invalid harness and failure JSON; never claim this n3 completed in a Web/Desktop/PWA GUI. Post-archive exact source HEAD native #38365803201 and full CI #38365803657 (25 success, final-gate) both passed; #1652 merged linearly and cleanup removed its branch. Browser window closure must never cancel durable task-owned upload/delete/sync, and this benchmark does not test request-level virtual-scroll cancellation.

**Persistent evidence:** [Opt-in native P047 CI](../.github/workflows/real-http-original-cas-permanent-100k-p047.yml), [source contract](../desktop/tests/real-http-original-cas-permanent-100k-p047-source.cjs), this FileExplorer canonical document, [central workload registry](performance-test-registry.md), and [six-platform matrix](performance-platform-coverage.md) are part of this same **single-work-commit Draft PR** now based on merged P046 master (#1645). Store native valid/failed/invalid raw samples and exact source+CI links under `docs/performance-evidence/real-http-original-cas-permanent-100k-p047/`, amend SAME work commit then rerun exact evidence-head scoped native n3 and full PR CI/final-gate after base retargets master; linear merge only if green. OS-installed desktop/Android/iOS PWA, actual user interface 100k selection, 100k physical Push/Pull, true WAN and RAW/HEVC/LIVP remain **Not measured**.

---


## P0 — P046 / M003-a · 100k distinct physical original CAS object finalization (2026-10-13)

**Status: MERGED #1645, production unchanged; BEFORE=CURRENT, AFTER=N/A, speedup=N/A.** Original n3 native #38356105800 and full #38356106043 passed. Exact audit HEAD `ca71dad272bf29f36026fe001a0e0c22d6f98f1b` native [#38358150853](https://github.com/lazyxu/xdrive/actions/runs/38358150853) + full [#38358151113](https://github.com/lazyxu/xdrive/actions/runs/38358151113) (25 success incl. final-gate) passed; linear master merge `275637e13ad50f2542915389a63fe60463247d20`. Source-exact n3 95k unlink 137,623.013 / 138,333.192 / 137,668.242ms; P50 137,668.242ms, Linux actual allocated blocks reclaimed 389,120,000B per cohort, 5k survivor full identity/content intact; postseed Go RSS-growth peak 1,597,440B. This is another unchanged-product CI run, NOT an optimized A/B improvement. [Exact HEAD machine evidence](performance-evidence/physical-original-cas-finalize-100k/ci-run-38358150853.json). P027/P028 are 100k SQL metadata deletion with empty storage keys. P034 physically unlinks 95k DERIVED thumbnail cache files with repeated small JPEG bytes. Neither is 100k genuinely distinct ORIGINAL content-addressed CAS files. P046 isolates only the production post-reference-release physical finalization step, Server.finalizeContentBlobDeletes → Local.Delete, not the HTTP permanent-trash transaction, complete original uploads or 100k JPEG/H264/Live decoding.

**First exact-source attempt (Invalid harness / 2026-10-13):** [Native CI #38355620529](https://github.com/lazyxu/xdrive/actions/runs/38355620529) on one-work-commit `c0458d2a129094d96f61c84b6667ebbb73cd5724` exited at the `gofmt -l` source preflight before the Go binary, physical 100k sources or native cleanup timings were produced. Therefore **no valid CURRENT, BEFORE, AFTER or product performance RED** exists yet. Preserve [machine failure provenance](performance-evidence/physical-original-cas-finalize-100k/ci-run-38355620529-invalid.json); output actual `gofmt -d` on the next exact-head run, then correct test-only whitespace without relaxing 95k actual deletions / 900s / 256MiB. No production hot path change.

**Second source-exact attempt (Invalid harness / formatting diagnostic):** Native [CI #38355923753](https://github.com/lazyxu/xdrive/actions/runs/38355923753) on previous evidence-amended head `f4753feeac12631bb1e4fcae3b35bb994b4cbefb` printed precise `gofmt -d` deltas (Go string/operator spacing and map alignment) and again exited **before** executable build and original CAS seed. [Permanent diagnostic record](performance-evidence/physical-original-cas-finalize-100k/ci-run-38355923753-invalid.json). Now only those known test-only formatting differences are corrected. The independent 100k, 95k, 900s and 256MiB contract is unchanged; BEFORE=N/A until a complete valid n3.

**True data identity and physical boundary:** Three fresh real PostgreSQL17 schema/Local CAS roots. Per fixture the test actually persists 100,000 different 1KiB binary originals through Local.Put under SHA-256-distinct canonical CAS paths (102,400,000B total source bytes per fixture). 95,000 are legitimately already in ContentBlob ref_count=0 / state=deleting after the metadata-release boundary. Another 5,000 have matching real User/Node/File references and ContentBlob ref_count=1 / state=ready and must survive. Original physical byte sample checks, storage walker totals and different sample salts prove this is not 100k metadata rows pointing to a single CAS object. Input generation, original CAS writes and PostgreSQL seed setup are excluded from measured finalization latency and recorded separately.

**Frozen unchanged-original CURRENT acceptance:** Invoke the unchanged production Server.finalizeContentBlobDeletes on the 95,000 truly unreferenced candidates, including real PostgreSQL transactions, Local CAS delete and lifecycle leases. Every one of 3 independent native fixtures must physically delete EXACTLY 95,000 original CAS files / 97,280,000B, preserve EXACTLY 5,000 live physical originals / 5,120,000B and their 5,000 actual File rows, and leave exactly 5,000 ready ContentBlob records with zero remaining deleting rows. Verify samples of protected source bytes and removed source absence. Each measured physical finalization ≤900,000ms (15 minutes) and Go VmRSS post-seed peak growth ≤268,435,456B; collect CPU ticks, 25ms RSS samples, original/remaining files and bytes, separate seed duration and whole-process resource samples. The 15-minute contract is a diagnostic Linux local storage benchmark budget, NOT guaranteed production WAN or NAS I/O behavior. Build, fixture or instrumentation failures are Invalid harness rather than a measured product RED.

**First VALID true original CAS 100k n3 (2026-10-13):** Frozen work SHA `5649ac6290e655b93d1e91a89ae76b608e8f09d5`; [native #38356105800](https://github.com/lazyxu/xdrive/actions/runs/38356105800) and [complete #38356106043](https://github.com/lazyxu/xdrive/actions/runs/38356106043) (final-gate) passed; unchanged production code. Each fixture physically seeds 100,000 distinct 1KiB original CAS objects, then executes the real Server.finalizeContentBlobDeletes+Local.Delete on 95,000 zero-ref originals. The source creation and final scan are **outside** production finalization stopwatch.

| Independent true PG17+CAS original fixture | 95k physical unlinks (ms) | Physical Local.Put seed, excluded (ms) | Actual Go CPU ticks | Go postseed RSS growth (B) |
| --- | ---: | ---: | ---: | ---: |
| sample-1 | 120493.622 | 48100.037 | 6951 | 0 |
| sample-2 | 120770.331 | 44819.850 | 6967 | 0 |
| sample-3 | 119825.354 | 44952.531 | 6915 | 0 |
| **P50 / maximum** | **120,493.622** | — | — | **0** |

Every sample passed original <=900,000ms and postseed RSS-growth <=256MiB budget and exactly verified 100,000→5,000 original CAS files, 95,000 real physical unlink operations, retained 5,000 File refs and 0 remaining deleting CAS blobs; six sampled content identities remained consistent. **97,280,000 B is the sum of logical source-payload bytes of 95k deleted originals, not physically allocated disk-block bytes**. Postseed RSS growth 0B does not mean Go process RSS is zero. The original complete data, elapsed/seed and CPU tick readings and process measurements are archived in [source accurate P046 n3 JSON](performance-evidence/physical-original-cas-finalize-100k/ci-run-38356105800.json) and [raw artifact](https://github.com/lazyxu/xdrive/actions/runs/38356105800/artifacts/11793585317). **Decision: ACCEPT unchanged CURRENT; no product optimization, AFTER=N/A, no speedup.** P027 SQL-only 100k metadata and P034 derived-thumbnail GC are NOT comparable AB baselines.

**Strict post-timer identity/disk audit on evidence HEAD:** Augment *only* the benchmark harness to match **every** one of the 5,000 retained CAS SHA identities to the expected subset, read/validate every 1KiB protected payload and measure actual `stat.Blocks * 512` Linux disk allocation both before and after. Keep all this independent work **outside** the measured 95k finalizer clock and record additional audit duration separately; never conflate source logical bytes with filesystem-allocated bytes. Original 900s, 256MiB, 100k/95k/5k budgets unchanged. Final evidence HEAD native n3 + full CI/final-gate are required before merge; no Race changes.

**Optimization decision:** Accept unchanged CURRENT if all 3 frozen wall, CPU/RSS and byte/metadata gates pass; no production optimization, AFTER=N/A and speedup=N/A. For real repeated RED, preserve machine data, profile the exact SQL-per-CAS/physical-delete cost and only then consider one small performance-only change with matched alternating n≥3 BEFORE/AFTER and equivalent resource/correctness checks. Reject insignificant gains. No Race work or change to durable task cancellation semantics.

**Evidence and platform truth:** New branch-only [native P046 benchmark](../.github/workflows/physical-cas-original-finalize-100k-performance.yml) and [source contract](../desktop/tests/physical-cas-original-finalize-100k-source.cjs). Save every true passing/failing or invalid sample under docs/performance-evidence/physical-original-cas-finalize-100k/; update this canonical report, the [central tested workload registry](performance-test-registry.md), and the [six-platform coverage matrix](performance-platform-coverage.md) in the same one-work-commit PR. After archive changes SHA, rerun exact evidence-head native n3 plus full GitHub CI/final-gate before Ready and linear merge. The native Go Server path does NOT prove separate Web, Mobile Web, Desktop Renderer, or OS-installed desktop/Android/iOS PWA E2E deletion. Full authenticated 100k real CAS DELETE /trash and source Push/Pull still require distinct tests.

---


## P0 — P045 / M004-d · real Desktop native Agent IPC high-entropy 4GiB CAS (2026-10-13)

**Status: Merged #1637 / Accepted CURRENT. Original CI #38347489640 and final evidence-head native #38348315108 + full #38348315479 (final-gate) all successful; production unchanged, AFTER=N/A, speedup=N/A.** This is a genuinely new physical-bits scale/platform workload: P011 Desktop 4GiB was sparse zero, P043 Desktop high-entropy only 1GiB, P044 Web 4GiB OPFS uses a different data and transport owner. Keep the production Electron Renderer→Preload→Main→Go Agent IPC→Gin/Postgres17/Local CAS and native file-save path unchanged; no Race or durable-task cancel changes.

**Three fresh real physical 4GiB originals and bytes:** Reuse existing opt-in production Desktop runner with `XD_REAL_DESKTOP_INCOMPRESSIBLE_PERF=1` and `XD_REAL_CAS_SIZE_GIB=4`. Three separate PG17/CAS/Agent/Electron sessions each generate, write and fsync a different AES256-CTR source of **4,294,967,296B**, streaming bounded 8MiB buffers, test that `stat.blocks*512>=98%`, retain original incremental SHA256. Genuine Renderer File→Preload upload→Desktop Main→Go Agent sends **512 signed 8MiB PUTs**, then one authenticated GET to a real complete **4GiB local Desktop save file**. Outside the transfer clock independently SHA256-scan **every downloaded byte** in bounded 1MiB chunks. Require original source SHA256 == native Server CAS File SHA == downloaded file full SHA256, three distinct source hashes and exact content sizes. This does not verify WAN, real Windows hardware, or OS-installed PWA.

**Frozen initial CURRENT budgets (before any run):** n=3 independent original+Server+Client native fixtures, each upload and each download <=360,000ms; Go Agent RSS, Go Server RSS and Electron renderer working-set growth **each <=256MiB**; fsync original actual allocation >=98%; exactly 512 signed PUT and one complete GET, 4GiB input/output, full original/CAS/download SHA equality, three distinct samples and valid CPU/timing; no live uncanceled errors. Existing disk guard requires at least 3x4GiB+2GiB of available space; insufficient disk or fixture/driver failure is **Invalid harness** rather than performance RED and never changes budget. Physical fixture generation and complete downloaded SHA read excluded from the timed transfer.

**First VALID source-exact genuine Desktop 4GiB high-entropy n3 (2026-10-13).** Original tested stack SHA `ec98b265939bd239dd288293c2449cfcdcd0a7a9` based on frozen P044 source, native [CI #38347489640](https://github.com/lazyxu/xdrive/actions/runs/38347489640) / job `115132162691` **success**. Physical upstream P044 was subsequently merged, so P045 was reconstructed as one work commit on master without changing its genuine Desktop/Go Agent/Server product path. Three separately seeded physically allocated 4GiB AES256-CTR originals and three independent auth/PG17/Local CAS fixtures completed real Renderer→Main→Agent signed 512x8MiB upload and one full authenticated native download, with **all downloaded bytes SHA-256 checked** against physical original and Server CAS File SHA. Source creation and full download hash were excluded from stopwatch.

| Independent real PG17/CAS+Agent/Electron sample | 4GiB upload (ms) | 4GiB download (ms) | Physical source allocation (B) | Agent / Go Server RSS growth (B) | Renderer WS peak growth (KiB) |
| --- | ---: | ---: | ---: | --- | ---: |
| sample-1 | 55087.089 | 21968.577 | 4294971392 | 18829312 / 2875392 | 157156 |
| sample-2 | 41979.754 | 21906.688 | 4294971392 | 18821120 / 2674688 | 125464 |
| sample-3 | 65086.902 | 22240.868 | 4294971392 | 18874368 / 4935680 | 137628 |
| **n3 P50 / maximum growth** | **55087.089** | **21968.577** | — | **18874368 / 4935680** | **157156** |

Actual Linux loopback upload throughput P50 **74.355MiB/s**, download **186.448MiB/s**. Original frozen gates all passed: each direction <=360,000ms; max Renderer/Agent/Gin RSS increase <=256MiB; real 512PUT/1GET per fresh fixture, three different sources, each original physically allocated 4294971392B for 4294967296B logical data, and complete source SHA256==Server CAS SHA256==full Desktop download SHA256; all source/Agent/Go CPU ticks in the [unrounded machine record](performance-evidence/real-desktop-incompressible-cas-4gib/ci-run-38347489640.json), [original raw artifact #11789204550](https://github.com/lazyxu/xdrive/actions/runs/38347489640/artifacts/11789204550). **Decision: ACCEPT unchanged CURRENT, no production change, AFTER=N/A, speedup=N/A; no comparison to sparse-zero or browser P044 as A/B.** New evidence-head single-work-commit SHA and full master-target CI/final-gate still required before merging #1637.

**Performance acceptance and archive:** Run branch-scoped [native P045](../.github/workflows/real-desktop-incompressible-cas-4gib.yml) on exact source SHA. Valid CURRENT within gates => **Accepted unchanged CURRENT, no product optimization, AFTER=N/A, speedup=N/A**; reproducible genuine RED => only minimal performance-only change with matched n>=3 BEFORE/AFTER on same environment and data, without important CPU/RSS/I/O or correctness regression. Archive valid/invalid raw n3 under `docs/performance-evidence/real-desktop-incompressible-cas-4gib/` and update this report, [single performance registry](performance-test-registry.md) and [six-platform matrix](performance-platform-coverage.md) in the same **one-work-commit stacked PR**. After archiving, rerun exact evidence-head native + full CI/final-gate before Ready/linear merge/branch cleanup. Windows physical, true WAN/slow network, installed Desktop/Android/iOS PWA, actual 100k physical sync/delete and RAW/HEVC/LIVP remain **Not measured**.

---



## P0 — P044 / M004-c · real Web non-sparse high-entropy 4GiB CAS/OPFS native benchmark (2026-10-13)

**Status: Accepted valid ORIGINAL CURRENT n3 / unchanged production / BEFORE=CURRENT, AFTER=N/A, speedup=N/A. Original native [CI #38342769834](https://github.com/lazyxu/xdrive/actions/runs/38342769834) and full [CI #38342770009](https://github.com/lazyxu/xdrive/actions/runs/38342770009) including final-gate successful; evidence-amended HEAD native+full CI still mandatory before Ready/merge.** Already accepted but **different** workloads: P010 = true 4GiB authenticated Web→Gin/CAS→OPFS with a sparse zero source; P042 = three separate real 1GiB high-entropy physically allocated and fully OPFS-verified sources; P043 = 1GiB high entropy over authentic Desktop Agent IPC. P044 keeps the exact **production Web XDriveApi** and PostgreSQL17/Gin/Local CAS path while measuring the previously untested **4,294,967,296 byte** genuinely allocated high-entropy Web file. It is not a speedup comparison between different source distributions or platforms, and does not assert a current measurement in advance.

**Stable physical dataset and real path:** Reuse the opt-in production runner `desktop/scripts/real-web-cas-transfer-runner.cjs` and Web benchmark harness. Set `XD_REAL_CAS_INCOMPRESSIBLE_PERF=1`, `XD_REAL_CAS_SIZE_GIB=4` and `VITE_XDRIVE_LARGE_TRANSFER_PERF=1`. Three fresh PostgreSQL17/Local CAS samples generate physically written and fsynced **4GiB AES-256-CTR pseudorandom source bytes** per sample using <=8MiB generator buffers, with sample-specific incremental SHA256 and actual `stat.blocks*512 >=98%` source allocation. The actual Chromium file input and production `XDriveApi.uploadWithConflictPolicy` make **512 signed 8MiB PUTs**, with one real full `XDriveApi.download` GET to OPFS. After the transfer stopwatch, independently regenerate and compare **every one of 4,294,967,296 OPFS bytes** with max 1MiB WebCrypto AES-CTR buffers and verify native Server File/CAS SHA equals original physical source SHA; three distinct original hashes and HTTP counts must match. Full OPFS verification duration is recorded separately, never subtracted from a smaller timed transfer.

**Frozen ORIGINAL gates before first valid run:** n=3 truly separate real physical PG17/CAS + Chromium sessions, exactly 4GiB each direction, every upload and download <=360,000ms, Renderer working-set and Go Server VmRSS growth each <=256MiB, source physically allocated >=98%, 512 real PUT/one real GET, 3 distinct full-source SHA256 values, every full OPFS byte matches expected high-entropy stream, positive measured wall/CPU/HTTP bytes and no uncanceled HTTP/identity errors. Benchmark-only Go Server CPU, browser memory/DOM and request counters must be recorded. Existing original launcher already fails closed if the 4GiB runner has <16GiB disk free; disk/OPFS quota/runner or harness failures are **Invalid harness**, never a product RED or a reason to relax original budgets. Initial runner source/fixture generation, Web build and full integrity scan are outside timed upload/download. Local Linux loopback not WAN.

**First source-exact run — INVALID HARNESS / NO 4GiB MEASUREMENT (2026-10-13).** [Native CI #38342586136](https://github.com/lazyxu/xdrive/actions/runs/38342586136), exact original work SHA `00732ecb0033efec68530372ef474f745e1769d7`, ran **five** source contract tests: **4 passed and 1 failed before any Web build, native Go fixture startup, true 4GiB physical seed, upload, download or OPFS readback**. The failing *test-only static substring* expected `assert.equal(final.file_sha256,rows[0].uploadSeedSHA256)`, but the **existing production benchmark runner** correctly supplies a third diagnostic-message argument to `assert.equal`, so the real source contains `assert.equal(final.file_sha256,rows[0].uploadSeedSHA256,`. This is a false source contract, **not a product SHA or runtime performance failure**. Preserve [raw exact failure facts](performance-evidence/real-web-incompressible-cas-4gib/ci-run-38342586136-invalid.json), fix only the static assertion without touching production and re-run the full unchanged n3/360s/256MiB/512PUT/4GiB SHA and OPFS gates. BEFORE=N/A; AFTER=N/A; no speedup.

**First VALID source-exact CURRENT / accepted original P044 (2026-10-13):** Frozen original work SHA `1bfda2cadce936db69d7b95d0cb922f9e01685a1`; real native [CI #38342769834](https://github.com/lazyxu/xdrive/actions/runs/38342769834), job `115117254801`, **SUCCESS**; original exact-head full [CI #38342770009](https://github.com/lazyxu/xdrive/actions/runs/38342770009) including final-gate success. Three independent PostgreSQL17/Gin/CAS/Chromium fixture sources physically persisted **4,294,971,392B** allocated per **4,294,967,296B** high-entropy original; actual SHA256 differ by sample. Each true production browser file input streamed **512 × 8MiB signed PUTs**, used exactly one original-size GET, verified Server File SHA == original high-entropy source SHA, then independently compared every 4GiB OPFS byte after the download stopwatch. No artificial 4GiB JS memory allocation; browser sample uses 1MiB bounded WebCrypto verification.

| Independent true physical sample | 4GiB upload elapsed (ms) | 4GiB download elapsed (ms) | Full OPFS byte verification after timer (ms) | Go server CPU (ms) | Go server RSS growth (B) | Renderer WS max growth (KiB) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| #1 | 48466.400 | 17800.500 | 23812.700 | 26340 | 2904064 | 88348 |
| #2 | 48925.000 | 18434.400 | 24512.100 | 26540 | 5033984 | 91704 |
| #3 | 48509.400 | 18417.300 | 24287.500 | 26480 | 5058560 | 82244 |
| **n3 median / max resource** | **48509.400** | **18417.300** | — | **26480** | **5058560** | **91704** |

True native loopback throughput P50 upload **84.437MiB/s**, download **222.400MiB/s**. All **3/3** finished **before the fixed 360,000ms individual direction cap**, Go Server RSS and Chromium renderer growth <=256MiB, 512 actual PUT / one GET, 3 distinct original SHA256, exact CAS/File SHA identity, full 4GiB OPFS byte matching, positive CPU. Each sample's full-byte comparison after download cost 23812.700 / 24512.100 / 24287.500ms and is excluded from measured download throughput. The first failed static-contract [CI #38342586136](https://github.com/lazyxu/xdrive/actions/runs/38342586136) remains permanently **Invalid harness** as archived; it contains **no genuine 4GiB throughput sample**. [Unrounded original machine JSON](performance-evidence/real-web-incompressible-cas-4gib/ci-run-38342769834.json) and [raw artifact #11788080629](https://github.com/lazyxu/xdrive/actions/runs/38342769834/artifacts/11788080629) preserve complete producer/consumer/CPU/RSS/hash details. **Decision: Accept CURRENT as-is, no production optimization, AFTER=N/A and speedup=N/A.** P010 4GiB sparse zeros or P042 1GiB high entropy are not matched before/after controls. A new accurate evidence-amended single-commit head **must** rerun native n3 and full PR CI/final-gate before merging PR #1631.

**Decision contract:** First obtain valid unchanged CURRENT using the exact scoped [P044 opt-in CI](../.github/workflows/real-web-cas-incompressible-4gib.yml) plus [source contract tests](../desktop/tests/real-web-incompressible-cas-4gib-source.cjs). If all true n3 samples meet the original gates, record **Accepted CURRENT** without production optimization (AFTER=N/A and speedup=N/A). A reproducible product RED triggers profiling and only then a minimal performance-only matched alternating BEFORE/AFTER experiment on identical data/transport/runner with CPU/RSS/I/O/bytes/correctness guard; otherwise reject/revert. No Race or durable Task Center cancellation changes.

**Evidence delivery:** When GitHub native CI generates true machine n3 output, archive unrounded source-exact raw JSON or any Failed/Invalid harness evidence under `docs/performance-evidence/real-web-incompressible-cas-4gib/`, update this section, the [central registry](performance-test-registry.md) and [cross-platform matrix](performance-platform-coverage.md) in the same amended **single-work-commit** branch. Re-run the exact evidence-amended native workflow and complete PR CI/final-gate before Ready/linear merge. Non-native Windows/macOS, installed desktop PWA, Android/iOS devices, true WAN, resume, task-owned cancel and 100k physical Push/Pull/delete remain **Not measured**.

---


## P0 — P043 / M004-b · genuine Desktop Agent IPC 1GiB non-sparse high-entropy CAS file transfer (2026-10-13)

**Status: Merged #1625 / Accepted CURRENT, production unchanged; BEFORE=CURRENT, AFTER=N/A / speedup=N/A. Original [native CI #38340678659](https://github.com/lazyxu/xdrive/actions/runs/38340678659) and final evidence-head [native #38341363095](https://github.com/lazyxu/xdrive/actions/runs/38341363095) and [full CI #38341363491](https://github.com/lazyxu/xdrive/actions/runs/38341363491) including final-gate all passed.** P042 just accepted Web 1GiB non-sparse high entropy full OPFS and P011/P013 already accepted sparse-zero Desktop 4/1GiB, so never repeat those dimensions. P043 moves the **same size/distribution** to the materially different production Desktop Renderer → Preload → Main → Go Agent IPC → Gin/PostgreSQL17/physical Local CAS, with a **native Desktop saved file**, not browser OPFS or installed PWA.

**Frozen true source and actual transport:** For 3 independent native PG17/CAS+real Agent/Electron fixture sessions, generate a different 1,073,741,824-byte actual physical AES-256-CTR pseudorandom source with bounded 8MiB streaming output, `fsync`, and ≥98% real allocated bytes checked from `stat.blocks*512`; retain real incremental source SHA256. Use Electron's test-only CDP file picker with the real Preload `cloudUploadDroppedFiles` → Desktop Main → authentic Go Agent signed 128×8MiB PUT → Server Node/File/CAS. Download the just-uploaded Node through genuine production native Main/Agent file-save IPC into the test-selected output path, **then hash every byte of the actual complete saved local file separately**, comparing source/Server CAS/download SHA256 and exact 1GiB byte sizes. Full hash and fixture creation must remain outside measured transfer stopwatch; don't say three local payloads mean WAN or 4GiB high-entropy.

**Predeclared original budgets:** All 3 independent genuine source-accurate runs must have each upload and download ≤240,000ms, actual 128 PUT/one GET and exact 1GiB physical bytes, source allocated ≥98%, SHA256 physical source==Server CAS/File==downloaded complete local file, nonzero CPU and time measurements, renderer working-set and native Agent/Gin post-seed RSS growth each ≤256MiB, 0 noncanceled file/identity errors. Preserve original sparse-zero P013/P011 code behind opt-in `XD_REAL_DESKTOP_INCOMPRESSIBLE_PERF=1`; no production renderer/Agent/API changes. If the host disk, Electron/Agent IPC or test harness cannot provide accurate measurement, record Invalid harness/Blocked instead of alleging product RED.

**Optimization decision:** FIRST measure current unchanged Desktop production. All gates pass => Accepted CURRENT, no production optimization and AFTER=N/A. Authentic reproducible red => retain machine data and identify actual preload/main/Agent/Go CPU/RSS/disk/byte bottleneck, then compare paired matched n≥3 BEFORE/AFTER on same source/bandwidth and freeze all correctness/resource gates; only meaningful repeatable gain may stay. No Race/concurrency task and no Server durable upload/download/sync/delete cancellation based on closing UI.

**First valid P043 ORIGINAL CURRENT n3 (2026-10-13):** Measured SHA `a8c7c76a97cc935f1511471e8a8d2eaba1c84889`, authentic [native original CI #38340678659](https://github.com/lazyxu/xdrive/actions/runs/38340678659) **success** and [complete source-accurate 3-fixture raw machine JSON](performance-evidence/real-desktop-incompressible-cas-1gib/ci-run-38340678659.json), [unmodified raw artifact #11786946078](https://github.com/lazyxu/xdrive/actions/runs/38340678659/artifacts/11786946078). Three distinct real non-sparse 1GiB AES-CTR sources with **1,073,745,920 physically allocated B each**. Every fixture runs true CDP File selection + production Renderer/Preload/Main/Go Agent IPC +128 real signed 8MiB upload PUTs and 1 genuine Server CAS native download GET, then hashes the **entire downloaded file independently**; all three source SHA==Server CAS File SHA==download full SHA.

| Fresh true PostgreSQL17 CAS / Agent / Electron fixture | Real Desktop 1GiB upload (ms) | Download (ms) | 128 PUT / 1 GET | Source/CAS/download full SHA | Original physical allocated (B) |
| --- | ---: | ---: | --- | --- | ---: |
| #1 | 18420.394 | 6039.798 | 128 / 1 | PASS | 1,073,745,920 |
| #2 | 18255.957 | 6058.419 | 128 / 1 | PASS | 1,073,745,920 |
| #3 | 18375.838 | 6033.144 | 128 / 1 | PASS | 1,073,745,920 |
| **cross-fixture n3 median** | **18,375.838** | **6,039.798** | **all valid** | **3/3 full-byte SHA verified** | |

P50 upload **55.725 MiB/s** and download **169.542 MiB/s** on Linux local loopback. Agent and Gin RSS peak growth max **20,529,152 / 2,560,000 B**; Electron Renderer working-set growth peak **57,232 KiB**, all ≤256MiB frozen gates. Native Go Agent/Server CPU tick deltas and each full round's timings unrounded remain in raw JSON. Pre-hash original source generation and downloaded full-file SHA read occur outside the measured upload/download clock. **Decision: ACCEPT CURRENT without production optimization; AFTER=N/A and speedup=N/A**. Do not compare sparse P013 or Web P042 data as matched A/B; no claims about 4GiB incompressible/WAN/Windows physical device/OS PWA.

**Final P043 evidence HEAD complete (2026-10-13):** Final exact archived evidence SHA `ee1462421497196075ac3bba9718b0af2ecf7c6c` remeasured native n3 in [CI #38341363095](https://github.com/lazyxu/xdrive/actions/runs/38341363095) with independent P50 upload **10,436.878ms** and download **3,260.053ms**, physical/SHA/CPU/RSS gates valid; [full CI #38341363491](https://github.com/lazyxu/xdrive/actions/runs/38341363491) including final-gate all success, PR #1625 merged to master `c6d36d173b4d3134d5633fb4cfc3a7fdd32e090d`. Because first-run versus final-run data come from separate CI environments with **identical unchanged product code**, their difference is **not an optimization or comparable A/B speedup**. Both independent evidence sets are kept separately; original n3 machine JSON remains canonical source; P043 no further exploratory repeat needed.

**Evidence and delivery:** source-exact branch-only [P043 Desktop native 1GiB CI](../.github/workflows/real-desktop-incompressible-cas-1gib.yml), executable source/entropy contracts, test-only real Desktop transfer runner extension and same work commit in [central dedup registry](performance-test-registry.md), [cross-platform matrix](performance-platform-coverage.md), this canonical section. After valid/invalid run archive unrounded raw JSON under `docs/performance-evidence/real-desktop-incompressible-cas-1gib/`; amend same one-work-commit PR and re-run exact final evidence-head specialized/complete CI/final-gate. Real Windows physical device and iOS/Android/installed PWA, 4GiB high-entropy/WAN/transfer-user cancel remain Not measured.

---

## P0 — P042 / M004-a · Web physical high-entropy 1GiB CAS upload/download and full OPFS parity (2026-10-13)

**Status: Merged #1619 / Accepted CURRENT, production unchanged; AFTER=N/A / speedup=N/A. Final evidence-head specialized [#38339314956](https://github.com/lazyxu/xdrive/actions/runs/38339314956) and full CI [#38339315279](https://github.com/lazyxu/xdrive/actions/runs/38339315279) including final-gate were successful.** This is a **new incompressible source-bytes** workload, not a repeat of P012 1GiB zero-source or P010/P011 4GiB sparse-zero real CAS (already accepted). Reuse the *production* Web `XDriveApi.uploadWithConflictPolicy` / `download` into authenticated Gin/PostgreSQL17/Local CAS + Chromium OPFS, including the actual Web upload picker, real 8MiB signed PUTs and real GET. No mock server or synthetic speedup claim.

**Source truthfulness:** a benchmark-only Node pre-step creates a 1,073,741,824-byte **actually allocated and fsynced** upload File (physical allocated bytes ≥98% original length). A per-sample SHA256-seeded AES-256-CTR cipher produces a distinct, deterministic, high-entropy pseudorandom stream from bounded 8MiB buffers; initial source SHA256 is incrementally recorded. The native Go CAS/Node/File metadata SHA256 after production upload must equal that exact original hash. Three independent Postgres17/Local CAS seeds/Chromium sessions, one browser File upload, then one authenticated OPFS download per seed. Timed download verifies three true 1MiB OPFS sample ranges. **After the stopwatch**, independent WebCrypto AES-CTR regenerates the corresponding deterministic bytes for **every 1GiB downloaded OPFS byte**, reading/comparing a maximum 1MiB chunk at a time. Record full byte-verified count and verification duration separately, no 1GiB JS allocation.

**Frozen budget before first valid original run:** n=3 fresh real physical files, separate owner/CAS sessions, **128 real 8MiB PUTs + exactly one real GET** per seed; individual upload and download each ≤240,000ms; Chromium renderer working-set growth ≤256MiB, native Go Server RSS peak growth ≤256MiB; true source allocated blocks ≥98%, all original data bytes transmitted, SHA256 physical source == Server CAS SHA, OPFS downloaded full size and exactly matches *every byte* of seed, no noncanceled HTTP/identity errors, capture native CPU/RSS/HTTP bytes and upload phases. Source generation, CAS fixture seeding, Web build and whole-file integrity readback are outside transfer stopwatch, recorded independently. If temporary disk/OPFS quota insufficient, mark **Invalid harness/Blocked infrastructure**; no product RED and no budget relaxation.

**Optimization gate:** measure unchanged CURRENT first. If frozen acceptance passes, do not modify production; AFTER=N/A / speedup=N/A. If a repeatable valid RED occurs, profile hashing, signed PUT, CAS fs/disk I/O, OPFS stream buffering and CPU/RSS, then use matched alternating n3 BEFORE/AFTER; keep only material repeatable improvement with no regressions, otherwise revert and retain rejected evidence. This first independent workload is **1GiB**, not a real 4GiB incompressible measurement, WAN throttling, Desktop Agent, actual OS-installed PWA, Android/iOS phone, or durable Task Center cancellation. Follow-up new workload IDs must separately verify 4GiB Web/Desktop high-entropy and WAN.

**First exact-source native CI — Invalid harness (no performance observations).** [CI #38338157368](https://github.com/lazyxu/xdrive/actions/runs/38338157368), work SHA `94a4e3e60d4e9e8cf8b16cd629fac187ed5fa7bf`, failed while building the Web benchmark before starting actual Gin/Postgres, generating a non-sparse 1GiB File, uploading, downloading or reading OPFS: `src/realCasIncompressibleReadback.ts(54,26) TS2322: Uint8Array<ArrayBufferLike> is not assignable to BufferSource`. This is a **test-only WebCrypto AES-CTR TypeScript owned buffer** error, not a throughput/CPU/RSS product RED; preserve [raw invalid source-exact evidence](performance-evidence/real-web-incompressible-cas-1gib/ci-run-38338157368-invalid.json). Fix only the benchmark helper's AES counter as `Uint8Array<ArrayBuffer>` backed by `new ArrayBuffer(16)`, add a contract regression, and re-run source-exact native n3 with original 240s/256MiB/physical SHA/CAS/OPFS-byte gates untouched. BEFORE/AFTER remain N/A until genuine throughput measurement.

**First VALID source-exact ORIGINAL CURRENT — accepted without production change.** Original source commit `b18fa1e43b187e26d231cad6c3cbf9833a5af7dc`, [native CI #38338652389](https://github.com/lazyxu/xdrive/actions/runs/38338652389) **success**, complete unrounded [n3 machine JSON](performance-evidence/real-web-incompressible-cas-1gib/ci-run-38338652389.json) and [original workflow artifact #11786586311](https://github.com/lazyxu/xdrive/actions/runs/38338652389/artifacts/11786586311). Three distinct 1GiB high-entropy source hashes were proven identical to three actual Server File/CAS SHA256s, with physical on-disk allocation of 1,073,745,920 B each and 128 actual 8MiB PUTs plus one GET per sample. Every byte in three 1,073,741,824-byte downloaded OPFS files was checked with bounded AES-CTR expected-byte parity **after** the timed download.

| Separate real physical PG/CAS/browser fixture | Upload Web XDriveApi (ms) | Download to OPFS (ms) | Full OPFS byte verification *after timing* (ms) | Source / Server CAS SHA | Go RSS delta (B) | Chromium renderer peak delta (KiB) |
| --- | ---: | ---: | ---: | --- | ---: | ---: |
| #1 | 17,657.3 | 2,922.9 | 4,274.5 | exact match | 2,637,824 | 80,156 |
| #2 | 17,415.7 | 2,934.5 | 3,875.8 | exact match | 4,964,352 | 90,408 |
| #3 | 16,882.1 | 2,902.4 | 3,780.9 | exact match | 4,898,816 | 76,964 |
| **n3 P50 / resource maxima** | **17,415.7** | **2,922.9** | **3,875.8** | **3/3 exact** | **4,964,352 max** | **90,408 max** |

**Frozen targets satisfied:** all six user transfers ≤240,000ms; measured upload/download P50 throughput **58.7975 / 350.337 MiB/s** on local loopback; native Go CPU P50 **4,170ms**; Renderer delta max 90,408 KiB (<256MiB), Go RSS growth ≤4,964,352 B (<256MiB); each real source SHA == uploaded Node == CAS Blob and each OPFS file passed full byte parity. The 4,274.5/3,875.8/3,780.9ms independent full-byte verification is not added to download throughput stopwatch. This is *not* a matched A/B with historical P012 sparse-zero 1GiB, and no acceleration/degradation percentage is justified by different content/caches/runners.

**Decision: ACCEPT unchanged CURRENT (original); AFTER=N/A / speedup=N/A.** Original test-only source used WebCrypto AES-CTR BufferSource's wrong TypeScript buffer ownership and failed [native CI #38338157368](https://github.com/lazyxu/xdrive/actions/runs/38338157368) before any actual transfer; preserved as [Invalid harness](performance-evidence/real-web-incompressible-cas-1gib/ci-run-38338157368-invalid.json). The evidence-source full CI [#38338652604](https://github.com/lazyxu/xdrive/actions/runs/38338652604) independently failed the *documentation contract* `assert(matrix.includes('独立设备'))` in `desktop-tests` while the real native 1GiB n3 was green. This is another [Invalid harness/static matrix wording failure](performance-evidence/real-web-incompressible-cas-1gib/ci-run-38338652604-document-contract-invalid.json), **not** high-entropy product performance RED. Add an accurate independent-device boundary to the matrix, keep all benchmarks and gates unchanged, then rerun **final evidence-head original native n3 and complete CI/final-gate** before Ready/merge.

**CI/evidence:** branch-only [P042 source-exact workflow](../.github/workflows/real-web-cas-incompressible-1gib.yml) reuses real compiled Gin fixture and Web large-transfer harness, additionally checks AES-CTR browser/Node parity and SHA/physical allocation/full-byte verification. First native n3 results (or Failed/Invalid proof) must be archived as raw source-exact JSON in `docs/performance-evidence/real-web-incompressible-cas-1gib/`, then amend [central tested-workload registry](performance-test-registry.md) and [cross-platform matrix](performance-platform-coverage.md) in this **same one-work-commit PR**. Re-run exact final evidence-head native n3 and complete GitHub CI/final-gate before Ready/merge. Zero real P042 measurements are claimed at creation.

---

## P0 — P040 / M005-g · 390px Mobile Web Files authentic 100k scroll-to-Go cancellation (2026-10-13)

**Status: Accepted measured CURRENT (original n3), not yet merged; evidence-head native/full CI pending. BEFORE = unchanged original CURRENT; AFTER=N/A / speedup=N/A; no production optimization.** This is an **untested surface dimension**, distinct from accepted P015 wide Web, P037 native Desktop Agent and P039 Mobile Web physical 100k JPEG decoding. Use existing production shared Web FileExplorer `Grid`/`Details` 390px viewport and already-used opt-in true Gin/PostgreSQL17/local CAS 100k fixture. **Data boundary:** 100,000 logical nodes/files/media-metadata records per fresh database fixture, just **16 distinct physical CAS JPEG originals**; therefore not a 100k actual physical JPEG benchmark, not installed PWA, and not a real Android/iOS device. A real browser-backed Electron Chromium window tests CSS breakpoint and mounted DOM, **not mobile hardware/touch gestures nor full App Frame**.

**Frozen original CURRENT benchmark and acceptance before any optimization:** use `XD_FILEEXPLORER_MOBILE_GO_CANCEL_100K_PERF=1` only in `.github/workflows/file-explorer-mobile-go-cancel-100k.yml`, with 3 independent Postgres fixtures per Grid/Details mode (6 sessions). Wait until six authenticated true upstream JPEG GETs are active and have each sent 256 bytes; verify real narrow `documentElement.clientWidth 375–390`, matching `max-width:899px`; move the actual mounted scroll host to 50%; probe the Gin handler's real HTTP `Request.Context().Done` and cancellation counters. Demand **36/36 actual completed upstream cancellation notifications**, longest Go notification ≤**160ms**, **zero** old Handler at +160ms and **zero** bytes emitted to abandoned clients after marking. Each sample must retain independent real range query `offset=50000&limit=200` returning 200 of true 100,000 items, a bounded mounted DOM (<1000), and ≤6 initially active requests. Record native Go/Renderer CPU and observed RSS growth measured in the 160ms cancellation window (each ≤128MiB), + main CPU and actual HTTP bytes. This interval sample is *not* a whole-process memory peak or total cold-start latency.

**Workload identity / safety:** P015 wide Web measured 36/36 and worst 51.153ms, P037 Desktop Agent 54/54 worst72.082ms, but neither is a valid P040 mobile baseline or A/B comparator. No concurrency/Race fixes, no task center/persistent upload/download/sync/delete cancellation, no mock Abort signal in place of real virtual scroll. The scoped native Go writer deliberately waits 1.5s after the real 256-byte first chunk; that artificially widens the cancellation window and is excluded from production throughput timing. If the harness cannot prove true mobile breakpoints or authenticated upstream streams, classify as **Invalid harness**, preserve failing evidence and repair measurement code before reaching any product performance conclusion. Only if valid CURRENT exceeds the predeclared budgets consider a smallest production optimization and matched n≥3 BEFORE/AFTER under the same workload. Otherwise accept original product unchanged.

**Initial Invalid harness (preserved, zero performance samples):** first source-exact opt-in native [CI #38331391630](https://github.com/lazyxu/xdrive/actions/runs/38331391630) at head `12de9a472d3af9c020a19b8947fc2027f0122a3e` stopped during the Go formatter preflight before starting Web/Electron or any 100k fixture (new test-only `server_pid` field needed normal Go map key alignment). This failure has **no BEFORE** and does **not** count as a product performance RED. Keep the n3/160ms/128MiB budgets untouched and rerun on a format-only corrected head.

**First complete authentic n3 CURRENT (2026-10-13):** Original source SHA `9f3081cddc7a0d36545499bcd076c18d7ae57dd6`, [native CI #38331711972](https://github.com/lazyxu/xdrive/actions/runs/38331711972) **success**, [original 6-session machine JSON](performance-evidence/file-explorer-mobile-web-go-cancel-100k/ci-run-38331711972.json), [full raw artifact #11783601327](https://github.com/lazyxu/xdrive/actions/runs/38331711972/artifacts/11783601327). Every one of the 6 actual mounted Chromium viewports confirmed 390px window/375px document, mobile breakpoint, 100k logical File/Node/MediaMetadata and 16 distinct physical JPEG originals; six authenticated slow HTTP streams with 256 B each; real 50% DOM scroll; six Go `Context.Done` and Handler cancellations; independent 200-of-100k page served. All 36 streams aborted upstream. Per-session source n3:

| Actual Web Files view | Fresh PG/CAS seed | Worst Go cancellation notification (ms) | Context.Done / canceled | Old Handler @+160ms / wasted bytes | Go / Renderer RSS growth during 160ms (B) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Grid | 1 | 21.979 | 6/6 | 0 / 0 | 0 / 3,088,384 |
| Grid | 2 | 12.325 | 6/6 | 0 / 0 | 8,192 / 2,969,600 |
| Grid | 3 | 15.346 | 6/6 | 0 / 0 | 12,288 / 2,080,768 |
| Details | 1 | 15.664 | 6/6 | 0 / 0 | 0 / 2,498,560 |
| Details | 2 | 11.681 | 6/6 | 0 / 0 | 16,384 / 2,301,952 |
| Details | 3 | 16.354 | 6/6 | 0 / 0 | 20,480 / 2,187,264 |

**Overall**: **36/36** real Go cancellation successes; worst **21.979ms** (frozen ≤160ms), Grid/Details per-session worst-notification P50 **15.346/15.664ms**; old active handler **0**, wasted bytes **0**, actual 36 responses' initial first chunks **9,216 B** (6×6×256B); mounted DOM max **23**, true six real 200-row paginated requests; Go/Renderer RSS growth max **20,480/3,088,384 B** vs 128MiB frozen budget; sampled Go CPU 160ms ticks **20/0/0/0/0/0ms** and Renderer **20/20/10/20/30/20ms**, zero CPU ticks are *sampling resolution* not no work. Electron Main CPU deltas and all unrounded rows are in raw JSON; this isn't full-run memory peak/real iOS/Android or installed PWA.

**Decision: ACCEPT CURRENT, product code unchanged; AFTER=N/A, speedup=N/A.** P015's wide Web 51.153ms and P037's Desktop72.082ms were different samples/platforms and cannot form a numeric before/after to infer an acceleration. First unsuccessful formatter run remains Invalid harness and is not erased. Since this evidence+canonical document edits change the original tested head, this PR still needs **exact final evidence-HEAD P040 native n3 + complete PR CI/final-gate** before Ready/merge. That is mandatory even if original sample passed.

**CI / archive (performed original run; final head revalidation pending):** run the branch-only 390px native P040 workflow, collect six raw samples and source SHA in original artifact, add its raw machine JSON to `docs/performance-evidence/file-explorer-mobile-web-go-cancel-100k/`, and update this canonical report, [deduplicated registry](performance-test-registry.md) and [cross-platform matrix](performance-platform-coverage.md) **in the same one-work-commit PR**. The raw original run and measurements are now committed; next rerun exact final evidence-head specialized native and complete GitHub CI/final-gate before Ready/merge. Do not claim the final evidence HEAD has passed until it actually does.

## P0 — P039 / M002-c · 390px Mobile Web shared FileExplorer 100k distinct physical JPEG (2026-10-13)

**Status: Merged #1590 / Accepted CURRENT; final evidence-head native [#38329778398](https://github.com/lazyxu/xdrive/actions/runs/38329778398) + full [#38329778477](https://github.com/lazyxu/xdrive/actions/runs/38329778477) (final-gate) both succeeded; short-lived branch cleaned. Production unchanged (AFTER=N/A / speedup=N/A).** New platform coverage only: actual production shared Web FileExplorer Grid/Details in 390px Linux Electron Chromium, *documentElement.clientWidth 375px*. This is not the complete Mobile Web 52px App Frame, not real Android/iOS hardware, and not an installed PWA. Original baseline source `9f8acfe6d500f50fa680f09a2bfb3e96721dc23d`: [opt-in native workflow #38275879504](https://github.com/lazyxu/xdrive/actions/runs/38275879504) **success**; [full PR CI #38275880243](https://github.com/lazyxu/xdrive/actions/runs/38275880243) **success**. [Authentic 13-file original artifact #11759192861](https://github.com/lazyxu/xdrive/actions/runs/38275879504/artifacts/11759192861) and [persisted source-identical n3 machine metrics](performance-evidence/file-explorer-mobile-physical-jpeg-100k/ci-run-38275879504.json) are the evidence, not a projected result.

**Frozen workload / boundaries:** `XD_FILEEXPLORER_MOBILE_PHYSICAL_100K_PERF=1` and existing 100k SHA-distinct 80×64 JPEG original physical-CAS + authenticated PostgreSQL17/Gin fixture. Three independent databases/CAS roots, **100,000 distinct physically persisted JPEG originals / 70,893,376B in each**, two genuine rendered shared Files view modes, scroll at 0/25/50/75/95%, five viewports×2 modes×n3 = **30 measured native Chromium viewports**, each ≥4 *new* real decoded original JPEG tile IDs. Seeding cost is excluded from user viewport rendering; no claimed 100k simultaneous decode. Grid/Details in the same independent fixture may share warmed CAS/cache (do not use cross-mode comparison as A/B). Mode is narrow via real production breakpoint, not actual phone screen.

| Fresh CAS/PG fixture | Grid median of 5 viewports (ms) | Details median of 5 viewports (ms) | Go CPU delta over both view sessions (ms) | Go RSS growth (B) |
| --- | ---: | ---: | ---: | ---: |
| #1 | 256.685 | 204.138 | 270 | 286,720 |
| #2 | 254.993 | 218.306 | 280 | 212,992 |
| #3 | 257.426 | 209.005 | 280 | 208,896 |
| **cross-run median** | **256.685** | **209.005** | **280** | **212,992** |

**Resource and correctness acceptance:** longest of all 30 viewports **296.193ms vs frozen ≤20,000ms**; 30/30 have ≥4 new valid JPEG identities and real decoded dimensions; mounted DOM max **33** vs <1,000, authenticated real thumbnail requests **298 / 210,014 response bytes** across 6 view sessions, max active **6** vs ≤6, HTTP failures **0**. Renderer working-set growth max **58,810,368B**, Go RSS peak growth **286,720B**, vs each ≤268,435,456B. Source file byte identity and CAS materialization were verified in the fixture, per-seed Go CPU **270/280/280ms**; browser/main CPU measurements preserved in raw JSON. CI original full test and native 100k jobs are green. **BEFORE = unchanged CURRENT**, AFTER=N/A: no optimizations attempted or retained because every declared metric already meets budget, and the Wide Web P006 numbers cannot serve as matched A/B.

**Untested (not inferred):** full Mobile App Frame and Touch device, iOS Safari / Android Chrome physical SoCs, installed standalone PWA Service Worker, independent codec H264 video/Live motion/RAW/HEVC/LIVP Grid+Details, slow/WAN transport, persistent transfers/sync/delete, and viewport→HTTP→Go `Request.Context().Done` cancellation. The available test has `expectedAbandonedViewportRequestCancels=0`, so it provides **no cancellation-latency measurement**; P015/P037 are distinct Web/Desktop workloads. Do not rerun unchanged P039 exploration on a new branch. Final evidence-head native and full CI must pass before Ready and merge, and this exact-head confirmation is a separate gate from the valid original measurements.

## P0 — P038 / M002-b1 genuine Desktop FileExplorer 100k mixed physical CAS media (2026-10-12)

### P038 first complete valid real Desktop physical mixed n3 — accepted CURRENT; #1577 merged after final source-exact CI (2026-10-12)

**Closeout:** #1577 final source-exact specialized n3 [#38274018275](https://github.com/lazyxu/xdrive/actions/runs/38274018275) and full CI [#38274018731](https://github.com/lazyxu/xdrive/actions/runs/38274018731) succeeded; PR merged with short-lived branch cleanup. Earlier prose below describes the historical gating state at the time of the original sample, not an outstanding gate today.

**Native original measured source** `b4222918b6c0ba44509e2d52246c637302befaa7`: [authentic native CI #38271556910](https://github.com/lazyxu/xdrive/actions/runs/38271556910) **success**, [full PR CI #38271557305](https://github.com/lazyxu/xdrive/actions/runs/38271557305) **success**. The runner builds real Electron Desktop, Agent, authenticated Gin/PostgreSQL17/Local CAS, and **three fresh 115k SHA-distinct physical original stores** of 149,285,128 bytes each, with exactly 100k logical Gallery assets and 15k paired Live Photo source identities. Six actual Electron sessions, **30/30 true virtual viewport type-specific decoded images/posters**, pass. Source-original complete JSON and every unrounded session/viewport: [ci-run-38271556910-current.json](performance-evidence/file-explorer-desktop-mixed-physical-100k/ci-run-38271556910-current.json), with [raw runner artifact #11758480302](https://github.com/lazyxu/xdrive/actions/runs/38271556910/artifacts/11758480302).

| Genuine native fixture | Grid median of five viewports (ms) | Details median of five viewports (ms) |
| --- | ---: | ---: |
| Independent seed #1 | 943.144 | 724.525 |
| Independent seed #2 | 963.230 | 734.891 |
| Independent seed #3 | 746.707 | 784.147 |
| **n3 P50 across the per-session medians** | **943.144** | **734.891** |

**Unchanged-production frozen gates:** max single expected-type decoded viewport 3,152.664312 ms vs ≤20,000ms; peak DOM 88 vs <1,000; real media GETs **454** and HTTP payload **248,902 bytes** across the six sessions, observed max concurrency **6**; Renderer working-set growth max **111,337,472 B**, Agent RSS max **5,926,912 B**, Go fixture RSS max **716,800 B** (each ≤268,435,456 B). All original material seed integrity, owner account, 15k pairing, 115k distinct CAS and type-specific visible decode checks passed. **Raw 5xx total=2, canceled 5xx=2, noncanceled 5xx=0**: the 2 500s were *not erased*; this accepted remeasurement uses explicit canceled-vs-uncanceled attribution, whereas the earlier [#38266101039](https://github.com/lazyxu/xdrive/actions/runs/38266101039) original raw-all-5xx-zero gate was genuinely failed and remains recorded as failed. This is a changed measurement classification, not production Go cancellation or any speedup.

**Decision: ACCEPT CURRENT measured scope / keep production source unchanged; AFTER=N/A / speedup=N/A.** The 100k logical/115k physical workload is FileExplorer rendering of separate still and motion files with shared H264 encoded sample, *not* Gallery paired live playback, RAW/HEVC/LIVP, arbitrary 4K streams, real installed PWA or device-native testing. This is *not* a same-runner before/after timing comparison with P035 JPEG or P036 Mobile Web. **Evidence amendment changes this PR head**, so a fresh exact-head specialized native n3 and full CI/final-gate are required before Ready/linear merge; this existing successful measurement run alone does not prove that the new documentation HEAD passed CI.

**Historical original incomplete first attempt / NOT accepted (preserved):** [Actual native #38266101039](https://github.com/lazyxu/xdrive/actions/runs/38266101039) built the real Electron/Agent/Go/PG17/CAS path and completed only 3 of 6 target Electron sessions / 15 of 30 actual viewports before exiting. [Original source-exact partial JSON](performance-evidence/file-explorer-desktop-mixed-physical-100k/ci-run-38266101039-partial.json) and [full raw original artifact](https://github.com/lazyxu/xdrive/actions/runs/38266101039/artifacts/11755775758) retain all measured/failed evidence. Original independent fixture #1 Grid 5-window median **582.415ms** (Renderer growth **103,505,920B**), Details **484.702ms** (Renderer growth **95,375,360B**); fixture #2 Grid five-window median **521.933ms**, Renderer growth **90,042,368B**, six active media requests maximum, all type-specific decoded-window checks pass. Both physical seeds each verified 115k unique CAS SHA and 149,285,128 original bytes, but independent n3 is **not complete**.

**Cancellation classification and original budget integrity:** #38266101039's second Grid recorded an actual `GET /api/v1/media/items/:id/thumbnail` HTTP **500**. The same exact native `fixture-2.log` reports a canceled SQL `SELECT xd_media_metadata` (`context canceled`) for a scrolled-away thumbnail; the initial probe unconditionally counted every internal 500 as an *uncanceled Server error*. The **original raw-zero-5xx gate failed**; that failure remains visible, never silently reclassified as a successful original sample. The probe instrumentation now reports **every raw 5xx** as `http_5xx_total`, canceled 5xx separately as `http_5xx_canceled`, and uncanceled live-client failures as `server_errors`. The corrected live-error distinction is measurement attribution, not a production improvement or a claim that no HTTP 500 occurred. An **independent real noncanceled HTTP 500 remains a hard benchmark failure**, and explicit unit-test coverage verifies these distinctions. The next exact-head full native run must be judged on raw 5xx diagnostics and zero uncanceled server errors; do not extrapolate its new classification backward to erase the original frozen all-5xx failure. No Race, task lifecycle or Go request cancellation production path is modified.

**Additional invalid preflight (2026-10-12):** corrected-attribution [CI #38271239007](https://github.com/lazyxu/xdrive/actions/runs/38271239007) stopped at the formatting-only `gofmt -l` check before building fixture or running any viewport; source-exact [full CI #38271239458](https://github.com/lazyxu/xdrive/actions/runs/38271239458) is a separate gate. This run supplies **zero new performance observations**. The offending test-only probe struct and map literal were formatted according to the local Go formatter, retaining its raw5xx/canceled5xx/uncanceled-error instrumentation and all frozen viewport/resource budgets.

**Scope accuracy:** xDrive FileExplorer presents 115k **individual files**. The 15k still/movie pairs are physically verified by the Gallery fixture but render as separate Files entries, not a 15k paired Live Photo player or 100k logical Files rows. The Live-motion H264 file thumbnail is a poster, not in-grid motion playback. The benchmark does NOT validate paired Live Photo player playback, LIVP extraction, RAW, HEVC, physical Windows, or 30k independent video encodes.

 The first two opt-in [CI #38265435898](https://github.com/lazyxu/xdrive/actions/runs/38265435898) and [#38265796880](https://github.com/lazyxu/xdrive/actions/runs/38265796880) failed at the literal `gofmt -l` preflight before seeding PostgreSQL/CAS or launching Electron; **0 valid performance samples**. Classified **Invalid harness**, not product first-red. Format-only correction aligns the extended test-only HTTP probe struct; frozen n3/20s/256MiB/6-GET budgets are unchanged. The amended source needs fresh exact-head native and full CI. Frozen GitHub base `3a665e7a66a0502c036da2f7abfca5f93b32ca95`, exactly one benchmark-only work commit above base on `perf/file-explorer-desktop-mixed-100k-p038-20261012`. P035/M002-a's real Desktop 100k all-JPEG physical CAS is already accepted; this separate workload adds H264 video and paired Live still/motion in mounted production Desktop FileExplorer. Related #1185 remains a blocked Gallery binary-progress test and is not modified.

**Physical identity and setup:** Reuse the existing authenticated Gin/PostgreSQL17/Local CAS Gallery fixture and `gallerySeedRealPhysicalMixed100K`: 100k logical Gallery PhotoAssets but **115k distinct actual CAS Node/File originals**, including 70k different decodable JPEGs, 15k H264 MP4 containers, and 15k paired Live Photos (15k still JPEG +15k motion H264). Physical source SHA uniqueness, 12 direct CAS readbacks, 15k real Live relation records and source/metadata consistency are verified independently before any viewport stopwatch. Video/motion originals all reuse the same valid 96x64 H264 *encoded sample* inside different CAS MP4 containers: never claim 30k independent video encodes, 4K, HEVC, true LIVP archive or RAW. Desktop FileExplorer sees **115k file entries**, not 100k file entries. Enable test-only Desktop boot schema and `Capacity()`, and authenticate the real Go Agent; production handlers, ports, contracts and permissions remain unchanged.

**Frozen authentic workload:** three isolated PostgreSQL fixtures and CAS roots, each with fresh physical originals; production compiled Electron Renderer/Preload/Main, actual Desktop Files Sidebar into `100k Browser Cold Gallery`, real view-menu selection Grid and Details, real virtual scroll fractions `0/.25/.5/.75/.95`. Sort positions target Live motion, Live still JPEG, standalone JPEG and H264 video. Each window requires its expected actual visible type and new *decoded* Image pixels (not just requests/icons): JPEG and Live-still windows ≥6 freshly decoded, video and Live-motion windows ≥2 posters freshly decoded; report separately counts by kind and HTTP byte counters. Five windows × 2 modes × 3 fresh fixtures = **30 genuine measured viewports**. Seeding, builds, Electron launch and Agent auth do not enter user-visible viewport timing.

**Predeclared acceptance:** each true viewport expected-type decoded latency ≤20,000 ms; item status exactly 115,000, DOM mounted <1000, actual thumbnail HTTP concurrency ≤6, positive GET count and bytes, original strict raw-5xx=0 gate must remain recorded as failed for CI #38266101039; corrected instrumentation requires zero **uncanceled** HTTP 5xx and reports canceled 5xx raw counts explicitly (cold poster miss 404 diagnostic); Renderer sampled working-set growth, Agent sampled VmRSS and Go fixture sampled VmRSS each ≤268,435,456 bytes (256MiB). Capture 30 raw rows, per-mode independent n3 medians, actual consumed bytes, process CPU and RSS, first two video / first six stills, error counts and source revision. Do not claim full 115k simultaneous decode, real Windows device, original-video independent encodings, WAN or Go context cancel latency.

**Decision & invalid-run safety:** Measure unchanged CURRENT first. If all gates pass, accept product unchanged with AFTER=N/A and no speedup. If genuine decoded-image/H264 poster/IO/CPU/memory budgets fail, preserve raw evidence, isolate the real bottleneck, freeze matching BEFORE, then propose the narrowest performance-only change and rerun matched same-runner n≥3 BEFORE/AFTER, respecting original correctness and resource budgets. If Electron cannot navigate, boot schema/capacity fails, H264 fixture input is invalid, or no valid viewports execute, mark **Invalid harness**, do not accuse production. Maintain distinct request-scoped cancellation vs durable upload/download/sync/delete ownership; no Race fixes.

**Run/gate:** branch-scoped `.github/workflows/file-explorer-desktop-mixed-100k-performance.yml` sets `XD_FILEEXPLORER_DESKTOP_MIXED_100K_PERF=1`, native runner `desktop/scripts/file-explorer-desktop-mixed-100k-runner.cjs`. Only after native independent n3 results exist: archive the **original raw JSON** under `docs/performance-evidence/file-explorer-desktop-mixed-physical-100k/`, amend this canonical section and [central registry](performance-test-registry.md) in the same one-work-commit PR, then rerun source-exact native benchmark and full PR CI/final-gate before Ready/merge. **The originally unmeasured submission and its subsequent invalid/partial attempts remain historical. Valid CURRENT n3 is recorded in the first section above; no AFTER or new speedup claim.**

---

## P0 — P037 / M005-f authentic Desktop FileExplorer 100k Renderer → Go Agent IPC viewport cancellation (2026-10-12)

**Status: Merged #1562 / Accepted measured CURRENT.** Valid original source-exact n3 `08d6f4e0` and final evidence-amended head `143b9868d5759b9c7bd762e220da3a68ccb0e2a7` both passed native tests; final native [#38256126554](https://github.com/lazyxu/xdrive/actions/runs/38256126554) and full [#38256126976](https://github.com/lazyxu/xdrive/actions/runs/38256126976) (including final-gate) completed successfully. GitHub merged 2026-10-12 as `55f11b3f2069bb28364a1dd7f64aee95ad8d3d9c`, and the short-lived task branch no longer exists. **No production optimization / AFTER=N/A / no speedup claim.** GitHub selected task baseline `lazyxu/xdrive master` at work-branch creation, one work commit; continue after merged P036 #1533. The central dedup registry [docs/performance-test-registry.md](performance-test-registry.md) already exists and is mandatory in [AGENTS.md](../AGENTS.md). Related open [#1185](https://github.com/lazyxu/xdrive/pull/1185) concerns Desktop **Gallery IPC media progress callbacks**, not FileExplorer viewport Go cancellation; keep that PR blocked independently and do not rewrite it. Do not modify user-facing FileExplorer interaction, persistent tasks, Race code or Shared Gallery components.

### Distinct workload identity and frozen pre-run acceptance

Existing accepted **P015** proves 36/36 real **Web** FileExplorer Grid/Details fast scroll → Gin Context.Done, 100k **metadata** / first few real JPEG bytes; **P017** proves 54/54 real **Desktop Gallery** virtual scroll/app switch/window destroy → real Agent/Gin cancellation; **P019** proves Go Agent IPC cancellation without the mounted production Desktop FileExplorer UI. **P035** proves Desktop FileExplorer *rendering* at 100k different physical JPEGs but did **not** assert Go `Context.Done` after scroll and teardown. These are distinct boundaries, not interchangeable acceptance or comparable latency A/B. **P037** tests the missing Desktop **FileExplorer Renderer/Preload/Main → xdrive-agent IPC → authenticated Server Handler** across the *actual mounted native Desktop FileExplorer*.

- Three independent PostgreSQL17 fixtures, real Gin Server, real Agent login + IPC credential discovery, production Desktop Electron Main/Preload/Renderer and `FileExplorer` DOM. Reuse existing actual `TestFileExplorerRealWebScrollCancelFixture100K` (no duplicate 100k seeder) via its opt-in flag, with 100000 logical Nodes/Files/Media metadata but **16 different physical JPEG originals**. This is **not** 100k physical JPEG decode or 100k separately decoded visible thumbnails.
- Each fresh fixture executes actual Desktop Sidebar Files navigation, double-clicks the genuine `100k Images` folder, confirms 100000-item status, bounded mounted DOM and a scrollable real virtualized host, and waits for exactly **6 authenticated Go JPEG handlers** to have each flushed 256 real bytes while a **test-only 1500ms slow writer** keeps them in flight. One deliberate user action then invalidates the owning viewport: (1) scroll the real virtual host from 0 to ~50%, (2) switch to the actual Desktop Home app, (3) destroy the real Electron BrowserWindow. Each action is measured in a **new Electron session**; a source-authoritative independent Agent 200-item page starting at offset 50000 must remain accessible after every cancellation. The recovery probe calls the existing `AgentIPCClient.cloudChildrenRange(parentID, 50000, 200, 'name', 'asc', true)`, which returns `total_count`; the cursor-only `cloudChildrenPage` must **not** be used as an offset/total_count API.
- **Predeclared n3×3 frozen correctness+performance gate:** 9 successful authentic mode runs = **54/54 HTTP request `Context.Done` and cancelled old Handler receipts**; every mode has exactly 6 started/6 first-body chunks, at **+160ms** old active handlers **0**, bytes emitted after scroll/app/window action **0**, maximum Go cancellation notification latency **≤160ms**; independent Agent range total_count=100000 and items=200 for **all 9**; no physical CAS or owner identity changed; Agent post-seed RSS growth **≤134217728 B (128MiB)** for each fixture. Report old-request count, Go microseconds, bytes, Agent RSS, scope/mode and all raw n3 samples. Detect Go abort itself — ignoring a stale React result is **insufficient evidence**.
- **No lasting background cancellation**: only viewport/request ownership changes; never turn window teardown into abort of persistent uploads/downloads, Source sync, file deletion, Server tasks, or global maintenance. Consumer-aware shared resources remain independent. This is a performance trial, **not** a Race or correctness rewrite.

**First original P037 native CI / Invalid harness (2026-10-12):** [Source-exact #38252660274](https://github.com/lazyxu/xdrive/actions/runs/38252660274) on initial work commit `036cf94f628bbf44f26490c91a58a45ac8c7c50c` passed source contract and compiled actual Go/Agent/Electron, but the first authentic Electron `virtual-scroll` session timed out **before entering the seeded 100k Images folder**; **0 valid Go viewport cancellation samples were produced**. [Original failing artifact #11748343214](https://github.com/lazyxu/xdrive/actions/runs/38252660274/artifacts/11748343214) includes `electron-1-virtual-scroll.log` (real directory navigation timeout), empty `agent-1.log`, and `fixture-1.log` showing repeated PostgreSQL missing-table 500s for `xd_node_changes`, `xd_sources`, `xd_file_operations`, `xd_photo_intelligence_reanalyze_intents`, `xd_file_saved_searches` and others. Those schema tables and the storage Capacity contract had been migrated only in P035's opt-in **100k physical JPEG mode**, not P037's deliberately sparse 16-physical-JPEG cancellation mode. This is **Invalid harness / product red NOT established**; retain the original log and source SHA. The runner also originally passed `offset=50000` to cursor-only `cloudChildrenPage` (no `total_count`), proactively corrected in subsequent test-only work SHA `632c222c...` to real `cloudChildrenRange(parentID, 50000, 200, 'name', 'asc', true)`. A subsequent test-only fixture revision enabled Desktop model migration and Capacity preconditions **without enabling the P035 100k physical JPEG seeder**. All predeclared 9×6, Go <=160ms, zero stale Handler/bytes, 128MiB Agent RSS and sparse JPEG fixture limits remained unchanged. The later valid n3 CURRENT is independently documented above; the initial failure remains Invalid harness.

### P037 first valid CURRENT: real Desktop/Agent/Gin 100k cancellation n3 (2026-10-12)

**Original exact-source native [CI #38254019068](https://github.com/lazyxu/xdrive/actions/runs/38254019068) success, job [#114827290948](https://github.com/lazyxu/xdrive/actions/runs/38254019068/job/114827290948); measured source SHA `08d6f4e0db1469438add7964aecb1069216632cd`.** The run started actual production Electron Renderer/Preload/Main, logged into real xdrive-agent, accessed authenticated Gin/PostgreSQL17/CAS, navigated the mounted 100k FileExplorer directory, and timed actual Go request cancellation on owner action. The complete nine-case native `FILEEXPLORER_DESKTOP_GO_CANCEL_100K_SUMMARY` stdout is archived in [P037 raw CI JSON](performance-evidence/file-explorer-desktop-go-cancel-100k/ci-run-38254019068.json), alongside [original native artifact #11749527989](https://github.com/lazyxu/xdrive/actions/runs/38254019068/artifacts/11749527989). This archive changes the work SHA; source-exact **new evidence-head native n3 and full CI/final-gate are mandatory** before merge.

| Real Desktop action | Independent n3 max Go cancel notification (ms) | Mode P50 (ms) | Mode worst (ms) | Go Context.Done | Still active +160ms | Extra bytes |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Virtual 100k scroll to 50% | 42.050 / 72.082 / 55.905 | 55.905 | 72.082 | 18/18 | 0 | 0 |
| Switch to Desktop Home | 41.438 / 71.772 / 35.341 | 41.438 | 71.772 | 18/18 | 0 | 0 |
| Destroy actual BrowserWindow | 5.382 / 6.463 / 4.718 | 5.382 | 6.463 | 18/18 | 0 | 0 |

**Frozen result:** 9/9 actual actions, 6 authenticated in-flight JPEG streams per session, **54/54 real Go Context.Done and 54/54 cancelled Handlers**, maximum notice **72.082ms versus predeclared <=160ms**; old active Handler at +160ms **0**, stale payload **0**. Each initial real HTTP stream sent 256 bytes before a fixture-only 1500ms slow writer hold. After each action an independent owner-scoped xdrive-agent cloudChildrenRange returned exactly 200 rows starting at offset 50000 with total_count 100000. Max post-seed Go Agent RSS growth **5,881,856 bytes (5.61MiB)** versus cap **134,217,728 bytes (128MiB)**. Go CPU and WAN performance were not measured and no CPU/network speedup is claimed.

**Decision: Accepted CURRENT / AFTER=N/A / speedup N/A.** Current production already releases request-scoped resources within the original limits, so do not alter AbortSignal → Desktop Main IPC → Go Agent → Gin request.Context. This n3 measures 100k Node/File metadata with only **16 distinct physical JPEG originals per fixture**, not 100k simultaneous physical media decodes, video/Live/RAW/HEVC, physical Windows, WAN, durable Task Center operation cancellation or Race absence. Pre-measurement [CI #38252660274](https://github.com/lazyxu/xdrive/actions/runs/38252660274) and [CI #38253465403](https://github.com/lazyxu/xdrive/actions/runs/38253465403) did not produce complete valid n3 results and are retained as Invalid harness, not genuine product regression.

### Execution and decision rules

Run the new opt-in [branch-only GitHub workflow](https://github.com/lazyxu/xdrive/actions/workflows/file-explorer-desktop-go-cancel-100k.yml) with `XD_FILEEXPLORER_DESKTOP_GO_CANCEL_100K_PERF=1`; its real Go binaries are compiled from the exact PR head, the genuine `web/dist` and production Desktop are built, Node tests assert the frozen 160ms/54-Context/physical-data bounds, and Linux Xvfb runs Electron/Agent/Gin. The native workflow archives authentic `sample-*-*.json`, summary, and failure diagnostics as GitHub Actions artifacts.

**CURRENT first**. If all gates pass, accept as measured CURRENT, leave production unchanged, `AFTER=N/A`, performance improvement N/A. If a genuine product `Context.Done` violation occurs, freeze the actual **Measured RED**, attribute which of Renderer AbortSignal / Main IPC owner / Agent HTTP / Gin handler / cache consumer failed, and **only then** propose the smallest strictly performance-scoped fix with matched alternating n≥3 BEFORE/AFTER. If driver cannot navigate/login, the Go fixture schema is incomplete, no genuinely in-flight requests materialize, or the runner fails before any valid data, mark **Invalid harness** and fix the fixture without calling it product RED or relaxing the budget. Preserve rejected/invalid runs in the central register and this document.

**Acceptance boundaries:** automated Linux/Xvfb native Electron ≠ installed Windows hardware; no 4GiB/real WAN, H264/live/RAW/HEVC, 100k physical media decode, CPU-heavy shared derivatives, or user cancellation of durable tasks is claimed. **The completed benchmark-only PR updated this registry and canonical document with its raw source-exact evidence and passed final evidence-amended native + full PR `final-gate` before #1562 merged.** Any new workload must meet those same gates. No GitLab or physical device results are claimed until executed.

**Post-merge handoff:** the original nine-case CURRENT n3 and frozen 160ms/no-waste contract remain the acceptance proof; the final evidence-head [native #38256126554](https://github.com/lazyxu/xdrive/actions/runs/38256126554) plus [full CI #38256126976](https://github.com/lazyxu/xdrive/actions/runs/38256126976) independently validated the accepted one-work-commit source, without altering `ctx.cancel` or any durable file/sync/delete task. #1185 remains a separate blocked Gallery IPC progress investigation, not a FileExplorer cancellation regression. The next unmeasured M002-b scope is Desktop FileExplorer 100k *mixed actual media* (H264/Live still+motion/RAW/HEVC), not a rerun of the accepted P035 100k physically distinct JPEG Grid/Details samples; no new M002-b timings are claimed here.

---

## P0 — P035 / M002-a real Desktop FileExplorer distinct physical 100k JPEG Grid/Details five-viewports (2026-10-12)

**Status: P035 / M002-a Accepted CURRENT — independent n3 physical Desktop JPEG Grid/Details five-viewport benchmark #38227611946 succeeded on source-exact `f7eb069f32388c85f033eb7dcad9e760425951d5`; frozen time, concurrency, DOM, bytes, memory and correctness budgets all passed. No production change, AFTER=N/A; evidence-amended final-head CI/merge still required.** Frozen baseline master@6b090d354cc692ceab8ab9e10a9ac58c4ea58483, branch perf/file-explorer-desktop-physical-jpeg-100k-20261012; one work commit. The central Performance Test Registry is authoritative for deduplication and is linked in AGENTS.md.

**Why this differs from accepted history:** P006 truly wrote 100k different valid JPEGs and measured Web Chromium Grid/Details, but the real production Desktop Main/Preload/Renderer → Go Agent IPC was not involved. P007 physically wrote 100k unique H264 MP4 containers but decoded only six sampled original videos (all sharing the same encoded bitstream); no Desktop FileExplorer mounted Grid/Details scroll. P003 was Desktop Gallery first-paint, not Desktop FileExplorer. This P035/M002-a is an entirely distinct execution layer, not a repeat of P006. Full mixed H264/Live/RAW/HEVC Desktop coverage remains M002-b.

**Frozen authentic fixture and operation:** Three fresh real PostgreSQL17 schemas plus physical local CAS data roots, each with exactly 100,000 SHA-distinct actually decodable 80×64 JPEG original bodies with individually generated 20-bit tile patterns and one owner-authenticated Node/File/MediaMetadata per original. Reuse the accepted native Go test fixture TestFileExplorerRealWebScrollCancelFixture100K with its physical-JPEG flag solely for data and Gin routing, not its Web browser. Start real cmd/xdrive-agent, authenticate the fixture account over Gin, then start the genuine built xDrive Electron Main/Preload/Renderer; navigate through the actual Desktop Sidebar Files item, double-click the actual 100k Images directory item, set Grid or Details using the real persisted preference, and programmatically scroll the actual DOM virtual host to 0%, 25%, 50%, 75%, and 95%. Assert at least six newly decoded SHA-distinct JPEG IDs per viewport (not 100k simultaneous decodes), active Go media-thumbnail HTTP counters, true response bytes and correct 100k directory total. Three independent fixtures times two mode sessions each = six real Electron samples and 30 sampled viewports. Source seeding/login/Electron boot are separately excluded from viewport stopwatch.

**Predeclared CURRENT acceptance before native execution:** 3/3 independent actual 100k CAS files, matching metadata and >50,000,000 real original-byte total each; both modes and five scroll fractions authentic; >=6 fresh decoded JPEG tiles per viewport, <1000 mounted FileExplorer DOM items, <=20,000ms wall time for each viewport, <=6 concurrent real Go media-thumbnail GET handlers, zero un-aborted Go HTTP errors, positive handler requests and response bytes, and post-start Renderer working set, Go Agent RSS and Go fixture RSS growth all <=268,435,456 B (256MiB) during every measured mode. Capture per-viewport first-six wall time, per-mode independent n3 medians, Go/CAS requests and payloads, observed cancellation count (diagnostic only), Electron Main user/system CPU and per-process memory. Warm caches between two views of the same fixture must be identified as a limitation, not advertised as independent cold-media timings; actual physical fixtures reset per sample.

**Strict decision:** benchmark ORIGINAL production first. If every independently measured fixture and correctness/resource budget passes, Accepted CURRENT, no production change, product AFTER=N/A, no speedup. If a genuine product-red recurs, isolate fixture, disk, decoder, IPC, Range, HTTP, Go, and Renderer stages before attempting the smallest performance-only change, then measure matched alternating n3 BEFORE/AFTER under the identical workload. Do not touch Race, loosen budgets or cancel durable Task Center jobs.

**Exclusions:** no 100k physical H264/HEVC/RAW/LIVP or Live motion, not all 100k decoded concurrently, no physical Windows/macOS GPU screen, WAN, 4GiB incompressible transfer, uploader/sync/deletion throughput, user cancellation, request Context.Done timing or M005 shared-thumbnail last-consumer CPU work. Only visible viewport thumbnails are sampled, so the physical 100k original count and decode count must be reported separately.

**First native CI failure / preserved invalid evidence (2026-10-12):** [exact original work SHA 72c3b5cc / Actions #38213017974](https://github.com/lazyxu/xdrive/actions/runs/38213017974) successfully built real Web/Desktop/Go, produced 100k distinct physical JPEG CAS originals (70,893,376 physical bytes) and authenticated the real Agent, but the actual Electron grid process exited after a 45s wait for the seeded `100k Images` root item. [Original logs](https://github.com/lazyxu/xdrive/actions/runs/38213017974/artifacts/11730507860) show no valid viewport sample, and the shell's genuine read-only polling hit absent `xd_sources`, `xd_node_changes`, `xd_file_operations`, `xd_file_recent_access` and other unmigrated physical-fixture models, causing 500s. This is **Invalid harness / no measured BEFORE**, not a product performance failure. Continue the same named P035 on the same one-work-commit branch with physical-mode-only real-model migrations plus scoped native DOM failure diagnostics; do not alter the frozen 20s/6/256MiB budgets or production code. Retain this red CI rather than counting it as an accepted sample. The next source-exact native n3 must still prove actual folder navigation and six new JPEG decodes per viewport before performance conclusions.

**Second invalid native CI / exact root cause (2026-10-12):** The [amended SHA ba381ed4 specialized run #38215287891](https://github.com/lazyxu/xdrive/actions/runs/38215287891) still failed before the first viewport, with artifacts at [#11732027961](https://github.com/lazyxu/xdrive/actions/runs/38215287891/artifacts/11732027961). This time the real Electron DOM diagnostic confirmed **Sidebar “文件” selected and FileExplorer mounted, but root showed exactly 0 items**; the separate real Agent successfully listed the seeded directory, and the same 100,000 unique original JPEG CAS objects totalled 70,893,376 bytes. The fixture Gin logs identify one `GET /api/v1/me/quota` HTTP 500 caused by unmigrated `xd_upload_sessions`, plus recurring `xd_background_owner_cancellations` 500s. In the *unchanged* shared production `useXDriveCloudFilesController.loadInitial`, `Promise.all([port.getQuota(), port.getRoot()])` rejects on quota failure, so the root directory range is never requested: this is a **fixture-schema precondition**, not performance or rendering throughput. Add `meta.UploadSession` and `meta.BackgroundOwnerCancellation` **only** to the opt-in physical fixture migrations, retain same real-authenticated Explorer path, preserve all original acceptance budgets and keep this second red run as Invalid harness. Only valid n3 physical scroll timings can establish P035 BEFORE. No product changes, no extrapolation from invalid navigation timing.

**Third invalid native CI / complete quota gate (2026-10-12):** [SHA 9651dbe2 specialized run #38216336850](https://github.com/lazyxu/xdrive/actions/runs/38216336850) [raw diagnostic artifact #11731274463](https://github.com/lazyxu/xdrive/actions/runs/38216336850/artifacts/11731274463). The previous schema failures were gone and the genuine quota aggregation SQL returned one row, but the real Desktop still displayed 0 FileExplorer items: `GET /api/v1/me/quota` returned `load storage capacity failed (500)`. Independent code review shows test-only `fileExplorerMediaPerfStore` satisfies base `storage.Store` but **does not implement the production `storage.CapacityReporter`** required by `Server.storageCapacity`. `storage.NewLocal` itself supports actual `Capacity(ctx)`. An opt-in `fileExplorerPhysicalCapacityStore` now embeds the existing IO-counting wrapper and delegates capacity to the real `storage.Local.Capacity` (no simulated capacity or production code changes). This third CI also identified absent `xd_sync_runs` and `xd_archive_prepare_runs` used by the real background task shell, so only the physical fixture migrates their authentic models. Before 100k JPEG data generation, authenticated native quota, background active summary and task list HTTP200 preflights enforce all discovered bootstrap contracts and fail early as Invalid harness rather than wasting repeated full native runs. Retain all three exact red logs and original frozen measurement thresholds. Do not fabricate CURRENT latency, CPU or memory values.

**Fourth invalid native CI / populated Grid, obsolete mode assertion (2026-10-12):** Same one-work-commit `b18a086cee`, [authentic Desktop CI #38217553931](https://github.com/lazyxu/xdrive/actions/runs/38217553931), [Electron/fixture raw artifact #11733506139](https://github.com/lazyxu/xdrive/actions/runs/38217553931/artifacts/11733506139), [sanitized source-exact evidence](performance-evidence/file-explorer-desktop-physical-jpeg-100k/ci-run-38217553931-invalid.json). Unlike previous fixture failures, the real Agent logged in, seed directory opened, and mounted FileExplorer showed **100,000 items**, 64 DOM tiles, and 1,849,363 px scroll range after creating 100,000 distinct JPEG files (70,893,376 B). The benchmark script demanded the **compact-layout** Grid label `网格` even though the actual shared wide Desktop UI reports `当前视图：图标 · 中图标`; the first viewport timer was never reached. The failure is solely **Invalid harness**, not a measured performance regression. Correct only this opt-in assertion to recognize wide `图标 ·` vs `详细信息 ·`, add a source-contract test referencing the real shared view-label generator, and rerun exact-head full native 3 × (Grid+Details) × five viewports. Do not change product, original thresholds, or claim a measured BEFORE/AFTER from this failed session.

**Fifth source-exact native CI: first real Grid five-viewport measurement; Details mode harness bug (2026-10-12):** [CI #38226110547](https://github.com/lazyxu/xdrive/actions/runs/38226110547), [artifact #11736903597](https://github.com/lazyxu/xdrive/actions/runs/38226110547/artifacts/11736903597), [durable partial JSON](performance-evidence/file-explorer-desktop-physical-jpeg-100k/ci-run-38226110547-partial.json). In the same first fixture of 100k different JPEG originals (70,893,376B), **one real production Electron Desktop Grid session passed all 5 scroll viewports**, first-six times `321.605, 1165.530, 547.429, 850.518, 596.862 ms`, five-viewport median **596.862ms**; max mounted 88, HTTP thumbnail requests 133, bytes 87,242, max active 6, zero HTTP errors; Renderer working-set growth 78,979,072B, Agent RSS 3,235,840B, fixture Go RSS growth 0B. This is **one valid Grid sample, not a full n=3 acceptance**. Next real Details session rendered **Grid** even though the harness had set `localStorage` to `details` just before clicking Files: the already-initialized Desktop workspace controller owned an older view value in React, so storage mutation alone did not change live UI. The Details view fail was another opt-in harness issue **before any Details timing**; not a measured application performance RED. The scoped fix opens the actual shared FileExplorer View command button and clicks the production MenuItem `详细信息` (or `中图标` for Grid), then asserts exact wide view status. Test-only UI action, no performance budget or production modification. All three fixture sessions/two views/five positions still required for P035 final benchmark. Full-prior CI additionally had unrelated `server-validation` host-install-manager failure; diagnose independently, do not treat as file-explorer speed data.

**Sixth real native n3 CURRENT — all budgets passed, product unchanged (2026-10-12).** [Source-exact specialized CI](https://github.com/lazyxu/xdrive/actions/runs/38227611946) (source `f7eb069f32388c85f033eb7dcad9e760425951d5`) succeeded after [five prior invalid/partial investigations](performance-evidence/file-explorer-desktop-physical-jpeg-100k/ci-run-38226110547-partial.json). [Raw six-session JSON](performance-evidence/file-explorer-desktop-physical-jpeg-100k/ci-run-38227611946.json) and [CI artifact #11737628022](https://github.com/lazyxu/xdrive/actions/runs/38227611946/artifacts/11737628022) preserve original latency, RSS, CPU, real thumbnail HTTP request and byte counters. Three independent native PostgreSQL17 + actual 100,000 SHA-distinct individually decodable 80×64 JPEG original CAS fixtures persisted **70,893,376 bytes each**. Six actual production Desktop sessions (3×Grid plus 3×Details) drove 5 DOM scroll positions each, requiring >=6 new decoded thumbnail IDs at every viewport, actual Main/Agent/Gin and media bytes. The frozen output reports **Grid median-of-3 viewport medians 725.375ms**, **Details 601.031ms**. Across 30 real viewports, max time **1257.055ms** (budget 20,000ms each), max mounted DOM **88** (<1,000), live Go thumbnail requests **415**, actual response bytes **266314B**, max HTTP handlers **6** (budget 6), errors **0**; peak post-start Renderer working set growth **99336192B**, Agent RSS growth **5013504B**, Go fixture RSS growth **1212416B**, each under the original 268,435,456B budget. All six samples passed. Per-session source original count, viewport decoded IDs, exact timings and CPU remain in raw JSON; note Grid→Details within each independent fixture may reuse warmed storage/media state. Current implementation **Accepted CURRENT / no production optimization / AFTER=N/A**, no matched performance increase can be computed. Excludes physical diverse H264/LIVP/RAW/HEVC, Mobile, Windows hardware, WAN, real persistent Push/Pull bytes and request cancellation latency. Evidence amendment changes source tree and therefore requires new exact-head native CI and full PR final-gate before merge, despite the original successful measurement run.

**Source/reproduction:** branch-only .github/workflows/file-explorer-desktop-physical-jpeg-100k-performance.yml, flags XD_FILEEXPLORER_DESKTOP_PHYSICAL_100K_PERF=1, XD_TEST_DATABASE_URL and paths for compiled Go API fixture/Agent/JSON output; npm Desktop+Web production build; go test -c ./internal/api and go build ./cmd/xdrive-agent; execute xvfb-run node desktop/scripts/file-explorer-desktop-physical-100k-runner.cjs. Upload six per-view JSON, summary.json and log files. Source-exact CI is the only authority for measured timings, not these planned budgets. After obtaining valid native n3, archive raw output under docs/performance-evidence/file-explorer-desktop-physical-jpeg-100k, amend this document and central P035 in the SAME single work commit, rerun exact amended-head native benchmark and full PR final gate before merge; if the fixture fails, mark Invalid harness rather than invent product-red numbers. No GitLab or physical-device completion claimed.

---


## P0 · Real 100k different physical H264 MP4 CAS sources, sampled Chromium decode (2026-10-11)

**Status: Accepted native 100k physical MP4 CURRENT n=3; production unchanged, AFTER=N/A, evidence-amended final-head CI pending.** Fixed GitHub `master@dc8c8fbeb86d64e43b6bb4fde916a1052165baae`, exactly one benchmark-only work commit on `perf/file-explorer-physical-h264-100k-20261011`. The only unfinished unrelated performance PR [#1185](https://github.com/lazyxu/xdrive/pull/1185) concerns Desktop Gallery progress event completion and stays blocked Draft; this fixture does not touch that IPC behavior or Race. `AGENTS.md` already requires same-workload BEFORE then AFTER only when a genuine performance failure is shown, so no redundant policy update.

**Earlier separate evidence, NOT this workload's BEFORE:** original [#1271](https://github.com/lazyxu/xdrive/pull/1271) real Chromium 100k-*metadata* H264 video-poster test sampled six physical 96×64 MP4 originals per independent schema: cold P50 about **17.7ms**, warm-cache P50 about **3.6ms**, with the production signed Preview Engine → Chromium first-frame decoder → JPEG poster PUT → warm GET. The other 99,994 video entries were metadata-only, not physically stored. This does **not** establish performance of 100k different physically stored originals and must not be used for a speedup or slowdown claim here. Authentic FileExplorer physical 100k JPEG Grid/Details [#1402](https://github.com/lazyxu/xdrive/pull/1402) already met its independent current budget.

**Frozen new workload** `file-explorer-physical-h264-100k-current`: three fresh PostgreSQL17 schemas and three fresh local CAS directories; each persists exactly **100,000 SHA-distinct valid MP4 container byte arrays** with one-to-one signed owner-scoped Node/File/MediaMetadata rows and independently stored content-addressed CAS objects. The containers share the SAME prevalidated **96×64 H264 encoded frames**, using a 12-byte index-specific trailing ISO BMFF `free` box for byte-distinctness. This exercises 100k physical CAS objects and PostgreSQL metadata, **NOT** 100k distinct independently encoded videos, 4K/HEVC decode, Live Photo motion, RAW, actual mounted Grid/Details window scrolling or simultaneous 100k decodes. Verify every physical write and unique digest; PostgreSQL unique-sha and media correspondence; read back first/middle/last physical originals; then from each of the three source areas cold-decode **2 real MP4s** through the production authenticated Preview Engine and actual Chromium `HTMLVideoElement`/canvas/JPEG poster path, PUT six revisioned posters, then warm-decode six cached JPEGs without reopening MP4 originals. The Go test seeding, binary compilation and 100k physical file creation are measured separately and **excluded** from browser cold/warm poster latency.

**Acceptance fixed before first native run:** 3/3 fresh independent PostgreSQL/CAS/Electron browser sessions; per fixture exactly 100k real CAS containers/100k unique SHA and 100k matching persistent metadata rows, exact source length `100000 × (H264 source bytes+12)`, three physical CAS read-back proofs, HTTP directory range `200/100000`, all six true H264 first-frame decodes and six correct JPEG saved/warm restored with **0 cached warm original video Store.Open**, each sampled cold poster `<15000ms`, native Go sampled VmRSS growth after seed **≤256MiB** and renderer working-set growth **≤256MiB**. Record three complete raw sample sets, cold/warm times, HTTP/CAS original and poster reads, persisted source-byte total, native Go sampled RSS/CPU and browser Renderer working-set snapshots. No user WAN, physical Windows/macOS, source-encoding diversity or full 100k viewport sampling claims. A failure in CAS physical write, fixture decode or runner capacity must be classified separately from a repeatable product performance red.

**Decision:** measure unchanged production CURRENT. If all original gates pass, **Accepted current unchanged code; AFTER=N/A, speedup=N/A**. If genuinely red, retain raw source-exact evidence, first isolate whether fixture/codec/disk or product, then make the smallest performance-only change and rerun the same native n≥3 workload as paired BEFORE/AFTER; keep only a repeatable material improvement with no RSS/CPU/IO/correctness regression. Do not modify production Preview Engine/Agent/Task Center or cancellation behavior in this benchmark-only PR.

**Reproduction:** `XD_FILEEXPLORER_REAL_H264_PHYSICAL_100K_PERF=1 XD_FILEEXPLORER_H264_TEST_BINARY=desktop/real-physical-h264-bin/api.test XD_FILEEXPLORER_REAL_H264_RESULTS=desktop/real-physical-h264-100k-results XD_TEST_DATABASE_URL=postgres://... xvfb-run -a ./desktop/node_modules/.bin/electron --no-sandbox desktop/scripts/file-explorer-real-h264-100k-main.cjs` after `go test -c -o desktop/real-physical-h264-bin/api.test ./internal/api` and desktop npm setup. Scoped exact-checkout workflow `.github/workflows/file-explorer-real-physical-h264-100k-performance.yml`, 3 raw `sample-*.json`, `summary.json` and Go fixture logs. **CURRENT native n=3 now measured on original source; see source-exact results and archived raw evidence below.** Record original SHA/job/runner and complete raw result in `docs/performance-evidence/file-explorer-physical-h264-100k/` and amend this canonical document **within the same one-work-commit PR**, then require exact amended-head scoped CI and full GitHub PR `final-gate` green before Ready/linear merge and branch cleanup. GitLab and physical-device runs not claimed.


### Source-exact 100k physical H264 CURRENT n=3 — accepted baseline (2026-10-11)

**Original native [scoped CI #38150707819 / job #114503397039](https://github.com/lazyxu/xdrive/actions/runs/38150707819/job/114503397039) SUCCESS** on exact one-work-commit `6783d0452a34e45152817f40c924ad34292f339f`; original [full PR CI #38150707969](https://github.com/lazyxu/xdrive/actions/runs/38150707969) including `final-gate` SUCCESS. Three independent native Ubuntu 24.04/PostgreSQL17/local CAS+Electron Chromium sessions wrote **100,000 SHA-distinct real MP4 containers per session**, **297,000,000 bytes** and correct persisted Node/File/MediaMetadata hashes; sampled first/middle/last source CAS readback passed; each of six sampled H264 videos actually produced a JPEG poster (six original reads, six revisioned PUTs), and all six warm cache JPEGs decoded with **zero original-video reads**. These are 100k different real MP4 *container files* sharing one 96×64 H264 encoded frame sequence, **not** 100k different encoded H264 videos or a mounted FileExplorer Grid/Details 100k scroll test.

| Independent fixture | Physical MP4 objects | Physical source bytes | 6 cold H264 poster P50 | 6 warm cached JPEG P50 | Source seeding excluded | Go after-seed RSS growth sampled | Renderer working-set growth |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 100,000 | 297,000,000 B | 18.500 ms | 2.800 ms | 53616.193 ms | 28,672 B | 20,156 KiB |
| 2 | 100,000 | 297,000,000 B | 18.600 ms | 2.800 ms | 46860.123 ms | 36,864 B | 19,700 KiB |
| 3 | 100,000 | 297,000,000 B | 18.500 ms | 2.900 ms | 54606.099 ms | 16,384 B | 19,860 KiB |
| **Across-fixture middle P50 / maximum resource growth** | **100,000** | **297,000,000 B** | **18.500 ms** | **2.800 ms** | — | **36,864 B max** | **20,156 KiB max** |

**Budget verdict:** 3/3 true physical PostgreSQL/CAS/Chromium fixtures, 18/18 cold H264 first-frame poster captures, 18/18 persisted warm JPEG decodes, 0 warm original media opens, every cold image <15,000ms, measured native Go post-fixture RSS growth ≤256MiB and Renderer working-set growth ≤256MiB: **PASS**. Original elapsed and resource metrics are **first CURRENT only**, not a product before/after timing comparison with the previous six-real-MP4 baseline. **Decision: ACCEPT unchanged production, AFTER=N/A, shipped speedup=N/A.** Node metadata and 100k CAS source creation time (46.860–54.606s) is excluded from browser capture timing; native whole-process Go VM figures are collected after fixture seed, not absolute process peaks. Native CPU during sampled browser work was 20.000 / 20.000 / 20.000 ms; no separate new transfer/sync/delete or request-cancellation optimization is made.

[Raw immutable n3 evidence including each of six cold and warm samples, CAS counters, resource readings and benchmark source SHA](performance-evidence/file-explorer-physical-h264-100k/ci-run-38150707819.json) is committed at `docs/performance-evidence/file-explorer-physical-h264-100k/ci-run-38150707819.json`; [original full run artifact](https://github.com/lazyxu/xdrive/actions/runs/38150707819/artifacts/11705494750) contains runner samples/logs. The source document/evidence amendment **changes work SHA** and therefore still requires a fresh exact amended-head **scoped 100k n3 + full GitHub PR `final-gate` success** before Ready/linear merge and branch cleanup. GitLab, physical hardware, actual 100k independently encoded movies/HEVC/RAW/LIVP, mounted browser virtual scroll and Desktop Agent FileExplorer are still unmeasured in this workload.



## P0 · 100k physically distinct decodable JPEG sources / real shared Web FileExplorer Grid & Details viewports (2026-10-11)

**Status: Accepted genuine CURRENT after n=3 native PostgreSQL/Chromium baseline; unchanged product, evidence-head CI pending.** Fixed GitHub master `a3f2bd46f4d1f9e4c1b50115af285526db7091e7`, one work commit above that baseline on `perf/file-explorer-physical-jpeg-100k-20261011`. Existing related FileExplorer real 100k Grid/Details scroll→Gin Context n=3 × 2 #1298 is already merged and its branch removed: **36/36** old HTTP/JPEG requests canceled, worst upstream Go notification **51.153ms ≤160ms**, zero obsolete bytes/handlers at +160ms; that test used **100,000 Nodes/Files/MediaMetadata but only 16 distinct real JPEG CAS originals**, warmed six visible JPEGs, so it did NOT qualify 100k physical originals or actual cold viewport decode. Previous synthetic 100k image/video/Live Grid/Details n=24 windowing structural tests (≤110 mounted/6 thumbnail concurrency) are also distinct scopes. Blocked Draft #1185 concerns genuine Desktop Gallery IPC *progress callback completion*, not this Web FileExplorer benchmark; preserve it untouched. `AGENTS.md` already requires named BEFORE then only a proven product-red optimization with matched AFTER; no policy rewrite is needed.

**New named workload** `file-explorer-web-real-physical-jpeg-100k-multiview-viewport-decode`: create **exactly 100,000 different, valid JPEG byte arrays**, each representing a unique visible 20-bit tile pattern encoded with real `image/jpeg` at **80×64**, with independently computed SHA256 and a **different physical `Local CAS` source object**; one-to-one PostgreSQL17 real Node+File+MediaMetadata rows, exact authoritative signed 100k directory pagination, original HTTP Media thumbnail endpoint. Verify all 100k distinct CAS digests and three first/middle/last original physical bytes by true read+JPEG decode. Seed and actual 100k original-file creation are timed and sized separately; do NOT present these synthetic 80×64 source JPEGs as real customer photos, RAW or video codecs. After creation, reuse actual shared `XDriveFileExplorer` `Grid` and `Details` with native Chromium, real virtual range/thumbnail scheduler, five actual scroll positions **0%, 25%, 50%, 75%, 95%**, and verify at least **six genuinely decoded `HTMLImageElement` JPEGs** (nonzero naturalWidth/Height) from each *new* mounted viewport. **n=3 independent PostgreSQL/CAS fixtures**, two real Web views per fixture, **30 sampled viewport windows** and at least 180 decoded visible thumbnail observations; not 100k simultaneous image decodes. Server counts real image GETs, bytes, errors and peak active requests; Renderer/Go process RSS and CPU diagnostics are sampled after fixture generation, not conflated with initial large-scale ingest.

**Predeclared acceptance BEFORE any product optimization:** all n=3×Grid/Details×5 viewport scenarios correct, 100k individual physical JPEG CAS originals and 100k metadata rows per fixture, all five locations show ≥6 valid decoded thumbnails, each first-six viewport completion **≤20,000ms** including real signed children GET+thumbnail+Chromium decode, mounted item nodes **1–999**, actual new ID windows on scroll, peak real thumbnail HTTP **≤6 active**, zero HTTP errors, real positive served image bytes, Renderer and measured native Gin RSS peak growth each **≤256MiB** over post-fixture baseline. Record timings, real HTTP request/byte counts, peak process resources, CPU and fixture seed time independently. A failed test must be classified by exact first-red layer (PG17 fixture, disk/inode capacity, JPEG generation, browser range/codec, true product performance), never silently passed via synthetic SVG or relaxed threshold.

**Decision:** run existing current production. If every frozen budget passes, **Accepted unchanged product; product AFTER=N/A, speedup=N/A**. If reproducible real product-red appears, preserve evidence, propose smallest **performance-only** fix then run identical samples and source data shape BEFORE/AFTER and retain only material repeatable gains without CPU/RSS/IO/request/correctness regression; do not change Race fences, App Frame UI, native Desktop Agent, or durable uploads/downloads/sync/delete. The separate 160ms `AbortSignal→Go ctx.Done()` viewport cancellation qualification stays intact and is not replaced by this completed-thumbnail benchmark.

**Opt-in reproducibility:** `XD_FILEEXPLORER_REAL_PHYSICAL_JPEG_100K_PERF=1` native Go fixture `TestFileExplorerRealWebScrollCancelFixture100K`, `VITE_XDRIVE_FILE_EXPLORER_REAL_SCROLL_PERF=1` for shared Web `FileExplorerRealScrollPerformanceHarness`, real Electron `desktop/scripts/file-explorer-real-physical-100k-main.cjs`; branch-scoped GitHub workflow `.github/workflows/file-explorer-real-physical-jpeg-100k-performance.yml`. Existing 16-original cancellation harness remains unchanged by default. Publish immutable original-source n=3 raw reports under `docs/performance-evidence/file-explorer-real-physical-jpeg-100k/` and measured values here **in this exact single work commit**; after documentation amendment require a new exact-head scoped benchmark and full GitHub PR CI `final-gate=success` before Ready/rebase-linear merge and automatic branch cleanup. No GitLab or physical iOS/Windows/macOS measured; actual 100k HEVC/RAW/LIVP decoding and Desktop Main/Agent media proxy remain future distinct baselines.

### Invalid first source-exact CI measurement (2026-10-11) — test driver raced its own decoded-thumbnail assertion

**Original [native scoped CI #38135528897 / job 114458489344](https://github.com/lazyxu/xdrive/actions/runs/38135528897/job/114458489344), source commit `70511afab3e9b9c85c014835153313ebc6c8bd8c`:** the native Go/PostgreSQL17/CAS fixture **PASSED** after generating/writing **100,000 distinct real decodable 80×64 JPEG CAS objects** and 100k matching records, with **70,893,376 B** actual different encoded original source bytes, **72,036.906ms** fixture seed time excluded from UI stopwatch. It logged a successful signed children range and real 200-byte-plus production JPEG thumbnail responses after an actual 25% Grid scroll. The test-only Electron runner then raised `virtual FileExplorer thumbnail window recycled stale source` at `file-explorer-real-physical-100k-main.cjs:171` **before waiting for six newly decoded IDs**: it returned from its async `until` when *any* newly decoded ID appeared alongside old overscan thumbnails, but subsequently asserted at least six new IDs. This is an invalid **benchmark-driver premature success predicate**, not a proven product virtualizer/HTTP/Go cancel failure or valid n=3 renderer performance reading. No screenshot, six-view n=3, full real codec load nor product code speedup is claimed.

**Bounded test-only correction:** inside the existing `until` poll, return a valid mounted viewport state only after there are **at least six decoded items whose IDs were not present in the previous viewport**. Retain the originally frozen **≤20,000ms** measured first-six completion acceptance, 100k unique CAS physical objects, n=3×2×5 coverage, 1–999 mounted nodes, ≤6 real HTTP active, zero HTTP errors, 256MiB peak memory budgets, and Go/native request correctness. Do **not** relax the criterion to one new image, assume an old image is decoded in the new viewport, change production thumbnail scheduler, or count the 72-second fixture setup as browser latency. Source-exact initial log/error and native seed proof: [invalid-ci-38135528897.json](performance-evidence/file-explorer-real-physical-jpeg-100k/invalid-ci-38135528897.json). The original full job failed deliberately on the invalid harness assertion; a new complete source-exact native n=3 and full CI must pass on the amended **single work commit** before considering any acceptance.

### Invalid second native CI probe — expected scroll-abort 404 misclassified as missing JPEG (2026-10-11)

**Original [native scoped CI 38135972440 / job 114459791160](https://github.com/lazyxu/xdrive/actions/runs/38135972440/job/114459791160) on exact source `804311cc27d920dc79c21ab5033b66823d1f0613`:** test-only fresh-six-ID wait correctly let the first **100k-distinct-physical-JPEG** fixture complete **both** mounted real Web Grid and Details at 0/25/50/75/95% positions. Actual native Web first-six decode durations per position in Grid **524.007 / 509.546 / 466.033 / 451.323 / 12.279ms** (P50 **466.033ms**), Details **463.718 / 336.781 / 397.818 / 371.802 / 423.324ms** (P50 **397.818ms**); mounted items **≤121 Grid / ≤40 Details**, real HTTP peak six, Renderer working set growth **106,016,768 B / 85,217,280 B**. Second 100k physical fixture completed its five Grid positions with decode **528.915 / 440.807 / 449.625 / 467.809 / 499.838ms**, P50 **467.809ms**, peak six HTTP. All retained raw partial samples and physical CAS fixtures are *real*, but **this is NOT n=3 complete acceptance**.

**First-red classification:** during the second fixture's Details fast virtual scroll, the original Go/Gin console shows `context canceled` for real `xd_files` lookup on already abandoned item 25015, followed by **one HTTP 404 / 26 B** after cancellation; 202 other signed thumbnail GETs returned 200 in that native fixture. The new benchmark probe counted *every* HTTP error status ≥400 as a missing JPEG, including a route whose upstream `r.Context().Err()!=nil`. That made the runner fail `genuine JPEG thumbnail HTTP failures` after the viewports; **it is not a proven missing real CAS source, failed image decode, or product performance regression**. Original [source-exact invalid run JSON](performance-evidence/file-explorer-real-physical-jpeg-100k/invalid-ci-38135972440.json) includes the three actual successful partial viewport rows and no invented third sample.

**Test-only correction:** classify HTTP statuses ≥400 with **already-canceled server Request.Context** separately as `canceled`; keep every real non-canceled 4xx/5xx as `failed` and require exactly zero `failed`. Record canceled old request count in the raw sample/summary alongside bytes and peak active Handler count. No change to Go production media handler, browser AbortSignal, cancellation semantics, shared scheduler or frozen acceptance: ≥6 **new decoded JPEG IDs** each viewport in **≤20,000ms**, 100k unique physical CAS files and metadata, 3×2×5 visible-range observations, HTTP peak ≤6, Renderer/Go RSS growth ≤256MiB, real authenticated HTTP body sizes. Original baseline old-viewport abort measurement remains distinct and unmodified. Require fresh original/current n=3 on amended one-work-commit SHA before accepting.

### Accepted source-exact n=3 genuine 100k distinct physical JPEG viewport benchmark (2026-10-11)

**Native [CI #38136433428, job #114461140913](https://github.com/lazyxu/xdrive/actions/runs/38136433428/job/114461140913) SUCCESS on original measured one-work-commit `3537f9786fea364fef4a71acd235cc4b7f46b498`.** Three independent PostgreSQL17 schemas and physical Local CAS roots each persisted **100,000 actually different, decodable 80×64 JPEG source files totaling 70,893,376 B**, owner-scoped Node/File/MediaMetadata, SHA256 and physical CAS readback checks. True mounted shared Web FileExplorer Grid and Details each scrolled to **0/25/50/75/95%** of 100k virtual namespace, 30 real viewport positions across n=3; at least six `HTMLImageElement` JPEGs completed decode with fresh Node IDs per position. **This is viewport sampling with 100k physical sources, NOT simultaneous 100k image decoding.**

| PostgreSQL/CAS fixture | Grid five-viewport first-six-decode P50 | Grid worst | Details five-viewport P50 | Details worst | Max mounted Grid / Details | Peak genuine HTTP concurrency |
| --- | ---: | ---: | ---: | ---: | --- | ---: |
| 1 | 470.653ms | 538.132ms | 407.638ms | 458.530ms | 121 / 40 | 6 |
| 2 | 457.736ms | 572.582ms | 424.032ms | 448.845ms | 121 / 40 | 6 |
| 3 | 455.079ms | 544.063ms | 421.246ms | 422.774ms | 121 / 40 | 6 |
| **Median of three within-fixture P50s** | **457.736ms** | — | **421.246ms** | — | **≤121 / ≤40** | **≤6** |

**Every one of 30 real newly decoded viewport measurements satisfied the frozen ≤20,000ms maximum.** Real signed HTTP JPEG request/byte counters are positive; **all genuine non-cancelled HTTP failures 0**, old scrolled-away `r.Context().Err()!=nil` requests are accounted as aborted rather than false source 404. Max Renderer working-set growth **113,709,056 B (108.44MiB) ≤256MiB**. Go process RSS growth after fixture generation **438,272 / 442,368 / 475,136 B**, max 0.453MiB; process CPU between fixture-ready and end of browser views **910 / 950 / 870ms**, measured at native server PID rather than Node. Original full 100k physical JPEG creation+PG fixture seed **70,913.053 / 67,051.977 / 66,662.466ms** is **excluded** from first-six-decode timer; it is not user upload/thumbnail performance. Test-only previous invalid runs [#38135528897](https://github.com/lazyxu/xdrive/actions/runs/38135528897) (premature six-fresh-image assertion) and [#38135972440](https://github.com/lazyxu/xdrive/actions/runs/38135972440) (expected context-cancelled old JPEG request HTTP404 miscounted as real JPEG failure) were retained in the preceding audit sections, *not* included as n3 valid samples.

**Decision: accept measured CURRENT, leave all production FileExplorer/Go/Agent/cache/cancel code untouched. AFTER=N/A; shipped speedup=N/A.** Original exact SHA's all six Web Grid/Details rows, 30 duration values, real JPEG HTTP requests/bytes, Renderer and native Go RSS/CPU, frozen gate values, source/CI provenance are archived at [ci-run-38136433428.json](performance-evidence/file-explorer-real-physical-jpeg-100k/ci-run-38136433428.json), with original [full Actions artifact #11701236114](https://github.com/lazyxu/xdrive/actions/runs/38136433428/artifacts/11701236114). This documentation/evidence amend changes the work SHA; require **new exact-head scoped real n3 + full GitHub PR CI including final-gate** before Ready/linear merge/branch cleanup. Physical 100k H264/RAW/LIVP, mobile hardware and Desktop Agent FileExplorer remain independent next P0 scopes.

## P0 · Real Web and Desktop 4GiB physical PostgreSQL/CAS transfer CURRENT qualification (2026-10-11)

**Status: Accepted CURRENT on original measured n=3 (production unchanged), evidence-amended source validation pending.** Fixed GitHub master baseline `a6bfcb37f99f0b11285e0fd6712eae984e6fac7e`, single-work-commit branch `perf/real-web-desktop-postgres-cas-4gib-20261011`. Related source-exact 1GiB real Web [#1364](https://github.com/lazyxu/xdrive/pull/1364) and real Desktop [#1375](https://github.com/lazyxu/xdrive/pull/1375) are merged and their performance branches removed. The only unfinished performance branch [#1185](https://github.com/lazyxu/xdrive/pull/1185) concerns blocked 100k Desktop Gallery progress callbacks, not bulk transfer; it remains Draft and unchanged. `AGENTS.md` already requires CURRENT/BEFORE→measured same-workload AFTER only if red; no policy update.

**Previously measured smaller workload, NOT a matched 4GiB BEFORE/AFTER:** authentic n=3 Web/Gin/PG17/CAS 1GiB P50 upload **12,827.100ms** and download **4,712.300ms**, max renderer WS increase **88.69MiB**, max actual Gin RSS growth **2.72MiB**; authentic Desktop Renderer/Preload/Main/Go Agent/Gin/physical CAS n=3 1GiB P50 upload **9,937.462ms** and download **3,457.113ms**, max renderer WS growth **70.80MiB**, Agent RSS growth **19.48MiB**, Gin RSS growth **4.56MiB**. Both 1GiB scopes passed original 240-second and ≤256MiB original budgets. **4GiB user-facing Web/Desktop has no authentic data yet**; previous mocks cannot qualify physical CAS or 4GiB performance.

**Named new unchanged-production workloads:** `real-web-postgres17-physical-cas-4gib` and `real-desktop-agent-postgres17-physical-cas-4gib`, each **n=3 independent** PostgreSQL17/Gin/local physical CAS and actual renderer sessions. Reuse the identical production 1GiB upload/download codepaths and harnesses, opting into size **4GiB** only through `XD_REAL_CAS_SIZE_GIB=4`; absence defaults to 1GiB and explicitly rejects any other size. The Server enforces one real authorized upload session, **512 × 8MiB HTTP PUTs totaling 4,294,967,296B**, physical CAS File/ContentBlob and SHA256, one authenticated full 4GiB GET. Real Web uses production XDriveApi prehash+upload and OPFS streaming download with exact 4GiB byte length and three **1MiB** start/middle/end zero-byte spot reads (**NOT full Web download SHA check**); Desktop uses real Electron Renderer→Preload→Main→Go Agent IPC for both actions, checks the complete local 4GiB downloaded file SHA256 against CAS. Both use sparse zero source to avoid unrelated fixture-generation cost; browser local loopback, page cache and 4GiB physical CAS are not WAN, cold-disk, incompressible media or GUI FileExplorer click timings.

**Predeclared accept/reject before any new production change:** each of 3 genuine isolated sessions per platform must finish 4GiB upload and download **each ≤360,000ms**, Renderer WS increase **≤256MiB**, native Gin and (for Desktop) Agent sampled peak RSS growth **≤256MiB**, native CPU numeric, exactly 512 actual HTTP PUTs and one GET, no skipped stage/partial data, complete persisted CAS, digest/metadata and response correctness. Report raw 3 sample times, MiB/s, P50, distinct process resource deltas, CPU and full bytes; source SHA, runner OS, supported size/codec boundaries and free-disk evidence. At least **14GiB free** in the native job's temp volume is required to hold CAS staging/final bytes and local OPFS/Desktop download, otherwise label `INSUFFICIENT_RUNNER_DISK / infrastructure unmeasured` rather than a product regression. High-size budget is deliberately a first baseline threshold, not a claim of linear scaling.

**Decision:** measure existing production first. If n=3 passes, mark **Accepted CURRENT / unchanged product, AFTER=N/A, speedup=N/A**. If a reproducible true product budget/integrity failure arises, preserve exact first red, distinguish CI disk/fixture errors, then do a minimal performance-only code change, same-source 4GiB BEFORE/AFTER and keep it only with meaningful repeatable gain without RSS/CPU/IO/correctness regressions. Do not change Race, upload/delete/sync task durability or viewport/request-scoped Go cancellation. Scoped PR-only two-job GitHub workflow `.github/workflows/real-web-desktop-cas-4gib-performance.yml`; capture exact n=3 JSON under `docs/performance-evidence/real-web-desktop-cas-4gib/` and update this document in the **same exactly-one-commit** branch, then run fresh exact evidence-amended scoped and full PR CI/final-gate before Ready/linear merge. GitLab not executed.

### First genuine current-source n=3 4GiB Web and Desktop results (2026-10-11)

**Status: Accepted measured CURRENT / production unchanged / AFTER=N/A.** [Native exact-source GitHub scoped CI 38131060742](https://github.com/lazyxu/xdrive/actions/runs/38131060742) measured single work commit `3b17916f8cc74be3c5244ce85b4e5a7263b44d28`, both independent native real [Web job 114445312154](https://github.com/lazyxu/xdrive/actions/runs/38131060742/job/114445312154) and [Desktop job 114445311888](https://github.com/lazyxu/xdrive/actions/runs/38131060742/job/114445311888) **SUCCESS**, three separate PostgreSQL17/Gin/physical-CAS fixtures each platform. All six samples per direction used the genuine shared production transport code: Web Chromium XDriveApi→Gin/physical CAS and OPFS, Desktop Electron Renderer→Preload→Main→Go Agent→Gin/CAS with independent local destination full SHA. Correctly completed exactly **4,294,967,296B per direction**, **512 authenticated real 8MiB PUTs**, **1 authenticated 4GiB GET**, File/ContentBlob physical size/digest and HTTP correctness in each session. This is **not** 100k physical video/RAW/LIVP nor 4GiB WAN or cold disk.

| 4GiB real native sample | Upload 1 (ms) | Upload 2 | Upload 3 | Upload P50 | Download 1 | Download 2 | Download 3 | Download P50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Web XDriveApi/Gin/OPFS | **62,507.700** | **52,367.500** | **57,861.000** | **57,861.000** | **13,608.300** | **13,188.400** | **13,050.900** | **13,188.400** |
| Desktop Electron/Agent/Gin/local SHA | **54,020.323** | **52,680.553** | **52,814.412** | **52,814.412** | **21,914.975** | **21,892.278** | **21,994.628** | **21,914.975** |

Web n3 P50 upload throughput **70.790MiB/s**, download **310.576MiB/s**; Web peak Renderer WorkingSet increase **99,376KiB = 97.05MiB**, actual Gin process sampled RSS growth worst **5,337,088B ≈5.09MiB**. Desktop n3 P50 upload **77.555MiB/s**, download **186.904MiB/s**; Desktop Renderer WS growth worst **139,904KiB = 136.63MiB**, Agent RSS growth worst **18,595,840B ≈17.73MiB**, Go Gin RSS growth worst **5,132,288B ≈4.89MiB**. All within original 360-second per-direction, 256MiB per-app/process resource thresholds; native CPU samples are numeric. The Web browser verifies OPFS output length and **three 1MiB zero-byte ranges** (no full browser-side SHA); the Desktop completely hashes each local downloaded 4GiB file and checks against original Server/CAS digest. OS sparse-zero input and warm local loopback page cache limit generalization to encrypted/incompressible 4GiB and WAN.

**Decision: preserve existing Web/Desktop/Agent/Go code; no production optimization.** These are *first genuine* 4GiB CURRENT baselines and **must NOT be presented as a code-change speedup or valid paired BEFORE/AFTER compared with earlier 1GiB suites**. Product AFTER=N/A, shipped improvement=N/A. Raw exact unrounded sample rows, actual Server and Agent memory/CPU, file SHA, all original frozen gates and source SHA are archived at [ci-run-38131060742.json](performance-evidence/real-web-desktop-cas-4gib/ci-run-38131060742.json). CI raw artifacts: [Web](https://github.com/lazyxu/xdrive/actions/runs/38131060742/artifacts/11699645385) and [Desktop](https://github.com/lazyxu/xdrive/actions/runs/38131060742/artifacts/11699201477).

**Delivery still gated:** this evidence addition amends the same one-work-commit PR source to a **new SHA**. Complete both new scoped 4GiB n3 CI jobs and full GitHub PR CI **including final-gate** on that amended exact HEAD, then Ready/rebase merge and verify branch cleanup. Prior measured-head success does not automatically validate the new evidence commit. Still outside this workload: genuine 100k distinct JPEG/HEVC/RAW/LIVP physical decode, 100k sync/delete physical bytes, WAN or cold-cache bandwidth, browser full-file SHA, multi-task durable cancellations and extra FileExplorer Desktop-specific window abort modes.

## P0 · Authentic Desktop Electron Renderer → Agent IPC → Gin/physical CAS 1GiB (2026-10-11)

### Accepted genuine Desktop 1GiB CURRENT n=3; all original hard gates passed on exact measured source

**Authoritative source-exact dedicated [GitHub native CI #38119810860 / job 114412035582](https://github.com/lazyxu/xdrive/actions/runs/38119810860/job/114412035582) completed SUCCESS** on work SHA `e6a10b0c6687fa4ba7080f04a75b752e92737af3`, with **3 independent fresh PostgreSQL17 schemas, physical Local CAS roots, Go Gin+production Agent processes and 6 real compiled Electron Desktop Renderer/Preload/Main processes**. The amended runner rigorously checked that `upload` **and** `download` are actual Electron measurement objects (not strings), required finite elapsed/throughput/CPU/Renderer values, exact 1GiB each direction, genuine 128 × 8MiB authenticated upload PUTs, 1 real authenticated GET, physical 1GiB CAS, each 1GiB downloaded file independent SHA256 identical to persistent PostgreSQL/CAS digest. All three strict source-exact native Go/Gin/IPC/CAS tests, every per-case 240s/256MiB budget, and actual `summary.passed=true` **passed**. The prior falsely green test-only summary #38119019808 is explicitly invalid and remains archived; this final n3 suite has **no** missing/null metric.

| Fresh native sample | Real 1GiB Desktop upload | Real 1GiB Desktop download | Renderer WS increase, upload/download | Agent RSS peak growth | Gin RSS peak growth | CPU Main user/system, upload/download ms |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | **10,013.061987ms** (102.266MiB/s) | **3,791.866286ms** (270.052MiB/s) | 72,496 / 13,272 KiB | 18,358,272 B | 4,784,128 B | 1037.098/319.378, 121.944/73.170 |
| 2 | **9,937.461504ms** (103.044MiB/s) | **3,263.663462ms** (313.758MiB/s) | 69,424 / 15,036 KiB | 18,255,872 B | 4,575,232 B | 1059.194/302.907, 108.323/73.616 |
| 3 | **9,760.575459ms** (104.912MiB/s) | **3,457.112545ms** (296.201MiB/s) | 62,844 / 17,432 KiB | 20,422,656 B | 2,490,368 B | 1060.846/314.532, 101.163/83.696 |
| **P50** | **9,937.461504ms, 103.044MiB/s** | **3,457.112545ms, 296.201MiB/s** | Max **72,496KiB ≈70.80MiB** | Max **19.48MiB** | Max **4.56MiB** | Numeric and valid in 6/6 processes |

**Accepted unchanged production (CURRENT/BEFORE); product AFTER=N/A, no code speedup claimed.** The original fixed runtime acceptance required upload/download each ≤240,000ms; Renderer WS, real Go Agent and Gin process RSS growth each ≤256MiB; exactly 128 × 8MiB PUTs, one GET, persistent CAS and SHA of entire 1GiB downloaded local file, with all 3 isolated cases valid. All passed in this workload. The Electron Main CPU is independent user/system process microseconds, native Go Agent and Gin process CPU tracked in `/proc` ticks, not a global CPU sum. Physical sparse zero input, Linux localhost and PageCache, not WAN or actual FileExplorer toolbar button clicks, not 4GiB or distinct 100k video/RAW/HEVC data. This is not comparable as a production performance speedup to older mock HTTP/Web CI or prior different runner. Source-exact unrounded 3 original sample/summary metrics, complete fixed gate details and CI provenance are durably archived at [ci-run-38119810860.json](performance-evidence/real-desktop-cas-1gib/ci-run-38119810860.json).

**Delivery gate:** archiving this source-exact result changes the one-work-commit branch HEAD, so require **both a fresh exact-head authentic n=3 native scoped benchmark and full GitHub PR CI including `final-gate=success`** after evidence amendment before Ready/rebase merge, then cleanup the merged branch by GitHub Actions. The original third run #38117873343 was genuinely n1 bytes pass but benchmark assertion false red; fourth #38119019808 genuinely n3 bytes pass but invalid aggregated JSON false green; both are preserved separately with their limitations. Real 4GiB Web/Desktop physical CAS, 100k distinct media codecs, durable canceled transfer Task Center semantics and non-local network remain separate unmeasured P0 tasks. No GitLab execution claimed.

### Original genuine Desktop 1GiB n=3 physical bytes pass, but green aggregate is invalid — 2026-10-11

**Exact benchmark work SHA `8f8aa05d63d3448c9fbac0adf80ea8fd7c29d544`: [GitHub native run 38119019808, job 114409719592](https://github.com/lazyxu/xdrive/actions/runs/38119019808/job/114409719592) returned CI SUCCESS with six real Electron transfer log records (3 independent PostgreSQL17/CAS/Agent process fixtures, upload + download per fixture), but the benchmark-only JS **summary was invalid**. All 6 authentic completed transfer logs and 3 actual Go Gin server logs show the real transfer path, actual persisted 1GiB physical CAS plus 128 × 8MiB authenticated upload PUTs and 1 × real 1GiB authenticated GET per fixture; independent download full-file SHA256 matches persisted CAS digest `49bc20df...` in **3/3**. The native Node report returned `{passed:true}` by merely checking `rows.length===3`, **without checking that every `download` result is a real object**. It actually returned the destination path string in the `download` member of each row, while the correct original metric was emitted separately in each authentic `electron-sample-N-download.log`. As a result `downloadMedianMs`, `downloadMedianMiBps` and `maxRendererWorkingSetGrowthKiB` serialized from `NaN` to JSON **null**, despite green CI. Green is NOT proof that the full structured benchmark passed.

| Native independent PG17 + Electron/Agent/Gin/CAS | Desktop true 1GiB upload | Desktop true 1GiB download | Upload/download Renderer WS delta | Agent RSS peak growth | Gin child RSS peak growth | Physical checksum and request proof |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | **10,728.154469ms** (95.450MiB/s) | **3,647.610210ms** (280.732MiB/s) | 64,692 / 14,416 KiB | 18,350,080 B | 2,691,072 B | 128 PUT / 1 GET / SHA match |
| 2 | **9,932.035818ms** (103.101MiB/s) | **3,358.785001ms** (304.872MiB/s) | 66,188 / 16,488 KiB | 20,402,176 B | 2,588,672 B | 128 PUT / 1 GET / SHA match |
| 3 | **10,219.831620ms** (100.197MiB/s) | **3,257.125616ms** (314.388MiB/s) | 63,116 / 17,124 KiB | 20,463,616 B | 2,473,984 B | 128 PUT / 1 GET / SHA match |
| **True raw-log P50** | **10,219.831620ms** (100.197MiB/s) | **3,358.785001ms** (304.872MiB/s) | Worst **66,188KiB ≈64.64MiB** | Worst **19.52MiB** | Worst **2.57MiB** | **3/3 valid physical bytes** |

Original native Electron Main CPU values were now **numeric** after the correct `process.cpuUsage()` test-only fix. Upload User CPU ms **1,269.327 / 1,166.821 / 1,235.414**, System **347.757 / 368.118 / 356.836**; download User **130.553 / 125.922 / 126.171**, System **78.685 / 77.946 / 71.669**. Go Agent/Go Gin child CPU `/proc` tick deltas were **404 / 419 / 401** and **528 / 522 / 519** respectively, diagnostic-only and **not cross-process aggregate CPU time**. Original frozen budget ≤240,000ms each 1GiB direction and ≤256MiB independently for Renderer WS, native Agent RSS and Go Gin RSS is met by every REAL source-exact raw child record. **This is not same-run BEFORE/AFTER production optimization.**

**Test-only corrections for credible final acceptance:** (1) `return { upload, download: downloaded }` rather than destination string `download`; (2) explicit 3×2 type/finite elapsed, throughput, Renderer memory, Electron Main CPU, persisted SHA/part count and backend integrity assertions before ever setting `passed:true`; (3) clear pending 6-minute watchdogs from completed `Promise.race` calls, whose un-cleared timers kept the already-finished native CI runner alive long after the true transfer elapsed. Original source-exact raw transcript and derivation from separate **original** Electron download log entries archived at [invalid-summary-ci-38119019808.json](performance-evidence/real-desktop-cas-1gib/invalid-summary-ci-38119019808.json), with original SHA, job/artifact IDs, all n3 original Go and recovered download numbers, and invalid-original-vs-reconstructed provenance. No production Client/Agent/IPC/Gin/CAS code, Race features or original 1GiB/n3/budget changed. **Current decision: source-current physical transfers appear to meet the originally frozen budgets, so do not optimize production; benchmark is still `Benchmarking` until the evidence-amended work commit passes a fresh complete n3 native benchmark with valid machine summary AND full GitHub CI/final-gate.**

### First real Desktop 1GiB uploads/downloads reached Gin/CAS; n=3 gate still blocked by benchmark validation error

**[Native performance CI #38117873343, job 114406337236](https://github.com/lazyxu/xdrive/actions/runs/38117873343/job/114406337236), original exact submitted work SHA `f66a619bb47254168ad5945340b887db9ae16b10`.** This third attempt **DID run authentic production Electron Renderer→Preload→Main→Go Agent IPC→Gin/PostgreSQL17 and physical local CAS transfer**. First isolated PostgreSQL17/CAS/Agent fixture completed a full **1,073,741,824B upload and full 1,073,741,824B download**, with **128 actual 8MiB authenticated PUT requests, one 1GiB content GET, physically persisted CAS 1GiB, `cas_valid=true`, verified SHA256 `49bc20df...`** and actual newly created Node #2. The two actual Electron processes produced the following durable measurements (no Go server/Agent RSS full-run summary was produced):

| First isolated actual Desktop run | Elapsed | Throughput | Actual Renderer WorkingSet start→peak→delta | Main process CPU | Physical Server/CAS confirmation |
| --- | ---: | ---: | --- | --- | --- |
| 1GiB real Desktop upload | **11,036.946847ms** | **92.779282MiB/s** | 134,720→205,548 KiB, delta **70,828 KiB** | **invalid/null** | 128 genuine 8MiB PUTs, 1GiB CAS committed |
| 1GiB real Desktop download | **3,503.255391ms** | **292.299557MiB/s** | 139,920→153,896 KiB, delta **13,976 KiB** | **invalid/null** | one full 1GiB authenticated Gin content GET |

**The test runner, not product transfer, failed *after these successful native IPC operations*:** it assigned `const download = path.join(tmp, 'download-<sample>.bin')` (destination path string) and `const downloaded = await launchElectron(...)` (real performance result object), but checked `for (const record of [upload, download])` instead of `[upload, downloaded]`. The erroneous string has `record.elapsedMs=undefined`, so it falsely raised `authentic Desktop 1GiB transfer elapsed budget exceeded`, even though real upload/download times were far below original 240,000ms budget. Separately, benchmark-only Electron Main called Electron `process.getCPUUsage()` whose return shape is CPU percent data, not Node `process.cpuUsage()`'s cumulative user/system microseconds; all four CPU metrics were `null`, hence **must not be used** as valid CPU data. These are **test-harness first-red errors, not product throughput faults**. Download full SHA check and Agent/Gin RSS peak sampler did not reach final post-loop assessment, so the **complete original n=3 acceptance is STILL UNMEASURED**. Do not classify the whole test as Accepted or claim real CPU proof.

**Decision and next:** archive the source-exact two real browser results, Gin final counts, original exact work SHA, artifact ID and invalid-instrumentation evidence at [invalid-ci-38117873343.json](performance-evidence/real-desktop-cas-1gib/invalid-ci-38117873343.json). Change *only* test runner to `[upload, downloaded]` and add finite elapsed/CPU checks; switch the test-only Electron Main CPU sampler to Node `process.cpuUsage()` with user/system microseconds. Preserve original exact **n=3 isolated PostgreSQL17/CAS/real Go Agent, physical 1GiB per direction, 128 PUT, one GET, ≤240s each, 256MiB per-process RSS growth** gates, and new exact source-head native and full GitHub CI before merging. No user-facing product changes, Race specialization changes or silent threshold relaxations. The existing unrelated Desktop startup dashboard polling logs include queries for tables not migrated in this minimal transfer fixture; the test-only extras are not needed to authenticate or complete real transfer, but must not be misrepresented as production SQL performance.

**Second invalid n=3 Desktop baseline attempt / actual Electron application-root bootstrap mismatch:** [native scoped CI #38113661932 / job #114394169832](https://github.com/lazyxu/xdrive/actions/runs/38113661932/job/114394169832) on `84bc70f9990886cea0cb22eef7353e2fb96e0b21` built production Renderer/Preload/Main, the real xdrive-agent and native PostgreSQL17/Gin/CAS API test fixture successfully, but **the Electron upload child never initialized the actual xDrive Desktop App**. Original uploaded `electron-sample-1-upload.log` shows `AssertionError: authentic Desktop app required`: `app.getAppPath()` returned `.../desktop/scripts` whereas production app root is `.../desktop`. The driver incorrectly passed `desktop/scripts/real-desktop-cas-electron-main.cjs` as Electron's entry file. Original Gin artifact shows a real login/root lookup, **0 HTTP PUT requests, 0 downloaded bytes, 0 persisted CAS**. Launcher eventually timed out at 360s waiting for an Electron result; **no actual 1GiB Desktop upload or download BEFORE is measured**, and the timeout is **not** a product 240s transfer budget breach. Correct only the benchmark runner to create a temporary `.cjs` bootstrap under the real Desktop package root and require the existing benchmark-only Main hook, as done by the already-accepted real Electron Gallery benchmark. The exact invalid CI metadata/Go counters and exception are archived at [invalid-ci-38113661932.json](performance-evidence/real-desktop-cas-1gib/invalid-ci-38113661932.json). No changes to production App, transfer pipeline, Agent IPC, Go cancellation, Race or budgets; repeat the untouched current-source n=3 workload with valid app identity.
**Invalid initial native CI launch / zero 1GiB samples:** [GitHub #38113380419, job #114393364470](https://github.com/lazyxu/xdrive/actions/runs/38113380419) on single work SHA `89d0a794a854741d05ea34ccdde8bcd8dc36d737` successfully built the production Desktop Main/Preload/Renderer, production Agent and real API test binary. The new benchmark-only Node runner then terminated before Go Gin fixture startup because its fixture function shadowed global `process` with local `const process` and attempted `{...process.env}` before initialization (`ReferenceError: Cannot access 'process' before initialization`). **No actual upload, download, CAS or native Agent perf metrics were produced; this is NOT a product performance red.** Correct only the runner's local name (`proc`) and retain the original exact size, 3 independent trials, authenticated 128×8MiB upload/1 real GET, SHA256, ≤240s and ≤256MiB resource budgets. Original invalid launch is archived as [invalid-ci-38113380419.json](performance-evidence/real-desktop-cas-1gib/invalid-ci-38113380419.json). Rerun complete true CURRENT/BEFORE. Production code remains unchanged.
**Status: Accepted CURRENT / actual authentic Desktop 1GiB Renderer→Agent IPC→Gin/PostgreSQL/CAS n=3 passes all original budgets and correct machine summary; production unchanged, AFTER=N/A. Evidence-amended exact-head CI pending.** Fixed original GitHub master base `156fd11fcb6bfdc9d91edc611ae93e4c55f41394`; one-work-commit branch `perf/real-desktop-postgres-cas-1gib`. Related actual Web XDriveApi→real Gin/PostgreSQL17/CAS→OPFS 1GiB [#1364](https://github.com/lazyxu/xdrive/pull/1364) was accepted/merged (original real Web CURRENT sample n3 upload P50 12,827.100ms / download P50 4,712.300ms, later exact-head n3 upload P50 16,754.600ms and download P50 2,838.000ms). Neither measures **actual Desktop Electron Preload/Main→Go Agent IPC 1GiB**; the earlier native Go→real Server/CAS [#1361](https://github.com/lazyxu/xdrive/pull/1361) 1GiB tests omit Renderer/Main IPC entirely. Open blocked Gallery media *progress-event* [#1185](https://github.com/lazyxu/xdrive/pull/1185) and transfer lifecycle/race PRs remain explicitly outside this performance-only test. `AGENTS.md` already includes the measurement-first and true Go upstream cancellation rules; do not duplicate or change them.

**Frozen new named workload** `desktop-renderer-preload-main-agent-postgresql17-physical-cas-1gib`, n=3 independent **native PostgreSQL17 schemas, fully physical Local CAS roots, Go Gin API test child processes, production `xdrive-agent` instances**, each with two distinct actual Electron app instances loading the compiled production Desktop Renderer/Preload/Main. Browser test code dynamically inserts an HTML `<input type=file>` into the actual Renderer and uses Chromium CDP `DOM.setFileInputFiles` with **exactly 1,073,741,824-byte sparse zero local file**. Test triggers unchanged production `window.xdriveDesktop.agent.cloudUploadDroppedFiles(root,[file])`, whose real Preload resolves OS path using Electron `webUtils.getPathForFile`, then real Main `'agent:cloud-upload-paths'`, production Go Agent `/v1/cloud/upload` IPC, `client.UploadFileResumable`, authentic Gin `POST /uploads`, **128 real 8MiB chunk PUTs** with SHA verification and physical CAS transaction/finalize. A second actual production Electron Renderer calls `window.xdriveDesktop.agent.cloudDownload(node,name)` over real Preload/Main `/v1/cloud/download` to the same real Server/CAS. Only the OS picker response is *test-overridden* to a private absolute local target path; production save/download implementation remains intact. Measure until `saved:true`, then independently hash/verify all 1GiB physical downloaded bytes and matching real CAS File/ContentBlob SHA/digest/refcount. The test manually triggers actual production Preload APIs via an inserted input rather than clicking the normal Desktop FileExplorer upload/download toolbar — it is real Electron API/IPC/backend transport but not user mouse-navigation UX. Source is sparse zero/low entropy, Linux localhost, not WAN, 4GiB or varied encrypted content.

**CURRENT/BEFORE acceptance frozen BEFORE any production change:** 3 fresh independent native PG17/CAS/Go Agent and fresh actual Electron application samples. Each must upload 1GiB with real initial HTTP session, exactly **128×8MiB actual PUTs totaling 1GiB**, physical CAS object/blob and committed File/Node, no skipped sessions, in **≤240s** measured from production Preload transfer invocation through real IPC Promise completion. Each must then download the exact newly uploaded node through real single authenticated Gin content GET to a real local file in **≤240s** with full independent native SHA256 match and size check. Every Electron Renderer process's peak working-set delta, Go Agent native process peak VmRSS increase and genuine Gin test binary peak VmRSS delta each **≤256MiB**, sampled ~25ms, with process CPU user+system recorded in native Linux ticks and Electron Main CPU use as diagnostic; do not invent a cross-process global-peak claim. Record upload/download individual/P50 wall-time, MiB/s, CPU/RSS, physical I/O request counts, signature, hash and correctness. Exclude fixture migration/build, sparse input file creation and independent post-download verification from timed upload/download stage. Require zero fake upload/download HTTP server or synthetic IPC channel; do **not** cancel durable transfer Task Center jobs merely because the foreground window changes. Actual cancellation lifecycle and 4GiB server/CAS are separate P0 workloads.

**Decision gate:** measure unchanged production with opt-in branch-scoped real PostgreSQL CI. If all n3 valid native samples meet the frozen time/memory/physical-byte gates, record **Accepted unchanged production / AFTER=N/A / no speedup percentage**. If a valid exact-source first-red occurs, preserve original CI and distinguish a harness/CDP/OS-dialog/Agent startup mismatch from product performance. Only after confirming a reproducible genuine product bottleneck may the smallest performance-only change be attempted, followed by the *same* n3 fixed workload, with CPU/RSS/I/O/byte and correctness non-regression. No Race, progress-delivery ordering, locks or speculative preemption.

**Command/files:** build normal production Web fixture dist (`npm --prefix web run build -- --config vite.config.ts`), normal production Desktop (`npm --prefix desktop run build`), `go build -o desktop/real-desktop-cas-bin/xdrive-agent ./cmd/xdrive-agent`, and `go test -c -o desktop/real-desktop-cas-bin/api.test ./internal/api`. Run `XD_TEST_DATABASE_URL=<native-pg17> XD_REAL_DESKTOP_AGENT_BINARY=<absolute-go-agent> XD_REAL_DESKTOP_CAS_TEST_BINARY=<absolute-api.test> XD_REAL_DESKTOP_CAS_RESULTS=<abs-output> xvfb-run -a node desktop/scripts/real-desktop-cas-runner.cjs`. Electron launcher `desktop/scripts/real-desktop-cas-electron-main.cjs` hooks the authentic app's BrowserWindow; it **does not** stub Agent IPC/backend data. Reuses merged `TestRealWebLargeTransferCASFixture` as real Go fixture (its Go fixture name mentions Web but routes real production Gin HTTP and is shared). Dedicated `.github/workflows/real-desktop-cas-1gib-performance.yml` scoped only to this branch. On completion archive each unrounded n3 sample and original SHA in `docs/performance-evidence/real-desktop-cas-1gib/`, plus CURRENT baseline, measured RSS/CPU, result decision and remaining work in this canonical document in the **same one-work-commit PR**. Amend branch to archive data, rerun source-exact dedicated n3 benchmark and full GitHub PR CI/final-gate before Ready/rebase merge/branch cleanup. GitLab pipeline not claimed.

## P0 · Authentic Web XDriveApi 1GiB → real Gin/PostgreSQL CAS and OPFS (2026-10-11)

### Final source-exact authentic Web 1GiB and Go child resource n=3 (2026-10-11)

**Status: Accepted CURRENT / production unchanged; product AFTER=N/A.** Final original measured single-work-commit SHA `435cabf408e7813398cae5777bbfd58274e59def` passed BOTH [scoped real Web/PG17/Gin/CAS CI #38109007223, job 114380456925](https://github.com/lazyxu/xdrive/actions/runs/38109007223/job/114380456925) and [full GitHub PR CI #38109007407, 76 jobs including final-gate SUCCESS](https://github.com/lazyxu/xdrive/actions/runs/38109007407). The corrected runner **executes the real compiled Gin child process directly**, sampling `/proc` RSS peak 25ms, separately logging child CPU. All three fresh PostgreSQL17 schemas, CAS roots and Chromium upload/download pairs passed their **original frozen 240s/256MiB/128 PUT/1 GET/1GiB physical SHA/OPFS spot-read** acceptance gates.

| Actual native independent Web/Gin session | Web 1GiB upload incl. prehash + physical CAS finalize | Upload MiB/s | 1GiB streamed Web OPFS download | Download MiB/s | Web Renderer working-set upload/download growth | Go Gin *child* RSS peak growth |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 12,827.100ms | 79.831 | 5,343.300ms | 191.642 | 49,012 / 88,276 KiB | 2,846,720 B |
| 2 | 12,868.500ms | 79.574 | 4,712.300ms | 217.304 | 48,492 / 76,268 KiB | 2,637,824 B |
| 3 | 12,544.600ms | 81.629 | 4,592.800ms | 222.958 | 49,548 / 90,816 KiB | 2,854,912 B |
| **P50** | **12,827.100ms** | **79.831 MiB/s** | **4,712.300ms** | **217.304 MiB/s** | Maximum **90,816KiB = 88.69MiB** | Worst **2,854,912 B ≈2.72MiB** |

Go Gin child-process CPU user+system P50 **5,710ms** for the combined upload/download fixture session (distinct from browser CPU), measured on the actual native test binary, **not** the `go test` supervisor. Production Web upload prehash/sample first-phase (ms) **2,228.700 / 2,386.300 / 2,231.700**; real Gin/CAS chunk upload windows **5,412.100 / 5,477.800 / 5,288.800**; SQL/CAS finalize windows **5,166.900 / 4,982.800 / 5,004.600**. Every session performed **128 real signed 8MiB PUTs**, an actual 1GiB CAS file with committed `ContentBlob` refcount/digest, **one** real authenticated Gin file GET, a browser OPFS File of exactly **1,073,741,824B** and **3×1MiB** start/middle/end zero-byte spot reads. Original source-exact unrounded n=3 sample and summary JSON archived at [ci-run-38109007223.json](performance-evidence/real-web-cas-1gib/ci-run-38109007223.json). Native CI job's transient raw logs/artifact can be verified using that exact measured SHA.

**Decision:** All fixed real Web→Gin/PostgreSQL17/CAS/OPFS 1GiB budgets pass. **Keep current production unchanged**; AFTER=N/A; no user-facing code speedup percentage. The earlier first source-exact run #38108352464 had correctly measured browser/CAS bytes/times but invalid Go server RSS (parent launcher); that *specific RSS defect is now fixed in benchmark harness* and is superseded by the latest corrected source-exact genuine Gin child measurements above. Cross-run browser upload time difference **18,226.700→12,827.100ms** is uncontrolled hosted-runner variance, NOT proof of production speedup: no production runtime code changed. Limitations: sparse zero source, Linux local loopback, OPFS 3MiB spot read not full JS SHA, warm OS cache, not real Desktop Agent IPC, 4GiB, WAN or 100k distinct physical media bytes; durable transfer cancellation not measured.

**Delivery rule:** this source-exact evidence was produced on work SHA `435cabf408e7813398cae5777bbfd58274e59def` and its native+full CI both passed. The evidence/document **amendment creates a new SHA**, so the same one-work-commit branch must receive fresh exact-head scoped n=3 native and full GitHub PR final-gate success before Ready/rebase merge. Do not claim GitLab or broader workloads.

### Source-exact first complete authentic Chromium Web/Gin 1GiB samples — 2026-10-11

**First valid completed browser-to-real-CAS test [GitHub CI 38108352464 / job 114378531433](https://github.com/lazyxu/xdrive/actions/runs/38108352464/job/114378531433)**, original single work SHA `7d5c03d7dec39d3c20aee6272b8411a9060690c8`: 3 independent authenticated native PostgreSQL17/physical Local CAS fixtures, each with real Chromium production Web XDriveApi upload and real Web OPFS download **PASS**. Each 1,073,741,824B sparse zero upload resulted in **128 actual 8MiB PUTs** with declared 1,073,741,824B on HTTP, persisted File/ContentBlob and true 1GiB CAS file with matching hash `49bc20df...`; each browser requested that newly uploaded Node once, wrote full 1GiB to OPFS and spot-checked 1MiB at **0/middle/end** (3MiB total), successfully. This new real Server/CAS benchmark cannot be mixed into a BEFORE/AFTER percentage with the old mock HTTP #1063.

| Native distinct PG17/Go Server and Chromium sample | 1GiB authentic Web upload elapsed | Upload MiB/s | 1GiB actual OPFS download elapsed | Download MiB/s | Web Renderer WS upload/download delta KiB | Web JS heap delta upload/download bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | **18,226.700ms** | 56.181 | 3,910.400ms | 261.866 | 50,000 / 80,852 | 22,377,733 / 5,145,976 |
| 2 | 18,774.600ms | 54.542 | 3,537.400ms | 289.478 | 53,656 / 75,140 | 22,772,638 / 5,405,530 |
| 3 | 17,603.200ms | 58.171 | 3,630.800ms | 282.032 | 51,212 / 76,316 | 23,068,016 / 6,283,458 |
| **P50** | **18,226.700ms** | **56.181** | **3,630.800ms** | **282.032** | Worst WS delta **80,852KiB ≈78.96MiB** | — |

**Important measurement correction before final acceptance:** the original benchmark did sample actual Chromium Renderer WS correctly, but its `serverRssStartBytes/serverRssPeakDeltaBytes` polled the PID of **the `go test` parent supervisor**. Gin/Server traffic was inside a spawned child test binary, so original tiny RSS numbers are **INVALID as Server RSS**; no native Server CPU measurement was collected. Despite original browser/timing/physical byte gates all passing, **do not** accept the full CPU/RSS resource contract, do not merge on that run alone. The benchmark-only runner and CI are amended to `go test -c -o desktop/real-web-cas-bin/api.test ./internal/api` once and launch the *compiled native API test binary directly*; `/proc/<actual Gin PID>/status` provides true RSS sampled 25ms, `/proc/<PID>/stat` user+system ticks provides process CPU. Workload, 1GiB bytes, 128 PUTs, one GET, correctness rules, browser resources and ≤240s/≤256MiB budgets **unchanged**. Re-run exact-head native n=3 and full PR CI. User-visible production upload, download, Server API, SQL and CAS implementations remain untouched. The original correct browser timings and original invalid process metrics are archived with explicit provenance in [ci-run-38108352464.json](performance-evidence/real-web-cas-1gib/ci-run-38108352464.json). Original source used zero-filled bytes and Linux localhost/page cache, not real WAN or 4GiB media.

**Invalid initial CI attempt — test Go formatting only (no Web transfer measured):** [GitHub scoped run 38108177500](https://github.com/lazyxu/xdrive/actions/runs/38108177500), one work SHA `725aef19351fb3bc6cd18e211a6e8a10f5a384d1`. The full production Web bundle built, including the new opt-in real Server harness, and the dedicated job then failed on the original test-only `gofmt -l internal/api/real_web_cas_transfer_fixture_performance_integration_test.go` rule; exact diff contained import indentation, `Server` literal fields and test stats map alignment. **No native Gin fixture, 1GiB HTTP upload or OPFS download ran.** This is not a product performance red. Correct only the test formatting; keep unchanged production code, fixed n=3 1GiB workload and all originally declared absolute budgets and correctness checks. Rerun complete native first measurement plus exact-head full PR CI.

**Status: Accepted CURRENT Web 1GiB / actual Gin CPU+RSS n=3 measured; production unchanged, AFTER=N/A, archival final-head validation pending.** Fixed GitHub `master` baseline `db3f55d6c2e1b3539e22bddf78bfce4f9e694e91`; single-commit branch `perf/real-web-postgres-cas-1gib`. Performance policy in `AGENTS.md` already requires named BEFORE and same-load AFTER only when genuine budget breached. Related 100k authentic Electron Gallery scroll/app/window cancellation [#1352](https://github.com/lazyxu/xdrive/pull/1352) and genuine physical 1GiB native Server/CAS [#1361](https://github.com/lazyxu/xdrive/pull/1361) are **merged**, their branches cleaned. Only remaining open performance PR [#1185](https://github.com/lazyxu/xdrive/pull/1185) is a blocked unrelated Desktop 100k thumbnail *progress event* completion benchmark; no Race or event-protocol edits here.

**Previous measured references, distinct scopes, not current n=3 real Web baseline:** Production Web upload BYOB against a **mock** HTTP handler 1GiB original→AFTER 7,150.900→5,582.600ms (peak Web Renderer working-set growth 928.008→46.410MiB) and OPFS download 3,682.100→3,450.100ms (412.941→76.012MiB); these paired mock results already merged in #1063 and are **not** a genuine physical CAS production end-to-end performance gain. Separately native, non-browser production Go Client→real Gin/PostgreSQL17/local CAS measured 1GiB upload P50 **17,459.448ms**, download P50 **714.184ms**, and max process VmRSS delta **19,869,696 bytes**, accepted #1361 (different runner/job, warm file cache and zero-filled sample). Cannot derive actual Browser/Go Agent timings from either.

**Frozen named CURRENT workload:** `real-web-chromium-xdriveapi-postgresql17-physical-cas-1gib`. Independently seed **3 PostgreSQL17 schemas + 3 physical local CAS roots and Go Gin fixture processes** (one at a time); build the actual production `web/src/api.ts` and opt-in source-extracted shared `web/src/LargeTransferPerformanceHarness.tsx`, run actual Chromium from Electron under Xvfb, CDP set actual `<input type=file>` to *1,073,741,824-byte sparse zero source* (data preparation not timed). On **actual Web XDriveApi.uploadWithConflictPolicy** to genuine Gin authenticated `POST /api/v1/uploads` + **128 genuine 8MiB PUT chunks** validated with per-chunk SHA256 and production finalize SQL/CAS, verify metadata Node ID/digest, physically persisted 1GiB blob and exact ContentBlob identity. In a second real Chromium process on the SAME authenticated private Gin fixture, call actual `Web XDriveApi.download` for the **newly uploaded Node**, stream full authenticated `GET /api/v1/files/:id/content` into Web Origin Private File System (OPFS) through the unchanged production browser download sink; verify OPFS size and three independent 1MiB actual zero-byte readbacks (start, middle, end). Server verifies full upload chunk SHA and durable CAS file metadata; **browser download is spot-checked, not a full 1GiB browser SHA256**. Use a freshly isolated browser userData partition per operation. This is Linux native localhost OS/pagecache/sparse-zero workload, **not WAN, not incompressible media or Desktop Agent IPC**.

**Budget declared BEFORE product changes:** n=3 fresh native schemas; each actual 1GiB Web upload total from XDriveApi start through SHA prehash, 128 physical HTTP PUTs and finalize **≤240,000ms**, and each Web authenticated 1GiB OPFS download **≤240,000ms**. Each of six Chromium runs requires renderer WorkingSet peak minus start **≤256MiB**, sampled from native Electron app metrics; each fixture's actual Go Server process RSS peak minus initial RSS **≤256MiB**, sampled `/proc` every 25ms. Exact **128 PUT requests** and `ContentLength` totals 1GiB, exactly **one GET** and 1GiB OPFS File, spot-check 3MiB, real CAS physical 1GiB file with matching SHA/refcount and completed Node; no resumed/skip uploads, stale GUI transfer, fake HTTP UploadSession handler, or partial downloads. Record n=3 upload/download elapsed/throughput and each Web renderer heap/WS, native Go Server RSS peak and on-disk stats and exact SHA, 3× upload/download per-operation JSON and full runner/CI metadata. Report initial Go schema setup and renderer startup excluded. 4GiB and real Windows/NAS network are separate workloads and are **NOT** assumed achieved by 1GiB.

**Decision:** if valid CURRENT meets thresholds, **Accepted unchanged production; AFTER=N/A, no speedup claim**. If any valid real UI-to-Go/Server/CAS performance or byte correctness gate fails, preserve source-exact first-red and diagnose invalid harness, disk quota, PostgreSQL or product bottleneck; only optimize production when reproducible and compare against same n=3 named workload on same runner/software/size with full time/CPU/RSS/I/O/request/correctness measurement. Reject non-material or noisy changes. Do **not** alter Race/progress-event fixes or cancel durable upload/download/sync/delete jobs merely because Gallery/FileExplorer views unmount; this benchmark measures completed transfers, not cancellation.

**Reproduction/test files:** `internal/api/real_web_cas_transfer_fixture_performance_integration_test.go` (opt-in native Gin/PostgreSQL17/CAS Web fixture), `web/src/LargeTransferPerformanceHarness.tsx` (test-only `xdriveLargeTransferRealCAS=1` branch using production XDriveApi; existing mock benchmark behavior preserved), `desktop/scripts/large-transfer-real-web-cas-main.cjs` (Chromium OPFS/perf resource measurements), `desktop/scripts/real-web-cas-transfer-runner.cjs` (n=3 independent real fixture and Browser upload/download), branch-scoped native `.github/workflows/real-web-cas-1gib-performance.yml`. Build `VITE_XDRIVE_LARGE_TRANSFER_PERF=1 npm --prefix web run build -- --config vite.config.ts`; run `go test -c -o desktop/real-web-cas-bin/api.test ./internal/api`, then `XD_TEST_DATABASE_URL=<native-Postgres17> XD_REAL_WEB_CAS_TEST_BINARY=<abs-api.test> XD_REAL_WEB_CAS_RESULTS=<abs-output> xvfb-run -a node desktop/scripts/real-web-cas-transfer-runner.cjs`. Before merge, write original n3 machine JSON to `docs/performance-evidence/real-web-cas-1gib/` and benchmark results/BEFORE/current budget/decision here in **the same single work commit**, then run new exact amended-head dedicated CI plus full GitHub PR CI/final-gate. GitLab run and Desktop Agent IPC transfer not claimed.

## P0 · Authentic 1 GiB PostgreSQL17 Server/CAS transfer baseline (2026-10-11)

**Second invalid native CI launch — exact `gofmt` whitespace, still zero 1GiB data:** [job 38106715392](https://github.com/lazyxu/xdrive/actions/runs/38106715392) on `b703c6d560c31fc234fa5d53211d78e730182003` printed its entire `gofmt -d`: only the two test-only CPU duration expressions required spaces around `-`. The job exited in the format-check step **before the real upload/download**. Correct exactly the formatter diff without altering any source or product performance path, 1GiB payload, 128 chunk requests, 1 GET, RSS or timing budgets. Re-run fresh native CURRENT benchmark on the one work commit; no product first-red/performance inference from these harness formatting failures.
**Invalid first native CI launch — formatter-only gate, no valid performance data:** [scoped run 38106517048](https://github.com/lazyxu/xdrive/actions/runs/38106517048) checked out original one-commit source `6ce0bd73643eb79ffe1cb6f132c89113bcb81cec`, created the PostgreSQL17 service, then failed the *test-only Go file's* `gofmt -l` check **before any 1GiB disk or network workload started**. This is not a production Server/CAS speed or correctness first-red. Correct formatting only, preserve the exact frozen 1GiB size, n=3, 128 chunk count, CPU/RSS/time and byte/hash correctness gates. Native workflow now emits `gofmt -d` diagnostics on future formatting errors. Repeat CURRENT/BEFORE on amended source; AFTER still unmeasured.
**Status: Measured CURRENT/BEFORE accepted by three native Go tests; evidence-amended exact-head full GitHub CI and scoped benchmark pending. Production unchanged, AFTER=N/A.** Frozen GitHub master base `b0c5eff155aa47e0fa35073a50cfc81048ae1eb5`, one-work-commit branch `perf/real-server-cas-1gib-transfer`. Related Gallery full actual Electron→Go cancellation [#1352](https://github.com/lazyxu/xdrive/pull/1352) has already merged and its branch has been deleted; real Desktop progress callback [#1185](https://github.com/lazyxu/xdrive/pull/1185) stays blocked/Draft and is not a replacement for real Server/CAS throughput. Separate [#1360](https://github.com/lazyxu/xdrive/pull/1360) is about Race/progress Add, explicitly out of scope. `AGENTS.md` already contains performance BEFORE/AFTER and scope rules; do not modify it here.

**Existing measured references, not a valid BEFORE for this different path:** Web 1 GiB original→BYOB browser **upload** P50 7,150.900→5,582.600ms, renderer working-set growth P50 928.008→46.410MiB, **download** 3,682.100→3,450.100ms and 412.941→76.012MiB; accepted PR #1063, hosted Electron/Xvfb with **mock HTTP upload/download responses**, sparse/zero-filled file and local OPFS, **not genuine PostgreSQL/chunk-staging/final CAS nor real authenticated Server response**. Web 4 GiB optimized current only upload P50 22,019.500ms/186.017MiB/s and download P50 13,507.800ms/303.232MiB/s, again mock server, no original 4GiB A/B. Native Go Agent mock HTTP 4GiB upload/download is also not a measured real Server/CAS result. Do NOT infer any genuine Server/CAS speedup, 4GiB throughput or desktop UI performance from those numbers.

**New named workload:** `real-server-postgresql17-local-cas-1gib-physical-upload-download`, **1,073,741,824 real bytes** upload + separately **1,073,741,824 real bytes** download per independently initialized PostgreSQL17 schema, real Gin `Server.Router()`, per-sample physical `storage.NewLocal()` directory, actual production Go `client.UploadFileResumableResult` -> authenticated session initiation, **128 genuine 8MiB PUT chunk requests**, verified per-part SHA-256, transactionally finalized CAS `ContentBlob` and persisted Node/File metadata. Then real authenticated `GET /api/v1/files/:id/content` streams the stored full CAS physical bytes, verifies exact body size, full SHA-256 and `X-Content-SHA256` response header. Reuse actual `client` and `Server`, do not mock `/api/v1/uploads`/`content`. Input is a **sparse, zero-filled 1GiB source** to exclude unrelated data generation; on Server all per-chunk and CAS physical bytes are written through genuine local storage. This is an important reproducible *low-entropy* workload, not representative encrypted or incompressible media; its hash is independently verified at both ends. OS loopback, no WAN.

**BEFORE acceptance predeclared without source modification:** n=3 **independent Go test processes, independently created PostgreSQL17 schemas and CAS filesystem roots**, never concurrent; fixed 1GiB size. Original client upload including full prehash, genuine 128 PUTs and final CAS persisted in ≤180,000ms per sample; download full authenticated Server body hashed in client in ≤120,000ms per sample; **peak observed Linux Go process VmRSS growth ≤256MiB** vs baseline, sampled every 25ms, and CPU user+system measured from `/proc` + `getrusage` around each upload and download. Every sample requires exact 1GiB `TransferredBytes`/progress/Node/File/ContentBlob size and hash, physical CAS open/stat, **128 upload chunk PUT attempts, 1 GET**, correct `Content-Length` if trusted, `X-Content-SHA256` and streamed body sha-256; no skips, fake HTTP handlers or precreated CAS. 3× independent correct results. Physical source file generation, database startup/migration, CAS cleanup and process Go compile excluded from timed operation. Report upload/download P50, individual sample times, MiB/s, per-stage CPU, peak RSS increase, raw network request counts, temp available disk, source SHA and correctness. Strict budget is a conservative first baseline acceptance, not comparable to prior mock simulated benchmark throughput.

**Decision rule:** first run unchanged production and archive complete CURRENT source-exact n=3 JSON/logs. If all three pass, **Accepted / production unchanged; AFTER=N/A; no speedup claimed**. If a real performance/CPU/RSS/integrity red arises, preserve original evidence, diagnose PostgreSQL/CAS/capacity/fixture independently; only then propose the smallest scoped optimization, run **the same exact size/samples/runner/profile** as a matched A/B and keep only material repeatable improvement with no regression. No Race/locks. This benchmark **does not yet** prove authenticated **Web Chromium or Electron Desktop Renderer→Agent→Server/CAS** full 1/4GiB user transfer or cancellation; that is the next explicitly separate P0. Optional 4GiB native Server test is source-supported but not run by this 1GiB CI job, so do not claim 4GiB measured.

**Reproduction:** `XD_TEST_DATABASE_URL=<native-pg17> XD_REAL_SERVER_CAS_LARGE_PERF=1 XD_REAL_SERVER_CAS_SIZE_GIB=1 XD_REAL_SERVER_CAS_SAMPLE=sample-1 XD_REAL_SERVER_CAS_LARGE_OUTPUT=real-server-cas-results/sample-1.json go test -run '^TestRealServerCASLargeTransferBaseline$' -count=1 -timeout=12m -v ./internal/api` on Linux. Test-only file `internal/api/large_transfer_real_server_performance_integration_test.go`, n=3 comparator `scripts/ci/summarize-real-server-cas-1gib.py`, dedicated branch-scoped GitHub CI `.github/workflows/real-server-cas-large-performance.yml`, with native `postgres:17-alpine`. Record n=3 raw metric JSON and full SOURCE_EXACT run/job/runner identity under `docs/performance-evidence/real-server-cas-1gib/`, and P50/budgets/decision here in the **same one-work-commit PR before merge**, then require a fresh exact-evidence-head full GitHub CI including final-gate and exact workload CI, linear merge and branch cleanup. GitLab execution and real Web/Desktop app transfer not claimed.

### Source-exact actual PostgreSQL/CAS 1 GiB native n=3 — FIRST VALID REAL BYTES (2026-10-11)

**Original [native GitHub scoped run 38106801137, job 114373936237](https://github.com/lazyxu/xdrive/actions/runs/38106801137/job/114373936237), work commit `ed3f6780a744f558f819110f9d70a2555cb16e67`: three full independent Go `TestRealServerCASLargeTransferBaseline` test processes **each PASSED** and emitted authenticated real physical Server/CAS byte, PostgreSQL and checksum metrics.** The *composite GitHub job* subsequently failed on the final Python aggregation due to a **test-harness relative output path**: Go test binary runs with `internal/api` cwd, but workflow aggregator expected JSON at `$GITHUB_WORKSPACE/real-server-cas-results`. This is a true valid n3 underlying Go data result yet **not** an all-green composite performance CI. The only subsequent code change is an *absolute* output JSON path in the dedicated CI workflow and this exact raw evidence; runtime Server/Client/Store/SQL unchanged. Re-run the full n3 composite on the evidence-amended one-work-commit head before Ready.

| Real native independent PostgreSQL17 + local CAS sample | Actual 1GiB upload incl. source hashing | Upload throughput | Actual 1GiB streaming download+SHA check | Download throughput | Upload/Download CPU time | Peak Go process RSS growth | CAS/result correctness |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | 9,606.208ms | 106.598MiB/s | 855.663ms | 1,196.732MiB/s | 7,252.656 / 1,201.143ms | 17,702,912B | 128 chunk PUTs, 1 GET, exact SHA |
| 2 | 9,530.993ms | 107.439MiB/s | 844.415ms | 1,212.673MiB/s | 7,206.820 / 1,198.383ms | 17,698,816B | 128 chunk PUTs, 1 GET, exact SHA |
| 3 | 9,514.071ms | 107.630MiB/s | 855.792ms | 1,196.552MiB/s | 7,227.962 / 1,206.274ms | 17,620,992B | 128 chunk PUTs, 1 GET, exact SHA |
| **P50 across three** | **9,530.993ms** | **107.439MiB/s** | **855.663ms** | **1,196.732MiB/s** | **7,227.962 / 1,201.143ms** | Worst **16.883MiB** | **3/3 PASSED** |

**Original frozen budgets all passed per actual Go test:** max upload 180,000ms, download 120,000ms, sampled Go process peak VmRSS growth ≤268,435,456B; exact 1,073,741,824B each direction; 128 8MiB PUT requests and 1 authenticated real GET; real physical CAS `Open/Stat` and `ContentBlob` row/refcount; body SHA-256, `X-Content-SHA256` and trustworthy exact 1GiB Content-Length, full user-visible transfer progress. The download high MiB/s is **warm same-run Linux filesystem page cache and loopback zero source**, not a real WAN or physical cold-disk throughput claim; upload includes reading/hash+HTTP staging+finalizing, download reuses hot CAS. Go process RSS is sampled every 25ms (NOT all child process memory), source sparse zero data generation is not timed. No real Browser/IPC and no 4GiB result.

**Decision: native 1GiB Server/Gin/PostgreSQL/CAS CURRENT accepted unchanged production.** This is an independent legitimate REAL Server transport workload, not comparable as A/B to mock HTTP Web 1GiB 5,582.6ms nor mock Agent/4GiB tests. AFTER=N/A and product speedup=N/A. **Durable immutable native Go sample JSON from exact original logs** [ci-run-38106801137.json](performance-evidence/real-server-cas-1gib/ci-run-38106801137.json) contains all exact unrounded time, CPU, RSS, data/part counts, header proof and raw source SHA. Original transient uploaded artifact missed the JSON because output path was relative; logs themselves preserve every emitted JSON. Final composite gate must run green on the amended work SHA. Full GitHub CI final-gate mandatory; GitLab/physical Web/Desktop full 1GiB app and real 4GiB tests not claimed.

## P0 · 100k mounted Web FileExplorer Grid/Details real thumbnail HTTP scroll cancellation (2026-10-10)

**Status: Merged / Accepted unchanged production, PR #1298, exact full GitHub CI #38034517714 with final-gate SUCCESS, linear rebase-merge c941bc6dcb66af0485a030a98e54445c7abb5801 and branch removed by cleanup Action #38035484790.** Fixed GitHub parent `6af6bca49523c774961fd697fb6561960f2a2cfd`; existing FileExplorer 100k synthetic Grid/Details and native PostgreSQL request/SQL tests are already measured and merged. Blocked open #1185 tests **Desktop Gallery IPC progress callbacks**, a separate scope; keep it Draft, do not introduce race changes or duplicate its work. The general benchmark-first/AFTER-if-red rule is already present in AGENTS.md, no policy update needed.


**Final exact-head remeasurement and delivery (2026-10-10).** [Successful CI 38034517714, benchmark job 114162140416](https://github.com/lazyxu/xdrive/actions/runs/38034517714/job/114162140416) on one-work-commit `ad8d29fc5cc8bdb0eda011c2e7332859daf39622` independently reran six actual shared FileExplorer Grid/Details Chromium scrolls with real signed PostgreSQL17/Gin/CAS JPEG bytes. Grid three per-run worst Go Context notification delays **51.153, 35.623, 38.408ms**; Details **27.147, 28.043, 26.396ms**; overall worst **51.153ms ≤160ms**. In all six runs old Gin handlers @+160ms **0**, additional stale bytes **0B**, contexts done **6/6**, canceled old requests **6/6**, fresh signed counted 200-item/100k children range **HTTP200**. This is a new independent run, not a BEFORE/AFTER product code change; no throughput percentage, peak RSS or 100k physical JPEG/MP4/LIVP decode claim. [PR #1298](https://github.com/lazyxu/xdrive/pull/1298) merged on master by rebase commit [c941bc6dcb66](https://github.com/lazyxu/xdrive/commit/c941bc6dcb66af0485a030a98e54445c7abb5801) and [PR close cleanup 38035484790](https://github.com/lazyxu/xdrive/actions/runs/38035484790) succeeded; exact performance branch absent. Preserve previous historical initial run and its gofmt-only correction notes as provenance, not as an unresolved blocker.

**Known separate BEFORE baselines:** 24/24 actual shared Web/Desktop 100k Grid/Details image/video/LIVP *renderer* scenarios satisfied max mounted 110, peak retained 1200 and six-thumbnail-in-flight structural limits with synthetic SVG thumbnails; these do NOT include authentic JPEG/MP4/LIVP HTTP. The authentic native PostgreSQL image cache benchmark sampled 102 physical requests in a 100k image namespace: cold P50 39.121ms; warm P50 1.866ms, Server-only (no browser). #1203 already demonstrated 100k children SQL cancellations releasing 6/6 native SQL waiters and handlers by +160ms, but no mounted Grid/Details scroll. The merged Gallery Web #1284 measured *its own* production Gallery scroll-to-Go network request cancellation (18/18 across n=3, all +160ms); it does not prove FileExplorer view ownership.

**Frozen current-source test:** Actual shared `XDriveFileExplorer` Grid and Details Web UI in Chromium, actual virtual scroll host and `XDriveFileExplorerThumbnailProvider`, real `AbortSignal` from the existing six-concurrency scheduler, real signed `/api/v1/nodes/:id/children` and `/api/v1/media/items/:id/thumbnail` backed by native PostgreSQL17, Gin, Local CAS, actual JPEG. Seed exactly **100,000 Nodes + 100,000 File rows + 100,000 MediaMetadata rows**, but only **16 distinct real JPEG CAS originals** reused by those logical entries; do NOT call this 100k physical JPEG decoding. First six real JPEGs are warmed outside the cancellation window. A *test-only* 1500ms response writer flushes the first real 256-byte JPEG chunk per watched first-viewport GET and delays the remainder. Once all six are already active, execute actual DOM scroll of the mounted Grid or Details scroll host to ~50% of its 100k height. Inspect Go `Request.Context().Done()`, Gin Handler return, response bytes and scroll geometry at +160ms; independently issue a new real signed 200-item children range at offset 50,000 and verify 100k total. Three fresh native schemas and Chromium partitions **per view** = six sessions; seed/build excluded from cancellation timing.

**Predeclared acceptance before running:** In **each** of the three Grid and three Details independent sessions: six genuine HTTP JPEG bodies must be active after exactly 256 bytes each; mounted UI items between 1 and 999, actual DOM scrollTop delta >10,000px, six Go Context notifications and six canceled HTTP handlers, **zero old active handlers and zero additional stale response bytes at +160ms**, worst notification **≤160ms**, new authenticated counted range **HTTP 200 / total_count=100000 / 200 items**; six image requests observed by the native probe and 6-request scheduled thumbnail concurrency unchanged. No synthetic direct `AbortController.abort()` as the triggering action. Real request cancellation is a resource reduction, not a successful-render wall-clock speedup. Original code must be preserved if within budget.

**Decision gate:** `BEFORE` = measured current product; `AFTER` = N/A unless repeated native real-red. If the six-session workload fails, first distinguish invalid harness/SQL memory/fixture from actual request ownership; only fix production when a repeatable real load-release defect is established, then measure the **identical six-session** BEFORE/AFTER with full HTTP/CPU/RSS/correctness counters before retaining a meaningful optimization. No Race/concurrency feature work. **Durable work:** publish sample JSON and source-exact job/log provenance under `docs/performance-evidence/file-explorer-real-web-scroll-100k/` and these exact numbers here **within the same single work commit**, followed by full exact-head CI and linear PR merge. Preserve prior rejected/inapplicable attempts. Scoped opt-in GitHub/GitLab CI job `file-explorer-real-web-scroll-100k-performance`, driver `desktop/scripts/file-explorer-real-web-scroll-cancel-100k-main.cjs` and Go fixture `TestFileExplorerRealWebScrollCancelFixture100K`. GitLab job is config parity only; no GitLab execution is claimed.

**Limitations / next P0:** not authentic 100k MP4/HEVC/RAW/LIVP decode or CAS of 100k distinct originals, not mobile physical hardware, Electron Desktop Renderer → Main → Agent signed-media proxy, real 1/4GiB Server/CAS uploads/downloads, 100k actual sync/physical-delete throughput or durable Task Center cancellation. Continue those as distinct named baselines after this real Web FileExplorer viewport test. Closing/switching a window must cancel abandoned media/range requests, **not durable transfers, sync or delete jobs**.



### Source-exact native CURRENT/BEFORE — six real mounted Grid/Details samples (2026-10-10)

**Status: Accepted unchanged production on the measured source, pending final evidence-amended CI.** [GitHub CI 38034119067 / scoped job 114160904557](https://github.com/lazyxu/xdrive/actions/runs/38034119067/job/114160904557) successfully ran the **single-work-commit original measured head `617353f3219d60c21567f5b771d34fa03e9560c0`** with six independently seeded PostgreSQL17 schemas, genuine Web shared FileExplorer DOM, six actual signed first-visible JPEG body GETs per session, and test-only 1500ms slow-writer pause after **256 genuine bytes/request**. Original metadata and native CAS fixture were identical across both views: **100,000** Nodes + File + MediaMetadata and **16 physically distinct 800×600 JPEG originals** (not 100k different binaries). All original frozen budgets passed.

| Real view | Independent run | scrollTop delta | Mounted items before | Canceled HTTP & Context Done | Old handlers @+160ms | Extra old bytes | Worst Go Context notification | Fresh counted children range | Fixture seed excluded |
| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | --- | ---: |
| Grid | 1 | 672,385px | 88 | 6/6; 6/6 | **0** | **0 B** | **41.875ms** | HTTP 200, 200 of 100k | 9,096.764ms |
| Grid | 2 | 672,385px | 88 | 6/6; 6/6 | **0** | **0 B** | **41.679ms** | HTTP 200, 200 of 100k | 9,086.833ms |
| Grid | 3 | 672,385px | 88 | 6/6; 6/6 | **0** | **0 B** | **39.953ms** | HTTP 200, 200 of 100k | 8,948.047ms |
| Details | 1 | 1,799,661px | 30 | 6/6; 6/6 | **0** | **0 B** | **19.452ms** | HTTP 200, 200 of 100k | 9,008.977ms |
| Details | 2 | 1,799,661px | 30 | 6/6; 6/6 | **0** | **0 B** | **22.986ms** | HTTP 200, 200 of 100k | 8,963.565ms |
| Details | 3 | 1,799,661px | 30 | 6/6; 6/6 | **0** | **0 B** | **36.488ms** | HTTP 200, 200 of 100k | 8,834.484ms |

**Frozen gate verdict:** actual mounted virtual scrolling (not manual AbortController) led to 36/36 old thumbnail Request Context cancellation notifications and genuinely exited handlers. Max of each session's Go notification times: Grid median **41.679ms**, Details median **22.986ms**, overall worst **41.875ms**, all ≤160ms; 0 stale HTTP body emissions after scroll, 0 old active handlers at +160ms. **BEFORE/current accepted; AFTER: N/A** because production already met budget. **Product delta/elapsed speedup: N/A** — the controlled 1500ms delayed response is only a cancellation-stress fixture and not a WAN speed comparison. Every fresh range after scrolling returned 200/100,000, confirming no global operation cancel was triggered.

**Source boundaries:** real Web Grid/Details with same production virtual surfaces/thumbnail scheduler/REST APIs; 100k metadata rows, limited physically stored CAS originals, warm first six JPEG derivatives, no full 100k decode, genuine 4K/HEVC/LIVP/RAW, mobile physical browser, Desktop Main→Agent IPC, network bandwidth, process CPU/RSS peak, task durability or 100k full sync/delete throughput. Preserve production behavior, including Task Center upload/download/sync/delete independence.

**Raw evidence:** [six source-exact JSON samples, six pre-range cancel diagnostics, native summary, frozen acceptance and provenance](performance-evidence/file-explorer-real-web-scroll-100k/ci-run-38034119067.json). The initial all-branch CI run also flagged **one gofmt alignment line in this opt-in Go test fixture** in the normal `go-linux` format check; the actual measured benchmark job itself passed. That is a test-format-only failure, not a product performance first red. Fix the one gofmt line in this same work commit and require a new **full exact-head PR CI success including final-gate** before any merge. No mixed-head success attribution. The GitLab job is configuration parity; GitLab execution is not claimed.

## P0 · Native 100k real H264 signed video preview HTTP cancellation — Browser viewport ownership and window teardown (2026-10-10)

**Status: Accepted / real Chromium signed H264-to-native Gin Context cancellation meets frozen +160ms n=3×2-mode gate; no production optimization; evidence-amended final full CI pending.** Frozen GitHub master baseline `af3c1e822b44046dc1ece4f1fa4eb5f9004d2601`. Existing related transport work is merged: Gallery virtual-range #1138 real HTTP abort, #1144 native PostgreSQL request cancel, and #1271 genuine H264 100k poster lifecycle. The only open performance PR #1185 concerns blocked Desktop media progress IPC event delivery, not this Web preview streaming cancellation; it remains Draft and untouched.

**Current evidence (distinct scopes, not comparable speedups):** #1271 verified six authentic 2,970-byte H264 samples in a 100,000-video metadata directory: first signed preview → Chromium first-frame JPEG → persisted PUT → warm cache; n=3 median of cold per-video P50 **17.7 ms**, warm-cache P50 **3.6 ms**, zero original-video Store.Open on warm. Independently, Gallery video poster scheduler #1088 achieved **3/3 old Node HTTP request disconnects before +160ms**, zero obsolete bytes, but used mock nondecodable body and no signed Gin/Chromium video. The signed Go/desktop Range benchmark qualified actual transport/Agent proxy cancellation with *nondecodable* MP4-sized payloads; it did not exercise real HTMLVideoElement teardown. **Those historical benchmarks did not provide a comparable actual Chromium video-element cancellation measurement; the new independent result is recorded below.**

**Frozen new native workload:** existing real 100,000 distinct video Node/File/MediaMetadata fixture and six physically stored SHA-distinct, decodable 96×64 H264/MP4 sources (2,970 bytes each), two from each of first/middle/end. Three independent native PostgreSQL17 schema/Go Server + Chromium sessions. Within each session run **three real authenticated signed Preview Engine video streams** in each of two request-owner lifecycles: (a) simulated virtual-viewport eviction calling the actual AbortSignal passed into the *production source-extracted* `xDriveCaptureVideoPosterBlob` Chromium helper, and (b) closing the actual Electron BrowserWindow with three in-flight video requests. Tickets are issued by the real Gin authentication and actual Store.Open/ServeContent. An explicitly test-only HTTP ResponseWriter sends the first **256 genuine original bytes per streaming request**, then pauses 1,500ms; after all three requests are observed active and have a Range header, signal abort/close and inspect native `Request.Context()`, active handler count, emissions and poster PUTs **at +160ms**. Measure Server context notification delay from an explicit test-only cancel marker; seed time separately. After each independent fixture, a new signed real HTTP Range GET must still return **206 / 1024 exact bytes**. Do not mistake artificial writer pacing for real WAN throughput.

**Predeclared acceptance, each mode per run (6 mode runs, 18 actual signed stream requests):** all three authenticated video Range requests must already be active and have emitted an initial genuine 256-byte body before abort; 3/3 `Context.Done()` and 3/3 genuinely canceled Gin handlers, **0 stale active handlers at +160ms**, **0 additional bytes emitted after the observed abort point**, **0 cache backfill PUTs**, worst Go context-notification ≤160ms. The Chromium source-extracted capture promises for the viewport-eviction mode must settle with three null JPEGs, not late posters. BrowserWindow destruction is actual in the second mode. Require six independently issued SHA identities and a healthy new preview after cancellation. Record raw started/active/cancelled contexts, signed Range headers, first/emitted/stale bytes, saved bytes vs the complete 3×2,970B payload, Context latency, fixture seed time, and success/failure per mode in native CI JSON. Don't claim 100k physical video streaming, real screen-scroll UI, Desktop Agent IPC, active decoder CPU cost, or distributed derivative/Task Center job cancellation.

**Source-exact measured CURRENT / BEFORE (unchanged runtime) — [GitHub CI 38025011662 / job 114133897053](https://github.com/lazyxu/xdrive/actions/runs/38025011662/job/114133897053), SHA `9e1a3d45df11514b39097ed845b38d9d892a4625`: ACCEPTED.** Three independent native PostgreSQL17/Gin/local CAS 100k metadata schemas and real Electron Chromium sessions. Six groups total, each with three separately authenticated, *already-active* Range streams of decodable 2,970-byte H264 MP4 file contents; all six groups emitted exactly **3×256=768 genuine bytes before cancellation**, and **0 additional bytes** thereafter. Every group observed 3/3 Go `Request.Context().Done()` notifications, 3/3 genuinely canceled signed Handler completions, **0** active at +160ms, **0** stale poster PUT; the viewport-owner group produced three null capture results. All three independent healthy post-abort signed Range requests returned **206 / 1,024 exact bytes**. Fixture seeding excluded from cancellation delays.

| Native run (100k logical video records, 6 physically seeded H264 videos) | Simulated viewport eviction — worst Go Context notification | Real Window destruction — worst Go Context notification | Old signed streams aborted per run | Handler active at +160ms | Late response bytes per run | Late poster PUTs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | **3.257 ms** | **6.523 ms** | **6/6** | **0** | **0 B** | **0** |
| 2 | **2.446 ms** | **6.361 ms** | **6/6** | **0** | **0 B** | **0** |
| 3 | **2.283 ms** | **7.128 ms** | **6/6** | **0** | **0 B** | **0** |

The maximum observed **7.128 ms** is a Go Context **notification** measured from a deliberately preceding test-only cancel marker, not absolute packet propagation time, actual codec decode latency, high-bandwidth Server transfer throughput or OS resource-usage peak. Within the artificial 1.5s delayed-body fixture, each discarded three-stream group avoids completing **8,142 bytes** of possible remaining payload versus an un-aborted 8,910-byte full response; this is a workload-specific structural byte bound and is **not a production WAN savings ratio**. All 18 signed Range requests were confirmed started and canceled. Source-exact full raw per-stream-group events, seed durations and acceptance: [ci-run-38025011662.json](performance-evidence/file-explorer-h264-cancel-100k/ci-run-38025011662.json).

**BEFORE/current accepted:** actual n=3 source-exact measured, no product changes. **AFTER:** N/A because current is below 160ms. **Delta:** no wall-clock code optimization speedup. **Decision:** preserve production Go HTTP, browser video capture, cache, dedup and independent durable Task Center lifetimes. The initial ordinary `go-linux` job failed only due to **test fixture Go formatting** (one blank line and three JSON field alignment corrections); it is not a production performance failure. The exact formatting correction and raw evidence are folded into the *same one-work-commit PR*, and the entire amended-source CI must pass before merge. Next P0: real mounted 100k FileExplorer Grid/Details scroll-triggered cancellation, Desktop Renderer→Main→Agent signed video decoders, true 4K/HEVC and full Server/CAS large-file transfers.

**Decision rule:** if all six benchmark mode runs meet the resource budgets, mark **Accepted unchanged production**; no new explicit cancellation endpoint, lock, controller or arbitrary `ctx.CancelFunc` injection. If a real upstream continuation persists after browser ownership expires, preserve first-red and consider the smallest proven transport/Go fix, with three identical BEFORE/AFTER repeated native samples and no Task Center upload/download/sync/delete change. This is performance/load shedding, not Race work.

**CI/command:** `XD_TEST_DATABASE_URL=postgres://... xvfb-run -a ./node_modules/.bin/electron --no-sandbox scripts/file-explorer-real-h264-cancel-100k-main.cjs` from `desktop/`, runner sets the already opt-in Go fixture `XD_FILEEXPLORER_REAL_H264_100K_PERF=1` and new `XD_FILEEXPLORER_H264_CANCEL_100K_PERF=1`. The benchmark job `file-explorer-real-h264-cancel-100k-performance` is scoped only to branch `perf/file-explorer-real-h264-cancel-100k` in GitHub and GitLab. The three valid native samples and accepted unchanged-code decision are archived in the canonical document and raw evidence path on this same single-commit PR. Rerun the entire final source-exact GitHub PR CI after this amendment; only then mark Ready, rebase-merge and verify safe redundant branch deletion.

## P0 · Native 100k video metadata + genuine H264 browser poster lifecycle (2026-10-10)

**Status: Accepted / n=3 native real H264 signed Preview Engine → Chromium decode → Server revisioned JPEG cache, unchanged production; exact evidence-amended full PR CI pending.** Earlier 100k FileExplorer video-poster cache HTTP (102 misses/PUT/hits), synthetic Grid/Details traces and independent H264 codec microbenchmark measured different components. The current test connects them through signed Preview Engine source and persistent Server poster, without rewriting FileExplorer UI or changing runtime code. Open Desktop Gallery progress PR #1185 is separately blocked and untouched.

**Fixed workload:** native PostgreSQL 17, authenticated production Gin routes and Local CAS, **100,000 distinct .mp4 Nodes with File and MediaMetadata** for one owner. Exactly **six** at offsets 0/50,000/99,998 contain *genuinely decodable* H264/MP4 bytes from the already accepted 96×64 Chromium fixture; remaining **99,994 items are metadata-only**. Three independent fresh native schema/Go-Server processes and isolated visible Electron/Chromium BrowserWindow renderers. Each browser confirms a counted 200-item FileExplorer Server range with total_count=100000, then invokes the actual shared xDriveResolveMediaVideoPoster / xDriveCaptureVideoPosterBlob through: cold authenticated thumbnail 404 → authenticated signed Preview Engine ticket/Range HTTP → real HTMLVideoElement H264 decode and JPEG canvas → revisioned poster PUT → JPEG image decode. Warm same six: persisted JPEG GET with ETag, no video decoding/PUT, verify **0 original Store.Open, 6 cached-poster Store.Open**. No mock Preview GET, fake codec data, artificial delays or new production endpoint.

**Acceptance frozen before first data:** three complete source-exact independent fixtures, correct 100k/200 page, 6/6 cold misses, six actual video decodes to nonempty JPEG, six accepted revisioned PUT, six warm JPEG/ETag hits, no additional original opens and six poster opens during warm pass, **each cold per-video resolution below existing 15,000 ms codec-capture timeout**, browser does not crash. Capture each cold/warm duration (ms), first decoder cost and P50, output JPEG bytes, underlying original/poster open counters, fixture seed time excluded, and renderer working-set snapshot (not peak). Cold-versus-warm timings are distinct cache states, **not** a code-change speedup. If current budgets pass, accept unchanged production. If a failure originates in fixture/measurement, correct the harness and revalidate before considering a production performance change.

**Invalid initial test-fixture run (not production first-red):** [GitHub CI 38022441586 / scoped job 114126136063](https://github.com/lazyxu/xdrive/actions/runs/38022441586/job/114126136063), first work head bd11d604a1167d252cf2f076d52e48624620e9d6. The measured browser ran 6 actual H264 captures, 6 successful poster PUTs and 6 warm JPEG reads with **0 new original reads**. Only **1 cold GET returned 404** because the six different Node IDs initially had byte-identical MP4 content and correctly shared the SHA256-derived Server VideoPosterStorageKey; five subsequent GETs were warm. This was an invalid independent-cold fixture, not a production performance fault. The test now appends one valid node-specific 12-byte ISO BMFF free box to each real H264/MP4, verifies all six hashes are distinct, and keeps the H264 media stream and production dedup rules unchanged. A local FFprobe smoke check confirmed that a valid trailing free box remains decodable and the corrected Go snippet passed gofmt. Preserve the original six-cold/six-warm gate for source-exact CI; no product speedup is claimed from the invalid run.

**Source-exact native CURRENT / BEFORE (three fresh host runs, no product change):** [GitHub Actions 38022798765 / job 114127268467](https://github.com/lazyxu/xdrive/actions/runs/38022798765/job/114127268467), benchmark work SHA `3450e343537c6c8246e5ab88485dc7b99a5931df`, PostgreSQL 17/Gin/local CAS + actual Electron Chromium on Xvfb. **All three runs passed** the frozen 100k count + first 200-item range, six unique 2,970-byte real H264 originals (two samples from each of offsets 0/50,000/99,998), 6/6 real video HTMLVideoElement-to-JPEG captures, 6/6 original Store.Open, 6/6 cold 404, 6/6 revision-fenced poster PUT, 6/6 warm 200 JPEG+ETag, exactly six warm poster Store.Open and zero warm original Store.Open. Every JPEG was 2,338 bytes; all cold per-video calls were below the existing 15,000 ms timer.

| Independent real PostgreSQL+Chromium run | Per-run cold video P50 (ms) | Per-run cached JPEG P50 (ms) | Cold 404 / real JPEG capture / poster PUT | Warm cache hit / original re-open / poster open | Fixture seed excluded (ms) | Renderer working-set snapshot (KiB) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | **17.700** | **3.800** | 6 / 6 / 6 | 6 / **0** / 6 | 6,368.031 | 155,208 |
| 2 | **19.800** | **3.200** | 6 / 6 / 6 | 6 / **0** / 6 | 7,548.288 | 155,624 |
| 3 | **17.000** | **3.600** | 6 / 6 / 6 | 6 / **0** / 6 | 6,120.150 | 153,604 |

**Current source measured aggregate:** median of per-run cold P50 **17.700 ms**, median of per-run warm P50 **3.600 ms** (independent cache-state results; **not a code-change speedup**). The longer cold path includes authenticated signed-ticket/MP4 read, video decode, canvas JPEG, Server PUT and image decode; warm includes persisted read and JPEG decode. Renderer working-set values are **post-result snapshots, not peaks or growth deltas**. Browser workload time/each individual cold/warm duration and seed time remain in [raw three-sample JSON](performance-evidence/file-explorer-real-h264-100k/ci-run-38022798765.json). No CPU/RSS/I/O reduction or throughput gain is claimed.

**Decision: Accepted existing implementation / no production optimization. AFTER product code N/A.** The frozen correctness and existing 15-second capture deadline all passed on three independent source-exact runs, so do not adjust poster cache, concurrency, video decoder, SHA dedup or production request cancellation. Document/JSON evidence amendment changes this PR's work SHA and therefore **must pass a new complete exact-head PR CI before merge**. Next P0: genuine browser mounted 100k FileExplorer video Grid/Details (including viewport scroll-to-upstream cancellation and shared derivative load ownership), then 4GiB real Server/CAS Web/Desktop transfers and 100k synchronization/deletion with actual physical bytes.

**Unmeasured here:** mounted FileExplorer Grid/Details UI and virtualization, real 4K/H.265/long-video bytes, Live Photo motion, Desktop Agent IPC, mobile/physical hardware, WAN, full-disk transfer, CPU/peak RSS, fast-scroll cancellation of genuine video decode, and durable Task Center upload/download/sync/delete. Do not infer those from this small 96×64 H264 fixture even though the logical directory contains 100k videos.

**Benchmark command:** from desktop/ with XD_TEST_DATABASE_URL configured, xvfb-run -a ./node_modules/.bin/electron --no-sandbox scripts/file-explorer-real-h264-100k-main.cjs. The runner invokes the opt-in Go test TestFileExplorerRealH264PosterBrowser100K three times with XD_FILEEXPLORER_REAL_H264_100K_PERF=1. Dedicated GitHub/GitLab job file-explorer-real-h264-100k-performance runs only on perf/file-explorer-h264-poster-web-100k. Raw per-sample browser and Gin metrics, source/runtime info, BEFORE/current/AFTER=N/A, and accept/reject decision must be amended into this canonical document plus docs/performance-evidence/file-explorer-real-h264-100k/ on the *same one-work-commit branch*, then pass final source-exact CI before merge.

## P0 10k/100k authenticated HTTP permanent Trash deletion — measurement-first (2026-10-10)

**Status: Accepted / matched native PostgreSQL17 full HTTP metadata deletion A/B passed (n=3 per scale); final evidence-amended exact-head CI pending; not yet merged.** Related 100k queued soft-delete fixes #1210/#1213, restore measurement #1231, and viewport SQL cancellation #1237 already merged. The open Desktop Gallery IPC progress benchmark #1185 is blocked on source-exact event delivery and is deliberately not modified by this FileExplorer track. No active permanent-delete performance branch/PR existed at selection time.

**Source audit / first-red hypothesis:** production `internal/api/history_trash.go::trashDeletePermanently` computes a complete deleted-subtree ID slice, then passes it as a GORM `IN ?` slice to FileVersion/File/Share deletion and final Node deletion. With 100,001 subtree IDs, PostgreSQL extended-protocol parameter count may exceed 65,535 and atomically fail. That remains a hypothesis until the real HTTP+PG17 baseline below finishes. Already accepted source helper `fileOperationDeleteIDArrayLiteral` supports a bounded single `bigint[]` SQL parameter in the separate queued soft-delete worker, but must not be applied speculatively before first red.

**Frozen workload:** three independent fresh PostgreSQL17 schema/Go processes at **10,000 and 100,000 file-type child Nodes**, one trashed selected directory, matching `xd_files` and `xd_file_versions` metadata rows per file, one in-subtree Share, one out-of-subtree Share and live sibling, owner and foreign signed users. Drive the **actual authenticated Gin DELETE /api/v1/trash/:id** with `If-Match: "2"`, and foreign-user 404 and stale-revision 409 controls. Measure HTTP response status/bytes, wall time in milliseconds, Go `TotalAlloc` delta bytes, exact subtree/metadata/Share row counts and matching audit event count after the request; report whether a native SQL error includes a 65,535-parameter overflow. Seed/ANALYZE excluded from elapsed. Empty storage keys deliberately exclude physical CAS/legacy bytes, actual media thumbnails, browser/Agent transport, and disk GC.

**Confirmed native HTTP baseline (n=3 per scale, original production unchanged):** [CI run 38018185939 / job 114113078678](https://github.com/lazyxu/xdrive/actions/runs/38018185939/job/114113078678); source-exact branch head `11a894f79a105d7f0c16b0a6f6c2bf03a62d257a`, fixed production parent `9ab6fac1e5dcef97dff2d30149d3e8ddd17245ee`. All 6 full-run harness cases passed their original BEFORE contract. [Six complete unrounded rows](performance-evidence/trash-permanent-100k/first-red-ci-38018185939.json).

| Unchanged production | HTTP times for 3 fresh native PG17 schemas (ms) | Median (ms) | Go TotalAlloc delta bytes | Outcome |
| --- | --- | ---: | --- | --- |
| 10,000 selected files + 10,000 File + 10,000 FileVersion rows | 372.623 / 442.903 / 378.705 | **378.705** | 42,222,712 / 42,252,912 / 42,258,736 | HTTP 204, correctly deleted; 3/3 within 5s |
| 100,000 selected files + 100,000 File + 100,000 FileVersion rows | 102.117 / 112.926 / 109.906 | **109.906** | 54,767,048 / 54,800,976 / 54,769,152 | **HTTP 500 and PostgreSQL 65,535-bind error, 3/3** |

**First-red correctness:** The 100k failure returned no partial commit: **100,001/100,001 Nodes, 100,000/100,000 File rows, 100,000/100,000 FileVersion rows and the in-scope Share remained; out-of-scope Share and sibling unchanged; zero success audit.** Foreign-account 404 and stale-revision 409 tests passed. A failed-request 109.906ms median must **never** be reported as successful 100k delete throughput or compared as a wall-clock speedup. The 10k successful median is valid but should not change the existing small-subtree query plan.

**Minimal AFTER experiment (no race change):** for more than 32,000 validated subtree IDs in `trashDeletePermanently`, pass one array literal from the already-tested `fileOperationDeleteIDArrayLiteral` helper into `node_id = ANY(CAST(? AS bigint[]))` for FileVersion/File/Share predicates and `id = ANY(CAST(? AS bigint[]))` for the final Node predicate. Under that threshold preserve the original `IN ?`. Scope remains the current ownership/revision/transaction/audit boundary; no changes to actual CAS references, Task Center, client cancellation or UI. A matched same-runner alternating n=3 per scale BEFORE/AFTER CI must pass the original failure predicate and AFTER success budgets before claiming Accepted. Timing from failing BEFORE 100k is not valid throughput evidence. **After actual paired verification, archive six-arm raw results per scale and amend this document before merge, then rerun full exact-head CI.**

**Matched same-runner BEFORE/AFTER verified (n=3 each arm at each scale):** [CI run 38018552161 / job 114114280127](https://github.com/lazyxu/xdrive/actions/runs/38018552161/job/114114280127), candidate source `ce97d3f36c4d6ad2a2d36ec5b0e0962ed6fc710a`, original fixed master parent `9ab6fac1e5dcef97dff2d30149d3e8ddd17245ee`; alternating arm order (BEFORE/AFTER, AFTER/BEFORE, BEFORE/AFTER). Every test used the same benchmark source and independent native PostgreSQL17 schema. [All 12 unrounded source-exact arms and acceptance gates](performance-evidence/trash-permanent-100k/paired-ci-38018552161.json).

| Workload / wall-clock | BEFORE n=3 (ms) | AFTER n=3 (ms) | P50 BEFORE | P50 AFTER | Assessment |
| --- | --- | --- | ---: | ---: | --- |
| 10k file+history permanent deletion | 445.183 / 444.296 / 470.133 | 447.963 / 470.396 / 444.633 | 445.183ms, HTTP 204 | **447.963ms**, HTTP 204 | **+0.624% elapsed**, small path unchanged; no material regression |
| 100k file+history permanent deletion | 138.698 / 131.736 / 145.644 | 3,831.826 / 3,829.607 / 3,986.548 | **138.698ms failed HTTP 500**, not throughput | **3,831.826ms**, HTTP 204 | 3/3 correctly completed, max **3,986.548ms** |

| 100k per-arm resource/correctness | BEFORE original | AFTER candidate |
| --- | --- | --- |
| Go `TotalAlloc` delta (bytes) | 54,769,328 / 54,802,648 / 54,765,024 (**failed requests**) | **176,800,176 / 176,801,040 / 176,802,864**, median 176,801,040 B ≈168.6 MiB |
| Native PG bind-limit overflow | 3/3 | **0/3** |
| HTTP status | 500/500/500 | **204/204/204** |
| Target Nodes left | 100,001 | **0** |
| Target File/FileVersion rows left | 100,000/100,000 | **0/0** |
| In-scope Share left | 1 | **0** |
| Out-of-scope Share left | 1 | **1** |
| Success audit | 0 | **1** |

**Decision: Accepted minimal large-subtree SQL parameter fix.** The 100k AFTER result stays below the frozen per-sample 40,000ms/512 MiB Go `TotalAlloc` gates and all source/Share/audit/revision/ownership guards pass; 10k measured latency differs by just +0.624% median on the same run and remains well within 5s. This is a **functional scale restoration with measured successful completion**. No 100k speedup percentage can be claimed, as the 100k BEFORE never successfully deleted data. Peak RSS/real disk CAS/legacy cleanup, full browser/Electron IPC and cross-network 4GiB transfer remain separate unmeasured P0 workloads. The evidence-amended final work commit must pass the entire exact-head CI before marking Merged. No Race code or durable Task Center cancellation was changed.

**Before/after decision thresholds fixed before measurement:** 10k unchanged production must finish authenticated HTTP 204 with every selected File/FileVersion, Node and Share deleted, audit written, foreign/sibling unchanged; each response ≤5,000ms. 100k must also produce HTTP 204, with **each successful AFTER sample ≤40,000ms and Go `TotalAlloc` delta ≤512MiB**. If 100k BEFORE reproduces 65,535-bind error, it must return HTTP 500 with no partial subtree/metadata/Share deletion and no success audit; **failure latency must not be compared as successful deletion throughput**. Only after three valid native first-red samples, use the smallest bounded-parameter SQL fix, compare three alternating BEFORE/AFTER pairs using the same harness/machine, and keep the fix only if all correctness/resource gates pass without important regression. Otherwise preserve unchanged production and document Accepted current/Rejected candidate. Do not claim throughput speedup against failed original requests.

**Benchmark command:** `XD_TEST_DATABASE_URL=postgres://... XD_TRASH_PERMANENT_HTTP_PERF=1 XD_TRASH_PERMANENT_HTTP_COUNT=<10000|100000> XD_TRASH_PERMANENT_HTTP_EXPECT_FIXED=<0|1> go test -run '^TestTrashPermanentDeleteRealHTTPPerformance10K100K$' -count=1 -timeout=8m -v ./internal/api`. GitHub/GitLab branch-scoped job `file-explorer-trash-permanent-100k-performance`. If native first-red holds, archive all source-exact rows under `docs/performance-evidence/trash-permanent-100k/`, then rerun full exact-head CI after evidence documentation before merge.

**Unmeasured here:** physical CAS refcount/GC, network or local 4GiB upload/download, Task Center cancellation, actual Web/Desktop 100k UI, photo/video/Live decoding. This test cannot establish those separate P0 performance goals.


## P0 10k/100k authenticated HTTP Trash restore baseline (2026-10-10)

**Status: Accepted / n=3 per size real authenticated HTTP baseline passed; production unchanged; full evidence-amended PR CI pending.** The relevant 100k DELETE fixes #1210/#1213 merged; #1185 remains an unrelated real Desktop IPC progress benchmark. No open/active dedicated Trash restore performance PR or branch existed at the start.

**Frozen workload:** 10,000 and 100,000 file-type `xd_nodes` with matching `xd_files` metadata (1,024 bytes each) under one deleted directory with a shared real `trash_root_id`, plus one unselected live sibling. Each sample uses a new isolated PostgreSQL17 schema and a real authenticated Gin HTTP server, signed access token, `POST /api/v1/trash/:id/restore`, `If-Match: "2"`, actual HTTP status + JSON body. A different valid signed user's request must receive HTTP 404. No physical CAS contents are stored: **metadata/SQL + real HTTP route only**, not real disk bytes. Seed and ANALYZE time are recorded separately and excluded from the HTTP measurement.

**Acceptance frozen before measurement:** 3 fresh-process independent native-PG trials per scale (6 total). Every successful response must restore N/N children and root, preserve all child revisions and original N `xd_files` metadata rows, set root revision 2→3 and clear all deleted/Trash fields, leave the sibling unchanged. **100k: median HTTP ≤5,000ms and every sample ≤8,000ms. 10k: median HTTP ≤1,500ms and every sample ≤3,000ms.** Each Go `TotalAlloc` delta ≤128 MiB. Report median [min,max] and each sample's response bytes/HTTP status/latency/allocated bytes, plus seed duration. TotalAlloc is cumulative allocations (not RSS). If all budgets pass, accept the existing production implementation without speculative optimization; otherwise preserve failed baseline and only then make a narrow production change and same-workload alternating BEFORE/AFTER. No percentage speedup from a benchmark-only branch.

**Measured unchanged production (n=3 fresh PostgreSQL17 schemas/size):** [CI run 38013902607 / job 114099858517](https://github.com/lazyxu/xdrive/actions/runs/38013902607/job/114099858517), test-only work commit `6795888d5856255b82e597883086fe58f1ddefda` on exact master `2d00ffca46496c5d9be6998f56b500d387493211`. Real HTTP 200, correct response JSON and owner/revision protections; all 10k/100k children restored with preserved File rows/child revisions, no residual Trash fields, and unchanged sibling. Foreign owner gets HTTP 404. Six source-exact raw measurements are archived in [ci-run-38013902607.json](performance-evidence/trash-restore-real-http-100k/ci-run-38013902607.json).

| Real HTTP restore | Three independent wall times (ms) | P50 (ms) | Go `TotalAlloc` delta per sample (bytes) | Decision |
| --- | --- | ---: | --- | --- |
| 10,000 children + 10,000 File metadata rows | 109.792 / 109.156 / 107.631 | **109.156** | 86,104 / 84,312 / 83,432 | Pass, no optimization |
| 100,000 children + 100,000 File metadata rows | 1,077.999 / 1,070.399 / 1,142.614 | **1,077.999** | 86,104 / 85,000 / 86,080 | Pass, no optimization |

**Decision: Accepted current production, no SQL/backend change.** 10k and 100k P50 and worst samples satisfy the predeclared thresholds, every sample stays under 128MiB cumulative allocation. Seed times are **excluded**: 10k seeds 989.225 / 403.723 / 378.208ms; 100k seeds 3783.602 / 3743.774 / 3771.174ms. The measured delta is in-process allocations over the HTTP call, **not** backend RSS, PostgreSQL buffer/cache footprint or physical CAS bytes. Scaling is approximate, but **not a before/after product speedup**. The original benchmark source was a valid real performance probe; an unrelated Go format-only failure in initial normal CI is fixed in the evidence-amended work commit, requiring exact-head full CI rerun.

**Unmeasured separately:** 100k FileOperation Undo/Redo/Trash restore lineage, permanent delete/CAS GC, sync replays, actual JPEG/MP4/LIVP browser decode, Web/Desktop 4GiB remote networking, viewport abort and sender-scoped HTTP/IPC context cancellation. Those cannot be claimed from this handler benchmark.

**Command:** `XD_TRASH_RESTORE_HTTP_PERF=1 XD_TRASH_RESTORE_HTTP_COUNT=<10000|100000> XD_TEST_DATABASE_URL=postgres://... go test -run '^TestTrashRestoreRealHTTPPerformance10K100K$' -count=1 -timeout=5m -v ./internal/api`. GitHub/GitLab branch-scoped job `file-explorer-trash-restore-100k-performance`. Raw CI measurements must be amended into this canonical document and verified on the exact evidence-amended head before any merge.


## P0 full queued FileOperation DELETE executor 100k — first-red confirmed (2026-10-10)

**Status: Merged / Accepted (#1213; final exact-head full GitHub PR CI success 37983497139, rebase merge 0766a60ec0ac49f5f068a4d3fd7161c0fbf60c6d).** The earlier [#1210](https://github.com/lazyxu/xdrive/pull/1210) fixed the *Node soft-delete SQL primitive* and merged after full CI. Its successful 100k Node UPDATE does not make the whole DELETE transaction work: `executeQueuedBatchDelete` still expands the 100,001 selected IDs for `xd_shares.node_id IN ?`, before invoking the now-bounded Node UPDATE.

**Frozen workload:** native PostgreSQL 17, 100,000 owner-scoped `xd_nodes` and 100,000 `xd_files` metadata rows of 1024 bytes under one selected root, one running durable `xd_file_operations` DELETE, an in-scope and out-of-scope `xd_shares` row. Call the real Go `executeQueuedBatchDelete` transaction (root load, subtree aggregation, managed-target protection, progress, Share revocation, soft-delete, UndoPlan, status completion). Exclude Web/Desktop UI, physical CAS bytes/GC, live sync, Share token HTTP fetching and full undo/restore run. Seed time is excluded from executor duration. Record Go TotalAlloc, operation state and Share scope. Three independent native-PG schemas per arm, alternate BEFORE/AFTER order.

**Measured initial BEFORE source** `ce8e042e56d825771929e57a2d50bb7b27ffcbba`: [CI run 37981553163 / job 113993673559](https://github.com/lazyxu/xdrive/actions/runs/37981553163/job/113993673559). All three attempts failed with `extended protocol limited to 65535 parameters` in **422.936 / 437.898 / 420.315 ms**, median **422.936 ms**. Go allocation deltas **75,877,424 / 75,910,368 / 75,911,472 bytes**, median **75,910,368 bytes**. **0 trashed Nodes, no Share revoked, FileOperation still running** after each rollback. **These are failure latencies, not successful deletion throughput.** Raw [n=3 first-red JSON](performance-evidence/file-operation-queued-delete-100k/ci-run-37981553163.json).

**Matched AFTER verified:** [run 37982836545 / job 113997583486](https://github.com/lazyxu/xdrive/actions/runs/37982836545/job/113997583486), actual parent `601131aee5602fb21d0af2a49605e7b4be92cf9e` vs bounded-Share candidate `963c4b01b5a372faceead930d9b5681a1ba1a5d2`, identical harness, three alternated fresh PostgreSQL 17 schemas. Original Share `IN ?` fails in every BEFORE arm with `extended protocol limited to 65535 parameters` and 0 changed Nodes/Shares. The AFTER arm successfully completes the real FileOperation executor with exactly **100,001** trashed Nodes, **1** in-scope Share revoked, **0** outside Shares revoked, an UndoPlan, correct root/100k-child Trash metadata and revisions, retained 100k File metadata rows, and `completed` task state with **1 processed item and 102,400,000 processed bytes** in every sample.

| 100k executor stage | Trial 1 | Trial 2 | Trial 3 | P50 |
| --- | ---: | ---: | ---: | ---: |
| BEFORE failed SQL elapsed (ms, **not completed throughput**) | 409.491 | 422.046 | 414.413 | **414.413** |
| AFTER successful executor elapsed (ms) | 1,528.597 | 1,520.216 | 1,523.744 | **1,523.744** |
| BEFORE failed Go `TotalAlloc` delta (bytes) | 75,874,632 | 75,911,280 | 75,918,512 | **75,911,280** |
| AFTER successful Go `TotalAlloc` delta (bytes) | 41,090,888 | 41,088,584 | 41,128,048 | **41,090,888** |

All AFTER samples satisfy the previously frozen **≤30,000 ms and ≤128 MiB Go TotalAlloc delta** gates. **Decision: Accepted for full executor SQL-stage functionality with bounded parameters, not a claimed wall-clock speedup over an unsuccessful operation.** The observed allocation samples differ by execution outcome (original abort vs candidate completion), not isolated allocator microbenchmarks; they do not establish peak RSS. Full evidence including original unrounded per-arm sample rows and provenance: [ci-run-37982836545-paired.json](performance-evidence/file-operation-queued-delete-100k/ci-run-37982836545-paired.json). A fresh full PR CI on the evidence-amended exact head is required before merging. Actual remote GitLab pipeline, 100k user-facing Trash restore/CAS GC, Web/Desktop HTTP/Agent, genuine MP4/Live decode, sync and cancellation of durable tasks are not covered by this benchmark.

**Minimal AFTER candidate:** preserve ordinary Share `node_id IN ?` under 32,001 subtree nodes; for larger subtrees pass the previously validated `fileOperationDeleteIDArrayLiteral` as **one `bigint[]` SQL parameter**, constrained by owner ID and `revoked_at IS NULL`. Same transaction, per-root operation checkpoint, protected-source validation and undo plan. This is not a new task cancellation architecture and does not touch Race code. Test the parent `master` with the same injected test file as original BEFORE, and the candidate as AFTER, three alternated pairs on the same CI runner.

**Predeclared acceptance:** all three BEFORE arms reproduce 65,535-bind error without partial delete; all three AFTER arms delete exactly 100,001 selected Nodes, revoke only the selected Share, preserve out-of-scope Share and sibling, maintain every child's `trash_root_id` and revision, leave `xd_files` metadata intact, write UndoPlan, and complete the FileOperation with **1 processed item / 102,400,000 processed bytes**. Each successful AFTER executor must complete in **≤30,000 ms** and emit **≤128 MiB Go TotalAlloc delta**. No causal wall-time % speedup is claimed since BEFORE fails. Correctness, bounded parameters and resource reduction are the decision gate; peak RSS, user-facing restore and actual CAS remain separate. Publish raw matched data and rerun source-exact full GitHub CI before merge.

**Command:** `XD_FILEOP_QUEUED_DELETE_100K_PERF=1 XD_TEST_DATABASE_URL=postgres://... XD_FILEOP_QUEUED_DELETE_100K_EXPECT_FIXED=<0|1> go test -run '^TestFileOperationQueuedDeleteExecutor100K$' -count=1 -timeout=6m -v ./internal/api`; scoped GitHub and GitLab performance jobs.


## P0 100k subtree soft-delete SQL — successful bounded mutation (2026-10-10)

**Status: Accepted in native PostgreSQL 17 soft-delete SQL stage / final source-exact full CI pending.** The production `markFileOperationDeleteSubtreeTx` uses `WHERE n.id IN ?` against a list of all selected subtree IDs. The original unbounded 100k query reproducibly exceeded PostgreSQL's 65,535-parameter limit, and the bounded one-array query now succeeds in 3/3 matched trials.

**Named workload:** actual PostgreSQL 17 and production subtree-delete SQL, 100,000 file-type child Nodes under one directory plus the root (100,001 IDs). Metadata-only SQL test: no 100k physical CAS files and not yet a full Task Center operation. Seed and SQL mutation are timed separately, along with Go TotalAlloc delta, root revision, exact soft-deletion count and transaction rollback. Three independent fresh-schema PostgreSQL trials.

**BEFORE:** expect PostgreSQL's bind-limit error and zero modified Nodes in the original code. If a different failure or successful delete occurs, correct the benchmark before changing production. Failed query elapsed is **not** successful delete throughput. The initial PR adds test, provider-parity CI jobs and this documentation only.

**Source-exact BEFORE evidence:** [GitHub run 37978549397](https://github.com/lazyxu/xdrive/actions/runs/37978549397), [scoped job 113982910988](https://github.com/lazyxu/xdrive/actions/runs/37978549397/job/113982910988), original benchmark-only PR head `22a60debb2851f42f148db60fe29b9b7d3d98f44`. Three fresh native PG17 schemas returned `extended protocol limited to 65535 parameters`, with **100,001 subtree IDs and 0 trashed rows** each; failed mutation elapsed **188.611 / 203.266 / 203.391 ms**, Go `TotalAlloc` delta **58,312,568 / 58,313,216 / 58,319,136 bytes**. These timings are **failure latencies**, never successful delete throughput. [All three raw rows](performance-evidence/file-operation-delete-subtree-100k/ci-run-37978549397.json).

**Minimal AFTER experiment:** for the existing helper only, use a bounded single PostgreSQL `bigint[]` bind with `= ANY(CAST(? AS bigint[]))` when the selected subtree exceeds 32,000 IDs; keep the original `IN` query below that threshold. This is a resource-bounded fix for confirmed SQL parameter overflow; preserve root ownership/revision and Trash semantics. The AFTER acceptance remains the previously declared 100,001 correctly trashed rows within 10 seconds and no meaningful memory regression. The three alternating same-runner BEFORE/AFTER pairs completed successfully; the final evidence-amended head still requires full CI.

**Measured A/B (3 alternating native PostgreSQL 17 pairs):** [run 37979441733 / job 113986460189](https://github.com/lazyxu/xdrive/actions/runs/37979441733/job/113986460189). Exact parent production BEFORE `163376baaf9b330863c84c67351378c79ffcf232` vs candidate source `c38591a9d6661c738b4cd04ba354e9daaa489e7c`, identical test harness, fresh schema per arm. BEFORE error `extended protocol limited to 65535 parameters` and 0 soft-deleted rows in all three. AFTER `bigint[]` query succeeded, **100,001 correctly soft-deleted rows in all three**, with the selected root revised once. Successful AFTER mutation durations **1196.839 / 1137.638 / 1068.664 ms**, median **1137.638 ms**, all well under the 10s gate. BEFORE failure durations **107.880 / 105.837 / 106.766 ms** (median **106.766 ms**) are *not* successful delete throughput. Per-arm Go `TotalAlloc` deltas BEFORE **58,312,640 / 58,318,672 / 58,318,736 bytes**, AFTER **4,804,056 / 4,804,264 / 4,804,120 bytes**; the allocation reduction refers only to these different SQL execution outcomes and does not establish full worker peak RSS. Source-exact [all six unrounded rows](performance-evidence/file-operation-delete-subtree-100k/ci-run-37979441733-paired.json). **Acceptance: fixed the blocking SQL-limit failure, not a claimed elapsed percentage speedup.** The final benchmark harness also verifies every child's revision and Trash root, plus a nonselected sibling, and will be rerun with final CI.

**AFTER gate (only after real BEFORE red):** a bounded parameter or set-based SQL strategy must update exactly 100,001 intended Nodes, including root revision +1 and correct Trash metadata, while keeping other owners and previously deleted state protected. Require three same-runner alternating BEFORE/AFTER trials with original failure reproduced and AFTER success; provisional <=10 seconds mutation elapsed and no material Go memory regressions. Preserve small-subtree regression tests. This is a correctness/resource-boundedness gate; do not claim a percentage speedup from the failing original. Full 100k Task Center delete/Trash/restore, actual File/CAS refs and cancellation remain distinct follow-ups.

**Command:** `XD_FILEOP_DELETE_100K_PERF=1 XD_TEST_DATABASE_URL=postgres://... go test -run '^TestFileOperationSoftDeleteSubtree100K$' -count=1 -timeout=7m -v ./internal/api`. Exact CI run and raw samples must be committed here before merge.


## P0 FileExplorer 100k native Go request cancellation — baseline contract (2026-10-10)

**Status: Merged / accepted (#1203, commit 163376baaf9b330863c84c67351378c79ffcf232); exact-head GitHub CI run 37975897712 and final-gate passed.** Source audit: `internal/api/children_pagination.go` builds range SQL with `s.DB.Table("xd_nodes")` without `WithContext(c.Request.Context())`. This is an unmeasured cancellation gap, not a claim of proven PostgreSQL retention until native CI reports it.

**Frozen initial workload:** 100,000 owner-scoped mixed-extension FileExplorer Nodes (25k each .jpg/.mp4/.livp/.txt; names only, not actual codec or Live pairing). Run actual authenticated Gin `GET /api/v1/nodes/:id/children?offset=N&limit=200&sort=name&order=asc` with six distinct 200-item ranges. In native PostgreSQL 17, intentionally hold a real `xd_nodes` ACCESS EXCLUSIVE lock and verify **6 real waiting SQL queries + 6 active HTTP handlers** before aborting all clients. At 160ms record `pg_stat_activity` lock waiters, Handler count, `Request.Context().Done` observations, HTTP stale response bytes and context propagation latency. Release the diagnostic lock; verify an independent new request succeeds with exact 100k authoritative total and 200 items. Three new-schema measurements with original source, no race flags.

**Predeclared acceptance if gap confirmed:** after adding request-scoped GORM context to *only* the FileExplorer paginated children query, six client-aborted requests cause **0 PostgreSQL lock waiters, 0 active handlers, 0 stale client bytes, 6/6 context-done callbacks within 160ms**; a new healthy pagination request remains correct. BEFORE must show all six SQL waits retained at +160ms in a same-runner three-pair A/B. No cancellation of durable upload, download, sync or delete Task Center jobs from viewport/navigation changes; do not cancel shared persistent poster worker when one HTTP waiter leaves.

**Measured BEFORE / confirmed resource waste:** [GitHub run 37974982928](https://github.com/lazyxu/xdrive/actions/runs/37974982928), [dedicated job 113970884456](https://github.com/lazyxu/xdrive/actions/runs/37974982928/job/113970884456), exact source `f3b3237d4bddd2498c9b470a46960c2583dc309f`. All three 100k/6-request native PostgreSQL17 trials started six real SQL waits, received all six request contexts in **0.142/0.121/0.107ms max**, and still retained **6 active Gin handlers and 6 PostgreSQL lock-waiting SQL** at +160ms; client stale response bytes were zero. Fresh uncancelled 200-item/100k-count page passed after diagnostic lock release. The dedicated benchmark succeeded; initial full CI rejected unformatted new test source, not the results. Full per-sample provenance: [raw BEFORE JSON](performance-evidence/file-explorer-go-context-cancel-100k/ci-run-37974982928.json).

**Minimal candidate:** attach `c.Request.Context()` via GORM `WithContext` to the common children query builder (count-once, count-free, grouped and cursor paths). Run three **alternating paired** BEFORE=exact parent production and AFTER=one-line candidate using the identical formatted test source on the same CI runner. No *percentage speedup* claim: this is an abort/resource-release gate measured in actual SQL waiter/handler counts and milliseconds. Keep the candidate only if 3/3 post-cancel samples meet every frozen goal; full CI and correct fresh query must also pass.

**Measured AFTER / source-exact paired verification:** [same-runner CI run 37975410352 / job 113972652556](https://github.com/lazyxu/xdrive/actions/runs/37975410352/job/113972652556), three alternating pairs (`before → after`, `after → before`, `before → after`). All 3 BEFORE arms retained **6 SQL lock waiters + 6 Gin Handlers** at +160ms, while all 3 AFTER arms retained **0 SQL waiters + 0 Handlers**. All arms got 6/6 Context notifications, 0 discarded-response bytes and a correct fresh paginated 100k/200-item request. BEFORE maximum context notification 0.120/0.251/0.126ms; AFTER 0.159/0.409/0.162ms. SQL retention at +160ms reduced **6/6 to 0/6 for each of three paired samples**; this is a resource-cancellation improvement, not a claim of faster successful query execution. [Complete paired raw JSON](performance-evidence/file-explorer-go-context-cancel-100k/ci-run-37975410352-paired.json). GitHub's initial paired full CI found unrelated CI parity drift because only GitHub had the new opt-in job; adding the identical branch-scoped GitLab job in this work commit is necessary before merge. **No claim of final CI green yet.**

**Measurement and gate:** `XD_FILEEXPLORER_GO_CONTEXT_CANCEL_PERF=1 XD_TEST_DATABASE_URL=... go test -run '^TestFileExplorerRequestContextCancellation100K$' -count=1 -timeout=8m -v ./internal/api`. The first PR runs a baseline-only scoped CI job with `XD_FILEEXPLORER_GO_CONTEXT_CANCEL_EXPECT_FIXED` absent. *No AFTER data is claimed until that baseline completes.* Test covers real Server/PG context and cancellation but excludes browser/Renderer→Main→Agent, remote-network latencies, actual 100k image/video/Live thumbnails and durable transfers.

## Scope

This performance track is intentionally limited to FileExplorer across shared UI, Web, Desktop, and the server APIs it consumes. It does not include Gallery, Source synchronization, or general server tuning.

## Performance work status

This table is the durable status index for the FileExplorer performance track. A performance PR is not considered fully documented until its status and evidence are reflected here or in the measured tables below.

| Work item | Status | Measurement state | Current evidence |
| --- | --- | --- | --- |
| Sparse paged directory SQL | **Merged** | Measured | Non-empty sparse reads: **2 -> 1 SQL round-trip**. |
| Sparse range count reuse at 100k | **Accepted / production validated (#750)** | Paired SQL A/B + production contract CI | #739 established the direction; #750 production validation preserved the same result: broad-offset **3885.236 -> 2136.375 ms (-45.01%)** and sequential **3480.204 -> 1695.987 ms (-51.27%)**. First range remains authoritative-counted; later ranges reuse that generation's count. |
| Search candidate-first / sparse range | **Merged** | Measured | 100k range/cursor workloads: **2.38x to 5.67x faster** depending on access pattern. |
| Directory sort at 100k | **Accepted / production validated (#759)** | #756 paired A/B + #759 production migration/benchmark CI | #759 reproduced the accepted exact expression-index result: first-counted **212.644 -> 210.804 ms (-0.87%)** and middle count-free **299.467 -> 127.996 ms (-57.26%)**. The index is installed idempotently through Server migration; persisted-key remains rejected. |
| Sparse VirtualCollection CPU at 100k | **Accepted structural baseline / no optimization (PR #708)** | Measured | Three CI CPU medians: **126.877 / 160.081 / 161.319 ms per sweep** (**50.751 / 64.032 / 64.528 us per viewport**); hosted-runner timing is diagnostic only, while structural counts are stable at **500 page loads / 800 peak / 600 final retained**. |
| Details/Grid windowing and logical-index interaction | **Merged** | Unmeasured wall-clock | Bounded mounted/retained work; no comparable end-to-end BEFORE/AFTER timing yet. |
| Thumbnail viewport scheduler + bounded cache | **Merged** | Unmeasured wall-clock | Shared viewport observer, max **6** concurrent thumbnail requests, bounded **96-entry** per-Explorer cache. |
| FileExplorer video poster cache | **Implemented / CI validated** | Structural; end-to-end cold codec timing pending | Video tiles share the bounded thumbnail scheduler. Warm reads hit the persistent 512px Server poster cache; cold Web/Desktop reads use the existing authenticated preview stream, capture one bounded frame, and revision-fenced backfill the Server cache without adding ffmpeg to the Server runtime. |
| 100k video-poster Server HTTP cache + native Chromium decode | **Measured baseline / no production optimization (#1074)** | 100k video metadata; 102 nodes × 3 cycles; 7 native Chromium H.264 samples | Batch median cold 404 **62.670 ms**, PUT 204 **102.922 ms**, warm GET **62.194 ms**; ≤6 concurrent, exact JPEG replies. Chromium steady cold **3.600 ms** vs first-process **329.200 ms** on a tiny test video. Separate layers, no production changes. |
| Desktop binary thumbnail transport | **Merged** | Unmeasured wall-clock | Agent raw bytes -> ArrayBuffer -> Blob URL; base64 thumbnail transport removed. |
| Desktop warm-thumbnail Agent cache | **Accepted / Merged** | Measured structural requests/bytes | Same 200 unique x 64 KiB x 3-pass workload: upstream requests **600 -> 200 (-66.7%)** and payload **39,321,600 -> 13,107,200 B (-66.7%, 25 MiB saved)**. Wall time remains diagnostic only. |
| Adaptive infinite-scroll prefetch | **Merged** | Unmeasured wall-clock | Prefetch threshold is viewport-adaptive and protected by in-flight request locks. |
| Indexed typed-path lookup | **Merged** | Unmeasured wall-clock | One exact child lookup per path segment instead of full child-list scans. |
| Indexed folder-upload conflict lookup | **Merged** | Unmeasured wall-clock | Existing sibling lookup is indexed instead of scanning the full parent directory. |
| Desktop folder-download paged scan | **Accepted / structural contract** | Structural / unmeasured wall-clock | Recursive tree scan: legacy **1 unbounded 1,201-node response -> 3 cursor pages, <=500 nodes/response**. #788 also bounded root lookup before the exact lookup follow-up below. No wall-clock speedup claimed. |
| Desktop folder-download exact root lookup | **Accepted / structural contract** | Structural / unmeasured wall-clock | 1,201-sibling target: paged root lookup **3 requests / 1,201 returned nodes -> 1 exact request / 1 returned node**; recursive scan remains paged. |
| Desktop folder-download progress aggregation | **Accepted / structural contract** | Structural / unmeasured wall-clock | For F manifest files, each group-progress publication no longer scans F child byte slots. Aggregate bytes are maintained by current-file deltas: **O(F) -> O(1) per progress publication**, and the two F-length `int64` progress arrays are removed. |
| Hierarchical Transfer history trim fast path | **Accepted / structural contract** | Structural / unmeasured wall-clock | One group + 1,000 completed child tasks below the 200-root history limit: `trimLocked` history-entry inspections during start/finish **1,003,001 -> 0**. Root-tree retention/eviction semantics are unchanged. |
| Folder-upload group progress aggregation | **Accepted / structural contract** | Structural / unmeasured wall-clock | For N folder-upload targets, every group-progress publication changes from scanning N child byte slots to an incremental byte total: **O(N) -> O(1)** per publication; `fileSize` probes during target setup **2N -> N** and the N-length `childDone` array is removed. |
| Web folder-upload child registration | **Accepted / structural contract** | Structural / unmeasured wall-clock | For N queued child tasks under one Web folder-upload group, upfront parent lookup/history trim/full-history persistence/listener publication **N -> 1** via the optional batch lifecycle; all child IDs still exist before group transfer begins. |
| Agent transfer child registration | **Accepted / structural contract** | Structural / unmeasured wall-clock | 1,000 queued folder children: Desktop folder-upload lifecycle setup **1,000 Agent IPC requests -> 1**; Agent Manager child-registration revision publications for both Desktop upload and folder download **1,000 -> 1**. Old Agents retain the single-child fallback. |
| Agent folder-download progress publication | **Accepted / structural contract** | Structural / unmeasured wall-clock | One throttled leaf-file progress callback updates child bytes/rate plus group aggregate under one Manager lock: revision publications **2 -> 1 per callback**; download bytes, 100 ms progress throttle, lifecycle states and Transfer Center fields are unchanged. |
| Web archive-download child registration | **Accepted / structural contract** | Structural / unmeasured wall-clock | For N prepared archive leaf files, Transfer Center child registration reuses the Web batch primitive: parent lookup/history trim/full-history persistence/listener publication **N -> 1**; archive prepare, progress polling and payload streaming are unchanged. |
| Web archive progress persistence batching | **Accepted / structural contract** | Structural / unmeasured wall-clock | For one progress snapshot over N prepared leaf files, TransferStore history trim/full-history persistence/listener publication changes from **up to N+1 -> 1** in steady progress; lifecycle states and 200 ms Server polling are unchanged. |
| Web direct-to-disk downloads | **Accepted / structural contract** | Structural / unmeasured wall-clock | File System Access path writes each response chunk directly to the selected file; application-retained payload chunks change from **O(download bytes) -> O(current chunk)**. Blob fallback remains for unsupported browsers. |
| Web single-download progress coalescing | **Accepted / structural contract** | Structural / unmeasured wall-clock | Fast 1 GiB stream at 64 KiB/read: TransferStore progress persistence/listener publications **16,384 -> 128** via 8 MiB byte coalescing; slow streams still publish at <=100 ms cadence and terminal complete/fail remains immediate. |
| File download metadata joins | **Accepted / structural contract** | Structural / unmeasured wall-clock | Current-file download metadata **2 SQL -> 1 exact JOIN**; historical-version download metadata **2 SQL -> 1 exact JOIN**. Store.Open, Range/ServeContent, ETag/SHA256 headers and payload streaming are unchanged. |
| Windows hydration range-buffer reuse | **Accepted / structural contract** | Structural / unmeasured wall-clock | Synthetic 1 GiB single-callback hydration at 4 MiB/range: large response buffers **256 -> 1**; HTTP range requests remain **256**. Original `DownloadRange` API remains compatible. |
| Linux FUSE read destination-buffer reuse | **Accepted / structural contract** | Structural / unmeasured wall-clock | 1 GiB sequential read at 128 KiB/FUSE callback: explicit payload buffers **8,192 -> 0**; reads now fill go-fuse's provided `dest` buffer directly. File backing, offsets, EOF and returned bytes are unchanged. |
| FileExplorer Trash sparse ranges | **Accepted / structural contract** | Structural / unmeasured wall-clock | 1,201 trash roots: initial response/materialization **1,201 items -> first 200 items + authoritative total**; later viewport ranges are <=200 items and omit repeated count work. Legacy unpaged Trash API remains compatible. |
| Windows change-journal baseline index | **Accepted / structural contract** | Structural / unmeasured wall-clock | 100k baseline + one 500-change page of missing deletes: node-path resolution **1,000 full baseline scans / ~100M entry checks -> 1 index build + 1,000 map lookups**; incremental file delete/rename no longer run full-map prefix scans. |
| Windows change-journal same-path upsert index fast path | **Accepted / structural contract** | Structural / unmeasured wall-clock | 100k-entry baseline, ordinary same-path upsert page: full `nodeID -> path` index builds **1 -> 0**; rename/move/new-path ambiguity and delete retain lazy full-index fallback. |
| Windows same-path file journal baseline-clone bypass | **Accepted / structural contract** | Structural / unmeasured wall-clock | 100k-entry baseline + one ordinary same-path existing-file upsert: full baseline copies **1 -> 0** and full hydrated-map copies **1 -> 0**; only the touched file state/hydration timestamp is snapshotted. Rename/delete/directory/conflict/policy cases retain the full-baseline path. |
| Windows exact file-delete journal baseline-clone bypass | **Accepted / structural contract** | Structural / unmeasured wall-clock | 100k-entry baseline + one ordinary soft-deleted file: Windows full baseline copies **1 -> 0**, full hydrated-map copies **1 -> 0**, and nodeID full-map index build **1 -> 0**. Deleted-path resolution is opt-in for Windows only; default Web change polling keeps the old query cost. Hard delete / empty path / directory / conflict / policy cases retain the full-baseline path. |
| Windows directory journal fast path | **Accepted / structural contract** | Structural / unmeasured wall-clock | Brand-new (revision-1) remote directory create and known-directory delete journal events no longer trigger `Client.Walk()`: **full-tree Walk fallback -> 0 full-walk requests**. Directory move/rename, restored/moved-in unknown directories, and an existing baseline directory missing locally retain full reconciliation. |
| Windows local moved-placeholder baseline index | **Accepted / structural contract** | Structural / unmeasured wall-clock | 100k baseline + 500 moved-placeholder node lookups from the existing baseline: node-path resolution **500 independent linear baseline lookups -> 1 lazy index-build pass + 500 map lookups**. Batches with no moved placeholder build no index; post-index additions retain one-scan fallback + cache. |
| Windows conflict source refresh | **Accepted / structural contract** | Structural / unmeasured wall-clock | Both live local-sync and full-reconcile overwrite-conflict recovery now restore the server winner via **1 exact `GET /nodes/:id` / 1 returned node** instead of `Client.Walk()` (**root + every directory page + whole-tree path map**). Conflict-copy upload and winner placeholder semantics are unchanged. |
| Windows full-reconcile remote-deletion pruning | **Accepted / structural contract** | Structural / unmeasured wall-clock | 1,200 flat baseline files absent remotely: remote-deletion cleanup **1,200 baseline-wide `deletePrefix` scans / up to 721,800 key inspections -> 1 baseline missing-set scan + 1,200 exact map deletes**. Missing directory subtrees collapse to one physical `RemoveAll` root. |
| Windows local-delete baseline pruning | **Accepted / structural contract** | Structural / unmeasured wall-clock | 1,200 flat local deletions: successful-delete baseline pruning **1,200 baseline-wide prefix scans / up to 721,800 key inspections -> 1 final baseline scan**; processed/deleted subtree coverage uses ancestor-set lookup instead of a growing linear prefix slice. Server DELETE cardinality/order are unchanged. |
| Windows local-change existence probe reuse | **Accepted / structural contract** | Structural / unmeasured wall-clock | 1,200 independent local-change paths: filesystem existence probes in `reconcileLocalChanges` **2,400 `Lstat` calls -> 1,200** by recording missing deletion candidates during the first pass; Server DELETE cardinality/order and 404/409 handling are unchanged. |
| Windows local file-rename baseline fast path | **Accepted / structural contract** | Structural / unmeasured wall-clock | 1,200 independent file renames in a 100k-entry baseline: prefix-wide baseline scans **2,400 -> 0**; directory rename and directory-target fallback retain subtree semantics. |
| Windows full-reconcile local-file delete baseline fast path | **Accepted / structural contract** | Structural / unmeasured wall-clock | 1,200 locally missing flat files with unchanged remote revisions: successful-delete baseline prefix scans **1,200 -> 0**; directory/type-mismatch cleanup retains subtree semantics. |
| Windows empty always-local policy fast path | **Accepted / structural contract** | Structural / unmeasured wall-clock | Default policy with a 100,000-entry baseline: `applyAlwaysLocal` baseline inspections **100,000 -> 0** when no normalized `AlwaysLocalPaths` exist; configured always-local pin/hydrate behavior is unchanged. |
| Web/Desktop 1 GiB transfer throughput + RSS | **Measured / Web optimization approved** | Measured wall-clock + memory | Desktop/Agent stays bounded (upload **2.373 s / +19.3 MiB RSS**, download **6.175 s / +3.2 MiB RSS**, medians). Web is red: upload **7.914 s / +471.8 MiB JS heap / +927.1 MiB renderer WS**; download **3.814 s / +313.8 MiB heap / +369.1 MiB WS**. A no-storage download sink still exceeds memory budgets, so a Web streaming/allocation follow-up is approved. |
| Resumable upload chunk-buffer reuse | **Accepted / structural contract** | Structural / unmeasured wall-clock | 1 GiB path upload at 8 MiB/chunk: explicit large payload buffers **256 -> 2** across pre-hash + upload verification; stream upload **128 -> 1**. Integrity double-read/double-hash semantics unchanged. |
| Upload finalize reused-source handle reuse | **Accepted / structural contract** | Structural / unmeasured wall-clock | 128-chunk overwrite with 1 changed chunk and 127 reused chunks from one prior CAS object: reused source-object opens **127 -> 1**; the changed staging-object open remains **1**. |
| Upload conflict preflight batching | **Accepted / structural contract** | Structural / unmeasured wall-clock | 120 unique upload targets: pre-transfer conflict discovery **120 sequential requests / ~240 handler DB queries -> 1 request / 1 SQL statement**; requests are capped at 200 targets and ordered single-preflight fallback is retained. |
| Upload-start expired-session cleanup | **Accepted / structural contract** | Structural / unmeasured wall-clock | One interactive upload-init request no longer drains up to **16 x 128 = 2,048 expired sessions** plus their part/object deletes. Expired resume rows are ignored by `expires_at > now`; startup/hourly Janitor retains full cleanup. |
| Instant-upload ownership existence probe | **Accepted / structural contract** | Structural / unmeasured wall-clock | 120 same-key current-file refs or 120 same-key historical-version refs: ownership changes from aggregate `COUNT(*)` over all matches to one indexed `EXISTS` union that needs only a boolean result. The outer fast check and in-transaction ownership recheck both remain. |
| Upload CAS metadata stat | **Accepted / structural contract** | Structural / unmeasured wall-clock | Local/ObjectStatProvider CAS health checks in finalize and instant-upload retain use metadata `Stat` without opening payload handles: healthy-object validation **1 Open + 1 fstat + 1 Close -> 1 metadata Stat** per check. Generic Store fallback remains unchanged. |
| Upload finalize existing-CAS write elision | **Accepted / structural contract** | Structural / unmeasured wall-clock | A completed upload whose declared SHA256 already has a ready same-size CAS object: finalize full-file assembled Store writes **1 -> 0**; every uploaded byte is still read and SHA256/MD5-verified. |
| Archive prepare subtree loading | **Accepted / structural contract** | Structural / unmeasured wall-clock | One selected folder with 120 direct child folders and one file in each: recursive child enumeration **121 per-directory child-list queries (+ GORM file preload queries) -> 1 recursive CTE with file metadata join** for that root. ZIP payload streaming is unchanged. |
| Archive prepare local metadata stat | **Accepted / structural contract** | Structural / unmeasured wall-clock | 1,000-file archive on `storage.Local`: prepare payload-handle opens/closes **1,000/1,000 -> 0/0**; metadata validation remains **1,000 Stat operations**, and ZIP streaming still opens each payload once. |
| Archive download progress coalescing | **Accepted / structural contract** | Structural / unmeasured wall-clock | Fast 8 MiB transfer at 64 KiB/read: progress-state callbacks **128 -> 1** inside one <100ms interval; production rate is capped to about **10 Hz per active file** plus terminal flush. ZIP/object reads are unchanged. |
| Archive selected-root ancestor coverage | **Accepted / structural contract** | Structural / unmeasured wall-clock | 120 selected files under independent 8-level branches: ancestor filtering **961 parent SELECTs -> 1 owner-scoped recursive CTE**. Nested-root suppression, missing-parent failure and cycle rejection remain unchanged. |
| FileOperation ancestor coverage | **Accepted / structural contract** | Structural / unmeasured wall-clock | 120 selected sibling files at depth 8: ancestor/top-level coverage **1,200 SELECTs -> 1 recursive CTE** per check; Copy/Move/Delete semantics unchanged. |
| FileOperation total-byte aggregation | **Accepted / structural contract** | Structural / unmeasured wall-clock | 120 selected top-level directories: recursive size aggregation **120 CTEs -> 1 selection CTE**; per-item owner/revision validation remains unchanged. |
| FileOperation enqueue root validation | **Accepted / structural contract** | Structural / unmeasured wall-clock | 120 selected file roots: owner/revision/root validation with file metadata **240 SELECTs -> 2 SELECTs** (one ordered locked node batch + one File preload); validation still reports the first failing requested item. |
| FileOperation execution root validation | **Accepted / structural contract** | Structural / unmeasured wall-clock | 120 selected roots: Copy/Delete locked root validation with File metadata **240 SELECTs -> 2 SELECTs**; Move root validation **120 SELECTs -> 1 SELECT** with no File preload. Recursive mutation/conflict/progress semantics are unchanged. |
| FileOperation delete subtree summary | **Accepted / structural contract** | Structural / unmeasured wall-clock | Per delete root, execution reuses one recursive subtree query for node IDs + bytes: **2 recursive CTE statements -> 1**; trash/protection/revision semantics unchanged. |
| FileOperation delete multi-root subtree aggregation | **Accepted / structural contract** | Structural / unmeasured wall-clock | 120 selected sibling directory roots, one file each: execution-time subtree summary recursion **120 CTEs -> 1 grouped CTE**; per-root managed-source/share/Trash/revision/undo semantics remain unchanged. |
| FileOperation delete managed-target preload | **Accepted / structural contract** | Structural / unmeasured wall-clock | 120 delete roots: Yike managed-target protection DB work **240 statements -> 2 statements** (one optional-schema probe + one owner target load); first protected root is still rejected in original request order. |
| FileOperation progress write coalescing | **Accepted / structural contract** | Structural / unmeasured wall-clock | 120 top-level Move/Delete roots: operation current-item + completion progress writes **240 UPDATEs -> 121 UPDATEs**. Every root still performs one `status=running` cancel checkpoint; the previous root's item/byte delta is folded into the next checkpoint and the final delta is flushed. Copy file-byte deltas use the same coalescer. |
| Permanent-delete CAS reference release | **Accepted / structural contract** | Structural / unmeasured wall-clock | 120 unique CAS references: reference-release DB statements **360 -> 3** (one ordered advisory-lock statement, one row-lock load, one batch update). Physical object deletes remain per-object and unchanged. |
| Legacy delete reference batching | **Accepted / structural contract** | Structural / unmeasured wall-clock | 120 legacy non-CAS keys: post-commit File/FileVersion reference checks **120 SQL statements -> 1 UNION query**; referenced keys remain protected and physical Store.Delete remains one call per unreferenced key. |
| CAS physical-delete reused-source guard | **Accepted / structural contract** | Structural / unmeasured wall-clock | Reused-source protection changes from `COUNT(*)` over all matches with no source-key index to an exact-key partial-indexed `EXISTS`; a blob referenced by 128 reused chunks no longer requires consuming all 128 matches just to answer a boolean guard. |
| FileOperation subtree predicates | **Accepted / structural contract** | Structural / unmeasured wall-clock | 1,201-node source subtree: target-descendant validation **1,201 DB rows -> 1 scalar bool** across the DB/Go boundary; managed-target protection removes the intermediate **1,201-ID Go slice + 1,201-value `IN` list** in favor of one database CTE `EXISTS`. |
| FileOperation target-descendant batching | **Accepted / structural contract** | Structural / unmeasured wall-clock | 120 selected source directories with one shared target outside the selection: repeated target-ancestor validation **120 recursive CTEs -> 1 recursive CTE**; request-order failure reporting remains in the existing Copy/Move loops. |
| FileOperation Move root-byte aggregation | **Accepted / structural contract** | Structural / unmeasured wall-clock | 120 selected sibling directories, one file each: execution-time root-byte recursion **120 CTEs -> 1 grouped CTE**; Move root loads no longer preload `xd_files`. Processed byte totals and conflict/replace semantics stay unchanged. |
| FileOperation Move replace/merge File preload elimination | **Accepted / structural contract** | Structural / unmeasured wall-clock | Merge root + 120 matching child directories, one source file per child: unused `xd_files` preload SELECTs **242 -> 0** (121 conflict-target preloads + 121 source-child preloads). Node traversal/mutation order is unchanged. |
| FileOperation Copy source-subtree loading | **Accepted / structural contract** | Structural / unmeasured wall-clock | One copied root with 120 child directories and one file each: source-tree reads **242 SELECTs -> 1 recursive CTE with file metadata join**. Destination creates, content-reference retain, hooks/progress and undo remain per node. |
| FileOperation Copy replace/merge source snapshot | **Accepted / structural contract** | Structural / unmeasured wall-clock | Replace/merge root + 120 matching target directories, one source file per child: recursive source enumeration **242 SELECTs -> 1 source-subtree CTE** while target conflict/protection checks remain dynamic per destination level. |
| Navigation-tree pagination | **Merged** | Unmeasured wall-clock | One 200-item folder page per expansion; additional siblings are explicit load-more. |
| Search server sort + sort-bound cursor | **Merged** | Unmeasured wall-clock | name/updated/size/type are globally server-paged; renderer no longer re-sorts only the loaded subset. |
| 100k image/video media-directory traces | **Server/object-store matrix measured; renderer trace measured** | Measured structural + diagnostic timing | Real Server + PostgreSQL + `storage.Local`: cold **102 original opens / 102 derivative writes**, warm **0 / 0** with **102 derivative reads**, video icon fallback **0 thumbnail/object-store work**. Synthetic Web/Desktop renderer remains bounded at <=6 thumbnail in-flight, 110 max mounted, and 1200 peak retained. |
| Viewport HTTP abort propagation (Gallery/FileExplorer/100k ranges) | **Candidate accepted by HTTP A/B / full regression pending (#1083)** | Same-host 500 ms HTTP, 3× paired samples per path, 160 ms observation | BEFORE **6/6 stale requests alive, 0/6 aborted**; AFTER **0/6 alive, 6/6 aborted, 0 stale bytes** in all nine samples. Abort latency 1.36–3.86 ms, no change to durable tasks. Five legacy Desktop test assertions pending correction before merge. |
| Viewport cancellation of stale requests (Gallery/FileExplorer/ranges, Web/Desktop) | **Measured baseline / structural breach (#1077)** | Same-host Node HTTP response abort trace, n=3 per surface | **All 6 stale requests still active at +160 ms, 0/6 aborted, 6/6 full responses delivered** for Gallery thumbnails, FileExplorer thumbnails and virtual ranges; current and parent identical. Product optimization justified; current PR measurement-only. |
| 100k Grid/Details image-video-LIVP renderer matrix | **Measured baseline / no production optimization (#1072)** | 24 actual Web/Desktop Chromium renders; synthetic thumbnail payloads | All structural budgets passed: Grid **110** DOM max, Details **37**, sparse metadata **1200**, thumbnail in-flight **≤6**, first viewport **189–250 ms** diagnostic. Live glyph **16–50** once a thumbnail source is available; decode completion is not asserted. Real codec/HTTP/backfill remain pending. |
| Current 100k local baseline (2026-10-09) | **Measured baseline / no production change** | Fresh controller, real image HTTP/store, PGlite metadata and 24 synthetic renderer samples | Bounded work: 800 controller peak retained, 110 renderer max mounted, 1200 renderer retained, <=6 thumbnail in-flight. Real video cold decode/backfill and LIVP HTTP coverage remain the next measurement-only gap. |
| Current 4 GiB Agent transfer baseline | **Measured baseline / memory budget passed** | Three fresh Linux processes per direction; exact payload/chunk validation | Upload **11.466 s / +22.48 MiB RSS**, download **2.638 s / +2.469 MiB RSS**; local zero-filled overlayfs/loopback only. No Agent production change. |
| Current native image/store + 4 GiB Agent qualification | **Measured baseline / budgets passed** | PR #1067 initial native CI, actual merge checkout `86cf14e1` | Image cold/warm batches **737.958 / 36.167 ms**, expected store bounds; Agent upload/download **10.987 / 11.414 s**, RSS deltas **23.523 / 3.414 MiB**. No production change or cross-environment speedup. |

## Request-scoped viewport cancellation benchmark (2026-10-09)

Status: **Benchmarking / baseline only** on `perf/viewport-cancel-request-baseline`, current production unchanged. This is a separate performance/cancellation track, not race-condition investigation.

- Named workload: six *already-started* pending requests for Gallery thumbnail retention, FileExplorer thumbnail scheduling and CloudFiles virtual-range loader. The last path models the real 100k virtual viewport, but the HTTP fixture itself is only six 8 KiB requests, **not** 100k network requests.
- Measurement uses the production scheduler/controller code extracted and TypeScript-transpiled in the Node CI environment. All operations use real Node `fetch` to a local slow HTTP endpoint (fixed 500 ms response delay), then simulate scroll eviction and a component/window unmount. Record `httpStillActive`, server-observed early disconnect count, client logical completion, admitted `AbortSignal` count, remaining scheduler slots, and server response bytes at **160 ms** after cancelling. Three samples each; original/current source is tested on the **same CI host** by reading exact `HEAD^` and work tree.
- This benchmark measures TCP/HTTP client abandonment at a local Node server. It **does not** directly exercise real Go Gin handlers, Agent IPC, media derivation scheduler cancellation, external-network throughput, or Web/Desktop integration; those require separate tests before declaring cancellation end-to-end.
- Predeclared next-stage budget if the baseline reveals stale work: no more than 6 started in-flight thumbnail/range requests, **6/6** abandoned requests must trigger actual transport abort before the 160-ms observation for each session, all stale requests must be off the server by the observation point, and no full 8 KiB stale HTTP payload should be transmitted. Cancelling the UI promise without aborting HTTP is **not** success. Use same three samples and same 500-ms simulated service cost for BEFORE/AFTER; do not accept throughput or correctness regression.
- Benchmark command: `cd desktop && node scripts/thumbnail-request-cancel-performance.cjs paired`; scoped job `file-explorer-viewport-cancel-performance` on GitHub/GitLab, raw JSON under `desktop/perf-results/`. The base source revision, per-sample timings and exact structural counts must be committed here before any production change is tested.
- **BEFORE/current verified:** [CI run 37877779088](https://github.com/lazyxu/xdrive/actions/runs/37877779088), job 113650209853; exactly 18 samples (3 scenarios × 3 samples × parent/current). Each of the **nine current production-source samples** started six real HTTP requests; **at +160 ms, all six remained active, zero received AbortSignals, zero HTTP responses were cancelled, and all six eventually transferred the full 8 KiB each (48 KiB unnecessary work per sample).** Parent sampled identically, and the paired baseline has no production delta.
- Gallery resolves its six logical promises promptly while the server retains six active requests; FileExplorer retains six active queue slots; the CloudFiles virtual-range callback accepts a signal from the collection controller but fails to pass it through the port, so its six underlying HTTP requests continue.
- **Decision:** confirmed structural performance breach; a later minimal production optimization is warranted. **AFTER:** not applicable in this benchmark-only PR; no product code is changed. The next optimization must pass the originally frozen **6/6 abort, zero remaining requests, zero stale payload by 160 ms** target, with equivalent cancellation and correctness evidence on Web and Desktop.
- Raw records including every parent/current row, event mode, logical-settlement count and transport counters: [ci-run-37877779088.json](performance-evidence/viewport-cancel/ci-run-37877779088.json). These Node-local HTTP counters are **not** proof of actual Gin or Agent context cancellation.
### Request-scoped transport abort optimization — follow-up

Status: **Measured improvement / full regression pending**, branch `perf/viewport-request-cancel-transport`. Initial 18-sample CI A/B [run 37880698868](https://github.com/lazyxu/xdrive/actions/runs/37880698868), job 113659481881 passed cancellation budgets. Five ordinary Desktop tests needed assertion/mocking updates and require a fresh full CI before merging; this is not yet a production acceptance.

- BEFORE: PR #1077, [run 37877779088](https://github.com/lazyxu/xdrive/actions/runs/37877779088), 3 samples per path; **6/6 server requests remain active at +160 ms, 0/6 transport aborts, 6/6 late responses** for Gallery thumbnails, FileExplorer thumbnails and 100k virtual-range page requests.
- Candidate contract: one abortable controller per request-lifetime, signal passed from shared viewport scheduler or VirtualCollection → Web REST/Native Desktop IPC → Agent HTTP → Go request `Context()`. Desktop request IDs are scoped to their sending window; Main supports cancel-before-admission and window-destroy cleanup. Agent/Server interface and durable task definitions are unchanged.
- Predeclared acceptance: same 500 ms delay, 8 KiB payload, six already-started requests, +160 ms observation, **three paired iterations per path with alternating BEFORE/AFTER order**. Each current sample must have 6/6 early server-observed disconnects, 0 remaining old requests and 0 stale payload bytes; the 6 logical transfers must release their slots. Also require Web/Desktop build, API/Agent regression suites and matching named CI jobs. Do not use a synthetic timing difference across machines to claim faster product UI.
- The primary benchmark executes real HTTP in Node with production TypeScript scheduler/controller code. Separate compiled Desktop Main/Agent IPC tests cover request-ID cancellation and Agent context propagation. **Neither result alone proves a complete browser-to-real Server media-derivative cancellation**. Specifically, the background derivative scheduler currently owns a detached work lifetime; cancelling one HTTP waiter must not indiscriminately kill a shared/durable derivative. That needs its own measured consumer-aware contract before change.
- A window, tab or view switch here refers to the view's request ownership ending (unmount/reload/navigation); a still-mounted hidden OS/background tab is not yet separately qualified. Persistent upload/download/sync/delete Task Center operations stay independent.
- AFTER initial candidate (**source `595e147a2f55a8396deeed17df30ebc824187586`**, same CI runner as BEFORE): each of the **nine paired current samples** observed HTTP **6/6 cancelled, 0/6 still active at +160 ms, 0/6 full responses, zero stale payload bytes**. Every paired parent sample had 0/6 cancelled and all 6 requests alive at +160 ms.
- Machine-readable exact sample rows and provenance: [ci-run-37880698868.json](performance-evidence/viewport-cancel-transport/ci-run-37880698868.json). Each old completed 6×8 KiB of unwanted response; candidate saves **48 KiB per six-request discarded viewport** in this synthetic fixture. It is not a measured global upload/download throughput improvement.

| Request owner | BEFORE aborted at +160 ms | AFTER aborted at +160 ms | AFTER maximum measured abort latency (ms) | AFTER finished stale HTTP bytes |
| --- | ---: | ---: | ---: | ---: |
| gallery | 0/6 (three samples) | **6/6 (three samples)** | 3.863 | **0** |
| file-explorer | 0/6 (three samples) | **6/6 (three samples)** | 2.052 | **0** |
| virtual-range | 0/6 (three samples) | **6/6 (three samples)** | 2.271 | **0** |

- Desktop actual Agent-HTTP regression successfully demonstrated a terminated thumbnail GET, terminated 100k-range GET, sender-ID isolation, cancel-before-admission and WebContents teardown. Normal Go/Server API tests passed in the initial run. The five Desktop failures were old structural string assertions and a callback unit-test missing its newly injected helper; corrected tests require rerun and must not be ignored.
- **Decision:** provisional candidate retained because the stable structural objective improved in 9/9 samples. **Acceptance conditional on corrected full CI and unchanged business semantics**, and on the 9/9 repeated HTTP gate remaining green. Actual background derivative worker cancellation remains intentionally outside this scope.
## Current performance contract

- Directory listing uses cursor pagination with 200 items per page.
- Non-empty paged directory reads fetch node and file metadata in one joined DB query; empty/terminal pages perform a fallback parent validation only to preserve 200-vs-404 semantics.
- The first sparse range of each FileExplorer directory generation fetches rows and authoritative `total_count` in **1 SQL round-trip** via `COUNT(*) OVER()`. After that count is primed, subsequent viewport ranges send `include_count=false` and execute the same ordered row query without the window count; count-free empty windows still validate the parent to preserve 200-vs-404 semantics.
- Details view windows large directories once 240 items are loaded.
- Details scroll-window state is updated at most once per animation frame and only when the effective row boundary changes.
- Grid view windows large directories once 400 items are loaded, with deterministic row geometry and three overscan rows.
- Grid keyboard navigation and marquee selection use computed virtual geometry instead of scanning every mounted item.
- Selection, active-item, Shift-anchor, keyboard-current-item, and Quick Look position lookup use memoized ID indexes instead of repeated whole-directory scans.
- Server-sorted directory arrays are reused without cloning, and the visible-item ID index, type-select names, Quick Look file list, and Quick Look index are built in one traversal.
- Selected-size aggregation scales with the selected set rather than the complete loaded directory.
- Paged node projection builds the node index and Explorer item view models in one pass, while breadcrumb path prefixes are computed once per directory instead of once per item.
- Grid thumbnails are viewport-proximate through one shared IntersectionObserver, share a global concurrency budget of 6 requests, cancel queued work when tiles unmount, and reuse a bounded 96-entry per-Explorer thumbnail cache.
- Desktop thumbnail transport stays binary from xdrive-agent to Electron: Agent IPC returns raw bytes, Desktop carries them as ArrayBuffer, and renderer surfaces create Blob URLs instead of base64 JSON/data URLs.
- Directory and search pagination reject duplicate in-flight load-more requests synchronously.
- Infinite-scroll page prefetch starts at least 500 px before the end and expands to 1.5 viewport heights on larger windows, while the existing in-flight locks prevent duplicate page requests.
- Normal directory page appends check only the incoming page against a retained ID set and append directly; the whole-directory Map merge remains only as a duplicate-ID correctness fallback.
- Search page appends use the same retained-ID fast path per workspace/query, with full Map reconciliation only when a duplicate ID is actually observed.
- Directory responses from superseded navigation requests are ignored rather than replacing the newer location.
- Address-bar path traversal resolves each segment with one exact-name paged child lookup (limit 1) instead of loading every child in each traversed directory.
- Folder-upload create conflicts reuse an existing sibling through a case-insensitive indexed name lookup (limit 1) instead of listing and scanning the entire parent directory.
- Desktop folder-tree download resolves the selected root through an owner-scoped exact node-id lookup and validates its expected parent/type/name; recursive directory enumeration uses cursor-paged children reads capped at **500 nodes per response** and must not use the legacy unpaginated children contract.
- Web authenticated file, version, and archive downloads open the File System Access sink before network work when supported, then await one writable chunk at a time while retaining Transfer Center byte progress; unsupported browsers keep the legacy Blob fallback.
- Current-file and historical-version download metadata are each resolved with one owner-scoped active-file JOIN. Current download no longer uses GORM `Preload("File")`, and version download no longer performs a separate owner-node lookup before loading the version row.
- Windows CfAPI hydration keeps the existing 4 MiB HTTP range granularity but fills one caller-owned buffer through `DownloadRangeInto` for the lifetime of each fetch callback, rather than allocating one response slice per range. The legacy `DownloadRange` API remains unchanged for compatibility.
- Windows remote change-journal pages build one `nodeID -> baseline path` index per page. File upsert/delete lookup is O(1) after that build; incremental file delete removes the exact baseline entry directly and file rename moves the exact entry directly. Brand-new revision-1 directory create and known-directory delete are also incremental; directory move/rename, restored or moved-in unknown directories, and an existing baseline directory missing locally retain the full-reconcile safety path.
- Resumable uploads reuse one bounded chunk buffer per pass instead of allocating a fresh 4-16 MiB payload slice for every chunk. Path uploads intentionally keep the pre-hash pass plus upload-time rehash so source mutation detection is unchanged; stream uploads reuse one chunk buffer from the first missing chunk onward.
- Upload finalize keeps a reused source object open across fixed-block overwrite parts with the same source storage key. Interleaved newly uploaded staging chunks do not force that source handle to reopen; staging parts keep their existing per-object open/close behavior.
- If an upload declares SHA256 and a matching ready CAS blob exists on an `ObjectStatProvider`, finalize still reads every uploaded part and recomputes SHA256/MD5 but hashes directly without writing a duplicate assembled temp object. Stores without metadata stat, missing/stale CAS metadata, or missing/wrong-size CAS objects retain the original assemble-and-promote path.
- Multi-file and folder uploads batch conflict preflight for unique destination names, with at most **200 targets per request**. Shared orchestration consumes results in original file order, excludes duplicate destination names from upfront batching, and falls back to the legacy per-file preflight when the batch transport is unavailable or fails.
- Archive prepare loads every descendant of a selected top-level directory with one owner-scoped recursive CTE per root, joining `xd_files` metadata in the same statement. Manifest DFS order, duplicate-root naming, stored-object validation, entry caps, and ZIP streaming remain unchanged.
- Archive prepare stored-object validation uses `storage.ObjectStatProvider` when available. Production `storage.Local` validates existence and size with metadata-only `os.Stat` instead of opening/closing each payload before download; backends without metadata stat retain the existing `Open -> Stat -> Close` fallback.
- FileOperation Copy/Move/Delete ancestor coverage is resolved by one owner-scoped recursive CTE per batch instead of walking every selected item's parent chain with one SQL query per level; missing selected nodes still fail before enqueue.
- FileOperation enqueue validates every selected root as before, then computes aggregate bytes for the already non-overlapping top-level selection with one owner-scoped recursive CTE instead of one recursive size query per selected directory.
- FileOperation enqueue locks selected roots in one deterministic ID-ordered query and batch-preloads their file metadata, then replays missing/root/revision validation in original request order. This replaces one node query plus one File preload per selected file without changing the first reported failing item.
- FileOperation delete execution resolves each active subtree once into both its node IDs and aggregate bytes, then reuses that summary for managed-source protection, share revocation, trash marking, and progress instead of recursively walking the same root twice.
- Multi-root FileOperation Delete resolves all already top-level delete roots through one grouped recursive subtree query, returning an independent ID list and byte total per root. The worker still applies managed-source protection, share revocation, Trash marking, revision validation, undo capture, and progress in original request order.
- FileOperation Delete loads the owner's Yike managed `target_node_id` values once per execution after a single optional-Sources schema probe, then checks each already-materialized subtree ID list in memory. The first protected root still fails with `managed_source_target` before that root is mutated.
- Permanent-delete CAS reference release groups unique content keys into batches of at most **200**. Each batch acquires content advisory locks in hash order with one statement, locks all matching `xd_content_blobs` rows with one `FOR UPDATE` query, then applies all validated refcount/state changes in one update statement. Two-phase `deleting` state and per-object physical cleanup are unchanged.
- CAS physical deletion checks temporary reused upload ranges with `SELECT EXISTS` against the partial index `idx_xd_upload_parts_reused_source_storage(source_storage_key) WHERE reused = TRUE`. The guard remains inside the existing per-blob transaction before `Store.Delete`, so active resumable overwrite ranges still keep the old content alive.
- FileOperation Copy/Move target-descendant validation walks the target's active ancestor chain in PostgreSQL and returns one scalar `EXISTS` result instead of materializing the source subtree IDs in Go. Managed-source subtree protection likewise stays inside PostgreSQL as a recursive CTE joined directly to `xd_sources`, while Delete keeps its existing ID materialization because those IDs are required for share revocation and Trash updates.
- FileOperation Move obtains logical byte totals for all selected roots with one lazily executed grouped recursive CTE, then reuses the per-root totals for normal, skipped, and replace/merge progress. Move root nodes are loaded without the unused `File` preload; Delete keeps its subtree summary contract.
- Ordinary FileOperation Copy preloads the active source descendants and current file metadata with one recursive CTE per copied root, then reuses that in-memory parent/child map during recursive creation. Destination writes, content-reference retain, hooks/progress, undo capture, and replace/merge conflict traversal remain unchanged.
- Search queries without `/` seed matching path components, expand descendants of matching directories, and reconstruct paths/breadcrumbs only for candidates; slash-containing queries retain full-tree path matching for exact cross-component substring semantics.
- Search result sorting is server-paged for name/updated/size/type; cursors bind query/type/sort/order, and changing sort reloads the active search from page one instead of re-sorting only the loaded subset.
- Grid marquee selection coalesces pointer-move work to one animation-frame update.
- Navigation-tree expansion loads one 200-item folder page at a time; further sibling folders require explicit load-more, while the active path child stays injected even when it lies outside the loaded page.

### FileExplorer Trash sparse-range contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- FileExplorer recycle bin with **1,201 trash-root nodes**;
- Web/Desktop both use the shared Trash controller and shared VirtualCollection;
- structural evidence is bounded response/item projection count; no wall-clock speedup is claimed.

BEFORE:

- opening the recycle bin calls legacy `GET /api/v1/trash`;
- Server materializes all **1,201** trash roots and their file metadata;
- Web/Desktop retain/project the whole result before FileExplorer can render;
- changing sort is local-only over that full array.

AFTER / current:

- FileExplorer uses `range=true&offset=&limit=&sort=&order=` with page size **200**;
- first range returns at most **200 items + total_count**;
- later viewport ranges return at most **200 items** and use `include_count=false` after the authoritative count is known;
- sorting is Server-global for name / deletion time / size / type, with directories kept ahead of files;
- default name ordering is supported by the partial `idx_xd_nodes_trash_name` index;
- legacy unpaged `listTrash()` remains unchanged for compatibility outside FileExplorer.

Decision: **Accepted.** This removes total-trash-size response/render amplification from the FileExplorer open path without changing restore or permanent-delete semantics.

Regression budget: FileExplorer Trash must never require an unpaged full-list request for initial display; ordinary viewport range payloads stay <= **200 items**.

Next action: continue the basic-path audit at ordinary download / sync reconciliation / delete mutation paths and only change another deterministic request, SQL, allocation, or I/O multiplier. Windows overwrite-conflict winner refresh is now an exact node lookup rather than a whole-tree walk.

### Windows full-reconcile remote-deletion pruning contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Windows full reconciliation after the remote snapshot is already loaded;
- baseline contains the root plus **1,200 flat files** that are all absent from the remote snapshot;
- evidence method: production control-flow cardinality plus deterministic helper tests; wall-clock timing is intentionally not quoted.

BEFORE:

- both Windows full-reconcile implementations iterated missing baseline entries and called `deletePrefix(baseline, rel)` for each one;
- `deletePrefix` scans the complete current baseline map to find descendants;
- because the flat workload has no descendant relationships, every one of the 1,200 files triggers another full-map prefix scan;
- the stable fixture therefore performs **1,200 baseline-wide prefix scans**, with up to **721,800 baseline-key inspections** across those scans.

AFTER / current:

- one pass collects every baseline path absent from the remote snapshot into a missing set;
- ancestor membership is resolved against that set so missing directory subtrees collapse to their top-level removal roots;
- physical filesystem cleanup runs once per top-level missing root;
- baseline cleanup then deletes each missing key directly, with no repeated whole-baseline prefix scan;
- the flat 1,200-file workload changes remote-deletion baseline scanning from **1,200 whole-map scans -> 1 whole-map collection pass + 1,200 exact deletes**;
- root preservation, `os.RemoveAll` behavior, remote-path retention, full-walk semantics and change-journal fallback behavior are unchanged.

Decision: **Accepted.** The remote snapshot already identifies the complete surviving path set, so repeated prefix discovery adds no correctness value during full-reconcile cleanup.

Regression budget: full-reconcile remote-deletion cleanup must not call `deletePrefix` once per missing remote path. Missing nested subtrees must collapse to top-level physical removal roots, while baseline keys are removed exactly.

Regression commands:

- `go test ./internal/mount -run '^TestPruneRemoteDeletedBaseline' -count=1`.

Next action: continue ordinary sync/download/delete performance and only change another deterministic request, SQL, allocation, filesystem, lock, or object-store multiplier.

### Windows remote-directory journal fast-path contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Windows CfAPI remote change-journal polling with the journal already enabled;
- deterministic directory-create fixture: one known root plus one new direct child directory;
- deterministic directory-delete fixture: one known directory root with a nested directory and file beneath it;
- the test HTTP server counts and rejects any `/nodes/root` or `/children` request, so a hidden fallback to `Client.Walk()` fails deterministically;
- no wall-clock speedup is claimed.

BEFORE:

- any directory upsert whose node was not already present at the same baseline path returned `needFull=true`;
- any delete of a baseline directory also returned `needFull=true`;
- `reconcileRemote` therefore followed one ordinary journal page with `Client.Walk()`, loading the owner root and every paged remote directory needed for a complete namespace snapshot;
- the extra work scaled with the whole remote namespace even when the mutation was only one plain directory create or delete.

AFTER / current:

- a brand-new revision-1 directory whose parent is already known is created/adopted locally with `MkdirAll`, statted once, and inserted into the baseline/index directly;
- a remote directory delete resolves the old path from the page-local node-ID index, executes one `RemoveAll`, and prunes that baseline prefix with one local baseline scan; descendant delete events in the same page are suppressed even when they appear before the directory-root event;
- both fixtures execute **0 full-walk requests** after the journal page;
- directory move/rename still returns `needFull=true` because descendants may not receive their own path mutations;
- a directory upsert absent from the baseline with `revision > 1` also keeps full reconciliation because it may be a restore or a subtree moved in from an excluded path;
- an existing baseline directory that is missing locally still falls back to full reconciliation, preserving the existing local-delete/remote-change conflict semantics;
- excluded-path behavior, file dirty checks, journal cursor handling, cache policy, baseline persistence, and full-reconcile fallback semantics are unchanged.

Decision: **Accepted.** Brand-new directory create and known-directory delete have enough information in the journal payload plus baseline index to update the local tree without a namespace-wide remote snapshot.

Regression budget: brand-new revision-1 directory create and known-directory delete journal pages must perform **0 `Client.Walk()` root/children requests**. Directory move/rename and unknown `revision>1` directory upserts must keep the existing full-reconcile fallback.

Regression commands:

- `go test ./internal/mount -run '^TestWindowsRemoteJournalDirectory(Create|Delete)AvoidsFullWalk$' -count=1`;
- existing `TestWindowsRemoteJournalDirectoryMoveRequestsFullReconcile` remains the move/rename safety gate;
- `TestWindowsRemoteJournalUnknownDirectoryUpsertKeepsFullReconcile` locks the restore/moved-in fallback.

Next action: continue basic FileExplorer sync/delete/download performance audits and only change another deterministic request, SQL, allocation, filesystem, lock, or object-store multiplier.

### Resumable upload chunk-buffer allocation contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- shared Go resumable-upload client used by FileExplorer/Desktop sync paths;
- stable structural workload: **1 GiB file**, **8 MiB chunks**, exactly **128 chunks**;
- evidence method: source-level explicit payload-buffer allocation count plus `go test ./internal/client`; wall-clock benchmark intentionally not quoted;
- samples: n/a for the structural count.

BEFORE:

- file-path pre-hash pass: **128** explicit large chunk-buffer instances;
- file-path upload verification pass with all chunks missing: **128** more;
- total for the 1 GiB path workload: **256** explicit 8 MiB payload-buffer instances;
- stream upload with 128 missing chunks: **128** explicit large payload-buffer instances.

AFTER / current:

- file-path pre-hash pass: **1** reusable chunk buffer;
- file-path upload verification pass: **1** lazily allocated reusable chunk buffer;
- total for the same 1 GiB path workload: **2** explicit 8 MiB payload-buffer instances;
- stream upload: **1** reusable chunk buffer from the first missing chunk onward;
- chunk-hash manifest strings remain **O(chunk count)** and are intentionally unchanged.

Decision: **Accepted.** The change removes chunk-count-scaled large payload allocations without weakening resumable-state validation, retry behavior, source-change detection, or the intentional second hash during upload.

Regression budget: payload-buffer instances must remain **O(1) per upload pass**, each bounded to one negotiated chunk (Server maximum **16 MiB**); no full-file buffering.

Next action: Server upload-finalize staging/object-store I/O is audited by the dedicated reused-source contract below; keep the client buffer contract unchanged.

### Upload-start expired-session cleanup contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- interactive `POST /api/v1/uploads` used by FileExplorer/Web/Desktop upload start;
- cleanup implementation is bounded at **128 sessions x 16 batches = 2,048 expired sessions** per invocation;
- every expired session may load its UploadParts, delete part/session rows, and delete each non-reused staging object;
- evidence is the production call graph plus the PostgreSQL upload integration; no wall-clock speedup is claimed.

BEFORE:

- every new upload-init synchronously called `cleanupExpiredUploads(ctx, ownerID)` before resume lookup;
- one unrelated backlog could therefore add cleanup DB/object-store work for up to **2,048 expired sessions** to a single interactive request.

AFTER / current:

- upload-init performs **0 expired-session cleanup passes**;
- resume lookup explicitly requires `expires_at > now()`, preserving the old effective behavior where expired sessions were removed before lookup;
- quota reservation and physical-capacity reservation already count only active, unexpired sessions;
- `StartUploadJanitor` runs a storage-Janitor pass immediately on startup and hourly thereafter; its staging-cleanup phase still performs the full expired-session drain;
- explicit abort/finalize expiry handling remains unchanged.

Decision: **Accepted.** Expired-session reclamation is maintenance work and is not required for upload-init quota/capacity correctness.

Regression budget: starting one upload must not delete unrelated expired upload-session rows or staging parts. Expired rows must never be resumed, and Janitor must retain the existing multi-batch drain test.

Next action: continue ordinary download/sync/delete performance audits and only change another deterministic request, SQL, allocation, filesystem, lock, or object-store multiplier.

### FileOperation enqueue root-validation batch-load contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- 120 selected sibling file roots, each with valid file metadata;
- deterministic SQL counting using the existing FileOperation GORM trace counter;
- comparison runs the legacy single-root loader for the same refs and the new batch loader;
- transaction begin/commit statements are outside the counted window.

BEFORE:

- each selected file root uses one locked `xd_nodes` SELECT plus one `xd_files` preload SELECT;
- **120 roots -> 240 SELECTs** before aggregate byte calculation.

AFTER / current:

- all selected roots are locked by one owner-scoped, ID-ordered `xd_nodes` SELECT;
- file metadata is loaded by one batched `xd_files ... IN (...)` preload SELECT;
- **120 roots -> 2 SELECTs**;
- returned nodes are reconstructed in request order;
- `node_not_found`, `root_mutation`, and `revision_conflict` validation still reports the first failing requested item and current revision where applicable;
- FileOperation execution itself remains unchanged and still performs its existing per-item mutation checks.

Decision: **Accepted.** This removes an enqueue-time N×2 SQL multiplier without broadening the execution-stage lock/mutation change.

Regression budget: selected-root enqueue validation remains **2 SELECTs** for a non-empty file batch regardless of batch size up to the existing 200-item cap; first-failure request-order semantics must remain covered.

Next action: execution-stage selected-root loading is covered by the dedicated contract below; continue recursive mutation/progress audits separately.

### FileOperation execution root-validation batch-load contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- 120 selected sibling file roots in one durable FileOperation;
- deterministic SQL counting uses the existing FileOperation GORM trace counter;
- Copy/Delete require File metadata; Move intentionally does not preload File metadata;
- the existing ordered locked batch loader is reused by the production execution paths.

BEFORE:

- Copy/Delete execute `batchLoadNodeTx(..., preload=true)` once per selected root;
- each root load issues one locked `xd_nodes` SELECT plus one `xd_files` preload SELECT;
- **120 Copy/Delete roots -> 240 SELECTs** before recursive mutation work;
- Move executes `batchLoadNodeTx(..., preload=false)` once per root;
- **120 Move roots -> 120 SELECTs** before recursive mutation work.

AFTER / current:

- Copy/Delete lock and validate all selected roots with one ordered `xd_nodes ... IN (...)` SELECT plus one batched File preload;
- **120 Copy/Delete roots -> 2 SELECTs**;
- Move locks and validates the same 120 roots with one ordered `xd_nodes ... IN (...)` SELECT and no File preload;
- **120 Move roots -> 1 SELECT**;
- nodes are reconstructed in request order, so first failing request index/id/revision validation semantics remain unchanged;
- Copy/Move/Delete recursive subtree work, target/conflict checks, managed-source protection, undo plans, mutation SQL and progress updates are unchanged.

Decision: **Accepted.** Execution already holds selected-root `FOR UPDATE` locks for the transaction lifetime; batching those existing root loads removes an N-scaled SQL round-trip multiplier without changing the recursive mutation algorithms.

Regression budget: Copy/Delete selected-root execution validation remains **2 SELECTs** and Move remains **1 SELECT** for any non-empty batch up to the existing 200-item limit. Production execution functions must not return to per-root `batchLoadNodeTx` calls.

Regression commands:

- `go test ./internal/api -run '^TestFileOperation(BatchRootLoadUsesConstantSQL|ExecutionUsesBatchRootLoads)$' -count=1`.

Next action: continue ordinary delete/sync/download execution audits and only change another deterministic SQL, request, allocation, filesystem, lock, or object-store multiplier.

### Upload finalize existing-CAS write-elision contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- a completed resumable upload whose declared SHA256 already has a ready CAS blob of the same size;
- the uploading user does **not** need to own that blob, so the cross-user instant-upload prohibition is unchanged;
- evidence is deterministic Store write counting around the real finalize handler;
- final SHA256/MD5 verification still consumes every uploaded byte.

BEFORE:

- finalize reads all uploaded parts and hashes them;
- finalize also writes one full assembled temporary object of **N bytes**;
- CAS preparation then discovers that the **N-byte CAS object already exists**, so the assembled temporary object is deleted;
- full-file assembled writes for this workload: **1**.

AFTER / current:

- ready CAS metadata plus metadata `Stat` establishes that a same-size target object already exists;
- finalize reads all uploaded parts and recomputes SHA256/MD5 exactly as before;
- bytes flow directly into the hash writers, not a duplicate Store object;
- full-file assembled writes: **0**;
- a hash mismatch still returns `file_hash_mismatch`; an existing CAS object is not proof that the uploaded bytes matched;
- stores without `ObjectStatProvider`, missing/stale CAS metadata, or missing/wrong-size CAS objects keep the original path.

Decision: **Accepted.** This removes one whole-file write and its temporary storage footprint from duplicate-content finalization without enabling cross-user instant upload or weakening payload verification.

Regression budget: existing-CAS finalize must perform **0 full-file assembled Store.Put calls** while still reading/hash-validating the complete upload. Unique-content finalize must retain the existing assemble-and-promote behavior.

Next action: continue the basic download/sync/delete audit and only change another deterministic request, SQL, allocation, filesystem, lock, or object-store multiplier.

### Upload finalize reused-source open contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Server resumable-overwrite finalize path using fixed-size chunk reuse from the previous file revision;
- stable structural shape: **128 chunks**, **1 changed staging chunk** in the middle, **127 reused chunks** pointing at the same prior CAS object; this mirrors a 1 GiB file at 8 MiB/chunk without allocating a 1 GiB test fixture;
- evidence method: deterministic `uploadPartSequence` test with a counting Store wrapper; wall-clock timing is intentionally not quoted;
- samples: n/a for the structural open count.

BEFORE:

- every reused part calls `Store.Open(source_storage_key)` independently;
- the 127 reused chunks therefore cause **127 opens** of the same prior CAS object;
- the one changed staging chunk causes **1** staging-object open.

AFTER / current:

- `uploadPartSequence` keeps one cached source file handle for the current reused source storage key;
- reused chunks before and after the interleaved changed staging chunk share that handle;
- reused source-object opens are **127 -> 1** for the stable workload;
- the changed staging-object open remains **1**;
- section offsets/sizes, assembled SHA-256/MD5 verification, CAS promotion, version history, resume state, and staging cleanup are unchanged.

Decision: **Accepted.** This removes reused-chunk-count-scaled object opens from delta overwrite finalize without changing file bytes or integrity checks.

Regression budget: reused source opens must remain **O(distinct reused source storage keys)**, not O(reused chunk count). The normal same-file overwrite path has one source key, so it must open that source at most once per finalize sequence.

Next action: continue sync/delete basic-path performance. LocalStore assembled-content promotion is already a same-filesystem rename, so no speculative CAS-copy rewrite is planned.

### Windows CfAPI hydration range-buffer allocation contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Windows CfAPI `fetchData` hydration path;
- stable synthetic structural workload: one callback requests **1 GiB**, fetched as **256 x 4 MiB** HTTP ranges;
- evidence method: source-level explicit large response-buffer allocation count, `DownloadRangeInto` caller-buffer unit coverage, and Windows build/tests;
- this workload describes allocation scaling and is **not** a claim that Windows normally requests 1 GiB in one callback;
- samples: n/a for the structural count.

BEFORE:

- each `DownloadRange` call used `io.ReadAll` and returned a newly allocated payload slice;
- 256 range requests therefore produced **256** large response buffers in the callback.

AFTER / current:

- `fetchData` allocates one buffer capped at **4 MiB** for the callback;
- every range request fills a slice of that same buffer through `DownloadRangeInto`;
- the same 1 GiB workload therefore uses **1** large response buffer;
- HTTP range requests remain **256**, CfAPI transfer granularity remains 4 MiB, and transfer-progress semantics are unchanged.

Decision: **Accepted.** This removes range-count-scaled large response allocations from the Windows hydration hot path without changing the network contract or public compatibility path.

Regression budget: explicit hydration payload buffers must remain **O(1) per fetch callback**, capped at **4 MiB**; do not replace this with full-file buffering.

Next action: continue the basic-path performance audit at FileOperation Copy/Move execution and FileExplorer thumbnail/cache transport; only optimize when a deterministic structural or measured hotspot is found.

### Linux FUSE read destination-buffer reuse

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Linux FUSE file-handle read callback backed by the existing local temp file;
- stable structural workload: **1 GiB sequential read** at **128 KiB per FUSE callback** = **8,192 callbacks**;
- evidence method: source-level payload-buffer allocation count plus a regression that verifies the returned `ReadResult` aliases the incoming go-fuse `dest` buffer;
- no wall-clock benchmark is quoted.

BEFORE:

- every `linuxHandle.Read` allocates `make([]byte, len(dest))`;
- the callback reads into that new slice and returns it through `fuse.ReadResultData`;
- the named workload therefore creates **8,192 explicit payload buffers**, with **1 GiB cumulative requested payload allocation volume** across the sequence.

AFTER / current:

- `ReadAt` fills the go-fuse-provided `dest` slice directly;
- `fuse.ReadResultData(dest[:n])` returns the same backing array;
- explicit xDrive payload-buffer allocations in the callback are **8,192 -> 0** for the named workload;
- this is cumulative allocation traffic, not 1 GiB of simultaneously retained memory;
- the file handle mutex, offset semantics, partial EOF reads, backing temp file and returned payload bytes are unchanged.

Decision: **Accepted.** go-fuse v2.5.1 explicitly permits constructing the read result from the incoming `dest` buffer, so the old copy buffer is unnecessary work on every Linux FUSE read.

Regression budget: `linuxHandle.Read` must not allocate a second payload-sized read buffer. Returned non-empty data must alias the incoming `dest` backing array.

Regression command:

- `go test ./internal/mount -run '^TestLinuxHandleReadReusesFuseDestinationBuffer$' -count=1`.

Next action: continue the basic sync/delete/download audit and only change paths with another deterministic SQL, request, allocation, or I/O multiplier.

### Windows change-journal baseline index contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Windows incremental remote journal fast path;
- stable baseline: **100,000 non-root entries**;
- one maximum-sized journal page: **500 missing file-delete events**;
- each missing delete exercises both the directory-safety precheck and the apply pass without filesystem mutation;
- evidence method: source-level lookup cardinality plus a Windows unit test that builds the 100k index and performs both lookup passes; wall-clock timing is intentionally not quoted;
- samples: n/a for the structural count.

BEFORE:

- each precheck delete calls `findBaselinePathByNodeID`, which linearly scans the whole baseline when the node is absent;
- each apply delete repeats the same linear lookup;
- **500 changes x 2 passes = 1,000 full baseline scans**, or roughly **100 million baseline-entry checks** at 100k entries;
- existing file deletes then call `deletePrefix`, another full baseline scan;
- existing file renames call `moveBaselinePrefix`, another full baseline scan plus path sorting even though directory moves already fall back to full reconciliation.

AFTER / current:

- the page builds one `winBaselineNodeIndex` in **1 baseline traversal**;
- the two 500-change passes use **1,000 O(1) map lookups**;
- incremental file delete removes the known exact baseline path and index entry directly;
- incremental file rename moves the known exact baseline entry directly and updates the node index;
- rare excluded-directory prefix cleanup updates the baseline and index together;
- directory move/delete safety fallback, journal cursors, placeholder updates, local-conflict checks, and full reconciliation remain unchanged.

Decision: **Accepted.** This removes change-count x baseline-size CPU amplification from the normal incremental journal page without weakening directory subtree safety.

Regression budget: `applyRemoteChangePage` must build at most **1 baseline node index per journal page** and must not call the linear `findBaselinePathByNodeID` for each change. Incremental file delete/rename must not call `deletePrefix` / `moveBaselinePrefix`.

Next action: continue delete-path performance at content-reference release / physical blob cleanup, and only change it if deterministic SQL or object-store amplification is found.

### Windows change-journal same-path upsert index fast-path contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Windows CfAPI remote change-journal page;
- stable structural workload: **100,000 baseline entries** and an ordinary file upsert whose journal `Path` still matches the same baseline entry/node ID;
- evidence method: deterministic helper behavior plus production source-shape guard; no wall-clock benchmark is quoted.

BEFORE:

- every non-empty remote change page eagerly built `indexBaselinePathsByNodeID(baseline)`;
- even one same-path file metadata/content update allocated and populated a full **100,000-entry** node index before applying the change.

AFTER / current:

- the page starts with no node index;
- an upsert first resolves `baseline[change.Path]` and verifies the node ID;
- ordinary same-path file/directory upserts therefore build **0 full baseline indexes**;
- if the supplied path is absent/mismatched, the existing lazy node-ID index is built and reused for the rest of the page;
- delete changes still build the lazy index because the Server delete journal intentionally has no path payload;
- rename/move detection and directory safety fallbacks are unchanged.

Decision: **Accepted.** Exact-path lookup already proves identity for the common same-path upsert case, so a namespace-sized reverse index adds no correctness there.

Regression budget: a same-path upsert must not build the full baseline node index. Rename/move/new-path ambiguity and delete must retain the existing lazy indexed fallback.

Regression commands:

- `go test ./internal/mount -run '^TestWindowsRemoteJournal(SamePath|RenameStillBuildsLazy)' -count=1`.

Next action: continue small-batch Windows baseline clone/persistence-diff auditing separately; do not mix those changes into this path-resolution fast path.


### Windows local moved-placeholder baseline index contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Windows local-change reconciliation / full-reconcile local-addition phase with a **100,000-entry baseline**;
- **500 moved-placeholder node IDs** that already exist in that baseline;
- deterministic helper test verifies lazy index reuse and indexed prefix-move maintenance;
- no wall-clock speedup is claimed.

BEFORE:

- every moved placeholder resolves its Cloud node ID through `findBaselinePathByNodeID`;
- that helper performs a full Go map traversal until the ID is found;
- the 500-item workload performs **500 separate linear baseline lookups** in the moved-placeholder path;
- ordinary non-placeholder local changes do not use this lookup.

AFTER / current:

- each local reconciliation loop starts with no node index;
- the index is built **only after the first actual placeholder is detected**;
- the 500-item workload becomes **1 baseline index-build pass + 500 O(1) map lookups**;
- successful prefix moves update every moved node's indexed path;
- if a node was added after the lazy index was built, one legacy scan resolves it and caches that result;
- local reconciliation loops with no moved placeholder build **0** baseline node indexes;
- rename/move requests, revision checks, placeholder identity, parent creation and baseline persistence semantics are unchanged.

Decision: **Accepted.** This removes moved-item-count × baseline-size CPU amplification from bulk local placeholder moves without taxing ordinary local-change batches.

Regression budget: one local reconciliation loop may build at most **1** baseline node index, and only after placeholder identity is confirmed. Existing indexed entries must not fall back to full-map scans; post-index additions may use at most one fallback scan per newly observed node before caching.

Next action: continue basic delete/download/sync performance and only change another deterministic SQL, request, allocation, filesystem, or object-store multiplier.

### Permanent-delete CAS reference release contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- permanent deletion of a trash subtree whose files/versions reference **120 unique CAS blobs**;
- every unique CAS key requires one refcount decrement; some rows remain referenced and some transition to `deleting`;
- evidence method: deterministic PostgreSQL statement counting around `releaseContentReferencesTx`; physical object-store deletion is outside this measured phase;
- samples: n/a for the structural count.

BEFORE:

- each unique CAS blob acquires one advisory xact lock with its own SQL statement;
- each blob is loaded with its own `SELECT ... FOR UPDATE`;
- each blob is updated with its own `UPDATE`;
- **120 unique blobs = 360 SQL statements** in the reference-release phase.

AFTER / current:

- unique CAS releases are sorted and processed in batches capped at **200**;
- one PostgreSQL statement per batch acquires advisory locks in hash order;
- one `SELECT ... FOR UPDATE` loads all matching content rows, then Go validates storage keys and refcount underflow exactly as before;
- one batch `UPDATE ... FROM VALUES` applies the resulting refcount/state transitions;
- **120 unique blobs = 3 SQL statements** in the reference-release phase;
- zero-ref rows still enter `deleting` and are physically removed only by the existing finalize path;
- legacy non-CAS key cleanup uses the separate batched reference-check contract below; physical object deletion remains per key.

Decision: **Accepted.** This removes unique-content-count-scaled DB round trips from permanent delete without changing the two-phase CAS deletion protocol or physical object deletion.

Regression budget: reference release must use at most **3 × ceil(unique CAS blobs / 200) SQL statements**, with exactly three statements for each non-empty batch; advisory locks must remain deterministically ordered and batches must stay parameter-bounded.

Next action: physical object deletion itself remains per-object by storage backend contract; continue download/basic-path performance audit after the reused-source guard is indexed.

### Legacy storage-key delete reference-check contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- permanent delete has already committed removal of the selected subtree's File/FileVersion rows;
- the release phase returns **120 unique sorted legacy non-CAS storage keys**;
- 40 keys remain referenced by current File rows, 40 by FileVersion rows, and 40 are unreferenced;
- deterministic GORM SQL tracing counts only the post-commit legacy reference lookup; physical object deletes are tracked separately.

BEFORE:

- `deleteLegacyStorageKeys` executes one SQL statement per key;
- each statement contains two scalar `COUNT(*)` subqueries, one against `xd_files` and one against `xd_file_versions`;
- **120 legacy keys -> 120 SQL statements** before physical deletion.

AFTER / current:

- candidate keys are processed in parameter-bounded batches of at most **500**;
- one `UNION` query per batch loads the subset still referenced by either File or FileVersion;
- **120 legacy keys -> 1 SQL statement**;
- referenced keys are kept exactly as before;
- unreferenced keys are still passed to `Store.Delete` individually and in input order;
- CAS content-reference batching and the permanent-delete transaction are unchanged.

Decision: **Accepted.** Reference existence is a set operation over the already unique candidate key list, so per-key SQL round trips add no safety.

Regression budget: legacy reference checks remain **ceil(candidate keys / 500) SQL statements**, with **1 statement** for the 120-key fixture; query failure must fail closed by deleting no keys; physical `Store.Delete` cardinality remains one call per unreferenced legacy object.

Next action: continue sync/download/delete audits and only change another deterministic request, SQL, allocation, filesystem, lock, or object-store multiplier.

### CAS physical-delete reused-source guard contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- one `xd_content_blobs` row in `deleting` state with `ref_count=0`;
- **128 reused upload parts** temporarily reference the blob through the same `source_storage_key`;
- evidence method: query-shape and schema-index contract plus the existing dedup integration lifecycle that verifies reused ranges keep the blob alive;
- samples: n/a for the structural result.

BEFORE:

- the finalizer issues `COUNT(*)` with `reused = TRUE AND source_storage_key = ?`;
- `xd_upload_parts` has the primary `(session_id, part_index)` key and an index on `reused`, but **no index on `source_storage_key`**;
- boolean safety only needs to know whether one matching reused range exists, but `COUNT(*)` must consume all **128 matching rows** in this workload before returning the count.

AFTER / current:

- migration installs `idx_xd_upload_parts_reused_source_storage(source_storage_key) WHERE reused = TRUE`;
- the finalizer issues `SELECT EXISTS (...)` with the partial-index predicate written as the SQL literal `reused = TRUE`;
- the exact source-storage-key probe can use the dedicated partial index and may stop after the first matching entry;
- the existing transaction order remains advisory lock -> content row `FOR UPDATE` -> reused-source guard -> physical `Store.Delete` -> content-row delete;
- no change to physical object deletion cardinality or upload-session semantics.

Decision: **Accepted.** The guard now matches its boolean intent and has an index aligned with its exact lookup key, without weakening the temporary-reference keepalive rule.

Regression budget: the finalizer guard must remain a single exact-key `EXISTS` probe backed by a partial index on reused upload parts; do not regress to counting all matches or scanning reused rows by boolean flag alone.

Next action: continue the basic download path audit; physical `Store.Delete` remains intentionally one call per object until storage backends expose a safe bulk-delete contract.


### Upload conflict preflight batching contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- FileExplorer multi-file/folder upload with **120 unique destination names** under one valid parent;
- existing single preflight performs one authenticated HTTP/IPC request per file and, inside the handler, one parent lookup plus one exact-name conflict lookup;
- batch preflight uses a VALUES-backed Server query that validates parents and resolves exact-name conflicts in one SQL statement;
- evidence is deterministic request/query cardinality; no wall-clock speedup is claimed.

BEFORE:

- **120 sequential preflight requests** before/during the ordered upload loop;
- approximately **240 handler-level DB queries** for those 120 targets (120 parent lookups + 120 conflict lookups), excluding auth middleware queries.

AFTER / current:

- **1 batch preflight request** for the 120-target workload;
- **1 Server SQL statement** returns the ordered 120-item result set;
- batch size is capped at **200 targets**, and larger selections are chunked by the shared controller;
- duplicate case-insensitive destination keys are intentionally excluded from upfront batching so their later preflight observes effects from earlier uploads;
- a batch transport/capability failure falls back to the existing single-target preflight path;
- per-item validation errors remain attached to their original index and are surfaced only when that target is reached, preserving ordered partial-success behavior;
- upload-session creation and finalize still revalidate target state, so batching does not weaken the authoritative conflict checks.

Decision: **Accepted.** This removes request-count-scaled preflight round trips and handler queries for normal unique-name batches without changing conflict-dialog order or upload execution order.

Regression budget: a normal <=200 unique-target batch must use at most **1 batch request / 1 batch SQL statement**; no batch failure may disable the single-target fallback, and duplicate destinations must remain sequentially preflighted.

Next action: upload finalize reused-source open amplification is handled by the dedicated contract above; continue sync/delete basic-path performance without speculative CAS-copy rewrites.

### Instant-upload ownership existence-probe contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- instant-upload dedup ownership lookup against a CAS storage key;
- deterministic fixture with **120 current-file references** to one key and **120 historical-version references** to another key for the same owner;
- production Server migration already provides `idx_xd_files_storage_key` and `idx_xd_file_versions_storage_key`;
- the regression captures the SQL emitted by the real `userOwnsStorageKey` helper and verifies current-file ownership, version-only ownership, foreign-user rejection, and a missing key;
- no wall-clock speedup is claimed.

BEFORE:

- each ownership check executes `COUNT(*)` over a `UNION ALL` of matching current-file and historical-version references;
- because the caller only needs a boolean, the aggregate nevertheless requires determining the full matching cardinality;
- instant upload intentionally performs this check once before entering the transaction and again inside the content-hash lock before retaining the blob.

AFTER / current:

- the same ownership predicate is expressed as one `SELECT EXISTS (... UNION ALL ...)` statement;
- the storage-key probes remain index-supported and the existence query may stop once ownership is proven instead of aggregating every matching reference;
- both ownership checks remain in place: the outer check is a fast rejection and the in-transaction check remains the authoritative safety revalidation;
- current-file, historical-version, trash/history ownership semantics are unchanged because the joins and owner predicate are unchanged.

Decision: **Accepted.** This removes unnecessary full-cardinality aggregation from a hot dedup-upload boolean check without weakening ownership validation or transaction safety.

Regression budget: `userOwnsStorageKey` must remain **1 SQL statement using EXISTS and no COUNT aggregation**, probe both current files and historical versions, and preserve the in-transaction recheck.

Next action: continue the sync/delete/download basic-path audit and only change another deterministic request, SQL, allocation, or I/O multiplier.

### Upload CAS metadata-stat contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- healthy CAS object validation during upload finalize and instant-upload retain;
- Local storage implements `storage.ObjectStatProvider`;
- deterministic unit fixture wraps Local and counts metadata `Stat` versus payload `Open`;
- no wall-clock speedup is claimed.

BEFORE:

- `ensureContentBlobObject` opened the target CAS object, called `f.Stat()`, then closed it;
- `retainOwnedContentBlobTx` used the same payload-handle pattern;
- each healthy-object validation therefore incurred **1 payload Open + 1 fstat + 1 Close** even though only object size metadata was required.

AFTER / current:

- both paths call one shared metadata-size helper;
- `ObjectStatProvider` backends perform **1 metadata Stat and 0 payload Opens**;
- stores without metadata support retain the existing `Open + Stat + Close` fallback;
- expected-size validation, CAS locking, blob state/refcount checks, quota and transaction semantics are unchanged.

Decision: **Accepted.** This removes payload-handle churn from two hot upload dedup/finalize checks without weakening content validation.

Regression budget: ObjectStatProvider paths must remain **0 payload Opens** for metadata-only healthy-object size checks; fallback Store behavior must remain supported.

Next action: continue download/sync/delete basic-path performance and only change another deterministic request, SQL, allocation, or I/O multiplier.

### Archive prepare subtree SQL contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- one selected top-level folder directly under the user root;
- **120 direct child folders**, each containing **1 file**;
- total manifest entries: **241** including the selected root;
- evidence is deterministic SQL cardinality for subtree enumeration; no wall-clock speedup is claimed.

BEFORE:

- archive manifest DFS calls one `Find(children)` for the selected root and one for each of its 120 child folders;
- that is **121 child-list SQL queries**, with additional `Preload("File")` queries emitted by GORM;
- file bytes are not read during this phase, but request latency and DB work scale with directory count.

AFTER / current:

- **1 recursive CTE** returns all descendants for the selected root and LEFT JOINs current file metadata in the same statement;
- children remain ordered by `lower(name), id` within each parent before the existing DFS builds archive paths;
- cycle detection and the 200,000-entry cap remain enforced;
- each file still goes through the existing stored-object open/stat validation;
- ZIP creation still streams each stored object with `io.Copy`; the data plane is intentionally unchanged.

Decision: **Accepted.** This removes directory-count-scaled manifest SQL without changing archive contents or download streaming semantics.

Regression budget: each selected top-level directory root may use at most **1 recursive subtree SQL statement** regardless of descendant directory count; no reintroduction of per-directory child queries.

Next action: archive prepare payload-handle amplification is handled by the metadata-stat contract below; continue basic download/sync/delete audits after that.

### Archive prepare local metadata-stat contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- production `storage.Local` backend;
- archive manifest containing **1,000 files** whose metadata sizes already exist in `xd_files`;
- prepare still verifies every stored object exists and has the expected size before the ZIP data plane starts;
- evidence method: deterministic provider fast-path test plus Local storage metadata test; wall-clock timing is intentionally not quoted.

BEFORE:

- each file validation calls `Store.Open`, then `File.Stat`, then `File.Close`;
- 1,000-file prepare therefore performs **1,000 payload-handle opens + 1,000 stats + 1,000 closes**;
- ZIP streaming later opens each of the same 1,000 payload objects again to copy bytes.

AFTER / current:

- `storage.ObjectStatProvider` exposes metadata-only object inspection without changing the base `Store` interface;
- production `storage.Local` implements it with one resolved-path `os.Stat`;
- 1,000-file prepare performs **0 payload-handle opens + 1,000 stats + 0 payload-handle closes**;
- actual ZIP streaming remains **1,000 payload opens** and still verifies the bytes written equal the prepared size;
- backends that do not implement metadata stat keep the old `Open -> Stat -> Close` validation fallback.

Decision: **Accepted.** This removes file-count-scaled payload-handle churn from archive preparation while preserving pre-stream existence/size validation and the existing ZIP data plane.

Regression budget: on `storage.Local`, archive prepare must perform **zero payload opens for stored-object metadata validation**. Do not remove the existence/size check, and do not change the fallback contract for backends without `ObjectStatProvider`.

Next action: archive ZIP progress bookkeeping is handled by the coalescing contract below; then continue sync/delete, prioritizing deterministic repeated I/O or unbounded response work.

### Archive download progress coalescing contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Archive ZIP data plane with progress tracking enabled;
- deterministic fast-transfer workload: **8 MiB** payload read in **64 KiB** chunks = **128 data reads**;
- test freezes the progress clock so all 128 reads occur inside one reporting interval;
- a second deterministic test advances the clock by exactly **100 ms** to lock periodic reporting and explicit terminal flush behavior;
- no wall-clock speedup is claimed.

BEFORE:

- `archiveProgressReader` invokes `onRead` for every successful underlying read;
- each callback reaches `updateArchiveDownloadProgress`, locks the Server-wide `archiveProgressMu`, updates the file state and calls `time.Now()`;
- the 8 MiB / 64 KiB workload therefore performs **128 progress-state callbacks / mutex updates**.

AFTER / current:

- read bytes accumulate locally in the per-file progress reader;
- progress state is published at most once every **100 ms** while the file is transferring;
- EOF/read errors flush pending bytes inside the reader, and the ZIP data plane explicitly flushes again after `io.Copy` returns so writer-side termination cannot strand pending progress;
- the frozen-clock 128-read workload performs **1 progress-state callback**, with the reported delta exactly equal to **8 MiB**;
- slow transfers still emit periodic progress at roughly **10 Hz**;
- ZIP entry creation, Store.Open, io.Copy, byte validation and final completed-size assignment are unchanged.

Decision: **Accepted.** This removes read-count-scaled global progress-lock traffic from fast archive downloads without changing payload streaming or final byte accounting.

Regression budget: archive byte progress must not call the global progress updater once per fast payload read. Periodic updates remain <= about 10 Hz per active file, and pending bytes must flush on EOF/read error or the explicit post-`io.Copy` terminal flush before the terminal file state is recorded.

Next action: selected-root ancestor filtering is handled by the constant-query contract below; then continue the basic delete/sync audit.

### Archive selected-root ancestor coverage contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- **120 selected files**;
- every file lives under its own **8-directory-deep** branch beneath one shared owner root;
- no selected file is nested under another selected item in the baseline workload;
- evidence is deterministic SQL cardinality from the real selected-root coverage helper;
- no wall-clock speedup is claimed.

BEFORE:

- `archiveNodeHasSelectedAncestor` walks each selected item's parent chain in Go;
- a request-local parent cache avoids reloading the shared root, but the 8 branch directories are unique per selected item;
- first selected file performs **9 parent SELECTs** (8 branch directories + root);
- the remaining 119 files perform **8 unique parent SELECTs** each;
- total ancestor-filter SQL on the fixture is **9 + 119×8 = 961 SELECT statements**.

AFTER / current:

- one owner-scoped recursive CTE seeds all selected IDs and walks their active parent chains together;
- one grouped result reports whether each origin encounters another selected ancestor;
- the same statement detects cycles and a missing/deleted/foreign parent chain;
- the 120-item fixture performs **1 SQL statement**;
- nested selections still suppress the descendant archive root;
- cycles still return `errArchiveInvalidStoredEntry`;
- missing/inactive parent chains still return `gorm.ErrRecordNotFound`.

Decision: **Accepted.** This removes selected-items × depth database round trips from multi-root archive preparation without changing root de-duplication or consistency validation.

Regression budget: archive selected-root ancestor filtering must remain **1 SQL statement per prepare request**, independent of selected-root count/depth up to the existing 1,000-root limit. Do not weaken cycle or missing-parent validation.

Next action: continue the basic delete/sync performance audit and only change another deterministic request, SQL, allocation, filesystem, lock, or object-store multiplier.

## Measured baselines and accepted/rejected changes

Only measurements produced from a stable, repeatable workload belong in this table. Complexity-only improvements without an equivalent BEFORE/AFTER timing are documented separately and must not be presented as measured speedups.

| Workload | BEFORE | AFTER / Current | Result |
| --- | ---: | ---: | --- |
| VirtualCollection CPU, 100k logical items / 2,500 viewport updates | n/a | CI CPU medians **126.877 / 160.081 / 161.319 ms/sweep**; **50.751 / 64.032 / 64.528 us/viewport**; peak retained 800; final retained 600 | **No production optimization**: timing varies ~27% across hosted runners, but worst observed controller CPU remains <0.1 ms/viewport and structural bounds are stable |
| Non-empty sparse range SQL | 2 SQL round-trips | 1 SQL round-trip | **-50% DB round-trips** |
| Search VirtualCollection metadata, 10k logical results | 10,000 retained items | 1,000 retained items | **-90% retained metadata** |
| Search 100k, range offset 0 | 1.586692183 s | 451.180732 ms | **-71.6% / 3.52x faster** |
| Search 100k, range offset 50k | 1.647826274 s | 674.156893 ms | **-59.1% / 2.44x faster** |
| Search 100k, cursor first page | 977.251868 ms | 411.109089 ms | **-57.9% / 2.38x faster** |
| Search 100k, cursor around item 50k | 2.168573513 s | 382.454648 ms | **-82.4% / 5.67x faster** |
| Directory 100k simple name-only fixture, first/middle | n/a | 73.981118 ms / 92.281482 ms | Healthy baseline; no production optimization |
| Directory-sort 100k current contract, name first-counted / middle-count-free | n/a | **118.088387 ms / 161.423072 ms** | #756 current-contract baseline |
| Directory-sort 100k current contract, updated first-counted / middle-count-free | n/a | **112.731281 ms / 88.349891 ms** | #756 current-contract baseline |
| Directory-sort 100k current contract, size first-counted / middle-count-free | n/a | **113.027136 ms / 130.228185 ms** | #756 current-contract baseline |
| Directory-sort 100k current contract, type first-counted / middle-count-free | n/a | **209.882056 ms / 294.770849 ms** | Slowest current directory sort baseline |
| Desktop warm-thumbnail transport, 200 unique x 64 KiB x 3 passes | **600 upstream GETs / 39,321,600 B** | **200 upstream GETs / 13,107,200 B** | **Accepted**: **-66.7% requests**, **-66.7% payload**, **25 MiB less upstream payload**; hosted httptest wall time is diagnostic only and is not compared across layers |

### Historical rejected measured attempt: type expression index (pre-#750)

A candidate type-sort expression index was evaluated on the exact same 100k mixed-file workload before adding any production index:

- index build on 100k nodes: **120.588962 ms**
- type first range: **273.676411 ms -> 274.482786 ms** (**0.3% slower**)
- type middle range: **422.931606 ms -> 420.332119 ms** (**0.6% faster**)

This is noise-level improvement with permanent write/storage maintenance cost, so the index was **rejected** and is not part of the production schema.

That result predates the #750 count-once contract: the old middle-range workload still recomputed `COUNT(*) OVER()`. The current benchmark-only follow-up does **not** erase this rejection. It explicitly retests the same expression index only because later viewport ranges now run with `include_count=false`, which can materially change the PostgreSQL plan. It also measures a persisted extension sort-key + matching index candidate. Until the paired data is written here, both candidates remain **Benchmarking**, not production recommendations.

### Directory type-sort count-free A/B

Status: **Measured / expression-index production candidate accepted; persisted-key rejected**.

Workload:

- PostgreSQL 17, isolated schema;
- **100,000** mixed file nodes with four extensions (`.txt/.jpg/.pdf/.zip`);
- page size **200**;
- first range at offset 0 remains authoritative-counted;
- middle range at offset 50,000 uses the production `include_count=false` path;
- **3 measured samples** after warm-up;
- exact ordered node IDs matched across every candidate;
- benchmark test duration: **18.29 s**.

Current #750-contract HTTP baselines:

| Sort | First range, counted | Middle range, count-free |
| --- | ---: | ---: |
| name | **118.088387 ms** | **161.423072 ms** |
| updated | **112.731281 ms** | **88.349891 ms** |
| size | **113.027136 ms** | **130.228185 ms** |
| type | **209.882056 ms** | **294.770849 ms** |

The paired DB-level type-sort A/B kept the query shape and ordered node IDs fixed:

| Variant | First counted | Delta vs current | Middle count-free | Delta vs current |
| --- | ---: | ---: | ---: | ---: |
| Current dynamic expression | **211.511509 ms** | baseline | **300.789263 ms** | baseline |
| Exact expression index | **208.566369 ms** | **-1.39%** | **126.173709 ms** | **-58.05%** |
| Persisted extension key + index | **122.501282 ms** | **-42.08%** | **192.687067 ms** | **-35.94%** |

Candidate setup cost on the same 100k fixture:

- expression-index build: **335.346016 ms**;
- persisted-key backfill: **2.831021167 s**;
- persisted-key index build: **147.718034 ms**.

Decision:

- **Accept the exact expression index as the production candidate.** The old pre-#750 rejection no longer applies to the dominant later-range path: once `COUNT(*) OVER()` is removed from subsequent viewport ranges, the same index produces a paired **58.05%** middle-range reduction while leaving the once-per-generation counted first range effectively unchanged.
- **Reject the persisted-key candidate for now.** Although it improves the counted first range more, it is slower than the expression index on the repeated count-free middle-range path, requires a multi-second 100k-row backfill in this fixture, adds persistent column/storage cost, and must be maintained on every name-changing create/rename/keep-both path.
- #756 remains benchmark-only: it does **not** add a production schema/index or change the Server query.

Production follow-up status: **Accepted / production validated (#759)**.

The production change installs only the accepted exact expression index as `idx_xd_nodes_children_type` through the normal Server `migrate()` path. It does not add a persisted sort-key column, alter the `sort=type` wire contract, or change the SQL sort expression. Migration coverage verifies that the partial expression index exists and that repeated Server migrations remain idempotent.

The unchanged #756 100k workload rerun on the #759 production branch measured:

| Production validation | Dynamic expression | Exact expression index | Paired reduction |
| --- | ---: | ---: | ---: |
| First range, counted | **212.643712 ms** | **210.804146 ms** | **-0.87%** |
| Middle range, count-free | **299.467459 ms** | **127.996139 ms** | **-57.26%** |

The same run measured expression-index build at **223.486145 ms**. The rejected persisted-key candidate measured **197.439026 ms** on the middle count-free range (**-34.07%**) and required **2.897457423 s** of backfill plus **148.027849 ms** index build, so it remains inferior for the repeated viewport path and materially more invasive.

Decision: **ship the expression index and keep the persisted-key design rejected.** #759 is the production realization of #756's measured candidate, not a new query contract.

### VirtualCollection 100k CPU baseline (PR #708)

Deterministic workload shape:

- logical items: **100,000**
- viewport size: **40**
- virtual page size: **200**
- viewport updates per full sweep: **2,500**
- page loads per full sweep: **500**
- peak retained logical items: **800**
- final retained logical items: **600**

#### Rejected short wall-clock timing method

The first implementation timed one ~100-150 ms sweep with `process.hrtime.bigint()`. Three hosted-runner CI executions produced medians of **122.270 ms**, **112.468 ms**, and **156.711 ms**. The min-to-max spread is about **39%**, even though all structural counts were identical.

That method is therefore **rejected as a regression baseline**. These values remain documented as evidence of runner noise and must not be quoted as a stable FileExplorer speed.

#### Revised CPU methodology

The benchmark now:

- measures `process.cpuUsage()` as the primary metric instead of scheduler-sensitive wall time;
- runs **10 complete 100k sweeps per sample**;
- records **5 samples** after warm-up;
- reports CPU milliseconds per sweep and CPU microseconds per viewport update;
- still reports wall time per sweep as diagnostic-only data;
- runs Node with `--expose-gc` and performs a GC opportunity before each sample.

Three GitHub CI runs of the revised method measured:

- run A: **160.081 ms CPU / sweep**, **64.032 us CPU / viewport**, **159.759 ms** diagnostic wall / sweep;
- run B: **161.319 ms CPU / sweep**, **64.528 us CPU / viewport**, **160.951 ms** diagnostic wall / sweep;
- validation run C: **126.877 ms CPU / sweep**, **50.751 us CPU / viewport**, **126.569 ms** diagnostic wall / sweep.

The CPU medians still vary by about **27%** across hosted runners, so timing remains **diagnostic rather than a narrow CI regression gate**. Structural counts, however, stayed exactly **500 page loads / 800 peak retained / 600 final retained** in every run.

Decision for PR #708: **accept the structural baseline and do not optimize VirtualCollection further now**. Even the slowest observed run is only **64.528 us CPU per viewport update**; the current 100k media-directory gap is renderer/thumbnail/transport behavior, not this state engine.

This is a controller/VirtualCollection CPU and retained-metadata baseline only. It does **not** include React commit/layout/paint, thumbnail HTTP/Agent IPC, image/video decode, Blob creation, or thumbnail generation. Do not use this benchmark as the result for media-heavy directories.

### Existing optimizations without comparable wall-clock BEFORE/AFTER

Thumbnail queue/cache changes, Desktop binary thumbnail transport, adaptive prefetch, indexed typed-path lookup, indexed folder-upload conflict lookup, navigation-tree pagination, and several controller/projection refactors have correctness/complexity/resource regression coverage but do **not** have an equivalent wall-clock BEFORE/AFTER workload. Do not quote a timing speedup for these changes until a stable benchmark exists.

### Desktop folder-download paged scan

Status: **Accepted / structural; wall-clock unmeasured**.

Workload and method:

- deterministic Agent fixture with **1,201 sibling nodes** under one directory;
- cursor page limit: **500**;
- recursive tree enumeration is the current paged path; #788 also applied the same paging to selected-root lookup before the exact lookup follow-up below;
- sample count: not applicable to timing because this is a deterministic structural contract, not a wall-clock benchmark;
- command: `go test ./cmd/xdrive-agent -run '^TestScanAgentCloudDownloadFolderPagesWideDirectories$' -count=1`.

BEFORE #788:

- Desktop folder download used `Client.List` for each recursively visited directory;
- the legacy children endpoint materialized and serialized the full sibling set in one response;
- on the 1,201-sibling fixture this meant **1 request carrying 1,201 nodes**.

AT #788 / current recursive-scan contract:

- recursive enumeration uses `Client.ListPage` with a **500-node** cursor page and a repeated/missing-cursor guard;
- the 1,201-sibling fixture uses **3 requests**, with at most **500 nodes in any one response**;
- maximum per-response node cardinality in that fixture is **1,201 -> 500 (-58.4%)**;
- total manifest metadata remains **O(total files)**, so this change does **not** claim bounded total Agent memory or a wall-clock speedup;
- #788's paged selected-root lookup is superseded by the exact lookup below.

Decision: **keep** bounded paging for recursive enumeration. It removes unbounded Server query/JSON/transport response size at the cost of additional bounded requests.

Regression budget: recursive folder-download scans may not fall back to legacy unpaginated `Client.List`; each children page stays at **<=500 nodes**.

### Desktop folder-download exact root lookup

Status: **Accepted / structural; wall-clock unmeasured**.

Workload and method:

- same logical **1,201-sibling** selected-folder scenario used to validate #788 root lookup;
- the requested folder ID is already known by FileExplorer;
- sample count: not applicable to timing because request/node counts are deterministic;
- command: `go test ./cmd/xdrive-agent -run '^TestResolveAgentCloudDownloadFolderRootUsesExactNodeLookup$' -count=1`.

BEFORE:

- #788 located the known folder ID by paging its parent with `Client.ListPage(limit=500)`;
- a target positioned after 1,200 siblings required **3 requests** and returned **1,201 node records** before the match was found.

AFTER / current:

- Server exposes authenticated `GET /api/v1/nodes/:id` backed by the owner-scoped active-node lookup;
- Go client exposes `Node(ctx, id)`;
- Agent performs **1 exact request** returning **1 node**, then validates the expected parent, directory type, and safe name before scanning descendants;
- on the deterministic workload, request count is **3 -> 1 (-66.7%)** and returned node metadata is **1,201 -> 1 (-99.9%)**;
- the basic lifecycle integration locks owner isolation, active-only visibility through Trash, and visibility again after Restore.

No wall-clock speedup is claimed; the accepted evidence is the deterministic removal of sibling-page work.

Decision: **accept** exact root lookup and keep 500-node pagination only for recursive children enumeration.

Regression budget: selected-root resolution must not call `List` or `ListPage`; the exact route remains authenticated, owner-scoped, and active-node-only.

Next action: group-progress CPU amplification is handled by the incremental contract below. If very large folder downloads still show Agent memory pressure after that, benchmark manifest retention and child-transfer creation separately before considering a streaming manifest design.

### Desktop folder-download incremental group-progress contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Desktop Agent folder download with a fully scanned manifest of **10,000 files**;
- synthetic progress shape: **4 progress publications per file** while transfers remain sequential, matching the existing one-file-at-a-time download contract;
- evidence method: deterministic source-level aggregation cardinality plus `TestAgentCloudFolderDownloadByteProgressIsIncremental`;
- no wall-clock speedup is claimed.

BEFORE:

- group byte progress is derived by scanning `childDone[]` and `childTotals[]` on every publication;
- each publication performs **10,000 done-slot reads + 10,000 total-slot reads** for the 10,000-file workload;
- 40,000 progress publications therefore imply **400,000,000 done-slot + 400,000,000 total-slot inspections** in the aggregation layer;
- the Agent also retains two additional `int64` arrays sized to the full file manifest.

AFTER / current:

- the Agent initializes aggregate `bytesTotal` once from the manifest and updates aggregate done/total by the current file's delta;
- each progress publication performs **O(1)** byte-accounting work independent of manifest file count;
- content-length corrections adjust the aggregate total by delta, matching the previous per-child-array semantics;
- successful completion fills any final current-file byte delta; failed files retain their already-transferred byte contribution;
- the two manifest-sized byte-progress arrays are removed; child transfer handles and the manifest itself remain unchanged.

Decision: **Accepted.** This removes file-count-scaled CPU from Transfer Center group progress without changing download order, HTTP streaming, fsync/rename behavior, per-file child tasks, cancellation, partial-success accounting, or failure handling.

Regression budget: folder-download group byte aggregation must remain **O(1) per progress publication** and must not reintroduce a scan over all manifest files or manifest-sized done/total byte arrays.

Next action: continue basic sync/delete/download auditing and only change another deterministic request, SQL, allocation, filesystem, lock, or object-store multiplier.

### File download metadata SQL contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- one authenticated current-file download metadata lookup;
- one authenticated historical-version download metadata lookup;
- both target one active file owned by the requesting user;
- evidence method: deterministic GORM SQL trace around each metadata helper; payload streaming is outside the counted region;
- sample count: n/a for the deterministic SQL-round-trip contract.

BEFORE:

- current-file download calls `ownedNode(..., preload=true)`: one `xd_nodes` query plus one GORM `Preload("File")` query = **2 SQL statements**;
- historical-version download first owner-validates the active node, then loads `xd_file_versions` separately = **2 SQL statements**.

AFTER / current:

- current-file download selects name, revision, storage key, SHA-256 and file modtime with **1 owner-scoped `xd_nodes JOIN xd_files` statement**;
- historical-version download selects the active owner file name and requested version metadata with **1 `xd_nodes JOIN xd_file_versions` statement**;
- owner isolation, active-only visibility and file-type validation remain in SQL;
- `Store.Open`, `Content-Disposition`, current-file ETag, SHA-256 response header, `http.ServeContent`, Range/seek behavior and payload bytes are unchanged.

Decision: **Accepted.** This removes one metadata DB round trip from every ordinary file download and every historical-version download without changing the data plane.

Regression budget: each current-file or historical-version download metadata lookup must remain **1 SQL statement**, owner-scoped, active-node-only, and file-type constrained. Do not reintroduce GORM Preload or a separate ownership query on these hot paths.

Next action: continue basic sync/delete/download audits and only change paths with another deterministic SQL, request, allocation or I/O multiplier.

### Web single-download progress coalescing contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- ordinary authenticated Web file/version download using either File System Access direct-to-disk or legacy Blob streaming;
- stable structural workload: **1 GiB response**, **64 KiB readable chunks**, all chunks arriving inside one 100 ms window;
- TransferStore `progress()` persists the complete transfer history and publishes listeners, so progress-call cardinality is the deterministic multiplier;
- no network/read/write operations are removed and no wall-clock speedup is claimed.

BEFORE:

- every readable chunk called TransferStore `progress()`;
- the 1 GiB / 64 KiB workload therefore caused **16,384** progress persistence/listener publications before terminal completion.

AFTER / current:

- one per-download reporter publishes after either **8 MiB** of additional bytes or **100 ms**, whichever comes first;
- the same fast workload causes **128** progress persistence/listener publications;
- slow transfers still surface progress at about 10 Hz even below the byte threshold;
- successful completion remains an immediate exact terminal `complete()`;
- failure flushes the latest successfully transferred byte count before the immediate `fail()`;
- File System Access writes, Blob fallback buffering, response reads and transfer cancellation/error behavior are unchanged.

Regression budget: ordinary Web download progress must not call TransferStore once per readable chunk. Fast streams remain bounded by one publication per 8 MiB, slow streams by the 100 ms cadence, and terminal success/failure must retain exact final state.

Regression command:

- `node --test desktop/tests/web-download-stream.cjs`.

Next action: continue the basic sync/delete audit and only change another deterministic request, SQL, allocation, filesystem, lock, or object-store multiplier.

### Web direct-to-disk download sink

Status: **Accepted / structural; wall-clock unmeasured**.

Problem:

- the legacy authenticated Web download path read every response chunk into a `BlobPart[]`;
- only after the complete response arrived did it create one Blob and trigger the browser download;
- application-retained payload therefore grew linearly with file/ZIP size, which is especially harmful for large FileExplorer downloads.

Current contract:

- when `showSaveFilePicker` is available, the save target is requested synchronously from the user's download action before archive preparation, auth refresh, or network I/O can consume transient user activation;
- the response reader waits for each file-system write before reading the next chunk, so xDrive itself does not retain an ever-growing chunk array;
- Transfer Center byte progress advances after every successful chunk write;
- a writer failure cancels the response reader and aborts the uncommitted destination file;
- cancelling the save picker returns a non-saved outcome before creating a transfer/task and produces neither success nor failure feedback;
- ordinary file downloads, historical-version downloads, and archive payloads reuse the same sink;
- browsers without File System Access support retain the existing Blob/object-URL fallback rather than losing download compatibility.

Deterministic behavior test:

- a pull-driven **128 x 64 KiB = 8 MiB** logical response is written in 128 ordered writes;
- maximum in-flight application writes is **1**;
- final byte progress is exactly **8 MiB**;
- no aggregate payload array exists in the direct-to-disk helper;
- cancellation, unsupported-browser fallback, close, and abort are covered separately.

This is structural memory-pressure evidence only. Browser/network internal buffering is outside xDrive's control, and no wall-clock or RSS speedup is claimed.

Regression budget: the File System Access branch must not reintroduce an application-level response chunk accumulator; it must preserve chunk progress and sequential backpressure.

### FileOperation batch ancestor coverage

Status: **Accepted / structural; wall-clock unmeasured**.

Workload and method:

- **120** selected sibling files;
- every file is under an **8-directory-deep** parent chain beneath the owner root;
- no selected item contains another selected item in the baseline case;
- the same helper also verifies the nested-selection case where a selected directory contains a selected file;
- SQL statements are counted with a GORM trace logger only around the ancestor/top-level helper call;
- sample count: not applicable to wall-clock because this is a deterministic SQL-round-trip contract;
- command: `go test ./internal/api -run '^TestBatchAncestorCoverageUsesConstantSQL$' -count=1`.

BEFORE:

- `batchSelectionHasAncestor` and `topLevelBatchDeleteRefs` walked upward independently for every selected item;
- each selected file required **10 SELECTs** on this fixture (file, 8 directories, root);
- **120 files x 10 levels = 1,200 SELECTs** per ancestor/top-level check before the FileOperation itself was queued.

AFTER / current:

- one recursive PostgreSQL CTE expands the parent chains for all selected IDs together;
- the grouped result reports whether each selected origin has another selected ancestor;
- each helper performs **1 SQL statement** on the same workload;
- selected-node ownership/active-state validation remains owner-scoped, and a selected ID absent from the active namespace still returns the existing `node_not_found` mutation failure;
- the nested-selection result and top-level delete filtering remain unchanged.

Structural delta: **1,200 -> 1 SQL statement (-99.9%)** per ancestor/top-level check on the deterministic fixture. No wall-clock speedup is claimed.

Decision: **accept** the set-based recursive CTE. It removes an items x depth SQL multiplier from FileExplorer Copy/Move/Delete enqueue without changing operation durability, cancellation, conflict, or transaction semantics.

Regression budget: ancestor/top-level coverage must remain constant-query for the selected batch; do not reintroduce renderer traversal or per-item parent SQL walks.

### FileOperation selection total-byte aggregation

Status: **Accepted / structural; wall-clock unmeasured**.

Workload and method:

- **120** selected sibling directories under one owner root;
- each selected directory contains exactly one file;
- Copy/Move already reject ancestor+descendant selections, and Delete reduces its selection to top-level roots before byte aggregation, so the roots passed into this calculation are non-overlapping;
- SQL statements are counted only around the aggregate byte helper; per-item owner/revision validation remains intentionally unchanged;
- sample count: not applicable to wall-clock because this is a deterministic SQL-round-trip contract;
- command: `go test ./internal/api -run '^TestFileOperationSelectionBytesUsesSingleRecursiveQuery$' -count=1`.

BEFORE:

- enqueue loaded and revision-validated each selected node;
- every selected directory then called `fileOperationNodeBytesTx` independently;
- the 120-directory fixture therefore issued **120 recursive size CTEs** before the durable FileOperation was queued.

AFTER / current:

- enqueue still owner/revision-validates every selected root exactly as before;
- the validated roots are passed together to one owner-scoped recursive CTE;
- the fixture issues **1 recursive selection-size CTE** and produces the same aggregate byte count;
- selected files with missing `xd_files` metadata still fail rather than being silently counted as zero;
- this does **not** claim total enqueue SQL is constant-query: per-item validation remains separate and is outside this optimization.

Structural delta: **120 -> 1 recursive size query (-99.2%)** on the deterministic fixture. No wall-clock speedup is claimed.

Decision: **accept** set-based total-byte aggregation for FileOperation enqueue. It removes the remaining selected-directories multiplier from Copy/Move/Delete task creation while leaving durable execution, progress, cancellation, retry, conflict, and revision semantics unchanged.

Regression budget: aggregate byte precomputation must not reintroduce one recursive size query per selected top-level directory.

### FileOperation delete subtree summary

Status: **Accepted / structural; wall-clock unmeasured**.

Problem and workload:

- FileOperation delete already receives non-overlapping top-level roots after enqueue validation;
- execution previously called `fileOperationNodeBytesTx` for a recursive byte sum and then `activeSubtreeIDsDB` for the exact same root;
- both helpers independently expanded the active subtree with a recursive CTE before the delete transaction could revoke shares, apply managed-source protection, and move nodes to Trash;
- the deterministic regression uses one selected directory containing **120 child directories + 120 files** (241 active nodes including the selected root).

BEFORE:

- **1 recursive CTE** for aggregate bytes;
- **1 recursive CTE** for active subtree IDs;
- total: **2 recursive subtree statements per delete root**.

AFTER / current:

- `activeSubtreeSummaryDB` expands the active subtree once;
- the same SQL statement returns ordered node IDs plus the aggregate file bytes;
- execution reuses those IDs for managed-source protection, share revocation, and Trash updates, and reuses the byte total for FileOperation progress;
- a directly selected file with missing `xd_files` metadata still fails instead of silently reporting zero bytes;
- owner/revision locking, Trash root assignment, undo metadata, cancellation and transaction boundaries are unchanged.

Structural delta: **2 -> 1 recursive subtree SQL statements (-50%) per delete root**. The transaction still performs its ordinary lock/update/audit/progress SQL, so this is not a claim that total delete SQL or wall-clock time is halved.

Regression command:

- `go test ./internal/api -run '^TestActiveSubtreeSummaryUsesSingleRecursiveQuery$' -count=1`.

Decision: **accept** the combined subtree summary. It removes a redundant full-tree traversal from a core FileExplorer delete path without changing delete semantics.

Regression budget: FileOperation delete must not separately call both recursive byte aggregation and recursive subtree-ID enumeration for the same selected root.

### FileOperation delete multi-root subtree aggregation

Status: **Accepted / structural; wall-clock unmeasured**.

Problem and workload:

- Delete enqueue already reduces the selection to non-overlapping top-level roots;
- execution still called the single-root subtree summary independently for every selected root;
- stable fixture: **120 selected sibling directories**, each containing **1 file**;
- evidence is deterministic SQL statement count around subtree-summary loading only; per-root mutation SQL is intentionally outside this optimization.

BEFORE:

- each delete root executes one recursive subtree CTE for IDs + bytes;
- the 120-root fixture therefore performs **120 recursive subtree SQL statements** before the worker can run per-root protection and Trash updates.

AFTER / current:

- `activeSubtreeSummariesDB` seeds all selected root IDs together and carries `root_id` through one recursive CTE;
- one grouped stats stage returns the byte total for each root while the same result set returns that root's ordered active node IDs;
- the 120-root fixture performs **1 recursive subtree SQL statement** and returns 120 independent summaries;
- `activeSubtreeSummaryDB` delegates to the grouped helper, so the existing single-root **2 -> 1** contract remains intact;
- the Delete worker still processes roots in original request order and keeps managed-source protection, share revocation, Trash root assignment, root revision validation, undo capture, cancellation checkpoints, and progress semantics unchanged.

Structural delta: **120 -> 1 recursive subtree CTE (-99.2%)** on the deterministic multi-root fixture. No wall-clock speedup is claimed.

Regression command:

- `go test ./internal/api -run '^TestActiveSubtreeSummaryUsesSingleRecursiveQuery$' -count=1`.

Decision: **accept** grouped multi-root subtree loading. It removes the remaining selected-root multiplier from Delete's recursive read phase without batching or weakening the mutation semantics.

Regression budget: one FileOperation Delete execution may use at most **1 grouped recursive subtree summary query** for its already top-level selected roots.

### FileOperation delete managed-target preload

Status: **Accepted / structural; wall-clock unmeasured**.

Problem and workload:

- Delete already has each selected root's active subtree IDs in memory;
- managed Yike target protection still called `yikeManagedTargetInIDsDB` once per root;
- each call probes whether the optional `xd_sources` table exists and then queries Sources for that root's subtree IDs;
- stable workload: **120 top-level delete roots**.

BEFORE:

- 120 optional-schema probes;
- 120 managed-target Source queries;
- total protection-read work: **240 SQL statements** before considering the normal per-root mutation statements.

AFTER / current:

- `loadYikeManagedTargetIDsDB` performs one optional-Sources schema probe;
- when Sources exists, one owner/kind query loads all non-null Yike `target_node_id` values into a set;
- each root checks its already-materialized subtree IDs against that set in memory;
- the 120-root protection-read workload performs **2 SQL statements** total;
- core-only schemas without `xd_sources` still return an empty protected set after the single schema probe;
- the Delete loop remains in original request order, so the first protected root still returns `managed_source_target` before that root's share/Trash/revision mutations;
- share revocation, Trash assignment, root revision validation, undo capture, cancellation checkpoints and progress are unchanged.

Structural delta: **240 -> 2 managed-target protection SQL statements (-99.2%)** for the 120-root workload. No wall-clock speedup is claimed.

Regression commands:

- `go test ./internal/api -run '^TestDelete(ManagedTargetProtectionLoadsOwnerTargetsOnce|ExecutorUsesSelectionWideManagedTargetLoad)$' -count=1`.

Decision: **accept** selection-wide managed-target preload for Delete. It removes the remaining root-count query multiplier from the protection read without batching delete mutations.

Regression budget: Delete managed-target protection may perform at most **one optional-schema probe + one owner target load per execution**, independent of selected-root count.

### FileOperation Move root-byte aggregation

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- **120 selected sibling directories**, each containing one file;
- FileOperation Move executes all 120 roots into another directory;
- evidence method: PostgreSQL SQL capture during real `processNextFileOperation()` plus final Move state assertions;
- no wall-clock benchmark is quoted.

BEFORE:

- each Move root was loaded with `batchLoadNodeTx(..., preload=true)`, preloading `xd_files` even though root file metadata is not needed to move a node;
- each selected directory later called `fileOperationNodeBytesTx` independently for progress accounting;
- on the 120-directory fixture, execution therefore issued **120 recursive root-byte CTEs**.

AFTER / current:

- Move root nodes use `batchLoadNodeTx(..., preload=false)`;
- logical bytes for all selected roots are computed lazily by one grouped recursive CTE and cached by root ID for the transaction;
- the 120-directory fixture changes execution-time root-byte recursion from **120 CTEs -> 1 grouped CTE**;
- selected file roots preserve the previous missing-`xd_files` failure behavior through an explicit `missing_file` result flag;
- normal Move, skip, keep-both, and replace/merge paths reuse the same root-byte value;
- Copy and Delete execution are intentionally unchanged.

Decision: **Accepted.** Move is metadata-only at the root level, so removing root File preloads and N recursive byte scans reduces DB work without changing content I/O, revision checks, conflict policies, undo behavior, or progress totals.

Regression budget: one Move operation may execute at most **one** grouped root-byte recursive CTE regardless of selected-root count, and root loading must not restore per-root File preloads.

Next action: continue the FileExplorer upload preflight batching audit; preserve ordered conflict/partial-success semantics while reducing request and DB-query count.


### FileOperation Move replace/merge File-preload contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- one Move replace/merge root directory;
- **120 matching source/target child directories** below that root;
- every source child directory contains **1 file** with valid `xd_files` metadata;
- evidence method: PostgreSQL SQL capture around the real `moveNodeReplaceOrMergeTx` traversal plus final merged-tree assertions;
- wall-clock timing is intentionally not quoted.

BEFORE:

- every successful destination-name conflict lookup used `Preload("File")`, although replace/merge only consumes target node identity/type/revision; for the merge root plus 120 matching child directories this produces **121 `xd_files` SELECTs**;
- every source-directory child enumeration in Move also used `Preload("File")`, although Move changes node metadata and does not consume child file metadata; the same root + 120 child directories produces another **121 `xd_files` SELECTs**;
- total unused File preload statements for the stable workload: **242**.

AFTER / current:

- destination conflict lookup is node-only;
- Move replace/merge source-child enumeration is node-only;
- the stable workload performs **0 `xd_files` SELECTs** during the Move merge traversal;
- conflict lookup, source child-list queries, target managed-source protection, per-node revision checks, move updates, merge cleanup and operation ordering are unchanged;
- Copy's recursive source-child preload remains intact because Copy hooks/content-reference creation consume source `File` metadata.

Decision: **Accepted.** This removes directory-count-scaled File metadata reads from Move replace/merge without changing the mutation side of the operation.

Regression budget: Move replace/merge must perform **0 `xd_files` SELECTs** for traversal metadata. Do not remove Copy source File loading unless a separate Copy contract proves that metadata is unnecessary.

Regression command:

- `go test ./internal/api -run '^TestFileOperationMoveMergeAvoidsFilePreloads$' -count=1`.

Next action: continue ordinary download / sync / delete audits and only change another deterministic SQL, request, allocation, filesystem, lock, or object-store multiplier.

### FileOperation Copy source-subtree loading

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- one copied source directory with **120 direct child directories**;
- each child directory contains **1 file**;
- active source subtree size: **241 nodes** including the copied root;
- evidence method: PostgreSQL SQL trace around the real `copyNodeTxWithHooks` execution plus copied-subtree assertions;
- no wall-clock benchmark is quoted.

BEFORE:

- the copied root calls `Find(children)` plus GORM `Preload("File")`;
- each of the 120 child directories repeats the same pair of source reads;
- source-tree enumeration therefore emits **121 node-list SELECTs + 121 file-preload SELECTs = 242 SELECT statements** before considering destination writes/content-reference bookkeeping.

AFTER / current:

- the first directory in a normal copy loads all active descendants with **1 owner-scoped recursive CTE**;
- the same statement LEFT JOINs current `xd_files` metadata needed by file-copy hooks and content-reference retain;
- recursive creation consumes an in-memory `parent_id -> children` map in the same `type ASC, name ASC` sibling order;
- healthy file descendants no longer issue fallback metadata SELECTs;
- destination node/file INSERTs, CAS retain/advisory locking, hooks/progress, undo capture, revision behavior and transaction boundaries are unchanged;
- replace/merge conflict traversal remains dynamic per directory because it must observe target-side state at each level.

Decision: **Accepted.** This removes directory-count-scaled source reads from ordinary recursive Copy without batching or reordering the mutation/data-integrity side of the operation.

Regression budget: one ordinary copied directory root may issue at most **1 source-subtree recursive CTE**, regardless of descendant directory count. Do not reintroduce per-directory `Preload("File")` source enumeration.

Regression command:

- `go test ./internal/api -run '^TestFileOperationCopyLoadsSourceSubtreeOnce$' -count=1`.

Next action: continue the basic sync/delete performance audit; only change paths with another deterministic request, SQL, allocation, or I/O multiplier.

### FileOperation Copy replace/merge source-snapshot contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- one Copy operation using the replace policy;
- source root directory with **120 direct child directories**, each containing **1 file** with valid File metadata;
- destination already contains the matching root directory and all **120 matching child directories**, so Copy follows the recursive merge path;
- evidence method: PostgreSQL SQL capture around the real `copyNodeReplaceOrMergeTx` traversal plus copied-file assertions;
- wall-clock timing is intentionally not quoted.

BEFORE:

- every source directory in the merge path independently loaded active children with one node-list query plus one `Preload("File")` query;
- the merge root plus 120 matching child directories therefore emitted **121 node-list SELECTs + 121 File preload SELECTs = 242 source-enumeration SELECTs**;
- target-side exact-name conflict checks were dynamic per level and remain necessary because the destination tree is mutated during merge.

AFTER / current:

- the first source-directory enumeration lazily loads the complete source subtree with the already accepted `loadFileOperationCopySubtree` recursive CTE and File metadata join;
- recursive merge levels reuse the resulting `parent_id -> children` map;
- when a destination conflict disappears or a non-directory target is replaced, `copyNodeTxWithHooksLoaded` consumes the same source snapshot instead of issuing another source-tree load;
- the stable workload changes recursive source enumeration from **242 SELECTs -> 1 recursive source-subtree CTE**;
- destination conflict lookup, managed-source protection, target replacement/trash, copy hooks/progress, content-reference retain, destination inserts and recursion order remain unchanged;
- the source snapshot is loaded lazily only after the same target conflict/protection/hook gates that previously preceded source child enumeration.

Decision: **Accepted.** Source traversal is read-only and already has a one-CTE representation used by ordinary Copy; reusing it in replace/merge removes directory-count-scaled source reads without precomputing the mutable target side.

Regression budget: one Copy replace/merge root may issue at most **1 source-subtree recursive CTE**, regardless of descendant directory count. Target conflict/protection queries must remain live and must not be replaced by a stale target snapshot.

Regression command:

- `go test ./internal/api -run '^TestFileOperationCopyMergeLoadsSourceSubtreeOnce$' -count=1`.

Next action: continue ordinary download / sync / delete audits and only change another deterministic SQL, request, allocation, filesystem, lock, or object-store multiplier.

### FileOperation subtree predicate materialization

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- one selected source directory containing **1,200 active child directories** (**1,201 active nodes including the source root**);
- Copy/Move target-descendant validation tests one direct descendant and one directory outside the source subtree;
- managed-source protection binds one Yike Source target to the last descendant;
- evidence method: SQL-shape regression plus deterministic behavior coverage; no timing comparison is quoted;
- regression command: `go test ./internal/api -run '^TestFileOperationSubtreePredicatesAvoidIDMaterialization$' -count=1`.

BEFORE:

- `batchTargetInsideNode` expanded the entire active source subtree with `activeSubtreeIDsDB`, returned all **1,201 IDs** through the PostgreSQL driver into a Go slice, then linearly searched for one target ID;
- `yikeManagedTargetInSubtreeDB` performed the same **1,201-ID** materialization and then issued a second Source query with those IDs as an `IN (...)` list;
- work scaled with source-subtree size even when the target directory was only one level below the source or completely outside it.

AFTER / current:

- target-descendant validation starts from the already validated target directory, recursively walks only its active ancestor chain, and returns one scalar PostgreSQL `EXISTS` value;
- on the 1,201-node fixture the DB/Go result shape changes from **1,201 node IDs -> 1 boolean**;
- managed-source protection performs one recursive subtree CTE joined directly to `xd_sources` and returns one scalar `EXISTS`; there is no intermediate Go ID slice and no subtree-sized `IN` parameter list;
- the optional-Sources-table behavior remains unchanged: core-only schemas still return “not protected” without requiring Source tables;
- Delete intentionally keeps its subtree ID summary because those IDs are consumed by share-revocation and Trash updates.

Decision: **Accepted.** This removes avoidable subtree-sized DB/Go materialization from Copy/Move validation without changing mutation, revision, conflict, Source-protection, or cancellation semantics.

Regression budget: Copy/Move target-descendant checks must not return the full source subtree to Go; managed-source subtree checks must not construct a Go subtree-ID slice or subtree-sized SQL `IN` list.

Next action: selection-wide target-descendant validation is covered by the dedicated contract below; continue managed-target/progress mutation audits separately.

### FileOperation target-descendant selection batching

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- one durable Copy/Move operation with **120 selected sibling source directories**;
- all selected sources share one target directory outside their subtrees;
- deterministic SQL capture compares the legacy per-root `batchTargetInsideNode` loop with the selection-wide helper;
- positive behavior also places the target under selected root #74 and verifies only that root is matched.

BEFORE:

- every selected directory independently executes the same recursive CTE starting from the same target directory;
- each CTE walks the target's active ancestor chain and tests one source ID;
- **120 selected directories -> 120 recursive target-ancestor CTEs**.

AFTER / current:

- Copy/Move compute the target ancestor chain once after selected-root validation;
- one query returns only selected directory IDs that occur in that ancestor chain;
- **120 selected directories -> 1 recursive target-ancestor CTE**;
- files are excluded from the candidate set;
- the existing per-item Copy/Move loops still raise `invalid_target` at the original request index, so user-visible error ordering is unchanged;
- Move keeps its explicit `node.ID == parentID` self-target error before the descendant membership check;
- recursive Copy/Move work, managed-source protection, conflict handling, progress, undo, revision and cancellation behavior are unchanged.

Decision: **Accepted.** The target directory is common to the whole operation, so rebuilding its ancestor chain once per selected source adds no correctness value.

Regression budget: durable Copy/Move may execute at most **1 recursive target-ancestor CTE** per non-empty operation regardless of selected directory count up to the existing 200-item limit. Production execution must not call `batchTargetInsideNode` per selected root.

Regression commands:

- `go test ./internal/api -run '^TestFileOperation(SubtreePredicatesAvoidIDMaterialization|ExecutionBatchesTargetDescendantChecks)$' -count=1`.

Next action: continue ordinary sync/delete/download performance; keep managed-target batching and progress-write coalescing as separate changes because they have different correctness/cancellation constraints.

### Desktop warm-thumbnail transport and Agent cache

Status: **Accepted / measured**.

This benchmark isolates the Server -> Go client transport that xdrive-agent uses for Desktop thumbnails; it does not measure Electron IPC, Blob creation, React commit/layout/paint, or browser decode.

Stable workload:

- unique thumbnails: **200**
- thumbnail payload: **64 KiB** each
- sequential passes: **3**
- total logical thumbnail views: **600**
- this deliberately exceeds the renderer's **96-entry** FileExplorer thumbnail LRU so a sequential revisit cannot remain entirely renderer-resident
- Server responses include a stable ETag and `Cache-Control: private, max-age=3600`

Command:

`XD_FILEEXPLORER_THUMBNAIL_TRANSPORT_PERF=1 go test -run '^TestFileExplorerDesktopThumbnailWarmTransportBaseline$' -count=1 -v ./internal/client`


Measured evidence:

- BEFORE baseline, branch-scoped GitHub CI:
  - upstream/full GET requests: **600**
  - conditional `If-None-Match` requests: **0**
  - response payload: **39,321,600 bytes (37.5 MiB)**
  - diagnostic wall time: **162.373 ms** in the original baseline run; a later paired CI run measured **82.651 ms**
- AFTER Agent-cache run from PR #720 authoritative CI:
  - upstream requests: **200**
  - upstream payload: **13,107,200 bytes (12.5 MiB)**
  - unique thumbnails: **200**
  - passes: **3**
  - thumbnail payload: **64 KiB**
  - diagnostic cache-layer wall time: **0.158 ms**
- structural delta:
  - upstream requests: **600 -> 200**, **-66.7% / 3x fewer**
  - upstream payload: **39,321,600 -> 13,107,200 bytes**, **-66.7%**
  - bytes avoided on the stable workload: **26,214,400 bytes (25 MiB)**

The wall-time values are **not comparable** and remain diagnostic only: the baseline measures the Go client/httptest transport path while the AFTER cache benchmark measures the in-process Agent cache layer. No wall-clock speedup or regression budget is claimed from those values.

Decision: **accept the bounded Desktop Agent thumbnail cache**. The deterministic request/byte counters materially improve on the exact baseline while the implementation keeps resident entries/bytes bounded, singleflights concurrent misses, and revalidates expired entries with ETag.

Next action: use this accepted warm-cache transport as an input to the planned **100k image cold/warm media-directory traces**, where renderer CPU, long tasks/FPS, RSS, Blob URL memory, request counts, and Web-vs-Desktop transport can be measured end to end.



## Current video-poster capability

FileExplorer now has a real persistent video-poster contract rather than an icon-only fallback:

- `xDriveFileSupportsThumbnail()` admits supported image and video file kinds into the same viewport-aware thumbnail scheduler.
- A video tile first requests the ordinary authenticated media-thumbnail endpoint. A warm 512px poster is served from `.xdrive-media/posters/` with a deterministic SHA/revision/version identity.
- On a poster-cache miss, Web/Desktop reuse the existing authenticated video preview stream, decode one displayable frame in the renderer, render a bounded 512px JPEG, display it immediately, and best-effort backfill the Server.
- Backfill requires `If-Match`, revalidates the current file revision/SHA/storage key, accepts only bounded JPEG data, and remains regenerable cache data.
- Server deployment stays distroless; no ffmpeg/ffprobe runtime or second Server-side decoder is introduced.
- Unsupported or browser-undecodable videos fall back to the normal shared video icon.
- Gallery and FileExplorer share the same capture/rotation helper so poster geometry cannot drift between the two surfaces.

The cold path is therefore intentionally client-assisted, while the warm path is a normal persistent Server-cache thumbnail read. Synthetic renderer traces measure scheduler/DOM/Blob behavior only; real codec decode plus Server backfill still requires a separate end-to-end dataset measurement.

## 100k media-directory benchmark matrix

### Synthetic renderer trace harness

A dedicated opt-in CI job on `perf/file-explorer-media-*` branches drives the actual Web and Desktop Chromium renderers with a deterministic **100,000-item sparse namespace**. It executes the same script on both surfaces: initial Grid mount, continuous scroll, midpoint jump, end jump, return to top, and a native Chromium mouse-driven marquee selection across the Grid viewport.

The harness records time-to-first-grid, scripted trace duration, Long Task count/duration, maximum mounted FileExplorer item nodes, maximum retained sparse metadata, thumbnail request count and peak in-flight requests, marquee duration/selection commits/selected-item peak, JS heap when Chromium exposes it, Electron renderer working-set memory, and a Chrome trace artifact.

Structural CI guards are intentionally strict while timing remains diagnostic: mounted items must stay **< 1,000**, retained sparse metadata must stay **<= 1,200**, thumbnail in-flight work must stay **<= 6**, every image/video-poster scenario must exercise thumbnail admission, and both warm synthetic scenarios must stay at **<= 600 thumbnail requests**.

Thumbnail admission is scroll-settled: every FileExplorer scroll records activity on the real scroll host, and newly visible/near-visible thumbnail tiles wait until **80 ms after the latest scroll event** before entering the thumbnail queue. Initial/static viewport thumbnails remain immediate; continuous scrolling keeps pushing admission back, and unmounted tiles cancel their pending admission timer before any loader/Blob work begins.

This is a **synthetic renderer/thumbnail-scheduler workload**, not a replacement for the real Server/object-store matrix below. It does not claim cold thumbnail generation latency, object-store throughput, HTTP/Agent transport throughput, or real codec decode cost. Those remain pending on a real 100k dataset.

#### First successful CI renderer trace sample

The following #728/#731/#734 tables are retained as the **historical pre-video-poster baseline**. They intentionally show the old `video icons` behavior and its zero-request contract; those rows are evidence for the previous implementation, not the current production contract.

The first complete hosted-runner trace after enabling a visible Chromium window under Xvfb produced the following six scenarios. Timing and RSS values are **diagnostic single-run samples**, not stable regression gates yet.

| Surface | Scenario | First grid | Script duration | Long tasks | Long-task time | Thumbnail requests | Peak in-flight | Max mounted | Peak retained | Renderer RSS |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Desktop | image cold | 1919.9 ms | 4105.9 ms | 1 | 69 ms | 364 | 6 | 110 | 1200 | 272,732 KiB |
| Desktop | image warm | 216.2 ms | 3100.8 ms | 1 | 75 ms | 1430 | 1 | 110 | 1200 | 278,108 KiB |
| Desktop | video icons | 214.0 ms | 2165.7 ms | 1 | 70 ms | 0 | 0 | 110 | 1200 | 259,180 KiB |
| Web | image cold | 217.9 ms | 2610.0 ms | 1 | 74 ms | 354 | 6 | 110 | 1200 | 288,876 KiB |
| Web | image warm | 290.1 ms | 8774.4 ms | 5 | 302 ms | 1400 | 1 | 110 | 1200 | 540,680 KiB |
| Web | video icons | 200.6 ms | 2151.8 ms | 1 | 71 ms | 0 | 0 | 110 | 1200 | 260,540 KiB |

Structural observations from this run:

- The 100,000-item logical directory remained bounded to **80 items on the initial mount** and **110 items maximum mounted**.
- Sparse retained metadata peaked at the configured **1200-item** budget.
- Cold image loading saturated but did not exceed the **6-request** thumbnail concurrency budget.
- Ordinary video tiles issued **0 thumbnail requests**, confirming image-thumbnail suppression.
- Warm image runs issue many more completed thumbnail loads than cold runs because zero-latency synthetic thumbnails finish before fast scrolling can cancel queued work. This is expected scheduler behavior, but it makes the warm renderer path the next trace target.
- The **Web image-warm** sample is the clear outlier in this first run: **8.77 s script duration**, **5 long tasks / 302 ms**, and **~528 MiB RSS** versus Desktop warm **3.10 s / 1 long task / ~272 MiB RSS**. Because this is one hosted-runner sample, do not treat the ratio as a stable regression result yet; repeat it before changing production behavior solely from timing.

#### Scroll-settle follow-up trace

The first authoritative trace from PR #731 applies the **80 ms scroll-settle admission gate** while keeping thumbnail transport concurrency at 6 and the FileExplorer cache at 96 entries.

| Surface | Scenario | First grid | Script duration | Long tasks | Long-task time | Thumbnail requests | Peak in-flight | Max mounted | Peak retained | Renderer RSS |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Desktop | image cold | 229.6 ms | 2480.3 ms | 1 | 71 ms | 106 | 6 | 110 | 1200 | 277,788 KiB |
| Desktop | image warm | 250.7 ms | 2591.6 ms | 2 | 135 ms | 184 | 1 | 110 | 1200 | 278,172 KiB |
| Desktop | video icons | 235.3 ms | 2519.7 ms | 1 | 91 ms | 0 | 0 | 110 | 1200 | 260,656 KiB |
| Web | image cold | 237.3 ms | 2503.9 ms | 2 | 128 ms | 102 | 6 | 110 | 1200 | 284,824 KiB |
| Web | image warm | 282.2 ms | 2542.4 ms | 1 | 77 ms | 184 | 1 | 110 | 1200 | 292,820 KiB |
| Web | video icons | 234.5 ms | 2302.2 ms | 1 | 77 ms | 0 | 0 | 110 | 1200 | 254,552 KiB |

Compared with the immediately preceding #728 renderer trace using the same harness:

- Desktop warm thumbnail loads fell **1430 -> 184 (-87.1%)**.
- Web warm thumbnail loads fell **1430 -> 184 (-87.1%)**.
- Web warm scripted duration fell **8.71 s -> 2.54 s (-70.8%)**.
- Web warm Long Task time fell **539 ms / 9 tasks -> 77 ms / 1 task**.
- Web warm renderer RSS fell **535,324 KiB -> 292,820 KiB (-45.3%)**.
- Cold image loads also fell materially without a scripted-duration regression: Desktop **366 -> 106**, Web **361 -> 102**.
- Video icon fallback remained at **0 thumbnail requests** on both surfaces.
- DOM and sparse-metadata bounds remained unchanged at **110 mounted items** and **1200 retained items**.

Decision: **accept scroll-settled thumbnail admission**. The first trace isolates request/Blob churn as the dominant cause of the prior warm Web outlier. Keep the existing **6-request concurrency** and **96-entry cache** unchanged; use the warm **<= 600 request** guard as a conservative structural regression budget. Continue treating timing and RSS as diagnostic until repeated hosted-runner samples establish variance.


#### Second scroll-settle sample (#731 final CI)

The final authoritative CI run for PR #731 repeated the same six scenarios after the amend, with no production-setting changes between samples.

| Surface | Scenario | First grid | Script duration | Long tasks | Long-task time | Thumbnail requests | Peak in-flight | Max mounted | Peak retained | Renderer RSS |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Desktop | image cold | 217.8 ms | 2400.4 ms | 1 | 72 ms | 102 | 6 | 110 | 1200 | 277,248 KiB |
| Desktop | image warm | 249.2 ms | 2419.0 ms | 2 | 138 ms | 184 | 1 | 110 | 1200 | 278,132 KiB |
| Desktop | video icons | 218.7 ms | 2237.0 ms | 1 | 77 ms | 0 | 0 | 110 | 1200 | 257,812 KiB |
| Web | image cold | 239.5 ms | 2472.2 ms | 2 | 134 ms | 102 | 6 | 110 | 1200 | 284,164 KiB |
| Web | image warm | 334.1 ms | 2798.1 ms | 3 | 229 ms | 184 | 1 | 110 | 1200 | 298,372 KiB |
| Web | video icons | 224.4 ms | 2392.4 ms | 1 | 79 ms | 0 | 0 | 110 | 1200 | 256,448 KiB |

Across the two post-settle samples, the structural signals are stable:

- warm thumbnail admission is exactly **184 requests** for both Desktop and Web in both runs;
- Web cold is exactly **102 requests** in both runs; Desktop cold is **106 -> 102**;
- video icon fallback remains exactly **0 thumbnail requests** on both surfaces;
- peak thumbnail concurrency remains **6** for cold images and **1** for the zero-latency warm fixture;
- mounted DOM and sparse metadata remain exactly **110** and **1200** at their peaks.

Hosted-runner timing still varies enough to remain diagnostic. The second Web warm run moved from **2.54 s -> 2.80 s (+10.1%)**, while renderer RSS moved only **292,820 -> 298,372 KiB (+1.9%)** and admission stayed fixed at **184**. Long-task observations also moved from **1 / 77 ms** to **3 / 229 ms** without any structural request growth.

Decision after the second sample: keep the current **80 ms scroll-settle**, **6-request concurrency**, **96-entry cache**, and **<=600 warm-request** structural guard unchanged. Do not add another production thumbnail optimization from synthetic timing alone. The next evidence must come from the real Server/object-store 100k image cold/warm and video icon-fallback matrix.

#### Real Server/object-store 100k sample (#734)

PR #734 adds a real production-path Server benchmark instead of another synthetic thumbnail transport. The fixture uses a real PostgreSQL **100,000-file** namespace per media case, the production Gin handlers, the production media-derivative scheduler, and `storage.Local`. The image namespace maps onto **128 physical 800x600 JPEG CAS objects** so the logical directory remains 100k while the measured top/middle/end sample contains **102 distinct source objects**. Cold and warm runs use the exact same 102 node IDs.

| Scenario | First range median | Middle range median | End range median | 102-thumbnail batch | p50 thumbnail | p95 thumbnail | Response bytes | Object-store behavior |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Image cold | 234.558 ms | 222.277 ms | 235.727 ms | 1248.984 ms | 70.311 ms | 102.139 ms | 2,610,039 | 102 original opens, 204 derived opens, 102 derived puts |
| Image warm | 234.558 ms | 222.277 ms | 235.727 ms | 70.345 ms | 3.722 ms | 6.227 ms | 2,610,039 | **0 original opens**, 102 derived opens, **0 derived puts** |
| Video icons | 219.400 ms | 197.063 ms | 206.675 ms | n/a | n/a | n/a | n/a | **0 thumbnail requests, 0 object-store opens, 0 derived puts** |

Structural conclusions:

- cold generation proves the sampled 102 requests are not accidentally deduplicated into a warm workload: there are exactly **102 distinct originals**, **102 original object opens**, and **102 derived writes**;
- warm serving proves the derivative cache is actually hit: source-object opens fall **102 -> 0** and derivative writes fall **102 -> 0**, while response bytes stay identical;
- diagnostic batch time falls **1248.984 -> 70.345 ms (17.8x)**; p50 falls **70.311 -> 3.722 ms (18.9x)** and p95 falls **102.139 -> 6.227 ms (16.4x)**;
- the current ordinary-video icon path performs no speculative media fetch at all: **0 thumbnail requests and 0 object-store I/O**;
- the cold path's two successful derived opens per newly generated thumbnail are visible in the counter (**204 opens for 102 thumbnails**), but current local-object-store timing does not justify changing production behavior from that count alone.

A second authoritative CI sample reproduced the structural result exactly: cold remained **102 original opens / 102 derivative writes**, warm remained **0 / 0** with **102 derivative reads**, and video fallback remained **0 thumbnail requests / 0 object-store opens**. The repeated range medians stayed in the same band: image **212.699-236.452 ms** and video **199.079-219.704 ms**.

Historical #734 decision: keep thumbnail concurrency, the 96-entry FileExplorer cache, and scroll-settle timing unchanged. The old video icon fallback conclusion is superseded by the persistent video-poster contract; the image-cache measurements remain valid historical evidence. Hosted-runner timing remains diagnostic.

#### Marquee-selection Chromium trace (#734)

The same Web/Desktop 100k renderer harness now performs a native Chromium mouse-driven marquee after the scroll/jump sequence. Electron sends a real mouse-down, 12 paced mouse moves, and mouse-up; FileExplorer handles them through the production pointer/rAF/virtual-geometry selection path.

| Surface | Scenario | Marquee duration | Selection commits | Final / peak selected | Long tasks | Long-task time | Thumbnail requests | Max mounted | Peak retained |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Desktop | image cold | 398.7 ms | 12 | 18 / 18 | 1 | 54 ms | 101 | 110 | 1200 |
| Desktop | image warm | 416.1 ms | 12 | 18 / 18 | 1 | 56 ms | 184 | 110 | 1200 |
| Desktop | video icons | 349.7 ms | 11 | 18 / 18 | 1 | 51 ms | 0 | 110 | 1200 |
| Web | image cold | 300.2 ms | 12 | 18 / 18 | 1 | 75 ms | 94 | 110 | 1200 |
| Web | image warm | 373.5 ms | 12 | 18 / 18 | 1 | 60 ms | 184 | 110 | 1200 |
| Web | video icons | 332.8 ms | 12 | 18 / 18 | 1 | 57 ms | 0 | 110 | 1200 |

The marquee duration is **not** a CPU-only latency metric: the driver intentionally includes 12 x 16 ms mouse pacing, a 50 ms input settle, polling, and post-input animation frames. The structural signal is what matters: all six runs completed a non-empty selection, selection work stayed frame-coalesced, DOM/metadata bounds did not grow, and marquee interaction did not create a new thumbnail-request class.

**Production decision after #734:** stop optimizing FileExplorer thumbnail/marquee behavior here. The backend cache path, renderer admission, sparse metadata, DOM bounds, and marquee interaction are healthy enough that another thumbnail or selection change would be speculative. The only repeatable cost now worth a separate investigation is the **100k file-heavy sparse range query (~200-236 ms per range)**. Because first/middle/end are all similar and the current range SQL uses `COUNT(*) OVER()`, the next performance PR should first A/B a **count-once / count-free subsequent-range** contract on the exact same fixture; only change production SQL/API if that paired measurement shows a material win without weakening count correctness.


The following four workloads are mandatory before claiming FileExplorer is validated for 100k media-heavy directories. “No thumbnails” means a **cold thumbnail cache at benchmark start**; “with thumbnails” means the same dataset with thumbnails already materialized/warm. The logical directory remains 100,000 items in all four cases.

| Scenario | Thumbnail state | Status | What must be measured |
| --- | --- | --- | --- |
| 100k images | Cold / no pre-existing thumbnails | **Server/object-store measured; Chromium renderer + marquee measured** | Backend generation/cache and renderer interaction are measured separately; a combined browser-to-real-Server trace is optional future evidence, not a blocker for the current decision. |
| 100k images | Warm / thumbnails pre-existing | **Server/object-store measured; Chromium renderer + marquee measured** | Warm derivative hits and renderer Blob/commit behavior are covered at their respective layers. |
| 100k videos | Cold / poster cache missing | **Capability implemented; end-to-end measurement pending** | Measure preview-stream bytes, renderer decode/canvas cost, 512px JPEG backfill, request cancellation, Server PUT validation, and subsequent cache visibility. |
| 100k videos | Warm / poster thumbnails pre-existing | **Capability implemented; synthetic renderer trace enabled; real cache measurement pending** | Measure persistent Server poster reads plus Web HTTP/Blob vs Desktop Agent/ArrayBuffer transport; request work must remain viewport-bounded. |

### Current assessment of the four 100k media cases

- **100k images, cold/no thumbnails:** sparse metadata and DOM work are already bounded; expected dominant costs are thumbnail generation, object-store I/O, HTTP/Agent transport, image decode, and Blob creation. Client thumbnail work must stay capped at **6 concurrent requests**, and request count must scale with viewport exposure rather than 100k logical items.
- **100k images, warm thumbnails:** generation cost is removed, isolating cached-object reads, transport, Blob URL creation, renderer commit/layout/paint, and the bounded **96-entry** FileExplorer thumbnail cache. This is the cleanest Web-vs-Desktop transport comparison.
- **100k videos, cold poster cache:** supported videos enter the same bounded thumbnail scheduler. The missing-cache GET is followed by one renderer decode/capture and a revision-fenced Server backfill; the benchmark must separate preview transport, codec/canvas time, PUT time, and the immediate local poster display.
- **100k videos, warm poster cache:** no preview decode/backfill should be needed. Measure persistent poster reads, Blob/ArrayBuffer transport, renderer commit/layout/paint, and the bounded **96-entry** FileExplorer thumbnail cache.

### Media benchmark execution rules

- Use the same 100,000-node namespace shape, sort order, viewport, Grid size, scroll/jump script, and client build for all four runs.
- Record **cold** and **warm** states separately. Never compare a cold image/video run against a warm run and call the difference a renderer optimization.
- Keep FileExplorer structural budgets visible in the result: thumbnail requests must remain **O(viewport/scroll exposure), not O(100k)**; in-flight thumbnail work must remain at or below **6**; the per-Explorer thumbnail cache must remain bounded at **96**; sparse logical metadata must remain bounded rather than retaining 100,000 rows.
- Run both **Web** and **Desktop** for warm-thumbnail transport because Desktop uses Agent IPC/ArrayBuffer while Web uses HTTP/Blob transport.
- For video runs, keep cold and warm poster states distinct. The synthetic `video-poster-cold` / `video-poster-warm` traces validate renderer admission only; a real cold run must additionally measure preview-stream decode/capture and revision-fenced backfill, while a real warm run must prove no preview decode or poster PUT occurs.
- The pure Node VirtualCollection baseline above is a prerequisite reference, not a substitute for these browser/Electron traces.
- Do not claim the image cases are fully end-to-end validated until the real Server/object-store fixture is connected to the Web/Desktop renderer transport. The current Server/object-store sample and synthetic Chromium trace measure complementary layers rather than one combined pipeline.

### 100k video poster: production Server HTTP/cache and Chromium decode (2026-10-09)

Status: **Measured baseline / no production optimization**, source commit `e329e683b51564cbf12187b04f539447fe55cca4`, [CI run 37876509402](https://github.com/lazyxu/xdrive/actions/runs/37876509402) and [performance job 113646340328](https://github.com/lazyxu/xdrive/actions/runs/37876509402/job/113646340328). Current implementation remains unchanged.

- Named workload `file-explorer-video-poster-server-100k`: one real PostgreSQL namespace with exactly **100,000 .mp4 nodes**, matching 100k `xd_files` and preindexed `xd_media_metadata` rows. Sample **102 distinct nodes** at offsets 0, 50k, and 99,746, exactly 34 per viewport. A real Gin HTTP server and `storage.Local` serve the production authentication, revision checks, poster cache PUT and warm GET paths.
- Three sequential paired cache cycles. Each cycle: **102 cold GET misses (expected 404)**, **102 valid 320×240 JPEG PUTs (expected 204, revision 1)**, **102 warm cached JPEG GETs (expected 200, full body equality, image/jpeg and ETag)**. All phases use **at most six in-flight requests**. Physical poster keys are deleted between cycles. Record phase batch wall-clock, individual p50/p95, byte counts, exact statuses, HTTP/store boundaries.
- The video originals in this **Server cache** fixture are intentionally fake, while media metadata is already indexed: it does **not** measure preview-ticket/Range bytes, MPEG/H.264 decoding or canvas capture. A separate **real Chromium MP4-to-JPEG poster** microbenchmark uses the existing seven-sample `desktop/scripts/gallery-video-poster-performance-main.cjs` with an embedded valid H.264 MP4. This isolates video decode/canvas from the HTTP cache contract, and may not be added to Server timing as though it were a single end-to-end run.
- Predeclared correctness acceptance: all 100k video metadata rows exist; all three sampled batches cover the same 102 IDs; 102/102 expected HTTP codes on each of nine phases, valid JPEG byte-for-byte warm equality, maximum **6** concurrent HTTP operations, no duplicate poster/response bytes. Performance times are diagnostic until a repeatable budget breach appears. The before/current code is unmodified; AFTER is **N/A**.
- Commands: `XD_FILEEXPLORER_VIDEO_POSTER_PERF=1 XD_TEST_DATABASE_URL=... go test -run '^TestFileExplorerVideoPosterCachePerformance100K$' -count=1 -v ./internal/api` and, on a Linux Xvfb Chromium host, `xvfb-run -a desktop/node_modules/.bin/electron --no-sandbox desktop/scripts/gallery-video-poster-performance-main.cjs` (working directory `desktop`). CI job `file-explorer-video-poster-server-performance` is branch-scoped.
- **BEFORE/current:** the authoritative run completed all three 102-item phases × three cycles, plus seven Chromium samples. **AFTER:** N/A — no product performance optimization was attempted.
- Full machine-readable raw measurements, original unrounded values, and source attribution: [ci-run-37876509402.json](performance-evidence/file-explorer-video-poster-100k/ci-run-37876509402.json). GitHub runs both layers; GitLab CI parity runs the Go Server benchmark only. No cross-host comparison is implied.

| Cache phase (102 requests, 6 workers) | Batch duration samples (ms) | Median batch (ms) | Per-request p50 median (ms) | Per-request p95 median (ms) | Response bytes / batch |
| --- | --- | ---: | ---: | ---: | ---: |
| cold-miss | 93.841 / 52.897 / 62.670 | **62.670** | 3.275 | 6.691 | 3,876 |
| poster-put | 102.922 / 102.501 / 110.996 | **102.922** | 5.907 | 8.449 | 0 |
| warm-hit | 62.328 / 62.194 / 59.557 | **62.194** | 3.192 | 5.925 | 929,118 |

- All nine phases passed their expected HTTP status, ETag/JPEG equality where applicable, exactly 102 requests and peak concurrency **6**. The **9,109-byte JPEG** was served **929,118 bytes** per warm batch.
- Native Chromium H.264 source was **2958 bytes** (micro-fixture), seven samples; first cold process **329.200 ms**, steady-cold median **3.600 ms**, warm median **3.400 ms**, median output JPEG **2338 bytes**. These values are *not* a realistic 4K/HEVC/large-file codec throughput test.
- **Decision: keep existing implementation.** This measurement is an isolated healthy Server cache/Chromium codec baseline, and does not reveal a repeatable breached latency/memory threshold. Do not optimize production from these synthetic fixture timings. The next run must use real preview stream bytes and real Web/Desktop transport if it makes end-to-end claims.
- Next: if these bounded paths pass, design a browser-to-real-Server end-to-end cold preview-stream/decode/backfill trace with real MP4 files and authenticated signed tickets, then resume 100k sync/delete batch and large-file transfer real disk/network measurements. Do not call a Server-only cache or isolated codec measurement end to end.

### 100k FileExplorer Grid/Details image, video and Live Photo renderer qualification (2026-10-09)

Status: **Measured baseline / no production optimization**. First run [CI 37874175164](https://github.com/lazyxu/xdrive/actions/runs/37874175164) on source `0622ae5dc6b1ce92c3e20e0f37be5ce40b4627ea`. This extends the earlier Grid-only 100k synthetic image/video traces without altering production FileExplorer/Thumbnail controllers.

- Logical directory size **100,000** for every run, 200-item pages and 2 retained pages either side of the viewport. Run the actual shared FileExplorer on **Web and Desktop**, in **Grid and Details**, with **image/video/LIVP**, each cold/warm: **24 named traces** per CI run.
- Every trace drives 36 consecutive scroll positions and jumps to 50% / 100% / 0%, observes long tasks, mounted DOM rows, sparse retained metadata, renderer working set, thumbnail requests/in-flight work and viewport geometry. Grid additionally uses real Chromium mouse-driven marquee. Details deliberately excludes marquee because its sticky header and row selection differ from Grid; zero marquee events in Details is not a performance failure.
- The `live-*` entries are real `.livp` file names classified by the production FileExplorer thumbnail/glyph UI; the trace asserts at least one displayed **实况照片** glyph after its thumbnail appears. Existing image/video poster scenarios continue to use SVG Blob thumbnails with synthetic 12 ms cold delay. Thus these results measure **real Chromium renderer + shared scheduler/virtual surface**, **not real Live Photo ZIP unpacking, codec decode, network/Agent IPC, Server poster GET/PUT, PostgreSQL or object-store I/O**.
- Predeclared structural acceptance: exactly 100k logical items and the named view/media combination; peak retained metadata **≤1200**, thumbnail in-flight **≤6**, mounted items **<1000**, at least one thumbnail request, warm thumbnail requests **≤600**, one glyph for `.livp`, and nonempty marquee in Grid. Time-to-first-grid/Details and script duration are diagnostic only unless a stable, comparable baseline identifies a repeatable breach. Prior healthy Grid image/video traces are the historical reference; new Details/LIVP have **no prior BEFORE timing**.
- Benchmark: `VITE_XDRIVE_FILE_EXPLORER_PERF=1` build both renderers, then `xvfb-run ... desktop/scripts/file-explorer-media-trace-main.cjs <web|desktop> <image-cold|image-warm|video-poster-cold|video-poster-warm|live-cold|live-warm> <grid|details>`; CI job `file-explorer-media-renderer-trace`, scoped to the performance branch. Samples per new combination: one initially; any suspected performance bottleneck requires at least three paired runs before optimization.
- Current decision: **Accept the measured structural baseline; no production optimization**. All **24/24** combinations met their frozen structural budgets. There is no comparable BEFORE/AFTER production change. Host/CI timing and final renderer working-set snapshots are diagnostic, not a performance speedup claim.
- Complete machine-readable raw metrics (all 24 rows, exact unrounded values): [ci-run-37874175164.json](performance-evidence/file-explorer-100k-grid-details/ci-run-37874175164.json). CI job [113638803698](https://github.com/lazyxu/xdrive/actions/runs/37874175164/job/113638803698).

| Surface | View | Media/state | First viewport (ms) | Script (ms) | Max DOM | Peak metadata | Thumb requests | Peak in-flight | Live glyphs | End WS (MiB) |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| desktop | grid | image-cold | 213.9 | 2714.4 | 110 | 1200 | 104 | 6 | 0 | 290.1 |
| desktop | grid | image-warm | 237.1 | 2855.3 | 110 | 1200 | 164 | 1 | 0 | 296.1 |
| desktop | grid | video-poster-cold | 229.9 | 2814.3 | 110 | 1200 | 104 | 6 | 0 | 285.3 |
| desktop | grid | video-poster-warm | 249.8 | 2673.2 | 110 | 1200 | 164 | 1 | 0 | 289.3 |
| desktop | grid | live-cold | 220.6 | 2787.5 | 110 | 1200 | 107 | 6 | 50 | 282.6 |
| desktop | grid | live-warm | 247.8 | 2762.0 | 110 | 1200 | 164 | 1 | 50 | 305.0 |
| desktop | details | image-cold | 203.5 | 2054.7 | 37 | 1200 | 50 | 6 | 0 | 236.7 |
| desktop | details | image-warm | 199.6 | 2050.7 | 37 | 1200 | 50 | 1 | 0 | 245.1 |
| desktop | details | video-poster-cold | 199.1 | 2049.5 | 37 | 1200 | 50 | 6 | 0 | 240.1 |
| desktop | details | video-poster-warm | 202.2 | 2053.5 | 37 | 1200 | 50 | 1 | 0 | 247.4 |
| desktop | details | live-cold | 203.5 | 2054.0 | 37 | 1200 | 50 | 6 | 16 | 244.6 |
| desktop | details | live-warm | 188.9 | 2040.9 | 37 | 1200 | 50 | 1 | 16 | 248.6 |
| web | grid | image-cold | 196.0 | 2695.8 | 110 | 1200 | 104 | 6 | 0 | 279.7 |
| web | grid | image-warm | 236.1 | 2678.8 | 110 | 1200 | 164 | 1 | 0 | 302.1 |
| web | grid | video-poster-cold | 197.5 | 2564.9 | 110 | 1200 | 101 | 6 | 0 | 291.7 |
| web | grid | video-poster-warm | 242.5 | 2675.4 | 110 | 1200 | 164 | 1 | 0 | 293.5 |
| web | grid | live-cold | 224.4 | 2706.1 | 110 | 1200 | 99 | 6 | 50 | 300.2 |
| web | grid | live-warm | 243.9 | 2717.5 | 110 | 1200 | 164 | 1 | 50 | 302.9 |
| web | details | image-cold | 206.7 | 2057.4 | 37 | 1200 | 50 | 6 | 0 | 255.1 |
| web | details | image-warm | 199.6 | 2051.5 | 37 | 1200 | 50 | 1 | 0 | 247.1 |
| web | details | video-poster-cold | 204.9 | 2055.1 | 37 | 1200 | 50 | 6 | 0 | 239.3 |
| web | details | video-poster-warm | 201.5 | 2052.5 | 37 | 1200 | 50 | 1 | 0 | 243.6 |
| web | details | live-cold | 210.5 | 2060.7 | 37 | 1200 | 50 | 6 | 16 | 246.5 |
| web | details | live-warm | 214.5 | 2066.1 | 37 | 1200 | 50 | 1 | 16 | 260.6 |

- Each run observed one startup long task; no runner-stable comparative CPU claim is made. All six `.livp` traces displayed the real shared Live Photo glyph (**50** Grid / **16** Details visible badges at final sampled viewport). Grid marquee remained non-empty; Details is a scroll/layout benchmark without marquee.
- Existing image/video cold/warm labels in this renderer harness are **synthetic 12 ms-delay vs no-delay**; they do not imply a real cache-hit benchmark. Warm scenario admissions (up to **164** in Grid) reflect the faster synthetic loader and are not a cache-efficiency comparison.
- **AFTER:** not applicable. No production code change was made; optimization was intentionally not attempted because all structural budgets passed. Later requests must not reuse the current single CI wall-clock numbers as a speed baseline across different hardware.
- Next: a separate real-video cold decode/canvas/PUT-backfill and warm-cache Server/HTTP/Agent test with a 100k metadata namespace, then 100k sync/delete operational performance. Do not equate the synthetic renderer timing with end-to-end throughput.

## Performance scenarios

The FileExplorer performance suite should keep these workloads stable:

| Scenario | Scale | Primary budget |
| --- | ---: | --- |
| Open directory | 200 / 10k / 100k children | first-page latency and time-to-interactive |
| Details scroll | 10k loaded items | frame stability and bounded mounted rows |
| Grid scroll | 10k loaded items | DOM count, thumbnail request concurrency, frame stability |
| Marquee select | 10k loaded items | pointer-frame CPU and selection latency |
| Pagination | 50 consecutive pages | no duplicate requests, no stale-page overwrite |
| Search | 100k namespace | first-page latency and next-page latency |

### Sparse range count cost A/B

Status: **Measured / production follow-up approved**.

The #734 media benchmark left one repeatable Server-side cost worth isolating: 100k file-heavy sparse directory ranges stayed around **200-236 ms** at first, middle, and end offsets even though thumbnail/object-store behavior was healthy. The current range query computes `COUNT(*) OVER()` on every viewport page, while the VirtualCollection contract only needs one stable `totalCount` to size the scrollbar for the active generation.

This PR is **benchmark-only**. It does not change the production children API, Go client, Agent/Web transport, or shared VirtualCollection contract.

Named workload: `file-explorer-range-count-100k`.

- namespace: **100,000 files** in one directory;
- range width: **200 items**;
- initial range: current counted query at offset 0, because a new generation still needs an authoritative total;
- broad-offset workload: **20 ranges** spread deterministically across the complete directory at offsets **200, 5,200, 10,200, ... 95,200**, preserving visibility into deep OFFSET cost;
- sequential-viewport workload: one authoritative counted range at offset 0 followed by **20 consecutive 200-item ranges** at offsets **200, 400, ... 4,000**;
- A path: the current production SQL shape with `COUNT(*) OVER() AS total_count` on every subsequent range;
- B path: the identical parent authorization join, File join, ordering, offset, limit, and projected row columns with only the window count removed after the initial counted range;
- correctness prerequisite: every broad-offset A/B range must return the exact same ordered node IDs, and every counted path must report `total_count=100000`;
- samples: **3 paired broad-offset batches** plus **3 paired sequential sessions**, alternating A/B execution order to reduce simple run-order bias;
- timing: report first-counted median, broad-offset batch/per-range medians, sequential session medians, raw sample batches, and paired reductions. Hosted-runner wall time remains diagnostic until repeated samples establish variance.

Command:

`XD_FILEEXPLORER_RANGE_COUNT_PERF=1 go test -run '^TestFileExplorerRangeCountPerformanceBaseline100K$' -count=1 -v ./internal/api`

Measured first authoritative CI sample (#739):

| Workload | Current counted path | Count-once / rows-only path | Delta |
| --- | ---: | ---: | ---: |
| Initial authoritative range | **82.252 ms median** | n/a | The first range still counts by design |
| 20 broad-offset subsequent ranges | **2040.550 ms** batch median (**102.028 ms/range**) | **1259.486 ms** batch median (**62.974 ms/range**) | **-38.28%**, about **39.1 ms/range** avoided |
| Sequential session: counted first range + 20 subsequent ranges | **1782.320 ms** median | **1077.919 ms** median | **-39.52%**, about **704.4 ms/session** avoided |

Raw paired samples:

- broad counted batches: **[2017.723, 2097.399, 2040.550] ms**;
- broad rows-only batches: **[1258.320, 1353.622, 1259.486] ms**;
- sequential count-every-page sessions: **[1782.320, 1793.888, 1782.060] ms**;
- sequential count-once sessions: **[1092.544, 1077.919, 1069.505] ms**.

The test completed in **29.39 s** and verified exact ordered node-ID equality for every broad A/B range plus `total_count=100000` on counted reads.

Decision: **accept the count-once direction for a separate production PR.** The roughly **38-40%** paired reduction is large and internally stable enough to justify implementation work. #739 remains benchmark-only so measurement and production-contract risk stay separated.

The production follow-up must preserve these semantics:

- offset 0 / a new navigation-or-sort generation obtains an authoritative total count;
- subsequent ranges may omit recomputing the count only when the client already owns that same generation's stable count;
- a missing count is never interpreted as zero;
- navigation, sort, refresh, or another generation reset reacquires an authoritative count;
- empty/out-of-range and 404 distinction must remain correct;
- Web and Desktop must consume one shared contract rather than inventing platform-specific count reuse.

Two later #739 validation samples confirmed the same direction despite hosted-runner wall-clock variation:

- validation sample 2: broad **3223.987 -> 1748.068 ms (-45.78%)**; sequential **2900.027 -> 1382.164 ms (-52.34%)**;
- validation sample 3: broad **3853.494 -> 2088.390 ms (-45.81%)**; sequential **3444.787 -> 1636.225 ms (-52.50%)**.

The absolute times moved with runner load, while the paired reduction stayed large across all three samples. That is sufficient evidence to proceed with the production contract without promoting raw wall time into a merge gate.

### Production count-once contract

Status: **Accepted / validated on #750**.

The production implementation keeps the optimization policy in the shared Cloud Files / VirtualCollection layer so Web and Desktop cannot drift:

- a new navigation, sort, explicit refresh, or other VirtualCollection generation requests its first range with an authoritative count;
- later viewport ranges request `include_count=false`;
- Server responses carry `total_count_included` so `total_count=0` is never ambiguous with “not computed”;
- the Go client treats an absent `total_count_included` field as counted, preserving compatibility with older Servers;
- Web and Desktop only serialize the shared controller's `includeCount` decision;
- a count-free page reuses the current generation's already-known total and cannot establish a fresh collection by itself;
- empty count-free ranges still validate the parent directory so 404 behavior is unchanged.

This is a production realization of the measured #739 candidate, not a separate speedup claim. The production-branch validation reran the same 100k paired workload and reproduced the benefit despite different hosted-runner absolute timing:

| Validation workload | Count every range | Count once / later ranges count-free | Paired reduction |
| --- | ---: | ---: | ---: |
| 20 broad-offset ranges | **3885.236 ms** | **2136.375 ms** | **-45.01%** |
| Counted first range + 20 sequential ranges | **3480.204 ms** | **1695.987 ms** | **-51.27%** |

The same production tree passed the shared Desktop controller/VirtualCollection tests, Web lint/build, Server deployment validation, API race suite, and the branch-scoped 100k benchmark before the final documentation-only rerun. Ordinary Go race also passed before that rerun. Absolute hosted-runner wall time remains diagnostic; the stable paired direction from #739 and #750 is the evidence.

Decision: **accept the production count-once contract.** Keep `total_count_included` as the explicit wire signal, keep old-Server compatibility by treating a missing flag as counted, and keep generation ownership in shared Cloud Files / VirtualCollection rather than duplicating policy in Web/Desktop adapters.



## Next work

1. **Keep the accepted FileExplorer scheduler budgets while validating video posters.** Preserve the current **80 ms scroll-settle**, **6-request thumbnail concurrency**, **96-entry FileExplorer cache**, and virtual-geometry marquee implementation; use the new cold/warm poster traces before making any further thumbnail tuning.
2. **Measured / accepted direction:** #739 shows a **38.28% broad-offset** and **39.52% sequential-session** reduction when later ranges stop recomputing `COUNT(*) OVER()`. Keep #739 benchmark-only.
3. **Accepted / implemented:** the production **count-once / count-free subsequent-range** contract is complete across Server -> Go client -> xdrive-agent/Electron/Web -> shared Cloud Files/VirtualCollection. Keep #739 as the decision benchmark and #750 as the production validation.
4. **Accepted / implemented:** #759 installs the #756-selected exact type expression index through Server migration. Production-branch validation reproduced a **57.26%** reduction on the repeated count-free middle range while leaving the counted first range effectively unchanged (**-0.87%**). Keep the persisted-key candidate rejected. No further FileExplorer directory-sort optimization is selected from current evidence.
5. **Video poster capability is implemented.** The remaining performance work is measurement: synthetic cold/warm poster traces plus a real browser/Electron-to-Server dataset that separates cold preview/decode/backfill from warm persistent-cache reads.

Every performance change should preserve FileExplorer selection, keyboard navigation, drag/drop, rename, preview, and pagination semantics.


### Sparse logical directory surface

The FileExplorer surface can separate the logical directory item count from loaded/rendered items. Details and Grid compute scrollbar geometry from the full logical count, while only the current viewport plus bounded overscan creates render slots. Missing slots are lightweight non-interactive placeholders; the surface never allocates an array sized to the full directory. The dense compatibility path retains adaptive prefetch/load-more behavior, while sparse mode bypasses legacy bottom pagination entirely. Search remains dense until its own range contract migrates.


Before sparse runtime is enabled, item interactions must also be logical-index aware. Active item, rename recovery, marquee hit-testing, and keyboard targets resolve against loaded sparse logical indexes. Shift ranges are committed only when every logical item in the requested range is loaded; otherwise FileExplorer requests that range instead of silently selecting a partial loaded subset. Full Ctrl+A / cross-unloaded-range bulk selection remains a separate selection-model problem and must not be faked by selecting only loaded items.

### Windows local-delete prefix-set and baseline pruning contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Windows CfAPI full/local-change reconcile push path;
- stable structural workload: **1,200 flat baseline files** deleted locally;
- every file remains an independent Server DELETE root, so network mutation cardinality is intentionally unchanged;
- evidence method: deterministic prefix-set/baseline helper behavior plus source-shape regression for both reconcile paths; no wall-clock benchmark is quoted.

BEFORE:

- every successful delete immediately called `deletePrefix(baseline, rel)`;
- for 1,200 flat files plus the root entry, repeated shrinking-map scans inspect up to **721,800 baseline keys**;
- subtree suppression used `underAny(rel, deletedPrefix)`, linearly scanning every previously successful prefix; 1,200 independent roots perform **719,400 prefix comparisons**;
- local-change new-directory suppression used the same growing-prefix-list shape.

AFTER / current:

- successful delete roots are recorded in `winPathPrefixSet`;
- ancestor coverage walks only the candidate path's ancestors and performs map lookups, independent of the number of previously processed sibling roots;
- baseline cleanup runs once after the delete loop and removes entries covered by any successful root;
- 1,200 flat successful deletions therefore require **1 final baseline scan** instead of 1,200 baseline scans;
- full reconcile keeps HTTP 404 as successful local cleanup and keeps 409 as non-cleanup; local-change reconcile keeps both 404/409 as non-cleanup exactly as before;
- if a later DELETE fails fatally, baseline entries for earlier successful DELETEs are still pruned before returning, matching the old partial-progress behavior;
- Server DELETE request order/cardinality, revision checks, subtree suppression, rename ordering, CfAPI behavior and baseline persistence are unchanged.

Decision: **Accepted.** The old repeated local map scans and linear prefix-list coverage added CPU work proportional to the product of deletion count and baseline/prefix count without contributing to server-side correctness.

Regression budget: successful local-delete baseline cleanup must perform at most **one full baseline traversal per reconcile delete phase**. Prefix coverage must be ancestor-set based and must not reintroduce a growing linear prefix scan.

Regression commands:

- `go test ./internal/mount -run '^TestWindows(PathPrefixSet|DeleteBaselinePrefixes|LocalDeletePruningSourceShape)$' -count=1`.

Next action: continue ordinary sync/delete/download performance audits and only change another deterministic request, SQL, allocation, filesystem, lock, or object-store multiplier.

### Windows local-change existence-probe reuse contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Windows CfAPI local-change reconciliation;
- stable structural workload: **1,200 independent changed paths** with no subtree suppression;
- evidence method: deterministic source-shape regression plus existing Windows reconcile behavior tests;
- no wall-clock speedup is claimed.

BEFORE:

- the main changed-path pass calls `os.Lstat` once per independent path to classify existing vs missing work;
- a second deletion-discovery pass iterates the complete `pathSet` and calls `os.Lstat` again for every path;
- 1,200 independent paths therefore require **2,400 filesystem existence probes** before Server DELETE work.

AFTER / current:

- the first pass records a path as a deletion candidate immediately when its single `Lstat` returns `os.ErrNotExist` and that path still exists in the baseline;
- the second whole-`pathSet` filesystem pass is removed;
- the same 1,200-path workload therefore requires **1,200 filesystem existence probes**;
- deletion candidates are still depth-sorted and filtered by the existing prefix set;
- the delete loop still re-checks the current baseline entry before issuing the Server DELETE;
- Server DELETE request order/cardinality, revision use, 404/409 behavior, successful-prefix pruning, always-local handling, cache enforcement and baseline persistence are unchanged.

Decision: **Accepted.** The second filesystem pass repeated information already obtained by the first pass and added one local metadata syscall per changed path without contributing new mutation semantics.

Regression budget: `reconcileLocalChanges` must perform at most one direct `os.Lstat` existence probe per processed changed path; deletion discovery must not reintroduce a second full `pathSet` filesystem scan.

Regression command:

- `go test ./internal/mount -run '^TestWindowsLocalChangeExistenceProbeSourceShape$' -count=1`.

Next action: continue basic FileExplorer download/sync/delete performance audits and only change another deterministic request, SQL, allocation, filesystem, lock, or object-store multiplier.

### Hierarchical Transfer history trim fast-path contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- shared Go Transfer Manager used by Desktop/Agent FileExplorer upload/download task trees;
- stable structural workload: **1 active group + 1,000 child tasks**, history limit **200 roots**;
- every child is created and then completed, while all tasks remain under the same root;
- evidence is deterministic source-shape/runtime regression; no wall-clock speedup is claimed.

BEFORE:

- every `Start` and terminal `Complete/Fail` calls `trimLocked`;
- `trimLocked` first scans the complete task order just to discover that root cardinality is still 1;
- one group plus 1,000 create+complete child cycles therefore performs **1,003,001 history-entry inspections** before doing no eviction.

AFTER / current:

- Manager maintains the distinct root IDs incrementally;
- when `len(roots) <= history limit`, `trimLocked` returns before allocating root-order maps or scanning task history;
- the same workload performs **0 history-entry inspections** in trim;
- once root cardinality really exceeds the limit, the existing oldest-terminal-root selection still scans and evicts whole root trees exactly as before.

Decision: **Accepted.** Child cardinality must not determine history-retention cost because the configured limit is defined in root transfers, not child tasks.

Regression budget: child create/finish under an in-limit root set must return from `trimLocked` before the history loop. Clear, clear-history, and trim eviction must keep the root set synchronized with retained trees.

Regression commands:

- `go test ./internal/transfer -run '^TestManagerHistoryTrimFastPathUsesRootCardinality$|^TestManagerHistoryLimitCountsRootTransfersNotChildren$|^TestManagerClearHistoryKeepsCompletedChildrenOfActiveGroup$' -count=1`.

Next action: completed by the Web child registration/persistence contract below; continue basic FileExplorer download/sync/delete audits.

### Folder-upload group progress aggregation contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- shared FileExplorer upload controller used by Web and Desktop;
- a folder upload with **N targets** keeps the existing sequential upload order and creates all queued child transfer tasks before the group starts;
- evidence is deterministic controller execution plus source-shape regression; no wall-clock speedup is claimed.

BEFORE:

- target setup evaluates `fileSize(target.file)` once while reducing total bytes and again while building child sizes: **2N probes**;
- an N-length `childDone` array stores every child byte position;
- each `groupProgress()` publication recomputes `bytesDone` with `childDone.reduce(...)`: **N slot inspections per publication**;
- frequent upload progress callbacks therefore multiply progress bookkeeping by folder cardinality.

AFTER / current:

- child sizes are computed once and their total is reduced from that cached list: **N file-size probes**;
- one scalar `groupBytesDone` tracks aggregate progress;
- the currently executing child keeps one local `childBytesDone`; each callback applies only `next - previous` to the aggregate;
- each group-progress publication reads the aggregate in **O(1)**;
- the N-length `childDone` array is removed;
- skipped/preflight-failed/cancelled children retain their prior zero-or-partial transferred-byte semantics; successful children advance the aggregate to their full size.

Decision: **Accepted.** Progress accounting must not become more expensive merely because a folder contains more queued siblings.

Regression budget: group progress aggregation must not scan per-child byte slots. `fileSize` is evaluated once per target during group setup. All children must still be registered before the group begins transfer.

Regression command:

- `node --test desktop/tests/shared-folder-upload-transfer-groups.cjs`.

### Web folder-upload child registration/persistence contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Web FileExplorer folder upload with **N queued child tasks** under one transfer group;
- all children must remain visible in Transfer Center before the group begins transferring;
- evidence is deterministic shared-controller execution plus Web store source-shape regression; no wall-clock speedup is claimed.

BEFORE:

- shared upload orchestration calls the Web `startChild` adapter N times;
- each call performs a parent-task lookup, prepends a new task array, trims root history, serializes the full transfer history into `localStorage`, copies a snapshot, and notifies listeners;
- child registration therefore performs **N parent lookups, N history trims, N full-history persistence writes, and N listener publications**;
- because every persistence write serializes the growing child list, cumulative registration serialization grows with both child count and retained history size.

AFTER / current:

- the shared lifecycle exposes optional `startChildren` while retaining `startChild` as the compatibility path;
- Web opts into `startChildren`; Desktop/Agent keeps the existing per-child lifecycle unchanged;
- Web resolves the parent once, constructs all queued child tasks in target order, prepends them in the same legacy newest-first display order, then runs one history trim and one emit/persistence step;
- the same N-child registration performs **1 parent lookup, 1 history trim, 1 full-history persistence write, and 1 listener publication**;
- returned child IDs stay in target order, so subsequent upload/progress/finish calls retain their existing file-to-transfer mapping;
- all queued children still exist before `begin(groupID)`, so upfront Transfer Center visibility is preserved.

Decision: **Accepted.** Upfront child visibility is part of the transfer contract, but persisting and publishing the entire growing transfer history after every child has no semantic value.

Regression budget: Web folder-upload batches with more than one child must use one `startChildren` call and one store emit for registration. The single-child `startChild` API remains compatible. Desktop transfer lifecycle behavior is unchanged.

Regression command:

- `node --test desktop/tests/shared-folder-upload-transfer-groups.cjs`.

Next action: completed for archive child creation by the Web archive-download registration contract below.

### Agent transfer child batch-registration contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Desktop FileExplorer folder upload and Agent-native folder download;
- stable structural workload: **1,000 leaf files** under one hierarchical Transfer Center group;
- evidence method: deterministic Manager revision test + Agent IPC batch test + Desktop/Agent source-contract test;
- samples: n/a for structural request/revision counts.

BEFORE:

- Desktop folder upload registered queued children with **1,000 renderer -> Electron -> Agent lifecycle requests**;
- each Agent child registration published one transfer revision, so upfront registration published **1,000 revisions**;
- Agent-native folder download also registered 1,000 children individually before payload transfer, publishing **1,000 revisions**.

AFTER / current:

- capability-gated `start_children` registers the same 1,000 Desktop upload children in **1 IPC request**; each request is bounded to **1,000 children** and the route has a dedicated **1 MiB** JSON ceiling while all ordinary Desktop IPC JSON remains capped at **64 KiB**;
- larger folders are chunked by the Desktop adapter (for example, 10,000 children -> **10** bounded IPC requests instead of 10,000 single-child requests), preserving target order without allowing one unbounded JSON body;
- `Manager.StartChildrenByID` inserts the complete child batch under one lock and publishes **1 revision** after the batch;
- Agent-native folder download reuses the same Manager batch primitive, so its upfront child-registration revisions are **1,000 -> 1**;
- all child IDs/tasks still exist before the group enters transfer execution, and upload/download payload order, per-file progress, completion, retry and cancellation semantics are unchanged;
- an older Agent without `transfer-lifecycle-child-batch` keeps the existing shared-controller `startChild` fallback.

Decision: **Accepted.** This removes child-count-scaled control-plane setup without adding transfer concurrency or changing the data plane.

Regression budget: each supported batch of up to **1,000 children** must issue **one Agent lifecycle request and one Manager revision publication**; larger Desktop child sets must be chunked into bounded batches, and no partial child set may be returned for a valid batch.

Next action: completed by the Agent folder-download progress publication contract below.

### Agent folder-download progress publication contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Agent-native Desktop FileExplorer folder download;
- one active leaf file whose `DownloadToProgress` callback already reports bytes at the shared client cadence;
- evidence method: deterministic Manager revision test plus source-contract coverage of the production folder-download callback;
- samples: n/a for structural revision counts.

BEFORE:

- every progress callback updates the leaf child with `Baseline` / `Progress`, publishing **1 Manager revision**;
- the same callback immediately updates the folder group aggregate with `UpdateGroup`, publishing **1 more revision**;
- total control-plane publication cost: **2 Manager revisions per download progress callback**.

AFTER / current:

- `BaselineAndUpdateGroup` / `ProgressAndUpdateGroup` mutate child and group state under one Manager lock and publish once after both are coherent;
- total control-plane publication cost: **1 Manager revision per download progress callback**;
- the child's byte/rate calculations and the group's bytes/items/percent calculations retain their existing semantics;
- the shared download client's existing **100 ms** progress-report throttling is unchanged;
- file start, completion, failure and cancellation transitions remain separate lifecycle publications; no transfer concurrency or data-plane behavior changes.

Decision: **Accepted.** Child and group progress are one coherent Transfer Center snapshot, so publishing the intermediate child-only state has no correctness or user-visible value.

Regression budget: each Agent folder-download progress callback must advance Manager revision by at most **1** while updating both the active child and its group aggregate. Standalone child/group APIs must continue to publish immediately.

Regression commands:

- `go test ./internal/transfer`;
- `node --test desktop/tests/shared-folder-download-transfer-groups.cjs`.

Next action: return to basic FileExplorer **sync/delete** performance auditing and only change another deterministic request, SQL, allocation, or publication hotspot.

### Web archive-download child registration/persistence contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Web FileExplorer archive/folder download after durable archive prepare returns **N leaf files**;
- stable structural example: **1,000 prepared leaf files**;
- Transfer Center child tasks must all exist before archive progress polling/transport begins;
- evidence is source-shape regression over the production Web download path; no wall-clock speedup is claimed.

BEFORE:

- archive prepare iterates every prepared leaf and calls `startTransferChild` separately;
- each child call resolves the parent, prepends transfer history, trims history, serializes the full transfer list to `localStorage`, snapshots it, and notifies listeners;
- N prepared files therefore perform **N parent lookups, N history trims, N full-history persistence writes, and N listener publications** before archive bytes start streaming.

AFTER / current:

- archive download maps the prepared manifest to one `startTransferChildren` call;
- Web TransferStore resolves the parent once, creates all children, trims once, persists once, and notifies once;
- returned IDs are consumed by manifest index and then stored in the existing path-indexed maps, preserving later server-progress routing;
- all child tasks still exist before the first group progress publication/poll;
- archive prepare/status polling, server-side per-entry progress, direct-to-disk/Blob transport, final completion and error/cancel handling are unchanged.

Decision: **Accepted.** Prepared archive entries are already known as one immutable manifest for this transfer, so publishing the same growing child list N times has no user-visible or correctness value.

Regression budget: one prepared archive manifest must use one batch child-registration call and must not call `startTransferChild` inside `downloadArchive`. Returned child count must match the prepared manifest before transport begins.

Regression command:

- `node --test desktop/tests/shared-web-archive-download-transfer-groups.cjs`.

### Web archive-download progress persistence batching contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Web FileExplorer archive/folder download with **N prepared leaf files** and the existing 200 ms Server progress polling;
- stable structural example: **1,000 child transfers + 1 group transfer**;
- evidence combines an executable Web TransferStore batching regression with source-shape coverage of archive progress/success/failure wiring;
- no wall-clock speedup is claimed.

BEFORE:

- every child `begin`, `progress`, or terminal `finish` calls TransferStore `patch`;
- each successful `patch` trims root history, serializes the complete transfer list to `localStorage`, snapshots it, and publishes every listener;
- a steady 1,000-file progress snapshot therefore performs **1,001 history trims, 1,001 full-history persistence writes, and 1,001 listener publications** (1,000 child progress updates + 1 group update);
- state-transition snapshots can perform more because begin/finish mutations are additional child patches;
- success fallback completion and failure/cancel cleanup also repeat persistence once per unfinished child.

AFTER / current:

- TransferStore exposes a nest-safe `batchUpdates` scope for lifecycle patches;
- archive `applyProgress` batches every child mutation and its group aggregate update;
- successful terminal catch-up batches child progress/completion plus group completion;
- failure cleanup batches unfinished-child cancellation plus group failure;
- the outer batch performs **one history trim, one full-history persistence write, one snapshot, and one listener publication** when any lifecycle item changed;
- ordinary single-file upload/download mutations outside a batch keep their existing immediate persistence/publication behavior;
- Server progress polling remains 200 ms and archive payload streaming is unchanged.

Decision: **Accepted.** A single Server progress snapshot is one coherent UI state transition; serializing and publishing the same transfer tree after each child mutation has no correctness or user-visible value.

Regression budget: one archive progress snapshot must cause at most **1** TransferStore trim/persistence/listener publication regardless of child count. Nested batch scopes must flush only at the outer boundary, and unbatched single-transfer progress must still publish immediately.

Regression commands:

- `node --test desktop/tests/web-transfer-store-batch.cjs`;
- `node --test desktop/tests/shared-web-archive-download-transfer-groups.cjs`.

Next action: continue basic FileExplorer sync/delete performance audits and only change another deterministic request, SQL, allocation, filesystem, lock, or object-store multiplier.



### Windows empty always-local policy fast-path contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Windows CfAPI reconciliation with the default normalized storage policy;
- stable structural workload: **100,000 baseline entries**, `AlwaysLocalPaths` empty after normalization;
- evidence method: policy unit regression plus source-shape regression that requires the empty-policy guard before the baseline loop;
- no wall-clock speedup is claimed.

BEFORE:

- every local-change and full-reconcile completion calls `applyAlwaysLocal(baseline)`;
- even when no always-local rule exists, `applyAlwaysLocal` allocates its path slice and inspects every baseline entry;
- the 100,000-entry default-policy workload therefore performs **100,000 baseline inspections** for work that cannot match any entry.

AFTER / current:

- normalized policy exposes `hasAlwaysLocal()`;
- `applyAlwaysLocal` returns before allocation or baseline iteration when that predicate is false;
- the same default-policy workload performs **0 baseline inspections** in this policy phase;
- when at least one normalized always-local rule exists, path matching, sort order, availability checks, pinning and hydration are byte-for-byte on the existing path.

Decision: **Accepted.** The empty policy mathematically cannot produce an always-local match, so scanning the baseline has no correctness value.

Regression budget: an empty normalized `AlwaysLocalPaths` policy must return before the `for rel, state := range baseline` loop; configured-policy behavior must continue through the existing loop.

Regression commands:

- `go test ./internal/mount -run '^TestSyncPolicyHasAlwaysLocal$|^TestWindowsApplyAlwaysLocalEmptyPolicyFastPathSourceShape$' -count=1`.

Next action: audit hierarchical Transfer Manager child creation so large folder uploads/downloads do not repeatedly rescan full task history while preserving upfront child visibility.

### FileOperation progress-write coalescing contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- durable FileOperation Copy/Move/Delete execution used by FileExplorer;
- stable structural workload: **120 top-level Move/Delete roots**;
- evidence method: PostgreSQL statement counter against the progress helper plus source-shape regression for Copy/Move/Delete executor wiring; no wall-clock benchmark is quoted.

BEFORE:

- each root wrote `current_item` with one `status=running` UPDATE;
- successful root completion then issued a second UPDATE for `processed_items/processed_bytes`;
- 120 roots therefore produced **240 FileOperation UPDATEs** before terminal completion;
- Copy additionally wrote `processed_bytes` once per copied file from its traversal hook.

AFTER / current:

- completed item/byte deltas remain pending only until the next item begins;
- the next `current_item` UPDATE atomically folds in the previous completed delta;
- the last pending delta is explicitly flushed before undo-plan/terminal completion;
- 120 roots therefore produce **121 FileOperation UPDATEs** for item/progress bookkeeping;
- Copy's per-file byte deltas are folded into subsequent node/root checkpoints instead of requiring one extra UPDATE per file.

Cancellation contract:

- **every item/node still executes the existing `status=running` UPDATE checkpoint**;
- a DB-visible `cancel_requested` state still makes that checkpoint affect zero rows and resolves to `errFileOperationCancelled`;
- the in-process cancellation context remains unchanged;
- coalescing does not reduce cross-Server cancellation checkpoint frequency.

Decision: **Accepted.** This removes redundant progress-only writes without weakening FileOperation cancellation, item ordering, mutation transactions, conflict handling, or final progress accuracy.

Regression budget: a 120-item begin+complete workload must remain at **<=121 FileOperation UPDATEs**, and the final stored processed item/byte totals must be exact.

Regression commands:

- `go test ./internal/api -run '^TestFileOperationProgress(CoalescesCompletedDeltas|PreservesDatabaseCancellationCheckpoint|ExecutorsUseCoalescer)$' -count=1`.

Next action: continue basic FileExplorer download/sync/delete performance audits and only change another deterministic request, SQL, allocation, filesystem, lock, or object-store multiplier.

### Windows local file-rename baseline fast-path contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Windows CfAPI event-driven local rename handling;
- stable structural workload: **1,200 independent file renames** against a **100,000-entry baseline**;
- every rename still performs the existing Server `RenameMove` mutation and `cfMarkPathInSync`;
- evidence method: production source-shape regression plus behavior tests over a 100k-entry baseline; no wall-clock benchmark is quoted.

BEFORE:

- every successful local rename called `deletePrefix(baseline, newPath)`;
- it then called `moveBaselinePrefix(baseline, oldPath, newPath)`;
- both helpers scan the whole baseline to discover subtree members;
- independent file renames have no descendants, so 1,200 file renames performed **2,400 whole-baseline prefix scans** without gaining file-level correctness.

AFTER / current:

- when the source is a file and the exact target is absent or is also a file, baseline bookkeeping uses exact map operations: delete the target key, delete the old key, and write the source state at the new key;
- the same 1,200-file workload performs **0 prefix-wide baseline scans** in rename bookkeeping;
- an exact target that is a baseline directory falls back to the old subtree delete/move path;
- directory source renames also keep the old subtree path because descendants must move with the directory;
- Server request cardinality, revision/conflict behavior, target parent resolution, path-in-sync marking, and later changed-path processing remain unchanged.

Decision: **Accepted.** A file node cannot own baseline descendants, so scanning the entire baseline twice per ordinary file rename adds work proportional to namespace size without contributing information.

Regression budget: ordinary file rename bookkeeping must not call `deletePrefix` or `moveBaselinePrefix`. Directory renames and directory-target fallback must retain subtree cleanup/move semantics.

Regression commands:

- `go test ./internal/mount -run '^TestWindowsLocalFileRename' -count=1`.

Next action: continue basic FileExplorer sync/delete performance auditing and only change another deterministic request, SQL, allocation, filesystem, lock, or object-store multiplier.

### Windows full-reconcile local-file delete baseline fast-path contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- Windows CfAPI full remote reconciliation fallback;
- stable structural workload: **1,200 flat file nodes** present in the baseline and remote snapshot, locally missing, with unchanged revisions;
- every item still performs the existing revision-fenced Server `DELETE`; this contract changes only post-success in-memory baseline bookkeeping;
- evidence method: behavior tests over a 100k-entry baseline plus a production source-shape regression; no wall-clock benchmark is quoted.

BEFORE:

- every successful local-missing delete called `deletePrefix(baseline, rel)`;
- for files, that helper scans the entire baseline even though a file cannot own descendants;
- 1,200 successful flat-file deletes therefore performed **1,200 prefix-wide baseline scans**.

AFTER / current:

- when both baseline and current remote node types are `file`, successful Server DELETE removes the exact baseline key with `delete(baseline, rel)`;
- the same 1,200-file workload performs **0 prefix-wide baseline scans** in post-delete bookkeeping;
- directory nodes retain `deletePrefix` because descendant baseline entries must be removed;
- a baseline/remote type mismatch also retains the subtree fallback rather than assuming file semantics;
- Server DELETE cardinality, revision checks, error handling, remote walk, path ordering, placeholder behavior, and final baseline persistence are unchanged.

Decision: **Accepted.** File deletion has exact-key baseline semantics; namespace-wide descendant discovery contributes no information for a file node.

Regression budget: successful full-reconcile deletion of a file must not call `deletePrefix`. Directory or type-mismatch cleanup must retain subtree deletion.

Regression commands:

- `go test ./internal/mount -run '^TestWindowsRemoteFullLocal' -count=1`.

Next action: continue the basic sync/delete performance audit. The next larger candidate is reducing full-baseline clone/diff work for small Windows incremental batches, but that should be handled separately because it changes persistence-delta plumbing rather than simple map bookkeeping.

### Windows remote journal file-page path-delta persistence contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- ordinary Windows CfAPI **remote change-journal** processing after the baseline is already loaded; this is **not first-open/full reconciliation**;
- stable structural workload: **10,000 baseline entries** and one journal page containing three independent file mutations: one in-place update, one delete, and one rename/move;
- evidence method: deterministic path-delta equivalence test plus production source-shape regression; no wall-clock speedup is quoted.

BEFORE:

- every successful journal page finished through `storeBaseline -> persistBaselineDelta -> diffBaseline`;
- `diffBaseline` iterated the complete previous map and then the complete current map even when only a few file paths changed;
- the 10,000-entry / three-file workload therefore performs roughly **20,000 baseline map visits in the persistence-diff phase**;
- the existing `cloneBaseline` at the beginning of the incremental page is separate and remains unchanged by this PR.

AFTER / current:

- pure file journal pages track only exact old/new paths touched by file create/update/move/delete;
- the same update + delete + move workload compares **4 candidate paths** in the persistence-diff phase;
- directory upserts/deletes, excluded-path prefix cleanup, unsupported node types, and local unsynchronized file handling that can create a conflict copy all keep the existing full `diffBaseline` fallback;
- overflow/full reconciliation, state-log framing, CRC, fsync, compaction thresholds, cache enforcement, always-local behavior, journal cursor semantics, and sync conflict handling are unchanged.

Decision: **Accepted.** File nodes have exact-key persistence semantics when the page does not enter a subtree-sensitive or conflict-copy path, so rescanning unrelated baseline entries adds no persistence information.

Regression budget: eligible pure-file journal persistence must remain **O(touched file paths)** for the diff phase; directory/subtree/conflict-sensitive pages must continue using the full-diff fallback. This does **not** claim total incremental reconciliation is O(changes), because baseline cloning remains O(baseline entries).

Regression commands:

- `go test ./internal/mount -run '^TestWindowsBaselinePathDeltaMatchesFullDeltaForSmallFileBatch$|^TestWindowsRemoteJournalFilePageUsesPathScopedBaselinePersistence$' -count=1`.

Next action: continue basic FileExplorer sync/delete performance auditing. The remaining larger Windows incremental cost is the full baseline clone at page start; handle that separately only if a safe copy-on-write/delta mutation design can preserve reconciliation semantics.

### Windows same-path file journal baseline-clone bypass contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- ordinary Windows CfAPI remote change-journal page after the baseline is loaded;
- stable structural workload: **100,001 baseline entries** (root + 100,000 files) and one same-path upsert for an already-known file node;
- the file has no unsynchronized local edit, Always Local is disabled, and cache-limit enforcement is disabled;
- evidence method: deterministic bounded-snapshot helper test plus production source-shape regression; no wall-clock speedup is quoted.

BEFORE:

- `applyRemoteChangePage` cloned the complete `p.baseline` before it knew whether the page only touched one ordinary file;
- it also cloned the complete hydrated timestamp map;
- one same-path file revision update in a 100k baseline therefore copied **100,001 baseline entries** before any path-specific work.

AFTER / current:

- a conservative fast path runs before `cloneBaseline`;
- it accepts only unique, same-path, already-known file upserts whose node ID, parent ID and filename still match the exact baseline path entry;
- it snapshots only the touched file state plus that file's hydration timestamp, preflights local-modification conflict state before any mutation, then applies the existing placeholder replacement semantics;
- memory baseline persistence merges only changed file paths and appends the already-supported path delta without constructing a full current-map copy;
- the same workload performs **0 full baseline clones** and **0 full hydrated-map clones** on the journal page;
- when persistence is disabled (`statePath == ""`), the delta path returns without snapshotting global state;
- if the baseline state file is missing or compaction is due, persistence deliberately snapshots the full current baseline at that exceptional boundary;
- file rename/move, delete, directory changes, excluded paths, duplicate page entries, local unsynchronized conflicts, Always Local, cache-limit enforcement, reset/full reconciliation, and unsupported node types all retain the existing full-baseline implementation.

Decision: **Accepted.** Same-path existing-file upserts have exact-key baseline semantics and do not need namespace-wide copy-on-write state. Restricting the fast path keeps every subtree/conflict/policy-sensitive case on the established code path.

Regression budget: one eligible same-path file-only journal page must not call `cloneBaseline` or `cloneHydrated` before applying the update. The fast-path snapshot size must remain **O(changes)**, not O(baseline entries).

Regression commands:

- `go test ./internal/mount -run '^TestWindowsRemoteJournal(SamePathFileUpsertSnapshotIsBounded|FastPathPrecedesBaselineClone|PathUpdatePersistsWithoutFullCurrentMap)$' -count=1`.

Next action: continue ordinary FileExplorer download/sync/delete performance auditing; do not broaden this fast path into rename/delete/directory/conflict handling without separate evidence.

### Windows exact file-delete journal baseline-clone bypass contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- ordinary Windows CfAPI remote change-journal page after the baseline is loaded;
- stable structural workload: **100,001 baseline entries** (root + 100,000 files) and one remote delete for an already-known file;
- the delete is an ordinary xDrive soft delete whose deleted Node row still retains its name/parent chain;
- evidence method: changes API opt-in integration contract + deterministic 100k bounded-snapshot/source-shape tests; no wall-clock speedup is quoted.

BEFORE:

- the default changes API emitted delete events without a path;
- Windows therefore could not do an exact baseline-key lookup for delete and entered the generic journal path;
- that path cloned the full baseline and hydrated map before processing the page and lazily built a full nodeID -> path index for the delete;
- one known-file delete in a 100k baseline therefore performed **1 full baseline clone + 1 full hydrated-map clone + 1 full baseline index-build scan**.

AFTER / current:

- the existing changes API keeps its default response/query cost unchanged for Web/FileExplorer polling;
- Windows explicitly requests `include_deleted_paths=true`; only that request resolves retained soft-deleted node paths with one owner-scoped recursive CTE for the page;
- hard-deleted/unresolvable nodes continue to return an empty path;
- Windows accepts the fast path only when every change is a unique file delete whose supplied path exactly maps to the same baseline node ID/type/name and whose parent path is still known;
- eligible pages snapshot only the touched file state and hydration timestamp, preserve the existing unsynchronized-local-change conflict check, remove the exact local files, and append a path-delete baseline delta;
- the same 100k workload performs **0 full baseline clones**, **0 full hydrated-map clones**, and **0 nodeID full-map index builds**;
- empty path, node/path mismatch, directory delete, excluded/Always Local/cache-limit policy, and local modification conflicts retain the established path.

Decision: **Accepted.** The Server metadata work is opt-in and batched, while exact known-file deletion has path-local baseline semantics. Hard deletes and subtree-sensitive cases remain conservative.

Regression budget: one eligible exact file-delete page must not call `cloneBaseline`, `cloneHydrated`, or scan `p.baseline` before applying the delete. The fast-path snapshot must remain **O(changes)**. Default `/changes` requests must not resolve deleted paths. Local unsynchronized modifications must still block the remote delete without removing the file or baseline entry.

Regression commands:

- `go test ./internal/api -run '^TestNodeChangeJournalLifecycleAndOwnerScope
- `go test ./internal/client -run '^TestNodeChanges' -count=1`;
- `go test ./internal/mount -run '^TestWindowsRemoteJournal(SamePathFileDeleteSnapshotIsBounded|FileDeleteFastPathPrecedesBaselineClone|FileDeleteFastPathPreservesLocalConflict|FileDeletePathDeltaPersistsWithoutFullCurrentMap)$' -count=1`.

Next action: continue ordinary FileExplorer download/sync/delete performance auditing and only change another deterministic request, SQL, allocation, filesystem, lock, or object-store multiplier.


### FileOperation Delete root-update coalescing contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- durable FileOperation Delete execution used by FileExplorer;
- stable workload: **120 top-level sibling files**, each with current File metadata;
- PostgreSQL integration invokes the real `executeQueuedBatchDelete` path and counts only `UPDATE xd_nodes` statements during execution;
- roots are loaded by `batchLoadNodesTx(..., preload=true)`, which takes `FOR UPDATE` locks and validates every requested revision before mutation;
- the BEFORE baseline was validated by the phase-1 authoritative API race run before production code changed;
- wall-clock timing is intentionally not quoted.

BEFORE:

- each root subtree is marked deleted/trash-root with one `xd_nodes` UPDATE;
- each already locked/revision-validated root then receives a second `xd_nodes` UPDATE only to increment root revision/update time;
- **120 roots -> 240 `xd_nodes` UPDATE statements**.

AFTER / current:

- one root-scoped SQL statement marks active subtree rows deleted, assigns `trash_root_id`, increments only the selected root revision, and updates timestamps;
- the same statement carries a root revision precondition and returns whether that exact root was updated, preserving the old defensive revision-conflict outcome even though roots are already locked;
- a selected root already soft-deleted earlier in the same transaction keeps its existing `deleted_at` / `trash_root_id` while still receiving the same revision +1 / `updated_at` mutation as before;
- **120 roots -> 120 `xd_nodes` UPDATE statements**;
- Share revocation remains one statement per root and different roots are intentionally not batched, preserving per-root progress/cancellation checkpoints and trash-root identity.

Decision: **Accepted.** The second root-only statement repeated mutation work already guarded by the selected-root lock/revision validation. Folding it into the subtree statement removes one SQL round trip per root without changing Delete ordering, undo-plan revisions, cancellation checkpoints, or Trash semantics.

Regression budget: Delete execution must perform at most **1 `xd_nodes` UPDATE per selected top-level root**. Root revision mismatch must mutate zero subtree rows and surface the existing `revision_conflict`; an already-deleted selected root must preserve its prior Trash identity while still receiving the revision bump.

Regression commands:

- `go test ./internal/api -run '^TestFileOperationDelete(NodeUpdatesCoalesced|RootsAreRevisionLockedBeforeMutation)$|^TestMarkFileOperationDeleteSubtreePreservesSemantics$' -count=1`.

Next action: continue ordinary FileExplorer **upload-finalize / download / sync / delete** performance auditing; the remaining larger Windows incremental cost is the full baseline clone at journal-page start.

### Resumable upload incremental reservation bookkeeping contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- ordinary resumable FileExplorer upload after a session is created; this is **not a first-open or 100k listing workload**;
- stable structural workload: **128 newly uploaded chunks** in one active session, matching a 1 GiB file at the default 8 MiB chunk size;
- evidence method: PostgreSQL statement capture around the reservation bookkeeping path plus the existing resumable-upload integration assertions; no wall-clock speedup is quoted.

BEFORE:

- every successful chunk insert called `refreshUploadReservation`;
- that helper selected **all UploadPart rows already recorded for the session** and summed them in Go before one `reserved_bytes` UPDATE;
- 128 sequential new chunks therefore executed **128 full-session UploadPart SELECTs** and materialized **1 + 2 + ... + 128 = 8,256 UploadPart rows** only to maintain the reservation counter;
- idempotent same-hash chunk retries still return before this path, and are unchanged.

AFTER / current:

- the upload transaction already holds the UploadSession row lock and knows the previous part size and the newly committed part size;
- normal chunk inserts update `reserved_bytes` from that byte delta with **0 full-session UploadPart SELECTs**;
- same-size part replacement requires **0 reservation UPDATEs** because received-byte coverage is unchanged;
- invalid or legacy-inconsistent reservation state falls back to the existing full recomputation, preserving capacity safety rather than trusting a bad counter;
- resume-time repair/recalculation, chunk hashing, object writes, quota reservation, session expiry, and finalize semantics are unchanged.

Decision: **Accepted.** Reservation state is a deterministic function of the already locked session counter plus the committed part-size delta, so rescanning every previously received chunk on each new chunk adds no information on the normal path.

Regression budget: a valid active upload must perform **0 full-session UploadPart scans per newly committed chunk** for reservation maintenance. The fallback full scan remains required only for inconsistent reservation state.

Regression command:

- `go test ./internal/api -run '^TestUploadChunkReservationUsesIncrementalBookkeeping$' -count=1`.

Next action: continue ordinary FileExplorer **upload-finalize / download / sync / delete** performance auditing; do not optimize 100k first-open behavior.

 -count=1`;
- `go test ./internal/client -run '^TestNodeChanges' -count=1`;
- `go test ./internal/mount -run '^TestWindowsRemoteJournal(SamePathFileDeleteSnapshotIsBounded|FileDeleteFastPathPrecedesBaselineClone|FileDeleteFastPathPreservesLocalConflict|FileDeletePathDeltaPersistsWithoutFullCurrentMap)$' -count=1`.

Next action: continue ordinary FileExplorer download/sync/delete performance auditing and only change another deterministic request, SQL, allocation, filesystem, lock, or object-store multiplier.


### FileOperation Delete root-update coalescing contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- durable FileOperation Delete execution used by FileExplorer;
- stable workload: **120 top-level sibling files**, each with current File metadata;
- PostgreSQL integration invokes the real `executeQueuedBatchDelete` path and counts only `UPDATE xd_nodes` statements during execution;
- roots are loaded by `batchLoadNodesTx(..., preload=true)`, which takes `FOR UPDATE` locks and validates every requested revision before mutation;
- the BEFORE baseline was validated by the phase-1 authoritative API race run before production code changed;
- wall-clock timing is intentionally not quoted.

BEFORE:

- each root subtree is marked deleted/trash-root with one `xd_nodes` UPDATE;
- each already locked/revision-validated root then receives a second `xd_nodes` UPDATE only to increment root revision/update time;
- **120 roots -> 240 `xd_nodes` UPDATE statements**.

AFTER / current:

- one root-scoped SQL statement marks active subtree rows deleted, assigns `trash_root_id`, increments only the selected root revision, and updates timestamps;
- the same statement carries a root revision precondition and returns whether that exact root was updated, preserving the old defensive revision-conflict outcome even though roots are already locked;
- a selected root already soft-deleted earlier in the same transaction keeps its existing `deleted_at` / `trash_root_id` while still receiving the same revision +1 / `updated_at` mutation as before;
- **120 roots -> 120 `xd_nodes` UPDATE statements**;
- Share revocation remains one statement per root and different roots are intentionally not batched, preserving per-root progress/cancellation checkpoints and trash-root identity.

Decision: **Accepted.** The second root-only statement repeated mutation work already guarded by the selected-root lock/revision validation. Folding it into the subtree statement removes one SQL round trip per root without changing Delete ordering, undo-plan revisions, cancellation checkpoints, or Trash semantics.

Regression budget: Delete execution must perform at most **1 `xd_nodes` UPDATE per selected top-level root**. Root revision mismatch must mutate zero subtree rows and surface the existing `revision_conflict`; an already-deleted selected root must preserve its prior Trash identity while still receiving the revision bump.

Regression commands:

- `go test ./internal/api -run '^TestFileOperationDelete(NodeUpdatesCoalesced|RootsAreRevisionLockedBeforeMutation)$|^TestMarkFileOperationDeleteSubtreePreservesSemantics$' -count=1`.

Next action: continue ordinary FileExplorer **upload-finalize / download / sync / delete** performance auditing; the remaining larger Windows incremental cost is the full baseline clone at journal-page start.

### Resumable upload incremental reservation bookkeeping contract

Status: **Accepted / complexity-only / unmeasured wall-clock**.

Workload and method:

- ordinary resumable FileExplorer upload after a session is created; this is **not a first-open or 100k listing workload**;
- stable structural workload: **128 newly uploaded chunks** in one active session, matching a 1 GiB file at the default 8 MiB chunk size;
- evidence method: PostgreSQL statement capture around the reservation bookkeeping path plus the existing resumable-upload integration assertions; no wall-clock speedup is quoted.

BEFORE:

- every successful chunk insert called `refreshUploadReservation`;
- that helper selected **all UploadPart rows already recorded for the session** and summed them in Go before one `reserved_bytes` UPDATE;
- 128 sequential new chunks therefore executed **128 full-session UploadPart SELECTs** and materialized **1 + 2 + ... + 128 = 8,256 UploadPart rows** only to maintain the reservation counter;
- idempotent same-hash chunk retries still return before this path, and are unchanged.

AFTER / current:

- the upload transaction already holds the UploadSession row lock and knows the previous part size and the newly committed part size;
- normal chunk inserts update `reserved_bytes` from that byte delta with **0 full-session UploadPart SELECTs**;
- same-size part replacement requires **0 reservation UPDATEs** because received-byte coverage is unchanged;
- invalid or legacy-inconsistent reservation state falls back to the existing full recomputation, preserving capacity safety rather than trusting a bad counter;
- resume-time repair/recalculation, chunk hashing, object writes, quota reservation, session expiry, and finalize semantics are unchanged.

Decision: **Accepted.** Reservation state is a deterministic function of the already locked session counter plus the committed part-size delta, so rescanning every previously received chunk on each new chunk adds no information on the normal path.

Regression budget: a valid active upload must perform **0 full-session UploadPart scans per newly committed chunk** for reservation maintenance. The fallback full scan remains required only for inconsistent reservation state.

Regression command:

- `go test ./internal/api -run '^TestUploadChunkReservationUsesIncrementalBookkeeping$' -count=1`.

Next action: continue ordinary FileExplorer **upload-finalize / download / sync / delete** performance auditing; do not optimize 100k first-open behavior.



### Web/Desktop 1 GiB large-transfer baseline

Status: **Measured / Web optimization follow-up approved**.

This benchmark is measurement-only. It follows the performance policy: establish the current production-path baseline first, then change production code only if the same stable workload exposes a material bottleneck.

Stable workload:

- payload: **1 GiB**, one file, loopback HTTP to remove Internet variance;
- Web upload: real production `XDriveApi.uploadWithConflictPolicy`, a real OS sparse 1 GiB file injected into a Chromium file input, 8 MiB resumable chunks, production pre-hash plus upload-time rehash retained;
- Web download: real production `XDriveApi.download` and `xDriveWriteWebDownloadToSink`, writing the 1 GiB response into a real OPFS `FileSystemWritableFileStream`;
- additional Web `download-discard`: identical production fetch/progress/sink call chain with a no-storage writable, used only to separate renderer/fetch allocation from OPFS storage cost;
- Desktop/Agent upload: real shared Go resumable-upload client plus Transfer Manager progress and the production `agentUploadTransferContext` network observer on a sparse 1 GiB filesystem file;
- Desktop/Agent download: real Agent `downloadAgentCloudFileIntoPath` staging path, including temporary-file write, `fsync`, close and final replace;
- fixture creation is outside the timed interval;
- **3 fresh processes per primary surface/direction**, plus 3 Web discard diagnostics.

Predeclared red signals, set before results:

- Web renderer peak working set **>512 MiB**;
- Web renderer working-set increase **>256 MiB**;
- Web JS heap increase **>128 MiB**;
- Desktop/Agent RSS increase **>128 MiB**;
- any 1 GiB loopback sample **>=60 s**;
- upload must transfer exactly **128 x 8 MiB** chunks with no retries; download must stream exactly **1 GiB**.

Measured BEFORE medians [min, max]:

| Surface / scenario | Elapsed | Throughput | Process / renderer memory delta | JS heap delta | Dominant phase |
| --- | ---: | ---: | ---: | ---: | ---: |
| Desktop/Agent upload | **2.373 s** [2.347, 2.390] | **431.6 MiB/s** [428.5, 436.3] | **+19.3 MiB RSS** [19.3, 19.4] | n/a | pre-hash **1.301 s** [1.298, 1.311] |
| Desktop/Agent download | **6.175 s** [5.875, 6.411] | **165.8 MiB/s** [159.7, 174.3] | **+3.2 MiB RSS** [3.1, 3.2] | n/a | streamed file write/fsync path |
| Web upload | **7.914 s** [7.558, 7.974] | **129.4 MiB/s** [128.4, 135.5] | **+927.1 MiB renderer WS** [747.9, 934.3] | **+471.8 MiB** [384.4, 472.5] | chunks **5.841 s** [5.496, 5.968]; pre-hash **2.056 s** [2.000, 2.067] |
| Web download / OPFS | **3.814 s** [3.757, 3.816] | **268.5 MiB/s** [268.3, 272.6] | **+369.1 MiB renderer WS** [361.4, 373.8] | **+313.8 MiB** [290.4, 314.4] | response-stream/write **3.810 s** [3.754, 3.812] |
| Web download / discard diagnostic | **1.142 s** [1.126, 1.193] | **896.4 MiB/s** [858.7, 909.2] | **+975.9 MiB renderer WS** [715.6, 1407.9] | **+227.9 MiB** [208.0, 476.1] | response-stream/write **1.139 s** [1.123, 1.189] |

Payload correctness held in every sample:

- Web/Agent upload transferred exactly **1,073,741,824 bytes**;
- upload emitted exactly **128 x 8 MiB chunks** with no retry/extra payload;
- every download streamed exactly **1,073,741,824 bytes**.

Decision:

- **Desktop/Agent: Accepted / no production change.** RSS is comfortably bounded and runtime is far below the 60 s diagnostic red signal. The upload pre-hash is the largest single Agent phase but there is no memory/runtime red signal that justifies weakening the intentional pre-hash + upload-time rehash integrity contract.
- **Web: red / production follow-up approved.** Upload exceeds both Web memory-delta budgets by a wide margin. Normal download also exceeds both memory-delta budgets.
- The discard diagnostic still exceeds the Web memory budgets even without OPFS writes. Therefore the Web issue cannot be attributed solely to the File System Access storage backend; the next experiment should isolate renderer fetch/chunk allocation and backpressure/GC behavior.
- The next production PR must preserve direct-to-disk behavior, byte progress, resumable upload semantics, full pre-hash plus upload-time integrity verification, and exact payload counts. It must rerun this **same 1 GiB workload** and only be kept if the memory reduction is material and repeatable without a meaningful throughput regression.
- **Do not run 4 GiB yet.** The 1 GiB Web renderer is not memory-bounded enough to justify scaling the workload.

Branch-scoped commands are implemented by the GitHub/GitLab `large-transfer-web-performance` and `large-transfer-agent-performance` jobs on `perf/large-transfer-1gib-baseline`.


## Current 100k local baseline — 2026-10-09

Status: **Measured baseline / no production experiment selected**. Exact measured source: `3a35c385ecc953d31a9ca2b81b75e9be4f569ea2`; the relevant measured FileExplorer sources are unchanged at this follow-up's selected base `d45a894ef19e03b3cdc90dcfde2cd91fef002bbf`. Measurements ran in an isolated detached worktree with unchanged production source, no race flags/suites, and a shared `flock` to serialize benchmark/build loads. This section is freshly measured local evidence, separate from historical CI tables above. No comparable production BEFORE/AFTER speedup is claimed.

### Controller and SQL

| Named workload | Exact scale / sampling | Fresh result | Included layers / budget |
| --- | --- | --- | --- |
| VirtualCollection sweep | 100,000 logical items, viewport 40, pages 200, 2,500 viewport updates; warmup then 5 samples x 10 sweeps | CPU median **110.692 ms/sweep / 44.277 us per viewport**; wall 109.526 ms; **500 page loads / 800 peak / 600 final retained** | Node/V8 controller only; stable structural budget passed, no React/browser/transport/decode. |
| Directory simple-name fixture | 100,000 child Nodes, first/middle 200-row page; warmup + 3 samples | **160.203 / 196.046 ms** medians | Real Gin handler via in-process request helper + PGlite SQL. Existing 500/750 ms gates passed; no browser. |
| Search counted range | 100,000 matching file Nodes, 200 rows; warmup + 3 samples | First/middle **716.662 / 944.693 ms** | Direct production Go helpers + PGlite SQL, no HTTP/browser. Both harness ranges request `includeCount=true`; this is not later count-free viewport coverage. No timing gate in this test. |
| Search cursor | Same 100k namespace / 3 samples | First/middle **629.640 / 559.398 ms** | Direct production Go helpers + PGlite SQL; diagnostic timing. |

The available database was **PGlite 0.5.8**, socket adapter **0.2.11**, PostgreSQL compiled to WASM on isolated loopback port 55439. It is not native PostgreSQL: do not compare these absolute timings to native-PG CI or infer an index/SQL regression. Native-PG count-once and expression-sort A/B histories remain the qualification evidence for those optimizations.

### Synthetic production-bundle Grid replay

Chromium **153.0.8010.0 headless**, original full Web/Desktop renderer bundles, 1280 x 800, 100,000 logical items, 200-row sparse pages. Three fresh browser-context samples per case; 36 paced scroll steps plus midpoint/end/top jumps, native mouse marquee, thumbnail settle. React/ReactDOM 18.3.1 and MUI 7.3.11; reused available dependency installs with own-worktree `@xdrive/ui`, Web Vite 6.4.3 / Desktop Vite 6.1.0.

| Scenario | Web first-grid median [min,max], ms | Desktop renderer first-grid median [min,max], ms | Web / Desktop scripted duration medians, ms |
| --- | ---: | ---: | ---: |
| Image cold | 216.8 [187.6,526.9] | 227.9 [194.0,257.5] | 3271.1 / 3824.4 |
| Image warm | 201.7 [188.2,245.9] | 258.9 [198.8,269.6] | 3203.2 / 3356.1 |
| Video poster cold | 233.1 [189.7,285.9] | 185.0 [181.6,261.9] | 3945.1 / 3148.9 |
| Video poster warm | 246.1 [226.6,258.6] | 242.3 [215.0,444.5] | 3717.5 / 3029.7 |

All **24 samples passed** original structural guards: max mounted **110 (<1000)**, peak retained **1200 (<=1200)**, thumbnail in-flight **6 cold / 1 warm (<=6)**, warm requests **<=230 (<=600)**. Every sample had 14 range changes, 80 initial mounted items, 13 selection commits, and 18 selected. These measurements include real React layout/scroll/selection, scheduler admission, Blob URLs and SVG decode; callbacks replay **12 ms cold / zero warm**. They exclude real JPEG/MP4 generation, Server/DB, Electron IPC and Agent. First-grid clock begins inside the mounted harness and excludes route/bundle startup. Script duration includes intentional pacing and is not a complete 100k traversal/decode time. No fresh Electron RSS/FPS trace was collected. Timing is diagnostic and not comparable with historical Electron/Xvfb samples; no repeatable threshold breach justifies a product change.

### Real image HTTP/store cold and warm

Original `TestFileExplorerMediaServerObjectStorePerformance100K`: **100k image Nodes + 100k metadata-only video Nodes**, **128 physical 800 x 600 JPEG CAS originals**, **102 distinct originals** sampled across three ranges, concurrency **6**. Range offsets 0/50,000/99,800 each use three samples. Includes real Gin/loopback HTTP, production Go JPEG decode/generation and derivative scheduler, `storage.Local`, and PGlite DB; excludes renderer/Agent.

| Scenario | Counted range top/middle/end medians, ms | Thumbnail batch / p50 / p95, ms | Response bytes | Store work |
| --- | ---: | ---: | ---: | --- |
| Image cold | 299.749 / 374.172 / 376.343 | **765.719 / 43.350 / 68.519** | 2,610,039 | 102 original opens / 204 derivative opens / 102 puts |
| Image warm | Same previously measured ranges | **100.413 / 5.200 / 9.185** | 2,610,039 | 0 original opens / 102 derivative opens / 0 puts |
| Legacy video metadata fixture | 279.463 / 362.078 / 370.245 | No media GET | None | 0 opens / 0 puts |

The image cache assertions passed; cold/warm difference describes cache state, not an optimization. The existing `video-icons` case uses fake storage key `perf-video-icon-fallback` and metadata listing only. It does **not** validate current cold preview/codec/poster-backfill or warm persistent-poster behavior.

### Commands, evidence and next action

The scratch root was `/workspace/scratch/4fa175e5d1c9`; commands ran under `flock <scratch-root>/perf-bench.lock`:

- Controller: `XD_FILEEXPLORER_VIRTUAL_COLLECTION_PERF=1 node --expose-gc --test desktop/tests/file-explorer-virtual-collection-performance.cjs`.
- Renderer build per app: `VITE_XDRIVE_FILE_EXPLORER_PERF=1 node node_modules/vite/bin/vite.js build --config vite.config.ts`; explicit Web TS config avoids stale generated `vite.config.js`. Driver: `node <scratch-root>/100k-renderer.cjs`.
- API binary: `go test -p 1 -c -o <scratch-root>/api-100k.test ./internal/api`; isolated adapter: `node <scratch-root>/100k-pglite.mjs <test>` for `TestFileExplorerDirectoryPerformanceBaseline100K`, `TestFileExplorerSearchPerformanceBaseline100K`, `TestFileExplorerMediaServerObjectStorePerformance100K`. Adapter supplies test DB simple protocol and opt-in variables.
- FileExplorer source guards: `node --test desktop/tests/file-explorer-performance.cjs`, **22/22 passed**.

Raw evidence: `100k-renderer-all.json` (24 rows), `100k-renderer-results/*.json`, `100k-controller.log`, `100k-directory-pglite.log`, `100k-search-pglite.log`, `100k-media-server-pglite.log`, `100k-renderer.log`, `100k-structural.log`, with `file-explorer-100k-baseline.md` and reproducible scratch drivers. Optional count-once repeat was interrupted at the parent's request and produced no accepted metric.

Decision: keep controller, Grid, scheduler/cache and image Server production code unchanged. Fresh Windows/CfAPI 100k runtime, Details 100k browser, real browser-to-Server video/LIVP, and end-to-end 100k sync/delete remain unmeasured here; existing smaller structural contracts are not relabeled as fresh 100k wall-time coverage.

The next **measurement-only** extension should reuse `FileExplorerPerformanceHarness.tsx` and `file_explorer_media_performance_integration_test.go` with actual children/media HTTP adapters, not introduce another production optimization. Seed 100k file metadata per dataset with **128 distinct physical CAS fixtures** and sample a bounded working set; do not download 100k originals. Reuse real H.264 MP4 `galleryFirstVisibleVideoMP4Base64` (96 x 64, not a high-resolution codec claim), `fileExplorerMediaPerfJPEG` (800 x 600), existing LIVP archive builders and production `InspectLIVP` validation. Distinct legal MP4 `free`-box variants must be decode-validated to prevent cold requests collapsing into one SHA/cache key.

Cold video must measure actual missing-poster GET -> authenticated preview ticket/stream -> production poster capture -> revision-fenced PUT -> decoded image. Warm uses persisted Server poster with fresh renderer cache and proves zero preview/PUT. LIVP measures real still extraction/derivative-cache -> decoded still and `.livp` glyph, with zero HTTP motion requests during ordinary Grid (not a claim of zero container storage reads). Record first/first12 decode, preview/poster bytes, request/store counters, long tasks, cache state and existing <=6 in-flight / 96 cache / <=1200 retained / <1000 mounted bounds. Web real HTTP first; only actual Electron/preload/Agent ArrayBuffer/poster plumbing can qualify Desktop end-to-end. Declare timing gates before experiments, after runtime variance is understood.

## Current 4 GiB Agent baseline — 2026-10-09

Full local sample values, environment, source revisions and qualification notes are retained in [the baseline evidence record](performance/2026-10-09-local-baselines.json). Current native CI results are recorded separately below.

Status: **Measured baseline / memory budget passed / no production change**. Exact Agent source `62e399f4fd257a49f318e6c223cd697339ca2a27`; only the performance harness was parameterized for size/throughput, fresh sample label and 10 ms RSS sampler. Each direction ran **three fresh test-binary processes**, serialized by the same lock, Go 1.25.0/linux-amd64, Linux 6.18.44, 8 GiB cgroup limit, local overlayfs and loopback HTTP. Source is sparse zero-filled **4,294,967,296 B**. Downloads use the production temporary-file write/fsync/close/final replace. These are not physical-disk, Internet, Server/CAS, Electron IPC or Windows CfAPI results and are not paired with the historical 1 GiB CI environment.

| Direction | Elapsed median [min,max] | Throughput median | Process RSS delta median [min,max] | Additional validation |
| --- | ---: | ---: | ---: | --- |
| Upload | **11.466 s [10.898,11.606]** | **357.2 MiB/s** | **22.48 MiB [21.95,22.49]** | 512 x 8 MiB chunks; pre-hash median 5.908 s; exact payload each sample |
| Download | **2.638 s [2.504,3.098]** | **1552.9 MiB/s** | **2.469 MiB [2.281,3.070]** | Exact payload each sample; one temporary download at a time |

RSS comes from `/proc/self/status` `VmRSS` every 10 ms with ready/join synchronization, initial forced GC, no forced GC during measurement, and final RSS included. Existing **<=128 MiB RSS delta** acceptance passes in all six samples; keep Agent production unchanged. This Agent-only scale-up does not authorize scaling the still-red Web renderer to 4 GiB.

Command per direction/sample: `XD_LARGE_TRANSFER_PERF=1 XD_LARGE_TRANSFER_SIZE_GIB=4 XD_LARGE_TRANSFER_SCENARIO=<upload|download> XD_LARGE_TRANSFER_SAMPLE=sample-<1|2|3> XD_LARGE_TRANSFER_PERF_OUTPUT=<results> <agent-perf.test> -test.run '^TestLargeTransferPerformanceBaselineLargeFile$' -test.count=1 -test.v`, under the shared `flock`. The committed baseline evidence record includes all six rows, source/binary/harness hashes and the benchmark-only harness delta; original scratch artifacts were `agent-4gib/results/summary-provenance.json` and `agent-4gib/harness.patch`. The completed branch-scoped native CI rerun uses the same 4 GiB parameter; its separate authoritative result is recorded below, without substituting it for or claiming a speedup against the local baseline.


## Native CI baselines — PR #1067 (2026-10-09)

Status: **Measured native baseline / structural and memory budgets passed / no production change**. Initial [run 37869011944](https://github.com/lazyxu/xdrive/actions/runs/37869011944) succeeded for both workloads below. The fixed branch base is `d45a894ef19e03b3cdc90dcfde2cd91fef002bbf`, PR head **`95258eb5cc71214536b7a3b491ffaa5174abfa1d`**. Both job checkout logs prove actual tested SHA **`86cf14e1724c1f2bdced4d34be04ec60cea75ed8`**, GitHub's synthetic merge into then-current master **`23b3f216b7e9b37222cbfeb7ff9be2812cad2f87`**. These are integration-tree results, not measurements of the fixed branch head alone. [The committed native evidence record](performance/2026-10-09-native-baselines.json) retains exact sample rows, commands, job/runtime/artifact provenance and checkout evidence. No headless-to-native, PGlite-to-PostgreSQL, 1-to-4-GiB or historical speedup is claimed.

### Real FileExplorer image HTTP/object-store: native PostgreSQL

Job **113622479830**, Ubuntu **24.04.5** runner image **20261004.327.1**, Go **1.25.14 linux/amd64**, native PostgreSQL **17.11** (`postgres:17-alpine`). Original `TestFileExplorerMediaServerObjectStorePerformance100K`, real Gin/loopback HTTP, production derivative scheduling/JPEG decode, `storage.Local`. **100k image Nodes + 100k legacy metadata-only video Nodes**, **128 physical 800 x 600 JPEG CAS originals**, **102 distinct originals** requested across offsets 0/50,000/99,800. One test process; three samples per counted metadata range, one cold and one warm batch; observed peak HTTP concurrency **6** in each batch.

| Scenario | Counted first/middle/end range medians, ms | Thumbnail batch / p50 / p95, ms | Response bytes | Store counters |
| --- | ---: | ---: | ---: | --- |
| Image cold | 137.973 / 125.127 / 207.005 | **737.958 / 39.121 / 65.610** | 2,610,039 | 102 original opens / 204 derivative opens / 102 puts |
| Image warm | Same already-measured image ranges | **36.167 / 1.866 / 4.374** | 2,610,039 | 0 original opens / 102 derivative opens / 0 puts |
| Legacy video metadata | 136.871 / 185.323 / 192.700 | No thumbnail/media requests | None | 0 object-store opens / 0 puts |

Decision: **keep Server image generation/cache production unchanged**. Exact request/response counts, **<=6** concurrency, and cold generation/warm-cache assertions pass. This fixture has no hard numeric latency gate; wall times remain measured diagnostics. Cold/warm differences are cache-state measurements, not a production optimization. The `video-icons` dataset still uses fake storage key `perf-video-icon-fallback` and does not validate the current video preview/decode/backfill path. No browser render or Agent IPC is included. The documented real FileExplorer video/LIVP HTTP benchmark remains the next measurement-only extension.

Command: `XD_FILEEXPLORER_MEDIA_SERVER_PERF=1 go test -run '^TestFileExplorerMediaServerObjectStorePerformance100K$' -count=1 -v ./internal/api`, with the native CI PostgreSQL service. This job's separate Gallery first-56 mixed-media qualification is recorded in [Gallery performance](gallery-performance.md#native-ci-baseline--pr-1067-2026-10-09).

### Agent 4 GiB: six fresh native processes

Job **113622480003**, same Ubuntu runner image, Go **1.25.14 linux/amd64**; **three fresh processes per direction**, no test cache. Payload **4,294,967,296 bytes** in every sample; upload exactly **512 x 8 MiB chunks**. Native Go Agent core and loopback mock HTTP, sparse zero-filled source file, production download temporary-file write/fsync/close/final replace. No real Server/CAS, Electron IPC, Windows CfAPI or external network; underlying runner filesystem characteristics were not collected and these are not dedicated physical-disk bandwidth measurements.

| Direction | Elapsed median [min,max] | Throughput median | Process RSS peak median | RSS delta median [min,max] | Integrity/phase evidence |
| --- | ---: | ---: | ---: | ---: | --- |
| Upload | **10.987 s [10.897,11.073]** | **372.8 MiB/s** | 37.699 MiB | **23.523 MiB [23.469,23.563]** | Exact 4 GiB / 512 chunks; pre-hash **6.054 s [6.041,6.088]** |
| Download | **11.414 s [11.411,11.437]** | **358.9 MiB/s** | 17.648 MiB | **3.414 MiB [3.406,3.504]** | Exact 4 GiB each; one temporary download at a time |

RSS is a **10 ms `/proc/self/status` process sampler**, synchronized at start/end, including final RSS. Initial GC occurs before timing; no forced GC occurs during timing. The existing **<=128 MiB process RSS delta** budget passes in **all six samples**. Byte/chunk correctness is enforced by the test; the memory budget is independently evaluated from emitted rows rather than inferred from a green job. **Decision: keep Agent production unchanged.** Different runtime/filesystem conditions prevent a paired timing comparison against the local 4 GiB or historical 1 GiB results. This does not qualify the separately red Web baseline or authorize a Web 4 GiB run.

Command per scenario/sample: `XD_LARGE_TRANSFER_PERF=1 XD_LARGE_TRANSFER_SIZE_GIB=4 XD_LARGE_TRANSFER_SCENARIO=<upload|download> XD_LARGE_TRANSFER_SAMPLE=sample-<1|2|3> XD_LARGE_TRANSFER_PERF_OUTPUT=<results> go test -run '^TestLargeTransferPerformanceBaselineLargeFile$' -count=1 -v ./cmd/xdrive-agent`. Artifact **11589288631**, SHA-256 `07a42da57edf57d080ba4b5ec14bb4ff4947f31e8f3b48663c8672140fbc918c`, expires 2026-10-16; all six raw rows and provenance remain committed after artifact expiry. The updated evidence must be amended into the same measurement commit and pass the resulting full PR CI before merge.

## Web 1 GiB renderer-memory A/B gate

Status: **Rejected / original Blob-body and native-pipeTo experiment**. The following proposal and 10% timing rule are preserved as historical declarations for `ac4571d5`; the final continuation below uses the stricter fixed 5% median nonregression gate.

The accepted 1 GiB baseline is repeatably red only on Web. Before this production experiment, the acceptance rule is fixed:

- rerun the exact same 1 GiB Web upload / OPFS download / discard workload with **3 fresh renderer processes per scenario**;
- Web median **JS-heap delta must improve by at least 50%** for the scenario whose production path changed;
- Web median **renderer working-set delta must improve by at least 50%** for that scenario;
- preferred steady-state budget remains **<=128 MiB JS heap delta** and **<=256 MiB renderer working-set delta**;
- throughput must not regress materially; a median regression above **10%** rejects the candidate unless paired repeat samples demonstrate hosted-runner noise;
- upload must remain exactly **128 x 8 MiB / 1 GiB** with full pre-hash and upload-time rehash;
- download must remain exactly **1 GiB**, direct-to-disk, cancellable, and progress-visible;
- each candidate is judged separately. A successful upload change cannot justify retaining an ineffective download change, or vice versa.

Candidate A / upload: keep the temporary ArrayBuffer only inside SHA-256 calculation and send the original 8 MiB File-slice Blob through XHR. This preserves the two-pass integrity contract while avoiding deliberate retention of the hash ArrayBuffer as the request body.

Candidate B / download: when the destination is a native WritableStream (the File System Access path), let the browser's Streams pipeline own pull/backpressure via `pipeTo`; a progress TransformStream was intended to preserve byte reporting. The failed-write probe below demonstrated premature progress publication in that candidate. The manual one-write-at-a-time loop remains as the compatibility/test fallback.

If either candidate misses the declared improvement gate, revert that candidate and record it as rejected rather than keeping a speculative production change.


## PR #1063 continuation: reusable Web BYOB buffers

Status: **Accepted / initial paired CI and current 4 GiB passed**. Continue the existing [PR #1063](https://github.com/lazyxu/xdrive/pull/1063), replacing its rejected production candidates; no new parallel implementation is implied. Original baseline PR #1053 merged as `62e399f4fd257a49f318e6c223cd697339ca2a27`. Its measured heads were `e1faa4881417cf5bbdf95ccc346e01f1fbcd3642` and `2ca7f021be433f08db428b87a0d4dbb4c21c8887`; their production and harness trees are identical, with only the recorded performance documentation changed. Final experiments reconstruct original production from immutable `2ca7f021`, then use the corrected ready/start measurement harness identified by `8cfdcd71`.

### Frozen final acceptance before final CI

For each changed upload/OPFS-download scenario, three fresh BEFORE/AFTER renderer samples must satisfy **all** of these requirements: median JS+external heap delta and renderer RSS/working-set delta each decrease **at least 50%**; median peak RSS/working set decreases **at least 25%**; **every** sample-index pair has lower RSS peak and delta; median elapsed does not increase by more than **5%**; heap-delta nonregression remains required (the 50% reduction gate is stricter than the 5% allowance); every 1 GiB sample remains **<60 s**; and **every** candidate sample stays within **512 MiB peak RSS/WS, 256 MiB RSS/WS delta, and 128 MiB heap delta**. Exact payload/chunk counts, upload integrity, awaited-write-before-progress/reuse, cancellation and primary-error preservation remain required. A passing upload cannot justify a failed download. These fixed gates supersede the historical 10% timing declaration above without changing old results. Do not relax a gate after seeing final CI.

No forced GC or artificial `ArrayBuffer.transfer(0)` is used by the final candidate or during measured windows. `performance.memory.usedJSHeapSize` includes V8-accounted external backing storage in this Chromium runtime (the [Chromium memory-info implementation](https://chromium.googlesource.com/chromium/src/+/abe0507666c40/third_party/blink/renderer/core/timing/memory_info.cc) sums used heap and external memory); it is not only object memory and is not identical to process RSS. Older optional **post-result** GC diagnostics are retained in raw records but excluded from every acceptance calculation. Heap and RSS must both improve; reducing one while inflating the other is a rejection.

### Historical hosted runs, including the rejected remote candidate

The table below preserves three samples per scenario from each exact head, including all failed memory values. These are **different workflow runs**, not a same-machine alternating A/B experiment. No speedup is attributed from comparing their timings. The original `ac4571d5e101d943f341afe83655dcdd4625c1ec` Blob upload/native-pipeTo download candidate is **Rejected**, even though the workflow executed successfully.

| Case | n | Elapsed ms median [min,max] | RSS/WS peak MiB | RSS/WS delta MiB | JS + external delta MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| Original e1faa488 / run37865189440 / upload | 3 | 7914.300 [7557.600, 7973.600] | 1056.844 [879.406, 1057.207] | 927.090 [747.906, 934.328] | 471.837 [384.412, 472.494] |
| Original e1faa488 / run37865189440 / download | 3 | 3814.000 [3757.000, 3816.100] | 487.770 [471.336, 489.305] | 368.887 [361.387, 373.785] | 313.765 [290.358, 314.422] |
| Original e1faa488 / run37865189440 / download-discard | 3 | 1142.400 [1126.300, 1192.500] | 1090.891 [827.941, 1534.000] | 975.879 [715.637, 1407.949] | 227.929 [207.948, 476.118] |
| Baseline 2ca7f021 / run37865523278 / upload | 3 | 6185.800 [6178.900, 6542.300] | 1199.781 [1182.863, 1329.910] | 1068.422 [1055.316, 1196.277] | 536.620 [528.608, 600.427] |
| Baseline 2ca7f021 / run37865523278 / download | 3 | 3094.900 [3076.000, 3225.800] | 528.910 [387.871, 608.527] | 412.621 [273.523, 494.375] | 348.462 [210.206, 430.620] |
| Baseline 2ca7f021 / run37865523278 / download-discard | 3 | 870.400 [862.700, 934.300] | 1416.660 [813.180, 1674.551] | 1294.430 [694.316, 1555.133] | 468.169 [308.685, 520.165] |
| Rejected ac4571d5 / run37866968455 / upload | 3 | 5392.600 [5294.800, 6195.100] | 566.742 [505.445, 648.684] | 437.172 [374.047, 533.066] | 456.487 [384.374, 528.623] |
| Rejected ac4571d5 / run37866968455 / download | 3 | 3319.000 [3216.200, 3660.600] | 582.711 [487.207, 703.465] | 470.516 [377.270, 582.387] | 396.515 [316.753, 524.730] |
| Rejected ac4571d5 / run37866968455 / download-discard | 3 | 1139.500 [1038.800, 1139.800] | 931.008 [895.309, 1244.699] | 812.898 [773.766, 1123.367] | 268.198 [215.801, 380.057] |

On ac4571d5 OPFS download, heap delta was **396.515 MiB** versus the original e1faa488 **313.765 MiB** (approximately +26.4%), and renderer delta **470.516 MiB** versus **368.887 MiB** (approximately +27.6%). Neither meets the declared dual-50% reduction gate. Hosted upload heap remained **456.487 MiB**, also below the required improvement. These cross-run numbers establish rejection signals, not causal throughput estimates. Exact source: [run37866968455/job113615882517](https://github.com/lazyxu/xdrive/actions/runs/37866968455/job/113615882517). Complete original launcher JSON and the original job log are archived below.

### Local diagnosis and rejected experiments

The comparable local baseline uses original production plus the ready/start handshake correction, Chromium **153.0.8010.0** headless, Node **24.19.0**, Linux overlayfs, loopback sparse-zero 1 GiB payloads, reused dependencies, and one renderer process. OPFS uses fresh persistent browser contexts to avoid off-record quota limits; discard uses off-record no-storage sinks. RSS is sampled every 25 ms after the initial RSS snapshot and before transfer activation. Existing harness heap sampling and payload counters are retained. Builds and benchmarks are serialized under `perf-bench.lock`. Local numbers do not replace hosted Electron/Xvfb results. Baseline runner/source hashes reconstructed after the runs are labeled as reconstructed, not contemporaneous captures; newer size-parameterized samples carry source/dist hashes.

| Case | n | Elapsed ms median [min,max] | RSS/WS peak MiB | RSS/WS delta MiB | JS + external delta MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| XHR handler cleanup | 1 | 33998.200 [33998.200, 33998.200] | 1626.723 [1626.723, 1626.723] | 1508.160 [1508.160, 1508.160] | 616.216 [616.216, 616.216] |
| ArrayBuffer transfer(0) after hash/request | 1 | 40904.500 [40904.500, 40904.500] | 2930.137 [2930.137, 2930.137] | 2812.035 [2812.035, 2812.035] | 9.222 [9.222, 9.222] |
| Blob body + hash-buffer transfer(0) | 1 | 8613.800 [8613.800, 8613.800] | 2176.355 [2176.355, 2176.355] | 2057.445 [2057.445, 2057.445] | 1.280 [1.280, 1.280] |
| Native pipeTo OPFS, verified local | 1 | 4409.000 [4409.000, 4409.000] | 772.750 [772.750, 772.750] | 655.430 [655.430, 655.430] | 640.311 [640.311, 640.311] |

- **XHR terminal/upload-handler cleanup: Rejected**, n=1. Clearing handlers and capturing primitive body length/signal reduced memory only about 2%, below the 25% minimum. Reverted without expanding a low-value sample.
- **Owned ArrayBuffer transfer(0) after hash or completed XHR/retry: Rejected**, n=1. Heap accounting decreased but RSS and elapsed increased substantially. Reverted; not retained as a final memory mechanism.
- **Blob request body plus hash-buffer transfer(0) in finally: Rejected**, n=1. Low reported heap did not compensate for worse RSS/time. Reverted.
- **Verified native pipeTo OPFS: Rejected**, local n=1. Elapsed 4409 ms was 29.3% above the local original 3409 ms median, with essentially unchanged RSS/heap. This local observation is separate from hosted CI; the 29.3% value must not be attributed to the hosted run. A first-write-failure probe also produced premature progress `[3]` before a failed sink write. The final manual awaited-write loop restores the original contract.
- **Blob-body only upload: Rejected**, verified local n=3. Measured source was the remote `0004927a` candidate. RSS delta improved about 40.8%, while heap delta increased about 43.1%, failing the dual-50% gate. The earlier `transfer-remote-candidate/` directory used an incorrect bundle path and is **invalid** candidate evidence; it is intentionally excluded from this archive.

### Final local 1 GiB BEFORE/AFTER qualification

Upload uses a per-upload **at most 8 MiB reusable BYOB scratch** for hashing while retaining immutable File-slice Blob request bodies. Full pre-hash and upload-time digest checks remain; independent varied-content tests compare native and forced-partial BYOB digests and XHR payloads with Node crypto. Download uses a **1 MiB reusable BYOB backing buffer with default minimum read size (1 byte)**. Each returned view is fully consumed by an awaited destination write before progress or reuse; unsupported byte readers preserve the default-reader path. Partial tails, EOF, abort, lock release, close failure and primary-error preservation are covered. There is no aggregate chunk array.

| Case | n | Elapsed ms median [min,max] | RSS/WS peak MiB | RSS/WS delta MiB | JS + external delta MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| Original local upload | 3 | 36114.100 [35509.300, 40743.100] | 1661.855 [1405.137, 1663.863] | 1542.520 [1286.090, 1545.109] | 632.186 [511.823, 632.241] |
| Blob-body only, rejected | 3 | 6610.800 [6490.600, 8106.100] | 1032.930 [815.270, 1040.168] | 913.820 [696.668, 920.906] | 904.623 [688.320, 904.627] |
| Final reusable BYOB upload | 3 | 6082.300 [5831.000, 6347.000] | 172.434 [171.617, 172.645] | 53.871 [52.961, 55.023] | 19.240 [18.939, 19.313] |
| Original local OPFS | 3 | 3409.000 [3312.100, 3818.200] | 773.938 [757.230, 778.117] | 656.336 [640.062, 660.742] | 638.639 [572.465, 642.702] |
| Full-min BYOB, replaced for latency | 3 | 3240.700 [2953.800, 3632.100] | 186.770 [186.613, 187.164] | 69.574 [69.035, 69.602] | 3.073 [2.990, 3.075] |
| Final default-min BYOB OPFS | 3 | 3305.500 [3114.200, 3828.700] | 189.004 [187.270, 189.395] | 71.910 [70.621, 72.145] | 3.175 [3.173, 3.368] |

Final upload median RSS peak/delta decrease approximately **89.6% / 96.5%**, and heap delta decreases **97.0%**. Final default-min OPFS download median peak/delta decrease **75.58% / 89.04%**, and heap delta decreases **99.50%**. Every sample-index RSS peak/delta pair decreases; all three final samples in each direction satisfy the absolute budgets and exact 1 GiB / 128-chunk upload counts. Upload elapsed is 6082.3 ms and download 3305.5 ms; their median timing gates pass. This is original-then-candidate local measurement, not alternating execution order. Timing is diagnostic; no Internet, physical-disk, Windows or native Electron throughput claim is made.

The initial 1 MiB **minimum-fill** download variant passed memory/timing gates but was **Replaced for measured publication latency**, not kept as a product optimization. On controlled delivery of **32 KiB every 50 ms** (about 5.24 Mbit/s), original first write/progress publication were **52.079 / 102.662 ms**, while full-min first write/publication were **1612.100 / 1612.148 ms**. Removing only the minimum-read option restored **51.502 / 101.906 ms**, matching a fresh original control **51.590 / 102.162 ms**. No adaptive batching policy was introduced. The latency regression first failed at 1619.7 ms and then passed; 14 new/existing download tests pass. Keep the replaced full-min raw samples to explain the choice.

Validation: upload's initial related suite **49/49** passed; independent native/partial varied-fixture integrity suite **45/45** passed. Download's final related suite **14/14** passed, and Web full TypeScript/Vite build passed. A full Desktop suite ran on the full-min predecessor: **1101 passed, 2 failed, 1 skipped**; both failed test files (`shared-image-preview-decode.cjs`, `shared-media-preview-lifecycle.cjs`) could not load absent `react-test-renderer` in the reused install and never reached assertions. This is not a green full-suite claim for final delivery; root's full validation/CI remains required.

Final local delivery validation resolved the already-declared `react-test-renderer` 18.3.1 test dependency and reran the complete normal Desktop suite against the final default-min/download and reusable-upload sources: **1131 passed, 0 failed, 1 skipped** (`node --test --test-concurrency=4 tests/*.cjs`, after the main build). Web TypeScript/performance build, both Desktop TypeScript checks, the CI parity suite, and shell/diff checks passed. Eleven comparator tests cover rejected memory/timing gates, runtime mismatch, exact payloads, nonzero CI exit with retained evidence, and the current 4 GiB budgets. Independent review verified the production source hashes against the measured candidates and found no remaining blocker. Hosted same-run paired CI is still the authoritative acceptance gate.

### Current bounded Web 4 GiB coverage

After bounded 1 GiB qualification, current Web upload and default-min OPFS download each ran **three fresh processes at exactly 4,294,967,296 bytes**. Upload emitted **512 x 8 MiB chunks**, retaining full pre-hash/integrity. Each direction passes all absolute memory budgets and the fixed **<=240 s per-sample 4 GiB elapsed cap**. OPFS quota was preflighted, temporary fixtures cleaned, and about 23 GiB free disk remained. The upload and download bundles have separate hashes because the download-only minimum changed between builds; upload API/transport hashes stayed fixed. Raw records distinguish executed bundle hashes from concurrently observed source hashes.

| Case | n | Elapsed ms median [min,max] | RSS/WS peak MiB | RSS/WS delta MiB | JS + external delta MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| Final Web 4 GiB upload | 3 | 25946.000 [25738.700, 25970.200] | 199.852 [199.137, 200.348] | 80.398 [79.605, 81.758] | 29.977 [22.155, 30.670] |
| Final Web 4 GiB OPFS download | 3 | 13487.800 [13071.200, 14365.100] | 201.656 [201.234, 203.910] | 84.238 [83.914, 85.895] | 5.904 [5.182, 5.905] |

Upload pre-hash median is **8394.5 ms**; download includes production OPFS writing. These are current bounded-workload baselines only: **original Web 4 GiB was not run**, so there is no 4 GiB before/after reduction or extrapolated speedup claim. This is local zero-filled loopback/overlayfs, not native Server/CAS, physical disk, Internet, Desktop IPC or Windows CfAPI. Earlier Linux Agent 4 GiB results are separately documented by the Gallery/Agent measurement follow-up and are not relabeled as Web evidence.

### Authoritative paired CI and durable evidence

**Initial same-run comparison passed on 4ec/deab; reconstructed-head revalidation is required before merge:** same-run Electron/Xvfb original-vs-candidate comparison, using exact immutable baseline/candidate provenance, shared corrected harness, three fresh samples for each upload/OPFS-download/discard scenario (**nine BEFORE + nine AFTER**) and alternating order. Upload and OPFS-download must pass the strict final gates; discard remains a separately reported diagnostic. Only after these gates pass does the same CI job run current-candidate **4 GiB upload/download, three samples each**, with the fixed absolute memory caps and **<=240 s per sample**. Record all original and candidate results plus failed gates here before this performance PR merges. The final size-parameterized 1/4 GiB harness must preserve the 1 GiB comparison workload; larger coverage is additional qualification, not substituted BEFORE data.

All complete local sample JSON, original e1/2ca CI records, nine full ac4571d5 launcher records and original job log, rejection/progress logs, slow-stream probes, full-min replacement evidence, final source/dist hashes, and current 4 GiB samples are archived under [performance-evidence/web-large-transfer](performance-evidence/web-large-transfer/README.md). [manifest.json](performance-evidence/web-large-transfer/manifest.json) records SHA-256 for every evidence file. Copied summaries retain original scratch paths as provenance; the archive's relative paths are the durable locations. Numeric sample values remain unrounded in JSON. Do not use optional post-result GC fields as acceptance evidence or silently omit rejected samples.

### Authoritative paired CI on 4ec31f39 — 2026-10-09

Status: **Accepted / paired performance gate passed**. The [large-transfer-web-performance job](https://github.com/lazyxu/xdrive/actions/runs/37870615110/job/113627600871) completed **successfully at 01:41:28 UTC**, after starting at 01:37:15 UTC. Actual checkout was **AFTER `4ec31f39ec151cd45642ba2c9603d2f78cf82899`**. Immutable `HEAD^` was **BEFORE `deab56e2f7b3489bcc88dea3ed94b5f93fdbcb8e`**; do not relabel this run with the later reconstruction base.

The exact immutable paired script archives that BEFORE tree and overlays **only** the AFTER measurement harness TSX and Electron launcher. It does not overlay the production API, sink or transport. Both builds reuse the same installed dependencies, with the baseline shared-UI package resolving to the archived baseline source. Samples alternate BEFORE/AFTER on odd indices and AFTER/BEFORE on even indices. There were **nine BEFORE + nine AFTER 1 GiB samples**, then **six current 4 GiB samples** only after the strict primary gate passed. Every complete sample reports identical timed runtime versions: **Electron 44.4.5 / Chromium 152.0.7977.130 / Node 24.21.0**. This hosted Electron/Xvfb runtime is separate from the local Chromium153 headless evidence.

All **24** complete launcher records were extracted from the original job log. Scenario/index order was independently matched to the immutable script. Exact payload validation held: each 1 GiB transfer was **1,073,741,824 bytes**, each 4 GiB transfer **4,294,967,296 bytes**, with **128 / 512 upload chunks** respectively. Runtime, byte/chunk checks and both comparison objects were independently recomputed using the **4ec31f39 comparison implementation**; the recomputed JSON exactly equals the original logged comparisons, and both top-level `accepted` values are **true**.

#### Complete same-run 1 GiB comparison

Every distribution below is median [minimum,maximum], n=3; units are stated per row. Values remain unrounded in the archived original sample JSON.

**upload, n=3 per side**

| Metric | BEFORE median [min,max] | AFTER median [min,max] | Change |
| --- | ---: | ---: | ---: |
| Elapsed ms | 7150.900 [7116.000, 7312.700] | 5582.600 [5353.300, 6055.900] | 21.932% decrease |
| Throughput MiB/s | 143.199 [140.030, 143.901] | 183.427 [169.091, 191.284] | 28.093% increase |
| JS + external delta MiB | 464.174 [423.592, 464.185] | 20.320 [20.270, 20.483] | 95.622% decrease |
| Renderer WS peak MiB | 1040.875 [960.973, 1041.871] | 158.961 [157.594, 160.656] | 84.728% decrease |
| Renderer WS delta MiB | 928.008 [847.613, 928.070] | 46.410 [46.027, 46.938] | 94.999% decrease |

**download, n=3 per side**

| Metric | BEFORE median [min,max] | AFTER median [min,max] | Change |
| --- | ---: | ---: | ---: |
| Elapsed ms | 3682.100 [3636.800, 3745.800] | 3450.100 [3449.300, 3509.700] | 6.301% decrease |
| Throughput MiB/s | 278.102 [273.373, 281.566] | 296.803 [291.763, 296.872] | 6.724% increase |
| JS + external delta MiB | 344.146 [330.143, 366.185] | 2.699 [2.670, 2.745] | 99.216% decrease |
| Renderer WS peak MiB | 519.887 [513.840, 541.668] | 183.699 [180.609, 184.160] | 64.666% decrease |
| Renderer WS delta MiB | 412.941 [404.508, 434.957] | 76.012 [71.969, 77.590] | 81.593% decrease |

**download-discard, n=3 per side**

| Metric | BEFORE median [min,max] | AFTER median [min,max] | Change |
| --- | ---: | ---: | ---: |
| Elapsed ms | 1106.100 [1088.500, 1123.800] | 764.700 [758.100, 775.600] | 30.865% decrease |
| Throughput MiB/s | 925.775 [911.194, 940.744] | 1339.087 [1320.268, 1350.745] | 44.645% increase |
| JS + external delta MiB | 429.750 [284.800, 461.761] | 3.310 [3.184, 3.903] | 99.230% decrease |
| Renderer WS peak MiB | 1621.492 [1529.719, 1629.523] | 120.367 [118.988, 120.699] | 92.577% decrease |
| Renderer WS delta MiB | 1514.469 [1422.348, 1522.238] | 13.039 [12.863, 13.266] | 99.139% decrease |

The fixed gates were not relaxed. Upload and OPFS download exceed the required **50% heap/delta and 25% peak reductions**, every individual paired peak/delta is lower, the **5% median elapsed** gate passes, and every AFTER sample meets the **512/256/128 MiB** memory caps and 60 s elapsed cap. The discard path also passes every check, while retaining its diagnostic-only role.

| Scenario | Memory reductions + all paired RSS lower | Heap nonregression | Median elapsed gate | Every sample memory caps | Every sample elapsed cap | Assessment |
| --- | --- | --- | --- | --- | --- | --- |
| upload | true | true | true | true | true | Accepted |
| download | true | true | true | true | true | Accepted |
| download-discard | true | true | true | true | true | Diagnostic, passed |

#### Current-candidate 4 GiB hosted coverage

No original 4 GiB path was measured. These distributions qualify the current bounded implementation and do not claim a 4 GiB before/after percentage improvement.

| Scenario | Elapsed ms median [min,max] | Throughput MiB/s | JS + external delta MiB | WS peak MiB | WS delta MiB | Every sample memory caps / <=240 s |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| upload | 22019.500 [21691.700, 22337.700] | 186.017 [183.367, 188.828] | 32.654 [24.471, 32.669] | 189.070 [187.305, 191.027] | 76.312 [76.027, 79.414] | true / true |
| download | 13507.800 [13498.600, 14300.500] | 303.232 [286.424, 303.439] | 4.582 [4.564, 4.590] | 187.484 [186.887, 188.090] | 80.844 [79.277, 82.301] | true / true |

All six samples pass the unchanged absolute memory budgets and fixed **<=240 s** elapsed cap. Exact bytes, chunk counts and runtime were independently checked above.

#### Provenance and materialization limits

The original artifact is **11590172527**, `web-large-transfer-1gib-4gib`, 15,451 bytes, digest **`sha256:410171ed8de680fbac1290ccf93f63acb59b8ba4ffddb404e017bcff660aaee4`**, associated with this exact head/run. The connector returned a ZIP reference, but its temporary download URL returned **HTTP 403**; the original ZIP and its `provenance.json` were not read. No authentication workaround was attempted.

The durable archive therefore preserves the **complete original job log**, all **24 complete original RESULT records**, both original/recomputed comparison JSON objects, and an explicitly named **`provenance-reconstructed.json`**. That provenance derives from the checkout log, immutable parent/AFTER Git objects, exact paired script and production/harness source hashes. It is **not** represented as the artifact's original provenance file; original artifact host/CPU fields remain unavailable. In particular, baseline API/sink/transport hashes match the original 2ca production, and AFTER API/sink/transport hashes match the locally measured final candidate. Source hashes and limits are retained in JSON.

Archive: [ci-4ec31f39](performance-evidence/web-large-transfer/ci-4ec31f39/provenance-reconstructed.json), [comparison.json](performance-evidence/web-large-transfer/ci-4ec31f39/comparison.json), [current-4gib.json](performance-evidence/web-large-transfer/ci-4ec31f39/current-4gib.json), and [audit-verification.json](performance-evidence/web-large-transfer/ci-4ec31f39/audit-verification.json). Original runtime/error/metric logs and per-side sample directories are alongside them; the global manifest verifies every file.

#### Post-conflict delivery verification remains separate

After Gallery #1067 merged, GitHub reported a genuine canonical-document conflict. The same single work commit was reconstructed on fixed parent **`a1f04f4681dba8e1d55307e09d292ecb880039dc`**, preserving both performance chapters and the final upload/download changes. Parent API additions are MediaSyncFolder methods/types; the transfer changes remain intact. These **4ec/deab** results do not validate that newer commit by attribution alone.

Fresh normal local checks after reconstruction passed Web performance TypeScript/build, both Desktop TypeScript checks/main build, Go CI parity and shell/diff checks. The complete normal Desktop suite is now **1212 passed, 0 failed, 1 skipped** (new parent adds ordinary tests); its log is archived separately from the earlier 1131-pass validation. **Final reconstructed-head full PR CI is mandatory before merge.** Keep this initial successful pair as its own exact-head measurement record; the final run must identify its own BEFORE/AFTER source provenance and strict gates before merge.

Next named performance workloads after this delivery: real 100k subtree delete/trash/restore and Client change-feed consumption; real FileExplorer video/LIVP HTTP+decode in Details/Grid; and the 4 GiB Agent controller/IPC boundary. Existing 100k metadata, replay renderer, and Agent-core results remain labeled by their actual measured layer. Start each extension with a measured baseline before considering a production optimization.


## Home recent/favorite video-poster parity (2026-10-09)

Status: **Implementation candidate / structural correctness, CI pending**. The shared Home page already uses the FileExplorer thumbnail Provider (maximum six active requests, 96-entry revision/updated-at keyed cache and URL leases), but previously the Web and Desktop Home adapters performed only a single persisted thumbnail GET. A cold ordinary video without a cached Server poster therefore had no video-frame fallback and displayed the standard failure surface. The existing FileExplorer and Gallery adapters have a revision-checked cold-frame backfill.

This change reuses the existing `xDriveResolveMediaVideoPoster` resolver on both Home adapters, without adding a new renderer, poster storage class or global work queue. Warm video: **1 cached GET, 0 original-video preview requests/captures, 0 PUT** (unchanged). Cold video: **BEFORE 1 failed thumbnail GET, 0 frame capture, 0 PUT, missing cover; AFTER 1 GET miss, 1 preview ticket and bounded frame capture, up to 1 revision-fenced poster PUT and a usable cover if source decoding succeeds**. Non-video: unchanged one-thumbnail request. These are deterministic source/request-contract counts, **not** wall-clock or network-byte performance measurements. Shared Provider passes an AbortSignal; Web HTTP and Desktop request-scoped IPC abort abandoned warm GETs, and the cold capture receives that signal. Revision-checked backfill remains best effort. Preserve the existing failure UI when even fallback capture is unavailable.

Regression contract: `desktop/tests/shared-home.cjs` asserts both real platform adapter paths use the same resolver, preserve the non-video fast path, pass signals, and use the same persisted-poster and revision-checked source. Native Web/Desktop CI is required before calling this implemented. Follow-up: real H.264/HEVC Home cover latency/bytes and browser/Agent early-abort measurements on the same named workload, not inferred from these code-level counts.

## P0-C — FileExplorer and shared media transfer progress (2026-10-09)

Status: **In progress / cross-platform implementation candidate / native CI evidence pending**. FileExplorer uses the same `XDriveMediaLoadingProgress` and bytes/stage semantics as Gallery/Viewer. Visible thumbnail loads alone subscribe to progress; still/video/Live noninteractive badges remain separate. Existing Web revision-safe thumbnail GET and Desktop sender-scoped viewport requests own cancellation and cache leases; no new transfer-center job, thumbnail radius, source scan or CfAPI/FUSE change.

The only observed BEFORE/stream-prototype benchmark currently available is the **16 MiB synthetic Node 22 same-host microbench** described in `docs/gallery-performance.md`; browser decoded image speed, 100k grid/Details RSS, real Go/Agent transfer bytes and Native Range playback **are unmeasured**. Reuse the native 100k FileExplorer Grid/Details and thumbnail test baselines, add same-fixture BEFORE/AFTER real visible media progress/abort tests, require no extra original-video poster read on warm cache and no non-visible resource subscriptions. No wall-clock or memory improvement is claimed at this stage.

### P0-C updated measurement boundary

The opt-in Web progress collector's original extra TransformStream had high synthetic overhead and was replaced by a direct reader after a measured diagnostic regression. [CI 37934247525](https://github.com/lazyxu/xdrive/actions/runs/37934247525) measured 16MiB Node n3 native 10.562ms vs observed-reader 8.761ms, but Web TypeScript required a DOM BlobPart type narrowing (TS2345) and thus did not pass the full source-exact gate. The new branch-scoped native Chromium HTTP A/B also records request bytes, sampled renderer RSS and CPU ticks; it is **not** a 100k FileExplorer Grid/Details, Agent IPC or physical-device benchmark. Correctness is a must: retain FileExplorer/Viewer thumbnail abort and revision fencing, with no durable task created per thumbnail.

### P0-C browser sampled-memory rejection (2026-10-09)

The [native Chromium HTTP A/B CI 37934997271](https://github.com/lazyxu/xdrive/actions/runs/37934997271) measured a 16MiB `response.blob()` baseline against the progress-observed direct-chunk reader (n=5): sampled renderer RSS growth **28 KiB vs 33,996 KiB** and coarse CPU **1 vs 3 ticks**, despite shorter wall time for the observed variant. This is **real Chromium process/loopback HTTP**, not an actual 100k FileExplorer UI or Desktop Agent comparison. The current reader is **not accepted** under the frozen 32MiB additional-memory budget for that workload. Evaluate native Blob-backed stream forwarding before merge; do not enable full-collection progress subscriptions or change cache quotas to hide the overhead. See [raw sample evidence](performance-evidence/media-shared-progress/ci-run-37934997271-chromium-before.json).

### P0-C selected bounded-observer reader and unmount semantics

The [four-arm native Chromium HTTP trial](performance-evidence/media-shared-progress/ci-run-37936088859-chromium-four-arm.json) showed the direct observed Blob(chunks) branch using 34,216 KiB of sampled renderer RSS growth, while a TransformStream observer required 17,008 KiB in the same 16MiB/64KiB n=5 experiment. Select the latter **only after source-exact CI revalidation**, keeping cached/unobserved requests on the native Blob path. This is not a measured 100k FileExplorer Renderer or Agent IPC speedup.

A FileExplorer/Gallery thumbnail leaving the viewport detaches its own progress callback and aborts abandoned request-scoped transports, but must preserve shared task consumers and persistent transfer/sync/delete tasks. Maintain bounded 6-way Gallery/Explorer concurrency and their existing LRU/URL-lease ownership. Reject any new per-thumbnail durable task, duplicated media request, unbounded retained progress listener or misreported original-file percent.

## P0 100k authenticated Trash virtual-range Go context cancellation (2026-10-10)

**Status: Accepted / 100k native PostgreSQL request-cancellation resource release, n=3 paired; final evidence-amended exact-head CI pending, not yet merged.** Existing #1203 only established FileExplorer children paging cancellation; it did not cover Trash page SQL. The unrelated Desktop Gallery progress probe #1185 remains blocked and is not merged or altered here. The first invalid n=1 diagnostic is retained at [invalid-ci-38014772267.json](performance-evidence/trash-range-go-context-cancel-100k/invalid-ci-38014772267.json): its independent health probe accidentally called the unpaged legacy Trash API, which exceeded PostgreSQL's 65,535 bind limit. That run is explicitly **not** counted as a valid benchmark. The health probe was corrected to request `?range=true` before the valid n=3 baseline below.

**Named measurement boundary:** Real authenticated Gin HTTP `GET /api/v1/trash?range=true&offset=...&limit=200&sort=name&order=asc`, native PostgreSQL 17, 100,000 deleted root file-type Nodes for one owner (25,000 each of `.jpg`, `.mp4`, `.livp`, `.txt` **metadata labels**, not actual photo/video decoding), all with `trash_root_id=id`. Six distinct counted 200-item ranges block on a real ACCESS EXCLUSIVE lock on `xd_nodes`; confirm six PostgreSQL `pg_stat_activity` lock waiters and six live Gin handlers **before** canceling all six HTTP clients. Sample at **+160ms**: HTTP `Request.Context().Done()` callbacks and their timing, active SQL waits, active Handlers, stale response bytes. Unlock and require an independent healthy counted 200-item/100k-range HTTP request. Three independent isolated-schema PostgreSQL17 processes per arm, matched BEFORE/AFTER runs alternating order on the same CI runner. Seed time is excluded from cancellation observation.

**Confirmed unchanged-production BEFORE / first red, n=3:** [CI run 38015359424 / job 114104358503](https://github.com/lazyxu/xdrive/actions/runs/38015359424/job/114104358503), work head `b3d13fb1c74023ee82cd254368d22ad310462b14` and original production parent `a63fe51e2f16c132c1be76b690a72165a44de5c0`, Go integration test `TestTrashRangeRequestContextCancellation100K`. All three full runs **passed the first-red predicate** and their independent recovery check. Raw parsed sample values are permanently archived at [first-red-ci-38015359424.json](performance-evidence/trash-range-go-context-cancel-100k/first-red-ci-38015359424.json).

| BEFORE sample | Six HTTP contexts done by 160ms | Still waiting in native PostgreSQL at 160ms | Active handlers at 160ms | Stale client bytes | Max server context notification (ms) | Seed (ms; excluded) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 6/6 | **6/6** | **6/6** | 0 | 0.189 | 2,748.073 |
| 2 | 6/6 | **6/6** | **6/6** | 0 | 0.139 | 1,987.590 |
| 3 | 6/6 | **6/6** | **6/6** | 0 | 0.136 | 1,964.017 |

**Observed root cause:** `history_trash.go::trashListRange` creates a shared GORM range/count query via `s.DB.Table("xd_nodes")` without binding the current HTTP request context. The HTTP context becomes canceled in ~0.1–0.2ms, but the six native SQL lock waits do not stop and the six Gin handlers continue to retain work. This is confirmed resource retention, not a theoretical race or a page rendering measurement.

**Smallest production experiment:** use `s.DB.WithContext(c.Request.Context())` in the **shared Trash counted/count-free range query builder**, so both primary `Scan` and optional empty-page `Count` inherit cancellation. No new global task cancellation and no changes to uploads, downloads, sync, persistent deletion, shared image derivatives, Gallery viewer/player lifecycle, or the legacy unpaged Trash API.

**Acceptance/rejection gate declared before AFTER:** all three paired BEFORE arms must retain the exact 6/6 waiter + Handler first-red and 6/6 notified HTTP contexts; all three paired AFTER arms must show **0 SQL lock waiters and 0 active Gin handlers at +160ms**, 6/6 contexts notified, 0 stale payload bytes, and still serve the fresh 200-item/100k-count range after releasing the lock. Preserve ordinary API and authorization tests. Because this measures abandoned-request resource release rather than successful throughput, **do not invent latency or percentage speedup**. Retain the production change only after same-runner alternating 3×(BEFORE+AFTER) evidence and full source-exact CI pass; otherwise reject/revert the experiment and record why.

**Measured alternating same-runner paired result (AFTER candidate source `b566306f9ed548423ae7d4be547d8f6f89dfd184`):** [CI run 38016336548 / job 114107316414](https://github.com/lazyxu/xdrive/actions/runs/38016336548/job/114107316414), 3 matched pairs, each using the same copied test harness and separate fresh PostgreSQL schemas. The benchmark job **passed**. Raw six-arm source-exact evidence: [paired-ci-38016336548.json](performance-evidence/trash-range-go-context-cancel-100k/paired-ci-38016336548.json).

| Paired sample (execution order) | BEFORE native SQL waits / live handlers @+160ms | AFTER native SQL waits / live handlers @+160ms | BEFORE/AFTER HTTP contexts Done | BEFORE/AFTER stale bytes | BEFORE/AFTER max context notice (ms) |
| --- | --- | --- | --- | --- | --- |
| 1 (BEFORE → AFTER) | **6 / 6** | **0 / 0** | 6/6 · 6/6 | 0 · 0 | 0.140 / 0.165 |
| 2 (AFTER → BEFORE) | **6 / 6** | **0 / 0** | 6/6 · 6/6 | 0 · 0 | 0.280 / 0.155 |
| 3 (BEFORE → AFTER) | **6 / 6** | **0 / 0** | 6/6 · 6/6 | 0 · 0 | 0.177 / 0.125 |

**Decision: Accepted minimal production context propagation, no throughput speedup claimed.** Every fixed gate passed in 3/3 pairs, with 6/6 SQL+HTTP handlers released instead of retained at +160ms; canceled-HTTP bytes remain zero, and every independent fresh counted range returned 200 items with the 100,000 total. PostgreSQL emitted real `canceling statement due to user request` diagnostics in AFTER runs. No measured renderer FPS, Server peak RSS or download/sync throughput is implied. A subsequent **evidence-amended head must pass complete PR CI before merge**. Go/DB cancellation remains request-scoped; durable Task Center work is unaffected.

**Benchmark command:** `XD_TRASH_RANGE_GO_CONTEXT_CANCEL_PERF=1 XD_TRASH_RANGE_GO_CONTEXT_CANCEL_EXPECT_FIXED=<0|1> XD_TEST_DATABASE_URL=postgres://... go test -run '^TestTrashRangeRequestContextCancellation100K$' -count=1 -timeout=8m -v ./internal/api`. Branch-scoped GitHub/GitLab `trash-range-go-context-cancel-100k-performance` job uses `git worktree` against the frozen parent with the *same copied benchmark harness* for BEFORE, current candidate for AFTER, alternating order to avoid before/after cache ordering bias. Each individual test seeds a fresh schema.

**Next action:** rerun the full source-exact CI on the final evidence-amended single work commit; if green and the PR remains mergeable, linear merge and perform merged-branch cleanup. Web/Desktop real rapid-scroll cancellation, large 4GiB transfers and genuine Live/RAW/media decoding remain unmeasured by this SQL-only experiment.

**P049首轮原生CI无效（Invalid harness，不是产品RED）：** [#38728914893](https://github.com/lazyxu/xdrive/actions/runs/38728914893) 的真实PG17服务已启动、GitHub checkout与依赖配置完成，但在 `node --check desktop/scripts/file-explorer-real-physical-100k-main.cjs` 阶段失败；旧单工作提交 `d88e0d21ef1154958244dd1dcc6ae81994c34839` 意外把 `-test.run` 字符串中的字面 `$'` 解释为JavaScript `String.replace` 后缀插入语法，导致测试驱动语法错误。**没有构造100k夹具、没有有效样本（n=0）、没有任何性能或取消结论**。按原冻结负载、真实媒体和预算只修复测试驱动字符串，保留[不可变无效记录](performance-evidence/file-explorer-mobile-mixed-p049/ci-run-38728914893-invalid.json)；修复后必须重新执行完整真实n3，不能把构建成功算性能通过。

**P049第二次原生执行归档（Invalid harness，不是产品性能RED，2026-10-15）：** 修复JS语法后的准确头 `3ac8059750d5afe457608420f42c2b809f86b12b` 在[原生CI #38729340131](https://github.com/lazyxu/xdrive/actions/runs/38729340131) 成功通过源码契约、真实Web构建、Go原生编译，并完成一组**115,000 SHA不同物理原始CAS文件 / 149,285,128 B / 15,000 Live配对**的真实PostgreSQL17+CAS种子（完整初始化`seed_ms=122498.147`，**不计入视口加载**）。但首屏按文件名排列首先显示`live-motion-*.mov`，生产`mediaThumbnail`对尚未生成海报的视频按契约正常返回HTTP404（日志看到10个），专用FileExplorer测试适配器却未调用真实签名预览→H264原片解码→视频海报JPEG PUT，因此Grid首视口等待超时、**有效视口n=0、未产生任何可比较BEFORE时延**。对应[完整CI #38729340392](https://github.com/lazyxu/xdrive/actions/runs/38729340392)还因新混合分支重命名旧P039源码字符串而使原P039的**静态契约断言**失败（其他主要作业通过，Final Gate按规则RED）；这也不是P039产品回归。修正范围仅为**测试用**共享Web性能适配器的真实视频signed preview读取/浏览器H264帧解码/经生产API PUT/GET视频海报、P039测试兼容断言以及P049首视口不超过原冻结20s的诊断，不改真实产品代码或放宽任何预算。严格保留**BEFORE=Not measured, AFTER=N/A, speedup=N/A**，无真机或PWA成绩。[无效机器记录](performance-evidence/file-explorer-mobile-mixed-p049/ci-run-38729340131-invalid.json)。

**P049 third scoped CI partial, test-only Invalid harness (2026-10-15).** [#38732126413](https://github.com/lazyxu/xdrive/actions/runs/38732126413) source `64b2fd5f77c55d77cb814588e16e4fbc5820a7ad`: real 115k distinct CAS mixed media / n3 true original runner; 15 physically decoded virtual viewports from complete sample-1 Grid+Details and sample-2 Grid were recorded within original budgets (slowest 369.969ms, Go thumbnail HTTP max6, non-canceled5xx0), including actual signed MP4 source video decode, JPEG poster PUT204 and server GET. The next sample-2 **Details** reused the same Server's Grid cache and legitimately required **zero new** H264 captures/PUT for already cached visible resources. The test-only invariant incorrectly required real H264 frame generation/POST in **every** view, not once per independent fixture. Failure occurred after Details viewport measurement but before its JSON row write; complete valid three-fixture n3 remains unavailable. [Immutable partial machine record](performance-evidence/file-explorer-mobile-mixed-p049/ci-run-38732126413-partial-invalid.json) plus [original artifact](https://github.com/lazyxu/xdrive/actions/runs/38732126413/artifacts/11970612923). Correct only the test driver: **cold Grid** must prove signed original decoded frame and CAS poster PUT/readback; **warm Details** may load current authorized cached JPEG without duplicate writes. Retain every 20s/256MiB/6-handler/permission/visible new-ID budget, production code and other performance tracks untouched. BEFORE remains Not measured, AFTER/speedup N/A, PWA device scenarios Not measured until exact full n3 and evidence-head CI pass.

---

## P0 — P051 / M004-e · 390px Mobile Web 真实4GiB非稀疏高熵CAS上传/下载（2026-10-16）

**状态：Accepted original CURRENT n3（原版真实有效，归档后准确证据HEAD/完整CI待验证）；BEFORE=CURRENT，AFTER=N/A、speedup=N/A，生产代码不优化。** P044已测的是1280px宽Web、P045是原生Desktop Agent IPC，P051是新的真实360–390 CSS px窄屏Chromium Web平台；不重复旧负载，也不把不同平台的P50当A/B优化。

**冻结原版样本：** 三个独立PG17/Gin/Local CAS源，各自真实fsync 4,294,967,296B非稀疏AES256CTR高熵文件（分配物理块至少98%、三个源SHA不同），共享生产Web XDriveApi/OPFS执行512次真实签名8MiB PUT和一个GET，源SHA256=CAS/File SHA256，下载完成后≤1MiB有界读取整个4GiB OPFS逐字节校验且验证耗时单列，不混入下载计时。真实BrowserWindow宽390高844，但必须测 `document.documentElement.clientWidth`/`window.innerWidth`在360–390px、Mobile媒体断点命中（外框宽不足以证明窄屏）。P051是Linux Xvfb上Electron承载Web Renderer，不是完整Mobile Web App Frame、不代表Android/iOS实机或OS installed PWA。

**冻结预算与资源：** 独立n=3，每样本上传与下载各≤360,000ms，Go Server与Chromium Renderer RSS增长各≤268,435,456B，HTTP PUT=512/GET=1、4GiB源和CAS SHA一致、OPFS全4GiB逐字节正确、0非取消5xx；记录单方向P50、MiB/s、Go CPU/RSS、Renderer RSS、真实CSS宽、请求及数据完整性，排除源生成和后置OPFS全量核验计时。先测CURRENT：达标则保留原版；有效RED才最小改生产同负载交替n≥3 BEFORE/AFTER复测，改善不稳定或造成内存/IO/正确性回退即Rejected。因物理磁盘不足、编解码或脚本错误应标Blocked/Invalid harness，不伪称产品RED。

**执行与归档：** 原版复用经P044验证的[Web启动器](../desktop/scripts/large-transfer-real-web-cas-main.cjs)和[Go/RSS采样器](../desktop/scripts/real-web-cas-transfer-runner.cjs)，新环境开关`XD_REAL_WEB_CAS_MOBILE_VIEWPORT=1`，仅对[分支P051专用CI](../.github/workflows/real-mobile-web-cas-incompressible-4gib-p051.yml)生效；[Node源契约](../desktop/tests/real-mobile-web-incompressible-cas-4gib-p051-source.cjs)。原始每组sample JSON、summary/source、准确运行与CI artifact须持久写入`docs/performance-evidence/real-mobile-web-incompressible-cas-4gib-p051/`，仍用固定master基线唯一工作提交修订，再跑准确归档HEAD专项与full/final-gate双绿后合入。**原版本负载已真正测得 n3；所有安装PWA与手机真机仍 Not measured。** 本专项不处理Race，也不会在页面切换时终止持续的Task Center用户拥有的上传/下载/同步/删除任务。

### P051真实原版CURRENT n3：原始来源SHA `9f2b6b56b497e19e4fb6526e728d8823b9cecb9f` / native CI #38758949429

| 独立PG17/Local CAS高熵物理源 | 4GiB上传(ms) | 4GiB下载(ms) | 完整OPFS后置验证(ms) | Go CPU(ms) | Go RSS增量(B) | Renderer单方向最大增量(KiB) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| sample-1 | 47,803.5 | 17,587.4 | 23,289.5 | 26,060 | 3,358,720 | 85,820 |
| sample-2 | 47,960.8 | 17,572.0 | 23,033.2 | 26,130 | 5,144,576 | 92,832 |
| sample-3 | 47,323.9 | 17,588.8 | 22,827.8 | 26,110 | 2,932,736 | 85,320 |
| **n3 P50／峰值** | **47,803.5** | **17,587.4** | —（计时后另列） | **26,110** | **5,144,576峰值** | **92,832峰值** |

**真实验证：** 每组真实fsync、物理源分配**4,294,971,392B**、SHA256各不相同；`size=4,294,967,296B`、有鉴权的PUT512/GET1、Server File/CAS SHA与源一致、`downloadDeterministicVerifiedBytes=4,294,967,296`全量正确，3/3均true。真实窄屏Chromium的`innerWidth=390px`、`documentWidth=375px`、断点命中；Linux Electron 44.4.5/Chromium 152.0.7977.130仅承载**Web Renderer**，没有完成真实Android/iOS或installed PWA性能验收。原各方向≤360,000ms、Renderer/Go RSS增长≤256MiB、完整SHA/OPFS预算全部通过。

**结论：原版CURRENT预算内，保持生产文件上传/下载/同步/删除与Race代码完全不变；无匹配AFTER或速度提升百分比。** 与P044宽Web、P045 Desktop Agent不同平台，结果不能当作A/B。初次[原生CI #38758949429](https://github.com/lazyxu/xdrive/actions/runs/38758949429)已成功，[原始GitHub工件](https://github.com/lazyxu/xdrive/actions/runs/38758949429/artifacts/11985756369)另存。永久[完整原始summary+sample1/2/3+source机器归档](docs/performance-evidence/real-mobile-web-incompressible-cas-4gib-p051/ci-run-38758949429/raw-n3.tar.gz)与[可读指标](docs/performance-evidence/real-mobile-web-incompressible-cas-4gib-p051/ci-run-38758949429/metrics.json)已纳入相同唯一工作提交，压缩包SHA256为`7c469635a52ef3df4b4858930add8e5dc18006e0b6c47fbbdd4639d64236a367`。因此需在新证据HEAD上重新进行相同原生真实n3以及完整CI/final-gate；仍保持PR Draft直到双绿，不能把仅原始成功称为Merged。

---

## P0 — P052 / M005-i · Mobile Web 390px + 100k不同物理JPEG CAS虚拟滚动真实Go取消（2026-10-16）

**状态：Accepted original CURRENT n3，归档后准确 HEAD 专项/完整 CI 待验收；BEFORE=CURRENT（原版有效），AFTER=N/A、speedup=N/A，生产代码保持原版。** P039的100k物理JPEG可见渲染已验收但不包含Go取消；P040真实Mounted 390px取消验收只提供16个不同物理JPEG原片。P052独立测量100k真实SHA不同原始JPEG文件 + 浏览器真实滚动→Go Request.Context.Done，避免重复旧负载。生产CSS/Go/Agent/Task Center及Race没有行为改动。

**真实性／样本：** 复用现有100k物理JPEG真正CAS `seedFileExplorerDistinctPhysicalJPEG100K`（80×64 JPEG每个不同SHA、真正Local.Put、SQL persisted COUNT DISTINCT=100000、首/中/尾CAS bytes实际读取并完整JPEG解码），而不是复制metadata到16个物理源；每个Grid/Details × n3 独立PostgreSQL17+Gin/Local CAS来源（共六个不同100k物理样本），生成种子耗时独立记录，不算用户可见取消时延。真实390×844 Chromium BrowserWindow、document.clientWidth 375~390、共享生产`XDriveFileExplorer`虚拟列表/Children API/授权Media Thumbnail，经当前Web AbortSignal取消；只在标识P052 opt-in测试Go HTTP包装器里让六个原片-backed请求先实际发送256B并阻滞1500ms，再对真实滚动后的Go Context.Done、活跃Handler、字节/CPU/RSS采样。不更改生产后端、图片或传输。

**冻结预算（先测CURRENT）：** 6个 Grid+Details 真实n3视口各等到6个原始物理JPEG HTTP流已发256B；滚动到50%视口替换、DOM挂载<1000；取消后≤160ms六条`Context.Done`均通知、六条Handler均退出、活跃Go请求为0、过期额外响应0B、最慢通知≤160ms，真实Auth子页 `offset=50000/limit=200/total_count=100000` 仍正确；Go与Renderer取消窗口RSS增量各≤128MiB并采样CPU。真实物理SHA100k不同、CAS源字节≥50,000,000且3个不同位置确有可解码JPEG，和P040用同样`n3+Grid/Details`计数但不同数据真实性，结果只能在自己新负载内A/B。真实RED先保存原始数据，候选仅微改热点、匹配n≥3 BEFORE/AFTER且性能改善显著无CPU/RSS/IO/正确性回退才保留，否则回退并列Rejected。

**基准与归档：** opt-in工作流[real Mobile Web P052](../.github/workflows/file-explorer-mobile-physical-100k-go-cancel-p052.yml)，[专用合同Node测试](../desktop/tests/file-explorer-mobile-physical-100k-cancel-p052-source.cjs)，复用[P040 Web取消driver](../desktop/scripts/file-explorer-real-web-scroll-cancel-100k-main.cjs)和[真实原始Go/Gin/CAS夹具](../internal/api/file_explorer_real_web_scroll_cancel_performance_integration_test.go)。来源准确native n3之后永久归档六样本/summary/source SHA和run/artifact至`docs/performance-evidence/file-explorer-mobile-physical-go-cancel-p052/`；归档修订保持冻结master上一个工作提交并重新运行准确证据头专项与完整CI/final-gate。此次只研究性能，不触碰Race，也不在页面离开时自动终止用户自己启动的持久上传/下载/同步/删除任务。真OS安装Desktop/Android/iOS PWA及手机真机仍`Not measured`。

**P052 首次源准确CI为 Invalid harness（n=0，不是产品RED）**：初始工作提交 `77273d9c9e1e09a7af59ba203f24b1891d1c050f` 的[原生 #38778285379](https://github.com/lazyxu/xdrive/actions/runs/38778285379)在 `gofmt -l internal/api/file_explorer_real_web_scroll_cancel_performance_integration_test.go` 预检失败；仅 Go 测试用 `map[string]any` 新增字段导致字面量值格式对齐，尚未构造 100k 物理JPEG/CAS、不曾启动浏览器滚动、没有任何取消延迟样本。保留[不可变无效记录](performance-evidence/file-explorer-mobile-physical-go-cancel-p052/ci-run-38778285379-invalid.json)，只修正Go源码格式、保持P052全部原冻结真实CAS/36取消/160ms/0B/128MiB门槛，不做产品优化或把首次失败称性能RED。修复后重新运行同一新负载的原版CURRENT n3。

**P052 2026-10-16 第二轮源准确 Invalid harness（n=0有效取消视口）**：[原生CI #38778786252](https://github.com/lazyxu/xdrive/actions/runs/38778786252)真正完成第一独立 PostgreSQL17/Local CAS **100k SHA不同JPEG**的生成与验证（70,893,376B；种子耗时90,888.799ms），但Web性能入口仍按P040仅16个物理JPEG检查config，故取消计时之前主动退出。**这是测试配置遗漏，不是产品性能RED，不能推测新的Go取消ms。** 保存[原始无效来源JSON](performance-evidence/file-explorer-mobile-physical-go-cancel-p052/ci-run-38778786252-invalid.json)和[CI artifact](https://github.com/lazyxu/xdrive/actions/runs/38778786252/artifacts/11995155658)。仅P052带上测试已有的`xdriveFileExplorerPhysical100k=1`参数，原版P040仍用16原片；100k物理来源、六独立fixture、Go通知≤160ms、+160ms旧Handler0及废弃0B、128MiB门槛不变，后续有效n3决定是否需要优化，生产实现暂不动。


### P052 原版 CURRENT 首次有效物理 CAS + Go 取消样本（2026-10-16）

准确原始测试源码 `a4dc597c5c4507c1cb0b7044146f888a138abd67`，[专项CI #38779915915](https://github.com/lazyxu/xdrive/actions/runs/38779915915) **SUCCESS**，独立真实PG17/Gin/Local CAS六组Grid/Details×n3，各组 **100,000个 SHA 不同的可解码80×64 JPEG原片 / 70,893,376B源负载**（独立schema/CAS根；并不意味着六组之间总共60万种不同编码内容）。实际Chromium 390px外框/375px document，真实DOM滚动到中段、6条受权thumbnail各先发送256B后触发生产前端AbortSignal，Go `Request.Context().Done` 真实通知且Handler退出。

| 独立样本 | Grid 最慢Go通知 | Details 最慢Go通知 |
| --- | ---: | ---: |
| 1 | 14.528ms | 16.200ms |
| 2 | 11.660ms | 17.909ms |
| 3 | 11.485ms | 14.213ms |
| **n3中位** | **11.660ms** | **16.200ms** |

**冻结预算验收**：36/36真实Go Context.Done + 36/36 Handler取消，全部六轮各6/6；160ms后active Handler **0**，过期多发响应字节 **0B**，首片有效实际发出6×256B×6轮 **9,216B**；最慢Go通知 **17.909ms ≤160ms**。全部六组真实认证中段分页每次HTTP200、总数100k、返回200项；最大DOM挂载 **23** (<1000)，Go 160ms RSS增长最大 **12,288B**，Renderer增长最大 **3,080,192B**，每组Go CPU delta最大 **10ms**、Renderer CPU delta最大 **20ms**（部分Go 0ms是采样精度限制，不等于无CPU成本）。真实每组100k JPEG CAS构造耗时72.440–78.953s不计入取消响应时延；Go/Renderer RSS为取消窗口开始与160ms后比较，而非整个100k seed或应用生命周期峰值。

**结论**：所有原版 `CURRENT` 真实性/取消/资源/字节预算通过，**不改生产代码**，AFTER=N/A，速度提升=N/A。首次成功的原始机读 `summary.json` 与 `grid/details-sample-{1,2,3}.json`、`source.txt` 永久归档 [完整原始六样本、summary和source压缩包](docs/performance-evidence/file-explorer-mobile-physical-go-cancel-p052/ci-run-38779915915/raw-n3.tar.gz)（原始压缩包SHA-256 `57f669e110da4d3c6fb95296c89dd4775488f3a12a421a10c418c40da1a0938e`），[可读机器汇总](docs/performance-evidence/file-explorer-mobile-physical-go-cancel-p052/ci-run-38779915915/metrics.json) 与 [原始 Artifact](https://github.com/lazyxu/xdrive/actions/runs/38779915915/artifacts/11995333174)。原始测试源码准确专项 + 完整CI #38779915873（25 success、含Final Gate）已通过；本次归档变更后的新HEAD必须再运行源码准确专项和完整CI/Final Gate后才能Ready/Merge，不把仅历史CI红色Invalid harness误认为产品性能RED。

**设备与范围仍未覆盖**：这是390px Linux Chromium 宿主中的共享Web FileExplorer，不是Android/iOS真实设备、安装态PWA、H264/Live Motion/RAW/HEVC/LIVP取消，也不是100k真实物理Push/Pull同步/GUI删除。既有P039/P040与本负载不等价，不能跨工作负载计算提速；浏览器视口取消不得终止用户拥有的持久上传/下载/同步/删除任务。

---

## P0 — P053 / M005-j · Native Desktop 100k不同真实JPEG物理原片 Go取消（2026-10-16）

**状态：Accepted original CURRENT n3，归档后的准确证据HEAD专项/完整CI待验证；BEFORE=CURRENT，AFTER=N/A，speedup=N/A。** 不重复P037 Linux真实Desktop Agent的100k逻辑／16物理JPEG取消54/54（最慢72.082ms），也不将P052 Mobile Web物理100k取消最慢16.305ms当作Desktop的 BEFORE。P053是独立的**Native Electron Renderer→Preload→Main→Go Agent IPC→实际Gin/PG17/CAS**负载、仅在测试专属环境开关生效，不改生产行为，也不处理Race。

### 真实物理内容、客户端和取消语义

- 每独立PG17/Local CAS来源真实Local.Put **100,000个SHA不同、80×64确实可解码JPEG**（≥50,000,000B、已验收P039/P052的真实物理源构造/SQL COUNT DISTINCT和三点CAS读回），而不是只写元数据；每个种子分离于取消时延计时。共n=3独立来源，每个来源下真实Native Desktop运行三模式：虚拟滚动到50%，切换Files→主页，真实销毁Electron窗口，共**9个Desktop会话与54条已首发256B的受权真实缩略图HTTP**。
- P053测试Go夹具开启单独`XD_FILEEXPLORER_DESKTOP_PHYSICAL_GO_CANCEL_100K_PERF=1`才让100k实体JPEG通过原有测试only慢Body观察器；与P037的16物理源默认及P052的Mobile Web100k测试相互独立。每条下载Body真实首发256B，再测试真实Desktop生命周期变化后到Server `Request.Context().Done`；取消请求作用域，绝不误停持续上传、下载、同步、删除Task Center。
- 真实Go Agent IPC认证登录、CloudRoot、Children真实分页；每模式额外独立Agent查询中间offset50k limit200，`total_count=100000`、HTTP200/200项及账号权限不降低。桌面浏览器是Linux Xvfb真实生产Electron链路，不冒充Windows/macOS本机或OS已安装PWA。

### 冻结性能预算与测量决策

- 原版独立n3×三模式，期待**9/9通过，54/54 Go上下文通知和54/54 Handler真实退出**、最慢通知`≤160ms`、+160ms旧Handler`0`、过时响应多发`0B`，各起始HTTP实发`1536B/会话`。虚拟列表挂载DOM低于1000，每组真实CAS SHA唯一100k、原始源至少50MB、来源字节与HTTP认证正确。
- 记录Native Agent RSS增长≤128MiB，Go Server RSS增长≤256MiB，实际尚存Renderer进程160ms窗口RSS增长≤128MiB；实际Agent/Server CPU ticks、Renderer CPU/RSS开始与+160ms后数值独立归档。销毁模式Renderer进程已经不存在，其后CPU/RSS **Not measured**，不能报告假造0；不把编译、物理CAS种子和首次应用启动计算入Go取消时延。超预算仅在真实性能产品RED时记录根因；候选必须匹配相同来源/环境n≥3 BEFORE/AFTER及CPU/RSS/IO/权限，收益不明显或退化则回退、保留Rejected。
- [仅P053工作分支原生CI](../.github/workflows/file-explorer-desktop-physical-go-cancel-p053.yml)、[P053 Node物理真实性与独立范围契约](../desktop/tests/file-explorer-desktop-physical-cancel-p053-source.cjs)，复用已验收P037的Desktop生产Electron driver和真实Go fixture。将每轮原生9样本/summary/source SHA、CPU/RSS和测试结论写入`docs/performance-evidence/file-explorer-desktop-physical-go-cancel-p053/`、中央台账及六平台矩阵；后续证据修订仍保留冻结master一个工作提交，再执行准确HEAD专项n3和完整仓库CI/final-gate后方可线性合入。

**仍未验收**：Windows/macOS真实Desktop硬件、Desktop/Android/iOS真正已安装PWA、H264/HEVC/RAW/LIVP/Live motion动态媒体取消、100k物理Push/Pull完整同步、GUI删除恢复Undo及实际WAN弱网。所有没有真实设备证据的列继续Not measured。
**P053首次 CI 无效（2026-10-16，Invalid harness，不是产品性能RED）**：精确初始工作头 `ecd7f3bf7ee253bbc38729ec6c9ab1d533a99f43` 的[专项CI #38831272729](https://github.com/lazyxu/xdrive/actions/runs/38831272729) 在 Go gofmt 和 Node source-contract预检之后失败：P053新增的静态测试误将 DOM 选择器名称外围的单引号也要求为源码字面量，实际真实Electron选择器为`[data-xdrive-file-explorer-scroll-host]`。错误发生在Web/Desktop/Agent编译、物理CAS种子与真实取消之前，**n=0、物理数据未生成，没有任何新 Go 取消时延**。仅修正测试用字符串断言并保存[不可变无效JSON](performance-evidence/file-explorer-desktop-physical-go-cancel-p053/ci-run-38831272729-invalid.json)；严格保持100k不同物理JPEG、三独立CAS/9真实Desktop会话、54 Go取消、160ms/0旧Handler/0B、CPU/RSS预算及原版P037/P052合同。复测CURRENT之前不做生产优化。

### P053 原版有效物理 100k JPEG CAS + native Go 取消 n3 实测结果（2026-10-16）

| 样本 | 取消操作 | 最慢Go通知 ms | Context.Done/Handler | 160ms旧 Handler | 过期字节 | DOM | Renderer 160ms RSS / CPU |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | virtual-scroll | 28.087 | 6/6 | 0 | 0B | 29 | 11317248B / 130ms |
| 1 | app-switch | 16.901 | 6/6 | 0 | 0B | 29 | 5656576B / 150ms |
| 1 | window-destroy | 4.220 | 6/6 | 0 | 0B | 29 | N/A（进程已退出） |
| 2 | virtual-scroll | 42.990 | 6/6 | 0 | 0B | 27 | 8630272B / 160ms |
| 2 | app-switch | 17.862 | 6/6 | 0 | 0B | 27 | 9265152B / 160ms |
| 2 | window-destroy | 6.349 | 6/6 | 0 | 0B | 29 | N/A（进程已退出） |
| 3 | virtual-scroll | 50.226 | 6/6 | 0 | 0B | 27 | 3117056B / 150ms |
| 3 | app-switch | 18.695 | 6/6 | 0 | 0B | 27 | 7012352B / 140ms |
| 3 | window-destroy | 4.892 | 6/6 | 0 | 0B | 29 | N/A（进程已退出） |

**P053 首次真实有效 ORIGINAL CURRENT n3（2026-10-16）**：冻结源 `c5219d6d6a79c761a4a5e770e4aef362b723accb` 的原生[专项CI #38831695299](https://github.com/lazyxu/xdrive/actions/runs/38831695299)与[全仓 CI #38831695498](https://github.com/lazyxu/xdrive/actions/runs/38831695498)均 SUCCESS（后者含Final Gate）。三独立 PG17/Gin/Local CAS 每组真实 **100,000 SHA 不同 JPEG，70,893,376B**，每组真实 native Desktop（Renderer→Preload→Main→Go Agent）滚动、切 Home、销毁窗口各一次，共 9 真实会话、**54/54 HTTP Context.Done + Handler 退出**、+160ms旧Handler **0**、额外 stale HTTP **0B**；首发 54×256B=13,824B，最慢通知 **50.226ms ≤160ms**。滚动三轮 **28.087/42.990/50.226ms，P50 42.990ms**；切应用 **16.901/17.862/18.695ms，P50 17.862ms**；关窗 **4.220/6.349/4.892ms，P50 4.892ms**；最大 DOM **29**；Agent postseed RSS峰增 **5,611,520B**、Go Server postseed RSS峰增 **0B**（不是总进程 RSS 为0）、仍存活的 Renderer 160ms RSS峰增 **11,317,248B**；已记录真实 CPU ticks，销毁后的Renderer资源为 **N/A**。9/9 Agent 授权中段分页为200项/总100k。所有冻结预算通过，**保留生产原版，不优化；BEFORE=CURRENT，AFTER=N/A，speedup=N/A**。永久[原始9样本+summary+source](performance-evidence/file-explorer-desktop-physical-go-cancel-p053/ci-run-38831695299/raw-n3.tar.gz)（tar.gz SHA256 `6d6303d7acba46d6d7ad54bc823ca2dd31de3dbf899acc875acc05c6703e8e6a`，Git blob `7fda058f2c02e5190def31dc4c7a4a8ee2f6c393`）、[易读机器指标](performance-evidence/file-explorer-desktop-physical-go-cancel-p053/ci-run-38831695299/metrics.json)、[完整原始 GitHub artifact](https://github.com/lazyxu/xdrive/actions/runs/38831695299/artifacts/12018225428) 可核对，原始 ZIP SHA256 `aacfda97a7ed334fc51120b4fd298f3c082cbf58ee80dd9adfc3b1601b0d3645`。**证据文件更新后的新 HEAD 必须重新跑准确源码专项 n3 和全仓 Final Gate 后方可 Ready/Merged。** P037 只含16个不同物理JPEG，P052是不同客户端，不能跨它们计算提速；同负载 Wide Web、真Windows/macOS以及三种安装态PWA仍 Not measured。

**资源和抽样边界**：上述 Go Server/Agent CPU 为每轮3模式累计的同机实际操作过程样本（不是每次取消独立 CPU），活动 Renderer RSS/CPU 为有效生命周期窗口的原生采样；关闭进程后不可计数。100k JPEG 的真实 CAS 构造/Go fixture 启动时间不计入请求取消时延；真实 CI artifact 另有各 PG/Local CAS 夹具和 Electron 运行原始日志。所有设备 PWA 列按实际 OS 安装要求持续 Not measured。

---

## P054 / M005-k — Wide Web 1440px + 100k DISTINCT physical CAS JPEG Go cancellation (2026-10-16)

**Current state: Accepted original CURRENT n3 (source-exact evidence-amended HEAD native/full CI pending); BEFORE=CURRENT, AFTER=N/A, speedup=N/A; no production optimization.** Freeze independent scope after [P053 #1739](https://github.com/lazyxu/xdrive/pull/1739) merged. This is NOT a repeat of P015 Wide Web 100k metadata + 16 original JPEG cancellation, P039 Wide Web 100k physical decode without cancellation, P052 Mobile Web 390px physical Go cancellation 36/36 max 16.305ms, or P053 native Desktop IPC 100k physical Go cancellation 54/54 max69.986ms. Each has a distinct source/viewport/transport/consumer lifecycle and cannot supply a matched BEFORE.

**Genuine original physical workload:** Production *shared Web FileExplorer* running in real Electron-hosted Chromium with visible **1440×900** BrowserWindow, measured actual DOM document width **1360–1440 CSS px** and NOT Mobile Web breakpoint; Grid and Details each 3 fresh independent PostgreSQL17/Gin/Local-CAS fixtures; **each fixture actually creates and checks 100,000 SHA-256-distinct decodable 80×64 JPEG originals ≥50,000,000 bytes** via proven physical seeder, SQL identity and CAS first/middle/last readback. Real authenticated Children offset50k limit200/total100k after every view; real visible virtual-scroll host at ~50%. Each view must have exactly six genuine signed thumbnail GETs which each actually emit 256B then test-only hold 1500ms; true browser AbortSignal on virtual viewport eviction must reach actual Go HTTP Request.Context.Done & handler exit. Six independent samples / 36 signed real HTTP contexts. Source fixture/seed times explicitly excluded from Go cancellation latency. Web HTTP path only, not native Desktop Agent IPC, installed PWA, or device phone.

**Predeclared frozen original CURRENT budget:** Six of six valid wide Grid/Details ×n3 real viewports; all 36/36 Go Context.Done and 36/36 canceled handlers, +160ms 0 old handlers and 0 stale transferred bytes; each request max notification≤160ms, CPU/RSS of actual Go Server+Renderer native processes during 160ms window captured, growth ≤128MiB each; DOM mount 1..999, actual wide CSS width, 9,216 B actual first 256 B before cancellation; six successful owner-authenticated offset50k/limit200/total100k pages. Storage source each 100k different JPEG physical originals and≥50MB, no mock/sparse 16-only references. Reject any fixture that fails physical truth, width, HTTP, handler ownership, CPU/RSS, byte counts, or page integrity; archive Invalid harness separately from actual Measured RED.

**Measure first** against unchanged production code; when valid original CURRENT passes all frozen bounds, retain unchanged; `AFTER=N/A`, speedup N/A. If a repeatable genuine RED is found, preserve original failing evidence, profile, apply only the minimum performance-only change, compare matched n≥3 original BEFORE/AFTER on same device/data/network, and retain only a meaningful repeatable improvement with CPU/RSS/IO and correctness parity, else revert and record Rejected. Never change Race, durable Task Center upload/download/sync/delete ownership. No real installed desktop/Android/iOS PWAs, Windows/macOS hardware, H264/HEVC/RAW/LIVP/Live Motion playback, 100k physical Push/Pull or GUI deletion, WAN/weak network or durable task cancellation claimed.

**Actual workload command / evidence gate:** branch-scoped [P054 native CI](../.github/workflows/file-explorer-wide-physical-100k-go-cancel-p054.yml) with `XD_FILEEXPLORER_WIDE_PHYSICAL_GO_CANCEL_100K_PERF=1`, real built shared Web and `xvfb-run ... electron desktop/scripts/file-explorer-real-web-scroll-cancel-100k-main.cjs`, [P054 source contract](../desktop/tests/file-explorer-wide-physical-100k-cancel-p054-source.cjs). After a valid CI n3, archive each `grid/details-sample-1,2,3.json`, full `summary.json`, source.txt, 160ms CPU/RSS and source/fixture/renderer logs into `docs/performance-evidence/file-explorer-wide-physical-go-cancel-p054/`, and append exact SHA/native CI/budgets/current-after decision to registry, matrix and this spec. Rebuild the **same one work commit** on frozen baseline with evidence, then rerun exact-evidence-head native and full CI including final-gate before Ready/Rebase merge. No cross-platform pseudo-speedup.

**P054 首轮 Invalid harness（2026-10-16）：** PR原始SHA `164c2fcf1fb67aec1e1f22a7a22ac2d707ae20e5` 的[专项工作流 #38841095304](https://github.com/lazyxu/xdrive/actions/runs/38841095304)无任何作业、在GitHub Actions YAML解析前即失败；源为步骤名称 `P054 original CURRENT: 1440px...` 含未引用的冒号。**100k CAS fixture与Web窗口均未启动，有效n=0，BEFORE=Not measured，AFTER=N/A，非产品性能RED。** 已永久记录[无效CI JSON](performance-evidence/file-explorer-wide-physical-go-cancel-p054/ci-run-38841095304-invalid.json)，仅给步骤名称加 YAML 引号并新增静态合同；原定6×100k SHA不同JPEG物理CAS、36Go取消、160ms/0 Handler/0B、CPU/RSS预算不变。后续重新跑原版 CURRENT，结果未出前不优化生产。

**P054 第二轮 Invalid harness（2026-10-16）：** 首次合法YAML HEAD `1c7cd878ed66ff15bd00d6c1b378a41f98bf5317` 的[专项CI #38841905546](https://github.com/lazyxu/xdrive/actions/runs/38841905546)真正完成Go/共享Web构建及全部Node源码检查，随后首个Grid-sample-1独立PG17/Gin夹具在登录/获取根节点后，以`/me/quota HTTP500` 在100k物理种子**之前**退出：`ERROR: relation "xd_local_push_quota_holds" does not exist (SQLSTATE 42P01)`。根因是最近master在`quotaUsageForUser`新增`xd_local_push_quota_holds`聚合，而P054已冻结的测试schema只AutoMigrate旧模型。**真实物理CAS种子0，Go取消样本n=0，非产品性能RED**。只在测试专用AutoMigrate列表加`meta.LocalPushQuotaHold`并锁定源码回归，绝不改变生产配额/LocalPush，也不放松100k真物理/36Go取消/160ms/0旧Handler/0B/CPU-RSS预算。保留[结构化无效记录](performance-evidence/file-explorer-wide-physical-go-cancel-p054/ci-run-38841905546-invalid.json)与[原始CI Artifact #12020699670](https://github.com/lazyxu/xdrive/actions/runs/38841905546/artifacts/12020699670)，后续重新跑未经修改的产品CURRENT。

### P054 原版有效真实100k物理JPEG Go取消 n3 原始结果（2026-10-16）

| 来源样本 | Wide Web Grid/Details | 最慢 Go 通知 | Go Context.Done/Handler | 160ms旧Handler | 多发响应字节 | DOM | Go 160ms RSS增量 | Renderer 160ms RSS增量 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | grid | 16.888ms | 6/6 | 0 | 0B | 88 | 8192B | 5652480B |
| 2 | grid | 18.541ms | 6/6 | 0 | 0B | 88 | 12288B | 5611520B |
| 3 | grid | 21.533ms | 6/6 | 0 | 0B | 88 | 8192B | 5574656B |
| 1 | details | 15.880ms | 6/6 | 0 | 0B | 30 | 4096B | 4268032B |
| 2 | details | 13.105ms | 6/6 | 0 | 0B | 30 | 0B | 4411392B |
| 3 | details | 13.847ms | 6/6 | 0 | 0B | 30 | 0B | 4235264B |

**P054首轮真实有效原版 CURRENT（2026-10-16）**：来源准确HEAD `a1e2e16d7501142f42b360b7f3eb09d693a63aba` 的 [专项CI #38842569463](https://github.com/lazyxu/xdrive/actions/runs/38842569463)和[完整CI #38842569539](https://github.com/lazyxu/xdrive/actions/runs/38842569539)（25 success/51 skip/Final Gate通过）均成功。**真实1440px Wide Web 生产共享FileExplorer Grid/Details各n3，共6个独立PG17/Gin/Local-CAS数据集，每组10万SHA不同、80×64可解码物理JPEG原片/70,893,376B。** 各轮6条真实签名原片thumbnail HTTP各已发送256B、滚动至约50%触发生产AbortSignal和实际Go Request.Context.Done/Handler退出。36/36 Go取消和Handler终止、最慢21.533ms≤160ms、+160ms遗留0、额外stale0B、初始实际发送36×256=9,216B；Grid三轮16.888/18.541/21.533ms（P50 18.541ms）；Details 15.880/13.105/13.847ms（P50 13.847ms）。document CSS宽1440px、非Mobile断点；全部6轮Owner中段offset50000/limit200/total100k正确；Go/Renderer 160ms RSS增量峰值**12,288B/5,652,480B**，每轮 CPU/网络样本完整。排除源100k CAS种子/页面启动时间，非10万缩略图同时解码，非真OS已安装PWA。**原版通过所有冻结预算，无生产优化，BEFORE=CURRENT，AFTER=N/A、speedup=N/A。** 已永久保存[6组原始JSON+summary+source](performance-evidence/file-explorer-wide-physical-go-cancel-p054/ci-run-38842569463/raw-n3.tar.gz)（tar SHA256 `dd648858af405aab1e3a7dda2e7a1332360319e70811513e9690dc1604d83613`、GitBlob `8cb5979109ea6fc3eb0b300475c73635961d0e07`）与[易读机器指标](performance-evidence/file-explorer-wide-physical-go-cancel-p054/ci-run-38842569463/metrics.json)；原始含六轮Go夹具日志的[CI Artifact #12022196447](https://github.com/lazyxu/xdrive/actions/runs/38842569463/artifacts/12022196447)ZIP SHA256 `dd8790ec4f78bafbaa2ef6ce6625db75e7fea1436cbda80fe04c2198077f9a01`。证据修订后的**新准确HEAD专项/完整CI incl Final Gate待重验**；与P052窄屏Web、P053 Desktop IPC不同负载不能计算跨平台提速；真Windows/macOS、三类已安装PWA、100k物理Push/Pull/GUI删、慢WAN、HEVC/RAW/LIVP和Live Motion仍Not measured。

**采样口径**：160ms窗口的Go/Renderer进程CPU/RSS增量并不等于完整100k原始CAS生成/启动峰值；真实源种入每独立fixture均为≥50MB，抽样主体确属Linux中真实Web GUI而非 native Desktop Agent IPC。标注的已安装PWA/真实OS平台仍Not measured。
