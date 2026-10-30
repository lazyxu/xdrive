# xDrive 服务器地址：Desktop / Android / iOS / DSM 统一连接规范

> Status: **architecture contract, not completed DSM configuration** (checked against \`master\` 0a450eef, 2026-10-30). A settings dialog is not evidence of an authorized Server switch.

## 用户可见目标

四个平台都应让使用者明确知道自己正在连接哪个 **xDrive Server**，并能通过受支持的 Host 配置流程更换 Server。共享的是配置体验和安全规则，而非未经验证的统一网络/登录传输。

| Host | 当前入口 | 现状 | 待补齐 |
| --- | --- | --- | --- |
| Desktop/Electron | Desktop 登录：服务器 + 内网连接参数 | 已有可编辑 Server 与连接探测 | 保持与 NAS/手机一致的文案和认证要求 |
| Android 原生 | Compose \`UnifiedLoginForm\` 的“服务器”及“内网 IP（可选）” | 已能输入 Server；可信 HTTPS 域名校验，明文 HTTP 仅经高级设置明确选择 | 持续做 PWA 1:1 行为回归 |
| iOS IPA | \`XDriveWebAppHome.swift\` 的“服务器 HTTPS 地址”与“更换服务器地址” | 已能配置/切换 HTTPS Origin，\`WKWebView\` 复用 Web/PWA 页面 | 保持 PhotoKit 与 Web Owner 的双向退出/清理和证书信任 |
| DSM NAS 套件 | \`web/src/synology.tsx\` 的共用设置弹窗 | **仅外观设置**；数据来自套件用户已连接的 Agent，浏览器通过同源 HTTPS \`backup.cgi\` 读取 | **实现真正经授权的 Server 地址查看、输入、验证、切换流程** |

DSM 的 Web 页面 Origin 是 DSM NAS 域名（例如 \`https://nas.example.com\`），不是 xDrive Server Origin；这两个地址不能直接互换。DSM 账户也不是 xDrive Server 的 Owner，二者权限不得相互推导。

## DSM 当前真实权限与传输

\`web/src/synologyHost.ts\` 只创建 \`new URL('backup.cgi', window.location.href)\`；\`createXDriveSynologyBackupLocalClient\` 拒绝非同源或非 HTTPS CGI。套件 CGI 以 DSM package user 调用 \`xd backup synology-ui cgi\`，在 \`internal/synologyui/gateway.go\` 重新检查 DSM 会话、授权用户名、Origin/CSRF 和 Agent capability；它**没有**浏览器直接配置任意 Server URL 的接口。Agent 的已认证 xDrive Owner 会话是现有数据读取的来源。

因此不得通过修改 \`synologyHost.ts\` 的 \`backup.cgi\` URL、添加任意远程 fetch、把 Server bearer/cookie 发给 DSM JS、仅存 localStorage 或以 DSM 管理员身份替代 Server Owner 来“完成服务器设置”。这些行为都会绕过原授权边界。

## 下一步实施合同

1. **当前连接只读回显。** 由已授权 package Host 返回经过删减的 \`server_origin\`、连接状态、当前 Server Owner/Device 身份与可配置能力；不返回 Token、Refresh Secret、私有 Root 路径或 Agent IPC 密钥。必须从 Agent 当前可信状态获取，不把页面上次编辑的地址当成已连接。
2. **仅真实支持时提供编辑。** 在现有共用 \`XDriveSettingsDialog\`（或与 Desktop 相同的登录入口）提供服务器 HTTPS 地址及可选内网地址，保存为待验证草稿。地址变更应要求明确确认，不得把“保存输入值”显示为“已切换 Server”。
3. **受限 Host 操作。** 接入专用、版本化、同源 HTTPS、DSM CSRF 验证的 Host configuration API。还需由实际 package/Agent Owner 显式授权 Server 身份变更，验证目标 xDrive Server 的证书/域名、Owner 登录及 Device/Root 绑定；禁止任意 URL 代理、SSRF、TLS 校验跳过、HTTP 降级或用 DSM 会话替代 Server 凭证。
4. **事务式连接切换。** 先验证候选连接，再由拥有任务的 Agent 按已有持久化/回放协议处理正在执行的备份。切换要使旧 Server 的 Owner 源、图库、文件、缩略图、Viewer 焦点、Scope 与缓存失效；不允许旧 A → 新 B → A 混淆，不能自动取消或重复提交已确认的 Durable Task/UploadSession。失败保留原有效配置并准确显示错误。
5. **验证与可观测性。** 测试无权限 DSM 用户、同源 CSRF、无效或自签未受信证书、不同 Owner/Device、错误服务器、网络离线、正在备份、重启回放及 A→B→A。再验证 375/390/899/900 px、键盘/触控、深浅色、DSM/桌面共同导航。真实 NAS/设备验收可以如实标为**跳过（未验收）**，不是源码/CI/合并门槛。

**实施分界：** 本文只冻结正确的设计与权限门槛；在确有受保护的 Host 配置读写服务前，DSM 设置页不能假装支持服务器切换。Android/iOS/桌面的现有服务器输入继续维持。
