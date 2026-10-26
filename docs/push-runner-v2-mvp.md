# Push Runner v2 · Backup-only minimum (2026-10-26)

## Current status

Linux/Windows owning-Agent personal Backup-only MVP is already implemented on master. [Issue #2204](https://github.com/lazyxu/xdrive/issues/2204) closed on 2026-10-25. This is source-and-CI delivery, not proof of installed-production acceptance or whole-Source physical completion.

Usage: [xd Backup-only CLI](xd-backup-only-cli.md). Deployment: [headless owning-Agent architecture](xd-headless-backup-architecture.md).

## Keep one pipeline

1. Owning Agent scans the authorized local folder for changed files.
2. Modified files use the **existing** UploadSession / chunks / finalize uploader and SQL/CAS transaction.
3. Preserve original per-file durable Operations and immutable SQL receipts; only a verified committed receipt permits incremental skipping. Quarantine uncertain outcomes.
4. Manual reruns and the same Agent's watcher / interval / cron scheduler scan again.

Desktop and xd backup are merely clients of ONE owning Agent, not independent uploaders. Keep existing bounded work and Source leases; do not add a second durable job broker, second CAS writer, second upload protocol, or pretend that local cancellation physically aborts an in-flight remote commit.

## Minimum usable contract

Already delivered: manual nested multi-file backups, unchanged-file skips, per-file durable outcomes, next-file-boundary pause/cancel, progress/history, optional scheduled incrementals, watcher with periodic rescans, and same-device ownership checks. Foreign devices and Web must stay read-only for this device's private Push.

These are **optional later work, not MVP blockers**: automatic write recovery for uncertain original Operations; whole-inventory completeness and current physical CAS certification; legacy Stage retirement/migration; Mirror, NAS and cross-device Push; transfer bandwidth/concurrency optimization; full 1k/10k/100k and >4 GiB installed throughput measurements. Benchmark before adding optimization complexity.

Do not set backup_complete, retirement_safe, or current_cas_verified true without their separate proof. A successful file-level partial terminal is not a whole-Source completion certificate. Production-only inaccessible safety acceptance is **按用户决定跳过（未验收）**; code-level Owner/Device/Root/native/SQL/CAS testing is still mandatory.

Future changes should use one small, directly useful Agent or CLI fix plus regression tests and a single PR, rather than reopening the historical G2/L03 milestones.
