## A3c20 · 百度 JSAPI4 三端真实 Owner 8×8 数量气泡（2026-10-18；依赖 #2083，生产 NO-GO）

本阶段**不启用百度动态代理**，只把 A3c19 新 Server 有界 Owner `/media/places/baidu-jsapi/cells` 的真实聚合数据贯通 xDrive 同一 Gallery：Web、Mobile Web/PWA、独立安全 HTTPS Desktop 窗口共享后端接口、数据源、照片选择 Range/VirtualCollection 和 Viewer。原生 JSAPI4 仅在 Server 当前签名发布、HTTPS 同源、单独签发 Map-only Cookie 后可以加载。超过 100 张照片时，最多 64 个官方 BMap.Label 标注显示 Server 全量精确数量；标注位置为该格真实代表照片 BD09LL（非网格中心），不将一格一个代表点投进 ClusterLayer 当作只有 64 张。点击多张区域逐级放大并重新有界查询，单张经 Gallery Range 重新授权后打开 Viewer；同步提供 44px 键盘可操作的区域列表。100 张以内沿用真实完整 JSAPI4 ClusterLayer。

客户端请求端严格校验 BD09 范围及坐标框架、总数/逐格数量的一致性、8×8 最多 64 格、有限浮点与安全整数、真实配对 Asset/Node ID、重复标识和额外响应字段；转动/平移/缩放即 Abort 上次 Server 查询、撤除过期气泡，导航/登出销毁覆盖物且不允许旧点击打开照片。单个 100k 合成 fixture 是纯离线契约测试，不等于物理大图库、原生 iOS/Android/Windows 截图或百度瓦片网络真实性证明。若 A3c19 未合入、SDK资源审核未完成、当前发布无有效签名，则继续安全降级百度静态地图，不提供伪造的已运行动态地图。

**A3 仍不得宣布生产 GO**：#1798 要求 9 对真实 Browser+upstream HAR、Provider 实际版本许可/AK 审核、来源固定签名根及逐资源白名单、HTTPS 三端 Web/Mobile/PWA/Desktop 真机手势和 iOS 27 照片 1:1 截图、实际 100k 性能/Viewer/删除/撤销等真实验收；静态 Server AK 与 Browser AK 已独立配置，不能把 4.0 代理无约束转发。保持百度唯一 Provider、全屏 App Frame/52px 全局标题栏、Web/Desktop 后端共享架构。

## A3c19 · 100k-safe Owner BD09 派生位置 8×8 有界聚合（2026-10-18）

新增真实 Go Server `GET /api/v1/media/places/baidu-jsapi/cells?west=...&south=...&east=...&north=...`，继续沿用原 `/viewport` 的 **当前 Owner JWT/SessionVersion、撤销 Epoch、实际签名发布**三重检查（查询前、SQL 后、写出前），未批准动态发布仍返回 503。坐标帧严格为 `bd09ll`；未知字段、重复参数、任意 AK、伪造 WGS84、异常范围或取消请求一律拒绝。**没有任何新地图 Provider、百度网络调用、Browser AK 或原始 WGS84 位置暴露。**

所有可见数据与原始 precise Viewport **复用完全相同**的 Owner+PhotoAsset+原始有效 GPS+Node/MediaMetadata revision+逐资产显式同意未过期 JOIN 谓词。单条 PostgreSQL 语句对**视窗全部合格照片**按固定 8×8 网格进行分组，`COUNT(*) OVER(PARTITION BY ...)` 汇总真实数量，`ROW_NUMBER` 在每格选中一张实际照片的成对 BD09 坐标与 Asset/Node ID；不使用人工网格中心冒充照片位置，不把前 100 张算作全部。返回 `{coordinate_space,index_scope,grid_columns:8,grid_rows:8,total_count,cells:[...]}`，最多 64 个网格对象，支持跨 ±180° 视窗；旧精确分页 /viewport 不改变。

