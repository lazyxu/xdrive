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


## S5-A2a · 从真实设备浏览器主动生成脱敏验收信息

既有“安装与运行环境”对话框在 Web/Mobile Web/PWA Installed 中共用同一 React/MUI 实现。点击“生成脱敏验收记录”，将当前浏览器可**客观观察到**的 display-mode、`navigator.standalone`（若可用）、HTTPS/安全上下文、受控 SW 路径是否本地 `/sw.js`、CSS 视口、已完成的七项公开安装资源检查状态和 Origin 的 SHA-256 在屏幕上呈现为只读 JSON。该操作不发送新网络请求，不访问任何身份或私有文件，不保存到 Server、SW CacheStorage、localStorage 或浏览器历史；关闭对话框时删除可见的旧记录。

**手动验收流程（一个平台一份）：** 在 OS 浏览器中打开真实 xDrive HTTPS 域名；使用现有按钮主动检测安装资源；如平台支持，按真实系统流程安装 PWA 并从**操作系统图标**关闭、重启；在普通 Web 和安装窗口分别打开“安装与运行环境”，点击“生成脱敏验收记录”并手动复制；补录原生 OS 安装图标、实际浏览器/设备系统版本、受信任证书、重新登录、Files/Gallery/Viewer 深链接、截图/录屏和 Server 结果。只根据真实设备及独立复核证据人工填写平台矩阵结果。

JSON `schema=xdrive-pwa-s5a2-browser-observation-v1` 中的 `platform_hint_only` **只是文案级提示，不是操作系统证明**；`display_mode_observed` 也不能证明安装；`origin_sha256` 仅为跨端对比不泄露实例地址。恒定 `installation_from_os_icon_verified=NOT_VERIFIED`、`trusted_os_certificate_verified=NOT_VERIFIED`、`physical_device_acceptance=NOT_RUN`、`release_gate=NO_GO_PHYSICAL_INSTALL_NOT_RUN`，需要另行人工复核才可将相应原始矩阵格子从 `NOT RUN` 更新为 `PASS/FAIL`。

