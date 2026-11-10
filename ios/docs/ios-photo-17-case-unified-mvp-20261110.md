# iOS Photos — 17-case unified MVP release / acceptance gate

**Delivery PR:** [#4265](https://github.com/lazyxu/xdrive/pull/4265) (one existing candidate; no second uploader).
**Signed-device and deployed-storage acceptance issue:** [#4249](https://github.com/lazyxu/xdrive/issues/4249).

This is a release **evidence map**, not a declaration that 17 physical-device problems were reproduced or fixed.
The merged code from #4082, #4104, #4126 and #4141 already supplies the single
PhotoKit -> durable queue -> managed UploadSession/CAS -> current Node receipt pipeline.
This PR tightens exact server evidence and makes the 20-old/3-new consent fixture executable.
Do not introduce another writer or relax Owner/Device/Source/Target checks to make tests pass.

## Evidence levels, never interchangeable

- **A**: executed Swift policy/SQLite or Node contracts on the candidate SHA.
- **B**: executed HTTP Go + PostgreSQL + real temporary local CAS bytes and SHA-256, scoped authorization.
- **C**: actual Xcode iOS Simulator SwiftUI/navigation test with no fabricated logged-in Owner or original receipt.
- **D**: **signed physical iPhone + real Owner/Source, deployed Server + target disk/NAS**. Record device model, iOS version, App and Server full commit SHA, signed IPA SHA-256, start/end time, redacted result/log and source/original SHA-256 hashes. Never upload tokens, raw image metadata or personal originals.

A/B/C must pass exact-HEAD CI and final-gate, but **none proves D**. A missing D record is `NOT RUN`, not PASS. A new commit invalidates claims about the prior HEAD's checks. This matrix tracks 17 cases in one PR while leaving D work in #4249.

## P0 (1–12): signed iPhone and deployed Server required

| # | Verification target | Existing or new executable evidence (A/B/C) | Required D witness |
|---|---|---|---|
| 1 | Signed install, cold/hot start, Full Photos permission | `ios-unsigned-ipa.yml` build + `XDriveIOSPhotoBackupMVPScenarioUITests` (C) | signed IPA build identity, real launch and no .ips crash |
| 2 | First enable only-new: 20 old + 3 new | `PhotoBackupMVPAcceptanceChecks.swift` 20/3 fixture **extended here** (A), `PhotoAutoSchedulePolicyChecks.swift` | upload only 3 **current** Nodes, old 20 untouched |
| 3 | New/edit/delete/import old-date and PhotoKit epoch | `PhotoBackupChangeQueueStoreChecks.swift`, `PhotoCursorEpochPolicyChecks.swift` (A) | edit and historical-import after consent; no skipped item/duplicate |
| 4 | Init/chunk/finalize lost ACK, force quit and resume | `TestIOSPhotoManagedOriginalHTTPResumeFinalizeCASReadback` **extended here** (B); durable SQLite tests (A) | actual network loss at all 3 stages and app restart; exactly one current Node |
| 5 | Current scoped Node+Revision+SHA receipt | `TestIOSPhotoManagedOriginalHTTPResumeFinalizeCASReadback` (B), `NativeCurrentPhotoReceiptPolicyChecks.swift` (A) | current authenticated Node revision and original hash, not historical counters |
| 6 | Owner/Device/Source/Target deny stale writes | managed upload and grant Go/Postgres regressions; post-revocation create/read **extended here** (B) | switch/revoke while in flight and after unknown ACK |
| 7 | Actual HEIC/video/Live pair original | `LiveOriginalArchiveChecks.swift`, `PhotoOriginalMediaPolicyChecks.swift` (A), CAS byte readback (B) | play/decode downloaded original and both Live resources, verify hashes |
| 8 | iCloud-only protected original and foreground consent | `PhotoBackupChangeQueueStoreChecks.swift`, iCloud permission Node contract (A) | protected background no unconsented download, explicit foreground retry |
| 9 | Wi-Fi-only transitions | `ios-photo-backup-wifi-only.cjs` (A) | Wi-Fi -> cellular -> offline -> Wi-Fi, no unauthorized cellular upload |
| 10 | BGProcessing admission/stop/unlock/rearm | `PhotoBackupMVPAcceptanceChecks.swift` and grant tests (A/B) | OS-admitted real execution; stop-generation and single-writer protection; **no lockscreen guarantee** |
| 11 | Backup overview/details/tasks/Gallery/Files navigation | native `XDriveIOSPhotoBackupMVPScenarioUITests.swift` (C) | real signed device repeated navigation, no crash/flicker/stuck modal |
| 12 | Deployed Server and original disk end-to-end | managed HTTP real PostgreSQL/CAS test **extended here** (B) | capture actual Server commit, target Node, upload/download and SHA proof on target storage |

## P1 (13–17): real performance/reliability evidence

| # | Target | Existing automated gate | Required D witness |
|---|---|---|---|
| 13 | 10k/100k PhotoKit performance | `PhotoBackupScanWindowChecks.swift` + bounded 256-slot/100k fixture (A) | physical memory and latency measurements, page/return/restart |
| 14 | Focused backup long run | `PhotoFocusedBackupPolicyChecks.swift` (A) | queue-first, cancellation, wake/display and full scan without cursor skip |
| 15 | Per-photo state, retry and failure | `PhotoBackupChangeQueueStoreChecks.swift` (A), task UI (C) | waiting/uploading/cloud-wait/failed/confirmed/unverified visible and accurate |
| 16 | Whole-library as-of summary | `NativePhotoCoveragePolicyChecks.swift`, `PhotoBackupMVPAcceptanceChecks.swift` (A) | timestamp and per-item read-only audit; no fake live 100% |
| 17 | NAS physical original restore | server local CAS hash check (B) **is NOT NAS evidence** | independent storage restore, original SHA/hash, video/Live decode, backup media health |

### Execute physical acceptance without leaking personal data

1. Build and sign the same recorded commit; verify Apple provisioning and Full Photos access. Use a separate test Owner and managed target `同步文件夹/Push/<SourceName>`.
2. Record a clean fixture: 20 existing assets; enable *only new*; create 3 new; later add a historical-dated import and one edit. Export **only redacted logs and cryptographic hashes**, never raw PhotoKit IDs, photos, GPS, tokens or device secrets.
3. Force failure at upload creation, chunk, Finalize, Owner/Device/Source/Target boundary and Wi-Fi transitions. Check exactly one current Node for each expected original, all ambiguous ACKs reconciled, and no stale writer restart.
4. Include HEIC, larger video, paired Live Photo, iCloud-only and real locked/unlocked BG windows. No assumed background execution; mark OS-not-admitted as observation, not a successful run.
5. Fetch from the actual NAS/target and independently hash, decode and play originals, then report measured library scan and Focused behavior at 10k and 100k sizes if a device fixture is available.

### Final-gate rule

Keep the PR Draft until **the new exact HEAD** passes all applicable CI, unsigned IPA build, native Simulator and Final Gate. Real signed iPhone / NAS D evidence must remain `NOT RUN` in #4249 until performed; do not close #4249 on A/B/C alone.
APNs, automatic deletion of Apple Photos originals and guaranteed locked-screen continuous upload remain outside the minimum incremental-backup MVP; original release remains disabled by default.
