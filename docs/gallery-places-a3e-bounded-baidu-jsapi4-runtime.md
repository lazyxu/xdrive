# P0-Places-A3e · 百度 JSAPI4 受控 serviceHost 资源代理（运维试用）

**2026-10-19 · Provider 仅百度、AK 仅 Server、三端复用 Web/Mobile Web 的 Gallery，iOS 27「照片」为 1:1 交互/视觉验收基准。** xDrive 全屏 App Frame、52px 全局标题栏、原来的 Range/VirtualCollection/Viewer 和 Static Map 均保留。

## 为什么改

百度官方 JSAPI4 代理说明和加载说明明确要求 `window._BMapSecurityConfig.serviceHost` 以 `/` 结尾，浏览器通过 `/_BMapService/` 申请 Loader 和后续瓦片等 SDK 服务，Server 向固定百度 HTTPS 上游注入 Browser AK 和 `BMAP_PROXY_URL`。此前 xDrive 只注册 Loader，子资源清单为 0，即使 AK 和自动管理的 Ed25519 签名都有效也不可能显示可用的动态底图。之前生产状态是结构性死锁。

官方说明：https://lbs.baidu.com/docs/jsapi?title=jsapi4%2Fguide%2Fconcepts%2Fproxy
加载说明：https://lbs.baidu.com/docs/jsapi?title=jsapi4%2Fguide%2Fconcepts%2Fload

## 本 PR 的真实可执行链路

1. 唯一 Go Router 入口 `GET /_BMapService/*resource`，精确识别 `/api?v=4.0` 与普通 SDK 子资源。**不是通配上游 URL**：所有子资源经源代码固定 `https://api.map.baidu.com`，无 Caddy 直连百度，未安装外部代理变量、重定向、跨站或自定义 URL。
2. 每个子资源强制 GET、规范化 ASCII 路径、至多 192 字节相对路径、至多 2048 字节和 20 个 query key，禁止浏览器 `ak/token/key/callback/url/redirect/proxy/host`、重复 key、编码路径、目录穿越、绝对 URL、非百度 Provider；拒绝包含协议注入的值。采用独立版本固定的 source policy digest；客户端或管理员不能增加 host/path/媒体类型。
3. 只有当前 Server 管理的四分钟签名发布、HTTPS Origin、合法 Owner 身份、短期 HttpOnly Map-only Cookie、当前账号和 map epoch、加密 Browser AK 修订以及 PostgreSQL 跨副本 Owner/Fleet 限流/flight 均通过才能真正向百度发送 HTTP。出站 Referer 仅来自 `AllowedOrigin`；不转发用户 JWT、Cookie、Origin 等凭据，Go 请求可随浏览器 Abort 取消。
4. 上游只允许固定 JavaScript/CSS/PNG/JPEG/WebP/GIF/WOFF/WOFF2/WASM/PBF/JSON 的 MIME；Body <=2 MiB、5s 超时、禁止跳转、压缩、Cookie 和 Location，检出 AK 原文/URL/base64 则丢弃、仅返回 no-store/no-referrer/nosniff/Same-Origin 等固定标头。所有失败只返回不透明状态，绝不回显路径、AK、GPS 或上游正文。
5. 单 Owner 120 次/分钟、全实例 2400 次/分钟，最多 8/Owner、64/全实例并行；所有子资源仍复用同一 PostgreSQL 原子配额、flight 和关闭/轮换/撤销验证。**此为有界初始配置，不能声称配额适用于全部生产流量**。
6. Server 已有 A3d4 自动生成并加密持久化的 Ed25519 身份；编译后的合法官方 serviceHost 家族使管理端期望开启后可以实际签发 runtime，Web/Mobile Web 同源脚本、标记/聚合/Viewer 依旧只在真实 Server `authorized_signed_release` 才挂载；Desktop 依旧在独立 HTTPS BrowserWindow，而非 file: 直接执行百度脚本。

## 部署后具体如何尝试

使用已配置的 Server AK/Browser AK 和 Referer 白名单，不需要再次填写。升级 Server 与随 Caddy 构建的 Web 包、Desktop Agent 相关组件，确认 **系统依赖 → 百度 JSAPI 4.0 → 启用** 的 desired_enabled=true；查看 Server 报告的 runtime_enabled 是否真实为 true。随后在 Web/Mobile Web 的图库「地图」及 Desktop 的独立 HTTPS 地图窗口尝试真实加载、平移/缩放、当前 Owner BD09 点、100 张以上 8×8 聚合和 Viewer；DevTools 浏览器请求只能是同源 `/_BMapService/*`、绝无 Browser AK 查询参数。旧百度静态地图作为不可用时的退路。正式来源同意/位置派生索引需要按原有用户权限单独存在；没有授权的照片不会自动进入动态地图。

## 不能伪造的生产验收

此 PR 的源代码和真实 PostgreSQL/Gin/Go + Web/Desktop 单测、CI 并不是生产百度账号实测；未拥有生产 Server、私有9组配对上下游 HAR、iOS27 真机/Android/Windows macOS 物理结果或真实 100k 性能数据，不能据此宣称 1:1 生产验收成功。官方 serviceHost 代理示例不能保证对每个版本的内部瓦片格式完全兼容；如真实百度响应不属于明确允许的 MIME、含 AK 或超过2MiB，仍安全拒绝而不会偷偷绕过。为防主 App 身份误暴露，需在上线前专项审查百度第三方可执行 JS 与 xDrive Web token 的同源隔离和 CSP；这项安全工作不允许仅凭“可以渲染地图”认定已完成。实测泄漏/权限失败应立即关闭 desired_enabled，回退 Static Map。详见 #1798。
