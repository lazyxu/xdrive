# Local Push v2 — durable original UploadOperation readback

This stage introduces three owning-Agent **private** routes for the common-upload
Operation merged in #2395: `/local-common-upload/admit`, `/bind`, and
`/receipt`. The only byte writer remains the ordinary xDrive
`/uploads` Session/chunks/finalize pipeline. These routes do not launch a
Push Runner, delete local data, retire legacy O_EXCL/SecretStore claims,
cancel a transfer, complete a SourceRun, or enable automatic backup.

## Why

The ordinary `/uploads/:id` response presents a mutable current Node and
UploadSessions expire. After a lost finalize ACK or crash, the Agent must
query the immutable original file Operation that was written **inside the
ordinary finalize transaction**. It must never infer success from target
filename, a different Node revision, expired upload lease, or an HTTP ACK.

## Authoritative pre-finalize sequence

1. The owning native Agent constructs and persists ONE immutable per-file
   Operation and its `lp2_` resume identity from a verified local Inventory.
2. `POST /sources/:id/local-common-upload/admit` validates JWT + owning
   Device/Root + paused Backup-only Source revision, exact direct-child target,
   SHA/size and stable Operation UUID, then stores a private RESERVED row.
   Identical admission is idempotent; conflicting original identity is denied.
3. The same Owner creates an **ordinary** `POST /uploads` Session using that
   `resume_key`. Immediate CAS fast-path is disabled for `lp2_` until
   original binding exists; standard Node/FileVersion/CAS APIs are unchanged.
4. `POST /sources/:id/local-common-upload/bind` confirms current scope,
   exact owning ordinary UploadSession, immutable target/revision/SHA/size,
   and changes original Operation RESERVED → BOUND. Repeat bind to the exact
   same Session is idempotent; cross-Session and concurrent finalize are
   rejected. PostgreSQL `NOWAIT` prevents binder/finalizer lock inversion.
5. The Agent calls the **existing** chunk and Finalize methods. Existing
   finalize SQL transaction writes the immutable Operation terminal together
   with its Node/FileVersion and generic UploadSession state; neither HTTP
   ACK nor an expired lease is independently trusted.
6. If an ACK is lost, the Agent keeps the original Operation and calls the
   private receipt below. No new Operation ID or silent retry is permitted.

Any of the ten legacy local Push SQL marker tables (Stage, Operation,
reservation terminal, Stage binding, first-leaf SQL commit, physical file
terminal, native challenge, CAS preparation, quota hold or first-directory
challenge) blocks v2 admission and binding until explicit audited migration.
Orphaned markers remain blockers even when another legacy table is empty.
Since the Server cannot inspect Agent-local SecretStore/O_EXCL files, the future
owning-Agent runtime must independently quarantine/migrate those markers
BEFORE enabling this v2 sequence. This PR only exposes the private protocol
to an already authenticated owning device; no existing Agent calls it yet.

## Private read contract

`POST /api/v1/sources/:id/local-common-upload/receipt` requires a normal
Owner JWT plus the existing `requireLocalSourceExecutor` owning Device/Root
proof and exact `If-Match` Source revision. The body carries ONLY a
canonical Operation UUID and its stable `lp2_` resume identity. Selectors
never enter URLs, caches or ordinary device overview models. The Server
revalidates live Owner session, owning Device and Root binding, paused local
Backup-only Source and immutable target, then reads one original Operation
row under SQL scope. No current Node or short-lived UploadSession lookup
occurs.

- Original Operation readback uses a PostgreSQL MVCC read, not an
  Operation row lock held after Source authorization. A simultaneous ordinary
  Finalize may therefore still appear `bound` until it commits; the owning
  Agent retries the **same** Operation rather than speculating. This avoids
  an inverted Source→Operation read lock versus ordinary
  Session→Operation→Source finalize lock order. A two-pool PostgreSQL test
  holds the original Operation UPDATE lock to prove bounded readback.
- Reserved/bound -> `committed=false`, no Node or commit result; retry must
  retain the original Operation and stay uncertain.
- Committed -> `committed=true` plus original NodeID/NodeRevision/SHA/size,
  exactly as stored in the original transaction.
- Missing, foreign, changed or revoked scope -> no receipt, fail closed.
- Every response leaves `backup_complete=false`,
  `retirement_safe=false`, `current_cas_verified=false`. Historical SQL
  commit is not a fresh physical CAS revalidation or full backup completion.
- A **zero-byte committed file** still explicitly carries `size: 0`.

## Tests and next dependency

Real isolated PostgreSQL fixture tests one original authenticated receipt
across repeat reads, bound/committed and malformed selectors, revoked device,
changed Root, source revision and owner session, plus no-current-Node
dependency. Selector/DTO tests require all explicit negative authority flags.
No synthetic test-seeded committed row is presented as a real upload.

The next dependency is **owning Agent wiring**: real native journal and
immutable OS fd verification, creating the original Operation and ordinary
UploadSession, binding before Finalize, and idempotent receipt reconciliation
after lost ACK/process restart. No current Agent runtime uses the new
protocol; all code-level synthetic commits are test-only. Preserve the
legacy Stage/Key/Writer migration gate before second-file production
execution. Nested directory support remains blocked until independently
validated descendant/Owner scope proof is added.

Production-only security acceptance: **按用户决定跳过（未验收）**.
Controlled non-production Owner/Device/Root, PostgreSQL/Race and
Linux/Windows tests remain mandatory.
