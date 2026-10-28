# Android BD09 Owner Map/Cells protocol · read-only P0 increment

2026-10-28 · native Android uses the same map spatial aggregation as the
Web/iOS PWA and Desktop hosts, without an alternate location writer or
client-side coordinate conversion.

## API / source of truth

Existing Go endpoint:

`GET /api/v1/media/places/baidu-jsapi/cells?west=...&south=...&east=...&north=...`

This is an authenticated, signed JSAPI4 release-fenced **derived BD09LL**
map query, not the original GPS `/media/places/overview` WGS84 query.
The Owner/PhotoAsset/Node/revision/GPS/source predicates and epoch remain
entirely on the Go Server. It returns at most 64 real representative cells
for an 8×8 map camera window, regardless of a 100k-photo library.

Native types `OwnerBd09Bounds`, `OwnerBd09MapCells` and
`OwnerBd09Cell` intentionally do not accept `OwnerMapBounds` (WGS84)
or `OwnerMapOverview`. No WGS84 value is silently used as a BD09 map pin.

## Fail-closed verification

- Require signed Owner Bearer on the existing OkHttp/TLS/optional LAN route.
  Never put credentials, AK, user IDs or coordinate-space claims into query.
- Accept only `coordinate_space=bd09ll`,
  `index_scope=owner_gps_auto_index`, grid 8×8, at most 64 cells.
- Validate each real `latitude/longitude` within requested BD09 camera
  (including date-line wrap), unique cell bins and Node/Asset IDs, positive
  Node revision and PhotoAsset count, and the exact total sum.
- Reject extra WGS84/source fields, incorrect coordinate-space, invalid
  geometry, missing count, duplicate bins or unverified extra media kind.
- Auth/release state 403/503 or unavailable route 404 is a genuine error;
  never paint fictional empty cells or approximate/synthetic centroids.
- This endpoint does NOT convert coordinates, grant media bytes, initialize
  the Baidu SDK, expose Browser/Server AKs or make provider egress.

## Tests

Core MockWebServer tests cover exact query + Owner Bearer, real BD09
bounds/antimeridian, empty scoped response, forged coordinate kind,
duplicate/bad cell ID, wrong count/grid/projection, 65+ response, leaked
fields, no WGS84 fallback and 403/503/404 behavior.

Android Gradle JVM/Core and exact HEAD CI must pass before merge.
Physical device, live SDK AK, official conversion and map→photo→Viewer
interaction remain **跳过（未验收）**, not claimed complete.
