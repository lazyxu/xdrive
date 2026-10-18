# L03-G0-A2b2b2c2c1 — SQL-durable reservation-terminal receipt

**Parent:** #2005 held owning-Root restart reconciliation passed exact work-HEAD
[full CI #39084643995](https://github.com/lazyxu/xdrive/actions/runs/39084643995)
(76 jobs, 25 success, 51 conditional skips, final-gate green), was
Ready/Rebase merged as `master@684f3b91bf6abae8ebd0ba6650ba86b467ed064f`,
and its work branch was deleted. This is a **Server-only c2c1 prerequisite**.

## Strictly reservation-terminal, not file-terminal

`LocalPushOperationTerminalReceipt` is a new **append-only private**
PostgreSQL table: one immutable receipt for an exact operation UUID,
unique Source/generation, original request-key SHA-256 digest, terminal
*reservation* state and database-clock `recorded_at`. It records only:

- `aborted`: the exact latest operation has a durable abort timestamp
  within its original 30-second admission window.
- `expired`: the latest operation remains reserved and the original
  expiry has elapsed according to the trusted PostgreSQL clock.

Neither state proves a completed upload, durable file cancellation, cloud
CAS/Node/SourceItem mutation, SourceRun completion or entitlement to retire
the native request key. A 30-second admission lease expiring does NOT mean
physical file work was safely terminated. The receipt is therefore NEVER a
`backup_complete` or `commit_supported` assertion.

The unexported `recordBoundLocalPushReservationTerminal` is
**not routed**. Under the established Owner SHARE → Device UPDATE →
Source UPDATE → Root SHARE → latest operation UPDATE locking order, it
requires the current Owner session, unrevoked owning device credential,
same native Root binding/fingerprint, Source revision and authoritative
cloud target, exact latest UUID/generation, and exact original nonzero
32-byte request key matching the persisted digest (constant-time).
A terminal receipt is inserted and verified within the same transaction,
with idempotent exact-request replay after a lost reply. Missing migration,
malformed timestamps, active reservation, wrong/foreign/revoked scope,
wrong key, changed Source/Root/target, newer generation, canceled context
or contradictory saved evidence fail closed.

All model fields and the in-process return object marshal to `{}`.
No raw request key is stored in the receipt, and no new public REST,
Agent IPC, Electron Renderer, Web/PWA, scheduler, upload worker, CAS/SQL
commit, Mirror deletion or source activation is introduced. Production
`local_folder` execution remains hard disabled; temporary Stage remains
capped at 64 MiB. Older finished reservation receipts are historical
metadata, not authority to work or to delete any local credential.

## Validation and next phases

Real isolated PostgreSQL two-pool tests cover idempotency after restart,
lease abort/expiry and DB clock bounds, exact digest, concurrent same-key
replay, superseded generations, owner/Device/Root revocation, session,
Source/target revision drift, fail-closed behavior, JSON redaction and zero
Node/SourceItem/SourceRun changes. Server migration is tested twice and
must start with zero rows. This is not physical installed Windows/Linux,
real native Root-to-SQL atomicity, 100k files or >=4GiB backup E2E.

**Next c2c2:** independently authenticate and materialize this exact
Server receipt under the owning Agent's CURRENT native Root held window,
rechecking the live Owner/device/Root/Source/inventory after observation.
**Next c2c3:** independently prove file-writer/cancel terminal exclusion,
then design the crash-safe native request-key/claim retirement protocol.
A reservation receipt alone NEVER permits key deletion, fresh generation
minting, physical upload or Desktop start/pause/cancel wiring.

Delivery gate: exactly one new scoped work commit, full exact-head GitHub
CI including PostgreSQL Race, Linux/Windows, Web/Desktop, Rootless,
artifacts, single-commit and final-gate, clean mergeability,
Ready/Rebase and verified old branch deletion. No GitLab delivery or
physical installed-device validation is claimed.
