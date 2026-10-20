# L03-Enable-1 · User-requested early activation: real first-file Push from owning Desktop

## User priority (2026-10-20)
The operator explicitly asked to **enable real Push first, then improve incrementally**, instead of waiting for all G2c2d2b1+/L05/L07 production gates. The safe initial activation implements the smallest genuine write path with explicitly limited semantics. It does not assert that the whole folder backup is operational or crash-safe.

## What this candidate changes
- Only an authenticated Windows/Linux **owning Desktop**, after OS-bound current Device/Root identity, gets a **manual "开始真实备份（首文件试运行）"** button. Web/Mobile Web, another Desktop, NAS and generic SourceManager do not obtain a write action.
- Desktop Main/Preload uses a dedicated capability and token-protected loopback Agent HTTP POST with **source_id only**. An ordinary owner JWT or a spoofed device ID never authorizes an OS path.
- The Agent holds its original native Root mutex; validates current owner/session/device/Root/fingerprint, bound paused Source, Backup mode, target, and current server-provided ignore rules. It scans the ENTIRE previously completed immutable private local inventory journal, selects the lexicographically first **eligible first-level regular file**, bounded 0..64 MiB, nonignored, strong native identity, single link.
- The Agent opens/rehashes the actual original file, rechecks ignore rules/session, creates the existing private authenticated localPushrunner Driver, and invokes the real physical Stage -> HTTP CAS/SQL COMMIT -> immutable historical SQL/CAS/native held-descriptor verification. No filename, path, digest, token or operation secret crosses the renderer.
- Positive output only says one physically observed first-file write; never returns a path or claims backup_complete, deletion inference, SourceRun completion or request-key retirement. An HTTP timeout/lost response is AMBIGUOUS; the original O_EXCL Stage/key remains quarantined, not silently retried.
- Start is ONE-SHOT per authorized Source. After it, even a positive result cannot trigger file 2 or a new generation until G2c2d2b+/credential retirement is independently proven. No auto schedule, Mirror/NAS, folder tree, overwrite, large file, multi-Source concurrency, or 100k-product readiness.

## Safety constraints and acceptance
- Preserve all current Source/server IAM checks and original Stage/per-Source key claim. The Agent refuses old/stale claim before any new Stage; no cleanup or key rotation in this scope. Server mutation route is the already landed private authenticated first-leaf writer (#2165), not general SourceRun activation.
- No remote write ability; Device Backup browser views stay strictly read-only.
- Tests: native Go selector filters nested/ignored/oversize/weak/hardlink/mtime, non-authoritative response; Node source contracts exercise the entire Desktop -> Agent chain and deny Web access.
- This is early feature enablement **in source**. A PR, even with passing CI, is not deployment. Actual installed Agent/Server must be upgraded and a separate physical Windows/Linux on-device test performed. Do not call the entire backup product production-ready merely because first-file CI passes.
- Exact one-work commit on frozen COMPLETE master, full append-only AGENTS. Require its OWN complete CI (Go/Linux/Windows, true PostgreSQL Race, Web/Desktop, Rootless/installers/images/artifacts, Final Gate) and clean Rebase Merge. Keep active dependent #2197 separate; preserve it and all unrelated files/branches.

## Follow-up issues
G2c2d2b1 SQL file-terminal COMMIT/CANCEL, G2c2d2b2 real writer quiescence, G2c2d2b3 native/Server durable file-terminal transport, separately audited key/Stage retirement, then genuine multi-file SourceRun, manual lifecycle and watcher/scheduler, >=4GiB and 1k/10k/100k installed tests (issue #2204).
