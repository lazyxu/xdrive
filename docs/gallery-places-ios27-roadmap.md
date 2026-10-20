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

## P0-Places-A3h · iOS 27「照片」多照片缩略图聚合地图（A4 后新增）

**A3h source candidate 2026-10-20（合入/真机前不得宣称完成）**：在现有签名 Owner `/media/places/baidu-jsapi/cells` 的 8×8 真实数量返回上增加当前 `node_revision`，
用官方 `BMap.Map.pointToPixel` 将经过授权的真实 BD-09 样本投影到地图容器 CSS 像素，React 覆盖层绘制单张代表照片与数量角标，最多 24 个互不遮挡可见封面。
缩略图经过 Gallery 共享鉴权加载池/Blob 生命周期，不把图片 URL 或 HTML 传给百度 Label/Layer，其他被碰撞抑制的格子仍在有界区域列表。
小于等于 100 张也使用同一个有界 `/cells` 标记；旧 Server 不含 `node_revision` 或不支持像素投影时恢复原生数字 Label/ClusterLayer。
移动/缩放即时取消旧 Controller、图片卸载释放，Desktop 使用现有隔离 HTTPS Web Gallery 而非 file: 直接执行第三方 JS。
这是代码候选，不等于真实 iOS 27 1:1、实际生产百度流量、100k 实物性能或第三方可执行脚本绝对隔离证明。

**后续仍需完成的验收与功能**：多张聚合到当前视窗的照片墙（不只是放大）、地图/Viewer 返回相机锚点、视频未生成 Poster 的安全生成策略、
真实跨账户撤销/缩略图缓存和百度资源隔离威胁模型；真实 100k 大库、iOS27 Safari/PWA/Android/Electron 截图、交互及低网速和 VoiceOver/键盘测试。
尚未完成这些不得关闭 Issue #2188 或视为 C1 通过。


**明确未完成，不得以数字圆点或普通 ClusterLayer 冒充实现。**
当前 A3 在 100 张以内使用百度原生 ClusterLayer；超过 100 张使用最多 64 个带真实总数的 BD-09 网格标记。
Apple iOS 27 官方操作及截图参考：https://support.apple.com/ja-jp/guide/iphone/iph390138909/27/ios/27 。
官方典型形式是**每个聚合位置一个真实照片封面及其数量角标**；正式像素与手势仍须用 iOS 27 真机核查。
它们还不是 iOS 27「照片」地图上的多位置可见照片缩略图聚合与对应数量角标。本子阶段需在 B1/B2/B3/C1 最终验收前完成。

- **真实聚合数据与权限**：继续使用当前 Owner、PhotoAsset、原始有效 WGS84 / 经授权正向派生 BD-09、单张地理同意、真实总数和 current media revision；
  服务端返回有界可见集群与一张真实代表封面的 Asset/Node 身份、总数和权限版本；禁止将代表样本条数冒充集群真实总数，
  不用网格中心伪造照片 GPS，不能将全部 100k PhotoAssets/GPS 传给浏览器。
- **图片式标记**：地图上的多个位置分别绘制一张真实代表封面，并叠加完整照片数量角标；不默认使用多图错层堆叠，只有真实 iOS 27 对照证明有此状态时才允许增加。
  缩略图取自现有认证媒体缩略图/CAS 传输（HEIC、视频 Poster、Live Photo 静态封面），严格限制尺寸、并发、视窗预取和取消；
  不在 Provider SDK URL、HTML 标记、浏览器日志或缓存中暴露账户 Bearer、Browser AK、原图地址或其他 Owner 私有资源。
- **触摸与导航**：地图 pan/pinch/zoom 时基于 Server 有界当前 BD-09LL 视窗重新查询，并立即 Abort 前一代请求。
  点击多张聚合应展开/放大该区域或通过现有有界 Media Range 进入照片墙；点击单张仍由 Server 重新验证 Asset/Node 身份后打开原 Viewer。
  返回必须恢复原地图 camera、选中聚合、Gallery/Viewer 排序和虚拟滚动锚点，不能闪过空白/错误中间态。
- **三端严格等价**：Web、Mobile Web/PWA、Desktop 独立安全 HTTPS 地图窗口共享 ONE Server 查询、Client controller、MUI Marker、Range/VirtualCollection/Viewer。
  不新增地图 Provider，不用另一份全量照片索引，不破坏 xDrive 全屏 App Frame、52px 全局标题栏与权限模型。
- **验收**：逐张对照真实 iOS 27「照片」地点地图的单张代表缩略图大小、白色边框、数量 badge 与位置、不同 zoom 的聚合切换、点击/返回、
  深浅色、横屏、安全区域、VoiceOver/键盘、持续缩放无跳动；使用真实 100k mixed photo/video/Live Photo 库、慢网及 Desktop Agent 取消链路测量。
  区分模拟/源码 CI、真实百度 SDK/账号授权和实体设备证据。签名发布正常不等于图库视觉和操作已验收。

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


## A3b2d2b3b2a · JSAPI4 九场景私有 HAR 证据矩阵（2026-10-15）

**进度：离线、只读证据覆盖工具；并非许可证审核、真实上游资源白名单或生产授权。** 在 #1693 Ed25519 发布证明经过完整 CI/Final Gate、线性合入并清理后，新建 `scripts/ci/baidu-jsapi4-evidence-matrix.cjs`，由现有 Browser HAR、Server→Baidu Upstream HAR 和 Cross-HAR 三层审计组合运行。任何审计通过都不能设置 JSAPI 的 `runtime_enabled`。

- **九场景输入**：`web`、`mobile-web`、`desktop` 每个平台必须分别采集 `load`、`pan`、`zoom`；每个场景各有一份浏览器 HAR、一份 Server 上游 HAR，总计 9 对、18 份私有记录。平台名称只是操作者输入的标签，**不能证明实际物理设备、iOS 27 或安装态 PWA**。
- 操作者在私有目录创建 `manifest.json`，其格式是 `{"version":1,"captures":[{"client":"web","scenario":"load","browser":"web-load-browser.har","upstream":"web-load-upstream.har"}, ...]}`，必须严格有全部九个唯一的 client/scenario 组合。捕获文件必须与 manifest 位于同一目录，采用安全 basename、不可为软链接；拒绝路径穿越、缺文件、空文件、超大文件、文件名复用、同内容重复捕获和未通过的单对审计。浏览器 HAR 最大 20 MiB，上游最大 32 MiB，manifest 最大 32 KiB；只读取本地文件，无网络请求或自动上传。
- 在可控离线环境中通过密码管理器仅向进程环境注入 `XD_BAIDU_JSAPI_AK_CANARY`，执行 `node scripts/ci/baidu-jsapi4-evidence-matrix.cjs /private/manifest.json https://your-trusted-origin.example`。**不得**把真实 AK、JWT、Cookie、完整 URL、GPS、原始 HAR、目录内容或私有 manifest 提交到代码库、CI 制品或聊天记录。
- 只输出固定错误码、要求的对数、已检查/拒绝对数；`release_authorized=false` 为不变常量。输入的 `capture_valid=true` 仅说明**这些文件通过有限规则**；没有全程网络完整性证明、实机证明、账号许可证明或签名可信来源。不要根据样本、匿名摘要或 HAR 自动扩展百度资源 allowlist。
- 合成测试覆盖九格齐全性、缺格/重复、跨格文件复用/重复原始字节、路径穿越、软链接、超限、错误代理结果、错误 Origin/密钥及输出脱敏；完整仓库 CI 额外使用先前三个真正的审计模块运行合成九对端到端测试。
- **仍为 NO-GO**：需要实际百度自托管/PWA/Electron/商用授权、真实 Loader/瓦片/JS/WASM/字体全量清单和原始响应泄漏证明；Server Owner 会话逐请求授权、生产签名信任根、受审查的固定上游资源规则、Caddy/CSP/Electron 安全隔离，以及 iOS27/Android/Desktop 真机验收。三端继续共用 Gallery Server API、Range、VirtualCollection、Viewer，保留 iOS 27「照片」1:1 基准、52px 全屏 App Frame、百度唯一 Provider 和 Static Server AK / JSAPI Browser AK 的独立配置。

**下一项 A3b2d2b3b2b**：在获得真实被授权的私有网络捕获及许可证明后，对每条 Host/Path/Query/MIME/大小限制执行人工审核和代码审查；缺证据时不开放真实 JSAPI Runtime。之后才实施 A3b3、A4、B1～B3 和 C1。

