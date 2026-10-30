# Android original Photo/Video MVP preflight (2026-10-30)

**Scope: Android-only, independent of #3292 native Gallery UI and #3296 encrypted checkpoint.**

The goal is to make the *actual* Go UploadSession-backed photo/video backup
possible without first implementing optional encryption enhancements or a
second content writer.

## Implemented here

- `XDriveService.verifiedOwnerIdentity` uses the **existing authenticated
  /api/v1/me** endpoint, not a locally entered username or HTTP cookie.
  It validates numeric Owner ID, user/admin role, no pending password change
  and the real `pwa_offline_instance_id`. Missing older-Server identity
  fails closed.
- `NativePhotoOwnerPreflight.verify` checks the *same bearer/session
  generation* before and after `/me` and `/nodes/root`. It verifies the
  Owner root is a real positive directory ID with positive revision.
  Login A→B→A cannot substitute a prior session-generation callback.
  No admin permission, device grant or background scheduling is assumed.
- `NativePhotoMediaStoreInventory.next` reads current authorized Android
  MediaStore image/video originals in **64-item**, strictly ID-ordered pages.
  No eager 100k list, source guessing from thumbnails or full/selected
  Photo Library confusion. Full image+video permissions are mandatory for
  whole-library automatic backup. Android 14 selected-photo mode is
  *not* labelled as full backup coverage.
- `NativePhotoMediaStoreInventory.stageOriginal` opens the actual
  permission-scoped source stream and writes to Android
  `noBackupFilesDir/photo-original-stage`, one bounded disposable
  random-named file at a time. It requires precise byte count, computes
  SHA-256 as it streams, checks private free space and syncs the staged
  bytes. The staged input can be reopened for the **existing**
  `XDriveService.uploadFile` protocol, with a second exact local hash
  check immediately before a future upload.
- Stage failure, revoked permission, truncated/growing original, unknown
  content type, zero/oversized size and malformed scanner order fail
  closed. Staged bytes are deleted on failure and after use, and never
  registered as a durable task or persisted to preferences.

## Not yet a running backup (explicit blockers)

1. Connect verified native Owner/Root **and real enrolled Device identity**
   to current Android session/consent in `DriveController`.
2. Add upload control to Gallery/Mine and connect staged original →
   **existing** Owner UploadSession writer → exact Go Node/revision/size
   receipt and read-only lost-ACK reconciliation. #3296 is a separate
   optional encrypted record layer; its state machine may be reused but
   new encryption work is NOT a gate for first functional backup.
3. Source revision/HMAC fingerprinting and durable confirmed-item index
   for incremental rescan without duplicate uploads, including true
   video + Motion Photo paired resource compatibility.
4. Controlled foreground and OS-permitted WorkManager scheduling,
   per-Owner grants, cancellation, restart, 10k/100k/115k checks and
   real Android device acceptance. Do not claim force-stop guarantees.

**No uploads, task scheduling, auto-retries or Server writes are performed
by this PR.** It is the source/proof building block, not a released
automated backup.

## Validation

- JVM unit tests: real `/me` MockWebServer response and malformed
  identities, root verification, session switch, byte-exact stage,
  SHA-256, provider truncation, size mismatch and revoked-source cleanup.
- Android PR requires exact-HEAD `pr-scope`, `android-native`,
  applicable Final Gate; emulator/physical MediaStore native acceptance
  still **跳过（未验收）** until run.
- Do not modify running #3292/#3296 HEAD simply to integrate this work.
