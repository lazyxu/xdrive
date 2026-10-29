# xDrive iOS — shared PWA Files/Gallery and explicit native Photos backup

SwiftUI shell (iOS 16+) mounts the canonical server-hosted PWA Files, Gallery, Map and Viewer in a persistent origin-locked WKWebView. The separate native login offers Owner-verified Files upload, authorized PhotoKit local inspection and explicitly requested single-still original upload. Foreground incremental photo backup is introduced in its own reviewed PR, not an automatic background process.
Visual reference: Android `AuthScreens.kt` and `SharedVisuals.kt`; uses the canonical
`assets/icon/web/pwa-512.png` brand and Android auth colors.

## What works in this increment

- Native light/dark compact login card: server, username, password reveal, default-on
  keep-login switch, loading and real error messages.
- Real HTTPS `POST /api/v1/auth/login`, `/auth/refresh` and `/auth/logout`.
  The server URL must be an HTTPS origin without paths, credentials or query.
- iOS local-network usage description is embedded for direct LAN connections;
  approve local network access when prompted on the iPhone.
- Platform trust evaluation is **never** bypassed; login requests do not follow
  redirects and credentials are never sent to another host or over HTTP.
- Only the refresh token is saved to device-only, unlocked Keychain when keep-login
  is on; never save passwords or access tokens. Refresh on app launch; rotate tokens.
  A rejected refresh clears the saved credential, while a transient outage does not.
- A successful native login shows the real account and server plus a logout button.
  Files/Gallery/Viewer are supplied by the **shared PWA session**, not cloned into SwiftUI or unlocked by the native login token.
- If the server requires a mandatory password change, use the existing Web/PWA
  page first. This preview cannot change passwords.

## Native Photos permission and metadata inventory

After native login, verify the current Owner and open **系统相册识别与单张照片手动上传**; the permission prompt appears only after tapping **允许检查系统相册**.
PhotoKit requests `readWrite` access only after this second explicit tap. A
`limited` grant is respected: totals refer only to the subset made visible by
iOS. Reopen the panel to refresh counts; changing authorization uses iOS Settings.

The native panel shows PhotoKit's lazy photo/video counts and at most 30 recent
authorized metadata items (type, date and Live Photo flag). Each visible item now
has an explicit **检查此项的原始资源组成** action: this re-resolves its currently
authorized transient PhotoKit identity, enumerates only PHAssetResource metadata
and distinguishes still, video and Live paired-video resources. A missing Live
component is reported as incomplete, never backed up as a finished Live Photo.
Full-resolution resource existence does not prove iCloud bytes are locally
available; this does not start an iCloud download or upload. No localIdentifier
or resource filename is saved into credentials, persisted state or Server.
 Ordinary local inventory inspection does not load original bytes, GPS or upload data. However, **explicit single-still manual upload and user-triggered foreground backup are different actions**: they read authorized original bytes and write the actual file through authenticated Server UploadSession after a separate user click. Live Photo paired completion, background sync and all-library coverage are not inferred from a single file receipt.
There is no PhotoKit authorization prompt at app launch or native login.

**Required for true native MVP**: securely mount the PWA's real Files/Gallery
routes in a single UI (with an intentional browser/native session handoff);
bind the PhotoKit device and selected Owner; implement explicit upload consent,
bounded PhotoResource bytes/Live pair streams, the existing
UploadSession/chunk/finalize protocol, durable per-asset ledger and
reconciliation after uncertain ACK; handle iCloud originals, albums,
delete/mirror policy, permissions changes, app restarts and background
constraints. Never equate a successful count with a successful backup.

Not yet implemented as native equivalents: Android's optional LAN IP routing or HTTP opt-in. PWA Files, Gallery and Viewer run through the WebKit host. Native background photo sync, Live original pair completion and real iOS device acceptance remain outstanding. The first foreground ordinary-still backup flow is limited to explicitly authorized Owner Files writes, not a privileged Device SourceRun.
If using a LAN IP as the primary server URL, its HTTPS certificate must actually
validate for that IP; preferably use your trusted server hostname with local DNS.
No certificate-warning bypass or fake LAN failover is implemented.

## CI: build a SideStore-ready unsigned IPA

`.github/workflows/ios-unsigned-ipa.yml` runs for iOS-only PRs, relevant
master pushes and manual dispatches after this workflow lands on master.

1. macOS GitHub Actions prepares the canonical xDrive icon using `sips`.
2. XcodeGen generates `ios/xDriveIOS.xcodeproj`; Xcode builds with code signing
   **disabled**; the output is packaged as `Payload/xDriveIOS.app` in an IPA.
3. Download the `xDrive-iOS-unsigned-<SHA>` workflow Artifact (a ZIP).
4. Unzip the Artifact in Files on iPhone and import the inner
   `xDrive-unsigned.ipa` into SideStore. This IPA is **not** already signed.
5. SideStore signs with your *own* free Apple Account and installs it.
   Enable Wi-Fi and LocalDevVPN to install/refresh. Refresh SideStore and
   xDrive before their free-signing 7-day expirations.

Official SideStore first-time setup (requires a computer and an initial cable):
https://docs.sidestore.io/docs/installation/install
SideStore prerequisites: https://docs.sidestore.io/docs/installation/prerequisites

The first build is an Actions Artifact, **not** a published Release, an installed
app or a physically tested iPhone build. No Apple ID/password, provisioning
certificate or device pairing file is ever uploaded to GitHub Actions.
A user testing it on a real device is still **跳过（未验收）**.

## Local macOS build

```sh
brew install xcodegen
bash ios/scripts/prepare-assets.sh
(cd ios && xcodegen generate --spec project.yml)
xcodebuild -project ios/xDriveIOS.xcodeproj -scheme xDriveIOS \
  -configuration Release -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build
```

Generated project, images and Info.plist are intentionally ignored by Git.
