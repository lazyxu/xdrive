# iOS read-only UploadSession recovery evidence

This is a **read-only native adapter**, not an UploadSession writer or a
photo-backup Runner. It does not call `POST /uploads`, `PUT /chunks`,
`POST /finalize` or mutate the encrypted operation ledger.

Inputs: the already persisted `XDrivePhotoSyncOperation` with HMAC
`resumeKey`, a current `XDrivePhotoSyncScope`, a previously verified
`XDriveNativeOwnerRoot` and the native memory-only short access token.

Before any recovery query, it re-reads the current Owner/Root through
existing /api/v1/me and /nodes/root. It rejects a changed server
installation, numeric Owner or root. It requires a plausible iOS
resume key and an exact source filename/size/full SHA-256.

Against Server PR #3075, it sends a bounded
`POST /api/v1/uploads/resume-lookup` with body-only HMAC identity
(never in a URL or application log), using HTTPS system trust and
no redirects or ambient WKWebView Cookie.

The returned persisted UploadSession must match the request's
exact owner-derived destination, resume key, size, full hash,
8MiB chunks and optional known Session ID. Only these outcomes are
observed:

- `active`: the session exists; reported chunks are **untrusted as
  complete** until a future native writer re-reads the staged file and
  verifies every expected chunk SHA.
- `finalized`: a read-only Server receipt included a matching Node
  ID, file type, name, positive revision and full SHA. This is a
  **single-resource** receipt, not a complete Live Photo pair or
  SourceRun/Device backup receipt.
- `noMatchingSession`, `expired`, `ambiguous`: no safe automatic
  retry or "backup complete" transition is permitted. Investigate the
  previously prepared Owner intent before any further mutation.

It neither registers an iPhone Device nor verifies possession of its
local Root; Server #3071 + native #3072 handle identity enrollment
separately. A verified Device/Root photo-only capability is still
required before a durable automatic Runner can call this adapter
and commit a `PhotoSyncEncryptedLedger.confirmReceipt` transition.

The correct next increment is a single owner-scoped uploader that
uses the encrypted ledger's **existing stable** resume key, followed
by Live still/motion pairing and actual Server Resource receipts.
No physical device, iCloud original, 100k library, or severed-ACK
test is claimed here: those remain **跳过（未验收）**.
