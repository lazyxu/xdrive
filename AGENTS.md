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
- Real production or unavailable device acceptance: say **跳过（未验收）** once and continue safe independent work. Never claim skipped checks passed.

## Git, CI and merge discipline
- GitHub master is canonical; merge on GitHub first, then fast-forward GitLab only if not diverged. Never force overwrite GitLab changes.
- A newer master SHA does not invalidate a green PR by itself. First compare business code, dependencies, APIs, DTOs, schema, toolchains, test prerequisites and security impact.
- If previously validated code and affected inputs are semantically unchanged and there is no blocking conflict, reuse its exact-HEAD green CI/Final Gate and merge promptly. Do not rebuild one work commit or rerun full CI just because master advanced.
- When a real conflict changes code, run affected tests. Revalidate broadly after a newly observed failure, shared protocol/schema/toolchain change or high-risk cross-component security/integrity edit.
- Never claim an earlier green SHA tests a different SHA. Satisfy actual GitHub-required checks, reviews and branch rules; never bypass protection or suppress a real failure.
- Every change, including `AGENTS.md` and CI workflows, must enter `master` through a PR whose exact current HEAD has completed its applicable CI and Final Gate successfully. Never push directly to `master` or treat queued, cancelled or skipped checks as passed.
- A PR may have several commits. Prefer Squash Merge instead of rewriting tested HEAD only to enforce a one-commit aesthetic.
- On PRs, fast CI scope is permitted **only** for conservatively whitelisted docs-only, Android-only and narrowly scoped nonsecurity PWA UI changes. Everything unclassified gets complete CI. Preserve a stable required gate that fails closed if scope detection fails.
- Master pushes and v* stable tags always retain complete build/testing/publishing contracts. Do not cancel required master Snapshot inputs as a PR optimization.
- On rapid edits, batch local work before pushing; avoid churn that cancels useful already-running CI. Re-run only relevant failed jobs when appropriate.


### Mandatory pre-CI consolidation of development branches and PRs
- **Inventory before creating another PR:** inspect existing open PRs and development branches, implementation completeness, overlap/dependencies, exact HEADs, conflicts and actual workflow/job/check status. Prefer consolidating eligible *existing* completed work over adding another branch or stacked PR.
- **Queued is NOT run:** no run, `queued`, or `pending`/`waiting` with no actual job started counts as **CI not yet run (排队也算还没跑)**. Inspect each relevant workflow, job and check on the exact SHA; a queued full CI may coexist with a running standalone check. A cancelled run counts as unstarted only when evidence shows no job actually began.
- **Combine development branches, NOT master:** when independently complete changes are compatible and safe to integrate, merge/cherry-pick their code and tests into **one existing development branch/primary PR** before CI starts. This is **多个开发分支合并成一个**, **不是合入 master**; do not use GitHub's PR merge-to-master action for consolidation. Preserve unique changes, Owner/security boundaries and test coverage; do not blindly combine unrelated or high-risk work.
- **Actually reduce CI load:** prefer one resulting PR and one set of checks for the consolidated HEAD. After proving superseded PRs' unique work is fully contained, document the successor and close redundant PRs; delete obsolete branches only under the exact-SHA deletion safeguards below. Cancel only superseded **unstarted** runs when authorized, never useful running/required tests. Merely stacking multiple open PRs or creating a multi-parent commit while leaving duplicate CI intact does not satisfy this objective.
- **Freeze work that has started testing:** once any relevant CI/check for a PR HEAD actually starts, or its tests have already passed, do not rebase, amend or push that HEAD just to consolidate unless a **real failure** requires a targeted fix. Preserve its already-running/green evidence; do not change it because another PR is queued or master advanced. Repair verified failures with affected tests and keep unrelated running branches untouched.
- **Success criterion:** fewer redundant open PRs, independent CI runs and queued jobs, without losing completed functionality, weakening checks, bypassing protection or treating development consolidation as authorization to merge to master. When combining is unsafe, keep work separate and state why.
- Never invent CI results, semantic compatibility, branch protection exemptions or measured speedups.

## Publishing
- master is Snapshot/edge: release once build, package and minimal integrity prerequisites pass, without waiting for unrelated long-running tests. Tests continue independently.
- Stable v* requires full Final Gate and exact artifact validation before publication. Do not add a release branch.
- Snapshot GitHub App tokens must use the numeric App ID, be limited to the target repository with verified permissions, and never leak secrets.
- An uploaded CI artifact is not a published or installed build.

