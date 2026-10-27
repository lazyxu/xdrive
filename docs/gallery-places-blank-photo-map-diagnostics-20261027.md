# xDrive Maps: no photo covers despite valid GPS (2026-10-27)

A Baidu basemap loading does not mean Owner photos have BD-09 positions.
The browser JSAPI/Browser AK only shows tiles. Photo pins need a current
Owner-authorized WGS84-to-BD-09 derived record from the configured
**Server/Web-Service AK**, an active background consumer and a successful
real official HTTPS Geoconv response.

If the UI reports “授权未生效或已撤销” (e.g. 3,323 valid-GPS /
0 BD-09 / 3,323 consent-denied), it is running **legacy** frontend and/or
Server logic. That phrase and authorization exclusion were removed from
current Web and Server. Update the Server + worker and Web/PWA static files
together; account for cached PWA/Service Worker content. Updating only a
web page cannot change an older Server's database predicate.

After upgrading, open Owner “全图库 GPS 覆盖核对”. The modern response
must report zero consent_unavailable_assets and consent_source_changed_assets.
Missing derived GPS must be classified as derived_missing_assets; stale or
invalid converted points are derived_invalid_assets. All Owner-valid GPS
photos can be planned automatically without grant/Consent actions.

Confirm the separate Server AK is enabled in Services & Dependencies;
Browser AK alone is insufficient. Let the bounded MediaIndexer/backfill
and existing durable queue process photos. No operator licence-review,
manual photo permission, provider screenshot, HAR, user credential or
special release toggle is an activation prerequisite. Actual AK validity,
real Provider errors, quota, Owner/Source checks and cancellation remain.

Read-only counts (no GPS or private IDs) in a controlled PostgreSQL
environment can distinguish queued/current/legacy/failed jobs:

SELECT status, consent_revision = 0 AS current_generation, COUNT(*)
FROM xd_baidu_photo_map_index_intents
GROUP BY 1, 2 ORDER BY 1, 2;

The fixes here avoid 30-second consumer backoff for genuinely idle Owners
and allow the existing planner to recover legacy nonzero-consent
cancellations. Modern zero-revision cancellations, active leases, failure
cooldowns, provenance, daily quota and HTTPS upstream are preserved.
Neither test fixtures nor the code patch prove the remote deployment
has converted any of the original 3,323 photos.

Unavailable physical production account testing: 按用户决定跳过（未验收）,
not a development or CI gate.

## Compatibility diagnostics after upgrading the Web frontend

When a new Web/PWA frontend receives a structurally valid, internally consistent
old Server `/coverage-reasons` payload with nonzero legacy consent counters,
the shared coverage panel now shows a specific Server/Worker upgrade warning.
It **never accepts or renders** these obsolete permission counters as current
Owner photo eligibility. Unknown, mismatched or fabricated payloads remain
unavailable; only real derived positions make pins appear.
