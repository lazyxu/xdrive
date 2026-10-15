# Gallery Places · iOS 27 Photos 1:1 implementation and acceptance

**Decision:** 2026-10-13 (Asia/Tokyo). **Provider:** GitHub `lazyxu/xdrive`.
**Frozen implementation baseline:** `master@3c92bd846ba1655df58bbdad38d3a44118a58a48`.
**Accepted order:** P0-Places-A1 → A2 → A3 → A4 → P1-B1 → B2 → B3 → P2-C1.
**Current delivery (2026-10-13):** A1 #1593 and A2 #1598 merged; A3a dual-AK proxy review PR #1599 pending; separate encrypted Browser AK desired-config #1607 had green exact-head CI but was closed under an obsolete limitation and is not merged. JSAPI runtime and A4/B1–B3/C1 remain unaccepted.
No physical iOS 27 Safari/PWA, Android or Electron measurements are asserted.

## Non-negotiable application contract

- Apple iOS 27 **Photos**, not vague iOS aesthetics, is the version-locked
  mobile content/interaction benchmark. Measure screenshots and gesture states
  before claiming 1:1; Baidu-authored basemap assets are a documented provider
  visual exception, not an excuse to omit map interactions.
- One full-screen xDrive App Frame and its fixed **52px global app header**
  (plus actual safe area). Do not introduce a nested global map header or route.
- **ONE** `XDriveMediaGalleryPage`, Web/Mobile Web REST
  `createWebMediaGalleryDataSource`, shared MUI Gallery controller,
  `VirtualCollection`, VirtualGrid/VirtualTimeline, Viewer and Server
  `PhotoAsset / MediaMetadata / CAS`. Desktop adapts only through its
  authorized Agent IPC. Mobile has the same Places queries, actions, counts,
  membership, error handling and return identity as wide Web; only presentation
  and native viewport gestures can differ.
- Baidu is the **only map Provider**. No offline SVG, OSM, Google Maps or
  alternative basemap if Baidu cannot load. GeoNames is only optional local
  naming metadata and is not a replacement basemap.
- Original GPS is immutable WGS84 provenance until a distinct user-authorized,
  revision-fenced metadata override is designed in B3. Never silently rewrite
  real photo coordinates with Baidu/BD-09 or artificial grid centers.
- A map selection is a bounded Server query, not a client-side scan of 100k
  media. Do not copy originals, prematurely load Live motion, materialize all
  items, or change owner isolation. Owner/role scope is enforced by the Server.
  Temporary map/viewport requests use abortable transports; never cancel
  durable upload/download/sync/tasks when a map is closed.

## P0-Places-A1 · bounded and accurate location data

**Baseline defect evidence (source inspection):** `/api/v1/media/places`
returns only an array of up to 1000 GPS grid facets, generally queried with
24 for the Gallery preview. Gallery's Places cards additionally render
`places.slice(0, 24)` even after asking for more. Count shown by the map is
then only the returned subset rather than the full owner-scoped number of cells.
Each `MediaPlaceFacet.latitude/longitude` is the mathematical center of a
0.01° grid cell, **not** an actual photographed GPS point; these semantics
must not be conflated.

**A1 candidate implementation (requires full exact-head CI):**

- Keep the original `GET /api/v1/media/places` and existing
  `place:<latCell>:<lonCell>` identifier/filter working for older Agents and
  deep links. Add `GET /api/v1/media/places/page?limit=48&offset=0` with
  authenticated owner-scoped pages (limit 1–100; offset 0–10,000,000),
  `{items,total_count,offset,limit,has_more}`. Total counts **all valid
  currently indexed owner PhotoAsset GPS cells**, not an old 1000-row cap or a
  pretend all-disk completion. The same grouping predicate and deterministic
  sorting power count and page. An empty page still returns the true total.
- Keep `latitude/longitude` backwards compatible as cell centers and add
  `sample_latitude/sample_longitude` taken together from the **same actual
  representative PhotoAsset/Node**, plus
  `coordinate_kind: "grid_cell_center"`. Do not use independently aggregated
  min/max latitude and longitude as a non-existent GPS pair.
  Existing Baidu static map will use the real sample when available; names
  and labels remain explicitly approximate grid groups, not city/POI identity.
  True photo GPS must remain unmodified.
- Share `mediaPlaceValidGPSPredicate` between Places and Gallery's
  `has_location=true/false` filter. Missing or out-of-range coordinate
  pairs are **without valid GPS**, not silently counted as locations.
  Coordinates (0,0) and legal poles/dateline are not automatically bogus;
  Baidu's currently supported image-center latitude limit (±85) is a
  **display capability**, not evidence that original legal GPS was invalid.
