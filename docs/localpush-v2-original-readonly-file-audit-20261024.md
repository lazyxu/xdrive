# Push Runner v2 — read-only original Operation receipt audit (2026-10-24)

## Exact scope

This is an owning-Agent **per-file read preflight** within the existing manual
incremental Runner, not a second queue, an unattended crash recovery daemon,
or a UI/API that accepts paths and Operation IDs from the Renderer.

The source of truth is still the durable private per-target-revision Plan,
the authenticated original PostgreSQL Operation receipt, and the current
Owner/Device/Root/Source proof. The Agent loads every retained versioned Plan
for the **same native-verified relative path**, validates the entire bounded
group before any remote request, and invokes
`localpushcommon.ReadVerifiedOriginalFileReceipts` through an interface
containing **only** the original receipt-read method.

A committed result must match the persisted Plan's original Source,
revision, Operation, Node revision, SHA-256 and size exactly. A reserved/bound
result remains uncommitted. An invalid Plan, revoked Owner/Root proof, changed
Operation identity, malformed or conflicting receipt, transient transport
error after the existing bounded read-back attempts, or canceled context
fails the **whole group** closed (no partially trusted results).

## Safety and compatibility

The replacement preflight runs before the existing
`decideLocalCommonRootFile` target decision, and preserves every later
native Root descriptor/content check, Source lease, manifest verification,
parent/Node read and ordinary `/uploads` path. This is a strict
read-only SQL gate: it never calls Admit, Bind, chunk, Finalize, UploadStatus
or deletes a prior Plan. No original Operation is automatically re-enqueued.

The current explicit manual Runner may still reconcile and, when proven
safe, resume its exact pending original Operation using its existing logic.
Automatic Source runs still require an authenticated `partial` checkpoint
with zero uncertain files; this patch **does not** promote `uncertain` to
`partial`, infer remote cancellation or assert whole-Source success.

The helper returns Agent-private Plan and receipt data. These must **never**
be serialized to Desktop IPC/Web; no new Renderer path/Operation selectors
are introduced. Security tests verify complete prevalidation before network,
only read transport methods, returned historical committed vs pending
states, rejection of cross-Owner/path/revision groups, mismatched receipts,
missing authority, cancellation and read-only transient backoff.

## Still not done

This is **P0-01 phase A**, not the entire recovery feature.
A later opt-in, bounded owning-Agent recovery review must produce **redacted**
per-Source counts/blocked reasons across the verified inventory; it needs an
audited current-state check, independent journal/history reconciliation and
clear manual decision before any uncertain Operation can be considered for
resume. The separate Source-wide `backup_complete`, `retirement_safe` and
`current_cas_verified` flags stay false without independent proofs.

Production-only unavailable validation: **按用户决定跳过（未验收）**.
Code-level Linux/Windows, genuine PostgreSQL API Race, negative authorization,
crash/ACK loss, Native Root and full exact-head CI/Final Gate remain required.
