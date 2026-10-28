# iOS original-file UploadSession transport (bounded internal primitive)

This implementation is **not a shipped PhotoKit backup** and does not add a user-visible
upload button. It only provides the exact authenticated data-plane contract needed
after a separately authorized PhotoKit resource exporter has staged one original
as a regular file in the app's temporary container.

## Existing Server contract

- Requires a current Owner access Bearer token, trusted HTTPS origin and a
  Server-owned directory ID. It never reads the PWA's HttpOnly Cookie, injects
  the native Keychain credential into WKWebView, or circumvents TLS trust.
- First hashes the staged file and its 8 MiB chunks without loading the
  entire file into RAM.
- Creates the existing `POST /api/v1/uploads` session with `conflict_policy=fail`,
  an opaque operation-specific `resume_key`, full SHA-256 and declared size.
  No overwrite, implicit rename, or "skip means uploaded" state.
- Validates the returned Owner session fields, including exact expected size,
  chunk count, SHA and permitted status. An instant CAS finalize is only
  accepted when the Server returns a complete file receipt.
- Uploads each missing chunk to the existing `PUT /chunks/{index}` with
  `X-Chunk-SHA256`, validates the acknowledged index/hash/length, and never
  automatically resends a write following uncertain transport failure.
- On lost chunk ACK, a read-only Owner GET must prove the exact part was saved.
  On lost finalize ACK, read-only `GET /api/v1/uploads/{id}` must return
  finalized with a complete matching file receipt. A missing/partial/mismatched
  response is **uncertain** and is never advertised as backup success.
- Rejects cross-origin redirects and invalid HTTPS certificates using standard
  URLSession trust. Does not persist tokens, the PhotoKit localIdentifier,
  staged original bytes, or a false "synchronized" checkpoint.

## Next required tasks (no claims of implementation)

1. Bind to one current Server-authenticated Owner, Device, Root and canonical
   source identity, with a verified native access-token refresh lifecycle.
2. Add a user-initiated PhotoKit original exporter, respecting iCloud download
   consent, Live Photo still+motion pairing and safe temporary-file cleanup.
3. Persist an Owner-scoped operation/asset manifest and `resume_key` **before**
   the first POST, so process death and unknown creation ACK are recoverable.
4. Connect explicit preview + manual single-file backup UI, then create a
   bounded durable scan/difference queue with pause/retry, owner logout, denied
   permission and server-generated final PhotoAsset receipts.
5. Validate first/second upload, denied/revoked Owner, live motion, HTTPS LAN
   and restart/ACK loss on a real iPhone. Physical acceptance remains
   **跳过（未验收）** until performed; do not block unrelated code merges.

The transport deliberately accepts only a previously staged local regular
file. It **does not** enumerate iOS Photos or perform a background task. The
eventual caller owns the staged-file lifetime and must delete private original
files promptly on success, cancel, failure and Owner change.
