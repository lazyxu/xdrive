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

## 已合入范围与剩余验收（2026-10-27）

- [#2736](https://github.com/lazyxu/xdrive/pull/2736) 已将浏览器专用 HTTPS 同源 Cookie 登录、轮换、退出与浏览器修改密码端点合入 `master`。
- [#2741](https://github.com/lazyxu/xdrive/pull/2741) 已将 Web/PWA 客户端切换代码合入 `master@07503074`。**部署到包含对应服务端与客户端代码的 HTTPS 同源环境**、勾选「保持登录」且服务端支持浏览器端点时，使用 HttpOnly Refresh Cookie，Access Token 只留在 JS 内存。与此不同，旧服务端 404 / HTTP 开发环境仍可回退兼容 JSON Token API，不能笼统声称所有 Web 登录都已停用 localStorage Token。
- 取消「保持登录」时仅保留页面内存会话，刷新页面需要重新登录；先前保存的 JSON 会话在升级时不会被强制抹去，而是在重新登录或安全清理时按新模式切换。Desktop、Android、xd 仍使用既有原生 JSON/Bearer 协议，不因浏览器迁移修改凭据格式。
- 浏览器 Cookie 路径包含严格 Origin/Host 与 Fetch Metadata 校验、Owner 绑定、旧刷新凭据重放拒绝、多标签可用时 Web Locks 串行轮换、登出立即清理本地私有视图并保留待远端撤销标记。无 Web Locks（含 Safari 受限能力）仅为安全降级，**不承诺跨标签互斥**；超时不代表远端撤销已经成功。
- Web/PWA 的手动公网/局域网入口和离线历史继续保持原状；不新增公开注册，也不绕过 HTTPS 身份验证。

**验证状态须分开记录：** #2741 合入前同一功能 HEAD 的 Web lint/构建、Desktop、Go API、服务器备份和相关打包检查已通过；Android 先前因 Viewer 缓存复用后的旧测试断言失败，已由 [#2760](https://github.com/lazyxu/xdrive/pull/2760) 的准确提交通过 API35 仪器测试并修复合入。合并后的 `master@07503074` CI / Snapshot 产物仍需看实际结果，不把合并成功冒充发布成功。真实 Chrome 双标签 Cookie 竞争、Safari 受限存储/ Web Locks、旧 Session 迁移及 401/403、密码变更/管理员撤销的端到端浏览器验证尚未完整取得证据；这些未验收项在 [#2725](https://github.com/lazyxu/xdrive/issues/2725) 继续跟踪。实际 Android Keystore/进程杀死重启、Desktop 局域网/证书变化、安装态 iOS PWA 测试均按项目约定标记「跳过（未验收）」，不替代源码安全测试。

## 2026-10-26 · Browser Cookie 端点（服务端已合入）

服务端新增专用 `POST /api/v1/auth/browser/login|refresh|logout` 三个端点：仅接受严格匹配请求 Host 的 HTTPS `Origin`（如提供 `Sec-Fetch-Site` 则必须为 `same-origin`），刷新及退出只读取固定 `__Host-xdrive_refresh` Cookie，拒绝混入 JSON Refresh Bearer。Cookie 使用 Secure、HttpOnly、SameSite=Strict、Path=/、Host-only；每次刷新按原有服务端数据库事务更换 Token，旧 Cookie 立即失效。浏览器响应仍返回短期 Access Token，但不会以 JSON 返回真实 Refresh Token。原有三个 `/auth/*` JSON 接口一字不换，支持现有 Desktop/Android/xd 和旧 Web。

**当前服务端和 Web/PWA 客户端两阶段均已合入 `master`。** #2741 已实现 Cookie 模式登录与冷启动恢复、修改密码后 Cookie 轮换、支持时的 Web Locks 串行、跨标签 Owner/epoch 防护、离线登出标记和有界超时。旧 JSON API 继续服务原生客户端与兼容环境；各项真实浏览器端到端证据的状态见上节，不将代码合入视为实机验收通过。

此外，已认证的 `POST /api/v1/me/change-password/browser` 复用现有 Owner 密码变更的事务、会话撤销和审计；其浏览器 HTTPS Origin 必须同源，响应仅返回新 Access Token，替代 Refresh Token 必须通过新的 HttpOnly Cookie 返回。原来的 `/api/v1/me/change-password` JSON API 保持兼容原生客户端。浏览器请求仍需 Bearer Access Token，因此长期 Refresh Cookie 并不能直接访问其他 Owner API。
