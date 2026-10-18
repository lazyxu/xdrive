# L03-G0-c2c3b7 — historical current-operation SQL record with pinned physical CAS observation

## Purpose

After #2072, a `LocalPushFirstLeafOperationCommit` row is created in the SAME
SQL transaction as one private current-operation physical CAS/Node/File/
PENDING SourceItem commit. This phase implements a separate, UNROUTED,
STRICTLY READ-ONLY operation-scoped observation: it simultaneously validates
that immutable SQL row, its original keyed operation/Stage identity, the
owning device/Root/Source scope, and real pinned physical CAS bytes.

A valid post-commit observation is a **historical SQL+current-CAS fact**;
it is NOT native-original provenance, full backup completion, durable
cancel-versus-commit exclusion, SourceRun status, or permission to delete
the OS-private operation key or start a new generation.

## Implementation and lock/identity contract

The existing historical first-leaf read-only SQL/CAS transaction is
extended via an optional Server-private selector, preserving the previous
non-operation physical and SQL receipt callers unchanged. It first locks
the current owner/device/Source/Root. BEFORE the CAS advisory hash/Blob/
Node locks, it acquires a SHARE lock for the exact original reservation,
the immutable `LocalPushOperationStageBinding` and the committed
`LocalPushFirstLeafOperationCommit`. The original 32-byte request key
is checked against its domain-separated hash; no caller-generated digest
alone grants access. The historical Stage quarantine record and all
source/device/Root/session/target/revision/CURRENT/path/content/size
metadata must match the two immutable operation records.

After acquiring the CAS hash lock, the existing reader validates the
committed quota hold, Blob/File/Node/PENDING SourceItem, including exact
committed NodeID and SourceItemID. The existing Local Store inspector
physically hashes the actual CAS inode before and after committing the
same read-only SQL transaction while its OS shard is held. A temporary
Stage may subsequently expire or be replaced; no live Stage or active
reservation is needed to observe its immutable historical commit.
This is intentionally NOT writer admission.

The result contains private, unexported fields and JSON-serializes to
`{}`. No new Router/HTTP endpoint, Agent IPC, Electron/Web DTO or UI
control is registered. A different owner/account, forged device secret,
Root fingerprint, session/revision/target change, wrong key/UUID/gen,
tampered Stage binding or SQL outcome, missing/synced SourceItem and
missing/corrupted CAS all fail closed. Real PostgreSQL and local disk
integration tests cover exact replay after Stage replacement and
adversarial mutation.

## Remaining gates — no production authorization

A positive CAS observation can become stale once the OS pin closes; it
does NOT prove the owning Agent still holds the same original native file
descriptor or that bytes can be restored after arbitrary future GC.
Reservation expiry/abort does NOT prove that physical commit was canceled.
No native request-key retirement, Mirror missing/deletion inference,
completed SourceRun, manual/automated Runner, Desktop Start/Cancel or
local_folder activation is introduced. Temporary Stage stays <=64MiB,
Web/Mobile Web/PWA and foreign Desktop remain observer-only, NAS Push
unsupported, and Pull unchanged.

Next: establish independently authenticated cross-process native original
provenance and a persistent physical COMMIT-vs-CANCEL linearization, then
prove crash-safe replay/key retirement before production execution.
