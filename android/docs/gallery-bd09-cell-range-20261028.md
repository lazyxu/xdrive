# Android BD09 Owner map cell → genuine Gallery Range (2026-10-28)

## Existing backend, no new second index

The server already implements `GET /api/v1/media/places/baidu-jsapi/cell-items`.
It checks the authenticated Owner, signed map release, exact 8×8 map cell,
representative asset/node/revision and count **before and after** querying the
ordinary Owner Gallery Range. A stale cell is HTTP 409; 403/404/503 remain
explicit errors. No WGS84 bounds, access secrets or provider AK go into a URL.

This Android Core increment makes that exact read available through the one
existing pinned Owner-authenticated `XDriveService`, with a request derived from
a validated `OwnerBd09Bounds` and `OwnerBd09Cell`.

- Supports bounded offset pagination of 60 items per request.
- Reuses the **same source code** that validates normal Gallery Range DTOs:
  positive versioned file Node, image/video media type, unique IDs, exact
  response offset and limit, and consistent metadata.
- Does not accept any returned total greater than the selected cell's
  authoritative photo_count. The Server may return fewer logical rows when
  normal Gallery folding applies.
- Rejects invalid coordinates, cell identity, count, sort and offset before
  network I/O; one Owner GET per requested page, never mutating/auto-retrying.
- Keeps map cells separate from WGS84 metadata; no second gallery decoder,
  media downloader, scoped token, client SQL/index or background job.

## Scope boundary

**This is only the Core transport and DTO contract.** The native UI's
cell-click → map-scoped photo wall → Viewer → map return-anchor work remains
separate and must not fabricate map tiles or bypass Gallery authorization.
UI coupling belongs after the independent #2947 WGS84/BD09 overview PR.

New MockWebServer tests cover exact 15-query-field allowlist, bearer header,
paged read, malformed/widened/duplicate DTO, stale HTTP 409, denied release
and preflight with zero requests. Android Native/Core, lint, APK, API35 and
required checks must pass on this exact PR SHA before merge.

Production Owner/map release, OEM device and 1:1 iOS 27 map screenshots:
**跳过（未验收）**, never claim passed.