## PR, issue and branch hygiene
- Review least-active branches first. Delete only current exact tip proven merged, contained or safely superseded; check protection and open PR head/base, then delete with an exact-SHA lease.
- Closed-unmerged PRs are not automatically redundant. Keep unique work until it is ported or explicitly rejected with evidence.
- The legacy sync-run telemetry orphan was audited in closed Issue #2524. Retire only its recorded exact SHA through reviewed deletion guards; never bulk merge its old 40-file schema or delete an advanced branch.
- Close completed or duplicate Issues with canonical evidence; preserve actual unfinished work.
- Avoid branch-name-only deletion and avoid bulk merge of old divergent source.

## Canonical UI architecture
- **2026-10-30 explicit owner decision (supersedes earlier iOS PWA/WKWebView UI and no-SwiftUI rules): both iOS and Android App product UIs MUST be native.** Authority: [all-platform architecture](docs/architecture/xdrive-all-platform-ui.md) and [mobile-native migration](docs/architecture/mobile-native-migration.md). Keep implemented-vs-target states distinct.
- **iOS target:** native SwiftUI/UIKit Server selection, Login, Files, Gallery/local PhotoKit albums, Map, Viewer, Settings, Transfers and Photo Backup. Do not add WebView/React/PWA product pages. The App boots native verified Owner Login and a five-slot Photos-first workspace; the old `XDriveWebAppHome`, WebKit JS Host and download fallback were retired, not reserved for rollback. Incomplete native Files, Map, Live and other modules remain truthfully unavailable until verified; preserve existing native PhotoKit/backup receipts and Owner/session security.
- **Android target:** fully native Kotlin/Jetpack Compose, MediaStore/SAF/Media3 and real native background APIs. Android already has native Login/Files/Gallery/Viewer/Transfers; extend current `android/app` and `android/core` instead of introducing WebView or rewriting accepted code. Web/PWA visuals are design references and measured parity fixtures, not shared mobile runtime.
- **Desktop/DSM:** retain one canonical React/MUI `XDriveApp` using `ui/shared` routes, pages, layout and theme; DSM real Agent/CGI/Owner permissions and unavailable capabilities only. Web/Mobile Web/PWA remains an independent React browser product with PWA/offline and browser session rules. Desktop/DSM mount the same app; Web still has its own top-level app controller while migrating.
- **Reuse contracts, not mobile JSX:** same xDrive Server REST, Owner/Device/Root/Node/PhotoAsset identities, UploadSession/CAS/Node receipts, design tokens and verified interaction spec. Native view state, navigation, PhotoKit/Keychain and MediaStore/Keystore are platform-owned. No second Server/CAS writer, unverified Device SourceRun rights or fake capability states.
- **iOS auth migration:** replace old PWA token-dependent Photos UI with verified native Server/Owner login/session, strict HTTPS CA/hostname/IP SAN and no auth redirects; keep original encrypted V1/V2 backup journal, independent scoped BG grants, real still/video/Live originals and lost-ACK reconciliation intact. Do not blindly resurrect retired Keychain refresh credentials or copy Web cookies/bearers.
- **Migration/CI:** inspect historical commits and current master before importing, port scoped code plus tests rather than broad revert; leave green/running unrelated PR HEADs untouched. New native implementation requires actual Xcode/Gradle, Server-API, security, Owner-switch and exact-head required CI before merging. Preserve unsigned IPA packaging, native Owner and encrypted-backup safety gates; do not reintroduce the retired iOS WebKit fallback.
- Mobile Web/PWA keeps the full-screen iOS 27 Files/Gallery browser design baseline, 52px header and compact navigation independently; Android/iOS use measured native UX, accessibility, 100k performance and truthful feature states. Navigation terms remain `概览、云端文件、同步文件夹、传输、存储、冲突、诊断`. No PDF/content editing requested.

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
- GPS editing, PDF editing and other media/file editing features are out of scope by the owner's decision; do not reopen GPS override, batch editing, editor undo/restore or PDF editing tasks.
- Share/export GPS privacy, trip membership and 100k map coverage remain separate unfinished work; do not mislabel them completed.

## Engineering and tests
- Preserve fail-closed authorization, Cookie/session revocation, credential isolation, SQL/CAS integrity, native device ACL and safe upgrade behavior.
- Do not weaken assertions, mask errors, inflate timeouts to hide races, or skip executable security validation.
- For performance: measure baseline → change → same-data/same-runner paired remeasurement (n≥3 when relevant). Retain only material demonstrated gains.
- Register benchmark evidence and outstanding dimensions in docs/performance-test-registry.md; reuse accepted historical measurements rather than repeating already resolved workloads.
- In 10k/100k/115k scenarios, use bounded group-index virtualization, cursor pages, cancellation and controlled resource lifetimes; do not load entire lists to client memory.
- Background workers have bounded concurrency; manual tasks take priority; old work is cancelled on Owner change or navigation.
- Keep this file durable and concise. Archive decisions, evidence and test matrices elsewhere.
