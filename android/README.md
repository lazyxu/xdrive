# xDrive Android — native client, first increment

Kotlin / Jetpack Compose, Android 10 (API 29) and later. This is a separate native
client of the existing xDrive Go Server, not a WebView wrapper. The Server and
Web/Desktop implementations are unchanged.

## Scope

First increment: Server configuration, login, mandatory password change, root and
nested folder browsing, Server-ordered 100-item pages, refresh/retry, file metadata
and logout. Tokens are memory-only; a process restart requires login. Only the
Server address, per-origin connection preferences, explicit HTTP preference and selected update source are saved. HTTPS uses platform trust
and hostname validation. HTTP sends credentials and content without encryption;
it requires explicit opt-in and should only be used on a trusted network.

The connection screen offers 自动 / 仅内网 / 仅公网. Optional LAN and public
addresses must be literal IPs; LAN accepts RFC1918 IPv4 or ULA IPv6, while public
addresses must be globally routable. LAN-only requires an address. Android uses
the device's own DNS when no public address is supplied; Windows hosts entries
do not configure an emulator's resolver. Public-only filters private, loopback,
link-local, reserved and documentation ranges from DNS results.

With explicit route settings, an anonymous bounded HTTPS `/api/v1/version`
request selects the socket before credentials are sent. Auto tries the configured
LAN address first, then public addresses only after DNS/connection/timeout
failure. Certificate or invalid-response errors stop selection. The original URL,
Host/SNI and platform certificate/hostname checks remain in force. The selected
IP is pinned in memory for that login session; logout/relogin or reconnect
selects again. Authenticated calls never switch routes or replay after a network
failure. Preferences are scoped to the exact origin and contain no credentials.
The public update checker continues to use its own independent client.
The Android client resolves through API 29+ asynchronous `DnsResolver` using
the current device network. The 12-second selection deadline or caller
cancellation cancels its native `CancellationSignal`; probes have a separate
3-second timeout. No detached blocking DNS thread is used by the Android client.

Default Auto with both IP fields empty retains the previous connection behavior,
including direct IP addresses and the explicit HTTP opt-in. Explicit route settings
require an HTTPS DNS domain. Unknown saved modes block connection until a valid mode is selected. These
controls do not change the server's listening ports, LAN reachability or CA trust.

This does **not** yet implement file preview/download/editing, upload, Gallery,
album synchronization or full Web/Desktop parity. Next increments add manual
media uploads and Gallery, then opt-in one-way album backup with a durable queue.
It does not activate unfinished Local Push v2 or create another content writer.

## Shared Web/Desktop appearance

The native Compose adapter uses the canonical xDrive brand from
`assets/icon/web/pwa-512.png`, the resolved shared MUI light/dark auth palette,
and the shared filename classification and Rounded Material action/file glyphs.
Phone Files now uses continuous-scroll authenticated 100-item Server pages and
an explicit list/icon view toggle. The view preference is stored as a non-sensitive
local UI setting; invalid values fall back to list. Pages append without replacing already visible
rows; a failed append retains the prior page and retries only the failed offset.
Short-tapping a folder opens it; long-pressing a row opens only real current actions
(folder open and/or properties), not placeholder file mutations. Switching folders
or refreshing starts a new first-page read. A bounded session-only viewport index
cache restores a visited folder within the currently loaded range when returning,
and grid/list switches seed the new viewport before its first frame. Persisted
directory return after process restart and unloaded-page anchors are not yet supported.
No second file
transport or optimistic cross-folder merge was added. Owner-checked recent file and favorites sections now use the existing Go
`/api/v1/file-recent` (bounded to 50) and `/api/v1/file-favorites` (bounded
to 256) endpoints. File/folder location breadcrumbs are checked through the
existing authenticated root/children pipeline before navigation. Long-press
supports real add/remove favorite actions with no optimistic success after a
failed request. The browsing list is preserved when changing the three Files
sections, and switching accounts discards the private collection rows.
Native Files also offers real Owner-scoped global search through the existing
`GET /api/v1/search` Server cursor contract, with 100 items per authenticated
page, cancellation on new queries, explicit failed-page retry and correct
Breadcrumb-based folder location. This is never a filter of only the visible
directory. Basic native Files mutations now also use the existing Owner
Node API: New Folder (POST), Rename (PATCH with `If-Match`), and Move to Trash
(DELETE with `If-Match`). Android shows a confirmation before trashing an
item or subtree, never retries a write automatically, and refreshes the
authoritative Server listing only after a successful acknowledgement.
If that follow-up read fails, it reports the mutation as committed but the
directory as stale, with GET-only refresh; it does **not** repeat the write.

