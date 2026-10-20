# L03-G2c2b · Private read-only recovery of the exact first-leaf operation

## Base, intent and source of truth

Start from the COMPLETE `master` after #2178 (G2c2a). The accepted G2c2a
one-work head `0e2e7e48785576a470eee8397349ec2da0b58782` completed
[full 77-job CI](https://github.com/lazyxu/xdrive/actions/runs/39353948132):
25 success, 52 conditional skip, zero failed; exact final-gate green. It was
Ready, GitHub clean and Rebase-merged as
`d11a3f5208895c1309c3227a4d113cd6b400ba72`.
Do not change any unrelated Gallery/Files/Host/performance/race owner branch.

A Stage O_EXCL claim and an OS request secret survive Agent restarts. They
do not, individually or together, establish an SQL COMMIT or authorize a new
Stage. Once the Agent restarts, its only safe initial operation is a
**read-only, exact-original reconciliation**, never a replacement upload.

## Narrow G2c2b delivery

- Share a single owning-Agent, mutex-only driver factory for fresh and
  recovery paths. It authenticates same Server/account/login session, current
  Device token, saved native Root/fingerprint, Source revision, target and
  Backup mode. The existing fresh runner still uses the very same
  `localpushrunner.RunFirstLeaf` protocol and pre-Stage G2c2a fence.
- An unrouted Agent-only `recoverLocalPushFirstLeafPrivate` entrypoint
  requires the exact existing 0600 private Stage claim, the unchanged
  32-byte OS SecretStore key, the MAC-bound prepared Operation UUID/generation
  and **exactly one** verified Stage hint for the requested current first-level
  file. Multiple candidates, old Source revision or missing/corrupt evidence
  fail closed without creating a replacement operation.
- Reuse the existing `Driver.Reconcile` held-native-original, historical
  PostgreSQL/CAS receipt, immutable SourceItem/Node evidence, native
  post-hash and fresh device/root/session checks. Bound the read by the
  caller's context; reject replacement claim/hint after the read.
- Neither this observer nor its validation calls Stage, Prepare, Bind,
  physical COMMIT, new-key mint, file deletion, SourceRun completion,
  key/claim retirement, Web/Renderer/IPC, or a scheduler. All uncertain
  cases retain original private evidence. Confirmed means **one observed
  physical first file only**, not backed-up Source or backup-complete.

## First CI failure and formatting-only correction

First source-exact CI [#39359786474](https://github.com/lazyxu/xdrive/actions/runs/39359786474) was RED: go-linux gofmt rejected three inline test closures and a trailing blank line in the refactored driver. Correct only those gofmt differences; do not weaken native/OS/Server/SecretStore authorization or restore stale original code. The rebuilt single work commit must run a wholly new full 77+ CI.

## Acceptance and blocked production gates

New real local private-claim/SecretStore tests cover missing, corrupt,
wrong-permission and orphan artifacts; exact-one-stage selection; prepared
receipt without native Stage; cancellation, JSON isolation and forbidden
write/IPC calls. These are NOT installed-device cross-host atomicity tests.

Still hard **NO-GO**: G2c distributed COMMIT/cancel exclusion, retired-key
proof, native terminal receipt and power-loss recovery, SourceRun state
machine, user start/pause/cancel, automatic scheduler, Mirror/NAS Push,
nested/multifile, >64 MiB and >=4 GiB/100k real installed E2E.
Keep this PR Draft until its own single-work exact-head full 77+ CI has
passed (Go Linux/Windows/true PostgreSQL API Race/Web/Desktop/rootless/
installers/images/final-gate). Then fresh clean rebase merge; never borrow
#2178's green CI.

## Exact-head CI after conflict-only master reconstruction

The original G2c2b work head `a48030105d63e7075573194faf0911dea2e9e337`
passed its own [77-job CI #39360099538](https://github.com/lazyxu/xdrive/actions/runs/39360099538)
(25 successful, 52 conditionally skipped, 0 failed, Final Gate green).
GitHub merger nevertheless returned HTTP 405 after independently merged
Gallery/Host/Files updates made the append-only AGENTS overlap. The branch
was rebuilt on complete `master@c2656c401b7353bb7d1d6ab0d57d6981e70b7539` because there was a genuine
merge conflict. Preserve unchanged G2c2b Go implementation/test blobs and
all new unrelated master source/history. Require a new full source-exact
77-job CI, clean Ready/Rebase Merge and branch cleanup. Do not count the
older green CI as proof for the newly rebased work SHA.