## A3b2d2b3b2b · 子资源候选规则离线形态校验（2026-10-15）

在 A3b2d2b3b2a #1697 已合入之后，此阶段新增 `internal/baidumapjsapi/child_candidate.go`：只验证人工复核的**候选**子资源规则是否为单一明确的百度 Host、`/_BMapService/` 精确路径、GET、有限 MIME/响应上限、显式固定值或严格界定的非负整数 query，拒绝多值、额外、编码绕过、AK、Token、Callback、遍历及外域。单测中的 `/_BMapService/tiles/0.png` 纯属合成样例，**不是百度实际受许可的子资源路径**。

这里没有加入任何真正子资源到生产 allowlist；`reviewedJSAPI4ChildResourceCount=0`、`runtime_enabled=false` 和生产发布闸门拒绝行为保持不变。代码通过仅代表规则语法可判定，不代表已取得百度合法许可、设备运行实证、Browser AK 不泄露、完整资源清单或真实连续动态地图。

**下一步仍需外部证据才能正式完成 A3**：经真实许可的完整官方资源和账户服务边界；人工逐项复核后把 Host/Path/Query/MIME/字节/超时写入不可由浏览器或设置修改的源码；本地原始上游+浏览器 HAR 私有审计；已钉扎的受信发布根、Owner 持久撤销与配额、Caddy/Electron/PWA 隔离及 iOS 27/Android/Desktop 验收。之后实施共享 Gallery A3b3 动态地图和 A4、B1–B3、C1。百度唯一 Provider，Server Static AK 与 Browser JSAPI AK 分离，保持 52px App Frame 与三端共用图库 API/虚拟化/Viewer。

## A3b3a1 · 真实视窗的 Server Owner 数据底座（2026-10-15）

在 A3b2d2b3b2b #1703 已通过准确 HEAD Final Gate、线性合入并确认相关分支删除后，增加**独立于百度 JSAPI 是否上线**的 `GET /api/v1/media/places/viewport`。四个必选 WGS84 边界分别为 west/south/east/north，支持跨 ±180°、合法两极、(0,0)；limit 默认 64、最大 100、offset 有上限。无客户端自定 SQL/聚合倍数；返回原 A1 的 `place:` 0.01° 单元格 ID、格网中心、**同一真实照片的 GPS 样本对**、每格成员数、视窗精确总格数和不同 PhotoAsset 总数，以及分页/has_more。大范围视窗若截断由客户端提示放大/进一步细分，不假称返回全部 Marker。

新接口始终走原登录 Owner 授权与 A1 一致的 GPS 谓词，查询由请求 Context 控制并有 3 秒上限，响应 `no-store`；不返回图像字节、Browser AK、Server AK、私有原图或具体路径。原有 Gallery Range/虚拟列表/Viewer 继续负责进入照片，三端同一个 API 契约。Go Client 类型接口作为后续 Desktop Agent bridge 前置；本阶段不改任何 Renderer 或 JSAPI Runtime。

**仍未完成**：A3b3a2 共用 MUI 数据源与 Desktop Agent IPC、A3b3 实际连续平移/缩放/标记/聚合，以及真正的百度自托管/PWA/Electron 授权、许可子资源白名单、签名发布、密钥泄漏与真机证明。动态 `runtime_enabled=false` 不变，严格拒绝非百度 Provider。完成 A3 才按用户指定顺序推进 A4、B1、B2、B3、C1。

## A3b3a2a · Web/Mobile Web/Desktop 单一视窗请求与取消链路（2026-10-15）

在 A3b3a1 #1706 准确 HEAD 完整 CI/Final Gate 成功并线性合入后，本阶段通过已有共享 `MediaGalleryDataSource` / `XDriveMediaGalleryPort` 添加可选 `listPlacesViewport`。Web 和 Mobile Web 使用同一 `web/src/mediaGalleryAdapter.ts` 与认证 REST；Desktop 复用经过 `media-gallery` 能力校验的 Electron Preload/Main、按 WebContents 绑定的短视窗请求取消、受认证本机 Agent API、Go Client，最终到达原 Server Owner 视窗查询，不新增照片模型或第二套 Viewer/虚拟列表。

取消仅作用于临时地图请求，立即传到 Go `r.Context()`，不影响上传、下载、同步等持久任务。旧 Agent/Server 能力缺失时明确显示未支持，不允许退化为前 24 个地点或从浏览器读取 100k GPS 全集。保留原本经纬度 WGS84、跨日期变更线、准确总格数/PhotoAsset 数及每页最多 100 格。

**本阶段只交付跨平台数据契约，尚未由实际 MUI 地图组件触发调用，也未启用 JSAPI4：** `runtime_enabled=false`，百度仍为唯一 Provider，Server AK/Browser AK 始终 Server 内加密隔离；依赖真实百度许可、完整人工批准子资源、客户端不泄漏 AK 的原始流量核查、生产发布签名、CSP/Electron/移动端真机验收仍不得绕过。下一步 A3b3a2b 实施 Viewer/视窗状态共享控制、取消与真实图库数据衔接，再完成有许可支持的 JSAPI4 动态交互，之后 A4、B1～B3、C1。保留 iOS 27「照片」1:1 与 52px App Frame。


## A3b3a2b · 三端共享静态相机视窗数据生命周期（2026-10-15）

承接已合入 #1710：在同一个 Web/Mobile Web/Desktop PlacesMap 中，通过现有经过 Owner 授权的 listPlacesViewport 请求，利用百度 Static Map 的手动相机变化近似估算 WGS84 视窗范围，分页查询每页最多 24 个真实地点网格和真实不同 PhotoAsset 总数。跨日期变更线使用 west>east；该矩形是近似静态相机范围，不是精确 BD-09 图片叠加，更不是 JSAPI4 动态标记。点击结果使用既有照片 Range/VirtualCollection/Viewer。

前端在相机/页码变更或组件销毁时立即取消旧短请求，Web REST 和 Desktop Electron/Main/Agent/Go Context 接收同一 AbortSignal；generation、视窗、offset 校验阻止旧响应覆盖当前结果。上次已提交结果需要明确标记过期。地图不可用时原有 Places 列表保留，绝不取消上传下载同步任务。

依然不能开启 JSAPI4 runtime：需真实百度账户自托管/PWA/Electron 使用许可、完整许可子资源不可变规则、真实 AK 原始响应和 HAR 无泄漏证明、固定生产签名信任根、Caddy CSP、Electron 隔离及物理 iOS 27/Android/Desktop 真机验收。先补完整跨 Viewer 返回锚点，再完成安全合规的交互地图/标记/聚合，之后依序完成 A4、B1–B3、C1。必须保留 iOS 27「照片」1:1、52px App Frame 和百度唯一 Provider。


## A3b3a2c · Static 地图、地点分页和 Viewer 返回位置（2026-10-16）

依赖 A3b3a2b #1719 合入后，本阶段由同一 Web/Mobile Web/Desktop MUI PlacesMap 保存短期地图相机 WGS84 中心/zoom、viewport offset、原 Places 根页 offset 和最后打开的 place ID。Viewer 返回或 Desktop/移动端界面切换时仅恢复一个小型 UI 会话锚点，然后重新发起 Owner 认证的有界 Server bbox 查询；数据结果仍来自原 Gallery Range、VirtualCollection 和 Viewer，不在客户端缓存媒体全集，也不宣称地图截图里有精确 BD-09 Marker。

相机快照仅在前端 JS 运行内按用户/服务 scope 保留最多 8 份、10 分钟，输入必须通过坐标/分页/标识符校验；不写 LocalStorage/IndexedDB/URL/Cookie/Service Worker，也不包含 AK、照片原始字节或 EXIF。新地点选择优先新照片坐标，视窗改变取消旧的短请求并重置其分页；恢复后的旧 place anchor 仅在相应 Server 页面返回后滚动定位，避免不存在的 DOM 节点或 100k 全量扫描。根地点列表分页也恢复最近 offset。

**仍为有限百度 Static Server API 体验**：JSAPI4 runtime_enabled=false。只有取得百度自托管/PWA/Electron 的适用许可、真实官方完整 JS/WASM/字体/瓦片子资源人工审查、原始响应与浏览器 HAR 防 AK 泄漏、受信签名发布门禁、Server 用户授权/限额、Caddy/CSP/Electron 安全隔离和真实 iOS27/Android/Desktop 操作及视觉比对后，才能进一步完成动态平移/缩放、Marker/Cluster。随后依次 A4、B1、B2、B3、C1，保留 52px 全屏 App Frame 与 iOS27「照片」1:1 标准。


