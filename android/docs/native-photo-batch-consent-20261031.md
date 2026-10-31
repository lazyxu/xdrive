# Android native Gallery — explicit photo/video backup consent (MVP integration)

Date: 2026-10-31. Child development branch of Android verified incremental
writer #3349. The parent CI HEAD is **never modified** for this UI increment.
This is not a release, automatic backup scheduler, or claimed complete MVP.

## Native Gallery behavior

- Remains under fixed **图库** → **本机照片 / 本机相册**, not a WebView
  or sixth bottom tab. Does not affect Files or the dynamic tab.
- "照片和视频备份" opens a native, Owner-session-scoped control panel.
- Android full photos AND videos access is requested **only** from an explicit
  user tap. Android 14 selected-only permissions are labelled inadequate for
  whole-library backup, never silently expanded or treated as full.
- "登记或核验本机备份设备" requires a second explicit confirmation. Reuses
  #3349's current authenticated Owner/Root and same-Owner /devices/self proof.
  An uncertain device registration POST is not retried automatically.
- "备份下一批原件" requires another explicit confirmation. At most 8 new
  originals are uploaded per approved batch through the existing Go
  UploadSession writer. An in-memory local ID cursor permits the user to
  explicitly request another batch; there is **no scheduled continuation**.
- Shows true scanned count and verified UploadSession receipts separately
  from already verified skipped items. The final page does not imply an
  iCloud/PhotoAsset/other-device backup is complete.
- During an active foreground write, displays explicit Stop with a warning:
  a cancelled/lost finalize ACK remains **unconfirmed** and must not be
  automatically retried. Controls cannot initiate concurrent uploads.
- Owner/logout/session changes dispose the panel and its pending confirmations.
  No URI, filename, bearer, photo bytes, map location or selected local IDs
  are written into Compose saved state or settings.

## Validation

- Three Android Compose emulator regressions assert denied/selected access
  cannot start a write, enrollment cannot happen before confirmation, batch
  requires separate confirmation, exact next cursor, logout/session invalidation,
  and stop action while global writer is busy.
- The OS grant requester checks actual Android platform permissions on each
  resume. The Controller still rechecks grants, root, Owner, device, source and
  upload journal just before the real Go mutation.
- No new Go endpoint, crypto layer, durable backup task record format, Web UI
  or unrelated platform changes.

## Safe 128-intent capacity recycling (MVP reliability)

The native incremental writer now reclaims **only VERIFIED intents backed by
an exact matching, durably committed SQLite receipt**, including matching
Owner/device, asset/resource/version, source SHA-256/bytes and verified
Go Node ID/revision. It verifies and compacts before a new intent is added,
and again after SQLite acknowledges an exact finalized Go upload. Different
Owners' fully verified intents may be reclaimed without making their pending
or unknown work eligible for replay.

PLANNED, MAY_HAVE_SENT and UNKNOWN_ACK cannot be removed by this path. An
unreadable index or failed journal commit preserves the original entries
and stops instead of silently discarding backup state. A post-finalize
SQLite failure leaves the original VERIFIED journal entry available for
repair. This is capacity management needed for >128 original uploads, **not
a new at-rest encryption scheme**. The existing private checkpoint and
SQLite index formats remain unchanged.

Pure JVM tests cover exact-index-only pruning, unknown-ACK retention,
failed index/commit, more than 128 completed originals, and no duplicate
UploadSession after journal repair.

## Owner-bound restart cursor (not another task log)

The foreground MediaStore ID-keyset scanner now resumes from a tiny committed
`(hash(Server installation, Owner, Root ID, Android device), lastVerifiedID)`
checkpoint after process restart. It advances **only after**
`NativePhotoIncrementalWriter` has a finalized Go receipt in SQLite or an
exact index-confirmed skip; a failed upload, stale Owner or UNKNOWN_ACK never
advances it. A clean end-of-sweep resets to zero for a future explicit rescan
and must not be described as proof of every original being backed up.

This is a numeric scanner position, not a backup task-record ledger. No new
Keystore/encryption format, raw URI, local filename, token, title, GPS,
media bytes or album list is stored. Existing encrypted uncertain-intent ledger
continues to fence all write decisions. Malformed or unavailable cursor state
fails closed rather than silently replaying an old upload.

Android instrumentation covers real preferences restarts, Owner A/B/ABA and
Server/device isolation, root-revision changes, stale-cursor failure,
validated sweep rewind and corruption. The cursor cannot authorize an upload.

## Not yet MVP complete

WorkManager opt-in automatic scheduling, safe durable large-library scanner
cursor, safe verified receipt compaction beyond 128 journal entries, bounded
lost-ACK exact read-only reconciliation, Motion Photo moving companion,
and installed-device Android 14 / 100k+ acceptance still require separate
implementation and validation. Real-device acceptance: **跳过（未验收）**.

The child cannot merge into master until #3349 is independently green/merged,
and this child exact HEAD passes applicable Android JVM, lint, debug APK,
emulator and final gate. Developer-branch integration is not a master merge.