**自动化限制：** Node 纯逻辑、Web 类型检查与真正 Chromium Desktop 及 Android UA/touch 双模式的共享 MUI 点击测试只能证明记录结构、DOM、匿名边界和不触发额外 API；不是 iOS 27 Safari、Android 系统 Installed 或桌面 Edge 的真机安装验收。缺少真实设备及部署域名时，所有矩阵格子保持 `NOT RUN`，保持发布 `NO-GO`。详见 [docs/pwa-delivery.md](pwa-delivery.md#pwa-s5-a2a-用户主动采集设备浏览器验收记录2026-10-16)。


## S5-A2b1 · 七平台物理设备材料接收与离线发布 NO-GO 守门（2026-10-16）

此阶段**不是**实际执行 iOS 27 或 Android 真机测试。它只建立严格的本地材料输入与审查清单；任何人仅凭 JSON/截图/Chrome 模拟均不能解锁正式发布。

1. 从 [docs/validation/pwa-s5-platforms.template.json](validation/pwa-s5-platforms.template.json) 复制一份本地材料清单（**不要把真实照片、个人路径、浏览器 Profile、登录凭证提交到公开 GitHub 仓库**）；初始七个平台为 `NOT_RUN`，`build_commit=null`、`origin_sha256=null`，真实材料收齐才填写。
2. 在真实设备上通过安装对话框手动触发 **S5-A2a 脱敏浏览器观察记录**；该记录必须仍带 `installation_from_os_icon_verified=NOT_VERIFIED` 和 `release_gate=NO_GO_PHYSICAL_INSTALL_NOT_RUN`，不可人为改成 PASS。将完整 JSON 按原样作为对应平台的 `browser_observation`。
3. 测试人员**独立**实际从操作系统图标打开 PWA，并人工核验设备 OS HTTPS 信任、首次登录和 Files/Gallery/Viewer 深链接。对每个平台填 `status=SUBMITTED` 和固定六字段 `manual_checks`：`os_family`（iOS/Android/Windows/Linux/macOS）、`os_version`（只填版本号，不写设备姓名）、`browser`（Safari/Chrome/Edge）、`launch_source`（安装模式 `os_icon`，普通网页 `browser_tab`）、`trusted_https_in_device_os` 与 `login_and_deeplinks_verified` 布尔值。失败/缺失留为 false，绝不猜测通过。
4. 在本地私有目录放一张经**脱敏**的真实 OS 图标/窗口截图（png/jpg/jpeg/webp，最大 20 MB）；`proof.filename` 仅允许简单文件名，`proof.sha256` 必须是其真实文件的 SHA-256。核验器会打开这个本地文件、校验非符号链接、格式头和全字节 SHA-256，**不会复制、上传或输出截图内容/文件路径**。不要把凭证、用户文件正文、账号信息、GPS 或服务器真实域名写入截图。
5. 同时使用 S5-A1 CLI 对**真实部署 HTTPS FQDN** 生成独立 `s5a-redacted-evidence.json`；其 `evidence_environment` 必须是 `node-trusted-https-origin`，不得为 `test-fixture-https`。把其 `origin_sha256` 与全部 S5-A2a 记录对齐，并填写准确 40 位 `build_commit`。
6. 在真实测试人员自己的机器上、无需额外 npm 依赖或登录凭证，运行下列只读核验（材料/证书报告均不上传 GitHub Actions）：

```bash
node desktop/scripts/pwa-s5b-physical-evidence-review.cjs \
  --input /local/private/pwa-s5-physical-evidence.json \
  --https-report /local/private/s5a-redacted-evidence.json \
  --artifacts-dir /local/private/redacted-screenshots \
  --output /local/private/s5b-review-no-go.json
```

脚本的 `--output` 仅创建权限 0600 的**脱敏**报告且不覆盖已有文件。输入有额外凭证字段、重复/未知平台、`PASS` 状态、跨域 Origin、不可信测试 HTTPS 报告、伪造浏览器/安装模式、路径穿越、缺失/哈希不匹配截图、不同 OS/浏览器声明时一律拒绝或标记不完整。每条最多显示 `NOT_RUN` / `INCOMPLETE_OR_UNVERIFIED` / `SUBMITTED_REQUIRES_INDEPENDENT_REVIEW`；不输出设备名、原始 Origin、User-Agent、截图文件名或媒体字节。

**严格的发布权限边界：** CLI 有完整七平台材料也**始终返回退出码 1**、`release_gate=NO_GO_INDEPENDENT_PHYSICAL_REVIEW_REQUIRED` 和 `independent_device_review_completed=false`；它只核验文件存在、摘要及输入契约，绝对**不**证明截图拍摄地点或 OS 原生安装真实性，更不能签发发布许可。未来需要独立人工评审/发布批准（S5-A2b2）和 S5-04~S5-11 完整验收才能谈 Release GO。GitHub CI 只能执行合成材料的**拒绝误通过测试**，不收集真实用户硬件、真实凭据或私人截图。

对应平台及功能矩阵仍以本文首表全部 `NOT RUN` 为准，直到独立实体设备证据得到实审。Desktop Browser/Installed、iOS Safari/Home Screen、Android Browser/Installed 的 OS 行为不能由 Android UA/Touch 或 `standalone` 一项来推断。正式版本发布流程本阶段不自动消费未经授权的本地材料，也不改动其他应用的发布和更新链路。

## S5-A2b1a · 脱敏材料输入契约收紧（2026-10-16）

S5-A2b1 核验器对本地 S5-A1 JSON 不再只数“十条 pass”：**十项原始检查必须与 S5-A1 实际输出的 ID、顺序、`reason=verified`、唯一完整字段逐项一致**；缺失的匿名私有 API 拒绝测试、重复伪造检查或附带隐藏字段不得进入“已提交待审核”。严格限定原始 `physical_platforms` 为三个 `not-run` 状态；这仍是自述材料，不是 HTTPS/设备证明。S5-A2a 浏览器观察仅接受源代码定义的五种 display mode、实际 Service Worker controller、合规正整数视口和合法 `navigator.standalone`；iOS 27 版本和 Desktop OS 家族必须匹配平台；缺失或伪造时 `INCOMPLETE_OR_UNVERIFIED`。新增 Node 真正调用核验器的反例测试，专项 workflow 覆盖本阶段。**不修改生产 Web/Service Worker/Server/文件任务，不改变零设备证据/Release NO-GO。** S5-A2b2 的真实七平台证书、系统图标启动、登录/深链接与独立物理审核依然未执行。


## S5-04A · 实际 Chrome 更新等待与双窗口不中断（自动化预验收）

\`.github/workflows/pwa-s5s4-real-update.yml\` 使用真实构建的 Web、原版 PWA SW 和为隔离测试**临时追加**的受限版本探针，在 genuine Desktop Chromium 与 Android UA/Touch 390px 模拟窗口验证：两个旧窗口仍受旧 worker 控制、新 worker 只 waiting，不刷新页面、不更换 controller；测试专用慢 POST 响应直到 Server 人工释放后才结束；匿名私有 API 仍被拒绝，SW 仅缓存公开离线页；所有旧窗口关闭后新 worker 才激活。脚本和 CI 报告恒写 \`physicalDevice=false\`、\`release_gate=NO_GO_PHYSICAL_INSTALL_NOT_RUN\`，不能证明真实 iOS 27/Android 已安装系统、物理 17MiB–4GiB 文件字节或真实运营 HTTPS。七平台 S5-01～S5-11 原始物理矩阵**全部保持 NOT RUN**，不得以专项绿灯当作发布放行。