## A3b3a3a · Native ClusterLayer 的真实 GPS 输入合同（2026-10-16）

在 A3b3a2c #1727 合入后，本次只新增三端共用的静态类型和纯函数层（并非启用地图脚本）：接收已有 Server /media/places/viewport 认证分页输出。仅当该视窗 offset=0、返回全部真实网格、total_count 与 items 长度相等、has_more=false 且单次 <=100 格时，构建可供未来 JSAPI4 层使用的 WGS84 Marker 输入；任何 100k 截断、重复 ID、缺失真实 sample 坐标、实际计数不符、无效/超范围 GPS 和取消均不能被当成成功聚合。0/0 合法，90 度极点仍是合法 GPS，但当前地图无法显示时单独声明不支持；绝不以旧 0.01 度网格中心冒充真实照片点。

百度 JSAPI 4.0 官方 2026/09/30 更新已内置 ClusterLayer（https://lbs.baidu.com/docs/jsapi?title=jsapi4%2Fchangelog）；官方坐标系章节（https://lbs.baidu.com/docs/jsapi?title=jsapi4%2Fguide%2Fconcept%2Fcoord）说明 JSAPI 默认 BD-09，源 GPS WGS84 必须由官方 BMap.Convertor.translate(points,1,5,callback) 转换，不能自行编造偏移。转换仅通过未来许可运行环境注入，不引入百度 JS、Loader、AK 或 URL；批次 <=10、视窗 <=100、每批最多等待 3 秒，取消/回调错误/缺点/NaN 均整体 fail closed。GeoJSON FeatureCollection 只允许转换成功后的 BD-09 点进入未来 native ClusterLayer.setData。内置 ClusterLayer 的聚合气泡计的是地理网格点位数量，不应谎称为实际照片张数；每个单点另外保留 Server 真实 photo_count。

仍为 NO-GO：尚未取得百度账号真实自托管/PWA/Electron/商用许可证据及完整官方资源授权清单；Server 生产路由、Owner 授权/撤销、可信签名、跨副本配额、原始上游及浏览器 HAR AK 无泄漏证据、Caddy CSP、Electron 隔离和 iOS27/Android/Desktop 真机验收均不能由合成测试替代。JSAPI4 runtime_enabled=false；唯一百度 Provider、分离加密 Server Static AK 和 Browser JSAPI AK、52px 全屏 App Frame、共用 Server Range/VirtualCollection/Viewer 保持不变。下一步在合法放行后挂接动态 Marker/ClusterLayer；然后 A4 Nearby、B1/B2/B3、C1。


## A3b3a3b · 三端共用百度 JSAPI4 原生图层生命周期适配器（2026-10-16）

在 #1732 完整通过并合入后，本项增加纯共享 TS 的 **未激活 ClusterLayer 控制器**，供后续合法授权的动态底图接入使用。它仅接受已由 Server Owner 鉴权获取的完整 ≤100 地点网格视窗和经官方 BMap.Convertor.translate(1,5) 校验过的 BD-09 FeatureCollection；不读取 AK、不签发 Cookie、不引入 Loader、不开动态地图、不添加新媒体接口。Web/Mobile Web/Desktop 继续使用一个图库 DataSource、Range、VirtualCollection、Viewer 和 52px App Frame。

官方 JSAPI4 ClusterLayer 使用 setData、addEventListener('click') / removeEventListener('click') 和 fitViewOnClick；点的 isCluster、pointCount 与 properties 必须分别判断。聚合点只请求继续缩放，不能把点数当作照片总数；单点只允许根据当前提交的服务端网格 id+photo_count 查回原 MediaPlaceFacet，再交给原图库打开照片墙，禁止相信前端点击事件自报的对象。

从 movestart/zoomstart 即刻取消旧短请求、清空旧图层；moveend/zoomend 合并一次通知未来可信 WGS84 区域查询，任何 BD-09 getBounds 值不得直接传给要求 WGS84 的 Server。视窗变化、缺数据、转码错误、取消、切换 Viewer 或卸载均阻止旧状态覆盖，释放官方图层监听和 Map layer。不构造第二套照片列表，也不触碰正在运行的上传、下载、同步和持久任务。

**仍未上线 JSAPI4：** 原生 adapter 测试只用 Mock Map/ClusterLayer/Convertor，不是实际百度地图运行或 iOS 27 1:1 UI 验收。当前生产 `runtime_enabled=false`、审核的子资源数 0，尚无实际自托管/PWA/Electron 使用许可、完整真实资源、AK 原始响应与 Browser HAR 防泄漏、Server 签名发布、公有/移动入口跨副本配额、Caddy/CSP/Electron 隔离与 iOS27/Android/Desktop 真机截图证据。未来先以可信 Server 批准的 JSAPI map-session+代理和安全容器接线，再完成真实移动/缩放/聚合，之后 A4、B1、B2、B3、C1。


## A3b3a3c · Server Owner 视窗和 Baidu 原生聚合共享协调器（2026-10-16）

承接 #1734 合入后本阶段仅为 Web/Mobile Web/Desktop 的同一 Gallery 数据源提供一个**未激活**视窗桥接器：真实百度 JSAPI Map/ClusterLayer 仅能由未来许可证和发布门禁认可的独立调用方注入；此阶段不安装 JSAPI、不读取 Browser/Server AK、不新增 HTTP/IPC 或源模型。原有图库 Range/VirtualCollection/Viewer 仍负责地点点开照片墙。

在 JSAPI Map `movestart`/`zoomstart` 即同步 AbortController 取消该地图的短期 Server GET 和已开始的官方 WGS84→BD-09 转码；在 `moveend`/`zoomend` 合并重查，只从已有 Owner 授权的 `listPlacesViewport(bounds,100,0,signal)` 查询**一页**并以精确总地点/PhotoAsset 数区分完整和截断，最多 100 个地点点位。超过阈值要求进一步缩放，不启动全量 100k GPS 拉取，也不假称照片总数为官方 ClusterLayer 的点位聚合数。provider 忽略 AbortSignal 时本地协调器仍立即结算已取消的 Promise。

百度默认地图边界采用 BD-09；新桥接器仅接收显式受审查的未来 WGS84 范围回调，并严格校验四个数值/反日期变更线/0/极地，拒绝把 BMap.getBounds 直接送给 Server WGS84 查询。真实 WGS84 样本经 A3b3a3a 官方转换后的 FeatureCollection 才能交给 A3b3a3b native 层；转换失败、过期、取消、卸载、权限变化都清空地图而非保留过时照片标记。

上述为 Node 模拟层和共享源契约测试，不代表线上真实百度 JSAPI4 已经可用：生产 `runtime_enabled=false`，百度唯一 Provider、Static Server AK 与独立加密 Browser AK 仍仅在 Server。实际自托管/PWA/Electron 商用许可、官方完整子资源 Host/Path/Query/MIME/bytes、上游和浏览器 HAR AK 无泄漏、Server Owner/session/epoch/签名发布/跨副本限额、Caddy CSP、Electron 沙盒与 iOS27/Android/Desktop 物理真机及 1:1 像素/手势检查仍是下一步 A3b3a3d 的独立发布门禁。合格上线后才严格按序 A4 Nearby、B1 地理语义、B2 旅程、B3 位置编辑/隐私、C1 视觉和性能验收。


## A3b3a3d1 · 发布前地图专用会话的 Server Owner 数据底座（2026-10-16）

承接已合入 #1743 的未激活 JSAPI4 Shared Viewport/ClusterLayer，本阶段在 Go Server 增加没有 Router 的私人 baiduJSAPIBootstrapCandidate。它验证服务器配置的 HTTPS 同源地址、精确空正文无参数 POST、唯一签名 Bearer、当前真实 PostgreSQL 用户及会话版本、地图专用持久撤销 epoch 和独立 Browser AK 配置存在性/修订号，不读取 AK 明文，不依赖 Host 或请求自报 UserID。验证失败统一关闭，不泄漏 SQL、原始坐标、Token、上游 URL。

