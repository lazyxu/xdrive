# iOS27 Places · P0-06C signed Camera / filter / Viewer scope

This implementation candidate is based on the merged P0-06A (filtered Map
Cells) and P0-06B (filtered Cell Range). It does not enable a new map
provider, WGS84 conversion, static map fallback or provider-side photo API.

## Trusted state

The Gallery Parent alone owns a canonical read-only scope:
`{filters: {sort_by, sort_dir, favorite?, asset_kind?, captured_from?,
captured_to?, time_zone?}, albumKey}`. Unreviewed media filters are
rejected, not ignored. No Owner ID, JWT, AK, photo resource URL or original
GPS is included in Child messages.

Every signed `/cells` response is bound to its BD09 Camera and the
canonical filter-scope signature. Changing filters cancels the old request,
invalidates Cell clicks, clears stale covers and refreshes at the latest
Camera bounds **without remounting the independently sandboxed HTTPS JSAPI
Child**. Stale completion may not repopulate a newer map generation.
Exactly matching versioned Cell identity and count are required to open
a photo wall. The original Server independently rechecks both before
and after paging.

The current-Camera button and each Cell click carry that same frozen
Album/filter scope to Gallery's virtual sparse Range and original Viewer.
Viewer paging passes the same immutable Album/filters; one-shot, bounded
Owner-local return snapshots copy the scope along with BD09 bounds, sort
and anchor. No stored snapshot is media authorization.

Web/Mobile use a single shared Gallery implementation. Desktop's typed
Go Client -> Agent IPC -> Electron route passes the album on the existing
signed Owner `viewport-items` path, with validated bounds, limit, origin,
sort and filter fields, never a generic /media/items fallback.

## Checks

The contract regression asserts canonical query equivalence for Cells
and Camera Range, rejects owner/CRS/filter/album substitution, checks
copy-on-return Owner separation and the signed range/cancellation source
wiring. Complete Go Linux/Windows, PostgreSQL API race, TS/React build,
browser E2E, and cross-device iOS27 visual/interaction checks must run
against this exact HEAD; synthetic tests are not proof of 10k/100k
production media performance.

Manual production-only security evidence that is inaccessible here:
**按用户决定跳过（未验收）**. Continue code-level access, revocation,
CSP/isolation and CI tests without requiring production secrets.
