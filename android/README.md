# xDrive Android — native client, first increment

Kotlin / Jetpack Compose, Android 10 (API 29) and later. This is a separate native
client of the existing xDrive Go Server, not a WebView wrapper. The Server and
Web/Desktop implementations are unchanged.

## Scope

First increment: Server configuration, login, mandatory password change, root and
nested folder browsing, Server-ordered 100-item pages, refresh/retry, file metadata
and logout. Tokens are memory-only; a process restart requires login. Only the
Server address and explicit HTTP preference are saved. HTTPS uses platform trust
and hostname validation. HTTP sends credentials and content without encryption;
it requires explicit opt-in and should only be used on a trusted network.

This does **not** yet implement file preview/download/editing, upload, Gallery,
album synchronization or full Web/Desktop parity. Next increments add manual
media uploads and Gallery, then opt-in one-way album backup with a durable queue.
It does not activate unfinished Local Push v2 or create another content writer.

## Shared Web/Desktop appearance

The native Compose adapter uses the canonical xDrive brand from
`assets/icon/web/pwa-512.png`, the resolved shared MUI light/dark auth palette,
and the shared filename classification and Rounded Material action/file glyphs.
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