**该候选结果绝不是生产授权。** RuntimeAuthorized 永久为 false，IssueMapSession 必须拒绝；Gin 未开放 POST /api/v1/media/places/baidu-jsapi/session、/_BMapService/ 或任何 JSAPI 资源代理。缺百度适用许可证据、正式全量子资源清单、真实浏览器+Server 上游 HAR AK 无泄漏证据、可信固定签名发布根、跨副本可撤销会话/请求字节配额、Caddy/CSP/Electron 沙盒和 iOS27/Android/Desktop 真机覆盖，因此 JSAPI4 runtime_enabled=false、百度唯一 Provider、Server Static AK 与加密 Browser AK 分离均不变。

下一项 A3b3a3d2 在**实际拿到百度授权证据**后，审核脚本/瓦片/字体/WASM/接口的固定 Host/Path/Query/MIME/超时/响应大小，构建强授权生产 map Cookie/Proxy 和可信签名发布，再进行 Web/Mobile Web/Desktop 原生 JSAPI4 平移、缩放、Marker、ClusterLayer 与既有 Gallery Range/Viewer 连接；最后按用户原序 A4、B1、B2、B3、C1 iOS 27 真机 1:1 验收。xDrive 52px App Frame 和共用后端/虚拟化不改变。


## A3b3a3d2a · JSAPI4 请求头歧义及恶意编码预检（2026-10-16）

承接已合并 #1747，修复未来地图专用会话 POST、子资源 GET 的预检边界：使用逐字段无歧义检查而非 `Header.Get()` 静默取第一个值，拒绝重复/大小写别名/空值的 Origin、Sec-Fetch-Site 等安全相关头及资源凭证头；严格拒绝非法 Query escape、编码路径别名、空强制 Query 和 fragment。Go 测试覆盖正常同源请求与攻击样例，Web/Mobile Web/Desktop 仍共用一个 Gallery 数据源、真实 Owner Range、VirtualCollection 和 Viewer。

**不代表百度动态地图已经开启。** 没有启用任何 JSAPI 路由、Browser AK、Cookie、Loader；`runtime_enabled=false`、零许可子资源和签名发布硬拒绝保持不变。真实百度适用于自托管/PWA/Electron 的授权、九场景私有原始 HAR、完整 Loader/瓦片/脚本/字体/WASM 依赖、钉扎发布公钥、每请求 Owner/撤销/跨副本配额、Caddy CSP/Electron 隔离和 iOS27/Android/Desktop 真机比对仍阻塞 A3b3a3d2。全屏 52px App Frame、百度唯一 Provider、分离的 Server/Browser AK 和 iOS 27「照片」1:1 目标不变，后续按 A3→A4→B1→B2→B3→C1。


## A3 · 三端共用百度静态地图的双指误拖修复（2026-10-16，JSAPI4 仍 NO-GO）

在共享 `MediaGalleryBaiduStaticMap` 中新增双指距离记录、离散缩放与多指误拖保护，只有手势结束后才提交一次整数 zoom，图片请求仍由现有 AbortController 取消、Server Static PNG 加载，Owner GPS 范围查询/照片集合复用原 DataSource、Range、Viewer。按同一组件覆盖 Web、Mobile Web、Desktop，避免手机双指造成单指平移或连续向服务器发起图片请求。无效距离、取消手势、第三指、尾指抬起不能修改相机；0/0 真实 GPS 不变。

此阶段属于当前静态地图体验修复，**不是** iOS 27「照片」1:1 原生连续 Pinch/百度 JSAPI4 Marker/Cluster 正式交付。只有在百度 self-host/PWA/Electron 实际许可、全量官方资源人工批准、九场景私有网络无 AK 泄漏、受信发布签名/Owner 撤销/配额/CSP/Electron/真机验证后方可启用真实 JSAPI4。保留 52px 全屏 App Frame、唯一百度 Provider、Server AK/Browser AK 各自加密仅 Server、三端共享图库。A3 完成才进入 A4、B1、B2、B3、C1。


## A3b3a3d1b · 百度 JSAPI4 官方构造器纯适配（2026-10-16）

承接已合并 #1759，新增三端共享 TypeScript 的未激活 BMap 原生接口适配。未来只能由独立获准的官方 JSAPI4 容器提供 Map、ClusterLayer、Convertor、Point；本阶段校验官方入参和方法，复用原 Owner viewport/ClusterLayer 和 Server Range/VirtualCollection/Viewer。不创建第二套 Mobile Web 或 Desktop 地图后端；测试中的 Mock BMap 既不是许可凭据，也不是运行授权。坐标只能通过官方 Convertor.translate(points,1,5) 处理 WGS84→BD-09，不能把 BD-09 getBounds 直接发给 Server WGS84 API。

此模块没有生产调用方、没有第三方 JS SDK 加载、Cookie、Browser AK 前端注入、百度上游请求或新路由。runtime_enabled=false、0 条已批准 JSAPI 子资源规则、生产签名根未配置，仍 NO-GO。A3b3a3d2 需要真实 self-host/PWA/Electron 商用许可、完整上游脚本/瓦片/WASM/字体白名单、九场景 HAR 原始字节防泄漏审核、受信签名、Owner/跨副本配额/CSP/Electron 隔离及真机实证。保留百度唯一 Provider、Server AK/Browser AK 服务端独立加密、52px 全屏 App Frame、iOS27「照片」1:1 标准。达到实际 A3 动态地图发布门禁后再实施 A4、B1、B2、B3、C1。


## A3b3a3d1c · 百度原生地图与三端 Owner 视窗端到端预集成（2026-10-16）

继续 #1763 之后，为 Web/Mobile Web/Desktop 共用 Gallery 新增仅供未来被单独授权的 Baidu JSAPI4 运行环境使用的 TypeScript 组合入口。其组合已有官方 Map/ClusterLayer/Convertor/Point 适配器和统一 Owner 视窗桥接器，仍复用同一 Gallery Server Range、VirtualCollection 和 Viewer。Node 模拟测试从官方构造器开始，验证第一次真实 GPS(0,0) 查询、限额 100 个地点网格、官方 WGS84→BD09 变换、聚合标记、正确地点点开照片集合、开始拖动时取消旧 Go 视窗请求、过期结果不回写、退出销毁全部事件/图层。

**未上线 JSAPI4**：目前不调用这个组合入口，也没有 BMap Loader、代理路由、地图 Cookie、Browser AK、GPS 持久化。BD09 的 BMap.getBounds 不能充作 Owner WGS84 范围；仍要求一个经许可和坐标正确性审查的 WGS84 包围盒来源，没有便擅自推进真实动态地图。生产 runtime_enabled=false、零已审核 JSAPI 子资源、未配置钉扎签名根保持 NO-GO。需要独立百度 self-host/PWA/Electron 许可、完整实际脚本/瓦片/WASM/字体白名单、九场景私有 upstream/browser 原始 HAR 防 AK 泄漏、受信发布签名、Server Owner/撤销/配额与 Caddy CSP/Electron 隔离及 iOS27/Android/Desktop 真机证据。保留百度唯一 Provider、Server AK/Browser AK 服务端独立加密、52px 全屏 App Frame、iOS27「照片」1:1 标准；A3 真正完成后才开始 A4、B1、B2、B3、C1。


## A3b3a3d2b · 百度静态地图跨端连续画面交接（2026-10-16）

在 #1770 合入后，修正三端共享 `MediaGalleryBaiduStaticMap` 每次更改相机立即清空图片造成的闪白：同一地点的新 PNG 加载期间，只保留上一张已成功的服务端百度 PNG 并以淡化及“上一视窗 · 正在更新”标明过期，绝不将旧地图坐标冒充当前 GPS。加载成功后切换并释放旧 Blob URL；切换不同地点/权限关闭、请求失败时不显示过时地图；过期请求、卸载严格释放 Blob。Node React 交互回归覆盖相机切换、旧请求取消、跨地点隐藏、(0,0)真实 GPS 和 URL 回收。

此项仅改善现有 Static Map，不是 iOS27 Photos 1:1 原生地图、不是 JSAPI4 平移/聚合功能上线。保留全屏 App Frame、52px 全局标题栏、百度唯一 Provider，Server AK/Browser AK 独立且只在 Server，Web/Mobile Web/Desktop 一套 Gallery DataSource、虚拟化、Viewer 与 Go Server Range。真实百度 JSAPI4 仍须 self-host/PWA/Electron 许可、完整子资源及九场景真实 upstream/browser HAR 脱敏审查、签名放行、Owner 撤销配额、Caddy CSP/Electron 沙盒、iOS27/Android/Desktop 真机验收；运行保持关闭。后续遵循 A3 → A4 → B1 → B2 → B3 → C1。


