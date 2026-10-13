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
