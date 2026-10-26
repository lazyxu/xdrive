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

## 首发验证与后续安全优化

本轮实现以已有 Go Token API 为兼容基线；Web/PWA 仍有历史的 localStorage token 存储路径，**未宣称已切换 HttpOnly Refresh Cookie**。该迁移需要同源 Origin/CSRF 校验、多标签刷新协调和离线登出语义整体实现、测试与安全复核，不能直接增加 Cookie 后保留原 JSON Refresh Token 双写。

需要补充实际 Android Keystore/进程杀死重启验收、桌面新旧局域网环境实测、Safari/PWA 真实站点存储限制测试。未完成的人工实机验收如按项目约定暂时跳过，必须准确标注，不应阻止其他合规代码和构建检查的推进。
