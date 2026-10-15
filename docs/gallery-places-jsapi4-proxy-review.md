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
