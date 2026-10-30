# Android native five-slot navigation and MediaStore gallery — P0 increment

Date: 2026-10-30. Scope: **Android only**. Contract:
[Native iOS five-slot / Gallery priority](../../docs/architecture/ios-native-navigation-and-gallery.md)
and [mobile-native-migration.md](../../docs/architecture/mobile-native-migration.md).

## Implemented on this development branch (not on master/APK until merged)

- One fully native Compose five-position bottom navigation:
  **全部 | 动态功能 | 图库 | 文件 | 我的**. Only slot 2's label
  changes with a real nonfixed feature. Android's initial supported dynamic
  feature is its existing authenticated Transfer Center; other entries
  are not falsely marked as implemented.
- Native Launcher categories, search, in-memory favorites/recent links;
  real destinations: Gallery (local/media/album/cloud/map), Files, Trash,
  Transfer Center. Mine shows current native account, Server/LAN settings,
  logout and real update check. Server admin is not implied.
- Gallery map is a feature child, not a sixth tab. Gallery root Back no
  longer navigates to Files. Read-only Files/Cloud Gallery Viewers use
  existing Server Owner APIs; no duplicate cloud media transport.
- Every successful authentication starts a new memory-only UI session
  epoch. On logout/server switch prior module selection, saved viewport
  keys, transfer popup, local MediaStore IDs and thumbnails are disposed.
- Separate Gallery source chips: **本机照片、 本机相册、 云端原件、 地点**.
  No UI action equates a local asset with a Server PhotoAsset receipt.
- Android 10+ local MediaStore read-only gallery: permission requested only
  by an explicit user action (Android 14 Selected Photos supported),
  32-album visible pages with actual thumbnail covers, album-specific
  photo/video walls with 64-item provider pages, 512 currently retained
  wall items, provider change invalidation and lifecycle cancellation.
  MediaStore album metadata scan is capped at 115,200 assets and 4,096
  buckets; cap and permissions cause explicit incomplete status.
  Local still thumbnail and video content:// viewers are scoped to the
  originating Gallery page. No new Server upload, writer or token routing.
- Android manifest requests only read grants for user-authorized media
  (legacy READ_EXTERNAL_STORAGE is maxSdk32). No broad storage write grants.

## Intentional incomplete areas — no production acceptance claim

1. Local still viewer currently uses a bounded MediaStore preview, not a
   guaranteed uncompressed full-resolution original. Embedded Motion Photo
   paired video/Live playback is NOT implemented. No Photo Picker/SAF
   import into Server is introduced by simply viewing local media.
2. No Android automatic photo/video/Motion original backup, WorkManager
   grant, background schedule, durable media ledger, UploadSession exact
   receipt writer/reconciliation or backed-up badge. Existing manual
   SAF Transfer Center remains authoritative. Implement P0 backup as a
   separate verified native workflow, reusing Go Server upload receipts
   and established Owner-scoped recovery protections.
3. Stable five positions are implemented; Android dynamic slot currently
   has only Transfers. Long-press recent picker and cross-launch permitted
   route restoration are not complete. Launcher shows recent functions
   accessibly, but this is not claimed to satisfy the long-press contract.
4. Switching Files/Gallery still calls existing controller routes that
   deliberately clear disposed Gallery Owner ranges. Exact within-tab
   saved album/map camera anchors across tab switches, complex L2 focus,
   complete native admin/settings, and real local 115k performance are
   follow-ups. No fabricated states or shortcuts for absent features.
5. No physical Android MediaStore full/selected/denied/changed,
   photo/video/Motion, 100k/115k, crash/Owner A→B→A,
   or network lost-ACK acceptance has been performed: **跳过（未验收）**.
   Emulator instrumentation must run when available.

## 2026-10-30 emulator failure follow-up

- The first PR Head `cb0369efa3b98827b09d1a67868649af528c51bd`
  compiled/linted/assembled successfully but its 320x640 Android emulator
  ran 120 instrumentation tests with **two real Gallery manual-album failures**:
  menu options were not reachable through anchored dropdowns after the fixed
  bottom navigation reduced the viewport. These checks did **not** pass.
- Replaced only manual album's edge-anchored action menu with an Android-native
  accessible action dialog, maintaining real existing Owner update/delete
  confirmations and the same action callbacks. Restored test assertions
  to directly confirm visible menu actions, instead of `performScrollTo()`
  on an absent node. Existing Cover Selection menu is unchanged.
- This is a targeted fix and **must be rerun on the new exact PR HEAD**.
  Neither earlier JVM green nor unrelated parent builds are a pass claim.

## Test gates

- Added pure navigation/JVM route tests: five stable slots, dynamic feature
  selection, Gallery shortcut scoping, recent/favorites and unauthorized
  fallback.
- Added Controller regressions: Gallery root Back stays local, a fresh
  authenticated Owner session resets UI epoch. Added Compose navigation
  fixture test for five destinations, Gallery local source and logout.
- Required: `cd android && ./gradlew --no-daemon :core:test :app:testDebugUnitTest
  :app:lintDebug :app:assembleDebug`, plus actual PR checks/Final Gate
  on the **exact PR HEAD**. Do not treat queued/failed/unrun checks as passed.
- Do not release/change master until the branch has successful required
  CI/Final Gate, reviewed merge candidate, and branch protection permits.
