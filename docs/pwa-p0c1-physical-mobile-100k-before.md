# xDrive · P0-C1：390px 真实物理 100k Mobile Web BEFORE 复测

日期：2026-10-21。当前范围是 **P0 静态 App Shell 完成后，评估共享 Files/Gallery 实际重型内容**，而不是基于一次启动测试直接修改产品。严格遵守根 `AGENTS.md` 原有“同条件先 BEFORE → 后优化 → 独立 AFTER，效果显著才保留”规则。

## 冻结完整源码与测试范围

此 Draft 源于整个 `master@0cc3fa29e47051787da699c5fe46c0c659a0483d`，只增加测试分支白名单和本说明。**不变更任何产品 App Shell、Service Worker、MUI、Go、CAS、浏览器用户 API**。不重写现有性能脚本、断言、预算、初始化顺序或假造数据。原有的老测试分支触发器保留，新增本独立分支只为了在当前更近版本重跑原始套件。

三条真实生产渲染/物理 CAS CI 任务（均使用 GitHub Actions 真实 PostgreSQL17、实际 Go API test binary、Web Vite build、原有 Electron Chromium 390px；原始资源来源/范围以各个套件定义为准）：

| 套件 | 源 workflow | 独立样本和观测 |
| --- | --- | --- |
| 100k FileExplorer JPEG Grid/Details | `file-explorer-mobile-physical-jpeg-100k.yml` | 3×100k distinct physical JPEG / 两种视图 × 五虚拟位置、四张首批解码、HTTP/内存 |
| 100k Gallery 115k CAS 混合静态图 | `gallery-web-physical-mobile-100k-viewports.yml` | 3×70k image + 15k video + 15k Live（115k 原件）/ 五位置、四张新增解码、Go/Renderer RSS |
| 100k Gallery H.264 posters | `gallery-mobile-web-h264-posters-100k.yml` | 3×100k mixed CAS、五位置、真实视频 poster 选择与首帧、HTTP 请求/时延 |

每项的**准确 SHA CI 摘要**必须独立生成：包含 runner、Web/Go commit SHA、n、p50/p95 或原套件已有的同等分位数、最差单视口、内存与并发、错误/取消，不把缺失值当 0。只有 workflow 真实输出或 artifact 才能报告指标，**当前首次数据未产生**。旧基线（2026-10-12 左右）只能作为不同源码/runner 的历史参考，不是可比较的 AFTER，也不得由 100k 折算出 PWA 资源预缓存量。

## PWA / 浏览器 / 用户数据边界

- 三套性能 Vite 构建的专项开关**可以跳过 SW 注入**；因此是共享 Mobile Web UI 的 390px Chromium/Electron 性能测试，**不是** iOS Safari 已安装主屏 PWA 的物理冷/热/飞行模式验收。
- 上游 P0-C0 [#2277](https://github.com/lazyxu/xdrive/pull/2277) 的真实 Chrome n=9 App Shell FIRST/WARM/OFFLINE 只测试公开登录启动，不是鉴权后的 100k Files/Gallery 性能。两类证据分别列明，不混作同一 A/B。
- 本阶段只测当前逻辑节点/缩略图等，不用用户私有数据、真实生产网络、JWT/Cookie、账号、AK 或 HAR。100k/115k synthetic fixture 在 CI 内创建、清理；不默认缓存原照片、视频、Live，不触碰 P1 IndexedDB 和 P2。
- 以前已有 React/Chromium Navigation P113/P114 无抖动验证；当前三套 100k 的 decode metrics **不直接等于** Files/Gallery 导航 CLS 或 Go ctx.cancel。导航/请求取消专项另测；性能差时先剖析瓶颈，严禁盲目缓存 100k。
- 生产专属安全验收依用户决定 **按用户决定跳过（未验收）**，但源码权限/隐私/CI 负例不得跳过。

## 合并门槛

此 PR 只把老套件在当前 master 上重新执行，不修改产品来“制造提速”。准确 HEAD 三套真实 PostgreSQL/CAS/Chromium 专项和完整 Web/Desktop/Go Linux+Windows/真实 PG Race/Final Gate、干净可合并状态全部完成，才可以 Ready/Rebase Merge。当前 P0-B2b2b-2a [#2273](https://github.com/lazyxu/xdrive/pull/2273) 仍在做升级上传专用 CI；等它合入后若 master 增加独立代码，需要基于完整最新 master 重验这一准确 HEAD，不能借用旧绿色。P1/P2 继续后置。

## 本次真实 CURRENT/BEFORE 源码准确测试结果（2026-10-21）

上述「数据未产生」仅适用于本 PR 创建时。随后当前冻结源码 `6b951dd7589399ab26add97ce48527a20ca09db9` 的三套原生 Chromium/PostgreSQL17/Go/CAS 专项与 [77-job 完整 CI #39561429946](https://github.com/lazyxu/xdrive/actions/runs/39561429946) 均已 **SUCCESS（Final Gate success）**。当前独立实测如下；它们既没有改变生产源码，也不是 BEFORE/AFTER 配对优化：

| 测试 | 成功 CI | 当前 n=3 汇总 | 量度条件 |
| --- | --- | --- | --- |
| FileExplorer 100k distinct JPEG Grid | [#39561430008](https://github.com/lazyxu/xdrive/actions/runs/39561430008) | **380.026 ms** | 390px 五位置，要求四张可见 JPEG 解码 p50 |
| FileExplorer 100k distinct JPEG Details | 同上 | **362.933 ms** | 同一文件量级，Details p50 |
| Gallery 100k 逻辑 / 115k 物理混合图 | [#39561429867](https://github.com/lazyxu/xdrive/actions/runs/39561429867) | **1724.216 ms** | 70k photo / 15k video / 15k Live，五位置四张新可见静态图解码 + 两次 rAF，独立 fixture 汇总中位 |
| Gallery 100k H.264 poster | [#39561430086](https://github.com/lazyxu/xdrive/actions/runs/39561430086) | **1765.050 ms** | 五位置每位置至少一张新视频 poster，独立 fixture p50 中位 |

三份仅含匿名数值/正确范围/原始 CI job 与 commit 的长期来源档案存放在 `docs/performance-evidence/pwa-p0c1-mobile-100k/`，分别为 `files-100k-distinct-jpeg.json`、`gallery-mixed-100k-115k.json`、`gallery-h264-100k-115k.json`；统一登记在 `docs/performance-test-registry.md`。旧跑批产生的数值必须标注旧源码，不得替换成合并后新代码的同条件 AFTER。Go 进程重启、真实 PWA SW waiting、物理 iPhone、整屏导航 CLS 和 Context.Done 完整取消仍属独立待测工作，不以静态缩略图完成时间顶替。

这三个源头的工作负载并不相同。尤其 H.264 使用同编码片段的合成视频内容，不证明 15k 独立编码真实影片或 Live Motion 视频可连续播放；即使在本 PR 当前源码表现良好，也不意味着一次 100k 全量加载是合理的。
