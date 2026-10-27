# xDrive 登录与会话统一（2026-10-26）

## 用户确认的范围

- **Web 和 iOS PWA 的手动切换入口、离线历史维持现状**。不按安装模式隐藏入口，也不删除其路由或缓存。
- Desktop 登录页只有 Server、可选内网 IP、用户名、密码。连接模式永远为 Auto：LAN 连接探测成功时优先 LAN；仅在连接不可达/超时时用 Server 域名 DNS。公网 IP 不再提供输入框，也不复用旧保存的公网覆盖地址。
- Desktop 登录页不再展示证书管理面板或指纹。只有首次直连 IP 遇到未信任的 HTTPS 身份时，给出简短的「验证此服务器」入口，再由 **Electron 原生确认框**严格验证证书链/IP SAN/根 CA 指纹并要求用户亲自批准。证书变更仍阻止登录，绝不关闭 TLS 校验。
- Android 登录与 Desktop 使用同样的紧凑字段/按钮，自动内网优先；不暴露三模式/公网 IP。手机使用原生 Compose 布局、44+ dp 触控目标和可滚动小屏适配。
- 四端保留显示密码。Web/PWA「保持登录」默认选中，取消时仅内存保留会话；Android HTTPS「保持登录」默认选中，只有可轮换 Refresh Token 使用 Keystore AES-GCM 保存，Access Token 和密码不落盘。显式退出登录清除本机令牌，后续请求不继承其他 Owner 的会话。

## 服务端与客户端职责

保留 Go Server 管理员建号、bcrypt 密码哈希、15 分钟 Access JWT、30 天 Refresh Token 旋转及管理员会话撤销，不开启公开注册。Android 复用 /auth/login /auth/refresh /auth/logout 和 /me/change-password。Desktop 优先依靠 Go Agent 已加密持久化的会话恢复，保留旧保存密码的兼容登录入口。

失败分类：
- 可达性/超时/断网 **不得**视为主动退出；Android 不删除 Keystore 中保存的刷新凭据，Desktop 不关闭自动登录配置。
- Server 明确的认证失败/会话撤销清除失效凭据，并需要重新输入密码。
- TLS 身份/证书变化必须停止认证，不向未经验证的新地址发送密码或 Token。
- Logout 先清理本地会话/私有缓存，再尽力请求 Server 撤销；网络不可用时不宣称远端撤销已经成功。

## 已合入范围与分层验收结果（2026-10-27）

