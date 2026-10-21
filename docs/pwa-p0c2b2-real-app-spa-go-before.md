# P0-C2b2 — 真实登录 Files → Gallery → Files 同文档路由的 Go Context.Done BEFORE

日期：2026-10-21。本阶段只增加可选择执行的 **真实性能测试**，不改任何生产 App/Go/Service Worker/Caddy/HTTPS/缓存/上传下载行为；保留 52px Mobile App Frame、统一 FileExplorer 与 Gallery。与 P0-C2b1 的跨文档 page-leave 不同，本阶段明确要求原 Web `App.tsx` 和真正 Mobile App Header/Sidebar 控件产生路由切换。

## 测试方法

复用已经合入 P048 和 P0-C2b1 的原 Go/Gin + PostgreSQL17 + CAS + Chromium 390px 原测试体系，新的唯一开关为 `XD_PWA_P0C2_SPA_BEFORE=1`。禁止同时启用旧的 page-leave 模式；原有 viewport-scroll 和 page-leave 在不开启此开关时不发生变化。

1. 在 isolated 本地真实 Go fixture 中先创建登录用户与授权 JWT、100k **逻辑图库条目** / 115k metadata nodes。Chromium 使用不带业务 mock 的正式 Web 编译 JS，从 `/#/app/files` 登录入口启动，在当前独立浏览器 origin localStorage 注入这个**仅测试夹具授权**的 JWT，并重新加载原 App；测试进程永远不输出 token/JWT/用户文件。
2. 严格检查实际 Mobile App Frame、52px Header 和原 Files 主 DOM。真实 Electron Chromium `sendInputEvent` 点击原 App Header “打开应用导航”及 Sidebar “图库”，观察 Hash/真实 Gallery 网格挂载，确认 document、main 和 App Shell 没有重建。
3. Go 侧真正 `Request.Context()` 探针确认首屏 4–6 个在途 JPEG HTTP 响应分别已经交付第一个 256B chunk，采集真实 Go 进程和 Renderer CPU/RSS。打开原 Sidebar “文件”，**再次确认全部 JPEG 在点击前仍处于 active，且无提前 Go Cancel**。此准备动作不计入冻结的 160ms “File click → Go Context.Done” 时间；冻结预算不放宽。
4. 标记 Go 计时并在真正 Chromium 执行“文件”真实按钮输入，160ms 后严格检查每个先前 HTTP GET 的 `Go Request.Context().Done` / context.Canceled、active=0、0 后续响应体字节，Go 和 Renderer 峰值 RSS 分别增加不超过 128MiB。再次确认原 Document/Main 身份保持、Gallery 已卸载、Files hash 已进入，并独立请求授权的 `media/items?range=true&limit=100&offset=50000` 返回 200/100k total/100 rows。
5. 同负载、独立运行 3 次，保留完整 source SHA、Go/Chromium 原数字样本与 CI Run provenance；缺失数据必然 RED。只生成匿名数字摘要。新专用 workflow 跑真实 Chromium/Go，而全仓库 CI/Final Gate、源码 Owner 隔离、安全负例也必须通过。

## 局限与后续

这是**首次**同文档、真实 App 控件到 Go 的 P0-C2b2 测量尝试。运行前不宣称通过、没有 BEFORE/AFTER 性能加速数字。100k 是逻辑媒体条目，实际只对首批 4–6 个物理 JPEG HTTP 监视，不能声称 100k 个不同 SHA 原件都被解码，也不代表 H264/Live、iOS Safari/Home Screen、WAN 真实高延迟或持久上传/下载/同步任务的取消。测试不可将短时读请求取消与 Server durable transfer 混淆；新 SW 一直 waiting，不可强制替换正在执行的任务。

本轮必须先有本准确 SHA 的 390px Chrome→Go 真实 n3 专项及完整 CI，再有 GitHub clean、最新完整 master 下 ahead=1/behind=0 才可合并。以后才允许同 Runner matched BEFORE→改一小处生产性能热点→AFTER，收益不明显必须回退；P1 opt-in IndexedDB 和 P2 私人缩略图缓存继续后置。无法接触的生产环境安全验收 **按用户决定跳过（未验收）**，所有源码安全/鉴权负例仍是硬门槛。

## 2026-10-21 · 首次真实 CI RED 的精确分界

