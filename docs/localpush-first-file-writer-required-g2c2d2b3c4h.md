# G2c2d2b3c4h — close the unclaimed first-file Agent execution bypass

## Verified source gap

Merged #2376 correctly pins the immutable original Stage Hint, native media
descriptor and live OS Writer Claim for the production manual first-file
operation. However, the bounded `localPushFirstLeafDriver` retained a
conditional **non-Writer** fallback in its `Commit` and `Reconcile`
methods. A dormant private entry `runLocalPushFirstLeafPrivate` also invoked
the Runner without first acquiring the native Writer Claim.

This is a pre-admission security mismatch: even if currently unexposed over
Desktop IPC, future internal callers must not persist a Stage, request key
or Operation without a genuine live source-scoped O_EXCL Writer Claim.

## Applied restrictions

- The real manual Backup-only activation retains its existing
  `localpushwriter.Begin` before launching the Runner. It binds the
  originally verified strong native inode identity to the Agent-only Driver.
- Before `Stage` creates the original O_EXCL Stage slot, and before
  `Prepare` creates a request-key SecretStore claim, the Driver validates
  the same live, still OS-locked Writer marker using the existing
  `WithHeldLiveOriginalWriterObservation` method. Closed, corrupt,
  substituted or foreign scopes reject before modifying remote or local
  durable Stage/Operation state.
- `Commit` and `Reconcile` also require a live original Writer and
  unconditionally retain the already implemented original Stage Hint fd,
  original media fd and verified kernel Writer-Claim callback during HTTP.
  Remove both old plain HTTP fallback branches.
- The obsolete internal filename-selected runner is fail-closed. The
  owning manual `cloudStartLocalBoundBackupFirstFileOnce` remains the
  sole enabled first-file execution entrypoint; it chooses bytes from a
  fully verified native inventory and still reports only
  `PhysicalObserved`, `BackupComplete=false`, `RetirementSafe=false`.

Go regression tests cover no-Writer side effects, genuine live Claim,
released Writer, foreign inode, Source and session, cancellation, actual
Commit/Reconcile call-chain constraints and owning manual activation.

**Not delivered:** remote OS kernel-lock attestation, a production
Agent→Server file terminal, `physical-commit`, independently quiesced
physical-CANCEL, lost ACK or crashed-process authoritative recovery,
Stage/Key/Writer retirement, second file, multi-file Runner, SourceRun,
automatic synchronization or arbitrary file selection. No public API,
router, schema, IPC or request-key HMAC authority is added.

Run exact-head Go Linux/Windows, real PostgreSQL API Race, Web/Desktop,
install/image and Final Gate. Production-only security acceptance remains
**按用户决定跳过（未验收）**, not a development/CI/merge gate.
