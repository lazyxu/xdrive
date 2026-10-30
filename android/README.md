# xDrive Android — native Kotlin/Jetpack Compose client

> **2026-10-30 architecture:** Android and iOS App product UIs are entirely native. Android already uses native Compose (NOT WebView); keep current Auth/Files/Gallery/Viewer/SAF/Media3/API/transfer code and finish gaps. Web/PWA is only a design/behavior reference, not a code-runtime dependency. Previous "first increment" missing-feature notes below describe historical stages, not necessarily current master. See [mobile-native-migration.md](../docs/architecture/mobile-native-migration.md).

Kotlin / Jetpack Compose, Android 10 (API 29) and later. This is a native
client of the existing xDrive Go Server, not a WebView wrapper.

## Scope

The native login card shares Desktop's compact structure: Server URL, optional
LAN IP, username, password reveal, and a default-on "保持登录" switch. The
client performs HTTPS route selection before sending credentials. Login and
mandatory password change use the existing Go Server endpoints.

By default HTTPS logins retain **only the refresh credential**, encrypted with
Android Keystore AES-GCM in private app preferences (excluded from Android backup).
Access tokens and raw passwords are never written to storage. On process restart,
the app performs one refresh against the saved Server/Owner; a rejected refresh
clears the credential, while a network outage keeps it for a later attempt.
Token rotation and password changes replace the encrypted credential. Explicit
logout removes it before the best-effort remote revocation. Unchecking "保持登录"
keeps the session in memory only, and HTTP never persists credentials.

The login UI defaults to automatic LAN-first selection when an optional private
IP is supplied, otherwise normal Server DNS. The older three-mode route transport
remains supported for existing saved settings and fixture compatibility but is not
part of the compact login UI. HTTPS preserves the original Host/SNI/hostname
verification, and certificate or identity errors never fall back to an untrusted
endpoint. The old manual HTTP connection remains opt-in in advanced settings;
it sends credentials in cleartext and must only be used on a trusted network.

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

Android Files additionally supports one-item Copy and Move through the
existing Go `POST /api/v1/nodes/{id}/copy` and revision-fenced
`PATCH /api/v1/nodes/{id}` contracts, with numeric `parent_id` JSON.
The native destination-folder picker walks authenticated `nodes/root` and
100-item `children` pages without trusting display paths. Selecting the
same folder for Move or a directory's own subtree is disabled. The original
file remains visible during Copy; Move removes it from its former folder only
after Server acknowledgement. Neither operation is automatically replayed if
the response or token-refresh outcome is uncertain. An uncertain write
freezes the picker confirmation and invalidates the stale browse snapshot
until a read-only refresh. Failed child-folder reads retry the intended
child rather than silently returning to the previous parent.

Structured filtering, saved searches, bulk file actions, upload/download,
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

### Download an Android APK directly from master

