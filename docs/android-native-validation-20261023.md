# Android native first increment — validation boundaries

User selected native Kotlin/Compose, incremental delivery and GitHub PR integration.
Source base: `31be6094efb1f070486d8d43f4490896d06f7b4b`. No Go Server, Web/Desktop,
Local Push v2, production configuration or GitLab changes are included.

## Implemented

- Server origin validation, HTTPS platform trust, explicit cleartext HTTP consent.
- Login, rotating refresh, mandatory password change, memory-only tokens; passwords
  are neither saved nor logged. Process restart requires login.
- Root/nested directories, parent/system Back, Server-ordered 100-row pages,
  metadata, refresh/retry, logout and Server switching.
- Cancellation plus generation fences, immediate old-account data clearing, atomic
  path/page updates after successful reads; failed navigation retains the previous
  successful directory with an explicit error.
- Adaptive launcher icon, secure screenshots/recents, disabled backup and explicit
  Android12+ data-extraction exclusions. Only Server origin/HTTP preference persists.

## Actual local evidence

Windows, existing JDK21.0.6, Gradle8.11.1 (official SHA256-verified distribution),
SDK35. Build caches and emulator data are isolated on D:.

```text
gradlew.bat --no-daemon -Pkotlin.compiler.execution.strategy=in-process
  :core:test :app:testDebugUnitTest :app:lintDebug
  :app:assembleDebug :app:assembleDebugAndroidTest
```

- Core: 14 tests pass, using actual loopback HTTP and local TLS. Covers real JSON/
  headers/query, refresh/password/logout, strict addresses/token parsing, redirects,
  bounded response bodies/ranges, safe errors and actual HTTP cancellation. Default
  trust rejects a self-signed test endpoint; only an explicitly injected test CA
  admits it. Production trust and hostname validation are never disabled.
- Controller: 11 tests pass, including non-cooperative late login/navigation,
  logout cancellation, paging, failed-navigation retry, first-page error, forced
  password change and refresh401/403/network/malformed failure reauthentication.
- Actual headless WHPX Android16/API36 emulator: APKs installed successfully;
  `am instrument` reports `OK (3 tests)`. Real Compose controls with fixture service
  exercise login/folder/details/back/logout, failed directory retry and HTTP opt-in.

Tests were authored first, but the initial preimplementation RED could not execute
while Gradle was unavailable. The first actual run found Unicode token handling,
a TLS fixture hostname mismatch and a module dependency export error. A subsequent
controller run genuinely reproduced refresh403 retaining FILES (10 tests,1 failure)
before the fix; its four refresh failure cases then passed. The first UI run was2/3:
after expanding the HTTP warning, the fixture test did not scroll to the submit
control. Explicit real scrolling plus a LOGIN-state assertion gave3/3. None of these
earlier failures is represented as having passed.

Final review added two bounded regressions: wrong current password must remain
retryable without a refresh/logout, and a malformed short nonfinal range must not
skip rows. Their focused RED run had 3 core and 1 controller failures; after the
fix all 25 unit tests passed. The final wrapper build/lint/APK run succeeded and
the reinstalled APK passed all 3 emulator UI tests. Scoped re-review found both
items addressed with no new issues. Final local debug APK SHA256:
`774f4f8eeee449357ebf525ff1c6bab79d46fa0d5727a4a1a47f015a3e5cc1bd`.

First GitHub run `39951576061` failed before Android compilation: setup-android@v3
defaulted to `tools platform-tools`, but sdkmanager could no longer find the legacy
`tools` package. The job now explicitly requests only `platform-tools`; SDK35 and
build-tools remain separately pinned. A local YAML contract check reproduced the
missing override then passed after this correction. This does not claim the cloud
SDK setup or the replacement exact-head CI passed; those must be observed directly.

Replacement run `39952246920` at `6889d1df` passed the complete Android job,
including API35 instrumentation and the debug APK/report artifact. Linux and
Windows Go jobs then correctly exposed an integration omission: the shared CI
parity test had not classified the new hosted-emulator job as GitHub-specific.
The correction uses the existing provider-specific mechanism and adds explicit
Android gate regression coverage; it does not remove shared jobs, weaken the
Final Gate or pretend that GitLab now builds Android. A further exact-head full
CI is required after that test-contract correction.
Local `go test ./internal/cicontract -count=1 -v` then passed all 7 top-level
tests and 8 negative mutation subtests. Independent scoped review accepted the
classification and explicit mandatory Android gate checks. No Server runtime or
Android application code changed in this CI-contract repair.

## Remaining gates and scope

- The PR's own exact-source full GitHub CI/Final Gate is required before integration,
  including the new API35 emulator job and unchanged Go/PostgreSQL/Web/Desktop gates.
  Local green is not a substitute for that CI result.
- API35 is an intentional AGP8.9.2 baseline; lint's OldTargetApi advisory is expected.
  This is a debug test APK, not a Play Store-ready or production-signed release.
- No live production Server, physical phone, Android10/minSDK device, TalkBack or
  OEM background behavior was exercised. Fixture testing is not production evidence.
- Uploads, Gallery, previews/downloads, editing, offline persistence and automatic
  album backup are not yet implemented. Next deliver manual media upload/Gallery,
  then opt-in one-way durable album backup using existing Server upload contracts.
- Remote logout is best effort. Clearing local credentials does not prove an
  unreachable Server revoked its session. No private production credentials/files
  are needed for source/CI acceptance.
