# Native Android BD09 cell → Gallery → Viewer (2026-10-28)

Source scope: reuse the Go signed Owner /media/places/baidu-jsapi/cell-items
and merged Android Core galleryBd09CellPage; do not invent a second Gallery
parser, downloader, map index, transfer runner or unverified GPS conversion.

Implementation acceptance: exact current Owner cell required, read-only
cell page and following pages remain in cell-items, stale 409 must remain
an error and never fall back to /media/items. Use the same existing Gallery
thumbnail and photo/Media3/Live Viewer, and preserve existing Owner Gallery
range and scroll position across Cell → Viewer → Cell → BD09 → Gallery.
No fixed bottom map photo strip. Signed Baidu basemap SDK remains separate.

Exact-HEAD Android Native Core/JVM/Lint/API35 and source integration tests
required before merge. OEM, production release/AK, iOS PWA screenshots and
real 100k data are 跳过（未验收） rather than PASS.
