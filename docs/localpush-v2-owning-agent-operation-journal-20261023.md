# Push Runner v2 · owning-Agent original file Operation journal (first slice)

This change follows merged [#2394](https://github.com/lazyxu/xdrive/pull/2394), [#2395](https://github.com/lazyxu/xdrive/pull/2395), [#2400](https://github.com/lazyxu/xdrive/pull/2400) and [#2410](https://github.com/lazyxu/xdrive/pull/2410).

**Decision:** xDrive Push reuses the existing Owner-scoped `/uploads` CAS/Node/FileVersion writer. The owning Agent supplies native Inventory verification, per-file original Operation identity, durable local checkpoints and restart-safe scheduling. No second byte writer or remotely attested native OS-lock proof is required for the second file.

## What this change implements

`internal/localpush.PrepareVerifiedCommonUploadPlan` prepares a **local, pre-HTTP, immutable file Plan** and returns exactly the same original Operation ID when re-entering it. It is a library helper, not a new Desktop/IPC/Server endpoint:

1. Load current persisted RootGrant from the owning user's private configuration; require the exact server/account/device/Root/fingerprint and a strong current OS Root identity.
2. Verify the CURRENT Inventory journal checksum/generation and find exactly one top-level, regular, non-ignored file with strong native identity and exactly one link. Cap this initial source file at 64 MiB and reject nested paths until trusted Server descendant authorization exists.
3. Reopen/hash original bytes with the existing Linux/Windows Root-scoped native file verifier; reject replacement, mutation, symlinks or mismatched native identity.
4. Resolve one Source revision and immutable new/overwrite target already selected by the owning Agent. Generate a canonical Operation UUID **once** and use the existing `localpushcommon.Plan.ResumeKey()` derivation.
5. Record a private per-file O_EXCL slot under the existing Root-scoped journal directory, mode 0600 (0700 directory), sync file metadata, and sync directory on Linux. A raw Owner Session ID is deliberately **not written**: only a domain-separated digest and derived nonsecret resume identity are persisted.
6. On retry/restart, verify current native Inventory/digest and the original slot. If snapshot/source/Root/account/session/target/bytes are identical, return the exact old Operation ID. Conflicting, truncated, symlinked, unreadable, non-private or rotated-session slots are **quarantined**, never overwritten with a new identity.
7. All returned plans are still **local observations**, not remote commits or permitted old Stage/Writer retirement. No automatic upload or background worker invokes this function yet.

A crash during a newly created slot may leave a truncated file; this conservatively blocks that slot rather than guessing whether the original Operation reached the Server. The Linux fsync is intended to improve durability; Windows currently syncs the journal file, not the parent directory. This is **not** a full power-loss durability guarantee on every filesystem or Windows volume. The owning production Agent must add platform-specific durability/integration evidence before enabling unattended backups.

## Security and remaining dependency order

- Existing old Agent O_EXCL Stage/SecretStore/Writer markers and Server SQL legacy Stage/Operation/terminal rows **remain**. Do not auto-delete them or migrate from a timer/HTTP ACK. The new common Server admission still refuses any old SQL claims. The new plan journal **does not** perform legacy migration or bypass this gate.
- Current source planner revalidates the file BEFORE creating the journal. The next step must connect it to a native **held descriptor / verified offset opener**, with pre/post identity + content hash at the actual upload boundary, and verify Owner/Device/Root/Source again. A plan saved earlier alone is never proof that bytes later sent over HTTP were unmodified.
- A later Agent runtime must call the merged [#2410](https://github.com/lazyxu/xdrive/pull/2410) durable upload bridge with the original persisted plan: admit → bind ordinary active Session before bytes → standard upload → original SQL receipt. On missing ACK/restart, the **same Operation ID** is used and unknown outcomes remain UNCERTAIN. No new Operation or file B on uncertain A.
- SourceRun, bounded multi-file scheduler, native watcher, cron/interval, nested directories, FileVersion/move planner, Mirror deletion and full Linux/Windows PostgreSQL/CAS lost-ACK E2E are future dependent stages. This first journal does not claim `backup_complete`, `retirement_safe` or production second-file execution.
- Tests check original ID survives retry/restart, different files receive separate IDs, user session/target/source changes cannot overwrite an outstanding plan, source file modifications fail, and truncated/symlink slots never trigger new work.

**Production-only inaccessible security acceptance: 按用户决定跳过（未验收）.** It is not a source/CI/PR/merge gate. Code-level Owner/Device/Root/native-identity/SQL/CAS and cross-platform automated checks remain mandatory.
