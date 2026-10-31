# xDrive · Share-scoped anonymous folder uploads

## Product decisions (2026-11-01)

- A folder share has exactly two access modes: `read_only` (browse, preview,
  download) or `view_upload` (the same plus new files and new subdirectories).
- The Owner chooses link expiry and access when creating the share; it can update
  either without rotating the already-issued link. Revoke is irreversible.
- There is **no per-share upload byte/file/count quota and no download-count cap**.
  Historical `max_downloads` is ignored as an authorization threshold; new
  shares store zero. Download counts can remain diagnostic metadata.
- Standard Server file-size, chunk-size, physical free-space, Owner storage
  quota and active-transfer resource controls still apply. These are not
  Share-specific user-configurable quotas.
- Every completed file is owned by the original Owner and immediately visible
  to all authorized readers of that share. Guest uploads cannot overwrite,
  rename, move, delete, create shares or access Owner APIs.
- Guest folder paths are built by individual scoped directory-create requests,
  never by submitting an absolute filesystem path or arbitrary Owner root.

## Owner operations (authenticated)

- `POST /api/v1/nodes/:id/shares`
  with `{"access":"view_upload","expires_at":"<RFC3339 or null>","password":"optional"}`.
  Existing request fields default to read-only; file shares cannot enable upload.
- `PATCH /api/v1/shares/:id`
  with `{"access":"read_only"|"view_upload","expires_at":"<RFC3339 or null>"}`.
  Requires the same authenticated Owner as the original share. Returns the
  updated metadata **without returning or rotating the raw token**.
- `DELETE /api/v1/shares/:id` revokes both download and upload access.
  Already committed Owner files are not deleted.

## Anonymous upload protocol

All calls use the ordinary **HTTPS** origin. No account login, JWT, cookie,
refresh token, Agent IPC or Owner upload API is needed. The share bearer and
optional password must be supplied on each request:

```
X-XDrive-Share-Token: <secret capability>
X-XDrive-Share-Password: <password, if required>
```

1. `POST /api/v1/public/share/directories` with
   `{"parent_id":0,"name":"folder"}`. `parent_id=0` means the shared root.
   Repeat per segment of a nested folder; existing authorized directories
   return their ID, and colliding files are rejected. The API also supports
   representing empty directories.
2. `POST /api/v1/public/share/uploads` with
   `{"parent_id":0,"name":"report.bin","size":8388610,
   "chunk_size":8388608,"resume_key":"ps1_<64 hex>","conflict_policy":"keep_both"}`.
   A client selects a fresh cryptographically random resume intent for a
   **new user upload**. Reusing that same intent after an uncertain response
   resumes the same exact session; a new intent creates a new copy.
3. `GET /api/v1/public/share/uploads/:id` reads received part indexes/hashes
   to resume an interrupted transfer.
4. For each missing chunk: `PUT /api/v1/public/share/uploads/:id/chunks/:index`
   with binary body, `Content-Type: application/octet-stream` and
   `X-Chunk-SHA256: <64 hex>`. Default chunks are 8 MiB, with the
   existing Server acceptance range of 4–16 MiB.
5. `POST /api/v1/public/share/uploads/:id/finalize` with `{}` validates,
   commits one canonical CAS/Node file and returns only a public-safe session
   receipt. A name conflict is resolved by keeping both copies.
6. `DELETE /api/v1/public/share/uploads/:id` explicitly aborts a live
   session; expired sessions are cleaned by the existing Upload Janitor.

The Web UI supports selecting multiple files or a directory and shows progress.
It uses the same endpoints as a command-line HTTP client, not an Owner token.
It stores only a non-authorizing resumable intent in browser session storage
(keyed by a one-way fingerprint of the link and manifest); it never stores
the raw link token or password in that resume entry.

## Mandatory security invariants

- The server authorizes the **current** Share token, password, expiry,
  revocation, permission, account enabled state and exact root ancestry on
  every upload endpoint. Neither UUID nor `parent_id` is authorization.
- UploadSession includes `ShareID` and still belongs to the original Owner.
  Normal account sessions require `share_id IS NULL` during resume lookup;
  a guest session lookup requires the exact ShareID. The Owner is never
  authenticated using a raw Share token.
- The final `Node/File/CAS` transaction acquires the Share row lock and
  repeats the root, target ancestry and active upload-grant checks. A link
  revoked or downgraded during a transfer cannot commit new content.
- Anonymous receipts never expose private Node DTO, storage key, reusable CAS
  source or Owner upload secrets. A guest cannot use `/api/v1/uploads` with
  only a Share token.
- Bounded request bodies, SHA-256 verification, session expiry, physical
  capacity reservations and fail-closed errors remain mandatory.
- Share pages continue to use the existing bounded 100-entry cursor
  renderer. Guest upload controls do not reuse the Owner mutation API.
- All Share-specific Go/React/desktop tests, full PR CI and exact-HEAD Final
  Gate must pass before merge. Physical production/WAN testing, when not
  available, is explicitly **跳过（未验收）**, not PASS.

## Browser limitation

The native browser `<input webkitdirectory>` picker normally returns
the files and their relative paths, but may omit fully empty subfolders.
The dedicated directory-create HTTP endpoint preserves those empty
directories for clients that enumerate them. This is not yet evidence
of browser empty-folder fidelity on real Safari/Android devices.