测试：真实 PostgreSQL Owner 隔离/同意/修订与跨日界线查询复用源 fixture；同 bin 多照片准确计数与单张真实代表坐标；新 Gin 精确路由未签名不可用、严格参数、无 Cookie/AK 原始坐标泄漏；合成 100k 响应体算术 64-cell 上界。**合成 100k 不等于真实 100k 性能实测**，还需真实 PostgreSQL 100k 和 Web/Mobile/Desktop 物理跑分、ClusterLayer 数字/缩略图交互的后续 A3c20/C1 测试。此阶段仍 **NO-GO**：尚无私有 9 组真 HAR、源审核全部百度子资源、受信签名根与真实地图/真机 1:1 验收，不能开放通配代理或冒充生产地图。

## A3c18 · 百度 JSAPI4 Server 发布前置状态可观测（2026-10-18，仍 NO-GO）

现有管理员「系统依赖 → 百度地图 → 检测」在 Web/Mobile Web/PWA/Desktop 共用 `GET /api/v1/admin/services/baidu-jsapi` 与 MUI 面板，新增有界只读 `release_blockers` 枚举：期望配置、独立 Browser AK、安全密钥环、可信 HTTPS Origin、代码固定的 Ed25519 发布公钥、完整审核资源清单和当前签名发布。所有原因都由实际 Server/源码生成，不读取、回显 Browser AK、Server AK、Origin 或 Owner/GPS；旧 Server 未返回此字段仍兼容。

该面板与 API 不执行百度 SDK/Tile 测试或外部请求，不改变 Server 授权路由，不能靠修改 `desired_enabled` 清除签名/子资源门禁。**这是软件发布前置可见性，不等于百度正式生产运行或 1:1 验收。** 真实双端 HAR 9 组、资源依赖图谱、AK 泄漏审计、发布签名与轮换，以及真实 iOS27/Android/Desktop、100k 缩略图簇仍不具备；不得开放未经批准的通配资源代理。

## A3c17 · Desktop 独立 HTTPS 地图窗口（2026-10-18，JSAPI4 仍 NO-GO）

已为 Desktop 增加从当前登录 Agent 所指定 HTTPS Server 地址打开的独立、非持久 Session 的 Electron BrowserWindow。它使用 xDrive 已有的 Web Gallery 路由 /#/app/gallery?section=places，因而与 Web/Mobile Web 复用同一个 Owner API、Gallery Range、VirtualCollection、Viewer 与 MUI 组件，无第二地图 Provider；原 Desktop file Renderer、全屏 App Frame 和 52px 标题栏不变。该新窗口 nodeIntegration=false、contextIsolation=true、sandbox=true，禁止任何 preload、webview、弹窗、权限及跨 Origin 请求/导航，证书由 Electron 默认 HTTPS 严格校验，不复制 Desktop Agent JWT、密码、AK 或默认 Session Cookie。首次需在独立安全窗口登录，切换 Desktop 账号或 Server、退出、认证过期/账号停用会关闭窗口。

安全链路回归覆盖 HTTPS IP/域名、错误协议/路径/凭据、跨 Origin 和百度直连拒绝、主进程/Preload/组件接线；Node 合成测试不能替代真实 Electron/iOS/Android。地图 JSAPI 正式代理仍被独立签名根和资源白名单源码门禁拒绝：没有完整原始真实百度资源/HAR/泄漏审计，不能放行，也不能声称 A3 已达到生产 GO。外部许可证、两类 AK/额度及零额外费用的操作员报告已在 Issue #1798 留存，不重复要求确认。

## A3c14 · 已转换 BD09LL 相片点的原生 ClusterLayer 数据边界（2026-10-18）

本阶段只提供经过 Server Owner 来源、定位同意及独立签名状态验证后的 **BD09LL 点列表**与原生百度 ClusterLayer 的安全连接适配器；**尚未挂载到产品页面，未启用真实百度动态 SDK 或生产资源代理。** Web/Mobile Web/PWA/Desktop 可使用 A3c13 相同的取消型 DataSource 接口；本实现不创建平台分叉。摄像机 Native getBounds() 坐标保持 `bd09ll`，绝不能改称照片原始 WGS84，已经官方正向转换的坐标不能再 Convertor.translate。原生点在无分页、有准确 100 以内总数时才绘制；100k/超过范围仅报告 `incomplete`，不伪造完整聚合。

