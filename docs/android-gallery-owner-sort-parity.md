# Android Gallery · Server-validated sort parity (2026-10-27)

This candidate adds the iOS PWA's four actual Gallery sort choices: capture time or
added time, each ascending or descending. It does not reorder only the 60 visible tiles.

- Reuse the same authenticated `/api/v1/media/items` or
  `/api/v1/media/albums/{id}/items` Owner Range and current pinned TLS/Bearer
  client, including existing q/kind/album scopes and exact absolute offsets.
- `captured/asc` retains sparse latest tail and Server-indexed year/month/day
  navigation. `added/asc` also uses the Server's latest sparse-tail contract.
  Descending starts at offset zero (latest first) and fetches further pages
  at the bottom; never scroll to the initial page's last item.
- Time-group navigation is intentionally hidden for nondefault sort modes to
  avoid showing a captured-time index with a different server ordering.
  The selector remains functional with all four combinations.
- Changing sort cancels previous Owner Range, stale Viewer work and pending SAF
  picker; leaving Gallery resets transient sort to default. No new storage,
  offline index, background transfer or access-token persistence.
- Tests cover actual HTTP query parameters/Bearer and rejected invalid modes,
  Controller two-page Owner pagination, Compose sort UI, and return to default.

**Status:** Source candidate only. Exact-head Core/JVM/Lint/APK/API35 and
GitHub-required checks are not yet verified. Real OEM devices and iOS screenshot
pixel parity: 跳过（未验收）, not passed.
