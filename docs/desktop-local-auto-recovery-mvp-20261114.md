# Desktop local incremental backup: recovery and status (2026-11-14)

This change is **only** for the owning Windows/Linux xdrive-agent's `local_folder/push/backup` Sources. It reuses the existing ordinary UploadSession/CAS and immutable original SQL Operations, not the generic Server Source runner or a second durable queue.

## The four code gaps

1. **Transient network/upload failure (P0):** A persisted `uncertain` checkpoint can re-enter the owning Agent's *original* per-file operation reconciler after a bounded wait. The versioned Plan is read from its private OS journal. Pending current-version writes may be retried **only with the original OperationID, resume key, pinned native identity and live Source lease**; unknown/mismatched original SQL receipts stop work. A private fsync'd admission record carries exponential backoff across Agent restart and failed new attempts. No blind new OperationID or deletion.
2. **Agent process death (P0):** A stale `running` checkpoint can be submitted for the same safe recovery path after its original worker process disappears. A still-running process is fenced by the one-per-Agent active job and cross-process Root lease; the previous run is archived as `uncertain` before the new one starts. Explicitly `paused` and `cancelled` do **not** auto-resume.
3. **Saved schedule/Source revision (P1):** The Agent may rebaseline from the last **clean, owner-private, same-Root** checkpoint at most 16 Source revisions older. This creates a NEW current-revision scan rather than copying the old run result. The Server's current Owner/Device/Root/target checks still apply to the read-only history endpoint, and only old `committed` original SQL records may be read across versions. Old `bound`/`reserved` writes cannot cross revision; modified or unrelated current cloud Nodes cannot be silently adopted. A missing/corrupt/foreign/old uncertain checkpoint fails closed.
4. **Clear last-run status (P1):** `scan_complete` is persisted with the original Owner/Root/version-fenced checkpoint and projected to Desktop, xd and history **only after the full inventory including the directory pass finishes**. Historical clients that do not provide it cannot claim full traversal. It is never `backup_complete`, `retirement_safe`, `current_cas_verified`, an authoritative complete SourceRun, or a physical CAS audit.

## Residual safety boundaries

- The private journal's `partial` state still means per-file results only. The additional `scan_complete` bit clearly describes a single fully traversed attempt and is checked on restart; it **does not attest all original bytes physically exist in CAS today**.
- Previous-version pending writes, cross-owner sessions, changed Roots/targets, unverifiable Source revisions, user pause/cancel, rejected native identities, unknown SQL receipts, and missing provenance remain **manual reconciliation** cases. Do not weaken these gates to produce a green check or call the backup complete.
- Neither change enables Mirror deletion or Source-level physical integrity certification. The latter needs a separately audited Server CAS/Node materialization proof before setting `backup_complete=true`.

## Validation

Added focused Go tests for prior-commit query scope and exact version selector, old-pending rejection, across-revision FileVersion continuity, Root-private checkpoint history, restart/cooldown timing, and serialized `scan_complete` invariants. CI/Final Gate and signed real-device acceptance are not assumed to have passed. Production device acceptance: 跳过（未验收）.
