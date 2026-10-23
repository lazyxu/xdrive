# Android Native Client Implementation Plan

> Implement the user-approved Kotlin/Compose client in small, independently usable GitHub PRs. Use test-driven development and verification before completion; the user's instruction to implement supersedes another design-approval round.

**Goal:** First ship an installable native Android client with Server configuration, login, and paged file browsing; then add manual photo/video upload and Gallery, followed by automatic album backup.

**Architecture:** Reuse the existing Go Server REST and upload protocols. Android UI is Kotlin/Jetpack Compose, with a platform-independent Kotlin HTTP client. No WebView, React port, new content writer, or activation of incomplete Local Push v2.

**Tech stack:** Kotlin 2.1.20, Compose BOM 2025.04.01, Android Gradle plugin 8.9.2, Gradle 8.11.1, compile/target SDK 35, minimum SDK 29, Java 17, OkHttp 4.12.0, kotlinx serialization 1.8.0/coroutines 1.10.1.

**Spec:** User decisions in this task: prioritize native experience, implement the three increments in order, validate and deliver through GitHub PRs. This document records the concrete first-increment contract.

## Global constraints

- First increment: native Server/login screens, password-change-required flow, root and nested folder browsing, parent/back navigation, bounded 100-item Server-ordered pages, file metadata dialog, refresh/retry, logout and Server change. No claim of full Desktop/Web parity or automatic backup.
- HTTPS verifies platform CA and host names. HTTP requires an explicit insecure-connection choice. Reject embedded credentials, query/fragment, non-root paths and non-HTTP schemes. Never follow API redirects with credentials.
- Session tokens remain in memory in this first increment; only the Server address/HTTP preference are persisted. Passwords/tokens are never logged, put in URLs, backups, saved UI state or screenshots. App process restart requires login.
- Directory path/page becomes current only when its request succeeds. Navigation/account changes cancel obsolete HTTP and fence late results. Failure is not an empty directory. A page holds at most 100 rows; next/previous page replaces rows rather than accumulating an entire directory.
- Preserve all existing source and AGENTS history. Freeze base `31be6094efb1f070486d8d43f4490896d06f7b4b`; exactly one work commit for the first PR. GitHub only; no GitLab push.
- Windows temporary files, downloads, Gradle cache, emulator state and diagnostics live under `D:\code\xdrive\tmp\android-native-20261023` (workspace fallback for the D-drive temporary directory policy). Set TEMP/TMP/TMPDIR for every spawned process.
- Debug APK is an explicit test artifact. No production signing key generation or stable-release publication is implied.

## Review focus

- Invalid Server URLs, explicit HTTP opt-in, TLS errors, cross-origin redirects and secret-bearing error bodies.
- Slow/cancelled login or directory requests completing after logout, account change or a newer navigation.
- First-page errors, empty folders, final/previous pages and malformed/mismatched Server pagination.
- Expired/revoked sessions, refresh rotation and must-change-password accounts.
- Small screens, keyboard/insets, rotation, system Back and process restart without leaked credentials.

## First PR tasks

### 1. Kotlin API and real HTTP tests

- Create `android/core` JVM module and `com.tfluid.xdrive.core` protocol models, validated Server address and `XDriveApi` implementation of `XDriveService`.
- Consume existing `/api/v1/auth/{login,refresh,logout}`, `/me/change-password`, `/nodes/root`, `/nodes/:id/children?offset=...&limit=100&sort=name&order=asc&group=none&folders_first=true&include_count=true`.
- Interface: `login(username,password)`, `refresh(refreshToken)`, `logout(refreshToken)`, `changePassword(accessToken,currentPassword,newPassword)`, `root(accessToken)`, `children(accessToken,parentId,offset)`; all suspend functions. Return `AuthSession`, `DriveNode`, `NodeRange`; represent HTTP errors without raw response bodies.
- Write behavior tests first against a local HTTP server: URL rejection, real payload/headers, pagination, refresh/password flow, non-followed redirects, cancellation and safe failures. Run RED then GREEN with `:core:test`.

### 2. Native application and state lifecycle

- Create `android/app` Compose application (`com.tfluid.xdrive`, display name xDrive), lifecycle controller and manifest/resources; no production device permissions beyond Internet/network state.
- Bind connection/login/password-change and folder/file-metadata screens to the above service. Use in-memory ViewModel state and generation-safe cancellable requests.
- Add controller tests for actual late results, logout/cancellation, paging bounds, retry and required password change. Add Compose UI instrumentation for connection/login/browse/back/error states.
- Verify `:core:test :app:testDebugUnitTest :app:lintDebug :app:assembleDebug` and Android-emulator smoke when available. Distinguish fixture, live Server and physical-device evidence.

### 3. Reproducible build, CI and delivery

- Commit Gradle wrapper with verified distribution checksum, project ignore rules, build/readme instructions and this plan/status record.
- Add Android tests/build job to the existing GitHub CI and its final-gate. Keep all existing gates intact. Upload the exact debug APK and test reports as CI artifacts.
- Fresh independent diff review, relevant local checks and one work commit. Push `codex/android-native`, open/attach PR, require its exact-source complete CI, fix within the same commit when necessary, then linear-history merge and branch cleanup. Do not wait for post-merge master CI.

## Subsequent increments

1. Manual media selection and streaming upload via existing ordinary UploadSession; progress/cancel, basic Gallery and real byte/hash verification. No full-file base64 or unbounded copies.
2. Opt-in one-way album backup with explicit media permissions, durable queue, network/charging preferences, duplicate/ACK reconciliation and WorkManager recovery. Never claim success from a transient upload response or silently propagate deletions.
3. Extend native functionality against an explicit Web/Desktop parity inventory; OS-specific capabilities get Android equivalents. Each increment receives its own focused PR and validation.

## Progress

- First native implementation is present: HTTP client, Compose app, memory-only session controller, bounded file browser, Gradle wrapper and GitHub CI gate.
- Local candidate verification: 14 real HTTP/TLS tests, 11 controller tests, 3 actual API36 emulator Compose fixture tests pass; lint/build and APK installation pass. Final review's wrong-password and short-page findings were reproduced, fixed and scoped re-reviewed. Exact-head GitHub CI and PR integration remain pending. See `docs/android-native-validation-20261023.md` for boundaries.
- Manual media upload/Gallery and automatic album backup are still subsequent increments, not claimed complete.
