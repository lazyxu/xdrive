# xDrive iOS — one shared UI, native capabilities through Host Adapter

The iOS app uses **one canonical xDrive React/MUI application**. The native
SwiftUI shell exists only to select a trusted HTTPS server, host a persistent
same-origin `WKWebView`, handle platform-level connection failures and connect
approved iPhone capabilities. Files, Gallery, Map, Viewer, account Login,
Settings and iPhone Photos backup are all rendered by **the same PWA UI**.

Do not create or revive separate SwiftUI Login, Files, Gallery, Viewer, Settings
or Photos pages. The old native Login/Photos diagnostic screens have been
removed from the consolidated shared-host branch; their reusable PhotoKit,
encrypted ledger and existing Go UploadSession service code remains.
On launch only the exact obsolete native-login refresh credential is purged
from the legacy Keychain service; the PWA cookies, native Device identity and
original-photo ledger secrets are not touched.

## iPhone Photos backup

The shared xDrive **账户 → 设置 → iPhone 系统相册备份** section appears only
when the real iOS WKWebView Host Adapter is available and the PWA has a current
Server-authenticated Owner. The regular browser/PWA/Desktop/DSM UI does not
pretend to provide iOS PhotoKit.

1. Sign in once through the **shared PWA login** in the iOS app.
2. Open the existing account Settings; iOS native Photos status is verified
   against the current PWA account's short-lived access token.
3. Explicitly grant Full or Limited Photos permission if requested. The count
   refers only to the authorized subset.
4. Optionally allow iCloud original downloads (off by default).
5. Tap **开始本轮照片备份** and confirm the destination Owner/server in
   the iOS system prompt. Only then does PhotoKit export original bytes.
6. The native host re-verifies Server installation + Owner/root and reuses the
   existing encrypted intent journal and Go UploadSession/CAS/Node receipt
   implementation. Results and bounded real progress return to shared Settings.

MVP in the consolidated follow-up: each pass scans one bounded window of
at most 256 currently authorized media (64 metadata entries per lazy page),
and uploads at most 20 **original items** through a single existing Owner
UploadSession/CAS/verified Node receipt path. Ordinary stills and original
videos are single-resource uploads; Live Photos require both PhotoKit
original resources packaged together into one full-SHA verified ZIP Node.
The ZIP preserves the originals but is **not** yet a playable Gallery Live
resource or an automatic restore into Apple Photos. The user may explicitly
enable a 15-minute/1-hour/6-hour/daily *foreground-only* automatic interval
while the authenticated App remains open, with Owner/root re-verification
and encrypted journal incremental deduplication. The draft iOS scoped
background integration additionally offers a revocable native Owner/Device/
Root grant and a one-original BGProcessingTask attempt while protected data
is available. Lock-screen work, force-quit wakeup, precise OS scheduling,
100k sharded full-library ledger and privileged Device SourceRun are **not
implemented or validated**. If Server login/PWA fails, the native connection
recovery screen can cancel this device's BG request and Keychain vault without
network access; this leaves remote grant revocation explicitly pending. PhotoKit offsets can shift on edits and are not durable IDs.

Canceled/backgrounded/stale-Owner work is stopped conservatively. A lost
create/finalize acknowledgment remains **needs reconciliation**; it never
licenses a blind duplicate upload. No mirror deletion or thumbnail-for-original
substitution. Preserve the existing upload/ledger logic instead of creating a
second uploader.

## Security and session boundaries

The native host bridge accepts only messages from the pinned, system-trusted
HTTPS *main frame*. Each private operation verifies the current Owner identity
and root with authenticated Server calls; the page cannot self-declare Owner
privileges. Only a short-lived **in-memory PWA access token is passed one way,
Web → native**, during a user-requested operation. Swift uses an ephemeral
URLSession, ordinary TLS and redirect rejection. No native Keychain refresh
credential, cookie, raw PhotoKit identifier, GPS, original filename or byte
content is sent back to JavaScript. A sign-out, Owner change, WebView navigation,
Settings closure or app background cancels active foreground work.

The PWA-selected server uses `xdrive.ios.web.origin`; the legacy
`xdrive.ios.server` key is migrated once for upgrades and is no longer an
independent visible native Login entry. Only system-trusted HTTPS domain or IP
certificates are supported; do not bypass certificate errors.

The shared React Login and Settings include **更换 iPhone App 服务器**;
the real iOS Host Adapter invokes the host's existing confirmation before a
change. Only the initial trusted-HTTPS connection chooser and error recovery
remain small SwiftUI bootstrapping surfaces, not a second authenticated UI.

See [shared-ios-host-adapter.md](docs/shared-ios-host-adapter.md) for protocol,
security expectations, exact CI, and physical acceptance matrix.

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
