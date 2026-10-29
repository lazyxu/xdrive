# Android BD09LL viewport request scheduling (2026-10-28)

This independent workstream prepares native Android for real map camera
movement while reusing the already-merged Go Owner BD09 8x8 /cells API.
It does not supply a Baidu native SDK, provider AK, basemap or live GPS conversion.

Required session-local behavior (must be tested independently of UI):
- Only valid verified *BD09LL* bounds may enter the request gate; no WGS84
  conversion or synthetic center sent to the Owner API.
- Wait at least 500 ms after the latest map camera motion.
- At most one Owner GET starts per 1000 ms; at most one request in flight.
- Keep only the latest pending viewport, never queue stale camera positions.
- A failed read never auto-retries the same view; explicit user retry or new
  camera motion is required. Server 401/403/409/503 remain real errors.
- Cache at most 32 already authenticated viewport summaries **only in memory**
  for one Owner session; no credential/coordinate persistence. Clear cache,
  request tickets and pending state at logout, server/Owner switch.
- Noncooperative replies after a camera change or Owner epoch change must not
  paint a stale viewport. A returned cached result is never proof the Server's
  Owner/session/release remains authorized after session reset.

This PR introduces pure Kotlin scheduling/data/state tests as a separate
building block. It is **not** an existing UI integration or automatic
authenticated retry. Connect it to the actual SDK camera with a later
Owner-fenced integration PR after #2951; not by adding a second map backend.
Android Native exact-SHA tests and provider/device validation remain separate
evidence classes; physical provider runtime remains 跳过（未验收）.