Marker 点击仅返回经过当前窗口验证的 `assetID + nodeID`，后续仍需真实 Owner Gallery Range/VirtualCollection/Viewer 重新校验权限；该模块自身不加载 SDK、不发请求、不显示媒体，也不保存定位。移动/缩放、页面卸载同步调用 AbortSignal；旧结果不改变新窗口。Node 回归测试验证 BD09(0,0)、ID、GeoJSON、分页/100k、恶意坐标、取消与晚到响应。不触碰静态地图、Server AK/Browser AK、Caddy、许可发布或 iOS27 布局。本层代码不代表 A3 GO，仍需私有 18 个真实 HAR、完整子资源白名单、Operator 公钥签名和三端真实隔离/视觉/性能验收。

## A3c13 · signed-release-fenced native BD-09 Owner viewport (2026-10-18)

**This is actual route + three-client transport, NOT yet a licensed JSAPI4 production map.** Until Baidu entitlement, complete child-resource allowlist, raw 9-pair Browser+upstream HAR leak audit, pinned production signing root and physical client isolation tests are independently approved, the Server's production release guard still rejects these requests. Static PNG remains the sole authorized map rendered in the Gallery; do NOT substitute a local/second Provider or pretend the new point API is a complete dynamic ClusterLayer.

- Owner-only `GET /api/v1/media/places/baidu-jsapi/viewport?west=...&south=...&east=...&north=...&limit=...&offset=...` is registered in the real Gin authenticated Router, never Caddy's `/_BMapService/*` proxy. Its entire query rectangle is **BD09LL**, not WGS84/GCJ02; unknown, forged coordinate-space, AK, duplicate or unbounded query parameters fail validation. Before reading the DB, the Server checks an actual signed JSAPI4 release, then independently validates current Owner JWT issued-at, SessionVersion and Map Epoch; after the bounded query it rechecks the SAME authority pointer and current source-pinned release for rotation/revocation. Without a release it returns `503 map_runtime_unavailable` with no Cookie or location leak.
- The existing `queryBaiduPhotoMapViewport` joins live Owner, PhotoAsset, primary Node, current ready MediaMetadata, exact original-GPS provenance, source revision, unexpired individual owner consent and canonical projection version. It supports antimeridian, limits pages to 100, computes the exact number of **opted-in, indexed PhotoAssets** in the window and returns only derived BD-09 latitude/longitude and authorized logical Asset/Node IDs. New response tags: `coordinate_space:"bd09ll"`, `index_scope:"explicit_opt_in_only"`, `items`, `total_count`, `offset`, `limit`, `has_more`. **Never claim this count is all library photos or all geographic cells.** The WGS84 `/media/places/viewport` remains unchanged.
- Web/Mobile Web/PWA share typed `mediaBaiduNativeViewport` via existing `XDriveApi` and `createWebMediaGalleryDataSource`; Desktop routes through IPC-safe Electron Main + local Go Agent + authenticated Go Client with abortable request ID and Server cancellation. Invalid coordinate contracts are rejected at Client, Main and Agent boundaries, no credentials in URLs, no direct provider requests.
- **Not yet mounted in the native Map UI:** The existing official JSAPI4 `ClusterLayer` controller still expects WGS84/official converter to produce BD09 point geometry. These newly available BD09 source-derived positions must be connected through a distinct reviewed already-BD09 data path (never re-convert or silently relabel). This stage delivers correct authorization/transport but does **not** claim a true native pan/zoom production render or full 1:1 iOS27 acceptance.
- Regression: Go real Router deny/default, strict query and JSON secrecy, existing PostgreSQL derived-position source/consent/revocation/wrap integration plus current Node reference, Agent local BD09 parser negatives, Go Client fixed URL/cancellation and coordinate-frame validation, Desktop 3-client static wiring. Full new exact-head 76-job GitHub CI incl Postgres Race, Go Linux/Windows, Web/Desktop, Rootless/Caddy, artifacts and Final Gate required before merge.

## A3c12 · Web/Mobile Web/Desktop Browser AK 共享配置管理（2026-10-18）

**生产动态地图仍为 NO-GO。**「系统依赖 → 百度地图 → 配置/验证」现使用同一个共享 Browser AK 面板。Web/Mobile Web/PWA 使用管理员 Bearer API；Desktop 使用有独立权限校验的 Electron Main→本机 Agent→Server admin API。静态 PNG 的 Server AK 和 JSAPI4 Browser AK 不共享、不复用、不互换；已保存的 Browser AK 不可通过该接口回显或读取。