- [#2736](https://github.com/lazyxu/xdrive/pull/2736) 已将浏览器专用 HTTPS 同源 Cookie 登录、轮换、退出与浏览器修改密码端点合入 `master`。
- [#2741](https://github.com/lazyxu/xdrive/pull/2741) 已将 Web/PWA 客户端切换代码合入 `master@07503074`。**部署到包含对应服务端与客户端代码的 HTTPS 同源环境**、勾选「保持登录」且服务端支持浏览器端点时，使用 HttpOnly Refresh Cookie，Access Token 只留在 JS 内存。与此不同，HTTP 开发环境及保留的 JSON/Bearer 兼容代码仍可使用旧式 Token，不能笼统声称所有 Web 登录都已停用 localStorage Token。**真实旧版 Server 对浏览器 Cookie 端点返回 404 的专项兼容验收已由用户取消，不实施、也不设为合入/发布门槛。**
- 取消「保持登录」时仅保留页面内存会话，刷新页面需要重新登录；先前保存的 JSON 会话在升级时不会被强制抹去，而是在重新登录或安全清理时按新模式切换。Desktop、Android、xd 仍使用既有原生 JSON/Bearer 协议，不因浏览器迁移修改凭据格式。
- 浏览器 Cookie 路径包含严格 Origin/Host 与 Fetch Metadata 校验、Owner 绑定、旧刷新凭据重放拒绝、多标签可用时 Web Locks 串行轮换、登出立即清理本地私有视图并保留待远端撤销标记。无 Web Locks（含 Safari 受限能力）仅为安全降级，**不承诺跨标签互斥**；超时不代表远端撤销已经成功。
- Web/PWA 的手动公网/局域网入口和离线历史继续保持原状；不新增公开注册，也不绕过 HTTPS 身份验证。

**验证状态须分开记录（2026-10-27）：**

- [#2736](https://github.com/lazyxu/xdrive/pull/2736) + [#2741](https://github.com/lazyxu/xdrive/pull/2741) 是生产 Server + Web/PWA Cookie 登录实现；[#2760](https://github.com/lazyxu/xdrive/pull/2760) 修正 Android Viewer 缓存复用旧断言，Android API35 实测通过。
- [#2767](https://github.com/lazyxu/xdrive/pull/2767) 已加入**两层独立**回归：真实 TLS Gin/PostgreSQL 的 Cookie 轮换、Owner/Origin/重放负例，以及真实 Chromium 中生产 TS 方法的两标签 Web Locks。两层分别验证不能称为同一条 Web UI 端到端链路。
- [#2776](https://github.com/lazyxu/xdrive/pull/2776) 已将成熟 S2B3 生产 Web/Gin/PostgreSQL 测试夹具**仅在隔离测试时切换为 HTTPS**，用完整的真实 Chromium+React 登录页面在同源链路上完成：HttpOnly/Secure/SameSite Cookie、短期 Access JWT 不落浏览器持久化存储、Cookie 不作 Bearer（401）、冷恢复并轮换、双标签恢复、错误 Owner（409 且不消耗 Cookie）、UI 登出返回 204、Cookie 清除及新标签拒绝恢复。准确 [GitHub Actions #40433874668](https://github.com/lazyxu/xdrive/actions/runs/40433874668) **Success**，`passed=true`，`logoutHTTPStatus=204`，已合入 [`master@a315e799`](https://github.com/lazyxu/xdrive/commit/a315e799d9a884134b0fc7a7b3a40c32bc6344ab)。
- 此测试把已有 Gin S2B3 **隔离 PostgreSQL** 缺少的 `BaiduJSAPIMapEpoch` 表补入迁移，以满足生产 Logout 中 Refresh Token 撤销、地图 epoch 和审计的原子事务；**不改变生产 TLS/认证代码**。自签名证书宽免仅允许测试 Chrome 访问临时本地 TLS Server；这不是外部实际部署 TLS 身份验收，测试还特意禁用 Service Worker，不能冒充 iOS 安装态验证。
- [#2782](https://github.com/lazyxu/xdrive/pull/2782) 在真实 Chromium → 生产 React UI → 同源 HTTPS Gin/PostgreSQL17 链路中补齐强制密码修改、HttpOnly Cookie 轮换、旧 JWT/Cookie/密码拒绝和正式管理员 `revoke-sessions` 的 SessionVersion 撤销；精确 HEAD [Chrome #40438244128](https://github.com/lazyxu/xdrive/actions/runs/40438244128) **Success**，后续 Browser Cookie 401、React 返回登录页面及 PostgreSQL 无有效 Refresh Token 均已断言，已合入 `master@471ee442`。
- [#2787](https://github.com/lazyxu/xdrive/pull/2787) 验证升级到新版 HTTPS Web 后，真实 Gin 签发的**旧 JSON 持久 Session** 连续冷启动仍能访问原 Owner；明确退出 204 后重新登录迁移为 HttpOnly Cookie，旧存储中的 Access/Refresh Token 清除，新 Cookie 可再次冷恢复。精确 HEAD [Chrome #40438884261](https://github.com/lazyxu/xdrive/actions/runs/40438884261) **Success**，已合入 `master@9631e449`。这**不是**真实旧版 Server 二进制的 404 兼容验收；该项明确取消。
- [#2791](https://github.com/lazyxu/xdrive/pull/2791) 验证离线主动退出时本地私有 UI 立即清除、Owner-pinned Tombstone 持久保留、断网重启不自动恢复；恢复网络后真正 Gin Logout 204，并用**故障前 Refresh Cookie 再次调用正式 Gin 得到 401**，证明远端 Token 撤销。还在真实 Chromium 中注入 Web Locks getter/request `SecurityError` 与 `localStorage` getter 拒绝，确认不能重复轮换或无 Owner 静默恢复。精确 HEAD [Chrome #40443444740](https://github.com/lazyxu/xdrive/actions/runs/40443444740) **Success**，报告 `passed=true`、`failedAt=null`、`deniedStoragePageErrors=[]`。针对共享 Files 导航存储读取/偏好写入增加失败安全回退，配套实际 TS/TSX Callback Node 回归 **12 项通过、0 失败**；同版完整 CI 作业 **15 成功、15 条件跳过、0 失败**。GitHub 正常合入 [`master@9bf5fb32`](https://github.com/lazyxu/xdrive/commit/9bf5fb32bef740bee305361f0cc1f6fb072e46d9)。
- **真实设备验收边界：** 上述 Safari-like 测试是在 Chromium 中模拟受限能力，**不等于真实 Safari/WebKit 或 iOS 安装态设备验证**。无 Web Locks 时只承诺安全降级，不承诺严格跨标签互斥。iOS PWA 实体安装态、Android Keystore/杀进程复原、Desktop 局域网证书变化等按项目约定标记「跳过（未验收）」，不能写成通过，也不阻塞源码合并或开发。Chrome 测试的临时自签名 TLS 例外仅限其私有 Fixture；生产 TLS 信任不放宽。准确合入后 `master` CI、Release、Snapshot 与实际生产部署应另按各自 SHA 核查，不以 PR 专项全绿冒充已发布。

## 2026-10-26 · Browser Cookie 端点（服务端已合入）

服务端新增专用 `POST /api/v1/auth/browser/login|refresh|logout` 三个端点：仅接受严格匹配请求 Host 的 HTTPS `Origin`（如提供 `Sec-Fetch-Site` 则必须为 `same-origin`），刷新及退出只读取固定 `__Host-xdrive_refresh` Cookie，拒绝混入 JSON Refresh Bearer。Cookie 使用 Secure、HttpOnly、SameSite=Strict、Path=/、Host-only；每次刷新按原有服务端数据库事务更换 Token，旧 Cookie 立即失效。浏览器响应仍返回短期 Access Token，但不会以 JSON 返回真实 Refresh Token。原有三个 `/auth/*` JSON 接口一字不换，支持现有 Desktop/Android/xd 和旧 Web。

**当前服务端和 Web/PWA 客户端两阶段均已合入 `master`。** #2741 已实现 Cookie 模式登录与冷启动恢复、修改密码后 Cookie 轮换、支持时的 Web Locks 串行、跨标签 Owner/epoch 防护、离线登出标记和有界超时。旧 JSON API 继续服务原生客户端与兼容环境；各项真实浏览器端到端证据的状态见上节，不将代码合入视为实机验收通过。

此外，已认证的 `POST /api/v1/me/change-password/browser` 复用现有 Owner 密码变更的事务、会话撤销和审计；其浏览器 HTTPS Origin 必须同源，响应仅返回新 Access Token，替代 Refresh Token 必须通过新的 HttpOnly Cookie 返回。原来的 `/api/v1/me/change-password` JSON API 保持兼容原生客户端。浏览器请求仍需 Bearer Access Token，因此长期 Refresh Cookie 并不能直接访问其他 Owner API。
