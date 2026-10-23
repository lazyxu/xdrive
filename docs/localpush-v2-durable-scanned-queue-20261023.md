# Push v2 — one durable queue, one existing uploader

## Why this exists

The agreed backup pipeline is **verified inventory scan → durable task list → existing /uploads → original immutable SQL receipt → incremental scan**. This increment implements the bounded-memory **scanned task list and original receipt replay** without copying CAS/Finalize logic or promoting a historical receipt into current-backup success.

Files:
- `internal/localpushqueue/queue.go` — immutable per-snapshot NDJSON queue + SHA-256 manifest, owner/device/root/source/revision snapshot scope, O_EXCL/fsync checkpoints, replay of original immutable receipts.
- `cmd/xdrive-agent/device_backup_local_common_queue_v2.go` — **unrouted owning Agent integration**: verifies Root, Source, ignore rules, legacy isolation; streams CURRENT inventory; uploads eligible original top-level <=64 MiB files via the **existing** `PrepareVerifiedCommonUploadPlan` and `UploadVerifiedCommonNativeOne`; records verified SQL receipts. No new byte writer.
- `internal/localpushqueue/queue_test.go` — A→B, loss of receipt, fresh process replay, failed scan, tampered journal, permissions, current Owner recheck.

## Safety and operational boundaries

- The queue itself cannot mint an upload Operation. The original per-file Plan journal remains the Operation/ResumeKey authority, and the ordinary generic upload API performs the actual bytes/CAS/Node/FileVersion finalize.
- Missing/failed acknowledgement never implies cancellation. A committed marker is **historical** only; reruns must recheck the original SQL receipt with current owning Device/Root/Source credentials.
- **Next incremental scan:** only reuse the prior verified snapshot as a delta baseline after every queued eligible task has an authenticated historical original SQL COMMIT. New top-level files can then be queued from the existing hash-bucket InventoryDelta; changed A′ remains a visible unsupported case until version-aware overwrite plans exist. An unfinished previous queue cannot be silently skipped.
- The scan callback must finish *fully* before the manifest is published; corrupt, ambiguous, cross-owner, or partially written queues fail closed. Private task paths and credential material do not cross ordinary IPC.
- This is a **source-only integration increment**, intentionally **not routed from Desktop/Web**. Existing legacy Stage/SecretStore/Writer claims remain quarantined and are never cleaned or converted automatically.
- Current native held-original uploader supports direct children, strongly identified regular single-link files <=64 MiB only; nested files, large files, updated file generations, old Stage migration, cross-process Agent lease, SourceRun/history, scheduled backup, and reliable present-day CAS verification are not delivered yet. Unsupported items must never be reported as backed up.
- `backup_complete`, `retirement_safe` and `current_cas_verified` remain false.

## Next integration in the same P0 feature stage

Replace the per-path one-shot Plan slot with audited per-generation identifiers anchored to verified current Node revision. Use the existing inventory delta to select added/changed candidates, and replay unfinished old tasks **before** advancing the baseline. Wire a single owning Desktop manual start/observe action only after cross-process Source lease and repeat-generation cases (A→B→A′) are tested. Do not make a fresh independent protocol or treat a failed HTTP request as physical CANCEL.

Production-environment acceptance unavailable to the agent is **按用户决定跳过（未验收）**; source-level Owner/Device/Root/native/SQL/CAS tests and exact-head CI remain required.
