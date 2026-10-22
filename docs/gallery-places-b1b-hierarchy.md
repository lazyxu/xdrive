# B1-B/C · GeoNames 国家 → 地区 → 附近城市

## Implementation

- Existing merged B1-A (#2199) stores GeoNames country ISO code, Admin1 code, original city GeoName ID, nearest-city distance, resolver version and input GPS fingerprint. `cities500` points are **not** administrative polygons.
- `GET /api/v1/media/places/hierarchy` supports `level=country`, `level=region&country=JP`, `level=city&country=JP&region=13`. Limit defaults to 48 and caps at 100, with an opaque-to-client stable keyset cursor (`country:JP`, `region:JP:13`, `city:JP:13:1850147`), bounded substring search and existing Gallery album/search/favorite/date/camera filters.
- Every group uses `COUNT(DISTINCT pa.id)` with Owner + live Node + indexed MediaMetadata + PhotoMetadata and a full GeoNames label trust predicate: same live GPS in three sources, ready per-asset place analysis, matching current dataset version, matching analysis fingerprint and exact recomputation of GPS IEEE754 bits through PostgreSQL `float8send`. A missing runtime GeoNames snapshot means `available=false` and no stale claims.
- Response `{available,dataset_version,level,items:[{id,name,photo_count,cover_node_id,match_kind}],has_more,next_cursor}`. Country and region names come from the **nearest-city GeoNames record**; cities explicitly render `附近城市 · ...`, never precise jurisdiction.
- `GET /api/v1/media/items?range=true&place_hierarchy=country:JP` (and region/city variants) uses a correlated `EXISTS` with exactly the *same* trusted metadata predicate as Facet. Gallery's original Count/Anchor/virtualized media/Viewer path is not duplicated. Existing legacy `place:<latCell>:<lonCell>` remains intact.
- Web request serialization and Desktop main → Agent IPC → Go Client query serialization carry `place_hierarchy`; invalid local identities are rejected, with Server-side validation authoritative. This is not yet a finished B1-D navigation UI.
- Source tests validate strict IDs, duplicate/invalid input; isolated genuine PostgreSQL tests cover Owner leakage, independent same-name GeoName identities, stable country/region/city pages, literal search, collection/favorite filters, outdated resolver, GPS mismatch, no-data fallback, plus Range/Count/Anchor parity.

## Remaining / acceptance

- B1-D: country/region/nearby-city virtualized navigation UI, cover loading, breadcrumbs/search/return anchors and full Desktop hierarchy listing transport. B1-C query support is not a completed click-to-city UI without B1-D.
- Add benchmark evidence for 10k/100k real physical PostgreSQL data, check query plans and indexes; verify Web/Mobile Web/Desktop flows. Source-exact Go Linux/Windows, real PostgreSQL Race, Web/Desktop and Final Gate CI remain mandatory before Ready/Merge. The mere presence of tests is not evidence they passed.
- Deployment-only safety acceptance that cannot be accessed is **按用户决定跳过（未验收）**; Owner/identity/SQL/IPC code tests are not skipped.
