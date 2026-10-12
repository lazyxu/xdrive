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
| P0-03 | 发布新版本等待提示、同源多标签页协调、用户确认后更新；传输/编辑/Viewer 中不自动强制 reload。 | S3A 已合并；有约束的安全激活仍待 S3C，不允许强制 reload |
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
| P1-01 | M38 8MiB 分块上传恢复：刷新/回收后用户重新选同文件，校验账号、大小/指纹/目标与冲突。 | S4B PR #1535 已通过完整 CI 并合并；真实 Go/Chrome 断点复用最终 SHA 和 iOS/Android 真机验收仍待完成 |
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
