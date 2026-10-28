# xDrive iOS — native login and local PhotoKit inventory preview

First testable iOS shell (SwiftUI, iOS 16+). Authentication works; the only additional native capability is an explicitly requested, local-only PhotoKit metadata inventory. Files, Gallery, Viewer and synchronization remain absent.
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
- A successful login shows the real account and server plus a logout button;
  it does **not** pretend that Files or Gallery are implemented.
- If the server requires a mandatory password change, use the existing Web/PWA
  page first. This preview cannot change passwords.

## Native Photos permission and metadata inventory

After native login, tap **检查系统相册（不上传）**, then **允许检查系统相册**.
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
 It neither loads
original bytes nor accesses GPS, caches local identifiers, stores personal
assets or writes anything to Server. This is **local recognition**, not an
upload, a complete Live Photo pair validator, or a background sync engine.
There is no PhotoKit authorization prompt at app launch or native login.

**Required for true native MVP**: securely mount the PWA's real Files/Gallery
routes in a single UI (with an intentional browser/native session handoff);
bind the PhotoKit device and selected Owner; implement explicit upload consent,
bounded PhotoResource bytes/Live pair streams, the existing
UploadSession/chunk/finalize protocol, durable per-asset ledger and
reconciliation after uncertain ACK; handle iCloud originals, albums,
delete/mirror policy, permissions changes, app restarts and background
constraints. Never equate a successful count with a successful backup.

Not yet implemented: Android's separate optional LAN IP routing, HTTP opt-in,
Files, Gallery, Viewer, transfers, actual Photos backup, background sync
and real iOS device acceptance.
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
