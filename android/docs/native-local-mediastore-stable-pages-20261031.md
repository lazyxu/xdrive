# Android Gallery: stable bounded MediaStore pages

Date: 2026-10-31. Scope: Android native local Gallery and album browsing only.
Parent behavior contract: `docs/architecture/ios-native-navigation-and-gallery.md`.

## Why

An OFFSET page is not stable while photos are added or removed. Some OEM
providers ignore the offset while honoring the limit, repeating the first 512
rows and inflating local album counts. The old Gallery wall checked only the
currently retained 512 IDs, which could miss a repeat after older rows were
discarded. These are local display errors, not backup receipts.

## Current Gallery behavior

- Each MediaStore query is a bounded 64-item photo-wall or 512-item metadata
  page, ordered by `DATE_ADDED DESC, _ID DESC`.
- The next request binds the last observed `(DATE_ADDED, _ID)` key and
  requests only strictly older rows. It never uses a shifting OFFSET.
- Reject a response larger than the requested limit, invalid IDs/dates,
  non-image/video rows, duplicate rows, repeated first pages and unordered
  provider data. If the provider ignores the keyset predicate, stop with an
  explicit reading error rather than report false album counts.
- Omit pending media, and omit trashed media on Android 11+; never request
  broad storage-write permissions or infer a remote Server backup.
- Album enumeration keeps at most 4,096 aggregated buckets and scans at most
  115,200 authorized local rows. The wall retains at most 512 tiles; its
  cursor remains available after dropped tiles. At the cap, results are
  explicitly incomplete.
- Permission changes, local ContentObserver events and manual refresh reset
  the local page anchor. Existing Viewer-only thumbnail cancellation and
  Owner/session UI epoch fencing are unchanged.

## iOS-aligned native Gallery landing

After a new authenticated Android login/session restoration, wait until the
actual Owner root directory GET has loaded before opening the native Gallery
fixed tab. The earlier Files-first bootstrap remains available while Owner
verification is incomplete; a failed root GET does not forge a Gallery session.

One-shot landing is fenced to the current native UI session epoch, does not
run during uploads/downloads, destination picking, file Viewer, edit mode or
other file actions, and never overrides an explicit Launcher/Files/Dynamic tab
choice. Once the user opens Files, their navigation remains Files until they
choose another tab; no cross-tab Back and no WebView transition.

## Gates and limitations

Pure JVM tests cover sort ties, page boundary continuity, invalid cursor keys,
OEM repeated-page behavior and discarded wall history. Exact PR-HEAD Android
Gradle, lint, debug APK, emulator and required Final Gate remain mandatory.

This does not prove 100k/115k physical-device performance or every OEM's
MediaStore pagination semantics. A provider lacking bounded, ordered SQL query
support is explicitly unavailable rather than silently showing wrong data.
Full/selected/denied/changed Android photo permissions and OEM hardware
acceptance: **跳过（未验收）**.

Unchanged: UploadSession, Go Server, encrypted ledger, device credentials,
manual single-original backup consent and cloud Gallery.