- Server 既有 `GET/PUT /api/v1/admin/services/baidu-jsapi` 只返回非秘密配置、明确区分 `desired_enabled`（期望）与 `runtime_enabled`（经过生产签名放行）。保存凭据只写加密修订并留存审计，不触发百度上游或 SDK 下载；新界面始终提示不能手动绕过许可、子资源清单和签名门禁。
- Desktop 增加严格 `GET/PUT /v1/cloud/admin-baidu-jsapi`；Go IPC 拒绝陌生 JSON 字段、超长输入、非法字符和冲突的清除/开启，Electron Main 还执行 admin-services capability 及安全数据结构校验。Server 再做实际管理员角色与修订权限判断，不能仅凭本机 capability 获得 Server 授权。
- Web、Mobile Web 和 Desktop 复用一套 MUI 面板、单一类型 `XDriveBaiduJSAPIConfig/Update`、错误和未保存编辑导航保护；清除 Browser AK 不影响 Server AK Static PNG。既有 Gallery Range/VirtualCollection/Viewer 和全屏 52px App Frame 完全不改。
- 下一阶段仍须：独立百度账户许可证明、九组真实 Browser+上游 HAR 原始响应审计、完整 JS/瓦片/字体/WASM 子资源源码白名单、私有受信签名发布启动配置、Web/Mobile SDK 真正挂载、独立 HTTPS Electron Map View、真实坐标视窗、iOS27/Android/100k 设备验收。此提交绝不能标记 A3 GO。

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
## A3c16 · 真实 Web/Mobile Web 签名 Session 与 BD09 原生照片地图 UI 接入（2026-10-18）

- **新增真实浏览器通信**：Web/Mobile Web/PWA 的同一 `XDriveApi` 读取 `GET /api/v1/media/places/baidu-jsapi/status`，只有 Server 当前返回 `provider=baidu-jsapi-4.0, enabled=true, activation_state=authorized_signed_release` 才在图库「地图」准备原生载入。接着真实已登录 Bearer 发送无请求体的 `POST /api/v1/media/places/baidu-jsapi/session`，从可信同源 HTTPS 取得独立、短效、Secure/HttpOnly Cookie；Server 未签名放行默认 503/false，浏览器不加载任何百度动态脚本。Browser AK 不在 HTML、链接、Session 响应或 JSAPI URL。
- 复用既有官方形状 JSAPI 4.0 同源 `/_BMapService/api?v=4.0` Loader、同一个 `_BMapSecurityConfig.serviceHost`（末尾带斜杠）；**未开放**未知 JS/瓦片/字体/WASM 子资源。重用同一原生 Map/ClusterLayer，`getBounds` 坐标是 **BD09LL**，只能请求 A3c13 已有 Owner signed-release-gated BD09 API，不得使用 WGS84 网格中心或二次坐标转换。照片点最多 100 个、Server 真总数、仅完整窗聚合；平移缩放立刻 Abort，旧结果不提交。
- 地图单点点击后必须重新通过 **现有 Owner Gallery Range**：基于最新用户排序向 Range 请求 `anchor_node_id` 获取可信逻辑序号，再按该序号读取单项；只有 Node 身份与当前响应一致，才调用既有 Range/VirtualCollection/Viewer。SDK 单点回调不拥有直接媒体访问权限；退出、导航与账号切换取消旧请求。
- 一套 shared MUI 地图组件和 DataSource 供宽屏 Web、Mobile Web/PWA 复用，不加第二份移动端实现，52px 全屏 App Frame 与原有照片布局不变。Desktop `file:` 页面**没有**地图 Session port，仍安全使用百度静态图；后续需要单独 HTTPS isolated BrowserWindow + Agent/Owner 身份桥，绝不可为了三端表面齐平在 Electron renderer 放开 Node/Token。
- 本阶段是**真实路由与 UI 集成、但实际 JSAPI4 生产仍 NO-GO**：资源白名单数量 0、公钥 pin 空、九组真实 Browser/Server upstream HAR、许可签字、Caddy/CSP/Electron/physical iOS27 像素+手势/100k 仍不具备。即使本 PR CI 全绿也不能写成三端百度动态实测通过。Server Static PNG 一直保留。