- Web/Mobile Web use one paginated REST adapter; Desktop uses an independently
  authorized Main/Preload/Go Agent/Server endpoint for the **same DTO**.
  No platform-specific business controller, photo index, Viewer or list.
- Root Places shows a truthful owner-scoped total and visible page range,
  with preceding/following bounded 48-place cards. **Page replacement**,
  never append-all 100k cards to the DOM. Mobile Collections preview remains
  bounded to its first few real cards. If an old Server/Agent cannot provide
  the page contract, label the displayed legacy subset as incomplete rather
  than saying there are no other places.
- Integration fixture: 31 valid cell groups, legal (0,0) and 90/180, invalid
  latitude, missing longitude, a second owner, repeated pages, end-of-page,
  exact sample/center separation, shared true/false GPS filter.
  Desktop/ Web adapter+IPC and UI parity are tested separately. Browser
  fixtures are **not** physical iOS acceptance.

**Known limitation:** Offset-based pages permit full coverage but a changing
Gallery can reorder rows between requests. The A2/A4 map selection design
should use an owner-scoped generation/position identity or cursor for strict
cross-request stability. Do not claim snapshot-consistent page totals under
concurrent media edits, or that a full 100k-item native browser benchmark ran.

## A2 · map entry points and return identity

- Same Places business controller for Gallery **Show Map**, Collections →
  Places, Viewer/Properties location card, album/Memory/Trip scoped map, and
  nearby-photo landing. Active query/selection and Viewer return should
  remember source collection, sort, sparse index/Node, map center/zoom and
  scroll anchor; compact 899/900 crossover may not reset them.
- Provide visible feedback when GeoNames is unavailable or coordinates are
  missing; no new fake city/place folder. At least 44px controls on mobile.
- Tests: Web 1280, mobile 375/390/899/900, Desktop route, navigation Back,
  selection/Viewer and a real 100k sparse-range fixture (no dense list).

## A3 · 百度双 AK 与 JSAPI 4.0 安全代理（2026-10-13 最新批准）

**最新决定：Server AK、Browser AK 按百度服务要求分别使用，密钥只保留在 xDrive Server。** Server AK 专供已有 Static Map v2；JSAPI 4.0 必须申请独立的 Browser AK，并且仅可通过已登录 xDrive Server 的严格同源代理使用。两种地图实现都是**百度地图唯一 Provider**，绝不把 Server AK 冒充 Browser AK。参阅 [安全/许可评审](gallery-places-jsapi4-proxy-review.md)。

- **A3a 方案/安全评审**：确认 JSAPI 官方代理加载规范、Browser AK 独立存储、商用/自托管授权、完整实际 JS/瓦片依赖、CSP、Cookie/Token 权限、配额与 Electron/Agent 隔离，评审完成不意味着上线代理。
- **A3b1 独立 Browser AK desired-config**：恢复复用 PR #1607 的已测试单提交，而不是另建相同配置；管理员加密保存/修订号/审计/关闭，**runtime_enabled=false** 即使保存成功。
- **A3b2 代理门禁**：要求有法定授权且实测完整 JSAPI 4.0 子资源的固定上游 host/path/method/query 白名单。为无法带 REST Bearer 的浏览器地图脚本/图片颁发由 Server 登录态验证的短时、HttpOnly/Secure/SameSite、地图专用同源会话；严禁通配 Nginx 代理、任意 URL、客户端 AK、重定向、跨副本无限请求或 Service Worker 缓存。
- **A3b3 交互与集成**：完成安全和许可门禁后在 Web/Mobile Web/Desktop 共用的共享 MUI 地图中实现连续平移/缩放、photo marker、Server 限量聚合与打开现有照片 Range/Viewer。不得让浏览器下载 100k 全量 GPS 列表。Desktop 必须证明 Electron sandbox/contextIsolation 与 Agent bridge 不赋予第三方 JS 文件/同步任务权限。
- **不满足门禁时**：仍使用**现有已授权的百度 Static Map v2**，明确显示动态不可用状态；PNG 不等于连续动态瓦片。不得用 OSM、Google、SVG 或假地理坐标兜底。

A4 才交付 Owner-scoped 附近照片 bbox/半径 Range，B1–B3 和 C1 独立完成；真机 iOS 27 视觉 1:1、Android/Desktop 功能、GPS 隐私/分享与性能不得由源码断言代替。

## A4 · nearby photos

