# Historical native mobile recovery audit — 2026-10-30

This follows [the new all-native mobile decision](./mobile-native-migration.md).
Old SwiftUI files were located by Git history **after** the docs-only
architecture PR #3260 was opened. All descriptions here refer to exact
historical source and current `master` checked at restoration time.

## iOS sources located

| Source | Exact historical commit | Current disposition | Decision |
| --- | --- | --- | --- |
| `ios/XDriveIOS/LoginScreen.swift` | [#2891 / `aa63f285`](https://github.com/lazyxu/xdrive/commit/aa63f285347d65951880b748687c740848318ead) ; expanded in [`622ed059`](https://github.com/lazyxu/xdrive/commit/622ed0590a818b9f51bce21f6954d3e0e492afaa) | Removed by [#3123 / `aafe02c`](https://github.com/lazyxu/xdrive/commit/aafe02c1952ff032ca72df582ac32da1640607de) in the PWA-in-WKWebView migration | **Reusable UI design only**: adapt server/username/password/reveal/keep-login components to a new reviewed native auth controller; do not restore the old credential store or entire screen. |
| `ios/XDriveIOS/LoginViewModel.swift` | `622ed059` | Removed by #3123 | **Do not blindly reinstate**: uses retired `KeychainSessionStore`, in-memory native bearer and old `xdrive.ios.server` and lacks completed current native password-change/Owner lifecycle. Extract scoped Owner/root verification ideas only. |
| `ios/XDriveIOS/KeychainSessionStore.swift` | `aa63f285` through `622ed059` | Deliberately retired; current `IOSRetiredNativeLogin.purgeLegacyRefreshToken()` removes exact legacy service `com.lazyxu.xdrive.ios.session / xdrive.refresh` on launch | **Do not restore same service** without explicit migration and security review; a new native auth/refresh design must not conflict with current PWA and native background/ledger identities. |
| `ios/XDriveIOS/LocalPhotoInventoryScreen.swift` | [`622ed059`](https://github.com/lazyxu/xdrive/blob/622ed0590a818b9f51bce21f6954d3e0e492afaa/ios/XDriveIOS/LocalPhotoInventoryScreen.swift) | Deleted by #3123; `PhotoKitResourceInspector` and `PhotoKitAlbumPager` still exist in master | **Recovered unchanged** as compiled native read-only inventory/album UI. Optional upload callback defaults to nil, has no wiring in current App. Its older text about Live/video support and first-still uploads is *historical*; do not present it as a complete native backup/Gallery. Future integration should remove obsolete optional upload controls and use the canonical verified native Owner/session. |
| `ios/XDriveIOS/PhotoKitScanPreviewScreen.swift` | [`622ed059`](https://github.com/lazyxu/xdrive/blob/622ed0590a818b9f51bce21f6954d3e0e492afaa/ios/XDriveIOS/PhotoKitScanPreviewScreen.swift) | Deleted by #3123; `PhotoKitBoundedSnapshotScanner` remains in master | **Recovered unchanged** as explicitly opened, read-only, 64-item/page PhotoKit metadata inspection. Generation/permission changes cancel and invalidate; no original bytes, GPS or server writes. |
| `ios/XDriveIOS/PhotoBackupMVPScreen.swift` | `622ed059` | Deleted by #3123 | **UI reference only** until native Owner/auth is safe. It depends on retired `LoginViewModel` and old 256/20 first-still scope, not today's V2 ledger/video/Live/BG behavior. |
| `AuthService`, `OwnerRootVerifier`, `PhotoKitBoundedSnapshotScanner`, `PhotoKitResourceInspector`, `PhotoKitAlbumPager`, `PhotoSyncEncryptedLedger`, `ForegroundPhotoBackupMVP`, `NativeUploadSessionTransport` | Added through #2891/#3056/#3063/#3097 and later | **Already present in current master** | **Reuse existing code in place; do not cherry-pick obsolete versions or fork the Go UploadSession/CAS writer.** |

## Android assessment

Current `android/app/src/main/java/com/tfluid/xdrive/` already contains
actual Compose `AuthScreens.kt`, `DriveApp.kt`, `DriveController.kt`,
`FileScreens.kt`, `GalleryScreens.kt`, native Gallery/Files Viewer
(image/video/Live/PDF/audio), `NativeTransferCenter.kt`, SAF import/export,
and `android/core/.../XDriveApi.kt`. **Do not recreate native Android from
history.** Preserve and extend the current implementation for MediaStore
inventory, real one-way original photo backup, durable task history and
native background execution; verify availability with current tests.

## This recovery PR (source, not an installed app)

Restores only two exact Git blobs from `622ed059`:
- `LocalPhotoInventoryScreen.swift`, old blob `d9bec92e6448d7b19fc7ac399c23e0f209cd5049`
- `PhotoKitScanPreviewScreen.swift`, old blob `abefdbcc4894f146860989d1c4ecbe029506b5f3`

Both are **unmounted native SwiftUI source screens** compiled by the XcodeGen
target; current `XDriveIOSApp` remains the existing WebView transitional
runtime until a new native Login/Owner/Files/Gallery route is validated.
No native credential is recreated; no backing upload is started; no old
background grant or ledger is modified. Source contracts verify bounded
PhotoKit reads, explicit permissions and cancellation. Exact-HEAD macOS IPA
must compile before merge; real iPhone, photo permission and SideStore tests
are **跳过（未验收）** until performed.

Next PR should adapt these screens to a new Native App shell and authenticated
Owner model, replace outdated UI labels and add real local photo thumbnails
with PhotoKit caching. Must not treat an album inventory as a whole-library
backed-up receipt.
