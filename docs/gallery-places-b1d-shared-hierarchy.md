# B1-D · shared Places country → region → nearby-city view

**Parent B1-B/C has merged**: PR #2384 -> master `2bcd35a34b7acdd2d4fe9a909dc910e09088f285`, source-exact 77-job CI successful (25 success / 52 skipped, Final Gate success). This B1-D branch is a single scoped work commit on that full master snapshot. Do not reuse B1-B's checks as B1-D acceptance. B1-D needs its own 77-job CI and Final Gate plus current clean mergeability before merge.


The original Baidu overview is **still the default** when opening Gallery → Places. One optional expandable panel below the map uses `ui/shared/src/mui/MediaGalleryPlacesHierarchy.tsx`, which is shared between wide Web, Mobile Web/PWA, and Electron renderer. It browses country (ISO code), Admin1 (country + region code), then nearest-city (country + region + GeoNames ID); it never collapses same-name cities by display text.

Owner facets are authenticated and bounded to **48 rows per page**. Each navigation, search, unmount or account/scope change cancels the previous read; the panel does not download all 100k GPS coordinates. Cards show exact distinct PhotoAsset count from the backend and an existing Owner-scoped image cover via the shared bounded thumbnail pool. Missing/unavailable GeoNames does not disable original GPS map/cells.

Selecting a city routes through **the existing** `MediaGalleryPage.loadFirstPage` with `place_hierarchy`, which uses B1-C's trusted Owner Media Range and the same gallery virtual photo wall, selection and Viewer. The old `place:` grid remains untouched. Mobile commits the navigation only after the first authenticated Owner Range response. The panel is not a new independent Viewer or map SDK. Code-level source contracts verify these invariants.

Current scope is a first shared UI vertical slice. Desktop uses authenticated Go Client → bounded Agent HTTP handler → Electron main IPC/Preload → shared Renderer. Its hierarchy request is cancelable through the existing viewport-request cancellation bridge. Exact return-to-cursor/scroll-anchor, proper full source-exact CI and physical platform acceptance still need follow-up; do not call all B1-D acceptance complete. Real 100k query-plan baseline and physical iOS/Android/Electron: **按用户决定跳过（未验收）** where inaccessible, without blocking source CI or merge.

## B1-D bounded replacement and return semantics

The GeoNames panel never accumulates all paged locations in the renderer: each next/previous response replaces the current 48 cards. Only a bounded cursor history (128 maximum) and the selected stable identity are retained in a 32-account in-memory LRU. No Owner media, names of images, thumbnails, counts or location coordinates persist there. Reopening the Places index restores country/region/current-page cursor, revalidates Owner access and GeoNames dataset version via the Server, and scrolls the selected card into view after the limited page loads. Secondary '照片' actions on country/region rows open the exact same Owner Media Range used for nearby city rows; the primary row action still drills down to the next level.

## B1-D consolidated security tests (source parity with #2386)

Retain the useful duplicate-PR adversarial scenarios without introducing another Gallery navigator: validate each returned stable identity for the requested country/region/city, reject foreign parents, noncanonical/unsafe integer GeoNames IDs, zero/bad counts, duplicate IDs, overlarge pages, stale/malformed cursors and non-owner thumbnail IDs. Electron Main additionally refuses wrong-parent cursors and malformed filter payloads *before* the independent Agent admission check. The single existing B1-D UI and Owner Media Range remain the only production route. This does not claim physical device or production security acceptance.

## B1-D filter composition regression

A selected country/Admin1/nearby-city stays the current **Owner collection scope** through date, favorite, text search, camera/format, time zone and ordinary filter clearing. Filter recomposition must preserve `place_hierarchy` for authenticated Facet options, sparse Range/Count and Viewer, rather than silently returning the full gallery. Explicit Back or section change discards the hierarchy. The production pure scoping helper is exercised by source-level Node regression alongside five real Gallery call sites. The hierarchy predicate already validates GPS, so ordinary `has_location` remains removable; clearing filters must not leave a permanent location chip.
