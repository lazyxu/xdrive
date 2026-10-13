# Gallery Places · iOS 27 Photos 1:1 implementation and acceptance

**Decision:** 2026-10-13 (Asia/Tokyo). **Provider:** GitHub `lazyxu/xdrive`.
**Frozen implementation baseline:** `master@3c92bd846ba1655df58bbdad38d3a44118a58a48`.
**Accepted order:** P0-Places-A1 → A2 → A3 → A4 → P1-B1 → B2 → B3 → P2-C1.
**Current delivery:** A1 exact-head PR and full CI **pending**; all other phases unimplemented.
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

## A3 · Baidu JSAPI 4.0 server-side proxy security/licence review

**Approved by user:** research a Baidu **JSAPI 4.0 proxy** so pan, pinch
zoom, interactive photo markers and count clustering can approach Apple Photos
behavior. This approves a feasibility and security review, **not** shipping an
unauthenticated HTTP proxy or reusing a credential type without validation.

**Official documents (read 2026-10-13):**

- [JSAPI 4.0 overview](https://lbs.baidu.com/docs/jsapi?title=jsapi4%2Findex):
  interactive Web maps, overlays, touch and desktop browser support.
- [Use proxy to protect AK](https://lbs.baidu.com/docs/jsapi?title=jsapi4%2Fguide%2Fconcepts%2Fproxy):
  `_BMapSecurityConfig.serviceHost`, own-origin JSAPI loader, controlled
  `BMAP_PROXY_URL` rewriting, and server-side credential injection.
- [Loader proxy mode](https://lbs.baidu.com/docs/jsapi?title=jsapi4%2Fguide%2Fconcepts%2Fload):
  `BMapLoader.load({version:"4.0",serviceHost:"https://.../"})`;
  no credential in renderer source or URLs.
- [JSAPI preparation](https://lbs.baidu.com/docs/jsapi?title=jsapi4%2Fquickstart%2Fprepare):
  **browser-type AK** is required for JSAPI. The existing xDrive **Server
  Static Map AK** must not be assumed to work for JSAPI. Any additional AK
  needs encrypted Server persistence, admin-only revision-guarded enable/edit/
  clear/audited temporary reveal, separate verification and no plaintext
  logs. Enabled, configured, remotely verified and currently effective are
  distinct states.
- Read the applicable [Baidu Maps terms](https://map.baidu.com/zt/client/service/index.html)
  and account-specific commercial/API licensing terms with the real intended
  distribution (self-hosted multiuser Web/Desktop/PWA), before accepting a
  production licence. The existence of technical API docs does not grant
  unrestricted redistribution or basemap-asset caching rights.

**Go/no-go requirements before enabling interactive JSAPI:**

1. Authentication and owner authorization before every proxy endpoint,
   bounded fixed upstream host **and path/method allowlist**, sanitized query,
   no arbitrary URL fetch, path traversal, redirects, Host headers or
   attacker-selected `serviceHost`. A proxy example using an unbounded
   `location ~*` rewrite is **not** a production security architecture.
2. No AK in JS globals, rendered URLs, source maps, HTTP redirect
   `Location`, Referrer, response bodies, browser console, Electron preload,
   logs, traces, telemetry, SW caches, URLs after errors, browser history,
   or browser-accessible headers. Confirm with real instrumented network
   and response-body audits, not a source-only assertion.
3. Known-allowed Baidu subresources, CSP/sandbox/WebGL on Safari, Android
   and Desktop Electron; do not allow a remote script to access Node IPC or
   native privileges. Review all transitive scripts/tiles/fonts.
4. Quota protection shared across Server replicas, scoped rate limits,
   cancellation and owner privacy disclosure; no bulk EXIF coordinate
   export. Default map disabled unless explicitly enabled; failures show
   Baidu-unavailable state, never alternate providers or global Gallery crash.
5. Explicit online trial with legally valid **browser-type AK**, recorded
   service level, API compatibility, attribution, entitlement and real
   iOS/Android/Desktop results. No live credentials in CI/PR.

**A3 design direction:** A securely proxied Baidu renderer can own only
basemap, camera gesture and native overlay positioning. xDrive remains the
authoritative owner for PhotoAsset, grid/region/cluster semantics, viewport
spatial query, counts, media thumbnails, Viewer and user-selected precision.
Baidu's appearance differs from Apple's basemap; record it as a provider
exception to iOS Photos 1:1 rather than silently changing vendor.

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
