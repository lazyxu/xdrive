# Android Gallery: verified BD09LL Owner cells (2026-10-28)

## User-visible result

The existing native **Gallery More → 显示地图** entry still opens genuine
read-only **WGS84** Owner GPS samples from the Go `/media/places/overview`
contract. This increment adds an *explicit* **查看已验证 BD-09 网格** action.

This action invokes the already merged Go Owner-signed
`GET /api/v1/media/places/baidu-jsapi/cells` through the same Android
`XDriveService` and pinned authenticated OkHttp route. It requests a world
BD09LL rectangle and consumes only the verified 8×8, max-64 representative
cell DTO. It never converts raw GPS locally, invents grid-centre representative
coordinates, leaks credentials in a URL, or requests native SDK/browser keys.

The read-only output is deliberately labeled **not a Baidu basemap**. The
actual BD09 coordinates from each returned cell are used for visual markers;
cell IDs and photo counts are genuine Go Owner data. The interface does **not**
claim pixel-parity with the iOS 27 map, a camera SDK, tile layer, cover
thumbnail, or cell→photo wall→Viewer navigation.

## Security, navigation and failures

- The query is a discardable Owner **GET**, not a new upload/download worker.
  Existing durable/uncertain writes and active SAF transfers are not cancelled.
- Returning to the WGS84 GPS overview invalidates the old BD09 request and
  removes the BD09 cells from memory. Previously loaded real WGS84 summary is
  reused without refetch or re-projection.
- Server 403/404/503 and missing signed map release are visible failures,
  **not** an empty photo map. Manual retry only reissues the read.
- Leaving the map or Owner/logout clears both coordinate spaces. A late
  non-cooperative read is rejected by the existing request generation check.
- No permanent GPS/cache storage, new permission, secret, SDK, proxy or
  unverified photo-specific consent/grant is introduced.

## Validation

Source-exact Android Core/JVM, lint, Debug APK and API35 Compose remain pending
until this PR's own GitHub checks finish. Added Controller tests cover verified
success and scope/return, 503→read-only retry and late response rejection.
Compose fixture covers real Gallery → WGS84 → signed BD09 → WGS84 → Gallery.
Production Owner release, device/OEM, actual Baidu SDK and iOS PWA pixel
screenshots: **跳过（未验收）**, not PASS.

Next: integrate the authorized native Baidu SDK camera and genuine map→cell
photo scope→Gallery Viewer return session; reuse the existing Go Owner BD09
backend and shared source revision, not another GPS index or authorizer.
