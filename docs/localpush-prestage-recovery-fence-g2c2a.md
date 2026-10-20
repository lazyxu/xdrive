# L03-G2c2a · Durable owning-Agent pre-Stage admission

## Accepted base

G2c1 [#2173](https://github.com/lazyxu/xdrive/pull/2173) passed its own
[77-job full CI](https://github.com/lazyxu/xdrive/actions/runs/39292136985)
(25 success, 52 conditional skip, 0 failure; final-gate green), was Ready,
GitHub mergeable_state=clean, and Rebase-merged as
`master@3465e2bd40a91eea0049be068238a5b12f51621d`.
This G2c2a work is a single independent commit on the later complete master.

## Why a second local claim is needed

A previous Agent can Stage native original bytes and crash before it mints
the G2c1 request key in Prepare. Therefore an absent request-key claim does
not prove there was no earlier byte stream, lost Stage HTTP ACK or temporary
CAS object. A newly started Agent must not start another Stage on that basis.

## Delivery

- Owning Agent's private `localPushFirstLeafDriver.Stage` now calls
  `reserveFreshLocalPushStageAdmission` **before**
  `StageVerifiedNativeOriginalBytes` opens or streams the native original.
- Create a private one-use nonsecret `stage-admissions` OS claim with
  O_EXCL, flushed file and POSIX parent-directory fsync. Its stable slot
  uses Server/account/Device/Source, not mutable session, Root,
  Source revision, target or original filename.
- Reject old current-Root Stage recovery directories, **including empty
  directories left after interruption**, plus the G2c1 durable operation
  slot. Repeat owner/Root and request-key preflight after claim publication.
- Fail closed for revoked Root, wrong account/device, cancellation, unknown
  SecretStore error, preexisting claim, insecure directory and symlink.
  A failed Stage/commit or lost ACK never removes the original claim.
- Unit tests use real private filesystem claims, saved Root grants,
  Stage recovery history, scope drift and two concurrent Agent contenders.
  The Agent source-contract test also forbids moving the claim behind the
  native-byte staging call.

## Explicit NO-GO and next acceptance steps

This protects one **local** pre-Stage race; it does NOT prove distributed
atomicity between a held OS native original, a remote PostgreSQL COMMIT,
cancellation, Server-side Stage, and multiple *installations*. It does not
automatically recover a crashed Stage or retire its claim, nor cover power
failure between OS writes, older Agent binaries or manual private-state
tampering. Existing Server physical/CAS, original request key, Device,
Root and Source checks all remain mandatory.

The one first-file SourceItem remains PENDING. Production activation,
SourceRun, scheduling, UI start/stop, Agent IPC, remote device write,
Mirror/NAS, nested/multifile, >64MiB, 100k and >=4GiB installed testing
are still NO-GO. Next G2c stages must implement exact same-operation
crash recovery, durable COMMIT-versus-cancel exclusion and independently
verified terminal receipt before audited OS claim/key retirement.

Merge only after THIS exact single-work HEAD passes complete 77+ Go
Linux/Windows, real PostgreSQL API Race, Web/Desktop, Rootless, artifacts,
images/installers, source tests, single-commit and Final Gate CI, with
fresh clean mergeability. Retain the FULL additive AGENTS.md history and
leave unrelated owner branches untouched.
