# iOS incremental Photos: one-PR minimum-MVP acceptance matrix

**Single PR:** [#4141](https://github.com/lazyxu/xdrive/pull/4141).
This is a **test and evidence matrix**, not a claim of physical iPhone acceptance.
Core implementation came from merged #4104/#4126. #4141 consolidates the
remaining regression and optional original-retention/APNs features.

## Acceptance levels

- **A — code-policy executable:** macOS Swift/SQLite or Node source contract.
- **B — service integration:** Go HTTP + PostgreSQL + real local CAS bytes/Node
  readback and failure/Owner/Device/Target cases.
- **C — simulator:** real Xcode/iPhone Simulator app launch, Gallery/Files
  navigation, backup UI/offline failure, background/foreground lifecycle.
  Candidate runs `XDriveIOSPhotoBackupMVPScenarioUITests` in the disposable CI-only
  smoke harness, opening actual native Backup overview/task list/settings
  without a signed-in Server or fabricated cloud receipts.
- **D — physical iPhone:** signed App + real Photos permission, real PhotoKit,
  true iCloud-only assets, APNs sender, sleep/lock and production NAS.
- Only **D** confirms physical-platform behavior. A/B/C must never be described
  as D or substituted for an impossible continuous locked-screen guarantee.

## P0: required for a dependable minimal release

| Case | Code/CI evidence | Still required on device |
| --- | --- | --- |
| IPA compile/start | `ios-unsigned-ipa.yml`, Xcode build and launch UI test | Signed iPhone cold/warm start and crash diagnostics |
| Exact HEAD CI/Final Gate | `CI`, `unsigned-ipa`, final-gate job | All applicable checks green on same HEAD |
| Only-new first enable | `PhotoAutoSchedulePolicyChecks.swift`, `PhotoBackupMVPAcceptanceChecks.swift` | 20 old originals + first 3 new photos; old media untouched |
| New photo, edited original, historical-date import | `PhotoBackupChangeQueueStoreChecks.swift`, `PhotoCursorEpochPolicyChecks.swift` | Verify one new photo, one edit, one old-dated import after enabling |
| App kill, restart, airplane mode, loss of signal | durable SQLite and unknown-ACK tests, prewrite retry policy | Interrupt upload at start/chunk/finalize and reopen without duplicate Node |
| Authenticated exact Server Node receipt | managed Source/Target Go integration; Swift receipt policies | Verify actual current SHA, Node revision, and correct Owner before green state |
| Owner/Device/Source/Target switches and revoke | Go managed upload and BG grant contracts | Switch during active transfer and after unknown ACK; no cross-owner bytes |
| HEIC/video/Live original restoration | Swift Live original ZIP + Go CAS; original restore contracts | Download, hash and play both Live resources and a long video |
| iCloud-only | waitingICloud persisted and retry checks | Background must not fetch without consent; foreground explicit retry |
| Foreground/BGProcessing | BG admission policy and non-secret diagnosis | Resume after lock/unlock as OS permits, no continuous-upload promise |
| Files/Gallery/backup crash regression | `ios-b9-release-crash-repro.yml` candidate, native UI tests | Actual signed app Files/Gallery/backup navigation |
| Matching Server/client | scoped API+Source/Target and storage schema tests | Exact deployed Server API and native IPA on same staged environment |

## P1: quality and operability before wider rollout

| Case | Code/CI evidence | Still required on device |
| --- | --- | --- |
| 10k–100k library | bounded 256 item policy, SQLite 70+ item pages, simulated 100k windows | Check memory/latency against real PhotoKit population |
| Per-photo status and failure recovery | #4104/#4126 native UI + exact revision queue tests | Processing, pending, cloud wait, failed, formerly confirmed, unverified |
| Progress/whole-library audit | bounded progress, Node proof snapshot and invalidation tests | Audit as-of timestamp, no fake live 100% |
| Wi-Fi-only | `ios-photo-backup-wifi-only.cjs` and native NWPath policy | Wi-Fi→cellular→offline→Wi-Fi with user setting respected |
| Focused | `PhotoFocusedBackupPolicyChecks.swift`, resumed 100k windows | Foreground screen on, return after cancellation, no gap skip |

## P2: optional, not blocking the minimal backup MVP

| Case | Current #4141 behavior | Independent acceptance |
| --- | --- | --- |
| APNs background hint | Encrypted Owner/Device/Source token, Apple ES256 sender, advisory BG rearm | Correct Apple App ID, .p8, signed entitlement, real APNs delivery |
| Release local original | Candidate single-item physical CAS hold + deletion flow, **UI disabled by default** behind explicit Swift compile flag | Separate signed test IPA; Full Live pair, iCloud propagation, restore, NAS backup strategy |
| Locked-screen continuous upload | No promise; protected bytes stay protected and OS schedules as permitted | Cannot mark guaranteed or require bypassing iOS restrictions |

## Exact-HEAD gate

All applicable GitHub Actions checks including iOS native IPA and Go API race
must succeed for the **same candidate HEAD**, with explicit Final Gate evidence.
Physical D acceptance remains **NOT RUN** without a connected and signed iPhone.
Do not merge to master with failing CI. Keep any production-dangerous original
deletion feature disabled for distribution until D acceptance is documented.
