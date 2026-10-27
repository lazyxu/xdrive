# xDrive — active development rules

This is the active policy, not a running log of PRs. The unabridged 2026-10-27
pre-consolidation copy is preserved at
[docs/history/AGENTS-2026-10-27-before-consolidation.md](docs/history/AGENTS-2026-10-27-before-consolidation.md).
Historical sections in that archive are **non-normative**. Do not append per-PR
checkpoints here; record them on the relevant PR, Issue, or in docs/history.
A later explicit owner decision supersedes older instructions.

## Start, scope and status
- Read live master and the relevant open PR, Issue, tests and shared source before editing.
- Report what is already merged, what remains and what is blocked. Do not recreate accepted work.
- Continue the existing relevant PR when possible, rather than generating duplicates.
- Keep changes scoped and shared among platforms. Preserve unrelated changes and real ownership boundaries.
- Distinguish implemented, tested, CI passed, built, published, deployed and physically validated.
- Real production or unavailable device acceptance: disclose **跳过（未验收）** once. When the owner has chosen to skip it, do not request confirmation again or block subsequent development. Never claim skipped checks passed.

## Git, CI and merge discipline
- GitHub master is canonical; merge on GitHub first, then fast-forward GitLab only if not diverged. Never force overwrite GitLab changes.
- A newer master SHA does not invalidate a green PR by itself. First compare business code, dependencies, APIs, DTOs, schema, toolchains, test prerequisites and security impact.
- If previously validated code and affected inputs are semantically unchanged and there is no blocking conflict, reuse its exact-HEAD green CI/Final Gate and merge promptly. Do not rebuild one work commit or rerun full CI just because master advanced.
- When a real conflict changes code, run affected tests. Revalidate broadly after a newly observed failure, shared protocol/schema/toolchain change or high-risk cross-component security/integrity edit.
- Never claim an earlier green SHA tests a different SHA. Satisfy actual GitHub-required checks, reviews and branch rules; never bypass protection or suppress a real failure.
- A PR may have several commits. Prefer Squash Merge instead of rewriting tested HEAD only to enforce a one-commit aesthetic.
- On PRs, fast CI scope is permitted **only** for conservatively whitelisted docs-only, Android-only and narrowly scoped nonsecurity PWA UI changes. Everything unclassified gets complete CI. Preserve a stable required gate that fails closed if scope detection fails.
- Master pushes and v* stable tags always retain complete build/testing/publishing contracts. Do not cancel required master Snapshot inputs as a PR optimization.
- On rapid edits, batch local work before pushing; avoid churn that cancels useful already-running CI. Re-run only relevant failed jobs when appropriate.
- Never invent CI results, semantic compatibility, branch protection exemptions or measured speedups.

## Publishing
- master is Snapshot/edge: release once build, package and minimal integrity prerequisites pass, without waiting for unrelated long-running tests. Tests continue independently.
- Stable v* requires full Final Gate and exact artifact validation before publication. Do not add a release branch.
- Snapshot GitHub App tokens must use the numeric App ID, be limited to the target repository with verified permissions, and never leak secrets.
- An uploaded CI artifact is not a published or installed build.

## PR, issue and branch hygiene
- Review least-active branches first. Delete only current exact tip proven merged, contained or safely superseded; check protection and open PR head/base, then delete with an exact-SHA lease.
- Closed-unmerged PRs are not automatically redundant. Keep unique work until it is ported or explicitly rejected with evidence.
- Preserve feat/sync-run-outcome-telemetry-p0-p2-20261016 until Issue #2524 resolves its remaining unique semantic differences.
- Close completed or duplicate Issues with canonical evidence; preserve actual unfinished work.
- Avoid branch-name-only deletion and avoid bulk merge of old divergent source.

