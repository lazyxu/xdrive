# P0-01 · Owner GPS to BD09 photo coverage reconciliation

Status: source implementation candidate; exact-HEAD Go/PG/CI validation is required. This is not a measurement of a user's actual photo library.

## Contract

Authenticated GET /api/v1/media/places/baidu-jsapi/coverage, no query parameters.
It does not need the third-party JSAPI runtime to be released. It never sends
GPS to Baidu or returns coordinates, Node IDs, Asset IDs, cover URLs or secrets.

Response counts logical Owner PhotoAssets, never the number of 0.01 degree
Places cells or the up-to-64 map clusters. All counts use a bounded repeatable
read PostgreSQL snapshot:

- valid_gps_assets: live, indexed-ready, owner-matched PhotoAssets with true
  valid source WGS84 GPS, shared with the existing Places validity predicate
- eligible_bd09_assets: source/Consent/revision-valid derived BD09 assets within
  the currently supported map camera latitude range, computed using the very
  same predicate as the trusted BD09 cells and photo wall
- not_eligible_bd09_assets: the difference, including no consent, not converted,
  expired/revoked/stale conversion, or source outside current map capability
- source_outside_camera_latitude_assets: source WGS84 latitude outside +/-85;
  informational only, NOT a disjoint cause category
- scope=indexed_ready_photoassets: this does not imply the filesystem/media
  index is complete; map_runtime_verified=false does not mean Baidu is loaded

A query failure must return 503, NOT invented zero counts. Map runtime disabled
does not mean zero GPS assets. Caller authorization remains the normal Server
Owner Bearer and no public/cross-user aggregated route is provided.

## Privacy-compliant ways to close the gap

1. Preferred: explicit, reviewable Owner bulk consent for a bounded selected
   server-side Asset set. Show purpose, affected count, provider, revocation and
   precise network disclosure BEFORE confirming; bind each grant to current
   Node, media GPS and revision. Support pause/cancel/idempotency and a durable
   audit. Existing Server-only licensed/geoconv quota and singleton dispatch
   must gate conversion; no browser-side GPS upload, no auto-opt-in scan.
2. Local conversion only if provider licence/SDK terms explicitly permit it.
   Keep WGS84 immutable, store permitted BD09 derivatives separately, fence
   origin/revision and invalidate on edit, consent revoke or account rotation.
   Do not treat an unverified local approximation as a licensed replacement.

Both strategies need separate approval/implementation; this count endpoint
performs neither and never silently exposes private GPS. An unavailable
provider still leaves the original Owner Places/photo wall available.
