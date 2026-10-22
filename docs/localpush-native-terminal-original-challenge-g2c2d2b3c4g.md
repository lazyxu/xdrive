# G2c2d2b3c4g — SQL-persisted original-operation native bridge challenge

## Why this is needed

The owning Agent now holds its original Stage Hint, current native-file descriptor
and original kernel Writer Claim through its first-file HTTP CAS/SQL operation
(merged #2376). However, no production transport supplies independently
authenticated evidence of that live held state to the Server's **UNROUTED**
`physical-commit` writer. Its test-only `originalClaimHeld=true` and
Agent-derived request-key HMAC are **not** remote kernel-lock attestation.

This increment supplies **only one anti-replay/freshness prerequisite**, not the
missing native proof.

## Internal SQL contract (no HTTP route)

`meta.LocalPushNativeTerminalChallenge` contains one private, immutable
per-original-Operation Stage/Owner/session/Device/Root/Source/target/key binding
and a **domain-separated SHA-256 nonce digest**, never the 32-byte nonce.
An original SQL COMMIT and immutable Stage→Operation binding must exist,
while no competing Source generation, reservation abort/expiry terminal or
physical file terminal may exist. The current Owner, enrolled Device, saved
Root fingerprint and Source revision/mode/target are revalidated under the
original canonical SQL lock order.

A Server-private issuer stores exactly **one** challenge per Operation/Stage,
with PostgreSQL DB-clock 15-second expiry. Duplicate issuance, including
after a lost ACK, is denied rather than minting a replacement nonce. A
Server-private consumer accepts the nonce at most once **inside a caller-owned
SQL transaction** with the same current Scope/Operation/Stage locks; successful
consumption marks the challenge used only if the caller's transaction commits.
A rollback leaves the same nonce unspent until its expiry, and an expired,
revoked, forged or stale challenge cannot be consumed. The result is not an
independent native Writer proof and therefore grants **no** terminal or
backup authority.

## Security boundaries and tests

- Both methods and their ephemeral ticket are **unexported and UNROUTED**.
  No HTTP, Agent IPC, Web, Desktop Renderer, scheduler or upload flow can
  presently issue/consume a challenge. JSON serialization of tickets and
  database records exposes no challenge material.
- Real isolated PostgreSQL integration verifies one-use issuance, rollback
  versus committed consumption, replay, incorrect original request key,
  Operation, Stage, generation, Owner, Root, Device revocation, Source revision,
  missing canonical SQL COMMIT, conflicting reservation or physical terminal,
  and database-enforced challenge expiry. It verifies **zero new**
  physical file terminals and SourceRuns. Migration tests verify no challenge
  row or physical result appears spontaneously.
- A future trusted Agent transport must bind a *live original OS descriptor*
  and original kernel Writer Claim to a fresh Server nonce and exact
  authenticated Owner/Device/Root/Operation under a retained SQL/CAS window.
  The challenge nonce or a request-key HMAC alone MUST NEVER set
  `originalClaimHeld=true`, `authoritative=true` or
  `retirement_supported=true`. The present code does not perform that step.

Unfinished Stage 1: trusted Agent→Server held native evidence, production
physical-COMMIT and physically quiesced CANCEL, actual lost-ACK and process
crash replay. Stage 2 retirement/file #2, multi-file Runner, SourceRun,
automatic sync and further large-scale E2E remain blocked.
`backup_complete=false` and `retirement_safe=false` remain mandatory.
Production-only inaccessible safety acceptance is **按用户决定跳过（未验收）**;
controlled code-level native/Owner/Device/Root/SQL/CAS security, real Windows
and Linux Go, PostgreSQL API Race, Web/Desktop/artifact/Final Gate remain gates.