Authenticated `bbox`/radius and optional temporal/album scope on the same
media Range backend; documented antimeridian wrap, legal poles, actual GPS
distance (not cell midpoint), consistent count/order/anchor and bounded
photo previews; viewport aborts down to Go context. Unavailable Baidu must
not erase the locally indexed geo results.

## B1 → B3

- B1: keep GeoNames as an optional local provenance-labelled resolver.
  Introduce separate city/region/country semantics, coordinate confidence and
  ambiguity rules. Never rename grid keys as stable semantic cities.
- B2: travel year navigation and explicit durable/derivable
  `PhotoAsset`-membership. Current date-only Trip range may include media
  from elsewhere; rectify before claiming accurate travel counts/maps.
- B3: revision-fenced per-asset and batch GPS override/removal/restore with
  separate original metadata provenance, auditable owner control, on-demand
  background reindex, and privacy-safe export/share with verified stripped
  GPS bytes. No in-place original CAS mutation.

## C1 · measurements and real iOS 27 acceptance

Follow `docs/mobile-gallery-ios27.md` and `AGENTS.md` source-exact
BEFORE/AFTER performance and sparse-window requirements. Record
375/390/899/900/1280 Desktop, Android, iOS 27 Safari/PWA screenshots,
pinch/pan/scroll/Back/VoiceOver, dark/landscape/safe-area; map display
availability, failed AK/blocked upstream and proxy quota; 100k location/
thumbnail and 100k media Range tests with actual cancellation. Keep distinct
evidence for source checks, CI, controlled Chromium, real Baidu, and devices.

**Handoff:** A1 PR/CI/merge state must be updated from an actual exact-head
GitHub result. Do not mark A2–C1 complete or JSAPI released based on this plan.


## P0-Places-A2 导航候选（2026-10-13）

本阶段使用同一共享图库视图增加图库「显示地图」入口；地点列表保留既有可授权 Server Range 与虚拟化媒体查询；从分地点照片墙返回时保存最大 48 条的当前地点页/选择 ID，不以全量地点数组恢复位置。真实 Web/Mobile Web 路由 Viewer 与 Desktop 内嵌 Viewer 复用唯一照片位置 Dialog 和既有百度静态 PNG Server 接口，遇到缺失/无效 GPS 不请求地图，不引入 JSAPI/其他 Provider。新的静态地图不是 A3 的平移/聚合实现，原生 iOS 27 Safari 截图及真实权限端到端仍须 CI 与设备验收。


### A3a · 2026-10-13 最新授权更正

先前的 Server AK-only / #1607 不得交付的临时决议已由用户撤回；按实际服务分别使用 Server AK (Static v2) 和 Browser AK (JSAPI 4.0) 并强制 Server 代理。#1607 可恢复为配置前置，但不自动解除 JSAPI 代理、许可、跨客户端安全及 C1 真机门禁。


## A3b2a · 本地 HAR 安全审计辅助工具（2026-10-13）

#1618 的百度 Static Map 分步平移已通过单提交 full CI/Final Gate 并线性合入；A3a #1599 与 A3b1 #1607 亦已合入。独立的 A3b2a 仅添加 `scripts/ci/baidu-jsapi4-browser-har-audit.cjs` 与合成测试，详见 [JSAPI 代理评审的 A3b2a 门禁](gallery-places-jsapi4-proxy-review.md)。它**不是动态 JSAPI 代理运行时**，也不能替代正式授权、百度完整上游资源白名单、真密钥泄漏证明和真机验收。A3b2/B3 仍 blocked，A4/B1–C1 后续按路线图顺序实现。前端两 AK 均不可见，共用架构和 App Frame 保持不变。


## A3b2b · 固定百度 Loader 请求/响应门禁（2026-10-13）

A3b2a 浏览器 HAR 安全审计 #1624 在 exact-head 完整 CI/Final Gate 通过后已线性合入 \`dadcbd42886e83f9ff6a85ed849a33d3736b7b1f\`；其工作分支已由 cleanup 清理。本阶段 A3b2b 单独新增 \`internal/baidumapjsapi\` 无路由的 Go 请求/响应安全构件，详情见 [JSAPI 安全评审的 A3b2b 部分](gallery-places-jsapi4-proxy-review.md)。其一律默认拒绝未观察到的子资源；保存 Browser AK 不自动启用 JSAPI；不能代替实际许可、完整流量清单、跨副本配额与 iOS/Android/Desktop 实机证明。只有这些门禁具备后才能接入 Server Session/HTTP Proxy 与同一共享 Gallery MUI 地图，随后实现 A3b3 动态平移、Marker/聚合，再按顺序进入 A4/B1–C1。保留 iOS 27 1:1 产品基准和 52px App Frame。


