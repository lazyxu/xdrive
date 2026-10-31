# Android native original backup: first bounded incremental writer integration

Date: 2026-10-31. Android Photos MVP only. Reuses the Owner-authenticated Go
UploadSession and the existing Android photo identity, staging, intent ledger
and verified-only SQLite index; no second uploader, new Server endpoint, CAS
writer, encryption scheme, background replay or Desktop Agent privileges.

## Implemented on this development branch

1. **Exact Owner/device:** the foreground batch checks Full photo+video read
   grant and proves the live Android device via /me + /nodes/root +
   authenticated read-only /devices/self with the saved identity credential.
   Device registration remains an **explicit** action. A second automatic
   enrollment POST is never attempted, even after a missing/uncertain ACK.
2. **Bounded real original scan:** read MediaStore ID-keyset pages (max 64),
   stage each authorized photo/video as a disposable, fd-synced original with
   SHA-256 and permission/source recheck; reverify current Owner root and
   session before every writer. Limit each user-approved foreground invocation
   to 1..16 real uploads and 1..1024 media rows. Explicit in-memory after-ID
   allows the next user-approved batch to continue. No claims of a scheduled
   or completed whole-library scan.
3. **Stable original identities:** hash source device ID + local media ID +
   resource; hash version from that identity, modification timestamp, original
   bytes and the staged SHA-256. Deterministic safe filename identifies each
   original/version without persisting MediaStore URI or raw filename. Reject
   unsupported image/video MIME instead of guessing a conversion.
4. **Actual verified incrementality:** consult the same Owner/device SQLite
   index and all persisted intents. Only a matched real verified receipt skips
   an upload; older root revisions do NOT hide an unresolved attempt. Before
   the existing Go upload starts, the ledger durably marks MAY_HAVE_SENT.
   After exact finalize ACK, mark VERIFIED in the journal **then** SQLite.
5. **Crash/lost-ACK safety:** any unknown network result is UNKNOWN_ACK (or
   retains MAY_HAVE_SENT if persistence fails) and blocks same-Owner automatic
   replay. A successful finalize followed by an index failure is recoverable
   from the journal's VERIFIED receipt without a new UploadSession.
6. **Controller entry points:** explicit foreground device enrollment and a
   single-batch runner are session-fenced and share the existing app writer
   exclusion; active Gallery upload/download/Viewer/metadata mutation blocks
   starting either. No unbounded queue or implicit background permission.

## Tests

Pure JVM tests exercise exact finalized Node receipts, 401/timeout-style lost
ACK, no second upload, root revision changes, changing Owner session, invalid
finalize ACK, stable source keys and repair after SQLite failure. A pure
Controller gate test covers Gallery-only starting conditions.

The original encrypted intent store and SQLite index are **reused**, not
extended for optional privacy/security features. Existing signed APK, Go,
Source/Agent and iOS behavior must be unaffected.

## Still required before calling Android auto-backup MVP complete

- **Native consent UI:** expose and confirm explicit device enrollment,
  full-library permission and a user-controlled foreground batch. Controller
  entry points exist but have no new UI wiring in this development increment.
- **Automatic scheduling:** Android WorkManager / approved background grant,
  persistent bounded scanner cursor, battery/network preferences, stop/resume
  semantics and Owner switching. No auto scheduler is claimed.
- **Long-term incremental scaling:** the 128-intent durable checkpoint must
  be safely compacted only after receipts are indexed; support >128 verified
  media and 100k/115k scans without falsely reporting full completion.
- **Unknown ACK:** bounded read-only authorized exact remote receipt
  reconciliation, preserving hash + Owner, before any reattempt.
- **Motion Photo:** embedded/pair companion semantics, not just still/video.
- **Real device acceptance:** Android 14 Full/Selected/Denied/revoked grants,
  MediaStore provider behavior, app restart, lost ACK and physical 100k/115k:
  **跳过（未验收）**.

## Merge gate

Keep Draft and do not merge master until this **exact PR HEAD** passes Android
JVM, lint, APK, emulator and required Final Gate. Verify parent master and
other Android Gallery PR compatibility before merge. An independent Gallery
navigation PR is not modified by this branch.
