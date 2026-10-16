# L03-F2d8c3b2p — Private challenge-bound advisory native directory evidence

**Status:** preparatory, read-only cryptographic integrity contract; NOT an executable local-folder backup. Built upon merged #1898 (`master@8a8d9c387538e6efef18a4841ade2f535b75d43b`) and frozen newer `master@2790744ec4ad9d71d96159557cdc2c2324021bde`. This phase adds only three `internal/localpush` files and this document; it does not change REST, Agent IPC, Desktop/Web/Renderer, SourceRun, Node, SourceItem, CAS, storage schema, or production activation.

## Scope

A private 32-byte random challenge is scoped to exactly one owner, Source ID/revision, authoritative cloud target Node, registered Device UUID, native Root UUID/fingerprint, and a maximum two-minute UTC lifetime. The owning Agent may only seal a *previously verified* `LocalFirstDirectoryNativeObservation` when the Current/Previous inventory SHA-256 heads are valid and distinct, actual CURRENT path-key matches the canonical Root-specific hash, native identity is present, and all commit/backup/delete authority flags are false. The secret MAC key is the OS-private device enrollment token, never the UI/Renderer credential or an Owner JWT.

The HMAC-SHA256 input is a domain-separated, length-framed canonical binary scope covering every challenge field, nonce and validity window, and exact native relative one-component directory, native identity, Root path-key and both snapshot SHA-256 digests. Verification requires the same active challenge and device token, checks field/clock consistency and uses constant-time MAC comparison. Challenge and seal objects have **all fields `json:"-"`**: no HTTP payload, `X-XDrive-*` headers, Electron IPC, UI disclosure, credential, absolute path or native name transmission is implemented in this phase. Synthetic offline tests and a Linux/Windows physical directory-replacement fixture exercise Owner/Source/revision/target/Device/Root changes, nonce swap, time drift/expiry, forged flags and digest/name changes. Future private transport must define a separately reviewed and strictly redacted payload and no-store boundary.

## Critical distinction: an authenticated MAC is NOT native filesystem attestation

- The challenge constructor is a pure, private library. It does **not** authenticate an owner, read Source/Root in a Server transaction, persist an issued nonce, reject a second successful verify, hold an open native OS handle, or contact PostgreSQL. The caller must never treat its output as a Server-authorized challenge without these additional boundaries.
- A stolen device token can still MAC attacker-selected fields. Even a genuinely Agent-observed directory may be replaced immediately afterward; the native fixture deliberately proves the old MAC remains valid after the new filesystem recheck denies replacement. A successful `VerifyLocalFirstDirectoryAdvisoryObservation` only confirms the supplied bytes have not changed relative to the supplied token and challenge; it never proves a physical current source or authorizes SQL/CAS, FileVersion, SourceRun or Mirror deletion.
- Existing production `local_folder` activation/BeginRun fail-closed, <=64 MiB private Stage limit, disabled CI-only first-directory route, and Web/other Desktop read-only policy are unchanged. Existing Pull, NAS legacy Sources and CfAPI/FUSE are unchanged.

## Next bounded step

A separate follow-up must issue and consume a one-use nonce **inside Server PostgreSQL** under current User/Device/Source/Root/revision/target locks, bind the issuance to an authenticated owning Agent (including revocation and session epoch), safely validate the actual native CURRENT evidence immediately before use, and reconcile crash/lost-reply SQL/CAS receipts. A successful MAC without that protocol is insufficient. Only after real SourceRun/rollback/recursive planner and >=4GiB/100k installed Windows/Linux tests should the Desktop own-device Start/Cancel/Retry and background L05 execution gates be considered.

## Delivery

One scoped work commit on a fixed GitHub master baseline; exact-head Go Linux/API PostgreSQL Race, Go Windows, shared Web/Desktop, images/artifacts, `single-commit` and `final-gate` CI must all succeed before Ready/Rebase merge. Test-only synthetic or local Go 1.23 checks are not release acceptance. Close superseded PRs and verify cleanup only for this LocalPush branch, leaving unrelated development untouched.