## Canonical UI architecture
- Web/Desktop/Synology must share the canonical `@xdrive/ui/mui` shell (source: `ui/shared`), navigation, all pages, dialogs and theme. This covers Files/Gallery/Viewer, Push/Pull, tasks/transfers, storage, conflicts, diagnostics and admin/settings; use small genuine platform adapters and capability-scoped routes.
- Use the term 同步文件夹. Main navigation: 概览、云端文件、同步文件夹、传输、存储、冲突、诊断. Admin: 用户管理、审计日志、全局存储、服务与依赖.
- Desktop uses real Electron/Agent IPC; Web uses Server APIs; Synology uses authenticated DSM-local adapters with same-user and Owner checks. Never fake a platform capability, invent state or create a second DSM UI/queue/CAS writer.
- The initial DSM 7 armada38x CLI-only backup SPK release is independent of full MUI adoption and physical DSM acceptance; it may ship without a native MUI page.
- Physical DSM share ACL, first real upload, unchanged second incremental, package stop/restart, upgrade credential/task/checkpoint persistence and effective CGI UID follow the owner's **按用户决定跳过（未验收）** decision: disclose once, continue development, and do not repeatedly seek confirmation. Required code-level security, CI and package-integrity checks still apply.
- Mobile Web/PWA follows the full-screen iOS 27 Files/Gallery app-frame baseline, 52px header, previous-app back control, shared virtualization, preserved navigation/scroll anchor and no floating navigation or multiple tabs.
- Android targets iOS PWA visual parity while retaining genuine native LAN and SAF capabilities; do not assert physical 1:1 without measurements/screenshots.

## Viewer, files and transfers
- Use thumbnail/poster-first Viewer for photos, videos and Live. Show real per-resource progress and honest unknown-size/buffering states.
- On opening Viewer or leaving a list, cancel obsolete thumbnail/preload/range requests and propagate backend Context cancellation to reduce load.
- Live motion starts only on hold. Reuse existing Owner-signed media identities, shared cache and scheduler, without duplicate fetches.
- Files use real cursor pagination, virtualized lists, copy/move/delete, selection, drag/drop, Preview and precise scroll-to-file/selection.
- Transfers expose real state, speed and control only when supported; do not invent Web browser download bytes.

## Push/Pull, media identity, backup and storage
- Device Push is local-owner managed; cloud Pull and foreign-device backup views are read-only. Web does not remotely control device backups.
- Reuse one owning xdrive-agent and UploadSession/chunks/finalize → PostgreSQL/CAS durable original receipt. No duplicate NAS uploader or separate write protocol.
- Protect account/Device/Root ownership, CAS idempotency, schema migrations, retries, source rate limits and conservative Mirror deletion.
- PhotoAsset/PhotoResource/metadata/collections should converge on shared identities. Album membership never copies physical media. Live requires authoritative pairing.
- Synology Photos canonical item IDs with authorized DSM byte transfer; Yike Source-wide cooldown and bounded 2 req/s.
- Admin backups/restore/integrity must have genuine CRUD/status/tests; do not report successful restore without durable verification.
- Separate original/version/staging/trash/database/backup from regenerable cache in human-readable storage statistics.

## Map and privacy
- Every authenticated Owner-visible asset with current valid GPS is map-eligible by default. Do not add photo-specific consent/grants, manual operator approval, entitlement screenshot/HAR checks or artificial enable switches.
- The configured enabled Baidu Server AK permits attempts at official GPS→BD-09 conversion; only a real verified provider reply establishes coordinates. Report retry/pending/error honestly.
- One Owner-bound photo Map/Cells/Scope/Viewer backend is shared between same-page and isolated SDK hosts, Web/PWA/Desktop. Browser AK is separate from Server AK.
- Preserve Owner/Node ACL, revision, Origin/CSP/CSRF, isolated child resources, quota, secret protection and provider errors. Removing manual gates never waives technical security.
- GPS editing, sharing/export stripping, trip membership and 100k map coverage are separate unfinished work; do not mislabel them completed.

## Engineering and tests
- Preserve fail-closed authorization, Cookie/session revocation, credential isolation, SQL/CAS integrity, native device ACL and safe upgrade behavior.
- Do not weaken assertions, mask errors, inflate timeouts to hide races, or skip executable security validation.
- For performance: measure baseline → change → same-data/same-runner paired remeasurement (n≥3 when relevant). Retain only material demonstrated gains.
- Register benchmark evidence and outstanding dimensions in docs/performance-test-registry.md; reuse accepted historical measurements rather than repeating already resolved workloads.
- In 10k/100k/115k scenarios, use bounded group-index virtualization, cursor pages, cancellation and controlled resource lifetimes; do not load entire lists to client memory.
- Background workers have bounded concurrency; manual tasks take priority; old work is cancelled on Owner change or navigation.
- Keep this file durable and concise. Archive decisions, evidence and test matrices elsewhere.
