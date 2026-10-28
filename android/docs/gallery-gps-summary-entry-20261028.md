# Android Gallery GPS summary entry — real Owner read-only UI

2026-10-28. The native iOS PWA Gallery places its map action in **More → 显示地图**,
not as an invented third bottom tab. This increment follows that entrance
and uses the already-merged shared Go GPS overview contract from #2933.

## Scope implemented

- A Compose Gallery More menu opens a native **GPS summary surface**. Its
  title, Back behavior, loading, empty state and retry are owned by the
  existing `DriveController` / Owner session and its generation-fenced GET.
- `GET /api/v1/media/places/overview` provides at most 64 real Owner
  `sample_latitude/sample_longitude` WGS84 points with authoritative
  `total_photo_count` and per-region counts. It never exposes a guessed
  GPS center, token-bearing URL, a second data store or a photo-specific
  consent requirement.
- A deliberately labeled **WGS84 distribution schematic (not a Baidu
  basemap)** projects genuine source sample coordinates onto a rectangular
  global grid and shows the accompanying exact-count region entries.
  This is useful read-only evidence, **not** iOS map 1:1.
- Open cancels obsolete Gallery Range GETs (but never a native SAF transfer
  or metadata writer). Close or system Back cancels the map GET and removes
  map-only Owner data from memory. Valid already-loaded Gallery photos
  remain available on return; an interrupted first photo page is re-read.
  An old, non-cooperative response cannot reappear after Back or logout.
- An unavailable/disabled map endpoint produces a real error and explicit
  Owner GET retry, not a fictitious empty map.

## Validation to run

- JVM Controller: open/read/back restores earlier Owner photo rows; late
  non-cooperative result after Back cannot repopulate the old map; 503 is not
  an empty map and explicit retry is GET-only; selection/metadata operations
  prevent map entry.
- API35 Compose: More → 显示地图 shows authenticated Owner-count, real
  WGS84 region, distribution and clearly labeled missing Baidu basemap;
  return to the original Gallery without a second login.
- Core authenticated GPS protocol is already covered by #2933.

## Explicitly unfinished

This is **not** a fully interactive Baidu Android SDK map. Still needed:
official authorized Android map SDK/runtime, genuinely converted BD-09
viewport, marker/cover cluster behavior, drill-down via bounded Go
Map/Cells/Owner PhotoScope, map→wall→Viewer→return anchor and 100k
cold-load/device screenshot acceptance. No fake map pins, conversion,
index, map photo permissions or full iOS 27 parity claim.

CI Android JVM/Core/lint/APK/API35 and Final Gate must pass on the exact
HEAD before merge. Production owner certificate, Baidu physical SDK,
real-device 390dp screenshots and 100k map stress remain **跳过（未验收）**.
