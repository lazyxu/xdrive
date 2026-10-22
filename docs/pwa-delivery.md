> **2026-10-22 最新执行状态：** 本文件下方最初的 P0/P1/P2 表格为 **2026-10-12 历史审查快照**，大量“待做”已由后续 PR 合入，不能据此重复开发。最新阶段真相及固定处理顺序请先读 [PWA 五阶段执行/验收台账](pwa-five-stage-execution-20261022.md)。P0 App Shell/双版本与 P1 明确授权只读目录/相册快照均已合入；P2-A 同进程 100k 真实基线 [#2325](https://github.com/lazyxu/xdrive/pull/2325) 已合入，**P2-A2 真正跨进程 [#2329](https://github.com/lazyxu/xdrive/issues/2329) 尚未开发，P2-B 缓存未做，AFTER=N/A**。生产环境无法触达的安全验收一律“按用户决定跳过（未验收）”，不阻塞源码/CI 合并；物理 iOS/Android `NOT RUN`，源码 Owner/ACL/撤销测试不可跳过。

# xDrive PWA 交付审查与强化路线图

**审查基线：2026-10-12，GitHub lazyxu/xdrive master@d7788fb73efc6d5f147b2ed53fd6c991004324ae。** 这是 PWA 专项唯一交付台账；已有移动任务以 docs/mobile-web-followups.md 的 M38–M49/M55/M56 和 docs/mobile-web-platform-matrix.md 为准，不重复实现业务逻辑。每条必须分别写清“实现、组件测试、CI、合并、浏览器验收、真机/物理测量”；未验证不得写完成。

## 已有基础与边界

- Manifest、standalone、稳定 ID/start/scope、192/512 安装图标、Apple Touch Icon、Vite 构建资源和基本 Manifest Node 测试已存在。**Manifest 可用不等于真实安装成功，不等于离线文件访问。**
- Web 的 19 个程序、Hash deep links、全屏动态 App Frame、52px 顶栏、Files/Gallery 共享 Server API/业务 Controller/Range 虚拟化、分块上传/续传基础、下载票据、浏览器 Cache Storage 统计与清理已存在，不得拆分移动后端；Mobile Files 唯一允许的功能差异是内部多标签页。
- **S1 已合入：** [PR #1509](https://github.com/lazyxu/xdrive/pull/1509) 通过完整 [CI #38218498555](https://github.com/lazyxu/xdrive/actions/runs/38218498555) 和 Final Gate，线性合并 `d1b96a01`，临时分支已清理；真机仍待验。
- **PWA-S1 已实装：** assets/icon/web/sw.js、offline.html、web/src/pwaRuntime.ts、desktop/tests/web-pwa-runtime.cjs。安全生产来源才注册 SW；网络优先处理根 SPA HTML，网络失败仅返回公开离线页；除该公开页外不持久缓存任何资源。禁止缓存 /api/*、带鉴权文件、缩略图、原件、Range、下载票据、用户数据/令牌；不自动 skipWaiting、强制刷新或执行后台传输。新增静态资源 Cache-Control，允许禁用 SW 的浏览器继续正常 Web 使用。
- 已有 Caddy XD_DOMAIN 可部署 HTTPS，但生产证书/公网访问和真实 iOS/Android 安装模式结果仍待测。iOS 后台或锁屏传输不保证继续；服务器 Durable Task 与浏览器传输分开。

## P0 — 基础交付前必须通过（12 项）

| ID | 检查与行动 | 当前状态 |
| --- | --- | --- |
| P0-01 | 安全 SW/公开离线页；跨冷启动断网提示、同 hash 重试；不可缓存私有字节。 | S1 已合入、完整 CI 通过，物理设备待验 |
| P0-02 | CacheStorage 全来源隔离：API、媒体、原件、分享、票据、令牌 Network-only；跨账号、退出、撤销和清缓存不可泄漏。 | S1 限定范围；完整测试待做 |
| P0-03 | 发布新版本等待提示、同源多标签页协调、用户确认后更新；传输/编辑/Viewer 中不自动强制 reload。 | S3A/S3D1/S3D2A/S3D2B 已合并；S3D2C 扩展当前窗口媒体编辑与退出提醒；跨窗口仍无可信自动激活许可 |
| P0-04 | Chrome/Android 可用时用户主动安装，iOS 使用 Safari/系统分享菜单引导；已安装/取消/不支持有分支。 | S2A #1516、S2B1 #1557、S2B2 #1560 完整 CI 通过并合并；Chrome 安装资源/离线/登录后 Files 恢复已验，iOS 27/Android 系统安装仍 not-run |
| P0-05 | 真正可信 HTTPS/DNS/证书；SW/Manifest/离线页 MIME、HTTP 状态、缓存头、图标、不错误回退 index.html。 | S2B1 #1557 与 S2B4 #1570 完整 CI / 真实 Chrome 已通过；S2B4 合并 98ffb1f9，验证本机 HTTP 警告与五项公开资源无凭据 HEAD；公网 DNS/CA 与生产 Caddy 仍 not-run |
| P0-06 | 安装图标→登录→恢复 Files/Gallery/Viewer deep link；公开分享、外链与浏览器/系统返回栈区分。 | S2B1/S2B2 Chrome Files 深链接已验；S2B3 #1566 真实 Gin/Postgres/JWT 双账号已通过并合并；S2B5 补登录后 Gallery 冷刷新/后退/前进（待 CI），Viewer/分享、安装图标冷启动仍 not-run |
| P0-07 | 应用在线时区分无网、Server 不可达、401/403、429、超时、取消；消息可重试但不报假成功。 | S3B 已有可取消 Server 诊断；S3C 已接入有限白名单 GET 一次重试；认证/上传/下载和其他接口仍保持原流程 |
| P0-08 | iOS/Android tab 与安装模式的真实任务恢复：上传、下载、任务、Viewer、切 App/锁屏/断网/进程回收。 | 业务基础有，真机 not-run |
| P0-09 | SW 安装/更新、手动刷新或退出时不误取消 Durable Server Task；非持久浏览器上传需重新选文件的情况明确告知。 | S4A/S4B 已完整 PR CI 通过并合并；Web 上传仍需人工重新选文件，真实安装模式和进程回收验收待 S5 |
| P0-10 | 320/375/390/430、899/900、短横屏/安全区/软件键盘/200% 字体/暗色/读屏保留 52px Frame。 | 布局基础有，真机 not-run |
| P0-11 | CI 发布 gate：built sw/offline/manifest 的 MIME/范围、离线 E2E、API bypass、更新/回滚、打包完整性。 | S2B1 新增内置生产 Web 与真实 Chrome SW/离线、API bypass/资源检查作业（待 CI）；更新/回滚、实际证书与安装包完整性仍待验 |
| P0-12 | 保留可复核的 iOS 27 Safari+Home Screen、Android Chrome+Installed、Desktop Chrome/Edge 安装 E2E 记录。 | 真机 not-run |

## P1 — 交付质量和主要场景（16 项）

| ID | 项目与交付验收 | 当前状态 |
| --- | --- | --- |
| P1-01 | M38 8MiB 分块上传恢复：刷新/回收后用户重新选同文件，校验账号、大小/指纹/目标与冲突。 | S4B #1535 代码已合并；S4B2-A 正补真实 Chrome/Gin/PostgreSQL/CAS 单文件断点续传测试，PR 全 CI 与专项真实测试待验证；真机/分组文件夹仍未验收 |
| P1-02 | M39 目录上传：空目录、嵌套、Unicode、相对路径、选择器能力与多文件/ZIP 回退。 | 部分基础有，待验 |
| P1-03 | M41/M42 原生下载、版本与 ZIP：1/4GiB、落盘哈希、Range、票据撤销/过期、取消和重试。 | S4C1 #1538 与 S4C2 #1545 已完整 CI 通过并合并；真实 Chromium/Gin/PG17/CAS→OPFS 1GiB 全字节回读通过（#38239794346）；4GiB、原生下载落盘 SHA 与真机待验 |
| P1-04 | 视频、Live/RAW、图库 Viewer 后台、恢复、seek、播放拒绝、旧播放器停用和 100k 列表滚动。 | 部分已有，真机待验 |
| P1-05 | display-mode/standalone 能力检测与安装模式诊断，不依赖 UA 猜测。 | S2A 已编写显示模式/显式 HEAD 诊断；CI/真实运行状态待验 |
| P1-06 | visibilitychange、pageshow/pagehide、network 变化恢复任务，避免旧请求和意外取消。 | S3A 更新提示已合并；S4D1 #1551 完整 CI 通过并合并，前台可见时只刷新 Server 权威任务状态；真机进程回收与本地上传仍待验 |
| P1-07 | 多标签/多账号登录、退出、刷新、撤销与 SW 更新状态一致，不广播 Token。 | 待验 |
| P1-08 | 浏览器配额/Storage Manager/CacheStorage 清理与可清退说明；清缓存后离线页重装。 | 统计/清理已有，待验 |
| P1-09 | M44 出站文件字节系统分享：canShare({files})、用户手势、取消、真实接收与下载回退。 | 链接分享已有，字节验收未完成 |
| P1-10 | 仅用户明确授权才规划通知；区分任务失败/完成，撤销及频率/隐私策略。 | 未实现 |
| P1-11 | maskable 安全区/Apple 图标、启动颜色、亮暗主题、CSP 与图标实测。 | 基础资产已有，待验 |
| P1-12 | PWA 冷/热启动及更新成本、离线页体积、CPU/RSS/请求；10k/100k 要先测量再优化。 | 部分性能专项已有，PWA 待测 |
| P1-13 | VoiceOver/TalkBack、键盘/外接输入、200% 字体、减弱动画、焦点与错误朗读。 | 基础部分有，真机待验 |
| P1-14 | 自建实例安装/HTTPS/诊断/清缓存/SW 卸载与回滚文档。 | 基本部署文档有，PWA 专项待完善 |
| P1-15 | M43 公开分享：密码、到期/撤销、计数、下载，SW 不能留下用户数据。 | 业务部分有，PWA 验收待做 |
| P1-16 | Web/Mobile Web Files 与 Gallery 真实功能等价、虚拟化 Range/取消/权限；只有 Mobile 内部文件多标签例外。 | 共用业务基础有，安装模式待测 |

## P2 — 可选新增能力，**不阻断基础 PWA 上线**（10 项）

| ID | 产品增强 | 必要前提 |
| --- | --- | --- |
| P2-01 | 手动 Keep Offline / Pin 文件 | 先定义账号隔离、容量、清退、版本、回收和撤销；默认不可自动缓存隐私文件 |
| P2-02 | 真正离线浏览、修改和冲突合并 | 独立授权/队列/版本安全，不能复用公共离线页面冒充 |
| P2-03 | Web Push | 显式通知权限、Push/Service Worker 和受保护订阅/撤销后端；iOS 主屏模式实测 |
| P2-04 | App 图标 badge | 权限、可信未读计数和浏览器能力检测 |
| P2-05 | 接收系统分享 M48 / share_target | 真实平台入口、目标选择、文件处理权限和上传确认；不支持则回退 picker |
| P2-06 | 快捷方式、系统文件处理器 | 仅开放真实 Files/Gallery 路由，处理权限与跨浏览器差异 |
| P2-07 | 启动截图、Splash、原生图标蒙版 | 自有品牌资源，物理设备检查 |
| P2-08 | 媒体会话/系统锁屏控制 | 已有单播放器行为验证后再接入，不能保证后台持续播放 |
| P2-09 | Web 后台周期同步/大文件长传 | 不能承诺 iOS 锁屏/杀进程后继续；长任务交给 Server |
| P2-10 | 多用户不同 PWA 安装实例 | Manifest ID、浏览器 profile 和 Origin 隔离经用户同意后单独设计 |

## PWA-S2A · 安装入口与能力诊断（2026-10-12）

**S2A 已合并：** [PR #1516](https://github.com/lazyxu/xdrive/pull/1516) 经完整 [CI #38221562395](https://github.com/lazyxu/xdrive/actions/runs/38221562395) 与 Final Gate 合并为 `99b58378`，临时分支已清理。真机安装尚未执行。登录页和账户菜单新增“安装 xDrive”入口；打开时按需加载一个共享的响应式 MUI 安装对话框，不新增 Web App route、不影响 52px App Frame。页面尽早订阅 `beforeinstallprompt`，只在浏览器真正提供该事件时显示原生安装按钮，必须由用户点击直接调用一次 `prompt()`；接受、取消、失败和未知结果分别展示，不能从普通 browser tab 推断“未安装”。

iOS 27 Safari 无 JS install prompt，按 Apple 官方指南显示“页面菜单/分享 → 添加到主屏幕 → 打开作为 Web App → 添加”；Android/桌面 Chrome/Edge 在未提供 prompt 事件时显示浏览器菜单指引，不创建失效按钮。**能力由浏览器事件、安全上下文、`display-mode` 与 `navigator.standalone` 实际观察**，UA 仅选用中文引导语，不作为功能授权或浏览器黑名单。

“检查安装环境”仅在显式点按后，向同源公开静态资源 `/site.webmanifest`、`/sw.js` 请求 `HEAD`，带 `credentials:'omit'`、`cache:'no-store'`、`redirect:'error'`，检查 HTTP 200、正确 MIME、更新缓存头以及浏览器 `isSecureContext`。可以识别代理把静态资源误返回为 HTML，但不能把安全上下文误宣称公网证书/DNS/设备安装验收通过。模块不读写登录 Token、私有 API、图片、上传任务或下载票据；不新增 SW 私有缓存或后台任务。

**验证层：** 独立 Node install prompt/模式/同源无凭据 HEAD/HTML 错误回退测试通过；接入 Web Auth/账户菜单/路由的源代码回归属于交付门槛。完整 Web 构建、PR CI、浏览器/真机安装是分开的阶段。S2B 仍需真实 Android/iOS Home Screen/standalone 启动、HTTPS 证书与深链接外链/返回的端到端验收；S3 才能增加更新/弱网恢复策略。

## PWA-S3A · 无中断更新观察及浏览器弱网提示（2026-10-12）

**S3A 已合并：** [PR #1520](https://github.com/lazyxu/xdrive/pull/1520) 经完整 [CI #38223457496](https://github.com/lazyxu/xdrive/actions/runs/38223457496) 和 Final Gate 合并为 `aa590f61`。在普通 Web App 启动时订阅同源 Service Worker 注册、首次注册完成、`updatefound` / `statechange`、`controllerchange`、`pageshow` 和浏览器 online/offline 提示。只在用户打开“安装与运行环境”时按需显示“版本与网络”；显式点击“检查新版本”会调用浏览器 `registration.update()`，**不** `skipWaiting`、不 `clients.claim`（S1 原有 activate 行为不变）、不自动重载、不中断传输、Viewer 或编辑工作。通过仅包含固定事件名的 BroadcastChannel 将“其他窗口发现更新”作为提醒，当前窗口仍须自行检查，绝不广播 Token、账号、设备信息、业务状态或凭证。若显示 waiting，只提供人工确认的安全更新步骤：结束所有前台操作并关闭同源窗口后由浏览器控制新 SW 激活，不暗示点击确认即完成更新。

**未完成：** S3B 需建立 Server 可用性检测、取消/拒绝/超时/429 的请求级分流和具实测预算的安全重试；必须由 Files/Gallery/Transfer/系统依赖统一提供“无进行中上传/下载、无未保存编辑、无 Viewer、无其他窗口正执行任务”的**可信可取消条件**后，才能讨论一键确认激活。当前实现既不绕过这些门槛，也不能宣称强制退出后浏览器任务仍会继续。S4 再验证 8MiB 上传分块恢复、真实大文件下载、前后台/锁屏与 Server durable task 边界。仅模拟 JS 事件的 Node 测试不能替代 Chrome/iOS/Android 物理设备和实际服务器验证。

## PWA-S3B · Server 可达性与受控重试入口（2026-10-12）

S3A 用 `navigator.onLine` 表示**浏览器提供的网络提示**，不能证明 Server 可用。S3B 新增公开的 `GET /api/v1/readyz` 用户主动检查：`credentials:'omit'`、`cache:'no-store'`、`mode:'same-origin'`、`redirect:'error'`，仅限同源只读、6 秒超时且可在 Dialog 关闭时取消。分别区分：200 Server 就绪、503 未就绪、429 限流、401/403 代理/访问拦截、其他 HTTP 状态、网络失败、超时与显式取消；结果不携带敏感服务器响应、Token、文件或原件。**就绪只表示当时的 Server 状态，不代表已登录、当前文件有权限、传输完整写入或定时任务正常。**“重新检测服务器”只重试这个无副作用诊断，不自动重放上传/下载/删除/变更请求。能力在普通 Web、移动 Web、PWA 安装模式共用同一 UI，且不会新建后端 API（沿用既有公开 readyz）。

**仍需完成的 S3C：** 经服务端契约确认后，将 GET 幂等请求的短时网络失败与 429 有界指数退避（尊重 Retry-After、AbortSignal、可见窗口/取消和上限）接入共享 Web 请求控制器，严格排除上传 chunk、下载票据及任何写操作；同时完成待更新 worker 的人工确认激活前置条件，涵盖全窗口未保存编辑和前台操作。当前不把手动 readiness 再检测标注为“文件上传已自动续传”。S4 对真实大文件及设备生命周期验收另行记录。

## PWA-S3C · Web/Mobile 共用只读文件浏览请求的有界重试（2026-10-12）

**实现交付条件：** 只在共同的 `XDriveApi.request` 中对明确白名单的浏览 GET 使用 `xDriveFetchPwaSafeRead`，包括 `/api/v1/nodes/*`、文件搜索、变更分页、媒体资产/相册/筛选读取、文件收藏、标签、最近和保存搜索。最多只额外发出 **1 次** GET，不缓存私有响应、不更改请求权限和业务控制器。仅重试 429、503 和浏览器 `TypeError` 网络错误；429/503 无明确 `Retry-After` 时分别等 500/300ms；`Retry-After` 超过 1200ms、无法解析或无效时保留原 HTTP 结果，不违背服务端较长冷却。状态 401/403/404/500 不经额外重试，认证 401 的既有会话刷新链路不变；后台页面不开始重试。等待期间 `AbortSignal` 取消立即拒绝，永不再发送第二请求；二次网络尝试失败直接交还上层处理，不进入无限重试。

**坚决排除：** POST/PUT/PATCH/DELETE/HEAD，带请求体的 GET，`/api/v1/uploads*`、分块/预校验/Finalize、`/api/v1/auth*`、私人文件/Archive 下载票据及字节流、公开分享、管理员服务变更，以及不在白名单内的所有接口。原有 `WebFileExplorer`/Mobile Files 和 Gallery 的共享 REST、虚拟化 Range、选择/权限和 Go Server 维持不变；Desktop Agent 传输行为保持独立。一个可取消的 GET 重试不能算上传恢复、浏览器后台持续执行或 Server durable job；本阶段**也不实现**有条件的一键 SW 更新激活，后者必须跨窗口确认没有上传、未保存编辑、正在运行的 Viewer 和其他任务才可以继续。

**证据层：** 单元测试覆盖每个允许/禁止路径、HTTP 429/503、长短 Retry-After、网络异常、后台 visibility、取消信号、单次上限，以及共享 XDriveApi 接线。完整 Web/Windows/Desktop/Go PR CI 才能声明代码交付；真实 100k 高并发异常、iOS 27 Safari/Home Screen、Android Tab/Installed 及物理锁屏/进程恢复仍属 S4/S5 **not-run**，不得从 Node 测试推定性能或真机可靠性。

## PWA-S4A · 前台上传退出保护（2026-10-12）

**本轮第一项 S4 可靠性实施：** Web/Mobile Web 共享 `FileManager` 只在当前 Web 传输 Store 中有 `direction:upload` 且状态为 `queued/running/retrying/cancelling` 的任务时，动态注册浏览器 `beforeunload` 提示；当上传完成、失败、取消或任务消失即撤销监听，空闲页面无需负担卸载拦截。用户自主刷新、关闭窗口或离开站点时尽可能提供浏览器原生警告。应用内部 Files/Gallery/Viewer 路由切换不触发此事件，任何提示都不执行 `cancelTransfer`，不触碰 Server Durable Task、后台 Source/设备备份、签名下载票据、原生浏览器下载，也不声称成功保存文件。

**平台限制：** iOS Safari/PWA 和 Android 在锁屏、操作系统回收浏览器进程或强制关闭时，可能根本不派发 `beforeunload`；即使出现提示，浏览器本身也决定是否展示和文案。故这项仅是**最佳努力防误退出**，不能替代已存在的 8MiB 块校验、持久化上传会话、刷新后重新选择同一文件的 S4B 产品入口、实际 1–4GiB 下载完整性 S4C 和跨应用/锁屏恢复 S4D。退出提示绝不是后台上传成功、Server 任务暂停/取消或应用已具备无条件持续运行能力。

**验收：** 短时状态纯函数测试覆盖活动状态与已完成/原生下载排除；浏览器执行的 `beforeunload` 行为及真实设备交互需要另外测试，不能以构造 Event 的 Node 测试冒充系统警告已出现。保留真实传输、跨账号、Viewer 后台切换和不同系统模式的任务证据。

## PWA-S4B · 中断上传的原文件重选及现有 8MiB 分块续传（2026-10-12）

**交付证据：** [PR #1535](https://github.com/lazyxu/xdrive/pull/1535) 经完整 [CI #38234206118](https://github.com/lazyxu/xdrive/actions/runs/38234206118)（含 Final Gate），线性合并为 `db056b57`，临时分支已自动清理。源代码单测、完整 PR CI 和合并已完成；真实 Go/Chromium 断点后的最终文件 SHA，以及 iOS 27/Android 安装模式、锁屏和进程回收均 **not-run**。

**实现边界：** 不设计第二条上传 API，不缓存 File/Blob、原件、上传块、Cookie 或访问令牌。共享 Web/Mobile Web 的普通文件上传会通过 `XDriveApi.uploadWithConflictPolicy` 和 `WebTransferStore.create` 仅在非破坏性 `fail` 冲突策略时，保存目标云端目录 ID、原文件名、大小、`lastModified`、原始策略，以及完成初次预哈希后生成的**有序分块 SHA-256 清单的 SHA-256 指纹**（只保留 64 字符摘要、不保存原始文件或上传块），至**已按当前登录账号与 Origin 分区的传输历史**；保留原有一条文件传输记录，页面刷新后将未结束的 Web 记录显示为失败、可重新选择文件，绝不能伪称浏览器后台仍持有 File 对象。

在上传/下载历史中，只有非分组的失败 Web 上传、可信目标 ID、原策略 `fail`、原开始时间在最近 23 小时内才显示 **“重新选择原文件”**。按钮直接打开真实系统文件选择器（iOS Safari/主屏、Android 和桌面均复用同一入口）；若取消，不发 HTTP。明确比对文件名、大小、修改时间，任何不一致均停止，绝不绕过原权限进行上传或猜测目标路径。匹配元数据后，先重新计算文件全部 8MiB 分块的 SHA-256，再比较清单指纹。**内容指纹不同则在任何新上传请求之前拒绝**；首次预哈希尚未完成、没有指纹的中断记录也不能直接续传。内容核验通过后，才启动一条**新的** Browser 传输，使用保存的可信目标及相同 fail-on-conflict 策略调用既有 `uploadWithConflictPolicy`。Server 的 owner+resume_key+parent+name+size+chunk_sha256 校验仍为唯一权威：24 小时内相同会话返回已接收分块索引，客户端对每个分块重新计算 SHA-256、只复用 size/hash 真正匹配的块，最终仍须 Server Finalize。只有服务端明确返回恢复成功（或原文件已经 Finalize）后，旧失败历史才永久关闭重选入口并清除旧指纹；内容不匹配、取消选择、网络/权限/Quota 错误仍可重新选择原文件，且页面刷新后不能重新激活已成功处理的旧入口。旧历史不会被伪造为“完成”或直接覆写历史。

**暂不支持直接重选：** overwrite/skip/keep-both 冲突策略、文件夹扫描与多文件组的不可安全重建上下文、取消的上传、已过期会话、不同用户/Origin、不同文件身份。用户仍能在目标文件夹按原标准入口重新上传；保留正常冲突确认。服务端上传会话 TTL 为 24 小时，UI 的 23 小时窗口是安全上限不是服务端保证。浏览器恶意更改本地历史不会提升权限，所有 Server owner/Node/Quota/Revision 校验仍执行。iOS/Android 文件选择器可能返回新的 lastModified，在无法核对时应拒绝“接续旧任务”而不是静默写入。

**交付与验收分离：** Node 模型/传输 Store 的账户隔离、失败/刷新、严格重选身份、过期、真实 XDriveApi 分块/哈希接线及共用 UI 合约纳入 PR CI。仍需 S4B2 真实 Chromium→Gin/PostgreSQL 的断点注入/已接收块/最终完整 SHA-256 及 iOS/Android 真机触控/进程回收证据；S4C 对 1–4GiB 原生/流式/ZIP 下载，S4D 对切 App/锁屏/Video/Server Durable Task 恢复。测试成功不等于保证系统强杀后可以自动上传。

## 分期与测试记录

- **S1：** 安全离线页 + 无私有缓存 SW + 生产注册 + Caddy 静态缓存更新头 + 单测 + 文档。本阶段代码通过 Web lint/build、Desktop 单测、完整 GitHub PR CI/Final Gate 才能合并。不能称实现完整离线文件管理。
- **S2：** 安装引导、环境能力与 HTTPS 诊断、启动与 deep link 真实 Chrome/Android/iOS 装机验证。
- **S3：** 用户确认的更新与多窗口状态、应用内断网提示/恢复，不在未保存或上传中自动重载。
- **S4：** M38/M41/M42/M47 上传/下载/Viewer 后台和回收矩阵，记录必须重新选文件及 Server Durable Task 状态。
- **S5：** P0 发版 gate + iOS 27 Safari/Home Screen + Android Chrome/Installed + Desktop 浏览器的真实版本/设备、权限/状态、100k 资源、错误、截图和录屏验收；P1 按实际门槛补齐，P2 只按明确产品选择实施。

每条记录至少包含：case ID、准确 commit/部署版本、设备/OS/浏览器、真实 display-mode、在线/离线、认证状态、步骤、Server 真实结果/文件字节、实际通过/失败/未执行、截图/视频与 SHA-256。不得放令牌、Cookie、私有文件正文或敏感路径。沿用 docs/mobile-web-platform-matrix.md 和 docs/validation/ 台账。

**注意：** 浏览器声明 standalone ≠ 真实安装；Chrome mock E2E ≠ iOS 真机；公开离线页 ≠ 用户文件可离线访问；Server 持久任务 ≠ Web 前台上传锁屏后必定继续。

## PWA-S4C1 · 直写磁盘文件完成前的长度校验（2026-10-12）

Web/Mobile Web 支持 File System Access 时，原有 BYOB/常规流顺序写入只在 **预期长度校验后** 调用 writable.close()，避免短读或额外数据静默完成。当前文件/历史版本使用授权 Node 元数据大小，ZIP/归档只在无 HTTP 压缩且 Content-Length 为有效非负安全整数时核验。超长块写入前拒绝；短流、Blob fallback 错误及不可信长度都不提交磁盘临时目标，而是沿原路径 abort/失败。不增缓存、API、并发读取或修改 Server。浏览器解码 gzip 的响应不能拿压缩 wire 长度作为解码文件长度。

**未验收**：长度校验不等于 SHA-256。iOS/Android 不提供 File System Access 时，普通文件由浏览器原生下载票据接管，xDrive 无法直接核验真实落盘结果。真实 1GiB/4GiB 和 ZIP 的落盘 SHA、Range 206/416、票据有效期/撤销、断网、取消、后台切换和锁屏仍属 S4C2/S4D/S5；小规模 Node 测试不代表真机已通过。


## PWA-S4C2 · 真实 1 GiB Web/OPFS 全字节回读门槛（2026-10-12）

复用已存在的 `real-web-cas-transfer-runner.cjs`、真实编译 Gin/PostgreSQL17/Local CAS fixture、实际 Chromium/Electron 浏览器和共享 `XDriveApi`。仅在 `XD_PWA_FULL_OPFS_READBACK=1` 的独立发布验收模式下，下载完成并关闭真实 OPFS 文件后，从第一个字节到最后一个字节按 **至多 1 MiB 的小块**逐字节验证稀疏全零 fixture 内容；校验准确总大小、浏览器和 Server 的真实 GET 计数、CAS 完整性。**全文件回读在已完成的传输计时后运行**，不改变现有 n=3 性能基线/吞吐预算或生产 Web/PWA Service Worker。失败时直接使验证作业失败；CI 仅上传脱敏后可核对的 summary/sample JSON，**不归档可能含临时下载票据的 Gin/Chromium 原始日志**。

新 CI workflow `.github/workflows/pwa-full-opfs-readback.yml` 只对专项 PR 分支运行 **一次 1 GiB 真实测试**，也支持手动指定 4 GiB（需要足够 runner 存储）。此处的全字节相等是针对确定性**零字节**输入，并非浏览器计算任意文件的流式 SHA-256。其他类型真实文件、iOS 27 Safari/主屏、Android Chrome/安装模式及 Browser-owned 原生下载落盘内容仍为 `not-run`，不允许由 Chromium OPFS 的成功结果代替。这是 S4C2 测试能力，不是新的文件下载实现。


**S4C2 CI 首轮故障（2026-10-12）：** [真实作业 #38239367800](https://github.com/lazyxu/xdrive/actions/runs/38239367800) 在构建步骤因 Desktop 没有 npm lockfile 而触发 `npm ci` EUSAGE，尚未启动浏览器/Server 的 1GiB 测试。与已有真实 1GiB benchmark 一致改用 Desktop `npm install --no-audit --no-fund`，并加源代码防回归断言；保持原完整 CI/真实测试重新运行后再判断结果。


## PWA-S4D1 · 前台恢复时仅刷新 Server 权威任务状态（2026-10-12）

**原问题：** iOS/Android 浏览器切换应用、冻结标签或从锁屏返回时可能长时间节流 `setInterval`。仅依赖轮询的 Server 持久后台任务摘要、当前用户/管理员全局任务列表与个人文件操作队列，回到前台后可能继续显示旧状态；浏览器本地上传不因此被恢复。

**共享增量：** `ui/shared/src/mui/TaskWakeRefresh.ts` 仅监听 `pageshow`、`focus`、`online`、`visibilitychange`，在文档确实可见且 1500ms 窗口内至多触发一次**现有只读刷新回调**；隐藏页面和卸载/换账号后没有请求，时钟异常时不把前台永远锁死。重用共享 Web/Mobile Web/Desktop `TaskCenterController` 的 Server 活跃数量摘要和当前可见的 Mine/Global 列表查询，以及 `FileOperationLifecycle` 的已有 owner 范围 GET；沿用各自的异步世代与账户/范围 fencing、原有授权与分页，不增加新 API、缓存或 Service Worker 操作。未打开任务列表时只刷新 badge 摘要，不强制拉取全局任务历史。

**必须保留：** 事件只通知观察者重新从 Server **读取**，不调用 Cancel/Retry/Upload、`skipWaiting`、`location.reload` 或持久任务控制。用户从后台返回不能误把浏览器前台上传标为完成，也不能改变 Server Durable Task 的实际执行状态。新 source-exact Node 测试覆盖隐藏、连续唤醒合并、卸载清理、异常时间、无浏览器对象、共享 Web/Desktop 接线；既有 Task Center 和文件操作 Race 测试模型仅补上新模块的隔离导入 fixture，不能以这些模拟验证真实 iOS 进程回收。

**未完成验收：** 新 S4D1 PR 完整 CI/Final Gate、真实 iOS 27 Safari/Home Screen、Android Chrome/Installed 的锁屏/杀进程/切 App，真实 Web/Go Durable 任务对照及下载到系统文件夹状态尚未执行或未取得证据。真实文件重新选取、ZIP/Range、断点字节 SHA 按 P0/P1 矩阵继续跟踪。


**S4D1 首次完整 CI（2026-10-12）：** [#38241457049](https://github.com/lazyxu/xdrive/actions/runs/38241457049) Desktop 旧测试有 6 项在模块装载阶段失败：`file-explorer-action-feedback-ordering.cjs`、`file-explorer-selection-actions.cjs` 和 `task-transfer-navigation.cjs` 的独立 TS/React 执行器没有解析 `./TaskWakeRefresh`，报 `MODULE_NOT_FOUND`。已只调整这三处测试依赖注入，测试实际业务与 race 断言不放松；新增源代码集成断言，并折叠到原 S4D1 单工作提交后必须重跑完整 CI 才能合并。真实移动 OS 唤醒场景仍未验收。


## PWA-S2B1 · 生产 Web 在真实 Chromium 浏览器中的公开安装外壳验收（2026-10-12）

**固定交付边界：** 新增独立 GitHub PR CI workflow、Node 源代码门槛和真实 Chrome/Chromium Playwright 浏览器脚本，按普通 Web 与 390px Android UA/触屏模拟两组测试生产构建的 xDrive App；使用仅侦听 127.0.0.1 的公开静态服务器，真实浏览器视为安全 loopback 上下文，**不能**据此宣称公网 HTTPS 证书/DNS 正确或已从 iOS/Android 系统主屏图标安装成功。本阶段不修改 Server 业务、Web/Desktop 共用 API、Files/Gallery 虚拟化、52px App Frame、认证持久化、SW 缓存范围或任何文件内容。

**实际验证点（PR CI 待执行）：** 独立 Chrome 浏览器页面加载 Web production bundle；真实 Service Worker 注册/接管及 Manifest id/start_url/scope/display、192/512 图标 GET、Manifest/Worker 正确 Content-Type 和禁止长期缓存的 HEAD；登录前点击用户可见安装/运行环境诊断，仅对公开资源 HEAD 并显式无凭证 /api/v1/readyz 查询；Files hash 深链接 #/app/files?dir=42 在未登录、刷新、**真实本地 HTTP 连接失败**时的公开离线 fallback、恢复联网后仍保留；SW CacheStorage **仅** /offline.html，离线导航到受保护下载票据路径时不能把公开 offline.html 作为该私有 URL 的成功响应。测试失败不能伪称服务/登录成功，不记录 JWT/Cookie、私人字节、原件或真实用户路径。

**不覆盖的 P0 后续门槛：** 从桌面 Chrome/Edge 的真实系统安装图标冷启动、登录成功后跨授权 Files/Gallery/Viewer deep link、外链/分享/后退栈、公网部署 HTTPS/可信证书、iOS 27 Safari→添加主屏幕→独立窗口及 Android Chrome→安装版→锁屏/强杀/推送/文件选择器行为。它们仍需对应设备、OS/浏览器版本、访问 URL、原始 HTTP 结果、截图和准确 commit 的独立验收，不能用 UA、display-mode mock 或 localhost 代替。发布默认 PWA 继续无私人文件离线访问与浏览器后台上传承诺。

验收记录：desktop/scripts/pwa-browser-install-offline.cjs、desktop/tests/pwa-browser-runtime-contract.cjs、.github/workflows/pwa-s2b-browser.yml，结果只导出 desktop/pwa-s2b1-results/summary.json。PR 完整 CI + 独立真实浏览器作业必须都通过后才线性合并；本阶段新增真实浏览器自动化不代表已通过。


**S2B1 第一轮真实 Chrome 验收（2026-10-12）：** [专项 CI #38247662658](https://github.com/lazyxu/xdrive/actions/runs/38247662658) 已通过生产构建、实机 Chrome 驱动、真实 SW 控制、Manifest 与静态诊断，并正确完成无凭据 readyz；在 Playwright `context.setOffline(true)` 条件下未出现离线页，因没有捕获该时刻 SW 自有 Fetch 的实际网络结果，**不能**认定产品离线页失败。测试改为只针对根 SPA 导航和私有 API 的 socket 级断开（服务器直接 destroy HTTP 连接），保留 Worker 所有真实浏览器 Fetch 行为；要求根导航离线 fallback 成功、私有 URL 确实尝试网络并且不能复用离线页，并重新跑准确提交的整套 CI。此故障不涉及系统 PWA 图标安装/设备认证。


**S2B1 第二轮 Chrome 验收（2026-10-12）：** [#38248085397](https://github.com/lazyxu/xdrive/actions/runs/38248085397) 通过了服务端 socket 断线后的真实公开离线页、私人下载路径 network bypass；随后“恢复联网”步骤只调用同一带 hash 的 URL `page.goto()`，Chrome 将该动作保留在离线文档中，导致未显示登录入口。这属于测试夹具同文档导航而非真实 reload，不代表 SW 返回了错误内容。已在服务恢复 HTTP 200 后使用真正的 `page.reload({waitUntil:'load'})`，并新增源代码回归断言。新准确提交的浏览器 E2E 与完整 CI 仍须独立跑绿；公网证书/安装模式/移动真机仍 not-run。


## PWA-S2B2 · Chrome 真实登录与 Files 深链接恢复（2026-10-12）

**交付目标：** 复用 S2B1 的生产 Web/真实 Chrome 与 Server-side 隔离 loopback fixture，增加可选 XD_PWA_S2B_AUTH=1 模式。在桌面 1280px 和 Android UA/390px 触控模拟的实际浏览器里，保持同一登录前 Files 深链接 #/app/files?dir=42；通过真实登录页面输入一组**仅供 CI 使用的虚构账号**，由严格限定的假 Server 响应模拟 AuthResult 及受保护的 Node/Children、任务摘要和 FileOperations GET，必须发送正确的 Bearer fixture token 才能访问私有 URL。登录成功后实际进入同一个 Files 路由，冷刷新后已授权会话与目标目录恢复；SW 仍只能缓存公开 /offline.html，不能把认证数据/票据写入 CacheStorage，浏览器 profile 不归档。

**安全隔离：** 所有 token/密码均为测试专用固定假值，没有真实服务器、有效身份或 CAS 凭据；只上报请求计数和验收布尔值，CI 只归档 summary.json，不归档浏览器登录数据、HTTP 正文或下载票据。未在自建生产 HTTPS 或真实 iOS/Android/PWA 安装模式运行，不能推断系统凭证链、Cookie/权限、浏览器系统文件管理能力和网络恢复完整可靠性。此阶段不新增 Web/Mobile Web API，也不改 Server 登录/权限契约；复用现有 React AuthView→FileManager 及共享虚拟列表。

**验收：** 新 desktop/tests/pwa-auth-deeplink-contract.cjs、独立 .github/workflows/pwa-s2b-auth.yml，代码/测试应作为严格单提交挂在 S2B1 的 HEAD 上，等待父 PR 线性合并再重新构建到 master、跑本分支完整 CI 与真实浏览器 CI。登录后的图库、Viewer、分享/浏览器返回栈以及 Desktop Chrome/Edge 系统安装冷启动仍属后续 S2B/S5，实际 iOS 27 Safari、Android 安装版真机 not-run。


**S2B2 第一次真实浏览器验收（2026-10-12）：** [专项作业 #38252576485](https://github.com/lazyxu/xdrive/actions/runs/38252576485) 中 Chrome 已完成真实表单登录、11 次授权目标目录 Node 请求、冷刷新及相同深链接保留，且无 401 或凭据泄露；但严格测试 fixture 漏列了 Web 文件管理器默认加载的 `GET /api/v1/sources`、`GET /api/v1/file-recent` 与目录访问 recent-touch，返回 501 使 `authUnknown=4`，最终拒绝验收。已仅按现有共享 XDriveApi 定义为这些**固定且有限**的路径增加明确允许条目，不放行任意私有 API 或写操作；未知端点仍返回 501，并只记录测试本地 HTTP 方法+静态 pathname 供准确排查，绝不写入 token、Cookie、查询字符串或敏感文件路径。新提交的完整 PR CI 与专项 Chrome 必须全部重新通过才合并，仍不构成实机 iOS/Android 安装验证。


## PWA-S2B2 合并结果（2026-10-12）

PR #1560 已通过完整 CI #38253266903（含 Final Gate）及真实 Chrome 专项 #38253266692，线性合并为 096e23d8，临时分支已由清理流程删除。S2B2 真实 Chrome 登录表单 2 次、21 次授权目录读、Desktop 1280px/Android UA 390px 触控模拟冷刷新和 CacheStorage 公开离线页隔离均通过。注意：S2B2 使用隔离的模拟 Server API，并不能替代真实 Go Server JWT 和 OS 安装模式真机。

## PWA-S2B3 · 真实 Gin/PostgreSQL17/Local CAS 浏览器登录与跨用户授权（2026-10-12）

本阶段在已有 S2B2 基础上，改为不拦截和不伪造任何 /api/v1 响应。直接复用 internal/api 的独立 PostgreSQL schema、生产 Gin Router、auth.HashPassword/createTestUser 及临时 Local CAS，构建生产 Web，用真实 Chrome 用户界面登录由 Go 服务签发 JWT 的隔离测试账号；访问目标 Node、冷刷新和同一 Chrome profile 内另一个新标签打开相同 Files hash 后，都必须读回真实授权文件夹。跨用户 JWT 访问同一目录必须返回 404；匿名访问返回 401。Service Worker CacheStorage 仍然只有公开 offline.html。

新增 internal/api/pwa_s2b3_real_gin_auth_integration_test.go、desktop/scripts/pwa-real-gin-auth-browser.cjs、desktop/tests/pwa-real-gin-auth-contract.cjs 和 branch-scoped .github/workflows/pwa-s2b3-real-gin.yml。CI 专项测试使用私有 ready 文件和临时数据库，产物仅上传脱敏 summary.json，绝不上传 JWT、密码、HTTP 正文、Gin 私有日志、浏览器 Profile 和私有文件字节；不向真实用户系统发送请求。

**证据边界：** 本阶段尚待 CI 实跑，不能认定真实 Gin 登录已通过。真实 Safari iOS27/Home Screen、Android Installed、桌面 Chrome/Edge 系统安装图标冷启动、公网 HTTPS/证书、Gallery/Viewer/分享、后台上传保证、锁屏/进程回收和 4GiB SHA 验收仍为 not-run。继续保持 52px App Frame、统一 Web/Mobile Web 后端接口/虚拟化列表与公开 SW 离线缓存限制。


## PWA-S2B3 真实 Go 认证验收及合并（2026-10-12）

[PR #1566](https://github.com/lazyxu/xdrive/pull/1566) 已通过全部 [CI #38256509314](https://github.com/lazyxu/xdrive/actions/runs/38256509314)（Final Gate 成功），并通过 [真实 Gin/PostgreSQL/Local CAS/Chrome #38256508993](https://github.com/lazyxu/xdrive/actions/runs/38256508993)；线性合并提交 34c0edd6，临时工作分支已清理。桌面 Chrome 1280 与 Chrome Android UA/触摸模拟 390px 均完成生产 Go JWT 登录、Node 200、冷刷新/新标签访问、跨用户 404 和匿名 401；没有模拟 /api/v1 或私人 SW 缓存。以上不是 iOS 27/Android Installed Mode 的真实设备结论。

## PWA-S2B4 · 自建部署协议与公开安装资源诊断（2026-10-12）

增强原有 Web / Mobile Web 共用安装弹窗的“检查安装环境”，继续只在用户点击时执行、只发 credentials=omit 的同源 HEAD，无鉴权/私有数据。把浏览器 isSecureContext 与**实际协议**分开展示：可信浏览器 HTTPS 环境可以标记当前访问为 HTTPS，但不声称替用户检测了公网 DNS、证书链和生产 Caddy；浏览器允许的 http://127.0.0.1 与 http://localhost 安全上下文显示警告，不能伪报为移动设备的 HTTPS。普通非本机 HTTP 应失败。

诊断项目覆盖 Manifest（JSON MIME、不可长期缓存）、SW（JS MIME、不可长期缓存）、公开 offline.html（HTML MIME、不可长期缓存）、真实 192px/512px PNG 图标（需返回真实 image/png，静态图标允许长期缓存）；HTTP 200 但实际回退为 SPA HTML、404/重定向/网络错误必须判失败。原有 SW 只缓存公开离线页，不对任何 API、图片、下载或私人分享做缓存。新浏览器回归复用实际生产构建/Chrome 的 S2B1 工作流并检查 5 个真实 HEAD、隔离及恢复原文件深链接；单元测试检验 HTTPS、本机 HTTP 区分、图标长缓存允许及 MIME 错误拒绝。

**合并状态：** [PR #1570](https://github.com/lazyxu/xdrive/pull/1570) 准确 HEAD 82dab9b 已通过 [完整 CI #38260127842](https://github.com/lazyxu/xdrive/actions/runs/38260127842)（含 Final Gate）及 [真实 Chrome #38260127409](https://github.com/lazyxu/xdrive/actions/runs/38260127409)，线性合并为 98ffb1f9，临时分支已自动清理。完整公网 HTTPS/DNS/证书与 Caddy 生产验证、iOS27 Safari 主屏、Android 系统安装版、桌面系统安装图标冷启动、Gallery/Viewer 分享路由和后台上传仍需 S2/S5 分别验收，Chrome Android UA 不等于 Android 设备。


## PWA-S2B5 · 已登录图库深链接冷恢复与浏览器前进/后退（2026-10-12）

在 S2B3 [真实 Gin/PostgreSQL17/Local CAS + Chrome](https://github.com/lazyxu/xdrive/pull/1566) 的**同一真实后端、零 /api/v1 mock**基础上，复用专用浏览器工作流。桌面 Chrome 1280px 和 Android UA + Touch 390px（仅浏览器模拟、不是 Android 物理设备）以已登录的隔离测试账号，在新标签页从 `#/app/gallery?section=albums` 直接进入图库；检查既有共享图库 React workspace 的 `data-xdrive-gallery-upload-picker` 实际 DOM 挂载、目标 Hash 精确保留、不显示登录表单；强制冷刷新再验。

通过**真实浏览器** Hash History 从图库切到 `#/app/files?dir=<owner node>`，要求文件夹由 Gin 返回 200 且图库组件卸载；Back 恢复图库组件，Forward 恢复 Files。保留原有异主 JWT 404、匿名 401、缓存仅公开 `/offline.html`、无 JS pageerror、测试产物脱敏及 Web/Mobile 共用 Files/Gallery 接口，业务 Go API 不变。

**已合并：** [PR #1574](https://github.com/lazyxu/xdrive/pull/1574) 准确 HEAD 2ead8f1 已通过 [完整 CI #38263115175](https://github.com/lazyxu/xdrive/actions/runs/38263115175) 和 [真实 Gin Chrome #38263114590](https://github.com/lazyxu/xdrive/actions/runs/38263114590)，线性合并为 8af11079，临时分支已清理。**验收边界：** 仅证明真实 Chrome 已登录图库路由挂载、冷启动 Hash 保留与浏览器历史协作，不证明 Gallery 数据查询成功、缩略图解码、Viewer/公开分享流量、系统图标冷启动、真实 iOS 27 Safari/Home Screen、Android Installed、锁屏后台、公网 TLS，也不代表 Web/Desktop 全功能等价。只有本分支 exact-head 全 CI 和专项真实浏览器均通过才可合并。


## PWA-S2B6 · 真实私有图库 Range、PNG Viewer 深链接冷恢复（2026-10-12）

复用 S2B3/S2B5 已认证的生产 Web → Gin JWT → PostgreSQL17 + Local CAS，使用桌面 Chrome 1280px 和 Android UA/Touch 390px（**模拟，不是真机**）。独立测试数据库迁移现有 Media/PhotoAsset/PhotoResource 表；Go fixture 向私有 Local CAS 写入一张 2×2 PNG，并建立匹配的 Node、File、FileVersion、ContentBlob、MediaMetadata、PhotoAsset 和 Resource。无生产 API、数据库迁移、图库 UI 或 Service Worker 变更。

必须通过真实 Go Handler 及 Chrome：本人图库 `GET /api/v1/media/items?range=true&limit=10&offset=0` HTTP 200 且存在私有图片，返回 no-store；新标签打开 `#/app/media-viewer?node=<真实ID>` 需真实 Gin item 200、共享沉浸式 Viewer 展示图像名称，冷刷新仍成功；异主账号同一 MediaItem 必须 404、匿名 401。原 S2B3 Files 授权、S2B5 Gallery 路由历史、CacheStorage 仅公开 offline.html 等门槛不放松。ready-file 只增加数值 media Node ID，不导出图像字节、CAS 路径、登录 Token、HTTP 私有正文；唯一 artifact 为脱敏 summary.json。

**证据边界：** 该阶段仅是实际 Chrome + 私有测试 PNG 的 Server/Viewer 基础链路验收，不是 iOS 27/Android Installed 真机、系统启动图标、100k 媒体性能、Live Photo、完整分享流、原件落盘 SHA、生产 HTTPS 或后台上传连续性保证。初始状态：单工作提交待 CI；准确 HEAD 完整 PR CI/Final Gate 和真实 Gin Chrome 专项均绿后再合并。


**S2B6 首轮红灯定位（2026-10-12）：** 准确 HEAD `ed5e60c` 的 Go Linux 作业在 `gofmt -l` 校验发现测试夹具仅有两处字段对齐空格；完整 CI 因此不得视为通过。独立真实 Gin Chrome 作业在启动 private fixture 时报告缺失 `xd_source_collections` 表，PostgreSQL 服务端日志明确指出源集合关系查询；由独立测试 schema 漏迁移造成，不是主线生产迁移。本次仅向**测试 fixture** 的 AutoMigrate 加入既有 `SourceItem`、`SourceCollection`、`SourceCollectionItem`，并修正两处 gofmt；没有修改产品 Handler、Source 运行/权限或 PWA 缓存。折叠回同一固定 `master@18532d9` 的**单工作提交**后，原 CI 证据作废，需重新跑准确新 HEAD 的完整 CI 与真实浏览器专项。


## PWA-S2B6 合并结果（2026-10-12）

[PR #1578](https://github.com/lazyxu/xdrive/pull/1578) 的第二轮准确 HEAD `eabb21c6fa6d1048038a700b611e87c0caa695b6` 已通过 [完整 CI #38266509984](https://github.com/lazyxu/xdrive/actions/runs/38266509984) 与 [真实 Gin/PostgreSQL17/Local CAS/Chrome #38266509563](https://github.com/lazyxu/xdrive/actions/runs/38266509563)，单工作提交 ahead=1/behind=0，线性合并为 `de762161e4ba42b1edae66bcea45d48402684f9d`，短期 PWA 分支经 cleanup workflow 清理。它证明真实测试 PNG 的 owner Gallery Range、Viewer 直接 Hash/冷刷新和不同账号权限，**不证明**真实 iOS/Android OS Installed 或生产公网 TLS。

## PWA-S2B7 · 公开分享 Hash 路由与 Viewer 历史恢复（2026-10-12）

**发现的实际缺陷：** `web/src/App.tsx` 使用无依赖 `useMemo` 只在首次 render 解析 `#/s/<token>`；在单页内通过浏览器 History 或不同公开分享链接切换时，Root App 不重读 Hash，导致可见页面与 URL 不一致，且分享表单可能重用旧密码/错误状态。修复限制在 Root App：从 URL 解析当前 token，用 `hashchange` 和 `popstate` 同步（含 mount 时校验、卸载监听清理），按 token 键隔离 `PublicShareView`；仍不持久化分享 token、账号凭据或任何私有文件，保持 FileManager 业务/52px App Frame 不变。

**真实可验证用例：** 在 S2B6 隔离私有 PNG + Gin JWT + PostgreSQL17 + CAS fixture 中，测试 Chrome desktop 1280px、Android UA/touch 390px。通过真正已登录 owner 的 `POST /api/v1/files/:id/shares` 新建两份仅供 CI 使用的分享（有密码/无密码），不将原始 token 放入 ready JSON 或脱敏 CI 摘要。另一完全匿名 Chrome context 从 `#/s/<token>` 打开，公共元数据 `GET /api/v1/public/share` 必须是 200 + no-store + 无 Authorization/Cookie；错误密码尝试 `download-ticket` 必须 401 且下载计数不变。切换另一 token 清除旧密码/错误，真实浏览器 Back/Forward 与公开分享 → Files 登录页 → Back 保持正确，SW CacheStorage 仅含 `/offline.html`。本人已登录 Viewer → 公开分享 → Back 必须恢复真实 Gin MediaItem 和 Viewer、不强制文档刷新。owner 撤销分享后，匿名页面冷刷新必须从 Gin 收到 410，并显示明确不可用且不保留先前私有文件名。

**安全及证据边界：** 单次测试可有合成分享 token 存在于浏览器和 CI 脚本内存，但不进入 artifact、日志、持久缓存；浏览器错误摘要脱敏。没有自动重载、`skipWaiting`、服务端持久任务取消、真正私有离线浏览或新移动端 API。该测试依旧是 Chrome 桌面与 Android UA/Touch 模拟，绝不能取代 iOS 27 Safari/Home Screen、Android Installed、系统应用图标冷启动、真实证书/DNS、4GiB 传输和锁屏/进程回收验收。初始 PR 必须保持 Draft，等准确 HEAD 的完整 CI / Final Gate 和真实 Gin Chrome 专项全绿后才能 Ready/线性合并。


## PWA-S2B7 合并结果（2026-10-12）
[PR #1582](https://github.com/lazyxu/xdrive/pull/1582) 准确单提交 `18767bc8` 在 [完整 CI #38271244201](https://github.com/lazyxu/xdrive/actions/runs/38271244201)（含 Final Gate）与 [真实 Gin/PostgreSQL17/Chrome #38271243815](https://github.com/lazyxu/xdrive/actions/runs/38271243815) 均通过后，线性合并为 `60fac3585b0e020cbb75d3a37cf6e2d6c34dba29`。自动清理已验证，当前无未处理 PWA 专项 PR 或分支；物理安装未验。

## PWA-S2B8 · 安装环境诊断的并行有界请求与实时取消（2026-10-12）
**现有缺口：** Web/Mobile Web 共用的“检查安装环境”将 Manifest、Worker、offline 与两个图标按顺序对公有静态资源发起 HEAD；自建代理让任何一个 HEAD 无限挂起时，整段诊断会一直停留在“检测中”。关闭弹窗时原有代码仅挡住最终写入，没有真正对网络发送 AbortSignal，造成后台浪费请求和错误的移动弱网体验。

**有界实现：** 继续由用户显式点击后触发，五个公开 HEAD 同时开始，**整个批次共享最多 6 秒总预算**，每个请求仍然严格 `HEAD`、`credentials=omit`、`same-origin`、`no-store`、`redirect=error`，仅允许固定五个资源，无新增 API。浏览器 `AbortController` 在超时、弹窗关闭/卸载和重复检测时直接取消所有未完成请求；网络故障、超时和用户取消不能误报为成功。结果仍严格按原五资源顺序显示；正常诊断用例保持原语义。绝不读取 Token/下载票据/私人字节，也不新增 Service Worker 缓存或后台轮询；不会中断正在运行的 File/Viewer/Server Durable Task。

**验收：** 独立 Node 测试要验证全部五个 HEAD 同时发出、悬挂单个 HEAD 触发超时、显式取消传播到五个信号、已经取消时零请求、可重复执行且状态不污染；真实 Chromium 生产 Web 的 Desktop 1280 / Android UA Touch 390 用例保留正常检查与离线恢复，在桌面模式特意让服务端挂住**一条公开 `/pwa-512.png` HEAD**，用户关闭真实 MUI Dialog 后必须观察到实际 HTTP 响应连接立即关闭，不能用 mock 拦截。CI 仅归档无私人数据的 summary.json。需要准确 HEAD 完整 CI/Final Gate 和 Chrome 专项双绿后合并。

**证据边界：** 这提供有界移动弱网体验和真实浏览器 HTTP abort 证据，不代表可信公网 TLS/DNS、已安装主屏 App、Android 设备真机、iOS 27 Safari、进程回收后网页后台上传或 OS 桌面图标启动。S2 真机矩阵仍待 S5 独立验收。


**S2B8 首轮 CI 故障及重建：** 工作提交 `89889667` 的 [真实 Chrome #38274175092](https://github.com/lazyxu/xdrive/actions/runs/38274175092) 通过了产物/资源/实际挂起 HEAD 网络取消；完整 [CI #38274175434](https://github.com/lazyxu/xdrive/actions/runs/38274175434) 的 desktop-tests 仅有 1 项失败（2482 passed、1 failed、1 skipped）：旧 `web-pwa-install.cjs` 还查找不带参数的 `checkXDrivePwaAssets()` 代码片段，但本功能为实际取消必须改成 `checkXDrivePwaAssets({ signal: controller.signal })`。原有 Node 超时、五请求并行、显式取消、已取消零网络请求测试均成功；本次仅修改这条静态断言以及此段交付说明，不放宽任何行为断言。重新构造同一冻结 master 的单工作提交，旧红灯与旧绿灯均不得用于新准确 HEAD 的合并验收。


## PWA-S2B8 合并结果（2026-10-12）
[PR #1586](https://github.com/lazyxu/xdrive/pull/1586) 准确单提交 `d06102c1` 通过 [完整 CI #38274742433](https://github.com/lazyxu/xdrive/actions/runs/38274742433)（Final Gate）以及 [真实 Chrome #38274742099](https://github.com/lazyxu/xdrive/actions/runs/38274742099) 后，以 rebase merge 合并至 `5ec371a75e808d35aa0ba6afc7d34ec6634cd6ec`。确认生产共享安装弹窗中五项公开资源并行 HEAD、6 秒总预算、关闭弹窗时真实 Chrome HTTP 取消。未执行真实 iOS/Android 系统安装或公网 CA/DNS 验收。

## PWA-S3D1 · Service Worker 手动版本检查有界等待（2026-10-13）
**既有真实缺口：** 浏览器的 `ServiceWorkerRegistration.getRegistration()/update()` 可以因弱网/代理阻塞，使共享 Web/Mobile Web 的“检查新版本”一直显示“检查中”。`registration.update()` 不提供 AbortSignal；前端无法证明已取消浏览器内部 SW 下载。

**本阶段实现：** 对**用户显式点击**触发的注册查找和 `update()` 设置同一 8 秒**界面等待总预算**。连续点击合并成一个 Promise。时间到后显示准确的超时提示，并允许新的用户显式重试；浏览器中的既有更新可能继续。迟到的 `update()` 结果不能覆盖 timeout 状态；独立 `updatefound/statechange` 检测到真实 waiting Worker 时仍应正确显示 waiting。任何情形都不得调用 `skipWaiting`、`location.reload`、自动关闭窗口、取消 Server Durable Task、浏览器上传或 Viewer；任何下载/用户媒体仍不得进入公共 SW CacheStorage。

**验收要求：** Node TS 执行器验证重复点击只调用一次 update、注册查找或 worker 更新两种阻塞均有超时、超时后迟到结果不能伪装成功、再次手动检查能恢复、实际 waiting 状态优先。桌面实际 Chrome 1280px 与 Android UA/Touch 390px 在正常同源 loopback 的生产 Web 上执行用户点击版本检查，要求有限时间内恢复按钮、Files URL 和文档 DOM 完全不动，继续保留 S2B8 真实挂起公开图标 HEAD 取消、S1 公开离线页隔离门槛。专项输出仅脱敏 summary.json。

**仍待完成：** 这只是手动检查的 UI 时间边界与真实 Chrome 常规交互；不能证明取消浏览器内部更新、自动安全激活或跨窗口真实活动已可信判断，也不是 iOS 27/Android Installed 真机、桌面系统图标、生产公网 HTTPS、100k 性能、4GiB 原生下载 SHA 或 OS 进程回收证据。后续 S3D2 要在共享 Files/Gallery/Viewer/编辑/传输真实活动及跨窗口 fencing 可信可用后才讨论一键安全激活。本阶段必须准确 HEAD 完整 GitHub PR CI + Final Gate 与真实 Chrome 专项均绿后线性合并。


## PWA-S3D2A · 当前 Web/Mobile 窗口的更新阻塞活动观察（2026-10-13）

**前置交付：** S3D1 [PR #1592](https://github.com/lazyxu/xdrive/pull/1592) 已在准确 HEAD `5777d418` 的 [完整 CI #38277431405](https://github.com/lazyxu/xdrive/actions/runs/38277431405) 和 [真实 Chrome #38277430794](https://github.com/lazyxu/xdrive/actions/runs/38277430794) 成功后，以单提交 rebase merge `d938592d` 合并。已确认该 PWA 临时分支被清理。原有 8 秒限时版本检查不变。

**S3D2A 增量（候选，需当前提交准确 CI）：** 共用 Web/Mobile `FileManager` 仅将当前页面前台浏览器上传、前台下载、Viewer 是否打开、系统依赖配置是否有未保存草稿的 **四个布尔状态**写入内存观察者。读写者以独立 FileManager lease 防止注销/切账号后旧组件异步清理覆盖新页面；真正卸载时状态回归 unknown。安装对话框只在 Service Worker waiting 时列出已知阻塞项，或明确未知/仅当前窗口空闲。状态不持久化、不读账号 Token/路径/文件正文、不广播给其他窗口，不产生新 HTTP 请求。

**安全边界：** 已知项全为 false 也绝不是跨窗口安全激活证明；未覆盖其他编辑器草稿、浏览器已接管的原生下载、同时打开的同源标签页/窗口、后台系统任务。没有 `skipWaiting`、`clients.claim`、自动 reload、一键激活或上传/下载/Viewer Cancel；仍要求用户完成正在运行的工作，关闭全部同源窗口，再重新打开。Server Durable Task 不属于浏览器传输；PWA 锁屏/杀进程后不保证传输。后续 S3D2B 须先补各编辑器真实脏状态与可信跨窗口 fail-closed 协调，再讨论是否需要任何一键更新。

**独立验收：** 新 Node TS 运行测试覆盖默认 unknown、四个阻塞项、相同状态不重复通知、注销/重挂旧 owner 清理隔离、下载与上传区别、真实 App/UI 连接及无隐私持久化断言；隔离环境 pure TS 首四项已通过，完整 Web/Windows/Desktop/Go CI 及真机 iOS27/Android Installed 均待该阶段准确证据。此只读 UX 改动不能替代 S5 真机/HTTPS/4GiB SHA 验收。


## PWA-S3D2A · 合并验收结果（2026-10-13）

[PR #1597](https://github.com/lazyxu/xdrive/pull/1597) 唯一工作提交 407aea7a 通过准确 HEAD 的 [完整 CI #38328655966](https://github.com/lazyxu/xdrive/actions/runs/38328655966)：Web/桌面/Go/Windows 源码、打包与安装升级回滚作业及 Final Gate 均成功。以 rebase merge 线性合并为 8bf627afa25f07b4d4f557b128bce2bd989a9812；已核实前一 PWA 工作分支被清理。不能把 Chrome/Node 测试当作物理 iOS/Android 系统安装验收。

## PWA-S3D2B · 跨窗口匿名忙态提示与过期保护（2026-10-13）

**范围：** 在普通 Web/Mobile Web 入口为支持该能力的安全浏览器创建独立 BroadcastChannel，并订阅 S3D2A 当前窗口的前台浏览器上传、下载、Viewer 与系统依赖未保存草稿观察值。仅发送一次性随机窗口 ID、递增序号、observed 和 busy 布尔值；无 Token/Cookie、用户名/账号、Node ID、绝对路径、私有字节、请求体，也不写入持久化存储、Service Worker 缓存或任何后端 API。收到 hello 回复当前状态，局部状态变更及页面返回及时发送匿名提示；每 15 秒心跳，45 秒后淘汰过时记录。对端记录限制为 32，额外对端或不支持 BroadcastChannel / randomUUID / 安全上下文时维持不确定状态。忽略乱序、伪造结构或语义非法消息；pagehide 报 unknown，绝不发送自动激活许可。

**不可放松的约束：** 同源浏览器窗口可能被 iOS 27 的主屏 Web App 隔离、锁屏、冻结或操作系统杀死；消息丢失和已过期都不能意味着其他窗口已关闭。账号切换、其他编辑器未保存草稿、浏览器原生下载与 Server 持久任务并不在此协议可信验证范围；其他窗口未报告忙态也绝对不代表所有 xDrive 工作已完成。只在已有 Service Worker waiting 更新提示内展示报告；没有 skipWaiting、clients.claim、location.reload、自动 Cancel、强制登出、跨窗口任务命令或一键激活。保持 52px 全屏 App Frame、Web/Mobile 相同 Files/Gallery 后端与虚拟列表，以及公有 offline.html 之外不缓存任何用户数据的原有策略。

**测试与门槛：** Node TypeScript 执行器验证不支持/不安全回退、两窗口匿名状态、任务消退、TTL/页面冻结、重复过期序号/无效消息、真实入口/UI/文档接线；本地隔离环境的 strict tsc 与前四个协议行为测试已通过，第五个接线测试需要完整仓库执行，不得以局部 stub 结果代替。必须准确 HEAD 完整 GitHub PR CI + Final Gate 全绿才能由 Draft 转 Ready、rebase merge；真实多窗口 Chrome 和 iOS 27 Safari/Home Screen、Android OS Installed、桌面 Edge、真 HTTPS/CA、4GiB 原生下载落盘 SHA/签名/锁屏进程恢复均未完成。后续 S3D2C 优先覆盖图库编辑器、创意生成等未保存草稿和真实活动；未覆盖所有编辑面之前不得开发一键强制更新。


## PWA-S3D2B 合并结果（2026-10-13）

[PR #1602](https://github.com/lazyxu/xdrive/pull/1602) 的唯一工作提交 `ce7198b9ffcf1027f5e2a37a3e34baf789e7a498` 通过准确 HEAD 的 [完整 CI #38330534346](https://github.com/lazyxu/xdrive/actions/runs/38330534346)（Final Gate、Desktop/Web、Go Linux/Windows、Client installers/rollback/upgrade、相关镜像全部通过），按单提交 rebase merge 合并为 `4dc1b4c0f87f4f8eacbc79ae5c06f9476ce0515d`。跨窗口信息只是匿名忙态提示，不能授权强制更新。合并后临时分支由 cleanup-merged-branches 自动清理；需独立确认是否已删除。未经物理设备测试，不宣称 iOS/Android Installed、跨 App 容器活动发现或后台传输能力通过。

## PWA-S3D2C · 共享媒体编辑会话与未保存配置退出保护（2026-10-13）

**具体源代码增量（候选，待准确 HEAD CI）：** 共用 Web/Mobile Web 的 `WebMediaViewerApp` 从其现有实际 `editOpen/creativeOpen` 状态报告“媒体编辑/创意对话框正在打开”，关闭会话或卸载时主动清理。由 FileManager 统一聚合进入 `pwaWorkloadSafety.ts` 的 `mediaEditorOpen` 内存布尔值，S3D2B 现有匿名跨窗口忙态推断自动将其纳入。不广播/存储 Node ID、编辑参数、图像内容、文件名、账号或任务详情；不新增 Server API、Service Worker 缓存或上传/下载后台工作。

**保守退出提示：** 原有 `beforeunload` 仅在当前 Web 上传活跃时注册；现扩展至未保存的系统依赖设置草稿，以及正在打开的媒体编辑或创意对话框。仍只维护一个事件监听器，三类情况全部结束即解除注册，绝不主动 `cancelTransfer`、`skipWaiting`、`location.reload`、关闭窗口、保存草稿或取消持久后台任务。具体“编辑器是否有未保存修改”在此阶段**未精确探测**：把打开的编辑/创意对话框保守视为可能含草稿，避免误判空闲；图库其他未接入的编辑/选择/组织弹窗仍未覆盖。

**平台约束：** iOS Safari/主屏 PWA 和 Android 在锁屏、系统杀进程、后台回收时可能不触发 `beforeunload`，不能据此保证数据恢复或 Desktop 等价。Browser-owned native downloads、另外浏览器容器和所有已运行的 Server Durable Tasks 不受这一事件控制。所有窗口消息只能提示可能忙，绝不能证明跨窗口安全激活，因此依旧仅让用户完成工作、手动关闭所有 xDrive 窗口并重新打开。

**精确测试与交付门槛：** 新 Node/TS 动态测试执行真实当前窗口活动 store，验证媒体编辑标志、其他阻塞持续保留、清理、UI/Viewer/React 接线、最佳努力退出监听、不含强制 Service Worker 操作；既有 S3D2A/B 和 S4A 及 Web/Windows/Desktop/Go 全 CI 仍需成功。源码级约束与浏览器模拟不等于真实 iOS/Android Installed 或跨进程行为；本阶段不新增强制一键更新。PWA S4 待完成 4GiB 落盘 SHA/真实移动端恢复，S5 仍待公网 HTTPS/证书、真实 iOS 27、Android Installed、桌面 Chrome/Edge 安装、锁屏/回收、发布回滚和截图/证据矩阵验收。


## PWA-S3D2C 交付结果（2026-10-13）

[PR #1606](https://github.com/lazyxu/xdrive/pull/1606) 的原始唯一工作提交 `299a992450d9c389cbbafde2daa2cd98382f34a9` 通过准确 HEAD [完整 CI #38331960544](https://github.com/lazyxu/xdrive/actions/runs/38331960544)（含 Final Gate），线性 rebase merge 为 `6b4a08a4315c488955cd7b28cf6bc42097f94883`。Web/Mobile 共同媒体 Viewer 的图片编辑/创意对话框活动与未保存系统依赖配置被纳入浏览器最佳努力退出提醒；不构成后台上传或自动强制更新保证。S3 这项 UI 安全基础已合并，真实 iOS/Android Installed 仍未验收。

## PWA-S4B2-A · 真实单文件上传：首块提交 → TCP 中断 → 浏览器刷新 → 重选原文件 → 物理 CAS 完整 SHA-256（2026-10-13）

**本轮首次执行的独立工作负载（候选，必须由精确 HEAD 专项 CI 证实）：** 从原来 S2B3 已验证的真实 Gin JWT、隔离 PostgreSQL17 与物理 Local CAS 测试服务增设一个**显式启用、仅测试环境可用**的 17 MiB（8 MiB + 8 MiB + 1 MiB）非零确定性上传案例；两套独立私有数据库/CAS 测试各使用真正系统 Chrome Desktop 1280px 或 Android UA+Touch 390px **模拟视口**。Chrome 通过真实登录表单、Files 文件选择器调用生产 `XDriveApi.uploadWithConflictPolicy`，Gin 接受 chunk0 后对**第一个上传会话内的所有 chunk1 PUT** 使用 `http.Hijacker` 真实断开 TCP，直到用户重选触发第二个 POST 会话才恢复服务（不是伪造/拦截返回的成功 API），浏览器传输 Store 必须记录可恢复的失败任务与有序块摘要。浏览器执行真实 hard reload，检测同账户历史仍可恢复，再由用户选择器**重新选择同一个原文件**；浏览器按原始 manifest 重新计算所有块 SHA-256，Server 的 `received_chunks` 复用 chunk0。最后检查真实浏览器 finalize 响应的原文件 SHA、文件大小；原失败历史的重试入口必须被消费。Go 再独立完整读取 Local CAS 实际存储字节与已提交 `ContentBlob/File` SHA，用同一公开确定性数据公式独立计算完整 17 MiB 的 SHA-256 并核对（非全零/非抽样、不是浏览器 JS 对缓存的比对）。

**必须通过的故障/重传断言：** 初次+恢复各仅创建一轮会话（总计 2 个 POST）、chunk0 仅上传 1 次，chunk1 在第一个会话中连续发生真实 TCP 丢失（允许 Chrome 网络栈透明重试），在第二个会话最终成功 1 次，chunk2 成功 1 次；完整 Local CAS 大小 17 MiB、Ready RefCount 与最终文件 SHA 精确一致。HTTP/Go 层签收和浏览器最终可见结果必须同时为真。失败时原任务不可谎报完成，页面重启丢失 File 的情况下必须明确要求用户再次选择；只有最终成功才清空旧续传 manifest。隐私：私有 Gin 日志、测试用 JWT、密码、浏览器 Profile、文件字节及临时 ready 文件**不上传**，CI 只归档不含敏感信息的两个布尔/字节数摘要。

**范围与未完成：** 仅单文件 Files 上传、已登录拥有者的 `fail` 非破坏性策略，并保留既有 8 MiB 分块/24h Server TTL；不声称文件夹/分组上传和已删除的本地 File 自动恢复。真正 iOS 27 主屏 App、Android 系统安装、后台锁屏/强杀/多窗口隔离、4 GiB 浏览器 native 下载 SHA、运营 HTTPS 证书及 Caddy 生产端配置仍分别 `not-run`；Chrome Android UA 390 是模拟，不是 Android 真机。更大 1/4 GiB 实际“中断后续传”另列 S4B2-B，不可复用已完成的正常不中断 1 GiB 性能测试充当证明。

**实施与交付门槛：** 新增 branch-scoped `.github/workflows/pwa-s4b2-real-resume.yml`，准确 HEAD 生产 Web 构建、Node/Chrome 脚本语法、Go test binary、独立 PostgreSQL17，desktop/mobile 模拟两次真实浏览器重复验证；5 个专门源码/安全合约 Node 测试必须与常规 Desktop 全测试共同通过。工作分支始终唯一一条 work commit；完整 GitHub PR CI（含 Final Gate）**及**这条专项真实 Chrome workflow 在相同 HEAD 均全绿之后才可 Ready、线性合并并检查自动清理。Go 真实传输红灯必须先排除 fixture/脚本/测试本身缺陷，不能将假测试失败称为生产 BUG；否则修复折叠回原唯一工作提交重新验证。用户没有授权在真实个人文件/生产部署中注入 TCP 故障；本用例严格限于隔离 CI 实例。

  
**S4B2-A 首轮真实 CI 诊断（2026-10-13）：** 当前旧 HEAD `6da955d3` 的 [专项真实 Chrome/Gin #38334623915](https://github.com/lazyxu/xdrive/actions/runs/38334623915) 已成功构建实际 Web、编译 Go/PostgreSQL fixture、运行新增 5/5 Node 合同测试；Desktop Chrome 在首次上传后等待“failed + retryable + manifest”的 45 秒门槛超时，脱敏 summary 显示还没有进入重新选择文件阶段。**这是测试用例未通过，不可据此声称已发现生产上传 bug，也不能宣称续传已经通过。** 当前代码未提供足以区分浏览器上传前校验、服务端是否收到首个分块、错误记录缺失的真实诊断数据，因此本次只在隔离测试 fixture 中增加无凭据、无文件名或内容的请求计数 `/__test/pwa-s4b2/stats`；Chrome 失败摘要补充固定阶段枚举、传输 state/retryable/manifest 布尔位和已发送 chunk 数量。禁止归档 Gin 原始日志、JWT、上传私有字节。要求新准确 HEAD 的专项实测后再判断 fixture 和产品路径；旧红灯不能授权合并。

**独立完整 CI 首轮基础设施故障：** [#38334624054](https://github.com/lazyxu/xdrive/actions/runs/38334624054) 的 `media-worker-image` 在不属于本 PWA PR 的 FFmpeg Docker 打包阶段因 Alpine 官方 APKINDEX 请求 `Permission denied` 而失败，后续 FFmpeg 依赖报缺失；非当前上传源码问题。尝试在整个 workflow 尚执行时重跑该 job，GitHub 403 拒绝（run already running）。待第一次完整 CI 结束后只重试此失败 job，并确认同准确 HEAD Final Gate；不为规避依赖下载失败而跳过镜像或放松测试。

  
**S4B2-A 第二轮 CI 格式门槛（2026-10-13）：** 增补诊断用的准确 HEAD `d386ad34` 在 [完整 CI #38335279563](https://github.com/lazyxu/xdrive/actions/runs/38335279563) 的 `go-linux/Check formatting` 作业显示 `gofmt -l internal/api/pwa_s2b3_real_gin_auth_integration_test.go` 非空，原因只是新增 4 个 `map[string]int64` 字段对齐不符；对应 [真实 Chrome #38335279361](https://github.com/lazyxu/xdrive/actions/runs/38335279361) 因 build 中显式 `gofmt` 门槛而在浏览器启动前失败。**这是本轮引入的 Go 测试夹具格式错误**，不是产品问题；不属于第一轮 Timeout 的复测结果。按 CI 逐行 diff 修复格式，继续仅一个工作提交，前两轮的旧 SHA 成功/失败均不能作为最终合并验收。


**S4B2-A 第三轮真实浏览器 First-red 及原因（2026-10-13）：** `8f87cb92` 的 [专用 Chrome #38335429885](https://github.com/lazyxu/xdrive/actions/runs/38335429885) 成功通过真实 Web 生产构建、Go 编译、5 项合同测试，并进入实际桌面 Chrome 上传。测试日志在 `await-first-failed-record` 阶段超时，脱敏浏览器摘要证明首次 17 MiB 已意外**完整成功**：`transfer.state=completed`、Server 会话 POST=1、chunk0 PUT=1、chunk1 PUT=2、chunk2 PUT=1、TCP drop=1。这表明浏览器/网络栈对幂等 PUT 在第一次 TCP 断开后自动重发成功；这是**现有系统的自动恢复表现，不是产品 bug**。原测试假定一次 socket drop 必定留下失败历史，属于不合理 harness 假设。改为第一个会话的**每一个** chunk1 PUT 都在到达业务 Handler 前强制断开真实 TCP，直至用户从浏览器恢复 UI 再发第二次 POST；第二会话中断解除并复用 chunk0。HTTP 计数允许不同 Chrome 版本的首会话透明重试次数，但强制首块恰好一次、两次 Server Session、chunk2 一次、drop=chunk1 PUT 总量-1，核对完整物理 CAS SHA 不变。仅限隔离 opt-in Gin test fixture；没有削弱 Chrome/XHR/Product 的自动重试、用户数据或运行时产品代码。必须新准确 HEAD 的浏览器专项成功才可声明 **人工重选** 的 S4B2 证据通过。


**S4B2-A 第四轮真实浏览器通过、Go 后置审查仍失败（2026-10-13）：** 在 `edb6cf98` 的 [真实专用工作流 #38335881276](https://github.com/lazyxu/xdrive/actions/runs/38335881276) 中，**Desktop Chrome 已完整执行并标记自身通过**：第一次持续 TCP 断线后产生失败+manifest，硬刷新保留重选入口，再次用户选取同一个 17MiB 非零文件后 finalize SHA 与长度匹配，旧重选 manifest 消费，SW CacheStorage 仅有公开 offline.html（summary-desktop.json 确认）。但 Go fixture 完成信号后由独立 DB/物理 CAS/HTTP 计数校验返回非零，整个工作流为 failure，**Go 后置验证尚未通过，不可宣布整项成功**。原工作流故意不归档 Go/Gin 原始日志，导致不能断言具体错误来自请求计数还是物理 CAS。下一轮在 Chrome 自身测试完成后、Go fixture 校验前，从仅限本地隔离测试服务的匿名只读 `/__test/pwa-s4b2/stats` 回填五个**纯数字**请求计数到脱敏 summary 并要求本次预期计数；Go 后置非零时工作流只过滤显示固定白名单 `S4B2` 失败类别，不输出 raw Gin 日志、JWT、文件正文或路径。没有为了通过降低或删除完整 Go 物理 SHA 校验，也没有更改任何生产上传逻辑。


**S4B2-A Go 目录归属失败的进一步复现与修正（2026-10-13）：** [Chrome/Gin 专项 #38336273069](https://github.com/lazyxu/xdrive/actions/runs/38336273069) 完整执行桌面 Chrome，脱敏摘要的 `session_posts=2`、`chunk0_puts=1`、`chunk1_puts=8`、`tcp_drops=7`、`chunk2_puts=1` 与浏览器 `passed=true` 一致；但 Go 严格在预期子目录按 Owner/parent/name 查询结果时报告 `S4B2 final original file missing`。源码核对揭示旧测试只等待 `GET /api/v1/nodes/<target>` 返回 200 和 `[data-xdrive-file-explorer]` 挂载，**没有等待 Files 实际导航目标目录完成**，之后就点击“上传文件”；因此文件可能被发到临时根目录。这是**待验证的测试点击时序假设**，不是已经被证实的产品上传目录 bug，更不能放宽 Go 目录归属或物理 SHA 校验。

同一单工作提交内修正浏览器验收的前置条件：桌面必须出现最后一段 `[data-xdrive-file-explorer-crumb][aria-current=page]` 绑定目标 folderID（DOM ID 带 `number:` 前缀）；窄屏 Mobile Web 应等待 `[data-xdrive-mobile-files]` 与准确目标目录标题就绪，采用实际“文件操作菜单 → 上传文件”菜单项，而非错误地寻找桌面按钮。硬刷新后仍必须再次确认目录就绪，最终 `final.result.parent_id` 必须与目标目录相同才认可成功，且两平台均记录脱敏布尔值 `targetFolderReady` 和 `finalizedInTargetFolder`。本次仍使用真实 Chrome 及真实 Gin/PostgreSQL/CAS；严格保留第一次会话 chunk1 连续真实 TCP 中断、首块仅上传一次、Go 全量读取物理 CAS SHA-256、隐私摘要与 S5 真机 not-run。必须以新准确 HEAD 的专项 Chrome 与完整 CI/Final Gate 验证，旧失败不可复用作绿灯。


## PWA-S4B2-B1 · 浏览器上传误选文件的真实拒绝验收（2026-10-13）

**续接与冻结基线：** S4B2-A [#1613](https://github.com/lazyxu/xdrive/pull/1613) 已在准确工作提交 `321fd1f095dd900485e30db1fd429661a78d05cb` 通过 [完整 CI #38337193327](https://github.com/lazyxu/xdrive/actions/runs/38337193327) 与 [真实 Chrome/Gin/PostgreSQL/CAS #38337193126](https://github.com/lazyxu/xdrive/actions/runs/38337193126)，线性合并 `8d918a58`，相关分支已清理。B1 固定 GitHub `master@d48f522b136579eb9d1ab526312bf92cf08f78a6`，独立单工作提交与 Draft PR，只有准确 HEAD 全 CI/Final Gate + 专项原生 Chrome 双绿才允许合并。

**B1 单次真实浏览器工作负载：** 继续使用现有隔离 Gin JWT/PostgreSQL17/Local CAS 的 17 MiB 非零原文件、8 MiB 首块与真实 TCP 中断、硬刷新、原文件重选、目标父目录归属和全字节物理 SHA-256，绝不重造生产 API。Desktop Chrome 1280px 与 Android UA/Touch 390px *模拟* 各先做两次错误重选：（1）字节、大小、时间相同而名字不同；（2）**名字、大小和修改时间相同但首字节不同**。每一次都必须通过真实文件选择器触发既有前端拒绝提示，观察浏览器**零个新 POST /api/v1/uploads** 与 Gin 请求计数始终只保留首次会话（`session_posts=1`），原失败任务的 manifest/重选入口仍保留。随后再次选择真正原文件并要求既有 B2-A 所有断点续传、父目录、CAS、隐私和缓存断言全部通过（最终应仍为 2 个 session）。

**边界和后续：** 本轮仅扩大真实 Chrome 的负向安全覆盖，不优化/重写产品代码；绝不持久缓存 File、Blob、媒体、Token 或私有字节。两个摘要仅含布尔/计数/运行阶段，拒绝归档原始网络日志、文件或凭证。Chrome Android UA + Touch **不是 Android 系统安装真机**；iOS 27 Safari/Home Screen、Android Installed、Desktop 系统图标、1/4 GiB 的*中断后*恢复、文件夹分组、锁屏/进程回收、原生下载落盘 SHA、公网 HTTPS/CA、S5 真实发布回滚仍为 **not-run**。1 GiB 不间断上传与真实中断后的重新选择是两个不同负载，不混为已完成。


**B1 第一轮真实 Chrome 失败记录（2026-10-13）：** 首个 HEAD `d29fc33ff0a82f93ff31cf164e4c20abbcde0765` 的 [专项真实 Chrome #38340988519](https://github.com/lazyxu/xdrive/actions/runs/38340988519) 在 Desktop 模式的 `reject-content-before-server` 阶段红灯，`PWA_S4B2_FAILED category=Error`。脱敏 summary 证明 `wrongNameRejected=true`、旧失败任务仍为 `retryable=true,hasManifest=true`，另外产生一个 `retryable=false,hasManifest=false` 的失败记录，`session_posts=1`，首次请求计数保持不变。**这是浏览器断言未通过，不是已证明产品向服务器上传了错误文件。** 原断言 `page.getByText(message)` 可能在 Snackbar 和失败任务行存在相同错误文案时触发 Playwright strict locator 错误（日志仅给 Error 类别，不能作更强断言）；改为等待当前可见 document body 包含精确错误消息，并继续保留浏览器 POST=0、Gin session=1、旧任务不消失及原文件最终物理 CAS SHA 校验。修订进固定基线的同一唯一工作提交后，**旧 HEAD 的所有 CI 不得作为新的验收依据**；当前准确 HEAD 的完整 CI、Final Gate 与 Chrome 双环境专项需重新通过。


## PWA-S4B2-B2 · 独立真实 1 GiB 中断上传／断点复用验收（2026-10-13）

**已合并上游与阶段：** B1 [PR #1626](https://github.com/lazyxu/xdrive/pull/1626) 在准确 HEAD `03802776533843fb0afe6f442af796cb3d34aa58` 的 [完整 CI #38341340388](https://github.com/lazyxu/xdrive/actions/runs/38341340388)（25 个作业含 Final Gate）与 [真实 Chrome/Gin #38341340220](https://github.com/lazyxu/xdrive/actions/runs/38341340220) 双绿后线性合并为 `80731cdd8c46b0bc9d766e7e6bfbb4b137f49208`；相关 PWA 分支已核实删除。本阶段固定 GitHub `master@c9d5210cbff8351bd9896e36d7834839a255cebe`，新建唯一工作提交；没有其他打开的 PWA PR/分支。全局清理 workflow 因 GitHub App 403 限流曾失败，不能把它误归结为 B1 合并失败。

**B2 冻结负载与真正的物理凭据：** 另启专属 branch-scoped workflow `.github/workflows/pwa-s4b2-real-1gib-resume.yml`，仅在显式环境标记 `XD_PWA_S4B2_LARGE_RESUME=1` 下，将现有 *隔离测试* Go/Gin/JWT/PostgreSQL17/Local CAS fixture 提升为确切的 **1,073,741,824 B（128×8 MiB）**，普通生产服务限额/上传 API 不变。真实 Chrome Desktop 1280px、Android UA/Touch 390px **模拟**分别在独立测试实例写入/fsync 一份非零确定性源文件，检查源文件真实磁盘分配≥98%，不是 sparse-zero benchmark。首会话仅接受 chunk0 后连续 TCP 丢弃 chunk1，强制失败/持久 manifest/冷刷新；实际 UI 人工重选同一物理文件后必须复用首块，完成 chunk1–127，证实 final chunk127 只请求一次、最终文件大小/父目录/Owner/SHA、Server 上传分块会话和独立 Go 对物理 CAS 全部 1 GiB 字节的 SHA-256 均匹配；SW 仍只缓存公开 `/offline.html`。Go 案例不会在日志/产物保存 Token、路径、File 或原件字节；两个产物只包含脱敏阶段、布尔结果和计数。

**不重复与平台边界：** B1 的 17 MiB 两类错误重选已独立真实 Chrome 双平台验证，本轮 1 GiB 不再生成两份额外 1 GiB 错误副本（避免将磁盘需求无意义扩大三倍）；继续保留已有小负载代码和原工作流不变。1 GiB 不间断真实性能 P042 与新的真实 TCP 中断人工续传 *不是*相同测试。内存、速度和 4 GiB 不代表自动通过；任何真实失败需先鉴别 Node/Playwright/Go/Docker/CI 磁盘 harness 问题，不能把不合理 fixture 当生产 BUG，也不降低既定 CAS SHA、目标目录、chunk0 复用、最后一块验收。先保持 Draft，**准确 HEAD 专项成功 + 完整 GitHub CI/Final Gate 通过**后才能 Ready→单提交 rebase merge→核实冗余分支清理。

**仍未实测：** 本测试的 Android UA/Touch 390px **不是**真实 Android 已安装系统 PWA；iOS 27 Safari 与主屏模式、桌面 Chrome/Edge 已安装图标、公网 HTTPS/CA、真实后台锁屏/强杀、文件夹分组失败续传、4 GiB 原生下载落盘 SHA/撤销和 S5 发布回滚独立保留。不存在保证 iOS 锁屏浏览器持续上传的行为，也不新增 Service Worker 私有缓存/后台重放/自动激活，保留 52px 全屏 App Frame 和 Web/Mobile 共用 API。

**S4B2-B2 首轮 Invalid harness（2026-10-13）：** 唯一原提交 `6cd4bc0e072a2ab9648281607815801504efa029` 的 [真实 Gin/Chrome 专项 #38347122987](https://github.com/lazyxu/xdrive/actions/runs/38347122987) 已成功完成真实 Web 生产构建，但在进入 Go 测试编译/浏览器前，执行 `gofmt -l internal/api/pwa_s2b3_real_gin_auth_integration_test.go` 返回非空，导致专属工作流格式门槛中止（没有两份 summary，也没有 1 GiB 文件/HTTP 续传测量）。原因是新增 `map[string]int64` 计数字段的 Go 字面量列间空格不符合 gofmt；只修正测试夹具对齐与本记录，不更动生产 API、浏览器上传逻辑、强制丢包、物理字节或 SHA 验收。以相同固定 `master@c9d5210cbff8351bd9896e36d7834839a255cebe` 重新创建**唯一一条**工作提交；旧 HEAD 全部 CI 证据作废，严格要求新 HEAD 完整 CI/Final Gate 和真实 Chrome/Gin 专项重新验证。此为测试夹具/格式错误，绝非已经观测到产品性能下降或上传失败。


## PWA-S4B2-B3A · Web 分组上传子文件安全断点恢复（2026-10-13）

**接续状态与单提交边界：** [#1635](https://github.com/lazyxu/xdrive/pull/1635) 已在准确提交 `4a3caa8c0bb988d5be918eeda8d529be41dea665` 通过 [真实 1 GiB Chrome/Gin #38347464662](https://github.com/lazyxu/xdrive/actions/runs/38347464662)（Desktop 与 Android UA/Touch 模拟，独立物理 CAS 全量 SHA256）和 [完整 CI #38347465096](https://github.com/lazyxu/xdrive/actions/runs/38347465096)（25 项含 Final Gate），并线性合入 `master@7393b843e2685ce50ac62a828d129f9d369b341f`；对应短期分支已删除。B3A 固定此 GitHub master 为基线，五个既有 PWA/共享控制器文件和一个新专用测试文件，**仅一个工作提交**，与其他 Race/Perf/图库 PR 分开。先验证 B3A 的源码、动态 TransferStore 合约与完整 CI/Final Gate，实际 Android OS Installed/iOS Safari 真机、真实文件夹目录选择器与 TCP 中断物理 CAS 留给 B3B 独立专项，不复用 B2 的单文件验收冒充文件夹测试。

**发现的真实源码缺口（需本次 CI 验证修复）：** Web 文件夹 `runGroup` 预先注册 parent/child，但 `uploadWithConflictPolicy` 在 `managedExternally=true` 时不保存 child 的 cloud-parent/mtime、完整 ordered-chunk manifest，也不调用子记录的 `fail`；旧 `finishLifecycle` 因此只留下不可重新选择原件的失败子任务。修复要求：从已经验证的 group cancellation owner 和目标 `parentID` 绑定 child 的 cloud_parent_id、file_name、size、lastModified；仅 `fail`（非破坏性冲突策略）记录**单一 64-hex manifest digest**，不持久化 File、Blob、upload token、chunk plaintext、绝对路径或签名下载。Web Group transport 在非取消的真实上传异常时记录失败 child，**由原共享 Controller 独占 parent 终态**；未开始的兄弟标记 cancelled，不向 Server 发送新请求。原失败 child 在刷新后仅在当前账户/同源、24h 会话有效、已重新选择且严格名称/大小/mtime/完整 manifest 相符的情况下，继续现有 Server 会话 SHA 复用；真实成功后只消费 child 的旧 manifest。恢复单个子文件不会把原始 group failed/partial 误改成 completed。终止 completed/cancelled/skipped 子记录应擦除摘要与 retryable 状态，剩余未执行兄弟不显示仍在排队。

**测试：** 新 Node + TypeScript *执行*真实 Web TransferStore 的父组、嵌套路径子任务创建、cloud ID 绑定、部分分块失败、失败终态、刷新恢复、手动核验后旧任务失效、不同账号隔离；非法 group/name/size/mtime、取消与已完成不允许保留 manifest、原 Web 单文件兼容。保留 shared Controller、Desktop Agent 原权限与真实目录扫描/取消逻辑，Web/Mobile 仍共享 FileExplorer 控制器和 REST API。**不声称**本阶段已实现 PWA 锁屏强杀持续执行、父组原地完整重启、重新选目录后自动批量恢复全部子文件，也不以 Chrome UA/touch 冒充 Android 系统安装实测。B3B 必须补真实 Web/Gin/PG/CAS 中文件夹中断/重选以及 iOS/Android 安装模式能力矩阵。


## PWA-S4B2-B3B · 真实目录选择、父组部分完成与失败子文件断点续传（2026-10-13）

**接续基线：** GitHub `lazyxu/xdrive` 上游 B3A [#1640](https://github.com/lazyxu/xdrive/pull/1640) 准确唯一提交 `421ac7c5d5fa7767fb7da9b3203c555f399c8042` 通过 [完整 CI #38354726499](https://github.com/lazyxu/xdrive/actions/runs/38354726499)，25 项含 Final Gate，全套 Desktop Node 2584/2584 成功；线性合并至 `master@b2642b62c00bb4e65b12e0bd1c8902d75b26bad1`。当前无未完成 PWA PR/分支。B3B 只扩展独立的已 opt-in S2B3 Gin/PostgreSQL17/Local CAS CI fixture，并新增专用系统 Chrome 文件夹场景、workflow、合约测试和本台账；不更改生产上传、同步、Viewer、SW 及 Desktop Agent，不追逐无关 master 的推进。

**唯一有别于 B2 的真实链路：** Desktop Chrome 1280px 与 Android UA/Touch 390px Chrome 浏览器模拟分别使用真正系统 Chrome FileChooser 选择**物理文件夹** `pwa-b3b-album`，经 Web/Mobile 共用 `webkitdirectory` 输入和 `fileUploads.runGroup`、共享目录解析器、实际 Gin JWT/PG17/Local CAS。文件夹包含根目录较小 `00-kept.bin`（已成功写入且实体 CAS 字节经过独立 Go 校验）、根目录 17MiB 非零确定性 `10-interrupted.mov`、嵌套 `nested/20-unstarted.bin`。第一子文件已完成、第二子文件首块 8MiB 已由 Gin 接收、首次会话 chunk1 的所有真实 TCP PUT 均断开，第三子文件应仍取消而不是默默发送；父组必须真实 `partial`，且 `items_completed=1/items_failed=1/items_queued=0`。整个文件夹的目标目录及 nested dir 应已被生产 API 创建，但第三个子文件 Node 不能出现。

**原文件恢复与后置证据：** 真实浏览器 hard reload 后父组保持 `partial`，故障子文件仍有原子级 SHA256 manifest、Owner/cloud parent ID、正确 relativePath/size/lastModified；经已有“上传与下载→历史记录→展开子任务→重新选择原文件”实际 Chrome 文件选择器，仅选择失败的子文件，必须成功复用原首块（3 upload session POST、两次 chunk0 PUT、chunk1 在首会话多次真断线且恢复一次、chunk2 仅一次）；真正 Gin finalize SHA、Node 云端父目录、完整物理 CAS 所有字节的独立 Go SHA 均匹配。恢复一个子文件不会将旧父组伪改为 completed；另一个嵌套子文件仍不得提交。敏感文件、用户名、路径、原始 Gin/网络日志、JWT/Cookie/Profile 和 CAS 字节绝不归档，仅两个固定脱敏 summary JSON。SW CacheStorage 仍只允许公开离线页面。

**验收与未完成：** 新 branch-scoped GitHub Actions `.github/workflows/pwa-s4b3-real-folder-resume.yml` 和独立 Node 契约测试不影响已合入 B2 的 17 MiB / 1 GiB 专项。完整准确 HEAD PR CI/Final Gate **以及**同 SHA 的真实 Browser/Gin/PostgreSQL/CAS Desktop+390px 模拟均成功后才 Ready → 单提交 rebase merge → 相关工作分支清理。Browser 390px 不是 Android OS Installed；iOS 27 Safari/Home Screen、真实 Android Installed、Desktop OS 安装、锁屏/进程回收、真公网 TLS/证书与 4 GiB 浏览器下载落盘 SHA、S5 发布回滚仍均 not-run。本测试不承诺 iOS/Android 进程回收后 File 对象仍存活，也不虚构 OS 后台传输能力。


**B3B 首轮 Invalid harness（2026-10-13）：** 初始唯一提交 `068e12b295a60569ec06b3ed5588bb268c130d22` 的 [独立真实 Chrome/Gin 专项 #38356546933](https://github.com/lazyxu/xdrive/actions/runs/38356546933) 在完成真实 Web 构建、gofmt 和 Node 新合约测试启动后，`B3B actual directory FileChooser`、`exact-head CI` 两项静态字符串合约检查失败；原测试把实际 JS 中 `unstarted?.state==='cancelled'` 错误写成 `t.state==='cancelled'`，以及把 workflow 中受控 `required=['originalParentRemainedPartial','physicalCASVerified']` 检查误写成逐字段 `r.originalParentRemainedPartial`。这是 **test-only contract harness 假阴性**，真实系统 Chrome、Gin/PG/CAS 物理文件上传与恢复**尚未执行**，不能宣称产品 RED 或 GREEN。只调整合约断言匹配实际语义，保留全部真实浏览器/Go CAS 与父组验收条件；与此事实记录一并折叠到固定 `master@b2642b62` 的同一个工作提交。旧提交的 CI 不再有效，新准确 HEAD 必须重新通过完整 PR CI（Final Gate）及 branch-scoped 真实 Chrome/Gin 专项。

**B3B 准确 HEAD 第二轮 First-red（2026-10-13）：** 提交 `5cf38bfb6885ed85ea16d3a9fc119236cd221746` 的 [真实 Chrome/Gin 专项 #38356820665](https://github.com/lazyxu/xdrive/actions/runs/38356820665) 在 Go/Web 构建和四项 B3B Node 合约通过后首次进入 Desktop Chrome，停止于 `real-folder-chooser TypeError`。只归档的脱敏 `summary-desktop.json` 显示 `folderPicker=false`、`session_posts=0`、`chunk0_puts=0`、`tcp_drops=0`，没有真实目录数据写入或 Server 上传失败证据。原因是 Node Playwright `FileChooser.element()` 直接返回 ElementHandle，错误脚本对它调用 `.then()`；改为直接对元素句柄 `.evaluate()`，仍要求真实 `webkitdirectory` 属性存在，保持真实 OS 文件夹选择与 Gin/PG/CAS 验证。同期 [完整 CI #38356821113](https://github.com/lazyxu/xdrive/actions/runs/38356821113) 的 Desktop Node 测试因**旧 B2 源码合约**仍期待常量 `uploadSessions.Load()<2`／`!=2`／`chunk0!=1` 而失败；B3B 将阈值安全改成 `faultRecoverySession=2/3`、`expectedSessions=2/3`、`expectedChunk0=1/2`，所以同步升级旧 B2 合约，使其仍核查 **旧单文件模式恰好2会话和1次首块**，且 B3B 独立模式3会话和2次首块，绝不削弱产品或物理 SHA 门槛。修改折叠到固定 `master@b2642b62c00bb4e65b12e0bd1c8902d75b26bad1` 的唯一新工作提交，旧 HEAD 全部 CI 作废。

**B3B 真目录枚举顺序 First-red（2026-10-13）：** 真实 Chrome/Gin 专项 [#38357602475](https://github.com/lazyxu/xdrive/actions/runs/38357602475) 确实通过系统 FileChooser 选择物理目录并进入真实 Gin/PG，但 Desktop 等待 `await-partial-group` 状态超时。脱敏摘要：`folderPicker=true`、`session_posts=1`、`chunk0_puts=1`、`tcp_drops=7`、`chunk2_puts=0`。说明实际浏览器枚举首先上传了测试指定为故障文件的 MOV，原先假定第一个小文件必定成功的测试夹具无效；**不是已证实的产品漏传/物理 CAS 失败**。共享 `xDriveFileExplorerFolderUploadPlan` 按浏览器 FileList 顺序保留文件项，OS 目录顺序本来不可猜，不改变生产排序来迎合测试。

**B3B 顺序无关修正：** 使用一个真实系统目录中的两个根文件和一个嵌套文件，每个都是磁盘实际写入、fsync 的 **17 MiB 非零确定性数据**，三文件不同 seed 与原始 SHA。让真实 FileList 中**第一项完全上传并完成**，只对第二个上传会话的 chunk1 真 TCP 连续断线；第三项始终取消，不得提交。通过真实历史记录动态识别完成、失败、取消三种子任务，失败后冷刷新，在“重新选择原文件”中选取对应磁盘原件，保留真实目标 parent、原始摘要、失败父组 `partial`。HTTP 必须 3 个 POST session、2 个 chunk0、2 个成功 chunk2，首会话成功+恢复会话成功的 chunk1 共2次，首故障会话的重复断线数等于 `chunk1_puts-2`。Go 不根据文件名假定处理顺序，逐一检查三个固定候选的 Owner/parent、独立全量 SHA 与真实 Local CAS 字节，**恰好2个有效文件、1个未提交文件**，嵌套目录存在且外部用户不能读取。两个源文件归档 summary 只含脱敏布尔/计数/阶段与枚举不相关的任务状态，不含本地路径、文件名、JWT 或原始 Gin 日志。B2 小文件/1GiB 旧模式仍保持原首会话断线、2个会话和1次 chunk0 的严格合同。需要新准确 HEAD 的真实 Chrome/Gin 专项和完整 CI/Final Gate **双绿**才可合并。

## PWA-S4C3-A · 4 GiB signed native-download Range transport gate (2026-10-13)

**本次实际范围（非完整 native 下载验收）：** S1–S3 已合并，S4B2-B3B [#1646](https://github.com/lazyxu/xdrive/pull/1646) 在准确 HEAD 的真实 Chrome/Gin/PostgreSQL/CAS 和完整 CI/Final Gate 双绿后于 2026-10-13 合并，PWA 相关短期分支已清理；当前从冻结 GitHub `master@30148b3e356be76e7f595d6b656ee41d9ef446de` 开始 **S4C3-A**，不与 performance P044 的 4 GiB Web/OPFS 整文件高熵验证重复。AGENTS.md 的入口仍指向本台账。

**新增边界回归：** 在现有独立 PostgreSQL schema + 真实 Gin Router + 本地 Store + 已登录 Owner 签名 ticket 集成测试内，增加 **4 GiB + 17 B 稀疏文件**；只读取恰好跨越 2 GiB 的标记区和 **超过 4 GiB** 的尾段，断言 `206`、64 位 `Content-Range`、`Content-Length`、确切响应字节与 `Cache-Control: no-store`。对第一条越界 Range 验证 `416` 和 `Content-Range: bytes */total`；会话撤销后，同一 4 GiB ticket 的 Range 必须 `401`。真实端点与鉴权复用生产代码，测试目录内容仅合成且不缓存原件。

**必须严格区分：** 稀疏文件和少量 Range 校验证明的是 **64 位 seek / HTTP 响应与权限边界**，**绝不能**证明完整 4 GiB 字节 SHA、Chrome/Android 浏览器 Native Download 真正写盘成功、取消后本机部分文件被正确丢弃、Range 自动重试或 iOS 27 Home Screen 真机能力；这些维持 `not-run`。P044 只证明 Web/OPFS 高熵完整下载，不可移作 Native Download 证据。

**门槛与后续：** 本阶段 Go 源文件 gofmt 和独立 Go 标准库 sparse/ServeContent 64 位 range 探针通过；完整仓库集成/CI 需在准确 PR HEAD 验证。保持单工作提交 + Draft，完整 PR CI 与 Final Gate 成功后才可 Ready/线性合并并核查分支清理。接着 S4C3-B 应使用真实 Playwright Chrome 浏览器接管原生下载，验证实际下载盘文件 1/4 GiB SHA-256、取消/票据失效和 206/416；之后推进 S4D 生命周期与 S5 iOS/Android Installed/HTTPS/回滚真机验收。

## PWA-S4C3-B1 · 真实 Chrome 原生下载到 OS 文件并校验完整 SHA-256（2026-10-13）

**已收尾的上游：** S4C3-A [PR #1654](https://github.com/lazyxu/xdrive/pull/1654)，准确 HEAD `a9531ce0` 的[完整 CI #38361675993](https://github.com/lazyxu/xdrive/actions/runs/38361675993) **25 成功/51 条件跳过，Final Gate success**，已单提交线性合入 `master@2f04e5612bc4b2bfb72162ab9bb5b2c5d985f230`，旧分支清理，开放 PWA PR/分支为空。冻结这个 master 继续 B1，不重复 P044 的 Web/OPFS 4 GiB 完整高熵性能回归。

**B1 的独立、可复核真实验收范围：** 复用隔离 `TestPWAS2B3RealGinAuthFixture` 的真 Gin Router / PostgreSQL17 schema / Web 生产构建 / Owner 登录和严格目录路由，仅在 `XD_PWA_S4C3_NATIVE_DOWNLOAD=1` 的 test-only 模式种入 **1 GiB 真正写盘（Linux allocated ≥98%）的 AES-256-CTR 合成源**到 immutable canonical Local CAS。生成流两遍、第一遍计算 SHA-256、第二遍写入并被 Storage 自身验证；独立 Go 后置全读 CAS 检查 SHA、数据库 Owner/文件/Blob 引用不变。Node Playwright 通过真实桌面与 Android UA/touch 390px 的 Web/Mobile Web 文件管理器菜单点击“下载”，测试时明确关闭 `showSaveFilePicker` **能力以走浏览器原生下载回退**，不 mock HTTP、Server、File/Blob 或下载响应。真正的 Chrome `Download` 保存到临时 OS 文件，要求实际占盘率≥98%、完整大小和 Node 流式重新读取的全量 SHA 等于 Gin CAS 原始 SHA；原生签名 URL 在内存内复验真实 `206` 首/尾 Range、`416` 越界和无票据 `401`，SW CacheStorage 只能含公开 `/offline.html`。真实下载文件、JWT、ticket URL、浏览器 profile、Gin 原始日志绝不归档，只存不含凭据的阶段/布尔/大小摘要。

**独立 CI 及交付门槛：** `.github/workflows/pwa-s4c3-real-native-download.yml` 仅对这一 B1 PR 专项分支或手动 dispatch 执行，默认两个环境各 **一次 1 GiB**，4 GiB 为有真实磁盘 preflight 的单独 `workflow_dispatch` 选项，**未运行不得宣称 4 GiB native 通过**。固定唯一 work commit、准确 HEAD 的完整 PR CI/Final Gate **以及** Chrome+Go 实体专项两者皆成功后才允许 Draft→Ready→单提交线性 merge→核对自动 cleanup。失败先区分本测试夹具/浏览器选择与产品缺陷，不降低全字节 SHA/Owner/权限/缓存/空间门槛。

**平台和下一阶段：** Chrome Android 触摸/UA 390px 只是模拟，不是 Android `OS Installed`，更不是 iOS 27 Safari/Home Screen，不能保证锁屏或强杀后台仍能下载，也未验浏览器管理的中断下载后自动 Range 续传、系统实际 Download Manager、iOS Files App 目标或 4 GiB 已安装模式。本测试检查“正常完整下载后实际落盘 SHA”，不把既有 OPFS 测试冒充 native。S4C3-B2 继续 4 GiB native 下载与取消/过期/撤销/自动 Range 续传，随后 S4D 前后台生命周期、S5 真机 HTTPS/性能/隐私/发布回滚。保留 52px App Frame、Web/Mobile Web 共享 REST/虚拟组件与 Server Durable Task 边界。

## PWA-S4C3-B2a · 实际浏览器原生下载 4 GiB 全字节物理落盘验收（2026-10-13）

**接续证据：** S4C3-B1 [PR #1659](https://github.com/lazyxu/xdrive/pull/1659) 准确提交 `bb845d509960bee73d7f150f6dd9794b851b5ec0` 在[真实 Chrome/Gin/PostgreSQL/CAS #38365060202](https://github.com/lazyxu/xdrive/actions/runs/38365060202) 的 Desktop 1280px 和 Android UA/Touch 390px 模拟下，1 GiB 浏览器原生下载到真正 Linux 磁盘、完整 SHA-256、独立 Go CAS 校验、Range 206/416 和 signed ticket 权限全绿；[完整 PR CI #38365060421](https://github.com/lazyxu/xdrive/actions/runs/38365060421) 25 required jobs incl Final Gate success。单提交 rebase 已合入冻结 `master@e52bd6bf36989462c74d4a1dc368d2468022d69b`，原短期 PWA 分支查得 Git Ref 404，开放相关 PR/分支为零。

**B2a 具体边界：** 只在既有 B1 专项工作流中加入有明确目标的 `test/pwa-native-4gib-s4c3b2a-20261013` 分支自动验收；`XD_PWA_S4C3_SIZE_GIB=4`，真实源 `4,294,967,296 B` 的 AES-256-CTR 确定性非稀疏磁盘实体写入 immutable CAS（Linux 实际占盘≥98%），Desktop/Android-UA 390px 两次独立真实 Chrome 浏览器的 Web/Mobile Web 文件管理器 UI → 签名下载 → Browser Download event → `saveAs` 真正 OS 目的文件。每次对整个落盘原生文件流式读取 SHA-256（**不是** OPFS, Blob, sparse-zero 或只验首尾 1MiB），与生产 Gin/PostgreSQL/CAS 源 Hash/字节相同，独立 Go 再完整读取原件 CAS；真实 Range 206 首尾 32 B、越界 416、无票据 401、SW 公共离线页缓存仍维持。既有 1 GiB B1 工作流触发和 `workflow_dispatch` 可选 1/4 GiB 不改变；扩大 `desktop/tests/pwa-s4c3-native-4gib-contract.cjs` 的源代码/安全 CI 合约。

**安全与门槛：** 真正 4 GiB 原生测试必须有合理可用磁盘（Runner preflight ≥12 GiB），不足空间直接失败，不降级 sparse fixture 或缩小负载。两种真实浏览器模式串行，测试实例独立；签名 URL/JWT、物理文件字节、Gin 私有日志和 Profile 不归档，只允许脱敏 JSON 的阶段、真值与总大小。新增分支必须在准确 **一个**工作提交之上，**专用原生测试及完整 CI Final Gate 双绿**才可 Ready→线性合并→工作分支自动清理，不借旧 B1 CI 证据代替新 HEAD 验收。

**未完成不冒充：** 这不是 iOS 27 Safari/Home Screen、Android 真机 `OS Installed` 或真实下载管理器落盘/锁屏/进程回收验收。此时原生网络传输取消后是否真正停止 Go 请求、用户手动中断后的 HTTP Range 自动恢复、浏览器原生下载系统文件权限，以及票据过期/账户撤销仍须 S4C3-B2b/B2c 独立验证。之后 S4D 前后台/任务状态，S5 iOS/Android Installed、HTTPS/CA、性能/安全和发布回滚。

## PWA-S4C3-B2b · Go ctx.cancel 与 4 GiB 真实 HTTP 下载中断（2026-10-13）

**依赖与范围：** 从 B2a 唯一提交 `7232423bc05d382d5947275e3b8c44fc5f0516f2` 的测试树堆叠单独一个测试提交，仅增加真实 TCP/HTTP 下载取消回归（及本记录），不修改生产下载、Service Worker、鉴权或图库 UI。B2a 的 4 GiB 非稀疏原生 Chrome 浏览器专项需要单独准确 HEAD 全绿和线性合并；本测试不能借它的 SHA 证明取消行为。

**独立模拟的真实边界（非浏览器模拟）：** 现有已签发且受 Owner/SessionVersion 保护的 `4 GiB + 17 B` **稀疏仅用于 Range** 本地文件，启动 `httptest.NewServer` 真 HTTP/1 TCP，`http.Client.Do(Request.WithContext)` 带 `Range: bytes=0-4294967312`，严格核对 206 和 64 位 Content-Range，并实际从 socket 流读取 32 KiB 后调用 Go `context.CancelFunc` 关闭客户端连接。要求已有生产 `trackDownloadProgress` / Request.Context 观察在 12s 上限内归类 `cancelled`，`active_requests=0` 且 `0 < bytes_sent < 4 GiB + 17 B`。真实取消之后，使用同一尚有效 ticket 单独请求尾部小 Range，要求原 CAS 字节仍正确；随后已有 SessionVersion 撤销测试继续确保 401。不能用 ResponseRecorder、虚假计数或伪造成功状态替代真实 TCP 断连证据。

**证据与下一项：** 该测试进入既有 PostgreSQL17/Gin `go-linux-api` 完整 CI/race 工作流；必须保持一条新增工作提交、准确 HEAD 完整 CI 含 Final Gate 全绿才可合入。不宣称 Playwright `Download.cancel()`、Android/iOS Installed OS 下载管理器、磁盘临时文件擦除、续传 206 自动合并、锁屏或强杀已经被测试。下一阶段 S4C3-B2c 专门执行真实 Chrome Native Download 用户取消和重新下载/票据过期与撤销；随后 S4D 和 S5。

## PWA-S4C3-B2c1 · 真实 Chrome Native 下载取消及重新下载（2026-10-15）

**基线：** 上游 B2b PR #1667 准确 HEAD `3dfdd3ba` 通过完整 CI #38369204432、Final Gate，线性合并至 `master@0463cb95c460a34e28184fe8f749f3184e64b122`，相关工作分支已自动清理。固定此 master，仅处理 PWA S4C3-B2c1。B1/B2a 的 1/4 GiB 全字节真 Chrome 原生落盘 SHA、B2b 的 Go TCP ctx.cancel 仍为独立已合入证据，不混作系统安装真机。

**本轮实现，待准确 CI 验证：** 在原有生产 Web 构建、真实 Gin/JWT/PostgreSQL17/1 GiB 物理非稀疏 CAS 和 Chrome Playwright Desktop/Android UA 390px 模拟专项内，增加仅 `XD_PWA_S4C3_CANCEL=1` 的第一次签名 HTTP 响应节流（真实 ServeContent 写入，非 fake Range/响应，不进入生产）。用户从真实 Files 菜单触发第一次原生下载，浏览器 `Download.cancel()` 应报告 `canceled`；再次点击同一 UI 应获得不同的 signed ticket，真正将全部 1 GiB 写入 OS 文件后流式重读 SHA-256，且 Go 独立核验原 CAS 全字节未变。Go 从真实 PostgreSQL 验证**恰好两条不同票据**的进度：取消第一次 `state=cancelled`、`failure_state=cancelled`、`active_requests=0`、`0<bytes_sent<1 GiB`；第二次 `state=completed`、`active_requests=0`、`bytes_sent=1 GiB`。如果浏览器其实没有真正取消服务端流，不得以 UI cancelled 冒充成功。

**不削弱旧测试：** 正常 1/4 GiB 的原始 B1/B2a Mode、Range 206/416/无票据 401、缓存隐私断言保持；取消专项不再对完成后的*同一个* retry ticket 发成功的额外 Range GET，以免重新开启该票据 DB 下载进度并覆盖完整文件证据。原有 206 和真实 4 GiB 全盘 SHA 仍由之前已合并专项证明。隔离 CI 仅归档 boolean/bytes 的 `summary-*.json`，JWT、signed URL、Gin 原始日志、磁盘文件和用户路径绝不归档。

**合并门槛：** 本阶段必须保持相对于固定基线恰好一个工作提交，新 Draft PR 准确 HEAD 的完整 PR CI（含 Go/PostgreSQL、Web、Desktop、Final Gate）与新增分支触发的真实 Chrome 专项均成功，再 Ready→rebase merge 并查分支清理。代码审查/合约检查不等于真实测试通过。iOS 27 Safari/Home Screen、Android OS Installed、系统下载管理器临时文件清理、网络自动 Range 恢复、票据过期和账户 SessionVersion 撤销、生产公网 HTTPS/CA、锁屏/杀进程及发布/回滚依然未验证；下一个 B2c2 做过期/撤销，之后 S4D/S5。

## PWA-S4C3-B2c2 · 签名票据过期、撤销和显式 Range 重新授权（2026-10-15）

**固定基线与依赖：** GitHub `lazyxu/xdrive` `master@8bc87cd7a63906c6f5b390f2cdc6615f05d3cd3e`；上游 S4C3-B2c1 [PR #1669](https://github.com/lazyxu/xdrive/pull/1669) 准确 HEAD `593a5337` 在[真实 Chrome/Gin/PG/CAS 专项 #38715777596](https://github.com/lazyxu/xdrive/actions/runs/38715777596) 和[完整 CI #38715777419](https://github.com/lazyxu/xdrive/actions/runs/38715777419)（25 successes、Final Gate）成功后线性合并至 `0e1b0466`；前序 PWA 临时分支清理已核实。当前无相关未合并 PR/分支。本阶段仅增加真实 HTTP/PostgreSQL 回归、专用 GitHub Actions 和本台账，不改生产 JWT、文件字节、Service Worker、52px App Frame、Files/Gallery REST 或上传取消策略。

**本次可验证路径（准确 HEAD CI 通过前不称已验收）：** 复用既有独立 PostgreSQL17/Local CAS `newNativeDownloadProgressFixture`，以 `httptest.NewServer` 驱动真实 Gin 签发与 HTTP TCP Range，独立 Go HTTP Client 实际读取网络响应字节。首次真实用户 POST 签名票据后 GET Range 0–4，核对 206、Content-Range、Content-Length、源字节和 no-store，Server 权威进度 completed/5。调用**现有生产 JWT 签发器**生成一个仅测试使用的 1 秒 file 票据，等待真实到期时刻后请求 Range 5–9 必须 401，不返回私有字节/Range 元数据、不激活排队进度、不改首次记录。再次经真实 owner bearer 签发新票据补取尾 Range，重组真实原 CAS 10 字节后验证完整 SHA-256；旧票据仍拒绝。合法签名借用其它文件 ID 401，其他用户无法签发文件。

**撤销边界：** 修改实际 PostgreSQL `xd_users.session_version` 后，先前签名 URL 的后续 Range 和旧 bearer 的新签发须全部 401，旧进度不因拒绝调用增字节；新会话不可查询旧版本下载进度（404），必须重新完成身份授权签发，新的票据正确读回 Range 且 CAS 字节不变。由原 `go-linux-api` PostgreSQL race CI 和专属 `PWA S4C3-B2c2 Real Signed Ticket Expiry and Revocation` 作业共同验收，专属 CI 仅报告固定非敏感状态，不归档 Gin 原始日志、JWT、签名 URL、用户资料、文件、原件或部分字节。

**严格未验收：** 本测试为真实 Go HTTP+PostgreSQL，但不是浏览器 OS Download Manager 的自动续传、iOS 27 Safari 主屏、Android Installed、Desktop OS Installed、真实公网 HTTPS CA/DNS、弱网／锁屏／进程回收、Safari Files App 落盘或 S5 发布回滚。仅能宣称“重新授权后显式请求 Range”；不得声称 OS 自动拼接剩余字节。严格一个工作提交、Draft PR、准确 HEAD Go 专项与完整 CI/Final Gate 全绿才 Ready→rebase merge→核查分支删除；下一阶段 S4D 前后台与 Server 任务恢复，之后 S5 真机验收。保持 Service Worker 不缓存任何私人数据、不自动更新中断上传或 Viewer。

**首次 CI 的已诊断格式问题（2026-10-15）：** 原唯一提交 `8339e73c` 的[专门真实 HTTP/PG 工作流 #38721204009](https://github.com/lazyxu/xdrive/actions/runs/38721204009) 在 `Verify exact PR HEAD and Go formatting` 阶段停止；[完整 CI #38721204765](https://github.com/lazyxu/xdrive/actions/runs/38721204765) 的 `go-linux/Check formatting` 给出唯一差异：`strings.HasPrefix(ticket.URL,` 的下一行 `fmt.Sprintf` 多一个 Tab。此时真实 HTTP/PG 测试**未执行**，不代表生产下载逻辑失败。只按准确 `gofmt -d` 删除该额外缩进，并在固定基线上重建唯一工作提交；旧 SHA 的所有 CI 证据不作为修复后验收，新 HEAD 必须重新通过专项 Go/PostgreSQL 和完整 Final Gate。

## PWA-S4D2 · 真实 Chrome 前后台切换及 Server 权威任务状态刷新（2026-10-15）

**接续与冻结基线：** GitHub `lazyxu/xdrive`，前置 S4C3-B2c2 [PR #1679](https://github.com/lazyxu/xdrive/pull/1679) 已在准确唯一提交 `9e642c81` 的[真实 PostgreSQL/TCP 专项 #38721477871](https://github.com/lazyxu/xdrive/actions/runs/38721477871) 和[完整 CI #38721478253](https://github.com/lazyxu/xdrive/actions/runs/38721478253)（25 项成功含 Final Gate）全部通过后线性合入 `master@a6a30eeda47304716522a4553c889063e9253cd4`；短期 PWA 工作分支已核实全部删除。已有 S4D1 [PR #1551](https://github.com/lazyxu/xdrive/pull/1551) 已合并 Web/Mobile Web/Desktop 共用 `TaskWakeRefresh` 的 pageshow/focus/online/visibilitychange 只读刷新，本阶段不重复实现或修改其生产语义。固定本工作基线 `master@9689237e6ac391b9fd441a09cd71e749090d8677`。不触碰无关性能/race/图库/设备备份 PR。

**本次精确测试范围（提交时不代表已通过）：** 仅在原隔离 `TestPWAS2B3RealGinAuthFixture` 的 `XD_PWA_S4D2_WAKE=1` 模式，使用真实 `Gin Router + PostgreSQL17 + Local CAS` 种入两条持久 `Source/SyncRun` 元数据记录：owner `running`（4/10），foreign `running`（4/10）。Chrome Desktop 1280px 与 Android UA+touch 390px **模拟**登录生产 Web、进入真实 `#/app/transfers` 和 MUI 任务列表，确认当前用户仅显示自身的真实 `sync-run` 活跃状态。再用**真正第二个 Chromium tab**切走使初始 tab 的 `document.visibilityState === hidden`，隔离测试专用、固定路径和固定标头 `POST /__test/pwa-s4d2/advance` 只在 Server DB 原子地把 owner 的单条 `SyncRun` 改为 completed/10 且保持 foreign 不变；这**不是**模拟生产同步执行成功或浏览器锁屏任务持续运行。切回原 tab 后必须捕获生产共享 TaskCenterController 触发的真实授权 **GET** `/api/v1/background-tasks/active-summary`（active_total=0/sync_run=0）和 `/api/v1/background-tasks/page`（原 sync-run 出现在 completed 历史中、活跃列表不再存在），实际可见共享 MUI 卡片从“进行中”变“已完成”；硬刷新后仍一致。所有浏览器触发的 task control、upload 禁止请求均为零，Server 后置独立核验 DB owner 完成、foreign 仍 running，owner/foreign 各自权限范围的摘要和任务页正确，SW CacheStorage 只有公开 offline.html。

**交付门槛：** 本阶段只新增专用 Linux Go fixture、Chrome runner、Node 契约测试、独立真实 Chrome+PG CI 和本台账，并对已有测试主入口做可选接线。不修改生产 REST/Auth/transfer/Viewer/Service Worker，也不发起任何持久任务取消/重试或隐式重放。用准确 HEAD 的完整 GitHub PR CI（含 Web/Desktop/Linux/Windows/升级回滚/Final Gate）与独立真实浏览器专项双绿作为合并前提，保持单工作提交、Draft→Ready→linear rebase merge，再核实短期分支清理。只归档脱敏 summary-desktop/mobile.json，不公开浏览器 profile、登录 Token、Gin 原始日志、Node ID 或文件字节。

**平台实测限制：** 390px Android UA/touch 只是 Linux Chrome 模拟，不是 Android Installed；未完成实际 iOS 27 Safari/Home Screen、Android OS Installed、Desktop 系统安装 PWA、手机切 App/锁屏/进程死亡、真实 Server durable worker 完整执行、生产 HTTPS/CA、1/4 GiB 系统下载管理器、S5 性能/安全/发布回滚。下轮继续 S4D3 真实 Server durable task 生命周期与浏览器回收、再进入 S5 各设备真机门槛，不把合成 DB 状态变化当作后台任务成功执行。

**S4D2 首轮格式门槛（2026-10-15）：** 原准确 HEAD `a158abaf3ba4a04387244d6fdf7f6f07ba911610` 的[专项 CI #38724914808](https://github.com/lazyxu/xdrive/actions/runs/38724914808) 在 `Build authentic Web` 的 `gofmt -l` 检查失败，Chrome/Gin 实际业务测试尚**未执行**。原完整 [CI #38724914741](https://github.com/lazyxu/xdrive/actions/runs/38724914741) 的 `go-linux/Check formatting` 明确给出唯一受影响新文件 `internal/api/pwa_s4d2_wake_fixture_test.go` 中 Source/SyncRun/更新 map 的字段对齐差异。这是新测试夹具格式错误，不是已复现的产品 bug；只按 gofmt -d 修正测试文件并记入台账，原冻结基线、一条工作提交与所有严格真实浏览器、Go Postflight、账号隔离、隐私断言不变。新准确 HEAD 需要完整 CI/Final Gate 与 Chrome 专项重新通过，旧 SHA 不作为合并证据。

**S4D2 首次真实浏览器 First-red（2026-10-15）：** 唯一 HEAD `9ee25d5c6afa272247448c7e3109b2fa946d86d7` 在[真实 Chrome/Gin 工作流 #38725247198](https://github.com/lazyxu/xdrive/actions/runs/38725247198) 中已通过 Web 构建、Go 编译与 3 项 Node 契约检查，进入 Desktop Chrome 后于 `login-deep-link` 阶段超时，未完成真实 tab hidden/Server DB 状态变化，不能断言产品前后台刷新失败。核对已合入 `web/src/webApps.ts` 的权威路由发现任务一级 App ID 是 `tasks`，而脚本错误访问 `#/app/transfers`（它只是 workspaceKey，不是 App Route ID）。只把真实浏览器进入地址及对应测试契约更新为 `#/app/tasks`，保持生产 App/Server、真实请求、owner/foreign DB postflight、可见性与缓存安全门槛完整；固定原基线重建唯一工作提交并重新要求完整 CI/Final Gate + 真实双环境 Chrome 专项，新旧 SHA 不能混用作为合并证明。

**S4D2 Chromium 前后台 First-red（2026-10-15）：** 准确 HEAD `6e07c279` 的[专用 Chrome/Gin/PG CI #38725793907](https://github.com/lazyxu/xdrive/actions/runs/38725793907) 已通过 Go 格式/Node 契约、生产 Web 构建、真实登录及当前 owner「进行中」MUI 卡片，然后在 `actual-background-tab` 等待 `visibilityState=hidden` 超时；Server 状态推进尚未调用，故不能宣称生产前台刷新有错。Playwright 为管理的每个 tab 模拟前台聚焦，`context.newPage() + bringToFront()` 在此 CI 中不能产生可证明的原生 hidden；独立本地 Chromium 原生 CDP 两 tab 实验能观察实际 active tab 切换后的 visible/hidden。保留所有数据库权限、真实 GET、UI、隐私/缓存和双环境门槛，仅将本专项测试改为 **Puppeteer CDP + Xvfb headed Chrome**，timer polling 等待真实 hidden（background 的 requestAnimationFrame 不可靠）；严禁 JS 合成 visibilitychange、CDP 强制生命周期状态、API mocks 或 headless 假冒真实后台。保持冻结基线、单一工作提交，新 HEAD 的专用 CI + 完整 Final Gate 必须双绿后才可合并；此验收仍不是 iOS 27/Android/桌面 OS Installed 或锁屏回收实测。

**S4D2 Puppeteer 转换后的静态契约 First-red（2026-10-15）：** 新准确 HEAD `7d968f0b` 的[专用 CI #38728027186](https://github.com/lazyxu/xdrive/actions/runs/38728027186) 在 Build authentic Web 前置 Node 测试中失败：旧源码契约仍要求已删除的 Playwright `task.getByText('已完成'`，而实际替代调用是 Puppeteer `waitForTaskState(page, ready.wake_task_id, '已完成')`。这属于仅测试断言未同步的假阴性，真实 Chrome/Gin 本轮尚未执行；只同步断言与本事实记录，不改变生产及真实 hidden/Owner 约束。继续固定同一 master 基线重建唯一工作提交，新 HEAD 专项与全 CI/Final Gate 重新开始，不能以旧红/旧绿冒充新验收。


**S4D2 完整交付及分支清理（2026-10-15）：** 唯一准确 HEAD `925d781b0b9064b7ffa70c5fe9575952b2dc732e` 的 [真实 headed Chrome/Xvfb/Gin/PostgreSQL17 专项 #38728248569](https://github.com/lazyxu/xdrive/actions/runs/38728248569) Desktop 与 Android UA/Touch 390px 两模式均通过，[完整 GitHub CI #38728248572](https://github.com/lazyxu/xdrive/actions/runs/38728248572) 包括 Go race、Desktop、Web、Linux/Windows、回滚与 Final Gate 全绿；[PR #1687](https://github.com/lazyxu/xdrive/pull/1687) rebase 合并为 `master@cde9912b3a4e7efc7285c031824940530dfc55b3`，短期分支已核实删除。该阶段用测试专用 SQL transition 证明真实浏览器 foreground read-only reconciliation，**不**宣称实际 Server worker 曾执行，亦不代表移动设备真实锁屏验收。下一个 S4D3 单独验证持久 Server Worker 与浏览器进程退出的隔离性。

## PWA-S4D3-A · 实际 Server 文件任务在浏览器进程终止后独立执行（2026-10-15）

**固定基线：** GitHub `lazyxu/xdrive master@cde9912b3a4e7efc7285c031824940530dfc55b3`，S4D2 #1687 全门槛成功并合入，PWA 相关旧 PR/短期分支均已收尾。严格只创建一个 PWA 专项分支、一个工作提交，保持 52px App Frame、Web/Mobile Web 共用任务中心/API、原 Service Worker、JWT/权限及桌面 Agent，不修改生产文件操作、上传/下载或 Go ctx.cancel 行为。

**真实而有边界的执行链路（准确 CI 通过前不称通过）：** 在原独立的 `TestPWAS2B3RealGinAuthFixture` 开启 `XD_PWA_S4D3_DURABLE=1`，使用生产 `POST /api/v1/file-operations` 和真实 owner JWT 把一个已实际建在 PostgreSQL 的空目录加入 `queued` 文件删除任务；确认未执行、非 owner GET 拒绝、没有直接写任务终态。Linux 有界 headed Chrome/Xvfb Desktop 1280px 与 Android UA/Touch 390px 模拟分别经生产 Web 登录真实 `#/app/tasks`，显示「等待执行」。测试用真正 `SIGKILL` 终止整个原 Chrome 进程，不合成生命周期事件或使用 Playwright focus 假象。然后仅通过隔离 Go 测试 HTTP mux 的固定无特权 `/__test/pwa-s4d3/start-worker` 启动**生产 `StartFileOperationWorker`**；它只启动 Worker，不执行任何模拟的 SQL `status=completed` 更新。真实 Worker 使用现有 PostgreSQL queued→running→completed 处理删除事务。新的 OS Chrome 进程、全新浏览器 profile 再次实际登录，必须看到「已完成」，冷刷新后真实认证 GET summary/page 显示无活跃文件任务与历史完成任务；Go 后置从数据库独立核验 `ProcessedItems=1`、起止时间、原目录被真实标记删除、Foreign Owner 仍不可见、浏览器未发起取消/上传/任务变更，SW 缓存只有公开 `offline.html`。不能携带真实文件字节、用户资料、JWT、Gin 日志或浏览器 profile 到 CI artifacts。

**明确限制：** S4D3-A 测试的真实 Server Worker 是在浏览器被杀后由隔离 fixture 信号启动，验证**已入库任务不依赖原浏览器进程存活、执行结果由 Server 持久保存并可跨新浏览器进程读取**，并非证明系统调度器无需信号必然及时唤醒、跨 Server 实际故障转移或 iOS 后台持续上传。SIGKILL 是 Linux Chrome 实际进程终止，不等于 iOS 27 Home Screen/Android OS Installed 的操作系统回收。尚需 S4D3-B 的 Server 重启/恢复与真实设备差异专项以及 S5 的公网 DNS/CA、Safari 主屏、Android Installed、桌面安装、锁屏、读屏、性能、安全、发布回滚。**合并门槛**为唯一新 HEAD 的专用 Chrome/PG 两模式成功且完整 PR CI（Go race/Web/Desktop/Windows/Linux/升级回滚/Final Gate）全绿，未达标保持 Draft，不修改无关 Race/Perf/图库分支。


**S4D3-A 首轮仅 Go 格式门槛失败（2026-10-15）：** 原准确 HEAD `cf7721f332dceb361c3a022560a04367de432c8a` 的[独立真实 Chrome/Gin 专项 #38733084103](https://github.com/lazyxu/xdrive/actions/runs/38733084103) 在 `gofmt -l` 即失败，真实 Chrome/Worker/Node 契约尚未执行；同期[完整 CI #38733083584](https://github.com/lazyxu/xdrive/actions/runs/38733083584) 的 `go-linux/Check formatting` 输出精确 diff：只涉及新 `pwa_s4d3_durable_fixture_test.go` 中 struct 字段对齐、Node 初始化、返回值的 Go 排版，未观测到生产 Worker 或浏览器缺陷。仅按该 `gofmt -d` 逐行修正和保存本记录，冻结基线和六文件/单工作提交不变。修改后准确 HEAD 需独立 Chrome 双环境及完整 PR CI/Final Gate 全部重验；不能复用旧提交的红/绿结果，仍为 Draft。


**S4D3-A 首次真实浏览器登录夹具 First-red（2026-10-15）：** 修正格式后的准确 HEAD `ce4c3da768cd99581bf994deb7f5f08a7f60c529` 在 [独立 Chrome/Gin/PG 专项 #38733460241](https://github.com/lazyxu/xdrive/actions/runs/38733460241) 成功通过 Go/JS 格式、3 项 Node 契约、生产 Web 构建和 Go 编译，并首次运行真实 Desktop Chrome；在 `login-queued` 报 `TypeError`，尚未真实 SIGKILL Chrome、启动 Worker 或执行 DB 后置验收。查明本轮抽取 Puppeteer 登录公共函数时误把 `p.$$('button')` 变为单元素 `p.$('button')`，并对返回值使用 `for...of`，系新测试脚本选择器错误，**不能视为生产任务持久性缺陷**。只恢复集合选择器并新增禁止单元素迭代的 Node 回归断言，保留全部真实 worker / owner / 浏览器及 Go 后置门槛；在原冻结 master 上继续保留唯一工作提交，新 HEAD 专项与完整 GitHub CI/Final Gate 必须重新双绿。


### S4D3-A real Chrome First-red: personal FileOperation selector (2026-10-15)

Old exact HEAD `bb681752` passed three S4D3 Node contracts plus production Web/Go build, but [dedicated real Chrome/Gin/PostgreSQL CI #38734016615](https://github.com/lazyxu/xdrive/actions/runs/38734016615) failed `login-queued TimeoutError`, before any genuine Chrome SIGKILL or Server Worker execution. The browser test incorrectly queried `data-xdrive-background-task-id="file-operation:<uuid>"` for a personal file operation. Actual shared Tasks/Files UI uses `FileOperationCenter` with `data-xdrive-file-operation-id="<uuid>"`, and the personal background-task page omits file-operation cards/history by design; the separate authenticated `/api/v1/file-operations` endpoint is authoritative for that UI. This is a first-red **test harness / mistaken UI contract**, not evidence of production Server worker failure. The one-work-commit repair on frozen `master@cde9912b` updates only the S4D3 browser harness, Node assertions, dedicated CI required proof and this audit log; all real OS Chrome termination, Worker-only start, SQL owner/foreign validation, authenticated completed file-operation GET, independent summary/page checks, no browser task mutation and public-only SW cache requirements remain. Require **new exact HEAD** full GitHub CI + Final Gate and real Chrome Desktop / Android UA-touch 390px simulation success before Ready / rebase merge. The older red run cannot authorize merge. Genuine installed iOS 27/Android/desktop, TLS/CA and autonomous Server startup remain unverified S5/S4D3-B.


### S4D3-A genuine Chrome reached the independent Go postflight; personal task-page fixture correction (2026-10-15)

Exact old HEAD `566962f` [dedicated CI #38736126852](https://github.com/lazyxu/xdrive/actions/runs/38736126852) passed all three Node contracts, production Web/Go build, and the real Desktop Chrome user flow (queued FileOperation card, OS SIGKILL, genuine Worker start, fresh Chrome login, completed FileOperation UI, authenticated file-operation GET, reload, no browser mutation and public-only SW cache). The job then stopped with `S4D3 independent PostgreSQL owner/task postflight failed` **after** the browser's test-only finish signal, and never ran the Android-UA 390px simulation. The isolated Go postflight still incorrectly demanded that the owner's `/api/v1/background-tasks/page` include a file operation. Production deliberately renders owner file operations via `FileOperationCenter` from the separate, authenticated `/api/v1/file-operations` endpoint; only the admin/global background-task page includes this domain. Repair the Go postflight to require **no duplicate file-operation entry in either personal background page**, plus a positive owner-only `GET /api/v1/file-operations/<id>` with completed state, one processed item and persisted start/finish timestamps; retain the foreign-user 404 and all existing real SQL Node deletion, Worker count, zero browser mutation, and active-summary checks. This corrects a fixture expectation, not the product Server API or Owner permissions. The old full CI and dedicated CI cannot authorize merge after this one-work-commit reconstruction; require **new exact-head** all required Go/Web/Desktop/Windows/Final Gate plus authentic Desktop/Android-UA/touch Chrome and PostgreSQL postflight to succeed before Ready/merge. Actual iOS 27/Android Installed and autonomous Server restart stay separately not-run.


## PWA-S4D3-A · 已完成合并（2026-10-15）

[PR #1700](https://github.com/lazyxu/xdrive/pull/1700) 的准确 HEAD `f8ce9099a555616d66c28d8b83637ad914ea7501` 通过 [真实 Chrome/Gin/PostgreSQL17 专项 #38736694036](https://github.com/lazyxu/xdrive/actions/runs/38736694036)（Desktop 和 Android UA/Touch 390px 模拟）与 [完整 PR CI #38736694196](https://github.com/lazyxu/xdrive/actions/runs/38736694196)（Go race、Web/Desktop、Linux/Windows、安装/升级/回滚、Final Gate），rebase 线性合并为 GitHub `master@2805055b93887db11f4baff155b5d0d6a6bf2197`。原唯一 PWA 临时分支已核实删除。旧 S4D3-A 证明真实 Chrome SIGKILL 后，隔离环境启动的真实 Server FileOperation Worker 可以继续完成持久任务；其 Worker 是从测试固定端点显式启动，不等于自动恢复或移动设备后台传输。

## PWA-S4D3-B1 · Server Worker 进程 SIGKILL 与 PostgreSQL 持久任务启动恢复（2026-10-15）

**固定基线：** GitHub `lazyxu/xdrive master@2805055b93887db11f4baff155b5d0d6a6bf2197`。本阶段只新增 Linux/Go 跨 OS 进程 PostgreSQL 测试、Node 源码契约、独立 GitHub CI workflow 和本台账；不修改生产 Server/API、Web/Mobile Web、Desktop Agent、共享虚拟化组件、52px App Frame 或 Service Worker。严格一条工作提交；准确 HEAD 的专项 CI 和完整 CI（含 Final Gate）均全绿方可从 Draft 转 Ready 并 rebase merge，之后核查相关分支清理。未向 GitLab 推送时不得称其已交付。

**有界可复核任务：** 父测试使用真实 PostgreSQL17 与隔离随机 schema。第一个 OS 子进程调用生产 `enqueueFileOperation` 创建两个持久删除操作，再使用真正 `claimNextFileOperation` 领取一条为 `running`，另一条保持 `queued`。父进程核对数据库中的状态和未完成时间，执行 **SIGKILL 整个子进程**，核对操作未丢失、死亡信号真实。第二个不同 PID、全新数据库连接的独立 Server Worker 进程在启动时调用生产 `StartFileOperationWorker`（其中 `recoverFileOperations` 先重排 `running`），不通过测试 HTTP Worker 启动端点，也不由测试直接将 SQL status 写为 completed。需要两个原始任务均实际完成、各自节点被真正移入回收站、起止时间和 processed_items 正确、Foreign Owner 无读取权、最终恰好两个完成任务。仅纯合成 ID 存入 0600 私有进程交接文件；不归档 JWT、用户数据、Gin 私有日志或文件内容，schema 随测试清理。

**严格解释：** 此 B1 是实际生产 Server Worker 方法运行在两个不同 OS 测试进程中的持久恢复测试，并非完整 `cmd/server` 产品二进制和容器自动编排；已领取的 `running` 任务在真正执行删除事务之前被强杀，不能冒充进行中大型文件写入或真实跨副本故障转移。B2 另测完整 Server 启动、实际执行中断和回滚；S5 需要 iOS 27 Safari/主屏幕、Android Installed、Desktop PWA、锁屏/系统回收、公网 HTTPS/CA、性能、安全、发布回滚。不能由 Go 进程测试声称 iOS 浏览器能后台上传。


## PWA-S4D3-B1 · 真实 Worker 子进程恢复测试已合并（2026-10-15）

[PR #1708](https://github.com/lazyxu/xdrive/pull/1708) 在唯一准确 HEAD `6f4a1b371f57864373ad856a3c22a7bfd0b945d5` 上，通过独立 [PostgreSQL17 SIGKILL 恢复 CI #38740779085](https://github.com/lazyxu/xdrive/actions/runs/38740779085) 和 [完整 PR CI #38740778951](https://github.com/lazyxu/xdrive/actions/runs/38740778951)（含 Go race、Web、Desktop、Linux/Windows、安装升级回滚和 Final Gate），rebase 线性合入 `master@a765457042f48c46852e581e34d458468188fdda`。相关 PWA 临时分支已清理。已证实两个不同 Go 测试进程内调用生产 Worker 方法可恢复已经领取的 `running` 和原先 `queued` 任务；**未验证**完整生产 Server binary 的启动和真正 SQL 事务内中断。

## PWA-S4D3-B2 · 完整生产 Server 二进制在中途删除事务内遭 SIGKILL 后恢复（2026-10-15）

**固定基线与变更范围：** GitHub `lazyxu/xdrive master@786b90113272d37cb9cccc82ef905f096c3bda86`，上游 #1700/#1708 已合并，无未完成 PWA 专题分支。只新增 Linux `cmd/server/pwa_s4d3b2_actual_server_restart_integration_test.go`、对应 Desktop Node 源码契约、单独 PostgreSQL17 CI workflow 和本交付台账；不修改生产 Server、JWT、文件协议、Web/Mobile Web/Desktop 共享 UI、52px App Frame、图库、Viewer、Service Worker 或后台 Source。所有新任务仅创建于测试独有的随机 PostgreSQL schema 和测试临时本地 CAS 根；不存在对真实用户目录注入中断或删除的操作。

**严格的中途事务场景：** 测试先用 `go build ./cmd/server` 生成真正的生产 Server 二进制，使第一个 Server OS 进程完成启动迁移、HTTP Listener 和 `readyz`。随后用真实 Linux `SIGSTOP` 暂停**整个 Server 进程**；在独立 Go 测试进程复用生产 `api.Server.Router`、真实 Owner JWT、共享独立 PostgreSQL schema 的 HTTP POST 入队两个持久任务（首任务两目录、第二任务一目录），Router **仅入队不执行任何 Worker**。任务持久写入后再由测试获得第二个根目录 `FOR UPDATE` 行锁，最后对真正的 Server 进程 `SIGCONT`，令其原生 Worker 获取任务、在第一个根目录的尚未提交修改后等待第二项锁。该暂停机制避免 Server 在夹具尚未建立锁时抢先处理任务，不新增产品运行控制接口。通过数据库任务状态和独立 `pg_stat_activity` 等待锁查询同时证明首任务 `running`、`CurrentItem` 已到第二个根节点、第二任务仍 `queued` 且 Server backend 等待真实 Node SQL 锁；**第一节点的 mutation 已执行但尚未 commit**。不接受普通 sleep、虚构 SQL 完成结果或仅凭 UI 任务卡冒充中途事务。

**真实崩溃与恢复：** 必须在锁仍存在时使用 `SIGKILL` 终止整个 Server OS 进程，并验证实际进程退出信号、原两条任务仍为 `running/queued`、前两个节点的删除时间/修订号仍为未提交初始值（包括第一节点在真实 SQL 事务中的中途更新回滚）。释放测试行锁，启动一个全新的不同 PID 产品 `cmd/server` 进程；只由其原生启动路径中的 `recoverFileOperations` 和生产 Worker 执行恢复。最终原始两条任务都应 `completed`（处理 2 项和 1 项），原三个目录各有正确一次回收站标记和精确修订号 2，总任务记录恰好两条，真实 owner REST GET 允许、foreign 404。不得复用旧进程内存、修改任务终态 SQL、绕过正常 JWT 或把真实浏览器后台续传混同于 Server 执行。

**CI/验收门槛：** 新工作分支严格在上述冻结基线增加**恰好一条工作提交**，先独立本地 `gofmt`、两项 Node 契约测试；专用 Linux PostgreSQL17 job 同一 HEAD 实际编译产品 Server 和 `cmd/server` 测试程序，运行中途事务 SIGKILL 及恢复，无私有 stdout/JWT/数据库或源文件 artifacts。仅当该专用 CI 与完整 GitHub PR CI（Go race、Web/Desktop、Linux/Windows 安装、升级、回滚和 Final Gate）对同一准确 HEAD 均为 success，才可以 Draft→Ready→rebase 线性合并并核实工作分支被清理。未观察到真实 DB 测试成功前只能称**已编写待验证**。

**边界：** 本次 SQL 工作负载是合成空目录的 Server 持久文件删除，不是长时间 1/4 GiB 上传下载中的 CAS 中断、跨 Server 多副本 failover、真实 Docker 自动重启或自建公网 CA 证书。iOS 27 Safari/Home Screen、Android Chrome Installed、Desktop Chrome/Edge 安装模式、真实锁屏/进程回收、性能/安全及发布/回滚仍属 S5 未完成。浏览器无法被承诺在 iOS 锁屏/强杀后继续传文件；Server 持久任务与浏览器 File/Blob 生存期明确分开。


**B2 初次真实 CI First-red（2026-10-15）：** 旧准确提交 `2184b49063419def3b0b4f7ea53ed3ee208803d1` 的 [专用 PostgreSQL17 CI #38746820541](https://github.com/lazyxu/xdrive/actions/runs/38746820541) 已通过准确 HEAD、`gofmt`、2 项 Node 契约、真实 `cmd/server` 编译和 Go test 编译，但实际测试在 `real production Server never became ready`（90 秒）终止，**没有执行真实 SIGKILL/回滚/恢复**。测试先占用节点 `FOR UPDATE` 行锁、再启动 Server，可能阻塞生产迁移或其他启动阶段；这只能确认为夹具启动时序失败，不能断言产品持久恢复有缺陷。调整为完整生产 Server **首先**启动并通过 `readyz`，然后获取注入行锁、经 Server 真正的 HTTP API 入队、检查 `pg_stat_activity` 锁等待，最后 SIGKILL 和重启。所有原始数据库不泄漏、真实二进制、部分事务回滚、2 条任务与 3 个节点的一次性提交、Owner 隔离等门槛维持严格不变。重建固定基线上的**同一个**工作提交后，专用真实 PostgreSQL CI 和完整 CI/Final Gate 必须在**新准确 HEAD** 重新验证，旧 HEAD 结果全部失效。


**B2 第二轮真实 CI First-red（2026-10-15）：** 旧准确 HEAD `4e05b51069b50f924de4e2b2972e3a74bd104914` 的 [真实 Server/PostgreSQL17 专项 #38747743828](https://github.com/lazyxu/xdrive/actions/runs/38747743828) 已成功完成 Go 格式、Node 契约与生产 Server/Go test 的编译，真实 Server `readyz` 也已可达；但在测试持有第二个节点 `FOR UPDATE` 锁后，直接通过运行中的 Server REST API 入队时触发 `S4D3B2 authenticated production enqueue failed`（5 秒网络超时），尚未开始 SIGKILL/事务恢复。这是注入行锁过早影响生产 API 前置校验的**夹具时序错误**，而非已证明的产品持久化失败。新方案由真正生产二进制先就绪，通过真实 OS `SIGSTOP` 暂停其 Worker，使用现有测试隔离进程中的生产 Router 与 Owner JWT 仅做真实 HTTP 入队；入队全部提交后才在测试进程持有指定 Node 锁，然后 `SIGCONT` 恢复真正 Server 的调度执行并检验 PostgreSQL 锁阻塞、中途事务回滚、恢复执行及 Owner 权限。恢复执行的所有原严格断言不降低、不制造任务终态 SQL、无新产品接口。必须重建固定基线上的唯一工作提交，新准确 HEAD 的专项/完整 CI + Final Gate 双绿方可合并，旧结果不复用。


**B2 第三轮真实 CI First-red（2026-10-15）：** 旧准确 HEAD `4d6e4816c8bdb2995be73c75659db665136bd20c` 的 [专项 PostgreSQL17 CI #38748927195](https://github.com/lazyxu/xdrive/actions/runs/38748927195) 已通过 Go/Node 格式、源码契约、真实生产 Server 二进制/Go test 构建；通过 `SIGSTOP` 暂停、独立真实 Router 持久入队、Node 行锁注入并 `SIGCONT` 后，在原有 25 秒联合断言 `did not observe real Worker blocked inside PostgreSQL node transaction` 处失败。尚未 SIGKILL 或完成任何恢复验收；同旧提交 [完整 CI #38748926907](https://github.com/lazyxu/xdrive/actions/runs/38748926907) 包含 Final Gate 已成功，但专项红灯使其不能合并。此红灯**不能确定**是 Worker 未领取、当前 Item 没有推进、Server `application_name` 不匹配还是 SQL 锁关联错误。故下一轮只增强**不泄漏数据的真实 PostgreSQL 锁因果诊断**：通过同一个持有行锁的事务获取 `pg_backend_pid()`，以 `pg_blocking_pids(waiter.pid)` 确认生产 Server 节点 UPDATE 的阻塞者确实为该会话；失败只打印任务状态条件的布尔值和 SQL 会话聚合数量，不输出 SQL 文本/凭据/绝对路径。原 `running`、第二项、第二任务 `queued`、实际 SQL 锁、真实 SIGKILL、事务回滚、自动启动完成和账户隔离门槛**全部保留**。在冻结基线上维持单提交并要求新准确 HEAD 的专用真实 PG 和完整 CI/Final Gate 双绿。

**B2 第四轮专项 First-red 与仅隔离夹具触发器修正（2026-10-16）：** 旧准确 SHA `354f8b37000f6c8bac9c65f7406ccca41f343a9d` 的 [真实 Server/PostgreSQL17 专项 #38753693947](https://github.com/lazyxu/xdrive/actions/runs/38753693947) 已通过 Go/Node 与真实 binary 编译，但未通过 `S4D3B2 real Worker lock evidence missing`。脱敏诊断显示 `first_running=true`、`current_first=false`、`current_second=false`、`second_queued=true`、`server_lock_waiters=1`、`blocked_by_fixture=1`、`tagged_node_blocked=1`。这证明了**真正的 Server backend 受夹具锁阻塞**，但不证明第二次真实事务内更新；原夹具直接 `FOR UPDATE` 锁定第二个真实 Node，因此 Worker 在 `batchLoadNodesTx` 等事务前置查询阶段就可能被卡住。此旧 HEAD 的 [完整 CI #38753693990](https://github.com/lazyxu/xdrive/actions/runs/38753693990) 虽全部通过含 Final Gate，也绝不可绕过专用红灯合并。下一修订只修改测试，在随机隔离 PostgreSQL schema 创建专用一行 gate 表，并安装目标限制为第二个根节点、仅在其 `deleted_at` 被实际更新后执行的 `AFTER UPDATE` 触发器。触发器才会访问预先锁住的**合成 gate 行**，因此节点读取/第一个节点修改不被预先阻塞；仍通过锁持有者的 `pg_backend_pid()` 与 `pg_blocking_pids` 独立验明生产 Server 的第二次 Node UPDATE 真实等待，保留 `running`、第二项 current_item、另一条 queued、SIGKILL、事务回滚、两条任务恢复、三个节点仅更新一次以及账号隔离的所有强制断言。严禁直接模拟 `completed`、降低断言、修改生产 Worker 或向真实用户数据库注入触发器。所有新 SQL 对象随测试 schema 自动清理。修正后同冻结基线单提交重测专项与完整 CI/Final Gate；真实执行成功前不能宣称通过。


**B2 第五轮 first-red（2026-10-16）：** 原准确 HEAD `cfab6b063d99e851d164e408a8b0166347586877` 的 [专项真实 Server/PostgreSQL17 CI #38758052791](https://github.com/lazyxu/xdrive/actions/runs/38758052791) 通过 `gofmt`、2 项 Node 契约、真实 `cmd/server` 和 Go test 编译，并成功由原生产 Router 创建两条 HTTP 202 的 queued 持久任务；随后创建**测试专用** PostgreSQL trigger function 时 `SQLSTATE 42601 syntax error at or near "$"`。复查旧 HEAD 实际源码确认函数体界定符错误地写为单独的 `$`，而不是有效的完整 SQL 字符串，**不是已证明的 GORM/pgx 特性或生产文件操作错误**；尚未实际阻塞第二次更新、SIGKILL 或恢复。只把测试专用 PL/pgSQL 函数体改为无内嵌引号的标准单引号 SQL 字符串，并添加静态契约防止非法界定符回归；该函数仍在随机隔离 schema 内，仅由第二个 Node 的 `AFTER UPDATE OF deleted_at` 触发。旧 CI 不能作为新提交的验收证据。所有真实锁阻塞、事务回滚、任务恢复与 Owner/Foreign 隔离要求保持原样。


**B2 第六轮仅 Node 静态测试语法 First-red（2026-10-16）：** 旧准确 HEAD `fd585f8e273105bf4605e4ea0ddb3ef58d6f8a94` 的 [专用 CI #38758618555](https://github.com/lazyxu/xdrive/actions/runs/38758618555) 已通过格式门槛，但新增的 Node 契约行 40 出现 `SyntaxError: missing ) after argument list`，因此未编译/执行本轮真实 Server 恢复测试。这是新的源码断言编辑错误，不是产品故障。仅将损坏的断言恢复为两个可执行的严格语义断言：触发器函数体必须用有效单引号字符串，触发器的可信数字 Node ID 必须被嵌入 DDL。保留第二根节点触发器、`pg_blocking_pids`、SIGKILL、SQL 事务回滚、恢复及权限原门槛；修复折叠成固定基线上的唯一工作提交后，新 HEAD 全套 CI/Final Gate 与专用真实 PostgreSQL 测试均须重验。


**B2 第七轮仅 Node 契约夹具重复残留（2026-10-16）：** 原唯一提交 `eebf4e42d40ffa940a1a38cf2add217514dc6219` 的 [专用 CI #38758909347](https://github.com/lazyxu/xdrive/actions/runs/38758909347) 在 Node 解析阶段失败，`SyntaxError: Unexpected token ')'`。详细审查已提交源文件发现第 67 行两个合法的 Node 测试结束后，错误地附加了一段旧的重复测试/断言片段（第 68–93 行），造成单独右括号并导致解析错误；本阶段的实际 Server/PG 恢复测试没有执行。这是测试文件拼接残留，不涉及产品代码。直接恢复**完整的、仅两项严格断言测试的规范文件**，移除末尾重复片段，并在提交前核实完整内容恰好两项测试、正确收尾、保留生产 Server/Node 触发器/锁因果/SIGKILL/回滚/Owner 断言。固定父提交不变，准确 HEAD 的专用 CI 与完整 CI/Final Gate 重新运行；旧 Head 红绿均不得混作本轮通过。


## PWA-S4D3-B2 · 真实 cmd/server 中途事务 SIGKILL 恢复已合并（2026-10-16）

[PR #1712](https://github.com/lazyxu/xdrive/pull/1712) 在准确工作 HEAD `22e65ce2e4deb2c9d6318805934198f928b31bcb` 的 [真实 Server binary/PostgreSQL17 专项 #38759388845](https://github.com/lazyxu/xdrive/actions/runs/38759388845) 成功后，经 [完整 GitHub PR CI #38759389440](https://github.com/lazyxu/xdrive/actions/runs/38759389440) 包括 Go race、Web、Desktop、Caddy、Windows/Linux 安装升级回滚和 Final Gate 全绿，rebase 合并到 `master@a4fcd497b0c9b56bb5198abf3c44177bf6878678`，唯一 PWA 临时分支已核实删除。隔离真实 PostgreSQL 测试在第 2 个合成目录的更新 AFTER 触发器中阻塞生产 Server SQL，实际 SIGKILL 整个产品 Server 进程，核验第一目录未提交事务回滚、新进程正常 main() 启动后两条原任务和 3 个节点最终正确仅一次完成，Owner 200/Foreign 404。该证据不等于真实 1–4GiB 文件字节进程中断、跨 Server 集群或 iOS 27/Android 安装模式。

## PWA-S5-A1 · 实际可信 HTTPS Origin 预检及物理平台发布 NO-GO 门槛（2026-10-16）

**本轮开始的固定基线：** GitHub `lazyxu/xdrive master@f8809ec7b2d42f2a4692b70032f4d3b2e1b0b6eb`，在 #1712 完整收尾/分支清理后选择，当前无待合并 PWA 分支。S5 必须严格按 [docs/pwa-s5-acceptance.md](docs/pwa-s5-acceptance.md) 平台对照表执行：Desktop Chrome Browser/Installed、Desktop Edge Installed、iOS 27 Safari/Home Screen、Android Chrome/Installed；**实际系统安装与手机锁屏**均保持 `NOT RUN`，不可用 Android UA 390px、PWA Manifest 或 `display-mode` 一项冒充。保留共同 52px App Frame、Web/Mobile Web 共用 REST/虚拟列表和 Server Durable Task 边界。

**本阶段可执行交付：** 新增无第三方 npm 依赖的 `desktop/scripts/pwa-s5a-live-https-audit.cjs` CLI、真实 Linux HTTPS OpenSSL 临时证书/Node fetch/权限响应测试、独立精确 HEAD CI workflow、规范化 7 平台 S5 验收矩阵和本台账/AGENTS 入口。脚本只接受无凭据、无 query/hash/path 的可信 `https://` FQDN，拒绝 `NODE_TLS_REJECT_UNAUTHORIZED=0`，禁止 HTTP、域名伪装回环地址和自动重定向。依赖平台默认 TLS 主机名/证书链验证，不声明完成手机 OS 的根证书验证。匿名 HEAD 五项公开安装资源检查 MIME/nosniff/安全缓存头，受限大小真实 GET Manifest 校验 `id/start_url/scope/display/icons`，检查 HSTS、同源只读 readiness 和匿名两条私人 API 拒绝访问且不可缓存，不读取任何私人 API 正文。只输出固定状态码和 Origin SHA-256/测试时间，不存 JWT/Cookie/文件/证书，`--output` 生成 0600 独占脱敏 JSON。返回 `actual_https_preflight=pass/fail`；**所有情况下的 release_gate 都为 NO-GO**，直到独立手机及桌面实机证据完成。

**证据与门槛：** 专用 CI 在真实 TLS socket 上安装仅测试的 OpenSSL 证书，用 `NODE_EXTRA_CA_CERTS` 让 Node 独立确认证书链和 IP SAN；若未信任证书、使用 HTTP、URI 中有密码或 Ticket、强行跳过 TLS、将 200 HTML 当 JS、公共资源被重定向、静态缓存策略错误、HSTS 缺失、匿名私人文件返回 200/可缓存，都必须出错且不得报告发布 GO。测试用 `XD_PWA_S5_FIXTURE=1 --fixture-loopback` 明确区分局部 fixture，**CI 的测试证书不是实际公网 HTTPS 部署记录**。不触碰生产 SW/Caddy/Auth/文件协议/UI/设备 Push 或无关 PR。固定基线**恰一工作提交**，测试与完整 CI Final Gate 在准确 HEAD 全绿后才能从 Draft 转 Ready、rebase merge 并清理分支；GitLab 未推送时不称已交付。

**下一步 S5-A2：** 拿到用户真实部署实例的合法域名/信任的实际运行环境，运行该 CLI 的真实 Origin 模式，再分别在真实 iOS 27 Safari/Home Screen、Android Chrome/Installed 和 Desktop Chrome/Edge Installed 完成启动图标、首次登录/深链接、系统证书信任的取证。再推进 S5 网络、下载、上传、100k、锁屏、无障碍、版本/回滚。没有这些设备和 Origin 访问时不应人为填 PASS 或冒充测试执行。


## PWA-S5-A1 · 可信 HTTPS 只读部署预检已合并（2026-10-16）

[PR #1731](https://github.com/lazyxu/xdrive/pull/1731) 在工作 HEAD `e084dbc0eddc42edaae36e0ada56d63716a5323c` 通过 [专用真实 OpenSSL/Node TLS 15 项 CI #38778782472](https://github.com/lazyxu/xdrive/actions/runs/38778782472) 与 [完整 GitHub CI #38778782109](https://github.com/lazyxu/xdrive/actions/runs/38778782109)（Go race/Web/Desktop/Linux/Windows/Caddy/升级回滚、Final Gate），rebase 线性合并成 `master@b3b1202f2056d8aca3c67c05728b985751458b53`。临时 PWA 分支已核实删除。只读工具检查真实受信任 HTTPS Origin 的公开安装资产、HSTS、匿名权限边界并生成脱敏报告；专项 CI 使用的自签证书只是**隔离测试工具本身**，绝非用户公网实例或手机系统证书验收。

## PWA-S5-A2a · 用户主动采集设备浏览器验收记录（2026-10-16）

**固定交付基线：** GitHub `lazyxu/xdrive master@449269876896ed194a734225de8d9c330da5e198`。PWA 关联 PR/分支已核对无开放项，保持仓库固定基线和严格一个工作提交。本阶段接续 S5-A1，仅新增独立的 `web/src/pwaDeviceEvidence.ts` 浏览器观察模块、将“生成脱敏验收记录”按钮集成到现有共用 `PwaInstallDialog.tsx`、新增 Node 契约测试和实际 Chrome Web 构建浏览器专项、CI workflow，以及本台账和 `docs/pwa-s5-acceptance.md`。保留 52px App Frame、Web/Mobile Web Files/Gallery 完全共用 REST/业务逻辑、Desktop/Server 文件任务权限、SW 仅公开离线缓存和所有当前更新/上传/Viewer 安全策略。不增加新的 Server REST、PWA 缓存或系统操作，禁止后台采集。

**实际设备操作方式：** 在真实 iOS 27 Safari/主屏 Web App、Android Chrome/已安装 PWA、Desktop Chrome/Edge 浏览器/独立 PWA 中，经已有登录前或账号菜单的“安装与运行环境”，点击**生成脱敏验收记录**。在当次点击里只读已有安装模式 `display-mode`、`navigator.standalone`、安全上下文与 http/https、SW API/controller 和是否来自本站固定 `/sw.js`、当前 CSS 视口、UA 衍生平台*提示*和先前人工触发过的公开静态 HEAD 的固定七个 `pass/warn/fail/not_run` 状态。不发起任何网络请求，绝不枚举用户文件或在本地持久存储；若浏览器 `crypto.subtle` 可用，仅输出本站 Origin 的 SHA-256，不输出域名、地址、Hash deep link、Query、原始 UA、账号、Token、Cookie、下载票据、媒体和完整诊断原文。记录在共享 MUI 对话框内以只读多行显示，用户主动选中复制后才可用于线下验收；对话框关闭时清除显示及异步状态，避免跨账号保留旧记录。

**严格防止冒充真机 PASS：** 即使浏览器返回 `standalone`、观察到 `appinstalled` 或安装提示 accepted、SW 已接管，生成 JSON 始终写 `installation_from_os_icon_verified=NOT_VERIFIED`、`trusted_os_certificate_verified=NOT_VERIFIED`、`physical_device_acceptance=NOT_RUN`、`release_gate=NO_GO_PHYSICAL_INSTALL_NOT_RUN`。用户须以真实系统图标重开、屏幕录制及独立证书/访问验证来人工完成 `S5-02`，无法通过产品内部按键自行改为 PASS。Android/iOS UA Chrome 390px 模拟是自动化**UI 回归**而非实机安装。

**明确测试范围：** Node 隔离运行生产 TS 模块，检查 Android/iOS/other 观察提示、原始域名/UA/秘密 Detail 不泄露、未知 SW 来源不写入、缺失 crypto 返回 null 不猜 SHA、严格不读 `/api` 和不可存储、所有状态仍 NO_GO；新的真实 Chrome 双模式（桌面 1280px 和 Android UA/touch 390px）必须通过生产构建后实际点击原 MUI 对话框、复制框读取并验证只是安全观察、不产生额外 HEAD/私有 API/请求控制，不破坏已有 S2/S3 的真实浏览器安装/离线/更新检查。单一准确 HEAD 的专项 CI 与完整 PR CI/Final Gate 双绿才能 Draft→Ready→rebase 合并并核实工作分支删除。物理 iOS 27 Safari/Home Screen、Android Chrome Installed、Desktop Edge Installed 和公网 CA 部署仍均须保持 `NOT RUN`，不能伪报 S5-A2 已验收。

**下一验收：** S5-A2b 需由真正持有设备、实际受信任 HTTPS 部署访问权限的测试人员在七平台矩阵逐一留下 `S5-02/S5-03` 的截图、独立系统安装/证书验证与登录深链接结果，再推进 S5-04 至 S5-11 弱网、文件传输、100k、锁屏、无障碍、发布回滚。安装行为取决于真实浏览器与 OS，不能声称能力与 Desktop 绝对相等。


**S5-A2a 首轮真实 Chrome UI First-red（2026-10-16）：** 原准确工作 SHA `99c73a1b2d635623328efe6fe7f53c248beb4d81` 的 [专用真实 Chrome/Node CI #38829922479](https://github.com/lazyxu/xdrive/actions/runs/38829922479) 完成了 4 项 Node 契约测试、生产 Web 构建和桌面 Chromium 的真实用户登录前安装 Dialog 点击；在从只读 MUI TextField 读取 JSON 时 `locator.waitFor: strict mode violation`，因为 MUI 的 multiline 输入同时存在实际文本 `textarea` 和 `aria-hidden=true` 的尺寸测量辅助 `textarea`。这证明前端按钮已经生成 JSON，**尚未通过读取断言，也未开始 Android 390px 模拟**；不是产品功能/安全失败，更不代表任何 OS Installed 真机证据。只将测试读取目标限定为非隐藏 `textarea:not([aria-hidden="true"])`，新增 Node 静态防回归断言；保持现有用户真实点击、脱敏哈希、公共请求次数、NO-GO 和双模式验收完全不变。保留固定基线并重建唯一工作提交，旧 CI 结果不得用于后继合并；需要新 HEAD 专项和完整 PR CI/Final Gate 同时成功后才能 Ready、rebase merge、清理分支。


**S5-A2a 真实 Chrome 后完整 CI 首次 Desktop 测试 First-red（2026-10-16）：** 旧准确 HEAD `8e2d08f43347614095bf62656d0473765d404d5a` 的 [独立真实 Chrome S5-A2a 专项 #38830281851](https://github.com/lazyxu/xdrive/actions/runs/38830281851) 成功：Node 脱敏契约 4/4、真实生产 Web 构建、Desktop Chrome + Android UA/Touch 390px 双模式 MUI 用户主动采集和绝对 NO-GO 均通过。然而 [完整 CI #38830282002](https://github.com/lazyxu/xdrive/actions/runs/38830282002) 的 `desktop-tests/Test desktop main IPC client` 在加载新的 `tests/pwa-s5a2-device-evidence.cjs` 时失败：`Cannot find module 'web/node_modules/typescript'`。仓库既有 Desktop 测试 `tests/web-pwa-install.cjs` 使用 `require('typescript')`，CI 的 desktop-tests 仅在 `desktop/` 安装依赖，而 `desktop/package.json` 已明确列入 TypeScript 开发依赖。这是**测试入口错误地依赖另一个工作区安装目录**，与产品业务/模拟浏览器/OS 安装状态无关。仅将新测试导入改为与既有 Desktop 测试一致的 `require('typescript')`，并添加桌面依赖路径回归；保留生产 Web、Node/Chrome 双环境全部验收不变。在原固定父提交 `449269876896ed194a734225de8d9c330da5e198` 上重建同一唯一工作提交，原准确 SHA 的所有 CI 成绩不可用于新提交合并；必须重新跑专项与完整 Final Gate，双绿才 Ready→rebase merge→核查临时分支删除。


**S5-A2a 双 CI 工作区依赖布局修正（2026-10-16）：** 旧准确 HEAD `b4dadf5c86cb1ca5842d020e2fc8450e2c1a1d46` 的 [真实 Chrome 专项 #38831219423](https://github.com/lazyxu/xdrive/actions/runs/38831219423) 在新增 Node 契约阶段因 `Cannot find module 'typescript'` 失败：该专用 workflow 只在 `web/` 执行 `npm ci`；而上一轮出错的 `desktop-tests` 只在 `desktop/` 安装 Node 模块。两个工作区各自 `devDependencies` 都声明 TypeScript，但测试仅使用 CJS 模块本地解析路径，不能覆盖两种 CI。仅在测试夹具用 `createRequire` 从明确的 `desktop/package.json` 优先解析已安装 TypeScript，若 `MODULE_NOT_FOUND` 再从 `web/package.json` 解析；不修改任何 lockfile/package.json、业务 UI、Server 或 SW、不额外安装整个 Electron 到 Chrome CI。新增测试验证两个工作区的声明和入口存在。旧提交的专用/完整 CI 不能作为新 SHA 合并证据。固定基线单提交规则维持，须在新准确 HEAD 的专用 Chrome+Node 与完整 Desktop/Web/Go/Final Gate 双绿才可线性合并。


## PWA-S5-A2a · 共用安装对话框脱敏观察记录已完整合并（2026-10-16）

[PR #1737](https://github.com/lazyxu/xdrive/pull/1737) 在准确 HEAD `06c07fc76b843925b1fe0fae18601fb871197afd` 通过 [真实 Chrome Desktop + Android UA/Touch 390px 专项 #38831611612](https://github.com/lazyxu/xdrive/actions/runs/38831611612) 和 [完整 GitHub CI #38831611655](https://github.com/lazyxu/xdrive/actions/runs/38831611655)（含 Desktop 全量测试、Go race、Caddy、Server、Windows/Linux 安装升级回滚和 Final Gate），rebase 线性合并至 `master@3c2cca2d53665cfcb5a42adf75e9c230f1676532`，相关临时 PWA 分支已核实删除。该阶段只提供用户主动点击、只在当前浏览器内显示的匿名观察 JSON，不能证明 iOS 27/Android/桌面已经由真实 OS 安装或受信任证书连接。

## PWA-S5-A2b1 · 七平台独立实测证据材料校验、绝不自动批准发布（2026-10-16）

**本阶段固定基线：** GitHub `lazyxu/xdrive master@2a5bce12d7f1d213fa64f1f2339a40da71b1b455`。相关 PWA 分支和未合并 PR 已核实均为空；不得动无关图库、性能、Race、设备 Push/Source 或系统依赖分支。本阶段只新增 `desktop/scripts/pwa-s5b-physical-evidence-review.cjs` 本地离线验收材料检查器、`desktop/tests/pwa-s5b-physical-evidence-review.cjs` Node 实际本地附件/安全拒绝测试、`docs/validation/pwa-s5-platforms.template.json` 初始 7 平台 NOT_RUN 模板、专用 GitHub Actions 工作流，以及本台账与 `docs/pwa-s5-acceptance.md` 使用说明。不修改任何生产 Server/Agent、浏览器安装/上传/下载/Viewer、SW/Caddy、52px App Frame 或发布工作流。

**当前真实 S5 缺口：** 仍无受信任的用户部署实例、真实 iOS 27 Safari/Home Screen、Android Chrome Installed、Desktop Chrome/Edge 安装模式的亲自测试或录屏；所有平台的 S5-01 至 S5-11 真机证据维持 NOT RUN，不可因提交本验收器标记 PASS 或已发布。

**严格工具合同：** 只接受固定 7 平台、严格无额外字段的本地 JSON，`NOT_RUN` 行不能携带伪造材料，`SUBMITTED` 行必须有有效构建 SHA 和同源的 S5-A1/S5-A2a 记录、对应 OS 浏览器/浏览器或系统图标打开方式和人工观察，以及本地去敏图片文件名+原图全字节 SHA256。文件从本地读取，拒绝符号链接/相对路径穿越/原始私人字段，不网络请求、不保存或复制图片。对于真正带有物理材料的行，检查器也最多报告 `SUBMITTED_REQUIRES_INDEPENDENT_REVIEW`，从不 `PASS`。错误信息只使用枚举代码而不输出个人数据。即使合成七平台表完全有效，`release_gate` 必为 `NO_GO_INDEPENDENT_PHYSICAL_REVIEW_REQUIRED`、`independent_device_review_completed=false` 且进程退出码 1；绝不能将旧 `test-fixture-https` 当作公网部署。代码只支持准备物理验收、材料摘要审查，不代表真实 OS 证明或 release approval。

**单提交与双 CI 门槛：** 固定本轮 master，严格一条工作提交，新 Draft PR 中分别运行专用 Node 合成截图哈希、无私密外泄、假 PASS 拒绝与 7 平台 NO-GO 断言，和完整 GitHub PR CI（Go race、Web/Desktop/Windows/Linux/Caddy/Final Gate）；仅在**准确同一 HEAD** 两组成功后 Ready→rebase merge 并核查关联分支清理。不可复用旧 HEAD 成功、不可因文档无代码就跳过 CI、不可宣称 GitLab push 或 iOS/Android Installed 实测。下一步 S5-A2b2 必须由真实设备操作者、独立审查者和受信任 Origin 实际进行物理安装及登录深链接复核，并按 S5-04~S5-11 完成压力/安全/回滚门槛。正式发布 GO 不在本次测试器权限范围。

## PWA-S5-A2b1a · 本地七平台材料校验的伪造检查拒绝（2026-10-16）

在已合并 #1745 的离线核验器中发现：原校验仅判断 S5-A1 HTTPS 报告含十条状态 `pass`，但没有验证十个**规定且不同的**安全检查 ID；同时 Installed display-mode 可接受未定义字符串，iOS 版本和 Desktop OS 家族交叉检查不足。该问题不会直接使发布 `GO`（旧工具也始终 NO-GO），但会把不充分的虚假材料错误归为 `SUBMITTED_REQUIRES_INDEPENDENT_REVIEW`。本阶段只收紧 S5-A1 十项检查 ID/顺序/字段/未执行设备状态、S5-A2a 安装模式与视口/SW、iOS 27/Desktop OS 规则，增加真实 Node 进程的伪造输入回归和本分支 CI 入口。原先的合成七平台完整材料仍仅是待独立审查的自述；不新增 OS 安装真实性判定、不中断 PWA/文件上传/Viewer、不改变公共 SW 离线范围、不上传证据，也不解除 `NO_GO_INDEPENDENT_PHYSICAL_REVIEW_REQUIRED`。**当前物理平台记录仍全部 NOT RUN；S5-A2b2 需要真实可信 HTTPS 实例、设备操作员和独立审核人员。**


## PWA-S5-04A · 真实 Chromium 双窗口候选 Service Worker 更新的自动化预验收（2026-10-16）

在 S5-A2b1a #1750 完整准确 HEAD CI/Final Gate 绿后线性合并并核对 PWA 旧分支删除的基础上，新增**专用真实 Chromium（非 OS 安装）**测试：从 Web 生产构建 / 真实 loopback HTTP 安全上下文注册原版 SW，并为测试专用响应追加有限的版本查询 message hook（绝不部署到正式 sw.js），两个已受控窗口保持旧 worker 时显式执行浏览器原生 \`registration.update()\`，确认 v2 仅处于 waiting；同时保持一个受控合成慢 POST 不被页面刷新/控制器变更打断，并验证匿名私有 \`/api\` 仍被 Server 拒绝且 CacheStorage 仅有公开 \`offline.html\`。旧窗口主动关闭后再新开，证明 v2 才成为 active。独立覆盖桌面 Chrome 和 Android UA/Touch 390px **模拟**，只上传匿名 JSON 测试结果，准确 HEAD 的专项及完整 GitHub CI/Final Gate 都须绿，严格一工作提交。

**证据边界：** 长 POST 是隔离 fixture 的少量合成字节，不是真实文件上传、下载、Viewer 活动，也不证明已安装 PWA、iOS 27 Safari/Home Screen、Android OS Installed、物理锁屏或真实 HTTPS 证书。此自动化只能证明 S5-04 的安全更新基础在 Chromium 表现正确，不能把 S5-02/S5-03/S5-04 真机矩阵从 NOT RUN 改 PASS；发布仍 \`NO_GO_PHYSICAL_INSTALL_NOT_RUN\`。下一步由真实七平台设备操作者与独立审核者提供 S5-01～S5-03 证据，之后执行真实 S5-04～S5-11 验收。

## PWA-P0A · iOS 优先的静态 App Shell 本地化（2026-10-20）

- **范围：** 使用 Vite `build.manifest` 提取主入口及其 *静态* imports/CSS/资源；生产构建在 `vite build` 后生成带 20 位内容修订号的 `/sw.js`。只预缓存公开 `index.html` 与构建哈希 `/assets/...` 的启动依赖，排除所有 dynamic imports（Viewer/大组件不会在首次安装被全量预取）；单次最多 120 个文件、24 MiB，超过限额构建失败而非放宽隐私规则。实现采用无新增 npm 依赖的 Vite 构建产物清单注入与原生 SW；后续若引入 Workbox，不得改变固定缓存白名单和 waiting 语义。
- **双缓存与权限：** `xdrive-pwa-public-offline-v1` 只含 `/offline.html`；版本化 `xdrive-pwa-public-shell-<revision>` 只含 `/index.html` 和精确清单静态 URL。安装时每个资源 `credentials:omit`、禁止重定向、校验 HTTP/MIME，最多 4 并发，全部成功才安装。离线根 SPA 导航用已缓存的公开 App Shell；所有 `/api/*`、登录、原件、缩略图、Live、下载票据、公开分享、Range、POST/PUT 仍然 Network-only，不进入 SW 公共缓存。
- **无中断更新：** 构建产物任意变动会改变 SW 字节并可由原有 `registration.update()` 检测；保留 `waiting`，**不** `skipWaiting`/强制页面刷新/取消浏览器前台任务或 Server durable tasks。新 SW 完整安装失败时旧版本不切换；激活时只清理本应用前代公开 shell 缓存，保留无关 CacheStorage。
- **HTTP 与回滚：** Caddy 根 HTML 每次可重新验证，`/assets/*` 为不可变构建哈希资源且文件缺失返回真实 404，不允许伪造 index.html MIME。仍需进一步建设旧构建资源保留与 API 协议兼容窗口；本阶段只解决新已安装 PWA 的启动静态图缓存，不承诺旧页面在 Server 发布后的所有延迟动态模块都能在线加载。
- **验证范围：** Node 合成 Vite 图构建、错误/越权资源拒绝、版本变化、真实 JS SW 沙箱缓存与私有请求 bypass；专项真实 Chromium desktop/Android UA 390（不是 iOS 真机）验证生产构建离线根导航、授权深链接及 CacheStorage 精确白名单。启动耗时 p50/p95、iOS 27 系统图标冷启动及 100k 性能尚无真实基线，不得捏造提速；独立物理/生产环境安全验收按用户永久决定跳过（未验收），不阻断源码 CI 与 PR 合并。
- **后续阶段：** P0B 保留旧哈希构建资源、真实版本间更新/回退，以及 Files/Gallery 页面不抖动（遵循既有稳定导航规则）；P1 明确授权的 IndexedDB 只读元数据；P2 有容量上限的可清理缩略图缓存。任何私人数据缓存都不与 P0A 公共 SW CacheStorage 混用。
