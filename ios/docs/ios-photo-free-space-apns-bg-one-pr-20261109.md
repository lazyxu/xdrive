# iOS Photos Free Up Space, APNs and safe background recovery — PR #4141

**One implementation PR:** https://github.com/lazyxu/xdrive/pull/4141
Existing core uploader and receipt reconciliation from #4104/#4126 are reused.
No second CAS writer, no Web bearer grant and no lower Keychain/file protection.

## 1. Current code paths (do not confuse with a verified release)

### Explicit iPhone original removal

- `NativePhotoFreeSpaceSection.swift` offers ONE explicitly selected PhotoKit
  image/video/Live Photo. No automatic/background/bulk Apple Photos deletion.
- Before a server hold is prepared, the native current-original model hashes
  the locally authorized original, verifies the historical finalized receipt
  and authenticates the exact current Owner/managed Source/Node.
- The new `POST /api/v1/ios/photos/managed/original-retention` requires the
  currently signed-in Owner **and** separately enrolled iPhone Device secret.
  It rechecks Source/Target/Node/session/revision/content digest inside SQL,
  requires an actual `CASReadLeaseProvider.OpenPinnedCAS` physical read lease,
  hashes all original CAS bytes, and for Live ZIP validates exactly two
  original still+motion members plus the JSON manifest, byte counts and CRC.
  A backend without pinned CAS support fails closed; a historical ACK alone
  cannot establish retention. No per-photo local identifier is sent to Server.
- The initial Hold can only be issued against a real finalized, Source/Device-
  bound UploadSession. Once the immutable Hold is recorded, normal upload
  history expiry/cleanup cannot revoke it. Re-checks validate the durable
  Hold/Node/Source and physical CAS (including Live pair) without requiring
  the pruned UploadSession. Re-preparing a matching Hold stays idempotent,
  while a missing/active session can never mint the initial Hold.
- PostgreSQL stores immutable `IOSPhotoOriginalHold` and indexed ancestors.
  The transactional migration installs guards on held Node/ancestor,
  File/FileVersion, Source, ContentBlob and hold records, protecting against
  ordinary trash, replacement, legacy cleanup, direct SQL mutation and CAS GC.
  The CAS GC independent reference query also checks retained storage keys.
  There is intentionally NO ordinary API that releases a permanent hold.
- After another user confirmation, `GET .../original-retention/:id` rechecks
  current managed authorization, physical bytes and hold status. The client
  rechecks the same PhotoKit revision, foreground, Full Photos access, Owner
  and zero pending/unknown ACK *again* before calling the OS PhotoKit
  `PHAssetChangeRequest.deleteAssets`. iOS will request its own permission.
  Deletion under iCloud Photos can affect other devices and Recently Deleted
  may delay reclaimed capacity. An old or changed proof cannot delete.
- A permanent Server hold is **not** a second geographically independent
  backup. Disk failure, malicious DB superuser and actual NAS restore must be
  handled by the existing external backup/restore discipline. The client does
  not claim its device storage has immediately been freed.

### APNs background hints

- The signed App uses XcodeGen-generated `aps-environment` entitlement
  (operator-selected `XDRIVE_APNS_ENVIRONMENT`, matching Apple provisioning)
  and `remote-notification`. Runtime checks its actual signed entitlement
  rather than inferring development vs production from a DEBUG define.
- A native token callback is accepted only for the exact captured approved
  Owner and stop generation; Owner switching invalidates the pending
  registration. Encrypted Server token registration requires a separate
  current Photo BG grant + Device secret. Grant rotation/revoke deauthorizes
  the old token, and a repeated registration preserves its rate limit.
- Server provider key is loaded only from a restricted operator local .p8 file,
  ES256 JWT is freshly signed and sent to Apple using HTTPS/HTTP2 background
  priority 5, at most once per grant every 2h with a multi-worker atomic claim.
  Invalid token replies invalidate only matching tokens, not the uploaded data.
  A push carries no credentials or PhotoKit identifiers. Missing provider or
  encryption keys disables APNs without disrupting foreground backups.
- **Deployment secrets outside source control:** `XD_IOS_PHOTO_APNS_TEAM_ID`,
  `XD_IOS_PHOTO_APNS_KEY_ID`, `XD_IOS_PHOTO_APNS_PRIVATE_KEY_FILE`,
  versioned `XD_CONNECTOR_SECRET_*` keyring, Apple App ID Push Notifications
  capability, matching signed provisioning, and explicit Xcode build
  `XDRIVE_APNS_ENVIRONMENT=development|production`.

### iOS background/lockscreen

- A silent push only attempts to re-arm an OS-admitted **future**
  BGProcessing window, never starts an upload in the push callback.
- Requires unlocked protected bytes, Full Photos permission, same current
  managed Device+Owner grant, unrevoked stop epoch, valid PhotoKit history,
  no active writer, no pending/unknown receipt, no paused review, throttle and
  no already-scheduled BG task. The existing foreground catch-up and Focused
  Backup remain the reliable user-driven recovery path.
- Apple does NOT guarantee BGProcessing scheduling or silent push delivery,
  and the existing complete/WhenUnlocked media and journal are intentionally
  inaccessible while locked. This limitation must remain explicit in UI.

## 2. Regression matrix and shipping conditions

- Go: bad request/Owner/Device/Target/session rejection, physical SHA mismatch,
  short/missing CAS, invalid Live manifest/missing motion/extra part, pinned
  CAS admission, APNs signing and token revocation.
- PostgreSQL: permanent hold+ancestor migration idempotence; ordinary Node,
  File, Source, ContentBlob, hold and ancestor deletion/overwrite denied while
  unrelated File deletion still works; CAS GC independent reference check.
- Native/CI: exact-HEAD Swift policy tests, Node fail-closed contracts, signed
  entitlement gate, Xcode unsigned IPA, all applicable full CI and Final Gate.
- Real signed iPhone, APNs send/receive and iCloud Photos destructive behavior:
  **跳过（未验收）** until an Apple-signed device is available. Never claim a
  queued/skipped/earlier HEAD check passed.
- Do not merge #4141 while any **applicable exact-HEAD** CI/Final Gate fails
  or while the above persistence/deletion contract is unverified.

## 3. Known hard limitations

A database trigger protects application-level deletion, but does not defeat
DB superuser tampering, host disk destruction or independent NAS data loss.
The product must not claim an external independent copy unless its existing
backup/restore system has proved one. APNs and BGProcessing can be delayed
or suppressed by Apple; no continuous locked-screen guarantee can be made.
