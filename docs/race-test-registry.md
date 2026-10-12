# Race / Concurrency Test Registry

> Canonical deduplication and evidence ledger for xDrive concurrency investigations. Updated 2026-10-12. **Not a claim that every package or hardware configuration was retested on this date.**
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
| R-TR-009 | Prepared scan-progress callback arrives after the same upload group's scan completed and transfer started | `internal/transfer/group_scan_late_progress_race_test.go` · `TestLateScanProgressCannotReopenCompletedUploadGroup` | [Real test-only First-red: Windows Go job #114645927150](https://github.com/lazyxu/xdrive/actions/runs/38198337872/job/114645927150), `cedd8fcc`. See [#1476](https://github.com/lazyxu/xdrive/pull/1476) for repaired exact-head CI and merge status. | First-red confirmed; fix under CI gate |

### R-TR-009 authentic First-red, failure specifics

**Test-only source `cedd8fcce4acb019d0395165550911a3cb868f22`: real First-red confirmed** on [CI #38198337872 / Windows Go job #114645927150](https://github.com/lazyxu/xdrive/actions/runs/38198337872/job/114645927150). Exact original assertion at `group_scan_late_progress_race_test.go:75`: Phase `transferring→scanning`, `ScanComplete true→false`, `BytesDone 60→0`, `ItemsCompleted 1→0`, `ItemsQueued 0→2`, revision `3→4`. The product code was unchanged on this test-only head. The same test remains unmodified on the repair branch. The minimal fix rejects an older scan-progress snapshot only after the current group has already completed scanning. Repaired source/CI and final merge status: follow [#1476](https://github.com/lazyxu/xdrive/pull/1476); acceptance requires its exact repaired head's full CI and final-gate.

### Master baseline inventory: all 32 existing `*_race_test.go` files

The following is a **source inventory on fixed `master@9a49cb7d`**, not 32 newly executed tests, not proof each had its own red CI, and not a substitute for the 13 evidence-indexed contracts above. Check names and the original test before adding a similar scenario. The new R-TR-009 file is separate from these 32.

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

**`internal/transfer/` (21 files)**

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
history_pending_group_cancel_race_test.go
late_skip_cancel_race_test.go
late_success_pending_cancel_race_test.go
late_terminal_callback_race_test.go
old_account_local_reveal_race_test.go
retry_cancel_lifecycle_race_test.go
retry_clean_cancel_race_test.go
terminal_progress_lifecycle_race_test.go
```

**`internal/pullworker/` (1 files)**

```text
queued_cancel_account_waiter_race_test.go
```

**`internal/sourceaccount/` (1 files)**

```text
lock_race_test.go
```

**Other concurrency cases** can exist in files not named `*_race_test.go` (e.g. integrated worker, API, PostgreSQL, and browser tests). Search the affected subsystem's full tests before creating a branch. This manifest is intentionally stable at the frozen baseline and must be refreshed when additional test files merge.

### Known covered test families (avoid category-level duplicate probes)

- **Transfer:** `internal/transfer/*_race_test.go` also covers child creation vs Clear, cancellation vs complete/retry, old-account stale handoffs, group Finish/trim, progress/terminal revision, and stale network progress observers. Compare the *exact* test's interleaving before repeating.
- **Scheduler:** `internal/background/*_race_test.go` covers Close/join, parent/timeout/lease cancellation, retry, resubmission capacity, release handoff and late-progress fencing. A new coverage gap must identify an untested ordering rather than simply re-run “Cancel vs Complete”.
- **Source / Gallery / FileExplorer:** check relevant module tests before adding a new probe; Go `-race` suites, true browser IPC and database-backed tests are different evidence scopes. Do not mark a synthetic metadata or fixture test as physical E2E.

### Invalid harness failures retained (not First-red)

- [#1472](https://github.com/lazyxu/xdrive/pull/1472): CI [#38196147034](https://github.com/lazyxu/xdrive/actions/runs/38196147034) failed gofmt, and [#38196430290](https://github.com/lazyxu/xdrive/actions/runs/38196430290) hit nil-DB fixture cleanup panic. Both are **invalid First-red attempts**. Only the later unchanged-production [#38196710592](https://github.com/lazyxu/xdrive/actions/runs/38196710592) yielded the authentic stale shared-account waiter failure.

### Next untested / targeted scenario queue

| Candidate | Forced interleaving / required evidence | State |
| --- | --- | --- |
| R-TR-009 | Older folder-scanning snapshot delivered after `ScanComplete=true` / `PhaseTransferring` was published; original revision and snapshot must remain unchanged | First-red proven on original code; fix under exact-head CI |
| R-MEDIA-001 | Concurrent thumbnail generation vs deletion/eviction of the same physical cache identity; require actual generation + eviction + reader evidence | Not run in this registry |
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
