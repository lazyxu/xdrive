# P0-06A · BD09 map cells share Gallery filter membership

Source candidate, not released or CI-accepted.

The authenticated signed `/api/v1/media/places/baidu-jsapi/cells` now
accepts an optional strict allowlist: `sort_by`, `sort_dir`, `time_zone`,
`favorite`, `captured_from`, `captured_to`, `kind` (image/video) and
`album` (validated PhotoCollection key). All other keys, especially Owner,
original WGS84 geometry, offset/limit, arbitrary search and duplicate folds,
fail closed; Server still owns the caller's Owner/session/revocation/signed
release.

**Critical invariant:** before the 8x8 SQL aggregate, select only Node IDs
from the **same existing mediaItemsBaseQuery** that powers the Gallery Range.
That Owner/PhotoMetadata/Album query is intersected with the signed current
BD09 Owner+Consent+source-revision predicate. No 100k client enumerate,
new index, on-provider identifiers, or WGS84 inverse conversion. Representative
ordering follows captured/added Gallery sort with an unfiltered internal
legacy wrapper to retain existing regression fixtures.

This patch adds Server filtering plus a shared Web/Mobile request serializer and adapter port, without activating filtered map controls. It does not activate a UI
filter, claim compatibility with old Agents, or falsely imply that Cell-click
Range and Viewer already replay all filters. Those must ship together in the
next frontend/client wiring phase, including camera-generation invalidation,
album scope, Viewer restoration, date/favorite/type changes and 10k/100k
PostgreSQL & browser comparisons before P0-06 is closed.

Production-only security acceptance: 按用户决定跳过（未验收）.
Code-level Owner/Consent/revoke/Origin/CSP and source-exact CI required.
