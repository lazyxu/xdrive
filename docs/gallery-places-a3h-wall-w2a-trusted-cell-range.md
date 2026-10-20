# A3h-Wall W2a · Trusted Cell Selection and Web Sparse Range Transport

**2026-10-20 / Source-only transport; NOT yet the iOS 27 user-visible photo wall.**

Frozen full `master@42bcad05e6311cd1267becdb173b2d371f2f9b21`; separate one-work PR, preserving pending Server W1 #2214 and unrelated Source/Device/Caddy/performance/race branches.

- The shared validator accepts an exact current Owner-authorized `/cells` BD09LL 8×8 summary before copying the selected cell's Asset/Node/revision/count with **original query bounds**. Third-party map clicks, grid centers and arbitrary WGS84 cannot determine collection membership.
- `xDriveBaiduNativeCellRangeParams` restricts one BD09 cell (0..7 coordinates), valid representative and count, page 1..100, offset <=10,000,000, captured/added sorting and optional true Anchor Node. No Browser AK, raw JWT, map Cookie, share token or caller Owner ID appears in the query.
- Web/Mobile Web use their established authenticated Web request to W1's Owner-only `GET /api/v1/media/places/baidu-jsapi/cell-items`, with AbortSignal/no-store and bounded page validation, via the existing shared `XDriveMediaGalleryPort` → `MediaGalleryDataSource` transport. W1 is still responsible for Server-side signed-release, Owner, SessionVersion, Map Epoch, original GPS/source revisions, Consent and exact aggregate proof before returning regular Gallery Range DTO.
- **Not done:** no actual map click, photo wall, Viewer or Desktop Agent IPC path has been activated; a legacy Server without W1 returns 404. W2b must use one original VirtualCollection/Viewer and maintain the old gallery/map painted until the first verified Range; W3 must prove pan/logout/cancel reaches Go ctx, and C1 requires physical mixed 100k and real-device iOS27 evidence. Production P0-01/02/03 remains NO-GO independently.
- Node tests dynamically transpile the original shared TypeScript helper and validate server-sourced selection, stale representative rejection, exact URL names/ranges and identity/count sanity, plus original Web adapter wiring. Source+CI validation is not physical Provider isolation/HAR acceptance.

Merge only after new exact-head complete CI (including genuine PostgreSQL API Race, Windows/Linux/Rootless/build/artifacts, Final Gate) and GitHub clean on the **latest** complete master; do not merge W2a ahead of W1 if W1 is still Draft.
