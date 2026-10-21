# G2c2d2b3c2a — retain original SQL operation + double-verified physical CAS pre-COMMIT window

## Exact previous merged/stacked baseline

Parent #2285 provides `storage.Local.InspectPinnedLocalPushHistoricalCASBeforeCommit`: canonical CAS descriptor and nonblocking shard pin, two full SHA-256 reads before a callback, a third physical verification after the callback, explicit pre-callback `ErrLocalPushCASPrecommitBusy` and callback-entered `ErrLocalPushCASPrecommitOutcomeUncertain`. #2280 provides the authenticated Server-private Source-wide vacant file-terminal slot, original Operation **UPDATE** lock, immutable Stage and real SQL/CAS witness. The existing owner-device Windows/Linux Desktop manual Backup-only first file <=64 MiB Stage→CAS/SQL execution remains enabled (#2212).

## One narrow actual integration

The original **unrouted read-only** `observeBoundLocalPushHistoricalPhysicalTerminalCandidate` switches its Local CAS inspector from `InspectPinnedLocalPushHistoricalCAS` to `InspectPinnedLocalPushHistoricalCASBeforeCommit`. As a result, its original Owner SHARE → Device/Source UPDATE → Root SHARE → Operation UPDATE → immutable Stage + file-terminal vacant → content CAS hash + Blob + canonical PENDING Node/SourceItem verification is retained under a PostgreSQL transaction while the same canonical CAS descriptor/shard is verified *twice* before the transaction's **read-only COMMIT** and again afterward.

The return is still a private advisory candidate, not a durable file terminal or a native-original witness. No `LocalPushFileTerminal` INSERT/UPDATE, SourceRun, key/Stage retirement, automatic backup or public/Agent/renderer route exists in this change. No record from a previous read can authorize a later SQL write; a later terminal writer needs the original native descriptor attested and independently reviewed end-to-end **in the same transaction**.

## Regression and fail-closed behavior

Real PostgreSQL + physically allocated CAS test performs original operation/Stage/Owner/Root checks, asserts a successful candidate contains the exact existing canonical Node and SourceItem yet publishes zero `LocalPushFileTerminal` and zero `SyncRun` rows; also corrupts the **same physical CAS file in place without changing its size** and asserts rejection and zero terminal. Existing revoked device, Mirror, wrong key/generation/revision, missing CAS/schema, conflict and canceled-context negatives remain. The original Node contract ensures this candidate is not exposed on Server router or Agent IPC and selects specifically the double-precheck primitive. New and old historical reads retain different conservative behavior.

## Order and release rules

One scoped work commit stacked on current #2285. Parent #2285 must pass its **own exact HEAD** full CI/Final Gate and merge into complete master first. Then restack this one work commit on the complete current master, preserving all non-AGENTS blobs and accumulating the entire latest master AGENTS, run a fresh exact-head full Go Linux/Windows, real PostgreSQL API Race, Web/Desktop, Rootless/images/installers/artifacts, Final Gate and clean mergeability before Ready/Rebase Merge.

This phase deliberately does **not** enable a durable SQL physical COMMIT/CANCEL terminal, cross-host native writer attestation, second file, SourceRun, scheduler, NAS Push or Mirror deletion. Those remain G2c2d2b3c2b+. Existing first-file uploading is not disabled pending later recovery work.

Production-environment safety acceptance: **按用户决定跳过（未验收）**. Do not ask for production access, accounts, credentials, JWT/Cookie/AK/HAR, capture or human signoff or turn it into a source/CI/PR gate; all locally testable authorization, native/SQL/CAS consistency and CI gates remain mandatory.
