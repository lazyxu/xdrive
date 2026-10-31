# Android Photos — explicit WorkManager auto-incremental MVP

Date: 2026-10-31. Android native app only. Development child of #3351.
Do not modify its started CI HEAD, nor merge this child before its own
exact-HEAD Android + Final Gate verification.

## Real implementation in this branch

- **User-driven opt-in/out**: fixed native Gallery's "本机照片" / "本机相册"
  offers separate two-step confirmation for auto backup, independent from
  each manual batch. Opt-in requires full photo+video OS permission, HTTPS,
  an explicitly remembered login, real Owner/root proof and already-enrolled
  read-only verified Android device identity. No auto enrollment or WebView.
- **15-minute minimum system scheduling**: one unique PeriodicWorkRequest
  (WorkManager 2.12.0 stable), network CONNECTED, battery not low.
  Actual scheduling is deferred/OS-controlled, not a promise of an exact
  15-minute delivery. Nothing in WorkData is a credential, photo path,
  URI, GPS, filename, media ID, album name or backup receipt.
- **Cold-start worker**: reads only the normal remembered HTTPS Owner
  refresh session, chooses the same optional LAN IP route, refreshes using a
  shared UI/worker rotation mutex, and re-verifies Go /me, /nodes/root and
  /devices/self. Owner, device ID, Server installation and consent epoch must
  match before access to one original; no guessing a local username.
- **Bounded real writer**: shared App-level batch mutex yields to foreground
  Gallery scans. A permitted run scans at most 128 MediaStore rows and
  uploads at most eight new originals through #3349's verified-intent,
  SHA-256 staging, SQLite exact receipt and the existing Go UploadSession.
  The #3353 app-process transport mutex prevents concurrent SAF/manual/
  WorkManager UploadSession writes from different XDriveApi instances.
- **Durable restart cursor**: reuses #3351's verified-only, Owner/device
  hashed checkpoint. Only real Go-verified receipts or exact durable-index
  skips advance; a complete sweep resets for the next independently
  authorized periodic scan. A cursor is NOT a proof that backup is complete.
- **Strict policy revocation**: logout, clear remembered session and switching
  saved Server/Owner clear consent before the old token may be reused.
  WorkManager is cancelled. Every worker Owner callback rereads the current
  epoch/grant; a late canceled worker may have an uncertain Go ACK but can
  never auto-retry it.
- **Failures**: full permission revoke and missing remembered session become
  explicit blocked statuses. A post-Owner verification exception pauses this
  consent with `needs_receipt_review`. The durable ledger remains the
  final retry gate; scheduled jobs cannot replay MAY_HAVE_SENT/UNKNOWN_ACK.
  The status `scanned_not_complete` never claims all originals are backed up.

## Validation added

Android emulator tests: exact persisted Owner/device/epoch consent, revoke,
corruption fail-closed, UI explicit opt-in and opt-out dialogs, permissions,
logout and other writer busy. Real Android Keystore + private-pref tests:
foreground/worker refresh serialization, logout during refresh, concurrent
Owner switch and mandatory-password-session preservation. JVM tests:
manual/worker batch mutex admission, cancellation and failure release.

## Required next work / limitations

1. **Unknown ACK reconciliation**: authorized bounded read-only exact
   UploadSession/Go receipt lookup before an uncertain original can be
   retried. This Worker deliberately pauses instead of sending duplicate
   bytes or inventing success.
2. **Live / Motion Photo** still+video association and exact imported
   original pairing (not just independent ordinary still/video).
3. **Acceptance** on actual Android 14 Full/Selected/Denied/Revoked, app
   process death, Server unavailable, 100k/115k library. No installed-device
   acceptance is claimed: **跳过（未验收）**.
4. **Multiple Android processes** are not configured. If a future Worker is
   moved into a remote process, add cross-process Owner and upload leases
   before enabling it; the current process mutex alone is insufficient.
5. **WorkManager periods** are not deterministic; OS battery/Doze limits
   can delay runs. There is no guarantee all 100k originals complete within
   one interval, or that a lost refresh ACK can be recovered without login.

No new encrypted local backup task ledger, independent Go writer, Server API,
Desktop Source/Agent role, external analytics or cloud Photo metadata.
