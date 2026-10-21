# G2c2d2b3c2b1 — retain original CAS pre-COMMIT BUSY/UNCERTAIN result at Server

## Baseline and bug
#2280, #2285 and #2291 have merged. The private B3c2a candidate holds the original authenticated Operation UPDATE, Source-wide terminal-vacancy test, immutable Stage and true pinned CAS descriptor while twice validating SHA-256 before a read-only SQL COMMIT callback and once after. Previously the Server candidate replaced every returned Local Store error with a generic denied error, erasing the critical distinction between BUSY **before** callback and UNCERTAIN **after** a possible durable transaction.

## Narrow source correction
A new private error classifier `localPushOriginalCASPrecommitError` preserves only `storage.ErrLocalPushCASPrecommitBusy` and `storage.ErrLocalPushCASPrecommitOutcomeUncertain` through `errors.Join` with the existing opaque denial. It never returns the raw Local Store message, which may contain private native file paths or callback secrets. All other errors remain opaque denials. A request context canceled after an otherwise successful pinned transaction inspection is classified conservatively as uncertain, not as proof of a rollback.

## Genuine integration and negative tests
A committed original first-leaf PostgreSQL fixture and real physical Local CAS run the original SQL operation validation and **read-only COMMIT inside the pinned CAS callback**. The callback intentionally loses its ACK only after SQL COMMIT. The real Local Store returns UNCERTAIN; Server preserves that typed state while masking the sensitive cause. No `LocalPushFileTerminal` or `SyncRun` appears, the SourceItem stays PENDING, and a subsequent independent authenticated read of the exact original operation/CAS is still possible. Pure classifier checks verify BUSY, UNCERTAIN, generic and nil error semantics. Existing owner/device/root/revocation, wrong-key, Mirror, CAS corruption and concurrent writer exclusions remain unchanged.

## Boundaries
This stage is still PRIVATE, UNROUTED and READ-ONLY, not the actual durable per-file PHYSICAL_COMMIT or physical-CANCEL, Native original cross-host attestation, restart-safe Stage/key retirement, a second file, SourceRun or scheduler. The existing genuine manual Windows/Linux owning-Desktop Backup-only first-file <=64 MiB upload stays enabled; never infer a finished backup or automatically retry an UNCERTAIN operation. Preserve all unrelated owner branches, exact one-work-commit history, full precise-source Go Windows/Linux, real PostgreSQL Race, Web/Desktop, Rootless, packages, images, Final Gate and fresh clean before rebase-merge.

Production-only environment safety acceptance: **按用户决定跳过（未验收）**. Never request production accounts, AK/JWT/Cookie, credentials, HAR, live packet captures or human signoff or make them code/CI/PR blockers. Code-level security and actual CI checks remain mandatory.
