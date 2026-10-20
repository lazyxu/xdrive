# L03-G2c2d2a — Private native-first-leaf positive observation journal

## Accepted starting point

G2c2d1 PR #2192 passed exact-head 77-job GitHub CI #39371493172
(25 successful, 52 conditionally skipped, zero failed, Final Gate green)
and was Rebase-merged to complete master as
`1198dea57321e11cb8042ed5ecf8bc8010af9795`. Its remote work branch
was verified absent. Preserve all independent Files/Gallery/Host/performance/
race work and full append-only `AGENTS.md` history.

## Specific crash-recovery gap

G2c2b can verify an *ephemeral* matching historical SQL commit + pinned
physical CAS + unchanged, strongly held native original descriptor. G2c2c
can observe a matching abort/expiry of the *reservation* alone. G2c2d1
classifies them without equating expiry with physical cancellation. None
of these permits a new file operation or retires the original native OS
request key. A crash after a verified positive read currently loses even
the local diagnostic observation itself.

## Narrow G2c2d2a implementation

Add an explicit, unexposed owning-Agent-only
`auditLocalPushPriorPhysicalCommitPrivate` entrypoint under the original
`localFolderGrantMu`, separate from the G2c2d1 **read-only** classifier.
It re-opens the exact original O_EXCL pre-Stage claim, original 32-byte OS
SecretStore request key and MAC-bound UUID/generation, requires **exactly
one** persisted Stage, authenticates the current Server/account/session,
Device, strong Root, Source revision and target, then independently reruns
the original-key historical SQL/CAS read while the actual original file
descriptor is held and post-hashed. Missing, changed, aborted, expired,
uncertain or foreign evidence fails closed: ONLY a verified positive
physical observation proceeds to a private disk diagnostic append.

The file is stored in the Agent's existing private config directory under
a hashed, stable Server/account/Device/Source slot, O_EXCL 0600 with a
0700 parent, file fsync and POSIX directory fsync. No path, token, password,
Root ID, account name or raw original key is written. The saved V1 record
binds the exact original scope digest, Stage, UUID/generation, content hash,
native snapshot and path key, size and observed UTC instant by an HMAC
using the ORIGINAL OS-private key. Exact idempotent replay is strictly
read-only; a partial/corrupt/foreign claim is never replaced or deleted.
A current read must re-check the original key/claim/Stage before the MAC-
bound diagnostic record can be viewed. Changed account, current Source or
Root, alternate Stage, symlink, insecure permissions, bad MAC, unknown JSON
field, cancellation or failed fsync remain quarantined.

**The journal is diagnostic only.** It is NOT a durable physical file-
terminal COMMIT receipt, a cross-host SQL/OS transaction, a signed Server
file-cancel receipt, a native writer-quiescence proof or a complete SourceRun.
The positive historical SQL/CAS/current-native proof must be independently
repeated after restart; no stored journal alone may justify success,
credential retirement, upload replay or a new generation. On Windows, a
flushed file/O_EXCL does NOT alone establish power-loss durability.

## Verification and release blockers

Original Go tests use real temporary private config directories, Stage
O_EXCL claim, SecretStore original key and MAC prepared UUID/generation;
check positive idempotent append, surviving original key/Stage, exact
identity, corrupt HMAC/unknown JSON, symlink/mode, orphan partial marker,
session switch, extra Stage, canceled caller and zero public IPC/writer
calls. This is NOT installed-device, cross-process or power-loss E2E.

Production Push remains **disabled**. G2c2d2b+ must implement independently
verified, durable **file-level COMMIT versus physical-CANCEL** exclusion,
writer quiescence, exact terminal replay and audited one-way retirement
of original Stage/key. Only then can SourceRun, on-device start/pause/cancel,
automatic scheduler, multi-file/chunked >=4 GiB, 1k/10k/100k interrupted
Windows/Linux acceptance, Mirror/NAS be considered. No Web/foreign Desktop
write or complete-backup status is introduced in this phase.

Merge gate: one scoped work commit on complete master, preserve full
append-only AGENTS history and all other PRs, pass its OWN 77+ GitHub CI
including Go Linux/Windows, true PostgreSQL API Race, Web/Desktop,
Rootless/installers/images/artifacts, single-commit and Final Gate. Require
fresh `mergeable_state=clean` before Ready/Rebase Merge and verify branch
cleanup. No previous commit CI certifies new source.

## First exact-head CI failure and scoped correction

First submitted SHA `5da387cc4ae1cb4ac928a83dfd2d547b33013a7c` was RED in [CI #39374313917](https://github.com/lazyxu/xdrive/actions/runs/39374313917): the new Go Agent test mistakenly used `RootGrant.RootFingerprint`, but the real RootGrant field is `Fingerprint`. Correct only that test field, without changing any production audit/source logic. The same CI also reported a Baidu Map quota admission PostgreSQL Race test failure unrelated to LocalPush-modified files; do not change Baidu code, waive it, or count the old run green. The reconstructed **one-work** head on unchanged frozen master must independently pass its own entire 77+ CI and Final Gate.

## Complete-master conflict-only reconstruction

The old exact one-work SHA `7b2bb5a70d0b1162e5b63d37d8af938b8a31dc3a` passed
[77-job CI #39374842614](https://github.com/lazyxu/xdrive/actions/runs/39374842614)
(25 success, 52 conditionally skipped, zero failure, Final Gate green).
Unrelated Gallery A3h merged to master and caused a REAL additive AGENTS.md
merge conflict, `mergeable_state=dirty`; no merge of #2197 occurred.
Reconstruct exactly one unchanged G2c2d2a production/test Go work commit from
complete `master@be5d58ed42eecdb6d69de83a7b3d6b3dcf7c0ed7` while preserving all new unrelated master files
and cumulative AGENTS history. A fresh own 77+ CI must independently pass
for this rewritten SHA. Do not use old CI or an audit-only marker to enable
uploads, file cancellation, credential retirement or SourceRun.
