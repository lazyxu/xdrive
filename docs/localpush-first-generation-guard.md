# L03-G1e — First-generation private Local Push COMMIT guard

## Problem

The L03-G1b Source-wide immutable COMMIT lookup ran only when a previous `LocalPushOperationIntent` record existed. Initial generation one could therefore be admitted without the `LocalPushFirstLeafOperationCommit` migration, or after a partial database restore that retained an immutable physical CAS/SQL COMMIT but lost the old private Operation row.

## Change

Reuse the existing `requireLocalPushSourceWithoutFirstLeafSQLCommitTx` helper before **all new reservations**, even generation one, under the original Owner → Device → Source → Root transaction and owning Source UPDATE lock. Missing SQL schema, query failure, or any historical committed first leaf denies a new Operation. This preserves legitimate live same-key replay of the existing private reservation without generating a new UUID. The G1a–G1d terminal/abort/source-commit fences remain unchanged.

## Verification

Real PostgreSQL fixture tests verify (1) missing COMMIT migration fails closed on initial keyed and unkeyed admission without inserting Operation/SourceItem/SourceRun, (2) a real canonical first-file physical CAS/SQL COMMIT with its Operation row intentionally lost cannot admit replacement generation one, while the COMMIT survives and the SourceItem stays PENDING, and (3) present-and-empty COMMIT schema still allows initial private reservation. Existing two-pool replay, conflict, cancellation and Source-wide embargo tests remain mandatory.

No public HTTP route, Go Client/Agent IPC/Renderer/Web modification; no key retirement, physical cancellation, authoritative recovery, production Runner/SourceRun, schedule/watch, Mirror remote deletion, NAS Push, or installed Windows/Linux 100k/≥4GiB E2E. The CI-only first-file writer remains disabled in production. This PR requires its own accurate-head full GitHub CI (genuine PostgreSQL API Race, Go/Web/Desktop Linux/Windows, Rootless, installers/artifacts, one work commit and Final Gate), plus current clean GitHub mergeability before Ready/Rebase merge.
