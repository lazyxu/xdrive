# G2c2d2b3c4b — pinned, original-Operation physical terminal replay (private)

## Source-exact dependency

Merged #2354 introduced a PostgreSQL/Local CAS-transaction-bound physical-COMMIT
writer **without** a production owning-Agent native proof producer, public
route or Agent transport. It remains explicitly UNROUTED; its synthetic test
witness is never authorization to perform another file write.

## This change

- Add a **private read-only** original Operation terminal replay that calls the
  existing B1 keyed SQL inspector in one retained PostgreSQL transaction.
  Recheck Owner/Device/Root/Source revision, immutable Operation + original
  request-key + Stage binding, terminal and canonical SQL COMMIT.
- Require exactly one source-wide terminal, physical-COMMIT state, valid hash,
  actual ready and pinned ContentBlob, and a physical Local CAS double-hash.
  Return success only after the read-only SQL transaction commits within the
  real CAS pin. Absent terminal, altered Operation/key/Stage/generation,
  contradictory terminal, revoked scope and missing CAS fail closed.
- Two real PostgreSQL/physical CAS integration cases exercise idempotent replay,
  negative identity and deleted physical bytes, using #2354's explicitly
  **synthetic test-only native witness** to seed an immutable terminal.
- Never insert another terminal or re-mint request keys. Never create a SyncRun,
  mark a SourceItem synced, release Stage/key/Writer or admit file #2.

## Still unimplemented / next dependencies

This is a usable INTERNAL SQL/CAS replay primitive **not yet a production
Agent->Server lost-ACK readback**. The owning native Agent must first generate
trusted held Claim + original OS fd evidence, and the Server must validate
that evidence in its existing authenticated private transport before invoking
the #2354 writer. A future authenticated Agent-specific replay handler may
call this primitive, and must separately verify local native evidence and
return UNKNOWN on any missing/mismatched proof. Physical-CANCEL quiescence and
Stage/key/Writer retirement remain unimplemented. Do not enable multi-file,
SourceRun or automatic backup from this change.

CI gate: one scoped work commit, actual Go Linux and Windows,
PostgreSQL API Race, Web/Desktop, artifacts/Final Gate and fresh clean master.
Production-only security acceptance: **按用户决定跳过（未验收）**;
controllable source-level safety tests remain mandatory.