源 `55d00add5a8f1ed24cc8724c4c3d67fb0e34ae34` 的 [P0-C2b2 专项 #39592873429](https://github.com/lazyxu/xdrive/actions/runs/39592873429) 首次运行，在真实 Go/PG17 构建以及原源码/Node 负例检查完成后 **RED**：`timed out: actual signed Owner Files App mount`，未进入从 Files 点击图库、Gallery JPEG 取消阶段，不能把此运行记录为 Context.Done 性能失败或伪造数字。首次 RED 及其 CI artifact 均保留。

代码核查另独立确认原组件 `XDriveSidebarNavItem` 实际是 MUI `ListItemButton`（可能为 `div[role=button]`），最初仅查找原生 `button` 的测试驱动选择器不完整。第二版仅扩展测试驱动选择器为 `button,[role="button"]`，不改变生产组件。正式授权 Go `/api/v1/me` 增加严格 HTTP 200 检查，并在保持原 30 秒 bootstrap 超时/原 160ms Go 取消预算不变的前提下，仅输出无 JWT/路径/正文的 DOM 布尔量及错误数量用于诊断真实 App 挂载问题。不得放宽失败条件、自动换成模拟 Gallery 组件或声称已修复。新 HEAD 必须重新经历独立专项和完整 CI。

### 首轮真实 Go fixture 归档证据补充与最小诊断性修正

已从 [#39592873429](https://github.com/lazyxu/xdrive/actions/runs/39592873429) 原样上传的 Go fixture `native-gin-1.log` 观察：真实 100k seed、47 个缩略图预热、`/__perf/config` 和公用 `/api/v1/version` 已发生，但**未出现期待的登录后 `/api/v1/me` 浏览器请求**。第一版先加载 `/#/app/files` 匿名 App、注入本地测试 token 后，又对**完全相同 URL** 调用 `win.loadURL`；Electron 未必进行 React 全文档重启，这与源准确 RED 符合，尚不能据此断定产品 App 有缺陷。最小测试夹具修正：第二次使用 `/?xdriveP0C2OwnerBootstrap=1#/app/files`，强制真正独立文档导航，正式 `App.tsx` 没有该测试 query 分支，仍是原 App；原 Go Owner 200、严格 Files DOM 挂载、真实 UI 路由/Go 160ms 负例全部保留。新准确 HEAD 的结果尚未验收。

### 第二次 RED：真实 Files App 已启动但 Sidebar 导航尚未验收

源 `35687a53864e8bfda6a7ad0271bc449c593e7ef2` 的 [准确专项 #39594406885](https://github.com/lazyxu/xdrive/actions/runs/39594406885) 在真 Go 100k/PG17 fixture、生产 Web 编译、原有源码测试之后 **RED**：`timed out: actual in-document app route gallery`。相较第一次 App mount 超时，独立 query 文档导航已使 App/Files 启动，但首个真实按钮导航仍未被证明成功。这是新测试证据缺失，**还未进入 HTTP Context.Done 性能阶段**，不得虚报 Go 性能。

审查原 `XDriveWorkspaceCompactNavigation` 表明 App Drawer 为 MUI bottom sliding `Drawer`，`ListItemButton component="button"` 在进场动画期间仍可能有非稳定坐标。第三轮修正仅限测试驱动：真实 Chromium `sendInputEvent` 前要求 Drawer role=dialog、原按钮中心点在 viewport 内、由 `elementFromPoint` 真实命中，等待原 enter transition 后再点。超时记录 URL 分类/DOM presence 布尔量，不含 JWT、URL 详情、私有媒体；不通过直接设置 hash、`element.click()` 或放宽取消预算绕开测试。任何后续真 Go/Chrome CI 新 SHA 验证前，保持 Draft。

### 第三次真实 CI RED：真实 App 最新尾页与旧测试首页不一致

准确源 `15136d2487c911a491447525ecfbdca5e92a3dd9` 的 [真实 CI #39596189765](https://github.com/lazyxu/xdrive/actions/runs/39596189765) 通过 Node 源码检查、正式 Web 编译及 PostgreSQL17/Go 构建，并完成原 Files→Gallery 同文档导航，但在等待实际首屏 4–6 个 Go 慢响应进入 Handler 时 **RED**；还没有达到 Files 点击后的 160ms Context.Done 测量阶段，不能报性能成功或失败。

原始归档 `native-gin-1.log` 显示正常产品 Gallery 返回 media/items 200，但首批 thumbnail 全部 HTTP 404；另有正常 App 的文件、任务及智能图库 API 因旧 P048 最小测试库缺表而返回 500。旧 P048 Harness 取默认第 0 页，而真实 Mobile Gallery 会按 captured 升序、`initial_position=latest` 进入 100k 集合最后 100 个条目，原先只给首页 56 条补真实 CAS 原件的夹具无法服务正常尾页。此 RED 不能被解释为 Go ctx.cancel 延迟结果。

仅在 `XD_PWA_P0C2_SPA_BEFORE=1` 的隔离 Go fixture 中，增加正常 App 所需现有数据表迁移，并使用真正 Owner/PG `queryMediaItemRange` 查出和校验尾页 `offset=99900`、`len=100`，只给这 100 条提供真实 JPEG/MP4 CAS 字节并预热图片。保留真实产品 JS、授权与原移动端页面、原生按钮点击、首屏 390px、Go 160ms、流计数、0 冗余字节与 n3；不新增模拟缩略图或产品侧测试开关，不预缓存全部 100k，也不影响旧 P048/P0-C2b1 运行。新增 Node guard 防止回退。新准确 SHA 专项及完整 CI 未通过之前必须保持 Draft；没有 matched AFTER 性能加速结论。

生产环境无法触及的安全验收按用户决定跳过（未验收）；代码级 Owner/权限与真实浏览器/Go 负例不得跳过。

### 第四次真实 CI RED：已确认尾页媒体完整，但 404 仍来自未监测集合

[CI #39598311040](https://github.com/lazyxu/xdrive/actions/runs/39598311040) 准确源 `6c4307f66a83ce1fa3d5745bef3f3d29a2cc8f53`，新 SPA-only PG 表补齐后 Files/People/Pets/Places/Tasks 相关 API 从 500 恢复 200（`/me/quota` 尚有一项独立 500）。真实 CAS 预热尾页 **81 张 JPG/19 视频来源**；正常 UI 的 `media/items` 全部 200，但是随后出现 **25 个不在监测集合的 thumbnail 404**，仍没有 4–6 条慢流，因此本轮 *依然不能衡量 ctx.cancel 的 160ms*。

进一步测试方案：在真实 Owner 和真实 query 的基础上，仅给同一 100k Gallery 的 `first 56` 与 `latest tail 100` 两个有界视口补充真实 CAS 并预热，涵盖首次安装与导航期间可能使用的普通首页和最新锚点页，**不做全库原图预缓存**。新 Go fixture 仅以布尔标志记录最先五条产品 `media/items` 查询形态，和最多 12 条完全由隔离 PG Fixture 生成的未监测 Node 路径，进一步区分首页/尾页与其他排序；不记录登录 Token、实际生产文件名、用户路径或任何外部 URL。真正的路由、Service Worker、Page/Adapter、按钮点击、6 请求调度、Context.Done 的 160ms 硬门槛仍保持原样。新准确 HEAD 专项验证完成前继续 Draft，禁止根据失败或无效数据虚构取消收益。

### 第五次准确 CI RED 与最早日期页修正（2026-10-21）
- `4d4e28ddec3380dbeb452382f73659c69878f262` 的 [真实专项 #39600210345](https://github.com/lazyxu/xdrive/actions/runs/39600210345) 仍在 4–6 条 active JPEG 入场前 RED，不能宣称 Go ctx.cancel 160ms 失败或通过。隔离原始日志实测 `sort_dir=asc, initial_position=latest` → `sort_dir=asc, offset=0` → 后续 offset。浏览器未监测到的 25 个缩略图 Node ID 与 100k 种子每 3650 项重复的最早日期完全吻合，说明夹具将默认 DESC 首屏误当为真实 Mobile ASC 第一页。
- 新测试只在 `XD_PWA_P0C2_SPA_BEFORE=1` 下按正式 Go Owner 授权 `queryMediaItemRange` 读取 captured ASC、unknown_first、offset0、limit100 的最早页，验证 100k 总数、0 offset、100 项，再仅为该页和已完成的最新尾页提供真实 CAS/JPEG 预热。旧 P048 默认场景、正式 App/SW、JWT/Owner、安全、Go 160ms 与 n3 样本仍原封不动；绝不预热所有 100k。
- 同源完整 [CI #39600213866](https://github.com/lazyxu/xdrive/actions/runs/39600213866) 唯一 Desktop tests RED：P067 仍断言旧 `if desktopFileExplorerMixed {` 文本，而实际配套扩展为 `if desktopFileExplorerMixed || p0c2SPAMode {`；保留对真实 `LocalPushQuotaHold` 数据表迁移与两个 opt-in mode 的强制检查，仅调整旧源码形态断言。未删测试、未改基准门槛。
- 当前仍是 BEFORE 实验，没有匹配 AFTER；最新 HEAD 必须独立经过 Chromium+Go+PG17 n3、完整 CI/Final Gate 与 fresh clean，失败时保留 Draft。生产环境专属安全验收按用户决定跳过（未验收），源码负例继续执行。
