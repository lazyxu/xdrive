## SH-P013 · source-exact 100k 首轮真实结果（2026-10-20）

**工作源码 `cca9875451e60cc991d18b698a55efec7bfc9b65`：** 两项独立专项均 SUCCESS，真实 [PG17 100k meta #39433239426](https://github.com/lazyxu/xdrive/actions/runs/39433239426) 与 [100k 不同 SHA 可解码 JPEG Chromium #39433237016](https://github.com/lazyxu/xdrive/actions/runs/39433237016)。原始 3+6 样本 JSON 与机器字段在 [不可变数字记录](performance-evidence/public-share-grid-parity-shp013/ci-run-39433237016-and-39433239426.json) 中完整归档。

- PG17 三个独立 100k Node/1000×100 页 walk **11314 / 11230 / 11191ms**，P50 **11230ms**；最大 page P95 **13.033ms**、单页最慢 **21.085ms**，每个约 11.32 MB JSON，保持冻结 walk≤60s/P95≤500ms/worst≤2000ms 全绿。**仅元数据，无100k实体 CAS**。
- JPEG 100k 个不同 SHA 的真实可解码 LocalCAS + 有限 public Share 浏览器原件保存。Web1440 n3 first/next P50 **318.885/228.164ms**，CDP Mobile390 n3 **273.335/231.665ms**；6次浏览器会话合计12次原件保存 SHA/名字/字节全部正确；最慢 Web first 323.712ms、next 234.598ms；移动 first 276.616ms、next 234.968ms，全部 ≤2000ms/page/≤5000ms download，0越界/旧行/横向溢出。真实设备、H264/Live Motion/安装 PWA/WAN 未实测。
- 这是一个纯 JSX 视觉构件共享的回归 **CURRENT**，不是同 Runner 原版和候选 A/B；产品速度 BEFORE/AFTER/speedup=N/A，不能把 SH-P012 先前 284ms 与本次 319ms 当已证实回退或加速。既有 SQL/Go/缩略图调度/Transfer/Cancel 原生产热点保持不变，不实施性能优化。
- 同一源码 [完整 CI #39433237019](https://github.com/lazyxu/xdrive/actions/runs/39433237019) 在首轮数字归档时最终门槛尚未完成。若继续证据归档改写工作 SHA，必须**再跑新完整 HEAD** 的这两项 n3 和完整 CI/Final Gate，不能沿用旧绿。历史最初 CI RED 与源断言修正永久保留下文。

## SH-P013 · first exact-head full CI RED and source-oracle correction (2026-10-20)

- Original single-work HEAD `504db606e0df40c5ecd0cd9907713860d3be202c` triggered [full CI #39432292773](https://github.com/lazyxu/xdrive/actions/runs/39432292773). The real `desktop-tests` failed **3 legacy source-only assertions**: old P012 expected literal `width: 72, height: 72` inside PublicShare itself; old thumbnail square-frame test expected literal visual Box inside Owner `FileExplorer.tsx`; old Grid alignment test expected `data-xdrive-file-explorer-grid-name` in Owner. These have intentionally moved to the truly shared `FileExplorerItemPresentation` leaf, while Owner/Public pass correct size props and render the same JSX. Production TypeScript/Web build has separately been successful, but the complete CI is RED and must never be called green.
- Do **not** add fake old literals, regress back to duplicate JSX, remove assertions, or weaken the square/no-rounded clipping/layout invariant. Correct original three tests to check the actual shared visual renderer's width/height/overflow/relative geometry, explicit Owner/Public mounting and Owner thumbnail sizes. Correct in the same one-work commit, preserve all previous original source and evidence, then trigger entirely NEW accurate-HEAD SH-P001 100k PG17, SH-P005 100k physical JPEG and complete 77+ CI/Final Gate. New HEAD performance AFTER/speedup still N/A until actual reruns; prior RED remains evidence. No Race/Go/ZIP/Owner permissions changed.

# SH-P013 · Public Share / Owner 同源 Grid Tile 纯展示结构（2026-10-20）

## 已完成与目标

已合入 #2117（文件/文件夹右键分享）、#2148（独立只读 Share Explorer）、#2158（显式下载分享根文件夹持久 ZIP）、#2233（无密码链接自动展示第一页）和 #2240（Owner+Share 共享文件名与 Details 名称单元格）。当前剩余差距之一：Owner `FileExplorer` 的网格视觉槽与分享页面独立重复实现；后者额外显示边框、圆角偏大，改一边不会同步另一边。

本独立单工作提交仅提取 `XDriveFileExplorerGridTileContent` 到无副作用的 `FileExplorerItemPresentation.tsx`，Owner 和公共 Share **实际调用同一 JSX 组件**。复用图标/缩略图槽的宽高、居中、裁剪、标题两行 Flex 和容器几何。Owner 仍通过自有受权数据注入真实缩略图、Live/状态标识、Owner-only 系统拖出；Public Share 仅注入允许显示的类型图标及原文件名，无账户 JWT、私有 API、写入权限。分享 Grid 外框改为同 Owner 一致的无边框轻圆角；保留原来的分页面板、菜单、移动点按、原文件下载/图片显式预览、密码、到期、撤销与根文件夹 ZIP。不将完整 Owner FileExplorer 装入公开路由。

## AGENTS 性能规则与改动前基线

`AGENTS.md` 已明确强制：先测试原版 CURRENT、冻结预算；未超预算保持原状；仅真实性能 RED 才做最小优化、同 runner/同数据 n≥3 A/B，明显且稳定、资源/正确性不退化才保留，反之回退。无需重复改写规则。

已合入 SH-P012 的真实原版数据：100k PG17 节点/1000页完整 walk P50 10.946 秒、最大分页 P95 12.072 毫秒；100k 不同 SHA JPEG 的 Chromium Web1440 首/后100条 P50 284.417/195.242 毫秒、模拟 Mobile390 244.532/198.417 毫秒；12/12 原件签名下载 SHA/名字/字节正确。来源为 #2240 的 [PG17 CI #39424821034](https://github.com/lazyxu/xdrive/actions/runs/39424821034) 与 [JPEG CI #39424818989](https://github.com/lazyxu/xdrive/actions/runs/39424818989)；当时与其他版本不同 runner，不是生产优化 A/B。本工作纯展示调整，原版性能在预算内，**不改 SQL/Go/传输热点、不宣称速度提升**。

## 本次 CI 冻结验收

- 将新分支列入既有真正 SH-P001 PG17 100k×3、每轮1000个 bounded HTTP 页面：完整 walk ≤60s、分页 P95 ≤500ms、worst ≤2000ms，授权正确、CPU/RSS/HTTP bytes 保留。
- 新 SH-P005 Chromium Web1440 三轮 + CDP390 Mobile 三轮，物理 100k 不同 SHA 可解码 JPEG CAS，每页仅100项、首/下一页 ≤2000ms、12/12 原件下载完整 SHA/名/字节、单次下载 ≤5000ms；不允许上一页残留、横向溢出或无界媒体请求。原图种子排除计时。测量未完成前 AFTER=Not measured、speedup=N/A。
- 77+ 全量 CI（真实 PG17 Go API、Windows/Linux、Web/Desktop、Single Commit、Final Gate）和 GitHub clean 才允许 Ready/Rebase 合并，任何 RED 保留为 RED。

## 继续未完成的明确差距

本切片完成的是**同源视觉容器**，不等于完整 FileExplorer 1:1：完整 DetailsHeader/Row、Grid 行动区域与选择状态、动态可调列、整棵分享子树服务器端搜索/排序、安全 Share 派生图片/视频 Poster/Live still、真实 Live 动态播放、嵌套子文件夹 ZIP、iOS/Android 原生/安装态 PWA/WAN 仍未完成，继续 [#2205](https://github.com/lazyxu/xdrive/issues/2205)。不得用原始32MiB图片 Quick Look 作为100k缩略图自动预取。后续请求取消仅对临时页、缩略图和预览传播 `AbortSignal → Go Request.Context.Done`；显式启动的持久 ZIP/上传/下载/同步/删除任务不能因页面离开被无意取消。不涉及 Race 工作。