## A3b3a3d2c · 三端共用静态地图双指焦点稳定（2026-10-16）

承接已合入 #1780，修复原先二指缩放默认以图片中心而非双指焦点缩放的跳动。共享 `media-gallery-baidu-camera.ts` 的 WGS84 Web Mercator 相机计算以手指初始/结束屏幕中点为锚，保持地图照片的大致视觉焦点；两指同向移动可在松手后进行一次有界平移。响应式元素真实边界转换为 480×280 的静态 PNG 逻辑相机，不在每次 PointerMove 调用百度；取消/第三根手指、过大移动、未变更手势、切换地点均不得产生误操作。纯函数测试和实际共享 React 手势测试覆盖 0/0 GPS、经度跨 180°、缩放焦点、平移、旧请求 AbortSignal 与单次 Server 请求。

该近似只能用于已有 Server Baidu Static PNG 相机，**不能**拿来替换百度官方 BD-09 JSAPI4 动态地图、真实 WGS84 逆变换或 iOS27「照片」1:1 像素/手势验收。独立 Server Static AK 和 Browser JSAPI AK 继续只在 Server 加密使用、百度唯一 Provider、52px 全屏 App Frame、Web/Mobile Web/Desktop 同一图库请求/虚拟化/Viewer；动态 JSAPI4 生产发布硬 NO-GO，仍需账户许可、完整经审查子资源、九组真实 browser/upstream HAR 无 AK 泄漏、受信签名、Owner 撤销和配额、Caddy/Electron 隔离及真实 iOS27/Android/Desktop 验收。A3 完成后再进入 A4、B1、B2、B3、C1。


## A3b3a3d2d · 避免百度 BD-09 视窗被误当成真实照片 WGS84（2026-10-16）

