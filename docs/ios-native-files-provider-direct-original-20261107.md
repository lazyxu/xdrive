# Native iOS Files: secure-scope direct original upload (2026-11-07)

## Scope

The merged #4052 implementation supports 64 sequential picker documents but
previously required a full 1 GiB-or-smaller private temporary copy for every
document. A valid FileProvider URL can already be a locally materialized original;
duplicating it increases temporary disk pressure and rejects larger files.

This follow-up retains the existing upload entrypoint, Owner/bearer session,
UploadSession/CAS writer, exact SHA-256/chunk/finalize verification, and readback.
It adds **one conditional, foreground-only source path**. No new Go Server API,
background worker, auto-retry of unknown POST or permission bypass is introduced.

## Admission / behavior

1. Reject non-file URLs, invalid source names, nonregular filesystem objects
   and negative size before network access. Retain picker-granted security scope
   while inspecting source metadata.
2. If the original fits the established **1 GiB private staging cap**, disk
   space preflight includes the existing **128 MiB** safety reserve. Passing
   sources continue to be copied into a private, protected, one-shot directory.
3. Otherwise, permit direct source reads **only when**
   `startAccessingSecurityScopedResource()` genuinely returned true, file size
   is positive, and `size <= 8 GiB`. The scope stays active until the
   verified transfer or error handling finishes. No provider original is ever
   deleted or mutated by cleanup. Unscoped providers cannot use this fallback.
4. All direct reads use the current UploadSession flow: check Owner and exact
   target before the upload, hash complete source and each 8 MiB chunk, compare
   source bytes against the hash immediately before sending each chunk, validate
   receipts, read back the committed Node/revision/SHA, and stop subsequent
   documents on cancellation or uncertain ACK. Provider changes while reading
   trigger the existing fail-closed integrity checks.
5. The direct path avoids an **additional xDrive private copy**, but it cannot
   guarantee zero device storage usage: the iOS FileProvider may need to hydrate
   a cloud file locally. There is no background continuation.
6. A Server configured with `XD_MAX_UPLOAD_BYTES` below 8 GiB may reject
   larger files. Its quota and authentication rules remain authoritative.

## What this change does *not* do

- Raise the foreground 64-document selection or 128/64/512MiB folder-tree cap.
- Raise original export/download limits; those are a different share-sheet task.
- Support resumable uploads after app termination.
- Weaken transport, Owner revocation or native file-provider permission checks.
- Promise successful original access from every Files provider, especially
  remote or offline-backed sources.

## Tests

Existing Swift Foundation policy checks cover 1 GiB copy boundaries, direct
scope-only admission, 8 GiB limits and accurate chunk acknowledgement
percentage. Existing Node integration contracts now assert that retained scopes
are released, no provider originals are deleted, no alternate writer is
introduced, and every direct import still uses the exact signed UploadSession
and final committed Node SHA proof. The full iOS Xcode build remains required.

Physical provider/device acceptance: **跳过（未验收）**.
