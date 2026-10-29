# Android native Owner BD09 aggregate drilldown · 2026-10-28

Builds on merged map-cell Gallery wall/Viewer #2951, not a new map backend.
The existing signed-release Go `/media/places/baidu-jsapi/cells` accepts
a **BD09LL** viewport and returns up to 64 real Owner-current cells. The
native app currently queries only the world viewport, so densely clustered
areas cannot be progressively explored without the future provider SDK.

This stage adds explicit **放大此区域** from a current signed aggregate
cell, deriving only that cell's exact 8×8 BD09 subrect using Go-compatible
wrapped longitude / antimeridian and ascending latitude grid math.
No GPS/WGS84 conversion, fabricated representative, automatic per-photo
consent or provider tile is involved. The Server remains authoritative.

- The current world/parent cell summary stays in a bounded in-memory
  stack (max 6 levels) to restore the exact previous viewport/scroll
  without another GET. The new child triggers one Owner-signed cells GET.
- The in-flight generation is invalidated on newer drill, back, logout,
  and account change; stale replies cannot override another viewport.
- The clicked cell photo wall's *existing* signed `cell-items` API
  receives the **current viewport** (not always world). Every subsequent
  Gallery/Viewer page preserves that same bounds, preventing wider scope.
- Errors and 409/403/503 are visible; back to a previously verified parent
  does not auto-retry a failed child. A full exit resets all in-memory map
  bounds and private previews.
- The scatter becomes viewport-relative, still explicitly labeled NOT a
  native Baidu map basemap. No fixed bottom photo strip.
- Unit/API35 tests validate geometry, antimeridian, invalid cells, stale
  response, exact bounded Owner requests and child→parent→Gallery return.

Actual Baidu SDK camera integration, live tiles, map gesture handling and
installed-device/iOS 1:1 screenshots remain **跳过（未验收）**.
