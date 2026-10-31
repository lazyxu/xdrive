# Native iOS Gallery MapKit route resume (2026-11-01)

This is a scoped P0 navigation change. The five-tab parent retains two non-secret hints for the Gallery-owned local PhotoKit map: scan mode (page or library) and bounded 64-aligned page start. A switch to Files, My or another Gallery source does not replace the dynamic slot or discard these hints.

The existing <=2 KiB Server/Owner/Root-scoped v1 snapshot adds optional fields; prior v1 snapshots remain decodable. Only valid page starts (0 to 1,000,000) are saved. Invalid persisted values fail closed. On any Owner/Server/Root change or logout, the parent resets the hints, including A→B→A.

On re-entry and app relaunch, an authorized current-page scan re-reads and clamps against the currently permitted PhotoKit library. Full-library mode requires a fresh user-triggered scan and never restores an older group count. Map camera, GPS coordinates, local asset IDs, thumbnails, selected cells and media tickets are not serialized. Existing same-page Map → Viewer camera return remains transient. No CAS writers, background backup, encrypted journal or upload code changes.

The native IPA workflow already runs the pure Swift navigation route tests and Node Gallery map wiring regressions; this change expands their coverage for legacy snapshots, invalid cursors and Owner switching. Exact-HEAD CI/IPA/Final Gate are required before merge. Physical iPhone rotation, partial PhotoKit permission, device relaunch and VoiceOver remain **跳过（未验收）**.
