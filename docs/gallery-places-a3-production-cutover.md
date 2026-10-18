# xDrive Places A3 · 百度 JSAPI 4.0 生产放行与三端验收

## c11 · 实际 HTTP 路由及 Caddy 反向代理闭环（2026-10-18）

**部署运行状态仍为 NO-GO。** 此次补全真正的 Gin/Caddy 地址路由，而非仅向 Go 包中添加未被调用的 Loader 函数：

- `POST /api/v1/media/places/baidu-jsapi/session`：使用正常登录 Bearer 的已认证 Gallery Owner，在独立的 `Origin` / Sec-Fetch-Site / JWT iat / DB User SessionVersion / Map Epoch / Browser AK revision / 签名发布根及当前源代码资源政策校验成功后，才签发 **120 秒**的 `XD_BMAP_SESSION` host-only、Secure、HttpOnly、SameSite=Strict、Path=`/_BMapService/` Cookie。无 Body、无浏览器传入 GPS/AK/Scope；不把 JWT 变成子资源 Cookie。当前由于无批准发布根与完整子资源清单，返回 503，绝不签发。
- `GET /_BMapService/api?v=4.0`：真实 Gin 精确 Loader 路由，向 Caddy 的 `/_BMapService/*` 由 Go Server 处理，Server 在签名发布、当前 Cookie/Owner/配置/epoch/跨副本限流及请求头/上游严格检查全部通过后才能对百度正式网络发请求。放行后只回送经清洗且无 AK 的限定 JS；关闭/轮换/过期期间的请求体在响应前再次确认并丢弃。**未列入源代码的 JS/瓦片/字体/WASM 子资源没有 Go 路由且返回 404，绝不可使用通配直连百度。**
- 所有 Caddy 类型（域名 HTTPS、LAN IP HTTPS、LAN-only）共同引入 `deploy/Caddyfile.common`，有 `no-store`、`no-referrer`、`nosniff`；不存在直接 Nginx/Caddy 反向代理百度的密钥插入。现有 PWA Service Worker 仅在 `/`/`/index.html` 导航失败时离线回退，不缓存地图 JS、地图 Cookie 或地点数据。默认 JavaScript API 状态与系统依赖配置继续清楚表示 `runtime_enabled=false`，当前仅 Server Static PNG 服务可用于生产。
- `InstallBaiduJSAPI4OperatorRelease` 只是**内存内受信部署配置入口**，不是公共管理或客户端设置；只有当真实账号许可、逐子资源白名单、敏感信息原始字节审计、源代码固定签名根及当前构建/策略/Origin/AK revision/epoch 受签名批准后，才能由未来安全部署加载凭证。当前没有任何启动调用方。不要把“路由 503”或一次成功编译写成三端实际访问成功。

**专项回归：** `internal/api/baidu_jsapi4_http_test.go` 验证真实 Gin 404/503、无 Cookie/AK 泄露、真正 Router 中精确地图路由与恶意模拟授权拒绝；`desktop/tests/baidu-jsapi4-protected-http-route.cjs` 验证 Caddy 先转到 Go、没有通配上游、PWA 非地图缓存及 Web/Mobile/Desktop 共享 Server Range 路径。真实授权用的前端 Map Session Provider、Desktop HTTPS-isolated Map、动态 BD09 视窗、官方资源白名单和真机仍**未交付**，详见本文件其他门禁。


## 2026-10-18 · signed-live transport and same-origin SDK implementation candidate

**Status: engineering candidate only; dynamic A3 production remains NO-GO.** This section records real source changes, not authorized Baidu production traffic or physical device results.

- Shared `ui/shared/src/media-gallery-baidu-jsapi4-browser-loader.ts` creates a real `<script>` requesting **only** `https://<current HTTPS origin>/_BMapService/api?v=4.0`, sets Baidu's required `serviceHost` ending in `/`, and exposes no Browser AK. It first awaits a **separate** authenticated Server map-only session grant; rejected grant/abort/file: origin cannot create a script. Concurrent callers share the script, and each authorized native Map converts the initial original WGS84 position with the official `Convertor.translate(points,1,5)`. It accepts only an independently derived current photo-WGS84 viewport; never repurposes BD-09 bounds or cell centers as true GPS. The browser factory has **no production caller** until a real, authenticated Session endpoint exists, and Electron requires a reviewed HTTPS-isolated view rather than `file:`.
- Go's `VerifyPinnedJSAPI4ProductionRelease` now implements the **actual** Ed25519 pinned-public-key verification for current trusted build/resource-policy/origin/Browser AK revision/map epoch and five-minute proof. `(*Server).baiduJSAPI4SignedLiveLoader` composes the exact same-origin request preflight, fresh Owner/map-only Cookie/account/config/epoch snapshot, signed release, existing cross-replica quota/flight, independently encrypted Browser AK, official fixed-host real `SafeHTTPClient.Do` (no env proxy/redirect, five-second limit), raw response sanitizer and a post-upstream current-credential recheck. It deliberately has **no public Router binding** until all child-resource and platform evidence passes independent review.
- **Mandatory current fail-closed build constants:** `jsapi4PinnedProductionPublicKey=""`, `reviewedJSAPI4ChildResourceCount=0`, existing JSAPI status `runtime_enabled=false`; there is no HTTP map Cookie issuer, no routable resource proxy and no supported client adapter acquiring a live Server session. A mocked `runtime_enabled:true` callback is NOT a Server signature, cannot satisfy the Go production release guard and does not prove production map access.