Structured filtering, saved searches, batch copy/move, upload/download,
thumbnails, Gallery, Viewer, and transfers are still unimplemented; this
increment is **not** full iOS PWA UI/functionality parity.

Phone folders use the actual blue iOS-style PWA `MobileFolderIcon` from
`web/src/MobileFiles.tsx`, including both gradients and the highlight, with that
page's flat list surfaces. This intentionally differs from Desktop's yellow
folders. Android keeps its system font, Back/IME behavior and at least 48dp touch
targets; visual consistency is not a claim of identical font rasterization or
full feature parity.

Generated native assets are checked in so an ordinary Gradle build needs no
Node/npm installation. After changing a canonical UI source, regenerate and
review the native snapshot rather than editing its generated colors or glyphs:

```sh
node android/scripts/shared-ui.mjs --write
node --test android/scripts/shared-ui.test.mjs
node android/scripts/shared-ui.mjs --check
```

Regeneration requires the existing Web/Desktop TypeScript and MUI dependencies;
the check and tests are dependency-free and run in the Android CI job. The icon
archive must match the version and integrity pinned by `web/package-lock.json`;
the retained MIT notice records the upstream icon license. The canonical SVG and
Web/Desktop assets are not changed by this adapter.

## Build and test

Use JDK 17 or 21, Android SDK platform 35 and build-tools 35.0.0. Set ANDROID_HOME
to the installed SDK. The committed Gradle wrapper pins 8.11.1 and its SHA-256.
The initial AGP 8.9.2 baseline deliberately targets API 35 (lint's OldTargetApi
advisory is expected); it is not a claim of latest Play Store release readiness.

```sh
cd android
./gradlew --no-daemon :core:test :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
node --test scripts/update-asset.test.mjs
# With an isolated emulator already running:
./gradlew --no-daemon :app:connectedDebugAndroidTest
```

On Windows use `gradlew.bat`; explicitly set TEMP, TMP, TMPDIR, GRADLE_USER_HOME
and ANDROID_USER_HOME to task-owned directories on D: before running tools.
An example task root is `D:\CodexTemp\xdrive\android-native`; when the sandbox
cannot write there, use `D:\code\xdrive\tmp\android-native-20261023`.
Do not reuse or clean another task's emulator/user directory. Stop only the
emulator you started. Android Studio may open this `android` directory directly.

The APK is `app/build/outputs/apk/debug/app-debug.apk`. It is debug-signed for
testing, **not** a production-signed release or an automatic update channel.
Isolated local builds and CI can use different debug certificates. Android will
not install one over an APK signed by a different key: uninstall that earlier
test build first (this removes its saved Server address/HTTP preference), then
install and sign in again. Do not treat a debug APK as a stable update channel.
GitHub CI's `android-native` job uploads the exact tested APK and reports and is
required by the existing Final Gate. Existing Go/Web/Desktop gates stay intact.
Android's hosted-emulator job is GitHub-specific in this increment, like the
existing provider-specific jobs. GitLab does not build an Android APK yet; the
shared Server/Web/Desktop CI parity contract remains enforced unchanged.

## Public update checks (also before login)

Open the top-right menu → **检查更新**, even on the initial Server configuration
screen. Select GitHub or GitLab and check manually; the selected source survives
app restarts and logout. This uses a separate anonymous HTTP client, with no
Drive login/session, cookies, Authorization or background polling. Changing
source or closing the dialog cancels the request and rejects late responses.

GitHub reads the public `lazyxu/xdrive` Releases API over HTTPS. GitLab reads
`http://gitlab.t-fluid.com:1080/api/v4/projects/xuliang%2Fxdrive/releases` and
displays an explicit cleartext warning. Both metadata and APK downloads must be
publicly accessible without provider credentials; do not embed provider tokens
or change a private project's visibility just to enable updates. HTTP cannot
guarantee metadata authenticity: prefer GitHub/HTTPS on untrusted networks.

