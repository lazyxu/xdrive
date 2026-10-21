# P0 · 百度动态照片地图故障诊断：系统依赖为单一主入口

日期：2026-10-21。范围：Web/Mobile Web/PWA/Desktop 共享图库和管理员系统依赖。
不改变百度唯一地图 Provider，不改变 Owner /cell-items、GPS 同意/撤销、Server 签名发布、地图配额或静态地图回退。生产环境安全验收永久 **按用户决定跳过（未验收）**；源码安全门禁照常生效。

## 已查证的问题

- `ui/shared/src/mui/MediaGalleryBaiduJSAPI4PhotoSurface.tsx` 将初始化、会话、视窗和续期失败折叠为 `unavailable`，只显示“百度动态照片地图暂不可用，仍可使用原有地点与静态地图”。SDK 超时 Abort 在旧实现中还可能没有完成错误提示。
- 上层 `MediaGalleryPlacesMap.tsx` 当 `GET /status` 的 Server Release 被拒绝时根本不挂载动态照片地图；此场景不会进入 PhotoSurface 的失败提示。
- 管理员 `BaiduJSAPIDesiredPanel.tsx` 已有独立 Browser AK、`activation_state`、`release_blockers` 和可选 Loader 检测，原始字段已经受权限保护。不能再建立第二套可编辑配置，也不能把 Static Map 在线健康或 Loader 成功冒充动态地图端到端通过。

## 交互决策

- 图库的静态回退保持原布局，只显示一句轻量提示，管理员可点“查看原因与修复建议”。
- Web/PWA 管理员直达 `admin-services?service=baidu-map&tab=verify`，使用原有授权路由和 `launchWebApp`，普通用户绝不暴露可用的管理入口。
- Desktop 管理员点击后走已有一级 `admin-services` 页面并定位“百度地图 / 检测与生效证据”；`file:` Desktop 仅能独立打开安全 HTTPS 地图窗口，绝不调用第三方脚本。
- 系统依赖保留现有“六个 Server 技术字段”，增加可操作的 `release_blockers` 中文解释 + 安全操作建议，并在同一只读检测部分显示最近 **15 分钟本进程**客户端故障阶段/短错误码/建议。两种证据绝不混作“已通过”。

## 故障归因与脱敏

- Server Status：未授权签名（`server_release_blocked`）、状态 HTTP 401/403、429、404/501 或网络错误。
- Session：地图专用会话签发 HTTP 401/403、429、404/501 或其他失败。
- SDK：固定 `/_BMapService/api?v=4.0` 及受控子资源加载/绑定异常、8 秒初始化超时。
- Map：原生 Map 能力缺失、已授权 `/cells` / native viewport 查询错误（401/403/409/429/404）、Go 取消后的安全回退。
- Renewal：2 分钟 Cookie/Session 续期失败，立即销毁动态地图并显示静态地图；不得继续显示失效的私有聚合。
- 不将用户正常路由切换 Abort 记为失败，不将 >100 个照片的有界“请放大地图”记为 SDK 故障。成功的已授权地图渲染清理过时诊断。
- 本模块**只存经过固定白名单校验的代码 + 时间戳**，按 Server/账号对应的运行时 `diagnosticScope` 隔离，最多 8 个 Scope，TTL 15 分钟，内存-only；不持久化到 IndexedDB/localStorage/SessionStorage/SW/URL，不收集 provider 错误消息/堆栈、HTTP body、AK、Cookie、JWT、精确经纬度、PhotoAsset/Node ID、缩略图 URL 或图像像素。
- 管理员可能在不同浏览器、不同 HTTPS Desktop 窗口查看；无记录时显示“本客户端暂无故障证据”，不能猜测另一会话的故障。
- `release_blockers` 缺失时如实报告 Server 未返回，不能将它视为 0 个阻断；管理员的 Loader 验证必须手动触发、可能消耗额度。

## 此轮对用户实际错误的证据边界

- **唯一可确定的源码条件**：看到 PhotoSurface 原句时，动态地图组件已被挂载且某个运行时环节返回了 unavailable / invalid-bounds / query-unavailable 等失败。通常说明前置的 Server `/status` 自报 `authorized_signed_release`，但**不证明** Session POST、SDK 子资源、ClusterLayer 或 Owner GPS 视窗实际成功。
- **已经证明的确定性失败路径**：如果当前浏览器文档不是可信 HTTPS（含 HTTP、file:、不可信 Origin），`media-gallery-baidu-jsapi4-browser-loader.ts` 中的 `secureDocument()` 会在请求 Browser Session 前拒绝，初版仅有通用 `unavailable`。现在在 UI 加一条单独的 `https_origin_required` 前置分类，立即保留 Static Map、管理员系统依赖内展示 HTTPS/Caddy 排查建议，**不读取或保留真实 URL/Host**。注意这只能证明“HTTP 一定失败”，**不能证明某个当前用户的浏览器实际是 HTTP**。
- 初次会话签发超过 8 秒单独标记 `session_timeout`；SDK 获取超过 8 秒才标 `sdk_timeout`，不将两者混为同一个网络故障。
- 百度官方 JSAPI 4.0 使用 `BMap` 命名空间，4.0 自带 `ClusterLayer` 且有 `Convertor`；仅因源码引用 `window.BMap` 不能推断为 BMapGL 命名空间写错。SDK 返回、代理白名单/CSP 或授予的会话仍需要非生产的受控重现；无法访问生产浏览器/HTTP 的 ChatGPT 不得声称真实用户故障已定位。
- 原始 `gallery-places-viewport-quiet-navigation.cjs` 是已合入的真实 React viewport/cancel/Owner fixture。首次 HEAD 的全量 Desktop 回归在新 import 上抛 `MODULE_NOT_FOUND`，本轮让它真实转译并加载 **原始 TypeScript 诊断源码**，保持原 viewport/cancel 断言不变；禁止略过测试或伪造诊断模块。

## 验收范围

- 原始 TS 模块的 Node 编译执行，真实数字状态归类、恶意 getter、secret 非传播、Owner Scope 隔离、最多 8 scope、15 分钟失效及成功清理。
- 从实际 Web/Shared/Desktop 源码验证管理员才有路由、图库没有长诊断、Server blockers 可见、安全静态回退、会话续期以及 Abort 语义。
- 独立 P0-03 第三方 JS 真正 HTTPS Origin 物理隔离、100k/真实 iOS27/全链路取消仍未完成，不能将本 UI 诊断交付记作上述项目的安全验收成功。
