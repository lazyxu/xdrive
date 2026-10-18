# L03-G0-A2b2b2c2b — authenticated post-restart prepared operation reconciliation

**Parent:** #2004 L03-G0-A2b2b2c2a completed exact-HEAD GitHub
[CI #39038876184](https://github.com/lazyxu/xdrive/actions/runs/39038876184)
(76 jobs, 25 successful, 51 conditional skips, final-gate green)
and was Rebase-merged as `master@3ae7c99a29d7411eb80fe14d22daa64525717c99`.
Its old LocalPush work branch has been independently verified absent.
This is the next, separately reviewed Agent-private prerequisite.

## Reconcile only under the CURRENT owning native checkpoint

An offline saved operation UUID and generation is **not** evidence that
the Server still authorizes that operation. A 30-second reserved lease
may have expired, a different generation may exist, or the account,
Device, Root, Source revision, target, login session or actual native
CURRENT directory may have changed.

New `withBoundLocalPushReconciledReceipt` is Agent-package-private.
It **never mints** a new request key. It composes the already-accepted
`withBoundLocalPushHeldRequest` with `newRequest=false`:

1. Current registered owning-Agent device token, authenticated Owner
   session, correct Root grant, paused local_folder/push Source, target
   and exact Source revision are read from Server and compared against
   the sealed CURRENT/PREVIOUS native inventory evidence.
2. The real Agent native reader opens and pins the CURRENT first-directory
   OS handle; a second independent authenticated Server/Root/Source read
   takes place **within the still-held native callback**, before any
   private offline journal or operation ID is consulted.
3. The original exact, nonzero 32-byte persisted request key is recovered
   from SecretStore; `loadLocalPushPreparedReceipt` requires a valid
   exclusive local claim, the same current scope (Server/account/login
   session/Device/Root fingerprint/Source revision/target), and an intact
   request-key HMAC before returning exact UUID and generation.
4. ONLY THEN the real owning Agent's Go Client sends an authenticated
   `POST /api/v1/sources/:id/local-operation/observe` using current
   device token and Root, with If-Match revision, **while the native
   handle is held**. Server independently checks JWT, Device,
   Root fingerprint, latest operation UUID/generation and SQL clock.
   The reply must match exact source, revision, UUID and generation.
5. A returned state `reserved`, `aborted` or `expired` is a
   **non-authoritative private observation only**. No state is
   interpreted as real upload, SourceRun cancellation or a durable
   terminal proof. The existing third Server/Root/session check and
   final native directory identity/generation recheck must succeed
   before the private result may be returned.

The real `inspectLocalBoundBackupReconciledReceipt` supplies owning
`c.localBoundBackupConfig`, OS-held
`RecheckLocalFirstDirectoryNativeWithHeldCheckpoint`, current
`userconfig.Load`, and the credentialed
`Client.ObserveLocalPushOperation`, serialized by
`localFolderGrantMu.TryLock`. There is NO production caller,
Agent loopback IPC route, Electron Main/Preload/Renderer exposure,
Web/Mobile Web endpoint, scheduler or worker.

## Security and test evidence boundaries

The result has unexported `operationID`, `generation` and `state`
fields and serializes to `{}`. Missing key or receipt, orphan/tampered
local claim, invalid/different operation ID, stale generation, revoked
owning device, foreign account/login, changed Root/Source/target,
replaced native directory, malformed/cacheable Server response and
cancellation fail CLOSED with an opaque result. No raw Server error,
credential, local absolute path, Root fingerprint, stored token or
request key may enter an Agent IPC/Renderer DTO.

Go tests use the real local RootGrant and durable SecretStore journal,
an injected test-only native held-reader for deterministic three-read
ordering and bad-state tests, plus an `httptest.Server` using the
**real** Go Client status HTTP codec inside the callback with owner
JWT/device token/Root/If-Match checks. These tests do not prove that
a real native OS descriptor is atomically coupled to PostgreSQL or
that a physical Windows/Linux installed Desktop survives power loss.
Unrelated Go API PostgreSQL two-pool authorization tests from #1989
remain the only Server transport proof. Native installed 1k/10k/100k
or >=4GiB whole-device backup E2E is still NOT verified.

**HARD NO-GO:** No committed-file or terminal backup receipt has been
created; no local key or correlation receipt is ever deleted, rotated
or automatically expired. An observed `aborted` or `expired` reservation
does not itself permit releasing a key or retrying a fresh operation.
The production `local_folder` activation/Run remains hard denied;
Stage remains <=64 MiB, NAS Push unsupported, Mirror deletion disabled,
foreign Desktop/Web/Mobile Web read-only. Existing Pull Sources and
CAS/Node/SourceItem histories are not changed.

**Next L03-G0-A2b2b2c2c:** separately specify and implement
independently authenticated *durable terminal receipt* and strict
request-key retirement eligibility with post-crash concurrency,
revocation, stale generation and database clock tests. Only afterward
consider a production original-file/CAS/SQL writer or true owning
Desktop start/pause/cancel and auto schedule.

Require exactly ONE scoped work commit on frozen master and the exact
work-HEAD's full GitHub Go Linux/API PostgreSQL Race, Windows,
Web/Desktop, Rootless, artifacts, single-commit and final-gate success
before Ready/Rebase Merge. Confirm old branch cleanup and never claim
GitLab delivery or real installed physical backup measurements.
