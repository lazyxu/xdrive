# PWA CR03d · Native Chromium LevelDB on-disk corruption (2026-10-23)

Scope: P1-03 remaining storage-failure test, distinct from merged native
QuotaExceeded (#2388), transaction abort/blocked/VersionError (#2361),
and late IDB purge/consent fences (#2377/#2389).

This source-exact test uses an isolated automatically created Chromium profile
and ONLY synthetic Owner, one directory, and one album. Native process A
writes genuine opted-in P1 IndexedDB, and independent process B cold-opens
the PUBLIC offline shell to verify the historical-only state persisted.
Both processes CLOSE before the runner physically overwrites the native
LevelDB CURRENT manifest-pointer file and fsyncs it, with strict path
and file-type checks restricted to the disposable temp directory.
Processes C and D cold-open the SAME profile independently after this
corruption. Chrome may legitimately recover coherent records or discard
the corrupted backing store. Either result is allowed only as historical
unverified or empty state, never as live authorized files, and must keep
public SW CacheStorage private-byte-free. Raw profile/paths/original bytes
are never uploaded; only fixed result booleans and exact SHA are archived.

This is a real OS file mutation of a native Chrome IndexedDB LevelDB
backing store, NOT a JavaScript DOMException mock or injected browser API.
It is NOT a kernel EROFS or EIO experiment, real physical disk failure,
or an iOS/Android hardware test. Other OS storage error modes remain
unverified; do not claim universal corruption recovery or data preservation.

Require genuine specialized native Chrome CI and full source-exact
Web/Desktop/Go/Linux/Windows/PostgreSQL API Race/Final Gate before merge.
Production-only inaccessible safety acceptance: 按用户决定跳过（未验收）.
Source Owner/ACL/privacy regressions remain mandatory and separate.
