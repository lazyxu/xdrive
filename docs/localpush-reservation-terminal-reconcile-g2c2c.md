# L03-G2c2c · Owning-Agent reservation-terminal reconciliation (private)

## Verified prerequisite and frozen scope

The accepted parent G2c2b [#2183](https://github.com/lazyxu/xdrive/pull/2183)
passed its own exact-head [77-job CI #39362087725](https://github.com/lazyxu/xdrive/actions/runs/39362087725)
(25 success, 52 conditionally skipped, zero failure, final-gate success)
and was Rebase-merged as `eceb70a953fc43db1a70acc4d7b8e37673c5f5d8`.
The G2c2b first-leaf recovery observer is the only accepted baseline;
do not reopen #1276/#1277, enable remote device writes, or alter
independent Gallery, Host, Files, performance, or race branches.

## Problem

G2c2b can independently verify that a particular historical operation
actually committed one canonical file (original OS fd + immutable keyed
PostgreSQL commit + physically present pinned CAS). However, if no
historical commit can be verified, **absence of a COMMIT observation does
not mean that cancellation safely terminated native or remote file work**.
The existing Server reservation-terminal proof is deliberately weaker:
it only records that the original admission was `aborted` or `expired`.

A 30-second reservation timeout is NOT an upload acknowledgment, file
terminal, physical cancellation, SourceRun completion, or permission to
delete/reissue the original OS-private request key.

## G2c2c implementation

- Factor the original G2c2b admission into
  `readPriorFirstLeafOriginalEvidence` so historical physical verification
  and this terminal observer require the same immutable Stage admission
  marker, exact SecretStore key, MAC-bound prepared UUID/generation and
  **exactly one** native Stage hint for the same current first-level file.
  Missing, corrupt, orphaned, foreign or ambiguous entries fail closed.
- Add `inspectLocalPushFirstLeafReservationTerminalPrivate` on only the
  owning Agent, serialized by its existing local grant mutex. Resolve its
  current credentialed Server/account/session, Device, strong native Root,
  Source revision and cloud target via the same private Driver constructor.
- Open the actual CURRENT original Linux/Windows OS file descriptor under
  `WithHeldCurrentOriginalReadCheckpoint`, retain it across the Server
  request and post-hash the exact descriptor. Recheck the original key,
  MAC correlation, Stage hint, private claim, Root/Source/session before,
  during and after the request.
- Use the existing credentialed
  `client.ReadLocalPushTerminalProof`, which **may materialize one immutable
  reservation-terminal SQL row** after the trusted Server DB clock reports
  abort/expiry. Server SQL admission separately rejects an actual recorded
  first-leaf COMMIT, including historical generations, and binds the
  original operation UUID/generation and nonzero 32-byte request key.
  No inferred state is produced on missing evidence or read errors.
- Return only an **unexported, non-JSON** reservation-status observation.
  Do not convert `aborted` or `expired` into a physical stop signal.
  Original local Stage claim, 32-byte key and prepared receipt stay
  quarantined. There is NO user-facing IPC, Web/Renderer control, scheduler,
  new upload endpoint, file COMMIT, new operation generation or SourceRun.

## Verification and explicit NO-GO

Original owning-Agent OS/SecretStore tests exercise the exact local
claim/key/Stage lineage, altered/wrong-permission claims, ambiguous Stage,
scope and terminal identity mismatches, cancellation, native-original
absence, no auto-deletion, JSON redaction and IPC source contracts. The
existing Server two-pool PostgreSQL tests protect SQL COMMIT vs terminal
exclusion, and existing client tests validate the strict terminal response.
These new tests do NOT substitute for installed Linux/Windows power-loss,
real multi-process 100k or >=4GiB physical cancellation proof.

**Still NO-GO:** distributed physical COMMIT-versus-cancel exclusion,
crash-safe original file-terminal receipt, audited operation-key and Stage
claim retirement, SourceRun completion, user start/pause/cancel, scheduled
Push, remote device write, NAS/Mirror, nested/multi-file or large-file
chunking, 100k and >=4GiB production E2E.

## Acceptance

Exactly ONE G2c2c work commit based on the full frozen current master,
including the complete additive original AGENTS.md history. Run its OWN
77+ Linux/Windows Agent + genuine PostgreSQL API Race + Web/Desktop +
Rootless/installers/images/artifacts + single-commit/Final Gate CI. Fix
actual failures without skipping tests. Require fresh GitHub
`mergeable_state=clean`, Ready/Rebase Merge and successful branch
cleanup. Any rewritten SHA requires wholly new source-exact CI.

## First CI formatting failure

The initial G2c2c exact work HEAD `4fc0426a16c1fef20e922d1d7c2cc36e00b9a02d` was **RED** on Go/Linux gofmt in [CI #39366012934](https://github.com/lazyxu/xdrive/actions/runs/39366012934). Only align the new terminal observation and fixture struct field values to the original gofmt diff. Preserve all authorization gates, OS/Server tests and unrelated code; rebuild one work commit on unchanged complete master and require a **new** full exact-head CI before merge.

## Second-stage acceptance: late duplicate Stage fails closed

Review found a source-level time-of-check risk: an initial exact-one Stage selection is not enough if a second Stage recovery hint appears during network observation. Re-list the complete bounded persisted Stage hint set before, during and after the native-held Server request and require it still contains exactly the same ONE Stage and path. Apply that shared check to G2c2b's physical COMMIT confirmation too; a successful immutable CAS observation must not hide a newly ambiguous local history. Keep the original Stage claim/key unchanged on denial. This is a source change: require a NEW full exact-head CI; no green from an earlier head can approve it.

## Exact-head green before concurrent AGENTS conflict

One-work G2c2c SHA `2025bfb89e2c9786085aa59493c0bd0fa9f3aaf0`
passed its own complete [77-job CI](https://github.com/lazyxu/xdrive/actions/runs/39367028469)
(25 success, 52 conditional skip, zero failures, final-gate green).
Unrelated master merges introduced a genuine additive AGENTS.md merge conflict
(`mergeable_state=dirty`). Retain unchanged production/test Go and Desktop
blob SHAs while reconstructing exactly one scoped work commit on COMPLETE
`master@940a0c8a3aa58dbe78acdf2b3b20ea9c4f7d6960` with the full current AGENTS history.
This rewritten commit requires its **own NEW full CI** and clean mergeability.
The older green belongs only to the older commit. No product activation.
