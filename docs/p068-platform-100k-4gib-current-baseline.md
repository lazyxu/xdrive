# P068 · source-exact Web/Desktop 4 GiB + 100k Sync CURRENT performance rebaseline

## 2026-10-22 · Genuine exact-source measured CURRENT baseline

**Status: Measured baseline · Accepted unchanged production / no optimization candidate.** Three independently seeded physical high-entropy 4 GiB originals per client, and three independent actual Go Client 100k change-feed samples. All dedicated jobs completed **SUCCESS** on the accurately tested HEAD `20ee9c596515d985e3918d5f93b8151435921afa`. The BEFORE/CURRENT values below do not constitute a paired BEFORE→AFTER optimization: **AFTER=N/A, speedup=N/A**. The earlier four-commit CI had failed the one-commit gate; this source was rebuilt as exactly one work commit on full `master@114ca6e1d05ae2bfeb1b9626ed7daac56bfa0d34`, preserving benchmark workflow file blobs.

| Workload (exact original bytes / authenticated endpoint) | Independent n | P50 upload / download or elapsed | Resource peak growth | Source-valid workflow |
| --- | ---: | --- | --- | --- |
| Wide Web Chromium XDriveApi→OPFS→Go/Gin/PostgreSQL17/CAS, **4,294,967,296-byte non-sparse** SHA-distinct high-entropy source | 3 | upload **47.878s**, download **17.515s** | Go RSS **5.17MiB**, renderer working set **89.32MiB** | [Web #39625778550](https://github.com/lazyxu/xdrive/actions/runs/39625778550) SUCCESS |
| Native Electron Renderer/Preload/Main→Go Agent IPC→Gin/PostgreSQL17/CAS, **4,294,967,296-byte non-sparse** SHA-distinct high-entropy source | 3 | upload **36.185s**, download **14.647s** | Agent RSS **20.18MiB**, Go RSS **4.25MiB**, renderer working set **156.49MiB** | [Desktop #39625778369](https://github.com/lazyxu/xdrive/actions/runs/39625778369) SUCCESS |
| Actual authenticated Go Client → Go/Gin/PostgreSQL17, **100,000 logical changes** (75,000 upserts + 25,000 tombstones), **100 HTTP pages**, not physical media payload | 3 | total elapsed **6.444s** (6.444 / 6.625 / 6.251s) | Go RSS **11.37MiB** | [Sync #39625781574](https://github.com/lazyxu/xdrive/actions/runs/39625781574) SUCCESS |

Each 4 GiB sample used **512 real PUTs, one real original GET, verified SHA-256 equality of source/CAS/full downloaded original**. Web full-byte OPFS check and Desktop downloaded file hash were successful; each independently seeded original source was physically allocated, not sparse. Source-read counts and original immutable 4 GiB physical payload shape remained unchanged. Sync passed the 60s-per-sample and 256MiB RSS budget with 0 HTTP errors; both 4 GiB platforms met 360s-per-direction and 256MiB bounded resource budgets. **No unjustified production hot-path tuning is retained or proposed.**

Original exact-source machine summary JSON (all n3 rows, throughput, hashes, bytes, CPU/RSS and original reference semantics) is committed at [P068 permanent evidence](performance-evidence/p068-platform-current/README.md): [Web](performance-evidence/p068-platform-current/web-current-run-39625778550.json), [Desktop](performance-evidence/p068-platform-current/desktop-current-run-39625778369.json), [Sync](performance-evidence/p068-platform-current/sync-current-run-39625781574.json). This archive preserves historic green/red results and does not rewrite the original logs. The inherited Desktop summary's `actualRealUIBoundary` description refers to older 1 GiB text; the verifiable per-sample byte counts and hashes are all 4 GiB and take precedence.

**Final gate:** committing this raw evidence and updating the canonical registry changes HEAD again; the measured source SHA above does **not** authorize merging a different archive HEAD. Require that archive HEAD's own three dedicated native suites, full 77+ jobs/Final Gate and clean GitHub mergeability before Ready or merge. Production-only unreachable security acceptance: **按用户决定跳过（未验收）**; code-level auth/Owner/Share and real CI cannot be skipped. Original Windows/macOS Desktop, installed Android/iOS PWA, WAN/slow-lossy network, paused/interrupted 4GiB resumes, 100k GUI delete/Sync, actual Live motion and other codecs remain **Not measured** by P068.


## Scope
Performance baseline only; no production UI/Go/SQL/Agent/CAS hot-path, API auth,
cancel semantics, race fix or workload budget changed. New branch on complete
`master@158c798585810097bae22a977d3aaa40485c786c`. All added workflow
paths are new opt-in copies of established original benchmarks, with only
workflow name, branch-scoped activation and artifact name changed. Each check
uses the exact head `github.event.pull_request.head.sha` checkout.

## Frozen workloads / acceptance (never relabel as speedup)

| Workload | Source workflow (unchanged) | New source-exact workflow | True payload and sample |
| --- | --- | --- | --- |
| Web browser XDriveApi→Go/Gin/Postgres17/LocalCAS, OPFS full download | `real-web-cas-incompressible-4gib.yml` | `p068-web-physical-4gib.yml` | Three independently generated, physically allocated, SHA-distinct 4,294,967,296-byte high-entropy uploads and full-byte download, 512 real PUTs each; per-arm <=360000ms, max 256MiB backend/renderer growth |
| Desktop Renderer/Preload/Main→Go Agent IPC→Go/Gin/Postgres17/LocalCAS | `real-desktop-incompressible-cas-4gib.yml` | `p068-desktop-physical-4gib.yml` | Same full 4 GiB byte integrity/sha, independently generated n3 and existing frozen CPU/RSS/timing limits |
| Original Owner Go Client 100k change feed | `sync-client-changefeed-100k-performance.yml` | `p068-sync-100k.yml` | 100000 NodeChanges with exactly 75000 upserts and 25000 tombstones, 100 HTTP pages, n3, 60s each + <=256MiB RSS growth |

The two 4 GiB workloads are NOT sparse placeholder files and retain original
native browser/Agent test implementations; failure to generate physical
high-entropy files or correctly round-trip SHA is a RED test, not successful
measurement. They test actual on-runner browser/Agent→server transport, not
end-user production WAN, installed Safari/PWA, router throughput or all OS
filesystem paths.

## Historical benchmarks are not a matched A/B
Earlier accepted original Web high-entropy 4 GiB P50 upload/download was
**48.509 / 18.417 seconds**; Desktop Agent original was **55.087 / 21.969
seconds**, as retained in the P020 branch documentation. Different
source/Runner epochs are not a valid BEFORE/AFTER pair for P068, so current
P068 AFTER/speedup = **N/A** until exact-run summaries are complete.
No optimized candidate code is in this PR; new runs report CURRENT.

## Other already-established 100k workload gates
#2275 physical 100k genuine Share JPEG n9 same-runner A/B established a real
56.7% Web / 56.4% CDP390 Go Context cancel reduction with 0 stale bytes.
#2290 physically distinct 100k logical/115k JPEG/H264/Live photo Grid/Details
Owner Desktop/Wide Web/Mobile regression is green at its exact previous HEAD.
#2307 adds a real shared Owner/Share explorer shell with new native physical
100k Share/Go-cancel checks. These remain independent PR dependencies. The
existing physically distinct 100k Delete/Undo, Copy, upload finalize and Sync
fixture coverage is not weakened or represented by small mocks. The P064
candidate Copy Worker optimization #2136 was closed unmerged for lack of valid
complete n3 A/B; original long-tail admission investigation stays Issue #2153.

## Rules and branch disposition
Maintain `AGENTS.md` mandatory baseline -> diagnosed bottleneck -> same
Runner/source/data n>=3 matched A/B -> keep only material benefit without
CPU/RSS/I/O/stale-byte/ACL/CAS regression. These workflows are measurement,
not an optimization. Do not modify frozen budgets or fabricate n3 acceptance.
No race files are touched. Inaccessible production-only acceptance:
**按用户决定跳过（未验收）**; code-level auth, ownership and CI remain mandatory.

## Rebase on full current master · verified earlier measured provenance

The original **source-exact, full-CI accepted** P068 physical n3 measurements are archived unmodified as machine-readable JSON in this PR: on accurate measured source `20ee9c596515d985e3918d5f93b8151435921afa`, Web 4 GiB median **47.878s up / 17.515s down**, Desktop actual Agent 4 GiB **36.185s up / 14.647s down**, and 100k authenticated Go Sync Change Feed **6.444s**. These are three separate original workloads, **CURRENT/BEFORE only**, matched product-code AFTER **N/A**.

A later accurate standalone-head `65526857e69387215305ce10e237a3a3fef93ab0` independently passed [4 GiB Web #39635346301](https://github.com/lazyxu/xdrive/actions/runs/39635346301), [4 GiB Desktop #39635345955](https://github.com/lazyxu/xdrive/actions/runs/39635345955), [100k Sync #39635346322](https://github.com/lazyxu/xdrive/actions/runs/39635346322), and [full CI/Final Gate #39635342869](https://github.com/lazyxu/xdrive/actions/runs/39635342869). Its Web job log reports 4 GiB upload/download P50 **85.628s / 16.794s**, Sync P50 **5.031s**; do not compare with `20ee9c` to infer a speedup/regression (different runners/SHAs). The full byte and SHA-256 checks passed, not sparse fixture outputs.

Only the 11 original test/workflow/registry/evidence/documentation files have been reapplied to current master as one work commit; no transfer or SQL production hot path changed. This restacked branch **must independently rerun all three genuine opt-in native n3 and exact-HEAD full 77+ CI / Final Gate**, with clean mergeability, before Ready/merge. The earlier native GREEN belongs to earlier immutable SHAs. Still unmeasured here: physically installed Windows/macOS Agent, iOS/Android PWA, WAN/packet loss, Pause/Resume/durable cancel, 100k GUI delete, independently encoded Live Motion. Inaccessible production-only safety acceptance: **按用户决定跳过（未验收）**; code-level security/ACL and CI remain required.
