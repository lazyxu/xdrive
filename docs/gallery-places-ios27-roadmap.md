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
