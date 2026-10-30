# xDrive mobile Apps — fully native iOS and Android

**Decision: 2026-10-30.** This supersedes earlier instructions requiring an
iOS WKWebView/PWA product UI or forbidding native SwiftUI Login, Files, Gallery,
Viewer, Settings and Photos. It **does not change** the shared React/MUI
Desktop/DSM architecture, nor the independent Web/Mobile Web/PWA.

| Client | UI target | Current as-built |
| --- | --- | --- |
| iOS App | SwiftUI/UIKit, every product screen native | PWA-in-WKWebView shell + valuable native PhotoKit and backup core |
| Android App | Kotlin/Jetpack Compose, every product screen native | Already native Auth/Files/Gallery/Viewer/transfers; remaining gaps |
| Web/PWA | React/MUI | Browser app, including offline/service worker |
| Desktop/DSM | One shared React/MUI XDriveApp + real Host ports | In-progress shared state/controller migration |


## Native iOS navigation decision (2026-10-30)

The approved five-slot bottom navigation, per-feature back stacks, three display levels and Photos-first rollout are specified in [ios-native-navigation-and-gallery.md](./ios-native-navigation-and-gallery.md). It is a UI contract; native implementation and acceptance remain separate.

## Product parity, not shared mobile JSX

Mobile clients share the real Server REST/DTO contracts, Owner/Device/Root,
Node/PhotoAsset/PhotoResource IDs, UploadSession/CAS original receipts,
design tokens/assets and interaction specs. **They do not share React JSX,
WebKit PWA login, or browser cookies**. iOS uses PhotoKit/Keychain and Swift
network/session services; Android uses MediaStore/SAF/Media3/Keystore, native
HTTP and appropriate native background services. Both provide native Server
selection and scoped account login, Owner state and logout.

## iOS P0 migration order

1. **Audit before restore.** Find historical deleted SwiftUI/UIKit screens,
   navigation/controllers, photo inventory, diagnostics and auth. Record exact
   commit/path, dependencies, current API compatibility, security effects
   and usable pieces. Cherry-pick or adapt only bounded components; never
   blanket-revert the WebView integration or revive unreviewed refresh tokens.
2. **Native shell/auth.** Native server address/HTTPS and IP SAN validation;
   native Login/password change/remember/logout using a reviewed, Owner- and
   origin-scoped Keychain/session design, no TLS bypass or redirects.
   Server/Owner A→B→A invalidates old Files/Photos cache/requests and
   explicitly handles old Owner/device/background grants.
3. **Native cloud product.** Files paging/search, cloud Gallery/PhotoAsset
   and albums, Map, Viewer images/video/Live, Transfers, Settings, native
   navigation and cancellation with real Owner-scoped Server APIs.
   No fake pagination/authorities/feature success, no PDF/content editing.
4. **Native local photos + backups.** Authorized PhotoKit Full/Limited
   album/photo wall/thumbnail paging, change observation, still/video/Live
   bytes; native status UI using existing encrypted V1/V2 ledger, generation
   cursor, exact original SHA/UploadSession/CAS/Node receipt and uncertain-ACK
   reconciliation. Do not create a second uploader or silently reset old
   ledgers; migrate Web-bearer foreground path to independently verified
   native Owner proof.
5. **Background and cutover.** Native BGProcessingTask and scoped grant,
   compatible Keychain/file-protection plan, crash/restart replay, bounded
   100k media, realistic system scheduling and cancellation. Keep existing
   WKWebView product runnable until all native critical paths are tested;
   remove only obsolete bridge/credentials when true native replacements
   and rollback are verified.

## Android: extend existing native implementation

Reuse `android/app/src/main/java/com/tfluid/xdrive/` and `android/core/`:
Compose `AuthScreens`, `DriveApp`, `DriveController`, native
`FileScreens`, `GalleryScreens`, photo/video/Live/PDF/audio viewers,
SAF upload/export, native transfer/recovery, and current Server HTTP/Owner
models. Priority remaining: native MediaStore/Photo Picker inventory and
one-way authorized original photo/video/Live backup with durable queue,
idempotent ACK handling, correct OS background execution and native
status/history UI. Use the same Go Server writer, not an Android CAS fork.

## Safety and acceptance

- Preserve current working IPA/APK + build workflows during migration. A
  documentation update never means native iOS has been delivered.
- No Web bearer/cookie pasted into native Keychain; no implicit admin/Device
  rights; strict TLS hostname/IP SAN, expiry, no credential redirects.
- Reuse genuine current Owner/root receipts and encrypted journal and protect
  unknown server ACKs from blind replay, on cancel/switch/restart as well as
  normal upload. A background capability checkbox never proves a photo was
  backed up or a force-quit task was started.
- Native lists/album scans use bounded paging, cancel stale Owner reads and
  test 10k/100k/115k. Manual viewer reads may preempt disposable thumbnails
  but must not cancel durable uploads.
- Every PR: scoped code, affected Xcode/Swift + Android Gradle/Kotlin + Go
  API/authorization and UI tests, exact HEAD and required Final Gate; protect
  running green PR heads. Device/SideStore/production unavailable checks
  are **跳过（未验收）**, not passing evidence.

## Existing docs hierarchy

The active decision above and `AGENTS.md` take priority. Historical
`ios/docs/shared-ios-host-adapter.md`,
`docs/android-ios-pwa-ui-parity.md`, and older WebView/iOS PWA roadmaps
remain as **implementation history**, not a ban on native iOS screens.
