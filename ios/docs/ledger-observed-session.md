# iOS photo sync journal: attach a recovered Server session (read-only)

The original encrypted Owner/Device/Root intent journal can contain a
`needsReconciliation` entry with no Session UUID, when an initial
`POST /uploads` may have committed but the HTTP ACK was lost.

This increment adds `recordObservedSession` to the existing actor to
persist a Server Session ID **only after the caller has independently
read and validated the current Owner's UploadSession**.

## Conservative transition contract

The caller must verify a live authenticated Owner/Server installation and
Root, then obtain an exact existing upload session through the planned
Owner-scoped HMAC lookup (#3075) / native read-only proof reader (#3076).
Only then may it call:

- `recordObservedSession(scope, id, observedSessionID, parentID, name,
  byteSize, fullSHA256, observedStatus)`.
- Requires a valid Session UUID, active/finalized status, positive parent,
  nonnegative size and exact lowercase full SHA-256.
- The sealed ledger entry must already be **needsReconciliation**, must
  have exactly the same target parent, filename, original byte size and
  original digest, and must have no previously confirmed Node.
- A previously saved *different* Session UUID causes a conflict. Repeating
  the same valid observation is idempotent.
- Recording the Server UUID keeps state as **needsReconciliation**.
  It does not issue an UploadSession POST/PUT/finalize, call a storage writer,
  promote the state back to uploading, or mark an asset confirmed.

If Server reports finalized, the caller must still check the matching
authenticated Owner file Node ID/revision/size/hash and then use the
existing `confirmReceipt` validation. If Server reports active, the
file remains uncertain: restart must rehash the staged original and
prove the exact received chunk state before any later reviewed resume
operation is permitted.

A 404/409/410, scope mismatch, changed iOS Photos authorization, Owner
revocation or lost GET leaves the journal uncertain and **must never**
be treated as permission to allocate a new resume key.

No new API, no new file format, no migration, no additional credential
storage and no automatic sync UI are included. The raw PhotoKit local
identifier is still absent from persisted journal data.

This PR intentionally does not import in-flight #3076; it changes only the
shared sealed journal primitive and can compile independently. Actual
iPhone/Server ACK-cut, keychain lock, lost-POST Session lookup and
process-restart tests remain **跳过（未验收）**. Go/Swift source checks
and the exact-HEAD iOS IPA compile must still be executed.