The checker examines the most recent **100 published releases** (including the
existing rolling `snapshot`, excluding drafts/upcoming releases), selecting the
highest Android versionCode from assets named exactly:

```text
xdrive-android-<versionCode>-<versionName>.apk
# Example: xdrive-android-3-0.1.2.apk
```

Server tags and Desktop installer versions are not Android versions. Equal or
older codes do not offer a downgrade; no Android asset is reported as *unknown*,
not “already current”. Missing/invalid metadata and provider/network errors are
retryable. Only official provider download paths are actionable; no arbitrary
host, credential-bearing URL or metadata redirect is followed.

**下载更新** opens the validated APK URL in the external browser. Android (not
xDrive) handles download permissions, unknown-source consent, package/version
and signing-certificate validation and the final install confirmation. This is
not a silent/background installer. Ordinary in-place updates require the same
application ID and signing key; switching providers must not change that key.

### Fixed release signing and packaging

The owner's local key is under project-root `.signing/android/`, ignored by Git
(as are root `tmp/` and `release/`). Keep and independently back up both the
PKCS12 keystore and its password. At the owner's request the local password file
is plaintext, **not** DPAPI-protected; Git ignore is neither encryption nor a
backup. Never upload this directory with CI artifacts or commit it.

Release signing consumes only process environment variables, never committed
passwords or keys. Example PowerShell after configuring D: task TEMP/TMP/TMPDIR,
GRADLE_USER_HOME and ANDROID_USER_HOME as above:

```powershell
$env:ANDROID_KEYSTORE_PATH = 'D:\code\xdrive\.signing\android\xdrive-android.p12'
$env:ANDROID_KEYSTORE_PASSWORD = [IO.File]::ReadAllText('D:\code\xdrive\.signing\android\keystore-password.txt')
try {
    .\gradlew.bat --no-daemon :app:assembleRelease
    # Before a later release, INCREASE androidVersionCode (max 2100000000).
    # Optional overrides: -PandroidVersionCode=4 -PandroidVersionName=0.1.3
} finally {
    Remove-Item Env:\ANDROID_KEYSTORE_PATH,Env:\ANDROID_KEYSTORE_PASSWORD -ErrorAction SilentlyContinue
}
# Using the configured Android SDK/JDK:
apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk
node scripts/update-asset.mjs app/build/outputs/apk/release/output-metadata.json ../release/android
```

The packaging helper copies APK bytes unchanged, uses the build's actual version
metadata, rejects debug/foreign/split/invalid builds and refuses overwrites. It
does **not** sign or verify certificates: verify the fixed release certificate
with `apksigner` before publication. Publish the resulting file as a GitHub
Release asset, or a same-origin GitLab generic package linked from its Release.
Preserve its full filename as the Release asset/link name; GitLab's link/direct
asset URL must point to that APK filename on the configured GitLab origin and
`xuliang/xdrive` project. Use the canonical `/-/releases/<tag>/downloads/<APK>`
direct asset link, or a generic-package API URL with encoded project namespace
`/api/v4/projects/xuliang%2Fxdrive/packages/generic/...`. Unverified numeric
project IDs are deliberately not accepted as direct download actions.

At implementation time GitHub Releases had no Android APK and GitLab has no
Android publishing job. This change does not auto-publish debug APKs, install
keys into hosted CI or alter GitLab project visibility. Both CI providers must
eventually receive the same private key through their protected secret stores
before enabling continuous signed APK publication. A local signed APK and
fixture tests alone do not prove a live provider-to-device upgrade.

## Test boundaries

- `core` tests send actual HTTP requests to a local fixture server and verify
  serialization, bounded pages, headers, redirects, cancellation and safe errors.
- `app` JVM tests cover navigation/session generations, retry, refresh and
  password-change gating; Compose instrumentation operates real UI controls
  against a fixture service.
- These are not proof of live production Server compatibility, physical-device
  permission behavior or background album delivery. Those must be reported
  separately, without production credentials or private files in test artifacts.

All credentials stay out of saved UI state/logs/backups. The app blocks screenshots
and recent-task previews. Logout clears local rows immediately and attempts remote
session revocation; an unreachable Server cannot be claimed to have revoked it.
