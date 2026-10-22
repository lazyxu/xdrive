# PWA CR-02b1 · 真实 Go/PG17 Owner ACL 与已授权离线历史重验证

日期：2026-10-22。来源 [CR-02b #2348](https://github.com/lazyxu/xdrive/issues/2348)，在已合入 [CR-02a #2346](https://github.com/lazyxu/xdrive/pull/2346) 之后执行。

本工作只增加真实浏览器测试、测试契约、专用 CI 和说明文档。完整现有生产 App、Go/Gin Router、SW、P1 IndexedDB、FileExplorer/图库、52px Mobile Web App Frame 和 AGENTS.md 保持不变；绝不通过放宽 Owner/ACL/撤销来迎合测试。

## 已经交付与真实新边界

- 已合入 CR-02a 的真实 Chromium + 公开 SW + P1 IndexedDB 合成 401 场景，证明 P1 100k 候选限制 20 目录条目、24 相册摘要、跨进程冷启动、跨标签 revoke 后 UI 清空和再次打开不复活。但旧夹具不是 Go 真实权限服务。
- 本 CR-02b1 原样复用受控真实 Go TestPWAS2B3RealGinAuthFixture：原 Gin Router、PostgreSQL17 schema、物理 LocalCAS、原生 Chrome 两名真实隔离用户及完全经生产 API 签发的 JWT。准备文件仅包含合成用户标识、受控目标节点和公开测试 origin，不把 Token/Go 日志/会话私密数据上传。
- 首次浏览器通过实际登录页获取 Go JWT，再调用真实 /api/v1/me 获取持久 Server instance UUID；真实 Owner Root、已授权目录、服务端新建父/子目录和一行 children Range 均必须 HTTP 200/201，另外创建真实媒体手动相册。外国 User B 经真实登录后访问 A 的新目录必须 404。
- 只有在实际 Go 授权成功后，明确 opt-in 调用产品 xDrivePwaSetOfflineConsent，并只把实际获授权的目录及相册元数据保存到产品 P1 IndexedDB；没有媒体原件、截图、缩略图、GPS/EXIF、JWT 或可复用票据。
- 完全关闭第一原生 Chromium 进程，保存 profile 并断网；第二原生 Chrome 冷启动访问生产构建公开 App Shell 的只读 /#/offline/files，目录与相册以历史未重验证呈现，不挂载 Owner FileExplorer。联网后原真实 JWT 必须触发 Go /me、/nodes/:id 和单行 children Range 的 200，前端只说明该文件夹访问权已重新核验，保存的旧目录名仍然是历史摘要。
- 从生产 Go DELETE 独立创建的测试目录，继续以真正授权 JWT 轮询 GET 404；实际 React 历史页再次点击权限重验证后，不仅目录，同时相册快照和 Owner hint 均必须清除。第三次 Chrome 独立进程断网重新启动，不得恢复已撤销内容；公开 Service Worker CacheStorage 永远不得持久保存 /api、Owner 元数据、原图、缩略图、票据或 JWT。
- 独立原有 Go fixture postflight 必须继续成功，原历史基础 target directory 不允许被测试删除；只有额外创建的 scoped test folder 可删除。

## 来源、测试与限制

专用工作流为 .github/workflows/pwa-cr02b1-real-go-owner-acl.yml；浏览器测试脚本 desktop/scripts/pwa-cr02b1-real-go-owner-acl.cjs，源码契约 desktop/tests/pwa-cr02b1-real-go-owner-source.cjs。所有用户身份与浏览器 profile 仅留在受控临时 Runner，归档只有匿名 bool summary 和准确 SHA；缺失真实 PostgreSQL、Go 证据、Chrome、Owner/ACL 或有效历史撤销全部 RED。

本次只是 **CR-02b 的真实 Owner ACL 第一增量**。还没有做 QuotaExceeded/blocked IndexedDB/事务 abort/本地损坏或驱逐、真实 429/503/Go Context.Done 与多个窗口同时读取途中撤销等故障回归；这些继续开放，不得因本增量通过而关闭整个 #2348。真实 iOS Home Screen、生产公网证书/实际生产授权安全验收仅按用户决定“跳过（未验收）”，绝不阻塞源码和受控 CI。仍必须通过本准确 HEAD 真实 Go+PG17+Chromium 专项、完整跨平台 77-job CI/Final Gate、fresh clean 才能合并。

## 测试夹具中的持久安装身份

原始 S2B3 受控 Go Gin 测试为了保留“旧 Server 不提供持久 PWA 身份则不得兜底伪造”的生产契约，默认不设置 Server.PWAOfflineInstanceID。因此本 CR-02b1 只在 XD_PWA_CR02B1_REAL_ACL=1 开关下，先对隔离 PostgreSQL17 自动迁移 meta.PWAOfflineInstance，再调用正式 meta.EnsurePWAOfflineInstanceID(db) 读取或创建经过校验的持久 UUID，并装入真实 Server 字段后构造原 Gin Router。不开启该开关的既有 S2B3 夹具行为不变；不会将随机写死的 UUID 冒充真实部署身份。这个受控测试本身仍不等于真实生产数据库生命周期或 OS 主屏验收。

## CI 固定超时及来源约束

真 Chrome P1 App Shell Service Worker ready 是一个可能永远不 resolve 的原生浏览器 Promise，不能让失效夹具挂满 45 分钟 CI。受控测试现在有一个 15 秒的原生 SW ready 上限，外加全程 7 分钟固定阶段 watchdog。超时时只记录 PWA_CR02B1_SAFE_WATCHDOG 和有限不含账号/JWT/文件名/URL 的阶段标识，退出 1；**不是**放宽安全断言或把浏览器失败当成通过。旧准确 HEAD 的任何 GREEN/RED 均不传递给补丁后新 SHA，必须重新通过真实 Chrome+Go+PG17 专项与全 CI/Final Gate。

## 2026-10-22 · 真实专项首次失败记录与最小定位

准确 SHA 79b6fa9270e3425c29407346f247b62a6f0e1dde 的真实 Go/PG17/Chrome 专项 #39725949167 已完成 Go 夹具与浏览器执行，但仍为 RED：日志仅确认固定 phase=actual-login-and-Owner、Error，未能区分真实登录控件、授权、公共 SW 就绪与 P1 写入。禁止将该失败归因成已证实的生产 ACL 安全漏洞，也禁止将旧 S2B3 合成/独立成功算作本轮 CR-02b1 成功。

新测试版本在原 Chromium 真实登录/IDB 写入链路中添加仅含固定 allowlist 的阶段码（如 wait-login-form、submit-login-form、wait-real-session、wait-public-shell、reload-authenticated-App、authorized-directory-album-capture）。原始 JWT、测试账号、URL、Server private fixture logs、文件/相册 ID 不进入日志或上传制品；所有严格的 Owner/ACL、200/404、清退检查及超时保持，准确 HEAD 专项与全 CI 必须重新执行。

## 2026-10-22 · 第二次准确 SHA 真实 Browser RED 定界

准确 HEAD 662be362eb730006e868b62fe534d9d0ba9d822d 的真实 Go/PG17/Chrome 专项 #39726700051 RED，固定阶段码明确停在 wait-public-shell，即真实登录/JWT 已经过关，但浏览器 navigator.serviceWorker.ready 在 15 秒内未得到 active Worker。没有进入 /me/ACL/相册写入测量，不能将其称为 Go Owner 安全失败。下版只加不含敏感字段的公共 SW 状态诊断：secure/registration/active/controller 布尔量及 /sw.js 公共 HTTP 状态/MIME 匹配；仍保留真实 SW ready 硬条件。原 Go/ACL 断言与无私有缓存策略不放宽。

## 2026-10-22 · 真正重现的 Go 静态服务重定向问题（第三轮 RED 后修复）

- 新 HEAD `cbdd6ffa` 的 77-job CI Final Gate 成功，但独立真实 Chrome/Go/PG17 专项 #39727382460 **FAILED**。真实登录已通过，页面 `/sw.js` HTTP 200/MIME 正确，但 `navigator.serviceWorker.getRegistration()` 未找到注册，15 秒 `ready` 超时；没有进入 Owner ACL、历史快照或撤销验收。
- 原始受控 Gin fixture 使用标准 `http.FileServer(http.Dir(dist))`，Go 对字面 `GET /index.html` 返回 HTTP **301** 到 `./`；已用 Go 标准库独立最小复现。与此同时 `web/scripts/build-pwa-shell.mjs` 确认把 `/index.html` 加入公开 Shell 预缓存，原本产品 SW `assets/icon/web/sw.js` 使用 `redirect: 'error'`，拒绝重定向。因此旧 Gin fixture 不能正确模拟原 SW 所要求的公开静态资产服务。
- 最小源级修复 **仅在隔离 Go _test.go fixture 中**：显式公共 `/index.html` 用 `http.ServeContent` 原样输出 200、不重定向；私有 `/api`、JWT、Owner ACL 不变；真实浏览器增加 no-store + redirect:error + text/html/200 的 fail-closed 前置断言。
- 前一诊断提交 `788b752` 对生产自动注册行为只作观测，不自行补装 Worker 来通过验收（诊断性补装成功仍 RED）。此轮整合为完整 master 上的一工作提交后，新 HEAD 专项和 CI 重新跑；**截止提交时仍 NOT PASS**，不能声称 CR-02b1 已完成。真实机器、生产安全仍按既定边界处理。
