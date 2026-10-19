# L03-G2c1 · Reject unresolved owning-Agent request slots before physical Stage

## Parent / accepted baseline

G2b2b [#2169](https://github.com/lazyxu/xdrive/pull/2169) passed its **own** 77-job exact-head
[CI #39288870375](https://github.com/lazyxu/xdrive/actions/runs/39288870375):
25 required successes, 52 conditionally skipped, no failures; true PostgreSQL
API Race and Final Gate. It was clean, Ready and Rebase-merged to complete
master as `80f4c8642d90e57a80cbcdeaf39944c5cf08b4a5`.

This first G2c step is **not** a complete terminal / cancel protocol. It
closes an avoidable pre-Stage hazard: a freshly constructed Agent Runner has
an empty process-local quarantine set, and previously reached
`StageVerifiedNativeOriginalBytes` (including native hashing and real
temporary Server upload) before `mintLocalPushOperationRequestKey` eventually
detected a leftover OS request claim. A crash, lost ACK or uncertain COMMIT
must not cause another unneeded Stage reservation or byte stream.

## Delivered

- `requireFreshLocalPushOperationSlot` is a new Agent-private, READ-ONLY
  pre-admission check of the stable
  **Server/account/owning-Device/Source** request-key slot, before the
  authenticated Source query and before native inventory scanning.
- An existing claim, orphaned OS credential, corrupt marker, unknown OS
  errors or unavailable credential backend all fail closed. Two Lstat
  checks bracket the SecretStore observation to detect a concurrent claim.
  The existing O_EXCL mint remains the definitive cross-process check.
- `localPushFirstLeafDriver.Check` binds the request slot to the exact
  Server/account/session/Device/Root/fingerprint/Source/revision/target.
  A NEW Runner must encounter an empty request slot. A SAME active Agent
  whose first request key is already in memory must instead recover the
  **identical** original key and claim from SecretStore on each subsequent
  Check. Missing/tampered credentials are denied.
- Tests use real filesystem claims + the existing OS SecretStore backend,
  including a restarted Agent, source/session/revision/Root changes, orphan
  secret/claim, mismatched memory key, preserved original Root and zero
  authenticated or temporary Stage calls when an old request exists.

## Explicit safety limitations and next G2c gates

This preflight does not atomically lease the local file against remote SQL.
A concurrent process could acquire the slot after the preflight; the
existing exclusive O_EXCL in Prepare still denies a second key. For a
fresh Source, no positive COMMIT evidence is inferred from a missing
claim; all stage/operation/native/Server checks remain in force.

A saved reservation terminal (expired/aborted) is **not** a file-terminal
receipt. No request-key/claim retirement, new generation, cancellation,
automatic recovery, SourceRun, scheduled backup, Mirror deletion or
public IPC/Renderer/Web execution entry is implemented.

Next G2c phases must add durable first-file COMMIT-versus-cancel exclusion,
crash-resumable original-key/Stage/Operation reconciliation independent of
the 30-second reservation, then explicitly authorized atomic OS
credential retirement only after a trustworthy terminal receipt; installed
Windows/Linux interruption, A-B-A file mutations, network ACK loss and
multiple Agent processes are release gates. Later: nested/multifile,
100k files, >=4GiB chunking/resume and automatic schedule.

Delivery requires one independent work commit on exact complete master;
its OWN 77+ Go Linux/Windows/PostgreSQL API Race/Web/Desktop/rootless/
images/artifacts/Final Gate CI and current GitHub clean mergeability.
