# Android native Photos Viewer, map return and dynamic picker (2026-10-30)

Stacked draft increment on #3292 (no change to its running CI HEAD).
Contract: [iOS fully-native navigation and Gallery priority](../../docs/architecture/ios-native-navigation-and-gallery.md).

## Implemented in this child branch

- **Gallery map return:** capture the source (local photos, local albums, or
  Owner-authenticated cloud originals) *before* setting the Map chip; preserve
  it on repeated Map actions. Exiting an unstacked Map restores the exact
  Gallery source instead of leaving the source chip on Map.
- **Native dynamic picker:** long-press the second bottom slot in portrait or
  landscape; the same actual implemented-feature picker is accessible from
  全部 and the dynamic screen. Today only Transfers is available; do not
  fabricate backup/sync/storage/admin routes. Owner login epoch resets it.
- **Local still Viewer:** read actual authorized MediaStore original via
  ContentResolver/ImageDecoder, with EXIF-aware decode bounded to 4096 px
  longest edge, 1–5x pinch/pan and double-tap zoom/reset. No Server token,
  second writer, original bytes persisted or false backed-up status. Video
  remains the existing Media3 native player.

## Safety and remaining P0 gaps

- iOS and Android are native UI implementations with the same behavior
  contract, not the same UI codebase. Android Photo/Video/Motion original
  incremental backup, authenticated receipts, scheduled WorkManager, and
  Owner/device linkage remain separate #3296/#3300/#3302 integration work.
- Decoding is size-bounded, but 4096px is a display limit, **not a claim that
  the full sensor-resolution pixels are shown**. Motion Photo moving
  companion, Gallery/Files cross-tab exact saved anchors, and map camera
  after reentering a tab are not yet complete.
- JVM regression covers image dimensions and map source restoration.
  Android emulator Compose test covers dynamic long-press and Launcher
  discoverability. Exact-HEAD Gradle, Android optional map build, required
  PR CI / Final Gate and real Android MediaStore permission/100k/rotation/
  lost-ACK acceptance remain unverified until actually run.
- Keep this PR Draft and stacked. Never merge the child to master while
  parent #3292 is unmerged, or claim that a queued/partial run passed.
