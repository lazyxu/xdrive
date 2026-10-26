# Storage permissions recovery implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement these related fixes inline. Preserve the repository's single-work-commit delivery policy.

**Goal:** Recover the complete deployed `/data` tree and prevent stale ownership markers, persistent locks and host-user migration from leaving storage inaccessible to the Server.

**Architecture:** Keep the existing Server storage writer and `storage prepare` command. Migrate old ownership markers once, validate every fixed lifecycle-lock family on subsequent starts, and force full preparation after user migration. Never replace lock inodes or change user bytes.

**Tech stack:** Go, Linux filesystem metadata and flock, Docker Compose, Bash.

**Spec:** Owner's 2026-10-26 request to audit and repair all `/data` and the related code/scripts. Live read-only audit: 23,500 entries, 4,242 owned by legacy UID/GID 1000, runtime 65532:65532; no symlinks, special files, foreign devices or multi-link files observed.

## Constraints and review focus

- Preserve all Owner/authentication, CAS/SQL and existing upload/backup safety checks.
- No file deletion, blob rewrite, lock unlink/recreation, broad world-writable mode, or host-wide ownership changes.
- Preserve lock identity and active flock coordination across metadata repair.
- Preserve explicit configured Server UID/GID rather than using the host account UID.
- Reject unsafe lock types and symlinks; do not silently accept damaged persistent state.
- Keep old marker fixtures separate from a genuinely current marker; a legacy marker cannot certify the full tree.
- Use this task's D-drive temporary directory for local tests and builds. Keep any production metadata journal private and persistent outside `/data`.
- GitHub PR/accurate-head CI first, then accepted GitHub master, then a non-forced GitLab mirror.

## Task 1: Full legacy ownership recovery and lock coverage

- [x] Add regressions in `cmd/server/storage_linux_test.go` and storage tests for a legacy marker with unreadable cache files, temporary lock and private-stage lock; assert bytes and lock inodes survive.
- [x] Confirm the regressions fail on the existing implementation.
- [x] Update `cmd/server/storage.go` to use a new ownership-marker generation, migrate the full old tree once, restore required owner access, and cover temporary, CAS and local-push-stage lock families even with a current marker.
- [x] Reject unsafe internal lock files; retain bounded subsequent preparation and all existing immutable-CAS tests.
- [x] Make storage readiness report unusable existing internal locks instead of claiming root-only readiness.
- [x] Run complete storage and Server packages, including native Linux filesystem tests and Windows compile/tests.

## Task 2: Migration and installer script prevention

- [x] Audit writes and ownership changes in installer, backup/restore and user migration scripts.
- [x] Make user migration explicitly force full storage preparation using the configured container UID/GID; do not equate it with the host account.
- [x] Extend the existing bounded legacy-image installer repair to every existing fixed lifecycle-lock family where needed.
- [x] Extend executable migration/installer fixtures and real Docker storage tests; preserve failure rollback and no-follow checks.

## Task 3: Deployed recovery and delivery

- [x] Validate metadata-only recovery in a disposable Docker volume first.
- [x] Save a private before-state metadata journal; revalidate the actual active `/data` mount and runtime identity.
- [x] Use the current image's existing `storage prepare --force` to recover the audited tree, preserving data and lock inodes.
- [x] Repeat the full audit as the runtime UID; verify existing lock read/write access and health without restarting services or claiming authenticated Gallery acceptance.
- [ ] Obtain independent review; verify the final scoped diff, commit and push through a GitHub PR, await accurate-head gates and synchronize GitLab only after GitHub merge.

## Verification checkpoint

- Complete native Windows and non-root native Linux `internal/storage` and `cmd/server` packages passed. Windows required a normal-user retry because the sandbox denied existing CAS hardlink tests.
- Existing user-migration (including rootless, custom runtime owner and rollback) and installer bootstrap fixtures passed in an isolated networkless Linux container.
- New exact-head CI must still execute the real Docker storage and custom-owner backup/restore drills plus all applicable Final Gate checks before merge.
- Final deployed audit: 23,595 entries, all owned by runtime UID/GID, 10,237 readable directories, 13,102 readable files and 256 read/write lock inodes. Recent 15-minute log window contained no permission-denied or upload-staging-cleanup failures. No authenticated Gallery acceptance is claimed.

## Review hardening

- Preserve legitimate CAS publication crash aliases only after a complete same-device alias inventory proves every hardlink is inside the prepared tree; staging/control locks remain single-link.
- Bind ownership/mode changes to checked native descriptors, including unreadable Linux inodes, with exact inode/type/link-count rechecks and no mutable-path chmod fallback.
- Derive marker staging from the same storage root and reject symlink, device and identity drift.
- Executed real non-root Docker nested-mount negatives for staging, CAS, media, both shard lock directories and singleton lock; deterministic before/after-pin path replacement and external staging regressions passed.
- Independent review found no remaining code blockers after these fixes. Full new-head CI and Final Gate remain required.
