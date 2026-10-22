# Local Push Runner v2 — reuse the ordinary xDrive upload engine

**Decision (2026-10-23):** The owning Agent scans and schedules trusted inventory. The Server's ordinary Owner-scoped UploadSession -> chunks -> finalize -> SHA/CAS -> Node/FileVersion is the **sole file-byte commit engine**. A durable, authorized file-operation checkpoint supplies idempotent long-term Push recovery. Independent remote native-kernel-lock attestation is **not a prerequisite** for file #2: native fd and Writer exclusion remain an Agent-local integrity boundary. This is not permission to disable Server Owner/Device/Root authorization or reuse caller-supplied paths/digests.

## Verified repository baseline

- `internal/client/upload.go`: bounded 8 MiB default chunks, `UploadStreamOpen(ctx, offset)`, received-part resume, retry, `UploadSession`, `UploadResult`, SHA and CAS metrics.
- `internal/api/uploads.go`: Owner-scoped normal upload, `resume_key` matching, normal finalize SQL transaction updates Node/FileVersion and the upload session terminal state together; repeated finalization reads that session's result.
- `internal/api/instant_upload.go`: CAS fast-path is restricted to **already owned** content and has independent size/quota checks.
- Current `xd_upload_sessions` expire by default after **24 hours**. Generic session resume is not permanent idempotency for a weeks-later Push operation. Finalized response projects a currently live Node and can become stale after later updates; never infer historical success from a changed Node.
- `internal/localpushrunner/runner.go`: legacy original first-file-only quarantined protocol; do not blindly remove `O_EXCL` Stage / SecretStore key / Writer claim from machines with in-flight operations.

## First safe increment in this change (not runtime enabled)

- `internal/localpushcommon.Plan`: Agent-only verified identity for one immutable inventory file and target decision. Stable Operation UUID, source revision, native identity, content SHA, size, Server/account/session, Device/Root, relative path and target are length-prefixed, domain-separated hashed into one nonsecret upload `resume_key`. Changing any original snapshot/target creates a different key. Absolute or traversing paths and ambiguous create/overwrite destinations reject before network I/O.
- `internal/client.UploadStreamResumableVerifiedResult`: a strict SHA-256/single-target frontend to the **existing** upload session, chunks, finalize, and Node/FileVersion writer. Reject malformed SHA, missing resume identity, ambiguous target, versionless overwrite and non-finalized results. Check a resumed/finalized result still matches the requested immutable source hash and size.
- `internal/localpushcommon.UploadOne`/`UploadSerial`: bounded 256-file serial transport adapter. Only confirmed normal-upload results advance to the next file; timeout, canceled request, missing ACK, bad hash, unexpected Node/target or rejected status is `UNCERTAIN`, never a physical CANCEL or implicit new operation. Unit tests demonstrate two different planned files using the same general uploader and stop-on-uncertain. This is **transport plumbing**, not durable SourceRun success.
- No new exposed HTTP/IPC/UI, no foreign-device control, no Node or local file deletion, no automatic scheduler, no feature activation. The already merged manual first file remains unchanged.

## Mandatory next vertical slices, in dependency order

1. **Durable per-file mapping:** Server table keyed to authenticated Owner + Device/Root + Source + stable Operation ID; immutable original target version and source snapshot, ordinary UploadSession ID, immutable committed NodeID/revision/content SHA/size and an operation-state transition in the **same SQL transaction** as generic upload finalize. Enforce same-owner scope, unique operation admission and concurrent duplicate-start exclusion; retain receipts independently of 24-hour UploadSession janitor and current Node edits. Operation ID is not a credential. Keep old sessions readable until migration is explicit.
2. **Real Agent binding and replay:** Only verified local Inventory/Root produces Plan/Open; native fd identity and pre/post file digest stay checked locally. Reconcile on same original Operation ID after lost Start/Part/Finalize ACK, Agent/Server SIGKILL, 429/503, revocation or stale target revision. Server receipt must distinguish committed vs uncertain without creating a second FileVersion. Test real ephemeral PostgreSQL/CAS/authenticated Agent, Linux/Windows and crash boundaries.
3. **Safe retirement + second file:** Transition legacy quarantined first-file claims through audited one-time migration only when the owning original operation's physical CAS+SQL state is established. No deleting an `O_EXCL` Stage/Key merely because a timer expired or request failed. Then use the same generic engine for file A and B, nested paths, versions and bounded multipart streams.
4. **Incremental SourceRun:** durable two-generation inventory, rename/move, unreadable Root != deletion, bounded fair task queue, task progress/history/pause/resume/cancel. Web/Mobile only read Device Push; owning Desktop/Agent controls it. Pull remains a separate app.
5. **Automatic backup and evidence:** watcher + interval/cron reconcile, offline/reboot resume and controlled nonproduction 1k/10k/100k + 1–4 GiB BEFORE/AFTER, code Owner/Device/Root security and CI. Mirror deletes only after existing independent double-complete/grace/trash protections.

## Security/rollback contract

- Ordinary authenticated Owner session alone **must not** become a privileged local Source execution grant. Source mutation and durable Push operation admission require owning Device/Root/Source scope on Server. No credentials, local paths, request key or OS handles in Renderer/Web/IPC or generic receipt JSON.
- Unknown outcomes fail closed per file, preserve original history and never trigger a new operation or unconditional file replacement. An ordinary UploadSession response is provisional until a durable Push receipt exists.
- Keep legacy workflow as-is while the new route is inactive. Changeover is opt-in behind a private, migration-aware Agent gate only after SQL/file tests; ability to revert to legacy without destroying any pending uploads is required.
- Inaccessible production environment security acceptance: **按用户决定跳过（未验收）**, not a development/CI/merge gate. Nonproduction Owner/Device/Root, OS-native, SQL/CAS, race and E2E safety checks remain mandatory.
