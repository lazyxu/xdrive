# Race / Concurrency Test Registry

> Canonical deduplication and evidence ledger for xDrive concurrency investigations. Updated 2026-10-12; PR #1495 exact-head CI/merge/branch cleanup archived. **Not a claim that every package or hardware configuration was retested on this date.**
>
> This file covers *Go data races*, logical ordering races, cancellation/finalizer ownership, and cross-session lifecycle races. A race detector's clean result alone does not establish ordering correctness. `AGENTS.md` defines the mandatory First-red-before-production-fix rule.

## Before a new Race investigation

1. Read this file **before** creating a Race work branch. Compare the **complete scenario signature**: subsystem + actual API/producer + competing operations + precise forced interleaving + lifecycle/identity scope + expected invariant + Go/Windows/Web/Desktop/physical platform. Matching a filename or a category alone is insufficient.
2. Inspect related existing tests and only the relevant unmerged PRs/branches. A covered, unchanged scenario should not be rerun as exploratory work. A new code change, an untested ordering/platform, a known regression, or mandatory exact-head CI is a legitimate retest; state why.
3. For a new interleaving, start from a fixed `master` SHA and an exactly-one-work-commit **test-only** branch. The first failing run must execute the actual product code and fail a meaningful business/lifecycle assertion. Compilation, gofmt, infrastructure and fixture failures are **invalid**, not First-red evidence.
4. Record **both** first failing and repaired **exact source SHA**, test name, CI run/job URLs, platform, outcome, and the specific violated invariant. Keep the original reproducer unchanged when applying the minimal production fix. Preserve invalid and rejected probes; never rewrite history to imply success.
5. After the fix, require the **same** reproducer, relevant `go test -race` suites, and the repository's authoritative PR CI/final gate. Update this registry **in the same one-work-commit PR**. After linear merge, update status with the actual merge and cleanup evidence; do not imply GitLab or hardware validation unless observed.

### Existing coverage and accepted evidence

Rows below index distinct scenarios, rather than counting repeated CI invocations as new investigations. “Merged” refers to GitHub; physical E2E and GitLab status are not implied. For detailed first-red lines and platform-level proof, follow the linked PRs/CI.