**Acceptance before enabling**: independent Baidu account-specific written entitlement, complete 9 × (Browser HAR + Server-upstream HAR) with synthetic locations and raw-byte Browser-AK leak audit, immutable per-host/path/query/MIME resource rules incl. JS/tile/font/WASM, operator-pinned public key and current signed release scope, Server-only Cookie signer/route/epoch/quota/cancellation, Caddy/CSP/PWA and sandboxed HTTPS Electron transport, accurate pan/zoom photo-WGS84 viewport conversion without inventing inverse coordinates, and real iOS27 Safari/PWA, Android Web/PWA, Desktop Electron/WebGL/100k/VoiceOver/pixel-hand gesture acceptance. Until then, the **existing Baidu Server-AK Static Map** remains the only live production map.

New offline Node test: `desktop/tests/media-gallery-jsapi4-browser-loader.cjs`. New negative Go boundary test: `internal/api/baidu_jsapi4_signed_live_loader_test.go`. Neither constitutes licensed upstream, approved release or physical three-platform proof. Keep credentials/HAR/Cookie/JWT/GPS/contracts out of GitHub, CI logs and chat; see the [private operator runbook](gallery-places-jsapi4-operator-runbook.md) and [GO/NO-GO #1798](https://github.com/lazyxu/xdrive/issues/1798).


> 2026-10-18 · 目标为 iOS 27「照片」**1:1 视觉/手势基准**，但保留 xDrive 全屏 App Frame、52px 全局应用标题栏及 Web/Mobile Web/PWA/Desktop ONE Gallery Owner Server Range / VirtualCollection / Viewer。百度是唯一地图 Provider。**此清单是验收门禁，不是生产授权声明。**

## 已实现但不等于运行时开放

- 统一 Owner 地点分页/真实坐标/视窗及返回 Viewer、源 GPS 数据合同；现行地图为 Server AK 驱动的百度 Static Map v2。绝不把网格中心或 Baidu BD-09 边界冒充原始照片 WGS84。
- 独立加密 Static Server AK 与动态 Browser AK 的配置、Owner 会话与撤销版本、跨 Server 限流/flight、短效签名候选、严密的私有 Loader 发送/响应检查、JSAPI4 native `Map / Convertor / ClusterLayer` 和有界 100-cell Owner 视窗控制器。
- 共享的 `XDriveBaiduJSAPI4MountLifecycle` 与 `XDriveMediaGalleryBaiduJSAPI4Surface` 提供统一的 Native Map 获取/销毁、初始**原始照片 WGS84**相机、拖动/缩放取消过期请求、100-cell 不完整结果提示、单点打开原 Gallery Viewer；Web/Mobile Web/Desktop 使用同一个代码路径。它需要将来**先经过 Server 生产授权**的 `authorizedJSAPI4Runtime`，当前生产客户端不提供该端口，不加载任何额外第三方资源。不能用前端布尔开关取代 Server 放行。静态地图同 Provider 保持可用。
- 参照 [JSAPI4 Loader 文档](https://lbs.baidu.com/docs/jsapi?title=jsapi4%2Fguide%2Fconcepts%2Fload) 在安全放行后使用不含 AK 的 **同源** `serviceHost`（必须以 `/` 结尾）和 Server 注入 Browser AK；官方 [代理保护说明](https://lbs.baidu.com/docs/jsapi?title=jsapi4%2Fguide%2Fconcepts%2Fproxy) 的通配 Nginx 示例**不允许直接用于 xDrive 多用户生产**。
- 官方 [ClusterLayer 类](https://lbs.baidu.com/jsapi/refdoc/v4/classes/BMap.ClusterLayer.html) 可供地图移动、缩放、点选和原生聚合，100k 原始文件不允许逐张浏览器渲染：Server 应先有界过滤，100 cell 不全时必须显示“缩小范围/放大地图”，而不能虚构一个完整簇。

## 生产部署的真实阻断项（全部通过才可放行）

| 阶段 | 必须提供的真实证据 | 缺失时行为 |
| --- | --- | --- |
| 账户许可与额度 | 针对实际 JSAPI4 Browser AK、代理自托管、多用户、iOS/Android PWA/Electron、派生坐标保留与配额的可独立审查批准 | NO-GO；此前操作者在 #1798 的许可/费用范围说明**已经收到，不再重复索取**，但不能代替官方证据 |
| 真实资源白名单 | 同一个授权 HTTPS staging Origin 的 **Web/Mobile Web/Desktop × load/pan/zoom，共 9 组 Browser HAR + 上游 HAR（18 份）**；审查每个 host、percent-encoded path/query、method、Content-Type、响应体限额、重定向及额外 JS/瓦片/字体/WASM | **不得**以宽泛通配反向代理代替精确且版本固定、人工审查并签名的代码白名单 |
| 服务端签名及 AK 防漏 | 固定并核验独立操作员签名公钥；每次资源请求重验 Owner SessionVersion、Map Epoch、AK 修订及每资源 Owner/Fleet 额度；原始上游/下游字节、URL/headers/errors/日志/referrer/Service Worker 扫描必须证明 Browser AK 不泄漏 | `runtime_enabled=false`；目前 `jsapi4PinnedProductionPublicKey=""`、审核子资源数为 0，禁止公用 Loader、Cookie、代理 |
| 传输与浏览器隔离 | Caddy TLS/CSP、同源 Cookie/CSRF/Origin、可中止的 Go Context、Electron Main/Agent IPC/安全上下文、PWA 缓存禁写、禁 Redirect、无任意上游 URL | 不允许在 `file:` Electron 页面直接加载带 AK 的跨域 script，也不允许把 HTTP Browser Token 暴露给外部 SDK |
| 真机产品验收 | iOS 27 Photos 逐场景 1:1 截图/手势与返回锚点；iOS Safari/PWA、Android Mobile Web/PWA、Desktop Electron 的动态地图加载、平移、缩放、Marker/Cluster、Viewer；深/浅色、横屏、VoiceOver/键盘和 100k 背景取消/性能 | 只有模拟 CI 是“代码预备”，不能写“真实三端通过”或“生产可用” |

### 隔离环境的九组技术采样

仅在**你实际控制**、已授权、证书可信的 HTTPS staging 测试域名进行，使用专用 Browser AK 和纯合成地点/GPS。参照 [私有采样操作手册](gallery-places-jsapi4-operator-runbook.md) 准备九条记录的本地 `manifest.json`，在各平台单独记录冷加载、平移、缩放的浏览器和 Server→百度上游两段请求。独立采集上游的原始字节；浏览器 DevTools HAR 不能假冒 Server 上游 HAR。

在本地私有目录执行现有审核工具（把下面两项路径换成你的真实私有路径和已验证 HTTPS origin）：

```bash
node scripts/ci/baidu-jsapi4-evidence-matrix.cjs /private/baidu-jsapi4/manifest.json https://your-authorized-staging.example
```

**绝不在聊天、GitHub PR、CI 工件或公开 HAR 分析网站上传原始 HAR、AK、Cookie/JWT、账户身份、合同或个人 GPS**。只需将无敏感信息的审查结果、版本化的资源策略和测试结论纳入可追溯证据。采样前需要独立受控 staging 实例，不允许将现行 `runtime_enabled=false` 生产端直接改为 true 来获取 HAR。

## 最终三端真实验收矩阵

| 场景 | Web | Mobile Web/PWA | Desktop Electron |
| --- | --- | --- | --- |
| 同源授权、无 AK 泄漏的真实 JSAPI4 冷加载 | 待实测 | 待实测 | 待实测 |
| 连续拖拽/双指捏合/缩放时同步中断旧视窗 Go 请求 | 待实测 | 待实测 | 待实测 |
| 官方 Marker / ClusterLayer；不完整视窗不假聚合 | 待实测 | 待实测 | 待实测 |
| 点击地点→共享 Range/VirtualCollection/Viewer→返回锚点 | 待实测 | 待实测 | 待实测 |
| 100k 照片、弱网、快速导航、后台/登出/撤销 | 待实测 | 待实测 | 待实测 |
| iOS27 视觉、深浅色、横屏、无障碍和可见性能数据 | 待实测 | 待实测 | 待实测 |

真实验收通过并签署 Server 发布证明、完成最后一次授权检查后，才能在独立可审计部署版本上开启动态服务；未通过则保留百度静态图和原有图库。完整设计参考 [A3 代理安全评审](gallery-places-jsapi4-proxy-review.md)、[Places 1:1 路线图](gallery-places-ios27-roadmap.md) 和 [GO/NO-GO #1798](https://github.com/lazyxu/xdrive/issues/1798)。
