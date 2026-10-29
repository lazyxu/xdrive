# iOS: explicit Owner-only recovery of uncertain original upload receipts

## Why

The native still backup persists an encrypted intent before session create and
finalize, and stops when the Server ACK is ambiguous. The read-only HMAC session
lookup endpoint (merged #3075) and the existing
`XDriveIOSPhotoBackupUncertainReceiptRecovery` can prove a finalized upload,
but neither was reachable from the **one canonical React/MUI iOS UI**.

This change adds a small section inside the existing
**账户 → 设置 → iPhone 系统相册备份**. Do not add another SwiftUI page,
uploader, account login, automatic retry queue, or privileged Device SourceRun.

## Native Host Adapter (same pinned HTTPS main frame)

- Capabilities v1 negotiates `receiptReview: true`. Older unsigned IPA
  installations omit it and will not show a fake recovery control.
- `photos.reconcile.status` (read-only local) verifies the **current Web
  access token /me + Owner + root** and reads the existing Owner/Server/Root
  encrypted ledger. It returns **only a pending count**, not PHAsset local IDs,
  filenames, SHA, resume keys, Node identities or credentials. A fresh install
  with no local backup identity returns zero, **without generating a Keychain
  secret or scanning PhotoKit**.
- The only mutating action is a user's explicit local
  `photos.reconcile.start`: at most **20** uncertain intents are checked
  sequentially per click. Existing `XDriveIOSUploadResumeProofReader` calls
  the logically read-only authenticated POST `/uploads/resume-lookup`.
  A finalized session must then pass current Owner Node ID, SHA-256, name,
  size, root and revision readback before its **local** sealed ledger becomes
  confirmed. The same operation's resume key and exact Server identity
  remain unchanged.
- A current-but-active Session remains uncertain; it is **never resumed
  automatically**. A 404, 409, 410, timeout, Owner mismatch, revoked auth,
  unsupported endpoint, malformed reply or current-Node disagreement remains
  uncertain. No upload create, chunk PUT, finalize, mirror deletion or
  substitute thumbnail is performed by this review feature.
- The original ordinary-still backup job and receipt review cannot run at
  the same time. An app background, WebView navigation/dismantle, Settings
  unmount, Owner switch or Cancel stops work; unresolved operations remain
  durable and non-successful.
- Progress contains only aggregate counts:
  `pending, checked, confirmed, activeUnverified, missing, expired, ambiguous,
  stage`. The UI does not surface any raw server session ID or local asset
  identity to JavaScript.

## Verification and acceptance

1. No native handler / old IPA: regular PWA, DSM and Desktop show no iPhone
   recovery controls; no Web-only path claims native reconciliation.
2. Empty or brand-new backup identity: status is zero and does not create a
   Keychain journal key, upload session or PhotoKit snapshot.
3. Current verified Owner/root: matching encrypted pending journal entries
   are counted; another Owner/server cannot enumerate them.
4. One explicit review processes at most 20 records; only a finalized
   Server session plus actual Owner file SHA/revision confirms one.
5. A 404 is not a safe-retry certificate. Active/expired/ambiguous/missing
   records are never incremented as confirmed; a network or auth failure
   stops the review without continuing writes.
6. Run exact-HEAD iPhoneOS unsigned IPA compile, shared Web TypeScript and
   existing Go server security tests before merging. Use the
   [#3133](https://github.com/lazyxu/xdrive/pull/3133) test-only follow-up
   only if the main CI actually fails; do not edit an otherwise running
   CI-tested HEAD.

Physical iPhone, SideStore, limited Photos, lost finalize/create ACK under
real network partition, iCloud download and 100k per-device ledger: **跳过（未验收）**.
This code does not assert those physical results, implement background sync
or expand the 1024-entry encrypted journal.
