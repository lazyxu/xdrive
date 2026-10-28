# Android native Places GPS overview wire contract

**2026-10-28** · Read-only first increment toward native Android photo maps.

This adds the existing shared Go/PWA Owner endpoint to Android's one pinned
`XDriveService` / OkHttp transport:

`GET /api/v1/media/places/overview?west=&south=&east=&north=&detail=0|1`

The server, not Android, authorizes the Owner/photo revision, chooses a
bounded **at most 64** sample set, and performs its current real GPS
aggregation. Map coordinates returned here are genuine source **WGS84**
samples. They are **not** BD-09, nor evidence that a Baidu SDK has converted
them. The native UI must either convert through the established guarded
server/provider path or present an honest read-only GPS overview; never
directly reuse WGS84 as unverified BD-09 pins.

## Contract

- Android validates finite WGS84 `west/south/east/north`, including legitimate
  date-line crossing, before any network activity.
- The returned `aggregated`, `total_photo_count`, each
  `sample_latitude/sample_longitude`, `coordinate_kind`, `item_count`,
  and optional `cover_node_id` are independently checked, including the
  exact per-sample count partition. All samples must belong to the requested
  viewport. The historic grid-cell center is not substituted for a real
  sample, and the region sample never becomes a fabricated midpoint.
- Aggregated region samples use `map_region_sample` and are distinct from
  `grid_cell_center` within the detail-only complete-cell mode; no client
  ever guesses which type it received. Malformed, duplicate, oversized or
  mismatched totals fail closed, not "empty map" with synthetic coordinates.
- Request uses the same current Owner Bearer, strict origin/TLS + optional
  LAN/SNI path, no redirects, no disk-backed GPS/credential cache, and no
  separate map service or background job.
- A missing/disabled Go route is a real `404` error, not a fictional empty
  photo collection or a request for new photo-specific consent.

## Current boundary and follow-up

**Implemented:** DTO, pinned authenticated API, 64-point parsing, positive/
negative MockWebServer and antimeridian tests.

**Not implemented here:** native Baidu map SDK, protected Browser AK handling,
GPS→BD-09 transform/projection, camera/pin interaction, Map→wall→Viewer
return anchors, cover thumbnails, iOS PWA screenshot parity, or actual 100k
performance evidence. These require separate UI/real-device validation and
should reuse the existing Owner Map/Cells/PhotoScope backend, not fork it.

Actual Android JVM/Core, lint and APK CI is pending until this PR's exact HEAD
runs. Real physical device, Baidu provider quota and production Owner
credentials are **跳过（未验收）**. No production or iOS 1:1 acceptance is claimed.
