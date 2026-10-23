# Current-map full photo wall — Web/Mobile Gallery integration

Continuation on PR #2436 rebased atop master including merged #2409.

- A current, Server-verified BD09 Child camera produces an Owner-authenticated `/cells` receipt.
  Only after that receipt returns can the trusted Parent expose **查看此地图的全部照片**.
  Initial worldwide bootstrap and cancelled or revoked camera replies do not expose this action.
- The new signed `/media/places/baidu-jsapi/viewport-items` route supplies the
  **existing** Gallery Count/Timeline/Anchor/MediaItemRange DTO. Web/Mobile adapter
  validates parameters and bounded responses before displaying.
- The collection target is `baidu-viewport` with ephemeral accepted BD09 bounds,
  distinct from `baidu-cell` and from any original WGS84 bbox. The first page must
  authenticate before replacing the live map. Subsequent pages reuse the same
  VirtualCollection and its Owner range. Back and Refresh clear the map wall
  and return to a fresh map query, never an unrestricted all-media list.
- No photo/media identity, URLs, CAS bytes, WGS84 or auth token is passed to
  the third-party Child. The original 10 representative-photo strip remains
  a preview, not the source or limit of the full camera collection.
- Electron's isolated HTTPS map opens this shared Web Gallery. Desktop Agent
  direct-list parity and persistent Viewer re-entry, filter recomposition,
  real 100k physical CAS/Browser testing and iOS27 pixel/gesture calibration
  are separate follow-ups; do not claim them as complete.
- Production access not available: **按用户决定跳过（未验收）**; source Owner,
  consent/revocation, session and cross-origin CI remain mandatory.

## Private map Viewer session state

BD09-derived camera/Cell scopes for routed Viewer navigation remain in a bounded
in-memory table (16 entries, absolute 10-minute TTL). They are not persisted
in sessionStorage, URLs, Service Workers or Baidu Child data. A browser reload
intentionally loses private map selection context, and older persisted map
contexts are rejected and removed. All subsequent media pages still require
current signed Server Owner/Consent/session validation. Ordinary non-map browse
sessions preserve their established browser-refresh behavior.
