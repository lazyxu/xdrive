# xDrive PWA S5 · 发布验收与跨平台能力矩阵

**状态：未取得真实设备证据，不准宣称 S5 发布已通过。** 本文是 `docs/pwa-delivery.md` 的 S5 验收明细，与 `AGENTS.md` 的持续汇报/固定基线/单提交规则配套。所有 iOS 27、Android、Desktop Installed 的 **OS 安装行为** 均需在实际系统/浏览器上操作确认，不能从 UA、390px Chrome 触屏模拟、Manifest 属性、`display-mode: standalone` 单一字段推导成功。

## 平台覆盖总表

| 平台与运行模式 | 安装入口/图标启动 | 登录和深链接 | 上传下载恢复 | 文件/图库/Viewer | 100k/性能 | 锁屏/进程回收 | 版本与回滚 |
|---|---|---|---|---|---|---|---|
| Desktop Chrome Browser (宽屏 Web) | N/A（普通浏览器） | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Desktop Chrome Installed (PWA) | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Desktop Edge Installed (PWA) | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| iOS 27 Safari (Mobile Web) | N/A（Safari 浏览器） | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| iOS 27 Home Screen (Installed Web App) | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Android Chrome (Mobile Web) | N/A（Chrome 浏览器） | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Android Installed (PWA) | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |

`NOT RUN` 是刻意保留的 **真实物理验收状态**，不等于“不支持”、通过或失败。已完成的 Node、Go PostgreSQL17、Chrome 桌面及 Android UA/touch 模拟 CI 必须在 `docs/pwa-delivery.md` 继续保留为独立自动化证据，不得填入上述物理/实际安装成功格子。真机触屏、Home Screen、OS 文件选择器、Safari Files 下载、系统回收与原生安装提示均无法由 Linux GitHub Actions 的 Node + 自签 HTTPS 证书证明。

## 顺序门槛与验收用例

| Case ID | 发布阻断项 | 必须留下的真实证据 |
|---|---|---|
| S5-01 | 实例域名、可信 HTTPS/证书链、Host/SNI，Caddy 静态资源 | 在实际部署域名运行 S5-A 只读工具；证书链与主机名有效，不能跳过 TLS 验证；移动设备浏览器分别再验证证书信任 |
| S5-02 | 各 OS 安装、启动图标和 `display-mode` | iOS 27 Safari 添加主屏并以系统图标重新启动；Android Chrome 安装后系统图标启动；Desktop Chrome/Edge 各自实际安装启动，录下 UI/模式和浏览器版本 |
| S5-03 | 登录、退出、会话撤销、跨账号、回退/前进 | Files/Gallery/Viewer 深链接冷启、返回锚点；退出或撤销后不能访问另一用户内容、私人响应不能留在 SW CacheStorage |
| S5-04 | 更新提示、多窗口和安全升级 | 真实旧→新版本待激活，正在上传/Viewer/编辑时不自动更新或强制 reload；完全退出后手动更新、重开准确恢复 |
| S5-05 | 离线安全、弱网、权限错误 | 公开离线页正常；离线、TLS 故障、401/403/429、取消区分；SW 不缓存 `/api`、缩略图、原件、Range、票据或身份凭证 |
| S5-06 | 17 MiB / 1 GiB 浏览器上传与重选恢复 | 真实文件分块、突然切 App/失网/系统回收；用户主动重新选择同一文件后校验 SHA-256、Server 已提交块和上传会话；不宣称 OS 杀进程后台仍能上传 |
| S5-07 | 1 GiB / 4 GiB 原生文件下载、Range、取消 | 真实系统落盘字节长度与完整 SHA-256，取消后无残余被误报完成，票据到期/撤销需要重新授权；注明系统文件管理器的真实行为 |
| S5-08 | 10k/100k Files/Gallery/视频/Live/RAW | 100k 文件/图片/视频、混合媒体、滚动/窗口切换/缩略图调度、取消旧请求的 Server 负载与 p50/p95、CPU/RSS、内存、失败请求，分别记录平台 |
| S5-09 | 屏幕旋转、软键盘、无障碍、滚动稳定性 | 320/375/390/430、899/900、短横屏/安全区、200% 字体、VoiceOver/TalkBack、焦点、暗色/减弱动画，维持 52px App Frame |
| S5-10 | Server Durable Task 与浏览器生命周期边界 | 后台文件任务即使浏览器退出，Server 仍能按持久任务执行；浏览器本地 File/Blob 不能保证持续存活，须正确展示恢复/重新选择 |
| S5-11 | 发布/升级与回滚 | 按固定构建 SHA 验证 Windows/Linux/Server/Caddy 升级回滚、旧 SW→新 SW 安全更新，保存匿名可复核结果，不在上传中强制刷新 |