## A3b2c1 · 短期地图专用会话安全合同（2026-10-13）

在 A3b2b 固定百度 Loader 上游组件完成 exact-head CI/Final Gate 并合入后，增加 `internal/baidumapjsapi/session.go` **不挂载任何 HTTP 路由**的加密短期会话原语：随机 AES-GCM nonce、仅地图路径的 HttpOnly/Secure/SameSite Cookie、2 分钟有效期，验证当前用户会话版本、JSAPI Browser AK 配置修订、持久撤销 epoch，并检查同源 HTTP 前置条件。旧 Cookie 在用户禁用、版本变更、AK 轮换、撤销 epoch 更新或 Map Runtime 未获批时自动拒绝。代码要求这些实时 Server 事实，**但本阶段未实现数据库撤销版本或登录/登出联动**，因此真实签发和代理仍不开放。

下一步 A3b2c2：持久化单调递增的撤销 epoch，Owner Bearer 授权签发与资源逐请求 DB 检查，处理退出登录/禁用/轮换，完成多副本配额与 Caddy/Electron 隔离。取得百度实际合法授权、完整子资源白名单和泄漏验收后方可交付 A3b2d 运行时，随后 A3b3 共享 Web/Mobile Web/Desktop 连续地图、Marker/聚合，最后 A4、B1–B3、C1 真机验收。继续保持 iOS 27「照片」1:1 基准、52px 全屏 App Frame、唯一百度 Provider。


## A3b2c2a · PostgreSQL Map Session 撤销版本（2026-10-13）

在 #1633 / A3b2c1 完整 CI 成功并线性合入后，新增独立 PostgreSQL `BaiduJSAPIMapEpoch` 持久撤销记录：每 Owner 初始版本 1，缺行/版本 0 失败关闭；事务内原子提升版本及不可回退的时间截止线，跨副本实时可读。`AccessAfterRevocation` 独立验证已经签名的 Access JWT 签发时间必须严格晚于撤销截止线，禁止旧 Token 再次签发地图 Cookie。新增隔离数据库/两个连接/回滚/账号隔离/禁用账号/必改密码测试，生产环境仍不开放 JSAPI 路由或百度密钥。

后续必须先做 A3b2c2b：实际 logout/管理员撤销与持久 epoch 原子联动，地图授权签发时核验真实用户、JWT iat/会话版本及 JSAPI 安全许可，并在每次地图资源请求重新读取数据库与跨副本配额。完成真实百度官方许可、全部子资源白名单及密钥泄漏验收后才可启用 A3b2d 代理，随后 A3b3 连续地图和照片 Marker/聚合，再推进 A4 附近照片、B1/B2/B3 和 C1 iOS 27 1:1 真机/性能验收。始终保留 52px App Frame，Web/Mobile Web/Desktop 共享图库后端与虚拟化组件，百度唯一地图 Provider。


## A3b2c2b · 退出登录撤销地图会话与已验签 JWT 校验（2026-10-13）

A3b2c2a / #1639 的每用户 PostgreSQL `epoch`、原子递增和 Access Token 截止线已完整 CI/Final Gate 通过并线性合入。此阶段将 **真实 `/api/v1/auth/logout`** 的有效、未过期 Refresh Token 事务性撤销与地图 `epoch`、脱敏审计一起提交；失败全部回滚，重复/失效 Token 不能反复提高版本。退出时清除路径限定的短期 `XD_BMAP_SESSION` Cookie，不改变普通用户 Access JWT 的现有生命周期，也不取消后台传输/同步。

独立的 `auth.Manager.ParseMapAccess` 只接受签名/时效/Subject/iat/SessionVersion 全部有效的 Access JWT；`verifiedMapBootstrapIdentity` 从 Server DB **重新读取真实用户、会话版本和地图撤销 epoch**，拒绝登出前签发的旧 JWT 重新申请地图 Cookie。当前它仅是 Server 内部预检，不提供 Session 路由，不读取/返回 AK，不等于 JSAPI 上线。

下一步继续 A3b2c2c：把管理员禁用/密码变更/强制撤销和 Browser AK 轮换的地图撤销状态统一审计，并实现逐资源 DB 权限、跨副本配额、固定白名单。只有真实许可证、全量上游资源及 HAR/原始字节泄漏审计、CSP/Electron/移动真机通过后才允许 A3b2d JSAPI 4.0 动态地图，继而 A3b3 三端共用 Marker/聚合，接续 A4、B1–B3、C1。继续保持 iOS 27「照片」1:1 基准、52px 全屏 App Frame 和 Web/Mobile Web/Desktop 共用图库后端。