根据百度官方 JSAPI4 [坐标系说明](https://lbs.baidu.com/docs/jsapi?title=jsapi4%2Fguide%2Fconcept%2Fcoord)和 [Geoconv v2 转换方向](https://lbsyun.baidu.com/docs/webapi?title=geoconv%2Fguide%2Fchangeposition-base)，境内地图默认使用 BD-09；官方支持原始照片 WGS84 → BD-09 标点，却不支持 BD-09/其他坐标系向 GPS 的反向转换。绝不能将 BMap.getBounds 返回值、手算近似逆变换或客户端自行声称的地图坐标直接作为原始 GPS 传入 Server /media/places/viewport，否则地点总数、附近照片与 Viewer 可能错误。

本阶段针对既有 **尚未接入生产** 的共享 JSAPI4 Owner 视窗桥接器增加显式且严格的坐标标记：输入必须为 coordinate_space='photo-wgs84' 且 bounds 只有 west/south/east/north，拒绝原始 BD-09、GCJ02、无标记、额外字段和非法范围，拒绝时不请求 Server、不创建照片 Marker。该标记只是**接口契约防误用**，不构成许可、安全来源或 WGS84 真实性证明。后续真正动态地图推荐在获得百度账户许可且确认衍生坐标保留合法后，以原始 WGS84 照片位置经过官方 WGS84→BD-09 正向转换建立有版本、Owner、隐私、删除/撤销同步的 **BD-09 查询索引**；地图视窗基于 BD-09 查索引，Viewer/Range 仍使用原有 PhotoAsset 身份与原始 GPS，绝不执行 BD-09→GPS。授权未确认前不创建或填充该索引。

A3 的 Provider 仍仅百度，AK 两种分别服务端加密，生产 JSAPI4 运行/资源代理/地图 Cookie 不启用。Web、Mobile Web 和 Desktop 共享 Server 请求、虚拟列表、图库 Viewer，52px 全屏 App Frame 不变；iOS 27「照片」1:1 仍需逐页真机截图、手势、暗/亮主题、横屏和性能验收。真实百度自托管/PWA/Electron 许可、完整 Loader/tiles/JS/WASM/fonts 经审查清单、真实九组 browser/upstream HAR 无 AK 泄漏、签名放行、Owner 撤销/配额、Caddy CSP/Electron 隔离均未完成。A3 真正完成后再依次 A4、B1、B2、B3、C1。


## A3b3a3d2e · 已运行的百度静态底图请求参数严格校验（2026-10-16）

这次修复生产中由 Web、Mobile Web、Desktop 共用的 Server `/media/places/baidu-static` 请求，而不是新增无调用方的 JSAPI4 Mock。之前 Go `URL.Query().Get()` 会在用户传入重复经纬度参数时选择首值，也会静默舍弃坏百分号 escape。改为原始 Query 强校验：五个固定参数 lat/lng/zoom/width/height 各一次，无扩展 AK/token/url、无大小写或百分号编码别名、无非法/空段、无异常 RawPath/Fragment；保留真实 0/0 GPS 和正常极小坐标科学计数法。所有无效输入 400 返回，不占百度上游配额也不触发网络；增加伪 HTTP transport 实测验证。原有配额、超时、取消、Server-only AK、PNG 响应和三端单一接口保持不变。

这项是**真实 Static Map 请求安全性**，不是百度 JSAPI4 动态地图发布。正式 JSAPI4 仍要依法完成 self-host/PWA/Electron 许可，完整子资源清单、九组私有 Browser/Upstream HAR 无 AK 泄漏、受信签名、Owner/撤销/跨副本额度和 Caddy/Electron 沙盒及 iOS 27「照片」1:1 真机验收。运行硬门禁未解除；地图仅百度，Web/Mobile Web/Desktop 共享 Gallery Range、VirtualCollection、Viewer，保留 52px 全屏 App Frame。待 A3 真正完成后，再依次实施 A4、B1、B2、B3、C1。


## A3b3a3d2f · 已运行的百度静态地图上游禁用环境代理（2026-10-16）

加固 Web/Mobile Web/Desktop 共用的 Server 百度静态 PNG HTTP 客户端。过去 Go 默认 Transport 可能继承 `HTTPS_PROXY` 等环境变量，将带 Static Server AK 和用户原始 GPS 的百度 HTTPS 请求转交给未审查的代理。改为复用一个严格 TLS 校验的连接池，明确 `Proxy=nil`、禁用自动响应压缩、限定最多三个上游连接和短期空闲回收；保持 5 秒超时、禁止重定向、原始百度固定 Host、Owner 限额、可取消 Go Context、3MiB PNG 校验、静态 Server AK 不返回客户端。Go 测试通过恶意环境变量和注入的离线 HTTP Transport 验证。

**与真正 JSAPI4 动态地图分开验收**：这属于现有运行中的静态底图 AK 泄漏面修复，不能凭此认为百度已经授予自托管/PWA/Electron 商业许可，也不建立任何 JSAPI 资源代理或持久 BD09 衍生数据库。JSAPI4 继续 `runtime_enabled=false`、无审核通过的完整子资源清单/生产受信签名根；真实 9 组 Browser/Server HAR 证据及 AK 无泄漏、逐请求 Owner 认证和跨副本配额、Caddy/Electron 隔离、iOS27/Android/Desktop 真机仍是 A3 硬条件。保留百度唯一 Provider、Server/Browser AK 独立服务端加密、52px 全屏 App Frame、三端共享图库 Range/VirtualCollection/Viewer；A3 实际完成后再实施 A4、B1、B2、B3、C1。


## A3b3a3d2f · 三端 Static 地图严格使用真实照片 GPS 样本（2026-10-16）

在已合入的 #1794 请求参数严格校验、#1800 Static Server AK 直连安全修复及 #1799 Mobile Collections→Place 首批照片授权提交之后，继续解决共享 MUI 静态地图的剩余坐标真实性问题：旧 Server/Agent 的地点 DTO 只有 `latitude/longitude`（0.01° 网格中心），没有 `sample_latitude/sample_longitude`（同一张真实照片的 GPS）。旧共享组件在缺少样本坐标或只有半对样本时回退到网格中心，会将虚构的经纬度拼接后发给百度，违反 A1。

新共享 `MediaGalleryBaiduStaticMap` **只**接受完整的真实代表照片 GPS 样本对，或者 Viewer 已持有的真实照片 `location`。样本缺失时静态底图保持原区域和明确的 Server/Agent 版本提示，但**绝不发送原网格中心、不得经其他 Provider 兜底**；已开始的视窗请求随样本失效而取消，避免复用旧相机。保留合法真实 GPS (0,0)；失效地图不得吞掉 Mobile Web 页面滚动或提供无效的键盘焦点。增加共享组件真实 React mount/regression，覆盖旧 DTO、半对样本、(0,0)、取消和 Viewer 坐标，不改变真实图库 Range、100k 虚拟化、Desktop Agent 通道或 52px App Frame。

这是**真实运行的 Static Server API 的正确性修复**，不等于 JSAPI4 资源许可、原生平移/聚合或 iOS 27「照片」1:1 交付。生产 JSAPI4 继续 runtime_enabled=false、零实际审核子资源、无可用 Loader/Proxy/Map Cookie；Browser AK 与 Server AK 分别加密仅 Server，必须先取得百度 self-host/PWA/Electron 适用账户许可、完整真实九场景隐私 HAR、不可变子资源白名单、信任根和 Owner 配额/CSP/Electron/真机证据。A3 真正验收通过后再按原序 A4→B1→B2→B3→C1。


## A3b3a3d2i · 百度原始照片 GPS 强失效派生索引底座（2026-10-16）

根据 #1825 的 Server-only 官方 Geoconv v2，新增空的 `BaiduPhotoMapPosition` PostgreSQL 派生坐标表及私有只读范围查询。每条记录关联 Owner + PhotoAsset + 原始主 Node/Node revision + MediaMetadata 更新时间 + 精确原始 WGS84 GPS + 显式 BD09/WGS84 地图坐标空间和固定转换版本。读取先校验账户有效、源 Node 未删除、PhotoAsset 仍属于 Owner、原始 GPS 与索引源坐标完整匹配、媒体状态 Ready；任何删除/修订变化都将派生点即时隐藏，后续清理还可物理回收。查询必须 Owner 隔离、真实总数、最多 100 条、严格坐标边界及日期变更线。只有未来独立审核的生产后台才可按照隐私许可生成索引、限流同步和删除；本阶段**没有任何新照片坐标外发，没有 public map API、无新前端、无用户数据 backfill**。

此项不是 A3 动态地图已上线：百度唯一 Provider、Server Static AK 与加密 Browser AK 分离、runtime_enabled=false、真实九组私有浏览器/上游 HAR 和经人工核准的 JSAPI4 child 清单、可信签名/Owner 撤销/跨副本配额/Caddy/Electron 安全和 iOS27/Android/Desktop 真机均需独立验收。绝不将百度原生 BD09 视窗当 WGS84，也不得将虚构网格中心作为实际照片位置。保留全屏 52px App Frame，Web/Mobile Web/Desktop 同一 Gallery Range、虚拟化和 Viewer，A3 完成后才进入 A4→B1→B2→B3→C1。


## P0-Places-A3b3a3d2j · 原始 GPS/Owner/隐私同事务写入闸门（2026-10-16）

在 #1830 的严格 Owner/原始 GPS 验证派生空间索引之后，增加仅供未来后端索引器调用的私有事务写入/撤销删除能力。需锁定真实有效 Owner、PhotoAsset、主文件与媒体定位修订，确认当前源 GPS 与候选一对精确一致、投影坐标有限且标注正确，再由受信服务端独立检查当前用户定位分享/索引隐私策略；该核验必须和写入处于同一 PostgreSQL 事务。失败绝不部分更新，Owner 定向删除保留，旧源版本在查询中继续被拒。此阶段只交付内部写入安全合同和合成 PostgreSQL 回归，**没有任何新 API/Viewer/网络发送**，也不会向百度导出用户真实坐标。

后续先完成真正可撤销的 Server 端隐私策略、跨副本 Geoconv 配额及带原照片修订的工作队列，再对接准确 BD-09 Native Map 有界视窗、Marker/ClusterLayer 和已有 Gallery Range/Viewer。仍禁止 BD09→GPS 逆变换、网格中心冒充照片 GPS、100k 全量 DOM 和另一地图源。JSAPI4 runtime_enabled=false、核准子资源 0、真实九组双端 HAR 与受信发布、iOS27/Android/Desktop 真机均未验收；保留 52px 全屏 App Frame 及 Web/Mobile Web/Desktop 同一图库数据源、虚拟化组件和 Viewer。A3 后才推进 A4、B1、B2、B3、C1。


## A3b3a3d2k · 默认拒绝的定位授权、撤销与读时版本闸门（2026-10-16）

承接已合入 #1833 的内部百度 BD-09 索引原语，本阶段先增加**默认拒绝的独立 per-PhotoAsset PostgreSQL 隐私授权记录**，索引使用与向百度 Geoconv 发送原始 GPS 分别显式授权。缺记录、禁用、到期、撤销或修订号不匹配均不得返回派生地点标记，且旧索引不能在授权更新后自行复现。真实写入必须同时通过 Owner/Node/媒体原始 GPS 的事务锁、持久授权行锁及原有独立隐私回调。服务端内部撤销使用修订号 CAS 并在同事务删除派生位置；源 WGS84 不受影响。

没有任何自动授予授权、浏览器控制接口、外传请求、后台地理索引任务或 JSAPI4 生产 Loader/Cookie/Proxy；只有离线和 PostgreSQL 测试。JSAPI runtime_enabled=false、资源审核数 0，真实九组 HAR / 正式发布信任根 / 配额及三端真机门禁仍未通过。后续需设计授权发布和编辑 API、隐私审计/保留期限、配额、源版本刷新索引及正式百度 JSAPI4 动态地图；再进入 A4、B1/B2/B3、C1 iOS27「照片」1:1 验收。保留 52px 全屏 App Frame 与 Web/Mobile Web/Desktop 共用 API、虚拟列表、Viewer。


## A3b3a3d2l1 · 后端私有定位授权签发/续期原语（2026-10-16）

#1840 的 per-PhotoAsset 位置授权已基于准确 HEAD 全量 CI 成功合入。本阶段只补充内部可测试、尚无生产调用方的**授权签发和续期事务**：当前 Owner、真实原始 WGS84/Node/MediaMetadata 修订号与授权修订号必须在同一 PostgreSQL 事务内锁定，验证当前用户独立的明确授权决定；准许的期限 5 分钟至 30 天，过期、旧身份或错 Owner 一律拒绝。每次新授权或更新都会清理旧的 BD-09 派生位置并递增 consent revision；审计失败一并回滚，无原始位置或 AK 进入审计。独立 PostgreSQL 测试并非用户真的授予过许可；仍没有 HTTP 签发路由、前端同意操作、任务队列或百度 GPS 出站。

后续必须实施真实 Owner 登录状态校验、角色权限和 CSRF/同源保护，添加 Web/Mobile Web/Desktop 共用的授权读取/修改/撤销交互与 Adapter/Agent 运输，再做跨副本 Geoconv 配额、可取消索引任务和正式 JSAPI4 子资源代理。仍拒绝产品态开启 runtime_enabled=false、0 reviewed children，无真实 9 组 HAR、签名信任根和真机 iOS27/Android/Desktop 证据前不得放行。iOS 27「照片」视觉与交互 1:1、52px 全屏 App Frame、百度唯一 Provider 以及共享图库 Range/VirtualCollection/Viewer 均保持不变。


## A3b3a3d2l2a · 将定位授权绑定到具体原始 GPS 修订（2026-10-16）

#1845 已通过准确 HEAD 76-job CI/final-gate 并 Rebase 合入。本阶段修正用户授权持久化中缺少 GPS 来源指纹的隐患：新增原始照片主 Node、NodeRevision、MediaMetadata 更新时间及原始 WGS84 latitude/longitude 对的授权快照。允许的授权只能来自同事务锁定的当前照片及用户明确授权；原有未绑定来源的旧授权必须失败关闭，不迁移为自动有效。后续地点索引写入和查询都同时验证照片来源版本与授权版本，照片 GPS 修改后必须再次得到用户授权才能重新派生 BD-09。测试覆盖正常 0,0、编辑 GPS 后旧授权拒绝、明确再授权、撤销/审计回滚及严格查询总数。

这里不新建公开授权 HTTP、移动端图库、JSAPI4 Loader/Cookie/Proxy，也不会让 Server 读取或向百度发送真实用户坐标。动态地图仍 `runtime_enabled=false`，待真实账户/九组私有上游+Browser HAR、人工签名审核、完整资源白名单和 Web/Mobile Web/Desktop 真机之后才能 GO。接下来先完成被 Owner/session 严格认证的显式授权读写接口，再在唯一共享 MUI Gallery / Range / VirtualCollection / Viewer 上完成三端对等；之后 A4→B1→B2→B3→C1，维持 iOS 27「照片」1:1 目标和 52px App Frame。


## A3b3a3d2l2b1 · 当前用户显式地图定位授权 API（2026-10-16）

在 #1851 精确 GPS 来源绑定通过准确 HEAD CI 合入后，新增 GET/PUT/DELETE /api/v1/media/items/:id/baidu-map-consent。只接受经过 Bearer 登录与最新 SessionVersion 检查的 Owner 主 Node/PhotoAsset，PUT 必须显式确认「允许将此照片原始坐标发送至百度用于地图坐标转换」与「允许建立派生地图索引」，同时要求授权修订号及 10 分钟到 30 天的有效期。不接收任何前端 GPS/AssetID/OwnerID，更不会将存储的原始坐标/密钥返回给浏览器。原始定位改动后，旧许可失效；授权新版本由当前 Server PostgreSQL 同事务锁核对。DELETE 使用 If-Match CAS、审计事务和索引清理，审计失败整个事务回滚；同一用户的软删除文件仍允许撤销。CORS Origin 和 Fetch Metadata 单独严格校验，Desktop Native Agent 可用自己的 Bearer 客户端认证。

这一阶段仅为 Go Server 用户授权协议及真实 PostgreSQL 测试；尚未连上 Go Client、Desktop Agent IPC 或 Web/Mobile Web/Desktop 的同一 MUI 位置授权 Dialog，亦无任何实际百度 Geoconv/JSAPI Loader/子资源代理/GPS 发送。位置授权开启不等于地图加载或获得用户已实际使用地图的许可。后续先完成共同 TS 数据模型/Agent 运输/共享 Viewer 控件，再做有界可取消 Geoconv 工作队列与百度 JSAPI4 生产资源白名单、签名发布及 9 组私有双端 HAR。保持百度唯一 Provider、Server AK/Browser AK 仅在 Server、iOS 27「照片」1:1 交互验收及 52px 全屏 App Frame，顺序 A3→A4→B1→B2→B3→C1。


## A3d2l2b2 · Web/Mobile Web/Desktop 共用定位授权与 Viewer 控件（2026-10-16）

#1857 的真实 Server 授权 GET/PUT/DELETE 以准确 HEAD CI 合入之后，本阶段使用 `ui/shared` 唯一的 `MediaBaiduMapConsent` 和 `MediaGalleryDataSource`，经 Web/Mobile Web/PWA 同一 Web API + Adapter 与 Desktop Go Client→受信 Agent→独立 IPC→Electron 预加载接入。Viewer「照片位置」共用 MUI 对话框，新定位授权默认不勾选、必须明确同意向百度发送原始 GPS 转换及 xDrive 地图派生索引两项，手动授权一小时，修订号 CAS 撤销；切换照片时不会将旧异步响应带到新照片。

**用户授权不等于百度 JSAPI 4.0 动态地图可用**，当前仍只有原有 Static PNG 底图和惯有位置导航；不新增实际 Geoconv/JSAPI4 Loader/Cookie/Proxy/未审核第三方资源。iOS 27「照片」逐页 1:1 视觉、手势、暗色、横屏、无障碍和 iOS27/Android/Desktop 真机，以及 100k/网络取消仍需独立通过，不能用静态假数据冒充。百度是唯一 Provider、AK 全部 Server-only、52px 全屏 App Frame 不改。下一项：正式可取消源修订绑定 Geoconv 索引队列与跨副本配额、安全代理和 9 组双端私有 HAR/发布签名审查，之后 A4→B1→B2→B3→C1。


## A3d2m1a · Server 百度 Geoconv 跨副本双层配额（2026-10-16）

在 #1865 Web/Mobile Web/Desktop 共用照片位置授权已由准确 HEAD 76-job CI 合并后，进一步加入**独立于 JSAPI4 加载资源**的 `BaiduGeoconvQuotaBucket`。一份 fleet 全局配额与每位有效 Owner 配额在同一 PostgreSQL 事务、固定先全局后 Owner 的锁顺序下预约，使用数据库钟的分钟窗口并累计「请求数」与「源坐标点数」。采用保守的工程保护（每 Owner 2 请求／20 点／分钟；fleet 20 请求／200 点／分钟；每批最多 20 点），这些不是对百度真实 SKU、价格和许可额度的验证。两个独立数据库连接池的真实 PostgreSQL 并发回归要求无超卖、失败不扣全球预算、月/分钟窗口不得由 Server 时钟重绕，丢表必须拒绝。

本阶段 **仅提交私有、未被生产调用的配额原语和迁移**，无需访问百度、无需 AK、不发送或保存任何用户 GPS、无需浏览器权限或新地图源。下一步必须把当前源 PhotoAsset、Owner、原始 WGS84、Node/媒体修订与有效且未被撤销的转换授权安全绑定到可取消的 Server 索引任务，再核对百度账号真实限制之后才考虑向官方固定 HTTPS 端点发送数据。JSAPI4 动态 Loader/Proxy/Session 仍禁用，子资源审核 0，9 组真实私人 Browser/上游 HAR、发布签名和 iOS27/Android/Desktop 真机验收未完成。保持现有 iOS 27「照片」1:1 目标、52px 全屏 App Frame、百度唯一 Provider、三端共享图库 Range/虚拟化/Viewer，顺序 A3→A4→B1→B2→B3→C1。


## A3d2m1b1 · 跨 Server 持久定位索引意图与取消租约（2026-10-17）

在 #1870 的独立 Geoconv 配额通过完整 76-job CI 合入后，本阶段加入 **Server-only** 的 `BaiduPhotoMapIndexIntent`（每 PhotoAsset 一条，持久状态 `queued/leased/cancelled`）。严格以数据库读取当前 Owner、PhotoAsset、主 Node 版本、MediaMetadata 更新时间和原始经纬度及有效且未撤销的双方确认授权；任务只保存来源版本、授权修订号、会话版本和 20 秒 PostgreSQL 时钟租约，不复制 GPS、照片路径、AK 或坐标转换结果。并发重复入队幂等，两独立 DB 连接池争抢只允许一个租约；租约失效、取消、撤销、会话变化后均不能继续通过二次验证；最多 3 次领取。真实 GPS (0,0) 合法，绝不以地点网格中心冒充照片原始坐标。

**当前边界：这是持久化、安全领取与撤销前置阶段，不是已上线的后台索引器。** 没有公开 API/自动后台提交、实际 Geoconv 外发、BD-09 派生写入、前端 JSAPI Loader/Proxy/地图 Cookie、第二地图 Provider，也不收取生产配额；用户的既有静态百度地图不受影响。下一项 A3d2m1b2 才将授权需求与可取消 Server Worker 接线，并加入实际许可证/账户限额、索引完成 CAS、派生位置事务与真正出站前再次检查。JSAPI4 依然 `runtime_enabled=false`、人工审批真实子资源数 0；九组原始私有 Browser/Server HAR、固定签名发布根、CSP/Electron/PWA 及 iOS27/Android/Desktop 实机逐项 1:1 视觉手势验收均不可跳过。Web、Mobile Web 和 Desktop 持续共享 Server Range、VirtualCollection、Viewer 和 52px 全屏 App Frame，按 A3→A4→B1→B2→B3→C1 推进。


## A3d2m1b2a · 可取消的私有单任务执行及原子完成收据（2026-10-17）

承接 #1877 已合入的 `BaiduPhotoMapIndexIntent`，增加 **Server 内部、显式调用、单张照片** 的 `executeBaiduPhotoMapIndexIntent`。执行前后多次核验当前 Owner/Session/PhotoAsset、主 Node、Ready Media、原始 WGS84 GPS 和未过期未撤销的精确授权修订，并校验真实跨副本 DB 租约；向受信转换器传递最长 8 秒的 Go Context。另一个 Server 取消任务、撤销位置许可、修改源或轮换会话后，250ms 有界轮询使正在等待的转换器收到 `ctx.Done()`；即使伪造的无视取消回调返回成功，最后的 PostgreSQL 事务也必须同时完成真实 BD-09 派生点写入与任务 `completed` CAS，失败时均回滚。过期、取消、来源错误或不合法 BD09 不得生成位置；旧取消不会倒退已经完成的任务。真实 PostgreSQL 双连接池测试仅用合成转换结果，(0,0) 仍是合法原始 GPS。

**本阶段不是已经上线的百度地图索引服务。** 无生产许可放行器、无真正百度上游请求、无 Server AK 注入、无启动时任务扫描、无对外任务 REST、无 JSAPI Loader/Proxy/Cookie，既有静态百度 PNG 无影响。下一步 A3d2m1b2b 需真实百度账户服务条款/额度核验、固定 HTTPS 上游、跨副本配额、认证 Owner 显式入队与取消、完成/失败重试观测和实际可取消 Worker 集成；JSAPI4 自身仍需 9 对私有上游与 Browser HAR、受审查固定子资源白名单及签名、CSP/Electron/PWA 和 iOS27/Android/Desktop 逐项 1:1 真机验收。继续百度唯一 Provider、独立加密 Server/Browser AK、52px 全屏 App Frame、三端统一 Range/VirtualCollection/Viewer，不冒充正式发布。后续严格 A3→A4→B1→B2→B3→C1。


## A3d2m1b2b1 · Owner 显式索引任务 REST 传输，不触发百度出站（2026-10-17）

承接已合入 #1882 的 Server 单任务可取消执行器，本阶段在现有 Gallery 主 Node 身份上新增经 Bearer 登录的 `GET/POST/DELETE /api/v1/media/items/:id/baidu-map-index-job`。POST 必须具备**独立的确认**、当前照片有效期内两个位置授权、真实源 Node/Media/PhotoAsset 与精确授权修订；任何浏览器主动提供 GPS、AK、Owner/Asset ID、未知 JSON 字段或伪 Origin/跨站 Fetch-Metadata 均不接受。任务仅持久化 Owner 和既有受信来源修订标识；GET 只返回状态、授权修订、尝试次数和常量 `dispatch_enabled=false`。DELETE 采用 `If-Match` 撤销指定代任务并使现有租约失效；提交和取消的审计失败都在同一 PostgreSQL 事务里回滚，不允许成功误报。匿名、越权、过期旧 GPS、会话变化、取消/重复入队均有真实 PostgreSQL/Gin HTTP 测试；对包含 WGS84 筛选谓词的 POST/DELETE 事务关闭 GORM 原始 SQL 日志并由测试捕获器验证，防止失效授权把 GPS 记录到诊断日志。实际百度配额和衍生坐标保持零。

**A3 仍为 NO-GO**：这一段只增加经鉴权的持久任务 API，不启动 Server Worker、不读取百度 AK、不触发真实 Geoconv、不安装 JSAPI Loader/Proxy/Cookie、不向外发 GPS。Web、Mobile Web/PWA、Desktop 的图库页面尚未挂接该新任务入口，因此三端现有 Range/VirtualCollection/Viewer、52px 全屏 App Frame 和当前静态地图维持一致；下阶段 A3d2m1b2b2 才将共享类型/Adapter/Agent IPC 与真实用户操作、受许可的后台 Worker 接通，并完成当前账户费率、有效许可、九组私有原始 HAR、不可变签名子资源、CSP/Electron 安全评估后方可启用真正的 JSAPI4 动态地图。保持百度唯一 Provider、Server AK / Browser AK 独立服务端加密、iOS27 Photos 明确 1:1 视觉和手势基准，后续顺序 A3→A4→B1→B2→B3→C1。


## A3d2m1b2b2a · 共享定位索引任务前端与桌面受信传输（2026-10-17）

承接 #1888 的 Owner 授权、修订号约束与审计 REST，新增统一 `MediaBaiduMapIndexJob` 状态 DTO 和显式 `expected_revision + confirm:true` 入队请求。Web/Mobile Web/PWA 使用同一 `web/src/api.ts` 和 shared `MediaGalleryAdapter`，Desktop 通过 `internal/client` → authenticated Go Agent loopback → Electron Main 输入校验 → preload → Renderer Adapter，调用同一 Server Owner PhotoAsset 的主 Node GET/POST/DELETE 路由。取消任务使用任务本身的 `consent_revision`，终态不会被旧取消错误回退。可见状态仅含 `not_queued/queued/leased/completed/cancelled`、尝试次数、修订号、`dispatch_enabled=false` 和 `blocked_pending_licence_and_provider_review`，不包含原始 GPS、AK、派生 BD09 或租约凭据。

图库原来的 `MediaGalleryViewerLocationDialog` 是**三端唯一**地图隐私与索引任务操作面。两项授权不等于入队；用户必须额外明确勾选，才允许单张照片加入队列。对未启用调度的环境明确说明「已排队不等于转换成功」，允许取消及手动刷新，不进行后台轮询。仅打开照片位置时读取，不影响 VirtualCollection、Range 或 Thumbnail 网络加载；关闭或切换照片通过 generation 拦截异步旧响应。保留 xDrive 全屏 App Frame、52px 应用标题栏、Web/Desktop 后端 API 以及 iOS 27「照片」1:1 视觉和手势对照目标。

**安全边界与剩余工作：** 本阶段仍不接入真正的百度坐标转换 Worker、真实账户许可和配额验证、不发送原始 GPS、不提供 Browser AK、不打开 JSAPI4 Loader/Proxy/Cookie、不加载任何未经审计的动态资源。生产 `runtime_enabled=false` 与原静态 PNG 地图保持不变。后续 A3d2m1b2b2b 必须独立取得正式许可、账号/配额证据、Server-only HTTPS Geoconv 可取消调度与失败重试，再对 JSAPI4 进行九组私有浏览器/上游 HAR 配对、完整不可变签名子资源白名单及 Caddy/Electron/PWA/iOS/Android 真机 1:1 验收。A3 仍未完成，之后顺序 A4→B1→B2→B3→C1。


## A3d2m1b2b2b1 · 独立许可检查 + 跨副本 Geoconv 配额的私有一次性执行边界（2026-10-17）

#1908 的三端显式照片任务 GET/POST/DELETE 和统一 Viewer 已通过准确 HEAD 76-job CI/final-gate、Rebase 合并并独立确认相关旧分支消失。承接既有 Server `executeBaiduPhotoMapIndexIntent` 与 PostgreSQL 的 `reserveBaiduGeoconvQuota`，本阶段只增加**内部可测试组合边界** `executeBaiduPhotoMapIndexQuotaAdmitted`，而不是产品态 Worker：无当前 Baidu 账户许可证明的请求不能领取已排队任务；已获信任的账号许可在真实任务领取后、配额预约前再次检查。配额仅从当前受信 Owner 扣除每张照片 1 次请求／1 个原始点，按 fleet→Owner 锁顺序、PostgreSQL 数据库分钟窗口保守预约；拒绝不超卖，取消和网络失败不返还已消费额度。转换调用沿用源 PhotoAsset/Node/Media/GPS/授权修订和数据库租约强制再检查、8 秒 Context 截止及跨 Server 取消轮询；导出任何坐标前始终要有当前有效授权。失败时不泄露 WGS84 查询日志。真实 PostgreSQL 双数据库池回归只允许合成转换结果；(0,0) 合法、授权拒绝或撤销、达到 Owner 配额、旧 GPS 与越权均须拒绝且不得额外写入派生索引。

**绝不视为生产放行：** 许可回调只有可信 Go 测试/未来内部代码能够构造，目前没有实际百度账号许可验证器、实际 AK 解密或官方 Geoconv 网络调用，更不会因用户在 Web/Desktop 排队或后台运行而自动消费。当前百度静态 PNG 仍是用户可见地图，JSAPI4 `runtime_enabled=false`、已受审 JSAPI 子资源数 0、没有实际地图 Loader/Cookie/Proxy。独立的下一阶段 A3d2m1b2b2b2 要证明真实 Server AK 账号和合法额度、专有不可伪造的生产发布准入、固定官方 HTTPS、跨 Server 并发限制、真正 Context Cancel、失败/重试/回收、隐私撤销和生命周期，然后按九组私有浏览器/上游 HAR 的 AK 字节审核和完整签名子资源安全门禁接入 JSAPI4。不得提交 AK/HAR/GPS 日志到 GitHub 或聊天。

保持百度唯一 Provider、苹果 iOS 27「照片」1:1 页面和交互验收、xDrive 全屏 App Frame + 52px 全局应用标题栏，以及 Web/Mobile Web/PWA/Desktop 同一照片位置授权/任务状态/Range/VirtualCollection/Viewer。A3 完成后才依序 A4→B1→B2→B3→C1。
