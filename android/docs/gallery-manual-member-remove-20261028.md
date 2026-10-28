# Android iOS PWA 手动相册成员移除 · 2026-10-28

## Scope / parity
Only **one selected, already loaded current Owner member** of an opened manual
PhotoCollection can be removed from that collection. Native compact Gallery
selected-items More menu exposes **从相册移除** only inside a manual album.
A confirmation explicitly states that original photos/videos are not deleted.
Imported/smart albums, owner-wide Library selections, unloaded query matches,
bulk delete and trash remain unavailable.

The exact existing Go route is
`DELETE /api/v1/media/albums/{albumID}/items/{nodeID}` with current
`If-Match: "<album revision>"`, authenticated Owner Bearer and URL-safe
opaque album ID. The operation removes only `PhotoCollectionAsset` membership:
no Node Trash, media file, CAS or transfer API is touched.

## Safety and reconciliation
The Core DTO parser accepts an ACK only when returned manual album identity,
name and folder match, revision increments exactly once and the member count
decreases by exactly one. A stale/no-op reply fails closed. Owner-visible
selection must be an exact member of the current loaded Gallery album range,
and mutation is one physical attempt through `authenticatedMutation` (no
refresh-token write replay). After a verified response Android invalidates
the album overview and fetches the authoritative album Range before showing
the new wall. No local sparse-tile filtering masquerades as a Server result.

If an ACK is lost, the selection remains frozen; **刷新核对** performs only
GET of Owner PhotoCollections **and** album member Range, updating the stale
selected album revision and clearing the uncertain state only after both GETs
succeed. Failed GET never triggers a second DELETE.

## Tests
- MockWebServer: Bearer, exact If-Match, encoded opaque ID, DELETE no body,
  positive ACK, rejected no-op/stale response, 409 conflict, imported and
  empty-album local denial, no repeat.
- Controller JVM: one membership removal, authoritative Range reload,
  returning to refreshed overview, lost-ACK reconciliation with exactly one
  write and two real Owner GETs.
- Android API35 Compose: manual collection → one media tile → select →
  More → remove confirmation → empty album → return overview, original
  file is untouched.

This PR is stacked only until #2888's exact-HEAD Android Native and Final Gate
are green and that PR merges; then retarget to master without rewriting
validated work unnecessarily. Physical Android OEM/production Owner/iOS pixel
comparison remains **跳过（未验收）**, not a CI pass.