## A3b2c2c1 · 地图资源逐请求身份与配置快照（2026-10-13）

继 A3b2c2b 的真实登出撤销与已签名 JWT 严格验证，新增无公开路由的内部地图资源预检：先通过 AES-GCM 认证短期 Cookie 提取 Owner 身份，随后从 PostgreSQL 实时读取用户状态、JSAPI Browser AK 配置修订和地图撤销 epoch；仅接受已审核的 Loader 精确路径，拒绝 Bearer、重复 Cookie、跨站或客户端 AK/URL。测试覆盖 Cookie 篡改/过期、密钥轮换、停用和撤销版本。**返回的 RuntimeAuthorized 固定 false，仍禁止 JSAPI 动态网络访问。**

下一步 A3b2c2c2：完成管理员账号安全动作与地图撤销事件的安全审计、真实可验证的运行时证据、跨副本配额及完整百度子资源白名单，再在许可通过后接入代理及共享 Web/Mobile Web/Desktop 动态地图。A3b3 照片 Marker/聚合、A4 附近照片、B1–B3/C1 按原顺序继续。保留 iOS 27「照片」1:1、52px App Frame 及共享虚拟列表。


## A3b2c2c2 · 管理员与个人账户安全操作的地图撤销事务（2026-10-13）

继 #1649 资源身份与逐请求可信状态预检已通过 exact-head 完整 CI/Final Gate 并线性合入，此子阶段将禁用用户（有效状态切换）、管理员重设密码、管理员撤销会话和用户修改密码四条真实授权处理链路接入同一个 PostgreSQL 地图撤销 epoch。业务修改、地图失效和脱敏审计全部位于各自已有单个事务；地图撤销失败会回滚账户更改，重新启用不会恢复旧 Cookie。Browser AK 配置更改沿用已有配置 revision + 审计，通过 #1649 的每资源重读使旧 Cookie 失效，避免无界全用户 epoch 扫描。

仍然没有公开 JSAPI Session/Loader/瓦片路由，没有合法许可证和真实完整子资源及泄漏证据，也无多副本配额和 Web/Mobile Web/Desktop 动态图库地图。保持 `runtime_enabled=false`；下一步 A3b2c2d 跨副本配额与代理固定资源准入，再到 A3b3/A4/B1–B3/C1；不将纯 Go / PostgreSQL / CI 检查算作 iOS 27 真机逐像素验收。


## A3b2d1 · JSAPI4 Loader 跨副本计数与有界请求预留（2026-10-13）

前序 #1649、#1655 均通过 exact-head 完整 CI/Final Gate 并线性合入，相关分支已清理。当前只补充 `meta.BaiduJSAPIQuotaBucket` 和纯 Server 侧、无公开 Router 的原子 PostgreSQL 准入构件；数据库单调分钟桶由 `clock_timestamp()` 确定，按 **fleet → trusted Owner** 固定顺序在同一事务中预留。生产固定 12 次 Loader GET/Owner/分钟、全局 240 次/分钟；每次按 Loader 已有最大响应 2MiB 保守扣除预算，拒绝后不额外扣全局计数。两独立连接、并发、Owner 互不借用、回滚、分钟翻转、坏表、迁移均应有独立 PostgreSQL 回归。

**状态仍为 NO-GO：** quota 是构件，不是合法商业授权或完整 JSAPI4 子资源 allowlist。没有公开 Map Cookie 签发/资源代理、没有 Browser AK 发送或动态地图组件，也没有实际字节/并发在途额度、真实 Server upstream/HAR 密钥验收、Electron/PWA/Caddy 和 iOS 27/Android/Desktop 真机体验证。`runtime_enabled=false` 保持不变。下一步 A3b2d2 必须将法律证据/全量子资源白名单/跨副本资源配额/可信发布门禁连成真实只允许合法范围的 Server 链路，通过后再实现 A3b3 共享连续地图交互与照片聚合，然后 A4、B1–B3、C1。保持唯一百度 Provider、iOS 27「照片」1:1 基准、52px 全屏 App Frame 和三端共用 Gallery 核心。


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

- Paired HAR bootstrap restriction: reject a non-POST map-session issuance request or any query-bearing session URL before cross-resource reconciliation. This supplements, but cannot replace, the live Server same-origin JWT authorization contract.


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