| ID | Subsystem / distinct interleaving | Canonical test / evidence | First-red → repaired CI | Status |
| --- | --- | --- | --- | --- |
| R-SRC-001 | Provider account lease: Heartbeat racing Close / duplicate unlock | [#1340](https://github.com/lazyxu/xdrive/pull/1340) · `internal/sourceaccount/lock_race_test.go` | See PR; exact run IDs not recorded here | Merged; old evidence index |
| R-BG-001 | Parent context canceled after worker returns cleanly | [#1406](https://github.com/lazyxu/xdrive/pull/1406) · `TestSchedulerParentCancelCleanReturnCannotCommitSuccess` | [repaired CI](https://github.com/lazyxu/xdrive/actions/runs/38137393433) | Merged |
| R-BG-002 | Canceled run resubmitted under same identity while old finalizer remains active | [#1414](https://github.com/lazyxu/xdrive/pull/1414) · `TestSchedulerCancelledRunDoesNotAbsorbImmediateResubmission` | [repaired CI](https://github.com/lazyxu/xdrive/actions/runs/38140882622) | Merged |
| R-BG-003 | Scheduler canceled execution receives late progress callback | [#1425](https://github.com/lazyxu/xdrive/pull/1425) · `TestSchedulerCancelledRunCannotPublishLateProgress` | [red](https://github.com/lazyxu/xdrive/actions/runs/38146522990) → [green](https://github.com/lazyxu/xdrive/actions/runs/38146697685) | Merged |
| R-TR-001 | Upload-group Finish invokes cancel callback which reenters snapshot/manager | [#1433](https://github.com/lazyxu/xdrive/pull/1433) · `TestUploadGroupFinishCancelCallbackCanReenterSnapshot` | [red](https://github.com/lazyxu/xdrive/actions/runs/38151250926) → [green](https://github.com/lazyxu/xdrive/actions/runs/38152059238) | Merged |
| R-TR-002 | Retry exits cleanly after context cancellation / late retry completion | [#1438](https://github.com/lazyxu/xdrive/pull/1438) · `TestRetryContextCancellationCleanExitCannotCommitSuccess` | [red](https://github.com/lazyxu/xdrive/actions/runs/38153811212) → [green](https://github.com/lazyxu/xdrive/actions/runs/38154506997) | Merged |
| R-TR-003 | Group terminal history visible before owned cancellation callback ends | [#1442](https://github.com/lazyxu/xdrive/pull/1442) · `TestHistorySnapshotWaitsForGroupCancellationHandoff` | [red](https://github.com/lazyxu/xdrive/actions/runs/38156479186) → [green](https://github.com/lazyxu/xdrive/actions/runs/38156750666) | Merged |
| R-TR-004 | Two competing direct BindCancel registrations orphan initial I/O owner | [#1447](https://github.com/lazyxu/xdrive/pull/1447) · `TestConcurrentDirectCancelBindingsHaveOneOwner` | [red](https://github.com/lazyxu/xdrive/actions/runs/38159940914) → [green](https://github.com/lazyxu/xdrive/actions/runs/38160137759) | Merged |
| R-TR-005 | Direct Cancel vs terminal Finish vs Clear/history handoff | [#1453](https://github.com/lazyxu/xdrive/pull/1453) · `TestDirectCancelTerminalFinishClearJoinsTransport` | [red](https://github.com/lazyxu/xdrive/actions/runs/38187995303) → [green](https://github.com/lazyxu/xdrive/actions/runs/38188272112) | Merged |
| R-TR-006 | One blocked old-account cancel prevents cancellation fan-out to independent uploads/downloads | [#1458](https://github.com/lazyxu/xdrive/pull/1458) · `TestAccountClearFansOutIndependentTransportCancels` | [red](https://github.com/lazyxu/xdrive/actions/runs/38189773914) → [green](https://github.com/lazyxu/xdrive/actions/runs/38189974166) | Merged |
| R-TR-007 | Concurrent account Clear returns before preceding Clear's I/O teardown | [#1464](https://github.com/lazyxu/xdrive/pull/1464) · `TestConcurrentAccountClearsJoinPendingOldTransport` | [red](https://github.com/lazyxu/xdrive/actions/runs/38191156162) → [green](https://github.com/lazyxu/xdrive/actions/runs/38191447056) | Merged |
| R-TR-008 | Second Clear during old account handoff leaves new-account transport running | [#1467](https://github.com/lazyxu/xdrive/pull/1467) · `TestSecondClearDuringOldHandoffAlsoCancelsNewAccount` | [red](https://github.com/lazyxu/xdrive/actions/runs/38194135634) → [green](https://github.com/lazyxu/xdrive/actions/runs/38194362963) | Merged |
| R-PULL-001 | Canceled queued Source still occupies shared provider-account waiter, starving next Source | [#1472](https://github.com/lazyxu/xdrive/pull/1472) · `TestCancelledQueuedSourceDoesNotStarveNextSharedAccountSource` | [red](https://github.com/lazyxu/xdrive/actions/runs/38196710592) → [green](https://github.com/lazyxu/xdrive/actions/runs/38197019592) | Merged on `master@9a49cb7d` |
| R-TR-009 | Prepared scanning callback arrives after same upload group completed scan and started transfer | [#1476](https://github.com/lazyxu/xdrive/pull/1476) · `TestLateScanProgressCannotReopenCompletedUploadGroup` | [test-only red](https://github.com/lazyxu/xdrive/actions/runs/38198337872/job/114645927150) → [repaired exact-head CI green](https://github.com/lazyxu/xdrive/actions/runs/38198569804) | Merged `dcd47cd6`; work branch [cleanup success](https://github.com/lazyxu/xdrive/actions/runs/38199255127) |

| R-TR-010 | Older cumulative child + group upload progress (20%) arriving after newer 80% **within same phase and attempt** | [#1495](https://github.com/lazyxu/xdrive/pull/1495) · `TestLateChildAndGroupProgressCannotRewindTransferredBytes` | [Unchanged-production First-red CI](https://github.com/lazyxu/xdrive/actions/runs/38211998634/job/114688037919) → [repaired exact-head CI #38212290600](https://github.com/lazyxu/xdrive/actions/runs/38212290600) (76 jobs; 25 success, 51 skipped, final gate green) | Merged `master@196c0b9f`; [branch cleanup](https://github.com/lazyxu/xdrive/actions/runs/38213076254) success, remote ref 404 |

| R-TR-011 | Equal-byte late group callback regresses child terminal counts | [#1503](https://github.com/lazyxu/xdrive/pull/1503) · `TestLateEqualByteGroupProgressCannotRewindTerminalItemCounts` | [First-red Windows Go](https://github.com/lazyxu/xdrive/actions/runs/38214765852/job/114696822973) → [repaired exact-head CI #38215092946](https://github.com/lazyxu/xdrive/actions/runs/38215092946) (76 jobs: 25 passed, 51 conditional skips; final gate green) | **Merged** `f200224d`; original test blob unchanged `59099bc...`, branch ref verified absent |

| R-MEDIA-001 | Physical thumbnail PUT → admin eviction → stale DB cache pointer | [#1508](https://github.com/lazyxu/xdrive/pull/1508) · `TestThumbnailCleanupDoesNotResurrectRemovedDerivativeMetadata` | [Real test-only First-red](https://github.com/lazyxu/xdrive/actions/runs/38217824658/job/114706604737) → [repaired exact-head CI #38218855626](https://github.com/lazyxu/xdrive/actions/runs/38218855626) (76 jobs: 25 success, 51 skips; Linux API `-race` original test PASS) | Merged `72fb6adc`, original branch ref 404 |

| R-STORAGE-001 | Live atomic Local.Put older than one hour vs admin aged temp cleanup | [#1515](https://github.com/lazyxu/xdrive/pull/1515) · `TestActiveLongRunningAtomicPutSurvivesTempCleanupRace` | [Authentic Linux API `-race` First-red](https://github.com/lazyxu/xdrive/actions/runs/38220588890/job/114715607592): `storage_active_temp_cleanup_race_test.go:143`, deleted active temp then `rename ... no such file` | Real bug reproduced; fixed-head CI pending |

### R-TR-009 authentic First-red, failure specifics

**Test-only source `cedd8fcce4acb019d0395165550911a3cb868f22`: real First-red confirmed** on [CI #38198337872 / Windows Go job #114645927150](https://github.com/lazyxu/xdrive/actions/runs/38198337872/job/114645927150). Exact original assertion at `group_scan_late_progress_race_test.go:75`: Phase `transferring→scanning`, `ScanComplete true→false`, `BytesDone 60→0`, `ItemsCompleted 1→0`, `ItemsQueued 0→2`, revision `3→4`. The product code was unchanged on this test-only head. The same test remains unmodified on the repair branch. The minimal fix rejects an older scan-progress snapshot only after the current group has already completed scanning. Repaired exact-head source `b892b506ec3823edd763e745e4580fa3a57a0709` passed [all 76 required CI jobs](https://github.com/lazyxu/xdrive/actions/runs/38198569804) (25 success, 51 conditional skips, 0 failure; final-gate green), merged linearly as `master@dcd47cd6e5fb7ecd15e4af3f64d5b858b7bf94ca`; [targeted branch cleanup succeeded](https://github.com/lazyxu/xdrive/actions/runs/38199255127).

### Race file inventory: 37 on R-STORAGE-001 test-only branch (36 on frozen master)

The following is the source inventory of **36 `*_race_test.go` files on frozen GitHub master** (through the merged R-MEDIA-001) and **37 on this new test-only branch** (including R-STORAGE-001). It is **not** 34 newly executed tests and does not claim each file separately produced First-red. The accepted test-ordering contracts above, not file counts alone, are the de-duplication authority.

**`internal/background/` (9 files)**

```text
scheduler_cancel_during_lease_release_race_test.go
scheduler_cancel_late_progress_race_test.go
scheduler_cancel_lease_acquire_race_test.go
scheduler_cancel_resubmit_capacity_race_test.go
scheduler_cancel_resubmit_race_test.go
scheduler_close_join_race_test.go
scheduler_external_cancel_late_progress_race_test.go
scheduler_parent_clean_exit_race_test.go
scheduler_stale_progress_race_test.go
```

**`internal/transfer/` (24 files)**

```text
account_clear_context_race_test.go
cancel_clear_handoff_race_test.go
cancelling_callback_phase_race_test.go
clear_cancel_callback_reentry_race_test.go
clear_new_account_during_old_handoff_race_test.go
clear_parallel_cancel_handoff_race_test.go
clear_start_child_race_test.go
concurrent_add_race_test.go
concurrent_clear_join_race_test.go
direct_cancel_binding_owner_race_test.go
direct_cancel_terminal_handoff_race_test.go
group_finish_cancel_reentry_race_test.go
group_finish_clear_handoff_race_test.go
group_scan_late_progress_race_test.go
history_pending_group_cancel_race_test.go
late_child_group_progress_race_test.go
late_equal_byte_group_terminal_counts_race_test.go
late_skip_cancel_race_test.go
late_success_pending_cancel_race_test.go
late_terminal_callback_race_test.go
old_account_local_reveal_race_test.go
retry_cancel_lifecycle_race_test.go
retry_clean_cancel_race_test.go
terminal_progress_lifecycle_race_test.go
```

**`internal/api/` (2 files on R-STORAGE-001 test branch)**

```text
media_thumbnail_cleanup_race_test.go
storage_active_temp_cleanup_race_test.go
```

**`internal/pullworker/` (1 file)**

```text
queued_cancel_account_waiter_race_test.go
```

**`internal/sourceaccount/` (1 files)**

```text
lock_race_test.go
```

**Other concurrency cases** can exist in files not named `*_race_test.go` (e.g. integrated worker, API, PostgreSQL, and browser tests). Search the affected subsystem's full tests before creating a branch. This manifest is intentionally stable at the frozen baseline and must be refreshed when additional test files merge.

### R-TR-010: new test-only probe and distinction from R-TR-009

- **Scenario identity:** genuine `Handle.ProgressAndUpdateGroup` on the **same child and root** of a live upload; both callbacks explicitly retain `PhaseTransferring` and `ScanComplete=true`; the older 20-byte count is released after an already-published 80-byte count. The prior R-TR-009 involved `UpdateGroup` reverting from **transferring back to scanning**, and does not test cumulative in-phase child progress ordering.
- **Assertion:** both child and group keep 80/100 bytes and 80%, `StateRunning`, and the snapshot revision does not advance for the old callback. Goroutine interleaving uses channel barriers; no timing luck or fake transport response.
- **Frozen original base:** `master@9e8f3344ad88cbf2877be6ed369c77bdc99068fb`; test-only source and CI details will be recorded in PR after the actual execution. **Authentic First-red confirmed** on [Windows Go job #114688037919](https://github.com/lazyxu/xdrive/actions/runs/38211998634/job/114688037919), test-only commit `d332b68db3e01e5eaea207ae41c78c81ee2a434f` (only the race test and registry changed). At `late_child_group_progress_race_test.go:83`, both child and root incorrectly changed `BytesDone 80→20`, `Percent 80→20`, and snapshot revision `4→5` after the controlled late callback. There was no Go compile/format/fixture failure; original production was executed. **The original test Blob SHA must remain unchanged in the repair work commit.** Minimal repair guards older cumulative child progress and older completed-scan in-phase group aggregate callbacks, without modifying `Baseline`, `Retry`, unrelated subsystems, or durable source state. **Confirmed repair and closeout:** original test blob `915beb97599d3a05ddd31495c040ea93367185c5` is unchanged in single work commit `552cde079ac2bbe835d6f92b414f268d5eed8611` (three scoped files, ahead=1/behind=0). [Exact repaired-head CI #38212290600](https://github.com/lazyxu/xdrive/actions/runs/38212290600) completed/success: 76 jobs, 25 success, 51 conditionally skipped, zero failure; [Windows Go](https://github.com/lazyxu/xdrive/actions/runs/38212290600/job/114689045366), [Linux Go `-race`](https://github.com/lazyxu/xdrive/actions/runs/38212290600/job/114689045186), [Linux API `-race`](https://github.com/lazyxu/xdrive/actions/runs/38212290600/job/114689044965), and [final-gate](https://github.com/lazyxu/xdrive/actions/runs/38212290600/job/114691026688) all successful. [PR #1495](https://github.com/lazyxu/xdrive/pull/1495) was rebase-linearly merged as `196c0b9fcdce9a3a8a16776808f4999fb068ba68` on 2026-10-12 06:33 UTC. [Targeted cleanup #38213076254](https://github.com/lazyxu/xdrive/actions/runs/38213076254) succeeded, and exact original remote work branch Ref returned HTTP 404. This proves GitHub CI and cleanup, not GitLab delivery or physical-device coverage.

### R-TR-011 authentic original-production First-red, repaired CI and merge

- Frozen GitHub base: `master@e2c5fc30c21ef0b674906fe6aa57caa73bc4e03b`. Deliberately check the in-phase **equal-byte** interleaving excluded from R-TR-010's decreasing-byte guard. Create two real child transfers; publish one terminal transition, then release an older already prepared group snapshot carrying two running items and zero completed/failed. Two cases: completed child and failed child.
- **Actual unchanged-production First-red:** test-only commit `443b0e9f9b961efb385083134525b876dc973e9d` (only new test + registry, no production edits), exact test blob `59099bc17abb1377d89465826ba7be007784b76d` (locally `gofmt`-validated). [CI #38214765852 Windows Go #114696822973](https://github.com/lazyxu/xdrive/actions/runs/38214765852/job/114696822973) executes both actual `Handle.UpdateGroup` deliveries; both completed-child and failed-child fail original assertion at `late_equal_byte_group_terminal_counts_race_test.go:111`. The first child's completed/failed counter regresses 1→0 and running counter 1→2; group snapshot revision incorrectly advances 7→8 while cumulative bytes stay 100/200. Neither gofmt nor harness caused the failure.
- **Minimal repaired code:** in `Manager.updateGroupLocked`, reject an older same-phase, same-byte upload-group snapshot that decreases already-published completed/failed item counts after `ScanComplete`. Do not touch child progress, scan-incomplete inventory, Retry attempt reset, terminal state, or any other module. Keep original test blob `59099bc...` untouched. Repaired exact source SHA, same-test CI, final gate, merge, and branch cleanup evidence are recorded below.

**R-TR-011 post-merge exact evidence (2026-10-12):** Repaired one-work-commit head `4d216ab05844ea63daf44f47778403b942728e33` preserved original test blob `59099bc17abb1377d89465826ba7be007784b76d`. [Repaired exact-head CI #38215092946](https://github.com/lazyxu/xdrive/actions/runs/38215092946) completed successful: 76 jobs, 25 success, 51 conditional skips, 0 failure; Windows Go and Linux Go/API `-race` plus final-gate all passed. [#1503](https://github.com/lazyxu/xdrive/pull/1503) rebase-linearly merged as `f200224d5bbab2034a5499b0fe887296f7d3042c`. The original work branch ref returned 404. The concurrent master scan cleanup workflow hit an API 403 rate-limit; the ref-absence check, not the failed scan status, establishes branch cleanup. No GitLab or physical E2E claimed.

### R-MEDIA-001 authentic First-red, repaired CI and merge

- Fixed master: `a2d2836cb94fb9a61f0ece8549291db0dfa1fbfa`. One new `internal/api/media_thumbnail_cleanup_race_test.go` integration test runs only with real `XD_TEST_DATABASE_URL`; uses repository's original PostgreSQL17 fixture, authentic uploaded PNG, original `Server.generateMediaDerivative`, local atomic `Local.Put`, original admin `cleanupStorageCache` and physical `Local.Open`. A narrow wrapper pauses after the real physical PUT returns; this is a scheduling barrier, not a fake API/SQL/cache response.
- Verify the real thumbnail is readable, trigger cache cleanup, release the delayed generator, then require that deleted physical thumbnail has no nonempty `MediaMetadata.thumbnail_key`/MIME/dimensions. A valid serialized cleanup is permitted, without rejecting implementations that serialize correctly.
- Original test-only work head `f3d4752c157236eaeb104349ff96bc2951b4743b` (only the integration test and registry) produced real [First-red Linux API `-race` #114706604737](https://github.com/lazyxu/xdrive/actions/runs/38217824658/job/114706604737): at line 178 the original physical cache key `.xdrive-media/thumbnails/...-v4-512.thumb` was not readable after successful deletion, yet `MediaMetadata.ThumbnailKey`, MIME and dimensions were republished by the delayed real generator. Only this new test failed; formatting, harness, and database prerequisites succeeded. This is a real logical race, not proof of physical devices or Go memory access races.
- **Minimal production repair (CI accepted):** immutable original test blob `6f082d828a1bbbb65d7d63676f70aba719d82281`. Shared PostgreSQL advisory transaction lock during derivative physical Store.Put + metadata publication; exclusive lock during administrator managed-cache deletion + DB thumbnail-key reset. Shared readers/writers permit independent media producers, exclusive admin cleanup serializes across Server instances using the same DB. Preserve ordinary cache identity and no Source/sync/transfer change. The original reproducer turned green on Linux API `-race` in completed [CI #38218855626](https://github.com/lazyxu/xdrive/actions/runs/38218855626) (76 jobs, 25 success, 51 conditional skips, final-gate success). #1508 merged linearly as `72fb6adc99a2cb764aa05d903a45edb8206607cb`; the original source branch ref was verified 404. No GitLab or physical-device validation claimed.

### R-STORAGE-001 authentic First-red and minimal repair gate

- Frozen GitHub `master@72fb6adc99a2cb764aa05d903a45edb8206607cb`, after #1508 merged and original Race branch ref returned 404. This is a **different storage-lifecycle interleaving**, not a rerun of derivative cache publishing or old retry/cancel tests.
- Use real `storage.Local.Put` into the normal atomic `.xdrive-upload-*` file. The real reader writes first bytes, then blocks with a channel while the writer still owns the file. After observing the actual file through `WalkManagedFiles`, age its filesystem timestamp beyond `storageTempReclaimableAge` to reproduce a legitimate stalled/very-large upload. Run genuine `Server.cleanupStorageCache(storageCleanupTemp)` against PostgreSQL17 + Local Store, then release reader.
- Assert original `Local.Put` still completes and the destination contains every byte, without a leaked temp. If cleanup deletes an open temp and the actual OS rename fails, that is a **real product failure**. A Windows platform refusing removal of an open handle is an accepted pass. An invalid DB fixture, test timeout, or skipped suite is not First-red. **First-red confirmed:** original test-only one-work-commit `fca424bf61fa77afca1108a381b0de103c30f47b` ran original production. [CI #38220588890 / Linux API Go `-race` #114715607592](https://github.com/lazyxu/xdrive/actions/runs/38220588890/job/114715607592) failed only this test at line 143: administrator cleanup deleted one real still-open atomic temporary file (`deleted=1`, `failed=0`); after releasing original reader, `Local.Put` failed `rename ... no such file or directory`. This is a true product filesystem lifetime race, not a timer/mock, gofmt, missing DB or fixture failure. Original test blob `7a391cc44c1973bb4526f8b06d4ba75d51c89e01` is bit-for-bit unchanged.
- **Repair submitted, CI pending:** a root-scoped, persistent OS file lock supports parallel Local.Put writers via shared locks held through rename. A storage_temp/all admin cleanup takes a nonblocking exclusive lease; if any live writer owns the shared lock, the cleanup skips aged temporary objects rather than unlinking active uploads or blocking them. Linux/macOS use `flock`, Windows uses `LockFileEx`. The lockfile is not a reclaimable write-temp file. The admin's existing PostgreSQL cache lock is acquired before optional temp-cleanup lease, preserving lock ordering when media derivative writers own both. New cross-Local-instance unit test verifies shared and exclusive ownership. Preserve original test; exact repaired-head CI/final gate, merge and branch cleanup must be observed before completion.

### Known covered test families (avoid category-level duplicate probes)

- **Transfer:** `internal/transfer/*_race_test.go` also covers child creation vs Clear, cancellation vs complete/retry, old-account stale handoffs, group Finish/trim, progress/terminal revision, and stale network progress observers. Compare the *exact* test's interleaving before repeating.
- **Scheduler:** `internal/background/*_race_test.go` covers Close/join, parent/timeout/lease cancellation, retry, resubmission capacity, release handoff and late-progress fencing. A new coverage gap must identify an untested ordering rather than simply re-run “Cancel vs Complete”.
- **Source / Gallery / FileExplorer:** check relevant module tests before adding a new probe; Go `-race` suites, true browser IPC and database-backed tests are different evidence scopes. Do not mark a synthetic metadata or fixture test as physical E2E.

### Invalid harness failures retained (not First-red)

- [#1472](https://github.com/lazyxu/xdrive/pull/1472): CI [#38196147034](https://github.com/lazyxu/xdrive/actions/runs/38196147034) failed gofmt, and [#38196430290](https://github.com/lazyxu/xdrive/actions/runs/38196430290) hit nil-DB fixture cleanup panic. Both are **invalid First-red attempts**. Only the later unchanged-production [#38196710592](https://github.com/lazyxu/xdrive/actions/runs/38196710592) yielded the authentic stale shared-account waiter failure.

### Next untested / targeted scenario queue

| Candidate | Forced interleaving / required evidence | State |
| --- | --- | --- |
| R-TR-009 | Older folder-scanning snapshot delivered after `ScanComplete=true` / `PhaseTransferring` was published | Completed: red → green → merged #1476; exact-head CI success, branch deleted |
| R-TR-010 | Child `ProgressAndUpdateGroup` callbacks in one running upload attempt: newer 80% then older 20%; child/root/revision must not regress | **Accepted, merged #1495**: [First-red #38211998634](https://github.com/lazyxu/xdrive/actions/runs/38211998634) → [repaired exact-head #38212290600](https://github.com/lazyxu/xdrive/actions/runs/38212290600), original test identical, merge `196c0b9f` and cleanup #38213076254 success |
| R-TR-011 | Same 100/200 bytes but older progress precedes a child completion/failure | **Completed**: original test-only `443b0e9f` First-red Windows Go #114696822973; original test blob `59099bc17abb1377d89465826ba7be007784b76d` unchanged in repaired head `4d216ab0`, [CI 38215092946](https://github.com/lazyxu/xdrive/actions/runs/38215092946) success; rebase-linear merged `master@f200224d5bbab2034a5499b0fe887296f7d3042c` and original remote branch Ref 404. Cleanup scan run 38216585134 failed independently due GitHub App API 403 rate limit; not evidence the merged work branch remains. |
| R-MEDIA-001 | Real PostgreSQL/Local Store: thumbnail PUT completed; admin cleanup removes object; late writer attempts metadata publication | **Completed**: First-red `f3d4752c`, [CI 38217824658](https://github.com/lazyxu/xdrive/actions/runs/38217824658); unchanged test blob `6f082d828a1bbbb65d7d63676f70aba719d82281` in repaired one-commit head `c68ffa46`, [full repaired CI 38218855626](https://github.com/lazyxu/xdrive/actions/runs/38218855626) success and exact original test PASS (10.57s); linear merge `72fb6adc99a2cb764aa05d903a45edb8206607cb`, work branch Git Ref 404. |
| R-STORAGE-001 | Original atomic writer with a still-open, age-expired `.xdrive-upload-*`; administrator cleanup physically deletes it before original rename | **Real First-red confirmed** on unchanged production head `fca424bf`, [Linux API `-race` #114715607592](https://github.com/lazyxu/xdrive/actions/runs/38220588890/job/114715607592): cleanup deleted=1, no file failures, upload `os.Rename` failed. Original test blob `7a391cc44c1973bb4526f8b06d4ba75d51c89e01` unchanged. Cross-process shared/exclusive filesystem lifetime lock fix submitted; exact-head repaired CI pending. |
| R-SYNC-001 | Source deletion/revision revoke vs running durable synchronization; require actual worker/DB fencing and cancellation semantics | Not run in this registry |
| R-DESKTOP-001 | Renderer window/session switch vs active Agent IPC callbacks; verify old session never updates new session, without aborting durable sync | Not run in this registry |

### Evidence recording template

```text
ID: R-...
Scenario signature: producer/API; A vs B; forced ordering; identity/attempt; platform
Frozen base and exact test-only SHA:
Original failing assertion, stack trace, CI run/job:
Harness failures, if any, with invalid status and cause:
Minimal production change (only after real First-red):
Same unchanged test, repaired exact SHA and CI:
Relevant Go race / Windows Go / Web / Desktop / DB checks:
Final gate; PR merged?; merged master SHA; branch cleanup verification:
Retest reason if an equivalent workload was previously accepted:
Unverified physical or GitLab scope:
```
