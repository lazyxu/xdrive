# xDrive iOS — native login preview

First testable iOS shell (SwiftUI, iOS 16+), intentionally limited to the **native login screen**.
Visual reference: Android `AuthScreens.kt` and `SharedVisuals.kt`; uses the canonical
`assets/icon/web/pwa-512.png` brand and Android auth colors.

## What works in this increment

- Native light/dark compact login card: server, username, password reveal, default-on
  keep-login switch, loading and real error messages.
- Real HTTPS `POST /api/v1/auth/login`, `/auth/refresh` and `/auth/logout`.
  The server URL must be an HTTPS origin without paths, credentials or query.
- Platform trust evaluation is **never** bypassed; login requests do not follow
  redirects and credentials are never sent to another host or over HTTP.
- Only the refresh token is saved to device-only, unlocked Keychain when keep-login
  is on; never save passwords or access tokens. Refresh on app launch; rotate tokens.
  A rejected refresh clears the saved credential, while a transient outage does not.
- A successful login shows the real account and server plus a logout button;
  it does **not** pretend that Files or Gallery are implemented.
- If the server requires a mandatory password change, use the existing Web/PWA
  page first. This preview cannot change passwords.

Not yet implemented: Android's separate optional LAN IP routing, HTTP opt-in,
Files, Gallery, Viewer, transfers, background sync and real iOS device acceptance.
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
