# P97 · Compact Gallery Library/Favorites first-Range atomic section navigation

## Verified production-source gap (2026-10-19)

After P95/P96, ordinary compact Gallery section changes still called setSection('library'/'favorites'), setQuery, setDraftFilters and onSectionRouteChange *before* the authenticated first media Range. Returning from Collections bottom Photos tab had a special safe Album branch, but other sections still unmounted the Collections index prematurely, potentially showing the old page or an unverified blank while a slow or failed Server GET was in flight. External Library/Favorites route changes also hid Collections before data acceptance.

## Scoped repair

Use one compact-only openCompactPhotoSection callback backed by the existing shared loadFirstPage(null, nextQuery, ..., onCommitted) boundary. The original current Owner/Port/request generation must accept and prime the counted first sparse page before one section/draft/query/route update and one Collections closure. Reuse an existing already committed Library immediately when tapping the bottom Photos tab. On user-initiated route commit, mark routeSectionAppliedRef before onSectionRouteChange so the URL echo cannot issue a duplicate Range and reset the visible wall. Keep external compact route transitions staged, never insert a separate Loading or timer, and leave wide Web/Desktop handling unchanged. The original sparse 100k paging, poster/Live Photo/thumbnail loading, uploads/downloads/sync and actual pagination indicators stay independent.

## Regression/limitations

The original shared Gallery Navigation is mounted, production TSX callbacks are executed (not mocked replacement handlers), and scenarios include held >365ms, failure/retry, stale rapid taps, committed zero/normal Range acceptance, Library/Favorites and Wide parity. The earlier original P96 mounted test is updated for the stronger Library acceptance rule; P93 source acceptance still checks the first Range/primePage ordering. Verify full exact-head 77+ CI including real PostgreSQL API Go Race, Web/Desktop Windows/Linux, Rootless/packages and Final Gate before merge. Built Chrome 375/390/899px, native iOS Safari/Android/PWA, WAN and physical 100k CLS/FPS NOT RUN in this source-only scope. Do not call this universal device-level zero jitter.