## S5-A1 · 实际 HTTPS 部署只读诊断

对**真正的自建域名**（不是 localhost、IP、自签测试 fixture），在有可信证书链的设备/Runner 运行：

```bash
node desktop/scripts/pwa-s5a-live-https-audit.cjs --origin https://drive.your-domain.tld --output s5a-redacted-evidence.json
```

仅请求五项公开安装资产的 HEAD、有限大小 Manifest GET、匿名 GET `/api/v1/readyz` 与两条原有私人 API 的未授权 GET。使用系统/Node TLS 校验，不允许忽略证书错误、改走 HTTP、URL 携带密码/票据、重定向、把 HTML SPA 回退当 JS/Manifest，也不输出原始响应、Cookie、JWT、私有文件或原始域名（仅 SHA-256）。检查 `HSTS`、`nosniff`、公开资源无 Cookie、SW/Manifest/Offline 可重新验证缓存、私有 API 401/403 且无可缓存认证错误页。脱敏证据文件按独占 0600 创建，已有文件不覆盖。

**此检查结果只有两层：** `actual_https_preflight=pass/fail` 表示运行该工具的 Node 平台对实际 Origin 的 TLS/公开资产/权限边界检查；`release_gate` 始终保持 `NO_GO_PHYSICAL_INSTALL_NOT_RUN`，直到独立真实 iOS/Android/Desktop 测试以及发布审批完成。即使桌面 Node 信任自己的 CA，也无法证明 iOS/Android OS 的信任链和已安装体验。

专门 CI `.github/workflows/pwa-s5a-trusted-https-audit.yml` 只运行隔离 OpenSSL HTTPS fixture：验证真 TLS 证书和主机名、缺失可信 CA、HTML 伪装、重定向、私有 API 泄漏、缓存误配置、缺失 HSTS、TLS bypass 和原始证据保密；`evidence_environment=test-fixture-https` **永远不可**伪装成部署域名通过。没有实际部署 Origin 的情况下，不会在 GitHub CI 访问用户公网实例，不会捏造 Android/iOS 物理结果。

## 必填验收记录格式

每一条实际设备 case 都记录：`case_id`、`platform`、`hardware/os_version/browser_version`、`app_build_sha`、`origin_sha256`、真实 `display_mode`、安装来源、网络/电源/屏幕锁定状态、账号权限类别（不要账号 ID）、重现步骤、Server 真实 HTTP/持久状态、原件总字节和 SHA-256（不保留文件原文）、测量工具/p50/p95/内存、`result=PASS|FAIL|NOT_RUN`、录屏/截图/CI URL 和测试时间。保存到 `docs/validation/` 的**脱敏**记录，不上传授权 Token、Cookie、个人路径、证书私钥、浏览器 profile 或私人媒体。审查者必须能逐格核实；如果缺失，保持 `NOT RUN` 和 Release NO-GO。

**下一个阶段 S5-A2：** 使用实际部署域名运行 S5-A1 Origin 检测并在真实 iOS 27 Safari/Home Screen、Android Chrome/Installed、Desktop Chrome/Edge Installed 分别完成安装+证书+首次登录/深链接的记录；之后再按 S5-04→S5-11 推进可靠性、性能、权限和发布回滚验收。
