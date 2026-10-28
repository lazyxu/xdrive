# Android Manual Album Cover · Owner revision-fenced MVP · 2026-10-28

## UI / Source of truth

Native Android now follows the same Owner PhotoCollection model as iOS PWA,
while using real Compose and original media identities:

- Inside the currently opened **manual** album, select exactly one loaded
  photo or video, then use **更多 → 设为相册封面**. The action is not shown
  in the Owner-wide Library, smart/imported albums, or for multiple items.
- From a manual Collections card, use **更多 → 恢复自动封面** and confirm.
  A reset is **not** a request for a blank image: Go may automatically
  choose the real first member as the cover.
- Both actions use existing `PUT /api/v1/media/albums/{albumID}/cover`
  with current-Owner Bearer, `If-Match: "<album revision>"`, body
  `{"node_id":N}` for a member, or `{"node_id":0}` for automatic.
  No original Node/CAS writes, separate Android album cache, or Server API
  changes are introduced.

## Reliable version/ACK semantics

- Core now supports a genuine JSON-body **PUT** through the already shared,
  bounded, cancellable, pinned Owner transport. Opaque album IDs remain one
  URL path segment; no tokens enter path/query.
- Go checks membership and the Owner, returning 409 for a foreign/stale
  member or If-Match conflict. Android accepts a completed ACK only when
  album ID/kind/name/folder/membership count match, revision changes by at
  most 1, and custom cover ID equals the selected member.
- If the custom cover PUT ACK is missing or malformed, keep the native
  selection frozen; **刷新核对** reads current Owner albums **and** member
  Range to recover the current cover/revision, never repeats PUT.
- A confirmed cover ACK may immediately update the opened album and clear
  its selection; the Collection overview list is invalidated so returning
  triggers an authoritative Owner GET. There is no fabricated local cover.
- Reset uses the shared existing rename/delete `mutateGalleryManualAlbum`
  single-write gate, and requires real Owner collection GET confirmation.
  Failed ACK or failed list GET freezes writes with GET-only recovery.

## Tests

1. MockWebServer: JSON `PUT` with node_id > 0/zero, exact Bearer, If-Match,
   opaque encoded album ID, 200 idempotency semantics, invalid revision,
   409 conflict, smart/empty/negative local rejection.
2. Controller JVM: custom cover then return/reload and automatic reset,
   version + list consistency, uncertain ACK GET-only recovery without
   repeated PUT.
3. API35 Compose: Owner manual album → single tile → More → set cover →
   overview → More → reset confirmation → real Owner list, no original
   data changes.

Depends on successful validation and merge of #2893 (member removal). The
candidate's **exact HEAD** must pass real Android Native/JVM/Lint/APK/API35
and Final Gate; no merge is claimed before that happens. Physical OEM and
production account/iOS screenshot measurement: **跳过（未验收）**.
