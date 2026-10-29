# iOS upload intent read-only reconciliation by resume key

An iOS photo backup Runner must persist the exact scope, operation and
resume_key **before** its first `POST /api/v1/uploads`. If the HTTP response
is lost after the Server created the UploadSession, the device has no
Session ID. A new random key would risk duplicate original files.

This change introduces **POST /api/v1/uploads/resume-lookup**. Although
it uses POST to keep the HMAC lookup key inside a JSON body, the handler
is **strictly read-only**. It never reserves quota, uploads a chunk,
finalizes an object, aborts a session, or deletes expired data.

## Strict request and binding

The exact authenticated Owner must supply:

- `resume_key`: `ios_` followed by exactly 64 lowercase hexadecimal
  characters, derived from a persistent native HMAC operation key.
  Generic `lp2_` local Push and browser resume keys are intentionally denied.
- `parent_id`: positive numeric Owner destination ID.
- `name`: one valid xDrive filename, untrimmed/unsafe names refused.
- `size`, `chunk_size`: exact expected bytes, 8 MiB chunk size.
- `sha256`: exact lowercase full-file digest.

The Server selects by current authorized Owner AND all supplied fields,
`node_id IS NULL`, fail-only conflict policy, and active/finalized status.
No other Owner or same-account mismatched resource is returned.

## Status contracts

- **200**: one exact unexpired session; normal existing UploadSession
  status and received-chunk DTO. A final Server file receipt still
  requires an actual, matching Node, revision and original digest.
- **400**: malformed key/resource identity or oversized request.
- **404**: no matching persisted session. **This is not proof that a
  create POST was never sent**; no automatic new-key retry is allowed.
- **409**: more than one exact matching session exists. Fail closed
  instead of guessing which write is canonical.
- **410**: only matching record has expired. The handler does not
  trigger janitor cleanup or repeat any write.

The endpoint has no URL query parameter and returns
`Cache-Control: private, no-store`. It reuses Server authentication,
Owner ACL, UploadSession model and existing session serialization.

## Remaining true recovery work

1. The native UploadSession transport must accept an externally
   **already-persisted** resume key from the encrypted Owner/Device
   ledger rather than generating a random key inside `uploadOnce`.
2. On unknown create ACK, the native runner calls this endpoint using
   the same exact Owner/Root/source identity, then rechecks the current
   Owner and session before any missing chunk is written.
3. Confirmed full-file bytes and Live still/motion pairing require
   separate verified PhotoAsset/PhotoResource receipts.
4. Real PostgreSQL, Owner revocation, interrupted commit, network
   cut after create and physical iPhone testing remain required
   acceptance work. Unavailable production/device tests are
   **跳过（未验收）**; Go security regression and CI checks remain mandatory.

This is a narrow recovery primitive, not a new uploader or a claim of
automatic incremental sync.