Every push to `master` runs the independent
[Android Master APK workflow](https://github.com/lazyxu/xdrive/actions/workflows/android-master-apk.yml?query=branch%3Amaster).
Select the latest **successful master run** and download its
`xdrive-android-master-<full commit SHA>` Artifact from the run's Artifacts
section (GitHub sign-in required). Extract the ZIP. It contains
`xdrive-android-master-<12-character SHA>-debug.apk`, `SHA256SUMS.txt`
and `BUILD_INFO.txt`. Verify the APK's checksum before installing.

This workflow compiles the exact `master` commit using `:app:assembleDebug`,
checks the APK's signing/container and package ID, and uploads the immutable
commit-named Artifact without waiting for the emulator or the full CI. You can
also run it manually with `workflow_dispatch` on `master`. Retention: 30 days.
This is **an Actions Artifact, not a Snapshot Release or Android update feed**.

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

### Explicit public fixed-key Android release (owner action only)

In addition to the automatic Debug Artifact, the repository now has a
**manual**, master-only [Android Signed Public Release workflow](https://github.com/lazyxu/xdrive/actions/workflows/android-signed-public-release.yml).
It will **not** publish on an ordinary master push, on a PR, or unless the owner
explicitly checks the release confirmation input.

It requires the owner to register the **fixed PKCS12 signing keystore**
(`ANDROID_RELEASE_KEYSTORE_P12_B64`), its password
(`ANDROID_RELEASE_KEYSTORE_PASSWORD`), and the separately verified public
signing certificate fingerprint (`ANDROID_RELEASE_CERT_SHA256`). Without them,
no public APK can be produced. A run verifies the true Release signer, package
ID and monotonically increased versionCode before publishing
`xdrive-android-<versionCode>-<versionName>.apk` as an immutable versioned
GitHub prerelease asset, with SHA256SUMS.txt. Unlike Actions Artifacts, an
actual **published public Release asset** is downloadable without logging in.
The app's existing anonymous update checker recognizes this asset name.

See [manual signing and release setup](docs/android-signed-public-release-20261028.md)
for the exact inputs, safeguards and local signer-fingerprint verification.
This does **not** auto-publish debug APKs, rotate certificates, embed keys,
change the independent server Snapshot publisher, or imply an installed update
has been tested on physical devices.

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

Native Files selection mode now works in the existing list/grid rows without
creating a second browser or backend. Up to 200 currently loaded Owner nodes
may be selected for one atomic `POST /api/v1/nodes/batch/delete` Trash
operation with per-item `{id, revision}` numeric fields. A confirmation is
required before any write; response `operation_id` and `deleted_ids` are
validated before showing success. Lost acknowledgement freezes the stale
browse selection until a new GET, and successful writes are followed by a
Server-authoritative refresh. Batch copy/move, selection across unloaded
ranges, and undo remain out of scope for this increment.

Root Files selection intercepts Android system Back to clear selected nodes before
leaving the Activity; the unselected root retains normal system Back. The native
App header uses the PWA 52dp content-height baseline plus status-bar insets.

Android Files now has a native "下载到设备" action for an Owner-verified loaded
file. A Storage Access Framework CreateDocument picker selects the target;
the existing authenticated /api/v1/files/:id/content endpoint streams bytes
through the same TLS/SNI/route-pinned OkHttp transport. No broad storage permission,
new Server endpoint or separate transfer runner is introduced. The in-flight
download reports bounded byte progress and can be cancelled; incomplete documents
are deleted on a best-effort basis, and revision, length and available SHA-256
metadata must match before completion. The SAF target URI is never retained in
UI state, logs or preferences. This is one-item export, not an upload flow,
resumable download or complete Transfer Center.

Manual Files upload uses Android OpenDocument to choose a single file. Only an
Owner-verified Browse directory can accept the late picker return. The original
Go /uploads UploadSession/8MiB chunk/finalize CAS pipeline is reused with
fail-on-conflict, bounded memory, chunk SHA-256 and Server-ACKed byte progress.
No new Server writer, WebView, persistent document URI grants or broad storage
permissions. The UI supports an explicit cancel action. Unknown file size or
invalid names fail before network. Full durable resume/foreground Service and
batch uploads are deferred; a lost final ACK is never automatically retried.


## Native Gallery — first usable photo wall increment

The Files account menu switches to the real native Gallery app; Gallery Back
returns to the previous Files Owner path. It uses the existing Go
`GET /api/v1/media/items?range=true&sort_by=captured&sort_dir=asc&unknown_first=true&fold_duplicates=true&initial_position=latest`
contract rather than a local directory filter or second media index. A sparse
last page opens at the newest photo; earlier items are prepended in 60-item
Owner-verified ranges. If the range's total changes during pagination, the
client refuses to merge unverified rows until a fresh request.

Image thumbnails and video posters are read from the authenticated
`/api/v1/media/items/:id/thumbnail?revision=...` endpoint through the same
route-pinned OkHttp client. The client bounds raw bytes to 4 MiB, decodes
reasonably sized images, keeps at most 48 in-memory thumbnails and limits
network concurrency to four. Unmounting a tile cancels its request; leaving
Gallery or switching Owner removes the gallery and its ephemeral cache.
There are no reusable public thumbnail URLs, disk token caches, WebViews or
second proxy servers.

Each visible Gallery tile now shows an indeterminate indicator while its
revisioned authenticated thumbnail is loading. Missing or undecodable derived
thumbnails remain placeholders with a failure-status badge and accessible
**long-press retry** on the tile (no floating operation button);
no automatic retry storm or fictional byte percentage is shown. Unmounting a
tile, leaving Gallery or changing Owner still cancels the existing request.
The retry reuses the same four-request concurrency and 4 MiB/48-image bounds.
This is not per-byte transfer progress or complete iOS visual parity.

Gallery tiles display real media markers. Image short-taps now open the
bounded original Viewer, and video short-taps open native Media3 playback.
Failed tile thumbnails still support long-press retry without a floating
operation control. Albums, indexed time-scale chrome, Live motion pairing,
over-32 MiB original image tiling, maps, editing, bulk selection, Gallery
transfer and final iOS 27 screenshot parity remain separate P0/P1 work.
The merged native behavior still requires exact Android CI validation.

## Gallery original image Viewer — native P0 increment

Image tiles now open a real full-screen native photo Viewer rather than the
metadata dialog. The Viewer reuses the existing authenticated, route-pinned
`GET /api/v1/files/:id/content` streaming code with its Node revision/ETag,
size and available SHA-256 verification. The compressed source stays in bounded
RAM (32 MiB maximum), is sampled to at most 2048 pixels on the long edge,
and is never written to a public URL, preferences or a persistent image cache.
Closing the Viewer cancels its scoped request; a separate viewer epoch discards
late bytes even when the same item is reopened. Native Back returns to the same
Gallery Range; double-tap zoom, pinch and pan are supported. Info remains a real
metadata dialog. No WebView or second Server endpoint is introduced.

This is only the *image* slice of P0 Viewer. Originals exceeding 32 MiB,
image tiling, adjacent-item swipe/filmstrip, actual video/Live playback, PDF,
full transfer center and pixel-for-pixel iOS 27 screenshot comparisons remain
open. Tests require the exact incremental PR SHA; no physical device
verification is claimed.

### Gallery → photo Viewer → exact scroll anchor

The Gallery's LazyGrid saveable viewport position and initial-latest positioning latch
now live in an Owner-keyed `SaveableStateProvider` on the same root App while the
Viewer replaces the Gallery. Returning to the wall restores its previous
visible position instead of jumping to the newest photo. Loading an entirely
new Gallery Range clears the positioning latch; Owner/session and private
thumbnail data remain non-persistent. A Compose API35 fixture scrolls to an
older photo, opens it, returns, and asserts that specific photo is still
visible (not merely that Gallery reopened).

### Gallery image Viewer adjacent navigation

Single-finger horizontal swipes at 1x zoom advance to the immediate verified
Owner photo in the current chronological Range. The Viewer does not silently
skip video tiles or fabricate an unloaded neighbor. A new selection invalidates
inflight original streams by Viewer epoch, and Compose cancels the old scoped
request; zoomed-in gestures remain for image pan. TalkBack has real previous/next
custom actions without floating buttons. JVM and API35 Compose fixtures cover
bounds, cancellation, swipe and return to the original Gallery scroll anchor.

## Android Gallery Media3 native Video MVP

Video tiles now open a real ExoPlayer/PlayerView with play/pause, buffering and
seek. The per-Viewer OkHttp client inherits the current Owner authenticated
XDriveApi DNS/TLS/SNI/Auto-LAN-Public route. Its scoped interceptor forwards
Bearer only to the *exact* versioned Go file content URL, sends If-Match, and
validates ETag plus exact Range offset/total size for every seek. No credential
in a URL, WebView, localhost proxy, disk cache, redirect or silent route retry.
Back, logout and server change cancel the private video Dispatcher immediately.

The native player reports unsupported codecs and revoked access as playback
failure, not success. Live Photo video pairing and iOS 27 pixel visual parity
remain later work. CI includes MockWebServer Range, stale ETag, 200 downgrade and
foreign-origin rejection, Controller Owner lifecycle, and API35 Compose opening/
closing a real native PlayerView.

Media3 is pinned to **1.7.1** while Android uses `compileSdk = 35`. The
previous 1.11.1 choice requires compileSdk 36 and failed the actual Android
Native `checkDebugAarMetadata` check (9 AAR metadata errors). Version 1.7.1
contains the same stable library code as 1.6.1; do not raise `targetSdk`
or globally upgrade the Android toolchain solely for this playback increment. The SaveableStateHolder now drops
this anchor when the user leaves Gallery for Files/logout/server switching;
a later Gallery visit (even for the same username) starts at newest again.
An API35 Compose regression covers old-position -> Files -> Gallery.

## Gallery: native single-photo download to device (P0)

Gallery's verified photo Info dialog now exposes **保存到设备** using the
**same** native SAF CreateDocument picker, Owner session, original revision,
TLS/SNI-pinned transport, stream verification and cancellation as Files.
The launch is allowed only for a currently selected photo/video Owner Range row;
a delayed picker callback after leaving Gallery, changing its Range, dismissing
Info or switching accounts is rejected and its newly created output discarded.
The Gallery and Files display the same transfer progress/success/cancel component;
download failures are separate from Gallery paging errors. Starting a new Owner
navigation cancels an in-flight export and best-effort deletes the partial file.
This is single-item export, not Gallery batch transfer, offline storage, a durable
transfer center, Live Photo resource-pair export or a production device acceptance.

### Gallery and Files: correct Android SAF MIME types

The unified Save to device uses one native `ACTION_CREATE_DOCUMENT` contract with
an allowlisted MIME type from the verified filename extension. JPEG/PNG/HEIC and
MP4/MOV, PDFs and plain text are declared as their real document/media type;
unknown, extensionless and Live `.livp` resources remain binary
`application/octet-stream`. Both Files and Gallery still share the exact same
content URI callback, Owner/revision checks and cancellation/partial-cleanup
logic. A chooser result with a non-`content:` URI is refused; no broad filesystem
permission or duplicate transfer implementation is added. This does not claim
that Android MediaStore automatically indexes SAF documents in every provider.

## Native Gallery Owner search (stacked follow-up)

The Gallery bottom-right Search entry queries the existing authenticated Go
`GET /api/v1/media/items?range=true&q=...` contract, never only the currently
loaded 60 thumbnails. It preserves chronological tail, verified absolute Range
pagination and the current Owner/TLS/route-pinned client. Changing or clearing
the query cancels its predecessor and invalidates the Viewer/thumbnail scope;
returning to Files or logging out discards the search terms. No full iOS 27
Collections, time-scale groups or generalized filters are claimed here.

## Android Gallery indexed Year / Month / Day navigation (dependent increment)

The native Gallery reads the existing Owner-authenticated Go `/media/items?range=true`
`timeline_group_sets` on the initial page: exact Year / Month / Day keys, counts
and absolute start indexes. The controller refuses malformed or incomplete index
partitions; it never computes a misleading 100k timeline from the 60 loaded rows.
The bottom 年 / 月 / 日 / 全部 controls open a bounded, lazy indexed-date chooser.
Selecting an actual group requests its exact absolute Offset through the same
Owner JWT, pinned TLS/SNI and existing 60-item Range endpoint. Returning to 全部
starts again at Server latest. Original Gallery query and media-kind filters
remain authoritative and never mix another Owner's index.

A jump starts near a selected date rather than pretending to load an entire
year/month; reaching the bottom fetches newer pages, reaching the top fetches
older ones. The top page at offset below 60 is allowed to overlap loaded rows,
but only after checking every overlapping node/revision. Failed jumps retry the
same absolute offset, never silently substitute newer photos or fabricate an
empty timeline. Leaving Gallery clears index state. No new Server endpoint,
SQLite photo index, background scan, persistent Owner cache or WebView is added.

This is **real indexed time navigation**, not yet full iOS 27 year/month/day
timeline rendering, a physical-device screenshot gate, Collections, Live Photo
held-motion playback or a complete transfer center. MockWebServer / Controller
JVM / API35 Compose regression source has been submitted; new HEAD CI must pass
before merging or calling the feature accepted.

## Files: exact "Show in Folder" with scroll-to-file and selection

Recent, Favorites and Search now locate the **specific current Owner Node**, not merely
its containing directory. Android uses the already-existing Go
`GET /api/v1/nodes/:id/location` and
`GET /api/v1/nodes/:parent/children/position` contracts to verify the latest
parent breadcrumb, file revision and its absolute position in the same
`name/asc/group=none/folders_first=true` order as native Files pages.
It reads only the containing 100-item page even for a 100k directory, then
renders the exact file in the first frame and highlights it as a selected
(non-editing) item in either List or Grid.

A stale/moved/deleted target leaves the original collection visible with an
error; no old Owner or delayed request can select a different Node. Earlier
pages are prepended only when scrolling back toward the top, while later
pages still use the existing 100-item append path. Stable item IDs preserve
the visible anchor and focused Node across paging. Folder **short-tap**
still enters the folder; its context-menu "Show in Folder" instead locates
and highlights the folder within its current parent.

Regression coverage: MockWebServer exact auth/sort/position and rejection of
malformed/stale DTOs; Controller 301-item position, bidirectional pagination,
revision mismatch and logout A→B cancellation; API35 Compose first-frame
List/Grid selection without enumerating all earlier rows.

Physical device pixel-level parity is still **not verified**. Run accurate
SHA JVM, lint, APK, API35 Compose and Final Gate before merging; do not
suppress or skip the safety tests.

## Native Files read-only text preview (MVP)

Text/code files opened from verified Files/Recent/Favorites/Search rows reuse
the existing authenticated Go `GET /api/v1/files/:id/preview/text` endpoint.
Android neither downloads an entire large original nor introduces a second
content writer, WebView, new preview service, or persistent private cache.

- A small filename allowlist merely controls the text-preview UI hint; the
  **Go Server is authoritative** for UTF-8 validity, MIME rejection (HTTP 415),
  current Owner authorization and its **1 MiB** maximum returned text.
- Android verifies the same Owner Node's ID, parent, name, size and revision
  **before and after** the bounded preview GET. The middle GET sends the
  original If-Match revision; the current Server implementation does not rely
  on that optional header, so the two authenticated Node checks are mandatory.
- Text lives only in current dialog state and is lazily displayed in 4 KiB
  Compose chunks. Closing, navigating, switching Server, logout or superseding
  the same file A→B→A cancels the old request and discards its private result.
  A 415/error never becomes a fake empty preview or auto-retry storm.
- The general JSON cap remains 2 MiB; only the authenticated preview endpoint
  permits a maximum 6 MiB + 1 KiB encoded JSON body, accounting for Unicode
  control-character escaping of Go's 1 MiB UTF-8 result. The decoded result
  is independently capped at 1 MiB.
- Tests cover current Owner/If-Match and stale revisions (MockWebServer),
  415/malformed/truncated/control-escaped text, Controller cancellation and
  explicit retries, and the native API35 visible text dialog.

**Not included:** PDF/image/video decoding, native Live Photo motion, PDF
annotation, editing source files, offline retention, virtualized cross-file
preview navigation, or 1:1 physical-device screenshot verification. Exact
source-head Android/JVM/lint/APK/API35 and branch checks are required before
merge; unavailable device-only evidence is recorded as unverified.

## Android Files/Gallery · first native transfer center (pending CI)

The top-right **传输** entry in Files, Gallery and Trash opens one
session-local transfer panel, backed exclusively by the existing SAF
upload/download operations in DriveController.

- It observes **actual Server-acknowledged upload chunks** and **actual SAF
  download-write callbacks**, showing IEC confirmed/total bytes, percent,
  elapsed session time, measured **whole-transfer average** and estimated
  remaining time only when a meaningful mean and known total are available.
  It does not invent instantaneous rates, unknown bytes, a pause/resume
  operation, or automatic retries.
- The active operation uses exactly the existing cancel control and Owner
  session/TLS/If-Match/SAF pipeline. A cancelled download is labelled cancelled
  and partial SAF output is discarded. Cancellation or ambiguous ACK during
  upload is labelled **结果未确认** (not "已上传"), with a directory-recheck warning;
  only a successful finalize ACK is recorded completed.
- The most recent 20 session operations can be inspected without leaving the
  current App. Terminal rows can be cleared without cancelling an active
  transfer. Switching Owner, logging out or changing Server destroys all
  filenames, progress/history and dialogs; no credentials, URIs, source bytes,
  transfer history, or private media are persisted.
- Scope is deliberately **single-file foreground SAF**. This is not yet the
  full Web/Desktop transfer center, queue management, batch transfers,
  background/notification delivery, durable resumable upload, independent
  per-connection speed, or all-device operation history.

JVM tests assert actual upload ACK, download partial bytes, failure, cancellation,
uncertain finalization, pure elapsed/speed/ETA math, 20-row bound and logout
privacy. API35 Compose tests cover the same top-right entry in Files/Gallery.
**Do not mark this increment released until accurate-head Android Native/JVM,
lint, debug APK and Compose tests pass.** Physical device inspection remains
unverified where unavailable, not a source-test waiver.
