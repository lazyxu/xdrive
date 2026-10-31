# xDrive iOS — fully native SwiftUI/UIKit target (2026-10-30)

**New decision:** ALL installed iPhone product pages will use native SwiftUI/
UIKit: Server selection, Login/account, Files, Gallery/cloud/local PhotoKit,
Map, Viewer, Settings, Transfers and native photo backup controls. The iOS App
will **not use Web/PWA React or WKWebView for product UI**. Android stays
native Kotlin/Compose; Web/PWA stays an independent React client.

**Current as-built:** the installed App enters the native SwiftUI Owner login
and five-slot Photos-first workspace. The old WKWebView/PWA connection shell,
WebKit download delegate, and JavaScript PhotoKit Host bridge have been
retired from the iOS target. Web/PWA remains a separate browser client.
The iOS native Files, Map, full cloud Live playback and some tools are not
yet complete and must show truthful unavailable states rather than fallback
to browser pages.

## Native navigation / Photos-first UI

The approved iPhone portrait/landscape UI uses **全部 | 动态功能 | 图库 | 文件 | 我的**, independent per-feature back navigation and L1/L2/L3 display levels. PhotoKit albums/photo wall/Viewer are the first native UI priority. Details: [native navigation and Gallery contract](../docs/architecture/ios-native-navigation-and-gallery.md). This is not a claim that the currently released IPA implements this shell.

## Preserve and reuse existing native code

The iOS code already contains useful Swift PhotoKit enumeration, Full/Limited
permission checks, native still/video/Live original extraction, local albums,
encrypted V1/V2 intent ledgers, SHA-256/Node receipt verification, Go
UploadSession/CAS transfer, Device enrollment, Keychain and scoped BGTask
authorization. Do NOT delete or duplicate these. The native foreground uploader uses verified Owner/root authorization.
The current native Keychain v2 session, encrypted backup journal, background
grants and uncertain upload receipts must remain intact. The exact retired
Keychain service is purged only for security, not used to restore Web login.

## Native migration priorities

1. Audit historical SwiftUI/UIKit Login, navigation, Files/Photos/Viewer
   screens and recover safe code by focused adaptation, never broad revert.
2. Native Server/HTTPS/Owner Login + Keychain scoped session, logout and
   server switch; exact CA/hostname/IP-SAN checks, no credential redirects.
3. Native Files/Gallery/Map/Viewer + local PhotoKit albums, thumbnail paging,
   videos/Live, cancellations/return anchors, truthful missing capabilities.
4. Native backup UI and state owned by Swift, reusing current PhotoKit and
   encrypted journal/UploadSession/CAS/Node receipts; native Owner auth,
   no blind duplicate writes on uncertain ACK; no mirror delete.
5. Independent authorized BGTask/URLSession where supported, persistence,
   revoke/stop, 100k bounded performance; no force-quit/locked-screen
   guarantee without real hardware evidence.
6. Exact-head IPA Xcode/native unit/API/security/CI gates and restore/update
   compatibility; do not reintroduce the deleted legacy WKWebView UI bridge.

The existing bounded core scans at most 256 authorized items (64 per page)
and uploads at most 20 complete original still/video/Live ZIP items per
foreground pass; an OS-admitted BGTask currently attempts at most one
original while protected data is accessible. Live ZIP is not yet a native
Gallery Live pair, and iOS does not guarantee background timing. Current
features and limitations are not certified by a successful unsigned IPA build.

Full target and recovery rules:
[mobile-native-migration.md](../docs/architecture/mobile-native-migration.md).
Historical `ios/docs/shared-ios-host-adapter.md` and iOS-PWA documents
describe removed implementations, not active app behavior or fallback code.

## GitHub Actions: unsigned IPA for SideStore

`.github/workflows/ios-unsigned-ipa.yml` builds on macOS for iOS-scoped PRs,
relevant master pushes and explicit workflow dispatch. It prepares icon assets,
generates an Xcode project with XcodeGen, builds for iPhoneOS with signing
disabled, then packages `Payload/xDriveIOS.app` into
`xDrive-unsigned.ipa` along with SHA-256.

Download `xDrive-iOS-unsigned-<commit SHA>` from that successful workflow's
Artifacts. The artifact ZIP contains an **unsigned** IPA, not an installed,
already signed app. Import the inner IPA into SideStore and sign with your own
Apple Account according to SideStore's supported setup/refresh process.
Do not upload an Apple ID password, provisioning private key, device pairing
file or personal mobile certificate to CI.

SideStore setup: https://docs.sidestore.io/docs/installation/install
SideStore prerequisites: https://docs.sidestore.io/docs/installation/prerequisites

### Local macOS build

```sh
brew install xcodegen
bash ios/scripts/prepare-assets.sh
(cd ios && xcodegen generate --spec project.yml)
xcodebuild -project ios/xDriveIOS.xcodeproj -scheme XDriveIOS \
  -configuration Release -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build
```

Build success is distinct from signability, installation and real iPhone
operation. SideStore, Live Photos, partial PhotoKit grants, iCloud, lost-ACK
and real device backup tests remain **跳过（未验收）** until performed; this
does not waive actual repo CI, authentication, or CAS security gates.
