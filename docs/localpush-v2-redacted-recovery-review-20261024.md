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

## Owning Desktop viewer integration

The existing local manual incremental backup dialog now provides a separate
**read-only recovery review** action when the current owning Agent advertises
the `device-backup-local-common-recovery-review` capability. The UI reads
one 16-file page on explicit user request. A next-page action carries the
numeric ordinal and the exact private generation epoch returned by the Agent;
it never accepts a pathname or an arbitrary Operation selector. No automatic
page sweep or "backup complete" projection is provided.

Electron main validates Source ID, ordinal, HMAC text and a per-window UUID,
then forwards the request only through the normal capability-gated Agent
client. The Go Server receives a normal loopback-authenticated GET; response
remains `private, no-store`. The operation uses a per-request AbortController;
closing the dialog cancels the Electron HTTP request and Go request context.
Stale responses after a Source/account change are discarded.

Renderer independently checks page Source/revision, the 16-file bound,
nonnegative counts and exact partition sum, ordinal consistency, unchanged
epoch for continuation and `authoritative === false`. It only shows the
current page's historical counts: committed, reserved/bound, missing,
ignored and unsupported. The UI intentionally does not sum successive
pages into a point-in-time complete Source claim; historical COMMITs alone
do not guarantee current Node or physical CAS availability.

A review cannot run alongside a pending manual start, and a fresh manual
backup clears stale displayed review counts. Web/Mobile Web, remote Desktop,
and the generic Source adapter receive no access to this private Agent read
interface. There is no new upload, deletion or automatic uncertain-result
retry button. Running without a newly updated Agent remains compatible:
the optional review section is hidden when the capability is absent.


## Read-only current Node metadata check (follow-up)

For historical COMMIT groups already validated by the original SQL receipt,
the owning Agent can additionally **read** the currently existing authorized
cloud parent/child Node and compare its exact Node identity, revision,
SHA-256 metadata and size to the complete original Operation chain. It
reuses the manual Runner's existing `decideLocalCommonRootFile` correctness
guard and re-reads a matching current Node to catch mutation during the
review. It **never** calls Admit, Bind, chunk, Finalize or any cloud writer.

The redacted, manual, at-most-16-file review page reports:

- `current_node_metadata_match_files`: historical committed file paths whose
  CURRENT remote Node *metadata* still exactly matches their latest original
  committed revision
- `current_node_metadata_mismatch_files`: past committed paths whose current
  Node metadata no longer matches, e.g. an externally updated/deleted child

The partition **must** sum to `historical_committed_files`. An inaccessible,
revoked or untrusted cloud ancestor or network failure denies the **whole**
page instead of converting an unknown result into a confirmed mismatch.

These are bounded read-only observations, not present-day CAS physical
verification, a global database snapshot, a backup completeness statement
or permission to resume a pending Operation. Multiple pages are not
aggregated into an authoritative SourceRun. Unlike original SQL receipt
queries, these current Node checks require extra read-only cloud requests
for each historical COMMIT in the selected page, so they are kept in the
explicit advanced recovery view and must not run during ordinary backup.

Production-only environment verification remains
**按用户决定跳过（未验收）**. Negative Owner/Root/Node tests and
Linux/Windows/PG CI are required on the exact feature HEAD.
