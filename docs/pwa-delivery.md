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
| P0-03 | 发布新版本等待提示、同源多标签页协调、用户确认后更新；传输/编辑/Viewer 中不自动强制 reload。 | 缺失 |
| P0-04 | Chrome/Android 可用时用户主动安装，iOS 使用 Safari/系统分享菜单引导；已安装/取消/不支持有分支。 | S2A 已编写登录/账户入口、能力检测、安装引导；CI/真实设备仍待验 |
| P0-05 | 真正可信 HTTPS/DNS/证书；SW/Manifest/离线页 MIME、HTTP 状态、缓存头、图标、不错误回退 index.html。 | 部分部署基础，未验收 |
| P0-06 | 安装图标→登录→恢复 Files/Gallery/Viewer deep link；公开分享、外链与浏览器/系统返回栈区分。 | Web Runtime 已有，安装模式未验 |
| P0-07 | 应用在线时区分无网、Server 不可达、401/403、429、超时、取消；消息可重试但不报假成功。 | S1 仅导航离线；应用内待做 |
| P0-08 | iOS/Android tab 与安装模式的真实任务恢复：上传、下载、任务、Viewer、切 App/锁屏/断网/进程回收。 | 业务基础有，真机 not-run |
| P0-09 | SW 安装/更新、手动刷新或退出时不误取消 Durable Server Task；非持久浏览器上传需重新选文件的情况明确告知。 | 待验 |
| P0-10 | 320/375/390/430、899/900、短横屏/安全区/软件键盘/200% 字体/暗色/读屏保留 52px Frame。 | 布局基础有，真机 not-run |
| P0-11 | CI 发布 gate：built sw/offline/manifest 的 MIME/范围、离线 E2E、API bypass、更新/回滚、打包完整性。 | 本轮新增 Node 单测，真实部署 gate 待做 |
| P0-12 | 保留可复核的 iOS 27 Safari+Home Screen、Android Chrome+Installed、Desktop Chrome/Edge 安装 E2E 记录。 | 真机 not-run |

## P1 — 交付质量和主要场景（16 项）

| ID | 项目与交付验收 | 当前状态 |
| --- | --- | --- |
| P1-01 | M38 8MiB 分块上传恢复：刷新/回收后用户重新选同文件，校验账号、大小/指纹/目标与冲突。 | 分块基础有，真机场景待验 |
| P1-02 | M39 目录上传：空目录、嵌套、Unicode、相对路径、选择器能力与多文件/ZIP 回退。 | 部分基础有，待验 |
| P1-03 | M41/M42 原生下载、版本与 ZIP：1/4GiB、落盘哈希、Range、票据撤销/过期、取消和重试。 | 票据/流式基础有，待验 |
| P1-04 | 视频、Live/RAW、图库 Viewer 后台、恢复、seek、播放拒绝、旧播放器停用和 100k 列表滚动。 | 部分已有，真机待验 |
| P1-05 | display-mode/standalone 能力检测与安装模式诊断，不依赖 UA 猜测。 | S2A 已编写显示模式/显式 HEAD 诊断；CI/真实运行状态待验 |
| P1-06 | visibilitychange、pageshow/pagehide、network 变化恢复任务，避免旧请求和意外取消。 | 局部实现，整体待验 |
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

**本次工作提交，待完整 CI/合并。** 登录页和账户菜单新增“安装 xDrive”入口；打开时按需加载一个共享的响应式 MUI 安装对话框，不新增 Web App route、不影响 52px App Frame。页面尽早订阅 `beforeinstallprompt`，只在浏览器真正提供该事件时显示原生安装按钮，必须由用户点击直接调用一次 `prompt()`；接受、取消、失败和未知结果分别展示，不能从普通 browser tab 推断“未安装”。

iOS 27 Safari 无 JS install prompt，按 Apple 官方指南显示“页面菜单/分享 → 添加到主屏幕 → 打开作为 Web App → 添加”；Android/桌面 Chrome/Edge 在未提供 prompt 事件时显示浏览器菜单指引，不创建失效按钮。**能力由浏览器事件、安全上下文、`display-mode` 与 `navigator.standalone` 实际观察**，UA 仅选用中文引导语，不作为功能授权或浏览器黑名单。

“检查安装环境”仅在显式点按后，向同源公开静态资源 `/site.webmanifest`、`/sw.js` 请求 `HEAD`，带 `credentials:'omit'`、`cache:'no-store'`、`redirect:'error'`，检查 HTTP 200、正确 MIME、更新缓存头以及浏览器 `isSecureContext`。可以识别代理把静态资源误返回为 HTML，但不能把安全上下文误宣称公网证书/DNS/设备安装验收通过。模块不读写登录 Token、私有 API、图片、上传任务或下载票据；不新增 SW 私有缓存或后台任务。

**验证层：** 独立 Node install prompt/模式/同源无凭据 HEAD/HTML 错误回退测试通过；接入 Web Auth/账户菜单/路由的源代码回归属于交付门槛。完整 Web 构建、PR CI、浏览器/真机安装是分开的阶段。S2B 仍需真实 Android/iOS Home Screen/standalone 启动、HTTPS 证书与深链接外链/返回的端到端验收；S3 才能增加更新/弱网恢复策略。

## 分期与测试记录

- **S1：** 安全离线页 + 无私有缓存 SW + 生产注册 + Caddy 静态缓存更新头 + 单测 + 文档。本阶段代码通过 Web lint/build、Desktop 单测、完整 GitHub PR CI/Final Gate 才能合并。不能称实现完整离线文件管理。
- **S2：** 安装引导、环境能力与 HTTPS 诊断、启动与 deep link 真实 Chrome/Android/iOS 装机验证。
- **S3：** 用户确认的更新与多窗口状态、应用内断网提示/恢复，不在未保存或上传中自动重载。
- **S4：** M38/M41/M42/M47 上传/下载/Viewer 后台和回收矩阵，记录必须重新选文件及 Server Durable Task 状态。
- **S5：** P0 发版 gate + iOS 27 Safari/Home Screen + Android Chrome/Installed + Desktop 浏览器的真实版本/设备、权限/状态、100k 资源、错误、截图和录屏验收；P1 按实际门槛补齐，P2 只按明确产品选择实施。

每条记录至少包含：case ID、准确 commit/部署版本、设备/OS/浏览器、真实 display-mode、在线/离线、认证状态、步骤、Server 真实结果/文件字节、实际通过/失败/未执行、截图/视频与 SHA-256。不得放令牌、Cookie、私有文件正文或敏感路径。沿用 docs/mobile-web-platform-matrix.md 和 docs/validation/ 台账。

**注意：** 浏览器声明 standalone ≠ 真实安装；Chrome mock E2E ≠ iOS 真机；公开离线页 ≠ 用户文件可离线访问；Server 持久任务 ≠ Web 前台上传锁屏后必定继续。
