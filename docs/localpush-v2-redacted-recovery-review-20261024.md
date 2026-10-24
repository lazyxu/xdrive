# Push Runner v2 — P0-01 Phase B: bounded read-only recovery review

## Feature and scope

Only the locally owning Windows/Linux Agent can report a **non-authoritative**
page of historical receipt statuses for its CURRENT privately verified native
Inventory. The Desktop IPC uses normal loopback Bearer authentication and
accepts exactly `source_id` and optional numeric `after_file`, plus a
required opaque `page_epoch` for continuation, never an
absolute/relative file path, Node ID, Operation UUID, ResumeKey, Root ID or
credentials supplied by a renderer.

The route is:
`GET /v1/device-backups/local-common-batch/recovery-review?source_id=42`

Subsequent pages must supply both `after_file=16` (or the returned next
ordinal) and the returned 64-character lowercase HMAC `page_epoch`.
This token is scoped to the current Owner session, Device/Root, Source
revision and target, Inventory generation, checkpoint and rules. It is
not a credential or an original manifest SHA. A new Inventory, Owner
session, rules or target invalidates the continuation and fails closed.

At most **16 files per page** are classified. Every call reads and validates
the entire current native Inventory Journal checksum, allowing memory-bounded
streaming of the selected files; it does not accumulate 100k file paths or
start a new persistent queue. An ordinal continuation cursor, not a path,
is returned only when more file entries remain, accompanied by the
opaque generation token. This is an intentionally
bounded diagnostic, **not** a performant full 100k network audit; throughput
and query-budget optimization require independent measurement.

## Trust and no-write boundary

The Agent checks its live local Owner login, approved Device/Root/Source,
strong OS Root identity, Source revision, Backup-only mode, saved rules and
a non-running fsynced batch checkpoint before reading any operation receipt.
It takes the Agent's local folder-grant mutex to exclude its own concurrent
backup worker. The current private manifest is SHA-verified before/after
streaming, then verified again as the same CURRENT generation, followed by
fresh **live OS Root identity**, original checkpoint, Owner session,
rules and Source/revision
reads. Any inconsistent proof returns an error **without partial counts**.

For each file in the selected page, ignored/unsupported items are counted
without reading an Operation. A path with no private Plan is `unrecorded`.
Otherwise `ReadVerifiedOriginalFileReceipts` requires the complete immutable
per-file Plan/SQL receipt group to pass. The page reports only:

- `historical_committed_files`: all recorded original SQL receipts committed;
  **not** a current Node, CAS physical verification or backup completion
- `pending_original_files`: any original reserved/bound receipt remains open;
  **not** permission to re-Admit/Bind/Chunk/Finalize
- `unrecorded_files`, `ignored_files`, `unsupported_files`, and
  `reviewed_files`: counts over selected native Inventory file ordinals
- `run_state`, `source_id`, `revision`, bounded page cursor and
  generation-bound `page_epoch`

The DTO always contains `authoritative:false` and no paths, private root
fingerprints, tokens, Operation identifiers, SHA-256 or file names.
`Cache-Control: private, no-store` is required; Web/Mobile and foreign
Desktop cannot call the owning Agent's private loopback route. On unsupported
platforms the handler returns 501.

The pre-existing Plan journal and authenticated original SQL receipts remain
the only source of per-file historical truth. No new original Operation,
upload session, CAS mutation, file delete, physical cancellation, legacy Stage
migration or automatic recovery is introduced by this view. If any historical
record is ambiguous, malformed, foreign, revoked or inaccessible, the whole
page is rejected. Even a page with only historical COMMITs **must not** set
`backup_complete`, `retirement_safe` or `current_cas_verified`.

## Verification and remaining work

Add Linux/Windows Go and IPC source-contract tests for numeric bounded
selectors, malicious renderer paths/Operation IDs, exactly 16-file page
bounds, redacted DTO JSON, pending-vs-committed classification, canceled
reads, access revocation, corrupt journal and current generation races.
Keep real PostgreSQL API Race, Windows native builds, Desktop/Web, installer
and complete exact-head Final Gate mandatory before merge.

This is Phase B **read-only recovery visibility**, not Phase C permission
to resume uncertain work. A later audited decision protocol needs explicit
original SQL identity, actual native fd and current remote descendant checks
before any manual recovery write can occur. Full Inventory coverage and
current physical CAS verification remain separate P0 requirements.

Production-only environment acceptance is **按用户决定跳过（未验收）**;
code-level security and CI are never skipped.

## Cross-page limits

The HMAC pins the local manifest/checkpoint and prevents mixing **different
local Inventory generations** by ordinal, but it is NOT a distributed SQL
snapshot. Historical Operation states can advance from pending to committed
between two read-only requests. Therefore even the sum of all historical
COMMIT counts is **not** a point-in-time complete Source, current Node or
present-day physical CAS proof. The page endpoint deliberately refuses
stale generations instead of silently accumulating incompatible counts.

Each page streams the full 100k-scale manifest to verify its checksum,
re-reading no more than 16 historical file groups. Large-scale review
throughput remains to be benchmarked independently; this P0 diagnostic
must not be used as a fast 100k upload/reconciliation engine.
