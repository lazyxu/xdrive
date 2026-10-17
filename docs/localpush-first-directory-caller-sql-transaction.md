# L03-F2d8c3b2v — private PENDING directory writer inside caller SQL transaction

**Status:** Server-private transaction-contract hardening following merged #1931. No real Local Push or SourceRun activation.

## What changes

- Extract the existing authenticated, Owner/Device/Root/Source-revision/target-fenced PENDING direct-child directory writer into unexported `commitBoundLocalPushFirstDirectoryTx(tx,...)`. It accepts an **existing caller-owned PostgreSQL transaction**, does not commit it and independently enforces all existing owning-device, Root fingerprint, Source revision, directory name and cloud target checks.
- Preserve the original `commitBoundLocalPushFirstDirectory` as the existing Server-private entry point: it opens its bounded transaction and delegates to the new helper. It still returns only non-authoritative `NodeID/SourceItemID/Replayed` results. No Router, Agent IPC, Go Client, Electron or Web caller is added.
- Add isolated real PostgreSQL tests that see a PENDING Node and SourceItem **inside** a caller transaction, then force rollback and prove neither survives. The original entry point may then retry and exact-replay once without duplicates. Separate tests cover same-transaction replay, malformed nil transaction and forged owning-device token. No SourceRun, completed SourceItem, FileVersion or physical Blob publication is reported by this step.
- Shared Desktop source-contract forbids exposing the caller-transaction helper outside Server-private code.

## Security and recovery limitations

This prepares the **database** side only. Do **not** call this writer after `consumeBoundLocalPushFirstDirectoryChallengeTx`, or combine the two merely because both accept `*gorm.DB`: the owning Linux/Windows native OS directory handle is still released before the Server transaction begins, and a previously authentic HMAC/nonce does not attest CURRENT physical identity through SQL. A stolen device credential, revocation race, path replacement or Agent crash must fail closed rather than yield a fictitious backup receipt.

A separately reviewed native-to-Server lifetime/authorization protocol, durable intent/replay receipts, physical CAS/Node reconciliation, cancel and crash recovery are mandatory before opening actual SourceRun writes. `local_folder` activation and production Run stay hard denied; Web/Mobile Web and foreign Desktop stay read-only, Stage <=64 MiB, Mirror deletes off, NAS Push unsupported and all Pull flows unchanged. No installed hardware, power-loss, 100k or >=4GiB backup acceptance is claimed.

## Verification and delivery

Keep exactly one work commit on frozen master, require that exact HEAD's complete Go API isolated real PostgreSQL Race, Go Linux/Windows, shared Desktop/Web, images/artifacts, single-commit/final-gate CI before Ready/Rebase merge. On scoped CI failure reconstruct one replacement work commit on the original parent and rerun the full head checks. Independently verify branch cleanup; do not touch unrelated PRs/branches.
