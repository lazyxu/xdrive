# P0-Places-A3a · 百度 JSAPI 4.0 代理接入、安全及许可评审

**日期：2026-10-13** · **唯一地图 Provider：百度** · **判定：有条件可行；生产动态 JSAPI 尚未批准开启**

## 最新批准及官方事实

用户最新决定允许 Server AK 与 Browser AK 按真实业务需求分别配置。以前的“只允许 Server AK”临时决议已被取代。**已有 Baidu Static Map v2 使用 Server 类型 AK**，JSAPI 4.0 按官方 [加载说明](https://lbs.baidu.com/docs/jsapi?title=jsapi4%2Fguide%2Fconcepts%2Fload) 和 [准备步骤](https://lbs.baidu.com/docs/jsapi?title=jsapi4%2Fquickstart%2Fprepare) **需要 Browser 类型 AK**，不是同一密钥的两种模式。

官方 [JSAPI 代理说明](https://lbs.baidu.com/docs/jsapi?title=jsapi4%2Fguide%2Fconcepts%2Fproxy) 支持 `serviceHost`、`BMAP_PROXY_URL` 在自己的 Server 后端加 AK 后转发，前端不必带 AK；其 Nginx 范例**不能直接用作 xDrive 多用户通配生产代理**。生产使用还需账户实际满足 [百度开放平台条款](https://lbs.baidu.com/docs/pcsa?title=law%2Fopen%2Flaw) 和 [付费授权协议](https://lbs.baidu.com/docs/pcsa?title=law%2Fopen%2Flaw-commercial)，包括自托管、PWA、Electron、商用权、配额、归属标记、数据隐私与缓存限制。**没有账号/许可证实证，动态 JSAPI NO-GO。**

## 选型与已经具备的能力

| 路径 | 密钥和存储 | Web、Mobile Web、Desktop 业务集成 | 当前门禁 |
|---|---|---|---|
| 百度 Static Map v2 | xDrive 既有加密 **Server AK** | Server 授权 PNG；Web/Mobile 共用 Gallery DataSource，Desktop 走受限 Agent IPC | 已交付；可继续展示 |
| 百度 JSAPI 4.0 | **Browser AK** 独立加密，仅 Server 内部解封，不返回普通用户 | 同一 Gallery、Server 媒体范围查询、真实 GPS、Viewer；另需只允许百度资源的 Server 同源代理和安全 Electron 运行环境 | **未启用**；#1607 是独立 desired-config 的前置候选 |

PR #1607 曾在 Server-AK-only 临时约束下关闭，已有准确的完整 CI 通过证明；依据最新决定应优先核查并恢复，避免重复分支。它只保存 **desired_enabled**、密钥版本/修订号、加密密文和不含敏感数据的审计记录，**runtime_enabled 永远 false**。不能把“保存配置”解释为“JSAPI 已启用或生效”。

## 强制 A3b2 代理安全门禁（未完成）

1. **鉴权和撤销**：原 API 使用 Owner Bearer；JSAPI `<script>`、瓦片、字体无法附带该 Header。Server 只有在原 JWT 登录/用户有效且服务已审核的情况下才可签发**地图专用短 TTL**、HttpOnly、Secure、SameSite、Path 限定的独立会话；每个地图资源请求重新验证撤销状态与配额。严禁从 `?token=`、Referer、User-Agent、自报 owner 获权；防 CSRF 与登出后仍可使用。
2. **绝对固定上游资源**：在授权 Browser AK 的测试环境收集实际 JSAPI 4.0 loader、JS、瓦片、WASM、样式等完整依赖，逐项制定固定百度 HTTPS host、path、method、query 参数、请求头、Content-Type 和响应大小/超时限制。代理绝不允许任意 URL、未知域、DNS rebinding、目录遍历、重定向、Host/Cookie 注入或浏览器 `ak` 参数；没有验证过的子资源必须 fail closed。**不得直接采用官方通配 Nginx proxy 示例**。
3. **严格无密钥泄漏**：真实网络逐请求、原始响应字节和浏览器 DevTools HAR 检查，不允许 AK 出现在 JS/CSS/JSON/响应 body、Location、browser URL、source map、日志、分析、Electron preload、Service Worker 存储或离线缓存。若必要的第三方资源在响应里回显 AK，禁用该资源和 JSAPI 整体激活，不能靠前端遮盖。Server upstream 注入 `BMAP_PROXY_URL` 仅在白名单匹配时合法。
4. **配额/隔离**：每 Owner、全局且跨副本的限流，超时、并发、流量/字节数、异常域名防护和独立 AK 使用观测；不记录完整用户 GPS。地图交互视窗变化即取消短网络请求，到 Go `Context.Done()`，不取消持久上传/下载/同步。
5. **共享组件与真实地理数据**：同一 Web/Mobile Gallery DataSource、VirtualCollection/Grid/Timeline/Viewer、Server authorized Range。照片坐标来自经过有效性判定的原件 GPS，网格中心只是区域代表点，不能冒充照片坐标。Baidu 坐标系、隐私转发和用户分享策略要有显式合同。地图 Marker/Cluster 仅消费 Server 有界 Owner 数据，不拉取 100k 全量到 DOM。
6. **跨客户端安全**：Desktop 同一 MUI 组件/媒体后端但 Electron sandbox、contextIsolation、受控 Agent/Main IPC、CSP 必须确保第三方百度 JS 无 Node/文件/设备根路径/账号令牌访问权；PWA 禁止缓存任何地图授权、脚本私有回复或 GPS 私有内容。iOS 27 Safari、Android、Desktop 实机 WebGL/手势/深浅色/无障碍/性能需要独立验收。

## 下一步严格顺序和状态

- **A3a（本 PR）**：安全许可评审与规范；合入前必须有本提交的完整 CI Final Gate。
- **A3b1（#1607）**：恢复已测试的浏览器 AK 独立加密 desired-config、管理员乐观锁、加密/越权单元与 Postgres 集成测试；保持动态 Runtime 禁用。
- **A3b2**：在合法授权 Browser AK、官方实际完整子资源白名单、泄漏证明前提下实现同源会话/代理，未满足条件持续 NO-GO。
- **A3b3**：Web/Mobile Web/Desktop 共用平移/缩放、Marker、区域聚合、范围照片墙和 Viewer；百度唯一 Provider。Static Map 作为同供应商的已授权可用模式，不能假称 JSAPI 连续交互。
- **A4、B1–B3、C1**：Owner 有界 Nearby Range、语义地区、准确旅程、定位编辑/隐私和 iOS 27 真机像素/交互测试另行开发。

**不改变 xDrive 全屏 App Frame、52px 全局栏、Web/Desktop 共享后端、Web/Mobile Web 功能等价。没有真实授权或未达到安全门禁前，不得宣称 JSAPI 已可用，也不得用 OSM、Google、SVG 等另一地图源降级。**


## A3b2a · 浏览器 HAR 泄漏审计门禁（2026-10-13）

本步骤仅提供**本地、离线、只输出固定错误码的审计程序**，不是 JSAPI 生产代理，也不是百度真实账号的法律授权证明。A3b1 的 `runtime_enabled=false` 保持不变，不增加任何 Server 路由、JSAPI loader 或第三方动态脚本。唯一 Provider 仍为百度，静态地图 Server AK 功能不变。

- 审计实现：`scripts/ci/baidu-jsapi4-browser-har-audit.cjs`；可执行合成正反例：`desktop/tests/baidu-jsapi4-browser-har-audit.cjs`，自动纳入 Desktop `node --test tests/*.cjs`。
- **拟议尚未上线的协议**：已登录客户端通过 Server Bearer 申请 `POST /api/v1/media/places/baidu-jsapi/session`；Server 校验当前用户、授权、修订和撤销状态后，发给地图资源专用、最多 300 秒的 `XD_BMAP_SESSION` HttpOnly + Secure + SameSite + Path=/_BMapService/ Cookie。代理载入 `/_BMapService/api?v=4.0`，后续子资源同源，Browser AK 仅由 Server 注入百度上游。此处的路径/Cookie 只是未来必须满足的验收合同，**端点和 Cookie 均尚未实现，不能调用**。
- **离线执行**：先在隔离环境从 Web、Mobile Web、Desktop 各自导出包含响应体的完整地图启动+平移/缩放 HAR；在本地安全终端由秘密管理器注入 `XD_BAIDU_JSAPI_AK_CANARY`（仅审计进程环境，勿出现在命令行、仓库、CI 产物或聊天记录），运行 `node scripts/ci/baidu-jsapi4-browser-har-audit.cjs /secure/path/session.har https://your-actual-origin.example web`。第三参数依次可为 `web`、`mobile-web`、`desktop`，每平台独立运行；退出码 0 才表示**该份完整采样 HAR 的浏览器侧检查通过**，并非 JSAPI 已上线。
- 必须拒绝：无真实密钥比对标记、浏览器 URL/Header/脚本 Body 的 AK 泄露、`ak` 查询参数、任意外域直连、重定向、Service Worker/浏览器缓存、HTTP 非成功、缺失 `no-store` / `nosniff` / `no-referrer`、Bearer 出现在代理资源请求、无地图专用 Cookie、没有 loader+子资源、无响应文本 body 或过长会话 TTL。仅输出固定码/汇总计数，不回显 URL、路径、Cookie、密钥或原始响应。
- **隐私**：真实 HAR 可能含 GPS、访问令牌、Cookie 和源图请求。严禁上传至 GitHub、提交仓库、生成 CI 附件或分享给第三方；采用按需访问和受控销毁。只有无密钥合成 fixture 可入库。

**明确未通过的生产门禁**：真实百度 Browser 类型 AK 及账户合法许可、自托管/Electron/商用边界、官方实际完整 loader/JS/WASM/瓦片/字体/样式请求清单、严格逐 host/path/method/query 白名单、Server 注入/上游返回原始字节无 AK 泄漏、跨副本配额与会话撤销、反向代理/CSP/Electron 沙盒、真实 iOS 27 Safari/PWA、Android、Desktop 验收。HAR 仅能证明采集的浏览器侧样本，不可证明未被采集的服务端上游或移动系统行为；模拟测试通过时 **A3b2/b3 仍为 NO-GO**。


## A3b2b · 只可内部调用的 Loader 请求及响应安全合同（2026-10-13）

下一步交付 \`internal/baidumapjsapi/loader_guard.go\`（独立 Go 标准库包），不增加公开 Router、授权 Session、Loader 脚本或百度上游网络请求；\`A3b1.runtime_enabled=false\` 维持原状。这是完整 JSAPI 代理的**构件**，不是可以上线的反向代理。

- **固定上游**：当前仅承认对 \`GET /_BMapService/api?v=4.0\` 的精确匹配，才能在**可信配置的 HTTPS origin** 基础上形成 \`BMAP_PROXY_URL\`。服务端内部上游固定 \`https://api.map.baidu.com/api\`，按 JSAPI 4.0 类型注入单独的加密 Browser AK；从不采用浏览器提交的 Host、X-Forwarded-Host、上游 URL、query AK 或其它泛化参数。所有尚未通过真实授权账号观测的瓦片/样式/WASM/字体等子资源**默认拒绝**，没有通配路径或通配主机。
- **五项独立放行条件**：合法许可、完整真实子资源清单、原始字节密钥泄漏实证、可撤销 Owner 地图会话及跨副本配额、Web/Mobile Web/Desktop 隔离证据。目前缺证据，构件无生产路由，任何保存的 desired-config 都不触发调用。测试可以人为构造 \`ReleaseGates{...}\` 校验纯函数，绝不代表真实门禁已满足。真实门禁必须由可信、可审计、不可伪造的 Server 证据落实。
- **保守上游检查**：限制 2 MiB JavaScript 响应体、严格 MIME、HTTP 200、拒绝重定向和压缩编码，常见原文/URL/base64 AK 在响应字节中一旦出现即拒绝，不透明的客户端可见错误；回送标头采用固定白名单 \`no-store/nosniff/no-referrer/CORP\`，上游 Set-Cookie、Location、ETag、缓存和 CORS 不透传。安全 HTTP Client 不读环境代理、不跟跳转，5s 超时并支持调用者的 \`context.Context\` 取消。
- **测试**：\`GO111MODULE=off go test -count=1 ./internal/baidumapjsapi\`，本地 Go 标准库 7 个测试组验证恶意资源路径、URL 编码/额外 AK、假 origin、缺失五项门禁、服务端请求不带 Cookie/Bearer、无密钥响应、上游 MIME/大小/重定向/压缩拒绝、标头白名单、真实 httptest 跳转不跟随及 ctx 取消。完整仓库 Go/Web/Desktop CI 与实际百度授权/设备验收必须独立区分。

**未具备上线条件**：本阶段并未取得合法百度账户许可或实际子资源清单，JavaScript 任意编码可能绕开常见密钥模式，因此还需要真实 upstream 原始字节及浏览器 HAR 的端到端安全审计；还欠地图专用 Session 与撤销、跨副本配额、真实上游资源白名单、Caddy/Electron 路由隔离、共享 UI/聚合/附近照片。不得在生产从任何客户端或管理开关调用 \`NewLoaderRequest\`，不得把此构件的单元测试当作 JSAPI4 可用证明。


## A3b2c1 · 带撤销版本的短期地图专用 Cookie 原语（2026-10-13）

承接 A3b2b（固定百度 Loader 请求/响应安全组件），新增 **零公开路由、零实际百度网络请求**的 `internal/baidumapjsapi/session.go`，与 5 组会话加密和 HTTP 预检测试。通过随机 nonce 的 AES-256-GCM、专有密码域、固定格式和 120 秒有效期创建 `XD_BMAP_SESSION` host-only Cookie（`HttpOnly; Secure; SameSite=Strict; Path=/_BMapService/`）；只包含加密过的 Owner ID、SessionVersion、JSAPI 配置修订、撤销 epoch、签发/截止时间及随机数；绝不包含 AK 或 Bearer。

**签发和每资源验证都必须读可信 Server/DB 当前状态**，并验证用户活跃、地图运行时确有完整安全及合法许可授权、Owner ID/session version/配置 revision/撤销 epoch 一致，否则拒绝。缺失/0 epoch 不允许签发。浏览器只能在精确受控 HTTPS origin 下通过同源 `POST /api/v1/media/places/baidu-jsapi/session` 请求短会话（这一 HTTP 端点尚未实现），资源 GET 禁止 Bearer、跨站请求以及客户端 AK/token/url 参数。资源方法与查询检查不取代上阶段**逐资源白名单**。Cookie 清除是浏览器端清除动作，不能代替 Server 提升持久撤销 epoch。

本阶段仍然 **NO-GO**：未创建数据库撤销状态、登录/登出接口联动、地图授权签发路由、真实动态 JSAPI、跨副本限流或任何客户端 JS Loader。用户要求的 Viewer/标记与聚合、A4 附近照片及 B/C 系列另行实现。单测能核查加密、过期、密钥不一致、篡改、会话版本/配置修订/epoch 变化、同源 POST 和带 AK 的跨站 GET 均被拒绝；**单测 12/12（含 A3b2b 的 7）不能冒充实际授权或设备验收**。

生产中必须先完成 A3b2c2 的持久会话撤销、Owner 授权、真实启用门禁和完整 Server/Agent/Browser 多平台隔离，再实施 A3b2d 代理/动态客户端。


## A3b2c2a · 持久撤销版本及 Access Token 签发截止线（2026-10-13）

本小阶段在 A3b2c1 加密 Cookie 合入之后，将未来多 Server 副本共同依赖的撤销状态置于 PostgreSQL：新增 `xd_baidu_jsapi_map_epochs` 每 Owner 一行、非零 `epoch`、可为空的 `revoked_after`，删除 Owner 时级联清理。缺行/0 版本一律拒绝，不把客户端 Cookie 或浏览器传入的用户/版本当作授权依据。`ensureBaiduMapEpochTx` 对真实有效账号初始化版本 1，冲突时保留此前状态；`advanceBaiduMapEpochTx` 使用单条原子 PostgreSQL `INSERT ON CONFLICT ... RETURNING`，以 `GREATEST` 避免时钟回拨导致撤销截止线倒退。所有操作使用请求 Context/DB 事务，回滚不误提升版本。

额外的纯 Go `AccessAfterRevocation` 对未来**已验签且仍有效的 Access JWT** 的 `iat` 与数据库撤销截止线做严格比较：旧 token、同秒签发 token、未来 token 不得重新申请地图 Session；空截止线表示此前未发生显式撤销，仍必须由 Server 执行正常账号/JWT 鉴权以及真实 JSAPI Runtime 放行证据。此逻辑不是 Cookie 本身的授权。

**限制必须明确**：当前尚未把原 `/auth/logout`、账户安全操作与这些 DB helpers 连线；也没有地图 Session HTTP 端点、正式百度 Browser AK 代理、子资源白名单或跨副本配额。保存 Browser AK 不会开放 JSAPI，`runtime_enabled=false` 不变。只有下一阶段 A3b2c2b 通过真实 refresh token 所属用户事务性推进 epoch、从受信 JWT 解析 `iat` 并且每次资源请求读取最新用户/配置/epoch 后，才可把“退出即撤销地图 Session”称为已实现。完整许可、Server 原始字节 + HAR 防泄漏、CSP/Electron/移动真机证据仍为后续上线强制门禁。


## A3b2c2b · Owner 退出后不能通过旧 JWT 重建地图授权（2026-10-13）

在已合入 A3b2c2a 的 PostgreSQL `xd_baidu_jsapi_map_epochs` 之上，将现有 `/auth/logout` 与地图撤销事务结合。只有服务器按 SHA256 找到 **有效且尚未撤销** 的 Refresh Token 并锁行时，才把它置为 revoked，同时提升其真实 Owner 的地图 epoch、更新时间截止线、写入无 AK/JWT/Refresh Token 的脱敏审计。审计或 DB 更新失败则整笔事务回滚，并返回不可误报成功的服务不可用状态。缺失、已过期、重复提交或伪造的 Refresh Token 保持幂等 204，但**不触发其他用户撤销**。所有正常退出都向客户端写入 host-only、HttpOnly、Secure、SameSite=Strict、Path=/_BMapService/ 的清除 Cookie 头。

`internal/auth/map_access.go` 采用与常规登录独立的严格 JWT 校验，检查 HS256 签名、精确 Access Token 类型、非零 SessionVersion、精确 Subject、`iat` 和 `exp`。`verifiedMapBootstrapIdentity` 额外查询当前 DB 用户（非禁用、无需强制改密码）、会话版本和地图 epoch，并比较 **签发时间严格晚于撤销截止线**，从而阻止退出后仍未过期的旧 Access JWT 重新申请地图授权。普通 Access JWT 可能在自身有效期内继续适用于原有普通 API，地图预检则必须拒绝。精确时间比较可能导致撤销同一秒新签发的 JWT 也被拒绝，这是保守的安全结果。

安全门禁仍为 **NO-GO**：无实际 Session 签发 HTTP 路由、无 JSAPI Loader/瓦片公开代理、无真实百度 Browser AK 请求；`runtime_enabled=false` 不变。管理员强制撤销、账户禁用和密钥轮换已有各自其他认证/配置保护，但后续仍需将地图 epoch/audit 与其准确联动及逐资源重新鉴权。必须完成法律许可、全量资源 allowlist、AK 原始上游响应+浏览器 HAR 防泄漏、跨副本资源配额、Caddy HTTPS、Electron 沙盒与 iOS 27/Android/桌面真机验收，才可以声称动态地图可用。

## A3b2c2c1 · Cookie 认证身份与 Server 逐请求数据校验（2026-10-13）

地图 JS/瓦片 GET 无法使用常规 Bearer，因此先对仅供地图资源的 120 秒 Cookie 进行 AEAD 认证，严禁从 URL/Host/Header 推断 Owner。内部 `InspectMapSessionOwner` 只返回经密码认证的 OwnerID，**不是权限**。`baiduJSAPIResourceSnapshot` 继续逐请求读取用户活跃状态、session version、JSAPI Browser AK 的 desired-config revision 和持久 epoch。当前仅允许 `/_BMapService/api?v=4.0` 的严格请求外形，拒绝重复 Cookie、任意来源、客户端 AK 与未登记的子资源。所有结果 `RuntimeAuthorized=false`，当前并不存在动态 JSAPI 代理或 JSAPI Map 会话签发 HTTP 端点。

独立 PostgreSQL 隔离测试会模拟已签发 Cookie，在配置轮换、关闭、Epoch 递增、账号禁用后证明旧 Cookie 不能通过新的状态；测试中人为将授权 Boolean 设为 true 只是密码学断言，绝非真实授权。完整百度许可、子资源清单/实时上游响应字节与 HAR 泄露检测、跨实例限额、CSP/Electron 沙盒及 iOS 27/Android/Desktop 物理验收仍为严格 NO-GO 门禁。


## A3b2c2c2 · Account-security mutations and map-only revocation (2026-10-13)

Account disabled transition, administrator password reset, administrator session revoke and authenticated password change must atomically bump only the affected Owner's durable map epoch with their existing User/RefreshToken changes and redacted audit. Audit includes only a non-secret epoch marker; failure to persist revocation rolls back the entire mutation. Re-enabling the same account never rolls the epoch backward; another Owner's active map Cookie must not be invalidated. For Browser AK updates, the existing atomic encrypted-config revision increment plus audit and #1649's per-resource live revision check already invalidates all old map Cookies, with no unbounded mass UPDATE of owner epochs. Direct DB out-of-band changes remain unsupported bypasses that need operator policy; account-security UI must use audited Server routes.

**Still fail closed:** A3b2c2c2 does not mint a map Cookie or create public `/_BMapService/` routes. It does not establish Baidu licences, observed full JSAPI4 upstream child requests, real AK non-disclosure, multi-replica quota, native sandbox isolation, or Apple Photos iOS 27 1:1 visual equivalence. Static Baidu Server-AK rendering continues; Browser-type AK remains encrypted and dynamic `runtime_enabled=false`.


## A3b2d1 · fixed-window, fail-closed PostgreSQL Loader quota (2026-10-13)

The official Baidu JSAPI 4.0 proxy documentation describes `serviceHost` and `BMAP_PROXY_URL`, but its wildcard Nginx sample is **not** a safe multitenant xDrive runtime policy. A3b2d1 introduces only persistent, atomic, server-private admission infrastructure: one quota row per positive trusted Owner ID and one scope 0 for the entire Server fleet, with a single DB-clock minute used for both. The one transaction serializes the global row before the owner row, so a declined owner charge rolls back the fleet charge. Default immutable bounds are 12 Loader GETs/owner/minute, 240/fleet/minute, each charged the **maximum** 2MiB Loader response; cancellation does not refund the conservative estimate. The resource path still has to pass the earlier exact `GET /_BMapService/api?v=4.0` guard. A successful quota test, synthetic ReleaseGates or a saved Browser AK never authorizes a request by itself.

Test real PostgreSQL parallel writes across separate connections, owner/fleet limit enforcement, rollback, minute rollover/backwards rejection, unknown DB/table, startup migration and no secret/GPS accounting. Counters have no AK, JWT, Cookie, URL or coordinates. Later fleet admission must also bound in-flight concurrency, actual response bytes and all legally observed child resources; the Loader-only budget must never be reused as a universal tile/WASM/font budget. Proven licensed upstream child inventory and raw browser HAR, credential masking, revocable Owner session, Caddy/Electron/PWA/iOS/Android isolation and actual shared Gallery are still independently blocked. No active JSAPI route, host wildcard, AK fetch or change from `runtime_enabled=false` is allowed in this phase.


## A3b2d2a · Cross-replica Loader in-flight capacity (2026-10-15)

This bounded sub-phase adds **Server-internal, non-routable** PostgreSQL concurrency leases for the future Baidu JSAPI4 Loader only. It does not enable the JSAPI4 runtime.

- Persistent table: xd_baidu_jsapi_loader_flights, with only an opaque SHA-256 lease digest, trusted owner ID, database-clock creation and expiry. No AK, bearer JWT, cookie, GPS, full URL, or response bytes.
- Fixed maximum: 2 in-flight Loader requests per owner and 16 fleet-wide. One immutable PostgreSQL transaction-level advisory lock serializes expired-row cleanup, global/owner counts and insertion across separate Server connections. Missing DB/table, invalid Owner, bad context or exhausted caps fail closed.
- A 32-byte cryptographically random nonce produces the opaque lease; releasing requires the same digest and owner, is idempotent, and cannot release another owner's lease. A process crash leaves an expiring lease; later admission prunes expiry using DB time.
- **Future proxy contract:** acquire only AFTER revalidating the owner map-only session and runtime release evidence; retain until bounded upstream fetch AND full downstream response finish, use a separate bounded cleanup context after request cancellation, and enforce a total request lifetime STRICTLY BELOW the 15-second lease TTL. A TTL is not a cancellation signal and an expired lease is not proof the old network request stopped. Preserve Go Context cancellation and never cancel durable background media tasks.
- The already-merged A3b2d1 minute/byte reservation remains independent; this phase does not meter actual outbound bytes, does not approve tile/JS/WASM/font paths, and does not expose POST Session, /_BMapService, browser AK or an active JSAPI client. Static Baidu Server-AK map remains unchanged. Web, Mobile Web and Desktop still share one Gallery/VirtualCollection/Viewer.
- Tests: input rejection, migrations, two independent PostgreSQL connections, owner/fleet limits, 24 concurrent lease attempts, idempotent/stale/wrong-owner release, DB expiry cleanup and missing-table denial. No claim of physical iOS/Android/Electron acceptance.

**Still NO-GO:** obtain actual licence and accepted self-hosted/PWA/Electron scope, complete observed upstream child-resource allowlist, trusted signed runtime release evidence, raw upstream + private browser HAR AK-leak proof, real per-resource bytes and total-life fencing, Caddy HTTPS/CSP/Electron isolation, and native iOS27/Android/Desktop evidence. Do not infer any of these from fixtures or a green CI. Next A3b2d2b must close the real legal/inventory/leak and release-authorization gates; then A3b3 shared pan/zoom/Marker/Cluster, A4, B1-B3 and C1 in order.


## A3b2d2b1 · Private upstream-HAR evidence gate (2026-10-15)

**Status: offline tooling candidate; NOT a runtime release, licence, full resource inventory or provider account proof.** This step adds `scripts/ci/baidu-jsapi4-upstream-har-audit.cjs` and synthetic Desktop tests. It complements (does not replace) the existing **browser** HAR audit and A3b2d1/d2a PostgreSQL rate/flight controls.

- Verify a private **Server→Baidu** HAR in an operator-controlled, non-networked environment. Supply the Browser-type AK exclusively as `XD_BAIDU_JSAPI_AK_CANARY` from a secret manager in the local environment, never a command argument, URL pasted into chat, source file, GitHub Actions artifact, or committed fixture.
- Each platform `web`, `mobile-web`, `desktop` requires separate `load`, `pan`, `zoom` traces. Example: `node scripts/ci/baidu-jsapi4-upstream-har-audit.cjs /private/trace.har https://actual-trusted-origin.example web load`. Check official `https://api.map.baidu.com` only, GET, one **server-side injected** `ak`, fixed `BMAP_PROXY_URL`, no forwarded browser Cookie/Bearer, no normalized path escapes, unsafe MIME/status/redirect or unbounded/missing response bytes; scan common AK encodings in raw upstream body/headers. A real trace may reveal additional legitimate upstream hosts, MIME or resources; such requests must **fail review** until a separately vetted, explicit policy covers them. Never silently broaden the proxy.
- CLI emits only fixed result codes, counts, and 20-hex-character SHA-256 **candidate path/query-key fingerprints**. It outputs **no** plaintext host/path/query values, AK, Cookie, JWT or GPS; fingerprints intentionally omit all query values. `capture_valid=true` means only the available trace passed this limited audit. `release_authorized=false` is unconditional. Hashes never authorize an upstream route, nor can they prove trace completeness or real-world licence terms.
- Security caveats: a HAR export is not a guaranteed byte-complete capture of every browser/network resource; unknown encodings, encrypted transport, missing response bodies, malformed headers or out-of-band network calls may evade its evidence scope. Acquire operator-reviewed full raw upstream bytes and Browser HAR in the approved licensed environment, securely review exact host/path/method/query restrictions, document redaction/disposal, then implement an immutable Server allowlist and signed release evidence. No upstream traces or actual credentials may enter CI or GitHub.
- Official JSAPI4 proxy uses `BMAP_PROXY_URL` and `serviceHost` with a trailing slash; its general Nginx wildcard example is inappropriate for an Owner-authorized xDrive reverse proxy. JSAPI4 2026-09-30 added `ClusterLayer`, which can be evaluated at A3b3 but does not replace Server-bounded photo aggregation.

**Non-goals:** no Browser AK read/decrypt, no outgoing Baidu requests, no public `/_BMapService/` or map-session endpoint, no production runtime release gates, no third-party JS in Electron or Web, and no dynamic Map UI. `runtime_enabled=false` remains intact. Next A3b2d2b2 requires *actual* legal approval, complete authorized upstream inventory, raw+browser AK secrecy, strict per-resource allowlist, trusted runtime gating and physical mobile/Electron/Caddy checks before A3b3. Preserve iOS 27 Photos 1:1, 52px App Frame, and shared Web/Mobile Web/Desktop Range, VirtualCollection and Viewer.


## A3b2d2b2 · Paired private browser/upstream HAR reconciliation (2026-10-15)

**Only an offline audit candidate, never a production release gate.** After the merged A3b2d2b1 upstream audit (#1678), compare a sanitized-scope **browser** HAR with its separately captured **Server→Baidu** HAR using `scripts/ci/baidu-jsapi4-cross-har-audit.cjs`. It composes the two existing independent auditors, then reconciles every map GET through exact method, proxy path, sorted query names **and values**, ignoring only the single valid Server-injected `ak`. Match counts including duplicates; fail closed on unmatched, extra and direct third-party traffic.

- Operator-only usage: `node scripts/ci/baidu-jsapi4-cross-har-audit.cjs /private/browser.har /private/upstream.har https://your-actual-origin.example web load`; run every `web/mobile-web/desktop` × `load/pan/zoom` combination independently. The capture must include the login-derived map-session bootstrap and Loader as required by the browser auditor, even for pan/zoom, plus all relevant Server upstream requests. Two files may contain sensitive tokens, AKs, Cookies and GPS; never commit, upload, paste, attach or publish either file. Only operator-local secret-manager environment may set `XD_BAIDU_JSAPI_AK_CANARY`.
- Output has **only** fixed diagnostic codes and two request counts; no matched raw URL/query string, GPS, Cookie, Browser AK, request ID or body. `release_authorized=false` is hard-coded, regardless of match or source audit outcomes. `capture_valid=true` means only the captured map-only trace is internally consistent, not that the capture is complete, the account is licensed, the dependency graph has been reviewed, or the JSAPI is safe to activate.
- Evidence must still include actual independently approved self-hosted/PWA/Electron/commercial licence, a complete real 4.0 network inventory, strict server-owned resource policy, raw AK leak checks, deployable authenticated/revocable map session, bounded byte/concurrency/time, HTTPS CSP/Electron isolation and separate iOS 27/Android/Desktop native acceptance. All unobserved child hosts remain denied; never turn trace-derived candidate paths or fingerprints into automatic allow rules.
- No public JSAPI route, credential read/decrypt, Server upstream network access, additional map Provider, or Renderer/virtualizer/Viewer change in this phase. Existing encrypted Server Static AK and Browser JSAPI AK remain independent; dynamic `runtime_enabled=false` continues. Next A3b2d2b3 is evidence-backed immutable child-resource policy + trusted release admission (still NO-GO without real provider evidence); A3b3 is then continuous shared map interaction, followed by A4, B1–B3 and C1.

- Bootstrap negative evidence: the map-only session signing call in the browser trace must be an exact no-query POST. A GET or URL-supplied token makes the HAR pair invalid; the live Server authorization gate is independently mandatory.


## A3b2d2b3a · Code-owned JSAPI4 resource envelope review and hard NO-GO (2026-10-15)

**Implementation candidate only; JSAPI4 dynamic production remains OFF.** After A3b2d2b2 #1681 completed exact-head CI/Final Gate and linear merge, add internal/baidumapjsapi/resource_policy.go with unit tests. This adds no public route, outbound connection, Browser AK decrypt, Session cookie minting, provider fallback, or Gallery renderer.

- The ONLY currently recognized path is canonical origin-form GET /_BMapService/api?v=4.0. It delegates to existing ValidateLoaderRoute, rejects absolute/proxy-form URLs, noncanonical RawPath, encoded traversal/alias, fragments, extra/duplicated/malformed parameters, Bearer/Proxy-Authorization, wrong methods and cancelled requests. A positive resource **shape review is not authorization**.
- Unknown tile, script, font, image and WASM children still fail closed. Reviewed child inventory revision is empty and reviewed child count is zero in source code; neither may be populated from saved admin settings, a browser request, fingerprints or unaudited HAR samples.
- JSAPI4ProductionResourceGate is private, has NO production caller and returns ErrGateClosed **unconditionally**, including when all five synthetic ReleaseGates booleans are true. Even a future code-reviewed inventory alone cannot open the gate: real legal entitlement, signed and auditable operator release authority, latest DB Owner/session/revocation/config proof, bounded fleet request/byte/time controls, raw upstream+browser AK safety and Electron/Caddy/mobile isolation must be separately implemented and reverified.
- Isolated Go stdlib tests cover Loader shape, denied arbitrary children, adversarial URL encoding, query/callback/AK injection, forbidden Bearer/absolute URL, canceled context and simulated all-true release flags. The isolated tests are not equivalent to repository-wide CI, actual Baidu traffic, licence evidence or physical Web/Mobile Web/Desktop iOS27 acceptance.

**Next A3b2d2b3b:** after obtaining actual licensed full JSAPI4 resource inventory, design explicit per-child source-reviewed host/path/query/MIME/bytes rules plus separately signed, revocable Server release state. Never synthesize an allowlist from HAR output. Only then can A3b3 use shared Gallery's Server Range, virtual photo wall, Viewer and bounded Marker/Cluster with Baidu as the sole Provider. Preserve 52px full-screen App Frame and iOS27 Photos 1:1 baseline.


## A3b2d2b3b1 · 受信发布证明签名基础（2026-10-15）

本阶段在 A3b2d2b3a 固定资源策略 #1688 已通过完整 CI/Final Gate 并线性合入后，增加独立的 Go Ed25519 **证明封套验证原语**，不增加任何公开地图 Route、百度网络请求、AK 读取、管理员生效操作或 Renderer 插件。**生产动态 JSAPI 仍为 NO-GO。**

- 采用版本固定的二进制 Canonical Encoding 和专用域分隔符，签名绑定 Server Build SHA-256、经代码审查的资源策略 SHA-256、可信 HTTPS Origin SHA-256、Browser AK 配置 Revision、Server Release Epoch，及 Web/Mobile Web/Desktop 全平台覆盖位；其中不存储真实 AK、Cookie、JWT、GPS、图片或地址。每项 Expected 值必须由 Server 自己的当前可信状态提供，不能从浏览器查询、用户可编辑设置或未经审查的 HAR 注入。
- 时间约束：签发后最多有效 5 分钟、签发前不能使用、截止秒立即拒绝，发布版本/策略/Origin/配置/撤销版本变化及签名篡改都会拒绝；校验使用 Go 标准库 Ed25519。
- 验证通过仅表示**在测试信任根下对该固定字节内容的密码学签名有效**；并非真实百度许可、完整子资源清单、真实设备隔离或原始响应无 AK 泄漏的证据。源代码里未配置受批准的生产验证公钥，生产包装器始终返回 `ErrGateClosed`，即使测试中真实 Ed25519 签名通过也不授权启用。
- 独立 Go 1.23 / race / vet 的 4 组测试验证正确签名、版本/策略/Origin/配置/撤销版本变化、缺失信任根、异域签名、未来/过期/超长有效期、平台覆盖不全等。需要 GitHub Go 1.25/PostgreSQL/Web/Desktop/Windows 完整 CI 和 Final Gate 才能合入。
- 下一阶段 A3b2d2b3b2 必须在实际取得百度自托管/PWA/Electron/商用许可及真实 Loader/瓦片等全量资源清单后，分别验证独立的原始上游和浏览器 HAR、防泄漏、不可伪造审计证据、受审查的固定资源策略和生产签名根。仍须每次地图请求重新校验 Owner、Session、撤销版本、额度和 CSP/Electron 隔离；未完成不能设置 `runtime_enabled=true`。之后才继续 A3b3 共享动态地图、A4 附近照片、B1～B3 和 C1 iOS27 逐项真机验收。


## A3b2d2b3b2a · JSAPI4 九场景私有 HAR 证据矩阵（2026-10-15）

**进度：离线、只读证据覆盖工具；并非许可证审核、真实上游资源白名单或生产授权。** 在 #1693 Ed25519 发布证明经过完整 CI/Final Gate、线性合入并清理后，新建 `scripts/ci/baidu-jsapi4-evidence-matrix.cjs`，由现有 Browser HAR、Server→Baidu Upstream HAR 和 Cross-HAR 三层审计组合运行。任何审计通过都不能设置 JSAPI 的 `runtime_enabled`。

- **九场景输入**：`web`、`mobile-web`、`desktop` 每个平台必须分别采集 `load`、`pan`、`zoom`；每个场景各有一份浏览器 HAR、一份 Server 上游 HAR，总计 9 对、18 份私有记录。平台名称只是操作者输入的标签，**不能证明实际物理设备、iOS 27 或安装态 PWA**。
- 操作者在私有目录创建 `manifest.json`，其格式是 `{"version":1,"captures":[{"client":"web","scenario":"load","browser":"web-load-browser.har","upstream":"web-load-upstream.har"}, ...]}`，必须严格有全部九个唯一的 client/scenario 组合。捕获文件必须与 manifest 位于同一目录，采用安全 basename、不可为软链接；拒绝路径穿越、缺文件、空文件、超大文件、文件名复用、同内容重复捕获和未通过的单对审计。浏览器 HAR 最大 20 MiB，上游最大 32 MiB，manifest 最大 32 KiB；只读取本地文件，无网络请求或自动上传。
- 在可控离线环境中通过密码管理器仅向进程环境注入 `XD_BAIDU_JSAPI_AK_CANARY`，执行 `node scripts/ci/baidu-jsapi4-evidence-matrix.cjs /private/manifest.json https://your-trusted-origin.example`。**不得**把真实 AK、JWT、Cookie、完整 URL、GPS、原始 HAR、目录内容或私有 manifest 提交到代码库、CI 制品或聊天记录。
- 只输出固定错误码、要求的对数、已检查/拒绝对数；`release_authorized=false` 为不变常量。输入的 `capture_valid=true` 仅说明**这些文件通过有限规则**；没有全程网络完整性证明、实机证明、账号许可证明或签名可信来源。不要根据样本、匿名摘要或 HAR 自动扩展百度资源 allowlist。
- 合成测试覆盖九格齐全性、缺格/重复、跨格文件复用/重复原始字节、路径穿越、软链接、超限、错误代理结果、错误 Origin/密钥及输出脱敏；完整仓库 CI 额外使用先前三个真正的审计模块运行合成九对端到端测试。
- **仍为 NO-GO**：需要实际百度自托管/PWA/Electron/商用授权、真实 Loader/瓦片/JS/WASM/字体全量清单和原始响应泄漏证明；Server Owner 会话逐请求授权、生产签名信任根、受审查的固定上游资源规则、Caddy/CSP/Electron 安全隔离，以及 iOS27/Android/Desktop 真机验收。三端继续共用 Gallery Server API、Range、VirtualCollection、Viewer，保留 iOS 27「照片」1:1 基准、52px 全屏 App Frame、百度唯一 Provider 和 Static Server AK / JSAPI Browser AK 的独立配置。

**下一项 A3b2d2b3b2b**：在获得真实被授权的私有网络捕获及许可证明后，对每条 Host/Path/Query/MIME/大小限制执行人工审核和代码审查；缺证据时不开放真实 JSAPI Runtime。之后才实施 A3b3、A4、B1～B3 和 C1。

## A3b2d2b3b2b · OFFLINE child-resource candidate policy checker (2026-10-15)

The new pure-Go `ValidateJSAPI4ChildCandidate` and `MatchJSAPI4ChildCandidate` verify **syntactic envelopes only** for a prospective, human-reviewed resource. Source-owned single `api.map.baidu.com` host, exact GET path under `/_BMapService/`, 2 MiB maximum per response, fixed allowed MIME family, at most 8 explicit query fields with literal or bounded unsigned integer values; no wildcard, arbitrary URL, redirect, browser AK/token/callback, duplicate/extra/encoded query or Bearer. These checks do not send network requests or read keys. No real child host/path has been authorized or added to the production reviewed inventory; fixture tile paths are fictional. Existing `JSAPI4ProductionResourceGate` stays unconditionally closed, with no public routes or JSAPI4 runtime.

**Human review protocol (not satisfied by synthetic CI):** obtain account-specific licence and independently identify only documented/authorized resources; review raw request/response and browser HAR privately on all nine platform/scenario cells, including provider-host ownership, MIME, per-resource time/bytes, AK secrecy, child CSP and Electron sandbox; then require a separately approved immutable source policy, trusted pinned release key and fresh server-side Owner/revocation/quota state. Operator HAR, AK and GPS remain private and may not be uploaded or logged. A passing candidate checker, mock nine-pair audit or self-signed operator fixture cannot activate any route, remove licence requirements or substitute for native iOS27/Android/Desktop acceptance.


## 2026-10-16 JSAPI4 官方 ClusterLayer 与 WGS84→BD-09 地图标记评审（仅预备，不上线）

- 官方 2026/09/30 JSAPI4 更新将 ClusterLayer 内置： https://lbs.baidu.com/docs/jsapi?title=jsapi4%2Fchangelog ；类参考 https://lbs.baidu.com/jsapi/refdoc/v4/classes/BMap.ClusterLayer.html 。ClusterLayer.setData 支持 FeatureCollection；native ClusterLayer 的点密度聚合不等于 Server PhotoAsset 照片数量，不能给单个簇贴虚假全图总数。xDrive Server 已有 0.01 度网格、该范围真实不同照片 total_photo_count，以及来自一个照片的 WGS84 sample 坐标。仅这些真实样本可用于标记；数学网格中心不能用于图片地图标点。
- 官方坐标系 https://lbs.baidu.com/docs/jsapi?title=jsapi4%2Fguide%2Fconcept%2Fcoord 明确 BD-09 默认及 Convertor.translate(points,1,5,callback) 的官方转换。xDrive 新的 ui/shared/src/media-gallery-baidu-jsapi4-markers.ts 仅提供纯 WGS84 完整有界视窗验证和模拟注入的 Convertor 到 BD-09 GeoJSON 的严格合同（<=100格、<=10一批、3s 失联超时、AbortSignal、无原始坐标/AK 错误回显）。缺字段、非全量结果和转换失败一律不交给未来 ClusterLayer；WGS84、BD-09 不可互相混称，GPS (0,0) 必须保留。
- 本阶段没有真实百度 JSAPI 加载、Browser AK 解密、子资源白名单启用、Cookie 签发、线上 ClusterLayer、地图 Marker/Cluster 或照片 Range 新路由；纯单测只验证合成结果，不能证明真实服务坐标转换/许可和性能。仍必须取得实际百度授权、完整审核 child-resource Host/Path/Query/bytes、AK upstream/browser HAR 泄漏零证据、受信签名发布门禁、Server Owner/session/epoch/quotas、Caddy/CSP/Electron 沙箱、iOS27/Android/Desktop 实机，再将共享地图动态层接入 Web/Mobile Web/Desktop。原有 52px App Frame、iOS27 Photos 1:1 目标、Static Server AK 与加密 Browser JSAPI AK 隔离、runtime_enabled=false、百度唯一 Provider 不改变。


## 2026-10-16 原生 ClusterLayer 调用边界补充（A3b3a3b，仍 NO-GO）

- 官方定义见 https://lbs.baidu.com/jsapi/refdoc/v4/classes/BMap.ClusterLayer.html 及 https://lbs.baidu.com/jsapi/refdoc/v4/interfaces/BMap.ClusterClickValue.html：接收 GeoJSON FeatureCollection，点击事件 value.isCluster 表示聚合点，pointCount 是点数而非照片数。当前源码新增的 `ui/shared/src/media-gallery-baidu-jsapi4-layer.ts` 仅消费人工注入的 Map/ClusterLayer/Convertor interface；**无任何生产调用点**，不能用 TS 对象模拟所谓安全会话。
- 视角 start 事件同步 AbortController 取消；end 事件通知 WGS84 请求重算而不直接发送 BD-09 Map.getBounds。官方 WGS84→BD-09 FeatureCollection 与从 Server 返回的当前 ≤100 完整 Owner 地点页共同锁定可选中的 place_id/photo_count；旧页、截断、错码、点击伪造和错误转换一律不调用图库 Viewer。卸载需清理监听、图层及数据。
- 生产 JSAPI4 继续 NO-GO，百度唯一 Provider：独立 Browser AK 加密保留于 Server，Static v2 由 Server AK 调用；只有获得许可和官方被许可的完整脚本/瓦片/字体/WASM 清单、逐请求 Owner/epoch+配额校验、原始上游和浏览器 HAR 密钥非泄露、受信发布签名、Caddy/PWA/Electron 安全隔离、真机浏览器测试后才能接入实际脚本与 layer。此阶段无新 HTTP 路由，不能暴露 AK、切换 provider 或破坏 52px App Frame 与三端共用 Gallery。


## 2026-10-16 A3b3a3c Server Owner 有界视窗到原生聚合的联接（仍 NO-GO）

- `ui/shared/src/media-gallery-baidu-jsapi4-viewport.ts` 仅是**未调用**的共享协调器。它以已有认证 Gallery Web/Mobile Web REST 或 Desktop Agent IPC 的 `listPlacesViewport` 为唯一数据源，limit=100、offset=0；使用 AbortSignal/8s 上限以及代际防陈旧，收到不完整视窗绝不拉取更后页/10万点。打开地点仍委托一个既有 Server Range/Viewer。
- JSAPI 4.0 官方在中国地区默认 BD-09。原生 Map.getBounds 的数值绝不能无证据直接当成 Server 要求的 WGS84；必须等批准的 WGS84 区域映射方法，由可信 Map adapter 注入经过验证的 west/south/east/north，严禁把 map 原始第三方资源直接当成真实摄影 GPS。
- 两种 AK 仍各自仅 Server 内加密，JSAPI 生产 runtime 仍关（`runtime_enabled=false`），无新的 Session/Cookie/proxy/JSAPI Loader/地图脚本、无真机运行证明。A3 后续上线前必须经百度真实 self-host/PWA/Electron 许可、完整原始资源清单、逐 Host/Path/Query/MIME/大小/超时的不可由浏览器编辑的资源策略、浏览器+Server 上游 HAR 无密钥泄漏、不可伪造签名的 release、逐请求 Owner/epoch 和跨副本配额、Caddy CSP 和 Electron 隔离/真实 iOS27、Android、Desktop 验收。即使所有 mock 全绿，当前发版仍 **NO-GO**。


## 2026-10-16 A3b3a3d1 · 独立 Browser AK/Owner 预校验与硬 NO-GO

Go Server 内部、无任何路由的 baiduJSAPIBootstrapCandidate 从精确 same-origin、无 query/body 的 POST 读取唯一登录 Bearer，使用 existing verifiedMapBootstrapIdentity 验证真实 PostgreSQL User.SessionVersion、Signed JWT、持久地图 epoch/logout cutoff 和 Owner，然后只读取独立加密 Browser JSAPI desired_enabled、configured、revision 元数据。没有 Browser/Server AK 明文、通配 upstream URL、Cookie 签发或客户端地图代码；所有错误为固定拒绝文本。

正向验证只得到 RuntimeAuthorized=false 的内部 MapSessionState，不能 IssueMapSession；真实 Router 的 Session POST 和 JSAPI Loader GET 仍为 404 且不泄密。隔离 PostgreSQL 回归覆盖配置旋转/关闭、JWT/Owner 隔离、禁用账户、会话撤销，以及绝对或编码别名路径、跨站 Origin、异常 Authorization/请求体和取消。此阶段依旧没有真实百度许可证据、全量经许可资源路径、私有浏览器与 upstream HAR、固定生产发布签名、并发字节配额或 iOS27/Android/Desktop 实机验收；reviewed child count=0，runtime_enabled=false 且 production resource gate 始终关闭。

百度官方支持基于 serviceHost / Server-side BMAP_PROXY_URL 的同源 JSAPI4 代理（https://lbs.baidu.com/docs/jsapi?title=jsapi4%2Fguide%2Fconcepts%2Fproxy），但不允许把官方开放式 Nginx 通配示例复制为 xDrive 的多用户授权代理。用户批准工程实施不等于百度为自托管、PWA、Electron 或商业场景授予许可。保留 iOS27 Photos 1:1、xDrive 52px App Frame、百度唯一 Provider 和同一 Web/Mobile Web/Desktop Gallery Range/VirtualCollection/Viewer。


## A3b3a3d2a · 同源 Session 与 JSAPI 资源的请求歧义拒绝（2026-10-16）

在既有非路由 `SessionBootstrapSameOrigin`、`SessionResourceRequest` 之前增加严格单 Header 字段判定：不得让 `Header.Get` 把同名重复行、混合大小写别名或空值静默转换为表面安全的 Origin、Fetch Metadata 或不含凭证请求；Proxy-Authorization 同样不能进入地图代理候选。资源 Query 使用 `url.ParseQuery` 显式检查错误；路径编码别名、强制空问号和 fragment 均拒绝。单元回归涵盖这些歧义，并保留正常旧浏览器无 Fetch Metadata 时的原本兼容语义。

**明确 NO-GO**：以上只是传输预检，不是百度账号许可证据、实际 Browser AK 响应防泄漏、真实九组 HAR、完整许可子资源清单、运营者钉扎 Ed25519 信任根或实际 Browser/Server/Electron 地图授权。生产 `runtime_enabled=false`、零资源子规则、未配置生产签名根、无 Cookie mint/JSAPI Loader/代理路由不变。百度唯一 Provider、Server AK/Browser AK 分离只留 Server，Web/Mobile Web/Desktop 共享 Gallery Range/VirtualCollection/Viewer，52px 全屏 App Frame 和 iOS27「照片」1:1 验收不变。完成 A3b3a3d2 的真实合法外部证据及受控上线后，才进入 A4、B1、B2、B3、C1。


## A3b3a3d1b · 官方 JSAPI4 Map/ClusterLayer 纯构造器对接（2026-10-16）

新增 ui/shared/src/media-gallery-baidu-jsapi4-native.ts，仅把未来合法加载、隔离的 JSAPI4 namespace 和 Map 实例绑定到现有共享 native ClusterLayer。严格限制 ClusterLayer 入参、setData/clearData/click 方法，以及 Convertor/Point 构造器有效性。异常固定化，不返回第三方错误或密钥。百度官方 ClusterLayer 类参考 https://lbs.baidu.com/jsapi/refdoc/v4/classes/BMap.ClusterLayer.html 支持 new ClusterLayer、setData、clearData、addEventListener；官方坐标文档 https://lbs.baidu.com/docs/jsapi?title=jsapi4%2Fguide%2Fconcept%2Fcoord 列举 WGS84→BD-09 Convertor.translate(1,5)。原生 Map.getBounds 使用 BD-09，必须另行审查 WGS84 查询视窗变换，不得当成已实现。

这是一个非路由、无生产调用方的纯适配，不执行 BMap Loader/网络代理，不读取全局 BMap，不创建地图 Cookie，不返回 Browser AK。既有 Server AK / Browser AK 加密隔离、Owner Session/epoch/配额、零许可资源和 hard NO-GO 保持不变。上线前需真实百度账户许可覆盖 self-host/PWA/Electron，完整私有九组上游与浏览器 HAR 的 AK 防泄漏实证、人工核准的代码白名单、钉扎受信发布根、Caddy/CSP/Electron 沙箱、真实 iOS27/Android/Desktop 验收。不得把 mock 通过或用户工程授权当成百度许可。xDrive 52px 全屏 App Frame、百度唯一 Provider、三端共用 Gallery、iOS27「照片」1:1 目标不变。


## A3b3a3d1c · 原生 Map 与 Owner 真实视窗的安全组合边界（2026-10-16）

新增无生产调用方的共享组合入口 xDriveComposeBaiduJSAPI4OwnerViewport。它仅依赖未来经合法许可、受信 Server 放行的原生 Map/Namespace、三端已有 Owner 授权 listPlacesViewport(100,0,AbortSignal)，以及经过独立审查的准确 WGS84 bounds 回调。不得把原生 BD09 getBounds 或来自用户的伪称经纬度当 WGS84；不通过客户端传入 Map/Namespace 对象来决定法律许可、运营者签名或 Server 对资源的授权。

离线 Node 测试使用模拟官方转换、百度 ClusterLayer 和地图事件，证明 bounded 100 点输入、原 Gallery Range/Viewer 导航、移动立即取消旧 Go 查询、失效页面无老标记、释放事件和拒绝伪造坐标类型。模拟成功并非生产完成；没有真实 JSAPI 加载请求、Browser AK、Cookie、Server 路由、JS/WASM/瓦片、地图脚本执行或真实官方 WGS84 反向视窗证明。生产 runtime_enabled=false、已审核子资源数 0、无钉扎签名根、无可用资源代理不变。取得账户对应的百度 self-host/PWA/Electron 合法授权、九场景私有完整 upstream+browser HAR、经人逐项审核的不可编辑 Host/Path/MIME 限额、真实 Server Owner/撤销/配额、Caddy/CSP/Electron 沙箱和 iOS27/Android/Desktop 真机证明之前均不能放行。保留百度唯一 Provider、分别加密仅在 Server 的 Static Server AK / JSAPI Browser AK、52px App Frame、三端统一 Gallery。


## A3b3a3d2d · 动态地图坐标合法转换与 Server 查询边界（2026-10-16）

**官方已核实约束**：百度国内 JSAPI4 Map 的原始查询范围通常为 BD-09；[JSAPI 4.0 坐标系](https://lbs.baidu.com/docs/jsapi?title=jsapi4%2Fguide%2Fconcept%2Fcoord)允许用 Convertor.translate(points,1,5) 将 GPS/WGS84 转为 BD-09，而 [Geoconv v2 官方转换文档](https://lbsyun.baidu.com/docs/webapi?title=geoconv%2Fguide%2Fchangeposition-base) 明确不能将任何类型转回 GPS（状态码 4）。因此严禁调用虚构的 5→1 官方转换、手写逆转换算法或原样将 BMap.getBounds BD-09 伪装成 Server 的 WGS84 查询范围。此为真实产品正确性与合规限制，不是优化选项。

既有共享 JSAPI4 Owner bridge 改为接受带 coordinate_space='photo-wgs84' 与精确 bounds 子对象的接口合同，额外字段、BD09、GCJ02、无标签与非法经纬度不进入 Server。只由未来经独立校验的原始 WGS84 viewport 源提供；**一个可以被客户端伪造的字符串标签不是可信变换证据**，测试通过不能触发生产激活。

建议实际动态相册地图采取**正向坐标索引**：合法来源的原始 WGS84 照片与受百度正式授权的 WGS84→BD09 映射，按 Owner/PhotoAsset/Location revision 建立有界索引，BD-09 native viewport 只用于对 BD-09 派生位置做匹配，不反向变换；结果照片仍以原始 Owner 授权媒体 Range + Viewer 打开。必须先取得具体百度商业/自托管/PWA/Electron 授权及是否允许保存衍生坐标的条款或书面确认，再讨论实际存储、更新/删除一致性和高并发索引性能，不能预先假设缓存合法。

本阶段完全不增加新的地图 Route、Caddy 资源反代、Browser AK、生产信任根或持久位置索引，JSAPI4 runtime_enabled=false、child count=0、无可用代理。生产上线仍需完整官方子资源白名单、九格真实私有 Browser/Upstream HAR 无泄漏、运营者签名、Owner/Session/Epoch/跨副本配额与 CSP/Electron/iOS27/Android/Desktop 真机。xDrive 52px 全屏 App Frame、百度唯一 Provider 及三端共享图库不变。


## A3b3a3d2f · Static AK 上游请求与 JSAPI4 同等级传输安全（2026-10-16）

对实际生产启用的 Static v2 Go HTTP 客户端，默认不能受宿主环境 `HTTPS_PROXY`、`HTTP_PROXY` 或 `ALL_PROXY` 影响。Proxy=nil + TLS 默认验证 + 统一只连 api.map.baidu.com/staticimage/v2 + 三路连接池 + 5 秒超时 + 禁止跳转，可减少 Static Server AK/GPS 意外离开预期链路的风险。测试注入自定义 RoundTripper 仅供 Server 可信配置/离线验证，不能通过客户端 URL 选择。该措施不能证明运营商中间人、进程级自定义 Transport、恶意宿主根证书或真实 JSAPI4 子资源无泄漏，生产运行须仍采用被信任的部署环境和账户策略。

**JSAPI4 法律/产品 NO-GO 未变化**：未取得百度对多用户自托管、PWA、Electron 实际场景的账户许可、完整官方资源及 9 组真实请求 HAR；不能修改生产 Loader/签名/路由和 `runtime_enabled=false`，更不能将静态通道当作官方商业授权。现有 52px App Frame、iOS 27 照片 1:1 基准、三端共享图库不变。证据工作跟踪 Issue #1798。


## A3b2a1 · 离线浏览器 HAR 严格正文解码与操作员交接（2026-10-16）

现有本地 HAR 审计原先依赖 Node 宽松 Base64 解码：非法字节、非规范填充、未知 encoding 或空脚本体不应被视为已审核正常。现在浏览器 HAR 必须通过有界、规范的 Base64 round-trip 校验；分别扫描原始 HAR 文本与解码后的正文，防止伪造编码标签隐藏可见 AK，并添加正反例 Desktop 回归。诊断仅固定码/计数，不能泄漏原始密钥或 URL。详见 [百度 JSAPI4 操作员私有许可和九场景取证指南](gallery-places-jsapi4-operator-runbook.md)。

这仅完善未来上线前**离线证据检测**，不运行生产浏览器 SDK、不访问百度接口、不读取/解密 Browser AK、不产生 JSAPI4 Cookie 或公开路由。没有账户适用自托管/商用/PWA/Electron 许可、完整人工核准的子资源清单、9 组真实 HAR、可信发布/跨副本 Owner 配额/CSP/Electron 和真实设备证明之前，JSAPI4 继续 runtime_enabled=false、资源审查数 0、唯一 Provider 百度，xDrive Web/Mobile Web/Desktop 共享图库 Range/VirtualCollection/Viewer、全屏 App Frame 与 52px 标题栏不变。


## P0-Places-A3b2d2b3c · Operator 授权确认后的 Loader 头部前置加固（2026-10-16）

**授权状态来源：用户报告已逐项确认**：当前账户已有独立 Server AK / Browser 类型 AK，使用范围包括多用户自托管同源 JSAPI4 代理、Web / Mobile Web、iOS/Android PWA 和 Electron Desktop，报告无额外付费；官方 WGS84→BD-09 正向派生坐标索引的保留亦报告可用。此结论作为运营方声明已写入 [Issue #1798](https://github.com/lazyxu/xdrive/issues/1798)，不是代码库已独立核验许可原件、配额表、地域条件或保留期限。后续不重复要求运营方口头确认同样事项，只在发现具体条款不明时针对该项核验。

**本阶段真实代码范围**：未来 JSAPI4 Loader 的非路由 `ReviewJSAPI4ResourceRequest` 原本用 `Header.Get("Authorization")` / `Header.Get("Proxy-Authorization")` 检查；空值、大小写别名和重复头可以绕过“字段必须不存在”这一前置约束。改为复用现有 `strictMapTransportHeader` 的完整遍历与去歧义验证，任何出现的 Authorization 或 Proxy-Authorization 即拒绝；合法无凭证的 GET `/_BMapService/api?v=4.0` 仍只能通过**形态审查**。Go 回归覆盖空、nil、重复、混合大小写别名与正常空 Header，签发与生产资源门禁继续硬拒绝。无百度真实网络请求、未持有 AK、不增加 Router、SDK 或代理。

**前向派生坐标架构边界**：拟定的 BD-09 地图视窗索引必须使用官方正向 WGS84→BD-09 转换结果，绑定当前 Owner + PhotoAsset + 源位置修订/有效性 + 索引转换版本，清理被删除、回收、撤销定位或隐私不允许共享的结果。任何过期源修订不允许用于 Marker、附近照片计数或 Viewer；地图 BD-09 视窗只能查询独立派生索引，不得把 `BMap.getBounds()` 反算或贴标签当成原始 WGS84。正式表结构、写入事务、授权条件、配额、响应边界和真机覆盖需独立后续 PR 实现并测试；本阶段**不创建表、不写入任何转换坐标**。

现有 iOS 27「照片」1:1、52px 全屏 App Frame、Web/Mobile Web/Desktop 共同的 Server Range、VirtualCollection 与 Viewer 不变。JSAPI4 动态生产仍 `runtime_enabled=false`、0 个完成审核的子资源、未配置发布签名根、无公开 Loader/Session/Proxy。真实 9 组 Browser/Server HAR、人工逐项固定 Host/Path/Query/MIME/字节限制、受信签名发布与 Owner/epoch/fleet 配额、Caddy/CSP/Electron 和真机 iOS/Android/Desktop 仍是技术 GO/NO-GO 条件。A3 完成后再 A4→B1→B2→B3→C1。


## P0-Places-A3b3a3d2h · 百度官方 Server Geoconv v2 正向转换构件（2026-10-16）

承接 #1820 经准确 HEAD [CI #38878187278](https://github.com/lazyxu/xdrive/actions/runs/38878187278) 76 作业（25 success/51 conditional skipped）、Final Gate 通过，Rebase 合入 master@`98d31fea240677e4749abefa47155164d6ba52aa` 并核实相关工作分支删除。此阶段仅为未来 BD-09 地理索引增加**真实协议级、内部可调用但生产尚无调用方**的 Go Server 正向转换构件。

**官方参数不能混淆：** [百度 Geoconv v2](https://lbsyun.baidu.com/docs/webapi?title=geoconv%2Fguide%2Fchangeposition-base) 的 `https://api.map.baidu.com/geoconv/v2/` 使用 `model=2` 将 GPS/WGS84 转换成 BD-09LL（longitude,latitude；分号分隔、最多 100 对），**不是** JSAPI4 原生 [Convertor](https://lbs.baidu.com/docs/jsapi?title=jsapi4%2Fguide%2Fconcept%2Fcoord) 的 `translate(points,1,5)`。不得进行 BD-09→GPS/WGS84 反向转换，也不得用近似偏移替代官方结果。百度文档说明中国境外底图通常直接采用 WGS84；派生索引将来必须具有明确坐标空间，不能把境外地图错误标记成 BD-09。

`internal/baidumapjsapi/geoconv_forward.go` 使用 Server AK 创建固定主机、固定模型的 GET，逐项校验来源 WGS84，最大 100 对；其执行函数沿用 `SafeHTTPClient` 的 TLS 验证、无环境代理、无重定向、5 秒超时和可取消 Context，原始 AK-bearing URL 严禁日志/前端/Agent IPC。只接受无压缩 HTTP 200、JSON MIME、至多 64 KiB 的完整响应；显式 status=0、结果数与来源一一对应、有限经纬度、无多余 JSON；任何失败仅固定脱敏错误。Go 离线测试覆盖 (0,0)、日期变更线、非法输入、100/101 点、缺字段、状态异常、溢出、非 JSON、上游重定向/压缩、伪造密钥回显及 Context 取消。合成假 HTTP Transport 不发生真实百度请求。

**关键边界：** 尚未在生产扫描/源同步/Gallery 请求中调用它，没有 Server→百度的真实用户 GPS 转换，也没有持久 BD-09 索引、回收/隐私失效事务、地图外部接口或 JSAPI4 SDK。以后使用转换结果需先实现 Owner/PhotoAsset/来源位置修订、有效性/用户隐私/删除检查，来源变化必须让旧索引失效；聚合不得把地图 BD-09 bounds 冒充原始照片 WGS84，且 PhotoAsset 原始 GPS/Viewer 身份不被修改。

运营方已确认两类 AK、跨平台/派生数据用途及无需额外付费，此为在 [Issue #1798](https://github.com/lazyxu/xdrive/issues/1798) 中记录的用户声明，并非已独立检查实际账户条款。生产 JSAPI4 继续 `runtime_enabled=false`、已核准子资源 0、未配置签名根、无公开 Loader/Session/Cookie/Proxy。还需 9 组真实私有 Browser+Server upstream HAR、人工核准资源白名单、可撤销受信签名/Owner/跨副本配额、Caddy/CSP/Electron、iOS27「照片」1:1 及 Android/Desktop 真机验收。百度唯一 Provider，Server Static AK/加密 Browser AK 分离，Web/Mobile Web/Desktop 统一 Gallery Range/VirtualCollection/Viewer 和 52px 全屏 App Frame 不变。完成 A3 后方可 A4→B1→B2→B3→C1。


## A3b3a3d2i · Owner/原始 GPS 版本校验的百度派生位置索引（2026-10-16，仍非生产地图）

在 #1825 已将百度 Geoconv v2 Server-only 官方 WGS84→BD-09 正向转换能力交付后，本阶段建立 **空的、可重建的独立坐标索引表** `xd_baidu_photo_map_positions` 和仅供未来 Server 授权调用的无公开路由视窗读取方法。逻辑身份是当前 `PhotoAsset`（非源文件副本），约束 `OwnerID`、`PrimaryNodeID`、`NodeRevision`、`MediaMetadata.UpdatedAt`、真实源 WGS84 latitude/longitude、显式 `bd09ll`/境外 `wgs84ll` 坐标空间、官方转换版本及派生经纬度；有复合地理索引和 PhotoAsset/Owner FK 删除级联。迁移自动创建空表，**不回填 GPS、不联系百度、不启用任何前端地图资源**。

只读范围查询必须同时 JOIN 当前 Owner、PhotoAsset、未删除 Node、`MediaMetadata`：用户停用、照片被删除、Node revision 变化、原始 GPS 修改、媒体重新扫描/UpdatedAt 变化、投影转换版本过期或坐标系不符，旧行必须**立即不可见**，不能用于标记、数量或照片导航；Owner 必填、最多 100 条/页、经纬度有界、支持日期变更线、总数不从当前页猜测。代码中不开放外部 HTTP 端点，不提供写入程序或任何 Browser AK/Server AK；只在 PostgreSQL 隔离 schema 的合成测试验证范围数据、真实计数和撤销安全。未来 ingestion/cleanup 需要当前照片 Owner、用户定位隐私策略和有效源修订作为写入许可，调用 #1825 的官方 Server 转换并加跨副本额度；视窗将用显式 BD09 边界匹配派生位置，**绝不逆算 BD09 为源 WGS84，也绝不将旧网格中心当拍摄地点**。

用户关于百度两种 AK、自托管 PWA/Electron、无额外费用和 WGS84 正向派生索引保存权限的确认已在 [#1798](https://github.com/lazyxu/xdrive/issues/1798) 分类记录，不再重复询问。正式动态 JSAPI4 的完整子资源列表、九组真实私有双端 HAR、受信发布签名、Owner/Session/撤销和额度、CSP/Electron/PWA 隔离、iOS27「照片」1:1 与 Android/Desktop 真机依旧未完成；`runtime_enabled=false`、零核准 child 资源、无公共 Loader/Cookie/代理不变。图库 Web/Mobile Web/Desktop 继续共用 Server Range、VirtualCollection、Viewer 和 52px App Frame，A3 真正验收后依次 A4→B1→B2→B3→C1。


## P0-Places-A3b3a3d2j · 百度位置派生索引事务写入安全约束（2026-10-16）

承接 #1830 的空表和 Owner/Node/MediaMetadata 修订强校验只读范围，本阶段只新增**不被生产 Router 调用的 Server 内部事务 upsert/purge**。新写入候选必须绑定经 Server 当前授权的 Owner、PhotoAsset、主 Node、Node revision、当前 MediaMetadata 更新时间及同一张照片的一对真实 WGS84 GPS；派生坐标必须为明确 `bd09ll`/境外适用的 `wgs84ll`，采用代码固定的 projection version。WGS84LL 不允许隐藏的坐标位移；所有坐标均为有限且合法范围。拒绝缺失、NaN、Inf、跨 Owner、旧修订、无效照片媒体状态、已删除 Node、禁用账号，禁止从 0.01° 网格中心构造原始 GPS。

写入采用 PostgreSQL 单事务，按稳定顺序锁住 **Owner → PhotoAsset → Node → MediaMetadata** 并重新核验真实原始 GPS 与更新时间，随后要求**受信 Server 回调在同事务内核实并锁定用户的持久位置索引/外传隐私许可状态**。没有回调或隐私拒绝则全事务回滚；调用方不能从浏览器传入一个 `consent=true` 当作证明。只有核验后才按 PhotoAsset 主键原子 upsert；Owner 作用域的 purge 即使账号停用仍可执行，供后续定位删除、撤销和回收。原有 Server 视窗读继续每次验证实时原始 GPS、Source revision 与当前 Owner，避免旧索引复现。离线 PostgreSQL 集成测试使用仅供测试的授权回调，**不构成生产隐私许可**。

仍无任何生产 indexer/定时 job、真实 Baidu Web Geoconv 网络调用、AK 解密、GPS 自动外传、地图 Proxy/Loader/Cookie 或新版 Web/Mobile 专属 Gallery。后续真实 ingestion 必须先有持久 privacy/retention 配置及其事务读取、Owner/全局额度、真实官方 Geoconv 正向转换、更新/删除一致性、安全审计、地区坐标规则与性能验证后才能接入。即使运营者已报告自托管/PWA/Electron/派生坐标许可、双 AK 和零额外费用，技术放行仍须九组真实 Browser/Server HAR、逐路径人工审核 JS/瓦片/字体/WASM 白名单、受信签名、每次请求的 Owner/Session/epoch/配额、Caddy/CSP/Electron 隔离和 iOS 27 照片 1:1 / Android / Desktop 真机。生产 `runtime_enabled=false`、0 个 approved child、无可信签名根不变，百度仍是唯一 Provider，Web/Mobile Web/Desktop 共享图库 Range、虚拟列表、Viewer 与 52px 全屏 App Frame，完成 A3 后才进入 A4→B1→B2→B3→C1。
